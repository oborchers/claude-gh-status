// gh-status: the data contract every module shares and the $.state contract.
// values only: snapshots live in $.state and cross the engine boundary.

/** Where the session's working directory points, as git sees it. */
export type RepoLocation = {
  /** Absolute working directory the facts were read in (a worktree's own). */
  cwd: string;
  /** Current branch; null on a detached HEAD. */
  branch: string | null;
  /** GitHub owner and repository from the origin remote; null if none or not GitHub. */
  owner: string | null;
  repo: string | null;
  /** Login named by a repo-local `gh auth token -u <login>` credential helper, if any. */
  pinnedLogin: string | null;
};

/** How the account for a repository was chosen, shown in the pane. */
export type AccountSource = 'config' | 'pinned' | 'remembered' | 'active' | 'probed';

export type AccountChoice = {
  login: string;
  source: AccountSource;
};

/** Why no account could read the repository. */
export type AccountFailure = {
  kind: 'no-access' | 'not-logged-in' | 'gh-missing';
  /** Logins that were tried, in order. */
  tried: string[];
};

export type CheckState =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'action-required'
  | 'timed-out'
  | 'stale';

/** One check run or commit status on the head commit. */
export type Check = {
  name: string;
  /** Workflow name for an Actions check run, if known. */
  workflow: string | null;
  state: CheckState;
  isRequired: boolean;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
  /** Actions workflow run id, for `gh run view <id>`; null for other providers. */
  runId: number | null;
  /** Actions job id, if known. */
  jobId: number | null;
};

/** Live detail of a running or failed Actions job (fetched only while the pane is open). */
export type JobDetail = {
  jobId: number;
  runId: number;
  name: string;
  state: CheckState;
  /** The step now running, or the first failed step. */
  currentStep: string | null;
  failedStep: string | null;
  url: string | null;
};

export type ReviewState = 'approved' | 'changes-requested' | 'commented' | 'dismissed' | 'pending';

export type Review = {
  author: string;
  state: ReviewState;
  submittedAt: string | null;
};

export type ReviewRequest = {
  /** User login or team slug (`org/team`). */
  reviewer: string;
  isTeam: boolean;
};

export type CommentRef = {
  author: string;
  createdAt: string;
  /** lastEditedAt; null when the comment was never edited. */
  editedAt: string | null;
  url: string;
};

export type ReviewThread = {
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  /** Last comment in the thread. */
  last: CommentRef | null;
};

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export type MergeQueueState = 'queued' | 'awaiting-checks' | 'mergeable' | 'unmergeable' | 'locked';

export type MergeQueueEntry = {
  position: number;
  state: MergeQueueState;
  /** Seconds, if GitHub estimates it. */
  estimatedTimeToMerge: number | null;
  /** Checks on the merge group commit the queue tests; empty until GitHub creates it. */
  checks: Check[];
};

/** GitHub's own merge facts, lowercased. */
export type Mergeable = 'mergeable' | 'conflicting' | 'unknown';

export type MergeStateStatus =
  | 'clean'
  | 'blocked'
  | 'behind'
  | 'dirty'
  | 'draft'
  | 'has-hooks'
  | 'unknown'
  | 'unstable';

export type ReviewDecision = 'approved' | 'changes-requested' | 'review-required' | null;

/** One pull request as one GraphQL refresh saw it. */
export type PullRequest = {
  /** GraphQL node id, needed by the merge queue mutations. */
  id: string;
  number: number;
  /** Open, or the last merged/closed PR of the branch when none is open. */
  state: 'open' | 'merged' | 'closed';
  title: string;
  url: string;
  /** The repository is private: a browser signed in as another account sees a 404. */
  isPrivate: boolean;
  isDraft: boolean;
  /** Login of whoever merged it; set once merged. */
  mergedBy?: string | null;
  mergedAt?: string | null;
  closedAt?: string | null;
  headRefName: string;
  headOid: string;
  baseRefName: string;
  mergeable: Mergeable;
  mergeStateStatus: MergeStateStatus;
  reviewDecision: ReviewDecision;
  isInMergeQueue: boolean;
  isMergeQueueEnabled: boolean;
  mergeQueueEntry: MergeQueueEntry | null;
  autoMerge: { method: MergeMethod; enabledAt: string } | null;
  viewerCanMergeAsAdmin: boolean;
  /** Merge methods the repository allows. */
  allowedMethods: MergeMethod[];
  checks: Check[];
  reviews: Review[];
  reviewRequests: ReviewRequest[];
  threads: ReviewThread[];
  commentCount: number;
  lastComment: CommentRef | null;
};

/**
 * A transient failure that is being retried (GitHub 5xx, an unreadable answer,
 * network, timeout, rate limit). Carried by the snapshot it concerns, so it is
 * gone with the next good answer.
 */
export type Problem = {
  /** Short label for the hint: `504`, `bad response`, `network`, `timeout`, `rate limit`. */
  reason: string;
  /** ISO time of the first failed attempt of this streak. */
  since: string;
  /** ISO time of the latest failed attempt. */
  triedAt: string;
  /** Wait from `triedAt` to the next attempt: 15 s, 30 s, then 60 s. */
  retryInMs: number;
};

/** Everything the band and pane draw from. Exactly one `kind` at a time. */
export type Snapshot =
  | { kind: 'loading'; at: string }
  | { kind: 'not-a-repo'; at: string; cwd: string }
  | { kind: 'no-github-remote'; at: string; location: RepoLocation }
  | { kind: 'detached'; at: string; location: RepoLocation }
  | { kind: 'no-account'; at: string; location: RepoLocation; failure: AccountFailure }
  | { kind: 'no-pr'; at: string; location: RepoLocation; account: AccountChoice }
  | {
      kind: 'pr';
      at: string;
      location: RepoLocation;
      account: AccountChoice;
      pr: PullRequest;
      /** Set while the last attempt to refresh failed transiently: `pr` is then the last good data, `at` its age. */
      stale?: Problem | null;
    }
  | { kind: 'error'; at: string; message: string; location: RepoLocation | null; problem?: Problem };

export type BlockerKind =
  | 'draft'
  | 'conflict'
  | 'behind'
  | 'required-check-failed'
  | 'required-check-pending'
  | 'review-required'
  | 'changes-requested'
  | 'unresolved-threads'
  | 'branch-protection'
  | 'unknown';

export type Blocker = {
  kind: BlockerKind;
  /** Short English text for the band, e.g. "review required". */
  text: string;
  /** Names involved: check names, reviewers. */
  subjects: string[];
};

/** The overall verdict the band leads with. */
export type Verdict =
  | 'mergeable'
  | 'blocked'
  | 'checks-running'
  | 'in-queue'
  | 'auto-merge'
  | 'merged'
  | 'closed';

/** Pipeline counts for the band. */
export type PipelineSummary = {
  total: number;
  running: number;
  queued: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Earliest startedAt among running checks. */
  runningSince: string | null;
  failedRequired: string[];
  failedOptional: string[];
};

/** Derived view of a PR snapshot (src/status.ts). */
export type Status = {
  verdict: Verdict;
  blockers: Blocker[];
  pipeline: PipelineSummary;
  approvals: string[];
  changesRequestedBy: string[];
  requested: string[];
  unresolvedThreads: number;
  /** Why a mergeable PR deserves a second look, in priority order; empty otherwise. */
  caveats: string[];
  /** Counts of the merge group commit's checks while the PR is in the queue; null otherwise. */
  queuePipeline: PipelineSummary | null;
  /** Threads or comments newer than lastSeenAt, by author. */
  newActivity: CommentRef[];
};

/** Rate limit facts from the last GraphQL answer. */
export type RateLimit = {
  remaining: number;
  resetAt: string;
};

/** What every pending write binds: the repository, the pull request and the time the confirmation opened. */
export type PendingBase = {
  prNumber: number;
  /** `owner/repo` the person saw, lowercase compare. */
  repo: string;
  /** Node id of the pull request the person saw. */
  prId: string;
  baseRefName: string;
  login: string;
  /** Epoch ms the confirmation (or its admin step) was asked for; presses right after it are ignored. */
  openedAt: number;
};

/** A write action awaiting confirmation, inline in the band or the pane. */
export type PendingAction =
  | (PendingBase & { kind: 'merge'; headOid: string; method: MergeMethod })
  | (PendingBase & { kind: 'admin-merge'; headOid: string; method: MergeMethod; bypassed: Blocker[]; isSecondStep: boolean })
  | (PendingBase & { kind: 'enqueue'; headOid: string })
  | (PendingBase & { kind: 'dequeue' })
  | (PendingBase & { kind: 'auto-merge-on'; headOid: string; method: MergeMethod })
  | (PendingBase & { kind: 'auto-merge-off' });

export type ActionOutcome = {
  kind: PendingAction['kind'];
  isOk: boolean;
  message: string;
  at: string;
  /** True when the write may or may not have reached GitHub (timeout, network, no exit code). */
  isUnknown?: boolean;
};

declare module 'claude-code' {
  interface PluginState {
    'gh-status': {
      /** What the band and pane draw. */
      snapshot: Snapshot;
      /** Live Actions job details, only while the pane is open and checks run. */
      jobs: JobDetail[];
      /** Last rate limit seen. */
      rateLimit: RateLimit | null;
      /** ISO time the person last looked at the pane, per `owner/repo#number`. */
      lastSeen: Record<string, string>;
      /** ETags of the fast check, per request path. */
      etags: Record<string, string>;
      /** The write action the band and pane ask to confirm; null when none. */
      pending: PendingAction | null;
      /** Result of the last write action, shown in the pane. */
      outcome: ActionOutcome | null;
    };
  }
}
