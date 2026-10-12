import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, PluginOptions, Register, RenderElement, RenderSurface, Timer, UiOpenResult } from 'claude-code'

import { RECHECK_FAILED, RULES_CHANGED, availableActions, bypassedRules, buildPending, ciReference, confirmStep, execute, executeRerun, isTooEarly, repoSlug, rerunnableRunIds, transitionToastPrefix, withMethod } from '../src/actions'
import type { ActionKind } from '../src/actions'
import { fastCheck } from '../src/etag'
import { runGh, tokenFor } from '../src/gh'
import type { Exec } from '../src/gh'
import { parseAccountConfig, resolveAccount } from '../src/accounts'
import type { AccountMemory } from '../src/accounts'
import { readLocation } from '../src/git'
import { fetchJobs } from '../src/jobs'
import { COUNTS_POLL_MS, COUNTS_RETRY_MS, fetchCounts, fetchList, lastPage, listAfter, listDelayMs, listRowCount } from '../src/list'
import type { AccountChoice, ListCounts, MergeMethod, PendingAction, PrList, RepoLocation, Snapshot } from '../src/model'
import { fetchPullRequest, fetchPullRequestByNumber } from '../src/query'
import { createRefresher, etagsOf, mergeEtags, nextDelayMs } from '../src/scheduler'
import type { RefreshReason, RefreshTarget, RefresherDeps, SchedulerConfig } from '../src/scheduler'
import { deriveStatus } from '../src/status'
import { renderBand } from '../src/ui/band'
import { confirmTitle } from '../src/ui/confirm'
import { paletteFor } from '../src/ui/colors'
import type { Palette } from '../src/ui/colors'
import { count } from '../src/ui/format'
import { renderList } from '../src/ui/list'
import { paneRowCount, renderPane } from '../src/ui/pane'
import type { Handlers, ListHandlers, ListView, UiTable, View } from '../src/ui/contract'

const PANE_ID = 'gh-status'
const PANE_TITLE = 'PR'
const LIST_ID = 'gh-status-list'
const LIST_TITLE = 'Open PRs'
/** Width the opening row count is estimated at; button wrapping is the only thing it changes. */
const PANE_ROWS_COLUMNS = 80

const DEFAULT_FAST_SECONDS = 5
const DEFAULT_IDLE_SECONDS = 30

/** Commands after which the pull request is likely to have changed. */
const CHANGING_COMMAND = /\bgit\s+(push|pull|checkout|switch|rebase|merge|commit|reset)\b|\bgh\s+(pr|run)\b/

const DEFAULT_COMMAND = 'pr'
/** The name that is always registered, so the mod stays reachable when the configured one is taken. */
const FALLBACK_COMMAND = 'gh-pr'
const COMMAND_NAME = /^[a-z0-9-]{1,32}$/
const PLUGIN_NAME = 'gh-status'

const usageFor = (name: string): string => `Usage: /${name} [<number> | list (ls) | back | refresh | open | close | copy | fix | rerun (rr) | merge (m) | queue (q) | dequeue (dq) | auto (a) | admin (x)]`

/** The configured command name, or 'pr' when it is not 1 to 32 characters of a-z, 0-9 and '-'. */
function commandNameOf(value: unknown): string {
  return typeof value === 'string' && COMMAND_NAME.test(value) ? value : DEFAULT_COMMAND
}

/** The write subcommands and their short aliases. */
const WRITE_COMMANDS: Record<string, 'merge' | 'enqueue' | 'dequeue' | 'auto' | 'admin-merge'> = {
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
  /** Reads the repository's open pull requests now (single flight) and, while the list pane is open, keeps reading them. */
  runList(): Promise<void>
  /** Stops the list polling; the list pane was closed. */
  stopList(): void
  /** The directory changed: refreshes the branch's pull request, the counts and, while the list pane is open, the list. */
  cwdChanged(): Promise<void>
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
  if (own !== null && (own.kind !== 'pr' || own.pr.number === selected.number)) return { snapshot: own, isSelected: true }
  if (branch.kind === 'pr' && branch.pr.number === selected.number) return { snapshot: branch, isSelected: true }
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
  return { snapshot, status, isSelected, jobs, nowMs, columns, surface, palette, outcome, pending: isElsewhere ? null : stored, counts }
}

async function readListView($: EngineInterface, columns: number, surface: 'terminal' | 'desktop', palette: Palette): Promise<ListView> {
  const selected = await read($, selectedState)
  return {
    list: await read($, listState),
    page: await read($, listPageState),
    hideDrafts: await read($, listHideDraftsState),
    selectedNumber: selected === null ? null : selected.number,
    counts: await read($, countsState),
    nowMs: await $.clock.now(),
    columns,
    surface,
    palette,
  }
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

/** Opens the detail pane, with the keyboard when asked (granted from an empty prompt). */
async function showPane($: EngineInterface, isFocused: boolean): Promise<UiOpenResult> {
  const { snapshot } = await subjectSnapshot($, 'pane')
  // Docked, the pane takes the height of the screen; inline it would get a third and cut off,
  // so ask for what the content needs. A size the person dragged still wins (engine).
  const view = await readView($, PANE_ROWS_COLUMNS, 'terminal', paletteFor(undefined), 'pane')
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, rows: paneRowCount(view), ...(isFocused ? { focus: true } : {}) })
  if (snapshot.kind === 'pr') {
    const nowMs = await $.clock.now()
    await update($, lastSeenState, seen => ({ ...seen, [seenKey(snapshot)]: new Date(nowMs).toISOString() }))
  }
  return opened
}

async function openPane($: EngineInterface, live: Live | null): Promise<string> {
  const opened = await showPane($, false)
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
    const offered = availableActions(snapshot.pr)
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
async function confirmPending($: EngineInterface, live: Live | null, isSecondStep: boolean): Promise<void> {
  if (confirmGuard.isBusy) return
  confirmGuard.isBusy = true
  try {
    const pending = await read($, pendingState)
    if (pending === null) return
    const step = confirmStep(pending, isSecondStep)
    if (step === 'ignore') return
    const pressedAt = await $.clock.now()
    if (isTooEarly(pending, pressedAt)) return
    if (step === 'advance') {
      await update($, pendingState, (current: PendingAction | null) =>
        current !== null && current.kind === 'admin-merge' && !current.isSecondStep ? { ...current, isSecondStep: true, openedAt: pressedAt } : current,
      )
      return
    }
    const exec: Exec = (argv, init) => $.process.run(argv, init)
    // The pull request the confirmation is bound to: the pick's or the branch's, never another one.
    const stored = await pendingTarget($, pending)
    const isPicked = (await read($, selectedState)) !== null
    const fail = async (message: string): Promise<void> => {
      await update($, outcomeState, () => ({ kind: pending.kind, isOk: false, message, at: new Date(pressedAt).toISOString() }))
    }
    if (stored === null) return await fail('no pull request to act on, review again')
    // The stored snapshot may be seconds old: re-read the pull request in full right before the write.
    // With a pick set the branch's pull request may not be the one asked for, so the lookup goes by its number.
    const fetched = isPicked ? await fetchPullRequestByNumber(exec, stored.location, pending.login, pending.prNumber) : await fetchPullRequest(exec, stored.location, pending.login)
    if (fetched.kind !== 'ok' || fetched.pr === null) return await fail(RECHECK_FAILED)
    const freshPr = fetched.pr
    const latest: Snapshot = { kind: 'pr', at: new Date(await $.clock.now()).toISOString(), location: stored.location, account: stored.account, pr: freshPr }
    // The fresh picture replaces the one the confirmation was asked on: the pick's own, else the branch's.
    if (isPicked && (await read($, selectedSnapshotState)) !== null) await update($, selectedSnapshotState, () => latest)
    else await update($, snapshotState, () => latest)
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

/**
 * Shows another open pull request of the repository in the pane: sets the pick, drops
 * the confirmation and result of the one before, opens the pane with the keyboard and
 * refreshes. The band keeps showing the branch's pull request.
 */
async function selectPr($: EngineInterface, live: Live | null, number: number): Promise<string> {
  if (!Number.isSafeInteger(number) || number < 1) return `${number} is not a pull request number.`
  if (confirmGuard.isBusy) return 'A confirmation is in progress, try again in a moment.'
  await update($, selectedState, () => ({ number }))
  await update($, selectedSnapshotState, () => null)
  await update($, pendingState, () => null)
  await update($, outcomeState, () => null)
  const opened = await showPane($, true)
  if (live !== null) void live.run('command')
  return opened.isPlaced ? `Showing PR #${number} in the pane.` : `PR #${number} selected but the pane is not drawn yet: ${opened.reason}`
}

/** Leaves the picked pull request: the pane shows the branch's again. */
async function back($: EngineInterface, live: Live | null): Promise<void> {
  if (confirmGuard.isBusy) return
  await update($, selectedState, () => null)
  await update($, selectedSnapshotState, () => null)
  await update($, pendingState, () => null)
  await update($, outcomeState, () => null)
  if (live !== null) void live.run('command')
}

/** Opens the list pane with the keyboard, sized to its current page, and reads the list now. */
async function openList($: EngineInterface, live: Live | null): Promise<string> {
  const rows = listRowCount(await read($, listState), await read($, listPageState), await read($, listHideDraftsState))
  const opened = await $.ui.open({ id: LIST_ID, title: LIST_TITLE, rows, focus: true })
  if (live !== null) void live.runList()
  return opened.isPlaced ? 'Open PRs listed in the pane.' : `Open PRs pane opened but not drawn yet: ${opened.reason}`
}

async function setPage($: EngineInterface, step: 1 | -1): Promise<void> {
  const last = lastPage(await read($, listState), await read($, listHideDraftsState))
  await update($, listPageState, (page: number) => Math.min(Math.max(page + step, 0), last))
}

async function toggleDrafts($: EngineInterface): Promise<void> {
  await update($, listHideDraftsState, (isHidden: boolean) => !isHidden)
  await update($, listPageState, () => 0)
}

/** The handler closures of the list pane. They read and open; none of them writes to GitHub. */
function listHandlersFor($: EngineInterface, live: Live | null): ListHandlers {
  return {
    selectPr: number => void selectPr($, live, number),
    nextPage: () => void setPage($, 1),
    prevPage: () => void setPage($, -1),
    toggleDrafts: () => void toggleDrafts($),
    refresh: () => {
      if (live !== null) void live.runList()
    },
    back: () => void back($, live),
    closeList: () => void $.ui.close({ id: LIST_ID }),
    openUrl: url => void openUrl($, url),
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
    confirmPending: isSecondStep => void confirmPending($, live, isSecondStep === true),
    cancelPending: () => void cancelPending($),
    selectMethod: method => void selectMethod($, method),
    selectPr: number => void selectPr($, live, number),
    back: () => void back($, live),
    openList: () => void openList($, live),
  }
}

export const register: Register = (on, options) => {
  const config = configOf(options)
  const palette = paletteFor(options.colors)
  const configured = commandNameOf(options.command)
  /** The names this mod answers to; set by session.start, empty before. */
  let activeNames: string[] = []
  /** Names this mod registered itself, so a second session.start (hot reload) does not read them as taken. */
  const ownNames = new Set<string>()
  const accountConfig = parseAccountConfig(typeof options.accounts === 'string' ? options.accounts : '')
  let live: Live | null = null

  on('session.start', async ($, e, next) => {
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
    const registeredNow: string[] = []
    for (const name of [...new Set(wanted)]) {
      try {
        await $.command.register({ name, description: 'Show the pull request status of this branch', argumentHint: '<number> | list (or ls) | back | refresh | open | close | copy | fix | rerun | merge | queue | dequeue | auto | admin (or rr | m | q | dq | a | x)' })
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

    let timer: Timer | null = null
    const arm = async (): Promise<void> => {
      timer?.cancel()
      let delay = nextDelayMs({ kind: 'loading', at: '' }, null, config)
      try {
        const rateLimit = await read($, rateLimitState)
        delay = nextDelayMs(await read($, snapshotState), rateLimit, config)
        const picked = await read($, selectedSnapshotState)
        if (picked !== null) delay = Math.min(delay, nextDelayMs(picked, rateLimit, config))
      } catch {
        // keep the slow default
      }
      timer = $.clock.after(delay, () => void run('timer'))
    }
    const run = async (reason: RefreshReason): Promise<void> => {
      await Promise.all([branchRefresher.refresh(reason), selectedRefresher.refresh(reason)])
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
    let listTimer: Timer | null = null
    const stopList = (): void => {
      isListPolling = false
      listTimer?.cancel()
      listTimer = null
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
        listTimer?.cancel()
        listTimer = null
        if (!isListPolling) return
        const delay = listDelayMs(await read($, listState))
        listTimer = $.clock.after(delay, () => void tickList())
      })()
      listFlight = flight
      return flight
    }
    const tickList = async (): Promise<void> => {
      if (!(await $.ui.panes()).some(pane => pane.id === LIST_ID)) return stopList()
      await runList()
    }

    let countsFlight: Promise<void> | null = null
    let countsTimer: Timer | null = null
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
        countsTimer?.cancel()
        countsTimer = $.clock.after(delay, () => void runCounts())
      })()
      countsFlight = flight
      return flight
    }

    live = {
      run,
      runList,
      stopList,
      cwdChanged: async () => {
        await run('cwd')
        await runCounts()
        if (isListPolling) await runList()
      },
    }

    if (e.isInteractive) void run('start').then(runCounts)
    return next(e)
  })

  // The name is a setting, so the matcher cannot be a literal: the hook sees every command run
  // and answers only the names session.start registered; any other command goes on untouched.
  on('command.run', async ($, e, next) => {
    if (!activeNames.includes(e.command)) return next(e)
    const argument = e.args.trim().toLowerCase()
    if (argument === 'list' || argument === 'ls') return { text: await openList($, live) }
    if (argument === '') {
      // No pull request for the branch (none yet, or a detached HEAD): the list is the useful view.
      const branch = await read($, snapshotState)
      if (branch.kind === 'no-pr' || branch.kind === 'detached') return { text: await openList($, live) }
      return { text: await openPane($, live) }
    }
    if (/^#?\d+$/.test(argument)) return { text: await selectPr($, live, Number(argument.replace('#', ''))) }
    if (argument === 'back') {
      await back($, live)
      return { text: 'Showing the pull request of this branch.' }
    }
    if (argument === 'refresh') {
      if (live === null) return { text: 'gh-status has not started yet.' }
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

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    try {
      const view = await readView($, e.props.bodyColumns, e.surface, palette, 'pane')
      return renderPane($.ui.resolve(e), view, handlersFor($, live, e.surface, 'pane'))
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'Pane', requestId: LIST_ID }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    try {
      const view = await readListView($, e.props.bodyColumns, e.surface, palette)
      return renderList($.ui.resolve(e), view, listHandlersFor($, live))
    } catch {
      return next(e)
    }
  })

  // Closing the pane (its mark, `close`) also drops what it asked to confirm, and the pick it showed:
  // the picked pull request is no longer polled once nobody looks at it.
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    await update($, pendingState, () => null)
    await update($, selectedState, () => null)
    await update($, selectedSnapshotState, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: LIST_ID }, async ($, e, next) => {
    if (live !== null) live.stopList()
    return next(e)
  }).catch(($, e, next) => next(e))
}
