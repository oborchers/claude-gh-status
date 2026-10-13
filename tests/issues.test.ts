import { describe, expect, test } from 'claude-code/testing'

import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import {
  ISSUE_DETAIL_QUERY,
  ISSUE_LIST_QUERY,
  MENTIONED_QUERY,
  fetchIssue,
  fetchIssues,
  groupIssues,
  issueAfter,
  issueProblemOf,
  issueRowCount,
  issuesAfter,
  issuesProblemOf,
  lastIssuePage,
  mentionedNumbersOf,
  normalizeIssue,
  normalizeIssues,
  paginateIssues,
} from '../src/issues'
import type { FetchedIssue, FetchedIssues } from '../src/issues'
import type { AccountChoice, Issue, IssueItem, IssueList, IssueSnapshot, Problem, RepoLocation } from '../src/model'

const location: RepoLocation = { cwd: '/work/app', branch: 'feature', owner: 'acme', repo: 'app', pinnedLogin: null }
const account: AccountChoice = { login: 'me', source: 'active' }

function node(number: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `I_${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/app/issues/${number}`,
    createdAt: '2026-10-01T10:00:00Z',
    author: { login: 'anna' },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    assignees: { nodes: [] },
    comments: { totalCount: 2 },
    closedByPullRequestsReferences: { nodes: [] },
    ...extra,
  }
}

function answer(nodes: Record<string, unknown>[], issueCount = nodes.length): unknown {
  return { data: { search: { issueCount, nodes }, rateLimit: { cost: 3, remaining: 4870, resetAt: '2026-10-12T16:00:00Z' } } }
}

function item(number: number, extra: Partial<IssueItem> = {}): IssueItem {
  return {
    id: `I_${number}`,
    number,
    title: `Issue ${number}`,
    url: '',
    author: 'anna',
    createdAt: '2026-10-01T10:00:00Z',
    labels: [],
    assignees: [],
    comments: 0,
    linkedPrs: [],
    mentionsViewer: false,
    ...extra,
  }
}

function listOf(items: IssueItem[]): IssueList {
  return { kind: 'list', at: '2026-10-12T12:00:00Z', location, account, items, total: items.length, isTruncated: false }
}

function others(count: number, from = 100): IssueItem[] {
  return Array.from({ length: count }, (_, at) => item(from + at, { createdAt: `2026-09-${String(10 + (at % 18)).padStart(2, '0')}T10:00:00Z` }))
}

describe('queries', () => {
  test('are read-only GraphQL with the variables the fetch supplies', () => {
    for (const query of [ISSUE_LIST_QUERY, MENTIONED_QUERY, ISSUE_DETAIL_QUERY]) {
      expect(query.startsWith('query(')).toBe(true)
      expect(query.includes('mutation')).toBe(false)
    }
    expect(ISSUE_LIST_QUERY).toContain('search(query: $q, type: ISSUE, first: 100)')
    expect(ISSUE_LIST_QUERY).toContain('closedByPullRequestsReferences(first: 3)')
    expect(ISSUE_LIST_QUERY).toContain('rateLimit { cost remaining resetAt }')
    expect(MENTIONED_QUERY).toContain('... on Issue { number }')
    expect(ISSUE_DETAIL_QUERY).toContain('$n: Int!')
    expect(ISSUE_DETAIL_QUERY).toContain('comments(last: 10)')
    expect(ISSUE_DETAIL_QUERY).toContain('includeClosedPrs: true')
  })
})

describe('normalizeIssues', () => {
  test('maps the fields and marks the mentioned ones', () => {
    const raw = answer([
      node(1, {
        assignees: { nodes: [{ login: 'me' }, { login: 'bo' }] },
        closedByPullRequestsReferences: { nodes: [{ number: 40 }, { number: 41 }] },
      }),
      node(2),
    ])
    const result = normalizeIssues(raw, new Set([2]))
    expect(result.items[0]).toEqual({
      id: 'I_1',
      number: 1,
      title: 'Issue 1',
      url: 'https://github.com/acme/app/issues/1',
      author: 'anna',
      createdAt: '2026-10-01T10:00:00Z',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: ['me', 'bo'],
      comments: 2,
      linkedPrs: [40, 41],
      mentionsViewer: false,
    })
    expect(result.items[1]?.mentionsViewer).toBe(true)
    expect(result.total).toBe(2)
    expect(result.isTruncated).toBe(false)
  })

  test('missing fields fall back and a deleted author is null', () => {
    const result = normalizeIssues(answer([{ id: 'I_9', number: 9, author: null }]), new Set())
    expect(result.items).toEqual([
      { id: 'I_9', number: 9, title: '', url: '', author: null, createdAt: '', labels: [], assignees: [], comments: 0, linkedPrs: [], mentionsViewer: false },
    ])
  })

  test('drops malformed nodes, including the empty ones of a search that matched a pull request', () => {
    const result = normalizeIssues(answer([{}, node(1), { id: 'x' }, { number: 3 }, node(4, { labels: { nodes: [{ color: 'fff' }, { name: 'ok' }] } })]), new Set())
    expect(result.items.map(entry => entry.number)).toEqual([1, 4])
    expect(result.items[1]?.labels).toEqual([{ name: 'ok', color: '' }])
  })

  test('survives garbage and flags more than 100 open issues', () => {
    expect(normalizeIssues(null, new Set())).toEqual({ items: [], total: 0, isTruncated: false })
    expect(normalizeIssues({ data: { search: { nodes: 'x' } } }, new Set()).items).toEqual([])
    const big = normalizeIssues(answer([node(1)], 140), new Set())
    expect(big.total).toBe(140)
    expect(big.isTruncated).toBe(true)
  })

  test('mentionedNumbersOf collects the numbers and ignores the rest', () => {
    expect([...mentionedNumbersOf({ data: { search: { nodes: [{ number: 4 }, {}, { number: 'x' }, { number: 7 }] } } })]).toEqual([4, 7])
    expect(mentionedNumbersOf(undefined).size).toBe(0)
  })
})

describe('groupIssues', () => {
  test('first match wins: assigned, then opened, then mentioned, then other', () => {
    const items = [
      item(1, { assignees: ['Me'], author: 'me', mentionsViewer: true }),
      item(2, { author: 'ME', mentionsViewer: true }),
      item(3, { mentionsViewer: true }),
      item(4),
      item(5, { author: null }),
    ]
    const groups = groupIssues(items, 'me')
    expect(groups.assigned.map(entry => entry.number)).toEqual([1])
    expect(groups.opened.map(entry => entry.number)).toEqual([2])
    expect(groups.mentioned.map(entry => entry.number)).toEqual([3])
    expect(groups.other.map(entry => entry.number)).toEqual([4, 5])
  })

  test('an issue assigned to someone else is not assigned', () => {
    expect(groupIssues([item(1, { assignees: ['bo'] })], 'me').other).toHaveLength(1)
  })

  test('sorts each group newest first and tolerates a missing date', () => {
    const groups = groupIssues(
      [item(1, { createdAt: '2026-10-01T00:00:00Z' }), item(2, { createdAt: '2026-10-03T00:00:00Z' }), item(3, { createdAt: '' }), item(4, { createdAt: '2026-10-02T00:00:00Z' })],
      'me',
    )
    expect(groups.other.map(entry => entry.number)).toEqual([2, 4, 1, 3])
  })
})

describe('paginateIssues', () => {
  test('pages across the groups in order and clamps the page', () => {
    const items = [...others(12), item(1, { author: 'me' }), item(2, { assignees: ['me'] })]
    const grouped = groupIssues(items, 'me')
    const first = paginateIssues(grouped, 1)
    expect(first.rows.map(row => row.group).slice(0, 3)).toEqual(['assigned', 'opened', 'other'])
    expect(first.pageCount).toBe(2)
    expect([first.first, first.last, first.total]).toEqual([1, 10, 14])
    const last = paginateIssues(grouped, 99)
    expect([last.page, last.first, last.last, last.rows.length]).toEqual([2, 11, 14, 4])
    expect(paginateIssues(grouped, -3).page).toBe(1)
    expect(paginateIssues(grouped, Number.NaN).page).toBe(1)
  })

  test('an empty list is one empty page', () => {
    const page = paginateIssues(groupIssues([], 'me'), 1)
    expect(page).toEqual({ rows: [], page: 1, pageCount: 1, first: 0, last: 0, total: 0 })
  })
})

describe('issueRowCount and lastIssuePage', () => {
  test('is 6 without a list', () => {
    expect(issueRowCount(null, 0)).toBe(6)
    expect(issueRowCount({ kind: 'loading', at: '' }, 0)).toBe(6)
    expect(lastIssuePage(null)).toBe(0)
  })

  test('counts 3 per issue, a heading per group and 4 of slack', () => {
    // One group of 2: 2 * 3 rows, plus 4.
    expect(issueRowCount(listOf(others(2)), 0)).toBe(6 + 4)
    // Two groups of one: 2 * 3 + 1 between the groups, plus 4.
    expect(issueRowCount(listOf([item(1, { author: 'me' }), item(2)]), 0)).toBe(7 + 4)
  })

  test('follows the page and stays within 40', () => {
    expect(issueRowCount(listOf(others(24)), 2)).toBe(12 + 4)
    const groups = [item(1, { assignees: ['me'] }), item(2, { author: 'me' }), item(3, { mentionsViewer: true }), ...others(7)]
    // Four groups on one page: 10 * 3 + 3, plus 4.
    expect(issueRowCount(listOf(groups), 0)).toBe(37)
    expect(issueRowCount(listOf(others(30)), 0)).toBe(34)
  })

  test('lastIssuePage is the zero-based last page', () => {
    expect(lastIssuePage(listOf(others(10)))).toBe(0)
    expect(lastIssuePage(listOf(others(11)))).toBe(1)
    expect(lastIssuePage(listOf(others(24)))).toBe(2)
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

const LIST_MATCH = 'closedByPullRequestsReferences(first: 3)'
const MENTIONED_MATCH = '... on Issue { number }'
const emptySearch = JSON.stringify({ data: { search: { issueCount: 0, nodes: [] } } })

describe('fetchIssues', () => {
  test('runs both queries as the login with -f variables', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify(answer([node(1), node(2)])) },
      { match: MENTIONED_MATCH, stdout: JSON.stringify({ data: { search: { issueCount: 1, nodes: [{ number: 2 }] } } }) },
    ])
    const result = await fetchIssues(exec, location, 'me')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.items.map(entry => [entry.number, entry.mentionsViewer])).toEqual([[1, false], [2, true]])
    expect(result.rateLimit).toEqual({ remaining: 4870, resetAt: '2026-10-12T16:00:00Z' })
    const graphql = calls.filter(call => call.argv[1] === 'api')
    expect(graphql).toHaveLength(2)
    expect(calls.filter(call => call.argv[1] === 'auth').every(call => call.argv.includes('me'))).toBe(true)
    const queries = graphql.map(call => call.argv.find(arg => arg.startsWith('q=')))
    expect(queries).toContain('q=repo:acme/app is:issue is:open sort:created-desc')
    expect(queries).toContain('q=repo:acme/app is:issue is:open mentions:@me')
    for (const call of graphql) {
      expect(call.argv).not.toContain('-F')
      const at = call.argv.findIndex(arg => arg.startsWith('q='))
      expect(call.argv[at - 1]).toBe('-f')
    }
  })

  test('flags a repository with more than 100 open issues', async () => {
    forgetTokens()
    const { exec } = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify(answer([node(1)], 140)) },
      { match: MENTIONED_MATCH, stdout: emptySearch },
    ])
    const result = await fetchIssues(exec, location, 'me')
    expect(result.kind === 'ok' && [result.total, result.isTruncated]).toEqual([140, true])
  })

  test('passes a gh failure of either query through', async () => {
    forgetTokens()
    const first = fakeExec([
      { match: LIST_MATCH, stdout: '', exitCode: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/app'. (repository)" },
      { match: MENTIONED_MATCH, stdout: emptySearch },
    ])
    const listed = await fetchIssues(first.exec, location, 'me')
    expect(listed.kind === 'error' && listed.failure.kind).toBe('not-found')
    forgetTokens()
    const second = fakeExec([
      { match: LIST_MATCH, stdout: JSON.stringify(answer([node(1)])) },
      { match: MENTIONED_MATCH, stdout: '', exitCode: 1, stderr: 'gh: HTTP 504' },
    ])
    const mentioned = await fetchIssues(second.exec, location, 'me')
    expect(mentioned.kind === 'error' && mentioned.failure.kind).toBe('server')
  })

  test('an answer that is not JSON is a server failure and a GraphQL error is a failure', async () => {
    forgetTokens()
    const html = fakeExec([{ match: LIST_MATCH, stdout: '<html>Unicorn</html>' }, { match: MENTIONED_MATCH, stdout: emptySearch }])
    const broken = await fetchIssues(html.exec, location, 'me')
    expect(broken.kind === 'error' && broken.failure.kind).toBe('server')
    forgetTokens()
    const errors = fakeExec([{ match: LIST_MATCH, stdout: JSON.stringify({ errors: [{ message: 'Field does not exist' }] }) }, { match: MENTIONED_MATCH, stdout: emptySearch }])
    const failed = await fetchIssues(errors.exec, location, 'me')
    expect(failed.kind === 'error' && failed.failure.message).toBe('Field does not exist')
  })

  test('a location without a repository is an error without running gh', async () => {
    const { exec, calls } = fakeExec([])
    const result = await fetchIssues(exec, { ...location, repo: null }, 'me')
    expect(result.kind).toBe('error')
    expect(calls).toHaveLength(0)
  })
})

const NOW = '2026-10-12T12:00:00Z'
const LATER = '2026-10-12T12:01:00Z'

function failure(kind: string, message = 'boom'): FetchedIssues & FetchedIssue {
  return { kind: 'error', number: 7, failure: { isOk: false, kind, exitCode: 1, message, stdout: '' } } as FetchedIssues & FetchedIssue
}

describe('issuesAfter', () => {
  const ok: FetchedIssues = { kind: 'ok', items: [item(1)], total: 1, isTruncated: false, rateLimit: null }

  test('a good read replaces the list and clears the problem', () => {
    const prev = { ...listOf([item(9)]), problem: { reason: '504', since: NOW, triedAt: NOW, retryInMs: 15_000 } }
    const next = issuesAfter(prev, ok, LATER, location, account)
    expect(next.kind === 'list' && next.items.map(entry => entry.number)).toEqual([1])
    expect(issuesProblemOf(next)).toBeNull()
  })

  test('a transient failure keeps the last list with a problem and backs off', () => {
    const prev = listOf([item(9)])
    const first = issuesAfter(prev, failure('server', 'gh: HTTP 504'), NOW, location, account)
    expect(first.kind === 'list' && first.items.map(entry => entry.number)).toEqual([9])
    expect(issuesProblemOf(first)).toEqual({ reason: '504', since: NOW, triedAt: NOW, retryInMs: 15_000 })
    const second = issuesAfter(first, failure('network'), LATER, location, account)
    expect(issuesProblemOf(second)).toEqual({ reason: 'network', since: NOW, triedAt: LATER, retryInMs: 30_000 })
  })

  test('a transient failure with nothing to keep is an error carrying the problem', () => {
    const next = issuesAfter(null, failure('rate-limited', 'slow down'), NOW, location, account)
    expect(next.kind).toBe('error')
    expect(next.kind === 'error' && next.message).toBe('slow down')
    expect(issuesProblemOf(next)?.reason).toBe('rate limit')
  })

  test('a permanent failure replaces even a good list', () => {
    const next = issuesAfter(listOf([item(9)]), failure('auth', 'Bad credentials'), NOW, location, account)
    expect(next).toEqual({ kind: 'error', at: NOW, message: 'Bad credentials' })
    expect(issuesAfter(null, failure('gh-missing'), NOW, location, account)).toEqual({ kind: 'error', at: NOW, message: 'gh is not installed' })
  })

  test('there is no problem on a loading list', () => {
    expect(issuesProblemOf(null)).toBeNull()
    expect(issuesProblemOf({ kind: 'loading', at: NOW })).toBeNull()
  })
})

function detail(extra: Record<string, unknown> = {}): unknown {
  return {
    data: {
      repository: {
        issue: {
          id: 'I_7',
          number: 7,
          title: 'Crash on start',
          url: 'https://github.com/acme/app/issues/7',
          state: 'CLOSED',
          stateReason: 'NOT_PLANNED',
          createdAt: '2026-10-01T10:00:00Z',
          author: { login: 'anna' },
          labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
          assignees: { nodes: [{ login: 'me' }] },
          milestone: { title: 'v1' },
          body: 'It crashes.',
          comments: {
            totalCount: 14,
            nodes: [
              { author: { login: 'bo', __typename: 'User' }, createdAt: '2026-10-02T10:00:00Z', lastEditedAt: '2026-10-03T10:00:00Z', body: 'Same here', url: 'https://github.com/acme/app/issues/7#c1' },
              { author: { login: 'ci-helper', __typename: 'Bot' }, createdAt: '2026-10-04T10:00:00Z', lastEditedAt: null, body: 'Triaged', url: 'u2' },
              { author: { login: 'dependabot[bot]', __typename: 'User' }, createdAt: '2026-10-05T10:00:00Z', body: 'Bump', url: 'u3' },
              { author: null, createdAt: '2026-10-06T10:00:00Z', body: 'Gone', url: 'u4' },
            ],
          },
          closedByPullRequestsReferences: {
            nodes: [
              { number: 40, title: 'Fix start', state: 'MERGED' },
              { number: 41, title: 'Try again', state: 'CLOSED' },
              { number: 42, title: 'Wip', state: 'OPEN' },
              { title: 'no number', state: 'OPEN' },
            ],
          },
          ...extra,
        },
      },
      rateLimit: { cost: 1, remaining: 4000, resetAt: '2026-10-12T16:00:00Z' },
    },
  }
}

describe('normalizeIssue', () => {
  test('maps state, reason, labels, comments and linked pull requests', () => {
    const issue = normalizeIssue(detail())
    expect(issue).not.toBeNull()
    if (issue === null) return
    expect([issue.id, issue.number, issue.title, issue.state, issue.stateReason]).toEqual(['I_7', 7, 'Crash on start', 'closed', 'not-planned'])
    expect([issue.author, issue.milestone, issue.body, issue.assignees]).toEqual(['anna', 'v1', 'It crashes.', ['me']])
    expect(issue.labels).toEqual([{ name: 'bug', color: 'd73a4a' }])
    expect(issue.linkedPrs).toEqual([
      { number: 40, title: 'Fix start', state: 'merged' },
      { number: 41, title: 'Try again', state: 'closed' },
      { number: 42, title: 'Wip', state: 'open' },
    ])
    expect(issue.commentCount).toBe(14)
    expect(issue.comments).toHaveLength(4)
    expect(issue.comments[0]).toEqual({ author: 'bo', isBot: false, createdAt: '2026-10-02T10:00:00Z', editedAt: '2026-10-03T10:00:00Z', body: 'Same here', url: 'https://github.com/acme/app/issues/7#c1' })
  })

  test('bots are found by type or by a [bot] login; a deleted author is ghost', () => {
    const comments = normalizeIssue(detail())?.comments ?? []
    expect(comments.map(entry => [entry.author, entry.isBot, entry.editedAt])).toEqual([
      ['bo', false, '2026-10-03T10:00:00Z'],
      ['ci-helper', true, null],
      ['dependabot[bot]', true, null],
      ['ghost', false, null],
    ])
  })

  test('an open issue has no reason, and missing fields fall back', () => {
    const issue = normalizeIssue({ data: { repository: { issue: { id: 'I_1', number: 1, state: 'OPEN', stateReason: 'REOPENED' } } } })
    expect(issue).toEqual({
      id: 'I_1',
      number: 1,
      title: '',
      url: '',
      state: 'open',
      stateReason: 'reopened',
      author: null,
      createdAt: '',
      labels: [],
      assignees: [],
      milestone: null,
      body: '',
      linkedPrs: [],
      comments: [],
      commentCount: 0,
    })
    expect(normalizeIssue({ data: { repository: { issue: { id: 'I_1', number: 1, state: 'OPEN', stateReason: null } } } })?.stateReason).toBeNull()
  })

  test('null, garbage and an issue without id or number give null', () => {
    expect(normalizeIssue(null)).toBeNull()
    expect(normalizeIssue({ data: { repository: { issue: null } } })).toBeNull()
    expect(normalizeIssue({ data: { repository: { issue: { number: 1 } } } })).toBeNull()
  })

  test('the comment count never falls below the comments loaded', () => {
    expect(normalizeIssue(detail({ comments: { nodes: [{ author: { login: 'bo' }, body: 'x' }] } }))?.commentCount).toBe(1)
  })
})

describe('fetchIssue', () => {
  const DETAIL_MATCH = 'includeClosedPrs'

  test('reads one issue with the owner, name and an integer number', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([{ match: DETAIL_MATCH, stdout: JSON.stringify(detail()) }])
    const result = await fetchIssue(exec, location, 'me', 7)
    expect(result.kind === 'ok' && result.issue.number).toBe(7)
    expect(result.kind === 'ok' && result.rateLimit?.remaining).toBe(4000)
    const graphql = calls.filter(call => call.argv[1] === 'api')
    expect(graphql).toHaveLength(1)
    const argv = graphql[0]?.argv ?? []
    expect(argv).toContain('owner=acme')
    expect(argv).toContain('name=app')
    expect(argv).toContain('n=7')
    expect(argv[argv.indexOf('n=7') - 1]).toBe('-F')
    expect(argv[argv.indexOf('owner=acme') - 1]).toBe('-f')
    expect(argv[argv.indexOf('name=app') - 1]).toBe('-f')
  })

  test('a missing issue is a not-found error with the number in the message', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ match: DETAIL_MATCH, stdout: JSON.stringify({ data: { repository: { issue: null } } }) }])
    const result = await fetchIssue(exec, location, 'me', 12)
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect([result.number, result.failure.kind, result.failure.message]).toEqual([12, 'not-found', '#12 is not an issue in acme/app'])
    const snapshot = issueAfter(null, result, NOW, location, account)
    expect(snapshot).toEqual({ kind: 'error', at: NOW, number: 12, message: '#12 is not an issue in acme/app' })
  })

  test('passes a gh failure through and refuses a location without a repository', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ match: DETAIL_MATCH, stdout: '', exitCode: 1, stderr: 'gh: HTTP 502' }])
    const result = await fetchIssue(exec, location, 'me', 7)
    expect(result.kind === 'error' && [result.number, result.failure.kind]).toEqual([7, 'server'])
    const none = fakeExec([])
    const missing = await fetchIssue(none.exec, { ...location, owner: null }, 'me', 7)
    expect(missing.kind).toBe('error')
    expect(none.calls).toHaveLength(0)
  })
})

describe('issueAfter', () => {
  const issue = normalizeIssue(detail()) as Issue
  const ok: FetchedIssue = { kind: 'ok', issue, rateLimit: null }
  const snapshot: IssueSnapshot = { kind: 'issue', at: NOW, location, account, issue }

  test('a good read gives a fresh snapshot without a stale mark', () => {
    const prev: IssueSnapshot = { ...snapshot, stale: { reason: '504', since: NOW, triedAt: NOW, retryInMs: 15_000 } }
    const next = issueAfter(prev, ok, LATER, location, account)
    expect(next).toEqual({ kind: 'issue', at: LATER, location, account, issue, stale: null })
    expect(issueProblemOf(next)).toBeNull()
  })

  test('a transient failure keeps the last good issue, marks it stale and backs off', () => {
    const first = issueAfter(snapshot, failure('server', 'gh: HTTP 503'), NOW, location, account)
    expect(first.kind === 'issue' && first.issue).toBe(issue)
    expect(issueProblemOf(first)).toEqual({ reason: '503', since: NOW, triedAt: NOW, retryInMs: 15_000 })
    const second = issueAfter(first, failure('timeout'), LATER, location, account)
    expect(issueProblemOf(second)).toEqual({ reason: 'timeout', since: NOW, triedAt: LATER, retryInMs: 30_000 })
  })

  test('a snapshot of another issue is not kept', () => {
    const next = issueAfter(snapshot, { ...failure('network'), number: 99 } as FetchedIssue, NOW, location, account)
    expect(next.kind).toBe('error')
    expect(next.kind === 'error' && next.number).toBe(99)
    expect(issueProblemOf(next)?.reason).toBe('network')
  })

  test('with nothing to keep a transient failure is an error carrying the problem', () => {
    const problem = issueProblemOf(issueAfter(null, failure('network'), NOW, location, account)) as Problem
    expect(problem.retryInMs).toBe(15_000)
  })

  test('a permanent failure replaces the snapshot', () => {
    expect(issueAfter(snapshot, failure('auth', 'Bad credentials'), NOW, location, account)).toEqual({ kind: 'error', at: NOW, number: 7, message: 'Bad credentials' })
    expect(issueProblemOf({ kind: 'loading', at: NOW, number: 7 })).toBeNull()
  })
})
