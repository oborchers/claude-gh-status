// The detail view of the pane: header, merge, pipeline, reviews and conversation of one PR (the branch's, or the one picked from the list).

import type { RenderElement } from 'claude-code'

import { availableActions, rerunnableRunIds } from '../actions'
import type { ActionOutcome, Check, CheckState, JobDetail, PipelineSummary, PullRequest, RepoLocation, ReviewThread, Snapshot, Status } from '../model'
import { checkGlyph, formatDuration, pipelineVerdict, prBadge, queueLine, commentWhen, relativeTime, shortSha, mergeTone, summarizePipeline, verdictText } from '../status'
import { cellWidth, count, headingLine, isForeignRepo, repeatsBadge, retryText, snapshotLine, truncate, truncateStart, unavailableText, wrappedLines } from './format'
import { prAnchor } from './anchor'
import { confirmRowCount, renderConfirm } from './confirm'
import { badgeBackground, tone } from './colors'
import type { Palette, Tone } from './colors'
import type { Handlers, UiTable, View } from './contract'
import { titleButton } from './detail'

type Pr = Extract<Snapshot, { kind: 'pr' }>
const MAX_CHECK_ROWS = 40
const MAX_THREAD_ROWS = 12
/** Most rows the pane asks for when it opens inline. */
const MAX_PANE_ROWS = 40
const MIN_PANE_ROWS = 6
const HEADER_ROWS = 4

function checkColor(state: CheckState): Tone | undefined {
  switch (state) {
    case 'success':
      return 'success'
    case 'failure':
    case 'timed-out':
    case 'action-required':
      return 'failure'
    case 'running':
    case 'queued':
      return 'pending'
    default:
      return undefined
  }
}

/** Failed first, then running, queued, passed, and checks that did not run last. */
export function stateRank(state: CheckState): number {
  switch (state) {
    case 'failure':
    case 'timed-out':
    case 'action-required':
    case 'cancelled':
      return 0
    case 'running':
      return 1
    case 'queued':
      return 2
    case 'skipped':
    case 'neutral':
      return 4
    default:
      return 3
  }
}

const checkRank = (check: Check): number => stateRank(check.state)

/** Required checks first, then failed, running, queued, the rest; stale checks are left out. */
export function sortChecks(checks: Check[]): Check[] {
  return checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check.state !== 'stale')
    .sort((a, b) => Number(!a.check.isRequired) - Number(!b.check.isRequired) || checkRank(a.check) - checkRank(b.check) || a.index - b.index)
    .map(({ check }) => check)
}

/** Checks that never ran: no duration, and no row of their own. */
const NOT_RUN_STATES: readonly CheckState[] = ['skipped', 'neutral', 'queued', 'stale']

/** Skipped, neutral and cancelled-without-run checks are drawn dim. */
function isCollapsed(check: Check): boolean {
  return check.state === 'skipped' || check.state === 'neutral' || (check.state === 'cancelled' && check.startedAt === null)
}

function checkDuration(check: Check, nowMs: number): string | null {
  if (NOT_RUN_STATES.includes(check.state) || check.startedAt === null) return null
  const start = Date.parse(check.startedAt)
  if (Number.isNaN(start)) return null
  if (check.state === 'running') return formatDuration(nowMs - start)
  if (check.completedAt === null) return null
  const end = Date.parse(check.completedAt)
  return Number.isNaN(end) ? null : formatDuration(end - start)
}

function jobFor(check: Check, jobs: JobDetail[]): JobDetail | null {
  if (check.jobId === null) return null
  return jobs.find((job) => job.jobId === check.jobId) ?? null
}

/** The step line under a running or failed job state, or null when it has none. */
function stepOf(state: CheckState, rank: number, job: JobDetail): { text: string; isRunning: boolean } | null {
  const isRunning = state === 'running'
  const step = isRunning ? job.currentStep : (job.failedStep ?? job.currentStep)
  if (step === null || !(isRunning || rank === 0)) return null
  return { text: `  ${isRunning ? '▸' : '✗'} ${step}`, isRunning }
}

/** The step line under a running or failed check, or null when it has none. */
function stepLine(check: Check, jobs: JobDetail[]): { text: string; isRunning: boolean } | null {
  const job = jobFor(check, jobs)
  return job === null ? null : stepOf(check.state, checkRank(check), job)
}

/** 0 for a job that failed, so its step shows; see checkRank. */
function jobRank(job: JobDetail): number {
  return checkRank({ name: job.name, workflow: null, state: job.state, isRequired: false, startedAt: null, completedAt: null, url: null, runId: job.runId, jobId: job.jobId })
}

/**
 * The jobs of one run as rows: glyph, name (a plain Button keyed <keyPrefix>-<i> when the job has a
 * url), and under a running or failed job its step. Shared by the Actions tab's run detail.
 */
export function jobLines(table: UiTable, jobs: JobDetail[], palette: Palette, columns: number, openUrl: (url: string) => void, keyPrefix = 'job'): RenderElement[] {
  const { Button, Text } = table
  const rows: RenderElement[] = []
  jobs.forEach((job, index) => {
    const color = checkColor(job.state)
    const dim = job.state === 'skipped' || job.state === 'neutral' ? true : undefined
    const name = truncate(job.name, Math.max(4, columns - 2))
    const url = job.url
    if (url !== null) {
      rows.push(
        <Button key={`${keyPrefix}-${index}`} plain onPress={() => openUrl(url)}>
          <Text color={tone(palette, color)} dimColor={dim}>{`${checkGlyph(job.state)} `}</Text>
          <Text dimColor={dim}>{name}</Text>
        </Button>,
      )
    } else {
      rows.push(
        <Text wrap="truncate-end">
          <Text color={tone(palette, color)} dimColor={dim}>{`${checkGlyph(job.state)} `}</Text>
          <Text dimColor={dim}>{name}</Text>
        </Text>,
      )
    }
    const step = stepOf(job.state, jobRank(job), job)
    if (step !== null) {
      rows.push(
        <Text color={step.isRunning ? palette.pending : palette.failure} wrap="truncate-end">
          {truncate(step.text, columns)}
        </Text>,
      )
    }
  })
  return rows
}

function heading(table: UiTable, title: string, columns: number): RenderElement {
  const { Text } = table
  return (
    <Text dimColor wrap="truncate-end">
      {headingLine(title, columns)}
    </Text>
  )
}

/** A success the pull request's own state already says ('merged by ...' after a merge) is not repeated. */
function repeatsState(outcome: ActionOutcome, pr: PullRequest): boolean {
  if (!outcome.isOk) return false
  switch (outcome.kind) {
    case 'merge':
    case 'admin-merge':
      return pr.state === 'merged'
    case 'enqueue':
      return pr.isInMergeQueue
    case 'auto-merge-on':
      return pr.autoMerge !== null
    default:
      return false
  }
}

/** The last outcome line, or null: none while a confirmation is up (it shows its own error) or when the state repeats it. */
function outcomeToShow(view: View, pr: PullRequest): ActionOutcome | null {
  const outcome = view.outcome
  if (outcome === null || view.pending !== null || repeatsState(outcome, pr)) return null
  return outcome
}

function mergeSection(table: UiTable, view: View, handlers: Handlers, snapshot: Pr, status: Status): RenderElement[] {
  const { Box, Button, Text } = table
  const { pr } = snapshot
  const columns = view.columns
  const rows: RenderElement[] = [heading(table, 'Merge', columns)]

  const verdictColor = status.verdict === 'mergeable' ? mergeTone(status) : status.verdict === 'blocked' ? 'failure' : status.verdict === 'merged' ? 'merged' : 'pending'
  const verdict = status.verdict === 'blocked' ? 'blocked' : verdictText(status.verdict, [], status.caveats)
  // The queue line below says what 'in merge queue' would; do not repeat it.
  const hasQueueLine = pr.isInMergeQueue && pr.mergeQueueEntry !== null
  const isFinished = pr.state !== 'open'
  const isRepeat = repeatsBadge(pr, status)
  if (isFinished) {
    // The badge already says merged or closed; add who and when instead.
    const at = pr.state === 'merged' ? (pr.mergedAt ?? pr.closedAt ?? null) : (pr.closedAt ?? null)
    const by = pr.state === 'merged' && pr.mergedBy ? ` by @${pr.mergedBy}` : ''
    const when = at === null ? '' : ` · ${relativeTime(at, view.nowMs)}`
    rows.push(
      <Text color={tone(view.palette, pr.state === 'merged' ? 'merged' : 'failure')} wrap="truncate-end">
        {truncate(`${pr.state}${by}${when}`, columns)}
      </Text>,
    )
  } else if (!(status.verdict === 'in-queue' && hasQueueLine) && !isRepeat) {
    rows.push(
      <Text color={tone(view.palette, verdictColor)} bold wrap="truncate-end">
        {truncate(verdict, columns)}
      </Text>,
    )
  }
  // A lone 'draft' blocker is the badge again; other blockers are always listed.
  const listed = isRepeat ? [] : status.blockers
  listed.forEach((blocker) => {
    rows.push(
      <Text color={view.palette.failure} wrap="truncate-end">
        {truncate(`• ${blocker.text}`, columns)}
      </Text>,
    )
  })
  if (pr.mergeQueueEntry !== null) {
    rows.push(
      <Text color={view.palette.pending} bold={status.verdict === 'in-queue'} wrap="truncate-end">
        {truncate(queueLine(pr.mergeQueueEntry, true), columns)}
      </Text>,
    )
  }
  if (pr.autoMerge !== null) {
    rows.push(
      <Text color={view.palette.pending} wrap="truncate-end">
        {truncate(`Auto-merge on (${pr.autoMerge.method}) since ${relativeTime(pr.autoMerge.enabledAt, view.nowMs)}`, columns)}
      </Text>,
    )
  }
  if (pr.viewerCanMergeAsAdmin && pr.state === 'open') {
    rows.push(
      <Text dimColor>
        admin merge available
      </Text>,
    )
  }

  const outcome = outcomeToShow(view, pr)
  if (outcome !== null) {
    rows.push(
      <Text color={tone(view.palette, outcome.isOk ? 'success' : 'failure')} wrap="truncate-end">
        {truncate(`${outcome.isOk ? '✓' : '✗'} ${outcome.message} · ${relativeTime(outcome.at, view.nowMs)}`, columns)}
      </Text>,
    )
  }

  // While an action waits, its confirmation takes the place of the buttons.
  if (view.pending !== null) {
    rows.push(renderConfirm(table, view, view.pending, handlers))
    return rows
  }
  const buttons: RenderElement[] = []
  const add = (key: string, hotkey: string, label: string, onPress: () => void) => {
    buttons.push(<Button key={key} plain hotkey={hotkey} label={label} onPress={onPress} />)
  }
  const actions = availableActions(pr, snapshot.account.login)
  const { requestMerge, requestEnqueue, requestDequeue, requestAutoMerge, requestAdminMerge, requestApprove, requestChanges, requestReady, ciToClaude } = handlers
  if (requestMerge !== undefined && actions.includes('merge')) add('merge', 'm', 'merge', () => requestMerge())
  if (requestEnqueue !== undefined && actions.includes('enqueue')) add('enqueue', 'q', 'add to queue', () => requestEnqueue())
  if (requestDequeue !== undefined && actions.includes('dequeue')) add('dequeue', 'q', 'remove from queue', () => requestDequeue())
  if (requestAutoMerge !== undefined && actions.includes('auto-merge-on')) add('auto-merge', 'a', 'auto-merge', () => requestAutoMerge())
  if (requestAutoMerge !== undefined && actions.includes('auto-merge-off')) add('auto-merge', 'a', 'auto-merge off', () => requestAutoMerge())
  if (requestAdminMerge !== undefined && actions.includes('admin-merge')) add('admin-merge', 'x', 'admin merge', () => requestAdminMerge())
  if (requestApprove !== undefined && actions.includes('approve')) add('approve', 'v', 'approve', () => requestApprove())
  if (requestChanges !== undefined && actions.includes('request-changes')) add('request-changes', 'w', 'request changes', () => requestChanges())
  if (requestReady !== undefined && actions.includes('ready-for-review')) add('ready-for-review', 'e', 'ready for review', () => requestReady())
  add('github', 'o', 'github', () => handlers.openOnGitHub())
  add('copy', 'c', 'copy url', () => handlers.copyUrl())
  add('refresh', 'r', 'refresh', () => handlers.refresh())
  if (ciToClaude !== undefined && status.pipeline.failed > 0) add('fix-ci', 'f', 'fix ci', () => ciToClaude())
  const rerunFailed = handlers.rerunFailed
  if (rerunFailed !== undefined && rerunnableRunIds(pr).length > 0) add('rerun-failed', 't', 'retry failed', () => rerunFailed())
  rows.push(
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {buttons}
    </Box>,
  )
  return rows
}

function checkRow(table: UiTable, view: View, handlers: Handlers, check: Check, key: string): RenderElement[] {
  const { Box, Button, Text } = table
  const duration = checkDuration(check, view.nowMs)
  const tag = check.isRequired ? ' [required]' : ''
  const tail = duration === null ? '' : ` ${duration}`
  const room = Math.max(4, view.columns - 2 - cellWidth(tag) - cellWidth(tail))
  const name = truncate(check.name, room)
  const color = checkColor(check.state)
  const dim = isCollapsed(check) ? true : undefined
  const url = check.url
  const label = (
    <Box>
      <Text color={tone(view.palette, color)} dimColor={dim}>{`${checkGlyph(check.state)} `}</Text>
      <Text dimColor={dim}>{name}</Text>
      <Text dimColor>{tag}</Text>
      <Text dimColor>{tail}</Text>
    </Box>
  )
  const rows: RenderElement[] = []
  if (url !== null) {
    rows.push(
      <Button key={key} plain onPress={() => handlers.openUrl(url)}>
        <Text color={tone(view.palette, color)} dimColor={dim}>{`${checkGlyph(check.state)} `}</Text>
        <Text dimColor={dim}>{name}</Text>
        <Text dimColor>{tag}</Text>
        <Text dimColor>{tail}</Text>
      </Button>,
    )
  } else {
    rows.push(label)
  }
  const step = stepLine(check, view.jobs)
  if (step !== null) {
    rows.push(
      <Text color={step.isRunning ? view.palette.pending : view.palette.failure} wrap="truncate-end">
        {truncate(step.text, view.columns)}
      </Text>,
    )
  }
  return rows
}

/** One checks list: a bold overall verdict, then every check (running and failed first; skipped ones dim). */
function checksList(table: UiTable, view: View, handlers: Handlers, title: string, checks: Check[], pipeline: PipelineSummary, keyPrefix: string): RenderElement[] {
  const { Text } = table
  const rows: RenderElement[] = [heading(table, title, view.columns)]
  const verdict = pipelineVerdict(pipeline)
  if (verdict === null) {
    rows.push(<Text dimColor>no checks reported</Text>)
    return rows
  }
  rows.push(
    <Text color={tone(view.palette, verdict.tone)} bold wrap="truncate-end">
      {truncate(verdict.text, view.columns)}
    </Text>,
  )
  const listed = sortChecks(checks)
  listed.slice(0, MAX_CHECK_ROWS).forEach((check, index) => rows.push(...checkRow(table, view, handlers, check, `${keyPrefix}-${index}`)))
  if (listed.length > MAX_CHECK_ROWS) {
    rows.push(<Text dimColor>{`… ${listed.length - MAX_CHECK_ROWS} more`}</Text>)
  }
  return rows
}

/** Workflow runs the pipeline offers a button for: those with a failed check, else all of them when there are at most two. */
function runTargets(pr: PullRequest): { runId: number; name: string }[] {
  const byRun = new Map<number, { name: string; isFailed: boolean }>()
  for (const check of sortChecks(pr.checks).slice(0, MAX_CHECK_ROWS)) {
    if (check.runId === null) continue
    const isFailed = checkRank(check) === 0 && check.state !== 'cancelled'
    const known = byRun.get(check.runId)
    if (known === undefined) byRun.set(check.runId, { name: check.workflow ?? check.name, isFailed })
    else if (isFailed) known.isFailed = true
  }
  const all = [...byRun.entries()].map(([runId, { name, isFailed }]) => ({ runId, name, isFailed }))
  const failed = all.filter((run) => run.isFailed)
  return (failed.length > 0 ? failed : all.length <= 2 ? all : []).map(({ runId, name }) => ({ runId, name }))
}

/** The `open run: <workflow>` buttons under the pipeline; none without the handler or while a confirmation waits. */
function runButtons(table: UiTable, view: View, handlers: Handlers, pr: PullRequest): RenderElement[] {
  const { Button, Text } = table
  const { openRun } = handlers
  if (openRun === undefined || isConfirming(view)) return []
  return runTargets(pr).map(({ runId, name }) => (
    <Button key={`run-${runId}`} plain onPress={() => openRun(runId)}>
      <Text dimColor>{truncate(`open run: ${name} ↗`, view.columns)}</Text>
    </Button>
  ))
}

function pipelineSection(table: UiTable, view: View, handlers: Handlers, pr: PullRequest, status: Status): RenderElement[] {
  return [...checksList(table, view, handlers, 'Pipeline', pr.checks, status.pipeline, 'check'), ...runButtons(table, view, handlers, pr)]
}

/** The `Linked issues` section: a plain Button per issue the pull request closes (plain text while a confirmation waits); null when there are none. */
function linkedIssuesSection(table: UiTable, view: View, handlers: Handlers, pr: PullRequest, location: RepoLocation): RenderElement[] | null {
  const { Button, Text } = table
  const issues = pr.linkedIssues ?? []
  if (issues.length === 0) return null
  const rows: RenderElement[] = [heading(table, 'Linked issues', view.columns)]
  const { openLinkedIssue } = handlers
  issues.forEach((issue) => {
    const isForeign = isForeignRepo(issue.repo, location)
    const label = truncate(`${isForeign ? issue.repo : ''}#${issue.number} ${issue.title}`, view.columns)
    const dim = issue.state === 'closed' || isForeign ? true : undefined
    if (isForeign || openLinkedIssue === undefined || isConfirming(view)) {
      rows.push(<Text dimColor={dim} wrap="truncate-end">{label}</Text>)
    } else {
      rows.push(
        <Button key={`linked-issue-${issue.number}`} plain onPress={() => openLinkedIssue(issue.number)}>
          <Text dimColor={dim}>{label}</Text>
        </Button>,
      )
    }
  })
  return rows
}

function queueSection(table: UiTable, view: View, handlers: Handlers, pr: PullRequest): RenderElement[] | null {
  if (!pr.isInMergeQueue || pr.mergeQueueEntry === null) return null
  const checks = pr.mergeQueueEntry.checks
  return checksList(table, view, handlers, 'Merge queue checks', checks, summarizePipeline(checks), 'queue-check')
}

function reviewsSection(table: UiTable, view: View, status: Status): RenderElement[] {
  const { Text } = table
  const rows: RenderElement[] = [heading(table, 'Reviews', view.columns)]
  const add = (key: string, text: string, color?: Tone) => {
    rows.push(
      <Text color={tone(view.palette, color)} wrap="truncate-end">
        {truncate(text, view.columns)}
      </Text>,
    )
  }
  status.approvals.forEach((login, index) => add(`approved-${index}`, `✓ @${login} approved`, 'success'))
  status.changesRequestedBy.forEach((login, index) => add(`changes-${index}`, `✗ @${login} requested changes`, 'failure'))
  status.requested.forEach((name, index) => add(`requested-${index}`, `◷ ${name} requested`, 'pending'))
  if (rows.length === 1) rows.push(<Text dimColor>no reviews yet</Text>)
  return rows
}

function threadRow(table: UiTable, view: View, handlers: Handlers, thread: ReviewThread, index: number): RenderElement {
  const { Button, Text } = table
  const where = thread.path === null ? 'thread' : thread.line === null ? thread.path : `${thread.path}:${thread.line}`
  const who = thread.last === null ? '' : ` ${commentWhen(thread.last, view.nowMs)}`
  const text = `${truncateStart(where, Math.max(8, view.columns - cellWidth(who) - 2))}`
  const url = thread.last?.url
  if (url === undefined) {
    return (
      <Text wrap="truncate-end">
        {`💬 ${text}`}
        <Text dimColor>{who}</Text>
      </Text>
    )
  }
  return (
    <Button key={`thread-${index}`} plain onPress={() => handlers.openUrl(url)}>
      <Text color={view.palette.pending}>💬 </Text>
      <Text>{text}</Text>
      <Text dimColor>{who}</Text>
    </Button>
  )
}

function conversationSection(table: UiTable, view: View, handlers: Handlers, pr: PullRequest, status: Status): RenderElement[] {
  const { Button, Text } = table
  const rows: RenderElement[] = [heading(table, 'Conversation', view.columns)]
  if (status.newActivity.length > 0) {
    rows.push(
      <Text color={view.palette.pending} bold>
        {`${status.newActivity.length} new since you looked`}
      </Text>,
    )
  }
  const open = pr.threads.filter((thread) => !thread.isResolved && !thread.isOutdated)
  const outdated = pr.threads.filter((thread) => !thread.isResolved && thread.isOutdated)
  if (open.length === 0) rows.push(<Text dimColor>no unresolved threads</Text>)
  else rows.push(<Text>{count(open.length, 'unresolved thread', 'unresolved threads')}</Text>)
  open.slice(0, MAX_THREAD_ROWS).forEach((thread, index) => rows.push(threadRow(table, view, handlers, thread, index)))
  if (open.length > MAX_THREAD_ROWS) rows.push(<Text dimColor>{`… ${open.length - MAX_THREAD_ROWS} more`}</Text>)
  if (outdated.length > 0) rows.push(<Text dimColor>{count(outdated.length, 'outdated thread', 'outdated threads')}</Text>)

  const last = pr.lastComment
  if (last !== null) {
    const url = last.url
    rows.push(
      <Button key="last-comment" plain onPress={() => handlers.openUrl(url)}>
        <Text>Last comment </Text>
        <Text dimColor>{truncate(commentWhen(last, view.nowMs), Math.max(8, view.columns - 14))}</Text>
      </Button>,
    )
  } else {
    rows.push(<Text dimColor>no comments yet</Text>)
  }
  return rows
}

/** The one line under the header while the data is stale: its age, what is wrong, when the next try comes. */
function staleRows(table: UiTable, view: View, snapshot: Pr): RenderElement[] {
  const { Text } = table
  const { stale } = snapshot
  if (!stale) return []
  const text = `showing last data from ${relativeTime(snapshot.at, view.nowMs)}, ${unavailableText(stale)}, ${retryText(stale, view.nowMs)}`
  return [
    <Text color={view.palette.pending} wrap="truncate-end">
      {truncate(text, view.columns)}
    </Text>,
  ]
}

const LIST_LABEL = 'all PRs'
const BACK_LABEL = 'back to list'
const LIST_GAP = 2

/** True while a confirmation waits anywhere: `b` and `l` then belong to its steps alone. */
const isConfirming = (view: View): boolean => view.pending !== null || view.hasPending === true

/** `l: all PRs` for the branch's pull request; drawn only when the list is available and no confirmation waits. */
function listButton(table: UiTable, view: View, handlers: Handlers, marginLeft?: number): RenderElement | null {
  const { Box, Button } = table
  const { openList } = handlers
  if (openList === undefined || isConfirming(view)) return null
  return (
    <Box flexShrink={0} marginLeft={marginLeft}>
      <Button key="pane-list" plain hotkey="l" label={LIST_LABEL} onPress={() => openList()} />
    </Box>
  )
}

/** `b: back to list` for a selected pull request; `l` goes back too. Hidden while a confirmation waits (`b` is its final step's). */
function backButtons(table: UiTable, view: View, handlers: Handlers, marginLeft?: number): RenderElement | null {
  const { Box, Button } = table
  const { back } = handlers
  if (view.isSelected !== true || back === undefined || isConfirming(view)) return null
  return (
    <Box flexShrink={0} marginLeft={marginLeft}>
      <Button key="back" plain hotkey="b" label={BACK_LABEL} onPress={() => back()} />
      <Box marginLeft={LIST_GAP}>
        <Button key="pane-list" plain hotkey="l" label="list" onPress={() => back()} />
      </Box>
    </Box>
  )
}

/** The navigation on the header row: back to the list for a selected pull request, the list for the branch's. */
function navButtons(table: UiTable, view: View, handlers: Handlers, marginLeft?: number): RenderElement | null {
  return view.isSelected === true ? backButtons(table, view, handlers, marginLeft) : listButton(table, view, handlers, marginLeft)
}

function navWidth(view: View, handlers: Handlers): number {
  if (isConfirming(view)) return 0
  if (view.isSelected === true) return handlers.back === undefined ? 0 : cellWidth(BACK_LABEL) + 3 + LIST_GAP + cellWidth('list') + 3 + LIST_GAP
  return handlers.openList === undefined ? 0 : cellWidth(LIST_LABEL) + 3 + LIST_GAP
}

/**
 * The number of a selected pull request: a plain Button keyed pr-<n> whose press only
 * refreshes. It keeps the key of the row that opened it, so a desktop pane that drops
 * the focus when the pressed Button is gone from the next drawing keeps it here.
 */
function selectedTitle(table: UiTable, view: View, handlers: Handlers, number: number, title: string): RenderElement {
  const key = `pr-${number}`
  return titleButton(table, key, title, () => handlers.refresh())
}

/** The branch pull request's number: on the terminal the `pr-anchor` Button drawn calm, on the desktop the Link. */
function branchTitle(table: UiTable, view: View, handlers: Handlers, href: string, title: string): RenderElement {
  if (view.surface === 'desktop') return prAnchor(table, view, handlers, href, title)
  return titleButton(table, 'pr-anchor', title, () => handlers.openOnGitHub())
}

function headerSection(table: UiTable, view: View, handlers: Handlers, snapshot: Pr): RenderElement[] {
  const { Box, Text } = table
  const { pr, account } = snapshot
  const columns = view.columns
  const badge = prBadge(pr)
  // First line: the colored state badge, the number and the navigation; the whole title wraps below it.
  const number = `${view.isSelected === true ? '' : 'PR '}#${pr.number}`
  return [
    <Box flexDirection="row" flexWrap="nowrap">
      <Box flexShrink={0}>
        <Text color={view.palette.badgeText} backgroundColor={badgeBackground(view.palette, badge.text)} bold>
          {` ${badge.text} `}
        </Text>
        <Text> </Text>
      </Box>
      {view.isSelected === true ? selectedTitle(table, view, handlers, pr.number, number) : branchTitle(table, view, handlers, pr.url, number)}
      {navButtons(table, view, handlers, LIST_GAP)}
    </Box>,
    <Text bold wrap="wrap">
      {pr.title}
    </Text>,
    <Text wrap="truncate-end">
      {truncate(`${pr.headRefName} → ${pr.baseRefName}`, columns)}
    </Text>,
    <Text dimColor wrap="truncate-end">
      {truncate(`@${account.login} (${account.source})`, columns)}
    </Text>,
    <Text dimColor wrap="truncate-end">
      {truncate(`${shortSha(pr.headOid)} · refreshed ${relativeTime(snapshot.at, view.nowMs)}`, columns)}
    </Text>,
    ...staleRows(table, view, snapshot),
  ]
}

/** The pane body for a view. */
export function renderPane(table: UiTable, view: View, handlers: Handlers): RenderElement {
  const { Box, Button, Text } = table
  const { snapshot, status } = view

  if (snapshot.kind !== 'pr' || status === null) {
    const line = snapshotLine(snapshot, 'pane', view.nowMs)
    const text = line?.text ?? 'No pull request status yet.'
    return (
      <Box flexDirection="column">
        <Text dimColor={line?.isDim ?? true} wrap="wrap">
          {text}
        </Text>
        <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => handlers.refresh()} />
        {navButtons(table, view, handlers)}
      </Box>
    )
  }

  const { pr } = snapshot
  const queueRows = queueSection(table, view, handlers, pr)
  const queueBlock = queueRows === null ? null : <Box flexDirection="column">{queueRows}</Box>
  const linkedRows = linkedIssuesSection(table, view, handlers, pr, snapshot.location)
  const linkedBlock = linkedRows === null ? null : <Box flexDirection="column">{linkedRows}</Box>
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {headerSection(table, view, handlers, snapshot)}
      </Box>
      <Box flexDirection="column">
        {mergeSection(table, view, handlers, snapshot, status)}
      </Box>
      <Box flexDirection="column">
        {reviewsSection(table, view, status)}
      </Box>
      <Box flexDirection="column">
        {conversationSection(table, view, handlers, pr, status)}
      </Box>
      {linkedBlock}
      {queueBlock}
      <Box flexDirection="column">
        {pipelineSection(table, view, handlers, pr, status)}
      </Box>
    </Box>
  )
}

const GAP_ROWS = 1

/** Rows a checks list takes: heading, verdict, each listed check with its step line, the 'more' row. */
function checksRowCount(view: View, checks: Check[], pipeline: PipelineSummary): number {
  if (pipelineVerdict(pipeline) === null) return 2
  const listed = sortChecks(checks)
  const shown = listed.slice(0, MAX_CHECK_ROWS)
  const steps = shown.filter((check) => stepLine(check, view.jobs) !== null).length
  return 2 + shown.length + steps + (listed.length > MAX_CHECK_ROWS ? 1 : 0)
}

/** Rows the buttons take once they wrap at the view's width; counts every action the PR offers. */
function buttonRowCount(view: View, pr: PullRequest, status: Status, viewerLogin: string): number {
  const actions = availableActions(pr, viewerLogin)
  const labels = ['o github', 'c copy url', 'r refresh']
  if (actions.includes('merge')) labels.push('m merge')
  if (actions.includes('enqueue')) labels.push('q add to queue')
  if (actions.includes('dequeue')) labels.push('q remove from queue')
  if (actions.includes('auto-merge-on')) labels.push('a auto-merge')
  if (actions.includes('auto-merge-off')) labels.push('a auto-merge off')
  if (actions.includes('admin-merge')) labels.push('x admin merge')
  if (actions.includes('approve')) labels.push('v approve')
  if (actions.includes('request-changes')) labels.push('w request changes')
  if (actions.includes('ready-for-review')) labels.push('e ready for review')
  if (status.pipeline.failed > 0) labels.push('f fix ci')
  if (rerunnableRunIds(pr).length > 0) labels.push('t retry failed')
  let rows = 1
  let used = 0
  for (const label of labels) {
    const width = cellWidth(label) + 1
    if (used > 0 && used + 2 + width > view.columns) {
      rows += 1
      used = width
    } else {
      used += (used > 0 ? 2 : 0) + width
    }
  }
  return rows
}

function mergeRowCount(view: View, pr: PullRequest, status: Status, viewerLogin: string): number {
  let rows = 1
  const hasQueueLine = pr.isInMergeQueue && pr.mergeQueueEntry !== null
  const isRepeat = repeatsBadge(pr, status)
  if (pr.state !== 'open') rows += 1
  else if (!(status.verdict === 'in-queue' && hasQueueLine) && !isRepeat) rows += 1
  if (!isRepeat) rows += status.blockers.length
  if (pr.mergeQueueEntry !== null) rows += 1
  if (pr.autoMerge !== null) rows += 1
  if (pr.viewerCanMergeAsAdmin && pr.state === 'open') rows += 1
  if (outcomeToShow(view, pr) !== null) rows += 1
  return rows + (view.pending !== null ? confirmRowCount(view, view.pending) : buttonRowCount(view, pr, status, viewerLogin))
}

function conversationRowCount(pr: PullRequest, status: Status): number {
  const open = pr.threads.filter((thread) => !thread.isResolved && !thread.isOutdated)
  const outdated = pr.threads.filter((thread) => !thread.isResolved && thread.isOutdated)
  let rows = 1 + 1 + 1 + Math.min(open.length, MAX_THREAD_ROWS)
  if (status.newActivity.length > 0) rows += 1
  if (open.length > MAX_THREAD_ROWS) rows += 1
  if (outdated.length > 0) rows += 1
  return rows
}

/**
 * Rows renderPane draws for a view, clamped to 6..40. register.tsx asks the engine
 * for this height when the pane opens inline, where it would otherwise get a third.
 */
export function paneRowCount(view: View, handlers: Pick<Handlers, 'openRun'> = {}): number {
  const { snapshot, status } = view
  if (snapshot.kind !== 'pr' || status === null) {
    const text = snapshotLine(snapshot, 'pane', view.nowMs)?.text ?? 'No pull request status yet.'
    const wrapped = Math.max(1, Math.ceil(cellWidth(text) / Math.max(1, view.columns)))
    return Math.max(MIN_PANE_ROWS, wrapped + 1)
  }
  const { pr } = snapshot
  const sections = [
    HEADER_ROWS + wrappedLines(pr.title, view.columns) + (snapshot.stale ? 1 : 0),
    mergeRowCount(view, pr, status, snapshot.account.login),
    1 + Math.max(1, status.approvals.length + status.changesRequestedBy.length + status.requested.length),
    conversationRowCount(pr, status),
    checksRowCount(view, pr.checks, status.pipeline) + (handlers.openRun === undefined || isConfirming(view) ? 0 : runTargets(pr).length),
  ]
  if ((pr.linkedIssues ?? []).length > 0) sections.push(1 + (pr.linkedIssues ?? []).length)
  if (pr.isInMergeQueue && pr.mergeQueueEntry !== null) {
    sections.push(checksRowCount(view, pr.mergeQueueEntry.checks, summarizePipeline(pr.mergeQueueEntry.checks)))
  }
  const total = sections.reduce((sum, rows) => sum + rows, 0) + GAP_ROWS * (sections.length - 1)
  return Math.min(MAX_PANE_ROWS, Math.max(MIN_PANE_ROWS, total))
}
