import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On } from 'claude-code'

import { buildPending, withMethod } from '../src/actions'
import type { PendingAction, PullRequest, Snapshot } from '../src/model'
import { deriveStatus } from '../src/status'
import { PALETTES } from '../src/ui/colors'
import { confirmButton, confirmTitle, renderConfirm } from '../src/ui/confirm'
import type { Handlers, View } from '../src/ui/contract'
import { makeCheck, makeLocation, makePr, makeSnapshot } from './fixtures/pr-builder'

const OID = '14c6306aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const base = { prNumber: 1, repo: 'acme/app', prId: 'PR_node', baseRefName: 'main', login: 'me', openedAt: 0 }
const NOW = Date.parse('2026-01-01T00:10:00Z')

const blockedPr = (overrides: Partial<PullRequest> = {}): PullRequest =>
  makePr({
    number: 1,
    title: 'add the write actions',
    baseRefName: 'main',
    headOid: '14c6306aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    mergeStateStatus: 'blocked',
    reviewDecision: 'review-required',
    reviewRequests: [{ reviewer: 'ben', isTeam: false }],
    checks: [makeCheck({ name: 'lint', state: 'failure', isRequired: true })],
    viewerCanMergeAsAdmin: true,
    ...overrides,
  })

function viewFor(snapshot: Snapshot, outcome: View['outcome'] = null): View {
  const status = snapshot.kind === 'pr' ? deriveStatus(snapshot.pr, snapshot.account.login, null) : null
  return { snapshot, status, jobs: [], nowMs: NOW, columns: 100, palette: PALETTES.claude, outcome, pending: null }
}

function pendingFor(kind: PendingAction['kind'], pr: PullRequest): { pending: PendingAction; view: View } {
  const snapshot = makeSnapshot(pr)
  const pending = buildPending(kind, snapshot)
  if (pending === null) throw new Error(`${kind} is not offered`)
  return { pending, view: viewFor(snapshot) }
}

type Calls = string[]

function handlersFor(calls: Calls): Handlers {
  return {
    refresh: () => {},
    openPane: () => {},
    closePane: () => {},
    openOnGitHub: () => {},
    copyUrl: () => {},
    openUrl: () => {},
    confirmPending: isSecondStep => void calls.push(`confirmPending ${String(isSecondStep)}`),
    cancelPending: () => void calls.push('cancelPending'),
    selectMethod: method => void calls.push(`selectMethod ${method}`),
  }
}

type Mounted = Pick<MountedOf<'terminal', 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'select' | 'unmount'>

/** Draws the dialog through the real element table, the way the pane hook does. */
function createRig(on: On) {
  let current: { view: View; pending: PendingAction; handlers: Handlers } | null = null
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (current === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return renderConfirm($.ui.resolve(e), current.view, current.pending, current.handlers)
  })
  return {
    show($: Engine, view: View, pending: PendingAction, handlers: Handlers): Promise<Mounted> {
      current = { view, pending, handlers }
      const props = { title: 'Confirm', isFocused: true, bodyColumns: view.columns, placement: 'inline' }
      return $.ui.mount({ plugin: 'test', surface: 'terminal', component: 'Pane', requestId: 'confirm', props: props as never })
    },
  }
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function rowsOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  const element = node as Node
  const props = element.props ?? {}
  const children = element.children ?? []
  if (element.type === 'Button') {
    const text = String(props.label ?? '')
    return [props.hotkey !== undefined ? `[${String(props.hotkey)}: ${text}]` : `[${text}]`]
  }
  if (element.type === 'Select') {
    const options = (props.options as { value: string }[]).map(option => option.value).join('|')
    return [`${String(props.label ?? '')}<${options}> ${String(props.value)}`]
  }
  const parts = children.map(child => rowsOf(child))
  if (props.flexDirection === 'column') return parts.flat()
  return [parts.map(lines => lines.join('\n')).join(' '.repeat(Number(props.columnGap ?? 0)))]
}

/** The color of the first Text whose own content contains `text`. */
function colorOf(node: unknown, text: string): unknown {
  if (typeof node === 'string') return undefined
  const element = node as Node
  if (element.type === 'Text' && (element.children ?? []).some(child => typeof child === 'string' && child.includes(text))) return element.props?.color
  for (const child of element.children ?? []) {
    const found = colorOf(child, text)
    if (found !== undefined) return found
  }
  return undefined
}

const textOf = async (ui: Mounted): Promise<string> => rowsOf(await ui.drawn()).join('\n')
const hotkeysOf = (buttons: { props: Record<string, unknown> }[]) => buttons.flatMap(button => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))

describe('the merge dialog', () => {
  test('names the action, the PR, the commit, the method and the account', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = pendingFor('merge', makePr({ number: 1, title: 'add the write actions', baseRefName: 'main', headOid: '14c6306aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', allowedMethods: ['squash'] }))
    const ui = await rig.show($, view, pending, handlersFor([]))
    expect(await textOf(ui)).toBe(
      ['Merge acme/app #1 into main', 'add the write actions', 'head 14c6306 · as @me', 'Method: squash', '[y: merge #1 (squash)]  [n: cancel]', 'press y to confirm, n to cancel'].join('\n'),
    )
  })

  test('confirm is the primary button on y, cancel is n', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = pendingFor('merge', makePr())
    const ui = await rig.show($, view, pending, handlersFor([]))
    const confirm = await ui.find({ key: 'confirm' })
    expect(confirm?.props).toMatchObject({ hotkey: 'y', plain: true, label: 'merge #42 (squash)' })
    expect((await ui.find({ key: 'cancel' }))?.props).toMatchObject({ hotkey: 'n', label: 'cancel' })
    expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['y', 'n'])
  })

  test('more than one allowed method draws a Select, picking calls selectMethod', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const { pending, view } = pendingFor('merge', makePr())
    const ui = await rig.show($, view, pending, handlersFor(calls))
    expect(await textOf(ui)).toContain('Method<merge|squash|rebase> squash')
    await ui.select({ key: 'method', value: 'rebase' })
    expect(calls).toEqual(['selectMethod rebase'])
  })

  test('a single allowed method is plain text, not a Select', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = pendingFor('merge', makePr({ allowedMethods: ['rebase'] }))
    const ui = await rig.show($, view, pending, handlersFor([]))
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    expect(await textOf(ui)).toContain('Method: rebase')
  })

  test('the confirm and cancel presses reach the handlers', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const { pending, view } = pendingFor('merge', makePr())
    const ui = await rig.show($, view, pending, handlersFor(calls))
    await ui.press({ key: 'cancel' })
    await ui.press({ key: 'confirm' })
    expect(calls).toEqual(['cancelPending', 'confirmPending false'])
  })

  test('shows the last error in the failure color, and only a failed one', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = pendingFor('merge', makePr())
    const failed = { ...view, outcome: { kind: 'merge' as const, isOk: false, message: 'Pull request is not mergeable', at: '2026-01-01T00:09:00Z' } }
    const ui = await rig.show($, failed, pending, handlersFor([]))
    expect(await textOf(ui)).toContain('✗ Pull request is not mergeable')
    expect(colorOf(await ui.drawn(), 'Pull request is not mergeable')).toBe(PALETTES.claude.failure)
    await ui.unmount()

    const ok = { ...view, outcome: { kind: 'merge' as const, isOk: true, message: 'PR #42 merged', at: '2026-01-01T00:09:00Z' } }
    const quiet = await rig.show($, ok, pending, handlersFor([]))
    expect(await textOf(quiet)).not.toContain('PR #42 merged')
  })

  test('the title names owner/repo, number and base branch from the pending action', () => {
    const pending = buildPending('merge', makeSnapshot(makePr({ number: 3, baseRefName: 'release' }), makeLocation({ owner: 'acme', repo: 'app' })))
    if (pending === null) throw new Error('merge')
    expect(confirmTitle(pending)).toBe('Merge acme/app #3 into release')
  })

  test('warns when the head moved since the dialog opened', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = pendingFor('merge', makePr({ headOid: 'a'.repeat(40) }))
    const snapshot = view.snapshot
    if (snapshot.kind !== 'pr') throw new Error('expected a pr')
    const moved = viewFor({ ...snapshot, pr: { ...snapshot.pr, headOid: 'b'.repeat(40) } })
    const ui = await rig.show($, moved, pending, handlersFor([]))
    expect(await textOf(ui)).toContain('new commits since you asked to confirm, review again')
  })
})

describe('the admin dialog', () => {
  const admin = () => pendingFor('admin-merge', blockedPr())

  test('step 1 lists the bypassed rules in the failure color and asks to continue on y', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = admin()
    const ui = await rig.show($, view, pending, handlersFor([]))
    expect(await textOf(ui)).toBe(
      [
        'Admin merge acme/app #1 into main (step 1 of 2)',
        'add the write actions',
        'head 14c6306 · as @me',
        'Method<merge|squash|rebase> squash',
        'This bypasses:',
        '• lint failed (required)',
        '• review required: @ben',
        '[y: continue]  [n: cancel]',
        'press y to confirm, n to cancel',
      ].join('\n'),
    )
    expect(colorOf(await ui.drawn(), 'review required: @ben')).toBe(PALETTES.claude.failure)
    expect(colorOf(await ui.drawn(), 'lint failed (required)')).toBe(PALETTES.claude.failure)
  })

  test('step 2 is a separate confirmation on b, with no y button', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = admin()
    if (pending.kind !== 'admin-merge') throw new Error('expected admin')
    const ui = await rig.show($, view, { ...pending, isSecondStep: true }, handlersFor([]))
    expect(await textOf(ui)).toBe(
      [
        'Final confirmation: bypass rules and merge acme/app #1',
        'add the write actions',
        'head 14c6306 · as @me',
        'Method: squash',
        'Bypassing, and this cannot be undone:',
        '• lint failed (required)',
        '• review required: @ben',
        '[b: bypass and merge #1]  [n: cancel]',
        'press b to bypass and merge, n to cancel',
      ].join('\n'),
    )
    expect(hotkeysOf(await ui.findAll({ type: 'Button' }))).toEqual(['b', 'n'])
  })

  test('each step passes its own number to confirmPending', async ($, on) => {
    const rig = createRig(on)
    const calls: Calls = []
    const { pending, view } = admin()
    if (pending.kind !== 'admin-merge') throw new Error('expected admin')
    const first = await rig.show($, view, pending, handlersFor(calls))
    await first.press({ key: 'confirm' })
    await first.unmount()
    const second = await rig.show($, view, { ...pending, isSecondStep: true }, handlersFor(calls))
    expect(await second.find({ key: 'confirm' })).toBeUndefined()
    await second.press({ key: 'confirm-final' })
    expect(calls).toEqual(['confirmPending false', 'confirmPending true'])
  })

  test('a queue-enabled repository lists the merge queue as a bypassed rule', async ($, on) => {
    const rig = createRig(on)
    const { pending, view } = pendingFor('admin-merge', makePr({ isMergeQueueEnabled: true, viewerCanMergeAsAdmin: true }))
    const ui = await rig.show($, view, pending, handlersFor([]))
    expect(await textOf(ui)).toContain('• merge queue')
  })
})

describe('the other dialogs', () => {
  test('titles and button labels name the action', () => {
    const snapshot = makeSnapshot(makePr({ number: 7, isMergeQueueEnabled: true, autoMerge: null }))
    const enqueue = buildPending('enqueue', snapshot)
    if (enqueue === null) throw new Error('enqueue')
    expect(confirmTitle(enqueue)).toBe('Add acme/app #7 to the merge queue of main')
    expect(confirmButton(enqueue)).toEqual({ hotkey: 'y', label: 'add #7 to queue' })

    const dequeue: PendingAction = { ...base, kind: 'dequeue', prNumber: 7 }
    expect(confirmTitle(dequeue)).toBe('Remove acme/app #7 from the merge queue')
    expect(confirmButton(dequeue).label).toBe('remove #7 from queue')

    const on: PendingAction = { ...base, kind: 'auto-merge-on', prNumber: 7, headOid: OID, method: 'merge' }
    expect(confirmTitle(on)).toBe('Enable auto-merge for acme/app #7 into main')
    expect(confirmButton(on).label).toBe('enable auto-merge #7 (merge)')

    const off: PendingAction = { ...base, kind: 'auto-merge-off', prNumber: 7 }
    expect(confirmTitle(off)).toBe('Disable auto-merge for acme/app #7')
    expect(confirmButton(off).label).toBe('disable auto-merge #7')
  })

  test('the method select applies to merge and auto-merge, and not to the second admin step', () => {
    const allowed = ['merge', 'squash', 'rebase'] as const
    const merge: PendingAction = { ...base, kind: 'merge', headOid: OID, method: 'squash' }
    expect(withMethod(merge, 'rebase', allowed)).toMatchObject({ method: 'rebase' })
    const second: PendingAction = { ...base, kind: 'admin-merge', headOid: OID, method: 'squash', bypassed: [], isSecondStep: true }
    expect(withMethod(second, 'rebase', allowed)).toBe(second)
    expect(withMethod(merge, 'rebase', ['squash'])).toBe(merge)
    const dequeue: PendingAction = { ...base, kind: 'dequeue' }
    expect(withMethod(dequeue, 'merge', allowed)).toBe(dequeue)
  })
})
