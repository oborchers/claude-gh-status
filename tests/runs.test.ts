import { describe, expect, test } from 'claude-code/testing'

import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import { PAGE_SIZE } from '../src/list'
import type { JobDetail, RepoLocation, RunItem, RunList, RunSnapshot } from '../src/model'
import type { FetchedRuns } from '../src/runs'
import {
  MAIN_STATUS_POLL_MS,
  RUN_POLL_MS,
  fetchMainStatus,
  fetchRun,
  fetchRuns,
  lastRunPage,
  mainStatusOf,
  newestPerWorkflow,
  normalizeRun,
  paginateRuns,
  runAfter,
  runDelayMs,
  runRowCount,
  runsAfter,
  runsProblemOf,
} from '../src/runs'

const location: RepoLocation = { cwd: '/work/app', branch: 'feature', owner: 'acme', repo: 'app', pinnedLogin: null }
const account = { login: 'me', source: 'active' } as const
const AT = '2026-10-12T12:00:00Z'

function raw(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: 'CI',
    workflow_id: 1,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: `sha${id}`,
    run_number: id,
    run_attempt: 1,
    actor: { login: 'anna' },
    created_at: '2026-10-01T10:00:00Z',
    run_started_at: '2026-10-01T10:00:05Z',
    updated_at: '2026-10-01T10:05:00Z',
    html_url: `https://github.com/acme/app/actions/runs/${id}`,
    ...extra,
  }
}

function run(id: number, extra: Partial<RunItem> = {}): RunItem {
  return {
    id,
    runNumber: id,
    workflowId: 1,
    name: 'CI',
    branch: 'main',
    event: 'push',
    actor: 'anna',
    state: 'success',
    headSha: `sha${id}`,
    createdAt: '2026-10-01T10:00:00Z',
    startedAt: null,
    updatedAt: '2026-10-01T10:05:00Z',
    url: `https://github.com/acme/app/actions/runs/${id}`,
    attempt: 1,
    ...extra,
  }
}

describe('normalizeRun', () => {
  test('reads every field of a run', () => {
    expect(normalizeRun(raw(7, { run_attempt: 2 }))).toEqual({
      id: 7,
      runNumber: 7,
      workflowId: 1,
      name: 'CI',
      branch: 'main',
      event: 'push',
      actor: 'anna',
      state: 'success',
      headSha: 'sha7',
      createdAt: '2026-10-01T10:00:00Z',
      startedAt: '2026-10-01T10:00:05Z',
      updatedAt: '2026-10-01T10:05:00Z',
      url: 'https://github.com/acme/app/actions/runs/7',
      attempt: 2,
    })
  })

  test('maps every status', () => {
    for (const status of ['queued', 'waiting', 'requested', 'pending']) {
      expect(normalizeRun(raw(1, { status, conclusion: null }))?.state).toBe('queued')
    }
    expect(normalizeRun(raw(1, { status: 'in_progress', conclusion: null }))?.state).toBe('running')
  })

  test('maps every conclusion of a completed run', () => {
    const expected: Record<string, string> = {
      success: 'success',
      failure: 'failure',
      cancelled: 'cancelled',
      skipped: 'skipped',
      neutral: 'neutral',
      action_required: 'action-required',
      timed_out: 'timed-out',
      stale: 'stale',
      startup_failure: 'failure',
    }
    for (const [conclusion, state] of Object.entries(expected)) {
      expect(normalizeRun(raw(1, { conclusion }))?.state).toBe(state)
    }
    expect(normalizeRun(raw(1, { conclusion: null }))?.state).toBe('neutral')
    expect(normalizeRun(raw(1, { conclusion: 'something_new' }))?.state).toBe('neutral')
  })

  test('missing optional fields get defaults', () => {
    const item = normalizeRun({ id: 3, name: 'x', workflow_id: 2, status: 'queued', created_at: '2026-10-01T10:00:00Z' })
    expect(item).toMatchObject({ branch: null, actor: null, startedAt: null, event: '', headSha: '', url: '', attempt: 1, runNumber: 0, updatedAt: '2026-10-01T10:00:00Z' })
  })

  test('malformed input is dropped and never throws', () => {
    for (const bad of [undefined, null, 4, 'x', [], {}, { id: 1 }, { id: 1, name: 'x', workflow_id: 1 }, raw(1, { id: '1' }), raw(1, { name: null })]) {
      expect(normalizeRun(bad)).toBeNull()
    }
  })
})

describe('newestPerWorkflow', () => {
  test('keeps the newest run of each workflow, ordered by workflow name', () => {
    const runs = [
      run(1, { workflowId: 2, name: 'Deploy', createdAt: '2026-10-01T10:00:00Z' }),
      run(2, { workflowId: 1, name: 'CI', createdAt: '2026-10-02T10:00:00Z' }),
      run(3, { workflowId: 1, name: 'CI', createdAt: '2026-10-03T10:00:00Z' }),
      run(4, { workflowId: 2, name: 'Deploy', createdAt: '2026-09-30T10:00:00Z' }),
    ]
    expect(newestPerWorkflow(runs).map(item => item.id)).toEqual([3, 1])
  })

  test('the higher id wins a tie on creation time', () => {
    expect(newestPerWorkflow([run(5), run(9), run(7)]).map(item => item.id)).toEqual([9])
  })

  test('an empty list stays empty', () => {
    expect(newestPerWorkflow([])).toEqual([])
  })
})

type Seen = { argv: readonly string[] }

type Reply = { stdout: string; exitCode?: number; stderr?: string }

/** Answers `gh api` by a key made of the path (without repos/acme/app/); unknown paths fail with a 404. */
function apiExec(replies: Record<string, Reply>): { exec: Exec; seen: Seen[] } {
  const seen: Seen[] = []
  const exec: Exec = async argv => {
    if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    seen.push({ argv })
    const path = (argv.find(part => part.startsWith('repos/')) ?? '').replace('repos/acme/app', '') || '/'
    const reply = replies[path] ?? { stdout: '', exitCode: 1, stderr: 'gh: Not Found (HTTP 404)' }
    return { exitCode: reply.exitCode ?? 0, stdout: reply.stdout, stderr: reply.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { exec, seen }
}

const body = (runs: Record<string, unknown>[]): string => JSON.stringify({ total_count: runs.length, workflow_runs: runs })

const MAIN_PATH = '/actions/runs?branch=main&per_page=50'
const BRANCH_PATH = '/actions/runs?branch=feature&per_page=50'
const ANY_PATH = '/actions/runs?per_page=30'

function repliesFor(): Record<string, Reply> {
  return {
    '/': { stdout: 'main\n' },
    [MAIN_PATH]: {
      stdout: body([
        raw(10, { name: 'CI', workflow_id: 1, created_at: '2026-10-05T10:00:00Z' }),
        raw(9, { name: 'CI', workflow_id: 1, created_at: '2026-10-04T10:00:00Z' }),
        raw(8, { name: 'Release', workflow_id: 2, created_at: '2026-10-03T10:00:00Z' }),
      ]),
    },
    [BRANCH_PATH]: { stdout: body([raw(20, { head_branch: 'feature', created_at: '2026-10-06T10:00:00Z' }), raw(19, { head_branch: 'feature', created_at: '2026-10-05T10:00:00Z' })]) },
    [ANY_PATH]: {
      stdout: body([
        raw(30, { head_branch: 'other', created_at: '2026-10-07T10:00:00Z' }),
        raw(20, { head_branch: 'feature', created_at: '2026-10-06T10:00:00Z' }),
        raw(10, { head_branch: 'main', created_at: '2026-10-05T10:00:00Z' }),
        raw(29, { head_branch: null, created_at: '2026-10-04T10:00:00Z' }),
      ]),
    },
  }
}

describe('fetchRuns', () => {
  test('groups the runs and excludes the default and this branch from recent', async () => {
    forgetTokens()
    const { exec, seen } = apiExec(repliesFor())
    const result = await fetchRuns(exec, location, 'me')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.defaultBranch).toBe('main')
    expect(result.main.map(item => item.id)).toEqual([10, 8])
    expect(result.branch.map(item => item.id)).toEqual([20])
    expect(result.recent.map(item => item.id)).toEqual([30, 29])
    expect(seen.map(call => call.argv)).toEqual([
      ['gh', 'api', 'repos/acme/app', '--jq', '.default_branch'],
      ['gh', 'api', 'repos/acme/app/actions/runs?branch=main&per_page=50'],
      ['gh', 'api', 'repos/acme/app/actions/runs?branch=feature&per_page=50'],
      ['gh', 'api', 'repos/acme/app/actions/runs?per_page=30'],
    ])
  })

  test('on the default branch the branch group is empty and not read', async () => {
    forgetTokens()
    const { exec, seen } = apiExec(repliesFor())
    const result = await fetchRuns(exec, { ...location, branch: 'main' }, 'me')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.branch).toEqual([])
    expect(result.recent.map(item => item.id)).toEqual([30, 20, 29])
    expect(seen.some(call => call.argv.join(' ').includes('branch=feature'))).toBe(false)
  })

  test('a detached HEAD has no branch group either', async () => {
    forgetTokens()
    const { exec, seen } = apiExec(repliesFor())
    const result = await fetchRuns(exec, { ...location, branch: null }, 'me')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.branch).toEqual([])
    expect(seen).toHaveLength(3)
  })

  test('recent holds the 20 newest only', async () => {
    forgetTokens()
    const many = Array.from({ length: 30 }, (_, index) => raw(100 + index, { head_branch: 'other', created_at: `2026-10-${String(1 + index).padStart(2, '0')}T10:00:00Z` }))
    const { exec } = apiExec({ ...repliesFor(), [ANY_PATH]: { stdout: body(many) } })
    const result = await fetchRuns(exec, location, 'me')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.recent).toHaveLength(20)
    expect(result.recent[0]?.id).toBe(129)
    expect(result.recent[19]?.id).toBe(110)
  })

  test('a known default branch saves the call that finds it', async () => {
    forgetTokens()
    const { exec, seen } = apiExec(repliesFor())
    await fetchRuns(exec, location, 'me', 'main')
    expect(seen).toHaveLength(3)
    expect(seen[0]?.argv).toEqual(['gh', 'api', 'repos/acme/app/actions/runs?branch=main&per_page=50'])
  })

  test('a branch name is encoded in the path', async () => {
    forgetTokens()
    const { exec, seen } = apiExec({ ...repliesFor(), '/actions/runs?branch=feat%2Fx%20y&per_page=50': { stdout: body([]) } })
    const result = await fetchRuns(exec, { ...location, branch: 'feat/x y' }, 'me')
    expect(result.kind).toBe('ok')
    expect(seen.map(call => call.argv[2])).toContain('repos/acme/app/actions/runs?branch=feat%2Fx%20y&per_page=50')
  })

  test('a failed read is an error with its failure; a bad body is a server error', async () => {
    forgetTokens()
    const failing = apiExec({ ...repliesFor(), [ANY_PATH]: { stdout: '', exitCode: 1, stderr: 'HTTP 502' } })
    const result = await fetchRuns(failing.exec, location, 'me')
    expect(result.kind === 'error' && result.failure.kind).toBe('server')
    const garbled = apiExec({ ...repliesFor(), [MAIN_PATH]: { stdout: '<html>' } })
    const bad = await fetchRuns(garbled.exec, location, 'me')
    expect(bad.kind === 'error' && bad.failure.kind).toBe('server')
  })

  test('an empty default branch name is an unreadable answer', async () => {
    forgetTokens()
    const { exec } = apiExec({ '/': { stdout: '\n' } })
    const result = await fetchRuns(exec, location, 'me')
    expect(result.kind === 'error' && result.failure.kind).toBe('server')
  })

  test('a location without a repository runs nothing', async () => {
    const { exec, seen } = apiExec({})
    const result = await fetchRuns(exec, { ...location, owner: null }, 'me')
    expect(result.kind).toBe('error')
    expect(seen).toEqual([])
  })
})

describe('runsAfter', () => {
  const list = (extra: Partial<Extract<RunList, { kind: 'list' }>> = {}): RunList => ({ kind: 'list', at: AT, location, account, defaultBranch: 'main', main: [run(1)], branch: [], recent: [], problem: null, ...extra })
  const ok: FetchedRuns = { kind: 'ok', defaultBranch: 'main', main: [run(2)], branch: [], recent: [] }
  const fail = (kind: 'server' | 'network' | 'auth' | 'gh-missing', message = 'HTTP 502') => ({ kind: 'error', failure: { isOk: false, kind, exitCode: 1, message, stdout: '' } }) as const

  test('a good read replaces the list and clears the problem', () => {
    const next = runsAfter(list({ problem: { reason: '502', since: AT, triedAt: AT, retryInMs: 15_000 } }), ok, '2026-10-12T12:01:00Z', location, account)
    expect(next).toMatchObject({ kind: 'list', problem: null, main: [{ id: 2 }] })
  })

  test('a transient failure keeps the last list and backs off 15, 30, 60 s', () => {
    const first = runsAfter(list(), fail('server'), '2026-10-12T12:01:00Z', location, account)
    expect(first).toMatchObject({ kind: 'list', main: [{ id: 1 }], problem: { reason: '502', since: '2026-10-12T12:01:00Z', retryInMs: 15_000 } })
    const second = runsAfter(first, fail('network', 'network down'), '2026-10-12T12:02:00Z', location, account)
    expect(runsProblemOf(second)).toEqual({ reason: 'network', since: '2026-10-12T12:01:00Z', triedAt: '2026-10-12T12:02:00Z', retryInMs: 30_000 })
    const third = runsAfter(second, fail('server'), '2026-10-12T12:03:00Z', location, account)
    expect(runsProblemOf(third)?.retryInMs).toBe(60_000)
    expect(runsProblemOf(runsAfter(third, fail('server'), '2026-10-12T12:04:00Z', location, account))?.retryInMs).toBe(60_000)
  })

  test('a transient failure without a list becomes an error that carries the problem', () => {
    const next = runsAfter(null, fail('server'), AT, location, account)
    expect(next).toMatchObject({ kind: 'error', message: 'HTTP 502', problem: { reason: '502' } })
  })

  test('a permanent failure replaces the list with an error', () => {
    expect(runsAfter(list(), fail('auth', 'bad credentials'), AT, location, account)).toEqual({ kind: 'error', at: AT, message: 'bad credentials' })
    expect(runsAfter(list(), fail('gh-missing'), AT, location, account)).toMatchObject({ kind: 'error', message: 'gh is not installed' })
  })

  test('runsProblemOf is null without a list or a problem', () => {
    expect(runsProblemOf(null)).toBeNull()
    expect(runsProblemOf({ kind: 'loading', at: AT })).toBeNull()
    expect(runsProblemOf(list())).toBeNull()
  })
})

describe('paging and rows', () => {
  const runs = (from: number, count: number): RunItem[] => Array.from({ length: count }, (_, index) => run(from + index))
  const list = (main: number, branch: number, recent: number): RunList => ({ kind: 'list', at: AT, location, account, defaultBranch: 'main', main: runs(100, main), branch: runs(200, branch), recent: runs(300, recent), problem: null })

  test('pages across main, branch and recent in order', () => {
    const groups = list(4, 5, 6) as Extract<RunList, { kind: 'list' }>
    const first = paginateRuns(groups, 1)
    expect(first.rows.map(row => row.group)).toEqual(['main', 'main', 'main', 'main', 'branch', 'branch', 'branch', 'branch', 'branch', 'recent'])
    expect(first).toMatchObject({ page: 1, pageCount: 2, first: 1, last: PAGE_SIZE, total: 15 })
    const second = paginateRuns(groups, 2)
    expect(second.rows.map(row => row.item.id)).toEqual([301, 302, 303, 304, 305])
    expect(second).toMatchObject({ first: 11, last: 15 })
  })

  test('the page is clamped and an empty list has one empty page', () => {
    const groups = list(4, 0, 0) as Extract<RunList, { kind: 'list' }>
    expect(paginateRuns(groups, 9).page).toBe(1)
    expect(paginateRuns(groups, -3).page).toBe(1)
    expect(paginateRuns(groups, Number.NaN).page).toBe(1)
    expect(paginateRuns(list(0, 0, 0) as Extract<RunList, { kind: 'list' }>, 1)).toMatchObject({ rows: [], pageCount: 1, first: 0, last: 0, total: 0 })
  })

  test('lastRunPage is zero-based', () => {
    expect(lastRunPage(null)).toBe(0)
    expect(lastRunPage({ kind: 'loading', at: AT })).toBe(0)
    expect(lastRunPage(list(0, 0, 0))).toBe(0)
    expect(lastRunPage(list(10, 0, 0))).toBe(0)
    expect(lastRunPage(list(10, 1, 0))).toBe(1)
    expect(lastRunPage(list(10, 10, 5))).toBe(2)
  })

  test('runRowCount: 3 rows per run, a blank between groups, 4 for chrome, 6 to 40', () => {
    expect(runRowCount(null, 0)).toBe(6)
    expect(runRowCount({ kind: 'error', at: AT, message: 'x' }, 0)).toBe(6)
    expect(runRowCount(list(1, 0, 0), 0)).toBe(7)
    expect(runRowCount(list(2, 1, 0), 0)).toBe(3 * 3 + 1 + 4)
    expect(runRowCount(list(1, 1, 1), 0)).toBe(3 * 3 + 2 + 4)
    expect(runRowCount(list(10, 5, 5), 0)).toBe(10 * 3 + 0 + 4)
    expect(runRowCount(list(10, 5, 5), 1)).toBe(10 * 3 + 1 + 4)
    expect(runRowCount(list(0, 0, 0), 0)).toBe(6)
    expect(runRowCount(list(10, 5, 5), 7)).toBe(runRowCount(list(10, 5, 5), 1))
  })
})

describe('mainStatusOf', () => {
  const status = (runs: RunItem[]) => mainStatusOf(runs, 'main', AT)

  test('no runs has no worst', () => {
    expect(status([])).toEqual({ at: AT, defaultBranch: 'main', worst: null, failing: [] })
  })

  test('only the newest run of a workflow counts', () => {
    const result = status([
      run(1, { workflowId: 1, state: 'failure', createdAt: '2026-10-01T10:00:00Z' }),
      run(2, { workflowId: 1, state: 'success', createdAt: '2026-10-02T10:00:00Z' }),
    ])
    expect(result.worst).toBe('success')
    expect(result.failing).toEqual([])
  })

  test('failure beats running beats queued beats success', () => {
    const base = [run(1, { workflowId: 1, state: 'success' }), run(2, { workflowId: 2, state: 'queued' })]
    expect(status(base).worst).toBe('queued')
    expect(status([...base, run(3, { workflowId: 3, state: 'running' })]).worst).toBe('running')
    expect(status([...base, run(3, { workflowId: 3, state: 'running' }), run(4, { workflowId: 4, state: 'failure' })]).worst).toBe('failure')
  })

  test('failure and timed-out fail; cancelled does not', () => {
    expect(status([run(1, { state: 'cancelled' })]).worst).toBe('neutral')
    expect(status([run(1, { state: 'cancelled' })]).failing).toEqual([])
    const result = status([run(1, { workflowId: 1, state: 'timed-out' }), run(2, { workflowId: 2, state: 'cancelled' }), run(3, { workflowId: 3, state: 'success' })])
    expect(result.worst).toBe('failure')
    expect(result.failing.map(item => item.runId)).toEqual([1])
  })

  test('failing lists the workflows newest first with name, run and url', () => {
    const result = status([
      run(1, { workflowId: 1, name: 'Alpha', state: 'failure', createdAt: '2026-10-01T10:00:00Z' }),
      run(2, { workflowId: 2, name: 'Beta', state: 'timed-out', createdAt: '2026-10-03T10:00:00Z' }),
    ])
    expect(result.failing).toEqual([
      { name: 'Beta', runId: 2, url: 'https://github.com/acme/app/actions/runs/2' },
      { name: 'Alpha', runId: 1, url: 'https://github.com/acme/app/actions/runs/1' },
    ])
  })

  test('skipped and neutral only is neutral', () => {
    expect(status([run(1, { state: 'skipped' })]).worst).toBe('neutral')
  })
})

describe('fetchMainStatus', () => {
  const head = (status: string, etag?: string): string => `HTTP/2.0 ${status}\r\n${etag === undefined ? '' : `Etag: ${etag}\r\n`}X-Ratelimit-Used: 3\r\n\r\n`
  const ok200 = (runs: Record<string, unknown>[], etag = 'W/"aaa"'): string => `${head('200 OK', etag)}${body(runs)}`
  const NOT_MODIFIED = head('304 Not Modified', '"aaa"')

  test('a first read has no If-None-Match and returns the status and the etag', async () => {
    forgetTokens()
    const { exec, seen } = apiExec({ '/': { stdout: 'main\n' }, [MAIN_PATH]: { stdout: ok200([raw(1, { conclusion: 'failure', name: 'CI' })]) } })
    const result = await fetchMainStatus(exec, location, 'me', null, null, () => AT)
    expect(result).toEqual({
      kind: 'ok',
      etag: 'W/"aaa"',
      status: { at: AT, defaultBranch: 'main', worst: 'failure', failing: [{ name: 'CI', runId: 1, url: 'https://github.com/acme/app/actions/runs/1' }] },
    })
    expect(seen.map(call => call.argv)).toEqual([
      ['gh', 'api', 'repos/acme/app', '--jq', '.default_branch'],
      ['gh', 'api', '-i', 'repos/acme/app/actions/runs?branch=main&per_page=50'],
    ])
  })

  test('a stored etag is sent as If-None-Match and a 304 is unchanged', async () => {
    forgetTokens()
    const { exec, seen } = apiExec({ [MAIN_PATH]: { stdout: NOT_MODIFIED, exitCode: 1, stderr: 'gh: HTTP 304\n' } })
    const result = await fetchMainStatus(exec, location, 'me', 'W/"aaa"', 'main')
    expect(result).toEqual({ kind: 'unchanged', etag: 'W/"aaa"' })
    expect(seen.map(call => call.argv)).toEqual([['gh', 'api', '-i', '-H', 'If-None-Match: W/"aaa"', 'repos/acme/app/actions/runs?branch=main&per_page=50']])
  })

  test('a changed answer returns the new etag', async () => {
    forgetTokens()
    const { exec } = apiExec({ [MAIN_PATH]: { stdout: ok200([raw(1)], 'W/"bbb"') } })
    const result = await fetchMainStatus(exec, location, 'me', 'W/"aaa"', 'main', () => AT)
    expect(result).toMatchObject({ kind: 'ok', etag: 'W/"bbb"', status: { worst: 'success' } })
  })

  test('failures: transient, permanent, unreadable', async () => {
    forgetTokens()
    const server = apiExec({ [MAIN_PATH]: { stdout: '', exitCode: 1, stderr: 'HTTP 503' } })
    expect(await fetchMainStatus(server.exec, location, 'me', null, 'main')).toMatchObject({ kind: 'error', failure: { kind: 'server' } })
    const missing = apiExec({})
    expect(await fetchMainStatus(missing.exec, location, 'me', null, 'main')).toMatchObject({ kind: 'error', failure: { kind: 'not-found' } })
    const junk = apiExec({ [MAIN_PATH]: { stdout: `${head('200 OK', 'W/"x"')}not json` } })
    expect(await fetchMainStatus(junk.exec, location, 'me', null, 'main')).toMatchObject({ kind: 'error', failure: { kind: 'server' } })
    const noRepo = apiExec({})
    expect(await fetchMainStatus(noRepo.exec, { ...location, repo: null }, 'me')).toMatchObject({ kind: 'error' })
    expect(noRepo.seen).toEqual([])
  })

  test('polls every five minutes', () => {
    expect(MAIN_STATUS_POLL_MS).toBe(300_000)
  })
})

describe('fetchRun and runAfter', () => {
  const RUN_PATH = '/actions/runs/42'
  const jobsJson = JSON.stringify({ jobs: [{ databaseId: 5, name: 'build', status: 'in_progress', conclusion: '', url: 'https://github.com/acme/app/actions/runs/42/job/5', steps: [{ name: 'Set up', status: 'in_progress', conclusion: '' }] }] })

  /** Serves `gh api` runs and `gh run view` jobs. */
  function runExec(api: Record<string, Reply>, jobs: Reply): { exec: Exec; calls: string[][] } {
    const calls: string[][] = []
    const inner = apiExec(api)
    const exec: Exec = async (argv, init) => {
      if (argv[1] === 'run') {
        calls.push([...argv])
        return { exitCode: jobs.exitCode ?? 0, stdout: jobs.stdout, stderr: jobs.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false }
      }
      calls.push([...argv])
      return inner.exec(argv, init)
    }
    return { exec, calls }
  }

  const loaded = (state: RunItem['state'] = 'running'): RunSnapshot => ({ kind: 'run', at: AT, location, account, run: run(42, { state }), jobs: [], stale: null })
  const fail = (kind: 'server' | 'not-found' | 'auth', message = 'HTTP 502') => ({ kind: 'error', failure: { isOk: false, kind, exitCode: 1, message, stdout: '' } }) as const

  test('reads the run and its jobs', async () => {
    forgetTokens()
    const { exec, calls } = runExec({ [RUN_PATH]: { stdout: JSON.stringify(raw(42, { status: 'in_progress', conclusion: null })) } }, { stdout: jobsJson })
    const fetched = await fetchRun(exec, location, 'me', 42)
    if (fetched.kind !== 'ok') throw new Error('expected ok')
    expect(fetched.run).toMatchObject({ id: 42, state: 'running' })
    expect(fetched.jobs.map((job: JobDetail) => [job.jobId, job.runId, job.currentStep])).toEqual([[5, 42, 'Set up']])
    expect(calls).toContainEqual(['gh', 'api', 'repos/acme/app/actions/runs/42'])
    expect(calls).toContainEqual(['gh', 'run', 'view', '42', '--json', 'jobs', '-R', 'acme/app'])
    const snapshot = runAfter(null, fetched, AT, location, account, 42)
    expect(snapshot).toMatchObject({ kind: 'run', stale: null, run: { id: 42 } })
  })

  test('a 404 names the run and the repository', async () => {
    forgetTokens()
    const { exec } = runExec({}, { stdout: '', exitCode: 1 })
    const fetched = await fetchRun(exec, location, 'me', 42)
    expect(fetched.kind === 'error' && fetched.failure.kind).toBe('not-found')
    expect(runAfter(null, fetched, AT, location, account, 42)).toEqual({ kind: 'error', at: AT, runId: 42, message: 'run 42 not found in acme/app' })
    expect(runAfter(loaded(), fetched, AT, location, account, 42)).toMatchObject({ kind: 'error', message: 'run 42 not found in acme/app' })
  })

  test('a body that is not a run is unreadable', async () => {
    forgetTokens()
    const { exec } = runExec({ [RUN_PATH]: { stdout: '{"message":"x"}' } }, { stdout: '' })
    const fetched = await fetchRun(exec, location, 'me', 42)
    expect(fetched.kind === 'error' && fetched.failure.kind).toBe('server')
  })

  test('a location without a repository runs nothing', async () => {
    const { exec, calls } = runExec({}, { stdout: '' })
    expect((await fetchRun(exec, { ...location, owner: null }, 'me', 42)).kind).toBe('error')
    expect(calls).toEqual([])
  })

  test('a transient failure keeps the last snapshot stale, with backoff', () => {
    const first = runAfter(loaded(), fail('server'), '2026-10-12T12:01:00Z', location, account, 42)
    expect(first).toMatchObject({ kind: 'run', run: { id: 42 }, stale: { reason: '502', since: '2026-10-12T12:01:00Z', retryInMs: 15_000 } })
    const second = runAfter(first, fail('server'), '2026-10-12T12:02:00Z', location, account, 42)
    expect(second).toMatchObject({ stale: { since: '2026-10-12T12:01:00Z', triedAt: '2026-10-12T12:02:00Z', retryInMs: 30_000 } })
    const recovered = runAfter(second, { kind: 'ok', run: run(42, { state: 'success' }), jobs: [] }, AT, location, account, 42)
    expect(recovered).toMatchObject({ kind: 'run', stale: null, run: { state: 'success' } })
  })

  test('a transient failure without a snapshot, or for another run, is an error with the problem', () => {
    expect(runAfter(null, fail('server'), AT, location, account, 42)).toMatchObject({ kind: 'error', runId: 42, problem: { reason: '502' } })
    expect(runAfter(loaded(), fail('server'), AT, location, account, 43)).toMatchObject({ kind: 'error', runId: 43 })
  })

  test('a permanent failure is an error', () => {
    expect(runAfter(loaded(), fail('auth', 'bad credentials'), AT, location, account, 42)).toEqual({ kind: 'error', at: AT, runId: 42, message: 'bad credentials' })
  })

  test('the next read: 15 s while queued or running, 60 s otherwise, the backoff while failing', () => {
    expect(RUN_POLL_MS).toBe(15_000)
    expect(runDelayMs(loaded('running'))).toBe(15_000)
    expect(runDelayMs(loaded('queued'))).toBe(15_000)
    expect(runDelayMs(loaded('success'))).toBe(60_000)
    expect(runDelayMs(null)).toBe(60_000)
    expect(runDelayMs({ kind: 'loading', at: AT, runId: 1 })).toBe(60_000)
    expect(runDelayMs({ kind: 'error', at: AT, runId: 1, message: 'x' })).toBe(60_000)
    const failing = runAfter(loaded('running'), fail('server'), AT, location, account, 42)
    expect(runDelayMs(failing)).toBe(15_000)
    expect(runDelayMs(runAfter(failing, fail('server'), AT, location, account, 42))).toBe(30_000)
  })

  test('a low rate limit raises the delay to five minutes', () => {
    expect(runDelayMs(loaded('running'), { remaining: 100, resetAt: AT })).toBe(300_000)
    expect(runDelayMs(loaded('running'), { remaining: 4000, resetAt: AT })).toBe(15_000)
  })
})
