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

describe('sortChecks', () => {
  test('puts required first, then failed, running, queued, the rest, and drops stale', () => {
    const checks: Check[] = [
      makeCheck({ name: 'ok-optional' }),
      makeCheck({ name: 'queued-optional', state: 'queued' }),
      makeCheck({ name: 'failed-optional', state: 'failure' }),
      makeCheck({ name: 'ok-required', isRequired: true }),
      makeCheck({ name: 'running-required', isRequired: true, state: 'running' }),
      makeCheck({ name: 'failed-required', isRequired: true, state: 'failure' }),
      makeCheck({ name: 'old', state: 'stale' }),
      makeCheck({ name: 'running-optional', state: 'running' }),
    ]
    expect(sortChecks(checks).map((check) => check.name)).toEqual([
      'failed-required',
      'running-required',
      'ok-required',
      'failed-optional',
      'running-optional',
      'queued-optional',
      'ok-optional',
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
type Mounted = Pick<MountedOf<Surface, 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'select' | 'unmount'>
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
        threads: [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: { author: 'ben', createdAt: '2026-01-01T00:09:30Z', url: 'https://x/c' } }],
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
          threads: [{ isResolved: false, isOutdated: false, path: 'a.ts', line: 1, last: { author: 'ben', createdAt: '2026-01-01T00:09:30Z', url: 'https://x/c' } }],
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
        lastComment: { author: 'ben', createdAt: '2026-01-01T00:06:00Z', url: 'https://x/last' },
        threads: [
          { isResolved: false, isOutdated: false, path: 'src/ui/band.tsx', line: 12, last: { author: 'ben', createdAt: '2026-01-01T00:06:00Z', url: 'https://x/t1' } },
          { isResolved: false, isOutdated: true, path: 'old.ts', line: 3, last: { author: 'ben', createdAt: '2025-12-30T00:06:00Z', url: 'https://x/t2' } },
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

  test('summarizes new activity since the last look', async ($, on) => {
    const rig = createRig(on)
    const view = prView({ lastComment: { author: 'ben', createdAt: '2026-01-01T00:06:00Z', url: 'https://x/last' } }, 80, [], '2026-01-01T00:00:00Z')
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
    const view = prView({ checks: [failedRequired, makeCheck({ name: 'docs' })], mergeStateStatus: 'blocked' }, 80)
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
