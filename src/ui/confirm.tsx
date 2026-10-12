// The confirmation: what a write action will do, to which pull request and
// commit, as which account, and the keys that confirm or cancel it. It is drawn
// inline in the pane's Merge section (the band has its own one-line version).
// Drawing only; the press handlers come from register.tsx and nothing here writes.

import type { RenderElement } from 'claude-code'

import type { MergeMethod, PendingAction, PullRequest } from '../model'
import { shortSha } from '../status'
import { HEAD_CHANGED, reviewText } from '../actions'
import { cellWidth, truncate } from './format'
import type { Handlers, UiTable, View } from './contract'

const CONFIRM_HOTKEY = 'y'
const FINAL_HOTKEY = 'b'
const CANCEL_HOTKEY = 'n'

/** The review text field's address, for tests and the ui.input event. */
export const REVIEW_INPUT_KEY = 'review-body'
const NO_COMMENT = '(no comment)'

type ReviewPending = Extract<PendingAction, { kind: 'approve' | 'request-changes' }>

/** Kinds that carry review text, typed into the field the confirmation draws. */
export const isReview = (pending: PendingAction): pending is ReviewPending => pending.kind === 'approve' || pending.kind === 'request-changes'

/** The text that will be posted, exactly; empty means no comment. */
export const postedText = (pending: ReviewPending): string => reviewText(pending.kind, pending.body)

export const BAND_TEXT_TOO_LONG = 'review text too long for the band, confirm in the pane'
const BAND_TEXT_PREFIX = 'post: '

/** What the band's second row says: `<owner>/<repo> #N · head <sha7> · @login`. */
export function confirmDetails(view: View, pending: PendingAction): string {
  const snapshot = view.snapshot
  const pr = snapshot.kind === 'pr' && snapshot.pr.number === pending.prNumber ? snapshot.pr : null
  const oid = 'headOid' in pending ? pending.headOid : (pr?.headOid ?? '')
  return `${pending.repo} #${pending.prNumber} · head ${oid === '' ? '-' : shortSha(oid)} · @${pending.login}`
}

/**
 * The band's row for a review's text, or null for other kinds. `text` is exactly
 * what would be posted; `isShown` is false when it cannot be shown whole in one row,
 * and then the band offers no confirm for it.
 */
export function bandReviewRow(pending: PendingAction, columns: number): { text: string; isShown: boolean; isDim: boolean } | null {
  if (!isReview(pending)) return null
  const text = postedText(pending)
  if (pending.kind === 'request-changes' && text.trim() === '') return { text: 'write what should change first, in the pane', isShown: false, isDim: false }
  if (text === '') return { text: NO_COMMENT, isShown: true, isDim: true }
  const room = Math.max(1, columns - cellWidth(BAND_TEXT_PREFIX))
  if (text.includes('\n') || text.includes('\r') || cellWidth(text) > room) return { text: BAND_TEXT_TOO_LONG, isShown: false, isDim: false }
  return { text, isShown: true, isDim: false }
}

export const BAND_TEXT_ROW_PREFIX = BAND_TEXT_PREFIX

/** Rows the posted text takes once wrapped at `columns`, one at least. */
function postedRows(pending: ReviewPending, columns: number): number {
  const text = postedText(pending)
  if (text === '') return 1
  return text.split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(cellWidth(part) / columns)), 0)
}

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
    case 'approve':
      return `Approve ${target}`
    case 'request-changes':
      return `Request changes on ${target}`
    case 'ready-for-review':
      return `Mark ${target} ready for review`
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
    case 'approve':
      return { hotkey: CONFIRM_HOTKEY, label: `approve ${number}` }
    case 'request-changes':
      return { hotkey: CONFIRM_HOTKEY, label: `request changes ${number}` }
    case 'ready-for-review':
      return { hotkey: CONFIRM_HOTKEY, label: `ready for review ${number}` }
  }
}

/** The confirmation content for a pending action. */
export function renderConfirm(table: UiTable, view: View, pending: PendingAction, handlers: Handlers): RenderElement {
  const { Box, Button, Input, Select, Text } = table
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

  if (isReview(pending)) {
    const text = postedText(pending)
    const isMissing = pending.kind === 'request-changes' && text.trim() === ''
    rows.push(
      <Box flexDirection="row">
        <Input
          key={REVIEW_INPUT_KEY}
          placeholder={pending.kind === 'approve' ? 'comment (optional)' : 'what should change (required)'}
          value={pending.body}
          submitLabel="keep"
          onInput={value => handlers.setReviewBody?.(value)}
          onSubmit={value => handlers.setReviewBody?.(value)}
        />
      </Box>,
    )
    line('Will post:', undefined, false, true)
    rows.push(
      <Text color={isMissing ? view.palette.failure : undefined} dimColor={text === ''} wrap="wrap">
        {text === '' ? (isMissing ? 'write what should change first' : NO_COMMENT) : text}
      </Text>,
    )
  }

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
      <Button key={isSecondStep ? 'confirm-final' : 'confirm'} plain hotkey={confirm.hotkey} label={confirm.label} onPress={() => handlers.confirmPending(isSecondStep, isReview(pending) ? pending.body : undefined)} />
      <Button key="cancel" plain hotkey={CANCEL_HOTKEY} label="cancel" onPress={() => handlers.cancelPending()} />
    </Box>,
  )
  if (isReview(pending)) line(`Esc leaves the field, then ${confirm.hotkey} posts it, ${CANCEL_HOTKEY} cancels (Enter does not post)`, undefined, false, true)
  else line(`press ${confirm.hotkey} to ${isSecondStep ? 'bypass and merge' : 'confirm'}, ${CANCEL_HOTKEY} to cancel`, undefined, false, true)
  return <Box flexDirection="column">{rows}</Box>
}

/** Rows renderConfirm draws for a pending action, for sizing the pane. */
export function confirmRowCount(view: View, pending: PendingAction): number {
  const snapshot = view.snapshot
  const pr = snapshot.kind === 'pr' && snapshot.pr.number === pending.prNumber ? snapshot.pr : null
  let rows = 2 + (pr !== null ? 1 : 0)
  if (hasMethod(pending)) rows += 1
  if (isReview(pending)) rows += 2 + postedRows(pending, Math.max(20, view.columns))
  if (pending.kind === 'admin-merge') rows += 1 + pending.bypassed.length
  if (pr !== null && 'headOid' in pending && pending.headOid !== pr.headOid) rows += 1
  if (view.outcome !== null && !view.outcome.isOk) rows += 1
  const confirm = confirmButton(pending)
  const buttonsWidth = confirm.hotkey.length + 2 + confirm.label.length + 2 + CANCEL_HOTKEY.length + 2 + 'cancel'.length
  rows += buttonsWidth > Math.max(20, view.columns) ? 2 : 1
  return rows + 1
}
