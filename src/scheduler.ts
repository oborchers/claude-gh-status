// When to look at GitHub again, and the single-flight refresh that does the
// looking. Pure logic: every outside effect (git, gh, $.state, toasts, time)
// arrives as an injected function, built in register.tsx.

import type { AccountChoice, AccountFailure, JobDetail, Problem, PullRequest, RateLimit, RepoLocation, Snapshot } from './model'
import type { FastCheckResult, FastTarget } from './etag'
import type { FetchedPullRequest } from './query'
import { transitions } from './status'

const SECOND_MS = 1000
const DEFAULT_FAST_SECONDS = 5
const DEFAULT_IDLE_SECONDS = 30
const SLOW_SECONDS = 120
const LOW_RATE_SECONDS = 60
const LOW_RATE_REMAINING = 500
const FULL_REFRESH_MS = 60_000
/** Waits after the 1st, 2nd and later transient failures in a row. */
const BACKOFF_MS = [15_000, 30_000, 60_000] as const

/** Check states that keep the fast interval going. */
const RUNNING_STATES = new Set(['queued', 'running'])
/** Check states whose Actions job the pane shows. */
const JOB_STATES = new Set(['running', 'failure', 'timed-out'])

export type RefreshReason = 'start' | 'timer' | 'push' | 'turn' | 'cwd' | 'command'

export type SchedulerConfig = {
  fastIntervalSeconds: number
  idleIntervalSeconds: number
  toasts: boolean
}

function seconds(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** The wait after a transient failure, given the wait after the one before (null: this is the first). */
export function backoffMs(previousMs: number | null): number {
  const index = previousMs === null ? -1 : BACKOFF_MS.findIndex(step => step >= previousMs)
  return BACKOFF_MS[Math.min(index + 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[0]
}

/** The transient failure a snapshot is retrying, if any. */
export function problemOf(snapshot: Snapshot): Problem | null {
  if (snapshot.kind === 'pr') return snapshot.stale ?? null
  if (snapshot.kind === 'error') return snapshot.problem ?? null
  return null
}

/** Short label of a transient failure for the hint: `504`, `network`, ... */
export function reasonOf(failure: { kind: string; message: string }): string {
  if (failure.kind === 'server') return /\b50\d\b/.exec(failure.message)?.[0] ?? 'bad response'
  if (failure.kind === 'rate-limited') return 'rate limit'
  return failure.kind
}

/** Milliseconds until the next timer refresh. */
export function nextDelayMs(snapshot: Snapshot, rateLimit: RateLimit | null, config: Pick<SchedulerConfig, 'fastIntervalSeconds' | 'idleIntervalSeconds'>): number {
  let delay = SLOW_SECONDS
  const problem = problemOf(snapshot)
  if (problem !== null) {
    delay = problem.retryInMs / SECOND_MS
  } else if (snapshot.kind === 'pr' && snapshot.pr.state === 'open') {
    const queueChecks = snapshot.pr.mergeQueueEntry?.checks ?? []
    const isBusy = snapshot.pr.isInMergeQueue || [...snapshot.pr.checks, ...queueChecks].some(check => RUNNING_STATES.has(check.state))
    delay = isBusy ? seconds(config.fastIntervalSeconds, DEFAULT_FAST_SECONDS) : seconds(config.idleIntervalSeconds, DEFAULT_IDLE_SECONDS)
  }
  if (rateLimit !== null && rateLimit.remaining < LOW_RATE_REMAINING) delay = Math.max(delay, LOW_RATE_SECONDS)
  return Math.round(delay * SECOND_MS)
}

/** True once the last full fetch is a minute old (or there was none). */
export function isFullRefreshDue(lastFullAtMs: number, nowMs: number): boolean {
  return nowMs - lastFullAtMs >= FULL_REFRESH_MS
}

/**
 * What a refresher looks after: the branch's pull request (the band, and the
 * pane unless one is picked) or the pull request picked from the list (the
 * pane only). One refresher per target, each with its own single flight.
 */
export type RefreshTarget = 'branch' | 'selected'

/** What the refresher reads of $.state. */
export type StateView = {
  snapshot: Snapshot
  jobs: JobDetail[]
  etags: Record<string, string>
  /** The pull request picked from the list; null when the pane shows the branch's. */
  selected: { number: number } | null
  selectedSnapshot: Snapshot | null
}

/**
 * What the refresher writes to $.state; absent fields stay as they are.
 * `snapshot` is the branch target's, `selectedSnapshot` the selected target's.
 * `etags` are the target's own request paths: the writer merges them into the
 * stored map with mergeEtags, so the two targets do not overwrite each other.
 */
export type StatePatch = {
  snapshot?: Snapshot
  selectedSnapshot?: Snapshot | null
  jobs?: JobDetail[]
  rateLimit?: RateLimit
  etags?: Record<string, string>
}

/** Prefix of the selected target's keys in the shared ETag map (branch keys have none). */
const SELECTED_ETAG_PREFIX = 'selected:'

/** The part of the stored ETag map that belongs to a target, with plain request paths as keys. */
export function etagsOf(stored: Record<string, string>, target: RefreshTarget): Record<string, string> {
  const own: Record<string, string> = {}
  for (const [key, value] of Object.entries(stored)) {
    const isSelectedKey = key.startsWith(SELECTED_ETAG_PREFIX)
    if (target === 'selected' && isSelectedKey) own[key.slice(SELECTED_ETAG_PREFIX.length)] = value
    else if (target === 'branch' && !isSelectedKey) own[key] = value
  }
  return own
}

/** The stored ETag map with the target's part replaced by `own` and the other target's part untouched. */
export function mergeEtags(stored: Record<string, string>, own: Record<string, string>, target: RefreshTarget): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(SELECTED_ETAG_PREFIX) !== (target === 'selected')) merged[key] = value
  }
  for (const [key, value] of Object.entries(own)) merged[target === 'selected' ? `${SELECTED_ETAG_PREFIX}${key}` : key] = value
  return merged
}

export type RefresherDeps = {
  /** Which pull request this refresher looks after; the branch's when absent. */
  target?: RefreshTarget
  config: SchedulerConfig
  readCwd(): Promise<string>
  readLocation(cwd: string): Promise<RepoLocation | null>
  resolveAccount(location: RepoLocation): Promise<AccountChoice | AccountFailure>
  fetchPullRequest(location: RepoLocation, login: string): Promise<FetchedPullRequest>
  /** The pull request with this number, for the selected target. */
  fetchPullRequestByNumber(location: RepoLocation, login: string, number: number): Promise<FetchedPullRequest>
  fastCheck(location: RepoLocation, login: string, target: FastTarget, etags: Record<string, string>): Promise<FastCheckResult>
  fetchJobs(location: RepoLocation, login: string, runIds: number[]): Promise<JobDetail[]>
  isPaneOpen(): Promise<boolean>
  readState(): Promise<StateView>
  writeState(patch: StatePatch, target: RefreshTarget): Promise<void>
  now(): Promise<number>
  toast(text: string): void
}

export type Refresher = {
  /** Coalescing refresh; resolves when the refresh covering this call is done. Never rejects. */
  refresh(reason: RefreshReason): Promise<void>
}

type PrSnapshot = Extract<Snapshot, { kind: 'pr' }>

function sameRepo(a: RepoLocation, b: RepoLocation): boolean {
  return (a.owner ?? '').toLowerCase() === (b.owner ?? '').toLowerCase() && (a.repo ?? '').toLowerCase() === (b.repo ?? '').toLowerCase()
}

function sameBranch(a: RepoLocation, b: RepoLocation): boolean {
  return (a.owner ?? '').toLowerCase() === (b.owner ?? '').toLowerCase() && (a.repo ?? '').toLowerCase() === (b.repo ?? '').toLowerCase() && a.branch === b.branch
}

/** True when `branch` is the pull request `number` of the location's repository. */
function isBranchPr(branch: Snapshot, location: RepoLocation | null, number: number | null): boolean {
  return branch.kind === 'pr' && location !== null && number !== null && branch.pr.number === number && sameRepo(branch.location, location)
}

function repoKey(location: RepoLocation): string {
  return `${(location.owner ?? '').toLowerCase()}/${(location.repo ?? '').toLowerCase()}`
}

export function isTransient(kind: string): boolean {
  return kind === 'network' || kind === 'timeout' || kind === 'rate-limited' || kind === 'server'
}

function runIdsOf(pr: PullRequest): number[] {
  const ids: number[] = []
  for (const check of [...pr.checks, ...(pr.mergeQueueEntry?.checks ?? [])]) {
    if (check.runId !== null && JOB_STATES.has(check.state) && !ids.includes(check.runId)) ids.push(check.runId)
  }
  return ids
}

/** A single-flight refresh: one runs, one more may wait behind it, the rest join the waiting one. */
export function createRefresher(deps: RefresherDeps): Refresher {
  const target: RefreshTarget = deps.target ?? 'branch'
  const isSelected = target === 'selected'
  const accounts = new Map<string, AccountChoice>()
  let lastFullAtMs = 0
  let inFlight: Promise<void> | null = null
  let queued: { reason: RefreshReason; done: Promise<void> } | null = null

  /** The snapshot this target keeps: the band's for the branch, the pane's pick for the selected. */
  function currentOf(state: StateView): Snapshot {
    if (!isSelected) return state.snapshot
    const own = state.selectedSnapshot
    return own !== null && (own.kind !== 'pr' || own.pr.number === state.selected?.number) ? own : { kind: 'loading', at: '' }
  }

  function ownPatch(snapshot: Snapshot): StatePatch {
    return isSelected ? { selectedSnapshot: snapshot } : { snapshot }
  }

  async function runOnce(reason: RefreshReason): Promise<void> {
    let nowMs = 0
    let state: StateView = { snapshot: { kind: 'loading', at: '' }, jobs: [], etags: {}, selected: null, selectedSnapshot: null }
    let location: RepoLocation | null = null
    try {
      nowMs = await deps.now()
      state = await deps.readState()
      const wanted = state.selected?.number ?? null
      if (isSelected && wanted === null) {
        if (state.selectedSnapshot !== null) await deps.writeState({ selectedSnapshot: null }, target)
        return
      }
      const at = new Date(nowMs).toISOString()
      const cwd = await deps.readCwd()
      location = await deps.readLocation(cwd)
      if (location === null) return await publish(state, { kind: 'not-a-repo', at, cwd }, null)
      if (location.owner === null || location.repo === null) return await publish(state, { kind: 'no-github-remote', at, location }, null)
      // a picked pull request needs the repository only; the branch target needs a branch
      if (!isSelected && location.branch === null) return await publish(state, { kind: 'detached', at, location }, null)
      // the picked pull request is the branch's: the pane reads the branch snapshot, nothing to keep or toast twice
      if (isSelected && isBranchPr(state.snapshot, location, wanted)) {
        if (state.selectedSnapshot !== null) await deps.writeState({ selectedSnapshot: null }, target)
        return
      }

      const key = repoKey(location)
      let account = accounts.get(key)
      if (account === undefined) {
        const resolved = await deps.resolveAccount(location)
        if (!('login' in resolved)) return await publish(state, { kind: 'no-account', at, location, failure: resolved }, null)
        account = resolved
        accounts.set(key, account)
      }

      const prev = currentOf(state)
      const here = location
      const isSameTarget = (snapshot: PrSnapshot): boolean =>
        snapshot.account.login === account.login && (isSelected ? sameRepo(snapshot.location, here) && snapshot.pr.number === wanted : sameBranch(snapshot.location, here))
      const prevPr: PrSnapshot | null = prev.kind === 'pr' && isSameTarget(prev) ? prev : null

      let etags = etagsOf(state.etags, target)
      let seeded: { headOid: string; etags: Record<string, string> } | null = null
      if (reason === 'timer' && prevPr !== null && prevPr.pr.state === 'open' && !isFullRefreshDue(lastFullAtMs, nowMs)) {
        const target = { prNumber: prevPr.pr.number, headOid: prevPr.pr.headOid }
        const fast = await deps.fastCheck(location, account.login, target, etags)
        etags = fast.etags
        if (!fast.isChanged && !fast.isFailed) {
          const { stale: _stale, ...fresh } = prevPr
          const same: Snapshot = { ...fresh, at, location, account }
          return await publish(state, same, account.login, { etags })
        }
        seeded = { headOid: target.headOid, etags: fast.etags }
      }

      const fetched = isSelected && wanted !== null ? await deps.fetchPullRequestByNumber(location, account.login, wanted) : await deps.fetchPullRequest(location, account.login)
      if (fetched.kind === 'error') {
        const failure = fetched.failure
        if (failure.kind === 'not-found' || failure.kind === 'auth') accounts.delete(key)
        const extra: StatePatch = failure.kind === 'rate-limited' ? { rateLimit: { remaining: 0, resetAt: at } } : {}
        if (isTransient(failure.kind)) {
          const earlier = problemOf(prev)
          const problem: Problem = { reason: reasonOf(failure), since: earlier?.since ?? at, triedAt: at, retryInMs: backoffMs(earlier?.retryInMs ?? null) }
          // keep the last good picture and mark it stale; the next try comes after the backoff
          if (prevPr !== null) return await deps.writeState({ ...extra, ...ownPatch({ ...prevPr, stale: problem }) }, target)
          return await publish(state, { kind: 'error', at, message: failure.message, location, problem }, null, extra)
        }
        const message = failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message
        return await publish(state, { kind: 'error', at, message, location }, null, extra)
      }

      lastFullAtMs = nowMs
      const extra: StatePatch = fetched.rateLimit === null ? {} : { rateLimit: fetched.rateLimit }
      if (fetched.pr === null) {
        const none: Snapshot = isSelected ? { kind: 'error', at, message: `PR #${wanted ?? 0} was not found`, location } : { kind: 'no-pr', at, location, account }
        return await publish(state, none, null, { ...extra, etags: {} })
      }
      const pr = fetched.pr
      if (pr.state === 'open') {
        if (seeded !== null && seeded.headOid === pr.headOid) etags = seeded.etags
        else etags = (await deps.fastCheck(location, account.login, { prNumber: pr.number, headOid: pr.headOid }, etags)).etags
      } else {
        etags = {}
      }
      return await publish(state, { kind: 'pr', at, location, account, pr }, account.login, { ...extra, etags })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        const at = new Date(nowMs).toISOString()
        await deps.writeState(ownPatch({ kind: 'error', at, message: message.slice(0, 300), location }), target)
      } catch {
        // nothing left to report to
      }
    }
  }

  /** Writes the snapshot with the extras, then jobs, then toasts. */
  async function publish(state: StateView, snapshot: Snapshot, login: string | null, extra: StatePatch = {}): Promise<void> {
    await deps.writeState({ ...extra, ...ownPatch(snapshot) }, target)
    // The jobs belong to the pull request the pane shows; the other target leaves them alone.
    if (isPaneSubject(state, snapshot)) {
      const jobs = await jobsFor(snapshot, login)
      if (JSON.stringify(jobs) !== JSON.stringify(state.jobs)) await deps.writeState({ jobs }, target)
    }
    // A picked pull request that is also the branch's is toasted by the branch target only.
    const isBranchDuplicate = isSelected && snapshot.kind === 'pr' && isBranchPr(state.snapshot, snapshot.location, snapshot.pr.number)
    if (deps.config.toasts && login !== null && !isBranchDuplicate) {
      for (const text of transitions(currentOf(state), snapshot, login)) deps.toast(text)
    }
  }

  /** True when the pane draws this target's snapshot: always for the selected target, and for the branch unless another pull request is picked. */
  function isPaneSubject(state: StateView, snapshot: Snapshot): boolean {
    if (isSelected || state.selected === null) return true
    return snapshot.kind === 'pr' && snapshot.pr.number === state.selected.number
  }

  async function jobsFor(snapshot: Snapshot, login: string | null): Promise<JobDetail[]> {
    if (snapshot.kind !== 'pr' || login === null) return []
    const runIds = runIdsOf(snapshot.pr)
    if (runIds.length === 0 || !(await deps.isPaneOpen())) return []
    return deps.fetchJobs(snapshot.location, login, runIds)
  }

  function refresh(reason: RefreshReason): Promise<void> {
    if (inFlight === null) {
      const running = runOnce(reason).finally(() => {
        inFlight = null
      })
      inFlight = running
      return running
    }
    if (queued === null) {
      const entry = { reason, done: Promise.resolve() }
      entry.done = inFlight.then(() => {
        queued = null
        return refresh(entry.reason)
      })
      queued = entry
    } else if (reason !== 'timer') {
      queued.reason = reason
    }
    return queued.done
  }

  return { refresh }
}
