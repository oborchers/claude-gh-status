// Write actions on the pull request: what may be offered, the dialog's pending
// state, the exact gh arguments, and the one place that executes them.
//
// Nothing here runs by itself. register.tsx calls `execute` only from the
// dialog's confirm press, and `execute` re-checks the head commit first. Every
// write binds the commit the person saw (`--match-head-commit`, `expectedHeadOid`),
// so GitHub itself refuses if the branch moved in between. These flags are
// never built: `--delete-branch`, `--auto`; `--admin` only for the admin action.

import { runGh, tokenFor } from './gh'
import type { Exec, GhResult } from './gh'
import type { ActionOutcome, Blocker, CheckState, JobDetail, MergeMethod, PendingAction, PullRequest, RepoLocation, Snapshot } from './model'
import { FAILED_STATES, deriveBlockers, deriveStatus } from './status'

export type PrSnapshot = Extract<Snapshot, { kind: 'pr' }>
export type ActionKind = PendingAction['kind']

export const HEAD_CHANGED = 'new commits since you asked to confirm, review again'
export const RULES_CHANGED = 'rules changed, review again'
export const RECHECK_FAILED = 'could not re-check the pull request, nothing was done'
export const CANCELLED = 'the dialog was closed, nothing was done'
export const CHANGES_NEED_TEXT = 'write what should change first'

/** Presses this soon after the dialog (or its admin step) opened are stray keystrokes. */
export const MIN_DIALOG_MS = 600

const WRITE_TIMEOUT_MS = 30_000

const METHOD_FLAG: Record<MergeMethod, string> = { merge: '--merge', squash: '--squash', rebase: '--rebase' }
const METHOD_ENUM: Record<MergeMethod, string> = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' }

// Input field names verified against GitHub's schema by introspection:
// EnqueuePullRequestInput { pullRequestId, expectedHeadOid, jump },
// DequeuePullRequestInput { id }, EnablePullRequestAutoMergeInput { pullRequestId,
// mergeMethod, expectedHeadOid, ... }, DisablePullRequestAutoMergeInput { pullRequestId },
// AddPullRequestReviewInput { pullRequestId!, commitOID, body, event, comments, threads }
// with event one of COMMENT, APPROVE, REQUEST_CHANGES, DISMISS,
// MarkPullRequestReadyForReviewInput { pullRequestId }.
export const ENQUEUE_MUTATION =
  'mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid}) { mergeQueueEntry { position } } }'
export const DEQUEUE_MUTATION = 'mutation($id: ID!) { dequeuePullRequest(input: {id: $id}) { mergeQueueEntry { position } } }'
export const AUTO_MERGE_ON_MUTATION =
  'mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) { enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid}) { pullRequest { number } } }'
export const AUTO_MERGE_OFF_MUTATION =
  'mutation($pullRequestId: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) { pullRequest { number } } }'

export const REVIEW_MUTATION =
  'mutation($pullRequestId: ID!, $commitOID: GitObjectID!, $event: PullRequestReviewEvent!, $body: String!) { addPullRequestReview(input: {pullRequestId: $pullRequestId, commitOID: $commitOID, event: $event, body: $body}) { pullRequestReview { state } } }'
export const READY_MUTATION =
  'mutation($pullRequestId: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $pullRequestId}) { pullRequest { number } } }'

const OID_PATTERN = /^[0-9a-f]{40}$/
const SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** True for a full 40-digit lowercase hex git object id. */
export const isValidOid = (oid: string): boolean => OID_PATTERN.test(oid)

function requireOid(oid: string): string {
  if (!isValidOid(oid)) throw new Error('no valid head commit to bind the write to')
  return oid
}

/**
 * Start of the state-transition toast (src/status.ts) that reports what `kind`
 * just did, or null when no transition toast exists for it. The mod's own
 * success toast already says it, so register.tsx drops the matching one.
 */
export function transitionToastPrefix(kind: ActionKind, prNumber: number): string | null {
  const label = `PR #${prNumber}: `
  switch (kind) {
    case 'merge':
    case 'admin-merge':
      return `${label}merged`
    case 'enqueue':
      return `${label}added to merge queue`
    case 'dequeue':
      return `${label}removed from merge queue`
    default:
      return null
  }
}

/** True while a press is too close to the dialog's opening to be deliberate. */
export const isTooEarly = (pending: PendingAction, nowMs: number): boolean => nowMs - pending.openedAt < MIN_DIALOG_MS

/** `owner/repo` of a location, or null when it has none. */
export function repoSlug(location: RepoLocation): string | null {
  return location.owner === null || location.repo === null ? null : `${location.owner}/${location.repo}`
}

/** The merge method to start from: squash if the repository allows it, else the first allowed one. */
export function defaultMethod(allowed: readonly MergeMethod[]): MergeMethod | null {
  if (allowed.includes('squash')) return 'squash'
  return allowed[0] ?? null
}

/** `gh pr merge` arguments, bound to the head commit. `--admin` only when `isAdmin`. Throws without a valid commit or repository. */
export function mergeArgs(target: { prNumber: number; repo: string; headOid: string }, method: MergeMethod, isAdmin: boolean): string[] {
  if (!SLUG_PATTERN.test(target.repo)) throw new Error('no GitHub repository to merge in')
  const args = ['pr', 'merge', String(target.prNumber), METHOD_FLAG[method], '--match-head-commit', requireOid(target.headOid), '-R', target.repo]
  if (isAdmin) args.push('--admin')
  return args
}

function graphqlArgs(query: string, variables: Array<[string, string]>): string[] {
  // -f, not -F: every value is passed as the string it is.
  return ['api', 'graphql', '-f', `query=${query}`, ...variables.flatMap(([name, value]) => ['-f', `${name}=${value}`])]
}

export const enqueueArgs = (prId: string, headOid: string): string[] =>
  graphqlArgs(ENQUEUE_MUTATION, [['pullRequestId', prId], ['expectedHeadOid', requireOid(headOid)]])

export const dequeueArgs = (prId: string): string[] => graphqlArgs(DEQUEUE_MUTATION, [['id', prId]])

export const autoMergeOnArgs = (prId: string, method: MergeMethod, headOid: string): string[] =>
  graphqlArgs(AUTO_MERGE_ON_MUTATION, [['pullRequestId', prId], ['mergeMethod', METHOD_ENUM[method]], ['expectedHeadOid', requireOid(headOid)]])

/** `gh run rerun` arguments for one run: only its failed jobs. Throws without a valid repository or run id. */
export function rerunArgs(runId: number, location: RepoLocation): string[] {
  const slug = repoSlug(location)
  if (slug === null || !SLUG_PATTERN.test(slug)) throw new Error('no GitHub repository to re-run in')
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('no valid run to re-run')
  return ['run', 'rerun', String(runId), '--failed', '-R', slug]
}

const REVIEW_EVENT = { approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' } as const

/** The text a review posts: an approval's blank comment is empty, anything else goes as typed. */
export const reviewText = (kind: 'approve' | 'request-changes', body: string): string => (kind === 'approve' && body.trim() === '' ? '' : body)

/** True for a request for changes without any text to say what should change. */
export const isReviewTextMissing = (pending: PendingAction): boolean => pending.kind === 'request-changes' && pending.body.trim() === ''

/** `addPullRequestReview` arguments, bound to the head commit the person saw (`commitOID`). */
export const reviewArgs = (prId: string, kind: 'approve' | 'request-changes', headOid: string, body: string): string[] =>
  graphqlArgs(REVIEW_MUTATION, [['pullRequestId', prId], ['commitOID', requireOid(headOid)], ['event', REVIEW_EVENT[kind]], ['body', reviewText(kind, body)]])

export const readyArgs = (prId: string): string[] => graphqlArgs(READY_MUTATION, [['pullRequestId', prId]])

export const autoMergeOffArgs = (prId: string): string[] => graphqlArgs(AUTO_MERGE_OFF_MUTATION, [['pullRequestId', prId]])

const sameLogin = (a: string | null, b: string): boolean => a !== null && b !== '' && a.toLowerCase() === b.toLowerCase()

/**
 * The write actions the person may start for this pull request, in display order.
 * `viewerLogin` is the account that would act: reviews are for other people's
 * open, non-draft pull requests, ready-for-review for the viewer's own drafts.
 */
export function availableActions(pr: PullRequest, viewerLogin = ''): ActionKind[] {
  if (pr.state !== 'open') return []
  // Every write binds the head commit; without a valid one nothing is offered.
  if (!isValidOid(pr.headOid)) return []
  const actions: ActionKind[] = []
  const isMergeable = deriveStatus(pr, '', null).verdict === 'mergeable'
  const hasMethod = pr.allowedMethods.length > 0
  // With a merge queue, `gh pr merge` would silently enqueue or enable auto-merge: no plain merge then.
  if (isMergeable && hasMethod && !pr.isDraft && !pr.isInMergeQueue && !pr.isMergeQueueEnabled) actions.push('merge')
  if (pr.isMergeQueueEnabled && !pr.isInMergeQueue && !pr.isDraft) actions.push('enqueue')
  if (pr.isInMergeQueue) actions.push('dequeue')
  if (!isMergeable && hasMethod && !pr.isDraft && !pr.isInMergeQueue && pr.autoMerge === null) actions.push('auto-merge-on')
  if (pr.autoMerge !== null && !pr.isInMergeQueue) actions.push('auto-merge-off')
  const needsBypass = !isMergeable || pr.isMergeQueueEnabled
  if (pr.viewerCanMergeAsAdmin && hasMethod && needsBypass && !pr.isDraft && !pr.isInMergeQueue) actions.push('admin-merge')
  if (!pr.isDraft && pr.author !== null && viewerLogin !== '' && !sameLogin(pr.author, viewerLogin)) actions.push('approve', 'request-changes')
  if (pr.isDraft && sameLogin(pr.author, viewerLogin)) actions.push('ready-for-review')
  return actions
}

/** States of a check whose job `gh run rerun --failed` re-runs. action-required is left out: it waits for an approval, a re-run does not help. */
const RERUNNABLE_STATES: readonly CheckState[] = ['failure', 'timed-out', 'cancelled']

/**
 * Distinct Actions run ids worth re-running: a check of the run failed, timed out
 * or was cancelled, and no check of that same run is still queued or running
 * (GitHub refuses to re-run a run in progress). Checks without a run id (other
 * providers) are ignored. Only the head commit's checks count, never the merge
 * queue's own (pr.mergeQueueEntry.checks), which GitHub starts and owns.
 */
export function rerunnableRunIds(pr: PullRequest): number[] {
  const inProgress = new Set<number>()
  for (const check of pr.checks) {
    if (check.runId !== null && (check.state === 'queued' || check.state === 'running')) inProgress.add(check.runId)
  }
  const ids: number[] = []
  for (const check of pr.checks) {
    if (check.runId === null || !RERUNNABLE_STATES.includes(check.state)) continue
    if (inProgress.has(check.runId) || ids.includes(check.runId)) continue
    ids.push(check.runId)
  }
  return ids
}

export type RerunSummary = { ok: number[]; failed: Array<{ runId: number; message: string }> }

/** Re-runs the failed jobs of each run once, as `login`, never retrying. Never rejects; every run is tried. */
export async function executeRerun(exec: Exec, login: string, location: RepoLocation, runIds: readonly number[]): Promise<RerunSummary> {
  const summary: RerunSummary = { ok: [], failed: [] }
  for (const runId of runIds) {
    let args: string[]
    try {
      args = rerunArgs(runId, location)
    } catch (error) {
      summary.failed.push({ runId, message: error instanceof Error ? error.message : 'the re-run could not be built' })
      continue
    }
    const ran = await runGh(exec, args, { login, cwd: location.cwd, timeoutMs: WRITE_TIMEOUT_MS })
    if (ran.isOk) summary.ok.push(runId)
    else summary.failed.push({ runId, message: ran.message })
  }
  return summary
}

/** The rules an admin merge would bypass, as the person reads them. */
export function bypassedRules(pr: PullRequest): Blocker[] {
  const rules = deriveBlockers(pr)
  if (pr.isMergeQueueEnabled) rules.push({ kind: 'branch-protection', text: 'merge queue', subjects: [] })
  if (rules.length === 0) rules.push({ kind: 'unknown', text: 'branch protection rules', subjects: [] })
  return rules
}

/**
 * The dialog's pending action for `kind`, or null when this pull request does
 * not offer it. `method` is validated against what the repository allows.
 */
export function buildPending(kind: ActionKind, snapshot: Snapshot, method?: MergeMethod, openedAt = 0, body = ''): PendingAction | null {
  if (snapshot.kind !== 'pr') return null
  const { pr, account, location } = snapshot
  const repo = repoSlug(location)
  if (repo === null || !SLUG_PATTERN.test(repo)) return null
  if (!availableActions(pr, account.login).includes(kind)) return null
  const chosen = method ?? defaultMethod(pr.allowedMethods)
  if (chosen !== null && !pr.allowedMethods.includes(chosen)) return null
  const base = { prNumber: pr.number, repo: repo.toLowerCase(), prId: pr.id, baseRefName: pr.baseRefName, login: account.login, openedAt }
  const headOid = pr.headOid
  switch (kind) {
    case 'merge':
      return chosen === null ? null : { ...base, kind, headOid, method: chosen }
    case 'admin-merge':
      return chosen === null ? null : { ...base, kind, headOid, method: chosen, bypassed: bypassedRules(pr), isSecondStep: false }
    case 'enqueue':
      return { ...base, kind, headOid }
    case 'dequeue':
      return { ...base, kind }
    case 'auto-merge-on':
      return chosen === null ? null : { ...base, kind, headOid, method: chosen }
    case 'auto-merge-off':
      return { ...base, kind }
    case 'approve':
    case 'request-changes':
      return { ...base, kind, headOid, body }
    case 'ready-for-review':
      return { ...base, kind, headOid }
  }
}

/** The pending action with another merge method; unchanged if it has none or the second admin step is up. */
export function withMethod(pending: PendingAction, method: MergeMethod, allowed: readonly MergeMethod[]): PendingAction {
  if (!allowed.includes(method)) return pending
  if (pending.kind === 'merge' || pending.kind === 'auto-merge-on') return { ...pending, method }
  if (pending.kind === 'admin-merge' && !pending.isSecondStep) return { ...pending, method }
  return pending
}

/**
 * What a confirm press does. `isSecondStep` is the admin step the pressed button
 * was drawn for: a press drawn for another step than the live one is stale and
 * ignored, so repeating the first step's key can never reach the final confirm.
 * Only a press of a non-admin dialog or of the admin second step executes.
 */
export function confirmStep(pending: PendingAction, isSecondStep: boolean): 'ignore' | 'advance' | 'execute' {
  if (pending.kind !== 'admin-merge') return 'execute'
  if (isSecondStep !== pending.isSecondStep) return 'ignore'
  return pending.isSecondStep ? 'execute' : 'advance'
}

function graphqlFailure(stdout: string): string | null {
  try {
    const answer: unknown = JSON.parse(stdout)
    const errors = (answer as { errors?: unknown } | null)?.errors
    if (Array.isArray(errors) && errors.length > 0) {
      const message = (errors[0] as { message?: unknown } | null)?.message
      return typeof message === 'string' ? message : 'GraphQL error'
    }
  } catch {
    // an unreadable body after exit 0 is not an error we can name
  }
  return null
}

function successMessage(pending: PendingAction): string {
  switch (pending.kind) {
    case 'merge':
      return `PR #${pending.prNumber} merged`
    case 'admin-merge':
      return `PR #${pending.prNumber} merged as admin`
    case 'enqueue':
      return `PR #${pending.prNumber} added to merge queue`
    case 'dequeue':
      return `PR #${pending.prNumber} removed from merge queue`
    case 'auto-merge-on':
      return `auto-merge enabled for PR #${pending.prNumber}`
    case 'auto-merge-off':
      return `auto-merge disabled for PR #${pending.prNumber}`
    case 'approve':
      return `PR #${pending.prNumber} approved`
    case 'request-changes':
      return `changes requested on PR #${pending.prNumber}`
    case 'ready-for-review':
      return `PR #${pending.prNumber} is ready for review`
  }
}

/** True when a failed run may still have reached GitHub: no clear refusal came back. */
function isResultUnknown(ran: Extract<GhResult, { isOk: false }>): boolean {
  if (ran.kind === 'timeout' || ran.kind === 'network' || ran.kind === 'server') return true
  return ran.kind === 'failed' && ran.exitCode === null
}

/**
 * Runs the confirmed action once, as `pending.login`, never retrying. Before any
 * write it checks the fresh snapshot `latest`: same pull request (node id and
 * number), same repository, same account, same head commit, action still offered,
 * and for the admin second step the same bypassed rules. Every id in the gh
 * arguments comes from `pending`, never from `latest`. Any mismatch is an outcome
 * with isOk false and no gh write. `at` is the ISO time of the call;
 * `isStillPending` is asked right before the write, and a false answer does nothing.
 */
export async function execute(
  exec: Exec,
  pending: PendingAction,
  latest: Snapshot | null,
  at: string,
  isStillPending: () => Promise<boolean> = async () => true,
): Promise<ActionOutcome> {
  const refuse = (message: string, isUnknown = false): ActionOutcome => ({ kind: pending.kind, isOk: false, message, at, ...(isUnknown ? { isUnknown } : {}) })
  if ('headOid' in pending && !isValidOid(pending.headOid)) return refuse('no valid head commit to bind the write to, review again')
  if (isReviewTextMissing(pending)) return refuse(CHANGES_NEED_TEXT)
  if (latest === null || latest.kind !== 'pr') return refuse('no pull request to act on, review again')
  const { pr, location, account } = latest
  const slug = repoSlug(location)
  if (slug === null) return refuse('no GitHub repository to act in')
  if (slug.toLowerCase() !== pending.repo.toLowerCase()) return refuse(`the repository changed to ${slug}, review again`)
  if (pr.id !== pending.prId || pr.number !== pending.prNumber) return refuse(`PR #${pending.prNumber} is no longer the pull request you saw, review again`)
  if (account.login !== pending.login) return refuse(`the account changed to @${account.login}, review again`)
  if ('headOid' in pending && pending.headOid !== pr.headOid) return refuse(HEAD_CHANGED)
  if (pending.kind === 'admin-merge' && !pending.isSecondStep) return refuse('admin merge needs its second confirmation')
  if (!availableActions(pr, account.login).includes(pending.kind)) return refuse('this action is no longer available for the pull request, review again')
  if ('method' in pending && !pr.allowedMethods.includes(pending.method)) return refuse(`${pending.method} is not allowed in this repository`)
  if (pending.kind === 'admin-merge' && JSON.stringify(bypassedRules(pr)) !== JSON.stringify(pending.bypassed)) return refuse(RULES_CHANGED)

  let args: string[]
  try {
    switch (pending.kind) {
      case 'merge':
      case 'admin-merge':
        args = mergeArgs(pending, pending.method, pending.kind === 'admin-merge')
        break
      case 'enqueue':
        args = enqueueArgs(pending.prId, pending.headOid)
        break
      case 'dequeue':
        args = dequeueArgs(pending.prId)
        break
      case 'auto-merge-on':
        args = autoMergeOnArgs(pending.prId, pending.method, pending.headOid)
        break
      case 'auto-merge-off':
        args = autoMergeOffArgs(pending.prId)
        break
      case 'approve':
      case 'request-changes':
        args = reviewArgs(pending.prId, pending.kind, pending.headOid, pending.body)
        break
      case 'ready-for-review':
        args = readyArgs(pending.prId)
        break
    }
  } catch (error) {
    return refuse(error instanceof Error ? error.message : 'the write could not be built')
  }

  // Warm the token first, so the last check below and the write are not separated by a process spawn.
  await tokenFor(exec, pending.login)
  if (!(await isStillPending())) return refuse(CANCELLED)
  const ran = await runGh(exec, args, { login: pending.login, cwd: location.cwd, timeoutMs: WRITE_TIMEOUT_MS })
  if (!ran.isOk) return refuse(ran.message, isResultUnknown(ran))
  const failure = pending.kind === 'merge' || pending.kind === 'admin-merge' ? null : graphqlFailure(ran.stdout)
  if (failure !== null) return refuse(failure)
  return { kind: pending.kind, isOk: true, message: successMessage(pending), at }
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The text `[f]` puts into the prompt: where the failure is and how to read it,
 * never the log itself. Null when no check failed.
 */
export function ciReference(snapshot: PrSnapshot, jobs: JobDetail[]): string | null {
  const { pr, location } = snapshot
  const failed = pr.checks.filter(check => FAILED_STATES.includes(check.state))
  if (failed.length === 0) return null
  const slug = repoSlug(location) ?? ''
  const lines = [`CI failed on ${slug} PR #${pr.number} (${pr.url})`, `Head commit: ${pr.headOid}`, 'Failed checks:']
  for (const check of failed) {
    const job = jobs.find(candidate => (check.jobId !== null && candidate.jobId === check.jobId) || (check.runId !== null && candidate.runId === check.runId && candidate.name === check.name))
    const parts = [`${oneLine(check.name)}${check.isRequired ? ' (required)' : ''}: ${check.state}`]
    if (check.runId !== null) parts.push(`run ${check.runId}`)
    const jobId = check.jobId ?? job?.jobId ?? null
    if (jobId !== null) parts.push(`job ${jobId}`)
    if (job?.failedStep) parts.push(`failed step "${oneLine(job.failedStep)}"`)
    lines.push(`- ${parts.join(', ')}`)
    if (check.runId !== null) lines.push(`  gh run view ${check.runId} --log-failed -R ${slug}`)
    else if (check.url !== null) lines.push(`  details: ${check.url}`)
  }
  lines.push('Please investigate these failures and fix them.')
  return lines.join('\n')
}
