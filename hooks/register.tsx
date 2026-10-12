import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderElement, RenderSurface, Timer, UiOpenResult } from 'claude-code'

import { RECHECK_FAILED, RULES_CHANGED, availableActions, bypassedRules, buildPending, ciReference, confirmStep, execute, executeRerun, isTooEarly, rerunnableRunIds, transitionToastPrefix, withMethod } from '../src/actions'
import type { ActionKind } from '../src/actions'
import { fastCheck } from '../src/etag'
import { runGh, tokenFor } from '../src/gh'
import type { Exec } from '../src/gh'
import { parseAccountConfig, resolveAccount } from '../src/accounts'
import type { AccountMemory } from '../src/accounts'
import { readLocation } from '../src/git'
import { fetchJobs } from '../src/jobs'
import type { MergeMethod, PendingAction, Snapshot } from '../src/model'
import { fetchPullRequest } from '../src/query'
import { createRefresher, nextDelayMs } from '../src/scheduler'
import type { RefreshReason, Refresher, SchedulerConfig } from '../src/scheduler'
import { deriveStatus } from '../src/status'
import { renderBand } from '../src/ui/band'
import { confirmTitle } from '../src/ui/confirm'
import { paletteFor } from '../src/ui/colors'
import type { Palette } from '../src/ui/colors'
import { count } from '../src/ui/format'
import { paneRowCount, renderPane } from '../src/ui/pane'
import type { Handlers, UiTable, View } from '../src/ui/contract'

const PANE_ID = 'gh-status'
const PANE_TITLE = 'PR'
/** Width the opening row count is estimated at; button wrapping is the only thing it changes. */
const PANE_ROWS_COLUMNS = 80

const DEFAULT_FAST_SECONDS = 5
const DEFAULT_IDLE_SECONDS = 30

/** Commands after which the pull request is likely to have changed. */
const CHANGING_COMMAND = /\bgit\s+(push|pull|checkout|switch|rebase|merge|commit|reset)\b|\bgh\s+(pr|run)\b/

const USAGE = 'Usage: /pr [refresh | open | close | copy | fix | rerun (rr) | merge (m) | queue (q) | dequeue (dq) | auto (a) | admin (x)]'

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

/** One confirm press at a time: a second press while one is being handled is dropped. */
const confirmGuard = { isBusy: false }

/** One re-run at a time: a second press while one is running is dropped. */
const rerunGuard = { isBusy: false }

/** The transition toast the mod's own successful write makes redundant; dropped once it shows up. */
const ownToast: { prefix: string | null; untilMs: number } = { prefix: null, untilMs: 0 }

/** What session.start builds and the other hooks use; null until then. */
type Live = {
  refresher: Refresher
  /** Refreshes, then re-arms the timer for the interval the new state asks for. */
  run(reason: RefreshReason): Promise<void>
}

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

async function readView($: EngineInterface, columns: number, surface: 'terminal' | 'desktop', palette: Palette): Promise<View> {
  const snapshot = await read($, snapshotState)
  const jobs = await read($, jobsState)
  const lastSeen = await read($, lastSeenState)
  const outcome = await read($, outcomeState)
  const pending = await read($, pendingState)
  const nowMs = await $.clock.now()
  const status = snapshot.kind === 'pr' ? deriveStatus(snapshot.pr, snapshot.account.login, lastSeen[seenKey(snapshot)] ?? null) : null
  return { snapshot, status, jobs, nowMs, columns, surface, palette, outcome, pending }
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
  const snapshot = await read($, snapshotState)
  // Docked, the pane takes the height of the screen; inline it would get a third and cut off,
  // so ask for what the content needs. A size the person dragged still wins (engine).
  const view = await readView($, PANE_ROWS_COLUMNS, 'terminal', paletteFor(undefined))
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

async function openOnGitHub($: EngineInterface): Promise<boolean> {
  const snapshot = await read($, snapshotState)
  if (snapshot.kind !== 'pr') return false
  const exec: Exec = (argv, init) => $.process.run(argv, init)
  const { pr, location, account } = snapshot
  const ran = await runGh(exec, ['pr', 'view', String(pr.number), '--web', '-R', `${location.owner ?? ''}/${location.repo ?? ''}`], { login: account.login, cwd: location.cwd })
  if (!ran.isOk) await openUrl($, pr.url)
  // The browser may be signed in to another github.com account, which gets a 404 on a private repository.
  if (pr.isPrivate && account.source !== 'active') await $.ui.toast(`gh-status: if GitHub shows 404, sign in to github.com as @${account.login}`)
  return true
}

async function copyUrl($: EngineInterface, surface: RenderSurface | undefined): Promise<string | null> {
  const snapshot = await read($, snapshotState)
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
async function requestAction($: EngineInterface, kind: ActionKind, isFromCommand = false): Promise<string> {
  // A confirm is being handled: a new request must not replace what it acts on.
  if (confirmGuard.isBusy) return 'A confirmation is in progress, try again in a moment.'
  const snapshot = await read($, snapshotState)
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
async function requestAutoMerge($: EngineInterface, isFromCommand = false): Promise<string> {
  const snapshot = await read($, snapshotState)
  if (snapshot.kind !== 'pr') return 'No pull request for this branch.'
  return requestAction($, snapshot.pr.autoMerge === null ? 'auto-merge-on' : 'auto-merge-off', isFromCommand)
}

async function cancelPending($: EngineInterface): Promise<void> {
  await update($, pendingState, () => null)
}

async function selectMethod($: EngineInterface, method: MergeMethod): Promise<void> {
  const snapshot = await read($, snapshotState)
  if (snapshot.kind !== 'pr') return
  const allowed = snapshot.pr.allowedMethods
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
    const stored = await read($, snapshotState)
    const fail = async (message: string): Promise<void> => {
      await update($, outcomeState, () => ({ kind: pending.kind, isOk: false, message, at: new Date(pressedAt).toISOString() }))
    }
    if (stored.kind !== 'pr') return await fail('no pull request to act on, review again')
    // The stored snapshot may be seconds old: re-read the pull request in full right before the write.
    const fetched = await fetchPullRequest(exec, stored.location, pending.login)
    if (fetched.kind !== 'ok' || fetched.pr === null) return await fail(RECHECK_FAILED)
    const freshPr = fetched.pr
    const latest: Snapshot = { kind: 'pr', at: new Date(await $.clock.now()).toISOString(), location: stored.location, account: stored.account, pr: freshPr }
    await update($, snapshotState, () => latest)
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

/** Puts the failed-check reference into the prompt box for the person to send or edit. */
async function ciToClaude($: EngineInterface): Promise<string> {
  const snapshot = await read($, snapshotState)
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
async function rerunFailed($: EngineInterface, live: Live | null): Promise<string> {
  if (rerunGuard.isBusy) return 'A re-run is in progress, try again in a moment.'
  rerunGuard.isBusy = true
  try {
    const snapshot = await read($, snapshotState)
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
function handlersFor($: EngineInterface, live: Live | null, surface: RenderSurface | undefined): Handlers {
  return {
    refresh: () => {
      if (live !== null) void live.run('command')
    },
    openPane: () => void openPane($, live),
    closePane: () => void closePane($),
    openOnGitHub: () => void openOnGitHub($),
    copyUrl: () => void copyUrl($, surface),
    openUrl: url => void openUrl($, url),
    ciToClaude: () => void ciToClaude($),
    rerunFailed: () => void rerunFailed($, live),
    requestMerge: () => void requestAction($, 'merge'),
    requestEnqueue: () => void requestAction($, 'enqueue'),
    requestDequeue: () => void requestAction($, 'dequeue'),
    requestAutoMerge: () => void requestAutoMerge($),
    requestAdminMerge: () => void requestAction($, 'admin-merge'),
    confirmPending: isSecondStep => void confirmPending($, live, isSecondStep === true),
    cancelPending: () => void cancelPending($),
    selectMethod: method => void selectMethod($, method),
  }
}

export const register: Register = (on, options) => {
  const config = configOf(options)
  const palette = paletteFor(options.colors)
  const accountConfig = parseAccountConfig(typeof options.accounts === 'string' ? options.accounts : '')
  let live: Live | null = null

  on('session.start', async ($, e, next) => {
    try {
      await update($, pendingState, () => null)
      await update($, outcomeState, () => null)
    } catch {
      // a fresh session starts without a pending action either way
    }
    try {
      await $.command.register({ name: 'pr', description: 'Show the pull request status of this branch', argumentHint: 'refresh | open | close | copy | fix | rerun | merge | queue | dequeue | auto | admin (or rr | m | q | dq | a | x)' })
    } catch {
      // the pane and band still work without the command
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

    const refresher = createRefresher({
      config,
      readCwd: () => $.session.cwd(),
      readLocation: cwd => readLocation(exec, cwd),
      resolveAccount: location => resolveAccount({ exec, memory }, location, accountConfig),
      fetchPullRequest: (location, login) => fetchPullRequest(exec, location, login),
      fastCheck: (location, login, target, etags) => fastCheck(exec, location, login, target, etags),
      fetchJobs: (location, login, runIds) => fetchJobs(exec, location, login, runIds),
      isPaneOpen: async () => (await $.ui.panes()).some(pane => pane.id === PANE_ID),
      readState: async () => ({ snapshot: await read($, snapshotState), jobs: await read($, jobsState), etags: await read($, etagsState) }),
      writeState: async patch => {
        if (patch.snapshot !== undefined) {
          const snapshot = patch.snapshot
          await update($, snapshotState, () => snapshot)
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
          await update($, etagsState, () => etags)
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

    let timer: Timer | null = null
    const arm = async (): Promise<void> => {
      timer?.cancel()
      let delay = nextDelayMs({ kind: 'loading', at: '' }, null, config)
      try {
        delay = nextDelayMs(await read($, snapshotState), await read($, rateLimitState), config)
      } catch {
        // keep the slow default
      }
      timer = $.clock.after(delay, () => void run('timer'))
    }
    const run = async (reason: RefreshReason): Promise<void> => {
      await refresher.refresh(reason)
      await arm()
    }
    live = { refresher, run }

    if (e.isInteractive) void run('start')
    return next(e)
  })

  on('command.run', { command: 'pr' }, async ($, e) => {
    const argument = e.args.trim().toLowerCase()
    if (argument === '') return { text: await openPane($, live) }
    if (argument === 'refresh') {
      if (live === null) return { text: 'gh-status has not started yet.' }
      await live.run('command')
      const snapshot = await read($, snapshotState)
      return { text: snapshot.kind === 'pr' ? `Refreshed PR #${snapshot.pr.number}.` : 'Refreshed.' }
    }
    if (argument === 'open') {
      const isOpened = await openOnGitHub($)
      return { text: isOpened ? 'Opening the pull request on GitHub.' : 'No pull request for this branch.' }
    }
    if (argument === 'copy') {
      const url = await copyUrl($, undefined)
      return { text: url === null ? 'No pull request for this branch.' : `Copied ${url}` }
    }
    // These set the confirmation pending and open the pane with the keyboard; the write waits for the confirm press.
    const write = WRITE_COMMANDS[argument]
    if (write === 'auto') return { text: await requestAutoMerge($, true) }
    if (write !== undefined) return { text: await requestAction($, write, true) }
    if (argument === 'rerun' || argument === 'rr') return { text: await rerunFailed($, live) }
    if (argument === 'fix') return { text: await ciToClaude($) }
    if (argument === 'close') {
      await closePane($)
      await cancelPending($)
      return { text: 'PR pane closed.' }
    }
    return { text: USAGE }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'The /pr command failed.' }))

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
    if (live !== null) void live.run('cwd')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    let mine: RenderElement | null = null
    let table: UiTable | null = null
    try {
      const view = await readView($, e.props.bodyColumns, e.surface, palette)
      table = $.ui.resolve(e)
      mine = renderBand(table, view, handlersFor($, live, e.surface))
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
      const view = await readView($, e.props.bodyColumns, e.surface, palette)
      return renderPane($.ui.resolve(e), view, handlersFor($, live, e.surface))
    } catch {
      return next(e)
    }
  })

  // Closing the pane (its mark, /pr close) also drops what it asked to confirm.
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    await update($, pendingState, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))
}
