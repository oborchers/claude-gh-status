// What register.tsx hands the UI modules. The UI never touches $: it gets the
// surface's element table, plain data and handler closures built in register.tsx.

import type { Elements } from 'claude-code'

import type { ActionOutcome, JobDetail, MergeMethod, PendingAction, Snapshot, Status } from '../model'
import type { Palette } from './colors'

/** The element tables of the surfaces gh-status draws on. */
export type UiTable = Elements['terminal'] | Elements['desktop']

/** Everything a drawing reads. */
export type View = {
  snapshot: Snapshot
  /** Derived status; null unless snapshot.kind is 'pr'. */
  status: Status | null
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
  /**
   * The confirm press. `isSecondStep` is the admin step the pressed button was
   * drawn for; a press from another step than the live one is ignored, so a
   * double press of the first step's key never reaches the final confirmation.
   */
  confirmPending(isSecondStep?: boolean): void
  /** The cancel key: clears the pending action, no write. */
  cancelPending(): void
  selectMethod(method: MergeMethod): void
}
