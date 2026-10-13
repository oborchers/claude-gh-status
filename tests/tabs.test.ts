// The Issues and Actions tabs wired into the one pane: tab switching, levels, cross links,
// entry points, polling and the main-branch status of the band. Stubs only: every gh call
// is answered here, nothing reaches GitHub.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { jobsFailed } from './fixtures/jobs'
import { prFailing, prGreen, prNone } from './fixtures/pr-raw'
import { MAIN_STATUS_POLL_MS } from '../src/runs'

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

describe('registering /gh', () => {
  test('/gh is registered next to pr and gh-pr, and answers for all three', async ($, on) => {
    const world = setup(on)
    await start($, world)
    expect(world.registered).toEqual(['pr', 'gh-pr', 'gh'])
    for (const name of ['pr', 'gh-pr', 'gh']) {
      expect((await runCommand($, name, 'bogus')).text).toContain(`Usage: /${name} [`)
    }
  })

  test('a taken gh is skipped without a toast; the others stay', async ($, on) => {
    const world = setup(on)
    world.existing = [{ name: 'gh', description: 'x', source: 'user' }]
    await start($, world)
    expect(world.registered).toEqual(['pr', 'gh-pr'])
    expect(world.toasts).toEqual([])
  })

  test('a gh of this plugin itself is not a collision', async ($, on) => {
    const world = setup(on)
    world.existing = [{ name: 'gh', description: 'x', source: 'plugin', plugin: 'gh-status' }]
    await start($, world)
    expect(world.registered).toContain('gh')
  })

  test('the usage and the hint name the new arguments', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const usage = (await runCommand($, 'gh', 'bogus')).text
    for (const word of ['issues (i)', 'actions (ac)', 'issue <n>', 'run <id>', 'prs']) expect(usage).toContain(word)
  })
})

describe('the tab row', () => {
  test('every view starts with the tab row: three buttons on the hotkeys 1, 2 and 3', async ($, on) => {
    const world = setup(on)
    await start($, world)
    for (const args of ['list', 'issues', 'actions']) {
      await gh($, world, args)
      const ui = await showPane($)
      const buttons = await Promise.all(['tab-prs', 'tab-issues', 'tab-actions'].map(key => ui.find({ key })))
      expect(buttons.map(button => (button?.props as { hotkey?: string }).hotkey)).toEqual(['1', '2', '3'])
      await ui.unmount()
    }
  })

  test('the labels carry the counts and the worst main-branch state', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    expect(await sees(ui, /PRs 7/)).toBe(true)
    expect(await sees(ui, /Issues 2/)).toBe(true)
    expect(await sees(ui, /Actions/)).toBe(true)
    await ui.unmount()
  })

  test('switching keeps each tab\'s own level and page; the pane is re-opened with the tab row and the view\'s rows', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    await press(ui, world, 'issue-12')
    expect(await sees(ui, /Body of issue 12/)).toBe(true)
    const detailRows = lastRows(world)
    await press(ui, world, 'tab-actions')
    expect(await has(ui, 'run-500')).toBe(true)
    expect(world.opened.at(-1)?.id).toBe(PANE)
    expect(lastRows(world)).toBeGreaterThanOrEqual(7)
    await press(ui, world, 'tab-prs')
    expect(await has(ui, 'tab-prs')).toBe(true)
    expect(await has(ui, 'run-500')).toBe(false)
    // back on Issues: still the detail of issue 12
    await press(ui, world, 'tab-issues')
    expect(await sees(ui, /Body of issue 12/)).toBe(true)
    expect(lastRows(world)).toBe(detailRows)
    // the Actions tab is as it was left: its list
    await press(ui, world, 'tab-actions')
    expect(await has(ui, 'run-500')).toBe(true)
    await ui.unmount()
  })

  test('pressing the active tab does nothing', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    const opens = world.opened.length
    await press(ui, world, 'tab-issues')
    expect(world.opened.length).toBe(opens)
    await ui.unmount()
  })
})

describe('levels and cross links', () => {
  test('b and l go up from the detail to the list of the same tab, the row remembered', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    for (const key of ['back', 'pane-list']) {
      await press(ui, world, 'issue-12')
      expect(await has(ui, key)).toBe(true)
      await press(ui, world, key)
      expect(await has(ui, 'issue-12')).toBe(true)
      expect(await has(ui, 'tab-issues')).toBe(true)
      // the list shows the row the detail was opened from as focused
      expect(await sees(ui, /▸ .*Issue 12/)).toBe(true)
      expect(await sees(ui, /▸ .*Issue 11/)).toBe(false)
    }
    await ui.unmount()
  })

  test('b in a run detail goes to the Actions list', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'actions')
    const ui = await showPane($)
    await press(ui, world, 'run-501')
    expect(await has(ui, 'run-rerun')).toBe(true)
    await press(ui, world, 'back')
    expect(await has(ui, 'run-501')).toBe(true)
    expect(await has(ui, 'run-rerun')).toBe(false)
    await ui.unmount()
  })

  test('the row a detail was opened from is remembered and focused again', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    // the row that was opened is the row the ring returns to
    await press(ui, world, 'issue-11')
    await press(ui, world, 'back')
    expect(await sees(ui, /▸ .*Issue 11/)).toBe(true)
    await ui.unmount()
  })

  test('a linked issue of a pull request opens in the Issues tab; b goes to the issues list', async ($, on) => {
    const detail = structuredClone(prFailing) as { list: unknown; detail: { data: { node: Record<string, unknown> } } }
    detail.detail.data.node.closingIssuesReferences = { nodes: [{ number: 12, title: 'Crash on start', state: 'OPEN' }] }
    const world = setup(on, detail)
    await start($, world)
    await gh($, world)
    const ui = await showPane($)
    expect(await has(ui, 'linked-issue-12')).toBe(true)
    await press(ui, world, 'linked-issue-12')
    expect(await sees(ui, /Body of issue 12/)).toBe(true)
    expect(await has(ui, 'tab-issues')).toBe(true)
    await press(ui, world, 'back')
    expect(await has(ui, 'issue-11')).toBe(true)
    await ui.unmount()
  })

  test('a run button of the pipeline opens the run in the Actions tab; b goes to the runs list', async ($, on) => {
    const world = setup(on, prFailing)
    await start($, world)
    await gh($, world)
    const ui = await showPane($)
    const runButton = (await ui.findAll({ type: 'Button' })).find(button => /^run-\d+$/.test(String(button.key)))
    expect(runButton).toBeDefined()
    // the run the button names exists on GitHub's side
    world.runs.push(raw(Number(String(runButton?.key).slice('run-'.length)), { name: 'Unit and Integration Tests', head_branch: 'feat/things' }))
    await press(ui, world, String(runButton?.key))
    expect(await has(ui, 'run-refresh')).toBe(true)
    expect(runDetailReads(world)).toBeGreaterThan(0)
    await press(ui, world, 'back')
    expect(await has(ui, 'run-500')).toBe(true)
    await ui.unmount()
  })

  test('a linked pull request of an issue opens its detail in the PRs tab; b goes to the PR list', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issue 12')
    const ui = await showPane($)
    expect(await has(ui, 'linked-pr-14580')).toBe(true)
    await press(ui, world, 'linked-pr-14580')
    expect(prLookups(world).length).toBeGreaterThan(0)
    expect(await sees(ui, /#14580 /)).toBe(true)
    expect(await has(ui, 'back')).toBe(true)
    await press(ui, world, 'back')
    expect(await has(ui, 'list-refresh')).toBe(true)
    await ui.unmount()
  })
})

describe('while a confirmation waits', () => {
  test('the tab row has no buttons and the hotkeys do nothing', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await gh($, world, 'merge')
    const ui = await showPane($)
    expect(await has(ui, 'confirm')).toBe(true)
    for (const key of ['tab-prs', 'tab-issues', 'tab-actions']) expect(await has(ui, key)).toBe(false)
    expect(await sees(ui, /2: Issues/)).toBe(true)
    await ui.unmount()
  })

  test('showTab and the cross links are no-ops, so the confirmation never ends up in another tab', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await gh($, world, 'merge')
    const opens = world.opened.length
    // the entry points refuse
    expect((await gh($, world, 'issues')).text).toContain('confirmation is waiting')
    expect((await gh($, world, 'actions')).text).toContain('confirmation is waiting')
    expect((await gh($, world, 'issue 12')).text).toContain('confirmation is waiting')
    expect((await gh($, world, 'run 500')).text).toContain('confirmation is waiting')
    expect(world.opened.length).toBe(opens)
    const ui = await showPane($)
    expect(await has(ui, 'confirm')).toBe(true)
    await ui.unmount()
  })
})

describe('the entry points', () => {
  test('bare /gh with a pull request on the branch opens its detail on the PRs tab', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await gh($, world)
    const ui = await showPane($)
    expect(await has(ui, 'tab-prs')).toBe(true)
    expect(await has(ui, 'list-refresh')).toBe(false)
    expect(await sees(ui, /14580/)).toBe(true)
    await ui.unmount()
  })

  test('bare /gh without a pull request opens the list', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world)
    const ui = await showPane($)
    expect(await has(ui, 'list-refresh')).toBe(true)
    await ui.unmount()
  })

  test('prs, list and ls open the PR list', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    for (const argument of ['prs', 'list', 'ls']) {
      await gh($, world, argument)
      const ui = await showPane($)
      expect(await has(ui, 'list-refresh')).toBe(true)
      await ui.unmount()
    }
  })

  test('issues and i open the Issues tab, with the keyboard, at the list the first time, then where it was left', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    expect(world.opened.at(-1)).toMatchObject({ id: PANE, focus: true })
    let ui = await showPane($)
    expect(await has(ui, 'issue-12')).toBe(true)
    await press(ui, world, 'issue-11')
    await ui.unmount()
    await gh($, world, 'i')
    ui = await showPane($)
    expect(await sees(ui, /Body of issue 11/)).toBe(true)
    await ui.unmount()
  })

  test('actions and ac open the Actions tab', async ($, on) => {
    const world = setup(on)
    await start($, world)
    for (const argument of ['actions', 'ac']) {
      await gh($, world, argument)
      const ui = await showPane($)
      expect(await has(ui, 'run-500')).toBe(true)
      await ui.unmount()
    }
  })

  test('issue <n> opens the detail, even from #n', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issue 11')
    let ui = await showPane($)
    expect(await sees(ui, /Body of issue 11/)).toBe(true)
    await ui.unmount()
    await gh($, world, 'issue #12')
    ui = await showPane($)
    expect(await sees(ui, /Body of issue 12/)).toBe(true)
    await ui.unmount()
  })

  test('run <id> opens the run detail', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'run 501')
    const ui = await showPane($)
    expect(await has(ui, 'run-rerun')).toBe(true)
    expect(runDetailReads(world)).toBeGreaterThan(0)
    await ui.unmount()
  })

  test('a bare number that is a pull request opens its detail, one that is not opens the issue', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, '14580')
    let ui = await showPane($)
    expect(await sees(ui, /#14580 /)).toBe(true)
    expect(await has(ui, 'tab-prs')).toBe(true)
    await ui.unmount()
    expect(issueDetailReads(world)).toBe(0)
    await gh($, world, '11')
    ui = await showPane($)
    expect(await sees(ui, /Body of issue 11/)).toBe(true)
    expect(prLookups(world).map(argv => argv.find(arg => arg.startsWith('number=')))).toContain('number=11')
    await ui.unmount()
  })

  test('a number that is neither is told in the Issues tab', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, '99999')
    const ui = await showPane($)
    expect(await sees(ui, /Could not read issue #99999/)).toBe(true)
    await ui.unmount()
  })

  test('back goes up one level in the tab it is run in', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issue 12')
    expect((await gh($, world, 'back')).text).toBe('Back to the list.')
    const ui = await showPane($)
    expect(await has(ui, 'issue-12')).toBe(true)
    await ui.unmount()
    expect((await gh($, world, 'back')).text).toContain('Already at the list')
  })
})

describe('polling', () => {
  test('only the visible tab and level polls, and the old poll stops when the view changes', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    expect(issueListReads(world)).toBe(1)
    await world.clock.advance(61_000)
    expect(issueListReads(world)).toBe(2)
    // a detail: the list stops, the issue is read now and every minute
    const ui = await showPane($)
    await press(ui, world, 'issue-12')
    expect(issueDetailReads(world)).toBe(1)
    const lists = issueListReads(world)
    await world.clock.advance(61_000)
    expect(issueListReads(world)).toBe(lists)
    expect(issueDetailReads(world)).toBe(2)
    // the Actions list: the issue detail stops
    await press(ui, world, 'tab-actions')
    expect(runListReads(world)).toBe(1)
    const details = issueDetailReads(world)
    await world.clock.advance(61_000)
    expect(issueDetailReads(world)).toBe(details)
    expect(runListReads(world)).toBe(2)
    // the PRs tab: nothing of the other tabs polls
    await press(ui, world, 'tab-prs')
    const runs = runListReads(world)
    await world.clock.advance(180_000)
    expect(runListReads(world)).toBe(runs)
    expect(issueListReads(world)).toBe(lists)
    await ui.unmount()
  })

  test('a run detail is read every 15 s while it runs and every minute once it is done', async ($, on) => {
    const world = setup(on)
    world.runs.push(raw(600, { name: 'Deploy', workflow_id: 3, head_branch: 'feat/things', status: 'in_progress', conclusion: null }))
    await start($, world)
    await gh($, world, 'run 600')
    expect(runDetailReads(world)).toBe(1)
    await world.clock.advance(16_000)
    expect(runDetailReads(world)).toBe(2)
    await world.clock.advance(16_000)
    expect(runDetailReads(world)).toBe(3)
    // finished now
    world.runs = world.runs.map(run => (run.id === 600 ? { ...run, status: 'completed', conclusion: 'success' } : run))
    await world.clock.advance(16_000)
    expect(runDetailReads(world)).toBe(4)
    await world.clock.advance(16_000)
    expect(runDetailReads(world)).toBe(4)
    await world.clock.advance(45_000)
    expect(runDetailReads(world)).toBe(5)
  })

  test('closing the pane stops the polling; the tabs keep their state', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issue 12')
    expect(issueDetailReads(world)).toBe(1)
    await gh($, world, 'close')
    const reads = issueDetailReads(world)
    await world.clock.advance(300_000)
    expect(issueDetailReads(world)).toBe(reads)
    // opened again, the Issues tab is still on the detail
    await gh($, world, 'issues')
    const ui = await showPane($)
    expect(await sees(ui, /Body of issue 12/)).toBe(true)
    await ui.unmount()
  })

  test('a transient failure keeps the list and retries after 15 s', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    world.issuesFailure = done(1, '', 'HTTP 502: Bad Gateway')
    await world.clock.advance(61_000)
    expect(issueListReads(world)).toBe(2)
    // the last list stays on screen
    expect(await has(ui, 'issue-12')).toBe(true)
    await world.clock.advance(16_000)
    expect(issueListReads(world)).toBe(3)
    world.issuesFailure = null
    await world.clock.advance(31_000)
    expect(issueListReads(world)).toBe(4)
    await ui.unmount()
  })

  test('a second session.start does not multiply the tab timer', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    await start($, world)
    await gh($, world, 'issues')
    const before = issueListReads(world)
    await world.clock.advance(61_000)
    expect(issueListReads(world) - before).toBe(1)
  })
})

describe('the main-branch status', () => {
  test('is read once at the start and every five minutes with the stored etag, the default branch known', async ($, on) => {
    const world = setup(on)
    await start($, world)
    expect(mainReads(world)).toHaveLength(1)
    expect(mainReads(world)[0]).not.toContain('If-None-Match: W/"main1"')
    const defaults = world.argvs.filter(argv => argv.includes('--jq')).length
    await world.clock.advance(MAIN_STATUS_POLL_MS + 1_000)
    expect(mainReads(world)).toHaveLength(2)
    expect(sawFlag(mainReads(world)[1] ?? [], '-H', 'If-None-Match: W/"main1"')).toBe(true)
    // the default branch is not looked up again
    expect(world.argvs.filter(argv => argv.includes('--jq')).length).toBe(defaults)
  })

  test('the band shows the failing workflow of the default branch and opens the Actions tab', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const band = await showBand($)
    const button = await band.find({ key: 'band-main' })
    expect(button).toBeDefined()
    expect(button?.props).toMatchObject({ hotkey: '3' })
    expect(await band.find({ text: /main ✗ Lint/ })).toBeDefined()
    await band.press({ key: 'band-main' })
    await world.clock.settle()
    expect(world.opened.at(-1)?.id).toBe(PANE)
    const ui = await showPane($)
    expect(await has(ui, 'run-500')).toBe(true)
    await ui.unmount()
    await band.unmount()
  })

  test('a green default branch shows no segment', async ($, on) => {
    const world = setup(on)
    world.runs = [raw(500)]
    await start($, world)
    const band = await showBand($)
    expect(await band.find({ key: 'band-main' })).toBeUndefined()
    await band.unmount()
  })

  test('the option off hides the segment and reads nothing', { options: { mainStatus: 'off' } }, async ($, on) => {
    const world = setup(on)
    await start($, world)
    const band = await showBand($)
    expect(await band.find({ key: 'band-main' })).toBeUndefined()
    expect(mainReads(world)).toHaveLength(0)
    await world.clock.advance(MAIN_STATUS_POLL_MS + 1_000)
    expect(mainReads(world)).toHaveLength(0)
    await band.unmount()
  })

  test('the Actions label shows the worst state', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issues')
    const ui = await showPane($)
    expect(await sees(ui, /Actions ✗/)).toBe(true)
    await ui.unmount()
  })
})

describe('a change of repository', () => {
  test('resets the tabs, their data and the main status', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'issue 12')
    let ui = await showPane($)
    expect(await sees(ui, /Body of issue 12/)).toBe(true)
    await ui.unmount()
    world.remote = 'git@github.com:other/repo.git'
    await $.classic.CwdChanged({ old_cwd: '/work/cli', new_cwd: '/work/other' })
    await world.clock.settle()
    ui = await showPane($)
    // the Issues tab is back at its list: the detail of the old repository is gone
    expect(await sees(ui, /Body of issue 12/)).toBe(false)
    await ui.unmount()
  })
})

describe('run actions', () => {
  test('retry failed re-runs the failed jobs of the shown run, bound to its id, with a toast and a refresh', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'run 501')
    const ui = await showPane($)
    const reads = runDetailReads(world)
    await press(ui, world, 'run-rerun')
    expect(reruns(world)).toHaveLength(1)
    expect(reruns(world)[0]).toContain('501')
    expect(reruns(world)[0]).toContain('--failed')
    expect(world.toasts.some(text => text.includes('re-running failed jobs'))).toBe(true)
    expect(runDetailReads(world)).toBeGreaterThan(reads)
    await ui.unmount()
  })

  test('a failing re-run is told and not refreshed', async ($, on) => {
    const world = setup(on)
    world.rerunAnswer = done(1, '', 'HTTP 403: forbidden')
    await start($, world)
    await gh($, world, 'run 501')
    const ui = await showPane($)
    const reads = runDetailReads(world)
    await press(ui, world, 'run-rerun')
    expect(world.toasts.some(text => text.includes('could not re-run'))).toBe(true)
    expect(runDetailReads(world)).toBe(reads)
    await ui.unmount()
  })

  test('fix ci puts the run reference into the prompt', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await gh($, world, 'run 501')
    const ui = await showPane($)
    await press(ui, world, 'run-fix')
    expect(world.filled).toHaveLength(1)
    expect(world.filled[0]).toContain('Lint')
    expect(world.filled[0]).toContain('run 501')
    expect(world.filled[0]).toContain('job ')
    await ui.unmount()
  })
})
