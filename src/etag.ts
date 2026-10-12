// The fast change detector. A conditional GET (If-None-Match) that GitHub
// answers with 304 Not Modified does not count against the primary rate limit
// (measured: x-ratelimit-used stays put across 304s and rises by 1 per 200),
// so this can run every few seconds. Only a 200 means something changed.
//
// `gh api -i` with a matching If-None-Match exits 1, prints `gh: HTTP 304` on
// stderr, and keeps the status line and headers on stdout. runGh keeps stdout
// on failure, so a 304 is recognised from stdout, not from the exit code.

import { runGh } from './gh'
import type { Exec } from './gh'
import type { RepoLocation } from './model'

/** The pull request and head commit the fast check watches. */
export type FastTarget = {
  prNumber: number
  headOid: string
}

export type FastCheckResult = {
  /** A watched resource changed, or was seen for the first time. */
  isChanged: boolean
  /** ETags per request path, to store for the next call. */
  etags: Record<string, string>
  /** At least one request failed for a reason other than 304. */
  isFailed: boolean
}

export type IncludeOutput = {
  /** HTTP status; 0 when stdout has no status line. */
  status: number
  etag: string | null
  body: string
}

/** Parses `gh api -i` output: status line, headers, blank line, body. Pure. */
export function parseIncludeOutput(stdout: string): IncludeOutput {
  const text = stdout.replace(/\r\n/g, '\n')
  const match = /^HTTP\/[\d.]+\s+(\d{3})/.exec(text)
  if (match === null) return { status: 0, etag: null, body: text }
  const split = text.indexOf('\n\n')
  const head = split === -1 ? text : text.slice(0, split)
  const body = split === -1 ? '' : text.slice(split + 2)
  let etag: string | null = null
  for (const line of head.split('\n').slice(1)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).trim().toLowerCase() === 'etag') etag = line.slice(colon + 1).trim()
  }
  return { status: Number(match[1]), etag, body }
}

/** The request paths a pull request's live state shows up in. */
export function fastPaths(location: RepoLocation, target: FastTarget): string[] {
  const base = `repos/${location.owner ?? ''}/${location.repo ?? ''}`
  return [
    `${base}/commits/${target.headOid}/check-runs?per_page=100`,
    `${base}/commits/${target.headOid}/status`,
    // Its updated_at moves on every review and comment, and its body carries mergeable_state.
    `${base}/pulls/${target.prNumber}`,
    `${base}/issues/${target.prNumber}/comments?per_page=100`,
  ]
}

/** GitHub sends weak ETags (W/"x") on 200 and strong ones on 304; compare the tag alone. */
function tagOf(etag: string): string {
  return etag.replace(/^W\//, '')
}

type Probe = { path: string; etag: string | null; isChanged: boolean; isFailed: boolean }

async function probe(exec: Exec, path: string, login: string, cwd: string, stored: string | undefined): Promise<Probe> {
  const args = stored === undefined ? ['api', '-i', path] : ['api', '-i', '-H', `If-None-Match: ${stored}`, path]
  const ran = await runGh(exec, args, { login, cwd })
  const parsed = parseIncludeOutput(ran.stdout)
  if (parsed.status === 304) return { path, etag: stored ?? null, isChanged: false, isFailed: false }
  if (!ran.isOk || parsed.status !== 200) return { path, etag: stored ?? null, isChanged: false, isFailed: true }
  const isChanged = parsed.etag === null || stored === undefined || tagOf(parsed.etag) !== tagOf(stored)
  return { path, etag: parsed.etag ?? stored ?? null, isChanged, isFailed: false }
}

/**
 * Asks GitHub, with conditional requests, whether anything about the pull
 * request changed since `etags` were taken. A first call has no ETags and
 * counts as changed. Never rejects.
 */
export async function fastCheck(exec: Exec, location: RepoLocation, login: string, target: FastTarget, etags: Record<string, string>): Promise<FastCheckResult> {
  const probes = await Promise.all(fastPaths(location, target).map(path => probe(exec, path, login, location.cwd, etags[path])))
  const next: Record<string, string> = {}
  for (const result of probes) {
    if (result.etag !== null) next[result.path] = result.etag
  }
  return {
    isChanged: probes.some(result => result.isChanged),
    etags: next,
    isFailed: probes.some(result => result.isFailed),
  }
}
