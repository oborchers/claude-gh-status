import { describe, expect, test } from 'claude-code/testing'

import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import type { CommentRef, PullRequest, RepoLocation } from '../src/model'
import { activityAt, commentWhen, transitions } from '../src/status'
import { EDIT_GRACE_MS, PR_BY_NUMBER_QUERY, PR_DETAIL_QUERY, PR_QUERY, candidatesOf, checkStateFrom, fetchPullRequest, fetchPullRequestByNumber, latestPerCheck, normalize, selectCandidate, statusContextState } from '../src/query'
import {
  prAdmin,
  prAutoMerge,
  prBehind,
  prClosed,
  prConflicting,
  prDraft,
  prForks,
  prGreen,
  prMergeQueue,
  prMergeQueueChecks,
  prMerged,
  prNone,
  prRunning,
  prSquashOnly,
  prStatusContexts,
  prFailing,
} from './fixtures/pr-raw'
import { makeCheck, makeSnapshot } from './fixtures/pr-builder'

const cliLocation: RepoLocation = { cwd: '/work/cli', branch: 'feature', owner: 'cli', repo: 'cli', pinnedLogin: null }

function at(owner: string): RepoLocation {
  return { ...cliLocation, owner }
}

describe('normalize', () => {
  test('a green approved pull request', () => {
    const { pr, rateLimit } = normalize(prGreen, cliLocation)
    expect(pr?.number).toBe(14580)
    expect(pr?.state).toBe('open')
    expect(pr?.mergeStateStatus).toBe('clean')
    expect(pr?.mergeable).toBe('mergeable')
    expect(pr?.reviewDecision).toBe('approved')
    expect(pr?.isDraft).toBe(false)
    expect(pr?.allowedMethods).toEqual(['merge', 'squash', 'rebase'])
    expect(pr?.headOid).toHaveLength(40)
    expect(pr?.checks.length).toBeGreaterThan(0)
    expect(pr?.checks.every(check => check.state === 'success' || check.state === 'skipped')).toBe(true)
    expect(rateLimit?.remaining).toBeGreaterThan(0)
    expect(rateLimit?.resetAt).toContain('2026')
  })

  test('check runs carry workflow name, run id, job id and the required flag', () => {
    const build = normalize(prGreen, cliLocation).pr?.checks.find(check => check.name === 'build (ubuntu-latest)')
    expect(build?.isRequired).toBe(true)
    expect(build?.workflow).not.toBeNull()
    expect(build?.runId).toBeGreaterThan(0)
    expect(build?.jobId).toBeGreaterThan(0)
    expect(build?.url).toContain('/actions/runs/')
  })

  test('a failing check, a review request and the blocked state', () => {
    const pr = normalize(prFailing, cliLocation).pr
    const failed = pr?.checks.filter(check => check.state === 'failure')
    expect(failed?.map(check => check.name)).toEqual(['govulncheck'])
    expect(failed?.[0]?.workflow).toBe('Lint')
    expect(pr?.mergeStateStatus).toBe('blocked')
    expect(pr?.reviewDecision).toBe('review-required')
    expect(pr?.reviewRequests).toEqual([
      { reviewer: 'sergiou87', isTeam: false },
      { reviewer: 'babakks', isTeam: false },
    ])
    expect(pr?.reviews).toEqual([{ author: 'copilot-pull-request-reviewer', state: 'commented', submittedAt: '2026-10-09T19:45:56Z' }])
  })

  test('a conflicting pull request with review threads', () => {
    const pr = normalize(prConflicting, cliLocation).pr
    expect(pr?.mergeable).toBe('conflicting')
    expect(pr?.mergeStateStatus).toBe('dirty')
    expect(pr?.threads).toHaveLength(5)
    const open = pr?.threads.find(thread => !thread.isResolved)
    expect(open?.path).toBe('api/http_client.go')
    expect(open?.line).toBe(19)
    expect(open?.last?.author).toBe('williammartin')
    expect(pr?.threads.some(thread => thread.isResolved)).toBe(true)
  })

  test('the author comes from the detail query; a missing or deleted author is null', () => {
    expect(PR_DETAIL_QUERY).toContain('author { login }')
    expect(normalize(prGreen, cliLocation).pr?.author).toBe('fixture-author')
    const deleted = structuredClone(prGreen) as { detail: { data: { node: Record<string, unknown> } } }
    deleted.detail.data.node.author = null
    expect(normalize(deleted, cliLocation).pr?.author).toBeNull()
  })

  test('a draft pull request', () => {
    const pr = normalize(prDraft, cliLocation).pr
    expect(pr?.isDraft).toBe(true)
    expect(pr?.state).toBe('open')
  })

  test('a merged pull request is found when no open one exists', () => {
    const pr = normalize(prMerged, cliLocation).pr
    expect(pr?.state).toBe('merged')
    expect(pr?.mergeStateStatus).toBe('unknown')
  })

  test('a closed pull request', () => {
    expect(normalize(prClosed, cliLocation).pr?.state).toBe('closed')
  })

  test('no pull request for the branch', () => {
    const result = normalize(prNone, cliLocation)
    expect(result.pr).toBeNull()
    expect(result.rateLimit).not.toBeNull()
  })

  test('merge queue entry', () => {
    const pr = normalize(prMergeQueue, cliLocation).pr
    expect(pr?.isInMergeQueue).toBe(true)
    expect(pr?.isMergeQueueEnabled).toBe(true)
    expect(pr?.mergeQueueEntry).toEqual({ position: 2, state: 'awaiting-checks', estimatedTimeToMerge: 540, checks: [] })
  })

  test('merge group commit checks, normalized like the head checks', () => {
    const entry = normalize(prMergeQueueChecks, cliLocation).pr?.mergeQueueEntry
    expect(entry?.checks.map((check) => [check.name, check.state, check.isRequired])).toEqual([
      ['lint', 'success', true],
      ['unit', 'running', true],
      ['e2e', 'queued', false],
      ['docs', 'skipped', false],
      ['license/cla', 'success', false],
    ])
    expect(entry?.checks[1]).toMatchObject({ workflow: 'CI', runId: 777, startedAt: '2026-10-12T07:50:00Z', url: 'https://github.com/cli/cli/actions/runs/777/job/unit' })
    expect(entry?.checks[4]).toMatchObject({ workflow: null, runId: null, url: 'https://cla.example/1' })
  })

  test('a queue entry without a merge group commit yet has no checks', () => {
    const raw = structuredClone(prMergeQueueChecks)
    const node = raw.detail.data.node as unknown as { mergeQueueEntry: Record<string, unknown> }
    node.mergeQueueEntry.headCommit = null
    expect(normalize(raw, cliLocation).pr?.mergeQueueEntry?.checks).toEqual([])
  })

  test('the detail query reads the merge group checks with the same selection as the head checks', () => {
    expect(PR_DETAIL_QUERY).toMatch(/mergeQueueEntry \{[^]*headCommit \{ oid statusCheckRollup/)
    expect(PR_DETAIL_QUERY.match(/isRequired\(pullRequestId: \$id\)/g)).toHaveLength(4)
    expect(PR_DETAIL_QUERY.match(/checkSuite \{ workflowRun/g)).toHaveLength(2)
  })

  test('merged by, merged at and closed at', () => {
    const raw = structuredClone(prMerged)
    const node = raw.detail.data.node as unknown as Record<string, unknown>
    node.mergedBy = { login: 'anna' }
    node.mergedAt = '2026-10-09T10:00:00Z'
    node.closedAt = '2026-10-09T10:00:00Z'
    expect(normalize(raw, cliLocation).pr).toMatchObject({ mergedBy: 'anna', mergedAt: '2026-10-09T10:00:00Z', closedAt: '2026-10-09T10:00:00Z' })
    expect(normalize(prGreen, cliLocation).pr).toMatchObject({ mergedBy: null, mergedAt: null, closedAt: null })
    expect(PR_DETAIL_QUERY).toContain('mergedBy { login } mergedAt closedAt')
  })

  test('behind the base branch', () => {
    expect(normalize(prBehind, cliLocation).pr?.mergeStateStatus).toBe('behind')
  })

  test('admin can merge', () => {
    expect(normalize(prAdmin, cliLocation).pr?.viewerCanMergeAsAdmin).toBe(true)
  })

  test('auto-merge, team and bot reviewers', () => {
    const pr = normalize(prAutoMerge, cliLocation).pr
    expect(pr?.autoMerge).toEqual({ method: 'squash', enabledAt: '2026-10-09T12:00:00Z' })
    expect(pr?.reviewRequests).toEqual([
      { reviewer: 'cli/platform', isTeam: true },
      { reviewer: 'copilot-pull-request-reviewer', isTeam: false },
    ])
  })

  describe('comment edits', () => {
    const comment = (login: string, createdAt: string, lastEditedAt: string | null, id: number) => ({
      author: { login },
      createdAt,
      lastEditedAt,
      url: `https://github.com/cli/cli/pull/14580#issuecomment-${id}`,
    })

    type Raw = { detail: { data: { node: { comments: { nodes: unknown[] }; reviewThreads: { nodes: unknown[] } } } } }
    function withComments(comments: unknown[], threadComments: unknown[] = []) {
      const raw = structuredClone(prGreen) as unknown as Raw
      raw.detail.data.node.comments.nodes = comments
      raw.detail.data.node.reviewThreads.nodes = [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 3, comments: { nodes: threadComments } }]
      return raw
    }

    test('the queries ask for lastEditedAt on the last 100 comments and the last 5 per thread', () => {
      expect(PR_DETAIL_QUERY).toContain('comments(last: 100) { totalCount nodes { author { login } createdAt lastEditedAt url } }')
      expect(PR_DETAIL_QUERY).toContain('comments(last: 5) { nodes { author { login } createdAt lastEditedAt url } }')
    })

    test('an unedited comment has editedAt null (also when the field is absent)', () => {
      const pr = normalize(prGreen, cliLocation).pr
      expect(pr?.lastComment?.editedAt).toBeNull()
      const raw = withComments([comment('anna', '2026-10-01T00:00:00Z', null, 1)])
      expect(normalize(raw, cliLocation).pr?.lastComment?.editedAt).toBeNull()
    })

    test('an edited older comment beats a newer unedited one', () => {
      const raw = withComments([
        comment('review-bot', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z', 1),
        comment('anna', '2026-10-03T00:00:00Z', null, 2),
      ])
      const last = normalize(raw, cliLocation).pr?.lastComment
      expect(last?.author).toBe('review-bot')
      expect(last?.editedAt).toBe('2026-10-05T00:00:00Z')
    })

    test('a newer comment beats an older edit; ties go to the later comment', () => {
      const newer = withComments([
        comment('review-bot', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z', 1),
        comment('anna', '2026-10-06T00:00:00Z', null, 2),
      ])
      expect(normalize(newer, cliLocation).pr?.lastComment?.author).toBe('anna')
      const tie = withComments([comment('a', '2026-10-01T00:00:00Z', null, 1), comment('b', '2026-10-01T00:00:00Z', null, 2)])
      expect(normalize(tie, cliLocation).pr?.lastComment?.author).toBe('b')
    })

    test('an old comment edited a day later wins among seven comments', () => {
      const comments = [
        comment('ci-bot', '2026-10-01T08:00:00Z', '2026-10-02T07:00:00Z', 1),
        comment('tracker-bot', '2026-10-01T08:01:00Z', '2026-10-02T07:01:00Z', 2),
        comment('anna', '2026-10-01T09:00:00Z', null, 3),
        comment('ben', '2026-10-01T10:00:00Z', null, 4),
        comment('anna', '2026-10-01T11:00:00Z', null, 5),
        comment('ben', '2026-10-01T12:00:00Z', null, 6),
        comment('anna', '2026-10-01T13:00:00Z', null, 7),
      ]
      const last = normalize(withComments(comments), cliLocation).pr?.lastComment
      expect(last?.author).toBe('tracker-bot')
      expect(last?.editedAt).toBe('2026-10-02T07:01:00Z')
    })

    test('an edit within the grace period is no edit; one exactly at the threshold counts', () => {
      expect(EDIT_GRACE_MS).toBe(60_000)
      const quick = withComments([comment('ci-bot', '2026-10-01T08:00:00Z', '2026-10-01T08:00:02Z', 1)])
      const quickRef = normalize(quick, cliLocation).pr?.lastComment
      expect(quickRef?.editedAt).toBeNull()
      expect(activityAt(quickRef as CommentRef)).toBe('2026-10-01T08:00:00Z')
      expect(commentWhen(quickRef as CommentRef, Date.parse('2026-10-01T09:00:00Z'))).not.toContain('edited')
      const justUnder = withComments([comment('ci-bot', '2026-10-01T08:00:00Z', '2026-10-01T08:00:59Z', 1)])
      expect(normalize(justUnder, cliLocation).pr?.lastComment?.editedAt).toBeNull()
      const exact = withComments([comment('ci-bot', '2026-10-01T08:00:00Z', '2026-10-01T08:01:00Z', 1)])
      expect(normalize(exact, cliLocation).pr?.lastComment?.editedAt).toBe('2026-10-01T08:01:00Z')
    })

    test('a quick bot edit raises no comment updated toast', () => {
      const prOf = (edited: string | null) => normalize(withComments([comment('ci-bot', '2026-10-01T08:00:00Z', edited, 1)]), cliLocation).pr as PullRequest
      const before = makeSnapshot(prOf(null))
      const quick = makeSnapshot(prOf('2026-10-01T08:00:02Z'))
      expect(transitions(before, quick, 'me').filter((t) => t.includes('comment updated'))).toEqual([])
      const late = makeSnapshot(prOf('2026-10-01T09:00:00Z'))
      expect(transitions(before, late, 'me').filter((t) => t.includes('comment updated'))).toHaveLength(1)
    })

    test('a thread surfaces its most recently active comment', () => {
      const raw = withComments([], [
        comment('review-bot', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z', 7),
        comment('anna', '2026-10-03T00:00:00Z', null, 8),
      ])
      const thread = normalize(raw, cliLocation).pr?.threads[0]
      expect(thread?.last?.author).toBe('review-bot')
      expect(thread?.last?.editedAt).toBe('2026-10-05T00:00:00Z')
    })

    test('malformed comments are skipped; none gives null', () => {
      const raw = withComments([{ author: null, createdAt: 5 }, comment('anna', '2026-10-01T00:00:00Z', null, 2)])
      expect(normalize(raw, cliLocation).pr?.lastComment?.author).toBe('anna')
      expect(normalize(withComments([]), cliLocation).pr?.lastComment).toBeNull()
    })
  })

  test('running and queued checks, unknown merge facts, a ghost comment author', () => {
    const pr = normalize(prRunning, cliLocation).pr
    expect(pr?.checks.map(check => [check.name, check.state])).toEqual([
      ['build', 'running'],
      ['lint', 'queued'],
      ['unit', 'success'],
    ])
    expect(pr?.checks[0]?.startedAt).toBe('2026-10-09T08:00:00Z')
    expect(pr?.checks[2]?.url).toBeNull()
    expect(pr?.mergeable).toBe('unknown')
    expect(pr?.mergeStateStatus).toBe('unstable')
    expect(pr?.reviewDecision).toBeNull()
    expect(pr?.commentCount).toBe(3)
    expect(pr?.lastComment?.author).toBe('ghost')
  })

  test('commit status contexts become checks without workflow or run', () => {
    const checks = normalize(prStatusContexts, cliLocation).pr?.checks
    expect(checks?.map(check => [check.name, check.state, check.isRequired])).toEqual([
      ['ci/circleci: test', 'success', true],
      ['ci/circleci: lint', 'failure', false],
      ['deploy/preview', 'queued', false],
      ['deploy/expected', 'queued', true],
    ])
    expect(checks?.every(check => check.workflow === null && check.runId === null && check.jobId === null)).toBe(true)
    expect(checks?.[2]?.completedAt).toBeNull()
    expect(checks?.[0]?.completedAt).not.toBeNull()
  })

  test('isPrivate comes from the repository, false when missing', () => {
    const privateList = structuredClone(prSquashOnly) as { list: { data: { repository: Record<string, unknown> } } }
    privateList.list.data.repository.isPrivate = true
    expect(normalize(privateList, cliLocation).pr?.isPrivate).toBe(true)
    expect(normalize(prSquashOnly, cliLocation).pr?.isPrivate).toBe(false)
  })

  test('the list query selects isPrivate', () => {
    expect(PR_QUERY).toContain('isPrivate')
  })

  test('allowed merge methods come from the repository flags', () => {
    expect(normalize(prSquashOnly, cliLocation).pr?.allowedMethods).toEqual(['squash'])
  })

  test('garbage in, safe defaults out, never a throw', () => {
    for (const raw of [undefined, null, 5, 'x', [], {}, { list: 1, detail: 2 }, { list: { data: null }, detail: { data: { node: {} } } }]) {
      const result = normalize(raw, cliLocation)
      expect(result.pr).toBeNull()
    }
    const sparse = normalize(
      {
        list: { data: { repository: { pullRequests: { nodes: [{ id: 'PR_1', number: 7, state: 'OPEN', headRepositoryOwner: null }] } } } },
        detail: { data: { node: { id: 'PR_1', number: 7, mergeStateStatus: 'SOMETHING_NEW', mergeable: 'WEIRD', reviewDecision: 'NOPE', reviewRequests: 'x', commits: { nodes: [{}] } } } },
      },
      cliLocation,
    )
    expect(sparse.pr?.mergeStateStatus).toBe('unknown')
    expect(sparse.pr?.mergeable).toBe('unknown')
    expect(sparse.pr?.reviewDecision).toBeNull()
    expect(sparse.pr?.allowedMethods).toEqual([])
    expect(sparse.pr?.checks).toEqual([])
    expect(sparse.pr?.headRefName).toBe('feature')
    expect(sparse.pr?.state).toBe('open')
    expect(sparse.rateLimit).toBeNull()
  })
})

describe('enum mapping', () => {
  const checkRows: [string, string | null, string][] = [
    ['QUEUED', null, 'queued'],
    ['PENDING', null, 'queued'],
    ['WAITING', null, 'queued'],
    ['REQUESTED', null, 'queued'],
    ['IN_PROGRESS', null, 'running'],
    ['COMPLETED', 'SUCCESS', 'success'],
    ['COMPLETED', 'FAILURE', 'failure'],
    ['COMPLETED', 'CANCELLED', 'cancelled'],
    ['COMPLETED', 'SKIPPED', 'skipped'],
    ['COMPLETED', 'NEUTRAL', 'neutral'],
    ['COMPLETED', 'ACTION_REQUIRED', 'action-required'],
    ['COMPLETED', 'TIMED_OUT', 'timed-out'],
    ['COMPLETED', 'STALE', 'stale'],
    ['COMPLETED', 'STARTUP_FAILURE', 'failure'],
    ['COMPLETED', null, 'neutral'],
    ['COMPLETED', 'BRAND_NEW', 'neutral'],
    ['completed', 'success', 'success'],
    ['in_progress', '', 'running'],
  ]
  for (const [status, conclusion, expected] of checkRows) {
    test(`check ${status}/${conclusion ?? 'none'} is ${expected}`, () => {
      expect(checkStateFrom(status, conclusion)).toBe(expected)
    })
  }

  test('unreadable check status is queued', () => {
    expect(checkStateFrom(undefined, undefined)).toBe('queued')
  })

  const contextRows: [string, string][] = [
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['ERROR', 'failure'],
    ['PENDING', 'queued'],
    ['EXPECTED', 'queued'],
    ['SOMETHING', 'queued'],
  ]
  for (const [state, expected] of contextRows) {
    test(`status context ${state} is ${expected}`, () => {
      expect(statusContextState(state)).toBe(expected)
    })
  }

  test('review, merge state and queue enums take their lowercase-hyphen forms', () => {
    const raw = JSON.parse(JSON.stringify(prGreen)) as typeof prGreen
    const node = raw.detail.data.node as Record<string, unknown>
    node.reviewDecision = 'CHANGES_REQUESTED'
    node.mergeStateStatus = 'HAS_HOOKS'
    node.mergeQueueEntry = { position: 1, state: 'AWAITING_CHECKS', estimatedTimeToMerge: null }
    node.latestReviews = {
      nodes: [
        { author: { login: 'a' }, state: 'CHANGES_REQUESTED', submittedAt: 't' },
        { author: { login: 'b' }, state: 'APPROVED', submittedAt: 't' },
        { author: { login: 'c' }, state: 'DISMISSED', submittedAt: 't' },
        { author: { login: 'd' }, state: 'PENDING', submittedAt: 't' },
        { author: { login: 'e' }, state: 'COMMENTED', submittedAt: null },
        { author: null, state: 'MYSTERY', submittedAt: null },
      ],
    }
    const pr = normalize(raw, cliLocation).pr
    expect(pr?.reviewDecision).toBe('changes-requested')
    expect(pr?.mergeStateStatus).toBe('has-hooks')
    expect(pr?.mergeQueueEntry?.state).toBe('awaiting-checks')
    expect(pr?.reviews.map(review => review.state)).toEqual(['changes-requested', 'approved', 'dismissed', 'pending', 'commented', 'commented'])
    expect(pr?.reviews[5]?.author).toBe('ghost')
    for (const [queueState, expected] of [['QUEUED', 'queued'], ['MERGEABLE', 'mergeable'], ['UNMERGEABLE', 'unmergeable'], ['LOCKED', 'locked'], ['NEW_STATE', 'queued']] as const) {
      node.mergeQueueEntry = { position: 1, state: queueState, estimatedTimeToMerge: 5 }
      expect(normalize(raw, cliLocation).pr?.mergeQueueEntry?.state).toBe(expected)
    }
  })
})

describe('selection rule', () => {
  test('prefers the open pull request of the location owner over a fork with the same branch name', () => {
    const forkOwned = candidatesOf(prForks.list)
    const owners = forkOwned.map(candidate => candidate.ownerLogin)
    expect(owners).toContain('acoulton')
    expect(selectCandidate(forkOwned, at('acoulton'))?.number).toBe(14373)
    // case-insensitive owner match
    expect(selectCandidate(forkOwned, at('ACoulton'))?.number).toBe(14373)
  })

  test('an open fork pull request wins over newer closed ones of the owner', () => {
    const candidates = candidatesOf(prForks.list)
    expect(candidates[0]?.state).toBe('CLOSED')
    expect(selectCandidate(candidates, at('cli'))?.number).toBe(14373)
  })

  test('prefers the owner among several open pull requests', () => {
    const candidates = [
      { id: 'a', number: 1, state: 'OPEN', ownerLogin: 'fork-a' },
      { id: 'b', number: 2, state: 'OPEN', ownerLogin: 'Cli' },
      { id: 'c', number: 3, state: 'OPEN', ownerLogin: 'cli' },
    ]
    expect(selectCandidate(candidates, at('cli'))?.number).toBe(2)
    expect(selectCandidate(candidates, at('nobody'))?.number).toBe(1)
  })

  test('falls back to the most recently updated merged or closed pull request', () => {
    const candidates = [
      { id: 'a', number: 5, state: 'MERGED', ownerLogin: 'cli' },
      { id: 'b', number: 4, state: 'CLOSED', ownerLogin: 'cli' },
    ]
    expect(selectCandidate(candidates, cliLocation)?.number).toBe(5)
  })

  test('none, or an unknown state, selects nothing', () => {
    expect(selectCandidate([], cliLocation)).toBeNull()
    expect(selectCandidate([{ id: 'a', number: 1, state: 'DRAFT?', ownerLogin: null }], cliLocation)).toBeNull()
  })

  test('a location without an owner still selects an open pull request', () => {
    const noOwner: RepoLocation = { ...cliLocation, owner: null }
    expect(selectCandidate([{ id: 'a', number: 9, state: 'OPEN', ownerLogin: 'x' }], noOwner)?.number).toBe(9)
  })

  test('candidatesOf drops malformed entries', () => {
    const list = { data: { repository: { pullRequests: { nodes: [{ id: 'a' }, null, 4, { id: 'b', number: 2, state: 'OPEN' }] } } } }
    expect(candidatesOf(list)).toEqual([{ id: 'b', number: 2, state: 'OPEN', ownerLogin: null }])
  })
})

describe('linked issues', () => {
  type Raw = { detail: { data: { node: Record<string, unknown> } } }
  const withClosing = (value: unknown) => {
    const raw = structuredClone(prGreen) as unknown as Raw
    raw.detail.data.node.closingIssuesReferences = value
    return raw
  }

  test('the detail query asks for the first 5 closing issues', () => {
    expect(PR_DETAIL_QUERY).toContain('closingIssuesReferences(first: 5) { nodes { number title state repository { nameWithOwner } } }')
  })

  test('fills linkedIssues with the state lowercased', () => {
    const raw = withClosing({ nodes: [{ number: 7, title: 'Crash', state: 'OPEN' }, { number: 9, title: 'Old', state: 'CLOSED' }] })
    expect(normalize(raw, cliLocation).pr?.linkedIssues).toEqual([
      { number: 7, title: 'Crash', state: 'open' },
      { number: 9, title: 'Old', state: 'closed' },
    ])
  })

  test('is empty when the answer has none, or junk entries', () => {
    expect(normalize(prGreen, cliLocation).pr?.linkedIssues).toEqual([])
    expect(normalize(withClosing({ nodes: [null, { title: 'no number' }, 3] }), cliLocation).pr?.linkedIssues).toEqual([])
  })
})

describe('queries', () => {
  test('are read-only GraphQL with the variables the fetch supplies', () => {
    expect(PR_QUERY.startsWith('query(')).toBe(true)
    expect(PR_QUERY).toContain('$owner')
    expect(PR_QUERY).toContain('$branch')
    expect(PR_DETAIL_QUERY.startsWith('query(')).toBe(true)
    expect(PR_DETAIL_QUERY).toContain('isRequired(pullRequestId: $id)')
    expect(PR_DETAIL_QUERY).toContain('workflowRun')
    expect(PR_QUERY.includes('mutation') || PR_DETAIL_QUERY.includes('mutation')).toBe(false)
  })
})

type Call = { argv: readonly string[] }

function fakeExec(answers: { stdout: string; exitCode?: number; stderr?: string }[]): { exec: Exec; calls: Call[] } {
  const calls: Call[] = []
  let next = 0
  const exec: Exec = async argv => {
    calls.push({ argv })
    if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const answer = answers[next] ?? { stdout: '', exitCode: 1, stderr: 'no more answers' }
    next += 1
    return { exitCode: answer.exitCode ?? 0, stdout: answer.stdout, stderr: answer.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { exec, calls }
}

describe('fetchPullRequest', () => {
  test('runs the list query, then the detail query of the selected pull request', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([{ stdout: JSON.stringify(prGreen.list) }, { stdout: JSON.stringify(prGreen.detail) }])
    const result = await fetchPullRequest(exec, cliLocation, 'oborchers')
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.pr?.number).toBe(14580)
    expect(result.rateLimit?.remaining).toBeGreaterThan(0)
    const graphql = calls.filter(call => call.argv[1] === 'api')
    expect(graphql).toHaveLength(2)
    expect(graphql[0]?.argv).toContain('owner=cli')
    expect(graphql[0]?.argv).toContain('name=cli')
    expect(graphql[0]?.argv).toContain('branch=feature')
    expect(graphql[1]?.argv.some(arg => arg.startsWith('id=PR_'))).toBe(true)
    expect(graphql[1]?.argv).not.toContain('-F')
  })

  test('sends a branch that looks like a number or a file as a plain string', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([{ stdout: JSON.stringify(prNone.list) }])
    await fetchPullRequest(exec, { ...cliLocation, branch: '@secrets' }, 'oborchers')
    const argv = calls.find(call => call.argv[1] === 'api')?.argv ?? []
    const at = argv.indexOf('branch=@secrets')
    expect(argv[at - 1]).toBe('-f')
  })

  test('no pull request for the branch costs one query and gives null', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([{ stdout: JSON.stringify(prNone.list) }])
    const result = await fetchPullRequest(exec, cliLocation, 'oborchers')
    expect(result).toEqual({ kind: 'ok', pr: null, rateLimit: { remaining: prNone.list.data.rateLimit.remaining, resetAt: prNone.list.data.rateLimit.resetAt } })
    expect(calls.filter(call => call.argv[1] === 'api')).toHaveLength(1)
  })

  test('passes a gh failure through', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ stdout: '', exitCode: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)" }])
    const result = await fetchPullRequest(exec, cliLocation, 'oborchers')
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.failure.isOk).toBe(false)
    expect(result.failure.kind).toBe('not-found')
    expect(result.failure.exitCode).toBe(1)
  })

  test('passes a failure of the detail query through', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ stdout: JSON.stringify(prGreen.list) }, { stdout: '', exitCode: 1, stderr: 'HTTP 429: secondary rate limit' }])
    const result = await fetchPullRequest(exec, cliLocation, 'oborchers')
    expect(result.kind === 'error' && result.failure.kind).toBe('rate-limited')
  })

  test('unreadable JSON and GraphQL errors without data are failures', async () => {
    forgetTokens()
    const garbage = await fetchPullRequest(fakeExec([{ stdout: '<html>' }]).exec, cliLocation, 'oborchers')
    expect(garbage.kind === 'error' && garbage.failure.kind).toBe('server')
    const cutOff = await fetchPullRequest(fakeExec([{ stdout: '{"data":' }]).exec, cliLocation, 'oborchers')
    expect(cutOff.kind === 'error' && cutOff.failure.kind).toBe('server')
    const errors = await fetchPullRequest(fakeExec([{ stdout: JSON.stringify({ data: null, errors: [{ message: 'boom' }] }) }]).exec, cliLocation, 'oborchers')
    expect(errors.kind === 'error' && errors.failure.message).toBe('boom')
  })

  test('a detached head or a missing remote is an error, not a crash', async () => {
    const { exec, calls } = fakeExec([])
    const result = await fetchPullRequest(exec, { ...cliLocation, branch: null }, 'oborchers')
    expect(result.kind).toBe('error')
    expect(calls).toHaveLength(0)
  })
})

/** The by-number answer for a pull request, built from a branch list fixture. */
function byNumberAnswer(list: typeof prGreen.list, pullRequest: unknown = list.data.repository.pullRequests.nodes[0]): unknown {
  const { pullRequests: _nodes, ...scalars } = list.data.repository
  return { data: { repository: { ...scalars, isPrivate: false, pullRequest }, rateLimit: list.data.rateLimit } }
}

describe('fetchPullRequestByNumber', () => {
  test('resolves the id by number, then reads the detail like the branch lookup', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([{ stdout: JSON.stringify(byNumberAnswer(prGreen.list)) }, { stdout: JSON.stringify(prGreen.detail) }])
    const result = await fetchPullRequestByNumber(exec, cliLocation, 'oborchers', 14580)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.pr?.number).toBe(14580)
    expect(result.pr?.allowedMethods).toEqual(['merge', 'squash', 'rebase'])
    expect(result.pr?.checks.length).toBeGreaterThan(0)
    expect(result.rateLimit?.remaining).toBeGreaterThan(0)
    const graphql = calls.filter(call => call.argv[1] === 'api')
    expect(graphql).toHaveLength(2)
    expect(graphql[0]?.argv).toContain('owner=cli')
    expect(graphql[0]?.argv).toContain('name=cli')
    expect(graphql[0]?.argv).toContain('number=14580')
    expect(graphql[0]?.argv.some(arg => arg.startsWith('branch='))).toBe(false)
    expect(graphql[1]?.argv.some(arg => arg.startsWith('id=PR_'))).toBe(true)
  })

  test('reads a pull request of another branch, a merged one included', async () => {
    forgetTokens()
    const { exec } = fakeExec([{ stdout: JSON.stringify(byNumberAnswer(prMerged.list)) }, { stdout: JSON.stringify(prMerged.detail) }])
    const result = await fetchPullRequestByNumber(exec, { ...cliLocation, branch: 'other' }, 'oborchers', prMerged.detail.data.node.number)
    expect(result.kind === 'ok' && result.pr?.state).toBe('merged')
  })

  test('a number that is no pull request costs one query and gives null', async () => {
    forgetTokens()
    const { exec, calls } = fakeExec([{ stdout: JSON.stringify(byNumberAnswer(prGreen.list, null)) }])
    const result = await fetchPullRequestByNumber(exec, cliLocation, 'oborchers', 99999)
    expect(result.kind === 'ok' && result.pr).toBe(null)
    expect(calls.filter(call => call.argv[1] === 'api')).toHaveLength(1)
  })

  test('passes failures through and refuses a bad number or a missing remote without a call', async () => {
    forgetTokens()
    const failing = await fetchPullRequestByNumber(fakeExec([{ stdout: '', exitCode: 1, stderr: 'HTTP 429: secondary rate limit' }]).exec, cliLocation, 'oborchers', 5)
    expect(failing.kind === 'error' && failing.failure.kind).toBe('rate-limited')
    const garbage = await fetchPullRequestByNumber(fakeExec([{ stdout: '<html>' }]).exec, cliLocation, 'oborchers', 5)
    expect(garbage.kind === 'error' && garbage.failure.kind).toBe('server')
    const { exec, calls } = fakeExec([])
    expect((await fetchPullRequestByNumber(exec, cliLocation, 'oborchers', 0)).kind).toBe('error')
    expect((await fetchPullRequestByNumber(exec, cliLocation, 'oborchers', 1.5)).kind).toBe('error')
    expect((await fetchPullRequestByNumber(exec, { ...cliLocation, owner: null }, 'oborchers', 5)).kind).toBe('error')
    expect(calls).toHaveLength(0)
  })

  test('the id query is read-only and takes an Int number', () => {
    expect(PR_BY_NUMBER_QUERY).toContain('pullRequest(number: $number)')
    expect(PR_BY_NUMBER_QUERY).toContain('$number: Int!')
    expect(PR_BY_NUMBER_QUERY.includes('mutation')).toBe(false)
  })
})

describe('latestPerCheck', () => {
  test('a workflow that ran twice on the commit keeps only the later run of each check', () => {
    const checks = [
      makeCheck({ name: 'prepare', workflow: 'Review', jobId: 10, state: 'success' }),
      makeCheck({ name: 'review', workflow: 'Review', jobId: 11, state: 'skipped' }),
      makeCheck({ name: 'lint', workflow: 'CI', jobId: 12, state: 'success' }),
      makeCheck({ name: 'prepare', workflow: 'Review', jobId: 20, state: 'success' }),
      makeCheck({ name: 'review', workflow: 'Review', jobId: 21, state: 'success' }),
    ]
    const kept = latestPerCheck(checks)
    expect(kept.map((check) => `${check.name}:${check.jobId}`)).toEqual(['prepare:20', 'review:21', 'lint:12'])
  })

  test('the same name in different workflows stays twice; commit statuses are never merged', () => {
    const checks = [
      makeCheck({ name: 'build', workflow: 'A', jobId: 1 }),
      makeCheck({ name: 'build', workflow: 'B', jobId: 2 }),
      makeCheck({ name: 'ci/legacy', workflow: null, jobId: null }),
      makeCheck({ name: 'ci/legacy', workflow: null, jobId: null }),
    ]
    expect(latestPerCheck(checks)).toHaveLength(4)
  })
})
