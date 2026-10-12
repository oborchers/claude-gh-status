// The list pane: the repository's open pull requests, grouped, one page at a time.
// A pull request takes two lines and a blank one: the title line (status symbol,
// title, labels) and a dim line of facts. Both lines are Buttons that select it.

import type { RenderElement } from 'claude-code'

import type { ListGroup, ListItem, PrList } from '../model'
import { PAGE_SIZE, groupItems, paginate } from '../list'
import { relativeTime } from '../status'
import { cellWidth, fitSegments, headingLine, retryText, truncate, unavailableText } from './format'
import { mutedLabelColor, tone } from './colors'
import type { Palette, Tone } from './colors'
import type { ListHandlers, ListView, UiTable } from './contract'

const SEPARATOR = ' · '
const GAP = '  '
const GAP_WIDTH = 2
const MARKER = '▸ '
const NO_MARKER = '  '
const NO_STATUS = ' '
const DRAFT = 'draft '
const FOOTER_GAP = 2
/** Cells before the title: the marker column, the status symbol and a space. */
const PREFIX_WIDTH = 4
/** Title cells a line keeps before any label is dropped. */
const TITLE_FLOOR = 24
const GROUP_HEADINGS: Record<ListGroup, string> = {
  yours: 'Yours',
  requested: 'Review requested from you',
  waiting: 'Waiting for review',
  other: 'Other open',
}
const REVIEW_TEXT = { approved: 'approved', 'changes-requested': 'changes requested', 'review-required': 'review required' } as const

/** A piece of a line: `color` is a palette tone, `hex` a literal color; neither draws in the default text color. */
type Run = { text: string; color?: Tone; hex?: string; isDim?: boolean; isBold?: boolean }

const runsWidth = (runs: Run[]): number => runs.reduce((sum, run) => sum + cellWidth(run.text), 0)

/** True when every pending check is still queued, none runs. */
function isOnlyQueued(item: ListItem): boolean {
  const { checks } = item
  return checks !== null && checks.pending > 0 && (checks.queued ?? 0) >= checks.pending
}

/** The symbol before a title and its tone: the state of the checks at a glance. */
function statusOf(item: ListItem): Run {
  const { checks } = item
  if (checks === null || checks.total <= 0) return { text: NO_STATUS }
  if (checks.failed > 0) return { text: '✗', color: 'failure' }
  if (checks.pending > 0) return { text: isOnlyQueued(item) ? '◷' : '●', color: 'pending' }
  return { text: '✓', color: 'success' }
}

function checksRun(item: ListItem): Run | null {
  const { checks } = item
  if (checks === null || checks.total <= 0) return null
  if (checks.failed > 0) return { text: `${checks.failed}/${checks.total} checks failing`, color: 'failure' }
  if (checks.pending > 0) return { text: `${checks.pending}/${checks.total} checks ${isOnlyQueued(item) ? 'queued' : 'running'}`, isDim: true }
  return { text: `${checks.passed}/${checks.total} passing`, isDim: true }
}

function reviewRun(item: ListItem): Run | null {
  switch (item.reviewDecision) {
    case 'approved':
      return { text: REVIEW_TEXT.approved, color: 'success' }
    case 'changes-requested':
      return { text: REVIEW_TEXT['changes-requested'], isDim: true }
    case 'review-required':
      return { text: REVIEW_TEXT['review-required'], isDim: true }
    default:
      return null
  }
}

/**
 * The labels that fit `room` cells, names only, two spaces apart, in the GitHub
 * color muted toward grey. Labels that do not fit are dropped from the end and
 * counted as `+N`; when not even that fits, nothing.
 */
function labelRuns(item: ListItem, room: number): Run[] {
  const { labels } = item
  const build = (shown: number): Run[] => {
    const runs: Run[] = []
    for (const label of labels.slice(0, shown)) {
      if (runs.length > 0) runs.push({ text: GAP })
      runs.push({ text: label.name, hex: mutedLabelColor(label.color) })
    }
    if (shown < labels.length) {
      if (runs.length > 0) runs.push({ text: GAP })
      runs.push({ text: `+${labels.length - shown}`, isDim: true })
    }
    return runs
  }
  for (let shown = labels.length; shown >= 0; shown -= 1) {
    const runs = build(shown)
    if (runsWidth(runs) <= room) return runs
  }
  return []
}

/** The runs cut to `max` cells; the one that crosses the edge ends in an ellipsis. */
function fitRuns(runs: Run[], max: number): Run[] {
  const kept: Run[] = []
  let used = 0
  for (const run of runs) {
    const width = cellWidth(run.text)
    if (used + width <= max) {
      kept.push(run)
      used += width
      continue
    }
    const text = truncate(run.text, max - used)
    if (text !== '') kept.push({ ...run, text })
    break
  }
  return kept
}

/** The facts line: '#15 · @oborchers · opened 2 h ago · 1/18 checks failing · review required · 💬 2'. */
function metaRuns(item: ListItem, nowMs: number): Run[] {
  const facts: Run[] = [{ text: `#${item.number}`, isDim: true }]
  if (item.author !== null) facts.push({ text: `@${item.author}`, isDim: true })
  facts.push({ text: `opened ${relativeTime(item.createdAt, nowMs)}`, isDim: true })
  for (const run of [checksRun(item), reviewRun(item)]) if (run !== null) facts.push(run)
  if (item.comments > 0) facts.push({ text: `💬 ${item.comments}`, isDim: true })
  const runs: Run[] = []
  for (const fact of facts) {
    if (runs.length > 0) runs.push({ text: SEPARATOR, isDim: true })
    runs.push(fact)
  }
  return runs
}

function drawRun(table: UiTable, palette: Palette, run: Run): RenderElement {
  const { Text } = table
  return (
    <Text color={run.hex ?? tone(palette, run.color)} bold={run.isBold === true ? true : undefined} dimColor={run.isDim === true ? true : undefined} wrap="truncate-end">
      {run.text}
    </Text>
  )
}

/** The title line of a pull request: marker, status symbol, title (bold), labels. A Button that selects it. */
function titleLine(table: UiTable, view: ListView, handlers: ListHandlers, item: ListItem, columns: number): RenderElement {
  const { Button, Text } = table
  const isSelected = view.selectedNumber === item.number
  // On a very narrow pane the draft prefix goes first; the title is dim anyway.
  const hasDraftPrefix = item.isDraft && columns - PREFIX_WIDTH - cellWidth(DRAFT) >= 4
  const room = Math.max(1, columns - PREFIX_WIDTH - (hasDraftPrefix ? cellWidth(DRAFT) : 0))
  const titleWidth = cellWidth(item.title)
  const everyLabel = labelRuns(item, Number.MAX_SAFE_INTEGER)
  let labels: Run[] = []
  if (everyLabel.length > 0) {
    // The title shrinks to its floor before a label is dropped.
    const fitsWhole = titleWidth + GAP_WIDTH + runsWidth(everyLabel) <= room
    const labelRoom = fitsWhole ? room : room - Math.min(titleWidth, TITLE_FLOOR) - GAP_WIDTH
    labels = labelRoom > 0 ? labelRuns(item, labelRoom) : []
  }
  const title = truncate(item.title, Math.max(1, room - (labels.length > 0 ? GAP_WIDTH + runsWidth(labels) : 0)))
  const parts: RenderElement[] = [
    <Text color={isSelected ? view.palette.pending : undefined} wrap="truncate-end">
      {isSelected ? MARKER : NO_MARKER}
    </Text>,
    drawRun(table, view.palette, statusOf(item)),
    <Text>{' '}</Text>,
  ]
  if (hasDraftPrefix) parts.push(drawRun(table, view.palette, { text: DRAFT, isDim: true }))
  parts.push(drawRun(table, view.palette, { text: title, isBold: true, isDim: item.isDraft }))
  if (labels.length > 0) {
    parts.push(<Text>{GAP}</Text>)
    for (const run of labels) parts.push(drawRun(table, view.palette, run))
  }
  return (
    <Button key={`pr-${item.number}`} plain label={`#${item.number} ${item.title}`} onPress={() => handlers.selectPr(item.number)}>
      {parts}
    </Button>
  )
}

/** The facts line: indented under the title, dim, cut at the end. A second Button that selects the same pull request. */
function metaLine(table: UiTable, view: ListView, handlers: ListHandlers, item: ListItem, columns: number): RenderElement {
  const { Button, Text } = table
  const runs = fitRuns(metaRuns(item, view.nowMs), Math.max(1, columns - PREFIX_WIDTH))
  return (
    <Button key={`pr-${item.number}-meta`} plain label={`#${item.number} ${item.title}`} onPress={() => handlers.selectPr(item.number)}>
      {[<Text>{' '.repeat(PREFIX_WIDTH)}</Text>, ...runs.map((run) => drawRun(table, view.palette, run))]}
    </Button>
  )
}

function blankLine(table: UiTable): RenderElement {
  const { Text } = table
  return <Text>{' '}</Text>
}

/** The summary line: '18 open · 1 to 25 · page 1 of 2 · drafts hidden', the account dim at the end. */
function headerLine(table: UiTable, view: ListView, list: Extract<PrList, { kind: 'list' }>, page: ReturnType<typeof paginate>): RenderElement {
  const { Box, Text } = table
  const columns = Math.max(10, view.columns)
  const parts: { key: string; text: string; priority: number; width: number }[] = []
  const add = (key: string, text: string, priority: number) => parts.push({ key, text, priority, width: cellWidth(text) })
  add('open', `${list.total} open`, 1)
  if (page.total > 0) {
    add('range', `${page.first} to ${page.last}`, 2)
    add('page', `page ${page.page} of ${page.pageCount}`, 3)
  }
  if (view.hideDrafts) add('drafts', 'drafts hidden', 4)
  if (list.isTruncated) add('truncated', `showing the first ${list.items.length}`, 5)
  add('account', `@${list.account.login}`, 6)
  const kept = fitSegments(parts, columns, cellWidth(SEPARATOR))
  const nodes: RenderElement[] = []
  kept.forEach((part, index) => {
    if (index > 0) {
      nodes.push(
        <Text dimColor wrap="truncate-end">
          {SEPARATOR}
        </Text>,
      )
    }
    nodes.push(
      <Text dimColor={part.key === 'account' ? true : undefined} wrap="truncate-end">
        {truncate(part.text, columns)}
      </Text>,
    )
  })
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      {nodes}
    </Box>
  )
}

type Footer = { key: string; hotkey: string; label: string; onPress: () => void }

function footerButtons(view: ListView, handlers: ListHandlers, hasNext: boolean, hasPrev: boolean, isList: boolean): Footer[] {
  const buttons: Footer[] = []
  if (hasNext) buttons.push({ key: 'list-next', hotkey: 'n', label: 'next', onPress: () => handlers.nextPage() })
  if (hasPrev) buttons.push({ key: 'list-prev', hotkey: 'p', label: 'previous', onPress: () => handlers.prevPage() })
  if (isList) buttons.push({ key: 'list-drafts', hotkey: 'h', label: view.hideDrafts ? 'show drafts' : 'hide drafts', onPress: () => handlers.toggleDrafts() })
  buttons.push({ key: 'list-refresh', hotkey: 'r', label: 'refresh', onPress: () => handlers.refresh() })
  if (view.selectedNumber !== null) buttons.push({ key: 'list-back', hotkey: 'b', label: 'back to branch PR', onPress: () => handlers.back() })
  buttons.push({ key: 'list-close', hotkey: 'x', label: 'close', onPress: () => handlers.closeList() })
  return buttons
}

/** The buttons packed into rows that fit `columns`. */
function footerRows(table: UiTable, columns: number, buttons: Footer[]): RenderElement[] {
  const { Box, Button } = table
  const lines: Footer[][] = []
  let width = 0
  for (const button of buttons) {
    const own = button.hotkey.length + 2 + cellWidth(button.label)
    const current = lines.at(-1)
    if (current === undefined || width + FOOTER_GAP + own > columns) {
      lines.push([button])
      width = own
    } else {
      current.push(button)
      width += FOOTER_GAP + own
    }
  }
  return lines.map((line) => (
    <Box flexDirection="row" flexWrap="nowrap">
      {line.map((button, index) => (
        <Box flexShrink={0} marginLeft={index === 0 ? undefined : FOOTER_GAP}>
          <Button key={button.key} plain hotkey={button.hotkey} label={button.label} onPress={button.onPress} />
        </Box>
      ))}
    </Box>
  ))
}

function messageLine(table: UiTable, view: ListView, text: string, color?: string): RenderElement {
  const { Text } = table
  return (
    <Text color={color} dimColor={color === undefined ? true : undefined} wrap="truncate-end">
      {truncate(text, Math.max(1, view.columns))}
    </Text>
  )
}

/** What the pane says while there is no list to draw. */
function stateText(view: ListView, list: PrList | null): { text: string; isProblem: boolean } {
  if (list === null || list.kind === 'loading') return { text: 'Loading pull requests…', isProblem: false }
  if (list.kind === 'error') {
    const { problem } = list
    if (problem !== undefined) return { text: `${unavailableText(problem)}, ${retryText(problem, view.nowMs)}`, isProblem: true }
    return { text: `gh-status: ${list.message}`, isProblem: true }
  }
  return { text: '', isProblem: false }
}

/** The list pane body for a view. */
export function renderList(table: UiTable, view: ListView, handlers: ListHandlers): RenderElement {
  const { Box } = table
  const columns = Math.max(10, view.columns)
  const { list } = view

  if (list === null || list.kind !== 'list') {
    const state = stateText(view, list)
    return (
      <Box flexDirection="column">
        {messageLine(table, view, state.text, state.isProblem ? view.palette.pending : undefined)}
        {footerRows(table, columns, footerButtons(view, handlers, false, false, false))}
      </Box>
    )
  }

  const viewer = list.account.login
  const page = paginate(groupItems(list.items, viewer), view.page + 1, PAGE_SIZE, view.hideDrafts)
  const lines: RenderElement[] = [headerLine(table, view, list, page)]
  if (list.problem) {
    const text = `showing last data from ${relativeTime(list.at, view.nowMs)}, ${unavailableText(list.problem)}, ${retryText(list.problem, view.nowMs)}`
    lines.push(messageLine(table, view, text, view.palette.pending))
  }
  if (page.rows.length === 0) {
    lines.push(messageLine(table, view, view.hideDrafts && list.items.length > 0 ? 'Only drafts are open.' : 'No open pull requests.'))
  }
  let current: ListGroup | null = null
  for (const [index, entry] of page.rows.entries()) {
    if (entry.group !== current) {
      // One blank line before every heading but the first.
      if (current !== null) lines.push(blankLine(table))
      current = entry.group
      lines.push(messageLine(table, view, headingLine(GROUP_HEADINGS[entry.group], columns)))
    }
    lines.push(titleLine(table, view, handlers, entry.item, columns))
    lines.push(metaLine(table, view, handlers, entry.item, columns))
    // One blank line between pull requests of a group, none after the last.
    if (page.rows[index + 1]?.group === entry.group) lines.push(blankLine(table))
  }
  const footer = footerButtons(view, handlers, page.page < page.pageCount, page.page > 1, true)
  return (
    <Box flexDirection="column">
      {lines}
      {footerRows(table, columns, footer)}
    </Box>
  )
}
