// The repository's open issues: GraphQL reads for the list and for one issue,
// the pure normalizers, grouping and paging. fetchIssues and fetchIssue take the Exec.
//
// Cost, measured live: ISSUE_LIST_QUERY 3 points (100 nodes with labels,
// assignees and linked pull requests), MENTIONED_QUERY 1, ISSUE_DETAIL_QUERY 1.

import type { Exec } from './gh'
import { LIST_LIMIT, PAGE_SIZE, ask, asNum, asObj, asStr, failed, nodesOf, toRateLimit } from './list'
import type { Failure } from './list'
import type { AccountChoice, Issue, IssueComment, IssueGroup, IssueItem, IssueList, IssueSnapshot, LinkedPr, Problem, RateLimit, RepoLocation } from './model'
import { SLUG_PATTERN, cleanStr } from './text'
import { backoffMs, isTransient, reasonOf } from './scheduler'

/** Group order, as drawn. */
export const ISSUE_GROUPS: readonly IssueGroup[] = ['assigned', 'opened', 'mentioned', 'other']

/** Open issues, newest first: variable $q (`repo:<owner>/<repo> is:issue is:open sort:created-desc`). */
export const ISSUE_LIST_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: ${LIST_LIMIT}) {
    issueCount
    nodes {
      ... on Issue {
        id number title url createdAt
        author { login }
        labels(first: 10) { nodes { name color } }
        assignees(first: 5) { nodes { login } }
        comments { totalCount }
        closedByPullRequestsReferences(first: 3) { nodes { number repository { nameWithOwner } } }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`

/** Numbers of the open issues that mention the viewer: variable $q (`... mentions:@me`). */
export const MENTIONED_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: ${LIST_LIMIT}) {
    issueCount
    nodes { ... on Issue { number } }
  }
}`

/** One issue by number: variables $owner, $name and $n (an Int, so sent with -F). */
export const ISSUE_DETAIL_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      id number title url state stateReason createdAt
      author { login }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      milestone { title }
      body
      comments(last: 10) {
        totalCount
        nodes { author { login __typename } createdAt lastEditedAt body url }
      }
      closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number title state repository { nameWithOwner } } }
    }
  }
  rateLimit { cost remaining resetAt }
}`

export type NormalizedIssues = {
  items: IssueItem[]
  total: number
  isTruncated: boolean
}

export type IssueRow = { group: IssueGroup; item: IssueItem }

export type IssuePage = {
  rows: IssueRow[]
  /** 1-based, clamped into 1..pageCount. */
  page: number
  pageCount: number
  /** 1-based position of the first and last row on the page among all rows; 0 when empty. */
  first: number
  last: number
  total: number
}

export type FetchedIssues =
  | { kind: 'ok'; items: IssueItem[]; total: number; isTruncated: boolean; rateLimit: RateLimit | null }
  | { kind: 'error'; failure: Failure }

export type FetchedIssue =
  | { kind: 'ok'; issue: Issue; rateLimit: RateLimit | null }
  | { kind: 'error'; number: number; failure: Failure }

function labelsOf(node: unknown): { name: string; color: string }[] {
  const labels: { name: string; color: string }[] = []
  for (const label of nodesOf(node)) {
    const name = cleanStr(label.name)
    if (name !== null) labels.push({ name, color: asStr(label.color) ?? '' })
  }
  return labels
}

function loginsOf(node: unknown): string[] {
  const logins: string[] = []
  for (const user of nodesOf(node)) {
    const login = cleanStr(user.login)
    if (login !== null) logins.push(login)
  }
  return logins
}

/** `owner/name` of a node's repository; null when absent or not a plain slug. */
function repoOf(node: Record<string, unknown>): string | null {
  const slug = asStr(asObj(node.repository)?.nameWithOwner)
  return slug !== null && SLUG_PATTERN.test(slug) ? slug : null
}

function toItem(node: Record<string, unknown>, mentioned: ReadonlySet<number>, current: string | null): IssueItem | null {
  const id = asStr(node.id)
  const number = asNum(node.number)
  if (id === null || number === null) return null
  const linkedPrs: number[] = []
  for (const pr of nodesOf(node.closedByPullRequestsReferences)) {
    const linked = asNum(pr.number)
    const repo = repoOf(pr)
    if (linked === null) continue
    // A pull request of another repository is not this issue's fix here.
    if (current !== null && repo !== null && repo.toLowerCase() !== current.toLowerCase()) continue
    linkedPrs.push(linked)
  }
  return {
    id,
    number,
    title: cleanStr(node.title) ?? '',
    url: asStr(node.url) ?? '',
    author: cleanStr(asObj(node.author)?.login),
    createdAt: asStr(node.createdAt) ?? '',
    labels: labelsOf(node.labels),
    assignees: loginsOf(node.assignees),
    comments: asNum(asObj(node.comments)?.totalCount) ?? 0,
    linkedPrs,
    mentionsViewer: mentioned.has(number),
  }
}

/**
 * Turns ISSUE_LIST_QUERY's answer into list items. `mentionedNumbers` comes from
 * MENTIONED_QUERY. `repository` is the one listed (`owner/name`): linked pull
 * requests of any other repository are not counted. Pure; never throws;
 * malformed issues are dropped.
 */
export function normalizeIssues(raw: unknown, mentionedNumbers: ReadonlySet<number>, repository: string | null = null): NormalizedIssues {
  const search = asObj(asObj(asObj(raw)?.data)?.search)
  const items: IssueItem[] = []
  for (const node of nodesOf(search)) {
    const item = toItem(node, mentionedNumbers, repository)
    if (item !== null) items.push(item)
  }
  const total = Math.max(asNum(search?.issueCount) ?? 0, items.length)
  return { items, total, isTruncated: total > LIST_LIMIT }
}

/** The issue numbers of MENTIONED_QUERY's answer. Pure; never throws. */
export function mentionedNumbersOf(raw: unknown): Set<number> {
  const numbers = new Set<number>()
  for (const node of nodesOf(asObj(asObj(raw)?.data)?.search)) {
    const number = asNum(node.number)
    if (number !== null) numbers.add(number)
  }
  return numbers
}

function byNewest(a: IssueItem, b: IssueItem): number {
  const left = Date.parse(a.createdAt)
  const right = Date.parse(b.createdAt)
  return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left)
}

/**
 * Splits items into the four groups, each newest first; the first match wins.
 * assigned = the viewer is an assignee; opened = authored by the viewer;
 * mentioned = the viewer is mentioned; other = the rest. Pure, exported for tests.
 */
export function groupIssues(items: readonly IssueItem[], viewer: string): Record<IssueGroup, IssueItem[]> {
  const me = viewer.toLowerCase()
  const groups: Record<IssueGroup, IssueItem[]> = { assigned: [], opened: [], mentioned: [], other: [] }
  for (const item of items) {
    if (item.assignees.some(login => login.toLowerCase() === me)) groups.assigned.push(item)
    else if (item.author !== null && item.author.toLowerCase() === me) groups.opened.push(item)
    else if (item.mentionsViewer) groups.mentioned.push(item)
    else groups.other.push(item)
  }
  for (const group of ISSUE_GROUPS) groups[group].sort(byNewest)
  return groups
}

/** One page across the groups in order. `page` is 1-based and clamped. Pure, exported for tests. */
export function paginateIssues(grouped: Record<IssueGroup, IssueItem[]>, page: number, pageSize: number = PAGE_SIZE): IssuePage {
  const rows: IssueRow[] = []
  for (const group of ISSUE_GROUPS) {
    for (const item of grouped[group]) rows.push({ group, item })
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

/** Terminal rows one issue takes: title line, meta line, blank line. */
export const ROWS_PER_ISSUE = 3

/**
 * Rows the issue list needs for its current page: 3 per issue, minus the blank
 * after the last one of each group, a heading per group, a blank before every
 * heading but the first, and 4 for the header, the footer and slack. At most 40.
 */
export function issueRowCount(list: IssueList | null, page: number): number {
  if (list === null || list.kind !== 'list') return 6
  const shown = paginateIssues(groupIssues(list.items, list.account.login), page + 1)
  const groups = new Set(shown.rows.map(row => row.group)).size
  // Per group: its heading (+1) and no blank after its last issue (-1); between groups, one blank.
  const body = shown.rows.length * ROWS_PER_ISSUE + Math.max(0, groups - 1)
  return Math.min(40, Math.max(6, body + 4))
}

/** The highest zero-based page of the issue list. */
export function lastIssuePage(list: IssueList | null): number {
  if (list === null || list.kind !== 'list') return 0
  return paginateIssues(groupIssues(list.items, list.account.login), 1).pageCount - 1
}

function issueSearch(location: RepoLocation, qualifiers: string): string | null {
  if (location.owner === null || location.repo === null) return null
  return `repo:${location.owner}/${location.repo} is:issue is:open ${qualifiers}`.trim()
}

/**
 * Reads the repository's open issues (3 points) and which of them mention the
 * viewer (1 point), both at once. `login` is the account the reads run as, and
 * so the viewer that `@me` and the groups mean.
 */
export async function fetchIssues(exec: Exec, location: RepoLocation, login: string): Promise<FetchedIssues> {
  const list = issueSearch(location, 'sort:created-desc')
  const mentioned = issueSearch(location, 'mentions:@me')
  if (list === null || mentioned === null) return { kind: 'error', failure: failed('no GitHub repository to list') }
  const [listed, mentionedAsked] = await Promise.all([
    ask(exec, ISSUE_LIST_QUERY, { q: list }, location, login),
    ask(exec, MENTIONED_QUERY, { q: mentioned }, location, login),
  ])
  if ('failure' in listed) return { kind: 'error', failure: listed.failure }
  if ('failure' in mentionedAsked) return { kind: 'error', failure: mentionedAsked.failure }
  const normalized = normalizeIssues(listed.answer, mentionedNumbersOf(mentionedAsked.answer), `${location.owner}/${location.repo}`)
  return { kind: 'ok', ...normalized, rateLimit: toRateLimit(asObj(asObj(listed.answer)?.data)?.rateLimit) }
}

/** The transient failure an issue list is retrying, if any. */
export function issuesProblemOf(list: IssueList | null): Problem | null {
  if (list === null || list.kind === 'loading') return null
  return list.problem ?? null
}

/**
 * The issue list after a read. A transient failure keeps the last list and
 * marks it with a problem (15, 30, then 60 s backoff); with no list to keep it
 * becomes an error that still carries the problem.
 */
export function issuesAfter(prev: IssueList | null, fetched: FetchedIssues, at: string, location: RepoLocation, account: AccountChoice): IssueList {
  if (fetched.kind === 'ok') {
    return { kind: 'list', at, location, account, items: fetched.items, total: fetched.total, isTruncated: fetched.isTruncated, problem: null }
  }
  const failure = fetched.failure
  if (!isTransient(failure.kind)) return { kind: 'error', at, message: failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message }
  const earlier = issuesProblemOf(prev)
  const problem: Problem = { reason: reasonOf(failure), since: earlier?.since ?? at, triedAt: at, retryInMs: backoffMs(earlier?.retryInMs ?? null) }
  if (prev !== null && prev.kind === 'list') return { ...prev, problem }
  return { kind: 'error', at, message: failure.message, problem }
}

/** GraphQL's SCREAMING_CASE enum as the model spells it: `NOT_PLANNED` becomes `not-planned`. */
function lowered(value: unknown): string | null {
  const text = asStr(value)
  return text === null ? null : text.toLowerCase().replaceAll('_', '-')
}

const LINKED_STATES: Record<string, LinkedPr['state']> = { open: 'open', closed: 'closed', merged: 'merged' }

function toComment(node: Record<string, unknown>): IssueComment {
  const author = asObj(node.author)
  const login = cleanStr(author?.login) ?? 'ghost'
  return {
    author: login,
    isBot: author?.__typename === 'Bot' || login.endsWith('[bot]'),
    createdAt: asStr(node.createdAt) ?? '',
    editedAt: asStr(node.lastEditedAt),
    body: cleanStr(node.body) ?? '',
    url: asStr(node.url) ?? '',
  }
}

/**
 * Turns ISSUE_DETAIL_QUERY's answer into an Issue; null when the repository has
 * no such issue or the node is malformed. A deleted comment author is `ghost`
 * (GitHub's own name for it). Pure; never throws.
 */
export function normalizeIssue(raw: unknown): Issue | null {
  const node = asObj(asObj(asObj(asObj(raw)?.data)?.repository)?.issue)
  if (node === null) return null
  const id = asStr(node.id)
  const number = asNum(node.number)
  if (id === null || number === null) return null
  const linkedPrs: LinkedPr[] = []
  for (const pr of nodesOf(node.closedByPullRequestsReferences)) {
    const linked = asNum(pr.number)
    if (linked === null) continue
    const repo = repoOf(pr)
    linkedPrs.push({
      number: linked,
      title: cleanStr(pr.title) ?? '',
      state: LINKED_STATES[lowered(pr.state) ?? ''] ?? 'open',
      ...(repo === null ? {} : { repo }),
    })
  }
  const comments = asObj(node.comments)
  const loaded = nodesOf(comments).map(toComment)
  return {
    id,
    number,
    title: cleanStr(node.title) ?? '',
    url: asStr(node.url) ?? '',
    state: lowered(node.state) === 'closed' ? 'closed' : 'open',
    stateReason: lowered(node.stateReason),
    author: cleanStr(asObj(node.author)?.login),
    createdAt: asStr(node.createdAt) ?? '',
    labels: labelsOf(node.labels),
    assignees: loginsOf(node.assignees),
    milestone: cleanStr(asObj(node.milestone)?.title),
    body: cleanStr(node.body) ?? '',
    linkedPrs,
    comments: loaded,
    commentCount: Math.max(asNum(comments?.totalCount) ?? 0, loaded.length),
  }
}

/** Reads one issue by number (1 point). A number that is no issue (a pull request, or absent) is an error. */
export async function fetchIssue(exec: Exec, location: RepoLocation, login: string, number: number): Promise<FetchedIssue> {
  if (location.owner === null || location.repo === null) return { kind: 'error', number, failure: failed('no GitHub repository to read') }
  const asked = await ask(exec, ISSUE_DETAIL_QUERY, { owner: location.owner, name: location.repo, n: number }, location, login)
  if ('failure' in asked) return { kind: 'error', number, failure: asked.failure }
  const issue = normalizeIssue(asked.answer)
  if (issue === null) {
    return { kind: 'error', number, failure: { ...failed(`#${number} is not an issue in ${location.owner}/${location.repo}`), kind: 'not-found' } }
  }
  return { kind: 'ok', issue, rateLimit: toRateLimit(asObj(asObj(asked.answer)?.data)?.rateLimit) }
}

/** The transient failure an issue snapshot is retrying, if any. */
export function issueProblemOf(snapshot: IssueSnapshot | null): Problem | null {
  if (snapshot === null || snapshot.kind === 'loading') return null
  return snapshot.kind === 'issue' ? (snapshot.stale ?? null) : (snapshot.problem ?? null)
}

/**
 * The issue snapshot after a read. A transient failure keeps the last good
 * issue of the same number and marks it stale; with none to keep it becomes an
 * error that still carries the problem.
 */
export function issueAfter(prev: IssueSnapshot | null, fetched: FetchedIssue, at: string, location: RepoLocation, account: AccountChoice): IssueSnapshot {
  if (fetched.kind === 'ok') return { kind: 'issue', at, location, account, issue: fetched.issue, stale: null }
  const failure = fetched.failure
  const number = fetched.number
  if (!isTransient(failure.kind)) return { kind: 'error', at, number, message: failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message }
  const kept = prev !== null && prev.kind === 'issue' && prev.issue.number === number ? prev : null
  const earlier = kept === null ? null : issueProblemOf(kept)
  const problem: Problem = { reason: reasonOf(failure), since: earlier?.since ?? at, triedAt: at, retryInMs: backoffMs(earlier?.retryInMs ?? null) }
  if (kept !== null) return { ...kept, stale: problem }
  return { kind: 'error', at, number, message: failure.message, problem }
}
