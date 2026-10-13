// Live Actions job detail, read with `gh run view <id> --json jobs`. Fetched
// only while the pane is open and checks are running or failed.

import { runGh } from './gh'
import type { Exec } from './gh'
import type { JobDetail, RepoLocation } from './model'
import { checkStateFrom } from './query'
import { cleanStr } from './text'

const MAX_RUNS = 5

type Obj = Record<string, unknown>

function asObj(value: unknown): Obj | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : null
}

function asStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function lowerStr(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

/** Reads `gh run view --json jobs` output into job details. Pure; never throws. */
export function parseJobs(raw: unknown, runId: number): JobDetail[] {
  const jobs = asObj(raw)?.jobs
  if (!Array.isArray(jobs)) return []
  const result: JobDetail[] = []
  for (const entry of jobs) {
    const job = asObj(entry)
    const jobId = job?.databaseId
    const name = cleanStr(job?.name)
    if (job === null || typeof jobId !== 'number' || name === null) continue
    const steps = Array.isArray(job.steps) ? job.steps.map(asObj).filter((step): step is Obj => step !== null) : []
    const current = steps.find(step => lowerStr(step.status) === 'in_progress')
    const failed = steps.find(step => lowerStr(step.conclusion) === 'failure')
    result.push({
      jobId,
      runId,
      name,
      state: checkStateFrom(job.status, job.conclusion),
      currentStep: cleanStr(current?.name),
      failedStep: cleanStr(failed?.name),
      url: asStr(job.url),
    })
  }
  return result
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Fetches the jobs of up to five workflow runs in parallel; a run that fails is skipped. */
export async function fetchJobs(exec: Exec, location: RepoLocation, login: string, runIds: number[]): Promise<JobDetail[]> {
  if (location.owner === null || location.repo === null) return []
  const repo = `${location.owner}/${location.repo}`
  const unique = [...new Set(runIds)].slice(0, MAX_RUNS)
  const perRun = await Promise.all(
    unique.map(async runId => {
      const ran = await runGh(exec, ['run', 'view', String(runId), '--json', 'jobs', '-R', repo], { login, cwd: location.cwd })
      return ran.isOk ? parseJobs(parseJson(ran.stdout), runId) : []
    }),
  )
  return perRun.flat()
}
