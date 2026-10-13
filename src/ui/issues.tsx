// The Issues tab: the repository's open issues, grouped, one page at a time. An issue takes
// two lines and a blank one, like a pull request of the PRs tab: the title line (open mark,
// title, labels) and a dim line of facts, together one Button that opens it.

import type { RenderElement } from 'claude-code'

import type { IssueGroup, IssueItem, IssueList } from '../model'
import { groupIssues, paginateIssues } from '../issues'
import { relativeTime } from '../status'
import type { IssuesView, RepoHandlers, UiTable } from './contract'
import { headingLine } from './format'
import { GAP, PREFIX_WIDTH, blankLine, fitTitle, footerRows, joinFacts, listRow, listState, messageLine, pagerButtons, staleText, summaryLine } from './row'
import type { Run } from './row'

const OPEN_MARK = '◯'
const GROUP_HEADINGS: Record<IssueGroup, string> = {
  assigned: 'Assigned to you',
  opened: 'Opened by you',
  mentioned: 'Mentioning you',
  other: 'Other open',
}

/** The facts line: '#12 · @anna · opened 2 h ago · → @a, @b · 💬 3 · ⇄ #15, #16'. */
function factRuns(item: IssueItem, nowMs: number): Run[] {
  const facts: Run[] = [{ text: `#${item.number}`, isDim: true }]
  if (item.author !== null) facts.push({ text: `@${item.author}`, isDim: true })
  facts.push({ text: `opened ${relativeTime(item.createdAt, nowMs)}`, isDim: true })
  if (item.assignees.length > 0) facts.push({ text: `→ ${item.assignees.map((login) => `@${login}`).join(', ')}`, isDim: true })
  if (item.comments > 0) facts.push({ text: `💬 ${item.comments}`, isDim: true })
  if (item.linkedPrs.length > 0) facts.push({ text: `⇄ ${item.linkedPrs.map((number) => `#${number}`).join(', ')}`, isDim: true })
  return joinFacts(facts)
}

function issueRow(table: UiTable, view: IssuesView, handlers: RepoHandlers, item: IssueItem, columns: number): RenderElement {
  const key = `issue-${item.number}`
  const room = Math.max(1, columns - PREFIX_WIDTH)
  const { title, labels } = fitTitle(item.title, item.labels, room)
  const first: Run[] = [{ text: OPEN_MARK, color: 'success' }, { text: ' ' }, { text: title, isBold: true }]
  if (labels.length > 0) first.push({ text: GAP }, ...labels)
  return listRow(table, view.palette, {
    key,
    rowKey: `row-${key}`,
    label: `#${item.number} ${item.title}`,
    isFocused: view.focusedKey === key,
    columns,
    first,
    facts: factRuns(item, view.nowMs),
    onPress: () => handlers.selectIssue(item.number),
  })
}

/** The summary line: '12 open · 1 to 10 · page 1 of 2 · @viewer'. */
function headerLine(table: UiTable, view: IssuesView, list: Extract<IssueList, { kind: 'list' }>, page: ReturnType<typeof paginateIssues>): RenderElement {
  const parts: { key: string; text: string; priority: number }[] = [{ key: 'open', text: `${list.total} open`, priority: 1 }]
  if (page.total > 0) {
    parts.push({ key: 'range', text: `${page.first} to ${page.last}`, priority: 2 })
    parts.push({ key: 'page', text: `page ${page.page} of ${page.pageCount}`, priority: 3 })
  }
  if (list.isTruncated) parts.push({ key: 'truncated', text: `showing the first ${list.items.length}`, priority: 5 })
  parts.push({ key: 'account', text: `@${view.viewer}`, priority: 6 })
  return summaryLine(table, Math.max(10, view.columns), parts)
}

/** The Issues list pane body for a view. */
export function renderIssues(table: UiTable, view: IssuesView, handlers: RepoHandlers): RenderElement {
  const { Box } = table
  const columns = Math.max(10, view.columns)
  const { issues } = view

  if (issues === null || issues.kind !== 'list') {
    const state = listState('Loading issues…', issues, view.nowMs)
    return (
      <Box flexDirection="column">
        {messageLine(table, columns, state.text, state.isProblem ? view.palette.pending : undefined)}
        {footerRows(table, columns, pagerButtons('issues', handlers, false, false))}
      </Box>
    )
  }

  const page = paginateIssues(groupIssues(issues.items, view.viewer), view.page + 1)
  const lines: RenderElement[] = [headerLine(table, view, issues, page)]
  if (issues.problem) lines.push(messageLine(table, columns, staleText(issues.at, issues.problem, view.nowMs), view.palette.pending))
  if (page.rows.length === 0) lines.push(messageLine(table, columns, 'No open issues.'))
  let current: IssueGroup | null = null
  for (const [index, entry] of page.rows.entries()) {
    if (entry.group !== current) {
      // One blank line before every heading but the first.
      if (current !== null) lines.push(blankLine(table))
      current = entry.group
      lines.push(messageLine(table, columns, headingLine(GROUP_HEADINGS[entry.group], columns)))
    }
    lines.push(issueRow(table, view, handlers, entry.item, columns))
    // One blank line between issues of a group, none after the last.
    if (page.rows[index + 1]?.group === entry.group) lines.push(blankLine(table))
  }
  const footer = pagerButtons('issues', handlers, page.page < page.pageCount, page.page > 1)
  return (
    <Box flexDirection="column">
      {lines}
      {footerRows(table, columns, footer)}
    </Box>
  )
}
