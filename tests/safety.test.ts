import { describe, expect, test } from 'claude-code/testing'

import { canRerunRun } from '../src/actions'
import { parseGitHubRemote } from '../src/git'
import { ISSUE_DETAIL_QUERY, ISSUE_LIST_QUERY, normalizeIssue, normalizeIssues } from '../src/issues'
import { parseJobs } from '../src/jobs'
import { normalizeList } from '../src/list'
import { PR_DETAIL_QUERY, normalize } from '../src/query'
import { normalizeRun } from '../src/runs'
import { cleanText } from '../src/text'
import { prGreen } from './fixtures/pr-raw'

type Raw = { detail: { data: { node: Record<string, unknown> } } }

const cliLocation = { cwd: '/work/cli', branch: 'feature', owner: 'cli', repo: 'cli', pinnedLogin: null }
/** An OSC 8 hyperlink opener and a red color change, as a hostile title would carry them. */
const HOSTILE = 'a\u001b]8;;https://x\u0007b\u001b[31mc\u0007d\u009b31me\u007ff\u0000g\rh'
const CLEAN = 'abcdefgh'

describe('cross-repository links', () => {
  test('all three queries ask for the repository of the linked nodes', () => {
    expect(ISSUE_LIST_QUERY).toContain('closedByPullRequestsReferences(first: 3) { nodes { number repository { nameWithOwner } } }')
    expect(ISSUE_DETAIL_QUERY).toContain('closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number title state repository { nameWithOwner } } }')
    expect(PR_DETAIL_QUERY).toContain('closingIssuesReferences(first: 5) { nodes { number title state repository { nameWithOwner } } }')
  })

  test('an issue detail carries the repository of every linked pull request', () => {
    const issue = normalizeIssue({
      data: {
        repository: {
          issue: {
            id: 'I_1',
            number: 1,
            state: 'OPEN',
            closedByPullRequestsReferences: {
              nodes: [
                { number: 5, title: 'Same', state: 'OPEN', repository: { nameWithOwner: 'acme/app' } },
                { number: 6, title: 'Other', state: 'MERGED', repository: { nameWithOwner: 'evil/fork' } },
                { number: 7, title: 'Unknown', state: 'OPEN' },
                { number: 8, title: 'Odd', state: 'OPEN', repository: { nameWithOwner: 'not a slug' } },
              ],
            },
          },
        },
      },
    })
    expect(issue?.linkedPrs).toEqual([
      { number: 5, title: 'Same', state: 'open', repo: 'acme/app' },
      { number: 6, title: 'Other', state: 'merged', repo: 'evil/fork' },
      { number: 7, title: 'Unknown', state: 'open' },
      { number: 8, title: 'Odd', state: 'open' },
    ])
  })

  test('a pull request carries the repository of every closing issue', () => {
    const raw = structuredClone(prGreen) as unknown as Raw
    raw.detail.data.node.closingIssuesReferences = {
      nodes: [
        { number: 7, title: 'Here', state: 'OPEN', repository: { nameWithOwner: 'cli/cli' } },
        { number: 9, title: 'There', state: 'CLOSED', repository: { nameWithOwner: 'other/repo' } },
        { number: 11, title: 'Unknown', state: 'OPEN' },
      ],
    }
    expect(normalize(raw, cliLocation).pr?.linkedIssues).toEqual([
      { number: 7, title: 'Here', state: 'open', repo: 'cli/cli' },
      { number: 9, title: 'There', state: 'closed', repo: 'other/repo' },
      { number: 11, title: 'Unknown', state: 'open' },
    ])
  })

  test('the issue list counts only pull requests of the listed repository (case-insensitive)', () => {
    const node = (number: number, refs: unknown[]) => ({ id: `I_${number}`, number, closedByPullRequestsReferences: { nodes: refs } })
    const raw = {
      data: {
        search: {
          issueCount: 1,
          nodes: [
            node(1, [
              { number: 15, repository: { nameWithOwner: 'Acme/App' } },
              { number: 16, repository: { nameWithOwner: 'evil/fork' } },
              { number: 17 },
            ]),
          ],
        },
      },
    }
    expect(normalizeIssues(raw, new Set(), 'acme/app').items[0]?.linkedPrs).toEqual([15, 17])
    expect(normalizeIssues(raw, new Set()).items[0]?.linkedPrs).toEqual([15, 16, 17])
  })
})

describe('canRerunRun', () => {
  test('only a failed or timed-out run may be re-run', () => {
    expect(canRerunRun('failure')).toBe(true)
    expect(canRerunRun('timed-out')).toBe(true)
    for (const state of ['success', 'running', 'queued', 'cancelled', 'neutral', 'skipped'] as const) expect(canRerunRun(state)).toBe(false)
  })
})

describe('remote slugs', () => {
  test('owner and repository must use the characters GitHub allows', () => {
    expect(parseGitHubRemote('git@github.com:Acme-1/site.github.io_x.git')).toEqual({ owner: 'Acme-1', repo: 'site.github.io_x' })
    expect(parseGitHubRemote('https://github.com/ac%20me/app')).toBeNull()
    expect(parseGitHubRemote('https://github.com/acme/ap$p')).toBeNull()
    expect(parseGitHubRemote('https://github.com/ac.me/app')).toBeNull()
    expect(parseGitHubRemote('https://github.com/ac_me/app')).toBeNull()
    expect(parseGitHubRemote('git@github.com:acme/app;rm.git')).toBeNull()
    expect(parseGitHubRemote('https://github.com/acme/..')).toBeNull()
  })
})

describe('cleanText', () => {
  test('removes escape sequences and control characters, keeps newline, tab and Unicode', () => {
    expect(cleanText(HOSTILE)).toBe(CLEAN)
    expect(cleanText('line one\n\tline two ünï ✓ 日本')).toBe('line one\n\tline two ünï ✓ 日本')
    expect(cleanText('x\u001b]0;title\u001b\\y')).toBe('xy')
  })
})

describe('GitHub text is cleaned where it is normalized', () => {
  test('issue list: title, label, author, assignee', () => {
    const raw = {
      data: {
        search: {
          issueCount: 1,
          nodes: [{ id: 'I_1', number: 1, title: HOSTILE, author: { login: HOSTILE }, labels: { nodes: [{ name: HOSTILE, color: 'fff' }] }, assignees: { nodes: [{ login: HOSTILE }] } }],
        },
      },
    }
    const item = normalizeIssues(raw, new Set()).items[0]
    expect([item?.title, item?.author, item?.labels[0]?.name, item?.assignees[0]]).toEqual([CLEAN, CLEAN, CLEAN, CLEAN])
  })

  test('issue detail: title, labels, body, comments, authors, linked pull request titles', () => {
    const issue = normalizeIssue({
      data: {
        repository: {
          issue: {
            id: 'I_1',
            number: 1,
            state: 'OPEN',
            title: HOSTILE,
            body: `${HOSTILE}\nsecond`,
            author: { login: HOSTILE },
            milestone: { title: HOSTILE },
            labels: { nodes: [{ name: HOSTILE, color: 'fff' }] },
            assignees: { nodes: [{ login: HOSTILE }] },
            comments: { totalCount: 1, nodes: [{ author: { login: HOSTILE }, body: HOSTILE, createdAt: '2026-10-01T10:00:00Z', url: 'u' }] },
            closedByPullRequestsReferences: { nodes: [{ number: 2, title: HOSTILE, state: 'OPEN' }] },
          },
        },
      },
    })
    expect([issue?.title, issue?.author, issue?.milestone, issue?.labels[0]?.name, issue?.assignees[0]]).toEqual([CLEAN, CLEAN, CLEAN, CLEAN, CLEAN])
    expect(issue?.body).toBe(`${CLEAN}\nsecond`)
    expect([issue?.comments[0]?.author, issue?.comments[0]?.body, issue?.linkedPrs[0]?.title]).toEqual([CLEAN, CLEAN, CLEAN])
  })

  test('runs: name, branch, actor', () => {
    const run = normalizeRun({ id: 1, workflow_id: 2, name: HOSTILE, head_branch: HOSTILE, actor: { login: HOSTILE }, created_at: '2026-10-01T10:00:00Z' })
    expect([run?.name, run?.branch, run?.actor]).toEqual([CLEAN, CLEAN, CLEAN])
  })

  test('jobs: job and step names', () => {
    const jobs = parseJobs(
      { jobs: [{ databaseId: 1, name: HOSTILE, status: 'completed', conclusion: 'failure', steps: [{ name: HOSTILE, status: 'completed', conclusion: 'failure' }] }] },
      9,
    )
    expect([jobs[0]?.name, jobs[0]?.failedStep]).toEqual([CLEAN, CLEAN])
  })

  test('pull request list: title, label, author', () => {
    const raw = {
      data: {
        search: {
          issueCount: 1,
          nodes: [{ id: 'PR_1', number: 1, title: HOSTILE, author: { login: HOSTILE }, labels: { nodes: [{ name: HOSTILE, color: 'fff' }] } }],
        },
      },
    }
    const item = normalizeList(raw, new Set(), 'me').items[0]
    expect([item?.title, item?.author, item?.labels[0]?.name]).toEqual([CLEAN, CLEAN, CLEAN])
  })

  test('pull request detail: title, branch, author, comment authors, linked issue titles', () => {
    const raw = structuredClone(prGreen) as unknown as Raw
    const node = raw.detail.data.node
    node.title = HOSTILE
    node.author = { login: HOSTILE }
    node.headRefName = HOSTILE
    node.comments = { totalCount: 1, nodes: [{ author: { login: HOSTILE }, createdAt: '2026-10-01T10:00:00Z', lastEditedAt: null, url: 'u' }] }
    node.closingIssuesReferences = { nodes: [{ number: 3, title: HOSTILE, state: 'OPEN' }] }
    const pr = normalize(raw, cliLocation).pr
    expect([pr?.title, pr?.author, pr?.headRefName, pr?.lastComment?.author, pr?.linkedIssues?.[0]?.title]).toEqual([CLEAN, CLEAN, CLEAN, CLEAN, CLEAN])
  })
})
