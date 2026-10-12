import { describe, expect, test } from 'claude-code/testing'

import type { Exec } from '../src/gh'
import { parseGitHubRemote, parsePinnedLogin, readLocation } from '../src/git'

const done = (exitCode: number, stdout = '') => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

describe('parseGitHubRemote', () => {
  const expected = { owner: 'acme', repo: 'widgets' }
  test('accepts the common GitHub URL forms', () => {
    expect(parseGitHubRemote('https://github.com/acme/widgets')).toEqual(expected)
    expect(parseGitHubRemote('https://github.com/acme/widgets.git')).toEqual(expected)
    expect(parseGitHubRemote('https://github.com/acme/widgets/')).toEqual(expected)
    expect(parseGitHubRemote('git@github.com:acme/widgets.git')).toEqual(expected)
    expect(parseGitHubRemote('git@github.com:acme/widgets')).toEqual(expected)
    expect(parseGitHubRemote('ssh://git@github.com/acme/widgets.git')).toEqual(expected)
    expect(parseGitHubRemote('https://x-token@github.com/acme/widgets.git')).toEqual(expected)
    expect(parseGitHubRemote('https://user:pw@GitHub.com/acme/widgets\n')).toEqual(expected)
  })
  test('keeps dots inside repository names', () => {
    expect(parseGitHubRemote('git@github.com:acme/site.github.io.git')).toEqual({ owner: 'acme', repo: 'site.github.io' })
  })
  test('rejects other hosts and malformed paths', () => {
    expect(parseGitHubRemote('https://gitlab.com/acme/widgets.git')).toBeNull()
    expect(parseGitHubRemote('git@bitbucket.org:acme/widgets.git')).toBeNull()
    expect(parseGitHubRemote('https://github.com.evil.com/acme/widgets')).toBeNull()
    expect(parseGitHubRemote('https://github.com/acme')).toBeNull()
    expect(parseGitHubRemote('https://github.com/a/b/c')).toBeNull()
    expect(parseGitHubRemote('')).toBeNull()
    expect(parseGitHubRemote('/local/path/repo')).toBeNull()
  })
})

describe('parsePinnedLogin', () => {
  test('reads the real helper line', () => {
    const line = '!f(){ echo username=x-access-token; echo "password=$(gh auth token -u oborchers)"; }; f'
    expect(parsePinnedLogin([line])).toBe('oborchers')
  })
  test('handles --user forms and underscores', () => {
    expect(parsePinnedLogin(['!gh auth token --user work-login'])).toBe('work-login')
    expect(parsePinnedLogin(['!gh auth token --user=bob; echo'])).toBe('bob')
    expect(parsePinnedLogin(['!gh auth token -u "carol"'])).toBe('carol')
  })
  test('ignores unrelated helpers and lets the last match win', () => {
    expect(parsePinnedLogin(['osxkeychain', '', '!gh auth git-credential'])).toBeNull()
    expect(parsePinnedLogin([])).toBeNull()
    expect(parsePinnedLogin(['!gh auth token -u first)', 'cache', '!gh auth token -u second)'])).toBe('second')
  })
})

type Script = Record<string, { exitCode: number; stdout?: string } | 'reject'>

function fakeGit(script: Script, argvs: string[][] = []): Exec {
  return async argv => {
    argvs.push([...argv])
    const key = argv.slice(3).join(' ')
    const entry = script[key]
    if (entry === 'reject') throw new Error('spawn git ENOENT')
    return entry === undefined ? done(1) : done(entry.exitCode, entry.stdout ?? '')
  }
}

const inRepo: Script = {
  'rev-parse --is-inside-work-tree': { exitCode: 0, stdout: 'true\n' },
  'branch --show-current': { exitCode: 0, stdout: 'feat/x\n' },
  'remote get-url origin': { exitCode: 0, stdout: 'git@github.com:acme/widgets.git\n' },
  'config --local --get-all credential.helper': { exitCode: 0, stdout: '\n!gh auth token -u oborchers)\n' },
}

describe('readLocation', () => {
  test('reads branch, remote and pinned login', async () => {
    expect(await readLocation(fakeGit(inRepo), '/w')).toEqual({ cwd: '/w', branch: 'feat/x', owner: 'acme', repo: 'widgets', pinnedLogin: 'oborchers' })
  })
  test('detached HEAD gives a null branch', async () => {
    const script = { ...inRepo, 'branch --show-current': { exitCode: 0, stdout: '\n' } }
    expect((await readLocation(fakeGit(script), '/w'))?.branch).toBeNull()
  })
  test('no remote gives null owner and repo; missing config is not an error', async () => {
    const script: Script = { ...inRepo, 'remote get-url origin': { exitCode: 2 }, 'config --local --get-all credential.helper': { exitCode: 1 } }
    expect(await readLocation(fakeGit(script), '/w')).toEqual({ cwd: '/w', branch: 'feat/x', owner: null, repo: null, pinnedLogin: null })
  })
  test('a non-GitHub remote gives null owner and repo', async () => {
    const script: Script = { ...inRepo, 'remote get-url origin': { exitCode: 0, stdout: 'https://gitlab.com/a/b.git\n' } }
    expect((await readLocation(fakeGit(script), '/w'))?.owner).toBeNull()
  })
  test('not a repository, or git unavailable, gives null', async () => {
    expect(await readLocation(fakeGit({ 'rev-parse --is-inside-work-tree': { exitCode: 128 } }), '/tmp')).toBeNull()
    expect(await readLocation(fakeGit({ 'rev-parse --is-inside-work-tree': 'reject' }), '/tmp')).toBeNull()
  })
  test('reads the host-scoped helper too', async () => {
    const script: Script = { ...inRepo, 'config --local --get-all credential.helper': { exitCode: 1 }, 'config --local --get-all credential.https://github.com.helper': { exitCode: 0, stdout: '!gh auth token --user=zed\n' } }
    expect((await readLocation(fakeGit(script), '/w'))?.pinnedLogin).toBe('zed')
  })
  test('passes the worktree cwd to every git call', async () => {
    const argvs: string[][] = []
    await readLocation(fakeGit(inRepo, argvs), '/work/tree-2')
    expect(argvs.length).toBe(5)
    for (const argv of argvs) expect(argv.slice(0, 3)).toEqual(['git', '-C', '/work/tree-2'])
  })
})
