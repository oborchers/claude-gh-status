// The GraphQL read of the current branch's pull request, and the pure
// normalizer that turns GitHub's answer into the PullRequest contract.
//
// Two small queries instead of one big one, 2 points of rate limit in total:
// 1. PR_QUERY lists the branch's pull requests with a few scalars, so the
//    selection rule can pick one without paying for five full copies.
// 2. PR_DETAIL_QUERY reads only the chosen pull request by node id. The id is
//    what makes `isRequired(pullRequestId: $id)` possible: that field needs the
//    pull request as an argument, which a list query cannot supply per node.

import { runGh } from './gh'
import type { Exec, GhResult } from './gh'
import { activityAt } from './status'
import type {
  Check,
  CheckState,
  CommentRef,
  MergeMethod,
  MergeQueueEntry,
  MergeQueueState,
  MergeStateStatus,
  Mergeable,
  PullRequest,
  RateLimit,
  RepoLocation,
  Review,
  ReviewDecision,
  ReviewRequest,
  ReviewState,
  ReviewThread,
} from './model'

/** Lists the pull requests of a branch: variables $owner, $name, $branch. */
export const PR_QUERY = `query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    pullRequests(headRefName: $branch, first: 5, orderBy: {field: UPDATED_AT, direction: DESC}, states: [OPEN, MERGED, CLOSED]) {
      nodes { id number state updatedAt headRepositoryOwner { login } }
    }
  }
  rateLimit { cost remaining resetAt }
}`

/** Resolves one pull request by number: variables $owner, $name, $number. Carries the repository scalars normalize needs. */
export const PR_BY_NUMBER_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    pullRequest(number: $number) { id number state updatedAt headRepositoryOwner { login } }
  }
  rateLimit { cost remaining resetAt }
}`

/** The CheckRun and StatusContext selection, shared by the head commit and the merge group commit. */
const CONTEXT_FIELDS = `__typename
        ... on CheckRun { databaseId name status conclusion startedAt completedAt detailsUrl isRequired(pullRequestId: $id) checkSuite { workflowRun { databaseId workflow { name } } } }
        ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestId: $id) }`

/** Reads one pull request in full by node id: variable $id. */
export const PR_DETAIL_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      id number state title url isDraft mergedBy { login } mergedAt closedAt headRefName headRefOid
      baseRefName mergeable mergeStateStatus reviewDecision
      isInMergeQueue isMergeQueueEnabled
      mergeQueueEntry { position state estimatedTimeToMerge headCommit { oid statusCheckRollup { state contexts(first: 100) { nodes {
        ${CONTEXT_FIELDS}
      } } } } }
      autoMergeRequest { mergeMethod enabledAt }
      viewerCanMergeAsAdmin
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } } ... on Bot { login } } } }
      latestReviews(first: 20) { nodes { author { login } state submittedAt } }
      reviewThreads(first: 100) { nodes { isResolved isOutdated path line comments(last: 5) { nodes { author { login } createdAt lastEditedAt url } } } }
      comments(last: 100) { totalCount nodes { author { login } createdAt lastEditedAt url } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) { nodes {
        ${CONTEXT_FIELDS}
      } } } } } }
    }
  }
  rateLimit { cost remaining resetAt }
}`

/** What normalize reads: the answers of PR_QUERY and PR_DETAIL_QUERY. */
export type RawPullRequest = {
  list: unknown
  detail: unknown
}

export type NormalizedPullRequest = {
  pr: PullRequest | null
  rateLimit: RateLimit | null
}

export type FetchedPullRequest =
  | { kind: 'ok'; pr: PullRequest | null; rateLimit: RateLimit | null }
  | { kind: 'error'; failure: Extract<GhResult, { isOk: false }> }

/** The candidate a branch lookup selected. */
export type Candidate = {
  id: string
  number: number
  state: string
  ownerLogin: string | null
}

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

function asBool(value: unknown): boolean {
  return value === true
}

/** The `nodes` of a GraphQL connection, as objects only. */
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

function lower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/_/g, '-') : ''
}

const MERGEABLE: Record<string, Mergeable> = {
  MERGEABLE: 'mergeable',
  CONFLICTING: 'conflicting',
}

const MERGE_STATES: readonly MergeStateStatus[] = ['clean', 'blocked', 'behind', 'dirty', 'draft', 'has-hooks', 'unknown', 'unstable']

const REVIEW_DECISIONS: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
}

const REVIEW_STATES: readonly ReviewState[] = ['approved', 'changes-requested', 'commented', 'dismissed', 'pending']

const QUEUE_STATES: readonly MergeQueueState[] = ['queued', 'awaiting-checks', 'mergeable', 'unmergeable', 'locked']

const MERGE_METHODS: Record<string, MergeMethod> = {
  MERGE: 'merge',
  SQUASH: 'squash',
  REBASE: 'rebase',
}

const PR_STATES: Record<string, PullRequest['state']> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
}

const CONCLUSIONS: Record<string, CheckState> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  ACTION_REQUIRED: 'action-required',
  TIMED_OUT: 'timed-out',
  STALE: 'stale',
  STARTUP_FAILURE: 'failure',
}

const STATUS_CONTEXT_STATES: Record<string, CheckState> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'queued',
  EXPECTED: 'queued',
}

/**
 * Maps a check run's status and conclusion to a CheckState. Case-insensitive,
 * so GraphQL (COMPLETED) and `gh run view` (completed) share it.
 */
export function checkStateFrom(status: unknown, conclusion: unknown): CheckState {
  const statusKey = typeof status === 'string' ? status.toUpperCase() : ''
  if (statusKey === 'IN_PROGRESS') return 'running'
  if (statusKey === 'COMPLETED') {
    const conclusionKey = typeof conclusion === 'string' ? conclusion.toUpperCase() : ''
    return CONCLUSIONS[conclusionKey] ?? 'neutral'
  }
  return 'queued'
}

/** Maps a commit status context state to a CheckState. */
export function statusContextState(state: unknown): CheckState {
  const key = typeof state === 'string' ? state.toUpperCase() : ''
  return STATUS_CONTEXT_STATES[key] ?? 'queued'
}

function toCheck(node: Obj): Check | null {
  if (node.__typename === 'CheckRun') {
    const name = asStr(node.name)
    if (name === null) return null
    const run = asObj(asObj(asObj(node.checkSuite)?.workflowRun))
    return {
      name,
      workflow: asStr(asObj(run?.workflow)?.name),
      state: checkStateFrom(node.status, node.conclusion),
      isRequired: asBool(node.isRequired),
      startedAt: asStr(node.startedAt),
      completedAt: asStr(node.completedAt),
      url: asStr(node.detailsUrl),
      runId: asNum(run?.databaseId),
      jobId: asNum(node.databaseId),
    }
  }
  if (node.__typename === 'StatusContext') {
    const name = asStr(node.context)
    if (name === null) return null
    const state = statusContextState(node.state)
    return {
      name,
      workflow: null,
      state,
      isRequired: asBool(node.isRequired),
      startedAt: asStr(node.createdAt),
      completedAt: state === 'queued' ? null : asStr(node.createdAt),
      url: asStr(node.targetUrl),
      runId: null,
      jobId: null,
    }
  }
  return null
}

/** The checks of a statusCheckRollup, malformed contexts dropped, latest run per check kept. */
function checksOf(rollup: unknown): Check[] {
  const checks: Check[] = []
  for (const context of nodesOf(asObj(rollup)?.contexts)) {
    const check = toCheck(context)
    if (check !== null) checks.push(check)
  }
  return latestPerCheck(checks)
}

/**
 * A workflow that runs twice on one commit (two pull request events) reports
 * every check twice. GitHub judges mergeability by the latest check run per
 * workflow and name, so only that one is kept, at the position of the first.
 * Check run ids grow, so the larger job id is the later run. Pure, exported for tests.
 */
export function latestPerCheck(checks: Check[]): Check[] {
  const latest = new Map<string, Check>()
  const order: string[] = []
  for (const check of checks) {
    if (check.jobId === null) {
      order.push(`status:${order.length}`)
      latest.set(order[order.length - 1] as string, check)
      continue
    }
    const key = `${check.workflow ?? ''}\u0000${check.name}`
    const known = latest.get(key)
    if (known === undefined) {
      order.push(key)
      latest.set(key, check)
    } else if ((known.jobId ?? 0) < check.jobId) {
      latest.set(key, check)
    }
  }
  return order.map((key) => latest.get(key) as Check)
}

/**
 * Bots often post a comment and rewrite it moments later (automatic
 * post-processing, 1 to 2 s after creation). Such an edit is part of posting,
 * not an update, so an edit closer to creation than this is treated as no edit.
 * Normalizing here keeps status, toasts and the pane unchanged.
 */
export const EDIT_GRACE_MS = 60_000

function toCommentRef(node: Obj | undefined): CommentRef | null {
  if (node === undefined) return null
  const createdAt = asStr(node.createdAt)
  const url = asStr(node.url)
  if (createdAt === null || url === null) return null
  const lastEditedAt = asStr(node.lastEditedAt)
  const isEdited = lastEditedAt !== null && Date.parse(lastEditedAt) - Date.parse(createdAt) >= EDIT_GRACE_MS
  return { author: asStr(asObj(node.author)?.login) ?? 'ghost', createdAt, editedAt: isEdited ? lastEditedAt : null, url }
}

/**
 * The most recently active of a connection's comments (max of createdAt and
 * lastEditedAt), so a review bot that edits an older comment in place
 * surfaces. Ties go to the later node.
 */
function latestActive(nodes: Obj[]): CommentRef | null {
  let best: CommentRef | null = null
  for (const node of nodes) {
    const ref = toCommentRef(node)
    if (ref === null) continue
    if (best === null || Date.parse(activityAt(ref)) >= Date.parse(activityAt(best))) best = ref
  }
  return best
}

function toReviewRequest(node: Obj): ReviewRequest | null {
  const reviewer = asObj(node.requestedReviewer)
  if (reviewer === null) return null
  if (reviewer.__typename === 'Team') {
    const slug = asStr(reviewer.slug)
    if (slug === null) return null
    const org = asStr(asObj(reviewer.organization)?.login)
    return { reviewer: org === null ? slug : `${org}/${slug}`, isTeam: true }
  }
  const login = asStr(reviewer.login)
  return login === null ? null : { reviewer: login, isTeam: false }
}

function toReview(node: Obj): Review {
  const state = lower(node.state)
  return {
    author: asStr(asObj(node.author)?.login) ?? 'ghost',
    state: REVIEW_STATES.find(known => known === state) ?? 'commented',
    submittedAt: asStr(node.submittedAt),
  }
}

function toThread(node: Obj): ReviewThread {
  return {
    isResolved: asBool(node.isResolved),
    isOutdated: asBool(node.isOutdated),
    path: asStr(node.path),
    line: asNum(node.line),
    last: latestActive(nodesOf(node.comments)),
  }
}

function toQueueEntry(value: unknown): MergeQueueEntry | null {
  const entry = asObj(value)
  const position = asNum(entry?.position)
  if (entry === null || position === null) return null
  const state = lower(entry.state)
  return {
    position,
    state: QUEUE_STATES.find(known => known === state) ?? 'queued',
    estimatedTimeToMerge: asNum(entry.estimatedTimeToMerge),
    checks: checksOf(asObj(entry.headCommit)?.statusCheckRollup),
  }
}

function toRateLimit(value: unknown): RateLimit | null {
  const limit = asObj(value)
  const remaining = asNum(limit?.remaining)
  const resetAt = asStr(limit?.resetAt)
  return remaining === null || resetAt === null ? null : { remaining, resetAt }
}

/** The pull requests a branch lookup returned, malformed entries dropped. */
export function candidatesOf(list: unknown): Candidate[] {
  const repository = asObj(asObj(asObj(list)?.data)?.repository)
  const result: Candidate[] = []
  for (const node of nodesOf(asObj(repository?.pullRequests))) {
    const id = asStr(node.id)
    const number = asNum(node.number)
    if (id === null || number === null) continue
    result.push({ id, number, state: asStr(node.state) ?? '', ownerLogin: asStr(asObj(node.headRepositoryOwner)?.login) })
  }
  return result
}

/**
 * The selection rule: the open pull request whose head repository belongs to
 * the location's owner; else any open one; else the most recently updated
 * merged or closed one (so the band can say "merged"). Lists arrive newest
 * first. Pure, exported for tests.
 */
export function selectCandidate(candidates: readonly Candidate[], location: RepoLocation): Candidate | null {
  const owner = location.owner?.toLowerCase() ?? null
  const open = candidates.filter(candidate => candidate.state === 'OPEN')
  const own = owner === null ? undefined : open.find(candidate => candidate.ownerLogin?.toLowerCase() === owner)
  return own ?? open[0] ?? candidates.find(candidate => candidate.state === 'MERGED' || candidate.state === 'CLOSED') ?? null
}

function allowedMethods(repository: Obj | null): MergeMethod[] {
  const methods: MergeMethod[] = []
  if (repository?.mergeCommitAllowed === true) methods.push('merge')
  if (repository?.squashMergeAllowed === true) methods.push('squash')
  if (repository?.rebaseMergeAllowed === true) methods.push('rebase')
  return methods
}

/**
 * Turns the two GraphQL answers into the contract. Pure; never throws.
 * Anything unknown or missing falls back to a safe default.
 */
export function normalize(raw: unknown, location: RepoLocation): NormalizedPullRequest {
  const input = asObj(raw)
  const list = input?.list
  const detail = input?.detail
  const rateLimit = toRateLimit(asObj(asObj(detail)?.data)?.rateLimit) ?? toRateLimit(asObj(asObj(list)?.data)?.rateLimit)
  const chosen = selectCandidate(candidatesOf(list), location)
  const node = asObj(asObj(asObj(detail)?.data)?.node)
  if (chosen === null || node === null) return { pr: null, rateLimit }
  const id = asStr(node.id)
  const number = asNum(node.number)
  if (id === null || number === null) return { pr: null, rateLimit }

  const repository = asObj(asObj(asObj(list)?.data)?.repository)
  const commit = asObj(nodesOf(node.commits)[0]?.commit)
  const rollup = asObj(commit?.statusCheckRollup)
  const checks = checksOf(rollup)
  const reviewRequests: ReviewRequest[] = []
  for (const request of nodesOf(node.reviewRequests)) {
    const parsed = toReviewRequest(request)
    if (parsed !== null) reviewRequests.push(parsed)
  }
  const autoMerge = asObj(node.autoMergeRequest)
  const autoMergeMethod = MERGE_METHODS[asStr(autoMerge?.mergeMethod) ?? '']
  const mergeState = lower(node.mergeStateStatus)
  const comments = asObj(node.comments)

  const pr: PullRequest = {
    id,
    number,
    state: PR_STATES[asStr(node.state) ?? ''] ?? PR_STATES[chosen.state] ?? 'open',
    title: asStr(node.title) ?? '',
    url: asStr(node.url) ?? '',
    isPrivate: repository?.isPrivate === true,
    isDraft: asBool(node.isDraft),
    mergedBy: asStr(asObj(node.mergedBy)?.login),
    mergedAt: asStr(node.mergedAt),
    closedAt: asStr(node.closedAt),
    headRefName: asStr(node.headRefName) ?? location.branch ?? '',
    headOid: asStr(node.headRefOid) ?? asStr(commit?.oid) ?? '',
    baseRefName: asStr(node.baseRefName) ?? '',
    mergeable: MERGEABLE[asStr(node.mergeable) ?? ''] ?? 'unknown',
    mergeStateStatus: MERGE_STATES.find(known => known === mergeState) ?? 'unknown',
    reviewDecision: REVIEW_DECISIONS[asStr(node.reviewDecision) ?? ''] ?? null,
    isInMergeQueue: asBool(node.isInMergeQueue),
    isMergeQueueEnabled: asBool(node.isMergeQueueEnabled),
    mergeQueueEntry: toQueueEntry(node.mergeQueueEntry),
    autoMerge: autoMerge !== null && autoMergeMethod !== undefined ? { method: autoMergeMethod, enabledAt: asStr(autoMerge.enabledAt) ?? '' } : null,
    viewerCanMergeAsAdmin: asBool(node.viewerCanMergeAsAdmin),
    allowedMethods: allowedMethods(repository),
    checks,
    reviews: nodesOf(node.latestReviews).map(toReview),
    reviewRequests,
    threads: nodesOf(node.reviewThreads).map(toThread),
    commentCount: asNum(comments?.totalCount) ?? 0,
    lastComment: latestActive(nodesOf(comments)),
  }
  return { pr, rateLimit }
}

function failed(message: string): Extract<GhResult, { isOk: false }> {
  return { isOk: false, kind: 'failed', exitCode: null, message, stdout: '' }
}

/** An answer that is not JSON (an HTML error page, a cut-off body) is GitHub's fault, so it is retried. */
function unreadable(): Extract<GhResult, { isOk: false }> {
  return { isOk: false, kind: 'server', exitCode: null, message: 'GitHub sent an unreadable answer', stdout: '' }
}

/** Parses gh's stdout as JSON; null when it is not valid JSON. */
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

/**
 * Looks up the pull request of the location's branch: one list query, then one
 * detail query for the selected pull request (2 points of rate limit).
 */
export async function fetchPullRequest(exec: Exec, location: RepoLocation, login: string): Promise<FetchedPullRequest> {
  const { owner, repo, branch } = location
  if (owner === null || repo === null || branch === null) {
    return { kind: 'error', failure: failed('no GitHub repository or branch to look up') }
  }
  // -f, not -F: -F would turn a branch named "123", "true" or "@file" into a number, bool or file read.
  const listRan = await runGh(exec, ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${repo}`, '-f', `branch=${branch}`], { login, cwd: location.cwd })
  if (!listRan.isOk) return { kind: 'error', failure: listRan }
  const list = parseJson(listRan.stdout)
  if (list === null) return { kind: 'error', failure: unreadable() }
  const listError = graphqlMessage(list)
  if (listError !== null) return { kind: 'error', failure: failed(listError) }

  return await readDetail(exec, location, login, list)
}

/** The second step of both lookups: pick the candidate of the list answer, read it in full, normalize. */
async function readDetail(exec: Exec, location: RepoLocation, login: string, list: unknown): Promise<FetchedPullRequest> {
  const chosen = selectCandidate(candidatesOf(list), location)
  if (chosen === null) return { kind: 'ok', ...normalize({ list, detail: null }, location) }

  const detailRan = await runGh(exec, ['api', 'graphql', '-f', `query=${PR_DETAIL_QUERY}`, '-f', `id=${chosen.id}`], { login, cwd: location.cwd })
  if (!detailRan.isOk) return { kind: 'error', failure: detailRan }
  const detail = parseJson(detailRan.stdout)
  if (detail === null) return { kind: 'error', failure: unreadable() }
  const detailError = graphqlMessage(detail)
  if (detailError !== null) return { kind: 'error', failure: failed(detailError) }
  return { kind: 'ok', ...normalize({ list, detail }, location) }
}

/** Reshapes the by-number answer like a branch list with one candidate, so normalize reads both alike. */
function asBranchList(answer: unknown): unknown {
  const data = asObj(asObj(answer)?.data)
  const repository = asObj(data?.repository)
  if (data === null || repository === null) return answer
  const { pullRequest, ...scalars } = repository
  const nodes = pullRequest === null || pullRequest === undefined ? [] : [pullRequest]
  return { ...asObj(answer), data: { ...data, repository: { ...scalars, pullRequests: { nodes } } } }
}

/**
 * Looks up one pull request of the location's repository by number, for the
 * pull request picked from the list: an id query, then the same detail query
 * and normalizer as the branch lookup (2 points of rate limit, the same as
 * fetchPullRequest; the detail query needs the node id, so they cannot merge).
 * A number that is no pull request of the repository gives `pr: null`.
 */
export async function fetchPullRequestByNumber(exec: Exec, location: RepoLocation, login: string, number: number): Promise<FetchedPullRequest> {
  const { owner, repo } = location
  if (owner === null || repo === null) return { kind: 'error', failure: failed('no GitHub repository to look up') }
  if (!Number.isSafeInteger(number) || number < 1) return { kind: 'error', failure: failed(`${number} is not a pull request number`) }
  // -F types the number as an Int; owner and name stay strings (-f).
  const ran = await runGh(exec, ['api', 'graphql', '-f', `query=${PR_BY_NUMBER_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${repo}`, '-F', `number=${number}`], { login, cwd: location.cwd })
  if (!ran.isOk) return { kind: 'error', failure: ran }
  const answer = parseJson(ran.stdout)
  if (answer === null) return { kind: 'error', failure: unreadable() }
  const error = graphqlMessage(answer)
  if (error !== null) return { kind: 'error', failure: failed(error) }
  return await readDetail(exec, location, login, asBranchList(answer))
}
