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

describe('classifyGhError for GraphQL internal errors', () => {
  test('a GraphQL internal error during an outage is a temporary server problem', () => {
    const stderr = "gh: Something went wrong while executing your query on 2026-10-12T12:56:00Z. Please include `3072:2D6B0:9F118E:EA5BA5:6ACCD8D6` when reporting this issue."
    expect(classifyGhError(stderr)).toBe('server')
  })

  test('a GraphQL timeout is a temporary server problem', () => {
    expect(classifyGhError("gh: We couldn't respond to your request in time. Sorry about that. Please try resubmitting your request")).toBe('server')
  })
})

describe('classifyGhError: faults of the server and the connection come first', () => {
  test('a 5xx is a server fault even when the text also says not found, rate limit or authentication', () => {
    expect(classifyGhError('gh: HTTP 502 Bad Gateway: upstream repository not found')).toBe('server')
    expect(classifyGhError('HTTP 503 Service Unavailable: rate limit store down')).toBe('server')
    expect(classifyGhError('gh: Server Error: authentication backend unavailable')).toBe('server')
    expect(classifyGhError('gh: Not Found (HTTP 404)')).toBe('not-found')
  })

  test('connection resets, EOF, TLS and broken pipe are network faults', () => {
    const texts = [
      'Post "https://api.github.com/graphql": read tcp 10.0.0.2:51234->140.82.121.5:443: connection reset by peer',
      'Post "https://api.github.com/graphql": EOF',
      'Post "https://api.github.com/graphql": net/http: TLS handshake timeout',
      'write tcp 10.0.0.2:51234: write: broken pipe',
      'Post "https://api.github.com/graphql": unexpected end of JSON input',
      'gh: not found anywhere, connection reset by peer',
    ]
    for (const text of texts) expect(classifyGhError(text)).toBe('network')
  })

  test('exit codes 124, 137 and 143 (timeout, killed, terminated) are timeouts whatever stderr says', () => {
    for (const code of [124, 137, 143]) {
      expect(classifyGhError('', '', code)).toBe('timeout')
      expect(classifyGhError('gh: Not Found (HTTP 404)', '', code)).toBe('timeout')
    }
    expect(classifyGhError('', '', 1)).toBe('failed')
  })

  test('runGh passes the exit code on, so a killed gh is a timeout', async () => {
    const exec: Exec = async () => ({ exitCode: 137, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    expect(await runGh(exec, ['api', 'user'], { login: null })).toMatchObject({ isOk: false, kind: 'timeout', exitCode: 137 })
  })
})
