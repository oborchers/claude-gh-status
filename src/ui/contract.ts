// What register.tsx hands the UI modules. The UI never touches $: it gets the
// surface's element table, plain data and handler closures built in register.tsx.

import type { Elements } from 'claude-code'

import type { ActionOutcome, CheckState, IssueList, IssueSnapshot, JobDetail, ListCounts, MainStatus, MergeMethod, PaneTab, PendingAction, PrList, RunList, RunSnapshot, Snapshot, Status } from '../model'
import type { Palette } from './colors'

/** The element tables of the surfaces gh-status draws on. */
export type UiTable = Elements['terminal'] | Elements['desktop']

/** Everything a drawing reads. */
export type View = {
  snapshot: Snapshot
  /** Derived status; null unless snapshot.kind is 'pr'. */
  status: Status | null
  /** True while the pane shows a pull request picked from the list instead of the branch's; the band never sets it. */
  isSelected?: boolean
  /** Live job details; empty unless the pane is open and checks run. */
  jobs: JobDetail[]
  /** Epoch ms of this draw, for relative times and running durations. */
  nowMs: number
  /** Cells the tree is laid out in (e.props.bodyColumns). */
  columns: number
  /** The surface drawn on; absent means terminal. */
  surface?: 'terminal' | 'desktop'
  /** The colors to paint with (the `colors` option). */
  palette: Palette
  /** Result of the last write action; null when none ran. */
  outcome: ActionOutcome | null
  /** The write action waiting for a confirm press; the band and the pane's Merge section both show its controls while set. */
  pending: PendingAction | null
  /** True while any confirmation waits, even one drawn only in the other site (the band's while the pane shows a pick). The pane then keeps `b` free. */
  hasPending?: boolean
  /** Open, yours and review-requested counts for the band; null until fetched. */
  counts?: ListCounts | null
  /** The default branch's failing workflows for the band; null or absent hides the segment (also when the `mainStatus` option is off). */
  mainStatus?: MainStatus | null
}

/** What the list view draws from. */
export type ListView = {
  list: PrList | null
  /** Zero-based page. */
  page: number
  /** Items per page; PAGE_SIZE when absent. */
  pageSize?: number
  hideDrafts: boolean
  /** The key of the Button that holds the focus ring (`pr-<n>`); null until it is known. */
  focusedKey: string | null
  counts: ListCounts | null
  nowMs: number
  columns: number
  surface?: 'terminal' | 'desktop'
  palette: Palette
}

/** Handlers the list view calls. */
export type ListHandlers = {
  selectPr(number: number): void
  nextPage(): void
  prevPage(): void
  toggleDrafts(): void
  refresh(): void
  closePane(): void
  openUrl(url: string): void
}

/** Handlers the band and pane call. Optional ones are absent until their wave lands. */
export type Handlers = {
  refresh(): void
  openPane(): void
  closePane(): void
  openOnGitHub(): void
  copyUrl(): void
  /** Opens a check's details page in the browser. */
  openUrl(url: string): void
  /** Puts a reference to a failed job into the prompt (wave 3). */
  ciToClaude?(): void
  /** Re-runs the failed jobs of the failed Actions runs; offered only while some run can be re-run. */
  rerunFailed?(): void
  /** Ask for a write action: sets it pending (the band and pane then show the confirmation); none of them writes by itself. */
  requestMerge?(): void
  requestEnqueue?(): void
  requestDequeue?(): void
  requestAutoMerge?(): void
  requestAdminMerge?(): void
  /** Review actions for the shown pull request: approve, request changes, take a draft out of draft. Each only sets the confirmation. */
  requestApprove?(): void
  requestChanges?(): void
  requestReady?(): void
  /** The review field's text, kept in the pending review's body (the one source of truth); it is posted only by the confirm press, never by Enter. */
  setReviewBody?(text: string): void
  /**
   * The confirm press. `isSecondStep` is the admin step the pressed button was
   * drawn for; a press from another step than the live one is ignored, so a
   * double press of the first step's key never reaches the final confirmation.
   * `drawnBody` is the review text the button was drawn with: a review whose
   * current text differs is refused, never posted.
   */
  confirmPending(isSecondStep?: boolean, drawnBody?: string): void
  /** The cancel key: clears the pending action, no write. */
  cancelPending(): void
  selectMethod(method: MergeMethod): void
  /** Shows this pull request of the repository in the pane (the list's rows call it). */
  selectPr?(number: number): void
  /** Leaves the selected pull request: the pane shows the list again. */
  back?(): void
  /** Shows the list of open pull requests in the pane. */
  openList?(): void
  /** An issue linked from the pull request: opens it in the Issues tab. */
  openLinkedIssue?(number: number): void
  /** A workflow run of the pipeline: opens it in the Actions tab. */
  openRun?(runId: number): void
  /** Opens the pane on the Actions tab list (the band's main-branch segment). */
  openActions?(): void
}

/** The tab row every view of the pane draws first. */
export type TabsView = {
  tab: PaneTab
  /** Open pull requests and open issues; absent until read. */
  prCount: number | null
  issueCount: number | null
  /** The worst newest run on the default branch; null until read. */
  mainWorst: CheckState | null
  /** True while a confirmation waits: the tab row is then drawn without buttons, so nothing moves away from it. */
  isLocked: boolean
  palette: Palette
}

/** What the Issues list draws from. */
export type IssuesView = {
  issues: IssueList | null
  page: number
  /** Items per page; PAGE_SIZE when absent. */
  pageSize?: number
  focusedKey: string | null
  /** The viewer's login, for the groups. */
  viewer: string
  nowMs: number
  columns: number
  surface?: 'terminal' | 'desktop'
  palette: Palette
}

/** What the Actions list draws from. */
export type RunsView = {
  runs: RunList | null
  page: number
  /** Items per page; PAGE_SIZE when absent. */
  pageSize?: number
  focusedKey: string | null
  nowMs: number
  columns: number
  surface?: 'terminal' | 'desktop'
  palette: Palette
}

/** What an issue's detail draws from. */
export type IssueDetailView = {
  snapshot: IssueSnapshot
  nowMs: number
  columns: number
  surface?: 'terminal' | 'desktop'
  palette: Palette
}

/** What a run's detail draws from. */
export type RunDetailView = {
  snapshot: RunSnapshot
  /** Result of the last rerun from this view; null when none ran. */
  outcome: ActionOutcome | null
  nowMs: number
  columns: number
  surface?: 'terminal' | 'desktop'
  palette: Palette
}

/** Handlers of the tab row, the Issues and Actions lists and their details. None of them writes to GitHub but `rerunRun`. */
export type RepoHandlers = {
  showTab(tab: PaneTab): void
  selectIssue(number: number): void
  selectRun(runId: number): void
  /** A pull request linked from an issue: opens it in the PRs tab. */
  openLinkedPr(number: number): void
  /** Up one level in the current tab: detail to list, the focus back on the row. */
  back(): void
  nextPage(): void
  prevPage(): void
  refresh(): void
  closePane(): void
  openUrl(url: string): void
  copyText(text: string): void
  /** Re-runs the failed jobs of the shown run, bound to its id. */
  rerunRun(runId: number): void
  /** Puts a reference to the shown run's failed job into the prompt. */
  ciToClaude(runId: number): void
}
