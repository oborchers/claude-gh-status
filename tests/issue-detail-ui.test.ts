import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Issue, IssueComment, IssueSnapshot, Problem } from '../src/model'
import { PALETTES, mutedLabelColor } from '../src/ui/colors'
import type { IssueDetailView, RepoHandlers } from '../src/ui/contract'
import { cellWidth } from '../src/ui/format'
import { MAX_BODY_LINES, MAX_COMMENT_LINES, cutLines, renderIssueDetail } from '../src/ui/issue-detail'
import { makeLocation } from './fixtures/pr-builder'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
type Mounted = Pick<MountedOf<Surface, 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'unmount'>

const account = { login: 'me', source: 'active' } as const

function comment(author: string, body: string, extra: Partial<IssueComment> = {}): IssueComment {
  return { author, isBot: false, createdAt: '2026-10-12T10:00:00Z', editedAt: null, body, url: `https://github.com/acme/app/issues/5#c-${author}`, ...extra }
}

function issueOf(extra: Partial<Issue> = {}): Issue {
  return {
    id: 'I_5',
    number: 5,
    title: 'Crash on start',
    url: 'https://github.com/acme/app/issues/5',
    state: 'open',
    stateReason: null,
    author: 'anna',
    createdAt: '2026-10-12T10:00:00Z',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: ['ben', 'cy'],
    milestone: 'v2',
    body: 'It crashes.\n\nSteps:\n1. start',
    linkedPrs: [],
    comments: [],
    commentCount: 0,
    ...extra,
  }
}

function snapshotOf(issue: Issue, stale: Problem | null = null): IssueSnapshot {
  return { kind: 'issue', at: '2026-10-12T11:58:00Z', location: makeLocation(), account, issue, stale }
}

function viewOf(snapshot: IssueSnapshot, columns = 80): IssueDetailView {
  return { snapshot, nowMs: NOW, columns, palette: PALETTES.claude }
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

type Current = { view: IssueDetailView; handlers: RepoHandlers }

function createRig(on: On) {
  let current: Current | null = null
  let serial = 0
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (current === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return renderIssueDetail($.ui.resolve(e), current.view, current.handlers)
  })
  return {
    draw($: Engine, surface: Surface, view: IssueDetailView, handlers: RepoHandlers): Promise<Mounted> {
      current = { view: { ...view, surface }, handlers }
      const props = { title: 'Issue', isFocused: true, bodyColumns: view.columns, placement: 'inline' }
      return $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: `issue-${(serial += 1)}`, props: props as never })
    },
  }
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function rowsOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  const element = node as Node
  const props = element.props ?? {}
  const children = element.children ?? []
  if (element.type === 'Markdown') return String(props.text ?? '').split('\n')
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
const keysOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Button' })).map((button) => String(button.key))

describe('cutLines', () => {
  test('keeps short text and cuts long text at the line, dropping trailing blanks', () => {
    expect(cutLines('a\nb\n\n', 5)).toEqual({ text: 'a\nb', isCut: false })
    expect(cutLines('a\nb\nc\nd', 2)).toEqual({ text: 'a\nb', isCut: true })
  })
})

describe('the issue detail', () => {
  test('draws the header, facts, description and footer on both surfaces', async ($, on) => {
    const rig = createRig(on)
    for (const surface of SURFACES) {
      const ui = await rig.draw($, surface, viewOf(snapshotOf(issueOf())), handlersFor([]))
      const text = await textOf(ui)
      for (const expected of [' open ', '#5 Crash on start', 'b: back to list', 'l: list', '@anna · opened 2 h ago', 'bug', 'assignees: @ben, @cy', 'milestone: v2', '── Description', 'It crashes.', '── Comments (0)', 'no comments yet', 'o: github', 'c: copy url', 'r: refresh']) {
        expect(text).toContain(expected)
      }
      await ui.unmount()
    }
  })

  test('leaves out assignees, milestone and labels when there are none', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf({ assignees: [], milestone: null, labels: [], body: '' }))), handlersFor([]))
    const text = await textOf(ui)
    expect(text).not.toContain('assignees')
    expect(text).not.toContain('milestone')
    expect(text).toContain('no description')
  })

  test('the label color is muted', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf())), handlersFor([]))
    expect(JSON.stringify(await ui.drawn())).toContain(mutedLabelColor('d73a4a'))
  })

  test('the state badge: green open, merged-purple closed, grey not planned', async ($, on) => {
    const rig = createRig(on)
    const colorOf = async (issue: Issue) => {
      const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issue)), handlersFor([]))
      return JSON.stringify(await ui.drawn())
    }
    expect(await colorOf(issueOf())).toContain(`"backgroundColor":"${PALETTES.claude.badgeOpen}"`)
    const done = await colorOf(issueOf({ state: 'closed', stateReason: 'completed' }))
    expect(done).toContain(`"backgroundColor":"${PALETTES.claude.badgeMerged}"`)
    expect(done).toContain(' closed ')
    expect(await colorOf(issueOf({ state: 'closed', stateReason: 'not-planned' }))).toContain(`"backgroundColor":"${PALETTES.claude.badgeDraft}"`)
  })

  test('the title button refreshes; back and list go back; the footer opens, copies and refreshes', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf())), handlersFor(calls))
    for (const key of ['issue-5', 'back', 'pane-list', 'issue-open', 'issue-copy', 'issue-refresh']) await ui.press({ key })
    expect(calls).toEqual(['refresh', 'back', 'back', 'openUrl https://github.com/acme/app/issues/5', 'copy https://github.com/acme/app/issues/5', 'refresh'])
    const hotkeys = (await ui.findAll({ type: 'Button' })).flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))
    expect(hotkeys).toEqual(['b', 'l', 'o', 'c', 'r'])
  })

  test('linked pull requests are keyed buttons; merged in the merged color, closed dim', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const linkedPrs = [
      { number: 8, title: 'Fix', state: 'merged' as const },
      { number: 9, title: 'Try', state: 'closed' as const },
      { number: 10, title: 'Again', state: 'open' as const },
    ]
    const ui = await rig.draw($, 'desktop', viewOf(snapshotOf(issueOf({ linkedPrs }))), handlersFor(calls))
    expect(await textOf(ui)).toContain('── Linked pull requests')
    expect((await keysOf(ui)).filter((key) => key.startsWith('linked-pr-'))).toEqual(['linked-pr-8', 'linked-pr-9', 'linked-pr-10'])
    expect(JSON.stringify(await ui.find({ key: 'linked-pr-8' }))).toContain(PALETTES.claude.merged)
    expect(JSON.stringify(await ui.find({ key: 'linked-pr-9' }))).toContain('"dimColor":true')
    await ui.press({ key: 'linked-pr-9' })
    expect(calls).toEqual(['pr 9'])
  })

  test('draws no linked pull request section without any', async ($, on) => {
    const rig = createRig(on)
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf())), handlersFor([]))
    expect(await textOf(ui)).not.toContain('Linked pull requests')
  })

  test('cuts a long description at 40 lines with a hint', async ($, on) => {
    const rig = createRig(on)
    const body = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf({ body }))), handlersFor([]))
    const markdown = await ui.find({ type: 'Markdown' })
    expect(String(markdown?.props.text).split('\n')).toHaveLength(MAX_BODY_LINES)
    expect(await textOf(ui)).toContain('… more on GitHub (o)')
    const short = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf())), handlersFor([]))
    expect(await textOf(short)).not.toContain('more on GitHub')
  })

  test('comments: author and age, bots dim, long bodies cut, earlier ones counted', async ($, on) => {
    const rig = createRig(on)
    const long = Array.from({ length: 30 }, (_, index) => `row ${index + 1}`).join('\n')
    const comments = [comment('ben', 'Same here'), comment('ci[bot]', 'build ok', { isBot: true, createdAt: '2026-10-12T11:30:00Z' }), comment('cy', long)]
    const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf({ comments, commentCount: 13 }))), handlersFor([]))
    const text = await textOf(ui)
    expect(text).toContain('── Comments (13)')
    expect(text).toContain('… 10 earlier on GitHub')
    expect(text).toContain('@ben · 2 h ago')
    expect(text).toContain('@ci[bot] · 30 min ago')
    const markdowns = await ui.findAll({ type: 'Markdown' })
    expect(markdowns).toHaveLength(4)
    expect(markdowns[2]?.props.dimColor).toBe(true)
    expect(markdowns[1]?.props.dimColor).toBeUndefined()
    expect(String(markdowns[3]?.props.text).split('\n')).toHaveLength(MAX_COMMENT_LINES)
    expect(text).toContain('… more on GitHub')
  })

  test('loading, error and stale states', async ($, on) => {
    const rig = createRig(on)
    const calls: string[] = []
    const loading = await rig.draw($, 'terminal', viewOf({ kind: 'loading', at: '2026-10-12T11:59:00Z', number: 5 }), handlersFor(calls))
    expect(await textOf(loading)).toContain('Loading issue #5…')
    expect((await keysOf(loading)).sort()).toEqual(['back', 'pane-list', 'refresh'])

    const problem: Problem = { reason: '504', since: '2026-10-12T11:50:00Z', triedAt: '2026-10-12T11:59:50Z', retryInMs: 30000 }
    const error = await rig.draw($, 'desktop', viewOf({ kind: 'error', at: '2026-10-12T11:59:00Z', number: 5, message: '#5 is not an issue', problem }), handlersFor(calls))
    const errorText = await textOf(error)
    expect(errorText).toContain('Could not read issue #5: #5 is not an issue, retrying in 20 s')
    await error.press({ key: 'back' })
    expect(calls).toEqual(['back'])

    const stale = await rig.draw($, 'terminal', viewOf(snapshotOf(issueOf(), problem)), handlersFor(calls))
    const staleText = await textOf(stale)
    expect(staleText).toContain('showing last data from 2 min ago, GitHub unavailable (504), retrying in 20 s')
    expect(staleText).toContain('#5 Crash on start')
  })

  test('never exceeds the columns, and keys are unique', async ($, on) => {
    const rig = createRig(on)
    const long = 'a-very-long-title-that-keeps-going-and-going-and-going-and-going-and-going'
    const issue = issueOf({ title: long, linkedPrs: [{ number: 8, title: long, state: 'open' }], milestone: long, assignees: [long] })
    for (const columns of [40, 80, 160]) {
      const ui = await rig.draw($, 'terminal', viewOf(snapshotOf(issue), columns), handlersFor([]))
      for (const row of rowsOf(await ui.drawn())) {
        for (const piece of row.split('  ')) expect(cellWidth(piece)).toBeLessThanOrEqual(columns)
      }
      const keys = await keysOf(ui)
      expect(new Set(keys).size).toBe(keys.length)
      await ui.unmount()
    }
  })
})
