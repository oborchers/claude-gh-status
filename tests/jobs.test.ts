import { describe, expect, test } from 'claude-code/testing'

import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import { fetchJobs, parseJobs } from '../src/jobs'
import type { RepoLocation } from '../src/model'
import { jobsFailed, jobsRunning } from './fixtures/jobs'

const location: RepoLocation = { cwd: '/work/cli', branch: 'feature', owner: 'cli', repo: 'cli', pinnedLogin: null }

describe('parseJobs', () => {
  test('a finished run with a failed step', () => {
    const jobs = parseJobs(jobsFailed, 37981739982)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({
      jobId: 113993699722,
      runId: 37981739982,
      name: 'lint',
      state: 'success',
      currentStep: null,
      failedStep: null,
      url: 'https://github.com/cli/cli/actions/runs/37981739982/job/113993699722',
    })
    expect(jobs[1]?.state).toBe('failure')
    expect(jobs[1]?.failedStep).toBe('Check Go vulnerabilities')
    expect(jobs[1]?.currentStep).toBeNull()
  })

  test('a running job names its current step', () => {
    const jobs = parseJobs(jobsRunning, 1)
    expect(jobs[0]?.state).toBe('running')
    expect(jobs[0]?.currentStep).toBe('Set up Go')
    expect(jobs[0]?.failedStep).toBeNull()
  })

  test('queued jobs and unexpected shapes', () => {
    const queued = parseJobs({ jobs: [{ databaseId: 5, name: 'x', status: 'queued', conclusion: '', url: null, steps: [] }] }, 2)
    expect(queued[0]).toMatchObject({ state: 'queued', url: null, runId: 2 })
    for (const raw of [undefined, null, 4, 'x', [], {}, { jobs: 'no' }, { jobs: [null, 3, { name: 'no id' }, { databaseId: 1 }] }]) {
      expect(parseJobs(raw, 1)).toEqual([])
    }
    const noSteps = parseJobs({ jobs: [{ databaseId: 9, name: 'y', status: 'completed', conclusion: 'cancelled', steps: 'bad' }] }, 3)
    expect(noSteps[0]?.state).toBe('cancelled')
    expect(noSteps[0]?.currentStep).toBeNull()
  })
})

function fakeExec(byRun: Record<string, { stdout: string; exitCode: number }>): { exec: Exec; runs: string[] } {
  const runs: string[] = []
  const exec: Exec = async argv => {
    if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const id = argv[3] ?? ''
    runs.push(id)
    expect(argv.slice(0, 3)).toEqual(['gh', 'run', 'view'])
    expect(argv.slice(4)).toEqual(['--json', 'jobs', '-R', 'cli/cli'])
    const answer = byRun[id] ?? { stdout: '', exitCode: 1 }
    return { exitCode: answer.exitCode, stdout: answer.stdout, stderr: answer.exitCode === 0 ? '' : 'HTTP 404', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { exec, runs }
}

describe('fetchJobs', () => {
  test('collects the jobs of every run and skips runs that fail', async () => {
    forgetTokens()
    const { exec } = fakeExec({
      '10': { stdout: JSON.stringify(jobsFailed), exitCode: 0 },
      '11': { stdout: '', exitCode: 1 },
      '12': { stdout: 'not json', exitCode: 0 },
      '13': { stdout: JSON.stringify(jobsRunning), exitCode: 0 },
    })
    const jobs = await fetchJobs(exec, location, 'oborchers', [10, 11, 12, 13])
    expect(jobs.map(job => job.runId)).toEqual([10, 10, 13, 13])
  })

  test('looks at no more than five distinct runs', async () => {
    forgetTokens()
    const { exec, runs } = fakeExec({})
    await fetchJobs(exec, location, 'oborchers', [1, 1, 2, 3, 4, 5, 6, 7])
    expect(runs.slice().sort()).toEqual(['1', '2', '3', '4', '5'])
  })

  test('without a repository there is nothing to ask', async () => {
    const { exec, runs } = fakeExec({})
    expect(await fetchJobs(exec, { ...location, owner: null }, 'oborchers', [1])).toEqual([])
    expect(runs).toEqual([])
  })
})
