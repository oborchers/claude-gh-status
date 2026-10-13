import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, PluginOptions, Register, RenderElement, RenderSurface, Timer, UiOpenResult } from 'claude-code'

import { CHANGES_NEED_TEXT, RECHECK_FAILED, RULES_CHANGED, TEXT_CHANGED, availableActions, bypassedRules, buildPending, ciReference, clampReviewText, confirmStep, execute, executeRerun, isReviewTextMissing, isTooEarly, repoSlug, rerunnableRunIds, transitionToastPrefix, withMethod } from '../src/actions'
import type { ActionKind } from '../src/actions'
import { fastCheck } from '../src/etag'
import { runGh, tokenFor } from '../src/gh'
import type { Exec } from '../src/gh'
import { parseAccountConfig, resolveAccount } from '../src/accounts'
import type { AccountMemory } from '../src/accounts'
import { readLocation } from '../src/git'
import { fetchJobs } from '../src/jobs'
import { fetchIssue, fetchIssues, issueAfter, issueProblemOf, issueRowCount, issuesAfter, issuesProblemOf, lastIssuePage } from '../src/issues'
import { COUNTS_POLL_MS, COUNTS_RETRY_MS, LIST_POLL_MS, fetchCounts, fetchList, lastPage, listAfter, listDelayMs, listRowCount, pollDelayMs } from '../src/list'
import type { AccountChoice, IssueList, IssueSnapshot, ListCounts, MainStatus, MergeMethod, PaneTab, PendingAction, PrList, RateLimit, RepoLocation, RunList, RunSnapshot, Snapshot, TabState } from '../src/model'
import { fetchPullRequest, fetchPullRequestByNumber } from '../src/query'
import { MAIN_STATUS_POLL_MS, fetchMainStatus, fetchRun, fetchRuns, lastRunPage, runAfter, runDelayMs, runProblemOf, runReference, runRowCount, runsAfter, runsProblemOf } from '../src/runs'
import { createRefresher, etagsOf, mergeEtags, nextDelayMs } from '../src/scheduler'
import type { RefreshReason, RefreshTarget, RefresherDeps, SchedulerConfig } from '../src/scheduler'
import { deriveStatus } from '../src/status'
import { renderBand } from '../src/ui/band'
import { confirmTitle } from '../src/ui/confirm'
import { paletteFor } from '../src/ui/colors'
import type { Palette } from '../src/ui/colors'
import { count } from '../src/ui/format'
import { renderIssueDetail } from '../src/ui/issue-detail'
import { renderIssues } from '../src/ui/issues'
import { renderList } from '../src/ui/list'
import { paneRowCount, renderPane } from '../src/ui/pane'
import { renderRunDetail } from '../src/ui/run-detail'
import { renderRuns } from '../src/ui/runs'
import { renderTabs } from '../src/ui/tabs'
import type { Handlers, IssueDetailView, IssuesView, ListHandlers, ListView, RepoHandlers, RunDetailView, RunsView, TabsView, UiTable, View } from '../src/ui/contract'

const PANE_ID = 'gh-status'
const PANE_TITLE = 'PR'
/** Width the opening row count is estimated at; button wrapping is the only thing it changes. */
const PANE_ROWS_COLUMNS = 80

/** The tab row every view of the pane draws first. */
const TAB_ROW = 1

/** Rows asked for an issue's or run's detail: the body is long, the engine clamps and the person can drag. */
const ISSUE_DETAIL_ROWS = 30
const RUN_DETAIL_ROWS = 24

const DEFAULT_FAST_SECONDS = 5
const DEFAULT_IDLE_SECONDS = 30

/** Commands after which the pull request is likely to have changed. */
const CHANGING_COMMAND = /\bgit\s+(push|pull|checkout|switch|rebase|merge|commit|reset)\b|\bgh\s+(pr|run)\b/

const DEFAULT_COMMAND = 'pr'
/** The name that is always registered, so the mod stays reachable when the configured one is taken. */
const FALLBACK_COMMAND = 'gh-pr'
/** Registered as well when free: one command for the PRs, Issues and Actions tabs. */
const EXTRA_COMMAND = 'gh'
const COMMAND_NAME = /^[a-z0-9-]{1,32}$/
const PLUGIN_NAME = 'gh-status'

const ARGUMENT_HINT = '<number> | prs | issues (i) | actions (ac) | issue <n> | run <id> | list (or ls) | back | refresh | open | close | copy | fix | rerun | merge | queue | dequeue | auto | admin | approve | changes | ready (or rr | m | q | dq | a | x)'

const usageFor = (name: string): string => `Usage: /${name} [<number> (a pull request or an issue) | prs | issues (i) | actions (ac) | issue <n> | run <id> | list (ls) | back (up one level) | refresh | open | close | copy | fix | rerun (rr) | merge (m) | queue (q) | dequeue (dq) | auto (a) | admin (x) | approve | changes | ready]`

/** The configured command name, or 'pr' when it is not 1 to 32 characters of a-z, 0-9 and '-'. */
function commandNameOf(value: unknown): string {
  return typeof value === 'string' && COMMAND_NAME.test(value) ? value : DEFAULT_COMMAND
}

/** The write subcommands and their short aliases. */
const WRITE_COMMANDS: Record<string, 'merge' | 'enqueue' | 'dequeue' | 'auto' | 'admin-merge' | 'approve' | 'request-changes' | 'ready-for-review'> = {
  merge: 'merge',
  m: 'merge',
  queue: 'enqueue',
  q: 'enqueue',
  dequeue: 'dequeue',
  dq: 'dequeue',
  auto: 'auto',
  a: 'auto',
  admin: 'admin-merge',
  x: 'admin-merge',
  approve: 'approve',
  changes: 'request-changes',
  ready: 'ready-for-review',
}

/** How long after the mod's own write its matching transition toast is still dropped. */
const OWN_TOAST_MS = 120_000

const snapshotState = atom({ plugin: 'gh-status', key: 'snapshot' } as const, { kind: 'loading', at: '' })
const jobsState = atom({ plugin: 'gh-status', key: 'jobs' } as const, [])
const rateLimitState = atom({ plugin: 'gh-status', key: 'rateLimit' } as const, null)
const lastSeenState = atom({ plugin: 'gh-status', key: 'lastSeen' } as const, {})
const etagsState = atom({ plugin: 'gh-status', key: 'etags' } as const, {})
const pendingState = atom({ plugin: 'gh-status', key: 'pending' } as const, null)
const outcomeState = atom({ plugin: 'gh-status', key: 'outcome' } as const, null)
const selectedState = atom({ plugin: 'gh-status', key: 'selected' } as const, null)
const selectedSnapshotState = atom({ plugin: 'gh-status', key: 'selectedSnapshot' } as const, null)
const listState = atom({ plugin: 'gh-status', key: 'list' } as const, null)
const listPageState = atom({ plugin: 'gh-status', key: 'listPage' } as const, 0)
const listHideDraftsState = atom({ plugin: 'gh-status', key: 'listHideDrafts' } as const, false)
const countsState = atom({ plugin: 'gh-status', key: 'counts' } as const, null)
const paneViewState = atom({ plugin: 'gh-status', key: 'paneView' } as const, 'detail')
const paneFocusState = atom({ plugin: 'gh-status', key: 'paneFocus' } as const, null)
const FRESH_TAB: TabState = { level: 'list', page: 0, focus: null, selected: null }
const paneTabState = atom({ plugin: 'gh-status', key: 'paneTab' } as const, 'prs')
const issuesTabState = atom({ plugin: 'gh-status', key: 'issuesTab' } as const, FRESH_TAB)
const actionsTabState = atom({ plugin: 'gh-status', key: 'actionsTab' } as const, FRESH_TAB)
const issuesState = atom({ plugin: 'gh-status', key: 'issues' } as const, null)
const issueSnapshotState = atom({ plugin: 'gh-status', key: 'issueSnapshot' } as const, null)
const runsState = atom({ plugin: 'gh-status', key: 'runs' } as const, null)
const runSnapshotState = atom({ plugin: 'gh-status', key: 'runSnapshot' } as const, null)
const mainStatusState = atom({ plugin: 'gh-status', key: 'mainStatus' } as const, null)

/**
 * The timers of the running session, at module scope: a second session.start (hot reload,
 * resume) cancels the first one's before it builds its own, so timers never multiply.
 * `generation` lets the flights of an older start notice they must not re-arm anything.
 */
/** Options the render hooks read; set by register. */
const settings = { isMainShown: true }

const timers: { branch: Timer | null; list: Timer | null; counts: Timer | null; tab: Timer | null; main: Timer | null } = { branch: null, list: null, counts: null, tab: null, main: null }
let generation = 0

/** The repository (lowercase `owner/repo`) the Issues and Actions data was read for; a change of repository resets them. */
let tabsRepo: string | null = null

/** The etag of the last main-branch read and the repository it belongs to. */
const mainCache: { repo: string | null; etag: string | null } = { repo: null, etag: null }

/** What the PR views call to stop the Issues and Actions polling; set by session.start. */
const controls = { stopTab: (): void => {} }

function cancelTimers(): void {
  for (const key of ['branch', 'list', 'counts', 'tab', 'main'] as const) {
    timers[key]?.cancel()
    timers[key] = null
  }
}

/** One confirm press at a time: a second press while one is being handled is dropped. */
const confirmGuard = { isBusy: false }

/** One re-run at a time: a second press while one is running is dropped. */
const rerunGuard = { isBusy: false }

/** The transition toast the mod's own successful write makes redundant; dropped once it shows up. */
const ownToast: { prefix: string | null; untilMs: number } = { prefix: null, untilMs: 0 }

/** What session.start builds and the other hooks use; null until then. */
type Live = {
  /** Refreshes the branch's pull request and the picked one, then re-arms the timer for the interval the new state asks for. */
  run(reason: RefreshReason): Promise<void>
  /** Reads the repository's open pull requests now (single flight) and, while the pane shows the list, keeps reading them. */
  runList(): Promise<void>
  /** Stops the list polling; the pane closed or shows a pull request. */
  stopList(): void
  /** The directory changed: refreshes the branch's pull request, the counts and, while the pane shows the list, the list. */
  cwdChanged(): Promise<void>
  /** Polls what the pane shows now: the Issues or Actions list or detail (read at once), nothing for the PRs tab. */
  syncTab(): Promise<void>
  /** Reads what the Issues or Actions tab shows now, outside its rhythm. */
  refreshTab(): Promise<void>
  /** Whether a number is a pull request or an issue of the repository; GitHub numbers both together. */
  kindOfNumber(number: number): Promise<'pr' | 'issue'>
}

/** Which pull request a handler acts on: the branch's (the band) or the one the pane shows (the picked one, else the branch's). */
type Subject = 'branch' | 'pane'

type PrSnapshot = Extract<Snapshot, { kind: 'pr' }>

function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function configOf(options: PluginOptions): SchedulerConfig {
  return {
    fastIntervalSeconds: numberOption(options.fastIntervalSeconds, DEFAULT_FAST_SECONDS),
    idleIntervalSeconds: numberOption(options.idleIntervalSeconds, DEFAULT_IDLE_SECONDS),
    toasts: options.toasts !== false,
  }
}

function seenKey(snapshot: Extract<Snapshot, { kind: 'pr' }>): string {
  return `${snapshot.location.owner ?? ''}/${snapshot.location.repo ?? ''}#${snapshot.pr.number}`
}

type Pick = { number: number; repo: string }

/** The lowercase `owner/repo` a snapshot belongs to, or null when it has no repository. */
function snapshotSlug(snapshot: Snapshot): string | null {
  return 'location' in snapshot && snapshot.location !== null ? (repoSlug(snapshot.location)?.toLowerCase() ?? null) : null
}

/** True when the snapshot is the pull request the pick names: same number, same repository. */
function isPick(selected: Pick, snapshot: PrSnapshot): boolean {
  return snapshot.pr.number === selected.number && snapshotSlug(snapshot) === selected.repo
}

/**
 * The snapshot a subject shows. The band always shows the branch's. The pane shows
 * the picked pull request when one is set: its own snapshot, the branch's when the
 * pick is the branch's pull request, else a loading line until the first answer.
 */
async function subjectSnapshot($: EngineInterface, subject: Subject): Promise<{ snapshot: Snapshot; isSelected: boolean }> {
  const branch = await read($, snapshotState)
  const selected = subject === 'pane' ? await read($, selectedState) : null
  if (selected === null) return { snapshot: branch, isSelected: false }
  const own = await read($, selectedSnapshotState)
  if (own !== null && (own.kind !== 'pr' || isPick(selected, own))) return { snapshot: own, isSelected: true }
  if (branch.kind === 'pr' && isPick(selected, branch)) return { snapshot: branch, isSelected: true }
  return { snapshot: { kind: 'loading', at: '' }, isSelected: true }
}

/** The pull request a pending write is bound to, found among the pick and the branch's; null when neither is it any more. */
async function pendingTarget($: EngineInterface, pending: PendingAction): Promise<PrSnapshot | null> {
  const own = await read($, selectedSnapshotState)
  for (const candidate of [own, await read($, snapshotState)]) {
    if (candidate !== null && candidate.kind === 'pr' && candidate.pr.number === pending.prNumber && repoSlug(candidate.location)?.toLowerCase() === pending.repo) return candidate
  }
  return null
}

async function readView($: EngineInterface, columns: number, surface: 'terminal' | 'desktop', palette: Palette, subject: Subject): Promise<View> {
  const { snapshot, isSelected } = await subjectSnapshot($, subject)
  const jobs = await read($, jobsState)
  const lastSeen = await read($, lastSeenState)
  const outcome = await read($, outcomeState)
  const stored = await read($, pendingState)
  const nowMs = await $.clock.now()
  const status = snapshot.kind === 'pr' ? deriveStatus(snapshot.pr, snapshot.account.login, lastSeen[seenKey(snapshot)] ?? null) : null
  // With a pick set, a confirmation shows only where its pull request is shown.
  const isElsewhere = (await read($, selectedState)) !== null && stored !== null && !(snapshot.kind === 'pr' && snapshot.pr.number === stored.prNumber)
  const counts = await read($, countsState)
  const mainStatus = settings.isMainShown ? await read($, mainStatusState) : null
  return { snapshot, status, isSelected, jobs, nowMs, columns, surface, palette, outcome, pending: isElsewhere ? null : stored, hasPending: stored !== null, counts, mainStatus }
}

async function readListView($: EngineInterface, columns: number, surface: 'terminal' | 'desktop', palette: Palette): Promise<ListView> {
  return {
    list: await read($, listState),
    page: await read($, listPageState),
    hideDrafts: await read($, listHideDraftsState),
    focusedKey: await read($, paneFocusState),
    counts: await read($, countsState),
    nowMs: await $.clock.now(),
    columns,
    surface,
    palette,
  }
}

/** The tab row's data: the counts behind each name, the worst main-branch state, locked while a confirmation waits. */
async function readTabsView($: EngineInterface, palette: Palette): Promise<TabsView> {
  const counts = await read($, countsState)
  const list = await read($, listState)
  const main = settings.isMainShown ? await read($, mainStatusState) : null
  return {
    tab: await read($, paneTabState),
    prCount: counts !== null ? counts.open : list !== null && list.kind === 'list' ? list.total : null,
    issueCount: counts?.issues ?? null,
    mainWorst: main === null ? null : main.worst,
    isLocked: (await read($, pendingState)) !== null,
    palette,
  }
}

/** The number an issue snapshot is about. */
const issueNumberOf = (snapshot: IssueSnapshot): number => (snapshot.kind === 'issue' ? snapshot.issue.number : snapshot.number)

/** The id of the run a run snapshot is about. */
const runIdOf = (snapshot: RunSnapshot): number => (snapshot.kind === 'run' ? snapshot.run.id : snapshot.runId)

/** What the active tab draws below the tab row. */
async function readTabBody($: EngineInterface, table: UiTable, columns: number, surface: 'terminal' | 'desktop', palette: Palette, live: Live | null): Promise<RenderElement> {
  const tab = await read($, paneTabState)
  const nowMs = await $.clock.now()
  if (tab === 'prs') {
    if ((await read($, paneViewState)) === 'list') {
      const listView = await readListView($, columns, surface, palette)
      return renderList(table, listView, listHandlersFor($, live))
    }
    const view = await readView($, columns, surface, palette, 'pane')
    return renderPane(table, view, handlersFor($, live, surface, 'pane'))
  }
  const handlers = repoHandlersFor($, live, surface)
  if (tab === 'issues') {
    const state = await read($, issuesTabState)
    if (state.level === 'list' || state.selected === null) {
      const issues = await read($, issuesState)
      const branch = await read($, snapshotState)
      const viewer = issues !== null && issues.kind === 'list' ? issues.account.login : 'account' in branch ? branch.account.login : ''
      const view: IssuesView = { issues, page: state.page, focusedKey: state.focus, viewer, nowMs, columns, surface, palette }
      return renderIssues(table, view, handlers)
    }
    const stored = await read($, issueSnapshotState)
    const snapshot: IssueSnapshot = stored !== null && issueNumberOf(stored) === state.selected ? stored : { kind: 'loading', at: '', number: state.selected }
    const view: IssueDetailView = { snapshot, nowMs, columns, surface, palette }
    return renderIssueDetail(table, view, handlers)
  }
  const state = await read($, actionsTabState)
  if (state.level === 'list' || state.selected === null) {
    const view: RunsView = { runs: await read($, runsState), page: state.page, focusedKey: state.focus, nowMs, columns, surface, palette }
    return renderRuns(table, view, handlers)
  }
  const stored = await read($, runSnapshotState)
  const snapshot: RunSnapshot = stored !== null && runIdOf(stored) === state.selected ? stored : { kind: 'loading', at: '', runId: state.selected }
  const view: RunDetailView = { snapshot, outcome: null, nowMs, columns, surface, palette }
  return renderRunDetail(table, view, handlers)
}

async function openUrl($: EngineInterface, url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return
  for (const opener of ['open', 'xdg-open']) {
    try {
      const ran = await $.process.run([opener, url], { timeoutMs: 10_000 })
      if (ran.exitCode === 0) return
    } catch {
      // try the next opener
    }
  }
}

/** Opens the pane on its detail view, with the keyboard when asked (granted from an empty prompt). */
async function showPane($: EngineInterface, isFocused: boolean): Promise<UiOpenResult> {
  controls.stopTab()
  await update($, paneTabState, () => 'prs')
  await update($, paneViewState, () => 'detail')
  const { snapshot } = await subjectSnapshot($, 'pane')
  // Docked, the pane takes the height of the screen; inline it would get a third and cut off,
  // so ask for what the content needs. A size the person dragged still wins (engine).
  const view = await readView($, PANE_ROWS_COLUMNS, 'terminal', paletteFor(undefined), 'pane')
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, rows: TAB_ROW + paneRowCount(view, { openRun: () => undefined }), ...(isFocused ? { focus: true } : {}) })
  if (snapshot.kind === 'pr') {
    const nowMs = await $.clock.now()
    await update($, lastSeenState, seen => ({ ...seen, [seenKey(snapshot)]: new Date(nowMs).toISOString() }))
  }
  return opened
}

async function openPane($: EngineInterface, live: Live | null): Promise<string> {
  // With the keyboard, so 1, 2, 3 and the row keys work at once; Esc gives it back to the prompt.
  const opened = await showPane($, true)
  if (live !== null) void live.run('command')
  return opened.isPlaced ? 'PR pane opened.' : `PR pane opened but not drawn yet: ${opened.reason}`
}

async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE_ID })
}

async function openOnGitHub($: EngineInterface, subject: Subject): Promise<boolean> {
  const { snapshot } = await subjectSnapshot($, subject)
  if (snapshot.kind !== 'pr') return false
  const exec: Exec = (argv, init) => $.process.run(argv, init)
  const { pr, location, account } = snapshot
  const ran = await runGh(exec, ['pr', 'view', String(pr.number), '--web', '-R', `${location.owner ?? ''}/${location.repo ?? ''}`], { login: account.login, cwd: location.cwd })
  if (!ran.isOk) await openUrl($, pr.url)
  // The browser may be signed in to another github.com account, which gets a 404 on a private repository.
  if (pr.isPrivate && account.source !== 'active') await $.ui.toast(`gh-status: if GitHub shows 404, sign in to github.com as @${account.login}`)
  return true
}

async function copyUrl($: EngineInterface, surface: RenderSurface | undefined, subject: Subject): Promise<string | null> {
  const { snapshot } = await subjectSnapshot($, subject)
  if (snapshot.kind !== 'pr') return null
  await $.ui.copy({ text: snapshot.pr.url, surface })
  return snapshot.pr.url
}

/**
 * Asks for a write action: sets `pending`, which the band and the pane's Merge
 * section then show as a confirmation. The write happens in confirmPending, after
 * the person's confirm press. A slash command also opens the pane with the keyboard
 * (`isFromCommand`); a button press opens nothing, the person is already there.
 */
async function requestAction($: EngineInterface, kind: ActionKind, subject: Subject, isFromCommand = false): Promise<string> {
  // A confirm is being handled: a new request must not replace what it acts on.
  if (confirmGuard.isBusy) return 'A confirmation is in progress, try again in a moment.'
  const { snapshot } = await subjectSnapshot($, subject)
  if (snapshot.kind !== 'pr') return 'No pull request for this branch.'
  const openedAt = await $.clock.now()
  const pending = buildPending(kind, snapshot, undefined, openedAt)
  if (pending === null) {
    const offered = availableActions(snapshot.pr, snapshot.account.login)
    return `That is not available for PR #${snapshot.pr.number} right now. Available: ${offered.length === 0 ? 'nothing' : offered.join(', ')}.`
  }
  await update($, outcomeState, () => null)
  await update($, pendingState, () => pending)
  // Warm the account token now, so the write does not wait on a process spawn after the press.
  void tokenFor((argv, init) => $.process.run(argv, init), pending.login)
  if (!isFromCommand) return `Confirm: ${confirmTitle(pending)}.`
  const opened = await showPane($, true)
  if (!opened.isPlaced) return `Confirm in the band, the pane is not drawn yet (${opened.reason}): ${confirmTitle(pending)}.`
  // focus is a request: a band the person holds refuses it, and then y reaches the band, which asks the same.
  const isFocused = (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isFocused)
  if (!isFocused) await $.ui.toast('gh-status: press y in the band, or click the pane to focus it')
  return `Confirm in the pane: ${confirmTitle(pending)}.`
}

/** Auto-merge is one toggle: off when it is on, on when it is off. */
async function requestAutoMerge($: EngineInterface, subject: Subject, isFromCommand = false): Promise<string> {
  const { snapshot } = await subjectSnapshot($, subject)
  if (snapshot.kind !== 'pr') return 'No pull request for this branch.'
  return requestAction($, snapshot.pr.autoMerge === null ? 'auto-merge-on' : 'auto-merge-off', subject, isFromCommand)
}

async function cancelPending($: EngineInterface): Promise<void> {
  await update($, pendingState, () => null)
}

/**
 * The review field changed: the text lives only in the pending review's body, written
 * in one update, so the field, the confirmation and the press all read the same value.
 * Enter in the field comes here as well and posts nothing; only confirmPending writes.
 */
async function setReviewBody($: EngineInterface, text: string): Promise<void> {
  const body = clampReviewText(text)
  await update($, pendingState, (current: PendingAction | null) =>
    current !== null && (current.kind === 'approve' || current.kind === 'request-changes') ? { ...current, body } : current,
  )
}

async function selectMethod($: EngineInterface, method: MergeMethod): Promise<void> {
  const pending = await read($, pendingState)
  if (pending === null) return
  const target = await pendingTarget($, pending)
  if (target === null) return
  const allowed = target.pr.allowedMethods
  await update($, pendingState, (current: PendingAction | null) => (current === null ? null : withMethod(current, method, allowed)))
}

/**
 * The confirm press, the only path to a write. `isSecondStep` is the admin step
 * the pressed button belonged to; a press from a stale drawing is ignored, and
 * so is one right after the confirmation (or its second step) was asked for. The write acts on
 * a fresh full fetch, never on the stored snapshot.
 */
async function confirmPending($: EngineInterface, live: Live | null, isSecondStep: boolean, drawnBody?: string): Promise<void> {
  if (confirmGuard.isBusy) return
  confirmGuard.isBusy = true
  try {
    const pending = await read($, pendingState)
    if (pending === null) return
    const step = confirmStep(pending, isSecondStep)
    if (step === 'ignore') return
    const pressedAt = await $.clock.now()
    if (isTooEarly(pending, pressedAt)) return
    if ((pending.kind === 'approve' || pending.kind === 'request-changes') && pending.body !== drawnBody) {
      // The press belongs to a drawing with other text than the live one: nothing is posted, the person looks again.
      await update($, outcomeState, () => ({ kind: pending.kind, isOk: false, message: TEXT_CHANGED, at: new Date(pressedAt).toISOString() }))
      return
    }
    if (isReviewTextMissing(pending)) {
      // Refused before any call: the confirmation stays up with the reason.
      await update($, outcomeState, () => ({ kind: pending?.kind ?? 'request-changes', isOk: false, message: CHANGES_NEED_TEXT, at: new Date(pressedAt).toISOString() }))
      return
    }
    if (step === 'advance') {
      await update($, pendingState, (current: PendingAction | null) =>
        current !== null && current.kind === 'admin-merge' && !current.isSecondStep ? { ...current, isSecondStep: true, openedAt: pressedAt } : current,
      )
      return
    }
    const exec: Exec = (argv, init) => $.process.run(argv, init)
    // The pull request the confirmation is bound to: the pick's or the branch's, never another one.
    const stored = await pendingTarget($, pending)
    const branch = await read($, snapshotState)
    const isBranchPr = branch.kind === 'pr' && isPick({ number: pending.prNumber, repo: pending.repo }, branch)
    const fail = async (message: string): Promise<void> => {
      await update($, outcomeState, () => ({ kind: pending.kind, isOk: false, message, at: new Date(pressedAt).toISOString() }))
    }
    if (stored === null) return await fail('no pull request to act on, review again')
    // The stored snapshot may be seconds old: re-read the pull request in full right before the write.
    // The branch's own pull request is looked up by its branch, any other one by its number.
    const fetched = isBranchPr ? await fetchPullRequest(exec, stored.location, pending.login) : await fetchPullRequestByNumber(exec, stored.location, pending.login, pending.prNumber)
    if (fetched.kind !== 'ok' || fetched.pr === null) return await fail(RECHECK_FAILED)
    const freshPr = fetched.pr
    const latest: Snapshot = { kind: 'pr', at: new Date(await $.clock.now()).toISOString(), location: stored.location, account: stored.account, pr: freshPr }
    // The fresh picture goes to the slot it belongs to: the pick's when it is the picked pull request, the branch's when it is the branch's.
    const picked = await read($, selectedState)
    const isPicked = picked !== null && isPick(picked, latest)
    if (isPicked) await update($, selectedSnapshotState, () => latest)
    if (isBranchPr) await update($, snapshotState, () => latest)
    // The confirmation may have been cancelled or changed while we fetched: act on what is pending now, or not at all.
    const isSame = (current: PendingAction | null): boolean => current !== null && JSON.stringify(current) === JSON.stringify(pending)
    if (!isSame(await read($, pendingState))) return
    let wasCancelled = false
    const isStillPending = async (): Promise<boolean> => {
      const isStill = isSame(await read($, pendingState))
      if (!isStill) wasCancelled = true
      return isStill
    }
    const outcome = await execute(exec, pending, latest, new Date(await $.clock.now()).toISOString(), isStillPending)
    if (wasCancelled) return
    await update($, outcomeState, () => outcome)
    if (!outcome.isOk) {
      if (outcome.message === RULES_CHANGED && pending.kind === 'admin-merge') {
        // Show the rules as they are now, back at step 1.
        await update($, pendingState, (current: PendingAction | null) =>
          isSame(current) ? { ...pending, bypassed: bypassedRules(freshPr), isSecondStep: false, openedAt: pressedAt } : current,
        )
      }
      if (outcome.isUnknown !== true) return
      // Timeout or unknown failure: the write may have gone through. Do not leave the confirmation armed.
      await update($, pendingState, () => null)
      await $.ui.toast(`PR #${pending.prNumber}: result unknown, refreshed status`)
      if (live !== null) void live.run('command')
      return
    }
    await update($, pendingState, () => null)
    // The action's own toast says it; the transition toast of the next refresh would say it twice.
    ownToast.prefix = transitionToastPrefix(pending.kind, pending.prNumber)
    ownToast.untilMs = pressedAt + OWN_TOAST_MS
    await $.ui.toast(outcome.message)
    if (live !== null) void live.run('command')
  } finally {
    confirmGuard.isBusy = false
  }
}

/** The lowercase `owner/repo` of the repository the session's directory is in; null when it is in none. */
async function currentRepo($: EngineInterface): Promise<string | null> {
  const location = await readLocation((argv, init) => $.process.run(argv, init), await $.session.cwd())
  return location === null ? null : (repoSlug(location)?.toLowerCase() ?? null)
}

/**
 * After a change of repository the pick, its snapshot and any pending write belong to the one
 * before: all three are dropped. `slug` is the lowercase `owner/repo` now, or null when there is none.
 */
async function dropIfRepoChanged($: EngineInterface, slug: string | null): Promise<void> {
  if (tabsRepo !== null && tabsRepo !== (slug ?? '')) {
    tabsRepo = null
    mainCache.repo = null
    mainCache.etag = null
    await update($, issuesTabState, () => FRESH_TAB)
    await update($, actionsTabState, () => FRESH_TAB)
    await update($, issuesState, () => null)
    await update($, issueSnapshotState, () => null)
    await update($, runsState, () => null)
    await update($, runSnapshotState, () => null)
    await update($, mainStatusState, () => null)
  }
  const selected = await read($, selectedState)
  const pending = await read($, pendingState)
  const isChanged = (repo: string): boolean => repo !== (slug ?? '')
  if (!(selected !== null && isChanged(selected.repo)) && !(pending !== null && isChanged(pending.repo))) return
  await update($, selectedState, () => null)
  await update($, selectedSnapshotState, () => null)
  await update($, pendingState, () => null)
  await update($, outcomeState, () => null)
}

/**
 * Shows another open pull request of the repository in the pane: sets the pick, drops
 * the confirmation and result of the one before, switches the same pane to its detail
 * view and refreshes. The band keeps showing the branch's pull request.
 */
async function selectPr($: EngineInterface, live: Live | null, number: number): Promise<string> {
  if (!Number.isSafeInteger(number) || number < 1) return `${number} is not a pull request number.`
  if (confirmGuard.isBusy) return 'A confirmation is in progress, try again in a moment.'
  // The pick belongs to the repository it was made in: a later change of repository drops it.
  const repo = await currentRepo($)
  if (repo === null) return 'No GitHub repository here.'
  await update($, selectedState, () => ({ number, repo }))
  await update($, selectedSnapshotState, () => null)
  await update($, pendingState, () => null)
  await update($, outcomeState, () => null)
  // The list is not on screen any more: it stops being read.
  if (live !== null) live.stopList()
  const opened = await showPane($, true)
  if (live !== null) void live.run('command')
  return opened.isPlaced ? `Showing PR #${number} in the pane.` : `PR #${number} selected but the pane is not drawn yet: ${opened.reason}`
}

/** Drops the pick with its snapshot, confirmation and result; false when nothing was picked. */
async function leaveSelection($: EngineInterface): Promise<boolean> {
  const selected = await read($, selectedState)
  if (selected === null) return false
  await update($, selectedState, () => null)
  await update($, selectedSnapshotState, () => null)
  await update($, pendingState, () => null)
  await update($, outcomeState, () => null)
  return true
}

/**
 * Leaves the picked pull request: the same pane shows the list again, the ring back on
 * the row it was opened from. The old list data stays visible until the fresh one arrives.
 */
async function back($: EngineInterface, live: Live | null): Promise<void> {
  if (confirmGuard.isBusy) return
  const selected = await read($, selectedState)
  await leaveSelection($)
  const key = selected === null ? null : `pr-${selected.number}`
  if (key !== null) await update($, paneFocusState, () => key)
  await showList($, live, false)
  if (key === null) return
  try {
    await $.ui.focus({ requestId: PANE_ID, key })
  } catch {
    // the ring stays where the engine put it; the marker already follows paneFocus
  }
}

/** Switches the pane to its list view, with the keyboard when asked, sized to its current page, and reads the list now. */
async function showList($: EngineInterface, live: Live | null, isFocused: boolean): Promise<UiOpenResult> {
  controls.stopTab()
  await update($, paneTabState, () => 'prs')
  await update($, paneViewState, () => 'list')
  const rows = TAB_ROW + listRowCount(await read($, listState), await read($, listPageState), await read($, listHideDraftsState))
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, rows, ...(isFocused ? { focus: true } : {}) })
  if (live !== null) void live.runList()
  return opened
}

/** Shows the list of open pull requests in the pane, with the keyboard. */
async function openList($: EngineInterface, live: Live | null): Promise<string> {
  const opened = await showList($, live, true)
  return opened.isPlaced ? 'Open PRs listed in the pane.' : `Open PRs listed but the pane is not drawn yet: ${opened.reason}`
}

async function setPage($: EngineInterface, step: 1 | -1): Promise<void> {
  const last = lastPage(await read($, listState), await read($, listHideDraftsState))
  await update($, listPageState, (page: number) => Math.min(Math.max(page + step, 0), last))
}

async function toggleDrafts($: EngineInterface): Promise<void> {
  await update($, listHideDraftsState, (isHidden: boolean) => !isHidden)
  await update($, listPageState, () => 0)
}

/** The handler closures of the list view. They read and open; none of them writes to GitHub. */
function listHandlersFor($: EngineInterface, live: Live | null): ListHandlers {
  return {
    selectPr: number => void selectPr($, live, number),
    nextPage: () => void setPage($, 1),
    prevPage: () => void setPage($, -1),
    toggleDrafts: () => void toggleDrafts($),
    refresh: () => {
      if (live !== null) void live.runList()
    },
    closePane: () => void closePane($),
    openUrl: url => void openUrl($, url),
  }
}

/** Whether a confirmation waits: then no tab switch or cross link may move away from it. */
async function isConfirming($: EngineInterface): Promise<boolean> {
  return (await read($, pendingState)) !== null
}

function readTabState($: EngineInterface, tab: 'issues' | 'actions'): Promise<TabState> {
  return tab === 'issues' ? read($, issuesTabState) : read($, actionsTabState)
}

async function patchTabState($: EngineInterface, tab: 'issues' | 'actions', patch: (state: TabState) => TabState): Promise<void> {
  if (tab === 'issues') await update($, issuesTabState, patch)
  else await update($, actionsTabState, patch)
}

/** Rows the view of an Issues or Actions tab needs, without the tab row. */
async function tabViewRows($: EngineInterface, tab: 'issues' | 'actions'): Promise<number> {
  const state = await readTabState($, tab)
  if (tab === 'issues') return state.level === 'list' ? issueRowCount(await read($, issuesState), state.page) : ISSUE_DETAIL_ROWS
  return state.level === 'list' ? runRowCount(await read($, runsState), state.page) : RUN_DETAIL_ROWS
}

/**
 * Puts the focus ring where the tab was left: the remembered row in a list, the tab's own
 * button in a detail. A request: where the engine refuses it (no keyboard, or `claude plugin
 * test`) the ring stays where it is.
 */
async function restoreFocus($: EngineInterface, tab: PaneTab): Promise<void> {
  let key: string | null
  if (tab === 'prs') {
    const focus = await read($, paneFocusState)
    key = (await read($, paneViewState)) === 'list' ? (focus !== null && focus.startsWith('pr-') ? focus : null) : 'tab-prs'
  } else {
    const state = await readTabState($, tab)
    key = state.level === 'list' ? state.focus : `tab-${tab}`
  }
  if (key === null) return
  try {
    await $.ui.focus({ requestId: PANE_ID, key })
  } catch {
    // the ring stays where the engine put it
  }
}

/** Opens the pane on what the active tab shows, sized to it, and starts the poll that view needs. */
async function showTabView($: EngineInterface, live: Live | null, isFocused: boolean): Promise<UiOpenResult> {
  const tab = await read($, paneTabState)
  if (tab === 'prs') {
    if ((await read($, paneViewState)) === 'list') return await showList($, live, isFocused)
    const opened = await showPane($, isFocused)
    if (live !== null) void live.run('command')
    return opened
  }
  if (live !== null) live.stopList()
  const rows = TAB_ROW + (await tabViewRows($, tab))
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, rows, ...(isFocused ? { focus: true } : {}) })
  if (live !== null) void live.syncTab()
  return opened
}

/**
 * Makes `tab` the active one, applies `patch` to its state, shows it and, when asked,
 * puts the ring where that tab was left. Each tab keeps its own level, page and row.
 */
async function enterTab($: EngineInterface, live: Live | null, tab: PaneTab, patch: ((state: TabState) => TabState) | null, isFocused: boolean, isRestoringFocus: boolean): Promise<UiOpenResult> {
  await update($, paneTabState, () => tab)
  if (patch !== null && tab !== 'prs') await patchTabState($, tab, patch)
  const opened = await showTabView($, live, isFocused)
  if (isRestoringFocus) await restoreFocus($, tab)
  return opened
}

/** The tab row's hotkeys 1, 2 and 3. Does nothing while a confirmation waits, so it never ends up in another tab. */
async function showTab($: EngineInterface, live: Live | null, tab: PaneTab): Promise<void> {
  if (await isConfirming($)) return
  if ((await read($, paneTabState)) === tab) return
  await enterTab($, live, tab, null, false, true)
}

const WAITING = 'A confirmation is waiting, answer it first.'

/** Shows an issue in the Issues tab; the detail is read at once. */
async function openIssue($: EngineInterface, live: Live | null, number: number, isFromCommand: boolean): Promise<string> {
  if (!Number.isSafeInteger(number) || number < 1) return `${number} is not an issue number.`
  if (await isConfirming($)) return WAITING
  await update($, issueSnapshotState, () => null)
  const opened = await enterTab($, live, 'issues', state => ({ ...state, level: 'detail', selected: number, focus: `issue-${number}` }), isFromCommand, !isFromCommand)
  return opened.isPlaced ? `Showing issue #${number} in the pane.` : `Issue #${number} selected but the pane is not drawn yet: ${opened.reason}`
}

/** Shows a workflow run in the Actions tab; the detail is read at once. */
async function openRun($: EngineInterface, live: Live | null, runId: number, isFromCommand: boolean): Promise<string> {
  if (!Number.isSafeInteger(runId) || runId < 1) return `${runId} is not a run id.`
  if (await isConfirming($)) return WAITING
  await update($, runSnapshotState, () => null)
  const opened = await enterTab($, live, 'actions', state => ({ ...state, level: 'detail', selected: runId, focus: `run-${runId}` }), isFromCommand, !isFromCommand)
  return opened.isPlaced ? `Showing run ${runId} in the pane.` : `Run ${runId} selected but the pane is not drawn yet: ${opened.reason}`
}

/** The Issues or Actions tab at the level it was left; the first time the list. */
async function openTabCommand($: EngineInterface, live: Live | null, tab: 'issues' | 'actions'): Promise<string> {
  if (await isConfirming($)) return WAITING
  const opened = await enterTab($, live, tab, null, true, true)
  const name = tab === 'issues' ? 'Issues' : 'Actions'
  return opened.isPlaced ? `${name} shown in the pane.` : `${name} shown but the pane is not drawn yet: ${opened.reason}`
}

/** Up one level in the active tab: detail to list, the ring back on the row it was opened from. */
async function tabBack($: EngineInterface, live: Live | null): Promise<boolean> {
  const tab = await read($, paneTabState)
  if (tab === 'prs') return false
  const state = await readTabState($, tab)
  if (state.level !== 'detail') return false
  const prefix = tab === 'issues' ? 'issue-' : 'run-'
  const key = state.selected === null ? state.focus : `${prefix}${state.selected}`
  await patchTabState($, tab, current => ({ ...current, level: 'list', selected: null, focus: key }))
  await showTabView($, live, false)
  await restoreFocus($, tab)
  return true
}

async function pageTab($: EngineInterface, step: 1 | -1): Promise<void> {
  const tab = await read($, paneTabState)
  if (tab === 'prs') return
  const last = tab === 'issues' ? lastIssuePage(await read($, issuesState)) : lastRunPage(await read($, runsState))
  await patchTabState($, tab, state => ({ ...state, page: Math.min(Math.max(state.page + step, 0), last), focus: null }))
}

/** Re-runs the failed jobs of the run the detail shows; no confirmation, like the pull request's `t`. */
async function rerunRun($: EngineInterface, live: Live | null, runId: number): Promise<string> {
  if (rerunGuard.isBusy) return 'A re-run is in progress, try again in a moment.'
  rerunGuard.isBusy = true
  try {
    const snapshot = await read($, runSnapshotState)
    if (snapshot === null || snapshot.kind !== 'run' || snapshot.run.id !== runId) return 'That run is not loaded.'
    const exec: Exec = (argv, init) => $.process.run(argv, init)
    const summary = await executeRerun(exec, snapshot.account.login, snapshot.location, [runId])
    const label = `Run #${snapshot.run.runNumber} ${snapshot.run.name}`
    const message = summary.ok.length > 0 ? `${label}: re-running failed jobs` : `${label}: could not re-run, ${summary.failed[0]?.message ?? 'gh failed'}`
    await $.ui.toast(message)
    if (summary.ok.length > 0 && live !== null) void live.refreshTab()
    return message
  } finally {
    rerunGuard.isBusy = false
  }
}

/** Puts a reference to the shown run's failed jobs into the prompt box. */
async function runToClaude($: EngineInterface, runId: number): Promise<string> {
  const snapshot = await read($, runSnapshotState)
  if (snapshot === null || snapshot.kind !== 'run' || snapshot.run.id !== runId) return 'That run is not loaded.'
  const text = runReference(snapshot)
  if (text === null) return 'No failed jobs.'
  const filled = await $.prompt.fill({ text, mode: 'insert' })
  const message = filled.isFilled ? 'Failed run added to the prompt.' : 'The prompt could not take the failed run.'
  await $.ui.toast(message)
  return message
}

/** The handler closures of the tab row, the Issues and Actions views. None of them writes to GitHub but `rerunRun`, which re-runs CI. */
function repoHandlersFor($: EngineInterface, live: Live | null, surface: RenderSurface | undefined): RepoHandlers {
  return {
    showTab: tab => void showTab($, live, tab),
    selectIssue: number => void openIssue($, live, number, false),
    selectRun: runId => void openRun($, live, runId, false),
    openLinkedPr: number => {
      void (async () => {
        if (await isConfirming($)) return
        await selectPr($, live, number)
      })()
    },
    back: () => void tabBack($, live),
    nextPage: () => void pageTab($, 1),
    prevPage: () => void pageTab($, -1),
    refresh: () => {
      if (live !== null) void live.refreshTab()
    },
    closePane: () => void closePane($),
    openUrl: url => void openUrl($, url),
    copyText: text => void $.ui.copy({ text, surface }),
    rerunRun: runId => void rerunRun($, live, runId),
    ciToClaude: runId => void runToClaude($, runId),
  }
}

/** Puts the failed-check reference into the prompt box for the person to send or edit. */
async function ciToClaude($: EngineInterface, subject: Subject): Promise<string> {
  const { snapshot } = await subjectSnapshot($, subject)
  if (snapshot.kind !== 'pr') return 'No pull request for this branch.'
  const text = ciReference(snapshot, await read($, jobsState))
  if (text === null) return 'No failed checks.'
  const filled = await $.prompt.fill({ text, mode: 'insert' })
  const message = filled.isFilled ? 'Failed checks added to the prompt.' : 'The prompt could not take the failed checks.'
  await $.ui.toast(message)
  return message
}

/**
 * Re-runs only the failed jobs of the failed Actions runs of the head commit. No
 * confirmation: it starts CI again, it changes no code and merges nothing. Never
 * retries; the refresh afterwards shows the queued jobs.
 */
async function rerunFailed($: EngineInterface, live: Live | null, subject: Subject): Promise<string> {
  if (rerunGuard.isBusy) return 'A re-run is in progress, try again in a moment.'
  rerunGuard.isBusy = true
  try {
    const { snapshot } = await subjectSnapshot($, subject)
    if (snapshot.kind !== 'pr') return 'No pull request for this branch.'
    const { pr, location, account } = snapshot
    const runIds = rerunnableRunIds(pr)
    if (runIds.length === 0) return 'No failed runs to re-run.'
    const exec: Exec = (argv, init) => $.process.run(argv, init)
    const summary = await executeRerun(exec, account.login, location, runIds)
    const label = `PR #${pr.number}`
    let message: string
    if (summary.failed.length === 0) message = `${label}: re-running failed jobs in ${count(summary.ok.length, 'run', 'runs')}`
    else if (summary.ok.length === 0) message = `${label}: could not re-run, ${summary.failed[0]?.message ?? 'gh failed'}`
    else message = `${label}: re-running failed jobs in ${count(summary.ok.length, 'run', 'runs')}, ${summary.failed.length} failed: ${summary.failed[0]?.message ?? 'gh failed'}`
    await $.ui.toast(message)
    if (summary.ok.length > 0 && live !== null) void live.run('command')
    return message
  } finally {
    rerunGuard.isBusy = false
  }
}

/** The handler closures the band and pane call; each runs with the `$` of the hook that built it. */
function handlersFor($: EngineInterface, live: Live | null, surface: RenderSurface | undefined, subject: Subject): Handlers {
  return {
    refresh: () => {
      if (live !== null) void live.run('command')
    },
    openPane: () => void openPane($, live),
    closePane: () => void closePane($),
    openOnGitHub: () => void openOnGitHub($, subject),
    copyUrl: () => void copyUrl($, surface, subject),
    openUrl: url => void openUrl($, url),
    ciToClaude: () => void ciToClaude($, subject),
    rerunFailed: () => void rerunFailed($, live, subject),
    requestMerge: () => void requestAction($, 'merge', subject),
    requestEnqueue: () => void requestAction($, 'enqueue', subject),
    requestDequeue: () => void requestAction($, 'dequeue', subject),
    requestAutoMerge: () => void requestAutoMerge($, subject),
    requestAdminMerge: () => void requestAction($, 'admin-merge', subject),
    requestApprove: () => void requestAction($, 'approve', subject),
    requestChanges: () => void requestAction($, 'request-changes', subject),
    requestReady: () => void requestAction($, 'ready-for-review', subject),
    setReviewBody: text => void setReviewBody($, text),
    confirmPending: (isSecondStep, drawnBody) => void confirmPending($, live, isSecondStep === true, drawnBody),
    cancelPending: () => void cancelPending($),
    selectMethod: method => void selectMethod($, method),
    selectPr: number => void selectPr($, live, number),
    back: () => void back($, live),
    openList: () => void openList($, live),
    openActions: () => void (async () => {
      if (await isConfirming($)) return
      await enterTab($, live, 'actions', null, false, true)
    })(),
    // Only the pane's pipeline and Linked issues sections are buttons; the band has none of them.
    ...(subject === 'pane'
      ? {
          openLinkedIssue: (number: number) => void openIssue($, live, number, false),
          openRun: (runId: number) => void openRun($, live, runId, false),
        }
      : {}),
  }
}

export const register: Register = (on, options) => {
  const config = configOf(options)
  const palette = paletteFor(options.colors)
  const configured = commandNameOf(options.command)
  settings.isMainShown = !(typeof options.mainStatus === 'string' && options.mainStatus.trim().toLowerCase() === 'off')
  /** The names this mod answers to; set by session.start, empty before. */
  let activeNames: string[] = []
  /** Names this mod registered itself, so a second session.start (hot reload) does not read them as taken. */
  const ownNames = new Set<string>()
  const accountConfig = parseAccountConfig(typeof options.accounts === 'string' ? options.accounts : '')
  let live: Live | null = null

  on('session.start', async ($, e, next) => {
    // A second start (hot reload, resume) must not leave the first one's timers running next to its own.
    cancelTimers()
    generation += 1
    tabsRepo = null
    mainCache.repo = null
    mainCache.etag = null
    const mine = generation
    const isCurrent = (): boolean => mine === generation
    try {
      await update($, pendingState, () => null)
      await update($, outcomeState, () => null)
    } catch {
      // a fresh session starts without a pending action either way
    }
    // A skill or another command of the same name hides the mod's: register the configured name only when it is free.
    let taken: CommandInfo[] = []
    try {
      taken = await $.command.list()
    } catch {
      // without the list, register as if nothing were taken
    }
    const isTaken = (name: string): boolean =>
      !ownNames.has(name) && taken.some(command => command.name === name && !(command.source === 'plugin' && (command.plugin === PLUGIN_NAME || command.plugin?.startsWith(`${PLUGIN_NAME}@`) === true)))
    const wanted = isTaken(configured) ? [FALLBACK_COMMAND] : [configured, FALLBACK_COMMAND]
    // /gh is one more name for the same command; a taken one is skipped without a word.
    const names = isTaken(EXTRA_COMMAND) ? wanted : [...wanted, EXTRA_COMMAND]
    const registeredNow: string[] = []
    for (const name of [...new Set(names)]) {
      try {
        await $.command.register({ name, description: 'Show the pull request status of this branch, the issues and the Actions runs', argumentHint: ARGUMENT_HINT })
        registeredNow.push(name)
        ownNames.add(name)
      } catch {
        // the pane and band still work without the command
      }
    }
    activeNames = registeredNow
    if (!wanted.includes(configured) && configured !== FALLBACK_COMMAND) {
      try {
        await $.ui.toast(`gh-status: /${configured} is taken here (skill or command), use /${FALLBACK_COMMAND}`)
      } catch {
        // a missing toast changes nothing
      }
    }

    const exec: Exec = (argv, init) => $.process.run(argv, init)
    const memory: AccountMemory = {
      get: async owner => {
        const login = await $.store.get(`account:${owner.toLowerCase()}`)
        return typeof login === 'string' ? login : null
      },
      set: (owner, login) => $.store.set(`account:${owner.toLowerCase()}`, login),
      forget: owner => $.store.delete(`account:${owner.toLowerCase()}`),
    }

    // Two refreshers, each with its own single flight, accounts and backoff: the branch's pull
    // request (the band) and the one picked from the list (the pane). The picked one idles
    // while nothing is picked, or while the pick is the branch's own pull request.
    const depsFor = (target: RefreshTarget): RefresherDeps => ({
      target,
      config,
      readCwd: () => $.session.cwd(),
      readLocation: cwd => readLocation(exec, cwd),
      resolveAccount: location => resolveAccount({ exec, memory }, location, accountConfig),
      fetchPullRequest: (location, login) => fetchPullRequest(exec, location, login),
      fetchPullRequestByNumber: (location, login, number) => fetchPullRequestByNumber(exec, location, login, number),
      fastCheck: (location, login, fastTarget, etags) => fastCheck(exec, location, login, fastTarget, etags),
      fetchJobs: (location, login, runIds) => fetchJobs(exec, location, login, runIds),
      isPaneOpen: async () => (await $.ui.panes()).some(pane => pane.id === PANE_ID),
      readState: async () => ({
        snapshot: await read($, snapshotState),
        jobs: await read($, jobsState),
        etags: await read($, etagsState),
        selected: await read($, selectedState),
        selectedSnapshot: await read($, selectedSnapshotState),
      }),
      writeState: async (patch, writer) => {
        if (patch.snapshot !== undefined) {
          const snapshot = patch.snapshot
          await update($, snapshotState, () => snapshot)
        }
        if (patch.selectedSnapshot !== undefined) {
          const selectedSnapshot = patch.selectedSnapshot
          await update($, selectedSnapshotState, () => selectedSnapshot)
        }
        if (patch.jobs !== undefined) {
          const jobs = patch.jobs
          await update($, jobsState, () => jobs)
        }
        if (patch.rateLimit !== undefined) {
          const rateLimit = patch.rateLimit
          await update($, rateLimitState, () => rateLimit)
        }
        if (patch.etags !== undefined) {
          const etags = patch.etags
          await update($, etagsState, (stored: Record<string, string>) => mergeEtags(stored, etags, writer))
        }
      },
      now: () => $.clock.now(),
      toast: async text => {
        const prefix = ownToast.prefix
        if (prefix !== null && text.startsWith(prefix)) {
          ownToast.prefix = null
          if ((await $.clock.now()) <= ownToast.untilMs) return
        }
        await $.ui.toast(text)
      },
    })
    const branchRefresher = createRefresher(depsFor('branch'))
    const selectedRefresher = createRefresher(depsFor('selected'))

    const arm = async (): Promise<void> => {
      timers.branch?.cancel()
      timers.branch = null
      if (!isCurrent()) return
      let delay = nextDelayMs({ kind: 'loading', at: '' }, null, config)
      try {
        const rateLimit = await read($, rateLimitState)
        delay = nextDelayMs(await read($, snapshotState), rateLimit, config)
        const picked = await read($, selectedSnapshotState)
        if (picked !== null) delay = Math.min(delay, nextDelayMs(picked, rateLimit, config))
      } catch {
        // keep the slow default
      }
      if (!isCurrent()) return
      timers.branch = $.clock.after(delay, () => void run('timer'))
    }
    const run = async (reason: RefreshReason): Promise<void> => {
      await Promise.all([branchRefresher.refresh(reason), selectedRefresher.refresh(reason)])
      // A pick or pending write made in another repository does not follow the session into this one.
      try {
        const slug = snapshotSlug(await read($, snapshotState))
        if (isCurrent() && slug !== null) await dropIfRepoChanged($, slug)
      } catch {
        // the state is gone with the session; arm() copes the same way
      }
      await arm()
    }

    // The list and the counts read the repository of the directory with the account the branch target resolved.
    // Each has its own single flight and timer; a request that arrives during a read joins it.
    type RepoTarget = { location: RepoLocation; account: AccountChoice }
    const repoTarget = async (): Promise<RepoTarget | string> => {
      const location = await readLocation(exec, await $.session.cwd())
      if (location === null || location.owner === null || location.repo === null) return 'no GitHub repository here'
      const branch = await read($, snapshotState)
      if ((branch.kind === 'pr' || branch.kind === 'no-pr') && branch.location.owner?.toLowerCase() === location.owner.toLowerCase() && branch.location.repo?.toLowerCase() === location.repo.toLowerCase()) {
        return { location, account: branch.account }
      }
      const resolved = await resolveAccount({ exec, memory }, location, accountConfig)
      return 'login' in resolved ? { location, account: resolved } : 'no GitHub account can read this repository'
    }

    let isListPolling = false
    let listFlight: Promise<void> | null = null
    const stopList = (): void => {
      isListPolling = false
      if (isCurrent()) {
        timers.list?.cancel()
        timers.list = null
      }
    }
    const readListOnce = async (): Promise<void> => {
      const target = await repoTarget()
      const nowMs = await $.clock.now()
      const at = new Date(nowMs).toISOString()
      if (typeof target === 'string') {
        const none: PrList = { kind: 'error', at, message: target }
        await update($, listState, () => none)
        return
      }
      const fetched = await fetchList(exec, target.location, target.account.login)
      await update($, listState, (current: PrList | null) => listAfter(current, fetched, at, target.location, target.account))
      if (fetched.kind === 'ok' && fetched.rateLimit !== null) {
        const rateLimit = fetched.rateLimit
        await update($, rateLimitState, () => rateLimit)
      }
    }
    const runList = (): Promise<void> => {
      isListPolling = true
      if (listFlight !== null) return listFlight
      const flight = (async (): Promise<void> => {
        try {
          await readListOnce()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const broken: PrList = { kind: 'error', at: new Date(await $.clock.now()).toISOString(), message: message.slice(0, 300) }
          await update($, listState, (current: PrList | null) => current ?? broken)
        } finally {
          listFlight = null
        }
        if (!isCurrent()) return
        timers.list?.cancel()
        timers.list = null
        if (!isListPolling) return
        // A low rate limit slows the poll down to every five minutes at most.
        const delay = listDelayMs(await read($, listState), await read($, rateLimitState))
        timers.list = $.clock.after(delay, () => void tickList())
      })()
      listFlight = flight
      return flight
    }
    const tickList = async (): Promise<void> => {
      // Read only while the pane is open and shows the list.
      if (!(await $.ui.panes()).some(pane => pane.id === PANE_ID) || (await read($, paneViewState)) !== 'list' || (await read($, paneTabState)) !== 'prs') return stopList()
      await runList()
    }

    let countsFlight: Promise<void> | null = null
    const runCounts = (): Promise<void> => {
      if (countsFlight !== null) return countsFlight
      const flight = (async (): Promise<void> => {
        let delay = COUNTS_POLL_MS
        try {
          const target = await repoTarget()
          if (typeof target === 'string') {
            await update($, countsState, () => null)
          } else {
            const nowMs = await $.clock.now()
            const fetched = await fetchCounts(exec, target.location, target.account.login, () => new Date(nowMs).toISOString())
            if (fetched.kind === 'ok') {
              const counts: ListCounts = fetched.counts
              await update($, countsState, () => counts)
            } else {
              // keep the last numbers and try again, never faster than once a minute
              delay = COUNTS_RETRY_MS
            }
          }
        } catch {
          delay = COUNTS_RETRY_MS
        } finally {
          countsFlight = null
        }
        if (!isCurrent()) return
        timers.counts?.cancel()
        let rateLimit: RateLimit | null = null
        try {
          rateLimit = await read($, rateLimitState)
        } catch {
          // without it the plain delay stands
        }
        timers.counts = $.clock.after(pollDelayMs(delay, rateLimit), () => void runCounts())
      })()
      countsFlight = flight
      return flight
    }

    // The Issues and Actions views poll only while they are the ones on screen: one timer, one
    // kind at a time. Switching tab or level stops the old poll and reads the new view at once;
    // the old data stays visible meanwhile. Each kind has its own single flight.
    type TabPoll = 'issues' | 'issue' | 'runs' | 'run'
    let tabPoll: TabPoll | null = null
    const tabFlights: Partial<Record<TabPoll, Promise<void>>> = {}
    const stopTab = (): void => {
      tabPoll = null
      if (isCurrent()) {
        timers.tab?.cancel()
        timers.tab = null
      }
    }
    controls.stopTab = stopTab
    const slugOf = (location: RepoLocation): string => (repoSlug(location) ?? '').toLowerCase()
    /** Which view is on screen: an Issues or Actions list or detail; null for the PRs tab or a detail without a pick. */
    const shownTabPoll = async (): Promise<TabPoll | null> => {
      const tab = await read($, paneTabState)
      if (tab === 'prs') return null
      const state = await readTabState($, tab)
      if (state.level === 'list') return tab === 'issues' ? 'issues' : 'runs'
      if (state.selected === null) return null
      return tab === 'issues' ? 'issue' : 'run'
    }
    const readTabOnce = async (kind: TabPoll): Promise<void> => {
      const target = await repoTarget()
      const at = new Date(await $.clock.now()).toISOString()
      if (typeof target === 'string') {
        if (kind === 'issues') await update($, issuesState, () => ({ kind: 'error', at, message: target }) as IssueList)
        if (kind === 'runs') await update($, runsState, () => ({ kind: 'error', at, message: target }) as RunList)
        if (kind === 'issue') {
          const number = (await read($, issuesTabState)).selected
          if (number !== null) await update($, issueSnapshotState, () => ({ kind: 'error', at, number, message: target }) as IssueSnapshot)
        }
        if (kind === 'run') {
          const runId = (await read($, actionsTabState)).selected
          if (runId !== null) await update($, runSnapshotState, () => ({ kind: 'error', at, runId, message: target }) as RunSnapshot)
        }
        return
      }
      const { location, account } = target
      tabsRepo = slugOf(location)
      const saveRate = async (rateLimit: RateLimit | null): Promise<void> => {
        if (rateLimit !== null) await update($, rateLimitState, () => rateLimit)
      }
      if (kind === 'issues') {
        const fetched = await fetchIssues(exec, location, account.login)
        await update($, issuesState, (current: IssueList | null) => issuesAfter(current, fetched, at, location, account))
        if (fetched.kind === 'ok') await saveRate(fetched.rateLimit)
      } else if (kind === 'issue') {
        const number = (await read($, issuesTabState)).selected
        if (number === null) return
        const fetched = await fetchIssue(exec, location, account.login, number)
        await update($, issueSnapshotState, (current: IssueSnapshot | null) => issueAfter(current, fetched, at, location, account))
        if (fetched.kind === 'ok') await saveRate(fetched.rateLimit)
      } else if (kind === 'runs') {
        const known = await read($, runsState)
        const knownDefault = known !== null && known.kind === 'list' ? known.defaultBranch : ((await read($, mainStatusState))?.defaultBranch ?? null)
        const fetched = await fetchRuns(exec, location, account.login, knownDefault)
        await update($, runsState, (current: RunList | null) => runsAfter(current, fetched, at, location, account))
      } else {
        const runId = (await read($, actionsTabState)).selected
        if (runId === null) return
        const fetched = await fetchRun(exec, location, account.login, runId)
        await update($, runSnapshotState, (current: RunSnapshot | null) => runAfter(current, fetched, at, location, account, runId))
      }
    }
    const tabDelay = async (kind: TabPoll): Promise<number> => {
      const rateLimit = await read($, rateLimitState)
      if (kind === 'issues') return pollDelayMs(issuesProblemOf(await read($, issuesState))?.retryInMs ?? LIST_POLL_MS, rateLimit)
      if (kind === 'issue') return pollDelayMs(issueProblemOf(await read($, issueSnapshotState))?.retryInMs ?? LIST_POLL_MS, rateLimit)
      if (kind === 'runs') return pollDelayMs(runsProblemOf(await read($, runsState))?.retryInMs ?? LIST_POLL_MS, rateLimit)
      return runDelayMs(await read($, runSnapshotState), rateLimit)
    }
    const runTab = (kind: TabPoll): Promise<void> => {
      tabPoll = kind
      const running = tabFlights[kind]
      if (running !== undefined) return running
      const flight = (async (): Promise<void> => {
        try {
          await readTabOnce(kind)
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 300)
          const at = new Date(await $.clock.now()).toISOString()
          if (kind === 'issues') await update($, issuesState, (current: IssueList | null) => current ?? ({ kind: 'error', at, message } as IssueList))
          if (kind === 'runs') await update($, runsState, (current: RunList | null) => current ?? ({ kind: 'error', at, message } as RunList))
        } finally {
          delete tabFlights[kind]
        }
        if (!isCurrent() || tabPoll !== kind) return
        timers.tab?.cancel()
        timers.tab = null
        const delay = await tabDelay(kind)
        if (!isCurrent() || tabPoll !== kind) return
        timers.tab = $.clock.after(delay, () => void tickTab(kind))
      })()
      tabFlights[kind] = flight
      return flight
    }
    const tickTab = async (kind: TabPoll): Promise<void> => {
      // Read only while the pane is open and still shows this view.
      if (!(await $.ui.panes()).some(pane => pane.id === PANE_ID) || (await shownTabPoll()) !== kind) return stopTab()
      await runTab(kind)
    }
    const syncTab = async (): Promise<void> => {
      const kind = await shownTabPoll()
      if (kind === null) return stopTab()
      timers.tab?.cancel()
      timers.tab = null
      await runTab(kind)
    }
    const refreshTab = async (): Promise<void> => {
      const kind = await shownTabPoll()
      if (kind !== null) await runTab(kind)
    }

    // The default branch's failing workflows, for the band: one conditional read every five minutes.
    let mainFlight: Promise<void> | null = null
    const runMain = (): Promise<void> => {
      if (!settings.isMainShown) return Promise.resolve()
      if (mainFlight !== null) return mainFlight
      const flight = (async (): Promise<void> => {
        let delay = MAIN_STATUS_POLL_MS
        try {
          const target = await repoTarget()
          if (typeof target === 'string') {
            await update($, mainStatusState, () => null)
          } else {
            const slug = slugOf(target.location)
            tabsRepo = slug
            const current: MainStatus | null = await read($, mainStatusState)
            const isKnown = current !== null && mainCache.repo === slug
            const nowMs = await $.clock.now()
            const fetched = await fetchMainStatus(exec, target.location, target.account.login, isKnown ? mainCache.etag : null, isKnown ? current.defaultBranch : null, () => new Date(nowMs).toISOString())
            if (fetched.kind === 'ok') {
              const status: MainStatus = fetched.status
              await update($, mainStatusState, () => status)
              mainCache.repo = slug
              mainCache.etag = fetched.etag
            } else if (fetched.kind === 'error') {
              // keep the last status and try again, never faster than once a minute
              delay = COUNTS_RETRY_MS
            }
          }
        } catch {
          delay = COUNTS_RETRY_MS
        } finally {
          mainFlight = null
        }
        if (!isCurrent()) return
        timers.main?.cancel()
        let rateLimit: RateLimit | null = null
        try {
          rateLimit = await read($, rateLimitState)
        } catch {
          // without it the plain delay stands
        }
        timers.main = $.clock.after(pollDelayMs(delay, rateLimit), () => void runMain())
      })()
      mainFlight = flight
      return flight
    }

    // A bare number is a pull request or an issue: GitHub numbers both together. The pull request is tried first.
    const kindOfNumber = async (number: number): Promise<'pr' | 'issue'> => {
      try {
        // What is already known saves the lookup: the branch's pull request, a row of either list.
        const branch = await read($, snapshotState)
        if (branch.kind === 'pr' && branch.pr.number === number) return 'pr'
        const prs = await read($, listState)
        if (prs !== null && prs.kind === 'list' && prs.items.some(item => item.number === number)) return 'pr'
        const issues = await read($, issuesState)
        if (issues !== null && issues.kind === 'list' && issues.items.some(item => item.number === number)) return 'issue'
        const target = await repoTarget()
        if (typeof target === 'string') return 'pr'
        const fetched = await fetchPullRequestByNumber(exec, target.location, target.account.login, number)
        if (fetched.kind === 'ok') return fetched.pr === null ? 'issue' : 'pr'
        return fetched.failure.kind === 'not-found' ? 'issue' : 'pr'
      } catch {
        return 'pr'
      }
    }

    live = {
      run,
      runList,
      stopList,
      syncTab,
      refreshTab,
      kindOfNumber,
      cwdChanged: async () => {
        // The directory may be in another repository now: what was picked or pending in the old one goes first.
        const location = await readLocation(exec, await $.session.cwd())
        await dropIfRepoChanged($, location === null ? null : (repoSlug(location)?.toLowerCase() ?? null))
        await run('cwd')
        await runCounts()
        void runMain()
        if (isListPolling) await runList()
        if (tabPoll !== null) await syncTab()
      },
    }

    if (e.isInteractive) void run('start').then(runCounts).then(runMain)
    return next(e)
  })

  // The name is a setting, so the matcher cannot be a literal: the hook sees every command run
  // and answers only the names session.start registered; any other command goes on untouched.
  on('command.run', async ($, e, next) => {
    if (!activeNames.includes(e.command)) return next(e)
    const argument = e.args.trim().toLowerCase()
    if (argument === 'list' || argument === 'ls' || argument === 'prs') return { text: await openList($, live) }
    if (argument === 'issues' || argument === 'i') return { text: await openTabCommand($, live, 'issues') }
    if (argument === 'actions' || argument === 'ac') return { text: await openTabCommand($, live, 'actions') }
    const target = /^(issue|run)\s+#?(\d+)$/.exec(argument)
    if (target !== null) {
      const number = Number(target[2])
      return { text: target[1] === 'issue' ? await openIssue($, live, number, true) : await openRun($, live, number, true) }
    }
    if (argument === '') {
      // No pull request for the branch (none yet, or a detached HEAD): the list is the useful view.
      const branch = await read($, snapshotState)
      if (branch.kind === 'no-pr' || branch.kind === 'detached') return { text: await openList($, live) }
      if (confirmGuard.isBusy) return { text: 'A confirmation is in progress, try again in a moment.' }
      // The branch's pull request: a pick made in the list gives way to it.
      await leaveSelection($)
      return { text: await openPane($, live) }
    }
    if (/^#?\d+$/.test(argument)) {
      const number = Number(argument.replace('#', ''))
      // GitHub numbers issues and pull requests together: a number that is no pull request is tried as an issue.
      if (live !== null && Number.isSafeInteger(number) && number >= 1 && !confirmGuard.isBusy && (await live.kindOfNumber(number)) === 'issue') {
        return { text: await openIssue($, live, number, true) }
      }
      return { text: await selectPr($, live, number) }
    }
    if (argument === 'back') {
      if (await tabBack($, live)) return { text: 'Back to the list.' }
      if ((await read($, paneTabState)) !== 'prs') return { text: 'Already at the list, nothing to go back from.' }
      if ((await read($, selectedState)) === null) return { text: 'No other pull request is shown, nothing to go back from.' }
      await back($, live)
      return { text: 'Back to the list of open PRs.' }
    }
    if (argument === 'refresh') {
      if (live === null) return { text: 'gh-status has not started yet.' }
      if ((await read($, paneTabState)) !== 'prs') {
        await live.refreshTab()
        return { text: 'Refreshed.' }
      }
      await live.run('command')
      const { snapshot } = await subjectSnapshot($, 'pane')
      return { text: snapshot.kind === 'pr' ? `Refreshed PR #${snapshot.pr.number}.` : 'Refreshed.' }
    }
    if (argument === 'open') {
      const isOpened = await openOnGitHub($, 'pane')
      return { text: isOpened ? 'Opening the pull request on GitHub.' : 'No pull request for this branch.' }
    }
    if (argument === 'copy') {
      const url = await copyUrl($, undefined, 'pane')
      return { text: url === null ? 'No pull request for this branch.' : `Copied ${url}` }
    }
    // These set the confirmation pending and open the pane with the keyboard; the write waits for the confirm press.
    const write = WRITE_COMMANDS[argument]
    if (write === 'auto') return { text: await requestAutoMerge($, 'pane', true) }
    if (write !== undefined) return { text: await requestAction($, write, 'pane', true) }
    if (argument === 'rerun' || argument === 'rr') return { text: await rerunFailed($, live, 'pane') }
    if (argument === 'fix') return { text: await ciToClaude($, 'pane') }
    if (argument === 'close') {
      await closePane($)
      await cancelPending($)
      return { text: 'PR pane closed.' }
    }
    return { text: usageFor(e.command) }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `The /${e.command} command failed.` }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (live !== null && CHANGING_COMMAND.test(e.command)) void live.run('push')
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    if (live !== null) void live.run('turn')
    return next(e)
  })

  on('classic.CwdChanged', ($, e, next) => {
    if (live !== null) void live.cwdChanged()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    let mine: RenderElement | null = null
    let table: UiTable | null = null
    try {
      const view = await readView($, e.props.bodyColumns, e.surface, palette, 'branch')
      table = $.ui.resolve(e)
      mine = renderBand(table, view, handlersFor($, live, e.surface, 'branch'))
    } catch {
      return next(e)
    }
    const others = await next(e)
    if (mine === null) return others
    if (others === null || others === undefined) return mine
    const { Box } = table
    return (
      <Box flexDirection="column">
        {mine}
        {others}
      </Box>
    )
  })

  // One pane, three tabs. The tab row comes first; below it the active tab's list or detail.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    try {
      const table = $.ui.resolve(e)
      const { Box } = table
      const columns = e.props.bodyColumns
      const surface = e.surface
      const tabs = renderTabs(table, await readTabsView($, palette), tab => void showTab($, live, tab), columns)
      return (
        <Box flexDirection="column">
          {tabs}
          {await readTabBody($, table, columns, surface, palette, live)}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  // Where the focus ring is, so a list can draw its row as focused: the PRs tab keeps it in
  // paneFocus, the Issues and Actions tabs in their own state (their row keys only, in a list).
  on('ui.focus', async ($, e, next) => {
    if (e.requestId === PANE_ID) {
      const key = e.element ?? null
      const tab = await read($, paneTabState)
      if (tab === 'prs') {
        await update($, paneFocusState, () => key)
      } else if (key !== null && key.startsWith(tab === 'issues' ? 'issue-' : 'run-')) {
        await patchTabState($, tab, state => (state.level === 'list' ? { ...state, focus: key } : state))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Closing the pane (its mark, `close`, `x`) drops what it asked to confirm, the pick it showed
  // and all list and detail polling: nothing is polled once nobody looks at it. The tabs keep
  // their level, page and row for the session.
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    if (live !== null) live.stopList()
    controls.stopTab()
    await update($, pendingState, () => null)
    await update($, selectedState, () => null)
    await update($, selectedSnapshotState, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))
}
