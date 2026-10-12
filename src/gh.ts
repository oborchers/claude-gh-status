// The one place gh-status starts `gh`. Every call names the account it runs
// as; the account's token reaches only that child, as GH_TOKEN in its env.
// `gh auth switch` is never run, so the person's global gh login is untouched.

import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

/**
 * Runs a host command. register.tsx builds it from $.process.run, since $ is
 * never passed across an import; tests pass a fake.
 */
export type Exec = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

export type GhErrorKind =
  | 'gh-missing'
  | 'not-found'
  | 'auth'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'failed'

export type GhResult =
  | { isOk: true; stdout: string; stderr: string }
  | { isOk: false; kind: GhErrorKind; exitCode: number | null; message: string; stdout: string }

export type GhOptions = {
  /** Login to run as; null runs as gh's active account. */
  login: string | null
  /** Working directory; the session's when absent. */
  cwd?: string
  /** Text written to stdin. */
  stdin?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000
const TOKEN_TIMEOUT_MS = 5_000

/** Tokens per login for this module instance; never written to $.state or $.store. */
const tokens = new Map<string, string>()

const SERVER_ERROR = /\bhttp (500|502|503|504)\b|bad gateway|service unavailable|gateway time-?out|server error|invalid character '<'|something went wrong while executing your query|couldn't respond to your request in time/

/** Exit codes of a process that was killed or timed out (timeout(1), SIGKILL, SIGTERM). */
const TIMEOUT_EXIT_CODES: readonly number[] = [124, 137, 143]

const NETWORK_ERROR = /could not resolve host|connection refused|connection reset|\beof\b|tls handshake|broken pipe|unexpected end|network|timeout|timed out/

/**
 * Classifies a failed gh run by its stderr, and by its stdout when that is an
 * HTML error page. Pure, exported for tests. A 5xx or an HTML body is 'server':
 * GitHub, not the request, is at fault, so it is worth retrying.
 */
export function classifyGhError(stderr: string, stdout = '', exitCode: number | null = null): GhErrorKind {
  const text = stderr.toLowerCase()
  // A killed or timed-out process says nothing about GitHub's answer: the write may have landed.
  if (exitCode !== null && TIMEOUT_EXIT_CODES.includes(exitCode)) return 'timeout'
  // Server and connection faults first: their text can also contain "not found" or "authentication".
  // An HTML body is GitHub's error page, unless stderr names a 4xx status for it.
  const isErrorPage = stdout.trimStart().startsWith('<') && !/\bhttp 4\d\d\b/.test(text)
  if (SERVER_ERROR.test(text) || isErrorPage) return 'server'
  if (NETWORK_ERROR.test(text)) return 'network'
  if (text.includes('could not resolve to a repository') || text.includes('http 404') || text.includes('not found')) {
    return 'not-found'
  }
  if (text.includes('rate limit') || text.includes('http 429') || text.includes('secondary rate')) {
    return 'rate-limited'
  }
  if (text.includes('http 401') || text.includes('bad credentials') || text.includes('authentication') || text.includes('gh auth login')) {
    return 'auth'
  }
  return 'failed'
}

/** Resolves the token for a login, cached per module instance; null if gh has none. */
export async function tokenFor(exec: Exec, login: string): Promise<string | null> {
  const cached = tokens.get(login)
  if (cached !== undefined) return cached
  try {
    const ran = await exec(['gh', 'auth', 'token', '-u', login], { timeoutMs: TOKEN_TIMEOUT_MS })
    const token = ran.stdout.trim()
    if (ran.exitCode !== 0 || token === '') return null
    tokens.set(login, token)
    return token
  } catch {
    return null
  }
}

/** Forgets cached tokens, e.g. after an auth failure. */
export function forgetTokens(): void {
  tokens.clear()
}

/** Runs `gh <args>` as the given account. Never rejects. */
export async function runGh(exec: Exec, args: readonly string[], options: GhOptions): Promise<GhResult> {
  const env: Record<string, string> = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
  if (options.login !== null) {
    const token = await tokenFor(exec, options.login)
    if (token === null) {
      return { isOk: false, kind: 'auth', exitCode: null, message: `gh has no token for ${options.login}`, stdout: '' }
    }
    env.GH_TOKEN = token
  }
  try {
    const ran = await exec(['gh', ...args], {
      cwd: options.cwd,
      env,
      stdin: options.stdin,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    if (ran.exitCode === 0) return { isOk: true, stdout: ran.stdout, stderr: ran.stderr }
    const kind = classifyGhError(ran.stderr, ran.stdout, ran.exitCode)
    if (kind === 'auth') forgetTokens()
    return { isOk: false, kind, exitCode: ran.exitCode, message: firstLine(ran.stderr), stdout: ran.stdout }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const kind: GhErrorKind = /enoent|not found|cannot start|spawn/i.test(message) ? 'gh-missing' : /timeout|timed out|still running/i.test(message) ? 'timeout' : 'failed'
    return { isOk: false, kind, exitCode: null, message, stdout: '' }
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').find(part => part.trim() !== '')
  return (line ?? 'gh failed').trim().slice(0, 300)
}
