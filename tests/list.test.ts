import { describe, expect, test } from 'claude-code/testing'

import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import { COUNTS_QUERY, LIST_QUERY, REQUESTED_QUERY, checksFrom, fetchCounts, fetchList, groupItems, listDelayMs, normalizeList, paginate, pollDelayMs, requestedNumbersOf } from '../src/list'
import type { ListItem, RepoLocation } from '../src/model'

const location: RepoLocation = { cwd: '/work/app', branch: 'feature', owner: 'acme', repo: 'app', pinnedLogin: null }

type Counts = { state: string; count: number }[]

function node(number: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `PR_${number}`,
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    createdAt: '2026-10-01T10:00:00Z',
    author: { login: 'anna' },
    labels: { nodes: [{ name: 'risk:R3', color: 'd93f0b' }] },
    reviewDecision: null,
    reviewRequests: { nodes: [] },
    comments: { totalCount: 2 },
    commits: { nodes: [{ commit: { statusCheckRollup: rollup([{ state: 'SUCCESS', count: 4 }], []) } }] },
    ...extra,
  }
}

function rollup(runs: Counts, statuses: Counts): Record<string, unknown> {
  return { state: 'SUCCESS', contexts: { checkRunCountsByState: runs, statusContextCountsByState: statuses } }
}

function answer(nodes: Record<string, unknown>[], issueCount = nodes.length): unknown {
  return { data: { search: { issueCount, nodes }, rateLimit: { cost: 3, remaining: 4870, resetAt: '2026-10-12T16:00:00Z' } } }
}

function user(login: string): Record<string, unknown> {
  return { requestedReviewer: { __typename: 'User', login } }
}

function team(slug: string): Record<string, unknown> {
  return { requestedReviewer: { __typename: 'Team', slug } }
}

function item(number: number, extra: Partial<ListItem> = {}): ListItem {
  return {
    id: `PR_${number}`,
    number,
    title: `Change ${number}`,
    url: '',
    isDraft: false,
    author: 'anna',
    createdAt: '2026-10-01T10:00:00Z',
    labels: [],
    reviewDecision: null,
    requestedFromViewer: false,
    hasOtherRequests: false,
    checks: null,
    comments: 0,
    ...extra,
  }
}

describe('queries', () => {
  test('are read-only GraphQL with the variables the fetch supplies', () => {
    for (const query of [LIST_QUERY, REQUESTED_QUERY, COUNTS_QUERY]) {
      expect(query.startsWith('query(')).toBe(true)
      expect(query.includes('mutation')).toBe(false)
    }
    expect(LIST_QUERY).toContain('search(query: $q, type: ISSUE, first: 100)')
    expect(LIST_QUERY).toContain('checkRunCountsByState')
    expect(LIST_QUERY).toContain('rateLimit { cost remaining resetAt }')
    expect(REQUESTED_QUERY).toContain('$q')
    expect(COUNTS_QUERY).toContain('$yours')
    expect(COUNTS_QUERY).toContain('$requested')
    expect(COUNTS_QUERY).toContain('first: 0')
  })
})

describe('checksFrom', () => {
  test('success is passed, skipped counts only toward the total', () => {
    const checks = checksFrom(rollup([{ state: 'SUCCESS', count: 2 }, { state: 'SKIPPED', count: 12 }, { state: 'NEUTRAL', count: 1 }], []))
    expect(checks).toEqual({ passed: 2, failed: 0, pending: 0, total: 15 })
  })

  test('failure, timed out, cancelled, action required and startup failure are failed', () => {
    const states = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']
    const checks = checksFrom(rollup(states.map(state => ({ state, count: 1 })), [{ state: 'ERROR', count: 2 }]))
    expect(checks).toEqual({ passed: 0, failed: 7, pending: 0, total: 7 })
  })

  test('queued, in progress, pending, waiting, requested and expected are pending', () => {
    const states = ['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED']
    const checks = checksFrom(rollup(states.map(state => ({ state, count: 1 })), [{ state: 'EXPECTED', count: 3 }, { state: 'PENDING', count: 1 }]))
    expect(checks).toEqual({ passed: 0, failed: 0, pending: 9, total: 9 })
  })

  test('check runs and commit statuses are summed', () => {
    const checks = checksFrom(rollup([{ state: 'SUCCESS', count: 3 }, { state: 'FAILURE', count: 1 }], [{ state: 'SUCCESS', count: 2 }, { state: 'PENDING', count: 1 }]))
    expect(checks).toEqual({ passed: 5, failed: 1, pending: 1, total: 7 })
  })

  test('zero counts, stale and completed only add what is counted', () => {
    const checks = checksFrom(rollup([{ state: 'STALE', count: 1 }, { state: 'COMPLETED', count: 0 }, { state: 'SUCCESS', count: 0 }], []))
    expect(checks).toEqual({ passed: 0, failed: 0, pending: 0, total: 1 })
  })

  test('no rollup and malformed rollups give null or zeros, never throw', () => {
    expect(checksFrom(null)).toBeNull()
    expect(checksFrom({ state: 'SUCCESS' })).toBeNull()
    expect(checksFrom({ contexts: {} })).toEqual({ passed: 0, failed: 0, pending: 0, total: 0 })
    expect(checksFrom({ contexts: { checkRunCountsByState: [null, 4, { state: 'SUCCESS', count: 'x' }, { count: 1 }] } })).toEqual({ passed: 0, failed: 0, pending: 0, total: 1 })
  })
})

describe('normalizeList', () => {
  test('maps a pull request to a list item', () => {
    const raw = answer([node(7, { isDraft: true, reviewDecision: 'APPROVED', labels: { nodes: [{ name: 'risk:R3', color: 'd93f0b' }, { name: 'area:ui', color: '0e8a16' }] } })])
    const { items, total, isTruncated } = normalizeList(raw, new Set(), 'me')
    expect(total).toBe(1)
    expect(isTruncated).toBe(false)
    expect(items[0]).toEqual({
      id: 'PR_7',
      number: 7,
      title: 'Change 7',
      url: 'https://github.com/acme/app/pull/7',
      isDraft: true,
      author: 'anna',
      createdAt: '2026-10-01T10:00:00Z',
      labels: [{ name: 'risk:R3', color: 'd93f0b' }, { name: 'area:ui', color: '0e8a16' }],
      reviewDecision: 'approved',
      requestedFromViewer: false,
      hasOtherRequests: false,
      checks: { passed: 4, failed: 0, pending: 0, total: 4 },
      comments: 2,
    })
  })

  test('maps every review decision, and none to null', () => {
    const decisions = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', null, 'SOMETHING_NEW']
    const raw = answer(decisions.map((decision, at) => node(at + 1, { reviewDecision: decision })))
    const mapped = normalizeList(raw, new Set(), 'me').items.map(entry => entry.reviewDecision)
    expect(mapped).toEqual(['approved', 'changes-requested', 'review-required', null, null])
  })

  test('requestedFromViewer comes from the requested numbers', () => {
    const { items } = normalizeList(answer([node(1), node(2)]), new Set([2]), 'me')
    expect(items.map(entry => entry.requestedFromViewer)).toEqual([false, true])
  })

  test('a request from the viewer is not another request, a request from someone else is', () => {
    const raw = answer([
      node(1, { reviewRequests: { nodes: [user('me')] } }),
      node(2, { reviewRequests: { nodes: [user('Me')] } }),
      node(3, { reviewRequests: { nodes: [user('me'), user('anna')] } }),
      node(4, { reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'Bot', login: 'ci-bot' } }] } }),
      node(5),
    ])
    const flags = normalizeList(raw, new Set([1, 2, 3]), 'me').items.map(entry => entry.hasOtherRequests)
    expect(flags).toEqual([false, false, true, true, false])
  })

  test('a team is another request, unless the viewer is requested through it', () => {
    const raw = answer([node(1, { reviewRequests: { nodes: [team('core')] } }), node(2, { reviewRequests: { nodes: [team('core')] } })])
    const flags = normalizeList(raw, new Set([2]), 'me').items.map(entry => entry.hasOtherRequests)
    expect(flags).toEqual([true, false])
  })

  test('a request with a hidden reviewer is another request', () => {
    const raw = answer([node(1, { reviewRequests: { nodes: [{ requestedReviewer: null }] } })])
    expect(normalizeList(raw, new Set(), 'me').items[0]?.hasOtherRequests).toBe(true)
  })

  test('no rollup gives null checks', () => {
    const raw = answer([node(1, { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }), node(2, { commits: { nodes: [] } })])
    expect(normalizeList(raw, new Set(), 'me').items.map(entry => entry.checks)).toEqual([null, null])
  })

  test('a deleted author is null, missing scalars fall back', () => {
    const raw = answer([{ id: 'PR_9', number: 9, author: null }])
    const [first] = normalizeList(raw, new Set(), 'me').items
    expect(first?.author).toBeNull()
    expect(first?.title).toBe('')
    expect(first?.labels).toEqual([])
    expect(first?.comments).toBe(0)
    expect(first?.isDraft).toBe(false)
  })

  test('drops search hits that are not pull requests', () => {
    const raw = answer([{}, node(3), { id: 'x' }])
    expect(normalizeList(raw, new Set(), 'me').items.map(entry => entry.number)).toEqual([3])
  })

  test('truncated above 100', () => {
    const exact = normalizeList(answer([node(1)], 100), new Set(), 'me')
    expect(exact.isTruncated).toBe(false)
    const over = normalizeList(answer([node(1)], 101), new Set(), 'me')
    expect(over.total).toBe(101)
    expect(over.isTruncated).toBe(true)
  })

  test('garbage in, empty list out', () => {
    for (const raw of [null, undefined, 4, 'x', [], {}, { data: null }, { data: { search: null } }]) {
      expect(normalizeList(raw, new Set(), 'me')).toEqual({ items: [], total: 0, isTruncated: false })
    }
  })
})

describe('requestedNumbersOf', () => {
  test('reads the numbers and ignores malformed nodes', () => {
    const raw = { data: { search: { issueCount: 3, nodes: [{ number: 4 }, {}, null, { number: 9 }] } } }
    expect([...requestedNumbersOf(raw)]).toEqual([4, 9])
    expect(requestedNumbersOf(null).size).toBe(0)
  })
})

describe('groupItems', () => {
  test('splits into yours, requested, waiting and other', () => {
    const items = [
      item(1, { author: 'me' }),
      item(2, { requestedFromViewer: true }),
      item(3, { hasOtherRequests: true }),
      item(4),
    ]
    const groups = groupItems(items, 'me')
    expect(groups.yours.map(entry => entry.number)).toEqual([1])
    expect(groups.requested.map(entry => entry.number)).toEqual([2])
    expect(groups.waiting.map(entry => entry.number)).toEqual([3])
    expect(groups.other.map(entry => entry.number)).toEqual([4])
  })

  test('the author is matched case-insensitively', () => {
    expect(groupItems([item(1, { author: 'ME' })], 'me').yours).toHaveLength(1)
  })

  test('an own pull request with a review request stays yours', () => {
    const own = item(1, { author: 'me', requestedFromViewer: true, hasOtherRequests: true })
    const groups = groupItems([own], 'me')
    expect(groups.yours).toHaveLength(1)
    expect(groups.requested).toHaveLength(0)
    expect(groups.waiting).toHaveLength(0)
  })

  test('a team request that includes the viewer is requested, not waiting', () => {
    const raw = answer([node(1, { reviewRequests: { nodes: [team('core')] } })])
    const { items } = normalizeList(raw, new Set([1]), 'me')
    const groups = groupItems(items, 'me')
    expect(groups.requested).toHaveLength(1)
    expect(groups.waiting).toHaveLength(0)
  })

  test('a team request without the viewer is waiting', () => {
    const raw = answer([node(1, { reviewRequests: { nodes: [team('core')] } })])
    const { items } = normalizeList(raw, new Set(), 'me')
    expect(groupItems(items, 'me').waiting).toHaveLength(1)
  })

  test('requested and also requested from others is requested, not waiting', () => {
    const groups = groupItems([item(1, { requestedFromViewer: true, hasOtherRequests: true })], 'me')
    expect(groups.requested).toHaveLength(1)
    expect(groups.waiting).toHaveLength(0)
  })

  test('a deleted author is never yours', () => {
    expect(groupItems([item(1, { author: null })], 'me').other).toHaveLength(1)
  })

  test('each group is newest first', () => {
    const items = [
      item(1, { createdAt: '2026-10-01T10:00:00Z' }),
      item(2, { createdAt: '2026-10-03T10:00:00Z' }),
      item(3, { createdAt: '2026-10-02T10:00:00Z' }),
    ]
    expect(groupItems(items, 'me').other.map(entry => entry.number)).toEqual([2, 3, 1])
  })
})

describe('paginate', () => {
  function crowd(): Record<'yours' | 'requested' | 'waiting' | 'other', ListItem[]> {
    const yours = [1, 2, 3].map(number => item(number, { author: 'me' }))
    const other = Array.from({ length: 30 }, (_, at) => item(100 + at))
    return { yours, requested: [], waiting: [], other }
  }

  test('pages across a group boundary', () => {
    const first = paginate(crowd(), 1, 25, false)
    expect(first.pageCount).toBe(2)
    expect(first.rows).toHaveLength(25)
    expect(first.rows.slice(0, 3).map(row => row.group)).toEqual(['yours', 'yours', 'yours'])
    expect(first.rows[3]?.group).toBe('other')
    expect([first.first, first.last, first.total]).toEqual([1, 25, 33])
    const second = paginate(crowd(), 2, 25, false)
    expect(second.rows).toHaveLength(8)
    expect(second.rows.every(row => row.group === 'other')).toBe(true)
    expect([second.first, second.last]).toEqual([26, 33])
  })

  test('orders groups yours, requested, waiting, other', () => {
    const grouped = { yours: [item(1)], requested: [item(2)], waiting: [item(3)], other: [item(4)] }
    expect(paginate(grouped, 1, 25, false).rows.map(row => row.group)).toEqual(['yours', 'requested', 'waiting', 'other'])
  })

  test('defaults the page size to 25', () => {
    expect(paginate(crowd(), 1, undefined, false).rows).toHaveLength(25)
  })

  test('hideDrafts filters before paging', () => {
    const grouped = crowd()
    grouped.other = grouped.other.map((entry, at) => (at < 10 ? { ...entry, isDraft: true } : entry))
    const hidden = paginate(grouped, 1, 25, true)
    expect(hidden.total).toBe(23)
    expect(hidden.pageCount).toBe(1)
    expect(hidden.rows.some(row => row.item.isDraft)).toBe(false)
    expect(paginate(grouped, 1, 25, false).total).toBe(33)
  })

  test('clamps the page', () => {
    expect(paginate(crowd(), 99, 25, false).page).toBe(2)
    expect(paginate(crowd(), 0, 25, false).page).toBe(1)
    expect(paginate(crowd(), -3, 25, false).page).toBe(1)
    expect(paginate(crowd(), Number.NaN, 25, false).page).toBe(1)
  })

  test('an empty list is one empty page', () => {
    const page = paginate({ yours: [], requested: [], waiting: [], other: [] }, 4, 25, false)
    expect(page).toEqual({ rows: [], page: 1, pageCount: 1, first: 0, last: 0, total: 0 })
  })
})

type Call = { argv: readonly string[] }

/** Answers by the query a call carries, so the order of a parallel pair does not matter. */
function fakeExec(answers: { match: string; stdout: string; exitCode?: number; stderr?: string }[]): { exec: Exec; calls: Call[] } {
  const calls: Call[] = []
  const exec: Exec = async argv => {
    calls.push({ argv })
    if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const query = argv.find(arg => arg.startsWith('query=')) ?? ''
    const found = answers.find(entry => query.includes(entry.match))
    const hit = found ?? { match: '', stdout: '', exitCode: 1, stderr: 'no answer' }
    return { exitCode: hit.exitCode ?? 0, stdout: hit.stdout, stderr: hit.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { exec, calls }
}

const LIST_MATCH = 'checkRunCountsByState'
const REQUESTED_MATCH = 'nodes { ... on PullRequest { number } }'

describe('fetchList', () => {
  test('runs both queries as the login with -f variables and groups by that viewer', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify(answer([node(1, { author: { login: 'me' } }), node(2)])) },
      { match: REQUESTED_MATCH, stdout: JSON.stringify({ data: { search: { issueCount: 1, nodes: [{ number: 2 }] } } }) },
    ])
    const result = await fetchList(exec, location, 'me')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.items.map(entry => [entry.number, entry.requestedFromViewer])).toEqual([[1, false], [2, true]])
    expect(result.total).toBe(2)
    expect(result.isTruncated).toBe(false)
    expect(result.rateLimit).toEqual({ remaining: 4870, resetAt: '2026-10-12T16:00:00Z' })
    const graphql = calls.filter(call => call.argv[1] === 'api')
    expect(graphql).toHaveLength(2)
    expect(calls.filter(call => call.argv[1] === 'auth').every(call => call.argv.includes('me'))).toBe(true)
    const queries = graphql.map(call => call.argv.find(arg => arg.startsWith('q=')))
    expect(queries).toContain('q=repo:acme/app is:pr is:open sort:created-desc')
    expect(queries).toContain('q=repo:acme/app is:pr is:open review-requested:@me')
    for (const call of graphql) {
      expect(call.argv).not.toContain('-F')
      const at = call.argv.findIndex(arg => arg.startsWith('q='))
      expect(call.argv[at - 1]).toBe('-f')
    }
  })

  test('flags a repository with more than 100 open pull requests', async () => {
    forgetTokens()
    const { exec } = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify(answer([node(1)], 140)) },
      { match: REQUESTED_MATCH, stdout: JSON.stringify({ data: { search: { issueCount: 0, nodes: [] } } }) },
    ])
    const result = await fetchList(exec, location, 'me')
    expect(result.kind === 'ok' && result.total).toBe(140)
    expect(result.kind === 'ok' && result.isTruncated).toBe(true)
  })

  test('passes a gh failure through', async () => {
    forgetTokens()
    const { exec } = fakeExec([
      { match: LIST_MATCH, stdout: '', exitCode: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/app'. (repository)" },
      { match: REQUESTED_MATCH, stdout: JSON.stringify({ data: { search: { issueCount: 0, nodes: [] } } }) },
    ])
    const result = await fetchList(exec, location, 'me')
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.failure.kind).toBe('not-found')
    expect(result.failure.exitCode).toBe(1)
  })

  test('a failure of the requested query is an error too', async () => {
    forgetTokens()
    const { exec } = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify(answer([node(1)])) },
      { match: REQUESTED_MATCH, stdout: '', exitCode: 1, stderr: 'gh: HTTP 504' },
    ])
    const result = await fetchList(exec, location, 'me')
    expect(result.kind === 'error' && result.failure.kind).toBe('server')
  })

  test('an answer that is not JSON is a server failure', async () => {
    forgetTokens()
    const { exec } = fakeExec([
      { match: LIST_MATCH, stdout: '<html>Unicorn</html>' },
      { match: REQUESTED_MATCH, stdout: JSON.stringify({ data: { search: { issueCount: 0, nodes: [] } } }) },
    ])
    const result = await fetchList(exec, location, 'me')
    expect(result.kind === 'error' && result.failure.kind).toBe('server')
  })

  test('a GraphQL error without data is a failure', async () => {
    forgetTokens()
    const { exec } = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify({ errors: [{ message: 'Field does not exist' }] }) },
      { match: REQUESTED_MATCH, stdout: JSON.stringify({ data: { search: { issueCount: 0, nodes: [] } } }) },
    ])
    const result = await fetchList(exec, location, 'me')
    expect(result.kind === 'error' && result.failure.message).toBe('Field does not exist')
  })

  test('a location without a repository is an error without running gh', async () => {
    const { exec, calls } = fakeExec([])
    const result = await fetchList(exec, { ...location, owner: null }, 'me')
    expect(result.kind).toBe('error')
    expect(calls).toHaveLength(0)
  })
})

describe('fetchCounts', () => {
  test('reads the band numbers in one query', async () => {
    forgetTokens()
    const body = { data: { open: { issueCount: 18 }, yours: { issueCount: 3 }, requested: { issueCount: 5 }, rateLimit: { cost: 1, remaining: 4000, resetAt: '2026-10-12T16:00:00Z' } } }
    const { exec, calls } = fakeExec([{ match: 'first: 0', stdout: JSON.stringify(body) }])
    const result = await fetchCounts(exec, location, 'me', () => '2026-10-12T12:00:00Z')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.counts).toEqual({ open: 18, yours: 3, requested: 5, at: '2026-10-12T12:00:00Z' })
    expect(result.rateLimit?.remaining).toBe(4000)
    const graphql = calls.filter(call => call.argv[1] === 'api')
    expect(graphql).toHaveLength(1)
    expect(graphql[0]?.argv).toContain('yours=repo:acme/app is:pr is:open author:@me')
    expect(graphql[0]?.argv).toContain('requested=repo:acme/app is:pr is:open review-requested:@me')
    expect(graphql[0]?.argv).not.toContain('-F')
  })

  test('missing counts fall back to zero', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ match: 'first: 0', stdout: JSON.stringify({ data: {} }) }])
    const result = await fetchCounts(exec, location, 'me')
    expect(result.kind === 'ok' && [result.counts.yours, result.counts.requested]).toEqual([0, 0])
  })

  test('passes a gh failure through', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ match: 'first: 0', stdout: '', exitCode: 1, stderr: 'gh: HTTP 401: Bad credentials' }])
    const result = await fetchCounts(exec, location, 'me')
    expect(result.kind === 'error' && result.failure.kind).toBe('auth')
  })
})

describe('the poll delay', () => {
  test('a low rate limit (under 500 left) keeps the list poll at five minutes at least', () => {
    expect(listDelayMs(null, null)).toBe(60_000)
    expect(listDelayMs(null, { remaining: 4000, resetAt: '2026-01-01T00:00:00Z' })).toBe(60_000)
    expect(listDelayMs(null, { remaining: 499, resetAt: '2026-01-01T00:00:00Z' })).toBe(300_000)
    expect(pollDelayMs(15_000, { remaining: 0, resetAt: '2026-01-01T00:00:00Z' })).toBe(300_000)
    expect(pollDelayMs(900_000, { remaining: 0, resetAt: '2026-01-01T00:00:00Z' })).toBe(900_000)
  })
})
