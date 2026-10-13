// The detail view of the Actions tab: one workflow run with its jobs.

import type { RenderElement } from 'claude-code'

import type { CheckState, JobDetail, RunItem } from '../model'
import { checkGlyph, formatDuration, relativeTime, shortSha } from '../status'
import { tone } from './colors'
import type { Tone } from './colors'
import type { RepoHandlers, RunDetailView, UiTable } from './contract'
import { detailHeader, messageView, sectionHeading, staleRows } from './detail'
import { retryText, truncate } from './format'
import { jobLines, stateRank } from './pane'

const FAILED_RUN_STATES: readonly CheckState[] = ['failure', 'timed-out']

function stateTone(state: CheckState): Tone | undefined {
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

/** `started 4 min ago · 3:12`; a running run shows the time elapsed so far, a queued one how long it waits. */
function timingLine(run: RunItem, nowMs: number): string {
  if (run.startedAt === null) return `queued ${relativeTime(run.createdAt, nowMs)}`
  const start = Date.parse(run.startedAt)
  const end = run.state === 'running' || run.state === 'queued' ? nowMs : Date.parse(run.updatedAt)
  const duration = Number.isNaN(start) || Number.isNaN(end) ? '' : ` · ${formatDuration(end - start)}`
  return `started ${relativeTime(run.startedAt, nowMs)}${duration}`
}

/** Jobs in the order the PR pipeline lists checks: failed first, jobs that did not run last, else as GitHub lists them. */
function sortJobs(jobs: JobDetail[]): JobDetail[] {
  return jobs.map((job, index) => ({ job, index })).sort((a, b) => stateRank(a.job.state) - stateRank(b.job.state) || a.index - b.index).map(({ job }) => job)
}

/** The run detail body for a view. */
export function renderRunDetail(table: UiTable, view: RunDetailView, handlers: RepoHandlers): RenderElement {
  const { Box, Button, Text } = table
  const { snapshot, columns, palette, nowMs } = view

  if (snapshot.kind === 'loading') return messageView(table, `Loading run ${snapshot.runId}…`, true, handlers)
  if (snapshot.kind === 'error') {
    const hint = snapshot.problem === undefined ? '' : `, ${retryText(snapshot.problem, nowMs)}`
    return messageView(table, `Could not read run ${snapshot.runId}: ${snapshot.message}${hint}`, false, handlers)
  }

  const { run, jobs } = snapshot
  const lead = <Text color={tone(palette, stateTone(run.state))} bold>{`${checkGlyph(run.state)} `}</Text>
  const facts = [run.branch, run.event, run.actor === null ? null : `@${run.actor}`, shortSha(run.headSha)].filter((part): part is string => part !== null && part !== '')
  const attempt = run.attempt > 1 ? ` · attempt ${run.attempt}` : ''
  const header: RenderElement[] = [
    detailHeader(table, columns, lead, 2, `run-${run.id}`, `#${run.runNumber} ${run.name}`, handlers, view.focusedKey ?? null),
    <Text wrap="truncate-end">{truncate(`${facts.join(' · ')}${attempt}`, columns)}</Text>,
    <Text dimColor wrap="truncate-end">
      {truncate(timingLine(run, nowMs), columns)}
    </Text>,
    ...staleRows(table, palette, columns, nowMs, snapshot.at, snapshot.stale),
  ]

  const sections: RenderElement[] = [<Box flexDirection="column">{header}</Box>]
  const jobRows = jobs.length === 0 ? [<Text dimColor>no jobs reported</Text>] : jobLines(table, sortJobs(jobs), palette, columns, (url) => handlers.openUrl(url), 'job')
  sections.push(
    <Box flexDirection="column">
      {sectionHeading(table, 'Jobs', columns)}
      {jobRows}
    </Box>,
  )

  const { outcome } = view
  const footer: RenderElement[] = []
  if (outcome !== null) {
    footer.push(
      <Text color={tone(palette, outcome.isOk ? 'success' : 'failure')} wrap="truncate-end">
        {truncate(`${outcome.isOk ? '✓' : '✗'} ${outcome.message} · ${relativeTime(outcome.at, nowMs)}`, columns)}
      </Text>,
    )
  }
  const hasFailed = FAILED_RUN_STATES.includes(run.state)
  footer.push(
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Button key="run-open" plain hotkey="o" label="github" onPress={() => handlers.openUrl(run.url)} />
      <Button key="run-copy" plain hotkey="c" label="copy url" onPress={() => handlers.copyText(run.url)} />
      <Button key="run-refresh" plain hotkey="r" label="refresh" onPress={() => handlers.refresh()} />
      {hasFailed ? <Button key="run-rerun" plain hotkey="t" label="retry failed" onPress={() => handlers.rerunRun(run.id)} /> : null}
      {hasFailed ? <Button key="run-fix" plain hotkey="f" label="fix ci" onPress={() => handlers.ciToClaude(run.id)} /> : null}
    </Box>,
  )
  sections.push(<Box flexDirection="column">{footer}</Box>)
  return (
    <Box flexDirection="column" gap={1}>
      {sections}
    </Box>
  )
}
