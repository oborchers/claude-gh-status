// The list pane: the repository's open pull requests, grouped, one page at a time,
// one row each. A row is a plain Button; its columns are sized per page so they line up.

import type { RenderElement } from 'claude-code'

import type { ListGroup, ListItem, PrList } from '../model'
import { PAGE_SIZE, groupItems, paginate } from '../list'
import { relativeTime } from '../status'
import { cellWidth, fitSegments, headingLine, retryText, truncate, unavailableText } from './format'
import { tone } from './colors'
import type { Palette, Tone } from './colors'
import type { ListHandlers, ListView, UiTable } from './contract'

const SEPARATOR = ' · '
const GAP = '  '
const GAP_WIDTH = 2
const MARKER = '▸ '
const NO_MARKER = '  '
const DRAFT = 'draft '
const FOOTER_GAP = 2
/** Title cells a row keeps before any other column is dropped. */
const TITLE_FLOOR = 24
const LABELS_MAX = 40
/** Relative luminance above which a label gets black text; GitHub's own mid-tone colors (red, green) get white. */
const LABEL_LIGHT = 0.25
const GROUP_HEADINGS: Record<ListGroup, string> = {
  yours: 'Yours',
  requested: 'Review requested from you',
  waiting: 'Waiting for review',
  other: 'Other open',
}
const REVIEW_TEXT = { approved: 'approved', 'changes-requested': 'changes requested', 'review-required': 'review required' } as const

type Run = { text: string; color?: Tone; background?: string; textColor?: string; isDim?: boolean }
type ColumnKey = 'labels' | 'author' | 'age' | 'checks' | 'review' | 'comments'
type Column = { key: ColumnKey; width: number; cells: Map<string, Run[]> }

/** Columns dropped when the row is too wide, first to last. */
const DROP_ORDER: readonly ColumnKey[] = ['comments', 'review', 'age', 'author', 'labels']

const runsWidth = (runs: Run[]): number => runs.reduce((sum, run) => sum + cellWidth(run.text), 0)

const isHex = (value: string): boolean => value.length === 6 && !/[^0-9a-fA-F]/.test(value)

/** Black or white, whichever reads better on a label's GitHub hex color (WCAG relative luminance). */
export function labelTextColor(hex: string): string {
  const value = isHex(hex) ? hex : '808080'
  const channel = (offset: number): number => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255
    return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4)
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  return luminance > LABEL_LIGHT ? '#000000' : '#ffffff'
}

function labelRuns(item: ListItem, max: number): Run[] {
  const runs: Run[] = []
  let used = 0
  for (const [index, label] of item.labels.entries()) {
    const hasColor = isHex(label.color)
    const rest = item.labels.length - index - 1
    const reserve = rest > 0 ? cellWidth(` +${rest}`) : 0
    const text = ` ${label.name} `
    const width = cellWidth(text) + (runs.length > 0 ? 1 : 0)
    if (used + width + reserve > max) {
      if (runs.length === 0) {
        // Not even one label fits whole: cut it, so the row still shows that it has labels.
        const room = Math.max(3, max - 2)
        runs.push({ text: ` ${truncate(label.name, room)} `, background: hasColor ? `#${label.color}` : undefined, textColor: hasColor ? labelTextColor(label.color) : undefined, isDim: !hasColor })
        used = runsWidth(runs)
        if (rest > 0 && used + cellWidth(` +${rest}`) <= max) runs.push({ text: ` +${rest}`, isDim: true })
      } else {
        runs.push({ text: ` +${item.labels.length - index}`, isDim: true })
      }
      return runs
    }
    if (runs.length > 0) runs.push({ text: ' ' })
    runs.push({ text, background: hasColor ? `#${label.color}` : undefined, textColor: hasColor ? labelTextColor(label.color) : undefined, isDim: !hasColor })
    used += width
  }
  return runs
}

function checksRuns(item: ListItem): Run[] {
  const { checks } = item
  if (checks === null || checks.total <= 0) return []
  if (checks.failed > 0) return [{ text: `✗ ${checks.failed}/${checks.total}`, color: 'failure' }]
  if (checks.pending > 0) return [{ text: `● ${checks.pending}/${checks.total}`, color: 'pending' }]
  return [{ text: `✓ ${checks.passed}/${checks.total}`, color: 'success' }]
}

function reviewRuns(item: ListItem): Run[] {
  switch (item.reviewDecision) {
    case 'approved':
      return [{ text: REVIEW_TEXT.approved, color: 'success' }]
    case 'changes-requested':
      return [{ text: REVIEW_TEXT['changes-requested'], color: 'failure' }]
    case 'review-required':
      return [{ text: REVIEW_TEXT['review-required'], isDim: true }]
    default:
      return []
  }
}

/** Builds the columns of a page: each holds the cells of its rows and the width of the widest. */
function columnsFor(items: ListItem[], nowMs: number, labelsMax: number): Column[] {
  const build = (key: ColumnKey, cell: (item: ListItem) => Run[]): Column => {
    const cells = new Map<string, Run[]>()
    let width = 0
    for (const item of items) {
      const runs = cell(item)
      cells.set(item.id, runs)
      width = Math.max(width, runsWidth(runs))
    }
    return { key, width, cells }
  }
  return [
    build('labels', (item) => labelRuns(item, labelsMax)),
    build('author', (item) => (item.author === null ? [] : [{ text: `@${item.author}`, isDim: true }])),
    build('age', (item) => [{ text: relativeTime(item.createdAt, nowMs), isDim: true }]),
    build('checks', checksRuns),
    build('review', reviewRuns),
    build('comments', (item) => (item.comments > 0 ? [{ text: `💬 ${item.comments}`, isDim: true }] : [])),
  ].filter((column) => column.width > 0)
}

type Layout = {
  columns: Column[]
  numberWidth: number
  titleWidth: number
  hasDraft: boolean
}

/** Which columns survive in `columns` cells, and how wide the title is. Columns drop in DROP_ORDER, then the title shrinks. */
function layoutFor(items: ListItem[], nowMs: number, columns: number): Layout {
  const numberWidth = items.reduce((max, item) => Math.max(max, cellWidth(`#${item.number}`)), 0)
  const hasDraft = items.some((item) => item.isDraft)
  const titleFull = items.reduce((max, item) => Math.max(max, cellWidth(item.title)), 1)
  const labelsMax = Math.min(LABELS_MAX, Math.max(8, Math.floor(columns / 3)))
  let kept = columnsFor(items, nowMs, labelsMax)
  const fixed = (): number => cellWidth(NO_MARKER) + (hasDraft ? cellWidth(DRAFT) : 0) + numberWidth
  const others = (): number => kept.reduce((sum, column) => sum + GAP_WIDTH + column.width, 0)
  const floor = Math.min(titleFull, TITLE_FLOOR)
  for (const key of DROP_ORDER) {
    if (fixed() + GAP_WIDTH + floor + others() <= columns) break
    kept = kept.filter((column) => column.key !== key)
  }
  // Last resort on a very narrow pane: the checks go too, the number and a cut title stay.
  if (fixed() + GAP_WIDTH + Math.min(titleFull, 4) + others() > columns) kept = kept.filter((column) => column.key !== 'checks')
  const room = columns - fixed() - GAP_WIDTH - others()
  return { columns: kept, numberWidth, titleWidth: Math.max(1, Math.min(titleFull, room)), hasDraft }
}

function drawRun(table: UiTable, palette: Palette, run: Run, isRowDim: boolean): RenderElement {
  const { Text } = table
  return (
    <Text color={run.textColor ?? tone(palette, run.color)} backgroundColor={run.background} dimColor={run.isDim === true || isRowDim ? true : undefined} wrap="truncate-end">
      {run.text}
    </Text>
  )
}

function pad(table: UiTable, width: number): RenderElement | null {
  const { Text } = table
  return width > 0 ? <Text>{' '.repeat(width)}</Text> : null
}

function row(table: UiTable, view: ListView, handlers: ListHandlers, layout: Layout, item: ListItem): RenderElement {
  const { Button, Text } = table
  const isDim = item.isDraft
  const isSelected = view.selectedNumber === item.number
  const parts: (RenderElement | null)[] = []
  parts.push(
    <Text color={isSelected ? view.palette.pending : undefined} wrap="truncate-end">
      {isSelected ? MARKER : NO_MARKER}
    </Text>,
  )
  if (layout.hasDraft) {
    parts.push(
      <Text dimColor wrap="truncate-end">
        {item.isDraft ? DRAFT : ' '.repeat(cellWidth(DRAFT))}
      </Text>,
    )
  }
  const number = `#${item.number}`
  parts.push(
    <Text bold={isSelected ? true : undefined} dimColor={isDim ? true : undefined} wrap="truncate-end">
      {number + ' '.repeat(layout.numberWidth - cellWidth(number))}
    </Text>,
  )
  parts.push(<Text>{GAP}</Text>)
  const title = truncate(item.title, layout.titleWidth)
  parts.push(
    <Text bold={isSelected ? true : undefined} dimColor={isDim ? true : undefined} wrap="truncate-end">
      {title}
    </Text>,
  )
  parts.push(pad(table, layout.titleWidth - cellWidth(title)))
  for (const column of layout.columns) {
    const runs = column.cells.get(item.id) ?? []
    parts.push(<Text>{GAP}</Text>)
    for (const run of runs) parts.push(drawRun(table, view.palette, run, isDim))
    parts.push(pad(table, column.width - runsWidth(runs)))
  }
  return (
    <Button key={`pr-${item.number}`} plain label={`#${item.number} ${item.title}`} dimColor={isDim ? true : undefined} onPress={() => handlers.selectPr(item.number)}>
      {parts.filter((part): part is RenderElement => part !== null)}
    </Button>
  )
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
  const layout = layoutFor(
    page.rows.map((entry) => entry.item),
    view.nowMs,
    columns,
  )
  const lines: RenderElement[] = [headerLine(table, view, list, page)]
  if (list.problem) {
    const text = `showing last data from ${relativeTime(list.at, view.nowMs)}, ${unavailableText(list.problem)}, ${retryText(list.problem, view.nowMs)}`
    lines.push(messageLine(table, view, text, view.palette.pending))
  }
  if (page.rows.length === 0) {
    lines.push(messageLine(table, view, view.hideDrafts && list.items.length > 0 ? 'Only drafts are open.' : 'No open pull requests.'))
  }
  let current: ListGroup | null = null
  for (const entry of page.rows) {
    if (entry.group !== current) {
      current = entry.group
      lines.push(messageLine(table, view, headingLine(GROUP_HEADINGS[entry.group], columns)))
    }
    lines.push(row(table, view, handlers, layout, entry.item))
  }
  const footer = footerButtons(view, handlers, page.page < page.pageCount, page.page > 1, true)
  return (
    <Box flexDirection="column">
      {lines}
      {footerRows(table, columns, footer)}
    </Box>
  )
}
