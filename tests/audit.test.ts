import { describe, expect, test } from 'claude-code/testing'

import { canRead } from '../src/accounts'
import { fastCheck } from '../src/etag'
import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import { fetchJobs } from '../src/jobs'
import { fetchCounts, fetchList } from '../src/list'
import type { RepoLocation } from '../src/model'
import { fetchPullRequest, fetchPullRequestByNumber } from '../src/query'

// gh's -F types a value ("123" becomes a number, "true" a bool, "@x" a file read); -f keeps it a string.
// Only integers may use -F: every call is made with values that would be misread, and every -F must
// be followed by a plain integer.

const location: RepoLocation = { cwd: '/work/app', branch: '@branch', owner: '123', repo: 'true', pinnedLogin: null }

describe('gh arguments', () => {
  test('every -F carries a plain integer; owner, repository and branch always go as -f', async () => {
    forgetTokens()
    const argvs: string[][] = []
    const exec: Exec = async argv => {
      argvs.push([...argv])
      if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      return { exitCode: 1, stdout: '', stderr: 'gh: HTTP 500', isStdoutTruncated: false, isStderrTruncated: false }
    }
    await canRead(exec, 'me', '123', 'true')
    await fetchPullRequest(exec, location, 'me')
    await fetchPullRequestByNumber(exec, location, 'me', 7)
    await fetchList(exec, location, 'me')
    await fetchCounts(exec, location, 'me')
    await fastCheck(exec, location, 'me', { kind: 'branch' } as never, {})
    await fetchJobs(exec, location, 'me', [11])
    const ghCalls = argvs.filter(argv => argv[0] === 'gh' && argv[1] !== 'auth')
    expect(ghCalls.length).toBeGreaterThan(4)
    for (const argv of ghCalls) {
      argv.forEach((arg, index) => {
        if (arg === '-F' || arg === '--field') expect(argv[index + 1]).toMatch(/^[a-z]+=\d+$/)
        if (/^(o|n|owner|name|branch)=/.test(arg)) expect(argv[index - 1]).toBe('-f')
      })
    }
    const typed = ghCalls.flatMap(argv => argv.filter((arg, index) => argv[index - 1] === '-F'))
    expect(typed).toEqual(['number=7'])
  })
})
