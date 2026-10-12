// Pure derivation of the band's facts from a pull request snapshot: blockers,
// verdict, pipeline counts, review state, toasts on change, and formatting.
// No processes and no clock: callers pass `now` in.

import type {
  Blocker,
  Check,
  CheckState,
  CommentRef,
  MergeQueueEntry,
  MergeQueueState,
  PipelineSummary,
  PullRequest,
  Review,
  Snapshot,
  Status,
  Verdict,
} from './model'

export const FAILED_STATES: readonly CheckState[] = ['failure', 'timed-out', 'action-required', 'cancelled']
const MERGEABLE_STATUSES: readonly string[] = ['clean', 'unstable', 'has-hooks']

/** Counts checks per state; stale checks are ignored. */
export function summarizePipeline(checks: Check[]): PipelineSummary {
  const summary: PipelineSummary = {
    total: 0,
    running: 0,
    queued: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    runningSince: null,
    failedRequired: [],
    failedOptional: [],
  }
  for (const check of checks) {
    if (check.state === 'stale') continue
    summary.total += 1
    if (check.state === 'queued') summary.queued += 1
    else if (check.state === 'running') {
      summary.running += 1
      if (check.startedAt !== null && (summary.runningSince === null || Date.parse(check.startedAt) < Date.parse(summary.runningSince))) {
        summary.runningSince = check.startedAt
      }
    } else if (check.state === 'success') summary.succeeded += 1
    else if (FAILED_STATES.includes(check.state)) {
      summary.failed += 1
      if (check.isRequired) summary.failedRequired.push(check.name)
      else summary.failedOptional.push(check.name)
    } else summary.skipped += 1
  }
  return summary
}

/** Latest decisive review state per author (commented and pending never count; dismissed clears). */
function decisiveReviews(reviews: Review[]): Map<string, 'approved' | 'changes-requested'> {
  const ordered = reviews
    .map((review, index) => ({ review, index }))
    .filter(({ review }) => review.state === 'approved' || review.state === 'changes-requested' || review.state === 'dismissed')
    .sort((a, b) => {
      const at = a.review.submittedAt === null ? 0 : Date.parse(a.review.submittedAt)
      const bt = b.review.submittedAt === null ? 0 : Date.parse(b.review.submittedAt)
      return at - bt || a.index - b.index
    })
  const latest = new Map<string, 'approved' | 'changes-requested'>()
  for (const { review } of ordered) {
    if (review.state === 'approved' || review.state === 'changes-requested') latest.set(review.author, review.state)
    else latest.delete(review.author)
  }
  return latest
}

function authorsWith(pr: PullRequest, state: 'approved' | 'changes-requested'): string[] {
  const out: string[] = []
  for (const [author, value] of decisiveReviews(pr.reviews)) if (value === state) out.push(author)
  return out
}

function requestedNames(pr: PullRequest): string[] {
  return pr.reviewRequests.map((request) => (request.isTeam ? request.reviewer : `@${request.reviewer}`))
}

function countUnresolved(pr: PullRequest): number {
  return pr.threads.filter((thread) => !thread.isResolved && !thread.isOutdated).length
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Reasons the pull request cannot merge yet, most important first. */
export function deriveBlockers(pr: PullRequest): Blocker[] {
  if (pr.state !== 'open') return []
  const blockers: Blocker[] = []
  if (pr.isDraft) blockers.push({ kind: 'draft', text: 'draft', subjects: [] })
  if (pr.mergeable === 'conflicting' || pr.mergeStateStatus === 'dirty') {
    blockers.push({ kind: 'conflict', text: 'merge conflict', subjects: [] })
  }
  if (pr.mergeStateStatus === 'behind') blockers.push({ kind: 'behind', text: 'branch behind base', subjects: [] })

  const pipeline = summarizePipeline(pr.checks)
  const failed = pipeline.failedRequired
  if (failed.length > 0) {
    const text = failed.length === 1 ? `${failed[0]} failed (required)` : `${failed.length} required checks failed`
    blockers.push({ kind: 'required-check-failed', text, subjects: failed })
  }
  const pending = pr.checks.filter((check) => check.isRequired && (check.state === 'queued' || check.state === 'running'))
  if (pending.length > 0) {
    const text = pending.length === 1 ? `${pending[0]?.name ?? 'check'} running (required)` : `${pending.length} required checks running`
    blockers.push({ kind: 'required-check-pending', text, subjects: pending.map((check) => check.name) })
  }
  if (pr.reviewDecision === 'changes-requested') {
    const authors = authorsWith(pr, 'changes-requested')
    const text = authors.length > 0 ? `changes requested by ${authors.map((a) => `@${a}`).join(', ')}` : 'changes requested'
    blockers.push({ kind: 'changes-requested', text, subjects: authors })
  }
  if (pr.reviewDecision === 'review-required') {
    const requested = requestedNames(pr)
    const text = requested.length > 0 ? `review required: ${requested.join(', ')}` : 'review required'
    blockers.push({ kind: 'review-required', text, subjects: pr.reviewRequests.map((request) => request.reviewer) })
  }
  if (blockers.length === 0 && pr.mergeStateStatus === 'blocked') {
    const unresolved = countUnresolved(pr)
    if (unresolved > 0) {
      blockers.push({ kind: 'unresolved-threads', text: `${unresolved} unresolved ${plural(unresolved, 'thread', 'threads')}`, subjects: [] })
    } else {
      blockers.push({ kind: 'branch-protection', text: 'blocked by branch protection', subjects: [] })
    }
  }
  if (blockers.length === 0 && pr.mergeStateStatus === 'unknown') {
    blockers.push({ kind: 'unknown', text: 'mergeability being computed', subjects: [] })
  }
  return blockers
}

/** The overall verdict the band leads with. */
export function deriveVerdict(pr: PullRequest, blockers: Blocker[], pipeline: PipelineSummary): Verdict {
  if (pr.state === 'merged') return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (pr.isInMergeQueue) return 'in-queue'
  const isMergeable = blockers.length === 0 && MERGEABLE_STATUSES.includes(pr.mergeStateStatus)
  if (pr.autoMerge !== null && !isMergeable) return 'auto-merge'
  if (isMergeable) return 'mergeable'
  const isOnlyPending = blockers.length > 0 && blockers.every((blocker) => blocker.kind === 'required-check-pending')
  const isRunningWithoutFailure = blockers.length === 0 && pipeline.running + pipeline.queued > 0 && pipeline.failed === 0
  if (isOnlyPending || isRunningWithoutFailure) return 'checks-running'
  return 'blocked'
}

/**
 * Reasons to look twice although GitHub allows the merge (no required checks, no
 * review rule), in priority order. Empty unless the verdict is mergeable.
 */
export function mergeCaveats(pr: PullRequest, status: Pick<Status, 'verdict' | 'pipeline' | 'unresolvedThreads' | 'changesRequestedBy'>): string[] {
  if (status.verdict !== 'mergeable') return []
  const caveats: string[] = []
  const { failed, running, queued } = status.pipeline
  if (failed > 0) caveats.push(`${failed} ${plural(failed, 'check', 'checks')} failed`)
  if (running + queued > 0) caveats.push('checks running')
  if (status.unresolvedThreads > 0) caveats.push(`${status.unresolvedThreads} unresolved ${plural(status.unresolvedThreads, 'thread', 'threads')}`)
  if (status.changesRequestedBy.length > 0 && pr.reviewDecision !== 'changes-requested') caveats.push('changes requested')
  return caveats
}

/** Color of the 'ready to merge' verdict: red with a failed check, warning with other caveats, else success. */
export function mergeTone(status: Pick<Status, 'pipeline' | 'caveats'>): 'success' | 'failure' | 'pending' {
  if (status.caveats.length === 0) return 'success'
  return status.pipeline.failed > 0 ? 'failure' : 'pending'
}

function commentRefs(pr: PullRequest): CommentRef[] {
  const refs: CommentRef[] = []
  const seen = new Set<string>()
  const add = (ref: CommentRef | null) => {
    if (ref === null || seen.has(ref.url)) return
    seen.add(ref.url)
    refs.push(ref)
  }
  add(pr.lastComment)
  for (const thread of pr.threads) add(thread.last)
  return refs
}

/** Pipeline counts of the merge group commit's checks while the pull request is in the queue; else null. */
export function queuePipelineOf(pr: PullRequest): PipelineSummary | null {
  if (!pr.isInMergeQueue || pr.mergeQueueEntry === null) return null
  return summarizePipeline(pr.mergeQueueEntry.checks)
}

/** Derived view of a pull request for the band and pane. */
export function deriveStatus(pr: PullRequest, viewerLogin: string, lastSeenAt: string | null): Status {
  const blockers = deriveBlockers(pr)
  const pipeline = summarizePipeline(pr.checks)
  const seenMs = lastSeenAt === null ? Number.POSITIVE_INFINITY : Date.parse(lastSeenAt)
  const newActivity = commentRefs(pr)
    .filter((ref) => ref.author !== viewerLogin && Date.parse(ref.createdAt) > seenMs)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const base = {
    verdict: deriveVerdict(pr, blockers, pipeline),
    blockers,
    pipeline,
    approvals: authorsWith(pr, 'approved'),
    changesRequestedBy: authorsWith(pr, 'changes-requested'),
    requested: requestedNames(pr),
    unresolvedThreads: countUnresolved(pr),
    newActivity,
    queuePipeline: queuePipelineOf(pr),
  }
  return { ...base, caveats: mergeCaveats(pr, base) }
}

function names(logins: string[]): string {
  return logins.map((login) => `@${login}`).join(', ')
}

/** Toast texts for what changed between two snapshots of the same pull request, at most 3. */
export function transitions(prev: Snapshot | null, next: Snapshot, viewerLogin: string): string[] {
  if (prev === null || prev.kind !== 'pr' || next.kind !== 'pr') return []
  if (prev.location.owner !== next.location.owner || prev.location.repo !== next.location.repo) return []
  if (prev.pr.number !== next.pr.number) return []

  const before = prev.pr
  const after = next.pr
  const prevStatus = deriveStatus(before, viewerLogin, null)
  const nextStatus = deriveStatus(after, viewerLogin, null)
  const label = `PR #${after.number}`
  const toasts: { priority: number; text: string }[] = []
  const push = (priority: number, text: string) => toasts.push({ priority, text: `${label}: ${text}` })

  if (before.state === 'open' && after.state === 'merged') push(0, 'merged')

  const wasRunning = prevStatus.pipeline.running + prevStatus.pipeline.queued > 0
  const isRunning = nextStatus.pipeline.running + nextStatus.pipeline.queued > 0
  const isReady = prevStatus.verdict !== 'mergeable' && nextStatus.verdict === 'mergeable'
  if (wasRunning && !isRunning) {
    const failed = nextStatus.pipeline.failed
    if (failed > 0) push(1, `${failed} ${plural(failed, 'check', 'checks')} failed`)
    else if (!isReady && after.state === 'open') push(3.5, 'checks passed')
  } else if (isRunning) {
    const fresh = nextStatus.pipeline.failedRequired.filter((name) => !prevStatus.pipeline.failedRequired.includes(name))
    if (fresh.length === 1) push(1, `${fresh[0]} failed`)
    else if (fresh.length > 1) push(1, `${fresh.length} required checks failed`)
  }

  const queueBefore = prevStatus.queuePipeline
  if (queueBefore !== null && queueBefore.running + queueBefore.queued > 0) {
    const queueAfter = nextStatus.queuePipeline
    const isFinishedRed = queueAfter !== null && queueAfter.running + queueAfter.queued === 0 && queueAfter.failed > 0
    const isDroppedRed = queueAfter === null && queueBefore.failed > 0 && after.state === 'open'
    if (isFinishedRed || isDroppedRed) push(1, 'merge queue checks failed')
  }

  const hadConflict = prevStatus.blockers.some((blocker) => blocker.kind === 'conflict')
  const hasConflict = nextStatus.blockers.some((blocker) => blocker.kind === 'conflict')
  if (!hadConflict && hasConflict) push(2, 'merge conflict')

  if (isReady) push(3, 'ready to merge')

  const newApprovals = nextStatus.approvals.filter((login) => !prevStatus.approvals.includes(login))
  if (newApprovals.length > 0) push(4, `approved by ${names(newApprovals)}`)
  const newChanges = nextStatus.changesRequestedBy.filter((login) => !prevStatus.changesRequestedBy.includes(login))
  if (newChanges.length > 0) push(4, `changes requested by ${names(newChanges)}`)

  const knownUrls = new Set(commentRefs(before).map((ref) => ref.url))
  const fresh = commentRefs(after).filter((ref) => ref.author !== viewerLogin && !knownUrls.has(ref.url))
  if (fresh.length === 1 && fresh[0] !== undefined) push(5, `new comment by @${fresh[0].author}`)
  else if (fresh.length > 1) push(5, `${fresh.length} new comments`)

  if (!before.isInMergeQueue && after.isInMergeQueue) {
    const position = after.mergeQueueEntry?.position
    push(6, position === undefined ? 'added to merge queue' : `added to merge queue (position ${position})`)
  } else if (before.isInMergeQueue && !after.isInMergeQueue && after.state !== 'merged') {
    push(6, 'removed from merge queue')
  }

  return toasts
    .map((toast, index) => ({ ...toast, index }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, 3)
    .map((toast) => toast.text)
}

/** Formats milliseconds as '42s', '2:14' or '1:05:09'. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (value: number) => String(value).padStart(2, '0')
  if (hours > 0) return `${hours}:${two(minutes)}:${two(seconds)}`
  if (minutes > 0) return `${minutes}:${two(seconds)}`
  return `${seconds}s`
}

/** Formats an ISO time relative to `nowMs` as 'just now', '4 min ago', '3 h ago' or '2 d ago'. */
export function relativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso)
  const seconds = Number.isNaN(then) ? 0 : Math.floor((nowMs - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

/** First 7 characters of a commit id. */
export function shortSha(oid: string): string {
  return oid.slice(0, 7)
}

/** One-character glyph for a check state. */
export function checkGlyph(state: CheckState): string {
  switch (state) {
    case 'success':
      return '✓'
    case 'failure':
    case 'timed-out':
    case 'action-required':
      return '✗'
    case 'queued':
      return '◷'
    case 'running':
      return '●'
    case 'cancelled':
      return '⊘'
    case 'skipped':
    case 'neutral':
    case 'stale':
      return '–'
  }
}

const CHECK_BLOCKERS: readonly string[] = ['required-check-failed', 'required-check-pending']

/** Blockers that are not about checks; the pipeline segment names the checks. */
export function nonCheckBlockers(blockers: Blocker[]): Blocker[] {
  return blockers.filter((blocker) => !CHECK_BLOCKERS.includes(blocker.kind))
}

const QUEUE_STATE_TEXT: Record<MergeQueueState, string> = {
  queued: 'queued',
  'awaiting-checks': 'waiting for checks',
  mergeable: 'about to merge',
  unmergeable: 'will be removed',
  locked: 'locked',
}

/** Plain words for a merge queue state. */
export function queueStateText(state: MergeQueueState): string {
  return QUEUE_STATE_TEXT[state]
}

/** Seconds as '<1 min', '~4 min' or '~1 h 5 min'. */
export function formatEta(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `~${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `~${Math.floor(minutes / 60)} h` : `~${Math.floor(minutes / 60)} h ${rest} min`
}

/** 'in merge queue #1 · waiting for checks', with ' · ~4 min' when `isWithEta` and GitHub estimates it. */
export function queueLine(entry: MergeQueueEntry | null, isWithEta: boolean): string {
  if (entry === null) return 'in merge queue'
  const eta = isWithEta && entry.estimatedTimeToMerge !== null ? ` · ${formatEta(entry.estimatedTimeToMerge)}` : ''
  return `in merge queue #${entry.position} · ${queueStateText(entry.state)}${eta}`
}

/** The band's headline for a verdict; a mergeable one carries its `caveats` after ' · '. */
export function verdictText(verdict: Verdict, blockers: Blocker[], caveats: string[] = []): string {
  switch (verdict) {
    case 'mergeable':
      return ['ready to merge', ...caveats].join(' · ')
    case 'blocked': {
      const first = nonCheckBlockers(blockers)[0]
      return first === undefined ? 'blocked' : `blocked: ${first.text}`
    }
    case 'checks-running':
      return 'checks running'
    case 'in-queue':
      return 'in merge queue'
    case 'auto-merge':
      return 'auto-merge on'
    case 'merged':
      return 'merged'
    case 'closed':
      return 'closed'
  }
}

/** The PR state badge word; src/ui/colors.ts holds what each is painted with. */
export type PrBadge = {
  text: 'open' | 'draft' | 'merged' | 'closed' | 'queued'
}

/** GitHub-like state: merged, closed, in the merge queue, draft, else open. */
export function prBadge(pr: PullRequest): PrBadge {
  if (pr.state === 'merged') return { text: 'merged' }
  if (pr.state === 'closed') return { text: 'closed' }
  if (pr.isInMergeQueue) return { text: 'queued' }
  if (pr.isDraft) return { text: 'draft' }
  return { text: 'open' }
}

/** The overall pipeline verdict line: '● pipeline running · 3 of 37 running'. Null without checks. */
export function pipelineVerdict(pipeline: PipelineSummary): { text: string; tone: 'success' | 'failure' | 'pending' } | null {
  if (pipeline.total === 0) return null
  if (pipeline.failed > 0) {
    const names = [...pipeline.failedRequired, ...pipeline.failedOptional]
    return { text: `✗ pipeline failed · ${names.join(', ')}`, tone: 'failure' }
  }
  if (pipeline.running > 0) return { text: `● pipeline running · ${pipeline.running} of ${pipeline.total} running`, tone: 'pending' }
  if (pipeline.queued > 0) return { text: '◷ pipeline queued', tone: 'pending' }
  const skipped = pipeline.skipped > 0 ? ` · ${pipeline.skipped} skipped` : ''
  return { text: `✓ pipeline passed · ${pipeline.succeeded} passed${skipped}`, tone: 'success' }
}
