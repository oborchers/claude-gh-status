import { describe, expect, test } from 'claude-code/testing'

import type { AccountChoice, AccountFailure, JobDetail, RateLimit, RepoLocation, Snapshot } from '../src/model'
import type { FastCheckResult } from '../src/etag'
import type { FetchedPullRequest } from '../src/query'
import { createRefresher, isFullRefreshDue, nextDelayMs } from '../src/scheduler'
import type { RefresherDeps, StatePatch, StateView } from '../src/scheduler'
import { makeCheck, makeLocation, makePr, makeSnapshot } from './fixtures/pr-builder'

const config = { fastIntervalSeconds: 5, idleIntervalSeconds: 30, toasts: true }
const OK_RATE: RateLimit = { remaining: 4000, resetAt: '2026-01-01T01:00:00Z' }
const LOW_RATE: RateLimit = { remaining: 120, resetAt: '2026-01-01T01:00:00Z' }
const NOW = Date.parse('2026-01-01T00:00:00Z')

describe('nextDelayMs', () => {
  const location = makeLocation()
  const delay = (snapshot: Snapshot, rate: RateLimit | null = OK_RATE) => nextDelayMs(snapshot, rate, config)

  test('fast while a check runs or is queued', () => {
    expect(delay(makeSnapshot(makePr({ checks: [makeCheck({ state: 'running' })] })))).toBe(5000)
    expect(delay(makeSnapshot(makePr({ checks: [makeCheck({ state: 'queued' })] })))).toBe(5000)
  })

  test('fast in the merge queue', () => {
    expect(delay(makeSnapshot(makePr({ isInMergeQueue: true })))).toBe(5000)
  })

  test('fast while the merge queue checks run, whatever the queue flag says', () => {
    const entry = { position: 1, state: 'awaiting-checks' as const, estimatedTimeToMerge: null, checks: [makeCheck({ state: 'running' })] }
    expect(delay(makeSnapshot(makePr({ checks: [makeCheck()], mergeQueueEntry: entry })))).toBe(5000)
    expect(delay(makeSnapshot(makePr({ checks: [makeCheck()], mergeQueueEntry: { ...entry, checks: [makeCheck()] } })))).toBe(30_000)
  })

  test('idle for an open PR with nothing running', () => {
    expect(delay(makeSnapshot(makePr({ checks: [makeCheck()] })))).toBe(30_000)
  })

  test('slow without a PR, repo, account or after an error', () => {
    const account: AccountChoice = { login: 'me', source: 'active' }
    const failure: AccountFailure = { kind: 'no-access', tried: [] }
    const snapshots: Snapshot[] = [
      { kind: 'loading', at: '' },
      { kind: 'not-a-repo', at: '', cwd: '/x' },
      { kind: 'no-github-remote', at: '', location },
      { kind: 'detached', at: '', location },
      { kind: 'no-account', at: '', location, failure },
      { kind: 'no-pr', at: '', location, account },
      { kind: 'error', at: '', message: 'boom', location },
    ]
    for (const snapshot of snapshots) expect(delay(snapshot)).toBe(120_000)
  })

  test('merged and closed pull requests are slow even with stale running checks', () => {
    const checks = [makeCheck({ state: 'running' })]
    expect(delay(makeSnapshot(makePr({ state: 'merged', checks })))).toBe(120_000)
    expect(delay(makeSnapshot(makePr({ state: 'closed', checks })))).toBe(120_000)
  })

  test('at least a minute while the rate limit is low', () => {
    expect(delay(makeSnapshot(makePr({ checks: [makeCheck({ state: 'running' })] })), LOW_RATE)).toBe(60_000)
    expect(delay(makeSnapshot(makePr()), LOW_RATE)).toBe(60_000)
    expect(delay({ kind: 'loading', at: '' }, LOW_RATE)).toBe(120_000)
  })

  test('configured intervals count, bad values fall back to the defaults', () => {
    const running = makeSnapshot(makePr({ checks: [makeCheck({ state: 'running' })] }))
    expect(nextDelayMs(running, null, { fastIntervalSeconds: 2, idleIntervalSeconds: 10 })).toBe(2000)
    expect(nextDelayMs(running, null, { fastIntervalSeconds: 0, idleIntervalSeconds: 10 })).toBe(5000)
    expect(nextDelayMs(makeSnapshot(makePr()), null, { fastIntervalSeconds: 2, idleIntervalSeconds: Number.NaN })).toBe(30_000)
  })
})

describe('isFullRefreshDue', () => {
  test('due after a minute, never before, and when there was none', () => {
    expect(isFullRefreshDue(0, NOW)).toBe(true)
    expect(isFullRefreshDue(NOW - 59_000, NOW)).toBe(false)
    expect(isFullRefreshDue(NOW - 60_000, NOW)).toBe(true)
  })
})

type Fakes = {
  deps: RefresherDeps
  state: StateView
  calls: string[]
  toasts: string[]
  writes: StatePatch[]
  setNow(ms: number): void
  setLocation(location: RepoLocation | null): void
  setFetch(next: () => Promise<FetchedPullRequest>): void
  setFast(next: Partial<FastCheckResult>): void
  setResolve(next: () => AccountChoice | AccountFailure): void
  setPaneOpen(isOpen: boolean): void
  gate(): { release(): void }
}

const account: AccountChoice = { login: 'me', source: 'active' }

function fakes(overrides: { toasts?: boolean } = {}): Fakes {
  let nowMs = NOW
  let location: RepoLocation | null = makeLocation()
  let isPaneOpen = false
  let fast: FastCheckResult = { isChanged: false, etags: { a: '"1"' }, isFailed: false }
  let resolve: () => AccountChoice | AccountFailure = () => account
  let fetchNext: () => Promise<FetchedPullRequest> = async () => ({ kind: 'ok', pr: makePr(), rateLimit: OK_RATE })
  let pending: Promise<void> | null = null
  const state: StateView = { snapshot: { kind: 'loading', at: '' }, jobs: [], etags: {} }
  const calls: string[] = []
  const toasts: string[] = []
  const writes: StatePatch[] = []
  const deps: RefresherDeps = {
    config: { ...config, toasts: overrides.toasts ?? true },
    readCwd: async () => '/work/app',
    readLocation: async () => location,
    resolveAccount: async () => {
      calls.push('resolve')
      return resolve()
    },
    fetchPullRequest: async () => {
      calls.push('fetch')
      if (pending !== null) await pending
      return fetchNext()
    },
    fastCheck: async () => {
      calls.push('fast')
      return fast
    },
    fetchJobs: async (_location, _login, runIds) => {
      calls.push(`jobs ${runIds.join(',')}`)
      return runIds.map<JobDetail>(runId => ({ jobId: runId * 10, runId, name: 'build', state: 'running', currentStep: 'test', failedStep: null, url: null }))
    },
    isPaneOpen: async () => isPaneOpen,
    readState: async () => ({ snapshot: state.snapshot, jobs: state.jobs, etags: state.etags }),
    writeState: async patch => {
      writes.push(patch)
      if (patch.snapshot !== undefined) state.snapshot = patch.snapshot
      if (patch.jobs !== undefined) state.jobs = patch.jobs
      if (patch.etags !== undefined) state.etags = patch.etags
    },
    now: async () => nowMs,
    toast: text => void toasts.push(text),
  }
  return {
    deps,
    state,
    calls,
    toasts,
    writes,
    setNow: ms => void (nowMs = ms),
    setLocation: next => void (location = next),
    setFetch: next => void (fetchNext = next),
    setFast: next => void (fast = { ...fast, ...next }),
    setResolve: next => void (resolve = next),
    setPaneOpen: next => void (isPaneOpen = next),
    gate: () => {
      let release = () => {}
      pending = new Promise<void>(done => void (release = done))
      return { release }
    },
  }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}
const fetchOf = (pr: ReturnType<typeof makePr> | null, rateLimit: RateLimit | null = OK_RATE): (() => Promise<FetchedPullRequest>) => async () => ({ kind: 'ok', pr, rateLimit })
const failWith = (kind: 'network' | 'timeout' | 'rate-limited' | 'not-found' | 'auth' | 'failed' | 'gh-missing', message = `${kind} failure`): (() => Promise<FetchedPullRequest>) => async () => ({
  kind: 'error',
  failure: { isOk: false, kind, exitCode: 1, message, stdout: '' },
})

describe('createRefresher: location kinds', () => {
  test('not a repository', async () => {
    const world = fakes()
    world.setLocation(null)
    await createRefresher(world.deps).refresh('start')
    expect(world.state.snapshot.kind).toBe('not-a-repo')
    expect(world.calls).toEqual([])
  })

  test('no GitHub remote, then detached HEAD', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    world.setLocation(makeLocation({ owner: null, repo: null }))
    await refresher.refresh('cwd')
    expect(world.state.snapshot.kind).toBe('no-github-remote')
    world.setLocation(makeLocation({ branch: null }))
    await refresher.refresh('cwd')
    expect(world.state.snapshot.kind).toBe('detached')
    expect(world.calls).toEqual([])
  })

  test('no account is a snapshot, not an error, and is asked again next time', async () => {
    const world = fakes()
    world.setResolve(() => ({ kind: 'not-logged-in', tried: [] }))
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    expect(world.state.snapshot.kind).toBe('no-account')
    await refresher.refresh('timer')
    expect(world.calls.filter(call => call === 'resolve')).toHaveLength(2)
  })
})

describe('createRefresher: pull request', () => {
  test('a full fetch writes the snapshot, rate limit and etags', async () => {
    const world = fakes()
    await createRefresher(world.deps).refresh('start')
    const snapshot = world.state.snapshot
    expect(snapshot.kind).toBe('pr')
    expect(world.writes.some(patch => patch.rateLimit?.remaining === 4000)).toBe(true)
    expect(world.state.etags).toEqual({ a: '"1"' })
    expect(world.calls).toEqual(['resolve', 'fetch', 'fast'])
  })

  test('no pull request', async () => {
    const world = fakes()
    world.setFetch(fetchOf(null))
    await createRefresher(world.deps).refresh('start')
    expect(world.state.snapshot.kind).toBe('no-pr')
    expect(world.state.etags).toEqual({})
  })

  test('the account is resolved once per repository, case insensitive', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    await refresher.refresh('push')
    world.setLocation(makeLocation({ owner: 'ACME', repo: 'App', branch: 'other' }))
    await refresher.refresh('cwd')
    expect(world.calls.filter(call => call === 'resolve')).toHaveLength(1)
    world.setLocation(makeLocation({ owner: 'acme', repo: 'other-repo' }))
    await refresher.refresh('cwd')
    expect(world.calls.filter(call => call === 'resolve')).toHaveLength(2)
  })

  test('the account is resolved again after not-found or auth', async () => {
    for (const kind of ['not-found', 'auth'] as const) {
      const world = fakes()
      const refresher = createRefresher(world.deps)
      await refresher.refresh('start')
      world.setFetch(failWith(kind))
      await refresher.refresh('push')
      expect(world.state.snapshot.kind).toBe('error')
      world.setFetch(fetchOf(makePr()))
      await refresher.refresh('push')
      expect(world.calls.filter(call => call === 'resolve')).toHaveLength(2)
      expect(world.state.snapshot.kind).toBe('pr')
    }
  })
})

describe('createRefresher: fast check path', () => {
  test('a timer after a full fetch checks first and skips the fetch when nothing changed', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.calls.length = 0
    world.setNow(NOW + 10_000)
    await refresher.refresh('timer')
    expect(world.calls).toEqual(['fast'])
    expect(world.state.snapshot.kind).toBe('pr')
    expect(world.state.snapshot.at).toBe(new Date(NOW + 10_000).toISOString())
  })

  test('a changed fast check triggers a full fetch', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.calls.length = 0
    world.setNow(NOW + 10_000)
    world.setFast({ isChanged: true })
    await refresher.refresh('timer')
    expect(world.calls).toEqual(['fast', 'fetch'])
  })

  test('a failed fast check falls through to a full fetch', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.calls.length = 0
    world.setFast({ isFailed: true })
    await refresher.refresh('timer')
    expect(world.calls).toEqual(['fast', 'fetch'])
  })

  test('a full refresh is forced after a minute', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.calls.length = 0
    world.setNow(NOW + 61_000)
    await refresher.refresh('timer')
    expect(world.calls).toEqual(['fetch', 'fast'])
  })

  test('every reason but timer forces a full fetch', async () => {
    for (const reason of ['start', 'push', 'turn', 'cwd', 'command'] as const) {
      const world = fakes()
      const refresher = createRefresher(world.deps)
      await refresher.refresh('start')
      world.calls.length = 0
      world.setNow(NOW + 5000)
      await refresher.refresh(reason)
      expect(world.calls[0]).toBe('fetch')
    }
  })

  test('a merged pull request is not fast checked', async () => {
    const world = fakes()
    world.setFetch(fetchOf(makePr({ state: 'merged' })))
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    expect(world.calls).toEqual(['resolve', 'fetch'])
    world.calls.length = 0
    world.setNow(NOW + 5000)
    await refresher.refresh('timer')
    expect(world.calls).toEqual(['fetch'])
  })
})

describe('createRefresher: failures', () => {
  test('a transient error keeps the last pull request visible', async () => {
    for (const kind of ['network', 'timeout', 'rate-limited'] as const) {
      const world = fakes()
      const refresher = createRefresher(world.deps)
      await refresher.refresh('start')
      const before = world.state.snapshot
      world.setFetch(failWith(kind))
      await refresher.refresh('push')
      expect(world.state.snapshot).toBe(before)
    }
  })

  test('a rate limit failure raises the delay by recording an empty budget', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.setFetch(failWith('rate-limited'))
    await refresher.refresh('push')
    expect(world.writes.at(-1)?.rateLimit?.remaining).toBe(0)
  })

  test('a transient error without an earlier pull request is an error snapshot', async () => {
    const world = fakes()
    world.setFetch(failWith('network', 'could not connect'))
    await createRefresher(world.deps).refresh('start')
    expect(world.state.snapshot).toMatchObject({ kind: 'error', message: 'could not connect' })
  })

  test('a lasting error replaces the pull request', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.setFetch(failWith('failed', 'GraphQL: boom'))
    await refresher.refresh('push')
    expect(world.state.snapshot).toMatchObject({ kind: 'error', message: 'GraphQL: boom' })
  })

  test('a throwing dependency never rejects', async () => {
    const world = fakes()
    world.deps.readLocation = async () => {
      throw new Error('git exploded')
    }
    await createRefresher(world.deps).refresh('start')
    expect(world.state.snapshot).toMatchObject({ kind: 'error', message: 'git exploded' })
  })
})

describe('createRefresher: jobs', () => {
  const running = makePr({ checks: [makeCheck({ state: 'running', runId: 7 }), makeCheck({ name: 'lint', state: 'failure', runId: 8 }), makeCheck({ name: 'ok', state: 'success', runId: 9 })] })

  test('fetched for running and failed runs while the pane is open', async () => {
    const world = fakes()
    world.setFetch(fetchOf(running))
    world.setPaneOpen(true)
    await createRefresher(world.deps).refresh('start')
    expect(world.calls).toContain('jobs 7,8')
    expect(world.state.jobs.map(job => job.runId)).toEqual([7, 8])
  })

  test('not fetched while the pane is closed, and cleared once it closes', async () => {
    const world = fakes()
    world.setFetch(fetchOf(running))
    world.setPaneOpen(true)
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    world.setPaneOpen(false)
    world.calls.length = 0
    await refresher.refresh('push')
    expect(world.calls.some(call => call.startsWith('jobs'))).toBe(false)
    expect(world.state.jobs).toEqual([])
  })
})

describe('createRefresher: toasts', () => {
  const before = makePr({ checks: [makeCheck({ state: 'running' })] })
  const after = makePr({ checks: [makeCheck({ state: 'failure' })] })

  test('a pipeline change toasts', async () => {
    const world = fakes()
    world.state.snapshot = makeSnapshot(before)
    world.setFetch(fetchOf(after))
    await createRefresher(world.deps).refresh('push')
    expect(world.toasts).toEqual(['PR #42: 1 check failed'])
  })

  test('no toast when toasts are off', async () => {
    const world = fakes({ toasts: false })
    world.state.snapshot = makeSnapshot(before)
    world.setFetch(fetchOf(after))
    await createRefresher(world.deps).refresh('push')
    expect(world.toasts).toEqual([])
  })

  test('no toast on the first sight of a pull request', async () => {
    const world = fakes()
    world.setFetch(fetchOf(after))
    await createRefresher(world.deps).refresh('start')
    expect(world.toasts).toEqual([])
  })
})

describe('createRefresher: single flight', () => {
  test('concurrent calls coalesce into one in flight and one queued', async () => {
    const world = fakes()
    const gate = world.gate()
    const refresher = createRefresher(world.deps)
    const first = refresher.refresh('start')
    await settle()
    const second = refresher.refresh('timer')
    const third = refresher.refresh('push')
    const fourth = refresher.refresh('timer')
    expect(world.calls.filter(call => call === 'fetch')).toHaveLength(1)
    gate.release()
    await Promise.all([first, second, third, fourth])
    // the in-flight run plus exactly one queued run
    expect(world.calls.filter(call => call === 'fetch')).toHaveLength(2)
  })

  test('a queued timer refresh is upgraded by a later forced reason', async () => {
    const world = fakes()
    const gate = world.gate()
    const refresher = createRefresher(world.deps)
    const first = refresher.refresh('start')
    await settle()
    const queued = refresher.refresh('timer')
    void refresher.refresh('command')
    gate.release()
    await Promise.all([first, queued])
    // forced: the queued run did a full fetch although its first reason was a timer
    expect(world.calls.filter(call => call === 'fetch')).toHaveLength(2)
  })

  test('a call after completion starts a fresh run', async () => {
    const world = fakes()
    const refresher = createRefresher(world.deps)
    await refresher.refresh('start')
    await refresher.refresh('push')
    expect(world.calls.filter(call => call === 'fetch')).toHaveLength(2)
  })
})
