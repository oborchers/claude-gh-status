// The row machinery of the pane's lists: a row is one plain Button of two lines
// (a title line and a dim line of facts) inside a keyed Box, the pieces drawn with
// the colors the engine's focus inversion needs. Shared by the PR, Issues and Actions lists.

import type { RenderElement } from 'claude-code'

import { cellWidth, fitSegments, retryText, truncate, unavailableText } from './format'
import { mutedLabelColor, tone } from './colors'
import type { Palette, Tone } from './colors'
import type { RepoHandlers, UiTable } from './contract'
import type { Problem } from '../model'
import { relativeTime } from '../status'

export const SEPARATOR = ' · '
export const GAP = '  '
export const GAP_WIDTH = 2
export const MARKER = '▸ '
export const NO_MARKER = '  '
export const FOOTER_GAP = 2
/** Cells before the title: the marker column, the status symbol and a space. */
export const PREFIX_WIDTH = 4
/** Title cells a line keeps before any label is dropped. */
export const TITLE_FLOOR = 24

/** A piece of a line: `color` is a palette tone, `hex` a literal color; neither draws in the default text color. */
export type Run = { text: string; color?: Tone; hex?: string; isDim?: boolean; isBold?: boolean }

export const runsWidth = (runs: Run[]): number => runs.reduce((sum, run) => sum + cellWidth(run.text), 0)

/**
 * The labels that fit `room` cells, names only, two spaces apart, in the GitHub
 * color muted toward grey. Labels that do not fit are dropped from the end and
 * counted as `+N`; when not even that fits, nothing.
 */
export function labelRuns(labels: { name: string; color: string }[], room: number): Run[] {
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

/** The title cut and the labels that fit beside it in `room` cells: the title shrinks to its floor before a label is dropped. */
export function fitTitle(title: string, labelList: { name: string; color: string }[], room: number): { title: string; labels: Run[] } {
  const titleWidth = cellWidth(title)
  const everyLabel = labelRuns(labelList, Number.MAX_SAFE_INTEGER)
  let labels: Run[] = []
  if (everyLabel.length > 0) {
    const fitsWhole = titleWidth + GAP_WIDTH + runsWidth(everyLabel) <= room
    const labelRoom = fitsWhole ? room : room - Math.min(titleWidth, TITLE_FLOOR) - GAP_WIDTH
    labels = labelRoom > 0 ? labelRuns(labelList, labelRoom) : []
  }
  return { title: truncate(title, Math.max(1, room - (labels.length > 0 ? GAP_WIDTH + runsWidth(labels) : 0))), labels }
}

/** The runs cut to `max` cells; the one that crosses the edge ends in an ellipsis. */
export function fitRuns(runs: Run[], max: number): Run[] {
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

/** Colors of the focused row, raw so they read on light and dark themes alike. */
export const FOCUS_BG = '#30363d'
export const FOCUS_FG = '#e6edf3'
export const FOCUS_DIM = '#8b949e'

export type LineProps = { color?: string; backgroundColor?: string; dimColor?: true; bold?: true }

/** The color a run is meant to show in: its own, the dim grey for dim runs, else undefined (the foreground). */
export function segmentColor(palette: Palette, run: Run): string | undefined {
  const own = run.hex ?? tone(palette, run.color)
  if (own !== undefined) return own
  return run.isDim === true ? FOCUS_DIM : undefined
}

/**
 * The colors of a title-line piece that shows `shown` on the focus background. The engine
 * marks a focused (or hovered) Button by inverting its first line, so the colors are drawn
 * swapped: after the inverse the piece reads `shown` (else the focus foreground) on FOCUS_BG.
 */
export function swapped(shown: string | undefined, isBold: boolean): LineProps {
  return { color: FOCUS_BG, backgroundColor: shown ?? FOCUS_FG, ...(isBold ? { bold: true as const } : {}) }
}

/** One piece of the title line, with the swapped colors it takes in focus and under the pointer. */
export function titlePiece(table: UiTable, palette: Palette, run: Run, isFocused: boolean): RenderElement {
  const { Text } = table
  const isBold = run.isBold === true
  const hover = swapped(segmentColor(palette, run), isBold)
  if (isFocused) return <Text {...hover} hover={hover} wrap="truncate-end">{run.text}</Text>
  return (
    <Text color={run.hex ?? tone(palette, run.color)} bold={isBold ? true : undefined} dimColor={run.isDim === true ? true : undefined} hover={hover} wrap="truncate-end">
      {run.text}
    </Text>
  )
}

/**
 * One piece of the facts line: its own colors at rest. The engine's inverse stops at the
 * newline inside the piece that opens the line, and every later piece is inverted again,
 * so those are drawn swapped like the title line; the opening piece takes the focus
 * colors as they are.
 */
export function factPiece(table: UiTable, palette: Palette, run: Run, isFocused: boolean, text = run.text, isOpening = false): RenderElement {
  const { Text } = table
  const hover = isOpening ? { color: FOCUS_DIM, backgroundColor: FOCUS_BG } : swapped(segmentColor(palette, run) ?? FOCUS_DIM, false)
  if (isFocused) return <Text {...hover} hover={hover} wrap="truncate-end">{text}</Text>
  return (
    <Text color={run.hex ?? tone(palette, run.color)} dimColor={run.isDim === true ? true : undefined} hover={hover} wrap="truncate-end">
      {text}
    </Text>
  )
}

/**
 * A list row: one plain Button of two lines, so the focus ring stops once per row. The
 * engine inverts every piece but the one that opens the facts line, from its newline on.
 * `first` is the title line after the marker column, `facts` the facts line after its indent.
 */
export function listRow(
  table: UiTable,
  palette: Palette,
  opts: { key: string; rowKey: string; label: string; isFocused: boolean; columns: number; first: Run[]; facts: Run[]; onPress: () => void },
): RenderElement {
  const { Box, Button } = table
  const { key, rowKey, label, isFocused, columns, onPress } = opts
  const first: Run[] = [isFocused ? { text: MARKER, color: 'pending' } : { text: NO_MARKER }, ...opts.first]
  first.push({ text: ' '.repeat(Math.max(0, columns - runsWidth(first))) })
  const facts = fitRuns(opts.facts, Math.max(1, columns - PREFIX_WIDTH))
  const factsUsed = PREFIX_WIDTH + runsWidth(facts)
  const children: RenderElement[] = first.map((run) => titlePiece(table, palette, run, isFocused))
  children.push(factPiece(table, palette, { text: '' }, isFocused, `\n${' '.repeat(PREFIX_WIDTH)}`, true))
  for (const run of facts) children.push(factPiece(table, palette, run, isFocused))
  children.push(factPiece(table, palette, { text: '' }, isFocused, ' '.repeat(Math.max(0, columns - factsUsed))))
  return (
    <Box key={rowKey} flexDirection="column">
      <Button key={key} plain label={label} onPress={onPress}>
        {children}
      </Button>
    </Box>
  )
}

/** Facts joined by the dim separator. */
export function joinFacts(facts: Run[]): Run[] {
  const runs: Run[] = []
  for (const fact of facts) {
    if (runs.length > 0) runs.push({ text: SEPARATOR, isDim: true })
    runs.push(fact)
  }
  return runs
}

export function blankLine(table: UiTable): RenderElement {
  const { Text } = table
  return <Text>{' '}</Text>
}

/** A summary line of dim-separated parts; the last-priority ones are dropped first when narrow, `account` is drawn dim. */
export function summaryLine(table: UiTable, columns: number, parts: { key: string; text: string; priority: number }[]): RenderElement {
  const { Box, Text } = table
  const kept = fitSegments(parts.map((part) => ({ ...part, width: cellWidth(part.text) })), columns, cellWidth(SEPARATOR))
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

export type Footer = { key: string; hotkey: string; label: string; onPress: () => void }

/** The buttons packed into rows that fit `columns`. */
export function footerRows(table: UiTable, columns: number, buttons: Footer[]): RenderElement[] {
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

/** One line of text in `truncate-end`; dim unless `color` is given. */
export function messageLine(table: UiTable, columns: number, text: string, color?: string): RenderElement {
  const { Text } = table
  return (
    <Text color={color} dimColor={color === undefined ? true : undefined} wrap="truncate-end">
      {truncate(text, Math.max(1, columns))}
    </Text>
  )
}

/** The footer of the Issues and Actions lists: next and previous only where they apply, then refresh and close. */
export function pagerButtons(prefix: string, handlers: RepoHandlers, hasNext: boolean, hasPrev: boolean): Footer[] {
  const buttons: Footer[] = []
  if (hasNext) buttons.push({ key: `${prefix}-next`, hotkey: 'n', label: 'next', onPress: () => handlers.nextPage() })
  if (hasPrev) buttons.push({ key: `${prefix}-prev`, hotkey: 'p', label: 'previous', onPress: () => handlers.prevPage() })
  buttons.push({ key: `${prefix}-refresh`, hotkey: 'r', label: 'refresh', onPress: () => handlers.refresh() })
  buttons.push({ key: `${prefix}-close`, hotkey: 'x', label: 'close', onPress: () => handlers.closePane() })
  return buttons
}

/** What a list says while it has nothing to draw: loading, or the error with its retry; empty text when it is a list. */
export function listState(loading: string, list: { kind: string; message?: string; problem?: Problem } | null, nowMs: number): { text: string; isProblem: boolean } {
  if (list === null || list.kind === 'loading') return { text: loading, isProblem: false }
  if (list.kind === 'error') {
    const { problem } = list
    if (problem !== undefined) return { text: `${unavailableText(problem)}, ${retryText(problem, nowMs)}`, isProblem: true }
    return { text: `gh-status: ${list.message ?? ''}`, isProblem: true }
  }
  return { text: '', isProblem: false }
}

/** The hint line over stale data: 'showing last data from 1 min ago, GitHub unavailable (504), retrying in 5 s'. */
export function staleText(at: string, problem: Problem, nowMs: number): string {
  return `showing last data from ${relativeTime(at, nowMs)}, ${unavailableText(problem)}, ${retryText(problem, nowMs)}`
}
