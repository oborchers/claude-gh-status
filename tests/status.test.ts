import { describe, expect, test } from 'claude-code/testing'

import {
  activityAt,
  checkGlyph,
  commentWhen,
  deriveBlockers,
  deriveStatus,
  deriveVerdict,
  formatDuration,
  formatEta,
  mergeCaveats,
  mergeTone,
  nonCheckBlockers,
  queueLine,
  queueStateText,
  relativeTime,
  shortSha,
  summarizePipeline,
  transitions,
  verdictText,
} from '../src/status'
import type { BlockerKind, CheckState, PullRequest, Verdict } from '../src/model'
import { makeCheck, makeLocation, makePr, makeSnapshot } from './fixtures/pr-builder'

const kinds = (pr: PullRequest): BlockerKind[] => deriveBlockers(pr).map((blocker) => blocker.kind)
const verdictOf = (pr: PullRequest): Verdict => {
  const blockers = deriveBlockers(pr)
  return deriveVerdict(pr, blockers, summarizePipeline(pr.checks))
}
const ref = (author: string, createdAt: string, url: string, editedAt: string | null = null) => ({ author, createdAt, editedAt, url })

describe('summarizePipeline', () => {
  test('counts every state and ignores stale', () => {
    const states: CheckState[] = [
      'queued', 'running', 'success', 'failure', 'timed-out', 'action-required', 'cancelled', 'skipped', 'neutral', 'stale',
    ]
    const summary = summarizePipeline(states.map((state, i) => makeCheck({ name: `c${i}`, state })))
    expect(summary).toEqual({
      total: 9,
      running: 1,
      queued: 1,
      succeeded: 1,
      failed: 4,
      skipped: 2,
      runningSince: null,
      failedRequired: [],
      failedOptional: ['c3', 'c4', 'c5', 'c6'],
    })
  })

  test('picks the earliest running start and splits failures by requirement', () => {
    const summary = summarizePipeline([
      makeCheck({ name: 'a', state: 'running', startedAt: '2026-01-01T10:05:00Z' }),
      makeCheck({ name: 'b', state: 'running', startedAt: '2026-01-01T10:01:00Z' }),
      makeCheck({ name: 'c', state: 'running' }),
      makeCheck({ name: 'lint', state: 'failure', isRequired: true }),
      makeCheck({ name: 'e2e', state: 'failure' }),
    ])
    expect(summary.runningSince).toBe('2026-01-01T10:01:00Z')
    expect(summary.failedRequired).toEqual(['lint'])
    expect(summary.failedOptional).toEqual(['e2e'])
  })

  test('empty list gives zeros', () => {
    expect(summarizePipeline([]).total).toBe(0)
  })
})

describe('deriveBlockers', () => {
  const cases: { name: string; pr: PullRequest; kinds: BlockerKind[]; text?: string }[] = [
    { name: 'clean', pr: makePr(), kinds: [] },
    { name: 'draft', pr: makePr({ isDraft: true, mergeStateStatus: 'draft' }), kinds: ['draft'], text: 'draft' },
    { name: 'conflicting', pr: makePr({ mergeable: 'conflicting' }), kinds: ['conflict'], text: 'merge conflict' },
    { name: 'dirty', pr: makePr({ mergeStateStatus: 'dirty' }), kinds: ['conflict'] },
    { name: 'behind', pr: makePr({ mergeStateStatus: 'behind' }), kinds: ['behind'], text: 'branch behind base' },
    {
      name: 'one required failed',
      pr: makePr({ checks: [makeCheck({ name: 'lint', state: 'failure', isRequired: true })] }),
      kinds: ['required-check-failed'],
      text: 'lint failed (required)',
    },
    {
      name: 'two required failed',
      pr: makePr({
        checks: [
          makeCheck({ name: 'lint', state: 'failure', isRequired: true }),
          makeCheck({ name: 'test', state: 'timed-out', isRequired: true }),
        ],
      }),
      kinds: ['required-check-failed'],
      text: '2 required checks failed',
    },
    { name: 'optional failure is no blocker', pr: makePr({ checks: [makeCheck({ state: 'failure' })] }), kinds: [] },
    {
      name: 'two required running',
      pr: makePr({
        checks: [
          makeCheck({ name: 'a', state: 'running', isRequired: true }),
          makeCheck({ name: 'b', state: 'queued', isRequired: true }),
        ],
      }),
      kinds: ['required-check-pending'],
      text: '2 required checks running',
    },
    {
      name: 'changes requested',
      pr: makePr({
        reviewDecision: 'changes-requested',
        reviews: [{ author: 'bob', state: 'changes-requested', submittedAt: '2026-01-01T10:00:00Z' }],
      }),
      kinds: ['changes-requested'],
      text: 'changes requested by @bob',
    },
    { name: 'review required', pr: makePr({ reviewDecision: 'review-required' }), kinds: ['review-required'], text: 'review required' },
    {
      name: 'review required with reviewer',
      pr: makePr({ reviewDecision: 'review-required', reviewRequests: [{ reviewer: 'anna', isTeam: false }] }),
      kinds: ['review-required'],
      text: 'review required: @anna',
    },
    {
      name: 'blocked with threads',
      pr: makePr({
        mergeStateStatus: 'blocked',
        threads: [
          { isResolved: false, isOutdated: false, path: null, line: null, last: null },
          { isResolved: false, isOutdated: false, path: null, line: null, last: null },
          { isResolved: false, isOutdated: false, path: null, line: null, last: null },
          { isResolved: true, isOutdated: false, path: null, line: null, last: null },
          { isResolved: false, isOutdated: true, path: null, line: null, last: null },
        ],
      }),
      kinds: ['unresolved-threads'],
      text: '3 unresolved threads',
    },
    { name: 'blocked unexplained', pr: makePr({ mergeStateStatus: 'blocked' }), kinds: ['branch-protection'], text: 'blocked by branch protection' },
    { name: 'unknown', pr: makePr({ mergeStateStatus: 'unknown' }), kinds: ['unknown'], text: 'mergeability being computed' },
    { name: 'merged has none', pr: makePr({ state: 'merged', isDraft: true }), kinds: [] },
  ]
  for (const c of cases) {
    test(c.name, () => {
      expect(kinds(c.pr)).toEqual(c.kinds)
      if (c.text !== undefined) expect(deriveBlockers(c.pr)[0]?.text).toBe(c.text)
    })
  }

  test('subjects carry check names and reviewers', () => {
    const pr = makePr({
      reviewDecision: 'review-required',
      reviewRequests: [{ reviewer: 'anna', isTeam: false }, { reviewer: 'acme/core', isTeam: true }],
      checks: [makeCheck({ name: 'lint', state: 'failure', isRequired: true })],
    })
    const blockers = deriveBlockers(pr)
    expect(blockers[0]?.subjects).toEqual(['lint'])
    expect(blockers[1]?.subjects).toEqual(['anna', 'acme/core'])
    expect(blockers[1]?.text).toBe('review required: @anna, acme/core')
  })

  test('orders by importance', () => {
    const pr = makePr({
      isDraft: true,
      mergeable: 'conflicting',
      mergeStateStatus: 'behind',
      reviewDecision: 'review-required',
      checks: [
        makeCheck({ name: 'lint', state: 'failure', isRequired: true }),
        makeCheck({ name: 'test', state: 'running', isRequired: true }),
      ],
    })
    expect(kinds(pr)).toEqual(['draft', 'conflict', 'behind', 'required-check-failed', 'required-check-pending', 'review-required'])
  })

  test('changes-requested before review-required and uses only the latest review per author', () => {
    const pr = makePr({
      reviewDecision: 'changes-requested',
      reviews: [
        { author: 'bob', state: 'changes-requested', submittedAt: '2026-01-01T10:00:00Z' },
        { author: 'bob', state: 'approved', submittedAt: '2026-01-01T11:00:00Z' },
        { author: 'eve', state: 'changes-requested', submittedAt: '2026-01-01T10:30:00Z' },
        { author: 'eve', state: 'commented', submittedAt: '2026-01-01T12:00:00Z' },
      ],
    })
    expect(deriveBlockers(pr)[0]?.subjects).toEqual(['eve'])
  })

  test('a thread or protection blocker appears only when nothing else explains blocked', () => {
    expect(kinds(makePr({ mergeStateStatus: 'blocked', reviewDecision: 'review-required' }))).toEqual(['review-required'])
  })
})

describe('deriveVerdict', () => {
  const cases: { name: string; pr: PullRequest; verdict: Verdict }[] = [
    { name: 'merged', pr: makePr({ state: 'merged' }), verdict: 'merged' },
    { name: 'closed', pr: makePr({ state: 'closed' }), verdict: 'closed' },
    { name: 'in queue beats auto-merge', pr: makePr({ isInMergeQueue: true, autoMerge: { method: 'squash', enabledAt: 'x' } }), verdict: 'in-queue' },
    {
      name: 'auto-merge while blocked',
      pr: makePr({ autoMerge: { method: 'squash', enabledAt: 'x' }, reviewDecision: 'review-required', mergeStateStatus: 'blocked' }),
      verdict: 'auto-merge',
    },
    { name: 'auto-merge but already mergeable', pr: makePr({ autoMerge: { method: 'squash', enabledAt: 'x' } }), verdict: 'mergeable' },
    { name: 'clean', pr: makePr(), verdict: 'mergeable' },
    { name: 'unstable', pr: makePr({ mergeStateStatus: 'unstable' }), verdict: 'mergeable' },
    { name: 'has-hooks', pr: makePr({ mergeStateStatus: 'has-hooks' }), verdict: 'mergeable' },
    {
      name: 'required running',
      pr: makePr({ mergeStateStatus: 'blocked', checks: [makeCheck({ state: 'running', isRequired: true })] }),
      verdict: 'checks-running',
    },
    {
      name: 'optional running, no blockers, behind-free but unknown status',
      pr: makePr({ mergeStateStatus: 'unknown', checks: [makeCheck({ state: 'running' })] }),
      verdict: 'blocked',
    },
    { name: 'draft', pr: makePr({ isDraft: true, mergeStateStatus: 'draft' }), verdict: 'blocked' },
    { name: 'conflict', pr: makePr({ mergeable: 'conflicting', mergeStateStatus: 'dirty' }), verdict: 'blocked' },
    {
      name: 'running plus review required is blocked',
      pr: makePr({
        mergeStateStatus: 'blocked',
        reviewDecision: 'review-required',
        checks: [makeCheck({ state: 'running', isRequired: true })],
      }),
      verdict: 'blocked',
    },
    {
      name: 'failure plus running is blocked',
      pr: makePr({
        mergeStateStatus: 'blocked',
        checks: [makeCheck({ name: 'a', state: 'failure', isRequired: true }), makeCheck({ name: 'b', state: 'running', isRequired: true })],
      }),
      verdict: 'blocked',
    },
  ]
  for (const c of cases) test(c.name, () => expect(verdictOf(c.pr)).toBe(c.verdict))

  test('no blockers, odd status, optional checks running gives checks-running', () => {
    const pr = makePr({ mergeStateStatus: 'draft', checks: [makeCheck({ state: 'queued' })] })
    expect(deriveVerdict(pr, [], summarizePipeline(pr.checks))).toBe('checks-running')
  })
})

describe('deriveStatus', () => {
  const lastSeen = '2026-01-01T12:00:00Z'
  const pr = makePr({
    lastComment: ref('anna', '2026-01-01T13:00:00Z', 'u1'),
    threads: [
      { isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: ref('bob', '2026-01-01T14:00:00Z', 'u2') },
      { isResolved: true, isOutdated: false, path: 'b.ts', line: 2, last: ref('me', '2026-01-01T15:00:00Z', 'u3') },
      { isResolved: false, isOutdated: false, path: 'c.ts', line: 3, last: ref('carl', '2026-01-01T09:00:00Z', 'u4') },
      { isResolved: false, isOutdated: true, path: 'd.ts', line: 4, last: ref('anna', '2026-01-01T13:00:00Z', 'u1') },
    ],
    reviewRequests: [{ reviewer: 'dora', isTeam: false }, { reviewer: 'acme/core', isTeam: true }],
    reviews: [
      { author: 'anna', state: 'approved', submittedAt: '2026-01-01T09:00:00Z' },
      { author: 'bob', state: 'changes-requested', submittedAt: '2026-01-01T09:00:00Z' },
      { author: 'carl', state: 'approved', submittedAt: '2026-01-01T09:00:00Z' },
      { author: 'carl', state: 'dismissed', submittedAt: '2026-01-01T10:00:00Z' },
    ],
  })

  test('newActivity is newer than lastSeenAt, not by the viewer, deduplicated by url', () => {
    expect(deriveStatus(pr, 'me', lastSeen).newActivity.map((r) => r.url)).toEqual(['u1', 'u2'])
  })

  test('null lastSeenAt means nothing is new', () => {
    expect(deriveStatus(pr, 'me', null).newActivity).toEqual([])
  })

  test('viewer comments are excluded even when new', () => {
    expect(deriveStatus(pr, 'anna', lastSeen).newActivity.map((r) => r.url)).toEqual(['u2', 'u3'])
  })

  test('an edit after lastSeenAt counts as new activity, sorted by activity time', () => {
    const edited = makePr({
      lastComment: ref('bot', '2026-01-01T08:00:00Z', 'b1', '2026-01-01T14:30:00Z'),
      threads: [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: ref('bob', '2026-01-01T14:00:00Z', 'u2') }],
    })
    expect(deriveStatus(edited, 'me', lastSeen).newActivity.map((r) => r.url)).toEqual(['u2', 'b1'])
    expect(deriveStatus(edited, 'bot', lastSeen).newActivity.map((r) => r.url)).toEqual(['u2'])
  })

  test('an edit before lastSeenAt stays old even if the comment is older still', () => {
    const edited = makePr({ lastComment: ref('bot', '2026-01-01T08:00:00Z', 'b1', '2026-01-01T11:00:00Z') })
    expect(deriveStatus(edited, 'me', lastSeen).newActivity).toEqual([])
  })

  test('reviews, requests and threads', () => {
    const status = deriveStatus(pr, 'me', lastSeen)
    expect(status.approvals).toEqual(['anna'])
    expect(status.changesRequestedBy).toEqual(['bob'])
    expect(status.requested).toEqual(['@dora', 'acme/core'])
    expect(status.unresolvedThreads).toBe(2)
  })

  test('verdict and pipeline are included', () => {
    const status = deriveStatus(makePr(), 'me', null)
    expect(status.verdict).toBe('mergeable')
    expect(status.pipeline.total).toBe(0)
  })
})

describe('transitions', () => {
  const snap = (overrides: Partial<PullRequest>) => makeSnapshot(makePr(overrides))

  test('first load and branch switch give no toasts', () => {
    expect(transitions(null, snap({ state: 'merged' }), 'me')).toEqual([])
    expect(transitions(snap({}), snap({ number: 43, state: 'merged' }), 'me')).toEqual([])
    const other = makeSnapshot(makePr({ state: 'merged' }), makeLocation({ repo: 'other' }))
    expect(transitions(snap({}), other, 'me')).toEqual([])
    expect(transitions({ kind: 'loading', at: 'x' }, snap({}), 'me')).toEqual([])
    expect(transitions(snap({}), { kind: 'loading', at: 'x' }, 'me')).toEqual([])
  })

  test('no change gives no toasts', () => {
    expect(transitions(snap({}), snap({}), 'me')).toEqual([])
  })

  test('pipeline finished green', () => {
    const prev = snap({ mergeStateStatus: 'blocked', reviewDecision: 'review-required', checks: [makeCheck({ state: 'running' })] })
    const next = snap({ mergeStateStatus: 'blocked', reviewDecision: 'review-required', checks: [makeCheck({ state: 'success' })] })
    expect(transitions(prev, next, 'me')).toEqual(['PR #42: checks passed'])
  })

  test('pipeline finished with failures', () => {
    const prev = snap({ checks: [makeCheck({ name: 'a', state: 'running' }), makeCheck({ name: 'b', state: 'queued' })] })
    const next = snap({ checks: [makeCheck({ name: 'a', state: 'failure' }), makeCheck({ name: 'b', state: 'failure' })] })
    expect(transitions(prev, next, 'me')).toEqual(['PR #42: 2 checks failed'])
    const one = snap({ checks: [makeCheck({ name: 'a', state: 'failure' }), makeCheck({ name: 'b', state: 'success' })] })
    expect(transitions(prev, one, 'me')).toEqual(['PR #42: 1 check failed'])
  })

  test('required check fails while others still run', () => {
    const prev = snap({ checks: [makeCheck({ name: 'lint', state: 'running', isRequired: true }), makeCheck({ name: 'test', state: 'running' })] })
    const next = snap({ checks: [makeCheck({ name: 'lint', state: 'failure', isRequired: true }), makeCheck({ name: 'test', state: 'running' })] })
    expect(transitions(prev, next, 'me')).toEqual(['PR #42: lint failed'])
  })

  test('ready to merge suppresses checks passed', () => {
    const prev = snap({ mergeStateStatus: 'blocked', checks: [makeCheck({ state: 'running', isRequired: true })] })
    const next = snap({ checks: [makeCheck({ state: 'success', isRequired: true })] })
    expect(transitions(prev, next, 'me')).toEqual(['PR #42: ready to merge'])
  })

  test('new approval and changes requested', () => {
    const prev = snap({ reviews: [{ author: 'anna', state: 'approved', submittedAt: '2026-01-01T09:00:00Z' }] })
    const approved = snap({
      reviews: [
        { author: 'anna', state: 'approved', submittedAt: '2026-01-01T09:00:00Z' },
        { author: 'bob', state: 'approved', submittedAt: '2026-01-01T10:00:00Z' },
      ],
    })
    expect(transitions(prev, approved, 'me')).toEqual(['PR #42: approved by @bob'])
    const changes = snap({
      reviews: [
        { author: 'anna', state: 'approved', submittedAt: '2026-01-01T09:00:00Z' },
        { author: 'eve', state: 'changes-requested', submittedAt: '2026-01-01T10:00:00Z' },
      ],
    })
    expect(transitions(prev, changes, 'me')).toEqual(['PR #42: changes requested by @eve'])
  })

  test('a single new comment, a count for several, never the viewer', () => {
    const prev = snap({ lastComment: ref('anna', '2026-01-01T09:00:00Z', 'u1') })
    const one = snap({ lastComment: ref('bob', '2026-01-01T10:00:00Z', 'u2') })
    expect(transitions(prev, one, 'me')).toEqual(['PR #42: new comment by @bob'])
    const many = snap({
      lastComment: ref('bob', '2026-01-01T10:00:00Z', 'u2'),
      threads: [
        { isResolved: false, isOutdated: false, path: null, line: null, last: ref('carl', '2026-01-01T10:30:00Z', 'u3') },
        { isResolved: false, isOutdated: false, path: null, line: null, last: ref('dora', '2026-01-01T10:40:00Z', 'u4') },
      ],
    })
    expect(transitions(prev, many, 'me')).toEqual(['PR #42: 3 new comments'])
    expect(transitions(prev, one, 'bob')).toEqual([])
  })

  test('became mergeable', () => {
    const prev = snap({ isDraft: true, mergeStateStatus: 'draft' })
    expect(transitions(prev, snap({}), 'me')).toEqual(['PR #42: ready to merge'])
    expect(transitions(snap({}), snap({}), 'me')).toEqual([])
  })

  test('queue entry and exit', () => {
    const queued = snap({ isInMergeQueue: true, mergeQueueEntry: { position: 2, state: 'queued', estimatedTimeToMerge: null, checks: [] } })
    expect(transitions(snap({}), queued, 'me')).toEqual(['PR #42: added to merge queue (position 2)'])
    expect(transitions(queued, snap({ mergeStateStatus: 'blocked', reviewDecision: 'review-required' }), 'me')).toEqual(['PR #42: removed from merge queue'])
    expect(transitions(queued, snap({ state: 'merged' }), 'me')).toEqual(['PR #42: merged'])
  })

  test('merged', () => {
    expect(transitions(snap({}), snap({ state: 'merged' }), 'me')).toEqual(['PR #42: merged'])
    expect(transitions(snap({ state: 'closed' }), snap({ state: 'merged' }), 'me')).toEqual([])
  })

  test('new merge conflict', () => {
    const next = snap({ mergeable: 'conflicting', mergeStateStatus: 'dirty' })
    expect(transitions(snap({}), next, 'me')).toEqual(['PR #42: merge conflict'])
    expect(transitions(next, next, 'me')).toEqual([])
  })

  test('at most 3 toasts, most important first', () => {
    const prev = snap({ checks: [makeCheck({ name: 'a', state: 'running' })], lastComment: ref('anna', '2026-01-01T09:00:00Z', 'u1') })
    const next = snap({
      checks: [makeCheck({ name: 'a', state: 'failure' })],
      mergeable: 'conflicting',
      reviews: [{ author: 'bob', state: 'approved', submittedAt: '2026-01-01T10:00:00Z' }],
      lastComment: ref('carl', '2026-01-01T10:00:00Z', 'u2'),
      isInMergeQueue: true,
    })
    expect(transitions(prev, next, 'me')).toEqual([
      'PR #42: 1 check failed',
      'PR #42: merge conflict',
      'PR #42: approved by @bob',
    ])
  })

  test('an edited known comment toasts as updated, not as new, matched by url', () => {
    const prev = snap({ lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1') })
    const edited = snap({ lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1', '2026-01-01T10:00:00Z') })
    expect(transitions(prev, edited, 'me')).toEqual(['PR #42: comment updated by @bot'])
    const again = snap({ lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1', '2026-01-01T11:00:00Z') })
    expect(transitions(edited, again, 'me')).toEqual(['PR #42: comment updated by @bot'])
    expect(transitions(edited, edited, 'me')).toEqual([])
  })

  test('the viewer\'s own edits do not toast; several edits are counted', () => {
    const prev = snap({
      lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1'),
      threads: [{ isResolved: false, isOutdated: false, path: null, line: null, last: ref('bot2', '2026-01-01T09:00:00Z', 'b2') }],
    })
    const edited = snap({
      lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1', '2026-01-01T10:00:00Z'),
      threads: [{ isResolved: false, isOutdated: false, path: null, line: null, last: ref('bot2', '2026-01-01T09:00:00Z', 'b2', '2026-01-01T10:00:00Z') }],
    })
    expect(transitions(prev, edited, 'bot')).toEqual(['PR #42: comment updated by @bot2'])
    expect(transitions(prev, edited, 'me')).toEqual(['PR #42: 2 comments updated'])
    expect(transitions(prev, edited, 'bot2')).toEqual(['PR #42: comment updated by @bot'])
  })

  test('a new comment and an edit together give both toasts', () => {
    const prev = snap({ lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1') })
    const next = snap({
      lastComment: ref('bot', '2026-01-01T09:00:00Z', 'b1', '2026-01-01T10:00:00Z'),
      threads: [{ isResolved: false, isOutdated: false, path: null, line: null, last: ref('carl', '2026-01-01T10:30:00Z', 'u3') }],
    })
    expect(transitions(prev, next, 'me')).toEqual(['PR #42: new comment by @carl', 'PR #42: comment updated by @bot'])
  })

  test('approval ranks above comments and queue', () => {
    const prev = snap({})
    const next = snap({
      reviews: [{ author: 'bob', state: 'approved', submittedAt: '2026-01-01T10:00:00Z' }],
      lastComment: ref('carl', '2026-01-01T10:00:00Z', 'u2'),
      isInMergeQueue: true,
      mergeQueueEntry: { position: 1, state: 'queued', estimatedTimeToMerge: null, checks: [] },
    })
    expect(transitions(prev, next, 'me')).toEqual([
      'PR #42: approved by @bob',
      'PR #42: new comment by @carl',
      'PR #42: added to merge queue (position 1)',
    ])
  })
})

describe('formatting helpers', () => {
  const durations: [number, string][] = [
    [0, '0s'],
    [999, '0s'],
    [42_000, '42s'],
    [59_000, '59s'],
    [60_000, '1:00'],
    [134_000, '2:14'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_909_000, '1:05:09'],
    [-5000, '0s'],
  ]
  for (const [ms, text] of durations) test(`formatDuration(${ms})`, () => expect(formatDuration(ms)).toBe(text))

  const now = Date.parse('2026-01-10T12:00:00Z')
  const relative: [string, string][] = [
    ['2026-01-10T12:00:00Z', 'just now'],
    ['2026-01-10T11:59:10Z', 'just now'],
    ['2026-01-10T11:59:00Z', '1 min ago'],
    ['2026-01-10T11:56:00Z', '4 min ago'],
    ['2026-01-10T11:00:00Z', '1 h ago'],
    ['2026-01-10T09:00:00Z', '3 h ago'],
    ['2026-01-08T12:00:00Z', '2 d ago'],
    ['2026-01-10T13:00:00Z', 'just now'],
    ['garbage', 'just now'],
  ]
  for (const [iso, text] of relative) test(`relativeTime(${iso})`, () => expect(relativeTime(iso, now)).toBe(text))

  test('commentWhen says edited only for edited comments and measures from the edit', () => {
    expect(commentWhen(ref('bot', '2026-01-10T11:56:00Z', 'u'), now)).toBe('@bot 4 min ago')
    expect(commentWhen(ref('bot', '2026-01-08T12:00:00Z', 'u', '2026-01-10T11:58:00Z'), now)).toBe('@bot edited 2 min ago')
  })

  test('activityAt is the edit time, else the creation time', () => {
    expect(activityAt(ref('a', '2026-01-01T00:00:00Z', 'u'))).toBe('2026-01-01T00:00:00Z')
    expect(activityAt(ref('a', '2026-01-01T00:00:00Z', 'u', '2026-01-02T00:00:00Z'))).toBe('2026-01-02T00:00:00Z')
  })

  test('shortSha', () => {
    expect(shortSha('abcdef0123456789')).toBe('abcdef0')
    expect(shortSha('abc')).toBe('abc')
  })

  const glyphs: [CheckState, string][] = [
    ['success', '✓'], ['failure', '✗'], ['timed-out', '✗'], ['action-required', '✗'],
    ['queued', '◷'], ['running', '●'], ['cancelled', '⊘'], ['skipped', '–'], ['neutral', '–'], ['stale', '–'],
  ]
  for (const [state, glyph] of glyphs) test(`checkGlyph(${state})`, () => expect(checkGlyph(state)).toBe(glyph))

  test('verdictText', () => {
    const blockers = deriveBlockers(makePr({ reviewDecision: 'review-required' }))
    expect(verdictText('mergeable', [])).toBe('ready to merge')
    expect(verdictText('blocked', blockers)).toBe('blocked: review required')
    expect(verdictText('blocked', [])).toBe('blocked')
    expect(verdictText('checks-running', [])).toBe('checks running')
    expect(verdictText('in-queue', [])).toBe('in merge queue')
    expect(verdictText('auto-merge', [])).toBe('auto-merge on')
    expect(verdictText('merged', [])).toBe('merged')
    expect(verdictText('closed', [])).toBe('closed')
  })
})

describe('merge queue', () => {
  const entry = (overrides = {}) => ({ position: 1, state: 'awaiting-checks' as const, estimatedTimeToMerge: 240, checks: [], ...overrides })
  const queued = (checks = [makeCheck({ name: 'unit', state: 'running' as const })], overrides = {}) =>
    makePr({ isInMergeQueue: true, mergeQueueEntry: entry({ checks, ...overrides }) })

  test('state texts and ETA', () => {
    expect(queueStateText('queued')).toBe('queued')
    expect(queueStateText('awaiting-checks')).toBe('waiting for checks')
    expect(queueStateText('mergeable')).toBe('about to merge')
    expect(queueStateText('unmergeable')).toBe('will be removed')
    expect(queueStateText('locked')).toBe('locked')
    expect(formatEta(20)).toBe('<1 min')
    expect(formatEta(240)).toBe('~4 min')
    expect(formatEta(3900)).toBe('~1 h 5 min')
    expect(formatEta(7200)).toBe('~2 h')
  })

  test('queue line', () => {
    expect(queueLine(entry(), false)).toBe('in merge queue #1 · waiting for checks')
    expect(queueLine(entry(), true)).toBe('in merge queue #1 · waiting for checks · ~4 min')
    expect(queueLine(entry({ estimatedTimeToMerge: null }), true)).toBe('in merge queue #1 · waiting for checks')
    expect(queueLine(null, true)).toBe('in merge queue')
  })

  test('the queue checks get their own pipeline while the PR is queued', () => {
    const checks = [makeCheck({ name: 'a', state: 'running' }), makeCheck({ name: 'b' }), makeCheck({ name: 'c', state: 'skipped' })]
    const status = deriveStatus(queued(checks), 'me', null)
    expect(status.verdict).toBe('in-queue')
    expect(status.queuePipeline).toMatchObject({ total: 3, running: 1, succeeded: 1, skipped: 1 })
    expect(deriveStatus(makePr({ mergeQueueEntry: entry({ checks }) }), 'me', null).queuePipeline).toBeNull()
  })

  test('queue checks finishing red toast once; finishing green does not', () => {
    const running = makeSnapshot(queued([makeCheck({ name: 'unit', state: 'running' })]))
    const red = makeSnapshot(queued([makeCheck({ name: 'unit', state: 'failure' })]))
    const green = makeSnapshot(queued([makeCheck({ name: 'unit', state: 'success' })]))
    expect(transitions(running, red, 'me')).toEqual(['PR #42: merge queue checks failed'])
    expect(transitions(red, red, 'me')).toEqual([])
    expect(transitions(running, green, 'me')).toEqual([])
    const kicked = makeSnapshot(makePr({ mergeStateStatus: 'blocked', reviewDecision: 'review-required' }))
    const partial = makeSnapshot(queued([makeCheck({ name: 'a', state: 'failure' }), makeCheck({ name: 'b', state: 'running' })]))
    expect(transitions(partial, kicked, 'me')).toEqual(['PR #42: merge queue checks failed', 'PR #42: removed from merge queue'])
  })
})

describe('blocked verdict text', () => {
  test('names the first non-check blocker, never a check', () => {
    const failed = { kind: 'required-check-failed' as const, text: 'lint failed (required)', subjects: ['lint'] }
    const review = { kind: 'review-required' as const, text: 'review required: @ben', subjects: ['ben'] }
    const conflict = { kind: 'conflict' as const, text: 'merge conflict', subjects: [] }
    expect(verdictText('blocked', [failed])).toBe('blocked')
    expect(verdictText('blocked', [failed, review])).toBe('blocked: review required: @ben')
    expect(verdictText('blocked', [conflict, failed, review])).toBe('blocked: merge conflict')
    expect(nonCheckBlockers([failed, review, conflict])).toEqual([review, conflict])
  })
})

describe('mergeCaveats', () => {
  const caveatsOf = (pr: PullRequest): string[] => deriveStatus(pr, 'me', null).caveats
  const openThread = { isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: null }

  test('a clean PR has none', () => {
    expect(caveatsOf(makePr({ checks: [makeCheck()] }))).toEqual([])
  })

  test('failed checks, singular and plural', () => {
    expect(caveatsOf(makePr({ mergeStateStatus: 'unstable', checks: [makeCheck({ state: 'failure' })] }))).toEqual(['1 check failed'])
    expect(caveatsOf(makePr({ checks: [makeCheck({ state: 'failure' }), makeCheck({ state: 'timed-out' })] }))).toEqual(['2 checks failed'])
  })

  test('running or queued checks', () => {
    expect(caveatsOf(makePr({ checks: [makeCheck({ state: 'running' })] }))).toEqual(['checks running'])
    expect(caveatsOf(makePr({ checks: [makeCheck({ state: 'queued' })] }))).toEqual(['checks running'])
  })

  test('unresolved threads ignore resolved and outdated ones', () => {
    expect(caveatsOf(makePr({ threads: [openThread] }))).toEqual(['1 unresolved thread'])
    expect(caveatsOf(makePr({ threads: [openThread, openThread] }))).toEqual(['2 unresolved threads'])
    expect(caveatsOf(makePr({ threads: [{ ...openThread, isResolved: true }, { ...openThread, isOutdated: true }] }))).toEqual([])
  })

  test('changes requested without a review rule', () => {
    const reviews = [{ author: 'x', state: 'changes-requested' as const, submittedAt: '2026-01-01T00:00:00Z' }]
    expect(caveatsOf(makePr({ reviews }))).toEqual(['changes requested'])
  })

  test('priority order and verdict text', () => {
    const reviews = [{ author: 'x', state: 'changes-requested' as const, submittedAt: '2026-01-01T00:00:00Z' }]
    const pr = makePr({ checks: [makeCheck({ state: 'failure' }), makeCheck({ state: 'running' })], threads: [openThread], reviews })
    const caveats = caveatsOf(pr)
    expect(caveats).toEqual(['1 check failed', 'checks running', '1 unresolved thread', 'changes requested'])
    expect(verdictText('mergeable', [], caveats)).toBe('ready to merge · 1 check failed · checks running · 1 unresolved thread · changes requested')
    expect(verdictText('mergeable', [], [])).toBe('ready to merge')
  })

  test('none for blocked, merged and queued verdicts', () => {
    const checks = [makeCheck({ state: 'failure', isRequired: true })]
    expect(caveatsOf(makePr({ checks, mergeStateStatus: 'blocked' }))).toEqual([])
    expect(caveatsOf(makePr({ checks, state: 'merged' }))).toEqual([])
    expect(caveatsOf(makePr({ checks, isInMergeQueue: true }))).toEqual([])
    const status = deriveStatus(makePr({ checks }), 'me', null)
    expect(mergeCaveats(makePr(), { ...status, verdict: 'blocked' })).toEqual([])
  })

  test('mergeTone: failed is red, other caveats warn, none succeeds', () => {
    const toneOf = (pr: PullRequest) => mergeTone(deriveStatus(pr, 'me', null))
    expect(toneOf(makePr())).toBe('success')
    expect(toneOf(makePr({ checks: [makeCheck({ state: 'failure' }), makeCheck({ state: 'running' })] }))).toBe('failure')
    expect(toneOf(makePr({ checks: [makeCheck({ state: 'running' })] }))).toBe('pending')
    expect(toneOf(makePr({ threads: [openThread] }))).toBe('pending')
  })
})
