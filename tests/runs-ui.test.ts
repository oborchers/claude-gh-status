import { describe, expect, test } from 'claude-code/testing'

import type { CheckState, RunItem, RunList } from '../src/model'
import { PALETTES } from '../src/ui/colors'
import type { RepoHandlers, RunsView } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { renderRuns } from '../src/ui/runs'
import { SURFACES, createRig, hotkeysOf, linesOf, nodesOf, textOf, textsOf } from './fixtures/ui-rig'
import { makeLocation } from './fixtures/pr-builder'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const FOCUS_BG = '#30363d'
const FOCUS_FG = '#e6edf3'
const FOCUS_DIM = '#8b949e'

function run(id: number, extra: Partial<RunItem> = {}): RunItem {
  return {
    id,
    runNumber: id,
    workflowId: 1,
    name: `Workflow ${id}`,
    branch: 'main',
    event: 'push',
    actor: 'anna',
    state: 'success',
    headSha: 'abcdef1234567',
    createdAt: '2026-10-12T11:56:00Z',
    startedAt: '2026-10-12T11:56:02Z',
    updatedAt: '2026-10-12T11:59:14Z',
    url: `https://github.com/acme/app/actions/runs/${id}`,
    attempt: 1,
    ...extra,
  }
}

const account = { login: 'me', source: 'active' } as const

function listOf(groups: { main?: RunItem[]; branch?: RunItem[]; recent?: RunItem[] }): RunList {
  return { kind: 'list', at: '2026-10-12T11:59:00Z', location: makeLocation(), account, defaultBranch: 'main', main: groups.main ?? [], branch: groups.branch ?? [], recent: groups.recent ?? [] }
}

/** 2 on main, 2 on this branch, then `recent` others. */
function crowd(recent = 14): RunList {
  return listOf({
    main: [run(1), run(2)],
    branch: [run(3, { branch: 'feat/things' }), run(4, { branch: 'feat/things' })],
    recent: Array.from({ length: recent }, (_, index) => run(100 + index, { branch: 'other/branch' })),
  })
}

function viewOf(runs: RunList | null, extra: Partial<RunsView> = {}): RunsView {
  return { runs, page: 0, focusedKey: null, nowMs: NOW, columns: 100, palette: PALETTES.claude, ...extra }
}

function handlersFor(calls: string[]): RepoHandlers {
  return {
    showTab: (tab) => void calls.push(`tab ${tab}`),
    selectIssue: (number) => void calls.push(`issue ${number}`),
    selectRun: (id) => void calls.push(`select ${id}`),
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

const rigFor = (on: Parameters<typeof createRig>[0]) => createRig<RunsView, RepoHandlers>(on, renderRuns)
const show = (rig: ReturnType<typeof rigFor>, $: Parameters<ReturnType<typeof rigFor>['show']>[0], surface: (typeof SURFACES)[number], view: RunsView, calls: string[] = []) => rig.show($, surface, view, handlersFor(calls), view.columns)

describe('renderRuns states', () => {
  test('loading and missing list read as one line with refresh and close', async ($, on) => {
    const rig = rigFor(on)
    for (const runs of [null, { kind: 'loading', at: '' } as RunList]) {
      const ui = await show(rig, $, 'terminal', viewOf(runs))
      const lines = await linesOf(ui)
      expect(lines[0]).toBe('Loading workflow runs…')
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
    const ui = await show(rig, $, 'terminal', viewOf(listOf({})))
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('0 runs')
    expect(lines[1]).toBe('No workflow runs.')
  })

  test('stale data keeps the list and adds the hint line', async ($, on) => {
    const rig = rigFor(on)
    const problem = { reason: '504', since: '2026-10-12T11:58:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 15_000 }
    const list = { ...(listOf({ main: [run(1)] }) as Extract<RunList, { kind: 'list' }>), problem }
    const ui = await show(rig, $, 'terminal', viewOf(list))
    expect((await linesOf(ui))[1]).toBe('showing last data from 1 min ago, GitHub unavailable (504), retrying in 5 s')
  })
})

describe('renderRuns header, groups and pages', () => {
  test('summary line and group headings: the default branch name, This branch, Recent', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const ui = await show(rig, $, surface, viewOf(crowd()))
      const lines = await linesOf(ui)
      expect(lines[0]).toBe('18 runs · 1 to 10 · page 1 of 2')
      const headings = lines.filter((line) => line.startsWith('── '))
      expect(headings.map((line) => line.replace(/^── | ─+/g, ''))).toEqual(['main', 'This branch', 'Recent'])
      for (const line of headings) expect(cellWidth(line)).toBe(100)
      await ui.unmount()
    }
  })

  test('the first heading names the default branch of the repository', async ($, on) => {
    const rig = rigFor(on)
    const list = { ...(listOf({ main: [run(1, { branch: 'trunk' })] }) as Extract<RunList, { kind: 'list' }>), defaultBranch: 'trunk' }
    const ui = await show(rig, $, 'terminal', viewOf(list))
    expect((await linesOf(ui)).filter((line) => line.startsWith('── ')).map((line) => line.replace(/^── | ─+/g, ''))).toEqual(['trunk'])
  })

  test('a group that is empty has no heading', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf({ recent: [run(1, { branch: 'x' })] })))
    expect((await linesOf(ui)).filter((line) => line.startsWith('── ')).map((line) => line.slice(3, 9))).toEqual(['Recent'])
  })

  test('page 1 has next, the last previous; the footer text follows', async ($, on) => {
    const rig = rigFor(on)
    const first = await show(rig, $, 'terminal', viewOf(crowd()))
    expect(await hotkeysOf(first)).toEqual(['n', 'r', 'x'])
    expect(await textOf(first)).toContain('n: next')
    expect(await textOf(first)).not.toContain('p: previous')
    const last = await show(rig, $, 'terminal', viewOf(crowd(), { page: 1 }))
    expect((await linesOf(last))[0]).toBe('18 runs · 11 to 18 · page 2 of 2')
    expect(await hotkeysOf(last)).toEqual(['p', 'r', 'x'])
    expect(await textOf(last)).toContain('p: previous')
    const only = await show(rig, $, 'terminal', viewOf(crowd(2)))
    expect(await hotkeysOf(only)).toEqual(['r', 'x'])
    const clamped = await show(rig, $, 'terminal', viewOf(crowd(), { page: 9 }))
    expect((await linesOf(clamped))[0]).toBe('18 runs · 11 to 18 · page 2 of 2')
  })

  test('a page holds 10 runs, two lines each', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(crowd()))
    expect((await linesOf(ui)).filter((line) => /^ {4}#\d+ ·/.test(line))).toHaveLength(10)
  })
})

describe('renderRuns rows', () => {
  const states: [CheckState, string, 'success' | 'failure' | 'pending' | 'dim'][] = [
    ['success', '✓', 'success'],
    ['failure', '✗', 'failure'],
    ['timed-out', '✗', 'failure'],
    ['running', '●', 'pending'],
    ['queued', '◷', 'pending'],
    ['cancelled', '⊘', 'dim'],
    ['skipped', '–', 'dim'],
    ['neutral', '–', 'dim'],
  ]

  test('the state symbol and its tone, in both palettes', async ($, on) => {
    const rig = rigFor(on)
    for (const palette of [PALETTES.claude, PALETTES.github]) {
      for (const [state, symbol, kind] of states) {
        const ui = await show(rig, $, 'terminal', viewOf(listOf({ main: [run(7, { name: 'CI', state })] }), { palette }))
        expect((await linesOf(ui)).find((line) => line.includes('CI'))).toBe(`  ${symbol} CI`)
        const node = nodesOf(await ui.drawn()).find((candidate) => candidate.children?.[0] === symbol)
        if (kind === 'dim') {
          expect(node?.props?.dimColor).toBe(true)
          expect(node?.props?.color).toBeUndefined()
        } else {
          expect(node?.props?.color).toBe(palette[kind])
        }
        await ui.unmount()
      }
    }
  })

  test('title line: symbol, bold workflow name, dim branch except in the default branch group', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(crowd(2)))
    const lines = await linesOf(ui)
    expect(lines.find((line) => line.includes('Workflow 1'))).toBe('  ✓ Workflow 1')
    expect(lines.find((line) => line.includes('Workflow 3'))).toBe('  ✓ Workflow 3  feat/things')
    expect(lines.find((line) => line.includes('Workflow 100'))).toBe('  ✓ Workflow 100  other/branch')
    const texts = textsOf(await ui.find({ key: 'run-3' }))
    const named = (content: string) => texts.find((node) => node.children?.[0] === content)
    expect(named('Workflow 3')?.props?.bold).toBe(true)
    expect(named('feat/things')?.props?.dimColor).toBe(true)
    expect(named('feat/things')?.props?.bold).toBeUndefined()
  })

  test('the facts line: number, event, actor, age and duration', async ($, on) => {
    const rig = rigFor(on)
    const metaOf = async (extra: Partial<RunItem>): Promise<string> => {
      const ui = await show(rig, $, 'terminal', viewOf(listOf({ main: [run(9, { runNumber: 412, ...extra })] }), { columns: 120 }))
      const lines = await linesOf(ui)
      await ui.unmount()
      return lines.find((line) => line.startsWith('    #412')) ?? ''
    }
    // Completed: startedAt to updatedAt (3:12). Age: createdAt, 4 min ago.
    expect(await metaOf({})).toBe('    #412 · push · @anna · 4 min ago · 3:12')
    expect(await metaOf({ event: 'pull_request', actor: null })).toBe('    #412 · pull_request · 4 min ago · 3:12')
    // Running: startedAt to now.
    expect(await metaOf({ state: 'running', startedAt: '2026-10-12T11:58:55Z', updatedAt: '2026-10-12T11:59:00Z' })).toBe('    #412 · push · @anna · 4 min ago · 1:05')
    // Queued or never started: no duration.
    expect(await metaOf({ state: 'queued', startedAt: null })).toBe('    #412 · push · @anna · 4 min ago')
    expect(await metaOf({ state: 'cancelled', startedAt: null })).toBe('    #412 · push · @anna · 4 min ago')
  })

  test('the facts line is dim', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf({ main: [run(9, { state: 'failure' })] })))
    const texts = textsOf(await ui.find({ key: 'run-9' }))
    const start = texts.findIndex((node) => String(node.children?.[0]).startsWith('\n'))
    const facts = texts.slice(start + 1).filter((node) => String(node.children?.[0]).trim() !== '')
    expect(facts.length).toBeGreaterThan(5)
    for (const node of facts) {
      expect(node.props?.dimColor).toBe(true)
      expect(node.props?.color).toBeUndefined()
    }
  })

  test('one blank line between runs and before each heading but the first, none after the last of a group', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(listOf({ main: [run(1), run(2)], recent: [run(3, { branch: 'x' })] })))
    const kind = (line: string): string => (line.trim() === '' ? 'blank' : line.startsWith('── ') ? 'heading' : /^ {4}#/.test(line) ? 'meta' : /^ {2,4}\S/.test(line) ? 'title' : 'other')
    const kinds = (await linesOf(ui)).map(kind)
    const start = kinds.indexOf('heading')
    expect(kinds.slice(start, start + 10)).toEqual(['heading', 'title', 'meta', 'blank', 'title', 'meta', 'blank', 'heading', 'title', 'meta'])
  })

  test('a long name keeps its floor and the branch is cut or dropped', async ($, on) => {
    const rig = rigFor(on)
    const titleLine = async (name: string, branch: string, columns: number): Promise<string> => {
      const ui = await show(rig, $, 'terminal', viewOf(listOf({ recent: [run(2, { name, branch })] }), { columns }))
      const lines = await linesOf(ui)
      for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(columns)
      await ui.unmount()
      return lines.find((line) => line.startsWith('  ✓')) ?? ''
    }
    expect(await titleLine('Build', 'feat/things', 60)).toBe('  ✓ Build  feat/things')
    expect(await titleLine('Build and deploy to production', 'feature/a-very-long-branch-name', 40)).toBe('  ✓ Build and deplo…  feature/a-very-lo…')
    expect(await titleLine('Build and deploy to production environments', 'feature/x', 20)).toBe('  ✓ Build and deplo…')
  })

  describe('the focused row', () => {
    const failing = listOf({ main: [run(15, { name: 'CI', state: 'failure' })] })

    test('marker, and the title line drawn swapped, filled to the width', async ($, on) => {
      const rig = rigFor(on)
      for (const palette of [PALETTES.claude, PALETTES.github]) {
        const ui = await show(rig, $, 'terminal', viewOf(failing, { palette, focusedKey: 'run-15' }))
        expect((await linesOf(ui)).filter((line) => line.startsWith('▸'))).toEqual(['▸ ✗ CI'])
        const texts = textsOf(await ui.find({ key: 'run-15' }))
        const first = texts.slice(0, texts.findIndex((node) => String(node.children?.[0]).startsWith('\n')))
        const named = (content: string) => first.find((node) => node.children?.[0] === content)
        expect(named('✗')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: palette.failure })
        expect(named('CI')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_FG, bold: true })
        expect(named('▸ ')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: palette.pending })
        expect(first.at(-1)?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_FG })
        expect(cellWidth(first.map((node) => String(node.children?.[0])).join(''))).toBe(100)
        await ui.unmount()
      }
    })

    test('a focused dim state symbol and branch are swapped onto the grey', async ($, on) => {
      const rig = rigFor(on)
      const ui = await show(rig, $, 'terminal', viewOf(listOf({ recent: [run(15, { name: 'CI', state: 'cancelled', branch: 'x/y' })] }), { focusedKey: 'run-15' }))
      const texts = textsOf(await ui.find({ key: 'run-15' }))
      const named = (content: string) => texts.find((node) => node.children?.[0] === content)
      expect(named('⊘')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_DIM })
      expect(named('x/y')?.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_DIM })
    })

    test('the facts line: the opening piece as is, the later ones swapped, filled to the width', async ($, on) => {
      const rig = rigFor(on)
      const ui = await show(rig, $, 'terminal', viewOf(failing, { focusedKey: 'run-15' }))
      const texts = textsOf(await ui.find({ key: 'run-15' }))
      const second = texts.slice(texts.findIndex((node) => String(node.children?.[0]).startsWith('\n')))
      expect(second.length).toBeGreaterThan(3)
      expect(second[0]?.props).toMatchObject({ color: FOCUS_DIM, backgroundColor: FOCUS_BG })
      for (const node of second.slice(1)) expect(node.props).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_DIM })
      expect(cellWidth(second.map((node) => String(node.children?.[0])).join('').slice(1))).toBe(100)
      await ui.unmount()
    })

    test('normal colors when another row, or none, has the focus', async ($, on) => {
      const rig = rigFor(on)
      for (const focusedKey of [null, 'run-99']) {
        const ui = await show(rig, $, 'terminal', viewOf(failing, { focusedKey }))
        const texts = textsOf(await ui.find({ key: 'run-15' }))
        expect(texts.find((node) => node.children?.[0] === '✗')?.props?.backgroundColor).toBeUndefined()
        expect(texts.some((node) => node.children?.[0] === '▸ ')).toBe(false)
        for (const node of texts.slice(texts.findIndex((entry) => String(entry.children?.[0]).startsWith('\n')) + 1)) expect(node.props?.backgroundColor).toBeUndefined()
        await ui.unmount()
      }
    })

    test('a hovered row looks like a focused one; the keyed Box holds only the Button', async ($, on) => {
      const rig = rigFor(on)
      const ui = await show(rig, $, 'terminal', viewOf(failing))
      const texts = textsOf(await ui.find({ key: 'run-15' }))
      const split = texts.findIndex((node) => String(node.children?.[0]).startsWith('\n'))
      const hoverOf = (content: string) => (texts.find((node) => node.children?.[0] === content) as { hover?: unknown } | undefined)?.hover
      expect(hoverOf('✗')).toMatchObject({ color: FOCUS_BG, backgroundColor: PALETTES.claude.failure })
      expect(hoverOf('CI')).toMatchObject({ color: FOCUS_BG, backgroundColor: FOCUS_FG })
      expect((texts[split] as { hover?: unknown }).hover).toMatchObject({ color: FOCUS_DIM, backgroundColor: FOCUS_BG })
      for (const node of texts.slice(split + 1)) expect((node as { hover?: unknown }).hover).toMatchObject({ color: FOCUS_BG })
      const rows = (await ui.findAll({ type: 'Box' })).filter((box) => String(box.key).startsWith('row-'))
      expect(rows.map((box) => String(box.key))).toEqual(['row-run-15'])
      expect((rows[0]?.children ?? []).map((child) => (child as { type?: string }).type)).toEqual(['Button'])
      await ui.unmount()
    })
  })
})

describe('renderRuns fits the width', () => {
  test('no line is wider than the columns at 10, 20, 40, 80, 120 and 160', async ($, on) => {
    const rig = rigFor(on)
    const heavy = Array.from({ length: 6 }, (_, index) =>
      run(5000 + index, { name: 'An extremely long workflow name: '.repeat(4), branch: 'feature/a-rather-long-branch-name-that-goes-on', actor: 'a-rather-long-actor-login', event: 'workflow_dispatch', state: index % 2 === 0 ? 'failure' : 'running' }),
    )
    const list = listOf({ main: heavy.slice(0, 2), branch: heavy.slice(2, 4), recent: [...heavy.slice(4), ...Array.from({ length: 10 }, (_, index) => run(100 + index))] })
    for (const columns of [10, 20, 40, 80, 120, 160]) {
      for (const surface of SURFACES) {
        const ui = await show(rig, $, surface, viewOf(list, { columns, focusedKey: 'run-5002' }))
        for (const line of await linesOf(ui)) expect(cellWidth(line)).toBeLessThanOrEqual(Math.max(columns, 10))
        await ui.unmount()
      }
    }
  })

  test('the facts line is cut at its end, the start stays', async ($, on) => {
    const rig = rigFor(on)
    const list = listOf({ main: [run(5001, { runNumber: 5001, event: 'workflow_dispatch', actor: 'a-rather-long-actor-login' })] })
    const ui = await show(rig, $, 'terminal', viewOf(list, { columns: 40 }))
    const meta = (await linesOf(ui)).find((line) => line.includes('#5001')) ?? ''
    expect(meta.startsWith('    #5001 · workflow_dispatch')).toBe(true)
    expect(meta.endsWith('…')).toBe(true)
    expect(cellWidth(meta)).toBeLessThanOrEqual(40)
  })

  test('footer buttons wrap into several lines instead of overflowing', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(crowd(), { columns: 24, page: 0 }))
    const lines = await linesOf(ui)
    expect(lines.filter((line) => /^[nprx]: /.test(line)).length).toBeGreaterThan(1)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(24)
  })
})

describe('renderRuns presses', () => {
  test('rows and footer buttons call the handlers', async ($, on) => {
    const rig = rigFor(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await show(rig, $, surface, viewOf(crowd(), { columns: 120 }), calls)
      await ui.press({ key: 'run-3' })
      await ui.press({ key: 'run-100' })
      await ui.press({ key: 'runs-next' })
      await ui.press({ key: 'runs-refresh' })
      await ui.press({ key: 'runs-close' })
      expect(calls).toEqual(['select 3', 'select 100', 'next', 'refresh', 'close'])
      expect(await ui.find({ key: 'runs-prev' })).toBeUndefined()
      await ui.unmount()
      const second = await show(rig, $, surface, viewOf(crowd(), { page: 1 }), calls)
      await second.press({ key: 'runs-prev' })
      expect(calls.at(-1)).toBe('prev')
      await second.unmount()
    }
  })

  test('every run is one plain button keyed run-ID', async ($, on) => {
    const rig = rigFor(on)
    const ui = await show(rig, $, 'terminal', viewOf(crowd()))
    const buttons = (await ui.findAll({ type: 'Button' })).filter((button) => String(button.key).startsWith('run-'))
    expect(buttons).toHaveLength(10)
    for (const button of buttons) expect(button.props.plain).toBe(true)
  })
})

describe('renderRuns page size', () => {
  test('a smaller pageSize draws fewer runs and says so in the header', async ($, on) => {
    const rig = createRig<RunsView, RepoHandlers>(on, renderRuns)
    const ui = await rig.show($, 'terminal', viewOf(crowd(), { pageSize: 3 }), handlersFor([]), 100)
    expect((await linesOf(ui))[0]).toBe('18 runs · 1 to 3 · page 1 of 6')
    expect((await ui.findAll({ type: 'Button' })).filter((button) => /^run-\d+$/.test(String(button.key)))).toHaveLength(3)
    await ui.unmount()
  })
})
