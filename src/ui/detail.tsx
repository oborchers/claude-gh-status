// What the issue and run detail views share: the header row (lead, title, back
// and list buttons), the stale line, section headings and the message views.

import type { RenderElement } from 'claude-code'

import type { Problem } from '../model'
import { relativeTime } from '../status'
import type { Palette } from './colors'
import type { RepoHandlers, UiTable } from './contract'
import { cellWidth, headingLine, retryText, truncate, unavailableText } from './format'

const BACK_LABEL = 'back to list'
const LIST_GAP = 2

/** A dim section heading: `── Title ─────`. */
export function sectionHeading(table: UiTable, title: string, columns: number): RenderElement {
  const { Text } = table
  return (
    <Text dimColor wrap="truncate-end">
      {headingLine(title, columns)}
    </Text>
  )
}

/** Cells the `b: back to list` and `l: list` buttons take, with the gap before them. */
function navWidth(): number {
  return cellWidth(BACK_LABEL) + 3 + LIST_GAP + cellWidth('list') + 3 + LIST_GAP
}

/** `b: back to list` and `l: list`; both go up one level. */
export function navButtons(table: UiTable, handlers: Pick<RepoHandlers, 'back'>): RenderElement {
  const { Box, Button } = table
  return (
    <Box flexShrink={0} marginLeft={LIST_GAP}>
      <Button key="back" plain hotkey="b" label={BACK_LABEL} onPress={() => handlers.back()} />
      <Box marginLeft={LIST_GAP}>
        <Button key="pane-list" plain hotkey="l" label="list" onPress={() => handlers.back()} />
      </Box>
    </Box>
  )
}

/**
 * A header title: a plain Button whose one child is the monochrome title text (the label
 * stays the accessible name), so the engine's own inverse is the selection.
 */
export function titleButton(table: UiTable, key: string, label: string, onPress: () => void): RenderElement {
  const { Button, Text } = table
  return (
    <Button key={key} plain label={label} onPress={onPress}>
      <Text>{label}</Text>
    </Button>
  )
}

/**
 * The header: `lead` (a badge or glyph), then the number as a plain Button keyed `titleKey`
 * whose press only refreshes (a stable focus anchor), then the navigation; the whole
 * title wraps on the lines below.
 */
export function detailHeader(table: UiTable, lead: RenderElement | null, titleKey: string, number: string, title: string, handlers: Pick<RepoHandlers, 'back' | 'refresh'>): RenderElement[] {
  const { Box, Text } = table
  return [
    <Box flexDirection="row" flexWrap="nowrap">
      {lead === null ? null : <Box flexShrink={0}>{lead}</Box>}
      {titleButton(table, titleKey, number, () => handlers.refresh())}
      {navButtons(table, handlers)}
    </Box>,
    <Text bold wrap="wrap">
      {title}
    </Text>,
  ]
}

/** The one line under the header while the data is stale: its age, what is wrong, when the next try comes. Empty when fresh. */
export function staleRows(table: UiTable, palette: Palette, columns: number, nowMs: number, at: string, stale: Problem | null | undefined): RenderElement[] {
  const { Text } = table
  if (!stale) return []
  const text = `showing last data from ${relativeTime(at, nowMs)}, ${unavailableText(stale)}, ${retryText(stale, nowMs)}`
  return [
    <Text color={palette.pending} wrap="truncate-end">
      {truncate(text, columns)}
    </Text>,
  ]
}

/** What a view with no data yet or a failed read says, with refresh and the way back. */
export function messageView(table: UiTable, text: string, isDim: boolean, handlers: Pick<RepoHandlers, 'back' | 'refresh'>): RenderElement {
  const { Box, Button, Text } = table
  return (
    <Box flexDirection="column">
      <Text dimColor={isDim} wrap="wrap">
        {text}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => handlers.refresh()} />
        <Button key="back" plain hotkey="b" label={BACK_LABEL} onPress={() => handlers.back()} />
        <Button key="pane-list" plain hotkey="l" label="list" onPress={() => handlers.back()} />
      </Box>
    </Box>
  )
}
