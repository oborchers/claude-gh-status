import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ListItem, PrList } from '../src/model'
import { PALETTES } from '../src/ui/colors'
import type { ListHandlers, ListView } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { labelTextColor, renderList } from '../src/ui/list'
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
  return { list, page: 0, hideDrafts: false, selectedNumber: null, counts: null, nowMs: NOW, columns, palette: PALETTES.claude, ...extra }
}

function handlersFor(calls: string[]): ListHandlers {
  return {
    selectPr: (number) => void calls.push(`select ${number}`),
    nextPage: () => void calls.push('next'),
    prevPage: () => void calls.push('prev'),
    toggleDrafts: () => void calls.push('drafts'),
    refresh: () => void calls.push('refresh'),
    back: () => void calls.push('back'),
    closeList: () => void calls.push('close'),
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
    return [props.hotkey !== undefined && children.length === 0 ? `${String(props.hotkey)}: ${text}` : text]
  }
  const parts = children.map((child) => {
    const margin = Number((child as Node).props?.marginLeft ?? 0)
    return rowsOf(child).map((line) => ' '.repeat(margin) + line)
  })
  if (props.flexDirection === 'column') return parts.flat()
  const gap = Number(props.columnGap ?? props.gap ?? 0)
  return [parts.map((lines) => lines.join('\n')).join(' '.repeat(gap))]
}

const linesOf = async (ui: Mounted): Promise<string[]> => rowsOf(await ui.drawn())
const textOf = async (ui: Mounted): Promise<string> => (await linesOf(ui)).join('\n')

function nodesOf(node: unknown): Node[] {
  if (typeof node === 'string' || node === null || node === undefined) return []
  const element = node as Node
  return [element, ...(element.children ?? []).flatMap(nodesOf)]
}

const hotkeysOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Button' })).flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))

describe('labelTextColor', () => {
  test('picks black on light colors and white on dark ones', () => {
    expect(labelTextColor('ffffff')).toBe('#000000')
    expect(labelTextColor('fbca04')).toBe('#000000')
    expect(labelTextColor('a2eeef')).toBe('#000000')
    expect(labelTextColor('000000')).toBe('#ffffff')
    expect(labelTextColor('0e8a16')).toBe('#ffffff')
    expect(labelTextColor('d93f0b')).toBe('#ffffff')
    expect(labelTextColor('5319e7')).toBe('#ffffff')
  })

  test('falls back for a color that is not six hex digits', () => {
    expect(['#000000', '#ffffff']).toContain(labelTextColor(''))
    expect(['#000000', '#ffffff']).toContain(labelTextColor('nope'))
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
        expect(await hotkeysOf(ui)).toEqual(['r'])
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
      expect(lines[0]).toBe('30 open · 1 to 25 · page 1 of 2 · @me')
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

  test('page 1 has next, page 2 has previous, and the text follows', async ($, on) => {
    const rig = createRig(on)
    const first = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100), handlersFor([]))
    expect(await hotkeysOf(first)).toEqual(['n', 'h', 'r'])
    expect(await textOf(first)).toContain('n: next')
    expect(await textOf(first)).not.toContain('p: previous')
    const second = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { page: 1 }), handlersFor([]))
    const lines = await linesOf(second)
    expect(lines[0]).toBe('30 open · 26 to 30 · page 2 of 2 · @me')
    expect(await hotkeysOf(second)).toEqual(['p', 'h', 'r'])
    expect(await textOf(second)).toContain('p: previous')
    expect(await textOf(second)).not.toContain('n: next')
  })

  test('a single page has neither', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd(2)), 100), handlersFor([]))
    expect(await hotkeysOf(ui)).toEqual(['h', 'r'])
  })

  test('a page past the end is clamped', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { page: 9 }), handlersFor([]))
    expect((await linesOf(ui))[0]).toBe('30 open · 26 to 30 · page 2 of 2 · @me')
  })

  test('hidden drafts leave the rows and say so', async ($, on) => {
    const rig = createRig(on)
    const all = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100), handlersFor([]))
    expect(await textOf(all)).toContain('draft #4')
    expect(await textOf(all)).toContain('h: hide drafts')
    const hidden = await rig.list($, 'terminal', viewOf(listOf(crowd()), 100, { hideDrafts: true }), handlersFor([]))
    const text = await textOf(hidden)
    expect(text).not.toContain('draft #')
    expect(text).not.toContain('#4 ')
    expect(text).toContain('drafts hidden')
    expect(text).toContain('h: show drafts')
    expect(text).toMatch(/^30 open · 1 to 25 · page 1 of 1 · drafts hidden/)
  })

  test('says when the repository is larger than the list', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd(), { total: 240, isTruncated: true }), 140), handlersFor([]))
    expect((await linesOf(ui))[0]).toBe('240 open · 1 to 25 · page 1 of 2 · showing the first 30 · @me')
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
  const rich = (): ListItem[] => [
    item(1035, {
      author: 'anna',
      title: 'Fix the parser',
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'docs', color: 'a2eeef' },
      ],
      checks: { passed: 34, failed: 0, pending: 0, total: 35 },
      reviewDecision: 'approved',
      comments: 6,
      createdAt: '2026-10-09T12:00:00Z',
    }),
    item(1036, { author: 'ben', title: 'Failing build', checks: { passed: 30, failed: 1, pending: 0, total: 35 }, reviewDecision: 'changes-requested', createdAt: '2026-10-12T11:00:00Z' }),
    item(1037, { author: 'cy', title: 'Still running', checks: { passed: 30, failed: 0, pending: 3, total: 35 }, reviewDecision: 'review-required', createdAt: '2026-10-12T11:59:30Z' }),
    item(1038, { author: null, title: 'Ghost', checks: null, createdAt: '2026-10-01T11:59:30Z' }),
  ]

  test('a row has number, title, labels, author, age, checks, review and comments', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.list($, surface, viewOf(listOf(rich()), 120), handlersFor([]))
      const text = await textOf(ui)
      const row = text.split('\n').find((line) => line.includes('#1035')) ?? ''
      expect(row).toMatch(/#1035 +Fix the parser +bug +docs +@anna +3 d ago +✓ 34\/35 +approved +💬 6/)
      expect(text).toContain('✗ 1/35')
      expect(text).toContain('changes requested')
      expect(text).toContain('● 3/35')
      expect(text).toContain('review required')
      expect(text).toContain('just now')
      expect(text).toContain('1 h ago')
      const ghost = text.split('\n').find((line) => line.includes('#1038')) ?? ''
      expect(ghost).not.toContain('@')
      await ui.unmount()
    }
  })

  test('label chips carry the GitHub color and a readable text color', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(rich()), 120), handlersFor([]))
    const chips = nodesOf(await ui.drawn()).filter((node) => typeof node.props?.backgroundColor === 'string')
    const byName = (name: string) => chips.find((node) => node.children?.includes(` ${name} `))
    expect(byName('bug')?.props).toMatchObject({ backgroundColor: '#d73a4a', color: '#ffffff' })
    expect(byName('docs')?.props).toMatchObject({ backgroundColor: '#a2eeef', color: '#000000' })
  })

  test('check and review colors follow the palette', async ($, on) => {
    const rig = createRig(on)
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      const ui = await rig.list($, 'terminal', viewOf(listOf(rich()), 120, { palette }), handlersFor([]))
      const colorOf = async (text: string) => nodesOf(await ui.drawn()).find((node) => node.children?.includes(text))?.props?.color
      expect(await colorOf('✓ 34/35')).toBe(palette.success)
      expect(await colorOf('✗ 1/35')).toBe(palette.failure)
      expect(await colorOf('● 3/35')).toBe(palette.pending)
      expect(await colorOf('approved')).toBe(palette.success)
      expect(await colorOf('changes requested')).toBe(palette.failure)
      expect(await colorOf('review required')).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the selected pull request gets the marker, the others do not', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(rich()), 120, { selectedNumber: 1036 }), handlersFor([]))
    const lines = await linesOf(ui)
    const marked = lines.filter((line) => line.startsWith('▸'))
    expect(marked).toHaveLength(1)
    expect(marked[0]).toContain('#1036')
    expect(lines.filter((line) => line.includes('#103') && !line.startsWith('▸'))).toHaveLength(3)
    expect(await textOf(ui)).toContain('b: back to branch PR')
    const none = await rig.list($, 'terminal', viewOf(listOf(rich()), 120), handlersFor([]))
    expect(await textOf(none)).not.toContain('▸')
    expect(await textOf(none)).not.toContain('back to branch PR')
  })

  test('drafts carry a dim prefix and the whole row is dim', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf([item(7, { isDraft: true, title: 'wip' }), item(8, { title: 'ready' })]), 100), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.find((line) => line.includes('#7'))).toContain('draft #7')
    expect(lines.find((line) => line.includes('#8'))).not.toContain('draft')
    const button = await ui.find({ key: 'pr-7' })
    expect(button?.props.dimColor).toBe(true)
    const ready = await ui.find({ key: 'pr-8' })
    expect(ready?.props.dimColor).toBeUndefined()
  })

  test('long titles are cut with an ellipsis', async ($, on) => {
    const rig = createRig(on)
    const title = 'A very long pull request title that never ends and keeps going on and on'
    const ui = await rig.list($, 'terminal', viewOf(listOf([item(1, { title })]), 40), handlersFor([]))
    const row = (await linesOf(ui)).find((line) => line.includes('#1')) ?? ''
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
        checks: { passed: 100, failed: index % 2, pending: 0, total: 123 },
        reviewDecision: 'changes-requested',
        comments: 1234,
        isDraft: index === 0,
        createdAt: '2025-01-01T10:00:00Z',
      }),
    )
  }

  test('no line is wider than the columns at 40, 80, 120 and 160', async ($, on) => {
    const rig = createRig(on)
    for (const columns of [40, 80, 120, 160]) {
      for (const surface of SURFACES) {
        const ui = await rig.list($, surface, viewOf(listOf([...heavy(), ...crowd()]), columns, { selectedNumber: 5001 }), handlersFor([]))
        for (const line of await linesOf(ui)) expect(cellWidth(line)).toBeLessThanOrEqual(columns)
        await ui.unmount()
      }
    }
  })

  test('drops comments, review, age, author and labels in that order, then cuts the title', async ($, on) => {
    const rig = createRig(on)
    const order = ['💬', 'approved', 'd ago', '@anna', ' bug ']
    const one = item(5000, { title: 'Twenty-four chars title', author: 'anna', labels: [{ name: 'bug', color: 'd73a4a' }], checks: { passed: 3, failed: 0, pending: 0, total: 3 }, reviewDecision: 'approved', comments: 3, createdAt: '2025-01-01T10:00:00Z' })
    const seen: string[][] = []
    for (const columns of [200, 90, 82, 74, 68, 56, 50, 44, 38]) {
      const ui = await rig.list($, 'terminal', viewOf(listOf([one]), columns), handlersFor([]))
      const row = (await linesOf(ui)).find((line) => line.includes('#5000')) ?? ''
      expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      seen.push(order.filter((part) => row.includes(part)))
      await ui.unmount()
    }
    expect(seen[0]).toHaveLength(5)
    expect(seen.at(-1)).toHaveLength(0)
    // Narrower keeps a subset of what wider keeps.
    for (let index = 1; index < seen.length; index += 1) for (const part of seen[index] ?? []) expect(seen[index - 1]).toContain(part)
    // Labels outlast author, author outlasts age, age outlasts review, review outlasts comments.
    const lastWidth = (part: string) => seen.reduce((last, kept, index) => (kept.includes(part) ? index : last), -1)
    for (let index = 1; index < order.length; index += 1) {
      expect(lastWidth(order[index] as string)).toBeGreaterThanOrEqual(lastWidth(order[index - 1] as string))
    }
  })

  test('keeps the title long enough to read at 80 columns', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(heavy()), 80), handlersFor([]))
    const row = (await linesOf(ui)).find((line) => line.includes('#5001')) ?? ''
    expect(row).toContain('An extremely long')
  })

  test('footer buttons wrap into several lines instead of overflowing', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 40, { selectedNumber: 1, page: 1 }), handlersFor([]))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => /^[nphrb]: /.test(line)).length).toBeGreaterThan(1)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(40)
  })
})

describe('renderList presses', () => {
  test('rows and buttons call the handlers', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await rig.list($, surface, viewOf(listOf(crowd()), 120, { selectedNumber: 2, page: 0 }), handlersFor(calls))
      await ui.press({ key: 'pr-5' })
      await ui.press({ key: 'list-next' })
      await ui.press({ key: 'list-drafts' })
      await ui.press({ key: 'list-refresh' })
      await ui.press({ key: 'list-back' })
      expect(calls).toEqual(['select 5', 'next', 'drafts', 'refresh', 'back'])
      expect(await ui.find({ key: 'list-prev' })).toBeUndefined()
      await ui.unmount()

      const second = await rig.list($, surface, viewOf(listOf(crowd()), 120, { page: 1 }), handlersFor(calls))
      await second.press({ key: 'list-prev' })
      expect(calls.at(-1)).toBe('prev')
      await second.unmount()
    }
  })

  test('every row is its own plain button keyed by number', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.list($, 'terminal', viewOf(listOf(crowd()), 120), handlersFor([]))
    const keys = (await ui.findAll({ type: 'Button' })).map((button) => String(button.key)).filter((key) => key.startsWith('pr-'))
    expect(keys).toHaveLength(25)
    expect(new Set(keys).size).toBe(25)
  })
})
