import { describe, expect, test } from 'claude-code/testing'

import type { IssueItem, IssueList } from '../src/model'
import { relativeTime } from '../src/status'
import { PALETTES, mutedLabelColor } from '../src/ui/colors'
import type { IssuesView, RepoHandlers } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { renderIssues } from '../src/ui/issues'
import { SURFACES, createRig, hotkeysOf, linesOf, nodesOf, textOf, textsOf } from './fixtures/ui-rig'
import { makeLocation } from './fixtures/pr-builder'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const FOCUS_BG = '#30363d'
const FOCUS_FG = '#e6edf3'
const FOCUS_DIM = '#8b949e'

function issue(number: number, extra: Partial<IssueItem> = {}): IssueItem {
  return {
    id: `I_${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/app/issues/${number}`,
    author: 'anna',
    createdAt: `2026-10-${String(1 + (number % 9)).padStart(2, '0')}T10:00:00Z`,
    labels: [],
    assignees: [],
    comments: 0,
    linkedPrs: [],
    mentionsViewer: false,
    ...extra,
  }
}

const account = { login: 'me', source: 'active' } as const

function listOf(items: IssueItem[], extra: { total?: number; isTruncated?: boolean } = {}): IssueList {
  return { kind: 'list', at: '2026-10-12T11:59:00Z', location: makeLocation(), account, items, total: extra.total ?? items.length, isTruncated: extra.isTruncated ?? false }
}

/** 2 assigned, 2 opened, 2 mentioning, then `others` more. */
function crowd(others = 14): IssueItem[] {
  const items: IssueItem[] = []
  for (let n = 1; n <= 2; n += 1) items.push(issue(n, { assignees: ['me'] }))
  for (let n = 3; n <= 4; n += 1) items.push(issue(n, { author: 'me' }))
  for (let n = 5; n <= 6; n += 1) items.push(issue(n, { mentionsViewer: true }))
  for (let n = 0; n < others; n += 1) items.push(issue(100 + n))
  return items
}

function viewOf(issues: IssueList | null, extra: Partial<IssuesView> = {}): IssuesView {
  return { issues, page: 0, focusedKey: null, viewer: 'me', nowMs: NOW, columns: 100, palette: PALETTES.claude, ...extra }
}

function handlersFor(calls: string[]): RepoHandlers {
  return {
    showTab: (tab) => void calls.push(`tab ${tab}`),
    selectIssue: (number) => void calls.push(`select ${number}`),
    selectRun: (id) => void calls.push(`run ${id}`),
    openLinkedPr: (number) => void calls.push(`pr ${number}`),
    back: () => void calls.push('back'),
    nextPage: () => void calls.push('next'),
    prevPage: () => void calls.push('prev'),
    refresh: () => void calls.push('refresh'),
    closePane: () => void calls.push('close'),
    openUrl: (url) => void calls.push(`openUrl ${url}`),
    copyText: (text) => void calls.push(`copy ${text}`),
    rerunRun: (id) => void calls.push(`rerun ${id}`),
    ciToClaude: (id) => void calls.push(`claude ${id}`),
  }
}

const rigFor = (on: Parameters<typeof createRig>[0]) => createRig<IssuesView, RepoHandlers>(on, renderIssues)
const show = (rig: ReturnType<typeof rigFor>, $: Parameters<ReturnType<typeof rigFor>['show']>[0], surface: (typeof SURFACES)[number], view: IssuesView, calls: string[] = []) => rig.show($, surface, view, handlersFor(calls), view.columns)

describe('renderIssues states', () => {
  test('loading and missing list read as one line with refresh and close', async ($, on) => {
    const rig = rigFor(on)
    for (const issues of [null, { kind: 'loading', at: '' } as IssueList]) {
      const ui = await show(rig, $, 'terminal', viewOf(issues))
      const lines = await linesOf(ui)
      expect(lines[0]).toBe('Loading issues…')
      expect(lines).toHaveLength(2)
      expect(await hotkeysOf(ui)).toEqual(['r', 'x'])
      await ui.unmount()
    }
  })

  test('an error names the problem and the retry, or the message', async ($, on) => {
    const rig = rigFor(on)
    const problem = { reason: '504', since: '2026-10-12T11:59:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 15_000 }
    const withProblem = await show(rig, $, 'terminal', viewOf({ kind: 'error', at: '', message: 'gh: HTTP 504', problem }))
    expect((await linesOf(withProblem))[0]).toBe('GitHub unavailable (504), retrying in 5 s')
    const bare = await show(rig, $, 'terminal', viewOf({ kind: 'error', at: '', message: 'boom' }))
    expect((await linesOf(bare))[0]).toBe('gh-status: boom')
  })

  test('an empty list says so', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf([])))
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('0 open · @me')
    expect(lines[1]).toBe('No open issues.')
    expect(await hotkeysOf(ui)).toEqual(['r', 'x'])
  })

  test('stale data keeps the list and adds the hint line', async ($, on) => {
    const rig = rigFor(on)
    const problem = { reason: '504', since: '2026-10-12T11:58:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 15_000 }
    const list = { ...(listOf([issue(1)]) as Extract<IssueList, { kind: 'list' }>), problem }
    const ui = await show(rig, $, 'terminal', viewOf(list))
    expect((await linesOf(ui))[1]).toBe('showing last data from 1 min ago, GitHub unavailable (504), retrying in 5 s')
  })
})

describe('renderIssues header, groups and pages', () => {
  test('summary line and group headings in order, on every surface', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const ui = await show(rig, $, surface, viewOf(listOf(crowd())))
      const lines = await linesOf(ui)
      expect(lines[0]).toBe('20 open · 1 to 10 · page 1 of 2 · @me')
      const headings = lines.filter((line) => line.startsWith('── '))
      expect(headings.map((line) => line.replace(/^── | ─+/g, ''))).toEqual(['Assigned to you', 'Opened by you', 'Mentioning you', 'Other open'])
      for (const line of headings) expect(cellWidth(line)).toBe(100)
      await ui.unmount()
    }
  })

  test('a group that is empty has no heading', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf([issue(1), issue(2)])))
    expect((await linesOf(ui)).filter((line) => line.startsWith('── ')).map((line) => line.slice(3, 13))).toEqual(['Other open'])
  })

  test('page 1 has next, the last previous; the footer text follows', async ($, on) => {
    const rig = rigFor(on)
    const first = await show(rig, $, 'terminal', viewOf(listOf(crowd())))
    expect(await hotkeysOf(first)).toEqual(['n', 'r', 'x'])
    expect(await textOf(first)).toContain('n: next')
    expect(await textOf(first)).not.toContain('p: previous')
    const last = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { page: 1 }))
    expect((await linesOf(last))[0]).toBe('20 open · 11 to 20 · page 2 of 2 · @me')
    expect(await hotkeysOf(last)).toEqual(['p', 'r', 'x'])
    expect(await textOf(last)).toContain('p: previous')
    const only = await show(rig, $, 'terminal', viewOf(listOf(crowd(2))))
    expect(await hotkeysOf(only)).toEqual(['r', 'x'])
  })

  test('a page holds 10 issues, two lines each; a page past the end is clamped', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf(crowd())))
    expect((await linesOf(ui)).filter((line) => /^ {4}#\d+ ·/.test(line))).toHaveLength(10)
    const clamped = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { page: 9 }))
    expect((await linesOf(clamped))[0]).toBe('20 open · 11 to 20 · page 2 of 2 · @me')
  })

  test('says when the repository is larger than the list; the narrow header drops the account first', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf(crowd(), { total: 240, isTruncated: true }), { columns: 140 }))
    expect((await linesOf(ui))[0]).toBe('240 open · 1 to 10 · page 1 of 2 · showing the first 20 · @me')
    const narrow = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { columns: 25 }))
    const first = (await linesOf(narrow))[0] ?? ''
    expect(first).not.toContain('@me')
    expect(cellWidth(first)).toBeLessThanOrEqual(25)
  })

  test('the viewer decides the groups', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf([issue(1, { assignees: ['Anna'] })]), { viewer: 'anna' }))
    expect((await linesOf(ui)).some((line) => line.startsWith('── Assigned to you'))).toBe(true)
  })
})

describe('renderIssues rows', () => {
  const rich = (): IssueItem =>
    issue(12, { title: 'Checkout fails on retry', author: 'oborchers', labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'payments', color: '0e8a16' }], assignees: ['anna', 'ben'], comments: 3, linkedPrs: [15, 16], createdAt: '2026-10-12T10:00:00Z' })

  test('title line and facts line: open mark, title, labels; number, author, age, assignees, comments, linked pull requests', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const ui = await show(rig, $, surface, viewOf(listOf([rich()])))
      const lines = await linesOf(ui)
      const at = lines.findIndex((line) => line.includes('Checkout fails'))
      expect(lines[at]).toBe('  ◯ Checkout fails on retry  bug  payments')
      expect(lines[at + 1]).toBe('    #12 · @oborchers · opened 2 h ago · → @anna, @ben · 💬 3 · ⇄ #15, #16')
      await ui.unmount()
    }
  })

  test('the optional facts are left out; no author when unknown', async ($, on) => {
    const rig = rigFor(on)
    const metaOf = async (extra: Partial<IssueItem>): Promise<string> => {
      const ui = await show(rig, $, 'terminal', viewOf(listOf([issue(9, { author: 'anna', createdAt: '2026-10-12T11:59:30Z', ...extra })]), { columns: 120 }))
      const lines = await linesOf(ui)
      await ui.unmount()
      return lines.find((line) => line.startsWith('    #9')) ?? ''
    }
    expect(await metaOf({})).toBe('    #9 · @anna · opened just now')
    expect(await metaOf({ assignees: ['ben'] })).toBe('    #9 · @anna · opened just now · → @ben')
    expect(await metaOf({ comments: 1 })).toBe('    #9 · @anna · opened just now · 💬 1')
    expect(await metaOf({ linkedPrs: [4] })).toBe('    #9 · @anna · opened just now · ⇄ #4')
    expect(await metaOf({ author: null })).toBe('    #9 · opened just now')
  })

  test('the open mark is the success tone, the title bold, labels muted, the facts dim', async ($, on) => {
    const rig = rigFor(on)
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      const ui = await show(rig, $, 'terminal', viewOf(listOf([rich()]), { palette }))
      const texts = textsOf(await ui.find({ key: 'issue-12' }))
      const named = (content: string) => texts.find((node) => node.children?.[0] === content)
      expect(named('◯')?.props?.color).toBe(palette.success)
      expect(named('Checkout fails on retry')?.props?.bold).toBe(true)
      expect(named('bug')?.props?.color).toBe(mutedLabelColor('d73a4a'))
      const start = texts.findIndex((node) => String(node.children?.[0]).startsWith('\n'))
      for (const node of texts.slice(start + 1).filter((candidate) => String(candidate.children?.[0]).trim() !== '')) {
        expect(node.props?.dimColor).toBe(true)
        expect(node.props?.color).toBeUndefined()
      }
      await ui.unmount()
    }
  })

  test('one blank line between issues and before each heading but the first, none after the last of a group', async ($, on) => {
    const rig = rigFor(on)
    const items = [issue(1, { assignees: ['me'], createdAt: '2026-10-03T10:00:00Z' }), issue(2, { createdAt: '2026-10-02T10:00:00Z' }), issue(3, { createdAt: '2026-10-01T10:00:00Z' })]
    const ui = await show(rig, $, 'terminal', viewOf(listOf(items)))
    const kind = (line: string): string => (line.trim() === '' ? 'blank' : line.startsWith('── ') ? 'heading' : /^ {4}#/.test(line) ? 'meta' : /^ {2,4}\S/.test(line) ? 'title' : 'other')
    const kinds = (await linesOf(ui)).map(kind)
    const start = kinds.indexOf('heading')
    expect(kinds.slice(start, start + 10)).toEqual(['heading', 'title', 'meta', 'blank', 'heading', 'title', 'meta', 'blank', 'title', 'meta'])
  })

  test('long titles are cut with an ellipsis; labels that do not fit become +N', async ($, on) => {
    const rig = rigFor(on)
    const many = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'].map((name) => ({ name, color: '1d76db' }))
    const titleLine = async (title: string, labels: IssueItem['labels'], columns: number): Promise<string> => {
      const ui = await show(rig, $, 'terminal', viewOf(listOf([issue(2, { title, labels })]), { columns }))
      const lines = await linesOf(ui)
      for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(columns)
      await ui.unmount()
      return lines.find((line) => line.startsWith('  ◯')) ?? ''
    }
    expect(await titleLine('Add feature', many, 80)).toBe('  ◯ Add feature  aaaaaaaa  bbbbbbbb  cccccccc  dddddddd')
    expect(await titleLine('Add feature', many, 40)).toBe('  ◯ Add feature  aaaaaaaa  bbbbbbbb  +2')
    expect(await titleLine('A title that keeps going and going and going', [many[0] as IssueItem['labels'][number]], 40)).toBe('  ◯ A title that keeps going …  aaaaaaaa')
    expect(await titleLine('A very long issue title that never ends and keeps going on and on', [], 30)).toContain('…')
  })

  describe('the focused row', () => {
    const colored = [issue(15, { title: 'fix', labels: [{ name: 'bug', color: 'd73a4a' }] })]

    test('marker before the mark and the title line drawn swapped, filled to the width', async ($, on) => {
      const rig = rigFor(on)
      for (const palette of [PALETTES.claude, PALETTES.github]) {
        const ui = await show(rig, $, 'terminal', viewOf(listOf(colored), { palette, focusedKey: 'issue-15' }))
        expect((await linesOf(ui)).filter((line) => line.startsWith('▸'))).toEqual(['▸ ◯ fix  bug'])
        const texts = textsOf(await ui.find({ key: 'issue-15' }))
        const first = texts.slice(0, texts.findIndex((node) => String(node.children?.[0]).startsWith('\n')))
        const named = (content: string) => first.find((node) => node.children?.[0] === content)
        expect(named('◯')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: palette.success })
        expect(named('fix')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_FG, bold: true })
        expect(named('bug')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: mutedLabelColor('d73a4a') })
        expect(named('▸ ')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: palette.pending })
        expect(first.at(-1)?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_FG })
        expect(cellWidth(first.map((node) => String(node.children?.[0])).join(''))).toBe(100)
        await ui.unmount()
      }
    })

    test('the facts line: the opening piece as is, the later ones swapped, filled to the width', async ($, on) => {
      const rig = rigFor(on)
      const ui = await show(rig, $, 'terminal', viewOf(listOf(colored), { focusedKey: 'issue-15' }))
      const texts = textsOf(await ui.find({ key: 'issue-15' }))
      const second = texts.slice(texts.findIndex((node) => String(node.children?.[0]).startsWith('\n')))
      expect(second.length).toBeGreaterThan(3)
      expect(second[0]?.props).toMatchObject({ color: FOCUS_DIM, backgroundColor: FOCUS_BG })
      for (const node of second.slice(1)) expect(node.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_DIM })
      expect(cellWidth(second.map((node) => String(node.children?.[0])).join('').slice(1))).toBe(100)
      await ui.unmount()
    })

    test('normal colors when another row, or none, has the focus', async ($, on) => {
      const rig = rigFor(on)
      for (const focusedKey of [null, 'issue-99']) {
        const ui = await show(rig, $, 'terminal', viewOf(listOf(colored), { focusedKey }))
        const texts = textsOf(await ui.find({ key: 'issue-15' }))
        expect(texts.find((node) => node.children?.[0] === '◯')?.props?.backgroundColor).toBeUndefined()
        expect(texts.some((node) => node.children?.[0] === '▸ ')).toBe(false)
        for (const node of texts.slice(texts.findIndex((entry) => String(entry.children?.[0]).startsWith('\n')) + 1)) expect(node.props?.backgroundColor).toBeUndefined()
        await ui.unmount()
      }
    })

    test('a hovered row looks like a focused one; the keyed Box holds only the Button', async ($, on) => {
      const rig = rigFor(on)
      const ui = await show(rig, $, 'terminal', viewOf(listOf(colored)))
      const texts = textsOf(await ui.find({ key: 'issue-15' }))
      const split = texts.findIndex((node) => String(node.children?.[0]).startsWith('\n'))
      const hoverOf = (content: string) => (texts.find((node) => node.children?.[0] === content) as { hover?: unknown } | undefined)?.hover
      expect(hoverOf('◯')).toMatchObject({ color: FOCUS_BG, backgroundColor: PALETTES.claude.success })
      expect(hoverOf('fix')).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_FG })
      expect((texts[split] as { hover?: unknown }).hover).toMatchObject({ color: FOCUS_DIM, backgroundColor: FOCUS_BG })
      for (const node of texts.slice(split + 1)) expect((node as { hover?: unknown }).hover).toMatchObject({ color: FOCUS_BG })
      const rows = (await ui.findAll({ type: 'Box' })).filter((box) => String(box.key).startsWith('row-'))
      expect(rows.map((box) => String(box.key))).toEqual(['row-issue-15'])
      const [box] = rows
      expect((box?.children ?? []).map((child) => (child as { type?: string }).type)).toEqual(['Button'])
      await ui.unmount()
    })
  })
})

describe('renderIssues fits the width', () => {
  test('no line is wider than the columns at 10, 20, 40, 80, 120 and 160', async ($, on) => {
    const rig = rigFor(on)
    const labels = Array.from({ length: 8 }, (_, index) => ({ name: `label-number-${index}`, color: 'a2eeef' }))
    const heavy = Array.from({ length: 6 }, (_, index) =>
      issue(5000 + index, { title: 'An extremely long title: '.repeat(6), author: 'a-rather-long-author-login', labels, assignees: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'], comments: 1234, linkedPrs: [1, 2, 3], createdAt: '2025-01-01T10:00:00Z' }),
    )
    for (const columns of [10, 20, 40, 80, 120, 160]) {
      for (const surface of SURFACES) {
        const ui = await show(rig, $, surface, viewOf(listOf([...heavy, ...crowd()]), { columns, focusedKey: 'issue-5001' }))
        for (const line of await linesOf(ui)) expect(cellWidth(line)).toBeLessThanOrEqual(Math.max(columns, 10))
        await ui.unmount()
      }
    }
  })

  test('the facts line is cut at its end, the start stays', async ($, on) => {
    const rig = rigFor(on)
    const item = issue(5001, { author: 'a-rather-long-author-login', assignees: ['aaaaaaaaaaaa'], comments: 1234, linkedPrs: [1], createdAt: '2025-01-01T10:00:00Z' })
    const narrow = await show(rig, $, 'terminal', viewOf(listOf([item]), { columns: 50 }))
    const meta = (await linesOf(narrow)).find((line) => line.includes('#5001')) ?? ''
    expect(meta.startsWith('    #5001 · @a-rather-long-author-login')).toBe(true)
    expect(meta.endsWith('…')).toBe(true)
    const wide = await show(rig, $, 'terminal', viewOf(listOf([item]), { columns: 160 }))
    expect((await linesOf(wide)).find((line) => line.includes('#5001'))).toBe(`    #5001 · @a-rather-long-author-login · opened ${relativeTime('2025-01-01T10:00:00Z', NOW)} · → @aaaaaaaaaaaa · 💬 1234 · ⇄ #1`)
  })

  test('footer buttons wrap into several lines instead of overflowing', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { columns: 24, page: 0 }))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => /^[nprx]: /.test(line)).length).toBeGreaterThan(1)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(24)
  })
})

describe('renderIssues presses', () => {
  test('rows and footer buttons call the handlers', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await show(rig, $, surface, viewOf(listOf(crowd()), { columns: 120 }), calls)
      await ui.press({ key: 'issue-5' })
      await ui.press({ key: 'issue-6' })
      await ui.press({ key: 'issues-next' })
      await ui.press({ key: 'issues-refresh' })
      await ui.press({ key: 'issues-close' })
      expect(calls).toEqual(['select 5', 'select 6', 'next', 'refresh', 'close'])
      expect(await ui.find({ key: 'issues-prev' })).toBeUndefined()
      await ui.unmount()
      const second = await show(rig, $, surface, viewOf(listOf(crowd()), { page: 1 }), calls)
      await second.press({ key: 'issues-prev' })
      expect(calls.at(-1)).toBe('prev')
      await second.unmount()
    }
  })

  test('every issue is one plain button keyed issue-N', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { columns: 120 }))
    const buttons = (await ui.findAll({ type: 'Button' })).filter((button) => String(button.key).startsWith('issue-'))
    expect(buttons.map((button) => String(button.key)).filter((key) => /^issue-\d+$/.test(key))).toHaveLength(10)
    for (const button of buttons) expect(button.props.plain).toBe(true)
  })
})

describe('renderIssues page size', () => {
  test('a smaller pageSize draws fewer issues and says so in the header', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { pageSize: 3 }))
    expect((await linesOf(ui))[0]).toBe('20 open · 1 to 3 · page 1 of 7 · @me')
    expect((await ui.findAll({ type: 'Button' })).filter((button) => /^issue-\d+$/.test(String(button.key)))).toHaveLength(3)
    await ui.unmount()
    const second = await show(rig, $, 'terminal', viewOf(listOf(crowd()), { pageSize: 3, page: 2 }))
    expect((await linesOf(second))[0]).toBe('20 open · 7 to 9 · page 3 of 7 · @me')
    await second.unmount()
  })
})
