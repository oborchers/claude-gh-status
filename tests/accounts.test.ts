import { describe, expect, test } from 'claude-code/testing'

import { canRead, listLogins, parseAccountConfig, resolveAccount } from '../src/accounts'
import type { AccountMemory } from '../src/accounts'
import { forgetTokens } from '../src/gh'
import type { Exec } from '../src/gh'
import type { RepoLocation } from '../src/model'

const done = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const hosts = (entries: { login: string; active: boolean; state?: string }[]) =>
  JSON.stringify({ hosts: { 'github.com': entries.map(e => ({ state: 'success', host: 'github.com', ...e })), 'other.example': [{ state: 'success', active: true, login: 'ghe' }] } })

type World = { status?: string | 'reject'; readable: string[] }

/** Fake gh: tokens are `tok-<login>`; the probe succeeds for logins in `readable`. */
function fakeWorld(world: World) {
  const argvs: string[][] = []
  const probed: string[] = []
  const exec: Exec = async (argv, init) => {
    argvs.push([...argv])
    if (argv[1] === 'auth' && argv[2] === 'status') {
      if (world.status === 'reject' || world.status === undefined) throw new Error('spawn gh ENOENT')
      return done(0, world.status)
    }
    if (argv[1] === 'auth' && argv[2] === 'token') return done(0, `tok-${argv[4]}\n`)
    if (argv[1] === 'api') {
      const login = (init?.env?.GH_TOKEN ?? '').replace('tok-', '')
      probed.push(login)
      return world.readable.includes(login)
        ? done(0, '{"data":{"repository":{"id":"R_1"}}}')
        : done(1, '{"data":{"repository":null}}', "Could not resolve to a Repository with the name 'acme/widgets'.")
    }
    return done(1)
  }
  return { exec, argvs, probed }
}

function fakeMemory(initial: Record<string, string> = {}) {
  const store = { ...initial }
  const events: string[] = []
  const memory: AccountMemory = {
    get: async owner => store[owner] ?? null,
    set: async (owner, login) => { store[owner] = login; events.push(`set ${owner} ${login}`) },
    forget: async owner => { delete store[owner]; events.push(`forget ${owner}`) },
  }
  return { memory, store, events }
}

const location = (over: Partial<RepoLocation> = {}): RepoLocation => ({ cwd: '/w', branch: 'b', owner: 'Acme', repo: 'widgets', pinnedLogin: null, ...over })
const both = hosts([{ login: 'alice', active: true }, { login: 'bob', active: false }])

function expectNoTokenInArgv(argvs: string[][]) {
  for (const argv of argvs) for (const part of argv) expect(part.includes('tok-')).toBe(false)
}

describe('parseAccountConfig', () => {
  test('lowercases owners and trims', () => {
    expect(parseAccountConfig('oborchers=oborchers, Example-Org = work-login')).toEqual({ oborchers: 'oborchers', 'example-org': 'work-login' })
  })
  test('ignores malformed parts', () => {
    expect(parseAccountConfig('noequals, =x, y=, a=b c, ok=fine,,')).toEqual({ ok: 'fine' })
    expect(parseAccountConfig('')).toEqual({})
  })
})

describe('listLogins', () => {
  test('lists github.com successes with the active first', async () => {
    const status = hosts([{ login: 'bob', active: false }, { login: 'alice', active: true }, { login: 'old', active: false, state: 'error' }])
    expect(await listLogins(fakeWorld({ status, readable: [] }).exec)).toEqual({ active: 'alice', others: ['bob'] })
  })
  test('no logins', async () => {
    expect(await listLogins(fakeWorld({ status: '{"hosts":{}}', readable: [] }).exec)).toEqual({ active: null, others: [] })
  })
  test('a rejecting exec means gh is missing', async () => {
    expect(await listLogins(fakeWorld({ status: 'reject', readable: [] }).exec)).toEqual({ kind: 'gh-missing' })
  })
})

describe('canRead', () => {
  test('true only when the repository is returned', async () => {
    forgetTokens()
    const world = fakeWorld({ readable: ['alice'] })
    expect(await canRead(world.exec, 'alice', 'acme', 'widgets')).toBe(true)
    expect(await canRead(world.exec, 'bob', 'acme', 'widgets')).toBe(false)
    expectNoTokenInArgv(world.argvs)
  })
})

describe('resolveAccount', () => {
  test('config wins and is not probed', async () => {
    forgetTokens()
    const world = fakeWorld({ status: both, readable: [] })
    const mem = fakeMemory({ Acme: 'bob' })
    const result = await resolveAccount({ exec: world.exec, memory: mem.memory }, location({ pinnedLogin: 'bob' }), { acme: 'carol' })
    expect(result).toEqual({ login: 'carol', source: 'config' })
    expect(world.argvs.length).toBe(0)
  })
  test('pinned beats remembered and active, without probing', async () => {
    forgetTokens()
    const world = fakeWorld({ status: both, readable: [] })
    const result = await resolveAccount({ exec: world.exec, memory: fakeMemory({ Acme: 'bob' }).memory }, location({ pinnedLogin: 'zed' }), {})
    expect(result).toEqual({ login: 'zed', source: 'pinned' })
    expect(world.argvs.length).toBe(0)
  })
  test('remembered is used when it can still read', async () => {
    forgetTokens()
    const world = fakeWorld({ status: both, readable: ['bob', 'alice'] })
    const result = await resolveAccount({ exec: world.exec, memory: fakeMemory({ Acme: 'bob' }).memory }, location(), {})
    expect(result).toEqual({ login: 'bob', source: 'remembered' })
    expectNoTokenInArgv(world.argvs)
  })
  test('a remembered login that lost access is forgotten, then active is tried', async () => {
    forgetTokens()
    const world = fakeWorld({ status: both, readable: ['alice'] })
    const mem = fakeMemory({ Acme: 'bob' })
    const result = await resolveAccount({ exec: world.exec, memory: mem.memory }, location(), {})
    expect(result).toEqual({ login: 'alice', source: 'active' })
    expect(mem.events).toEqual(['forget Acme'])
    expect(world.probed).toEqual(['bob', 'alice'])
  })
  test('active is not remembered', async () => {
    forgetTokens()
    const mem = fakeMemory()
    const result = await resolveAccount({ exec: fakeWorld({ status: both, readable: ['alice', 'bob'] }).exec, memory: mem.memory }, location(), {})
    expect(result).toEqual({ login: 'alice', source: 'active' })
    expect(mem.events).toEqual([])
  })
  test('a probed login is remembered', async () => {
    forgetTokens()
    const world = fakeWorld({ status: both, readable: ['bob'] })
    const mem = fakeMemory()
    const result = await resolveAccount({ exec: world.exec, memory: mem.memory }, location(), {})
    expect(result).toEqual({ login: 'bob', source: 'probed' })
    expect(mem.events).toEqual(['set Acme bob'])
    expect(world.probed).toEqual(['alice', 'bob'])
    expectNoTokenInArgv(world.argvs)
    for (const argv of world.argvs) expect(argv.includes('switch')).toBe(false)
  })
  test('no-access lists every login tried, once each', async () => {
    forgetTokens()
    const result = await resolveAccount({ exec: fakeWorld({ status: both, readable: [] }).exec, memory: fakeMemory({ Acme: 'bob' }).memory }, location(), {})
    expect(result).toEqual({ kind: 'no-access', tried: ['bob', 'alice'] })
  })
  test('not-logged-in when gh knows no logins', async () => {
    forgetTokens()
    const result = await resolveAccount({ exec: fakeWorld({ status: '{"hosts":{}}', readable: [] }).exec, memory: fakeMemory().memory }, location(), {})
    expect(result).toEqual({ kind: 'not-logged-in', tried: [] })
  })
  test('gh-missing when gh cannot start', async () => {
    forgetTokens()
    const result = await resolveAccount({ exec: fakeWorld({ status: 'reject', readable: [] }).exec, memory: fakeMemory().memory }, location(), {})
    expect(result).toEqual({ kind: 'gh-missing', tried: [] })
  })
  test('a location without owner and repo is no-access', async () => {
    const result = await resolveAccount({ exec: fakeWorld({ readable: [] }).exec, memory: fakeMemory().memory }, location({ owner: null, repo: null }), {})
    expect(result).toEqual({ kind: 'no-access', tried: [] })
  })
})
