// A clickable PR reference that never draws the raw URL. A terminal without
// OSC 8 support draws a Link's text and then its URL, which wraps the band, so
// the terminal gets a plain Button (label only) that opens the PR; the desktop
// gets a real Link with an explicit label.

import type { RenderElement } from 'claude-code'

import type { Handlers, UiTable, View } from './contract'

/** The PR reference with `label` as its only visible text. */
export function prAnchor(table: UiTable, view: View, handlers: Handlers, href: string, label: string): RenderElement {
  const { Button, Link } = table
  if (view.surface === 'desktop') return <Link href={href} label={label} />
  return <Button key="pr-anchor" plain label={label} onPress={() => handlers.openOnGitHub()} />
}
