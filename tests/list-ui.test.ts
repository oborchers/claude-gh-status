import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ListItem, PrList } from '../src/model'
import { relativeTime } from '../src/status'
import { PALETTES, mutedLabelColor } from '../src/ui/colors'
import type { ListHandlers, ListView } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { renderList } from '../src/ui/list'
import { makeLocation } from './fixtures/pr-builder'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
type Mounted = Pick<MountedOf<Surface, 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'unmount'>

function item(number: number, extra: Partial<ListItem> = {}): ListItem {
  return {
    id: `PR_${number}`,
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    isDraft: false,
    author: 'anna',
    createdAt: `2026-10-${String(1 + (number % 9)).padStart(2, '0')}T10:00:00Z`,
    labels: [],
    reviewDecision: null,
    requestedFromViewer: false,
    hasOtherRequests: false,
    checks: null,
    comments: 0,
    ...extra,
  }
}

const account = { login: 'me', source: 'active' } as const

function listOf(items: ListItem[], extra: { total?: number; isTruncated?: boolean } = {}): PrList {
  return { kind: 'list', at: '2026-10-12T11:59:00Z', location: makeLocation(), account, items, total: extra.total ?? items.length, isTruncated: extra.isTruncated ?? false }
}

/** 4 yours (one draft), 2 requested, 2 waiting, then `others` more: 8 + others open. */
function crowd(others = 22): ListItem[] {
  const items: ListItem[] = []
  for (let n = 1; n <= 4; n += 1) items.push(item(n, { author: 'me', isDraft: n === 4 }))
  for (let n = 5; n <= 6; n += 1) items.push(item(n, { requestedFromViewer: true }))
  for (let n = 7; n <= 8; n += 1) items.push(item(n, { hasOtherRequests: true }))
  for (let n = 0; n < others; n += 1) items.push(item(100 + n, { isDraft: n % 7 === 0 }))
  return items
}

function viewOf(list: PrList | null, columns: number, extra: Partial<ListView> = {}): ListView {
  return { list, page: 0, hideDrafts: false, counts: null, nowMs: NOW, columns, palette: PALETTES.claude, ...extra }
}

function handlersFor(calls: string[]): ListHandlers {
  return {
    selectPr: (number) => void calls.push(`select ${number}`),
    nextPage: () => void calls.push('next'),
    prevPage: () => void calls.push('prev'),
    toggleDrafts: () => void calls.push('drafts'),
    refresh: () => void calls.push('refresh'),
    closePane: () => void calls.push('close'),
    openUrl: (url) => void calls.push(`openUrl ${url}`),
  }
}

type Current = { view: ListView; handlers: ListHandlers }

function createRig(on: On) {
  let current: Current | null = null
  let serial = 0
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (current === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return renderList($.ui.resolve(e), current.view, current.handlers)
  })
  return {
    list($: Engine, surface: Surface, view: ListView, handlers: ListHandlers): Promise<Mounted> {
      current = { view: { ...view, surface }, handlers }
      const props = { title: 'Pull requests', isFocused: true, bodyColumns: view.columns, placement: 'inline' }
      return $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: `list-${(serial += 1)}`, props: props as never })
    },
  }
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function rowsOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  const element = node as Node
  const props = element.props ?? {}
  const children = element.children ?? []
  if (element.type === 'Button' || element.type === 'Link') {
    const text = children.length > 0 ? children.flatMap(rowsOf).join('') : String(props.label ?? '')
    return (props.hotkey !== undefined && props.plain === true ? `${String(props.hotkey)}: ${text}` : text).split('\n')
  }
  const parts = children.map((child) => {
    const margin = Number((child as Node).props?.marginLeft ?? 0)
    return rowsOf(child).map((line) => ' '.repeat(margin) + line)
  })
  if (props.flexDirection === 'column') return parts.flat()
  const gap = Number(props.columnGap ?? props.gap ?? 0)
  return [parts.map((lines) => lines.join('\n')).join(' '.repeat(gap))]
}

/** The drawn lines, without the padding a focused row is filled to the width with. */
const linesOf = async (ui: Mounted): Promise<string[]> => rowsOf(await ui.drawn()).map((line) => line.trimEnd())
const textOf = async (ui: Mounted): Promise<string> => (await linesOf(ui)).join('\n')

function nodesOf(node: unknown): Node[] {
  if (typeof node === 'string' || node === null || node === undefined) return []
  const element = node as Node
  return [element, ...(element.children ?? []).flatMap(nodesOf)]
}

const hotkeysOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Button' })).flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))

describe('mutedLabelColor', () => {
  test('mixes the GitHub color 35% toward the neutral #9aa0b0', () => {
    expect(mutedLabelColor('d73a4a')).toBe('#c25e6e')
    expect(mutedLabelColor('000000')).toBe('#36383e')
    expect(mutedLabelColor('ffffff')).toBe('#dcdee3')
    expect(mutedLabelColor('9aa0b0')).toBe('#9aa0b0')
    expect(mutedLabelColor('0E8A16')).toBe(mutedLabelColor('0e8a16'))
  })

  test('falls back to the neutral for a color that is not six hex digits', () => {
    expect(mutedLabelColor('')).toBe('#9aa0b0')
    expect(mutedLabelColor('nope')).toBe('#9aa0b0')
    expect(mutedLabelColor('12345')).toBe('#9aa0b0')
  })
})

describe('renderList states', () => {
  test('loading and missing list read as one line with a refresh button', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      for (const list of [null, { kind: 'loading', at: '2026-10-12T11:59:00Z' } as PrList]) {
        const ui = await rig.list($, surface, viewOf(list, 80), handlersFor([]))
        const lines = await linesOf(ui)
        expect(lines[0]).toBe('Loading pull requests…')
        expect(lines).toHaveLength(2)
        expect(await hotkeysOf(ui)).toEqual(['r', 'x'])
        await ui.unmount()
      }
    }
  })

  test('an error names the problem and the retry, or the message', async ($, on) => {
    const rig = createRig(on)
    const problem = { reason: '504', since: '2026-10-12T11:59:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 15_000 }
    const withProblem = await rig.list($, 'terminal', viewOf({ kind: 'error', at: '', message: 'gh: HTTP 504', problem }, 80), handlersFor([]))
    expect((await linesOf(withProblem))[0]).toBe('GitHub unavailable (504), retrying in 5 s')
    const bare = await rig.list($, 'terminal', viewOf({ kind: 'error', at: '', message: 'boom' }, 80), handlersFor([]))
    expect((await linesOf(bare))[0]).toBe('gh-status: boom')
  })

  test('an empty list says so', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf([]), 80), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('0 open · @me')
    expect(lines[1]).toBe('No open pull requests.')
  })

  test('stale data keeps the list and adds the hint line', async ($, on) => {
    const rig = createRig(on)
    const problem = { reason: '504', since: '2026-10-12T11:58:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 15_000 }
    const list: PrList = { ...(listOf([item(1)]) as Extract<PrList, { kind: 'list' }>), problem }
    const ui = await rig.list($, 'terminal', viewOf(list, 100), handlersFor([]))
    expect((await linesOf(ui))[1]).toBe('showing last data from 1 min ago, GitHub unavailable (504), retrying in 5 s')
  })
})

describe('renderList header, groups and pages', () => {
  test('draws the summary line and the group headings in order, on every surface', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.list($, surface, viewOf(listOf(crowd()), 100), handlersFor([]))
      const lines = await linesOf(ui)
      expect(lines[0]).toBe('30 open · 1 to 10 · page 1 of 3 · @me')
      const headings = lines.filter((line) => line.startsWith('── '))
      expect(headings.map((line) => line.replace(/^── | ─+/g, ''))).toEqual(['Yours', 'Review requested from you', 'Waiting for review', 'Other open'])
      for (const line of headings) expect(cellWidth(line)).toBe(100)
      const order: (string | number)[] = lines.flatMap((line): (string | number)[] => (line.startsWith('── ') ? [line.slice(3, 8)] : /#(\d+)/.test(line) ? [Number(/#(\d+)/.exec(line)?.[1])] : []))
      expect(order.indexOf('Yours')).toBeLessThan(order.indexOf('Revie'))
      expect(order.indexOf('Revie')).toBeLessThan(order.indexOf('Waiti'))
      expect(order.indexOf('Waiti')).toBeLessThan(order.indexOf('Other'))
      const yours = order.slice(order.indexOf('Yours') + 1, order.indexOf('Revie'))
      expect([...yours].sort()).toEqual([1, 2, 3, 4])
      await ui.unmount()
    }
  })

  test('a group that is empty has no heading', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf([item(1), item(2)]), 100), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => line.startsWith('── ')).map((line) => line.slice(3, 13))).toEqual(['Other open'])
  })

  test('page 1 has next, the middle page both, the last previous, and the text follows', async ($, on) => {
    const rig = createRig(on)
    const first = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100), handlersFor([]))
    expect(await hotkeysOf(first)).toEqual(['n', 'h', 'r', 'x'])
    expect(await textOf(first)).toContain('n: next')
    expect(await textOf(first)).not.toContain('p: previous')
    const middle = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { page: 1 }), handlersFor([]))
    expect((await linesOf(middle))[0]).toBe('30 open · 11 to 20 · page 2 of 3 · @me')
    expect(await hotkeysOf(middle)).toEqual(['n', 'p', 'h', 'r', 'x'])
    const last = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { page: 2 }), handlersFor([]))
    const lines = await linesOf(last)
    expect(lines[0]).toBe('30 open · 21 to 30 · page 3 of 3 · @me')
    expect(await hotkeysOf(last)).toEqual(['p', 'h', 'r', 'x'])
    expect(await textOf(last)).toContain('p: previous')
    expect(await textOf(last)).not.toContain('n: next')
  })

  test('a page holds 10 pull requests, two lines each', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => /^ {4}#\d+ ·/.test(line))).toHaveLength(10)
    expect(lines.filter((line) => line.includes('Change') && !line.includes('#'))).toHaveLength(10)
  })

  test('a single page has neither', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd(2)), 100), handlersFor([]))
    expect(await hotkeysOf(ui)).toEqual(['h', 'r', 'x'])
  })

  test('a page past the end is clamped', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { page: 9 }), handlersFor([]))
    expect((await linesOf(ui))[0]).toBe('30 open · 21 to 30 · page 3 of 3 · @me')
  })

  test('hidden drafts leave the rows and say so', async ($, on) => {
    const rig = createRig(on)
    const all = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100), handlersFor([]))
    expect(await textOf(all)).toContain('draft Change 4')
    expect(await textOf(all)).toContain('h: hide drafts')
    const hidden = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { hideDrafts: true }), handlersFor([]))
    const text = await textOf(hidden)
    expect(text).not.toContain('draft Change')
    expect(text).not.toContain('#4 ')
    expect(text).toContain('drafts hidden')
    expect(text).toContain('h: show drafts')
    expect(text).toMatch(/^30 open · 1 to 10 · page 1 of 3 · drafts hidden/)
  })

  test('says when the repository is larger than the list', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd(), { total: 240, isTruncated: true }), 140), handlersFor([]))
    expect((await linesOf(ui))[0]).toBe('240 open · 1 to 10 · page 1 of 3 · showing the first 30 · @me')
  })

  test('the header drops the account first when narrow', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 30, { hideDrafts: true }), handlersFor([]))
    const first = (await linesOf(ui))[0] ?? ''
    expect(first).not.toContain('@me')
    expect(first.startsWith('30 open')).toBe(true)
    expect(cellWidth(first)).toBeLessThanOrEqual(30)
  })
})

describe('renderList rows', () => {
  const bug = { name: 'bug', color: 'd73a4a' }
  const payments = { name: 'payments', color: '0e8a16' }
  const failing = (): ListItem =>
    item(15, {
      author: 'oborchers',
      title: 'fix: rounding in invoice totals',
      labels: [bug, payments],
      checks: { passed: 17, failed: 1, pending: 0, total: 18 },
      reviewDecision: 'review-required',
      comments: 2,
      createdAt: '2026-10-12T10:00:00Z',
    })
  const rich = (): ListItem[] => [
    failing(),
    item(14, { author: 'oborchers', title: 'feat: add order history page', labels: [{ name: 'frontend', color: '1d76db' }], checks: { passed: 7, failed: 0, pending: 11, queued: 3, total: 18 }, createdAt: '2026-10-12T10:00:00Z' }),
    item(1, { author: 'oborchers', title: 'feat: add checkout flow', checks: { passed: 18, failed: 0, pending: 0, total: 18 }, reviewDecision: 'approved', createdAt: '2026-10-12T07:00:00Z' }),
  ]
  const titleLineOf = (lines: string[], title: string): number => lines.findIndex((line) => line.includes(title))

  test('a pull request is a title line and a facts line, with the symbol, labels and facts of the owner layout', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.list($, surface, viewOf(listOf([failing()]), 100), handlersFor([]))
      const lines = await linesOf(ui)
      const at = titleLineOf(lines, 'fix: rounding')
      expect(lines[at]).toBe('  ✗ fix: rounding in invoice totals  bug  payments')
      expect(lines[at + 1]).toBe('    #15 · @oborchers · opened 2 h ago · 1/18 checks failing · review required · 💬 2')
      await ui.unmount()
    }
  })

  test('the three pull requests of the owner layout read as in the mock', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(rich()), 100), handlersFor([]))
    const lines = await linesOf(ui)
    const at = titleLineOf(lines, 'fix: rounding')
    expect(lines.slice(at, at + 8)).toEqual([
      '  ✗ fix: rounding in invoice totals  bug  payments',
      '    #15 · @oborchers · opened 2 h ago · 1/18 checks failing · review required · 💬 2',
      '',
      '  ● feat: add order history page  frontend',
      '    #14 · @oborchers · opened 2 h ago · 11/18 checks running',
      '',
      '  ✓ feat: add checkout flow',
      '    #1 · @oborchers · opened 5 h ago · 18/18 passing · approved',
    ])
  })

  test('one blank line between pull requests and before each heading but the first, none after the last of a group', async ($, on) => {
    const rig = createRig(on)
    const items = [item(1, { author: 'me', createdAt: '2026-10-03T10:00:00Z' }), item(2, { createdAt: '2026-10-02T10:00:00Z' }), item(3, { createdAt: '2026-10-01T10:00:00Z' })]
    const ui = await rig.list($, 'terminal', viewOf(listOf(items), 100), handlersFor([]))
    const lines = await linesOf(ui)
    const kind = (line: string): string => (line.trim() === '' ? 'blank' : line.startsWith('── ') ? 'heading' : /^ {4}#/.test(line) ? 'meta' : /^ {2,4}\S/.test(line) ? 'title' : 'other')
    const kinds = lines.map(kind)
    const start = kinds.indexOf('heading')
    expect(kinds.slice(start, start + 10)).toEqual(['heading', 'title', 'meta', 'blank', 'heading', 'title', 'meta', 'blank', 'title', 'meta'])
    expect(kinds[start - 1]).toBe('other')
  })

  test('the status symbol follows the checks and is the only strongly colored mark of the title line', async ($, on) => {
    const rig = createRig(on)
    const states: [string, ListItem['checks'], 'success' | 'failure' | 'pending' | undefined][] = [
      ['✓', { passed: 4, failed: 0, pending: 0, total: 4 }, 'success'],
      ['✗', { passed: 2, failed: 1, pending: 1, total: 4 }, 'failure'],
      ['●', { passed: 2, failed: 0, pending: 2, queued: 1, total: 4 }, 'pending'],
      ['◷', { passed: 2, failed: 0, pending: 2, queued: 2, total: 4 }, 'pending'],
      [' ', null, undefined],
      [' ', { passed: 0, failed: 0, pending: 0, total: 0 }, undefined],
    ]
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      for (const [symbol, checks, color] of states) {
        const ui = await rig.list($, 'terminal', viewOf(listOf([item(3, { title: 'Same title', checks })]), 100, { palette }), handlersFor([]))
        const lines = await linesOf(ui)
        expect(lines.find((line) => line.includes('Same title'))).toBe(`  ${symbol} Same title`)
        const node = nodesOf(await ui.drawn()).find((candidate) => candidate.children?.length === 1 && candidate.children[0] === symbol && symbol !== ' ')
        if (color !== undefined) expect(node?.props?.color).toBe(palette[color])
        await ui.unmount()
      }
    }
  })

  test('the facts line: checks text per state, review text, comments only when there are some, no author when unknown', async ($, on) => {
    const rig = createRig(on)
    const metaOf = async (extra: Partial<ListItem>): Promise<string> => {
      const ui = await rig.list($, 'terminal', viewOf(listOf([item(9, { author: 'anna', createdAt: '2026-10-12T11:59:30Z', ...extra })]), 120), handlersFor([]))
      const lines = await linesOf(ui)
      await ui.unmount()
      return lines.find((line) => line.startsWith('    #9')) ?? ''
    }
    expect(await metaOf({})).toBe('    #9 · @anna · opened just now')
    expect(await metaOf({ checks: { passed: 4, failed: 0, pending: 0, total: 4 } })).toBe('    #9 · @anna · opened just now · 4/4 passing')
    expect(await metaOf({ checks: { passed: 4, failed: 2, pending: 1, total: 8 } })).toBe('    #9 · @anna · opened just now · 2/7 checks failing, 1 skipped')
    expect(await metaOf({ checks: { passed: 16, failed: 0, pending: 0, total: 18 } })).toBe('    #9 · @anna · opened just now · 16/16 passing, 2 skipped')
    expect(await metaOf({ checks: { passed: 0, failed: 0, pending: 0, total: 3 } })).toBe('    #9 · @anna · opened just now · 3 skipped')
    expect(await metaOf({ checks: { passed: 1, failed: 0, pending: 3, queued: 1, total: 4 } })).toBe('    #9 · @anna · opened just now · 3/4 checks running')
    expect(await metaOf({ checks: { passed: 1, failed: 0, pending: 3, queued: 3, total: 4 } })).toBe('    #9 · @anna · opened just now · 3/4 checks queued')
    expect(await metaOf({ reviewDecision: 'approved' })).toBe('    #9 · @anna · opened just now · approved')
    expect(await metaOf({ reviewDecision: 'changes-requested' })).toBe('    #9 · @anna · opened just now · changes requested')
    expect(await metaOf({ reviewDecision: 'review-required', comments: 1 })).toBe('    #9 · @anna · opened just now · review required · 💬 1')
    expect(await metaOf({ author: null })).toBe('    #9 · opened just now')
  })

  test('the facts line is dim; only failing checks and approved are colored', async ($, on) => {
    const rig = createRig(on)
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      const failingItem = item(9, { checks: { passed: 1, failed: 1, pending: 0, total: 2 }, reviewDecision: 'approved', comments: 3 })
      const ui = await rig.list($, 'terminal', viewOf(listOf([failingItem]), 120, { palette }), handlersFor([]))
      // The facts line: every Text after the four-space indent, outside the Button.
      const all = nodesOf(await ui.drawn()).filter((node) => node.type === 'Text' && typeof node.children?.[0] === 'string')
      const start = all.findIndex((node) => node.children?.[0] === '    ')
      const texts = all.slice(start + 1).filter((node) => String(node.children?.[0]).trim() !== '')
      expect(start).toBeGreaterThan(0)
      expect(texts.length).toBeGreaterThan(5)
      for (const node of texts) {
        const text = String(node.children?.[0])
        if (text === '1/2 checks failing') expect(node.props).toMatchObject({ color: palette.failure })
        else if (text === 'approved') expect(node.props).toMatchObject({ color: palette.success })
        else {
          expect(node.props?.dimColor).toBe(true)
          expect(node.props?.color).toBeUndefined()
        }
      }
      await ui.unmount()
    }
  })

  test('the title is bold; a draft has a dim prefix and a dim, not bold, title', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf([item(7, { isDraft: true, title: 'wip' }), item(8, { title: 'ready' })]), 100), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.find((line) => line.includes('wip'))).toBe('    draft wip')
    expect(lines.find((line) => line.includes('ready'))).toBe('    ready')
    const text = (button: unknown, content: string) => nodesOf(button).find((node) => node.type === 'Text' && node.children?.[0] === content)
    const draftTitle = await ui.find({ key: 'pr-7' })
    expect(text(draftTitle, 'draft wip')?.props).toMatchObject({ dimColor: true })
    expect(text(draftTitle, 'draft wip')?.props?.bold).toBeUndefined()
    expect(text(draftTitle, 'draft wip')?.props?.color).toBeUndefined()
    const ready = await ui.find({ key: 'pr-8' })
    expect(text(ready, 'ready')?.props).toMatchObject({ bold: true })
    expect(text(ready, 'ready')?.props?.dimColor).toBeUndefined()
  })

  test('labels are plain names, two spaces apart, in the GitHub color muted toward grey, the same in both palettes', async ($, on) => {
    const rig = createRig(on)
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      const ui = await rig.list($, 'terminal', viewOf(listOf([failing()]), 100, { palette }), handlersFor([]))
      const nodes = nodesOf(await ui.drawn())
      const byName = (name: string) => nodes.find((node) => node.type === 'Text' && node.children?.[0] === name)
      expect(byName('bug')?.props?.color).toBe(mutedLabelColor('d73a4a'))
      expect(byName('payments')?.props?.color).toBe(mutedLabelColor('0e8a16'))
      expect(byName('bug')?.props?.color).toBe('#c25e6e')
      expect(nodes.some((node) => node.props?.backgroundColor !== undefined)).toBe(false)
      expect((await linesOf(ui)).find((line) => line.includes('bug'))).toMatch(/totals {2}bug {2}payments$/)
      await ui.unmount()
    }
  })

  test('labels that do not fit are dropped from the end and counted as +N, after the title shrank to its floor', async ($, on) => {
    const rig = createRig(on)
    const many = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'].map((name) => ({ name, color: '1d76db' }))
    const at = async (title: string, labels: { name: string; color: string }[], columns: number): Promise<string> => {
      const ui = await rig.list($, 'terminal', viewOf(listOf([item(2, { title, labels })]), columns), handlersFor([]))
      const lines = await linesOf(ui)
      for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(columns)
      await ui.unmount()
      return lines.find((line) => line.startsWith('  ') && !line.startsWith('    #') && line.trim() !== '' && !line.startsWith('──')) ?? ''
    }
    expect(await at('Add feature', many, 80)).toBe('    Add feature  aaaaaaaa  bbbbbbbb  cccccccc  dddddddd')
    expect(await at('Add feature', many, 40)).toBe('    Add feature  aaaaaaaa  bbbbbbbb  +2')
    expect(await at('Add feature', many, 33)).toBe('    Add feature  aaaaaaaa  +3')
    // The title is cut first (down to 24 cells) before a label goes.
    const long = 'A title that keeps going and going and going'
    const cut = await at(long, [bug], 40)
    expect(cut).toBe('    A title that keeps going and g…  bug')
    // Nothing of the labels fits beside a 24-cell title: only the count.
    const onlyCount = await at(long, [{ name: 'x'.repeat(30), color: 'ffffff' }, bug], 40)
    expect(onlyCount).toMatch(/^ {4}A title that keeps going.*…  \+2$/)
    // Not even the count fits: the title takes the room.
    expect(cellWidth(await at(long, many, 30))).toBeLessThanOrEqual(30)
  })

  test('every title line is indented two cells and carries no marker, so symbol and title line up', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(rich()), 100), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => line.includes('▸'))).toEqual([])
    const feat = lines.find((line) => line.includes('feat: add order history page')) ?? ''
    const failingLine = lines.find((line) => line.includes('fix: rounding')) ?? ''
    expect(failingLine.indexOf('✗')).toBe(feat.indexOf('●'))
    expect(failingLine.indexOf('fix:')).toBe(feat.indexOf('feat:'))
    expect(feat.startsWith('  ● feat')).toBe(true)
    const metas = lines.filter((line) => /^ {4}#\d+/.test(line))
    expect(metas).toHaveLength(3)
    expect(await textOf(ui)).not.toContain('back to')
  })

  describe('the row styling', () => {
    const textsIn = (node: unknown): Node[] => nodesOf(node).filter((entry) => entry.type === 'Text' && typeof entry.children?.[0] === 'string')
    const colored = [item(15, { title: 'fix', checks: { passed: 0, failed: 1, pending: 0, total: 1 }, labels: [{ name: 'bug', color: 'd73a4a' }] })]

    test('only the title is the Button, one monochrome Text; symbol, labels and facts stay outside with their colors', async ($, on) => {
      const rig = createRig(on)
      for (const palette of [PALETTES.claude, PALETTES.github]) {
        const ui = await rig.list($, 'terminal', viewOf(listOf(colored), 100, { palette }), handlersFor([]))
        const button = (await ui.find({ key: 'pr-15' })) as { props: Record<string, unknown>; children: Node[] }
        expect(button.children).toHaveLength(1)
        expect(button.children[0]?.children).toEqual(['fix'])
        expect(button.children[0]?.props?.color).toBeUndefined()
        expect(button.children[0]?.props?.backgroundColor).toBeUndefined()
        expect(button.children[0]?.props?.bold).toBe(true)
        expect(button.children[0]).not.toHaveProperty('hover')
        const outside = textsIn(await ui.drawn()).filter((entry) => !(button.children as Node[]).includes(entry))
        const named = (content: string) => outside.find((entry) => entry.children?.[0] === content)
        expect(named('✗')?.props?.color).toBe(palette.failure)
        expect(named('bug')?.props?.color).toBe(mutedLabelColor('d73a4a'))
        for (const entry of outside) expect(entry.props?.backgroundColor).toBeUndefined()
        expect(outside.some((entry) => entry.children?.[0] === '▸ ')).toBe(false)
        await ui.unmount()
      }
    })

    test('the facts line is plain Text outside the Button, no inverse pieces, no padding to the width', async ($, on) => {
      const rig = createRig(on)
      const ui = await rig.list($, 'terminal', viewOf(listOf(colored), 100), handlersFor([]))
      const button = (await ui.find({ key: 'pr-15' })) as { children: Node[] }
      const facts = textsIn(await ui.drawn()).filter((entry) => !(button.children as Node[]).includes(entry) && String(entry.children?.[0]).includes('#15'))
      expect(facts).toHaveLength(1)
      expect(facts[0]?.props?.dimColor).toBe(true)
      const failing = textsIn(await ui.drawn()).find((entry) => String(entry.children?.[0]).includes('failing'))
      expect(failing?.props?.color).toBe(PALETTES.claude.failure)
      const lines = await linesOf(ui)
      expect(lines.some((line) => line.startsWith('    #15'))).toBe(true)
      for (const line of lines.filter((line) => line.startsWith('    #'))) expect(cellWidth(line)).toBeLessThan(100)
      await ui.unmount()
    })

    test('the row has no keyed Box and no hover pieces; the focused look is the engine inverse on the title', async ($, on) => {
      const rig = createRig(on)
      const ui = await rig.list($, 'terminal', viewOf(listOf(colored), 100), handlersFor([]))
      expect((await ui.findAll({ type: 'Box' })).filter((box) => String(box.key).startsWith('row-'))).toEqual([])
      for (const entry of textsIn(await ui.drawn())) expect(entry).not.toHaveProperty('hover')
      expect(await ui.findAll({ type: 'Button' })).toContainEqual(expect.objectContaining({ key: 'pr-15' }))
      await ui.unmount()
    })
  })

  test('long titles are cut with an ellipsis', async ($, on) => {
    const rig = createRig(on)
    const title = 'A very long pull request title that never ends and keeps going on and on'
    const ui = await rig.list($, 'terminal', viewOf(listOf([item(1, { title })]), 40), handlersFor([]))
    const row = (await linesOf(ui)).find((line) => line.includes('A very long')) ?? ''
    expect(row).toContain('…')
    expect(cellWidth(row)).toBeLessThanOrEqual(40)
  })
})

describe('renderList fits the width', () => {
  const heavy = (): ListItem[] => {
    const labels = Array.from({ length: 8 }, (_, index) => ({ name: `label-number-${index}`, color: ['d73a4a', 'a2eeef', '0e8a16', 'fbca04'][index % 4] ?? 'ffffff' }))
    return Array.from({ length: 6 }, (_, index) =>
      item(5000 + index, {
        title: 'An extremely long title: '.repeat(6),
        author: 'a-rather-long-author-login',
        labels,
        checks: { passed: 122, failed: index % 2, pending: 0, total: 123 },
        reviewDecision: 'changes-requested',
        comments: 1234,
        isDraft: index === 0,
        createdAt: '2025-01-01T10:00:00Z',
      }),
    )
  }

  test('no line is wider than the columns at 20, 40, 80, 120 and 160', async ($, on) => {
    const rig = createRig(on)
    for (const columns of [20, 40, 80, 120, 160]) {
      for (const surface of SURFACES) {
        const ui = await rig.list($, surface, viewOf(listOf([...heavy(), ...crowd()]), columns), handlersFor([]))
        for (const line of await linesOf(ui)) expect(cellWidth(line)).toBeLessThanOrEqual(columns)
        await ui.unmount()
      }
    }
  })

  test('the facts line is cut at its end, the start stays', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(heavy()), 50), handlersFor([]))
    const meta = (await linesOf(ui)).find((line) => line.includes('#5001')) ?? ''
    expect(meta.startsWith('    #5001 · @a-rather-long-author-login')).toBe(true)
    expect(meta.endsWith('…')).toBe(true)
    expect(cellWidth(meta)).toBeLessThanOrEqual(50)
    const wide = await rig.list($, 'terminal', viewOf(listOf(heavy()), 160), handlersFor([]))
    expect((await linesOf(wide)).find((line) => line.includes('#5001')) ?? '').toBe(`    #5001 · @a-rather-long-author-login · opened ${relativeTime('2025-01-01T10:00:00Z', NOW)} · 1/123 checks failing · changes requested · 💬 1234`)
  })

  test('keeps the title long enough to read at 80 columns, labels cut to +N', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(heavy()), 80), handlersFor([]))
    const row = (await linesOf(ui)).find((line) => line.includes('An extremely long') && !line.includes('draft')) ?? ''
    expect(row).toContain('An extremely long title')
    expect(row).toMatch(/\+\d$/)
  })

  test('footer buttons wrap into several lines instead of overflowing', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 40, { page: 1 }), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => /^[nphrx]: /.test(line)).length).toBeGreaterThan(1)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(40)
  })
})

describe('renderList presses', () => {
  test('rows and buttons call the handlers', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await rig.list($, surface, viewOf(listOf(crowd()), 120, { page: 0 }), handlersFor(calls))
      await ui.press({ key: 'pr-5' })
      await ui.press({ key: 'list-next' })
      await ui.press({ key: 'list-drafts' })
      await ui.press({ key: 'list-refresh' })
      await ui.press({ key: 'list-close' })
      expect(calls).toEqual(['select 5', 'next', 'drafts', 'refresh', 'close'])
      expect(await ui.find({ key: 'list-prev' })).toBeUndefined()
      await ui.unmount()

      const second = await rig.list($, surface, viewOf(listOf(crowd()), 120, { page: 1 }), handlersFor(calls))
      await second.press({ key: 'list-prev' })
      expect(calls.at(-1)).toBe('prev')
      await second.unmount()
    }
  })

  test('pressing a pull request selects it, whichever line it is clicked on', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await rig.list($, surface, viewOf(listOf(crowd()), 120), handlersFor(calls))
      await ui.press({ key: 'pr-5' })
      await ui.press({ key: 'pr-6' })
      expect(calls).toEqual(['select 5', 'select 6'])
      await ui.unmount()
    }
  })

  test('every pull request is one plain button keyed pr-N, so the focus ring stops once per pull request', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 120), handlersFor([]))
    const buttons = await ui.findAll({ type: 'Button' })
    const keys = buttons.map((button) => String(button.key)).filter((key) => key.startsWith('pr-'))
    expect(keys.filter((key) => /^pr-\d+$/.test(key))).toHaveLength(10)
    expect(keys.filter((key) => /-meta$/.test(key))).toHaveLength(0)
    expect(new Set(keys).size).toBe(10)
    for (const button of buttons.filter((candidate) => String(candidate.key).startsWith('pr-'))) expect(button.props.plain).toBe(true)
  })
})

describe('renderList page size', () => {
  test('a smaller pageSize draws fewer items and says so in the header', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', { ...viewOf(listOf(crowd()), 100), pageSize: 3 }, handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('30 open · 1 to 3 · page 1 of 10 · @me')
    expect((await ui.findAll({ type: 'Button' })).filter((button) => /^pr-\d+$/.test(String(button.key)))).toHaveLength(3)
    await ui.unmount()
    const second = await rig.list($, 'terminal', { ...viewOf(listOf(crowd()), 100), pageSize: 3, page: 1 }, handlersFor([]))
    expect((await linesOf(second))[0]).toBe('30 open · 4 to 6 · page 2 of 10 · @me')
    await second.unmount()
  })
})
