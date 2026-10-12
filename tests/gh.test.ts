import { describe, expect, test } from 'claude-code/testing'

import { classifyGhError, forgetTokens, runGh } from '../src/gh'
import type { Exec } from '../src/gh'

describe('runGh', () => {
  test('passes the login token only as GH_TOKEN of that child', async () => {
    forgetTokens()
    const calls: { argv: readonly string[]; env: Record<string, string> | undefined }[] = []
    const exec: Exec = async (argv, init) => {
      calls.push({ argv, env: init?.env })
      if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok123\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      return { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    }
    const result = await runGh(exec, ['api', 'user'], { login: 'oborchers' })
    expect(result.isOk).toBe(true)
    expect(calls[0]?.argv).toEqual(['gh', 'auth', 'token', '-u', 'oborchers'])
    expect(calls[1]?.env?.GH_TOKEN).toBe('tok123')
  })

  test('classifies a repository the account cannot see as not-found', () => {
    expect(classifyGhError("GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)")).toBe('not-found')
  })
})
