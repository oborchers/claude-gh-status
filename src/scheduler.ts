// When to look at GitHub again, and the single-flight refresh that does the
// looking. Pure logic: every outside effect (git, gh, $.state, toasts, time)
// arrives as an injected function, built in register.tsx.

import type { AccountChoice, AccountFailure, JobDetail, PullRequest, RateLimit, RepoLocation, Snapshot } from './model'
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

/** Milliseconds until the next timer refresh. */
export function nextDelayMs(snapshot: Snapshot, rateLimit: RateLimit | null, config: Pick<SchedulerConfig, 'fastIntervalSeconds' | 'idleIntervalSeconds'>): number {
  let delay = SLOW_SECONDS
  if (snapshot.kind === 'pr' && snapshot.pr.state === 'open') {
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

/** What the refresher reads of $.state. */
export type StateView = {
  snapshot: Snapshot
  jobs: JobDetail[]
  etags: Record<string, string>
}

/** What the refresher writes to $.state; absent fields stay as they are. */
export type StatePatch = {
  snapshot?: Snapshot
  jobs?: JobDetail[]
  rateLimit?: RateLimit
  etags?: Record<string, string>
}

export type RefresherDeps = {
  config: SchedulerConfig
  readCwd(): Promise<string>
  readLocation(cwd: string): Promise<RepoLocation | null>
  resolveAccount(location: RepoLocation): Promise<AccountChoice | AccountFailure>
  fetchPullRequest(location: RepoLocation, login: string): Promise<FetchedPullRequest>
  fastCheck(location: RepoLocation, login: string, target: FastTarget, etags: Record<string, string>): Promise<FastCheckResult>
  fetchJobs(location: RepoLocation, login: string, runIds: number[]): Promise<JobDetail[]>
  isPaneOpen(): Promise<boolean>
  readState(): Promise<StateView>
  writeState(patch: StatePatch): Promise<void>
  now(): Promise<number>
  toast(text: string): void
}

export type Refresher = {
  /** Coalescing refresh; resolves when the refresh covering this call is done. Never rejects. */
  refresh(reason: RefreshReason): Promise<void>
}

type PrSnapshot = Extract<Snapshot, { kind: 'pr' }>

function sameBranch(a: RepoLocation, b: RepoLocation): boolean {
  return (a.owner ?? '').toLowerCase() === (b.owner ?? '').toLowerCase() && (a.repo ?? '').toLowerCase() === (b.repo ?? '').toLowerCase() && a.branch === b.branch
}

function repoKey(location: RepoLocation): string {
  return `${(location.owner ?? '').toLowerCase()}/${(location.repo ?? '').toLowerCase()}`
}

function isTransient(kind: string): boolean {
  return kind === 'network' || kind === 'timeout' || kind === 'rate-limited'
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
  const accounts = new Map<string, AccountChoice>()
  let lastFullAtMs = 0
  let inFlight: Promise<void> | null = null
  let queued: { reason: RefreshReason; done: Promise<void> } | null = null

  async function runOnce(reason: RefreshReason): Promise<void> {
    let nowMs = 0
    let state: StateView = { snapshot: { kind: 'loading', at: '' }, jobs: [], etags: {} }
    let location: RepoLocation | null = null
    try {
      nowMs = await deps.now()
      state = await deps.readState()
      const at = new Date(nowMs).toISOString()
      const cwd = await deps.readCwd()
      location = await deps.readLocation(cwd)
      if (location === null) return await publish(state, { kind: 'not-a-repo', at, cwd }, null)
      if (location.owner === null || location.repo === null) return await publish(state, { kind: 'no-github-remote', at, location }, null)
      if (location.branch === null) return await publish(state, { kind: 'detached', at, location }, null)

      const key = repoKey(location)
      let account = accounts.get(key)
      if (account === undefined) {
        const resolved = await deps.resolveAccount(location)
        if (!('login' in resolved)) return await publish(state, { kind: 'no-account', at, location, failure: resolved }, null)
        account = resolved
        accounts.set(key, account)
      }

      const prev = state.snapshot
      const prevPr: PrSnapshot | null = prev.kind === 'pr' && sameBranch(prev.location, location) && prev.account.login === account.login ? prev : null

      let etags = state.etags
      let seeded: { headOid: string; etags: Record<string, string> } | null = null
      if (reason === 'timer' && prevPr !== null && prevPr.pr.state === 'open' && !isFullRefreshDue(lastFullAtMs, nowMs)) {
        const target = { prNumber: prevPr.pr.number, headOid: prevPr.pr.headOid }
        const fast = await deps.fastCheck(location, account.login, target, etags)
        etags = fast.etags
        if (!fast.isChanged && !fast.isFailed) {
          const same: Snapshot = { ...prevPr, at, location, account }
          return await publish(state, same, account.login, { etags })
        }
        seeded = { headOid: target.headOid, etags: fast.etags }
      }

      const fetched = await deps.fetchPullRequest(location, account.login)
      if (fetched.kind === 'error') {
        const failure = fetched.failure
        if (failure.kind === 'not-found' || failure.kind === 'auth') accounts.delete(key)
        const extra: StatePatch = failure.kind === 'rate-limited' ? { rateLimit: { remaining: 0, resetAt: at } } : {}
        if (isTransient(failure.kind) && prev.kind === 'pr') {
          // keep the last good picture; the next tick tries again
          if (extra.rateLimit !== undefined) await deps.writeState(extra)
          return
        }
        const message = failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message
        return await publish(state, { kind: 'error', at, message, location }, null, extra)
      }

      lastFullAtMs = nowMs
      const extra: StatePatch = fetched.rateLimit === null ? {} : { rateLimit: fetched.rateLimit }
      if (fetched.pr === null) {
        return await publish(state, { kind: 'no-pr', at, location, account }, null, { ...extra, etags: {} })
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
        await deps.writeState({ snapshot: { kind: 'error', at, message: message.slice(0, 300), location } })
      } catch {
        // nothing left to report to
      }
    }
  }

  /** Writes the snapshot with the extras, then jobs, then toasts. */
  async function publish(state: StateView, snapshot: Snapshot, login: string | null, extra: StatePatch = {}): Promise<void> {
    await deps.writeState({ ...extra, snapshot })
    const jobs = await jobsFor(snapshot, login)
    if (JSON.stringify(jobs) !== JSON.stringify(state.jobs)) await deps.writeState({ jobs })
    if (deps.config.toasts && login !== null) {
      for (const text of transitions(state.snapshot, snapshot, login)) deps.toast(text)
    }
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
