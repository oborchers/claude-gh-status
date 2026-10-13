// The Actions tab's data: workflow runs read over REST with `gh api`, the pure
// normalizer, grouping and paging, and the main-branch status of the band.
// fetchRuns, fetchMainStatus and fetchRun take the Exec.
//
// Cost: every read here is a REST call against the core limit (1 request each);
// only fetchMainStatus is conditional, so a 304 costs nothing. fetchRuns reads
// plainly: it merges three lists into one picture, the tab is open only while
// someone looks at it, and RunList has no place to keep ETags between reads.

import { parseIncludeOutput } from './etag'
import { runGh } from './gh'
import type { Exec, GhResult } from './gh'
import { fetchJobs } from './jobs'
import { PAGE_SIZE, fitPageSize, pollDelayMs } from './list'
import type { AccountChoice, JobDetail, MainStatus, Problem, RateLimit, RepoLocation, RunGroup, RunItem, RunList, RunSnapshot } from './model'
import { checkStateFrom } from './query'
import { cleanStr } from './text'
import { backoffMs, isTransient, reasonOf } from './scheduler'

/** Runs read for the default branch and for this branch. */
export const RUNS_PER_BRANCH = 50

/** Runs read across all branches. */
export const RUNS_RECENT_READ = 30

/** Runs of other branches the tab lists. */
export const RECENT_LIMIT = 20

/** A run that is queued or running is read again this often. */
export const RUN_POLL_MS = 15_000

/** A finished run is read again this often. */
export const RUN_IDLE_POLL_MS = 60_000

/** The band's main-branch status is read again this often. */
export const MAIN_STATUS_POLL_MS = 300_000

/** Group order, as drawn. */
export const RUN_GROUPS: readonly RunGroup[] = ['main', 'branch', 'recent']

/** Terminal rows one run takes: title line, meta line, blank line. */
export const ROWS_PER_RUN = 3

type Failure = Extract<GhResult, { isOk: false }>

export type FetchedRuns =
  | { kind: 'ok'; defaultBranch: string; main: RunItem[]; branch: RunItem[]; recent: RunItem[] }
  | { kind: 'error'; failure: Failure }

export type FetchedMainStatus =
  | { kind: 'ok'; status: MainStatus; etag: string | null }
  | { kind: 'unchanged'; etag: string | null }
  | { kind: 'error'; failure: Failure }

export type FetchedRun =
  | { kind: 'ok'; run: RunItem; jobs: JobDetail[] }
  | { kind: 'error'; failure: Failure }

export type RunRow = { group: RunGroup; item: RunItem }

export type RunPage = {
  rows: RunRow[]
  /** 1-based, clamped into 1..pageCount. */
  page: number
  pageCount: number
  /** 1-based position of the first and last row on the page among all rows; 0 when empty. */
  first: number
  last: number
  total: number
}

type Obj = Record<string, unknown>

function asObj(value: unknown): Obj | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : null
}

function asStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads one entry of `workflow_runs` into a run. status queued, waiting,
 * requested or pending is 'queued', in_progress is 'running', completed is its
 * conclusion (an unknown one is 'neutral'). Pure; never throws; an entry
 * without id, workflow id, name or creation time is dropped.
 */
export function normalizeRun(raw: unknown): RunItem | null {
  const run = asObj(raw)
  const id = asNum(run?.id)
  const workflowId = asNum(run?.workflow_id)
  const name = cleanStr(run?.name)
  const createdAt = asStr(run?.created_at)
  if (run === null || id === null || workflowId === null || name === null || createdAt === null) return null
  return {
    id,
    runNumber: asNum(run.run_number) ?? 0,
    workflowId,
    name,
    branch: cleanStr(run.head_branch),
    event: asStr(run.event) ?? '',
    actor: cleanStr(asObj(run.actor)?.login),
    state: checkStateFrom(run.status, run.conclusion),
    headSha: asStr(run.head_sha) ?? '',
    createdAt,
    startedAt: asStr(run.run_started_at),
    updatedAt: asStr(run.updated_at) ?? createdAt,
    url: asStr(run.html_url) ?? '',
    attempt: asNum(run.run_attempt) ?? 1,
  }
}

/** The runs of a `workflow_runs` answer, malformed ones dropped. Pure; never throws. */
export function runsOf(raw: unknown): RunItem[] {
  const list = asObj(raw)?.workflow_runs
  if (!Array.isArray(list)) return []
  const runs: RunItem[] = []
  for (const entry of list) {
    const run = normalizeRun(entry)
    if (run !== null) runs.push(run)
  }
  return runs
}

function time(text: string): number {
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? 0 : ms
}

function byNewest(a: RunItem, b: RunItem): number {
  return time(b.createdAt) - time(a.createdAt) || b.id - a.id
}

/** The newest run (by creation time, then id) of every workflow, ordered by workflow name. Pure. */
export function newestPerWorkflow(runs: readonly RunItem[]): RunItem[] {
  const newest = new Map<number, RunItem>()
  for (const run of runs) {
    const seen = newest.get(run.workflowId)
    if (seen === undefined || byNewest(run, seen) < 0) newest.set(run.workflowId, run)
  }
  return [...newest.values()].sort((a, b) => a.name.localeCompare(b.name) || a.workflowId - b.workflowId)
}

/** The newest `limit` runs that are on neither branch. A null branch excludes only the default one. Pure. */
export function recentRuns(runs: readonly RunItem[], defaultBranch: string, branch: string | null, limit: number = RECENT_LIMIT): RunItem[] {
  return runs
    .filter(run => run.branch !== defaultBranch && (branch === null || run.branch !== branch))
    .sort(byNewest)
    .slice(0, limit)
}

function unreadable(): Failure {
  return { isOk: false, kind: 'server', exitCode: null, message: 'GitHub sent an unreadable answer', stdout: '' }
}

function failed(message: string): Failure {
  return { isOk: false, kind: 'failed', exitCode: null, message, stdout: '' }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function repoPath(location: RepoLocation): string | null {
  if (location.owner === null || location.repo === null) return null
  return `repos/${location.owner}/${location.repo}`
}

function runsPath(base: string, perPage: number, branch: string | null): string {
  return `${base}/actions/runs?${branch === null ? '' : `branch=${encodeURIComponent(branch)}&`}per_page=${perPage}`
}

/** Reads a JSON answer: the parsed body, or the failure. */
async function getJson(exec: Exec, path: string, location: RepoLocation, login: string): Promise<{ answer: unknown } | { failure: Failure }> {
  const ran = await runGh(exec, ['api', path], { login, cwd: location.cwd })
  if (!ran.isOk) return { failure: ran }
  const answer = parseJson(ran.stdout)
  return answer === null ? { failure: unreadable() } : { answer }
}

/** The repository's default branch: one REST call that prints only the name. */
async function readDefaultBranch(exec: Exec, base: string, location: RepoLocation, login: string): Promise<{ branch: string } | { failure: Failure }> {
  const ran = await runGh(exec, ['api', base, '--jq', '.default_branch'], { login, cwd: location.cwd })
  if (!ran.isOk) return { failure: ran }
  const branch = ran.stdout.trim()
  return branch === '' ? { failure: unreadable() } : { branch }
}

/**
 * Reads the Actions runs of the tab: the default branch (50), this branch (50,
 * skipped on the default branch or a detached HEAD) and all branches (30), as
 * plain REST calls in parallel. `knownDefault` is the default branch of an
 * earlier read, which saves the call that finds it. main and branch hold the
 * newest run per workflow; recent the 20 newest runs on neither.
 */
export async function fetchRuns(exec: Exec, location: RepoLocation, login: string, knownDefault: string | null = null): Promise<FetchedRuns> {
  const base = repoPath(location)
  if (base === null) return { kind: 'error', failure: failed('no GitHub repository to list runs of') }
  let defaultBranch = knownDefault
  if (defaultBranch === null) {
    const found = await readDefaultBranch(exec, base, location, login)
    if ('failure' in found) return { kind: 'error', failure: found.failure }
    defaultBranch = found.branch
  }
  const ownBranch = location.branch !== null && location.branch !== defaultBranch ? location.branch : null
  const [onMain, onBranch, onAny] = await Promise.all([
    getJson(exec, runsPath(base, RUNS_PER_BRANCH, defaultBranch), location, login),
    ownBranch === null ? Promise.resolve({ answer: null }) : getJson(exec, runsPath(base, RUNS_PER_BRANCH, ownBranch), location, login),
    getJson(exec, runsPath(base, RUNS_RECENT_READ, null), location, login),
  ])
  if ('failure' in onMain) return { kind: 'error', failure: onMain.failure }
  if ('failure' in onBranch) return { kind: 'error', failure: onBranch.failure }
  if ('failure' in onAny) return { kind: 'error', failure: onAny.failure }
  return {
    kind: 'ok',
    defaultBranch,
    main: newestPerWorkflow(runsOf(onMain.answer)),
    branch: newestPerWorkflow(runsOf(onBranch.answer)),
    recent: recentRuns(runsOf(onAny.answer), defaultBranch, location.branch),
  }
}

/** The transient failure a run list is retrying, if any. */
export function runsProblemOf(list: RunList | null): Problem | null {
  if (list === null || list.kind === 'loading') return null
  return list.problem ?? null
}

/** A transient failure as a problem: reason, first failure of the streak, and the next backoff step. */
function problemFor(failure: Failure, earlier: Problem | null, at: string): Problem {
  return { reason: reasonOf(failure), since: earlier?.since ?? at, triedAt: at, retryInMs: backoffMs(earlier?.retryInMs ?? null) }
}

/**
 * The run list after a read. A transient failure keeps the last list and marks
 * it with a problem (15, 30, then 60 s backoff); with no list to keep it
 * becomes an error that still carries the problem.
 */
export function runsAfter(prev: RunList | null, fetched: FetchedRuns, at: string, location: RepoLocation, account: AccountChoice): RunList {
  if (fetched.kind === 'ok') {
    return { kind: 'list', at, location, account, defaultBranch: fetched.defaultBranch, main: fetched.main, branch: fetched.branch, recent: fetched.recent, problem: null }
  }
  const failure = fetched.failure
  if (!isTransient(failure.kind)) return { kind: 'error', at, message: failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message }
  const problem = problemFor(failure, runsProblemOf(prev), at)
  if (prev !== null && prev.kind === 'list') return { ...prev, problem }
  return { kind: 'error', at, message: failure.message, problem }
}

/**
 * One page across the groups in order main, branch, recent. `page` is 1-based
 * and clamped. Pure, exported for tests.
 */
export function paginateRuns(groups: Record<RunGroup, readonly RunItem[]>, page: number, pageSize: number = PAGE_SIZE): RunPage {
  const rows: RunRow[] = []
  for (const group of RUN_GROUPS) {
    for (const item of groups[group]) rows.push({ group, item })
  }
  const size = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const wanted = Number.isFinite(page) ? Math.floor(page) : 1
  const clamped = Math.min(Math.max(wanted, 1), pageCount)
  const start = (clamped - 1) * size
  const slice = rows.slice(start, start + size)
  return {
    rows: slice,
    page: clamped,
    pageCount,
    first: slice.length === 0 ? 0 : start + 1,
    last: start + slice.length,
    total: rows.length,
  }
}

/**
 * Rows the Actions pane needs for its current page (zero-based `page`): 3 per
 * run, a heading per group, a blank before every heading but the first, and 4
 * for the header, the footer and slack for a stale hint or a wrapped footer.
 * At least 6, at most 40.
 */
export function runRowCount(list: RunList | null, page: number): number {
  return Math.min(40, Math.max(6, runDrawnRows(list, page, PAGE_SIZE)))
}

/** Rows the Actions list view draws for the zero-based `page` of `pageSize` items, uncapped (0 without a list). */
export function runDrawnRows(list: RunList | null, page: number, pageSize: number, isPadded = false): number {
  if (list === null || list.kind !== 'list') return 0
  const shown = paginateRuns(list, page + 1, pageSize)
  const groups = new Set(shown.rows.map(row => row.group)).size
  // Per group: its heading (+1) and no blank after its last run (-1); between groups, one blank.
  const padding = isPadded ? Math.max(0, Math.min(pageSize, shown.total) - shown.rows.length) : 0
  return (shown.rows.length + padding) * ROWS_PER_RUN + Math.max(0, groups - 1) + 4
}

/** The page size that makes the Actions list fit `bodyRows` when the page starts at item `firstIndex`. */
export function runPageSize(list: RunList | null, firstIndex: number, bodyRows: number | undefined): number {
  return fitPageSize(size => runDrawnRows(list, Math.floor(firstIndex / size), size, true), bodyRows)
}

/** The highest zero-based page of the run list. */
export function lastRunPage(list: RunList | null, pageSize: number = PAGE_SIZE): number {
  if (list === null || list.kind !== 'list') return 0
  return paginateRuns(list, 1, pageSize).pageCount - 1
}

/** States that make a workflow count as failing on the default branch. Cancelled does not. */
const FAILING = new Set(['failure', 'timed-out'])

/**
 * The status of the default branch from its runs: the newest run per workflow
 * decides. worst = failure (failure and timed-out) over running over queued
 * over success; anything else (cancelled, skipped, neutral, ...) is 'neutral';
 * null without runs. failing lists those workflows, newest first. Pure.
 */
export function mainStatusOf(runs: readonly RunItem[], defaultBranch: string, at: string): MainStatus {
  const newest = newestPerWorkflow(runs)
  const failing = newest
    .filter(run => FAILING.has(run.state))
    .sort(byNewest)
    .map(run => ({ name: run.name, runId: run.id, url: run.url }))
  const states = new Set(newest.map(run => run.state))
  let worst: MainStatus['worst'] = null
  if (newest.length > 0) {
    if (failing.length > 0) worst = 'failure'
    else if (states.has('running')) worst = 'running'
    else if (states.has('queued')) worst = 'queued'
    else if (states.has('success')) worst = 'success'
    else worst = 'neutral'
  }
  return { at, defaultBranch, worst, failing }
}

/**
 * Reads the default branch's runs (50) with a conditional GET. A 304 costs no
 * rate limit and returns 'unchanged'. `etag` is the one an earlier call
 * returned; pass `knownDefault` (an earlier status's defaultBranch) so that no
 * extra call finds the default branch.
 */
export async function fetchMainStatus(exec: Exec, location: RepoLocation, login: string, etag: string | null = null, knownDefault: string | null = null, now: () => string = () => new Date().toISOString()): Promise<FetchedMainStatus> {
  const base = repoPath(location)
  if (base === null) return { kind: 'error', failure: failed('no GitHub repository to read runs of') }
  let defaultBranch = knownDefault
  if (defaultBranch === null) {
    const found = await readDefaultBranch(exec, base, location, login)
    if ('failure' in found) return { kind: 'error', failure: found.failure }
    defaultBranch = found.branch
  }
  const path = runsPath(base, RUNS_PER_BRANCH, defaultBranch)
  const args = etag === null ? ['api', '-i', path] : ['api', '-i', '-H', `If-None-Match: ${etag}`, path]
  const ran = await runGh(exec, args, { login, cwd: location.cwd })
  const parsed = parseIncludeOutput(ran.stdout)
  // A 304 makes gh exit 1, so it is told from stdout, as in etag.ts.
  if (parsed.status === 304) return { kind: 'unchanged', etag }
  if (!ran.isOk) return { kind: 'error', failure: ran }
  const answer = parseJson(parsed.body)
  if (parsed.status !== 200 || answer === null) return { kind: 'error', failure: unreadable() }
  return { kind: 'ok', status: mainStatusOf(runsOf(answer), defaultBranch, now()), etag: parsed.etag ?? etag }
}

/** Reads one run and its jobs. A run that cannot be read as a run is an unreadable answer. */
export async function fetchRun(exec: Exec, location: RepoLocation, login: string, runId: number): Promise<FetchedRun> {
  const base = repoPath(location)
  if (base === null) return { kind: 'error', failure: failed('no GitHub repository to read the run of') }
  const [asked, jobs] = await Promise.all([
    getJson(exec, `${base}/actions/runs/${runId}`, location, login),
    fetchJobs(exec, location, login, [runId]),
  ])
  if ('failure' in asked) return { kind: 'error', failure: asked.failure }
  const run = normalizeRun(asked.answer)
  return run === null ? { kind: 'error', failure: unreadable() } : { kind: 'ok', run, jobs }
}

/** The transient failure a run snapshot is retrying, if any. */
export function runProblemOf(snapshot: RunSnapshot | null): Problem | null {
  if (snapshot === null || snapshot.kind === 'loading') return null
  return snapshot.kind === 'run' ? (snapshot.stale ?? null) : (snapshot.problem ?? null)
}

/**
 * The run snapshot after a read. A 404 is an error naming the run; a
 * transient failure keeps the last snapshot of this run, marked stale, with the
 * same backoff as the list.
 */
export function runAfter(prev: RunSnapshot | null, fetched: FetchedRun, at: string, location: RepoLocation, account: AccountChoice, runId: number): RunSnapshot {
  if (fetched.kind === 'ok') return { kind: 'run', at, location, account, run: fetched.run, jobs: fetched.jobs, stale: null }
  const failure = fetched.failure
  if (failure.kind === 'not-found') return { kind: 'error', at, runId, message: `run ${runId} not found in ${location.owner ?? ''}/${location.repo ?? ''}` }
  if (!isTransient(failure.kind)) return { kind: 'error', at, runId, message: failure.kind === 'gh-missing' ? 'gh is not installed' : failure.message }
  const problem = problemFor(failure, runProblemOf(prev), at)
  if (prev !== null && prev.kind === 'run' && prev.run.id === runId) return { ...prev, stale: problem }
  return { kind: 'error', at, runId, message: failure.message, problem }
}

/** Milliseconds until the next read of the run: the backoff while failing, 15 s while it is queued or running, else 60 s. */
export function runDelayMs(snapshot: RunSnapshot | null, rateLimit: RateLimit | null = null): number {
  const problem = runProblemOf(snapshot)
  if (problem !== null) return pollDelayMs(problem.retryInMs, rateLimit)
  const isLive = snapshot !== null && snapshot.kind === 'run' && (snapshot.run.state === 'queued' || snapshot.run.state === 'running')
  return pollDelayMs(isLive ? RUN_POLL_MS : RUN_IDLE_POLL_MS, rateLimit)
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Job states that count as failed in a run reference. */
const FAILED_JOB_STATES: readonly string[] = ['failure', 'timed-out']

/**
 * The text `[f]` in a run's detail puts into the prompt: which workflow failed where
 * and how to read it, never the log itself. Null unless the snapshot is a run that
 * failed or has a failed job. Pure.
 */
export function runReference(snapshot: RunSnapshot): string | null {
  if (snapshot.kind !== 'run') return null
  const { run, jobs, location } = snapshot
  const failed = jobs.filter(job => FAILED_JOB_STATES.includes(job.state))
  if (!FAILED_JOB_STATES.includes(run.state) && failed.length === 0) return null
  const slug = location.owner !== null && location.repo !== null ? `${location.owner}/${location.repo}` : ''
  const lines = [`CI failed in workflow "${oneLine(run.name)}" on ${slug} (run ${run.id}, ${run.url})`]
  if (run.branch !== null) lines.push(`Branch: ${oneLine(run.branch)}`)
  if (run.headSha !== '') lines.push(`Commit: ${run.headSha}`)
  if (failed.length > 0) {
    lines.push('Failed jobs:')
    for (const job of failed) {
      const parts = [`${oneLine(job.name)}: ${job.state}`, `job ${job.jobId}`]
      if (job.failedStep) parts.push(`failed step "${oneLine(job.failedStep)}"`)
      lines.push(`- ${parts.join(', ')}`)
    }
  }
  lines.push(`  gh run view ${run.id} --log-failed${slug === '' ? '' : ` -R ${slug}`}`)
  lines.push('Please investigate this failure and fix it.')
  return lines.join('\n')
}
