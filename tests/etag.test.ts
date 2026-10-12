import { describe, expect, test } from 'claude-code/testing'

import { fastCheck, fastPaths, parseIncludeOutput } from '../src/etag'
import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import type { RepoLocation } from '../src/model'

const location: RepoLocation = { cwd: '/work/cli', branch: 'feature', owner: 'cli', repo: 'cli', pinnedLogin: null }
const target = { prNumber: 7, headOid: 'abc123' }
const paths = fastPaths(location, target)

const OK_200 = 'HTTP/2.0 200 OK\r\nCache-Control: private, max-age=60\r\nEtag: W/"aaa"\r\nX-Ratelimit-Used: 28\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{"total_count":0}\n'
const NOT_MODIFIED_304 = 'HTTP/2.0 304 Not Modified\r\nEtag: "aaa"\r\nX-Ratelimit-Remaining: 4973\r\nX-Ratelimit-Used: 27\r\n\r\n'

function response(etag: string): string {
  return OK_200.replace('W/"aaa"', etag)
}

describe('parseIncludeOutput', () => {
  test('a 200 answer', () => {
    expect(parseIncludeOutput(OK_200)).toEqual({ status: 200, etag: 'W/"aaa"', body: '{"total_count":0}\n' })
  })

  test('a 304 answer as gh prints it, with a strong etag and no body', () => {
    expect(parseIncludeOutput(NOT_MODIFIED_304)).toEqual({ status: 304, etag: '"aaa"', body: '' })
  })

  test('HTTP/1.1, bare line feeds and any header casing', () => {
    expect(parseIncludeOutput('HTTP/1.1 200 OK\nETAG: W/"b"\n\n[1]')).toEqual({ status: 200, etag: 'W/"b"', body: '[1]' })
  })

  test('headers without a body separator', () => {
    expect(parseIncludeOutput('HTTP/2.0 304 Not Modified\r\nEtag: "z"')).toEqual({ status: 304, etag: '"z"', body: '' })
  })

  test('no status line', () => {
    expect(parseIncludeOutput('{"a":1}')).toEqual({ status: 0, etag: null, body: '{"a":1}' })
    expect(parseIncludeOutput('')).toEqual({ status: 0, etag: null, body: '' })
  })

  test('an error status without an etag', () => {
    expect(parseIncludeOutput('HTTP/2.0 403 Forbidden\r\nContent-Type: x\r\n\r\n{"message":"rate limit"}')).toMatchObject({ status: 403, etag: null })
  })
})

type Seen = { path: string; ifNoneMatch: string | null }

/** Answers each request path with the next function result; 304 when If-None-Match equals the current tag. */
function serverExec(current: Record<string, string>, forced: Record<string, { stdout: string; exitCode: number; stderr?: string }> = {}): { exec: Exec; seen: Seen[] } {
  const seen: Seen[] = []
  const exec: Exec = async argv => {
    if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const path = argv[argv.length - 1] ?? ''
    const header = argv.indexOf('-H')
    const sent = header === -1 ? null : (argv[header + 1] ?? '').replace('If-None-Match: ', '')
    seen.push({ path, ifNoneMatch: sent })
    const force = forced[path]
    if (force !== undefined) return { exitCode: force.exitCode, stdout: force.stdout, stderr: force.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false }
    const tag = current[path] ?? '"zzz"'
    const strong = tag.replace(/^W\//, '')
    if (sent !== null && sent.replace(/^W\//, '') === strong) {
      return { exitCode: 1, stdout: NOT_MODIFIED_304.replace('"aaa"', strong), stderr: 'gh: HTTP 304\n', isStdoutTruncated: false, isStderrTruncated: false }
    }
    return { exitCode: 0, stdout: response(tag), stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { exec, seen }
}

function tags(version: string): Record<string, string> {
  return Object.fromEntries(paths.map((path, index) => [path, `W/"${version}-${index}"`]))
}

describe('fastPaths', () => {
  test('watches check runs, commit status, the pull request, its comments and its review comments', () => {
    expect(paths).toEqual([
      'repos/cli/cli/commits/abc123/check-runs?per_page=100',
      'repos/cli/cli/commits/abc123/status',
      'repos/cli/cli/pulls/7',
      'repos/cli/cli/issues/7/comments?per_page=100',
      'repos/cli/cli/pulls/7/comments?per_page=100',
    ])
  })
})

describe('fastCheck', () => {
  test('a first call has no etags and counts as changed', async () => {
    forgetTokens()
    const { exec, seen } = serverExec(tags('v1'))
    const result = await fastCheck(exec, location, 'oborchers', target, {})
    expect(result.isChanged).toBe(true)
    expect(result.isFailed).toBe(false)
    expect(result.etags).toEqual(tags('v1'))
    expect(seen.every(request => request.ifNoneMatch === null)).toBe(true)
  })

  test('304 on every request means nothing changed, and the etags are kept', async () => {
    forgetTokens()
    const stored = tags('v1')
    const { exec, seen } = serverExec(stored)
    const result = await fastCheck(exec, location, 'oborchers', target, stored)
    expect(result).toEqual({ isChanged: false, etags: stored, isFailed: false })
    expect(seen.map(request => request.ifNoneMatch)).toEqual(Object.values(stored))
  })

  test('one 200 with a new etag changes it and the new tag is stored', async () => {
    forgetTokens()
    const stored = tags('v1')
    const server = tags('v1')
    const pulls = paths[2] ?? ''
    server[pulls] = 'W/"v2-pull"'
    const { exec } = serverExec(server)
    const result = await fastCheck(exec, location, 'oborchers', target, stored)
    expect(result.isChanged).toBe(true)
    expect(result.isFailed).toBe(false)
    expect(result.etags[pulls]).toBe('W/"v2-pull"')
    expect(result.etags[paths[0] ?? '']).toBe(stored[paths[0] ?? ''])
  })

  test('a 200 that repeats the stored etag is not a change', async () => {
    forgetTokens()
    const stored = tags('v1')
    const forced: Record<string, { stdout: string; exitCode: number }> = {}
    for (const path of paths) forced[path] = { stdout: response(stored[path] ?? ''), exitCode: 0 }
    const result = await fastCheck(serverExec(stored, forced).exec, location, 'oborchers', target, stored)
    expect(result.isChanged).toBe(false)
  })

  test('a weak and a strong spelling of the same tag are the same tag', async () => {
    forgetTokens()
    const stored = Object.fromEntries(paths.map(path => [path, '"same"']))
    const forced: Record<string, { stdout: string; exitCode: number }> = {}
    for (const path of paths) forced[path] = { stdout: response('W/"same"'), exitCode: 0 }
    const result = await fastCheck(serverExec(stored, forced).exec, location, 'oborchers', target, stored)
    expect(result.isChanged).toBe(false)
  })

  test('a failing request is reported without hiding a change elsewhere', async () => {
    forgetTokens()
    const stored = tags('v1')
    const server = tags('v1')
    server[paths[1] ?? ''] = 'W/"v2-status"'
    const forced = { [paths[3] ?? '']: { stdout: 'HTTP/2.0 403 Forbidden\r\n\r\n{"message":"API rate limit exceeded"}', exitCode: 1, stderr: 'gh: API rate limit exceeded (HTTP 403)' } }
    const result = await fastCheck(serverExec(server, forced).exec, location, 'oborchers', target, stored)
    expect(result.isFailed).toBe(true)
    expect(result.isChanged).toBe(true)
    expect(result.etags[paths[3] ?? '']).toBe(stored[paths[3] ?? ''])
  })

  test('everything failing is failed and not changed', async () => {
    forgetTokens()
    const stored = tags('v1')
    const exec: Exec = async argv => {
      if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      return { exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com', isStdoutTruncated: false, isStderrTruncated: false }
    }
    const result = await fastCheck(exec, location, 'oborchers', target, stored)
    expect(result).toEqual({ isChanged: false, etags: stored, isFailed: true })
  })

  test('a gh that cannot start does not reject', async () => {
    forgetTokens()
    const exec: Exec = async argv => {
      if (argv[1] === 'auth') return { exitCode: 0, stdout: 'tok\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      throw new Error('spawn gh ENOENT')
    }
    const result = await fastCheck(exec, location, 'oborchers', target, {})
    expect(result.isFailed).toBe(true)
  })
})
