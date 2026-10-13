import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ActionOutcome, CheckState, JobDetail, Problem, RunItem, RunSnapshot } from '../src/model'
import { PALETTES } from '../src/ui/colors'
import type { RepoHandlers, RunDetailView } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { renderRunDetail } from '../src/ui/run-detail'
import { makeLocation } from './fixtures/pr-builder'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
type Mounted = Pick<MountedOf<Surface, 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'unmount'>

const account = { login: 'me', source: 'active' } as const

function runOf(extra: Partial<RunItem> = {}): RunItem {
  return {
    id: 900,
    runNumber: 12,
    workflowId: 3,
    name: 'CI',
    branch: 'feat/things',
    event: 'push',
    actor: 'anna',
    state: 'success',
    headSha: 'abcdef0123456789',
    createdAt: '2026-10-12T11:55:00Z',
    startedAt: '2026-10-12T11:56:00Z',
    updatedAt: '2026-10-12T11:59:12Z',
    url: 'https://github.com/acme/app/actions/runs/900',
    attempt: 1,
    ...extra,
  }
}

function jobOf(extra: Partial<JobDetail> = {}): JobDetail {
  return { jobId: 1, runId: 900, name: 'build', state: 'success', currentStep: null, failedStep: null, url: null, ...extra }
}

function snapshotOf(run: RunItem, jobs: JobDetail[] = [], stale: Problem | null = null): RunSnapshot {
  return { kind: 'run', at: '2026-10-12T11:58:00Z', location: makeLocation(), account, run, jobs, stale }
}

function viewOf(snapshot: RunSnapshot, columns = 80, outcome: ActionOutcome | null = null): RunDetailView {
  return { snapshot, outcome, nowMs: NOW, columns, palette: PALETTES.claude }
}

function handlersFor(calls: string[]): RepoHandlers {
  return {
    showTab: (tab) => void calls.push(`tab ${tab}`),
    selectIssue: (n) => void calls.push(`issue ${n}`),
    selectRun: (id) => void calls.push(`run ${id}`),
    openLinkedPr: (n) => void calls.push(`pr ${n}`),
    back: () => void calls.push('back'),
    nextPage: () => void calls.push('next'),
    prevPage: () => void calls.push('prev'),
    refresh: () => void calls.push('refresh'),
    closePane: () => void calls.push('close'),
    openUrl: (url) => void calls.push(`openUrl ${url}`),
    copyText: (text) => void calls.push(`copy ${text}`),
    rerunRun: (id) => void calls.push(`rerun ${id}`),
    ciToClaude: (id) => void calls.push(`fix ${id}`),
  }
}

type Current = { view: RunDetailView; handlers: RepoHandlers }

function createRig(on: On) {
  let current: Current | null = null
  let serial = 0
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (current === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return renderRunDetail($.ui.resolve(e), current.view, current.handlers)
  })
  return {
    draw($: Engine, surface: Surface, view: RunDetailView, handlers: RepoHandlers): Promise<Mounted> {
      current = { view: { ...view, surface }, handlers }
      const props = { title: 'Run', isFocused: true, bodyColumns: view.columns, placement: 'inline' }
      return $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: `run-${(serial += 1)}`, props: props as never })
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
const keysOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Button' })).map((button) => String(button.key))

describe('the run detail', () => {
  test('draws the header, facts, timing and jobs on both surfaces', async ($, on) => {
    const rig = createRig(on)
    const jobs = [jobOf({ url: 'https://ci/job/1' }), jobOf({ jobId: 2, name: 'lint', state: 'failure', failedStep: 'Run eslint' }), jobOf({ jobId: 3, name: 'e2e', state: 'running', currentStep: 'Run tests' })]
    for (const surface of SURFACES) {
      const ui = await rig.draw($, surface, viewOf(snapshotOf(runOf(), jobs)), handlersFor([]))
      const text = await textOf(ui)
      for (const expected of ['✓ ', '#12 CI', 'b: back to list', 'l: list', 'feat/things · push · @anna · abcdef0', 'started 4 min ago · 3:12', '── Jobs', '✓ build', '✗ lint', '✗ Run eslint', '● e2e', '▸ Run tests', 'o: github', 'c: copy url', 'r: refresh']) {
        expect(text).toContain(expected)
      }
      await ui.unmount()
    }
  })

  test('a running run shows the time elapsed so far; a queued one how long it waits', async ($, on) => {
    const rig = createRig(on)
    const running = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ state: 'running' }))), handlersFor([]))
    expect(await textOf(running)).toContain('started 4 min ago · 4:00')
    const queued = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ state: 'queued', startedAt: null }))), handlersFor([]))
    expect(await textOf(queued)).toContain('queued 5 min ago')
  })

  test('says the attempt after the first, and leaves out a missing branch or actor', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ attempt: 2, branch: null, actor: null }))), handlersFor([]))
    expect(await textOf(ui)).toContain('push · abcdef0 · attempt 2')
  })

  test('jobs with a url are keyed buttons that open it', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf(), [jobOf({ url: 'https://ci/job/1' }), jobOf({ jobId: 2, name: 'docs' })])), handlersFor(calls))
    expect((await keysOf(ui)).filter((key) => key.startsWith('job-'))).toEqual(['job-0'])
    await ui.press({ key: 'job-0' })
    expect(calls).toEqual(['openUrl https://ci/job/1'])
  })

  test('says so when the run has no jobs', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf())), handlersFor([]))
    expect(await textOf(ui)).toContain('no jobs reported')
  })

  test('retry failed and fix ci appear only for a failed or timed-out run', async ($, on) => {
    const rig = createRig(on)
    const keysFor = async (state: CheckState) => {
      const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ state }))), handlersFor([]))
      return (await keysOf(ui)).filter((key) => key === 'run-rerun' || key === 'run-fix')
    }
    expect(await keysFor('failure')).toEqual(['run-rerun', 'run-fix'])
    expect(await keysFor('timed-out')).toEqual(['run-rerun', 'run-fix'])
    for (const state of ['success', 'running', 'queued', 'cancelled', 'skipped'] as const) expect(await keysFor(state)).toEqual([])
  })

  test('the buttons call their handlers with the run id', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const ui = await rig.draw($, 'desktop', viewOf(snapshotOf(runOf({ state: 'failure' }))), handlersFor(calls))
    for (const key of ['run-900', 'back', 'pane-list', 'run-open', 'run-copy', 'run-refresh', 'run-rerun', 'run-fix']) await ui.press({ key })
    expect(calls).toEqual(['refresh', 'back', 'back', 'openUrl https://github.com/acme/app/actions/runs/900', 'copy https://github.com/acme/app/actions/runs/900', 'refresh', 'rerun 900', 'fix 900'])
    const hotkeys = (await ui.findAll({ type: 'Button' })).flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))
    expect(hotkeys).toEqual(['b', 'l', 'o', 'c', 'r', 't', 'f'])
  })

  test('shows the outcome of the last rerun', async ($, on) => {
    const rig = createRig(on)
    const outcome: ActionOutcome = { kind: 'merge', isOk: true, message: 'Re-running failed jobs', at: '2026-10-12T11:59:00Z' }
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ state: 'failure' })), 80, outcome), handlersFor([]))
    expect(await textOf(ui)).toContain('✓ Re-running failed jobs · 1 min ago')
    const failed = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ state: 'failure' })), 80, { ...outcome, isOk: false, message: 'denied' }), handlersFor([]))
    expect(await textOf(failed)).toContain('✗ denied · 1 min ago')
  })

  test('loading, error and stale states', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const loading = await rig.draw($, 'terminal', viewOf({ kind: 'loading', at: '2026-10-12T11:59:00Z', runId: 900 }), handlersFor(calls))
    expect(await textOf(loading)).toContain('Loading run 900…')
    expect((await keysOf(loading)).sort()).toEqual(['back', 'pane-list', 'refresh'])

    const problem: Problem = { reason: '504', since: '2026-10-12T11:50:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 30000 }
    const error = await rig.draw($, 'desktop', viewOf({ kind: 'error', at: '2026-10-12T11:59:00Z', runId: 900, message: 'run not found', problem }), handlersFor(calls))
    expect(await textOf(error)).toContain('Could not read run 900: run not found, retrying in 20 s')
    await error.press({ key: 'pane-list' })
    expect(calls).toEqual(['back'])

    const stale = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf(), [], problem)), handlersFor(calls))
    expect(await textOf(stale)).toContain('showing last data from 2 min ago, GitHub unavailable (504), retrying in 20 s')
  })

  test('never exceeds the columns, and keys are unique', async ($, on) => {
    const rig = createRig(on)
    const long = 'a-very-long-job-name-that-keeps-going-and-going-and-going-and-going-and-going'
    const jobs = [jobOf({ name: long, url: 'https://ci/1', state: 'failure', failedStep: long }), jobOf({ jobId: 2, name: long, url: 'https://ci/2' })]
    for (const columns of [40, 80, 160]) {
      const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(runOf({ name: long, state: 'failure' }), jobs), columns), handlersFor([]))
      for (const row of rowsOf(await ui.drawn())) {
        for (const piece of row.split('  ')) expect(cellWidth(piece)).toBeLessThanOrEqual(columns)
      }
      const keys = await keysOf(ui)
      expect(new Set(keys).size).toBe(keys.length)
      await ui.unmount()
    }
  })
})

describe('the run detail header title', () => {
  const swapped = { color: '#30363d', backgroundColor: '#e6edf3' }
  type Piece = { props?: Record<string, unknown>; hover?: unknown }

  test('is the Button text; pre-swapped with the same hover while it holds the ring, normal plus hover otherwise', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const base = viewOf(snapshotOf(runOf()))
      const focused = await rig.draw($, surface, { ...base, focusedKey: 'run-900' }, handlersFor([]))
      const on1 = (await focused.find({ key: 'run-900' })) as { props: Record<string, unknown>; children: Piece[] }
      expect(on1.props.label).toBe('#12 CI')
      expect(on1.children).toHaveLength(1)
      expect(on1.children[0]?.props).toMatchObject(swapped)
      expect(on1.children[0]?.hover).toEqual(swapped)
      await focused.unmount()
      for (const focusedKey of [null, 'tab-actions', 'back']) {
        const rest = await rig.draw($, surface, { ...base, focusedKey }, handlersFor([]))
        const off = (await rest.find({ key: 'run-900' })) as { children: Piece[] }
        expect(off.children[0]?.props?.color).toBeUndefined()
        expect(off.children[0]?.props?.backgroundColor).toBeUndefined()
        expect(off.children[0]?.hover).toEqual(swapped)
        await rest.unmount()
      }
    }
  })

  test('sits alone in a Box keyed head-run-900', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.draw($, 'terminal', { ...viewOf(snapshotOf(runOf())), focusedKey: 'run-900' }, handlersFor([]))
    const box = (await ui.find({ key: 'head-run-900' })) as { type: string; children: { type: string; key?: unknown }[] }
    expect(box.type).toBe('Box')
    expect(box.children.map((child) => child.type)).toEqual(['Button'])
    await ui.press({ key: 'run-900' })
    await ui.unmount()
  })
})
