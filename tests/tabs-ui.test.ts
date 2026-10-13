import { describe, expect, test } from 'claude-code/testing'

import type { PaneTab } from '../src/model'
import { PALETTES } from '../src/ui/colors'
import type { TabsView } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { renderTabs } from '../src/ui/tabs'
import { SURFACES, createRig, hotkeysOf, linesOf, nodesOf } from './fixtures/ui-rig'

type Show = { onShow: (tab: PaneTab) => void; columns: number }

function viewOf(extra: Partial<TabsView> = {}): TabsView {
  return { tab: 'prs', prCount: 4, issueCount: 7, mainWorst: 'failure', isLocked: false, palette: PALETTES.claude, ...extra }
}

const ignore: Show = { onShow: () => {}, columns: 80 }
const rigFor = (on: Parameters<typeof createRig>[0]) => createRig<TabsView & { surface?: 'terminal' | 'desktop' }, Show>(on, (table, view, handlers) => renderTabs(table, view, handlers.onShow, handlers.columns))

describe('renderTabs', () => {
  test('draws one line: hotkey, name and the count or symbol after it', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const ui = await rig.show($, surface, viewOf(), ignore, 80)
      expect(await linesOf(ui)).toEqual(['1: PRs 4   2: Issues 7   3: Actions ✗'])
      await ui.unmount()
    }
  })

  test('the symbol follows the worst state of the default branch, in the tone of the palette', async ($, on) => {
    const rig = rigFor(on)
    const cases: [TabsView['mainWorst'], string | null, 'failure' | 'pending' | 'success' | null][] = [
      ['failure', '✗', 'failure'],
      ['timed-out', '✗', 'failure'],
      ['running', '●', 'pending'],
      ['queued', '●', 'pending'],
      ['success', '✓', 'success'],
      ['skipped', null, null],
      [null, null, null],
    ]
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      for (const [worst, symbol, color] of cases) {
        const ui = await rig.show($, 'terminal', viewOf({ mainWorst: worst, palette }), ignore, 80)
        const line = (await linesOf(ui))[0]
        expect(line).toBe(symbol === null ? '1: PRs 4   2: Issues 7   3: Actions' : `1: PRs 4   2: Issues 7   3: Actions ${symbol}`)
        if (symbol !== null && color !== null) {
          const node = nodesOf(await ui.drawn()).find((candidate) => candidate.children?.[0] === symbol)
          expect(node?.props?.color).toBe(palette[color])
        }
        await ui.unmount()
      }
    }
  })

  test('an unknown count is left out', async ($, on) => {
    const rig = rigFor(on)
    const ui = await rig.show($, 'terminal', viewOf({ prCount: null, issueCount: null, mainWorst: null }), ignore, 80)
    expect(await linesOf(ui)).toEqual(['1: PRs   2: Issues   3: Actions'])
  })

  test('the active tab is bold, the others dim', async ($, on) => {
    const rig = rigFor(on)
    const names = { prs: 'PRs', issues: 'Issues', actions: 'Actions' }
    for (const tab of ['prs', 'issues', 'actions'] as const) {
      const ui = await rig.show($, 'terminal', viewOf({ tab }), ignore, 80)
      for (const [which, text] of Object.entries(names)) {
        const node = nodesOf(await ui.drawn()).find((candidate) => candidate.children?.[0] === text)
        if (which === tab) {
          expect(node?.props?.bold).toBe(true)
          expect(node?.props?.dimColor).toBeUndefined()
        } else {
          expect(node?.props?.dimColor).toBe(true)
          expect(node?.props?.bold).toBeUndefined()
        }
      }
      await ui.unmount()
    }
  })

  test('three plain buttons keyed tab-*, hotkeys 1 2 3, a press shows the tab', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const calls: PaneTab[] = []
      const ui = await rig.show($, surface, viewOf(), { onShow: (tab) => void calls.push(tab), columns: 80 }, 80)
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map((button) => String(button.key))).toEqual(['tab-prs', 'tab-issues', 'tab-actions'])
      for (const button of buttons) expect(button.props.plain).toBe(true)
      expect(await hotkeysOf(ui)).toEqual(['1', '2', '3'])
      expect(buttons.map((button) => button.props.label)).toEqual(['PRs', 'Issues', 'Actions'])
      await ui.press({ key: 'tab-issues' })
      await ui.press({ key: 'tab-actions' })
      await ui.press({ key: 'tab-prs' })
      expect(calls).toEqual(['issues', 'actions', 'prs'])
      await ui.unmount()
    }
  })

  test('the Button holds only the monochrome name; the count or symbol follows outside, the symbol in its tone', async ($, on) => {
    const rig = rigFor(on)
    type Piece = { props?: Record<string, unknown>; hover?: unknown }
    const claude = PALETTES.claude
    for (const surface of SURFACES) {
      const ui = await rig.show($, surface, viewOf({ tab: 'issues' }), ignore, 80)
      const issues = (await ui.find({ key: 'tab-issues' })) as { children: Piece[] }
      expect(issues.children).toHaveLength(1)
      expect(issues.children[0]).toMatchObject({ children: ['Issues'], props: { bold: true } })
      expect(issues.children[0]?.props?.color).toBeUndefined()
      expect(issues.children[0]?.props?.backgroundColor).toBeUndefined()
      const actions = (await ui.find({ key: 'tab-actions' })) as { children: Piece[] }
      expect(actions.children).toHaveLength(1)
      expect(actions.children[0]?.props?.dimColor).toBe(true)
      const texts = nodesOf(await ui.drawn()).filter((node) => node.type === 'Text')
      const symbol = texts.find((node) => node.children?.[0] === '✗')
      expect(symbol?.props?.color).toBe(claude.failure)
      expect(texts.find((node) => node.children?.[0] === '7')?.props?.color).toBeUndefined()
      for (const node of texts) {
        expect(node).not.toHaveProperty('hover')
        expect(node.props?.backgroundColor).toBeUndefined()
      }
      expect(await linesOf(ui)).toEqual(['1: PRs 4   2: Issues 7   3: Actions ✗'])
      for (const tab of ['prs', 'issues', 'actions']) expect(await ui.find({ key: `tabbox-${tab}` })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('locked: the same look as plain text, no Buttons', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const ui = await rig.show($, surface, viewOf({ isLocked: true, tab: 'issues' }), ignore, 80)
      expect(await linesOf(ui)).toEqual(['1: PRs 4   2: Issues 7   3: Actions ✗'])
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      const active = nodesOf(await ui.drawn()).find((candidate) => candidate.children?.[0] === 'Issues')
      expect(active?.props?.bold).toBe(true)
      await ui.unmount()
    }
  })

  test('narrow: the counts go first, then the names are cut', async ($, on) => {
    const rig = rigFor(on)
    const wide = viewOf({ prCount: 120, issueCount: 45 })
    const ui = await rig.show($, 'terminal', wide, { onShow: () => {}, columns: 31 }, 31)
    expect((await linesOf(ui))[0]).toBe('1: PRs   2: Issues   3: Actions')
    for (const columns of [24, 40, 80]) {
      const narrow = await rig.show($, 'terminal', wide, { onShow: () => {}, columns }, columns)
      for (const line of await linesOf(narrow)) expect(cellWidth(line)).toBeLessThanOrEqual(columns)
      await narrow.unmount()
    }
  })
})
