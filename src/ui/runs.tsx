// The Actions tab: the newest run per workflow on the default branch, on this branch, then
// recent runs of others, one page at a time. A run takes two lines and a blank one: the title
// line (state symbol, workflow name, branch) and a dim line of facts, together one Button.

import type { RenderElement } from 'claude-code'

import type { CheckState, RunGroup, RunItem, RunList } from '../model'
import { paginateRuns } from '../runs'
import { formatDuration, relativeTime } from '../status'
import type { RepoHandlers, RunsView, UiTable } from './contract'
import { cellWidth, headingLine, truncate } from './format'
import { GAP, GAP_WIDTH, PREFIX_WIDTH, blankLine, footerRows, joinFacts, listRow, listState, messageLine, pagerButtons, staleText, summaryLine } from './row'
import type { Run } from './row'

/** Cells of the workflow name kept before the branch is cut. */
const NAME_FLOOR = 16
/** The narrowest branch name worth drawing. */
const BRANCH_FLOOR = 4

/** The symbol of a run's state with its tone or dimness. */
export function stateRun(state: CheckState): Run {
  switch (state) {
    case 'success':
      return { text: '✓', color: 'success' }
    case 'failure':
    case 'timed-out':
    case 'action-required':
      return { text: '✗', color: 'failure' }
    case 'running':
      return { text: '●', color: 'pending' }
    case 'queued':
      return { text: '◷', color: 'pending' }
    case 'cancelled':
      return { text: '⊘', isDim: true }
    default:
      return { text: '–', isDim: true }
  }
}

/** How long a run took (completed) or has taken (running); null for a queued run or one without a start. */
function durationOf(item: RunItem, nowMs: number): string | null {
  if (item.state === 'queued' || item.startedAt === null) return null
  const start = Date.parse(item.startedAt)
  if (Number.isNaN(start)) return null
  if (item.state === 'running') return formatDuration(nowMs - start)
  const end = Date.parse(item.updatedAt)
  return Number.isNaN(end) ? null : formatDuration(end - start)
}

/** The facts line: '#412 · push · @anna · 4 min ago · 3:12'. */
function factRuns(item: RunItem, nowMs: number): Run[] {
  const facts: Run[] = [{ text: `#${item.runNumber}`, isDim: true }, { text: item.event, isDim: true }]
  if (item.actor !== null) facts.push({ text: `@${item.actor}`, isDim: true })
  facts.push({ text: relativeTime(item.createdAt, nowMs), isDim: true })
  const duration = durationOf(item, nowMs)
  if (duration !== null) facts.push({ text: duration, isDim: true })
  return joinFacts(facts)
}

function runRow(table: UiTable, view: RunsView, handlers: RepoHandlers, item: RunItem, group: RunGroup, columns: number): RenderElement {
  const key = `run-${item.id}`
  const room = Math.max(1, columns - PREFIX_WIDTH)
  const nameWidth = cellWidth(item.name)
  // The branch is drawn dim after the name, except in the default branch's own group; the name keeps its floor.
  const wantsBranch = group !== 'main' && item.branch !== null
  const branchRoom = room - Math.min(nameWidth, NAME_FLOOR) - GAP_WIDTH
  const hasBranch = wantsBranch && branchRoom >= BRANCH_FLOOR
  const branch = hasBranch && item.branch !== null ? truncate(item.branch, branchRoom) : ''
  const name = truncate(item.name, Math.max(1, room - (hasBranch ? GAP_WIDTH + cellWidth(branch) : 0)))
  const first: Run[] = [stateRun(item.state), { text: ' ' }, { text: name, isBold: true }]
  if (hasBranch) first.push({ text: GAP }, { text: branch, isDim: true })
  return listRow(table, view.palette, {
    key,
    rowKey: `row-${key}`,
    label: `#${item.runNumber} ${item.name}`,
    isFocused: view.focusedKey === key,
    columns,
    first,
    facts: factRuns(item, view.nowMs),
    onPress: () => handlers.selectRun(item.id),
  })
}

/** The summary line: '12 runs · 1 to 10 · page 1 of 2'. */
function headerLine(table: UiTable, view: RunsView, page: ReturnType<typeof paginateRuns>): RenderElement {
  const parts: { key: string; text: string; priority: number }[] = [{ key: 'runs', text: `${page.total} ${page.total === 1 ? 'run' : 'runs'}`, priority: 1 }]
  if (page.total > 0) {
    parts.push({ key: 'range', text: `${page.first} to ${page.last}`, priority: 2 })
    parts.push({ key: 'page', text: `page ${page.page} of ${page.pageCount}`, priority: 3 })
  }
  return summaryLine(table, Math.max(10, view.columns), parts)
}

function headingOf(group: RunGroup, list: Extract<RunList, { kind: 'list' }>): string {
  if (group === 'main') return list.defaultBranch
  return group === 'branch' ? 'This branch' : 'Recent'
}

/** The Actions list pane body for a view. */
export function renderRuns(table: UiTable, view: RunsView, handlers: RepoHandlers): RenderElement {
  const { Box } = table
  const columns = Math.max(10, view.columns)
  const { runs } = view

  if (runs === null || runs.kind !== 'list') {
    const state = listState('Loading workflow runs…', runs, view.nowMs)
    return (
      <Box flexDirection="column">
        {messageLine(table, columns, state.text, state.isProblem ? view.palette.pending : undefined)}
        {footerRows(table, columns, pagerButtons('runs', handlers, false, false))}
      </Box>
    )
  }

  const page = paginateRuns(runs, view.page + 1, view.pageSize)
  const lines: RenderElement[] = [headerLine(table, view, page)]
  if (runs.problem) lines.push(messageLine(table, columns, staleText(runs.at, runs.problem, view.nowMs), view.palette.pending))
  if (page.rows.length === 0) lines.push(messageLine(table, columns, 'No workflow runs.'))
  let current: RunGroup | null = null
  for (const [index, entry] of page.rows.entries()) {
    if (entry.group !== current) {
      // One blank line before every heading but the first.
      if (current !== null) lines.push(blankLine(table))
      current = entry.group
      lines.push(messageLine(table, columns, headingLine(headingOf(entry.group, runs), columns)))
    }
    lines.push(runRow(table, view, handlers, entry.item, entry.group, columns))
    // One blank line between runs of a group, none after the last.
    if (page.rows[index + 1]?.group === entry.group) lines.push(blankLine(table))
  }
  const footer = pagerButtons('runs', handlers, page.page < page.pageCount, page.page > 1)
  return (
    <Box flexDirection="column">
      {lines}
      {footerRows(table, columns, footer)}
    </Box>
  )
}
