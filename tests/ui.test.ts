import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import type { Check, JobDetail, PendingAction, PullRequest, Snapshot } from '../src/model'
import { buildPending } from '../src/actions'
import { deriveStatus } from '../src/status'
import { renderBand } from '../src/ui/band'
import { PALETTES, badgeBackground } from '../src/ui/colors'
import type { Palette } from '../src/ui/colors'
import { prBadge } from '../src/status'
import type { Handlers, View } from '../src/ui/contract'
import { cellWidth, count, fitSegments, headingLine, repeatsBadge, snapshotLine, truncate, truncateStart } from '../src/ui/format'
import { confirmRowCount } from '../src/ui/confirm'
import { paneRowCount, renderPane, sortChecks } from '../src/ui/pane'
import { makeCheck, makeLocation, makePr, makeSnapshot } from './fixtures/pr-builder'

const NOW = Date.parse('2026-01-01T00:10:00Z')
const SURFACES = ['terminal', 'desktop'] as const

describe('cellWidth and truncate', () => {
  test('counts emoji as two cells and joiners as none', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('💬')).toBe(2)
    expect(cellWidth('✓ ok')).toBe(4)
    expect(cellWidth('a‍b')).toBe(2)
    expect(cellWidth('')).toBe(0)
  })

  test('keeps short text and cuts long text with an ellipsis', () => {
    expect(truncate('hello', 5)).toBe('hello')
    expect(truncate('hello world', 8)).toBe('hello w…')
    expect(truncate('hello', 1)).toBe('…')
    expect(truncate('hello', 0)).toBe('')
    expect(truncate('hello', -3)).toBe('')
  })

  test('never exceeds the width, also for wide glyphs', () => {
    for (const text of ['💬 2 unresolved, 1 new', '日本語のテキスト', 'plain ascii text here']) {
      for (let max = 0; max <= 24; max += 1) {
        expect(cellWidth(truncate(text, max))).toBeLessThanOrEqual(max)
        expect(cellWidth(truncateStart(text, max))).toBeLessThanOrEqual(max)
      }
    }
  })

  test('truncateStart keeps the end', () => {
    expect(truncateStart('src/ui/band.tsx', 8)).toBe('…and.tsx')
    expect(truncateStart('short', 10)).toBe('short')
    expect(truncateStart('abc', 1)).toBe('…')
  })

  test('headingLine fills the width', () => {
    expect(headingLine('Merge', 20)).toBe('── Merge ───────────')
    expect(cellWidth(headingLine('Merge', 20))).toBe(20)
    expect(cellWidth(headingLine('A very long heading title', 12))).toBeLessThanOrEqual(12)
  })

  test('count picks the form', () => {
    expect(count(1, 'thread', 'threads')).toBe('1 thread')
    expect(count(2, 'thread', 'threads')).toBe('2 threads')
    expect(count(0, 'thread', 'threads')).toBe('0 threads')
  })
})

describe('fitSegments', () => {
  const segments = [
    { key: 'pr', width: 6, priority: 1 },
    { key: 'verdict', width: 14, priority: 2 },
    { key: 'pipeline', width: 22, priority: 3 },
    { key: 'reviews', width: 16, priority: 4 },
    { key: 'threads', width: 22, priority: 5 },
    { key: 'account', width: 11, priority: 6 },
    { key: 'details', width: 11, priority: 7 },
    { key: 'github', width: 10, priority: 8 },
  ]
  const keys = (columns: number) => fitSegments(segments, columns, 3).map((segment) => segment.key)
  const total = (columns: number) => {
    const kept = fitSegments(segments, columns, 3)
    return kept.reduce((sum, segment) => sum + segment.width, 0) + (kept.length - 1) * 3
  }

  test('keeps everything at 160 columns', () => {
    expect(keys(160)).toEqual(['pr', 'verdict', 'pipeline', 'reviews', 'threads', 'account', 'details', 'github'])
  })

  test('drops buttons then the account at 80 columns', () => {
    expect(keys(80)).toEqual(['pr', 'verdict', 'pipeline', 'reviews'])
  })

  test('keeps only the PR number and the verdict at 40 columns', () => {
    expect(keys(40)).toEqual(['pr', 'verdict'])
  })

  test('always fits when it can and drops from the lowest priority up', () => {
    for (const columns of [40, 80, 160]) expect(total(columns)).toBeLessThanOrEqual(columns)
    let previous = Number.POSITIVE_INFINITY
    for (let columns = 160; columns >= 20; columns -= 5) {
      const kept = keys(columns).length
      expect(kept).toBeLessThanOrEqual(previous)
      previous = kept
    }
  })

  test('never drops the first piece and keeps order', () => {
    expect(keys(1)).toEqual(['pr'])
    expect(fitSegments([], 10, 3)).toEqual([])
    const shuffled = [segments[2], segments[0], segments[1]].flatMap((segment) => (segment === undefined ? [] : [segment]))
    expect(fitSegments(shuffled, 30, 3).map((segment) => segment.key)).toEqual(['pr', 'verdict'])
  })

  test('drops the later piece on a priority tie', () => {
    const tie = [
      { key: 'a', width: 10, priority: 1 },
      { key: 'b', width: 10, priority: 2 },
      { key: 'c', width: 10, priority: 2 },
    ]
    expect(fitSegments(tie, 25, 3).map((segment) => segment.key)).toEqual(['a', 'b'])
  })
})

describe('snapshotLine', () => {
  const location = makeLocation()
  const at = '2026-01-01T00:00:00Z'
  const account = { login: 'me', source: 'active' } as const

  test('band draws nothing for detached, no remote, not a repo and loading', () => {
    const snapshots: Snapshot[] = [
      { kind: 'loading', at },
      { kind: 'not-a-repo', at, cwd: '/x' },
      { kind: 'no-github-remote', at, location },
      { kind: 'detached', at, location },
    ]
    for (const snapshot of snapshots) expect(snapshotLine(snapshot, 'band')).toBeNull()
  })

  test('pane explains each of them', () => {
    const snapshots: Snapshot[] = [
      { kind: 'loading', at },
      { kind: 'not-a-repo', at, cwd: '/x' },
      { kind: 'no-github-remote', at, location },
      { kind: 'detached', at, location },
    ]
    for (const snapshot of snapshots) expect(snapshotLine(snapshot, 'pane')?.text.length).toBeGreaterThan(10)
    expect(snapshotLine(snapshots[3] as Snapshot, 'pane')?.text).toContain('detached')
  })

  test('no-pr, no-account and error speak in both places', () => {
    expect(snapshotLine({ kind: 'no-pr', at, location, account }, 'band')).toEqual({ text: 'no PR for feat/things', isDim: true })
    expect(snapshotLine({ kind: 'no-account', at, location, failure: { kind: 'no-access', tried: ['a', 'b'] } }, 'band')?.text).toBe(
      'gh-status: no gh account can read acme/app (tried a, b)',
    )
    expect(snapshotLine({ kind: 'no-account', at, location, failure: { kind: 'gh-missing', tried: [] } }, 'pane')?.text).toContain('not installed')
    expect(snapshotLine({ kind: 'no-account', at, location, failure: { kind: 'not-logged-in', tried: [] } }, 'pane')?.text).toContain('gh auth login')
    expect(snapshotLine({ kind: 'error', at, message: 'rate limited', location: null }, 'band')?.text).toBe('gh-status: rate limited')
    expect(snapshotLine({ kind: 'pr', at, location, account, pr: makePr() }, 'band')).toBeNull()
  })
})

describe('transient problem text', () => {
  const location = makeLocation()
  const at = '2026-01-01T00:09:00Z'
  const problem = { reason: '504', since: at, triedAt: '2026-01-01T00:09:50Z', retryInMs: 15_000 }

  test('an error without earlier data reads as trouble with a countdown', () => {
    const snapshot: Snapshot = { kind: 'error', at, message: 'gh: HTTP 504', location, problem }
    expect(snapshotLine(snapshot, 'pane')?.text).toBe('GitHub is having trouble (504), retrying in 15 s')
    expect(snapshotLine(snapshot, 'band', NOW)?.text).toBe('GitHub is having trouble (504), retrying in 5 s')
    expect(snapshotLine(snapshot, 'band', NOW + 20_000)?.text).toBe('GitHub is having trouble (504), retrying')
    expect(snapshotLine(snapshot, 'band')?.text).not.toContain('gh: HTTP 504')
  })

  test('an error without a marker keeps the raw message', () => {
    expect(snapshotLine({ kind: 'error', at, message: 'GraphQL: boom', location }, 'band')?.text).toBe('gh-status: GraphQL: boom')
  })
})

describe('stale data hint', () => {
  const stale = { reason: '504', since: '2026-01-01T00:08:00Z', triedAt: '2026-01-01T00:09:50Z', retryInMs: 15_000 }
  const staleView = (columns: number, overrides: Partial<PullRequest> = {}): View => {
    const base = makeSnapshot(makePr({ checks: [makeCheck()], ...overrides }))
    const snapshot: Snapshot = base.kind === 'pr' ? { ...base, at: '2026-01-01T00:08:00Z', stale } : base
    return viewFor(snapshot, columns)
  }

  test('the band shows the hint before the account on every surface', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.band($, surface, staleView(120), handlersFor([]))
      const text = await textOf(ui)
      expect(text).toContain('GitHub unavailable (504), retrying')
      expect(text.indexOf('GitHub unavailable')).toBeLessThan(text.indexOf('@me'))
      await ui.unmount()
    }
  })

  test('the band without a marker has no hint', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.band($, 'terminal', prView({ checks: [makeCheck()] }, 120), handlersFor([]))
    expect(await textOf(ui)).not.toContain('GitHub unavailable')
  })

  test('the band drops the account first, then the hint, and fits the width', async ($, on) => {
    const rig = createRig(on)
    const seen: { hasHint: boolean; hasAccount: boolean }[] = []
    for (const columns of [120, 90, 70, 60, 50, 40, 30]) {
      const ui = await rig.band($, 'terminal', staleView(columns), handlersFor([]))
      const text = await textOf(ui)
      for (const row of text.split('\n')) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      seen.push({ hasHint: text.includes('GitHub unavailable'), hasAccount: text.includes('@me') })
      await ui.unmount()
    }
    expect(seen[0]).toEqual({ hasHint: true, hasAccount: true })
    for (const entry of seen) if (entry.hasAccount) expect(entry.hasHint).toBe(true)
    expect(seen.at(-1)?.hasHint).toBe(false)
  })

  test('the pane says how old the data is, what is wrong and when it retries', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.pane($, surface, staleView(100), handlersFor([]))
      const text = await textOf(ui)
      expect(text).toContain('showing last data from 2 min ago, GitHub unavailable (504), retrying in 5 s')
      await ui.unmount()
    }
  })

  test('the pane line is one row under the header, counted in the height, and fits narrow widths', async ($, on) => {
    const rig = createRig(on)
    const withMarker = staleView(40)
    expect(paneRowCount(withMarker)).toBeGreaterThanOrEqual(paneRowCount(prView({ checks: [makeCheck()] }, 40)))
    const ui = await rig.pane($, 'terminal', withMarker, handlersFor([]))
    const rows = (await textOf(ui)).split('\n')
    const at = rows.findIndex((row) => row.startsWith('showing last data'))
    expect(at).toBeGreaterThan(0)
    expect(rows[at - 1]).toContain('refreshed')
    for (const row of rows) expect(cellWidth(row)).toBeLessThanOrEqual(40)
  })

  test('the no-data error draws the friendly line in band and pane', async ($, on) => {
    const rig = createRig(on)
    const error: Snapshot = { kind: 'error', at: '2026-01-01T00:09:50Z', message: 'gh: HTTP 504', location: makeLocation(), problem: { reason: '504', since: '2026-01-01T00:09:50Z', triedAt: '2026-01-01T00:09:50Z', retryInMs: 15_000 } }
    for (const surface of SURFACES) {
      const band = await rig.band($, surface, viewFor(error, 80), handlersFor([]))
      expect(await textOf(band)).toBe('GitHub is having trouble (504), retrying in 5 s')
      const pane = await rig.pane($, surface, viewFor(error, 80), handlersFor([]))
      expect(await textOf(pane)).toContain('GitHub is having trouble (504), retrying in 5 s')
      await band.unmount()
      await pane.unmount()
    }
  })
})

describe('sortChecks', () => {
  test('puts required first, then failed, running, queued, passed, checks that did not run last, and drops stale', () => {
    const checks: Check[] = [
      makeCheck({ name: 'ok-optional' }),
      makeCheck({ name: 'queued-optional', state: 'queued' }),
      makeCheck({ name: 'failed-optional', state: 'failure' }),
      makeCheck({ name: 'ok-required', isRequired: true }),
      makeCheck({ name: 'running-required', isRequired: true, state: 'running' }),
      makeCheck({ name: 'failed-required', isRequired: true, state: 'failure' }),
      makeCheck({ name: 'old', state: 'stale' }),
      makeCheck({ name: 'running-optional', state: 'running' }),
      makeCheck({ name: 'skipped-early', state: 'skipped' }),
      makeCheck({ name: 'ok-late' }),
      makeCheck({ name: 'neutral-optional', state: 'neutral' }),
    ]
    expect(sortChecks(checks).map((check) => check.name)).toEqual([
      'failed-required',
      'running-required',
      'ok-required',
      'failed-optional',
      'running-optional',
      'queued-optional',
      'ok-optional',
      'ok-late',
      'skipped-early',
      'neutral-optional',
    ])
  })
})

// Rendering through the kit: a test hook beneath the plugin draws with the surface's real
// element table, so these tests do not depend on how register.tsx wires its own hooks.

type Calls = string[]

function handlersFor(calls: Calls, extra: Partial<Handlers> = {}): Handlers {
  return {
    refresh: () => void calls.push('refresh'),
    openPane: () => void calls.push('openPane'),
    closePane: () => void calls.push('closePane'),
    openOnGitHub: () => void calls.push('openOnGitHub'),
    copyUrl: () => void calls.push('copyUrl'),
    openUrl: (url) => void calls.push(`openUrl ${url}`),
    confirmPending: (isSecondStep) => void calls.push(`confirmPending ${String(isSecondStep)}`),
    cancelPending: () => void calls.push('cancelPending'),
    selectMethod: (method) => void calls.push(`selectMethod ${method}`),
    ...extra,
  }
}

function viewFor(snapshot: Snapshot, columns: number, jobs: JobDetail[] = [], lastSeenAt: string | null = null): View {
  const status = snapshot.kind === 'pr' ? deriveStatus(snapshot.pr, snapshot.account.login, lastSeenAt) : null
  return { snapshot, status, jobs, nowMs: NOW, columns, palette: PALETTES.claude, outcome: null, pending: null }
}

function prView(overrides: Partial<PullRequest>, columns: number, jobs: JobDetail[] = [], lastSeenAt: string | null = null): View {
  return viewFor(makeSnapshot(makePr(overrides)), columns, jobs, lastSeenAt)
}

type Surface = (typeof SURFACES)[number]
type Mounted = Pick<MountedOf<Surface, 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'select' | 'input' | 'unmount'>
type Current = { view: View; handlers: Handlers }

/** Registers one hook per component, once, before the test first touches `$`; each draw sets what they render. */
function createRig(on: On) {
  let band: Current | null = null
  let pane: Current | null = null
  let serial = 0
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (band === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return renderBand($.ui.resolve(e), band.view, band.handlers) ?? next(e)
  })
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (pane === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return renderPane($.ui.resolve(e), pane.view, pane.handlers)
  })
  return {
    band($: Engine, surface: Surface, view: View, handlers: Handlers): Promise<Mounted> {
      band = { view: { ...view, surface }, handlers }
      const props = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: view.columns, scroll: { bodyRows: 6 }, view: {} }
      return $.ui.mount({ plugin: 'test', surface, component: 'AbovePrompt', requestId: `band-${(serial += 1)}`, props: props as never })
    },
    pane($: Engine, surface: Surface, view: View, handlers: Handlers): Promise<Mounted> {
      pane = { view: { ...view, surface }, handlers }
      const props = { title: 'PR', isFocused: true, bodyColumns: view.columns, placement: 'inline' }
      return $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: `pane-${(serial += 1)}`, props: props as never })
    },
  }
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Text a tree draws, one string per row, laid out the way the terminal would. */
function rowsOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  const element = node as Node
  const props = element.props ?? {}
  const children = element.children ?? []
  if (element.type === 'Button' || element.type === 'Link') {
    const text = children.length > 0 ? children.flatMap(rowsOf).join('') : String(props.label ?? '')
    return [props.hotkey !== undefined && props.plain === true ? `${String(props.hotkey)}: ${text}` : text]
  }
  const parts = children.map((child) => {
    const margin = Number((child as Node).props?.marginLeft ?? 0)
    return rowsOf(child).map((line) => ' '.repeat(margin) + line)
  })
  if (props.flexDirection === 'column') return parts.flat()
  const gap = Number(props.columnGap ?? props.gap ?? 0)
  return [parts.map((lines) => lines.join('\n')).join(' '.repeat(gap))]
}

const textOf = async (ui: Mounted): Promise<string> => rowsOf(await ui.drawn()).join('\n')

const hotkeysOf = (buttons: { props: Record<string, unknown> }[]) => buttons.flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))

const failedRequired = makeCheck({ name: 'lint', state: 'failure', isRequired: true, url: 'https://ci/lint' })

describe('renderBand', () => {
  test('draws a ready PR on every surface', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.band($, surface, prView({ checks: [makeCheck(), makeCheck({ name: 'test' })], reviews: [{ author: 'anna', state: 'approved', submittedAt: '2026-01-01T00:00:00Z' }] }, 120), handlersFor([]))
      const text = await textOf(ui)
      expect(text).toContain('PR #42')
      expect(text).toContain('✓ 2 checks')
      expect(text).toContain('✓ @anna')
      expect(text).toContain('ready to merge')
      expect(text).toContain('@me')
      if (surface === 'desktop') expect(await ui.find({ type: 'Link' })).toBeDefined()
      else expect(await ui.find({ type: 'Link' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('shows running progress with elapsed time', async ($, on) => {
    const rig = createRig(on)
    const checks = [makeCheck({ name: 'a', state: 'running', isRequired: true, startedAt: '2026-01-01T00:07:46Z' }), makeCheck({ name: 'b' }), makeCheck({ name: 'c' })]
    const ui = await rig.band($, 'terminal', prView({ checks }, 120), handlersFor([]))
    expect(await textOf(ui)).toContain('● 1/3 running 2:14')
    expect(await textOf(ui)).toContain('checks running')
  })

  test('blocked PR: failed required check, review, threads and a second line', async ($, on) => {
    const rig = createRig(on)
    const view = prView(
      {
        checks: [failedRequired, makeCheck({ name: 'build', state: 'running', startedAt: '2026-01-01T00:09:00Z' })],
        reviewDecision: 'review-required',
        mergeStateStatus: 'blocked',
        reviewRequests: [{ reviewer: 'ben', isTeam: false }],
        threads: [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: { author: 'ben', createdAt: '2026-01-01T00:09:30Z', editedAt: null, url: 'https://x/c' } }],
      },
      160,
      [],
      '2026-01-01T00:00:00Z',
    )
    for (const surface of SURFACES) {
      const ui = await rig.band($, surface, view, handlersFor([]))
      const text = await textOf(ui)
      expect(text).toContain('✗ lint failed (required), 1 running')
      expect(text).toContain('◷ @ben')
      expect(text).toContain('💬 1 unresolved, 1 new')
      expect(text).toContain('blocked: review required: @ben')
      expect(text.match(/lint/g)).toHaveLength(1)
      expect(rowsOf(await ui.drawn())).toHaveLength(1)
      await ui.unmount()
    }
  })

  test('changes requested shows the reviewer', async ($, on) => {
    const rig = createRig(on)
    const reviews = [{ author: 'x', state: 'changes-requested' as const, submittedAt: '2026-01-01T00:00:00Z' }]
    const ui = await rig.band($, 'terminal', prView({ reviews, reviewDecision: 'changes-requested', mergeStateStatus: 'blocked' }, 120), handlersFor([]))
    expect(await textOf(ui)).toContain('✗ @x')
  })

  test('never exceeds the columns at 40, 80 and 160', async ($, on) => {
    const rig = createRig(on)
    const view = (columns: number) =>
      prView(
        {
          title: 'a very long title',
          checks: [failedRequired, makeCheck({ name: 'build', state: 'running', startedAt: '2026-01-01T00:09:00Z' })],
          reviewDecision: 'review-required',
          mergeStateStatus: 'blocked',
          reviewRequests: [{ reviewer: 'someone-with-a-long-login', isTeam: false }],
          threads: [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: { author: 'ben', createdAt: '2026-01-01T00:09:30Z', editedAt: null, url: 'https://x/c' } }],
        },
        columns,
      )
    const handlers = handlersFor([], { ciToClaude: () => {}, requestMerge: () => {}, requestEnqueue: () => {} })
    for (const columns of [20, 40, 80, 160]) {
      for (const surface of SURFACES) {
        const ui = await rig.band($, surface, view(columns), handlers)
        for (const row of rowsOf(await ui.drawn())) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
        expect(await textOf(ui)).toContain('PR #42')
        await ui.unmount()
      }
    }
  })

  test('buttons: details and github always, the rest only when possible', async ($, on) => {
    const rig = createRig(on)
    const plain = await rig.band($, 'terminal', prView({ checks: [failedRequired] }, 160), handlersFor([]))
    expect(hotkeysOf(await plain.findAll({ type: 'Button' }))).toEqual(['d', 'o'])

    const all = handlersFor([], { ciToClaude: () => {}, requestMerge: () => {}, requestEnqueue: () => {} })
    const failing = await rig.band($, 'terminal', prView({ checks: [failedRequired], isMergeQueueEnabled: true }, 160), all)
    expect(hotkeysOf(await failing.findAll({ type: 'Button' }))).toEqual(['d', 'o', 'f', 'q'])

    const ready = await rig.band($, 'desktop', prView({ checks: [makeCheck()], isMergeQueueEnabled: true }, 160), all)
    // a merge queue hides the plain merge: gh would enqueue instead
    expect(hotkeysOf(await ready.findAll({ type: 'Button' }))).toEqual(['d', 'o', 'q'])

    const noQueue = await rig.band($, 'desktop', prView({ checks: [makeCheck()] }, 160), all)
    expect(hotkeysOf(await noQueue.findAll({ type: 'Button' }))).toEqual(['d', 'o', 'm'])
  })

  test('every button has a key and a lowercase single-character hotkey', async ($, on) => {
    const rig = createRig(on)
    const handlers = handlersFor([], { ciToClaude: () => {}, requestMerge: () => {}, requestEnqueue: () => {} })
    const ui = await rig.band($, 'terminal', prView({ checks: [failedRequired], isMergeQueueEnabled: true }, 160), handlers)
    const buttons = (await ui.findAll({ type: 'Button' })).filter((button) => button.props.hotkey !== undefined)
    expect(new Set(buttons.map((button) => button.key)).size).toBe(buttons.length)
    for (const button of buttons) {
      expect(button.key).toBeDefined()
      expect(String(button.props.hotkey)).toMatch(/^[a-z0-9]$/)
    }
  })

  test('pressing a button calls only its handler', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const ui = await rig.band($, 'terminal', prView({}, 120), handlersFor(calls))
    await ui.press({ key: 'band-details' })
    await ui.press({ key: 'band-github' })
    expect(calls).toEqual(['openPane', 'openOnGitHub'])
  })

  test('queued and auto-merge verdicts', async ($, on) => {
    const rig = createRig(on)
    const queued = await rig.band($, 'terminal', prView({ isInMergeQueue: true, mergeQueueEntry: { position: 2, state: 'queued', estimatedTimeToMerge: null, checks: [] } }, 120), handlersFor([]))
    expect(await textOf(queued)).toContain('in merge queue #2 · queued')
    const auto = await rig.band($, 'terminal', prView({ autoMerge: { method: 'squash', enabledAt: '2026-01-01T00:00:00Z' }, mergeStateStatus: 'blocked', reviewDecision: 'review-required' }, 160), handlersFor([]))
    expect(await textOf(auto)).toContain('auto-merge on')
  })

  test('merged and closed PRs are one dim line with a link', async ($, on) => {
    const rig = createRig(on)
    for (const state of ['merged', 'closed'] as const) {
      const ui = await rig.band($, 'terminal', prView({ state }, 80), handlersFor([]))
      expect((await textOf(ui)).replace(/\s+/g, ' ')).toBe(`PR #42 ${state} `)
      expect(await ui.find({ type: 'Button' })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter((button) => button.props.hotkey !== undefined)).toHaveLength(0)
    }
  })

  test('no PR: dim line with the account', async ($, on) => {
    const rig = createRig(on)
    const snapshot: Snapshot = { kind: 'no-pr', at: '2026-01-01T00:00:00Z', location: makeLocation(), account: { login: 'me', source: 'active' } }
    const ui = await rig.band($, 'terminal', viewFor(snapshot, 80), handlersFor([]))
    expect(await textOf(ui)).toBe('no PR for feat/things · @me')
  })

  test('no account and error speak in one line', async ($, on) => {
    const rig = createRig(on)
    const at = '2026-01-01T00:00:00Z'
    const noAccount: Snapshot = { kind: 'no-account', at, location: makeLocation(), failure: { kind: 'no-access', tried: ['a', 'b'] } }
    const ui = await rig.band($, 'terminal', viewFor(noAccount, 120), handlersFor([]))
    expect(await textOf(ui)).toBe('gh-status: no gh account can read acme/app (tried a, b)')
    const error: Snapshot = { kind: 'error', at, message: 'network down', location: null }
    const errorUi = await rig.band($, 'desktop', viewFor(error, 120), handlersFor([]))
    expect(await textOf(errorUi)).toBe('gh-status: network down')
  })

  test('returns null for those snapshots with a real table', async ($, on) => {
    const at = '2026-01-01T00:00:00Z'
    const results: (RenderElement | null)[] = []
    on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
      const table = $.ui.resolve(e)
      for (const snapshot of [{ kind: 'loading', at }, { kind: 'detached', at, location: makeLocation({ branch: null }) }] as Snapshot[]) {
        results.push(renderBand(table, viewFor(snapshot, 80), handlersFor([])))
      }
      return next(e)
    })
    const props = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { bodyRows: 6 }, view: {} }
    try {
      await $.ui.mount({ plugin: 'test', surface: 'terminal', component: 'AbovePrompt', props: props as never })
    } catch {
      // nothing beneath answers when every snapshot is null; that is the point
    }
    expect(results).toEqual([null, null])
  })
})

describe('renderPane', () => {
  const jobs: JobDetail[] = [
    { jobId: 7, runId: 70, name: 'build', state: 'running', currentStep: 'Run tests', failedStep: null, url: null },
    { jobId: 8, runId: 70, name: 'lint', state: 'failure', currentStep: null, failedStep: 'eslint', url: null },
  ]
  const blocked = (columns: number) =>
    prView(
      {
        title: 'add things',
        checks: [
          makeCheck({ name: 'build', state: 'running', isRequired: true, startedAt: '2026-01-01T00:07:46Z', url: 'https://ci/build', jobId: 7, runId: 70 }),
          { ...failedRequired, jobId: 8, runId: 70, startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:05Z' },
          makeCheck({ name: 'docs', url: null }),
          makeCheck({ name: 'e2e', state: 'queued' }),
        ],
        reviews: [{ author: 'anna', state: 'approved', submittedAt: '2026-01-01T00:00:00Z' }],
        reviewDecision: 'review-required',
        mergeStateStatus: 'blocked',
        reviewRequests: [{ reviewer: 'ben', isTeam: false }, { reviewer: 'acme/core', isTeam: true }],
        viewerCanMergeAsAdmin: true,
        lastComment: { author: 'ben', createdAt: '2026-01-01T00:06:00Z', editedAt: null, url: 'https://x/last' },
        threads: [
          { isResolved: false, isOutdated: false, path: 'src/ui/band.tsx', line: 12, last: { author: 'ben', createdAt: '2026-01-01T00:06:00Z', editedAt: null, url: 'https://x/t1' } },
          { isResolved: false, isOutdated: true, path: 'old.ts', line: 3, last: { author: 'ben', createdAt: '2025-12-30T00:06:00Z', editedAt: null, url: 'https://x/t2' } },
        ],
      },
      columns,
      jobs,
    )

  test('draws all sections for a blocked PR with a running pipeline', async ($, on) => {
    const rig = createRig(on)
    const handlers = handlersFor([], { requestMerge: () => {}, requestEnqueue: () => {}, requestAutoMerge: () => {}, requestAdminMerge: () => {}, ciToClaude: () => {} })
    for (const surface of SURFACES) {
      const ui = await rig.pane($, surface, blocked(80), handlers)
      const text = await textOf(ui)
      for (const expected of [
        'PR #42 add things',
        'feat/things → main',
        '@me (active)',
        'abcdef0',
        '── Merge',
        'blocked',
        '• ',
        'admin merge available',
        '── Pipeline',
        '✗ pipeline failed · lint',
        '✗ lint [required] 1:05',
        '✗ eslint',
        '● build [required] 2:14',
        '▸ Run tests',
        '◷ e2e',
        '── Reviews',
        '✓ @anna approved',
        '◷ @ben requested',
        '◷ acme/core requested',
        '── Conversation',
        '💬 src/ui/band.tsx:12 @ben 4 min ago',
        '1 outdated thread',
        'Last comment @ben 4 min ago',
      ]) {
        expect(text).toContain(expected)
      }
      await ui.unmount()
    }
  })

  test('required checks come before optional ones in the pipeline', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.pane($, 'terminal', blocked(80), handlersFor([]))
    const text = await textOf(ui)
    expect(text.indexOf('✗ lint')).toBeLessThan(text.indexOf('◷ e2e'))
    expect(text.indexOf('● build')).toBeLessThan(text.indexOf('– docs') === -1 ? text.indexOf('✓ docs') : text.indexOf('– docs'))
  })

  test('check rows with a url are plain keyed buttons, others are text', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const ui = await rig.pane($, 'terminal', blocked(80), handlersFor(calls))
    const checkButtons = (await ui.findAll({ type: 'Button' })).filter((button) => String(button.key).startsWith('check-'))
    expect(checkButtons.map((button) => button.key)).toEqual(['check-0', 'check-1'])
    await ui.press({ key: 'check-0' })
    expect(calls).toEqual(['openUrl https://ci/lint'])
    expect(await ui.find({ type: 'Text', text: /docs/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).some((button) => /docs/.test(button.text))).toBe(false)
  })

  test('thread and last comment rows open their url', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const ui = await rig.pane($, 'desktop', blocked(80), handlersFor(calls))
    await ui.press({ key: 'thread-0' })
    await ui.press({ key: 'last-comment' })
    expect(calls).toEqual(['openUrl https://x/t1', 'openUrl https://x/last'])
  })

  test('action buttons appear only for existing handlers', async ($, on) => {
    const rig = createRig(on)
    const hotkeys = async (handlers: Handlers, view: View) => {
      const ui = await rig.pane($, 'terminal', view, handlers)
      return (await ui.findAll({ type: 'Button' })).flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))
    }
    expect(await hotkeys(handlersFor([]), blocked(80))).toEqual(['o', 'c', 'r'])
    const all = handlersFor([], { requestMerge: () => {}, requestEnqueue: () => {}, requestDequeue: () => {}, requestAutoMerge: () => {}, requestAdminMerge: () => {}, ciToClaude: () => {} })
    expect(await hotkeys(all, blocked(80))).toEqual(['a', 'x', 'o', 'c', 'r', 'f'])
    const ready = prView({ checks: [makeCheck()], isMergeQueueEnabled: true }, 80)
    expect(await hotkeys(all, ready)).toEqual(['q', 'o', 'c', 'r'])
    const plainReady = prView({ checks: [makeCheck()] }, 80)
    expect(await hotkeys(all, plainReady)).toEqual(['m', 'o', 'c', 'r'])
    const queued = prView({ isInMergeQueue: true, mergeQueueEntry: { position: 1, state: 'awaiting-checks', estimatedTimeToMerge: 300, checks: [] } }, 80)
    expect(await hotkeys(all, queued)).toEqual(['q', 'o', 'c', 'r'])
  })

  test('merge queue entry and auto-merge are spelled out', async ($, on) => {
    const rig = createRig(on)
    const view = prView({ isInMergeQueue: true, mergeQueueEntry: { position: 3, state: 'awaiting-checks', estimatedTimeToMerge: 300, checks: [] }, autoMerge: { method: 'squash', enabledAt: '2026-01-01T00:07:00Z' } }, 100)
    const text = await textOf(await rig.pane($, 'terminal', view, handlersFor([], { requestDequeue: () => {} })))
    expect(text).toContain('in merge queue #3 · waiting for checks · ~5 min')
    expect(text).toContain('Auto-merge on (squash) since 3 min ago')
  })

  test('buttons call their handlers', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const ui = await rig.pane($, 'terminal', blocked(80), handlersFor(calls))
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'copy' })
    await ui.press({ key: 'github' })
    expect(calls).toEqual(['refresh', 'copyUrl', 'openOnGitHub'])
  })

  test('never exceeds the columns, also for long names', async ($, on) => {
    const rig = createRig(on)
    const long = 'a-very-long-check-name-that-keeps-going-and-going-and-going-and-going'
    const view = (columns: number) => {
      const base = blocked(columns)
      const snapshot = base.snapshot
      if (snapshot.kind !== 'pr') throw new Error('expected a pr')
      const pr = { ...snapshot.pr, title: long + long, checks: [...snapshot.pr.checks, makeCheck({ name: long, url: 'https://ci/x' })] }
      return viewFor({ ...snapshot, pr }, columns, jobs)
    }
    const handlers = handlersFor([], { requestMerge: () => {}, requestEnqueue: () => {}, requestAutoMerge: () => {}, requestAdminMerge: () => {}, ciToClaude: () => {} })
    for (const columns of [40, 80, 160]) {
      for (const surface of SURFACES) {
        const ui = await rig.pane($, surface, view(columns), handlers)
        for (const row of rowsOf(await ui.drawn())) {
          // button rows wrap, so measure each button on its own
          for (const piece of row.split('  ')) expect(cellWidth(piece)).toBeLessThanOrEqual(columns)
        }
        await ui.unmount()
      }
    }
  })

  test('edited comments read "edited" relative to the edit time, in rows and the last comment line', async ($, on) => {
    const rig = createRig(on)
    const view = prView(
      {
        lastComment: { author: 'bot', createdAt: '2026-01-01T00:00:00Z', editedAt: '2026-01-01T00:08:00Z', url: 'https://x/last' },
        threads: [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: { author: 'bot', createdAt: '2026-01-01T00:00:00Z', editedAt: '2026-01-01T00:08:00Z', url: 'https://x/t1' } }],
      },
      80,
    )
    const text = await textOf(await rig.pane($, 'terminal', view, handlersFor([])))
    expect(text).toContain('💬 a.ts:1 @bot edited 2 min ago')
    expect(text).toContain('Last comment @bot edited 2 min ago')
  })

  test('summarizes new activity since the last look', async ($, on) => {
    const rig = createRig(on)
    const view = prView({ lastComment: { author: 'ben', createdAt: '2026-01-01T00:06:00Z', editedAt: null, url: 'https://x/last' } }, 80, [], '2026-01-01T00:00:00Z')
    const text = await textOf(await rig.pane($, 'terminal', view, handlersFor([])))
    expect(text).toContain('1 new since you looked')
  })

  test('an empty PR says so plainly', async ($, on) => {
    const rig = createRig(on)
    const text = await textOf(await rig.pane($, 'terminal', prView({}, 80), handlersFor([])))
    expect(text).toContain('no checks reported')
    expect(text).toContain('no reviews yet')
    expect(text).toContain('no unresolved threads')
    expect(text).toContain('no comments yet')
  })

  test('explains every snapshot that holds no PR', async ($, on) => {
    const rig = createRig(on)
    const at = '2026-01-01T00:00:00Z'
    const snapshots: [Snapshot, string][] = [
      [{ kind: 'loading', at }, 'Loading'],
      [{ kind: 'not-a-repo', at, cwd: '/x' }, 'not a git repository'],
      [{ kind: 'no-github-remote', at, location: makeLocation({ owner: null, repo: null }) }, 'no GitHub remote'],
      [{ kind: 'detached', at, location: makeLocation({ branch: null }) }, 'detached'],
      [{ kind: 'no-pr', at, location: makeLocation(), account: { login: 'me', source: 'active' } }, 'no PR for feat/things'],
      [{ kind: 'error', at, message: 'boom', location: null }, 'boom'],
    ]
    for (const [snapshot, expected] of snapshots) {
      const ui = await rig.pane($, 'terminal', viewFor(snapshot, 80), handlersFor([]))
      expect(await textOf(ui)).toContain(expected)
    }
  })
})

describe('the band while an action is pending', () => {
  const green = (): { view: View; pending: PendingAction } => {
    const view = prView({ checks: [makeCheck()] }, 120)
    const pending = buildPending('merge', view.snapshot)
    if (pending === null) throw new Error('merge is not offered')
    return { view, pending }
  }

  for (const surface of SURFACES) {
    test(`replaces its buttons with the confirm controls on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: string[] = []
      const { view, pending } = green()
      const ui = await rig.band($, surface, { ...view, pending }, handlersFor(calls))
      const text = await textOf(ui)
      expect(text).toContain('merge #42 (squash)?')
      expect(text).toContain('y: confirm')
      expect(text).toContain('n: cancel')
      expect(text).not.toContain('details')
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
      await ui.press({ key: 'band-confirm' })
      await ui.press({ key: 'band-cancel' })
      expect(calls).toEqual(['confirmPending false', 'cancelPending'])
      await ui.unmount()
    })
  }

  test('admin step 2 asks in the failure color and confirms with b as the second step', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const { view, pending } = green()
    const admin = buildPending('admin-merge', view.snapshot)
    if (admin === null || admin.kind !== 'admin-merge') {
      // A green PR offers no admin merge: build the second step from a plain pending shape.
      const second: PendingAction = { ...pending, kind: 'admin-merge', bypassed: [], isSecondStep: true } as unknown as PendingAction
      const ui = await rig.band($, 'terminal', { ...view, pending: second }, handlersFor(calls))
      expect(await textOf(ui)).toContain('bypass rules and merge #42?')
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['b', 'n'])
      await ui.press({ key: 'band-confirm' })
      expect(calls).toEqual(['confirmPending true'])
      return
    }
    throw new Error('expected no admin merge on a green PR')
  })

  test('shows the normal buttons when nothing is pending', async ($, on) => {
    const rig = createRig(on)
    const { view } = green()
    const ui = await rig.band($, 'terminal', view, handlersFor([]))
    expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toContain('d')
    expect(await ui.find({ key: 'band-confirm' })).toBeUndefined()
  })
})

describe('band layout', () => {
  const LONG_URL = 'https://github.com/Example-Enterprise-Platform/a-very-long-repository-name-indeed/pull/1016'
  const longView = (columns: number, overrides: Partial<PullRequest> = {}): View => {
    const snapshot = makeSnapshot(makePr({ number: 1016, url: LONG_URL, checks: [makeCheck({ name: 'a-rather-long-check-name', state: 'running', startedAt: '2026-01-01T00:09:00Z' }), makeCheck()], ...overrides }))
    const login = 'someone-with-a-very-long-login_suffix'
    if (snapshot.kind !== 'pr') throw new Error('expected a pr snapshot')
    return viewFor({ ...snapshot, account: { login, source: 'active' } }, columns)
  }

  test('is exactly one row of non-shrinking cells at 80 and 140 columns', async ($, on) => {
    const rig = createRig(on)
    const handlers = handlersFor([], { ciToClaude: () => {}, requestMerge: () => {}, requestEnqueue: () => {} })
    for (const columns of [80, 140]) {
      for (const surface of SURFACES) {
        const ui = await rig.band($, surface, longView(columns), handlers)
        const rows = rowsOf(await ui.drawn())
        expect(rows).toHaveLength(1)
        expect(cellWidth(rows[0] ?? '')).toBeLessThanOrEqual(columns)
        expect(rows[0]).not.toContain('https://')
        const root = (await ui.drawn()) as Node
        const row = (root.children ?? [])[0] as Node
        expect(row.props?.flexWrap).toBe('nowrap')
        for (const child of row.children ?? []) expect((child as Node).props?.flexShrink).toBe(0)
        await ui.unmount()
      }
    }
  })

  test('the PR reference shows its label, never the URL', async ($, on) => {
    const rig = createRig(on)
    const desktop = await rig.band($, 'desktop', longView(140), handlersFor([]))
    const link = await desktop.find({ type: 'Link' })
    expect(link?.props.label).toBe('PR #1016')
    expect(link?.props.href).toBe(LONG_URL)
    const calls: Calls = []
    const terminal = await rig.band($, 'terminal', longView(140), handlersFor(calls))
    expect(await terminal.find({ type: 'Link' })).toBeUndefined()
    const anchor = await terminal.find({ type: 'Button', text: /PR #1016/ })
    expect(anchor?.props.label).toBe('PR #1016')
    await terminal.press({ key: 'pr-anchor' })
    expect(calls).toEqual(['openOnGitHub'])
  })

  test('buttons are separated by a gap', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.band($, 'terminal', longView(140), handlersFor([]))
    const text = await textOf(ui)
    expect(text).toContain('d: details o: github')
    expect(text).not.toContain('detailso:')
  })

  test('in the merge queue the verdict and the pipeline speak of the queue', async ($, on) => {
    const rig = createRig(on)
    const checks = [makeCheck({ name: 'a', state: 'running' }), makeCheck({ name: 'b', state: 'running' }), makeCheck({ name: 'c' })]
    const entry = { position: 1, state: 'awaiting-checks' as const, estimatedTimeToMerge: 240, checks }
    const ui = await rig.band($, 'terminal', prView({ isInMergeQueue: true, mergeQueueEntry: entry, checks: [makeCheck()] }, 140), handlersFor([]))
    const text = await textOf(ui)
    expect(text).toContain('in merge queue #1 · waiting for checks')
    expect(text).toContain('● queue 2/3 running')
    expect(text).not.toContain('✓ 1 checks')
    const red = { ...entry, checks: [makeCheck({ name: 'unit', state: 'failure' })] }
    const redUi = await rig.band($, 'terminal', prView({ isInMergeQueue: true, mergeQueueEntry: red }, 140), handlersFor([]))
    expect(await textOf(redUi)).toContain('✗ queue unit failed')
  })

  test('a failed required check is named once', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.band($, 'terminal', prView({ checks: [failedRequired], mergeStateStatus: 'blocked' }, 140), handlersFor([]))
    const text = await textOf(ui)
    expect(text.match(/lint/g)).toHaveLength(1)
    expect(text).toContain('blocked · ✗ lint failed (required)')
  })
})

describe('pane merge queue and check lists', () => {
  const queueView = (checks: Check[], columns = 100) =>
    prView({ isInMergeQueue: true, mergeQueueEntry: { position: 1, state: 'awaiting-checks', estimatedTimeToMerge: 240, checks }, checks: [makeCheck({ name: 'head-lint' })] }, columns)

  test('one queue line, and the verdict is not repeated', async ($, on) => {
    const rig = createRig(on)
    const text = await textOf(await rig.pane($, 'terminal', queueView([]), handlersFor([])))
    expect(text).toContain('in merge queue #1 · waiting for checks · ~4 min')
    expect(text.match(/in merge queue/g)).toHaveLength(1)
    expect(text).not.toContain('ETA')
  })

  test('merge queue checks come above the pipeline, running and failed first, skipped collapsed', async ($, on) => {
    const rig = createRig(on)
    const checks = [
      makeCheck({ name: 'passing', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' }),
      makeCheck({ name: 'skip-a', state: 'skipped', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:00Z' }),
      makeCheck({ name: 'skip-b', state: 'neutral' }),
      makeCheck({ name: 'cancel-never-ran', state: 'cancelled' }),
      makeCheck({ name: 'waiting', state: 'queued', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:00Z' }),
      makeCheck({ name: 'busy', state: 'running', startedAt: '2026-01-01T00:07:46Z' }),
      makeCheck({ name: 'broken', state: 'failure', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:02:00Z' }),
    ]
    const text = await textOf(await rig.pane($, 'terminal', queueView(checks), handlersFor([])))
    expect(text.indexOf('Merge queue checks')).toBeGreaterThan(-1)
    expect(text.indexOf('Merge queue checks')).toBeLessThan(text.indexOf('── Pipeline'))
    const section = text.slice(text.indexOf('Merge queue checks'), text.indexOf('── Pipeline'))
    expect(section.indexOf('broken')).toBeLessThan(section.indexOf('busy'))
    expect(section.indexOf('busy')).toBeLessThan(section.indexOf('waiting'))
    expect(section.indexOf('waiting')).toBeLessThan(section.indexOf('passing'))
    for (const name of ['skip-a', 'skip-b', 'cancel-never-ran']) expect(section).toContain(name)
    expect(section).toContain('✗ pipeline failed · cancel-never-ran, broken')
    expect(section).not.toContain('0s')
    expect(section).toContain('busy 2:14')
  })

  test('no queue section outside the queue; skipped checks are listed in the pipeline too', async ($, on) => {
    const rig = createRig(on)
    const checks = [makeCheck({ name: 'ok' }), makeCheck({ name: 'skip-a', state: 'skipped' }), makeCheck({ name: 'skip-b', state: 'skipped' })]
    const text = await textOf(await rig.pane($, 'terminal', prView({ checks }, 100), handlersFor([])))
    expect(text).not.toContain('Merge queue checks')
    expect(text).toContain('skip-a')
    expect(text).toContain('skip-b')
    expect(text).toContain('✓ pipeline passed · 1 passed · 2 skipped')
  })

  test('the header has the title once, truncated to one line, and no URL line', async ($, on) => {
    const rig = createRig(on)
    const title = 'a very long pull request title that goes on and on and on and on and on'
    for (const surface of SURFACES) {
      const ui = await rig.pane($, surface, prView({ title }, 40), handlersFor([]))
      const rows = rowsOf(await ui.drawn())
      expect(rows[0]).toContain('PR #42 a very long')
      expect(cellWidth(rows[0] ?? '')).toBeLessThanOrEqual(40)
      expect(rows.join('\n')).not.toContain('https://')
      await ui.unmount()
    }
  })
})

/** Every node of a drawn tree, depth first. */
function nodesOfTree(node: unknown): Node[] {
  if (typeof node !== 'object' || node === null) return []
  const element = node as Node
  return [element, ...(element.children ?? []).flatMap(nodesOfTree)]
}

const withPalette = (view: View, palette: Palette): View => ({ ...view, palette })
const paletteNames = ['claude', 'github'] as const

describe('badge and review colors', () => {
  const states: [Partial<PullRequest>, string, keyof Palette][] = [
    [{}, 'open', 'badgeOpen'],
    [{ isDraft: true }, 'draft', 'badgeDraft'],
    [{ state: 'merged' }, 'merged', 'badgeMerged'],
    [{ state: 'closed' }, 'closed', 'badgeClosed'],
    [{ isInMergeQueue: true }, 'queued', 'badgeQueued'],
  ]

  test('prBadge words', () => {
    for (const [overrides, text] of states) expect(prBadge(makePr(overrides)).text).toBe(text)
  })

  test('band and pane badge: padded text, bold, palette colors, on both surfaces', async ($, on) => {
    const rig = createRig(on)
    for (const name of paletteNames) {
      const palette = PALETTES[name]
      for (const [overrides, text, key] of states) {
        for (const surface of SURFACES) {
          const view = withPalette(prView(overrides, 120), palette)
          for (const ui of [await rig.band($, surface, view, handlersFor([])), await rig.pane($, surface, view, handlersFor([]))]) {
            const badge = nodesOfTree(await ui.drawn()).find((node) => node.props?.backgroundColor !== undefined)
            expect(badge?.children).toEqual([` ${text} `])
            expect(badge?.props).toMatchObject({ backgroundColor: palette[key], color: palette.badgeText, bold: true })
            expect(badgeBackground(palette, prBadge(makePr(overrides)).text)).toBe(palette[key])
            await ui.unmount()
          }
        }
      }
    }
  })

  test('reviews are colored in band and pane', async ($, on) => {
    const rig = createRig(on)
    const reviews = [
      { author: 'anna', state: 'approved' as const, submittedAt: '2026-01-01T00:00:00Z' },
      { author: 'x', state: 'changes-requested' as const, submittedAt: '2026-01-01T00:01:00Z' },
    ]
    const view = withPalette(prView({ reviews, reviewRequests: [{ reviewer: 'ben', isTeam: false }], reviewDecision: 'changes-requested' }, 160), PALETTES.github)
    const colorOf = async (ui: Mounted, text: string) => nodesOfTree(await ui.drawn()).find((node) => node.children?.includes(text))?.props?.color
    const band = await rig.band($, 'terminal', view, handlersFor([]))
    expect(await colorOf(band, '✓ @anna')).toBe('#3fb950')
    expect(await colorOf(band, '✗ @x')).toBe('#f85149')
    expect(await colorOf(band, '◷ @ben')).toBe('#d29922')
    const pane = await rig.pane($, 'terminal', view, handlersFor([]))
    expect(await colorOf(pane, '✓ @anna approved')).toBe('#3fb950')
    expect(await colorOf(pane, '✗ @x requested changes')).toBe('#f85149')
    expect(await colorOf(pane, '◷ @ben requested')).toBe('#d29922')
  })

  test('ready to merge is painted by its caveats on both palettes', async ($, on) => {
    const rig = createRig(on)
    const thread = { isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: null }
    const cases: { overrides: Partial<PullRequest>; text: string; tone: 'success' | 'failure' | 'pending' }[] = [
      { overrides: { checks: [makeCheck()] }, text: 'ready to merge', tone: 'success' },
      { overrides: { checks: [makeCheck({ state: 'failure' }), makeCheck({ state: 'running' })] }, text: '1 check failed', tone: 'failure' },
      { overrides: { checks: [makeCheck({ state: 'running' })] }, text: 'checks running', tone: 'pending' },
      { overrides: { threads: [thread, thread] }, text: '2 unresolved threads', tone: 'pending' },
    ]
    for (const name of paletteNames) {
      const palette = PALETTES[name]
      for (const { overrides, text, tone } of cases) {
        const view = withPalette(prView(overrides, 160), palette)
        const colorOf = async (ui: Mounted, match: string) => nodesOfTree(await ui.drawn()).find((node) => node.children?.some((child) => typeof child === 'string' && child.includes(match)))?.props?.color
        const band = await rig.band($, 'terminal', view, handlersFor([]))
        expect(await textOf(band)).toContain(text === 'ready to merge' ? text : `ready to merge · ${text}`)
        expect(await colorOf(band, 'ready to merge')).toBe(palette[tone])
        if (text !== 'ready to merge') expect(await colorOf(band, text)).toBe(palette[tone])
        const pane = await rig.pane($, 'terminal', view, handlersFor([]))
        expect(await colorOf(pane, 'ready to merge')).toBe(palette[tone])
        expect(await textOf(pane)).toContain(text === 'ready to merge' ? text : `ready to merge · ${text}`)
      }
    }
  })

  test('pane lists every caveat; band drops the caveat before the verdict', async ($, on) => {
    const rig = createRig(on)
    const overrides: Partial<PullRequest> = { checks: [makeCheck({ state: 'failure' }), makeCheck({ state: 'running' })] }
    const pane = await rig.pane($, 'terminal', prView(overrides, 160), handlersFor([]))
    expect(await textOf(pane)).toContain('ready to merge · 1 check failed · checks running')
    for (const columns of [20, 30, 40, 60, 80, 160]) {
      const ui = await rig.band($, 'terminal', prView(overrides, columns), handlersFor([]))
      const text = await textOf(ui)
      for (const row of rowsOf(await ui.drawn())) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      expect(text).toContain('PR #42')
      if (text.includes('1 check failed')) expect(text).toContain('ready to merge')
    }
    const narrow = await textOf(await rig.band($, 'terminal', prView(overrides, 34), handlersFor([])))
    expect(narrow).toContain('ready to merge')
    expect(narrow).not.toContain('failed')
  })

  test('both palettes draw valid trees; claude uses theme keys, github hex', async ($, on) => {
    const rig = createRig(on)
    const checks = [failedRequired, makeCheck({ name: 'build', state: 'running', startedAt: '2026-01-01T00:09:00Z' })]
    for (const name of paletteNames) {
      for (const surface of SURFACES) {
        const view = withPalette(prView({ checks, mergeStateStatus: 'blocked' }, 120), PALETTES[name])
        for (const ui of [await rig.band($, surface, view, handlersFor([])), await rig.pane($, surface, view, handlersFor([]))]) {
          const colors = nodesOfTree(await ui.drawn()).flatMap((node) => [node.props?.color, node.props?.backgroundColor]).filter((value): value is string => typeof value === 'string')
          expect(colors.length).toBeGreaterThan(0)
          for (const color of colors) expect(name === 'github' ? color : color).toMatch(name === 'github' ? /^#[0-9a-f]{6}$/ : /^[a-zA-Z]+$/)
          await ui.unmount()
        }
      }
    }
  })
})

describe('pane order and finished PRs', () => {
  test('header, Merge, Reviews, Conversation, Merge queue checks, Pipeline', async ($, on) => {
    const rig = createRig(on)
    const entry = { position: 1, state: 'queued' as const, estimatedTimeToMerge: null, checks: [makeCheck({ name: 'q1' })] }
    const text = await textOf(await rig.pane($, 'terminal', prView({ isInMergeQueue: true, mergeQueueEntry: entry, checks: [makeCheck()] }, 100), handlersFor([])))
    const order = ['── Merge ─', '── Reviews', '── Conversation', '── Merge queue checks', '── Pipeline'].map((heading) => text.indexOf(heading))
    expect(order.every((index) => index > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('a merged PR: who and when instead of repeating merged, pipeline as a summary only', async ($, on) => {
    const rig = createRig(on)
    const checks = [makeCheck({ name: 'a' }), makeCheck({ name: 'b', state: 'skipped' }), makeCheck({ name: 'c', state: 'skipped' })]
    const merged = await textOf(await rig.pane($, 'terminal', prView({ state: 'merged', mergedBy: 'anna', mergedAt: '2026-01-01T00:07:00Z', checks }, 100), handlersFor([])))
    expect(merged).toContain('merged by @anna · 3 min ago')
    expect(merged.match(/merged/g)).toHaveLength(2) // the badge and the line
    expect(merged).toContain('✓ pipeline passed · 1 passed · 2 skipped')
    for (const name of ['a', 'b', 'c']) expect(merged).toContain(`– ${name}`.replace('– a', '✓ a'))
    const closed = await textOf(await rig.pane($, 'terminal', prView({ state: 'closed', closedAt: '2026-01-01T00:08:00Z', checks }, 100), handlersFor([])))
    expect(closed).toContain('closed · 2 min ago')
  })

  test('skipped rows are dim and carry no duration', async ($, on) => {
    const rig = createRig(on)
    const checks = [makeCheck({ name: 'b', state: 'skipped', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:00Z' })]
    const ui = await rig.pane($, 'terminal', prView({ checks }, 100), handlersFor([]))
    const row = nodesOfTree(await ui.drawn()).find((node) => node.children?.includes('b'))
    expect(row?.props?.dimColor).toBe(true)
    expect(await textOf(ui)).not.toContain('0s')
  })

  test('the pipeline verdict line: running, queued, failed and passed, colored and bold', async ($, on) => {
    const rig = createRig(on)
    const cases: [Check[], string, string][] = [
      [[makeCheck({ name: 'a', state: 'running' }), makeCheck({ name: 'b' }), makeCheck({ name: 'c' })], '● pipeline running · 1 of 3 running', 'pending'],
      [[makeCheck({ name: 'a', state: 'queued' }), makeCheck({ name: 'b' })], '◷ pipeline queued', 'pending'],
      [[makeCheck({ name: 'opt', state: 'failure' }), makeCheck({ name: 'req', state: 'failure', isRequired: true })], '✗ pipeline failed · req, opt', 'failure'],
      [[makeCheck({ name: 'a' }), makeCheck({ name: 'b', state: 'skipped' })], '✓ pipeline passed · 1 passed · 1 skipped', 'success'],
    ]
    for (const [checks, text, key] of cases) {
      const ui = await rig.pane($, 'terminal', withPalette(prView({ checks }, 100), PALETTES.github), handlersFor([]))
      const line = nodesOfTree(await ui.drawn()).find((node) => node.children?.includes(text))
      expect(line?.props).toMatchObject({ bold: true, color: PALETTES.github[key as keyof Palette] })
    }
  })
})


describe('badge repeats', () => {
  test('band leaves out a verdict that only says draft', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.band($, 'terminal', prView({ isDraft: true, mergeStateStatus: 'blocked' }, 120), handlersFor([]))
    const text = await textOf(ui)
    expect(text).toContain('PR #42')
    expect(text).toContain('draft')
    expect(text).not.toContain('blocked')
    expect(rowsOf(await ui.drawn())).toHaveLength(1)
  })

  test('band keeps the verdict when a draft has another blocker', async ($, on) => {
    const rig = createRig(on)
    const view = prView({ isDraft: true, mergeStateStatus: 'blocked', reviewDecision: 'review-required', reviewRequests: [{ reviewer: 'ben', isTeam: false }] }, 140)
    expect(view.status?.blockers.length).toBeGreaterThan(1)
    const ui = await rig.band($, 'terminal', view, handlersFor([]))
    expect(await textOf(ui)).toContain('blocked: draft')
  })

  test('pane prints no verdict line or bullet for a lone draft blocker', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.pane($, 'terminal', prView({ isDraft: true, mergeStateStatus: 'blocked' }, 80), handlersFor([]))
    const text = await textOf(ui)
    expect(text).toContain('── Merge')
    expect(text).not.toContain('blocked')
    expect(text).not.toContain('• draft')
  })

  test('pane still lists the other blockers of a draft', async ($, on) => {
    const rig = createRig(on)
    const view = prView({ isDraft: true, mergeStateStatus: 'blocked', reviewDecision: 'review-required', reviewRequests: [{ reviewer: 'ben', isTeam: false }] }, 80)
    const text = await textOf(await rig.pane($, 'terminal', view, handlersFor([])))
    expect(text).toContain('blocked')
    expect(text).toContain('• draft')
    expect(text).toContain('• review required')
  })

  test('repeatsBadge covers draft, merged and closed only', () => {
    const check = (overrides: Partial<PullRequest>) => {
      const view = prView(overrides, 80)
      return view.snapshot.kind === 'pr' && view.status !== null ? repeatsBadge(view.snapshot.pr, view.status) : null
    }
    expect(check({ isDraft: true, mergeStateStatus: 'blocked' })).toBe(true)
    expect(check({ state: 'merged' })).toBe(true)
    expect(check({ state: 'closed' })).toBe(true)
    expect(check({})).toBe(false)
    expect(check({ mergeStateStatus: 'blocked', reviewDecision: 'review-required', reviewRequests: [{ reviewer: 'ben', isTeam: false }] })).toBe(false)
  })
})

describe('the pane while an action is pending', () => {
  const pendingView = (kind: PendingAction['kind'], overrides: Partial<PullRequest> = {}): { view: View; pending: PendingAction } => {
    const view = prView({ checks: [makeCheck()], ...overrides }, 100)
    const pending = buildPending(kind, view.snapshot)
    if (pending === null) throw new Error(`${kind} is not offered`)
    return { view: { ...view, pending }, pending }
  }

  for (const surface of SURFACES) {
    test(`draws the confirmation in the Merge section instead of the buttons on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: string[] = []
      const { view } = pendingView('merge')
      const ui = await rig.pane($, surface, view, handlersFor(calls))
      const text = await textOf(ui)
      expect(text).toContain('Merge acme/app #42 into main')
      expect(text).toContain('head abcdef0 · as @me')
      expect(text).toContain('press y to confirm, n to cancel')
      expect(await ui.find({ key: 'merge' })).toBeUndefined()
      expect(await ui.find({ key: 'refresh' })).toBeUndefined()
      expect((await ui.find({ key: 'confirm' }))?.props).toMatchObject({ hotkey: 'y' })
      await ui.press({ key: 'confirm' })
      await ui.press({ key: 'cancel' })
      expect(calls).toEqual(['confirmPending false', 'cancelPending'])
      await ui.unmount()
    })
  }

  test('several allowed methods show the selector, and its choice reaches selectMethod', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const { view } = pendingView('merge')
    const ui = await rig.pane($, 'terminal', view, handlersFor(calls))
    await ui.select({ key: 'method', value: 'rebase' })
    expect(calls).toEqual(['selectMethod rebase'])
    await ui.unmount()
  })

  test('the admin step 1 lists the bypassed rules and asks y; no other pane button is drawn', async ($, on) => {
    const rig = createRig(on)
    const { view } = pendingView('admin-merge', { mergeStateStatus: 'blocked', reviewDecision: 'review-required', reviewRequests: [{ reviewer: 'ben', isTeam: false }], viewerCanMergeAsAdmin: true })
    const ui = await rig.pane($, 'terminal', view, handlersFor([]))
    expect(await textOf(ui)).toContain('This bypasses:')
    expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
    await ui.unmount()
  })

  test('the last error shows once, inside the confirmation', async ($, on) => {
    const rig = createRig(on)
    const { view } = pendingView('merge')
    const failed = { ...view, outcome: { kind: 'merge' as const, isOk: false, message: 'boom', at: '2026-01-01T00:09:00Z' } }
    const ui = await rig.pane($, 'terminal', failed, handlersFor([]))
    expect((await textOf(ui)).split('✗ boom')).toHaveLength(2)
    await ui.unmount()
  })

  test('the row count includes the confirmation', () => {
    const { view } = pendingView('merge')
    const confirmRows = confirmRowCount(view, view.pending as PendingAction)
    expect(confirmRows).toBeGreaterThanOrEqual(6)
    expect(paneRowCount(view)).toBeGreaterThanOrEqual(confirmRows + 4)
  })
})

describe('the pane outcome line', () => {
  const merged = (overrides: Partial<PullRequest>): PullRequest => makePr({ state: 'merged', mergedBy: 'me', mergedAt: '2026-01-01T00:09:30Z', ...overrides })

  test('a success the state already says is left out; "merged by" is enough', async ($, on) => {
    const rig = createRig(on)
    const view = { ...viewFor(makeSnapshot(merged({})), 100), outcome: { kind: 'merge' as const, isOk: true, message: 'PR #42 merged', at: '2026-01-01T00:09:40Z' } }
    const ui = await rig.pane($, 'terminal', view, handlersFor([]))
    const text = await textOf(ui)
    expect(text).toContain('merged by @me')
    expect(text).not.toContain('✓ PR #42 merged')
    await ui.unmount()
  })

  test('a success the state does not say stays', async ($, on) => {
    const rig = createRig(on)
    const view = { ...prView({}, 100), outcome: { kind: 'merge' as const, isOk: true, message: 'PR #42 merged', at: '2026-01-01T00:09:40Z' } }
    const ui = await rig.pane($, 'terminal', view, handlersFor([]))
    expect(await textOf(ui)).toContain('✓ PR #42 merged')
    await ui.unmount()
  })

  test('an error stays even on a merged pull request', async ($, on) => {
    const rig = createRig(on)
    const view = { ...viewFor(makeSnapshot(merged({})), 100), outcome: { kind: 'merge' as const, isOk: false, message: 'boom', at: '2026-01-01T00:09:40Z' } }
    const ui = await rig.pane($, 'terminal', view, handlersFor([]))
    expect(await textOf(ui)).toContain('✗ boom')
    await ui.unmount()
  })
})

describe('paneRowCount', () => {
  test('matches the rows renderPane draws, within the cap', async ($, on) => {
    const rig = createRig(on)
    const view = prView({ checks: [failedRequired, makeCheck({ name: 'docs' })], mergeStateStatus: 'blocked', author: 'me' }, 80)
    const ui = await rig.pane($, 'terminal', view, handlersFor([]))
    const drawn = rowsOf(await ui.drawn()).join('\n').split('\n').length
    // sections are separated by one blank row, which the test layout does not draw
    const sections = (await textOf(ui)).split('── ').length - 1 + 1
    expect(paneRowCount(view)).toBe(drawn + sections - 1)
  })

  test('grows with the content and is capped at 40', () => {
    const small = paneRowCount(prView({}, 80))
    const checks = Array.from({ length: 60 }, (_, index) => makeCheck({ name: `job ${index}` }))
    expect(paneRowCount(prView({ checks }, 80))).toBe(40)
    expect(small).toBeGreaterThanOrEqual(6)
    expect(small).toBeLessThan(40)
  })

  test('a PR without a status asks for a few rows', () => {
    const view = viewFor({ kind: 'loading', at: '' } as Snapshot, 80)
    expect(paneRowCount(view)).toBe(6)
  })
})

describe('the retry failed button', () => {
  const rerunnable = [makeCheck({ name: 'lint', state: 'failure', runId: 70 }), makeCheck({ name: 'build', state: 'success', runId: 71 })]
  const inProgress = [makeCheck({ name: 'lint', state: 'failure', runId: 70 }), makeCheck({ name: 'test', state: 'running', runId: 70 })]

  test('the band shows t only when a run can be re-run and the handler exists, on both surfaces', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const handlers = handlersFor(calls, { rerunFailed: () => void calls.push('rerunFailed') })
      const shown = await rig.band($, surface, prView({ checks: rerunnable }, 160), handlers)
      expect(hotkeysOf(await shown.findAll({ type: 'Button' }))).toContain('t')
      expect(await textOf(shown)).toContain('t: retry failed')
      await shown.press({ key: 'band-retry-failed' })
      expect(calls).toEqual(['rerunFailed'])
      await shown.unmount()

      const running = await rig.band($, surface, prView({ checks: inProgress }, 160), handlers)
      expect(hotkeysOf(await running.findAll({ type: 'Button' }))).not.toContain('t')
      await running.unmount()

      const noHandler = await rig.band($, surface, prView({ checks: rerunnable }, 160), handlersFor([]))
      expect(hotkeysOf(await noHandler.findAll({ type: 'Button' }))).not.toContain('t')
      await noHandler.unmount()

      const noRunId = await rig.band($, surface, prView({ checks: [makeCheck({ name: 'ext', state: 'failure' })] }, 160), handlers)
      expect(hotkeysOf(await noRunId.findAll({ type: 'Button' }))).not.toContain('t')
      await noRunId.unmount()
    }
  })

  test('the band drops it first when the row is tight', async ($, on) => {
    const rig = createRig(on)
    const handlers = handlersFor([], { ciToClaude: () => {}, rerunFailed: () => {} })
    const wide = await rig.band($, 'terminal', prView({ checks: rerunnable }, 160), handlers)
    expect(hotkeysOf(await wide.findAll({ type: 'Button' }))).toEqual(['d', 'o', 'f', 't'])
    await wide.unmount()
    for (const columns of [40, 60, 80]) {
      const ui = await rig.band($, 'terminal', prView({ checks: rerunnable }, columns), handlers)
      const keys = hotkeysOf(await ui.findAll({ type: 'Button' }))
      if (keys.includes('t')) expect(keys).toEqual(['d', 'o', 'f', 't'])
      for (const row of rowsOf(await ui.drawn())) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })

  test('the pane shows t next to fix ci only when a run can be re-run, and pressing it calls the handler', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const handlers = handlersFor(calls, { ciToClaude: () => {}, rerunFailed: () => void calls.push('rerunFailed') })
      const shown = await rig.pane($, surface, prView({ checks: rerunnable }, 100), handlers)
      const keys = hotkeysOf(await shown.findAll({ type: 'Button' }))
      expect(keys.indexOf('t')).toBe(keys.indexOf('f') + 1)
      await shown.press({ key: 'rerun-failed' })
      expect(calls).toEqual(['rerunFailed'])
      await shown.unmount()

      const running = await rig.pane($, surface, prView({ checks: inProgress }, 100), handlers)
      expect(hotkeysOf(await running.findAll({ type: 'Button' }))).not.toContain('t')
      await running.unmount()

      const noHandler = await rig.pane($, surface, prView({ checks: rerunnable }, 100), handlersFor([], { ciToClaude: () => {} }))
      expect(hotkeysOf(await noHandler.findAll({ type: 'Button' }))).not.toContain('t')
      await noHandler.unmount()
    }
  })
})

describe('the list entry points', () => {
  const noPr: Snapshot = { kind: 'no-pr', at: '2026-01-01T00:00:00Z', location: makeLocation(), account: { login: 'me', source: 'active' } }
  const counts = { open: 18, yours: 3, requested: 2, at: '2026-01-01T00:00:00Z' }
  const withCounts = (view: View, value: View['counts']): View => ({ ...view, counts: value })

  test('the band without a PR shows the counts and the list button', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await rig.band($, surface, withCounts(viewFor(noPr, 120), counts), handlersFor(calls, { openList: () => void calls.push('openList') }))
      expect(await textOf(ui)).toBe('no PR for feat/things · 18 open · 3 yours · 2 review requested · @me  l: list')
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['l'])
      await ui.press({ key: 'band-list' })
      expect(calls).toEqual(['openList'])
      await ui.unmount()
    }
  })

  test('zero parts are left out, except open; no counts leaves them all out', async ($, on) => {
    const rig = createRig(on)
    const zero = await rig.band($, 'terminal', withCounts(viewFor(noPr, 120), { ...counts, yours: 0, requested: 0, open: 0 }), handlersFor([]))
    expect(await textOf(zero)).toBe('no PR for feat/things · 0 open · @me')
    const some = await rig.band($, 'terminal', withCounts(viewFor(noPr, 120), { ...counts, yours: 0 }), handlersFor([]))
    expect(await textOf(some)).toBe('no PR for feat/things · 18 open · 2 review requested · @me')
    const none = await rig.band($, 'terminal', withCounts(viewFor(noPr, 120), null), handlersFor([]))
    expect(await textOf(none)).toBe('no PR for feat/things · @me')
    expect(await none.find({ key: 'band-list' })).toBeUndefined()
  })

  test('the no-PR band fits every width and keeps the list button', async ($, on) => {
    const rig = createRig(on)
    const kept: string[][] = []
    for (const columns of [160, 80, 60, 50, 40]) {
      const ui = await rig.band($, 'terminal', withCounts(viewFor(noPr, columns), counts), handlersFor([], { openList: () => {} }))
      const text = await textOf(ui)
      for (const row of text.split('\n')) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      expect(text).toContain('l: list')
      kept.push(['18 open', '3 yours', 'review requested', '@me'].filter((part) => text.includes(part)))
      await ui.unmount()
    }
    expect(kept[0]).toHaveLength(4)
    expect(kept.at(-1)).toEqual([])
    for (let index = 1; index < kept.length; index += 1) expect(kept[index - 1]).toEqual(expect.arrayContaining(kept[index] ?? []))
  })

  test('without the handler there is no list button', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.band($, 'terminal', withCounts(viewFor(noPr, 120), counts), handlersFor([]))
    expect(await textOf(ui)).toBe('no PR for feat/things · 18 open · 3 yours · 2 review requested · @me')
  })

  test('the band with a PR adds "18 open" and drops it before anything else', async ($, on) => {
    const rig = createRig(on)
    const base = prView({ checks: [makeCheck()] }, 160)
    const wide = await rig.band($, 'terminal', withCounts(base, counts), handlersFor([]))
    const text = await textOf(wide)
    expect(text).toContain('18 open')
    expect(text.indexOf('18 open')).toBeLessThan(text.indexOf('@me'))
    expect(hotkeysOf(await wide.findAll({ type: 'Button' }))).toEqual(['d', 'o'])
    const without = await rig.band($, 'terminal', base, handlersFor([]))
    expect(await textOf(without)).not.toContain('18 open')
    // Whenever the counted band lacks "18 open", it reads exactly as the plain band: nothing else went first.
    let dropped = 0
    for (let columns = 160; columns >= 40; columns -= 2) {
      const counted = await rig.band($, 'terminal', withCounts({ ...base, columns }, counts), handlersFor([]))
      const plain = await rig.band($, 'terminal', { ...base, columns }, handlersFor([]))
      const countedText = await textOf(counted)
      for (const row of countedText.split('\n')) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      if (!countedText.includes('18 open')) {
        dropped += 1
        expect(countedText).toBe(await textOf(plain))
      }
      await counted.unmount()
      await plain.unmount()
    }
    expect(dropped).toBeGreaterThan(0)
  })

  test('the pane header has an all PRs button when the list is available', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const ui = await rig.pane($, surface, prView({ title: 'A fairly long title for the header row to cut', checks: [makeCheck()] }, 60), handlersFor(calls, { openList: () => void calls.push('openList') }))
      const lines = (await textOf(ui)).split('\n')
      expect(lines[0]).toContain('l: all PRs')
      for (const row of lines.slice(0, 4)) expect(cellWidth(row)).toBeLessThanOrEqual(60)
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toContain('l')
      await ui.press({ key: 'pane-list' })
      expect(calls).toEqual(['openList'])
      await ui.unmount()
    }
  })

  test('the pane has no all PRs button without the handler', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.pane($, 'terminal', prView({ checks: [makeCheck()] }, 100), handlersFor([]))
    expect(await ui.find({ key: 'pane-list' })).toBeUndefined()
    expect(await textOf(ui)).not.toContain('all PRs')
  })

  test('the header of a selected PR is a Button keyed pr-N that only refreshes, with b: back to list and l', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: string[] = []
      const view = { ...prView({ number: 42, title: 'A fairly long title for the header row to cut', checks: [makeCheck()] }, 70), isSelected: true }
      const ui = await rig.pane($, surface, view, handlersFor(calls, { back: () => void calls.push('back'), openList: () => void calls.push('openList') }))
      const lines = (await textOf(ui)).split('\n')
      expect(lines[0]).toContain('#42 A fairly')
      expect(lines[0]).not.toContain('PR #42')
      expect(lines[0]).toContain('b: back to list')
      expect(lines[0]).not.toContain('all PRs')
      for (const row of lines.slice(0, 4)) expect(cellWidth(row)).toBeLessThanOrEqual(70)
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(expect.arrayContaining(['b', 'l']))
      await ui.press({ key: 'pr-42' })
      await ui.press({ key: 'back' })
      await ui.press({ key: 'pane-list' })
      expect(calls).toEqual(['refresh', 'back', 'back'])
      await ui.unmount()
    }
  })

  test('the PR header title (picked: pr-N, branch: pr-anchor) is a plain Button around one monochrome Text, no swap, no hover, no head- Box', async ($, on) => {
    const rig = createRig(on)
    type Piece = { props?: Record<string, unknown>; hover?: unknown }
    const cases = [
      { isSelected: true, key: 'pr-42' },
      { isSelected: false, key: 'pr-anchor' },
    ]
    for (const { isSelected, key } of cases) {
      const base = { ...prView({ number: 42, title: 'Calm title', checks: [makeCheck()] }, 80), isSelected }
      const ui = await rig.pane($, 'terminal', base, handlersFor([], { back: () => {}, openList: () => {} }))
      const button = (await ui.find({ key })) as { props: Record<string, unknown>; children: Piece[] }
      expect(button.props.label).toContain('#42 Calm title')
      expect(button.children).toHaveLength(1)
      expect(button.children[0]?.props?.color).toBeUndefined()
      expect(button.children[0]?.props?.backgroundColor).toBeUndefined()
      expect(button.children[0]).not.toHaveProperty('hover')
      expect(await ui.find({ key: `head-${key}` })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the branch PR header keeps l: all PRs; both navigations are hidden while a confirmation waits', async ($, on) => {
    const rig = createRig(on)
    const plain = await rig.pane($, 'terminal', prView({ number: 42, checks: [makeCheck()] }, 80), handlersFor([], { openList: () => {}, back: () => {} }))
    expect((await textOf(plain)).split('\n')[0]).toContain('l: all PRs')
    expect(await plain.find({ key: 'back' })).toBeUndefined()
    await plain.unmount()
    for (const isSelected of [false, true]) {
      const base = { ...prView({ author: 'octocat', checks: [makeCheck()] }, 100), isSelected }
      const pending = buildPending('approve', base.snapshot, undefined, 0, 'x')
      if (pending === null) throw new Error('approve is not offered')
      for (const view of [{ ...base, pending }, { ...base, hasPending: true }]) {
        const ui = await rig.pane($, 'terminal', view, handlersFor([], { openList: () => {}, back: () => {} }))
        expect(await ui.find({ key: 'pane-list' })).toBeUndefined()
        expect(await ui.find({ key: 'back' })).toBeUndefined()
        await ui.unmount()
      }
    }
  })

  test('the pane without a PR offers the list too', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.pane($, 'terminal', viewFor(noPr, 80), handlersFor([], { openList: () => {} }))
    expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['r', 'l'])
  })
})

describe('the review buttons and confirmation', () => {
  const everyReview = { requestApprove: () => {}, requestChanges: () => {}, requestReady: () => {} }

  for (const surface of SURFACES) {
    test(`the pane offers v approve and w request changes for someone else's PR, and pressing them calls the handlers on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: string[] = []
      const handlers = handlersFor(calls, { requestApprove: () => void calls.push('requestApprove'), requestChanges: () => void calls.push('requestChanges'), requestReady: () => void calls.push('requestReady') })
      const ui = await rig.pane($, surface, prView({ author: 'octocat' }, 100), handlers)
      const text = await textOf(ui)
      expect(text).toContain('v: approve')
      expect(text).toContain('w: request changes')
      expect(text).not.toContain('e: ready for review')
      expect((await ui.find({ key: 'approve' }))?.props).toMatchObject({ hotkey: 'v' })
      expect((await ui.find({ key: 'request-changes' }))?.props).toMatchObject({ hotkey: 'w' })
      await ui.press({ key: 'approve' })
      await ui.press({ key: 'request-changes' })
      expect(calls).toEqual(['requestApprove', 'requestChanges'])
      await ui.unmount()
    })

    test(`the pane offers e ready for review for an own draft, and no review on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: string[] = []
      const ui = await rig.pane($, surface, prView({ author: 'me', isDraft: true }, 100), handlersFor(calls, { ...everyReview, requestReady: () => void calls.push('requestReady') }))
      const text = await textOf(ui)
      expect(text).toContain('e: ready for review')
      expect(text).not.toContain('v: approve')
      expect(text).not.toContain('w: request changes')
      await ui.press({ key: 'ready-for-review' })
      expect(calls).toEqual(['requestReady'])
      await ui.unmount()
    })
  }

  test('an own PR, a draft of someone else, a merged PR and a missing handler draw no review button', async ($, on) => {
    const rig = createRig(on)
    const keys = async (overrides: Partial<PullRequest>, handlers: Partial<Handlers> = everyReview) => {
      const ui = await rig.pane($, 'terminal', prView(overrides, 100), handlersFor([], handlers))
      const found = hotkeysOf(await ui.findAll({ type: 'Button' }))
      await ui.unmount()
      return found
    }
    for (const overrides of [{ author: 'me' }, { author: 'octocat', isDraft: true }, { author: 'octocat', state: 'merged' as const }, { author: 'octocat', state: 'closed' as const }, { author: null }]) {
      const found = await keys(overrides)
      expect(found).not.toContain('v')
      expect(found).not.toContain('w')
    }
    const none = await keys({ author: 'octocat' }, {})
    expect(none).not.toContain('v')
    expect(none).not.toContain('w')
  })

  for (const surface of SURFACES) {
    test(`the pane draws the confirmation with the field in the Merge section on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: string[] = []
      const view = prView({ author: 'octocat', checks: [makeCheck()] }, 100)
      const pending = buildPending('request-changes', view.snapshot, undefined, 0, 'rename x')
      if (pending === null) throw new Error('request-changes is not offered')
      const ui = await rig.pane($, surface, { ...view, pending }, handlersFor(calls, { setReviewBody: text => void calls.push(`setReviewBody ${text}`) }))
      const text = await textOf(ui)
      expect(text).toContain('Request changes on acme/app #42')
      expect(text).toContain('Will post:')
      expect(text).toContain('rename x')
      expect(text).toContain('y: request changes #42')
      expect(await ui.find({ key: 'review-body' })).toBeDefined()
      expect(await ui.find({ key: 'approve' })).toBeUndefined()
      expect(await ui.find({ key: 'refresh' })).toBeUndefined()
      await ui.input({ key: 'review-body', text: 'rename y' })
      expect(calls).toEqual(['setReviewBody rename y'])
      await ui.press({ key: 'confirm' })
      expect(calls).toEqual(['setReviewBody rename y', 'confirmPending false'])
      await ui.unmount()
    })

    test(`the band shows the short confirm controls for a pending review on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: string[] = []
      for (const [kind, prompt] of [['approve', 'approve #42?'], ['request-changes', 'request changes #42?']] as const) {
        const view = prView({ author: 'octocat' }, 120)
        const pending = buildPending(kind, view.snapshot, undefined, 0, 'x')
        if (pending === null) throw new Error(`${kind} is not offered`)
        const ui = await rig.band($, surface, { ...view, pending }, handlersFor(calls))
        const text = await textOf(ui)
        expect(text).toContain(prompt)
        expect(text).toContain('y: confirm')
        expect(text).toContain('n: cancel')
        expect(await ui.find({ key: 'review-body' })).toBeUndefined()
        expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
        await ui.unmount()
      }
    })
  }

  test('the pane row count covers the review confirmation and its buttons', () => {
    const view = prView({ author: 'octocat', checks: [makeCheck()] }, 100)
    const pending = buildPending('request-changes', view.snapshot, undefined, 0, 'x')
    if (pending === null) throw new Error('request-changes is not offered')
    const confirmRows = confirmRowCount({ ...view, pending }, pending)
    expect(confirmRows).toBeGreaterThanOrEqual(8)
    expect(paneRowCount({ ...view, pending })).toBeGreaterThanOrEqual(confirmRows + 4)
  })
})

describe('the band confirm shows what will happen', () => {
  const asked = (kind: PendingAction['kind'], body: string, columns: number, overrides: Partial<PullRequest> = {}): { view: View; pending: PendingAction } => {
    const view = prView({ author: 'octocat', checks: [makeCheck()], ...overrides }, columns)
    const pending = buildPending(kind, view.snapshot, undefined, 0, body)
    if (pending === null) throw new Error(`${kind} is not offered`)
    return { view: { ...view, pending }, pending }
  }
  const details = (view: View): string => {
    if (view.snapshot.kind !== 'pr') throw new Error('no pull request')
    return `acme/app #${view.snapshot.pr.number} · head ${view.snapshot.pr.headOid.slice(0, 7)} · @me`
  }
  const bodyHandlers = (calls: Calls): Handlers => handlersFor(calls, { confirmPending: (isSecondStep, drawnBody) => void calls.push(`confirmPending ${String(isSecondStep)} ${String(drawnBody)}`) })

  for (const surface of SURFACES) {
    test(`a merge shows owner/repo, number, short head and account, and still confirms on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: Calls = []
      const { view } = asked('merge', '', 120, { author: 'me' })
      const ui = await rig.band($, surface, view, bodyHandlers(calls))
      const text = await textOf(ui)
      expect(text).toContain('merge #42 (squash)?')
      expect(text).toContain(details(view))
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
      await ui.press({ key: 'band-confirm' })
      expect(calls).toEqual(['confirmPending false undefined'])
      await ui.unmount()
    })

    test(`a review shows the exact text it will post, and the press hands that text over on ${surface}`, async ($, on) => {
      const rig = createRig(on)
      const calls: Calls = []
      for (const kind of ['approve', 'request-changes'] as const) {
        const { view } = asked(kind, 'rename x and add a test', 120)
        const ui = await rig.band($, surface, view, bodyHandlers(calls))
        const text = await textOf(ui)
        expect(text).toContain(details(view))
        expect(text).toContain('rename x and add a test')
        expect(text).not.toContain('too long')
        await ui.press({ key: 'band-confirm' })
        await ui.unmount()
      }
      expect(calls).toEqual(['confirmPending false rename x and add a test', 'confirmPending false rename x and add a test'])
    })
  }

  test('an approval without text says (no comment)', async ($, on) => {
    const rig = createRig(on)
    for (const body of ['', '   \n ']) {
      const { view } = asked('approve', body, 120)
      const ui = await rig.band($, 'terminal', view, handlersFor([]))
      expect(await textOf(ui)).toContain('(no comment)')
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
      await ui.unmount()
    }
  })

  test('details that do not fit end in an ellipsis; they are cut only then', async ($, on) => {
    const rig = createRig(on)
    const wide = asked('approve', '', 120)
    const full = details(wide.view)
    const roomy = await rig.band($, 'terminal', wide.view, handlersFor([]))
    expect(await textOf(roomy)).toContain(full)
    expect(await textOf(roomy)).not.toContain('…')
    await roomy.unmount()
    const narrow = asked('approve', '', cellWidth(full) - 4)
    const cut = await rig.band($, 'terminal', narrow.view, handlersFor([]))
    const rows = rowsOf(await cut.drawn())
    const row = rows.find((line) => line.startsWith('acme/app #42')) ?? ''
    expect(row.endsWith('…')).toBe(true)
    expect(cellWidth(row)).toBeLessThanOrEqual(cellWidth(full) - 4)
    await cut.unmount()
  })

  test('review text that fills the row exactly is shown whole, not cut', async ($, on) => {
    const rig = createRig(on)
    const columns = 60
    const text = 'x'.repeat(columns - cellWidth('post: '))
    const { view } = asked('request-changes', text, columns)
    const ui = await rig.band($, 'terminal', view, handlersFor([]))
    const drawn = await textOf(ui)
    expect(drawn).toContain(text)
    expect(drawn).not.toContain('too long')
    expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
    await ui.unmount()
  })

  test('review text that does not fit the band row offers no y: cancel only, and says where to confirm', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const long = 'x'.repeat(200)
    for (const [kind, body] of [['approve', long], ['request-changes', long], ['request-changes', 'one line\nand another']] as const) {
      const { view } = asked(kind, body, 80)
      const ui = await rig.band($, 'terminal', view, bodyHandlers(calls))
      const text = await textOf(ui)
      expect(text).toContain('review text too long for the band, confirm in the pane')
      expect(text).not.toContain(long)
      expect(text).toContain(details(view))
      expect(await ui.find({ key: 'band-confirm' })).toBeUndefined()
      expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['n'])
      await ui.press({ key: 'band-cancel' })
      await ui.unmount()
    }
    expect(calls).toEqual(['cancelPending', 'cancelPending', 'cancelPending'])
  })

  test('a request for changes without text offers no y in the band either', async ($, on) => {
    const rig = createRig(on)
    const { view } = asked('request-changes', ' ', 120)
    const ui = await rig.band($, 'terminal', view, handlersFor([]))
    expect(await ui.find({ key: 'band-confirm' })).toBeUndefined()
    expect(await textOf(ui)).toContain('write what should change first')
    await ui.unmount()
  })

  test('the pane confirm hands the drawn review text over too', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const { view } = asked('request-changes', 'drawn text', 100)
    const ui = await rig.pane($, 'terminal', view, bodyHandlers(calls))
    await ui.press({ key: 'confirm' })
    expect(calls).toEqual(['confirmPending false drawn text'])
    await ui.unmount()
  })
})

describe('keys of the confirmation do not collide', () => {
  const pendingView = (view: View, kind: PendingAction['kind'], overrides: Partial<View> = {}): View => {
    const pending = buildPending(kind, view.snapshot, undefined, 0, 'x')
    if (pending === null) throw new Error(`${kind} is not offered`)
    return { ...view, pending, ...overrides }
  }

  test('the pane hides b: back while a confirmation waits, and draws it again after', async ($, on) => {
    const rig = createRig(on)
    const base = { ...prView({ author: 'octocat', checks: [makeCheck()] }, 100), isSelected: true }
    const back: Partial<Handlers> = { back: () => {} }
    const plain = await rig.pane($, 'terminal', base, handlersFor([], back))
    expect(await plain.find({ key: 'back' })).toBeDefined()
    await plain.unmount()
    for (const kind of ['approve', 'request-changes'] as const) {
      const ui = await rig.pane($, 'terminal', pendingView(base, kind), handlersFor([], back))
      expect(await ui.find({ key: 'back' })).toBeUndefined()
      expect(await textOf(ui)).not.toContain('b: back')
      await ui.unmount()
    }
  })

  test('a confirmation drawn only in the band (the pane shows a pick) hides the pane back button too', async ($, on) => {
    const rig = createRig(on)
    const base = { ...prView({ author: 'octocat', checks: [makeCheck()] }, 100), isSelected: true }
    const ui = await rig.pane($, 'terminal', { ...base, hasPending: true }, handlersFor([], { back: () => {} }))
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  })

  test('every confirm key of the pane and of the band appears once per site', async ($, on) => {
    const rig = createRig(on)
    const base = { ...prView({ author: 'octocat', checks: [makeCheck()] }, 100), isSelected: true }
    for (const kind of ['approve', 'request-changes'] as const) {
      const pane = await rig.pane($, 'terminal', pendingView(base, kind), handlersFor([], { back: () => {}, openList: () => {} }))
      const paneKeys = hotkeysOf(await pane.findAll({ type: 'Button' }))
      expect(new Set(paneKeys).size).toBe(paneKeys.length)
      expect(paneKeys).toEqual(expect.arrayContaining(['y', 'n']))
      expect(paneKeys).not.toContain('b')
      await pane.unmount()
      const band = await rig.band($, 'terminal', pendingView(base, kind), handlersFor([]))
      const bandKeys = hotkeysOf(await band.findAll({ type: 'Button' }))
      expect(new Set(bandKeys).size).toBe(bandKeys.length)
      await band.unmount()
    }
  })
})

describe('the pane: linked issues and workflow runs', () => {
  const linked = [
    { number: 7, title: 'Crash on start', state: 'open' as const },
    { number: 9, title: 'Old report', state: 'closed' as const },
  ]
  const runChecks = [
    makeCheck({ name: 'lint', workflow: 'CI', state: 'failure', runId: 70, jobId: 1, url: 'https://ci/lint' }),
    makeCheck({ name: 'unit', workflow: 'CI', state: 'failure', runId: 70, jobId: 2 }),
    makeCheck({ name: 'deploy', workflow: 'Deploy', state: 'success', runId: 71, jobId: 3 }),
    makeCheck({ name: 'docs', workflow: 'Docs', state: 'success', runId: 72, jobId: 4 }),
  ]
  const pendingView = (view: View, kind: PendingAction['kind']): View => {
    const pending = buildPending(kind, view.snapshot, undefined, 0, 'x')
    if (pending === null) throw new Error(`${kind} is not offered`)
    return { ...view, pending }
  }
  const full = (extra: Partial<Handlers> = {}) => handlersFor([], { openLinkedIssue: () => {}, openRun: () => {}, ...extra })
  const runKeys = async (ui: Mounted) => (await ui.findAll({ type: 'Button' })).map((button) => String(button.key)).filter((key) => key.startsWith('run-'))

  test('draws a Linked issues section with one keyed button per issue, closed ones dim', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const calls: Calls = []
      const ui = await rig.pane($, surface, prView({ linkedIssues: linked }, 80), handlersFor(calls, { openLinkedIssue: (n) => void calls.push(`issue ${n}`) }))
      const text = await textOf(ui)
      expect(text).toContain('── Linked issues')
      expect(text).toContain('#7 Crash on start')
      const keys = (await ui.findAll({ type: 'Button' })).map((button) => String(button.key)).filter((key) => key.startsWith('linked-issue-'))
      expect(keys).toEqual(['linked-issue-7', 'linked-issue-9'])
      expect(JSON.stringify(await ui.find({ key: 'linked-issue-9' }))).toContain('"dimColor":true')
      await ui.press({ key: 'linked-issue-9' })
      expect(calls).toEqual(['issue 9'])
      await ui.unmount()
    }
  })

  test('a linked issue of another repository is dim text with its slug, never a button', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const issues = [
      { number: 7, title: 'Here', state: 'open' as const, repo: 'ACME/app' },
      { number: 9, title: 'There', state: 'open' as const, repo: 'evil/fork' },
    ]
    const ui = await rig.pane($, 'terminal', prView({ linkedIssues: issues }, 80), handlersFor(calls, { openLinkedIssue: (n) => void calls.push(`issue ${n}`) }))
    const keys = (await ui.findAll({ type: 'Button' })).map((button) => String(button.key)).filter((key) => key.startsWith('linked-issue-'))
    expect(keys).toEqual(['linked-issue-7'])
    const text = await textOf(ui)
    expect(text).toContain('evil/fork#9 There')
    expect(text).toContain('#7 Here')
    expect(text).not.toContain('ACME/app#7')
  })

  test('draws no section without linked issues, and no button without the handler', async ($, on) => {
    const rig = createRig(on)
    const none = await rig.pane($, 'terminal', prView({ linkedIssues: [] }, 80), full())
    expect(await textOf(none)).not.toContain('Linked issues')
    const absent = await rig.pane($, 'terminal', prView({}, 80), full())
    expect(await textOf(absent)).not.toContain('Linked issues')
    const noHandler = await rig.pane($, 'terminal', prView({ linkedIssues: linked }, 80), handlersFor([]))
    expect(await noHandler.find({ key: 'linked-issue-7' })).toBeUndefined()
  })

  test('offers a run button per failing run, named by its workflow', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const handlers = handlersFor(calls, { openRun: (id) => void calls.push(`run ${id}`) })
    const ui = await rig.pane($, 'terminal', prView({ checks: runChecks }, 80), handlers)
    expect(await runKeys(ui)).toEqual(['run-70'])
    expect(await textOf(ui)).toContain('open run: CI ↗')
    await ui.press({ key: 'run-70' })
    expect(calls).toEqual(['run 70'])
  })

  test('without a failure it offers every run when there are at most two, none for more', async ($, on) => {
    const rig = createRig(on)
    const two = runChecks.filter((check) => check.state === 'success')
    const few = await rig.pane($, 'terminal', prView({ checks: two }, 80), full())
    expect(await runKeys(few)).toEqual(['run-71', 'run-72'])
    const three = [...two, makeCheck({ name: 'x', workflow: 'X', runId: 73 })]
    const many = await rig.pane($, 'terminal', prView({ checks: three }, 80), full())
    expect(await runKeys(many)).toEqual([])
  })

  test('skips the run buttons without the handler', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.pane($, 'terminal', prView({ checks: runChecks }, 80), handlersFor([]))
    expect(await runKeys(ui)).toEqual([])
  })

  test('both stay off the hotkeys and are hidden while a confirmation waits', async ($, on) => {
    const rig = createRig(on)
    const base = prView({ author: 'octocat', checks: [...runChecks, makeCheck()], linkedIssues: linked }, 100)
    const idle = await rig.pane($, 'terminal', base, full())
    const buttons = await idle.findAll({ type: 'Button' })
    expect(buttons.filter((button) => /^(run|linked-issue)-/.test(String(button.key))).every((button) => button.props.hotkey === undefined)).toBe(true)
    expect(hotkeysOf(buttons)).toEqual(['o', 'c', 'r'])
    for (const view of [{ ...base, hasPending: true }, pendingView(base, 'approve')]) {
      const ui = await rig.pane($, 'terminal', view, full())
      const keys = (await ui.findAll({ type: 'Button' })).map((button) => String(button.key))
      expect(keys.some((key) => /^(run|linked-issue)-/.test(key))).toBe(false)
      await ui.unmount()
    }
  })

  test('every button key is unique within the pane', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.pane($, 'terminal', prView({ checks: runChecks, linkedIssues: linked }, 100), full({ requestMerge: () => {} }))
    const keys = (await ui.findAll({ type: 'Button' })).map((button) => String(button.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('paneRowCount counts the section and the run lines', () => {
    const base = prView({ checks: runChecks }, 80)
    const withLinks = prView({ checks: runChecks, linkedIssues: linked }, 80)
    expect(paneRowCount(withLinks)).toBe(paneRowCount(base) + 1 + linked.length + 1)
    expect(paneRowCount(base, { openRun: () => {} })).toBe(paneRowCount(base) + 1)
  })
})

describe('the main-branch segment of the band', () => {
  const noPr: Snapshot = { kind: 'no-pr', at: '2026-01-01T00:00:00Z', location: makeLocation(), account: { login: 'me', source: 'active' } }
  const red = { at: '2026-01-01T00:00:00Z', defaultBranch: 'main', worst: 'failure' as const, failing: [{ name: 'CI', runId: 7, url: 'https://github.com/o/r/actions/runs/7' }] }
  const withMain = (view: View, mainStatus: View['mainStatus']): View => ({ ...view, mainStatus })
  const withOpen = (calls: string[]) => handlersFor(calls, { openActions: () => void calls.push('openActions') })

  test('shows "<branch> ✗ <name>" as a plain button on 3 that opens the Actions tab, with a PR and without', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      for (const base of [prView({ checks: [makeCheck()] }, 160), viewFor(noPr, 160)]) {
        const calls: string[] = []
        const ui = await rig.band($, surface, withMain(base, red), withOpen(calls))
        expect(await textOf(ui)).toContain('main ✗ CI')
        const button = await ui.find({ key: 'band-main' })
        expect(button?.props).toMatchObject({ hotkey: '3' })
        expect(JSON.stringify(await ui.find({ key: 'band-main' }))).toContain(`"color":${JSON.stringify(base.palette.failure)}`)
        await ui.press({ key: 'band-main' })
        expect(calls).toEqual(['openActions'])
        await ui.unmount()
      }
    }
  })

  test('names the first failing workflow and counts the others', async ($, on) => {
    const rig = createRig(on)
    const failing = [...red.failing, { name: 'Lint', runId: 8, url: '' }, { name: 'Docs', runId: 9, url: '' }]
    const ui = await rig.band($, 'terminal', withMain(viewFor(noPr, 160), { ...red, failing }), withOpen([]))
    expect(await textOf(ui)).toContain('main ✗ CI +2')
  })

  test('is hidden when the branch is green, nothing is known or the view does not carry it', async ($, on) => {
    const rig = createRig(on)
    const green = { ...red, worst: 'success' as const, failing: [] }
    for (const mainStatus of [green, null, undefined]) {
      for (const base of [prView({ checks: [makeCheck()] }, 160), viewFor(noPr, 160)]) {
        const ui = await rig.band($, 'terminal', withMain(base, mainStatus), withOpen([]))
        expect(await ui.find({ key: 'band-main' })).toBeUndefined()
        expect(await textOf(ui)).not.toContain('✗ CI')
        await ui.unmount()
      }
    }
  })

  test('without the handler it is plain text, not a button', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.band($, 'terminal', withMain(viewFor(noPr, 160), red), handlersFor([]))
    expect(await textOf(ui)).toContain('main ✗ CI')
    expect(await ui.find({ key: 'band-main' })).toBeUndefined()
  })

  test('fits the row at every width', async ($, on) => {
    const rig = createRig(on)
    for (const columns of [160, 100, 80, 60, 40]) {
      for (const base of [prView({ checks: [makeCheck()] }, columns), viewFor(noPr, columns)]) {
        const ui = await rig.band($, 'terminal', withMain(base, red), withOpen([]))
        for (const row of (await textOf(ui)).split('\n')) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
        await ui.unmount()
      }
    }
  })
})
