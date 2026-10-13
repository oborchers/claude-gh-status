// The list view of the pane: the repository's open pull requests, grouped, one page at a time.
// A pull request takes two lines and a blank one: the title line (status symbol,
// title, labels) and a dim line of facts, together one Button that opens it.

import type { RenderElement } from 'claude-code'

import type { ListGroup, ListItem, PrList } from '../model'
import { PAGE_SIZE, groupItems, paginate } from '../list'
import { relativeTime } from '../status'
import { cellWidth, headingLine, retryText, unavailableText } from './format'
import type { ListHandlers, ListView, UiTable } from './contract'
import { GAP, PREFIX_WIDTH, blankLine, fitTitle, footerRows, joinFacts, listRow, messageLine, summaryLine } from './row'
import type { Footer, Run } from './row'

export { FOCUS_BG, FOCUS_DIM, FOCUS_FG } from './row'

const NO_STATUS = ' '
const DRAFT = 'draft '
const GROUP_HEADINGS: Record<ListGroup, string> = {
  yours: 'Yours',
  requested: 'Review requested from you',
  waiting: 'Waiting for review',
  other: 'Other open',
}
const REVIEW_TEXT = { approved: 'approved', 'changes-requested': 'changes requested', 'review-required': 'review required' } as const

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
  if (checks === null) return null
  // Skipped and neutral checks did not run; they are counted apart, never as part of the total that passed.
  const ran = checks.passed + checks.failed + checks.pending
  const skipped = checks.total - ran
  const skippedText = skipped > 0 ? `, ${skipped} skipped` : ''
  if (ran <= 0) return skipped > 0 ? { text: `${skipped} skipped`, isDim: true } : null
  if (checks.failed > 0) return { text: `${checks.failed}/${ran} checks failing${skippedText}`, color: 'failure' }
  if (checks.pending > 0) return { text: `${checks.pending}/${ran} checks ${isOnlyQueued(item) ? 'queued' : 'running'}${skippedText}`, isDim: true }
  return { text: `${checks.passed}/${ran} passing${skippedText}`, isDim: true }
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

/** The facts line: '#15 · @oborchers · opened 2 h ago · 1/18 checks failing · review required · 💬 2'. */
function metaRuns(item: ListItem, nowMs: number): Run[] {
  const facts: Run[] = [{ text: `#${item.number}`, isDim: true }]
  if (item.author !== null) facts.push({ text: `@${item.author}`, isDim: true })
  facts.push({ text: `opened ${relativeTime(item.createdAt, nowMs)}`, isDim: true })
  for (const run of [checksRun(item), reviewRun(item)]) if (run !== null) facts.push(run)
  if (item.comments > 0) facts.push({ text: `💬 ${item.comments}`, isDim: true })
  return joinFacts(facts)
}

/**
 * A pull request: one Button of two lines, so the focus ring stops once per PR. The
 * engine inverts every piece but the one that opens the facts line, from its newline on.
 */
function prRow(table: UiTable, view: ListView, handlers: ListHandlers, item: ListItem, columns: number): RenderElement {
  const { palette } = view
  const key = `pr-${item.number}`
  const isFocused = view.focusedKey === key
  // On a very narrow pane the draft prefix goes first; the title is dim anyway.
  const hasDraftPrefix = item.isDraft && columns - PREFIX_WIDTH - cellWidth(DRAFT) >= 4
  const room = Math.max(1, columns - PREFIX_WIDTH - (hasDraftPrefix ? cellWidth(DRAFT) : 0))
  const { title, labels } = fitTitle(item.title, item.labels, room)
  const first: Run[] = [statusOf(item), { text: ' ' }]
  if (hasDraftPrefix) first.push({ text: DRAFT, isDim: true })
  first.push({ text: title, isBold: !item.isDraft, isDim: item.isDraft })
  if (labels.length > 0) first.push({ text: GAP }, ...labels)
  return listRow(table, palette, { key, rowKey: `row-${item.number}`, label: `#${item.number} ${item.title}`, isFocused, columns, first, facts: metaRuns(item, view.nowMs), onPress: () => handlers.selectPr(item.number) })
}

/** The summary line: '18 open · 1 to 25 · page 1 of 2 · drafts hidden', the account dim at the end. */
function headerLine(table: UiTable, view: ListView, list: Extract<PrList, { kind: 'list' }>, page: ReturnType<typeof paginate>): RenderElement {
  const columns = Math.max(10, view.columns)
  const parts: { key: string; text: string; priority: number }[] = []
  const add = (key: string, text: string, priority: number) => parts.push({ key, text, priority })
  add('open', `${list.total} open`, 1)
  if (page.total > 0) {
    add('range', `${page.first} to ${page.last}`, 2)
    add('page', `page ${page.page} of ${page.pageCount}`, 3)
  }
  if (view.hideDrafts) add('drafts', 'drafts hidden', 4)
  if (list.isTruncated) add('truncated', `showing the first ${list.items.length}`, 5)
  add('account', `@${list.account.login}`, 6)
  return summaryLine(table, columns, parts)
}

function footerButtons(view: ListView, handlers: ListHandlers, hasNext: boolean, hasPrev: boolean, isList: boolean): Footer[] {
  const buttons: Footer[] = []
  if (hasNext) buttons.push({ key: 'list-next', hotkey: 'n', label: 'next', onPress: () => handlers.nextPage() })
  if (hasPrev) buttons.push({ key: 'list-prev', hotkey: 'p', label: 'previous', onPress: () => handlers.prevPage() })
  if (isList) buttons.push({ key: 'list-drafts', hotkey: 'h', label: view.hideDrafts ? 'show drafts' : 'hide drafts', onPress: () => handlers.toggleDrafts() })
  buttons.push({ key: 'list-refresh', hotkey: 'r', label: 'refresh', onPress: () => handlers.refresh() })
  buttons.push({ key: 'list-close', hotkey: 'x', label: 'close', onPress: () => handlers.closePane() })
  return buttons
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
        {messageLine(table, view.columns, state.text, state.isProblem ? view.palette.pending : undefined)}
        {footerRows(table, columns, footerButtons(view, handlers, false, false, false))}
      </Box>
    )
  }

  const viewer = list.account.login
  const page = paginate(groupItems(list.items, viewer), view.page + 1, PAGE_SIZE, view.hideDrafts)
  const lines: RenderElement[] = [headerLine(table, view, list, page)]
  if (list.problem) {
    const text = `showing last data from ${relativeTime(list.at, view.nowMs)}, ${unavailableText(list.problem)}, ${retryText(list.problem, view.nowMs)}`
    lines.push(messageLine(table, view.columns, text, view.palette.pending))
  }
  if (page.rows.length === 0) {
    lines.push(messageLine(table, view.columns, view.hideDrafts && list.items.length > 0 ? 'Only drafts are open.' : 'No open pull requests.'))
  }
  let current: ListGroup | null = null
  for (const [index, entry] of page.rows.entries()) {
    if (entry.group !== current) {
      // One blank line before every heading but the first.
      if (current !== null) lines.push(blankLine(table))
      current = entry.group
      lines.push(messageLine(table, view.columns, headingLine(GROUP_HEADINGS[entry.group], columns)))
    }
    lines.push(prRow(table, view, handlers, entry.item, columns))
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
