// Pure text helpers for the band and pane: cell widths, truncation, fitting
// segments into a line, and the one-line explanation of a snapshot with no PR.

import type { Problem, PullRequest, Snapshot, Status } from '../model'
import { prBadge } from '../status'

/** Terminal cells one code point takes: 0 for marks and joiners, 2 for wide glyphs and emoji. */
function codePointWidth(code: number): number {
  if (code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x300 && code <= 0x36f)) return 0
  if (code < 0x1100) return 1
  if (
    code <= 0x115f ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** Width of a text in terminal cells. */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) width += codePointWidth(char.codePointAt(0) ?? 0)
  return width
}

/** Cuts a text to at most `max` cells, ending in an ellipsis when it was cut. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  if (cellWidth(text) <= max) return text
  if (max === 1) return '…'
  let out = ''
  let width = 0
  for (const char of text) {
    const next = codePointWidth(char.codePointAt(0) ?? 0)
    if (width + next > max - 1) break
    out += char
    width += next
  }
  return `${out}…`
}

/** Like truncate, but keeps the end (a file path's name matters more than its start). */
export function truncateStart(text: string, max: number): string {
  if (max <= 0) return ''
  if (cellWidth(text) <= max) return text
  if (max === 1) return '…'
  const chars = [...text]
  let out = ''
  let width = 0
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index] ?? ''
    const next = codePointWidth(char.codePointAt(0) ?? 0)
    if (width + next > max - 1) break
    out = char + out
    width += next
  }
  return `…${out}`
}

/** A piece of a line: how wide it draws and how long it survives (1 is dropped last). */
export type Fittable = {
  width: number
  priority: number
}

/**
 * Drops pieces, highest priority number first (the later one on a tie), until the
 * line of pieces and `separatorWidth` between them fits `columns`. The piece with the
 * lowest priority number is never dropped. Keeps the original order.
 */
export function fitSegments<T extends Fittable>(segments: T[], columns: number, separatorWidth: number): T[] {
  const kept = [...segments]
  const total = () => kept.reduce((sum, segment) => sum + segment.width, 0) + Math.max(0, kept.length - 1) * separatorWidth
  while (kept.length > 1 && total() > columns) {
    let drop = 0
    kept.forEach((segment, index) => {
      const worst = kept[drop]
      if (worst !== undefined && segment.priority >= worst.priority) drop = index
    })
    kept.splice(drop, 1)
  }
  return kept
}

/** Section heading line: `── Title ─────` filled to `columns`. */
export function headingLine(title: string, columns: number): string {
  const head = `── ${truncate(title, Math.max(1, columns - 5))} `
  return head + '─'.repeat(Math.max(0, columns - cellWidth(head)))
}

/** `1 thread` or `2 threads`. */
export function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}

/** `GitHub unavailable (504)`. */
export function unavailableText(problem: Problem): string {
  return `GitHub unavailable (${problem.reason})`
}

/** `GitHub unavailable (504), retrying`: the band's hint next to stale data. */
export function unavailableHint(problem: Problem): string {
  return `${unavailableText(problem)}, retrying`
}

/** `retrying in 15 s` counted from the last attempt; just `retrying` once the wait is over. */
export function retryText(problem: Problem, nowMs: number): string {
  const tried = Date.parse(problem.triedAt)
  const remaining = Number.isNaN(tried) ? problem.retryInMs : tried + problem.retryInMs - nowMs
  const secondsLeft = Math.ceil(remaining / 1000)
  return secondsLeft > 0 ? `retrying in ${secondsLeft} s` : 'retrying'
}

/**
 * What the band or pane says for a snapshot that holds no pull request; null: say nothing.
 * `nowMs` counts the retry wait of a transient error down; without it the full wait shows.
 */
export function snapshotLine(snapshot: Snapshot, scope: 'band' | 'pane', nowMs = Number.NaN): { text: string; isDim: boolean } | null {
  switch (snapshot.kind) {
    case 'loading':
      return scope === 'pane' ? { text: 'Loading pull request status…', isDim: true } : null
    case 'not-a-repo':
      return scope === 'pane' ? { text: 'This directory is not a git repository.', isDim: true } : null
    case 'no-github-remote':
      return scope === 'pane' ? { text: 'This repository has no GitHub remote named origin.', isDim: true } : null
    case 'detached':
      return scope === 'pane' ? { text: 'HEAD is detached: check out a branch to see its pull request.', isDim: true } : null
    case 'no-account': {
      const { owner, repo } = snapshot.location
      const tried = snapshot.failure.tried.length > 0 ? ` (tried ${snapshot.failure.tried.join(', ')})` : ''
      const target = owner !== null && repo !== null ? `${owner}/${repo}` : 'this repository'
      if (snapshot.failure.kind === 'gh-missing') return { text: 'gh-status: the gh CLI is not installed', isDim: false }
      if (snapshot.failure.kind === 'not-logged-in') return { text: 'gh-status: not logged in to gh (run gh auth login)', isDim: false }
      return { text: `gh-status: no gh account can read ${target}${tried}`, isDim: false }
    }
    case 'no-pr':
      return { text: `no PR for ${snapshot.location.branch ?? 'this branch'}`, isDim: true }
    case 'error': {
      const { problem } = snapshot
      if (problem !== undefined) return { text: `GitHub is having trouble (${problem.reason}), ${retryText(problem, Number.isNaN(nowMs) ? Date.parse(problem.triedAt) : nowMs)}`, isDim: true }
      return { text: `gh-status: ${snapshot.message}`, isDim: true }
    }
    case 'pr':
      return null
  }
}

/**
 * True when the verdict would only say again what the state badge already does:
 * a draft that is blocked by nothing else, a merged or closed PR, or a queued PR
 * without a queue entry to describe.
 */
export function repeatsBadge(pr: PullRequest, status: Status): boolean {
  const badge = prBadge(pr).text
  if (status.verdict === 'merged' || status.verdict === 'closed') return true
  if (status.verdict === 'in-queue') return badge === 'queued' && pr.mergeQueueEntry === null
  if (status.verdict === 'blocked') return badge === 'draft' && status.blockers.length > 0 && status.blockers.every((blocker) => blocker.kind === 'draft')
  return false
}
