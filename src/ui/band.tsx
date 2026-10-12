// The band above the prompt: one line (two when blocked) with the PR number,
// pipeline, reviews, threads, verdict and the few buttons worth a key.

import type { RenderElement } from 'claude-code'

import type { PendingAction, PipelineSummary, PullRequest, Snapshot, Status } from '../model'
import { availableActions } from '../actions'
import { formatDuration, mergeTone, nonCheckBlockers, prBadge, queueLine, verdictText } from '../status'
import { cellWidth, fitSegments, repeatsBadge, snapshotLine, truncate } from './format'
import type { Fittable } from './format'
import { prAnchor } from './anchor'
import { confirmButton } from './confirm'
import { badgeBackground, tone } from './colors'
import type { Palette, Tone } from './colors'
import type { Handlers, UiTable, View } from './contract'

const SEPARATOR = ' · '
const BUTTON_GAP = 2
const BUTTON_SPACING = 1
const ACCOUNT_MAX = 24
const CANCEL_HOTKEY = 'n'

type Run = { text: string; color?: Tone; isDim?: boolean }
type Segment = Fittable & { key: string; runs: Run[]; button?: { hotkey: string; label: string; onPress: () => void } }

const runWidth = (runs: Run[]): number => runs.reduce((sum, run) => sum + cellWidth(run.text), 0)

function verdictRun(pr: PullRequest, status: Status): Run {
  switch (status.verdict) {
    case 'mergeable':
      return { text: verdictText('mergeable', []), color: mergeTone(status) }
    case 'blocked':
      return { text: verdictText('blocked', status.blockers), color: 'failure' }
    case 'checks-running':
      return { text: verdictText('checks-running', []), color: 'pending' }
    case 'in-queue': {
      return { text: queueLine(pr.mergeQueueEntry, false), color: 'pending' }
    }
    case 'auto-merge':
      return { text: verdictText('auto-merge', []), color: 'pending' }
    default:
      return { text: verdictText(status.verdict, []) }
  }
}

/** The merge queue's own checks: '● queue 3/9 running'. */
function queueRun(queue: PipelineSummary): Run {
  if (queue.failed > 0) {
    const name = queue.failedRequired.length + queue.failedOptional.length === 1 ? `${[...queue.failedRequired, ...queue.failedOptional][0]} failed` : `${queue.failed} checks failed`
    return { text: `✗ queue ${name}`, color: 'failure' }
  }
  if (queue.running > 0) return { text: `● queue ${queue.running}/${queue.total} running`, color: 'pending' }
  if (queue.queued > 0) return { text: `◷ queue ${queue.queued}/${queue.total} queued`, color: 'pending' }
  return { text: `✓ queue ${queue.total} checks`, color: 'success' }
}

function pipelineRun(status: Status, nowMs: number): Run | null {
  if (status.queuePipeline !== null && status.queuePipeline.total > 0) return queueRun(status.queuePipeline)
  const { pipeline } = status
  if (pipeline.total === 0) return null
  const running = pipeline.running > 0 ? `, ${pipeline.running} running` : ''
  if (pipeline.failedRequired.length === 1) return { text: `✗ ${pipeline.failedRequired[0]} failed (required)${running}`, color: 'failure' }
  if (pipeline.failedRequired.length > 1) return { text: `✗ ${pipeline.failedRequired.length} required checks failed${running}`, color: 'failure' }
  if (pipeline.failed > 0) {
    const name = pipeline.failedOptional.length === 1 ? `${pipeline.failedOptional[0]} failed` : `${pipeline.failed} checks failed`
    return { text: `✗ ${name}${running}`, color: 'failure' }
  }
  if (pipeline.running > 0) {
    const since = pipeline.runningSince === null ? '' : ` ${formatDuration(nowMs - Date.parse(pipeline.runningSince))}`
    return { text: `● ${pipeline.running}/${pipeline.total} running${since}`, color: 'pending' }
  }
  if (pipeline.queued > 0) return { text: `◷ ${pipeline.queued}/${pipeline.total} queued`, color: 'pending' }
  return { text: `✓ ${pipeline.total} checks`, color: 'success' }
}

function namesList(logins: string[]): string {
  const shown = logins.slice(0, 2).map((login) => `@${login}`).join(', ')
  return logins.length > 2 ? `${shown} +${logins.length - 2}` : shown
}

function reviewRuns(status: Status): Run[] {
  const runs: Run[] = []
  const add = (run: Run) => {
    if (runs.length > 0) runs.push({ text: ', ', isDim: true })
    runs.push(run)
  }
  if (status.changesRequestedBy.length > 0) add({ text: `✗ ${namesList(status.changesRequestedBy)}`, color: 'failure' })
  if (status.approvals.length > 0) add({ text: `✓ ${namesList(status.approvals)}`, color: 'success' })
  if (status.requested.length > 0) {
    const names = status.requested.slice(0, 2).join(', ') + (status.requested.length > 2 ? ` +${status.requested.length - 2}` : '')
    add({ text: `◷ ${names}`, color: 'pending' })
  }
  return runs
}

function threadRun(status: Status): Run | null {
  const fresh = status.newActivity.length
  const parts: string[] = []
  if (status.unresolvedThreads > 0) parts.push(`${status.unresolvedThreads} unresolved`)
  if (fresh > 0) parts.push(`${fresh} new`)
  if (parts.length === 0) return null
  return { text: `💬 ${parts.join(', ')}`, color: status.unresolvedThreads > 0 ? 'pending' : undefined }
}

function buttonSegments(pr: PullRequest, status: Status, handlers: Handlers): Segment[] {
  const buttons: Segment[] = []
  const add = (hotkey: string, label: string, onPress: () => void) => {
    buttons.push({ key: `band-${label.replace(/\s+/g, '-')}`, runs: [], priority: 7 + buttons.length, width: hotkey.length + 2 + cellWidth(label), button: { hotkey, label, onPress } })
  }
  add('d', 'details', () => handlers.openPane())
  add('o', 'github', () => handlers.openOnGitHub())
  const ciToClaude = handlers.ciToClaude
  if (ciToClaude !== undefined && status.pipeline.failed > 0) add('f', 'fix ci', () => ciToClaude())
  const actions = availableActions(pr)
  const requestMerge = handlers.requestMerge
  if (requestMerge !== undefined && actions.includes('merge')) add('m', 'merge', () => requestMerge())
  const requestEnqueue = handlers.requestEnqueue
  if (requestEnqueue !== undefined && actions.includes('enqueue')) add('q', 'queue', () => requestEnqueue())
  return buttons
}

function drawRuns(table: UiTable, palette: Palette, runs: Run[]): RenderElement[] {
  const { Text } = table
  return runs.map((run) => (
    <Text color={tone(palette, run.color)} dimColor={run.isDim === true ? true : undefined} wrap="truncate-end">
      {run.text}
    </Text>
  ))
}

/** 'PR #N' and its colored state badge, side by side. */
function prHead(table: UiTable, view: View, handlers: Handlers, pr: PullRequest): RenderElement {
  const { Box, Text } = table
  const badge = prBadge(pr)
  return (
    <Box flexShrink={0}>
      {prAnchor(table, view, handlers, pr.url, `PR #${pr.number}`)}
      <Text> </Text>
      <Text color={view.palette.badgeText} backgroundColor={badgeBackground(view.palette, badge.text)} bold wrap="truncate-end">
        {` ${badge.text} `}
      </Text>
    </Box>
  )
}

const headWidth = (pr: PullRequest): number => cellWidth(`PR #${pr.number}  ${prBadge(pr).text} `)

/** A cell that never shrinks, so the row cannot wrap one segment inside its own column. */
function cell(table: UiTable, child: RenderElement | RenderElement[], marginLeft?: number): RenderElement {
  const { Box } = table
  return (
    <Box flexShrink={0} marginLeft={marginLeft}>
      {child}
    </Box>
  )
}

function prBand(table: UiTable, view: View, handlers: Handlers, snapshot: Extract<Snapshot, { kind: 'pr' }>, status: Status): RenderElement {
  const { Box, Button, Text } = table
  const { pr } = snapshot
  const columns = Math.max(10, view.columns)

  if (pr.state !== 'open') return prHead(table, view, handlers, pr)

  const segments: Segment[] = []
  segments.push({ key: 'pr', runs: [], priority: 1, width: headWidth(pr) })
  const verdict = verdictRun(pr, status)
  // Capped so the PR number and the verdict always fit; the text is cut at draw time.
  const verdictRoom = Math.max(1, columns - headWidth(pr) - cellWidth(SEPARATOR))
  // A verdict that only repeats the badge ('draft' next to 'blocked: draft') is left out.
  if (!repeatsBadge(pr, status)) {
    segments.push({ key: 'verdict', runs: [verdict], priority: 2, width: Math.min(cellWidth(verdict.text), verdictRoom) })
  }
  // The first caveat is its own segment so it goes before anything else but the verdict.
  const caveatText = status.verdict === 'mergeable' ? (status.caveats[0] ?? null) : null
  const caveat: Run | null = caveatText === null ? null : { text: caveatText, color: mergeTone(status) }
  if (caveat !== null) {
    const room = Math.max(1, columns - headWidth(pr) - cellWidth(verdict.text) - 2 * cellWidth(SEPARATOR))
    segments.push({ key: 'caveat', runs: [caveat], priority: 2.5, width: Math.min(cellWidth(caveat.text), room) })
  }
  const pipeline = pipelineRun(status, view.nowMs)
  if (pipeline !== null) {
    const capped: Run = { ...pipeline, text: truncate(pipeline.text, Math.max(12, Math.floor(columns / 2))) }
    segments.push({ key: 'pipeline', runs: [capped], priority: 3, width: cellWidth(capped.text) })
  }
  const reviews = reviewRuns(status)
  if (reviews.length > 0) segments.push({ key: 'reviews', runs: reviews, priority: 4, width: runWidth(reviews) })
  const threads = threadRun(status)
  if (threads !== null) segments.push({ key: 'threads', runs: [threads], priority: 5, width: cellWidth(threads.text) })
  const account: Run = { text: truncate(`@${snapshot.account.login}`, ACCOUNT_MAX), isDim: true }
  segments.push({ key: 'account', runs: [account], priority: 6, width: cellWidth(account.text) })

  // Text segments and buttons share one budget; buttons are dropped first.
  const buttons = buttonSegments(pr, status, handlers)
  const all = fitSegments([...segments, ...buttons], columns, 3)
  const kept = all.filter((segment) => segment.button === undefined)
  const keptButtons = all.filter((segment) => segment.button !== undefined)

  const nodes: RenderElement[] = []
  kept.forEach((segment, index) => {
    if (index > 0) {
      nodes.push(
        cell(
          table,
          <Text dimColor wrap="truncate-end">
            {SEPARATOR}
          </Text>,
        ),
      )
    }
    if (segment.key === 'pr') {
      nodes.push(prHead(table, view, handlers, pr))
    } else if (segment.key === 'verdict') {
      nodes.push(
        cell(
          table,
          <Text color={tone(view.palette, verdict.color)} wrap="truncate-end">
            {truncate(verdict.text, Math.max(1, verdictRoom))}
          </Text>,
        ),
      )
    } else if (segment.key === 'caveat' && caveat !== null) {
      nodes.push(
        cell(
          table,
          <Text color={tone(view.palette, caveat.color)} wrap="truncate-end">
            {truncate(caveat.text, Math.max(1, segment.width))}
          </Text>,
        ),
      )
    } else {
      nodes.push(cell(table, drawRuns(table, view.palette, segment.runs)))
    }
  })
  keptButtons.forEach((segment, index) => {
    const button = segment.button
    if (button === undefined) return
    nodes.push(cell(table, <Button key={segment.key} plain hotkey={button.hotkey} label={button.label} onPress={button.onPress} />, index === 0 ? BUTTON_GAP : BUTTON_SPACING))
  })

  // Exactly one row: nothing wraps, nothing shrinks; segments were fitted to the columns above.
  const lines: RenderElement[] = [
    <Box flexDirection="row" flexWrap="nowrap">
      {nodes}
    </Box>,
  ]
  // The first non-check blocker is in the verdict; more of them get a second row.
  const more = status.verdict === 'blocked' ? nonCheckBlockers(status.blockers).slice(1) : []
  if (more.length > 0) {
    lines.push(
      <Text color={view.palette.failure} wrap="truncate-end">
        {truncate(`↳ ${more.map((blocker) => blocker.text).join(SEPARATOR)}`, columns)}
      </Text>,
    )
  }
  return <Box flexDirection="column">{lines}</Box>
}

/** The question the band asks while an action waits: 'merge #1 (squash)?'. */
function confirmPrompt(pending: PendingAction): string {
  const number = `#${pending.prNumber}`
  if (pending.kind === 'admin-merge') return pending.isSecondStep ? `bypass rules and merge ${number}?` : `admin merge ${number} (step 1 of 2)?`
  return `${confirmButton(pending).label}?`
}

/**
 * While an action is pending the band holds its confirm controls instead of its
 * buttons, so whoever holds the keyboard can answer. Same handlers and hotkeys
 * as the pane's confirmation; every check stays in confirmPending.
 */
function confirmBand(table: UiTable, view: View, handlers: Handlers, pending: PendingAction): RenderElement {
  const { Box, Button, Text } = table
  const isSecondStep = pending.kind === 'admin-merge' && pending.isSecondStep
  const confirm = confirmButton(pending)
  const label = pending.kind === 'admin-merge' ? confirm.label : 'confirm'
  const columns = Math.max(10, view.columns)
  const buttonsWidth = confirm.hotkey.length + 2 + cellWidth(label) + BUTTON_GAP + CANCEL_HOTKEY.length + 2 + cellWidth('cancel') + BUTTON_SPACING
  const prompt = truncate(confirmPrompt(pending), Math.max(1, columns - buttonsWidth))
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Box flexShrink={0}>
        <Text color={isSecondStep ? view.palette.failure : undefined} bold wrap="truncate-end">
          {prompt}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={BUTTON_GAP}>
        <Button key="band-confirm" plain hotkey={confirm.hotkey} label={label} onPress={() => handlers.confirmPending(isSecondStep)} />
      </Box>
      <Box flexShrink={0} marginLeft={BUTTON_SPACING}>
        <Button key="band-cancel" plain hotkey={CANCEL_HOTKEY} label="cancel" onPress={() => handlers.cancelPending()} />
      </Box>
    </Box>
  )
}

/** The band for a view, or null when nothing should be drawn. */
export function renderBand(table: UiTable, view: View, handlers: Handlers): RenderElement | null {
  const { Box, Text } = table
  if (view.pending !== null) return confirmBand(table, view, handlers, view.pending)
  const { snapshot, status } = view
  const columns = Math.max(10, view.columns)

  if (snapshot.kind === 'pr') {
    if (status === null) return null
    return prBand(table, view, handlers, snapshot, status)
  }

  const line = snapshotLine(snapshot, 'band')
  if (line === null) return null
  if (snapshot.kind === 'no-pr') {
    const account = `@${snapshot.account.login}`
    const room = columns - cellWidth(SEPARATOR) - cellWidth(account)
    const text = truncate(line.text, Math.max(1, room > 8 ? room : columns))
    return (
      <Box>
        <Text dimColor>{text}</Text>
        {room > 8 && <Text dimColor>{`${SEPARATOR}${account}`}</Text>}
      </Box>
    )
  }
  return (
    <Box>
      <Text dimColor={line.isDim} color={line.isDim ? undefined : view.palette.pending}>
        {truncate(line.text, columns)}
      </Text>
    </Box>
  )
}
