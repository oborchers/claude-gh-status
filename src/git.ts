// Reads where the session's working directory points, as git sees it. Pure
// parsers plus one injected-Exec reader; every git call runs in the given cwd,
// so a linked worktree reports its own branch.

import type { RepoLocation } from './model'
import type { Exec } from './gh'

const GIT_TIMEOUT_MS = 5_000
const URL_FORM = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i
const SCP_FORM = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/
const PINNED_LOGIN = /gh\s+auth\s+token\s+(?:-u|--user)[\s=]+["']?([A-Za-z0-9][A-Za-z0-9_-]*)/

/** Extracts owner and repository from a github.com remote URL; null for anything else. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const text = url.trim()
  const match = URL_FORM.exec(text) ?? SCP_FORM.exec(text)
  if (match === null) return null
  const host = match[1]
  const path = match[2]
  if (host === undefined || path === undefined || host.toLowerCase() !== 'github.com') return null
  const segments = path.replace(/\/+$/, '').replace(/\.git$/i, '').split('/')
  const owner = segments[0]
  const repo = segments[1]
  if (segments.length !== 2 || !owner || !repo) return null
  return { owner, repo }
}

/** Finds the login a repo-local `gh auth token -u <login>` credential helper pins; the last match wins. */
export function parsePinnedLogin(helperLines: readonly string[]): string | null {
  let login: string | null = null
  for (const line of helperLines) {
    const match = PINNED_LOGIN.exec(line)
    const found = match?.[1]
    if (found !== undefined) login = found
  }
  return login
}

/** Reads branch, GitHub remote and pinned login in cwd; null when cwd is not in a git work tree. */
export async function readLocation(exec: Exec, cwd: string): Promise<RepoLocation | null> {
  const inside = await git(exec, cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside === null || inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return null
  const [branch, remote, helper, hostHelper] = await Promise.all([
    git(exec, cwd, ['branch', '--show-current']),
    git(exec, cwd, ['remote', 'get-url', 'origin']),
    git(exec, cwd, ['config', '--local', '--get-all', 'credential.helper']),
    git(exec, cwd, ['config', '--local', '--get-all', 'credential.https://github.com.helper']),
  ])
  const branchName = branch !== null && branch.exitCode === 0 ? branch.stdout.trim() : ''
  const parsed = remote !== null && remote.exitCode === 0 ? parseGitHubRemote(remote.stdout) : null
  return {
    cwd,
    branch: branchName === '' ? null : branchName,
    owner: parsed?.owner ?? null,
    repo: parsed?.repo ?? null,
    pinnedLogin: parsePinnedLogin([...lines(helper), ...lines(hostHelper)]),
  }
}

async function git(exec: Exec, cwd: string, args: readonly string[]) {
  try {
    return await exec(['git', '-C', cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  } catch {
    return null
  }
}

function lines(ran: { exitCode: number | null; stdout: string } | null): string[] {
  if (ran === null || ran.exitCode !== 0) return []
  return ran.stdout.split('\n').filter(line => line.trim() !== '')
}
