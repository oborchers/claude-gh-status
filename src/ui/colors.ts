// The two palettes the band and pane paint with. `claude` uses theme keys, so
// the colors follow the person's Claude Code theme on every surface; `github`
// uses GitHub's own Primer hex values. Neutral text is drawn with dimColor.

export type Palette = {
  /** PR state badge backgrounds. */
  badgeOpen: string
  badgeDraft: string
  badgeMerged: string
  badgeClosed: string
  badgeQueued: string
  /** Badge text, drawn on those backgrounds. */
  badgeText: string
  /** Passed, failed, pending or running, merged text. */
  success: string
  failure: string
  pending: string
  merged: string
}

export type PaletteName = 'claude' | 'github'

export type Tone = 'success' | 'failure' | 'pending' | 'merged'

export const PALETTES: Record<PaletteName, Palette> = {
  claude: {
    badgeOpen: 'success',
    badgeDraft: 'inactive',
    badgeMerged: 'merged',
    badgeClosed: 'error',
    badgeQueued: 'warning',
    badgeText: 'inverseText',
    success: 'success',
    failure: 'error',
    pending: 'warning',
    merged: 'merged',
  },
  github: {
    badgeOpen: '#238636',
    badgeDraft: '#6e7781',
    badgeMerged: '#8957e5',
    badgeClosed: '#da3633',
    badgeQueued: '#9a6700',
    badgeText: '#ffffff',
    success: '#3fb950',
    failure: '#f85149',
    pending: '#d29922',
    merged: '#a371f7',
  },
}

/** The palette an option value names; anything else is `claude`. */
export function paletteFor(option: unknown): Palette {
  return option === 'github' ? PALETTES.github : PALETTES.claude
}

/** The color of a tone in a palette; undefined draws in the default text color. */
export function tone(palette: Palette, value: Tone | undefined): string | undefined {
  return value === undefined ? undefined : palette[value]
}

/** The neutral grey a label color is mixed toward, so it reads on dark and light terminals. */
const LABEL_NEUTRAL = [0x9a, 0xa0, 0xb0] as const

/** Share of the neutral grey in a label color. */
const LABEL_MIX = 0.35

/** A GitHub label hex (six digits, no `#`) mixed 35% toward #9aa0b0, as `#rrggbb`; the neutral itself for anything that is not six hex digits. */
export function mutedLabelColor(hex: string): string {
  const isHex = hex.length === 6 && !/[^0-9a-fA-F]/.test(hex)
  const mixed = LABEL_NEUTRAL.map((neutral, index) => {
    const own = isHex ? parseInt(hex.slice(index * 2, index * 2 + 2), 16) : neutral
    return Math.round(own * (1 - LABEL_MIX) + neutral * LABEL_MIX)
  })
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** The badge background for a badge word. */
export function badgeBackground(palette: Palette, text: 'open' | 'draft' | 'merged' | 'closed' | 'queued'): string {
  switch (text) {
    case 'open':
      return palette.badgeOpen
    case 'draft':
      return palette.badgeDraft
    case 'merged':
      return palette.badgeMerged
    case 'closed':
      return palette.badgeClosed
    case 'queued':
      return palette.badgeQueued
  }
}
