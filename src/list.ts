// The repository's open pull requests as a list: GraphQL reads, the pure
// normalizer, grouping and paging. fetchList and fetchCounts take the Exec.
//
// Cost, measured live against cli/cli: LIST_QUERY 3 points (100 nodes with
// labels, review requests and check counts), REQUESTED_QUERY 1, COUNTS_QUERY 1.
// `first: 0` is allowed on a search that only needs issueCount.

import { runGh } from './gh'
import type { Exec, GhResult } from './gh'
import type { AccountChoice, ListChecks, ListCounts, ListGroup, ListItem, PrList, Problem, RateLimit, RepoLocation, ReviewDecision } from './model'
import { backoffMs, isTransient, reasonOf } from './scheduler'

/** Most pull requests one list read returns; a repository with more is truncated. */
export const LIST_LIMIT = 100

/** Rows per page of the list. */
export const PAGE_SIZE = 25

/** The list is read again this often while its pane is open. */
export const LIST_POLL_MS = 60_000

/** The band's counts are read again this often. */
export const COUNTS_POLL_MS = 300_000

/** A failed counts read is tried again after this long, never sooner. */
export const COUNTS_RETRY_MS = 60_000

/** Group order, as drawn. */
export const GROUPS: readonly ListGroup[] = ['yours', 'requested', 'waiting', 'other']

/** Open pull requests, newest first: variable $q (`repo:<owner>/<repo> is:pr is:open sort:created-desc`). */
export const LIST_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: ${LIST_LIMIT}) {
    issueCount
    nodes {
      ... on PullRequest {
        id number title url isDraft createdAt
        author { login }
        labels(first: 10) { nodes { name color } }
        reviewDecision
        reviewRequests(first: 10) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } ... on Bot { login } } } }
        comments { totalCount }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts { checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`

/** Numbers of the pull requests whose review is requested from the viewer, teams included: variable $q (`... review-requested:@me`). */
export const REQUESTED_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: ${LIST_LIMIT}) {
    issueCount
    nodes { ... on PullRequest { number } }
  }
}`

/** The two numbers of the band: variables $yours (`... author:@me`) and $requested (`... review-requested:@me`). */
export const COUNTS_QUERY = `query($open: String!, $yours: String!, $requested: String!) {
  open: search(query: $open, type: ISSUE, first: 0) { issueCount }
  yours: search(query: $yours, type: ISSUE, first: 0) { issueCount }
  requested: search(query: $requested, type: ISSUE, first: 0) { issueCount }
  rateLimit { cost remaining resetAt }
}`

export type NormalizedList = {
  items: ListItem[]
  total: number
  isTruncated: boolean
}

export type ListRow = { group: ListGroup; item: ListItem }

export type Page = {
  rows: ListRow[]
  /** 1-based, clamped into 1..pageCount. */
  page: number
  pageCount: number
  /** 1-based position of the first and last row on the page among all rows; 0 when empty. */
  first: number
  last: number
  /** Rows after the draft filter. */
  total: number
}

type Failure = Extract<GhResult, { isOk: false }>

export type FetchedList =
  | { kind: 'ok'; items: ListItem[]; total: number; isTruncated: boolean; rateLimit: RateLimit | null }
  | { kind: 'error'; failure: Failure }

export type FetchedCounts =
  | { kind: 'ok'; counts: ListCounts; rateLimit: RateLimit | null }
  | { kind: 'error'; failure: Failure }

type Obj = Record<string, unknown>

function asObj(value: unknown): Obj | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : null
}

function asStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nodesOf(value: unknown): Obj[] {
  const nodes = asObj(value)?.nodes
  if (!Array.isArray(nodes)) return []
  const result: Obj[] = []
  for (const node of nodes) {
    const obj = asObj(node)
    if (obj !== null) result.push(obj)
  }
  return result
}

const REVIEW_DECISIONS: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
}

/** Check run and status context states that count as passed: SUCCESS only. */
const PASSED = new Set(['SUCCESS'])

/** Failed: FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE and ERROR (a commit status). */
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

/** Pending: QUEUED, IN_PROGRESS, PENDING, WAITING, REQUESTED and EXPECTED (a commit status). */
const PENDING = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED'])

/**
 * The counts of a statusCheckRollup. passed = SUCCESS; failed = FAILURE +
 * TIMED_OUT + CANCELLED + ACTION_REQUIRED + STARTUP_FAILURE + ERROR; pending =
 * QUEUED + IN_PROGRESS + PENDING + WAITING + REQUESTED + EXPECTED. Everything
 * else (SKIPPED, NEUTRAL, STALE, COMPLETED) counts only toward total, so
 * total = passed + failed + pending + skipped/neutral. Check runs and commit
 * statuses are summed. Null when the commit has no rollup.
 */
export function checksFrom(rollup: unknown): ListChecks | null {
  const contexts = asObj(asObj(rollup)?.contexts)
  if (contexts === null) return null
  const checks: ListChecks = { passed: 0, failed: 0, pending: 0, total: 0 }
  for (const key of ['checkRunCountsByState', 'statusContextCountsByState']) {
    const entries = contexts[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const obj = asObj(entry)
      const count = asNum(obj?.count)
      const state = asStr(obj?.state)?.toUpperCase() ?? ''
      if (count === null || count <= 0) continue
      checks.total += count
      if (PASSED.has(state)) checks.passed += count
      else if (FAILED.has(state)) checks.failed += count
      else if (PENDING.has(state)) checks.pending += count
    }
  }
  return checks
}

/**
 * True when a review is requested from someone other than the viewer. A team
 * is someone else, unless the viewer asked for it via requestedFromViewer; a
 * request whose reviewer GitHub hid (null) is someone else too.
 */
function hasOtherRequests(node: Obj, viewer: string, requestedFromViewer: boolean): boolean {
  const me = viewer.toLowerCase()
  for (const request of nodesOf(node.reviewRequests)) {
    const reviewer = asObj(request.requestedReviewer)
    if (reviewer === null) return true
    if (reviewer.__typename === 'Team') {
      if (!requestedFromViewer) return true
      continue
    }
    const login = asStr(reviewer.login)
    if (login === null || login.toLowerCase() !== me) return true
  }
  return false
}

function toItem(node: Obj, requestedNumbers: ReadonlySet<number>, viewer: string): ListItem | null {
  const id = asStr(node.id)
  const number = asNum(node.number)
  if (id === null || number === null) return null
  const labels: { name: string; color: string }[] = []
  for (const label of nodesOf(node.labels)) {
    const name = asStr(label.name)
    if (name !== null) labels.push({ name, color: asStr(label.color) ?? '' })
  }
  const rollup = asObj(nodesOf(node.commits)[0]?.commit)?.statusCheckRollup
  const isRequested = requestedNumbers.has(number)
  return {
    id,
    number,
    title: asStr(node.title) ?? '',
    url: asStr(node.url) ?? '',
    isDraft: node.isDraft === true,
    author: asStr(asObj(node.author)?.login),
    createdAt: asStr(node.createdAt) ?? '',
    labels,
    reviewDecision: REVIEW_DECISIONS[asStr(node.reviewDecision) ?? ''] ?? null,
    requestedFromViewer: isRequested,
    hasOtherRequests: hasOtherRequests(node, viewer, isRequested),
    checks: checksFrom(rollup),
    comments: asNum(asObj(node.comments)?.totalCount) ?? 0,
  }
}

/**
 * Turns LIST_QUERY's answer into list items. `requestedNumbers` comes from
 * REQUESTED_QUERY. Pure; never throws; malformed pull requests are dropped.
 */
export function normalizeList(raw: unknown, requestedNumbers: ReadonlySet<number>, viewer: string): NormalizedList {
  const search = asObj(asObj(asObj(raw)?.data)?.search)
  const items: ListItem[] = []
  for (const node of nodesOf(search)) {
    const item = toItem(node, requestedNumbers, viewer)
    if (item !== null) items.push(item)
  }
  const total = Math.max(asNum(search?.issueCount) ?? 0, items.length)
  return { items, total, isTruncated: total > LIST_LIMIT }
}

/** The pull request numbers of REQUESTED_QUERY's answer. Pure; never throws. */
export function requestedNumbersOf(raw: unknown): Set<number> {
  const numbers = new Set<number>()
  for (const node of nodesOf(asObj(asObj(raw)?.data)?.search)) {
    const number = asNum(node.number)
    if (number !== null) numbers.add(number)
  }
  return numbers
}

function byNewest(a: ListItem, b: ListItem): number {
  const left = Date.parse(a.createdAt)
  const right = Date.parse(b.createdAt)
  return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left)
}

/**
 * Splits items into the four groups, each newest first. yours = authored by the
 * viewer; requested = review requested from the viewer, not yours; waiting =
 * review requested from someone else, in neither of those; other = the rest.
 * Pure, exported for tests.
 */
export function groupItems(items: readonly ListItem[], viewer: string): Record<ListGroup, ListItem[]> {
  const me = viewer.toLowerCase()
  const groups: Record<ListGroup, ListItem[]> = { yours: [], requested: [], waiting: [], other: [] }
  for (const item of items) {
    if (item.author !== null && item.author.toLowerCase() === me) groups.yours.push(item)
    else if (item.requestedFromViewer) groups.requested.push(item)
    else if (item.hasOtherRequests) groups.waiting.push(item)
    else groups.other.push(item)
  }
  for (const group of GROUPS) groups[group].sort(byNewest)
  return groups
}

/**
 * One page across the groups in order. Drafts are filtered before paging when
 * hideDrafts is set. `page` is 1-based and clamped. Pure, exported for tests.
 */
export function paginate(grouped: Record<ListGroup, ListItem[]>, page: number, pageSize: number = PAGE_SIZE, hideDrafts: boolean): Page {
  const rows: ListRow[] = []
  for (const group of GROUPS) {
    for (const item of grouped[group]) {
      if (hideDrafts && item.isDraft) continue
      rows.push({ group, item })
    }
  }
  const size = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const wanted = Number.isFinite(page) ? Math.floor(page) : 1
  const clamped = Math.min(Math.max(wanted, 1), pageCount)
  const start = (clamped - 1) * size
  const slice = rows.slice(start, start + size)
  return {
    rows: slice,
    page: clamped,
    pageCount,
    first: slice.length === 0 ? 0 : start + 1,
    last: start + slice.length,
    total: rows.length,
  }
}

function toRateLimit(value: unknown): RateLimit | null {
  const limit = asObj(value)
  const remaining = asNum(limit?.remaining)
  const resetAt = asStr(limit?.resetAt)
  return remaining === null || resetAt === null ? null : { remaining, resetAt }
}

/** An answer that is not JSON (an HTML error page, a cut-off body) is GitHub's fault, so it is retried. */
function unreadable(): Failure {
  return { isOk: false, kind: 'server', exitCode: null, message: 'GitHub sent an unreadable answer', stdout: '' }
}

function failed(message: string): Failure {
  return { isOk: false, kind: 'failed', exitCode: null, message, stdout: '' }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** The first error of a GraphQL answer that carries `errors` and no data to use. */
function graphqlMessage(answer: unknown): string | null {
  const errors = asObj(answer)?.errors
  if (!Array.isArray(errors) || errors.length === 0 || asObj(asObj(answer)?.data) !== null) return null
  return asStr(asObj(errors[0])?.message) ?? 'GraphQL error'
}

/** Runs one query and parses it: the answer, or the failure. */
async function ask(exec: Exec, query: string, variables: Record<string, string>, location: RepoLocation, login: string): Promise<{ answer: unknown } | { failure: Failure }> {
  // -f, not -F: -F would turn a value like "123", "true" or "@file" into a number, bool or file read.
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [name, value] of Object.entries(variables)) args.push('-f', `${name}=${value}`)
  const ran = await runGh(exec, args, { login, cwd: location.cwd })
  if (!ran.isOk) return { failure: ran }
  const answer = parseJson(ran.stdout)
  if (answer === null) return { failure: unreadable() }
  const message = graphqlMessage(answer)
  if (message !== null) return { failure: failed(message) }
  return { answer }
}

function searchOf(location: RepoLocation, qualifiers: string): string | null {
  if (location.owner === null || location.repo === null) return null
  return `repo:${location.owner}/${location.repo} is:pr is:open ${qualifiers}`.trim()
}

/**
 * Reads the repository's open pull requests (3 points) and which of them wait
 * for the viewer's review (1 point), both at once. `login` is the account the
 * reads run as, and so the viewer that `@me` and the groups mean.
 */
export async function fetchList(exec: Exec, location: RepoLocation, login: string): Promise<FetchedList> {
  const list = searchOf(location, 'sort:created-desc')
  const requested = searchOf(location, 'review-requested:@me')
  if (list === null || requested === null) return { kind: 'error', failure: failed('no GitHub repository to list') }
  const [listed, requestedAsked] = await Promise.all([
    ask(exec, LIST_QUERY, { q: list }, location, login),
    ask(exec, REQUESTED_QUERY, { q: requested }, location, login),
  ])
  if ('failure' in listed) return { kind: 'error', failure: listed.failure }
  if ('failure' in requestedAsked) return { kind: 'error', failure: requestedAsked.failure }
  const normalized = normalizeList(listed.answer, requestedNumbersOf(requestedAsked.answer), login)
  return { kind: 'ok', ...normalized, rateLimit: toRateLimit(asObj(asObj(listed.answer)?.data)?.rateLimit) }
}

/** Reads the band's two numbers for a branch without a pull request (1 point). */
export async function fetchCounts(exec: Exec, location: RepoLocation, login: string, now: () => string = () => new Date().toISOString()): Promise<FetchedCounts> {
  const open = searchOf(location, '')
  const yours = searchOf(location, 'author:@me')
  const requested = searchOf(location, 'review-requested:@me')
  if (open === null || yours === null || requested === null) return { kind: 'error', failure: failed('no GitHub repository to count') }
  const asked = await ask(exec, COUNTS_QUERY, { open, yours, requested }, location, login)
  if ('failure' in asked) return { kind: 'error', failure: asked.failure }
  const data = asObj(asObj(asked.answer)?.data)
  return {
    kind: 'ok',
    counts: {
      open: asNum(asObj(data?.open)?.issueCount) ?? 0,
      yours: asNum(asObj(data?.yours)?.issueCount) ?? 0,
      requested: asNum(asObj(data?.requested)?.issueCount) ?? 0,
      at: now(),
    },
    rateLimit: toRateLimit(data?.rateLimit),
  }
}

/** The transient failure a list is retrying, if any. */
export function listProblemOf(list: PrList | null): Problem | null {
  if (list === null || list.kind === 'loading') return null
  return list.problem ?? null
}

/**
 * The list after a read. A transient failure keeps the last list and marks it
 * with a problem (15, 30, then 60 s backoff, as for the pull request); with no
 * list to keep it becomes an error that still carries the problem.
 */
export function listAfter(prev: PrList | null, fetched: FetchedList, at: string, location: RepoLocation, account: AccountChoice): PrList {
  if (fetched.kind === 'ok') {
    return { kind: 'list', at, location, account, items: fetched.items, total: fetched.total, isTruncated: fetched.isTruncated, problem: null }
  }
  const failure = fetched.failure
  if (!isTransient(failure.kind)) return { kind: 'error', at, message: failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message }
  const earlier = listProblemOf(prev)
  const problem: Problem = { reason: reasonOf(failure), since: earlier?.since ?? at, triedAt: at, retryInMs: backoffMs(earlier?.retryInMs ?? null) }
  if (prev !== null && prev.kind === 'list') return { ...prev, problem }
  return { kind: 'error', at, message: failure.message, problem }
}

/** Milliseconds until the next read of the list. */
export function listDelayMs(list: PrList | null): number {
  return listProblemOf(list)?.retryInMs ?? LIST_POLL_MS
}

/** Rows the list pane needs for its current page: the page's rows, a header per group shown, and the title and footer lines. */
export function listRowCount(list: PrList | null, page: number, hideDrafts: boolean): number {
  if (list === null || list.kind !== 'list') return 6
  const shown = paginate(groupItems(list.items, list.account.login), page + 1, PAGE_SIZE, hideDrafts)
  const groups = new Set(shown.rows.map(row => row.group)).size
  return Math.min(40, Math.max(6, shown.rows.length + groups + 4))
}

/** The highest zero-based page of the list under the current draft filter. */
export function lastPage(list: PrList | null, hideDrafts: boolean): number {
  if (list === null || list.kind !== 'list') return 0
  return paginate(groupItems(list.items, list.account.login), 1, PAGE_SIZE, hideDrafts).pageCount - 1
}
