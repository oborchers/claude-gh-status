// Chooses which gh login reads a repository. Logins only ever reach runGh's
// `login` option; `gh auth switch` is never run, so the global login is untouched.

import type { AccountChoice, AccountFailure, RepoLocation } from './model'
import { runGh } from './gh'
import type { Exec } from './gh'

const LIST_TIMEOUT_MS = 10_000
const PROBE_QUERY = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){id}}'

/** Remembers the login that worked per owner; register.tsx backs it with $.store. */
export type AccountMemory = {
  get(owner: string): Promise<string | null>
  set(owner: string, login: string): Promise<void>
  forget(owner: string): Promise<void>
}

export type LoginList = { active: string | null; others: string[] }

/** Parses `oborchers=oborchers, Org = other_login` into lowercased owner to login. */
export function parseAccountConfig(text: string): Record<string, string> {
  const config: Record<string, string> = {}
  for (const part of text.split(/[,\n]/)) {
    const at = part.indexOf('=')
    if (at < 0) continue
    const owner = part.slice(0, at).trim().toLowerCase()
    const login = part.slice(at + 1).trim()
    if (owner === '' || login === '' || /\s/.test(owner) || /\s/.test(login)) continue
    config[owner] = login
  }
  return config
}

/** Lists the github.com logins gh knows; the active one first. */
export async function listLogins(exec: Exec): Promise<LoginList | { kind: 'gh-missing' }> {
  let ran
  try {
    ran = await exec(['gh', 'auth', 'status', '--json', 'hosts'], { timeoutMs: LIST_TIMEOUT_MS })
  } catch {
    return { kind: 'gh-missing' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(ran.stdout)
  } catch {
    return ran.exitCode === 127 ? { kind: 'gh-missing' } : { active: null, others: [] }
  }
  const hosts = (parsed as { hosts?: Record<string, unknown> } | null)?.hosts
  const entries = hosts?.['github.com']
  let active: string | null = null
  const others: string[] = []
  if (Array.isArray(entries)) {
    for (const entry of entries as { state?: unknown; active?: unknown; login?: unknown }[]) {
      if (entry?.state !== 'success' || typeof entry.login !== 'string' || entry.login === '') continue
      if (entry.active === true && active === null) active = entry.login
      else if (!others.includes(entry.login)) others.push(entry.login)
    }
  }
  return { active, others }
}

/** True when the login can see the repository. */
export async function canRead(exec: Exec, login: string, owner: string, repo: string): Promise<boolean> {
  const result = await runGh(
    exec,
    ['api', 'graphql', '-f', `query=${PROBE_QUERY}`, '-f', `o=${owner}`, '-f', `n=${repo}`],
    { login },
  )
  if (!result.isOk) return false
  try {
    const data = JSON.parse(result.stdout) as { data?: { repository?: unknown } | null }
    return data?.data?.repository != null
  } catch {
    return false
  }
}

/** Picks the account: config, pinned, remembered, active, then probing the others. */
export async function resolveAccount(
  deps: { exec: Exec; memory: AccountMemory },
  location: RepoLocation,
  config: Record<string, string>,
): Promise<AccountChoice | AccountFailure> {
  const { exec, memory } = deps
  const { owner, repo } = location
  if (owner === null || repo === null) return { kind: 'no-access', tried: [] }

  const configured = config[owner.toLowerCase()]
  if (configured !== undefined) return { login: configured, source: 'config' }
  if (location.pinnedLogin !== null) return { login: location.pinnedLogin, source: 'pinned' }

  const tried: string[] = []
  const probe = async (login: string): Promise<boolean> => {
    tried.push(login)
    return canRead(exec, login, owner, repo)
  }

  const remembered = await memory.get(owner)
  if (remembered !== null) {
    if (await probe(remembered)) return { login: remembered, source: 'remembered' }
    await memory.forget(owner)
  }

  const logins = await listLogins(exec)
  if ('kind' in logins) return { kind: 'gh-missing', tried }
  if (logins.active === null && logins.others.length === 0) return { kind: 'not-logged-in', tried }

  if (logins.active !== null && !tried.includes(logins.active) && (await probe(logins.active))) {
    return { login: logins.active, source: 'active' }
  }
  for (const login of logins.others) {
    if (tried.includes(login)) continue
    if (await probe(login)) {
      await memory.set(owner, login)
      return { login, source: 'probed' }
    }
  }
  return { kind: 'no-access', tried }
}
