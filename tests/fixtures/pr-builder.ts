// Builders for valid PullRequest and Check values; tests override what matters.

import type { Check, PullRequest, RepoLocation, Snapshot } from '../../src/model'

/** A passing, required-less check; override any field. */
export function makeCheck(overrides: Partial<Check> = {}): Check {
  return {
    name: 'build',
    workflow: null,
    state: 'success',
    isRequired: false,
    startedAt: null,
    completedAt: null,
    url: null,
    runId: null,
    jobId: null,
    ...overrides,
  }
}

/** A clean, open, approved pull request; override any field. */
export function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'PR_node',
    number: 42,
    state: 'open',
    title: 'add things',
    url: 'https://github.com/acme/app/pull/42',
    isPrivate: false,
    isDraft: false,
    headRefName: 'feat/things',
    headOid: 'abcdef0123456789abcdef0123456789abcdef01',
    baseRefName: 'main',
    mergeable: 'mergeable',
    mergeStateStatus: 'clean',
    reviewDecision: null,
    isInMergeQueue: false,
    isMergeQueueEnabled: false,
    mergeQueueEntry: null,
    autoMerge: null,
    viewerCanMergeAsAdmin: false,
    allowedMethods: ['merge', 'squash', 'rebase'],
    checks: [],
    reviews: [],
    reviewRequests: [],
    threads: [],
    commentCount: 0,
    lastComment: null,
    ...overrides,
  }
}

/** A repo location for snapshots. */
export function makeLocation(overrides: Partial<RepoLocation> = {}): RepoLocation {
  return { cwd: '/work/app', branch: 'feat/things', owner: 'acme', repo: 'app', pinnedLogin: null, ...overrides }
}

/** A 'pr' snapshot around a pull request. */
export function makeSnapshot(pr: PullRequest, location: RepoLocation = makeLocation()): Snapshot {
  return { kind: 'pr', at: '2026-01-01T00:00:00Z', location, account: { login: 'me', source: 'active' }, pr }
}
