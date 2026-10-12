// The confirmation: what a write action will do, to which pull request and
// commit, as which account, and the keys that confirm or cancel it. It is drawn
// inline in the pane's Merge section (the band has its own one-line version).
// Drawing only; the press handlers come from register.tsx and nothing here writes.

import type { RenderElement } from 'claude-code'

import type { MergeMethod, PendingAction, PullRequest } from '../model'
import { shortSha } from '../status'
import { HEAD_CHANGED } from '../actions'
import { truncate } from './format'
import type { Handlers, UiTable, View } from './contract'

const CONFIRM_HOTKEY = 'y'
const FINAL_HOTKEY = 'b'
const CANCEL_HOTKEY = 'n'

/** Kinds that carry a merge method. */
const hasMethod = (pending: PendingAction): pending is Extract<PendingAction, { method: MergeMethod }> => 'method' in pending

/** The first line of the confirmation: the action, `owner/repo #N` and the base branch. */
export function confirmTitle(pending: PendingAction): string {
  const target = `${pending.repo} #${pending.prNumber}`
  const base = pending.baseRefName
  switch (pending.kind) {
    case 'merge':
      return `Merge ${target} into ${base}`
    case 'admin-merge':
      return pending.isSecondStep ? `Final confirmation: bypass rules and merge ${target}` : `Admin merge ${target} into ${base} (step 1 of 2)`
    case 'enqueue':
      return `Add ${target} to the merge queue of ${base}`
    case 'dequeue':
      return `Remove ${target} from the merge queue`
    case 'auto-merge-on':
      return `Enable auto-merge for ${target} into ${base}`
    case 'auto-merge-off':
      return `Disable auto-merge for ${target}`
  }
}

/** The confirm button's label and hotkey. */
export function confirmButton(pending: PendingAction): { hotkey: string; label: string } {
  const number = `#${pending.prNumber}`
  switch (pending.kind) {
    case 'merge':
      return { hotkey: CONFIRM_HOTKEY, label: `merge ${number} (${pending.method})` }
    case 'admin-merge':
      return pending.isSecondStep ? { hotkey: FINAL_HOTKEY, label: `bypass and merge ${number}` } : { hotkey: CONFIRM_HOTKEY, label: 'continue' }
    case 'enqueue':
      return { hotkey: CONFIRM_HOTKEY, label: `add ${number} to queue` }
    case 'dequeue':
      return { hotkey: CONFIRM_HOTKEY, label: `remove ${number} from queue` }
    case 'auto-merge-on':
      return { hotkey: CONFIRM_HOTKEY, label: `enable auto-merge ${number} (${pending.method})` }
    case 'auto-merge-off':
      return { hotkey: CONFIRM_HOTKEY, label: `disable auto-merge ${number}` }
  }
}

/** The confirmation content for a pending action. */
export function renderConfirm(table: UiTable, view: View, pending: PendingAction, handlers: Handlers): RenderElement {
  const { Box, Button, Select, Text } = table
  const columns = Math.max(20, view.columns)
  const snapshot = view.snapshot
  const pr: PullRequest | null = snapshot.kind === 'pr' && snapshot.pr.number === pending.prNumber ? snapshot.pr : null
  const isSecondStep = pending.kind === 'admin-merge' && pending.isSecondStep
  const rows: RenderElement[] = []
  const line = (text: string, color?: string, isBold?: boolean, isDim?: boolean) =>
    rows.push(
      <Text color={color} bold={isBold} dimColor={isDim} wrap="truncate-end">
        {truncate(text, columns)}
      </Text>,
    )

  line(confirmTitle(pending), undefined, true)
  if (pr !== null) line(pr.title)
  line(`head ${shortSha(pending.kind === 'dequeue' || pending.kind === 'auto-merge-off' ? (pr?.headOid ?? '') : pending.headOid)} · as @${pending.login}`, undefined, false, true)

  if (hasMethod(pending)) {
    const allowed = pr?.allowedMethods ?? []
    if (allowed.length > 1 && !isSecondStep) {
      rows.push(
        <Box flexDirection="row">
          <Select key="method" label="Method" value={pending.method} options={allowed.map(method => ({ value: method, label: method }))} onSelect={value => handlers.selectMethod(value as MergeMethod)} />
        </Box>,
      )
    } else {
      line(`Method: ${pending.method}`)
    }
  }

  if (pending.kind === 'admin-merge') {
    line(isSecondStep ? 'Bypassing, and this cannot be undone:' : 'This bypasses:', view.palette.failure, true)
    for (const rule of pending.bypassed) line(`• ${rule.text}`, view.palette.failure)
  }

  if (pr !== null && 'headOid' in pending && pending.headOid !== pr.headOid) line(HEAD_CHANGED, view.palette.failure, true)
  const outcome = view.outcome
  if (outcome !== null && !outcome.isOk) line(`✗ ${outcome.message}`, view.palette.failure, true)

  const confirm = confirmButton(pending)
  rows.push(
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Button key={isSecondStep ? 'confirm-final' : 'confirm'} plain hotkey={confirm.hotkey} label={confirm.label} onPress={() => handlers.confirmPending(isSecondStep)} />
      <Button key="cancel" plain hotkey={CANCEL_HOTKEY} label="cancel" onPress={() => handlers.cancelPending()} />
    </Box>,
  )
  line(`press ${confirm.hotkey} to ${isSecondStep ? 'bypass and merge' : 'confirm'}, ${CANCEL_HOTKEY} to cancel`, undefined, false, true)
  return <Box flexDirection="column">{rows}</Box>
}

/** Rows renderConfirm draws for a pending action, for sizing the pane. */
export function confirmRowCount(view: View, pending: PendingAction): number {
  const snapshot = view.snapshot
  const pr = snapshot.kind === 'pr' && snapshot.pr.number === pending.prNumber ? snapshot.pr : null
  let rows = 2 + (pr !== null ? 1 : 0)
  if (hasMethod(pending)) rows += 1
  if (pending.kind === 'admin-merge') rows += 1 + pending.bypassed.length
  if (pr !== null && 'headOid' in pending && pending.headOid !== pr.headOid) rows += 1
  if (view.outcome !== null && !view.outcome.isOk) rows += 1
  const confirm = confirmButton(pending)
  const buttonsWidth = confirm.hotkey.length + 2 + confirm.label.length + 2 + CANCEL_HOTKEY.length + 2 + 'cancel'.length
  rows += buttonsWidth > Math.max(20, view.columns) ? 2 : 1
  return rows + 1
}
