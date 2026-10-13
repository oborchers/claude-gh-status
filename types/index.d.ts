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
  /** Login of the author; null for a deleted account. */
  author: string | null;
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
  /** Issues the pull request closes when merged (`closingIssuesReferences`); absent before 0.3.0 data. */
  linkedIssues?: { number: number; title: string; state: 'open' | 'closed' }[];
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
  | (PendingBase & { kind: 'auto-merge-off' })
  | (PendingBase & { kind: 'approve'; headOid: string; body: string })
  | (PendingBase & { kind: 'request-changes'; headOid: string; body: string })
  | (PendingBase & { kind: 'ready-for-review'; headOid: string });

/** Which list group a pull request falls in, in display order. */
export type ListGroup = 'yours' | 'requested' | 'waiting' | 'other';

/** Pipeline counts of one pull request's head commit. */
export type ListChecks = {
  passed: number;
  failed: number;
  pending: number;
  /** Of `pending`, the checks that wait to start (queued, waiting, requested, expected); absent counts as none. */
  queued?: number;
  total: number;
};

/** One open pull request in the repository list. */
export type ListItem = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  /** Author login; null for a deleted account. */
  author: string | null;
  createdAt: string;
  /** Label name and its GitHub hex color without '#'. */
  labels: { name: string; color: string }[];
  reviewDecision: ReviewDecision;
  /** Review requested from the viewer, directly or through a team (from a `review-requested:@me` search). */
  requestedFromViewer: boolean;
  /** Review requested from someone other than the viewer. */
  hasOtherRequests: boolean;
  checks: ListChecks | null;
  comments: number;
};

/** The repository's open pull requests, as one list refresh saw them. */
export type PrList =
  | { kind: 'loading'; at: string }
  | { kind: 'list'; at: string; location: RepoLocation; account: AccountChoice; items: ListItem[]; total: number; isTruncated: boolean; problem?: Problem | null }
  | { kind: 'error'; at: string; message: string; problem?: Problem };

/** Counts for the band when the branch has no pull request. */
export type ListCounts = {
  /** All open pull requests of the repository. */
  open: number;
  yours: number;
  requested: number;
  /** Open issues of the repository; absent until read. */
  issues?: number;
  at: string;
};

/** Which tab of the pane is showing. */
export type PaneTab = 'prs' | 'issues' | 'actions';

/** Where a tab of the pane stands: its level, page and focused row. Kept per tab for the session. */
export type TabState = {
  level: 'list' | 'detail';
  /** Zero-based page of the tab's list. */
  page: number;
  /** Key of the row that held the focus ring in the list (`issue-<n>`, `run-<id>`); null until known. */
  focus: string | null;
  /** The issue number or run id the detail shows; null on the list. */
  selected: number | null;
};

/** Which issue list group an issue falls in, in display order. */
export type IssueGroup = 'assigned' | 'opened' | 'mentioned' | 'other';

/** One open issue in the repository list. */
export type IssueItem = {
  id: string;
  number: number;
  title: string;
  url: string;
  /** Author login; null for a deleted account. */
  author: string | null;
  createdAt: string;
  /** Label name and its GitHub hex color without '#'. */
  labels: { name: string; color: string }[];
  assignees: string[];
  comments: number;
  /** Numbers of the pull requests that close the issue when merged. */
  linkedPrs: number[];
  /** The viewer is mentioned (from a `mentions:@me` search). */
  mentionsViewer: boolean;
};

/** The repository's open issues, as one list refresh saw them. */
export type IssueList =
  | { kind: 'loading'; at: string }
  | { kind: 'list'; at: string; location: RepoLocation; account: AccountChoice; items: IssueItem[]; total: number; isTruncated: boolean; problem?: Problem | null }
  | { kind: 'error'; at: string; message: string; problem?: Problem };

/** One comment of an issue, newest last. */
export type IssueComment = {
  author: string;
  isBot: boolean;
  createdAt: string;
  editedAt: string | null;
  body: string;
  url: string;
};

/** A pull request that closes an issue. */
export type LinkedPr = { number: number; title: string; state: 'open' | 'closed' | 'merged' };

/** One issue with what its detail view shows. */
export type Issue = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  /** `completed`, `not-planned`, `reopened` or null. */
  stateReason: string | null;
  author: string | null;
  createdAt: string;
  labels: { name: string; color: string }[];
  assignees: string[];
  milestone: string | null;
  /** Markdown of the issue body. */
  body: string;
  linkedPrs: LinkedPr[];
  /** The latest comments (up to 10), oldest first. */
  comments: IssueComment[];
  commentCount: number;
};

export type IssueSnapshot =
  | { kind: 'loading'; at: string; number: number }
  | { kind: 'issue'; at: string; location: RepoLocation; account: AccountChoice; issue: Issue; stale?: Problem | null }
  | { kind: 'error'; at: string; number: number; message: string; problem?: Problem };

/** One GitHub Actions workflow run. */
export type RunItem = {
  id: number;
  runNumber: number;
  workflowId: number;
  /** The workflow's name, as the run shows it. */
  name: string;
  branch: string | null;
  event: string;
  actor: string | null;
  /** queued, running or the conclusion once completed. */
  state: CheckState;
  headSha: string;
  createdAt: string;
  /** When the run (this attempt) started; null before. */
  startedAt: string | null;
  updatedAt: string;
  url: string;
  attempt: number;
};

/** Which run list group a run falls in, in display order. */
export type RunGroup = 'main' | 'branch' | 'recent';

/** The Actions runs the tab lists: the newest per workflow on the default branch and on this branch, then recent others. */
export type RunList =
  | { kind: 'loading'; at: string }
  | { kind: 'list'; at: string; location: RepoLocation; account: AccountChoice; defaultBranch: string; main: RunItem[]; branch: RunItem[]; recent: RunItem[]; problem?: Problem | null }
  | { kind: 'error'; at: string; message: string; problem?: Problem };

export type RunSnapshot =
  | { kind: 'loading'; at: string; runId: number }
  | { kind: 'run'; at: string; location: RepoLocation; account: AccountChoice; run: RunItem; jobs: JobDetail[]; stale?: Problem | null }
  | { kind: 'error'; at: string; runId: number; message: string; problem?: Problem };

/** The newest run per workflow on the default branch, for the band and the Actions tab label. */
export type MainStatus = {
  at: string;
  defaultBranch: string;
  /** The worst state among the newest runs: failure over running over success; null without runs. */
  worst: CheckState | null;
  /** The workflows whose newest run on the default branch failed, newest first. */
  failing: { name: string; runId: number; url: string }[];
};

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
      /** Open pull requests of the repository, while the pane shows the list. */
      list: PrList | null;
      /** Zero-based page of the list (25 per page). */
      listPage: number;
      /** Hide drafts in the list. */
      listHideDrafts: boolean;
      /** A pull request picked from the list; the detail pane shows it instead of the branch's. */
      selected: { number: number; repo: string } | null;
      /** Snapshot of the selected pull request; the band keeps showing `snapshot`. */
      selectedSnapshot: Snapshot | null;
      /** Yours and review-requested counts for the band. */
      counts: ListCounts | null;
      /** Which view the one pane shows: the list of open pull requests or the detail of one. */
      paneView: 'list' | 'detail';
      /** Key of the pane element that holds the focus ring (`pr-<n>` in the list); null until known. */
      paneFocus: string | null;
      /** Which tab the pane shows. The PRs tab keeps `paneView`, `listPage`, `selected` and `paneFocus`. */
      paneTab: PaneTab;
      /** Where the Issues tab stands. */
      issuesTab: TabState;
      /** Where the Actions tab stands. */
      actionsTab: TabState;
      /** Open issues of the repository, while the Issues tab shows its list. */
      issues: IssueList | null;
      /** The issue the Issues tab shows in detail. */
      issueSnapshot: IssueSnapshot | null;
      /** Actions runs, while the Actions tab shows its list. */
      runs: RunList | null;
      /** The run the Actions tab shows in detail. */
      runSnapshot: RunSnapshot | null;
      /** Newest runs on the default branch, for the band and the tab label. */
      mainStatus: MainStatus | null;
    };
  }
}
