// The tab row every view of the pane draws first: '1: PRs 4   2: Issues 7   3: Actions ✗'.
// Three plain Buttons with the hotkeys 1, 2 and 3 (the engine draws the '1: ' itself);
// while a confirmation waits the same
// row is drawn as plain text, so nothing moves the focus away from the confirmation.

import type { RenderElement } from 'claude-code'

import type { CheckState, PaneTab } from '../model'
import { tone } from './colors'
import type { Tone } from './colors'
import type { TabsView, UiTable } from './contract'
import { cellWidth, truncate } from './format'
import { swapped } from './row'

const TAB_GAP = '   '
const TAB_GAP_WIDTH = 3

type TabSpec = { tab: PaneTab; hotkey: string; key: string; name: string }

const TABS: readonly TabSpec[] = [
  { tab: 'prs', hotkey: '1', key: 'tab-prs', name: 'PRs' },
  { tab: 'issues', hotkey: '2', key: 'tab-issues', name: 'Issues' },
  { tab: 'actions', hotkey: '3', key: 'tab-actions', name: 'Actions' },
]

/** The symbol of the default branch's worst state and its tone; null without runs or for states that say nothing. */
export function mainSymbol(worst: CheckState | null): { text: string; color: Tone } | null {
  switch (worst) {
    case 'failure':
    case 'timed-out':
    case 'action-required':
      return { text: '✗', color: 'failure' }
    case 'running':
    case 'queued':
      return { text: '●', color: 'pending' }
    case 'success':
      return { text: '✓', color: 'success' }
    default:
      return null
  }
}

type Suffix = { text: string; color?: Tone }

/** The count or symbol after a tab's name; null while unknown. */
function suffixOf(view: TabsView, tab: PaneTab): Suffix | null {
  if (tab === 'prs') return view.prCount === null ? null : { text: String(view.prCount) }
  if (tab === 'issues') return view.issueCount === null ? null : { text: String(view.issueCount) }
  return mainSymbol(view.mainWorst)
}

function itemWidth(spec: TabSpec, suffix: Suffix | null): number {
  return cellWidth(`${spec.hotkey}: ${spec.name}`) + (suffix === null ? 0 : 1 + cellWidth(suffix.text))
}

/**
 * The tab row for a view; `onShow` is called with the tab a press or hotkey picks.
 * `columns` (default 80) decides how much fits: too narrow for the counts, the names
 * alone are drawn, and below that the names are cut.
 */
export function renderTabs(table: UiTable, view: TabsView, onShow: (tab: PaneTab) => void, columns = 80): RenderElement {
  const { Box, Button, Text } = table
  const { palette } = view
  const suffixes = TABS.map((spec) => suffixOf(view, spec.tab))
  const gaps = TAB_GAP_WIDTH * (TABS.length - 1)
  const full = TABS.reduce((sum, spec, index) => sum + itemWidth(spec, suffixes[index] ?? null), 0) + gaps
  const hasSuffix = full <= columns
  const bare = TABS.reduce((sum, spec) => sum + itemWidth(spec, null), 0) + gaps
  const nameRoom = Math.max(1, Math.floor((columns - gaps) / TABS.length) - cellWidth('1: '))
  const nodes: RenderElement[] = []
  TABS.forEach((spec, index) => {
    const isActive = view.tab === spec.tab
    const suffix = hasSuffix ? (suffixes[index] ?? null) : null
    const name = bare <= columns ? spec.name : truncate(spec.name, nameRoom)
    const isFocused = view.focusedKey === spec.key
    const bold = isActive ? true : undefined
    const style = { bold, dimColor: isActive ? undefined : true }
    const plainHover = swapped(undefined, isActive)
    // Focused, a piece is drawn pre-swapped so the engine's inverse reads as normal colors on the focus background.
    const piece = (text: string, shown?: string): RenderElement => {
      if (view.isLocked) return shown === undefined ? <Text {...style}>{text}</Text> : <Text color={shown} bold={bold}>{text}</Text>
      const hover = shown === undefined ? plainHover : swapped(shown, isActive)
      if (isFocused) return <Text {...hover} hover={hover}>{text}</Text>
      if (shown === undefined) return <Text {...style} hover={hover}>{text}</Text>
      return <Text color={shown} bold={bold} hover={hover}>{text}</Text>
    }
    const children: RenderElement[] = [piece(name)]
    if (suffix !== null) {
      children.push(piece(' '))
      children.push(piece(suffix.text, suffix.color === undefined ? undefined : tone(palette, suffix.color)))
    }
    if (index > 0) nodes.push(<Text>{TAB_GAP}</Text>)
    if (view.isLocked) {
      nodes.push(<Box flexShrink={0}>{[<Text {...style}>{`${spec.hotkey}: `}</Text>, ...children]}</Box>)
      return
    }
    nodes.push(
      <Box key={`tabbox-${spec.tab}`} flexShrink={0}>
        <Button key={spec.key} plain hotkey={spec.hotkey} label={spec.name} onPress={() => onShow(spec.tab)}>
          {children}
        </Button>
      </Box>,
    )
  })
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      {nodes}
    </Box>
  )
}
