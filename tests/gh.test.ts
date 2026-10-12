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

  test('classification table', () => {
    const table: [string, string, string][] = [
      ['gh: HTTP 504', '', 'server'],
      ['HTTP 502: Bad Gateway (https://api.github.com/graphql)', '', 'server'],
      ['gh: HTTP 503 Service Unavailable', '', 'server'],
      ['gh: HTTP 500', '', 'server'],
      ['gh: Server Error', '', 'server'],
      ['Gateway Timeout', '', 'server'],
      ["invalid character '<' looking for beginning of value", '', 'server'],
      ['', '<!DOCTYPE html><html>Unicorn!</html>', 'server'],
      ['gh: Not Found (HTTP 404)', '', 'not-found'],
      ['gh: HTTP 404', '<html>Not Found</html>', 'not-found'],
      ['gh: Bad credentials (HTTP 401)', '', 'auth'],
      ['gh: HTTP 403: API rate limit exceeded', '', 'rate-limited'],
      ['HTTP 429: secondary rate limit', '', 'rate-limited'],
      ['error connecting to api.github.com: could not resolve host', '', 'network'],
      ['operation timeout', '', 'network'],
      ['GraphQL: boom', '', 'failed'],
    ]
    for (const [stderr, stdout, kind] of table) expect(classifyGhError(stderr, stdout)).toBe(kind)
  })

  test('runGh reports a 504 as server and keeps the first stderr line', async () => {
    const exec: Exec = async () => ({ exitCode: 1, stdout: '', stderr: 'gh: HTTP 504\n', isStdoutTruncated: false, isStderrTruncated: false })
    expect(await runGh(exec, ['api', 'user'], { login: null })).toMatchObject({ isOk: false, kind: 'server', message: 'gh: HTTP 504' })
  })
})
