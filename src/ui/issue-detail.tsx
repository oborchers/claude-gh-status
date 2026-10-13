// The detail view of the Issues tab: one issue with its state, labels, linked
// pull requests, description and latest comments.

import type { RenderElement } from 'claude-code'

import type { Issue, LinkedPr } from '../model'
import { relativeTime } from '../status'
import { badgeBackground, mutedLabelColor, tone } from './colors'
import type { Palette } from './colors'
import type { IssueDetailView, RepoHandlers, UiTable } from './contract'
import { detailHeader, messageView, sectionHeading, staleRows } from './detail'
import { cellWidth, retryText, truncate } from './format'

/** Lines of the description before it is cut. */
export const MAX_BODY_LINES = 40
/** Lines of one comment before it is cut. */
export const MAX_COMMENT_LINES = 12

/** The first `max` lines of a text and whether lines were cut off. */
export function cutLines(text: string, max: number): { text: string; isCut: boolean } {
  const lines = text.replace(/\s+$/, '').split('\n')
  if (lines.length <= max) return { text: lines.join('\n'), isCut: false }
  return { text: lines.slice(0, max).join('\n'), isCut: true }
}

/** The badge background of an issue: green open, merged-purple closed as completed, grey closed as not planned. */
function stateBackground(palette: Palette, issue: Issue): string {
  if (issue.state === 'open') return badgeBackground(palette, 'open')
  return badgeBackground(palette, issue.stateReason === 'not-planned' ? 'draft' : 'merged')
}

function linkedPrLabel(pr: LinkedPr, columns: number): string {
  return truncate(`#${pr.number} ${pr.title}${pr.state === 'open' ? '' : ` (${pr.state})`}`, columns)
}

function commentRows(table: UiTable, view: IssueDetailView, issue: Issue): RenderElement[] {
  const { Markdown, Text } = table
  const { columns, nowMs } = view
  const rows: RenderElement[] = [sectionHeading(table, `Comments (${issue.commentCount})`, columns)]
  if (issue.comments.length === 0) {
    rows.push(<Text dimColor>no comments yet</Text>)
    return rows
  }
  const earlier = issue.commentCount - issue.comments.length
  if (earlier > 0) rows.push(<Text dimColor>{`… ${earlier} earlier on GitHub`}</Text>)
  issue.comments.forEach((comment) => {
    const dim = comment.isBot ? true : undefined
    const edited = comment.editedAt === null ? '' : ' (edited)'
    const cut = cutLines(comment.body, MAX_COMMENT_LINES)
    rows.push(
      <Text dimColor={dim} bold={comment.isBot ? undefined : true} wrap="truncate-end">
        {truncate(`@${comment.author} · ${relativeTime(comment.createdAt, nowMs)}${edited}`, columns)}
      </Text>,
    )
    rows.push(<Markdown text={cut.text === '' ? '(no text)' : cut.text} dimColor={dim} />)
    if (cut.isCut) rows.push(<Text dimColor>… more on GitHub</Text>)
  })
  return rows
}

function descriptionRows(table: UiTable, view: IssueDetailView, issue: Issue): RenderElement[] {
  const { Markdown, Text } = table
  const rows: RenderElement[] = [sectionHeading(table, 'Description', view.columns)]
  const cut = cutLines(issue.body, MAX_BODY_LINES)
  if (cut.text.trim() === '') rows.push(<Text dimColor>no description</Text>)
  else rows.push(<Markdown text={cut.text} />)
  if (cut.isCut) rows.push(<Text dimColor>… more on GitHub (o)</Text>)
  return rows
}

/** The issue detail body for a view. */
export function renderIssueDetail(table: UiTable, view: IssueDetailView, handlers: RepoHandlers): RenderElement {
  const { Box, Button, Text } = table
  const { snapshot, columns, palette, nowMs } = view

  if (snapshot.kind === 'loading') return messageView(table, `Loading issue #${snapshot.number}…`, true, handlers)
  if (snapshot.kind === 'error') {
    const hint = snapshot.problem === undefined ? '' : `, ${retryText(snapshot.problem, nowMs)}`
    return messageView(table, `Could not read issue #${snapshot.number}: ${snapshot.message}${hint}`, false, handlers)
  }

  const { issue } = snapshot
  const lead = (
    <>
      <Text color={palette.badgeText} backgroundColor={stateBackground(palette, issue)} bold>
        {` ${issue.state} `}
      </Text>
      <Text> </Text>
    </>
  )
  const header: RenderElement[] = [
    detailHeader(table, columns, lead, cellWidth(issue.state) + 3, `issue-${issue.number}`, `#${issue.number} ${issue.title}`, handlers),
    <Text dimColor wrap="truncate-end">
      {truncate(`${issue.author === null ? 'ghost' : `@${issue.author}`} · opened ${relativeTime(issue.createdAt, nowMs)}`, columns)}
    </Text>,
  ]
  if (issue.labels.length > 0) {
    header.push(
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {issue.labels.map((label) => (
          <Text color={mutedLabelColor(label.color)}>{label.name}</Text>
        ))}
      </Box>,
    )
  }
  if (issue.assignees.length > 0) {
    header.push(
      <Text dimColor wrap="truncate-end">
        {truncate(`assignees: ${issue.assignees.map((login) => `@${login}`).join(', ')}`, columns)}
      </Text>,
    )
  }
  if (issue.milestone !== null) {
    header.push(
      <Text dimColor wrap="truncate-end">
        {truncate(`milestone: ${issue.milestone}`, columns)}
      </Text>,
    )
  }
  header.push(...staleRows(table, palette, columns, nowMs, snapshot.at, snapshot.stale))

  const sections: RenderElement[] = [<Box flexDirection="column">{header}</Box>]
  if (issue.linkedPrs.length > 0) {
    sections.push(
      <Box flexDirection="column">
        {sectionHeading(table, 'Linked pull requests', columns)}
        {issue.linkedPrs.map((pr) => (
          <Button key={`linked-pr-${pr.number}`} plain onPress={() => handlers.openLinkedPr(pr.number)}>
            <Text color={tone(palette, pr.state === 'merged' ? 'merged' : undefined)} dimColor={pr.state === 'closed' ? true : undefined}>
              {linkedPrLabel(pr, columns)}
            </Text>
          </Button>
        ))}
      </Box>,
    )
  }
  sections.push(<Box flexDirection="column">{descriptionRows(table, view, issue)}</Box>)
  sections.push(<Box flexDirection="column">{commentRows(table, view, issue)}</Box>)
  sections.push(
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Button key="issue-open" plain hotkey="o" label="github" onPress={() => handlers.openUrl(issue.url)} />
      <Button key="issue-copy" plain hotkey="c" label="copy url" onPress={() => handlers.copyText(issue.url)} />
      <Button key="issue-refresh" plain hotkey="r" label="refresh" onPress={() => handlers.refresh()} />
    </Box>,
  )
  return (
    <Box flexDirection="column" gap={1}>
      {sections}
    </Box>
  )
}
