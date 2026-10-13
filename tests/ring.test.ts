// The Issues and Actions tabs wired into the one pane: tab switching, levels, cross links,
// entry points, polling and the main-branch status of the band. Stubs only: every gh call
// is answered here, nothing reaches GitHub.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { jobsFailed } from './fixtures/jobs'
import { prFailing, prGreen, prNone } from './fixtures/pr-raw'
import { MAIN_STATUS_POLL_MS } from '../src/runs'
import { FOCUS_BG } from '../src/ui/row'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const PANE = 'gh-status'
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const PANE_PROPS = { title: 'PR', isFocused: true, bodyColumns: 100, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

const done = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
const RATE = { cost: 1, remaining: 4000, resetAt: '2026-10-12T16:00:00Z' }

type Fixture = { list: unknown; detail: unknown }

type World = {
  argvs: string[][]
  registered: string[]
  existing: { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }[]
  opened: { id: string; title?: string; rows?: number; focus?: boolean }[]
  closed: string[]
  toasts: string[]
  filled: string[]
  panes: { id: string }[]
  fixture: Fixture
  others: Record<number, Fixture>
  clock: ReturnType<typeof mock.clock>
  /** Open issue numbers of the repository, newest first. */
  issues: number[]
  /** Runs the REST list answers, as raw `workflow_runs` entries. */
  runs: Record<string, unknown>[]
  /** The etag the main-branch read answers with; a request carrying it gets a 304. */
  mainEtag: string
  remote: string
  rerunAnswer: ReturnType<typeof done>
  /** What the issue list query answers instead of the issues while set. */
  issuesFailure: ReturnType<typeof done> | null
}

function raw(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: 'CI',
    workflow_id: 1,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: `sha${id}`,
    run_number: id,
    run_attempt: 1,
    actor: { login: 'anna' },
    created_at: '2026-10-12T10:00:00Z',
    run_started_at: '2026-10-12T10:00:05Z',
    updated_at: '2026-10-12T10:05:00Z',
    html_url: `https://github.com/cli/cli/actions/runs/${id}`,
    ...extra,
  }
}

const issueNode = (number: number) => ({
  id: `I_${number}`,
  number,
  title: `Issue ${number}`,
  url: `https://github.com/cli/cli/issues/${number}`,
  createdAt: '2026-10-01T10:00:00Z',
  author: { login: 'anna' },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  comments: { totalCount: 0 },
  closedByPullRequestsReferences: { nodes: [] },
})

const issueDetail = (number: number, linkedPr: number | null) => ({
  data: {
    repository: {
      issue: {
        ...issueNode(number),
        state: 'OPEN',
        stateReason: null,
        milestone: null,
        body: `Body of issue ${number}`,
        comments: { totalCount: 0, nodes: [] },
        closedByPullRequestsReferences: { nodes: linkedPr === null ? [] : [{ number: linkedPr, title: 'Fix it', state: 'OPEN' }] },
      },
    },
    rateLimit: RATE,
  },
})

const sawFlag = (argv: readonly string[], flag: string, value: string) => argv.some((arg, index) => arg === flag && argv[index + 1] === value)

function byNumberAnswer(fixture: Fixture | null): unknown {
  if (fixture === null) return { data: { repository: { isPrivate: false, pullRequest: null }, rateLimit: RATE } }
  const list = (fixture.list as { data: { repository: { pullRequests: { nodes: unknown[] } } & Record<string, unknown>; rateLimit: unknown } }).data
  const { pullRequests, ...scalars } = list.repository
  return { data: { repository: { ...scalars, isPrivate: false, pullRequest: pullRequests.nodes[0] }, rateLimit: list.rateLimit } }
}

function answer(world: World, argv: readonly string[]) {
  const [command, ...args] = argv
  if (command === 'git') {
    if (args.includes('rev-parse')) return done(0, 'true\n')
    if (args.includes('--show-current')) return done(0, 'feat/things\n')
    if (args.includes('get-url')) return done(0, world.remote + '\n')
    return done(1)
  }
  if (command === 'open' || command === 'xdg-open') return done(0)
  if (command !== 'gh') return done(127, '', 'not found')
  if (args[0] === 'auth' && args[1] === 'status') return done(0, JSON.stringify({ hosts: { 'github.com': [{ state: 'success', active: true, login: 'me' }] } }))
  if (args[0] === 'auth' && args[1] === 'token') return done(0, 'tok\n')
  if (args[0] === 'run' && args[1] === 'rerun') return world.rerunAnswer
  if (args[0] === 'run' && args[1] === 'view') return done(0, JSON.stringify(jobsFailed))
  if (args[0] === 'api') {
    const path = args.find(arg => arg.startsWith('repos/')) ?? ''
    if (path.includes('/actions/runs?') && args.includes('-i')) {
      // the main-branch read: conditional on its etag
      if (sawFlag(args, '-H', `If-None-Match: ${world.mainEtag}`)) return done(1, `HTTP/2.0 304 Not Modified\netag: ${world.mainEtag}\n\n`)
      const main = world.runs.filter(run => run.head_branch === 'main')
      return done(0, `HTTP/2.0 200 OK\netag: ${world.mainEtag}\n\n${JSON.stringify({ workflow_runs: main })}`)
    }
    if (args.includes('-i')) return done(0, 'HTTP/2.0 200 OK\netag: W/"stable"\n\n{}')
    if (args.includes('--jq')) return done(0, 'main\n')
    const one = /\/actions\/runs\/(\d+)$/.exec(path)
    if (one !== null) {
      const found = world.runs.find(run => run.id === Number(one[1]))
      return found === undefined ? done(1, '', 'HTTP 404: Not Found') : done(0, JSON.stringify(found))
    }
    if (path.includes('/actions/runs?')) {
      const branch = /branch=([^&]+)/.exec(path)?.[1]
      const runs = branch === undefined ? world.runs : world.runs.filter(run => run.head_branch === decodeURIComponent(branch))
      return done(0, JSON.stringify({ workflow_runs: runs }))
    }
    const query = args.find(arg => arg.startsWith('query=')) ?? ''
    if (query.includes('$yours')) return done(0, JSON.stringify({ data: { open: { issueCount: 7 }, yours: { issueCount: 1 }, requested: { issueCount: 0 }, issues: { issueCount: world.issues.length }, rateLimit: RATE } }))
    if (query.includes('closedByPullRequestsReferences(first: 3)')) {
      if (world.issuesFailure !== null) return world.issuesFailure
      const nodes = world.issues.map(issueNode)
      return done(0, JSON.stringify({ data: { search: { issueCount: nodes.length, nodes }, rateLimit: RATE } }))
    }
    if (query.includes('$n: Int!')) {
      const number = Number(args.find(arg => arg.startsWith('n='))?.slice(2))
      if (!world.issues.includes(number)) return done(0, JSON.stringify({ data: { repository: { issue: null }, rateLimit: RATE } }))
      return done(0, JSON.stringify(issueDetail(number, number === 12 ? 14580 : null)))
    }
    if (query.includes('$q: String!')) {
      // the mentions query and the pull request list
      const nodes = query.includes('statusCheckRollup') ? [] : []
      return done(0, JSON.stringify({ data: { search: { issueCount: nodes.length, nodes }, rateLimit: RATE } }))
    }
    if (query.includes('$branch')) return done(0, JSON.stringify(world.fixture.list))
    if (query.includes('$number: Int!')) {
      const number = Number(args.find(arg => arg.startsWith('number='))?.slice('number='.length))
      return done(0, JSON.stringify(byNumberAnswer(world.others[number] ?? null)))
    }
    if (query.includes('$id: ID!')) {
      const id = args.find(arg => arg.startsWith('id='))?.slice('id='.length)
      const owner = [world.fixture, ...Object.values(world.others)].find(fixture => (fixture.detail as { data?: { node?: { id?: string } } } | null)?.data?.node?.id === id)
      return done(0, JSON.stringify((owner ?? world.fixture).detail))
    }
    return done(0, '{"data":{"repository":{"id":"R_1"}}}')
  }
  return done(1, '', 'unexpected')
}

function setup(on: On, fixture: Fixture = prNone): World {
  const world: World = {
    argvs: [],
    registered: [],
    existing: [],
    opened: [],
    closed: [],
    toasts: [],
    filled: [],
    panes: [],
    fixture,
    others: { 14580: prGreen },
    clock: mock.clock(on, { now: NOW }),
    issues: [12, 11],
    runs: [raw(500, { name: 'CI', workflow_id: 1, head_branch: 'main' }), raw(501, { name: 'Lint', workflow_id: 2, head_branch: 'main', conclusion: 'failure' }), raw(502, { name: 'CI', workflow_id: 1, head_branch: 'feat/things', conclusion: 'failure' })],
    mainEtag: 'W/"main1"',
    remote: 'git@github.com:cli/cli.git',
    rerunAnswer: done(0),
    issuesFailure: null,
  }
  mock.store(on)
  on('process.run', (_$, e) => {
    world.argvs.push([...e.argv])
    return { value: answer(world, e.argv) }
  })
  on('session.cwd', () => ({ value: '/work/cli' }))
  on('command.list', () => ({ value: world.existing }))
  on('command.register', (_$, e) => {
    world.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    world.opened.push(e)
    world.panes = [{ id: e.id }]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    world.closed.push(e.id)
    world.panes = []
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes.map(pane => ({ id: pane.id, title: pane.id, isShown: true, isFocused: true, isPlaced: true })) }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    world.filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.focus', () => ({}))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.CwdChanged', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['engine band'] }))
  return world
}

async function start($: Engine, world: World) {
  await $.session.start({ cwd: '/work/cli', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
}

const runCommand = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
const gh = async ($: Engine, world: World, args = '') => {
  const ran = await runCommand($, 'gh', args)
  await world.clock.settle()
  return ran
}
const showPane = ($: Engine) => $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
type Pane = Awaited<ReturnType<typeof showPane>>
const showBand = ($: Engine) => $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })

const sees = async (ui: Pane, text: string | RegExp) => (await ui.find({ text })) !== undefined
const has = async (ui: Pane, key: string) => (await ui.find({ key })) !== undefined
const press = async (ui: Pane, world: World, key: string) => {
  await ui.press({ key })
  await world.clock.settle()
}

const queries = (world: World, needle: string) => world.argvs.filter(argv => argv[1] === 'api' && argv.some(arg => arg.startsWith('query=') && arg.includes(needle)))
const issueListReads = (world: World) => queries(world, 'closedByPullRequestsReferences(first: 3)').length
const issueDetailReads = (world: World) => queries(world, '$n: Int!').length
const runListReads = (world: World) => world.argvs.filter(argv => argv[1] === 'api' && argv.some(arg => arg.includes('/actions/runs?') && arg.includes('per_page=30'))).length
const runDetailReads = (world: World) => world.argvs.filter(argv => argv[1] === 'api' && argv.some(arg => /\/actions\/runs\/\d+$/.test(arg))).length
const mainReads = (world: World) => world.argvs.filter(argv => argv[1] === 'api' && argv.includes('-i') && argv.some(arg => arg.includes('/actions/runs?')))
const prLookups = (world: World) => queries(world, '$number: Int!')
const reruns = (world: World) => world.argvs.filter(argv => argv[0] === 'gh' && argv[1] === 'run' && argv[2] === 'rerun')
const lastRows = (world: World) => world.opened.at(-1)?.rows

const ring = async ($: Engine, world: World, element: string) => {
  await $.ui.focus({ requestId: PANE, element } as never)
  await world.clock.settle()
}

type Found = Awaited<ReturnType<Pane['find']>>
const textColors = (button: Found): unknown[] => ((button?.children ?? []) as { props?: { color?: unknown } }[]).map(child => child.props?.color)

describe('the pane ring', () => {
  test('the hook follows the ring: the row marker leaves the list for a footer button or a tab, and the tab is drawn calm', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    await ring($, world, 'issue-12')
    expect(await sees(ui, /▸ .*Issue 12/)).toBe(true)
    expect(textColors(await ui.find({ key: 'tab-issues' }))).toEqual([undefined, undefined, undefined])
    await ring($, world, 'issues-close')
    expect(await sees(ui, /▸ /)).toBe(false)
    await ring($, world, 'tab-issues')
    expect(await sees(ui, /▸ /)).toBe(false)
    expect(new Set(textColors(await ui.find({ key: 'tab-issues' })))).toEqual(new Set([FOCUS_BG]))
    expect(textColors(await ui.find({ key: 'tab-actions' }))).not.toContain(FOCUS_BG)
    await ring($, world, 'issue-11')
    expect(await sees(ui, /▸ .*Issue 11/)).toBe(true)
    await ui.unmount()
  })

  test('the Actions list follows the ring the same way', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'actions')
    const ui = await showPane($)
    await ring($, world, 'run-501')
    expect(await sees(ui, /▸ .*Lint/)).toBe(true)
    await ring($, world, 'actions-refresh')
    expect(await sees(ui, /▸ /)).toBe(false)
    await ui.unmount()
  })

  test('the issue detail draws its title calm while the ring is on it, and not otherwise', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    await press(ui, world, 'issue-12')
    await ring($, world, 'issue-12')
    expect(textColors(await ui.find({ key: 'issue-12' }))).toEqual([FOCUS_BG])
    await ring($, world, 'tab-issues')
    expect(textColors(await ui.find({ key: 'issue-12' }))).toEqual([undefined])
    await ui.unmount()
  })

  test('re-entering a detail puts the ring on its header title, never on the tab button', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    await press(ui, world, 'issue-12')
    await press(ui, world, 'tab-prs')
    await press(ui, world, 'tab-issues')
    expect(textColors(await ui.find({ key: 'issue-12' }))).toEqual([FOCUS_BG])
    expect(textColors(await ui.find({ key: 'tab-issues' }))).toEqual([undefined, undefined, undefined])
    await press(ui, world, 'tab-actions')
    await press(ui, world, 'run-501')
    await press(ui, world, 'tab-prs')
    await press(ui, world, 'tab-actions')
    expect(textColors(await ui.find({ key: 'run-501' }))).toEqual([FOCUS_BG])
    expect(textColors(await ui.find({ key: 'tab-actions' }))).not.toContain(FOCUS_BG)
    await ui.unmount()
  })

  test('a picked pull request gets the ring on its title when its tab is entered again', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    await press(ui, world, 'issue-12')
    await press(ui, world, 'linked-pr-14580')
    expect(textColors(await ui.find({ key: 'pr-14580' }))).toEqual([undefined])
    await press(ui, world, 'tab-issues')
    await press(ui, world, 'tab-prs')
    expect(textColors(await ui.find({ key: 'pr-14580' }))).toEqual([FOCUS_BG])
    expect(new Set(textColors(await ui.find({ key: 'tab-prs' })))).toEqual(new Set([undefined]))
    await ui.unmount()
  })

  test('the branch pull request gets the ring on its anchor when its tab is entered again', async ($, on) => {
    const world = setup(on, prFailing)
    await start($, world)
    await gh($, world)
    const ui = await showPane($)
    await press(ui, world, 'tab-issues')
    await press(ui, world, 'tab-prs')
    expect(textColors(await ui.find({ key: 'pr-anchor' }))).toEqual([FOCUS_BG])
    await ui.unmount()
  })
})
