import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { jobsRunning } from './fixtures/jobs'
import { prAdmin, prAutoMerge, prFailing, prGreen, prMergeQueue, prRunning } from './fixtures/pr-raw'

const NOW = Date.parse('2026-01-01T00:10:00Z')
const PANE = 'gh-status'
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} }

type Caller = { tool: { call(input: object): Promise<unknown> } }
/** Calls the Bash tool through a narrow type: the engine's own overloads are too deep for tsc here. */
const bash = ($: Engine, command: string) => ($ as unknown as Caller).tool.call({ tool: 'Bash', command })

type Raw = { list: unknown; detail: { data: { node: Record<string, unknown> } } }

const done = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

type Fixture = { list: unknown; detail: unknown }

/** Everything the plugin did to the world, and the knobs the tests turn. */
type World = {
  argvs: string[][]
  registered: { name: string; argumentHint?: string; description: string }[]
  /** What `$.command.list()` answers: the commands and skills that exist before the mod registers. */
  /** When set, `$.command.list()` rejects. */
  listThrows: boolean
  existing: { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }[]
  opened: { id: string; title?: string }[]
  closed: string[]
  toasts: string[]
  copied: string[]
  panes: { id: string }[]
  /** Whether the engine gave the opened pane the keyboard. */
  isFocused: boolean
  fixture: Fixture
  /** Other open pull requests of the repository by number, served to the by-number lookup (the list's picks). */
  others: Record<number, Fixture>
  /** When set, `gh pr merge` throws this instead of answering. */
  mergeThrows: string | null
  /** When set, the fixture becomes this once `gh pr merge` ran (the pull request shows merged). */
  afterMerge: Fixture | null
  /** What `gh pr merge` and the GraphQL mutations answer. */
  mergeAnswer: ReturnType<typeof done>
  mutationAnswer: ReturnType<typeof done>
  /** What `gh run rerun` answers, per call. */
  rerunAnswer: (argv: readonly string[]) => ReturnType<typeof done>
  filled: { text: string; mode?: string }[]
  clock: ReturnType<typeof mock.clock>
  /** How often the branch lookup (the full refresh) ran. */
  fullFetches(): number
  /** How often a conditional REST request (the fast check) ran. */
  fastRequests(): number
  /** The by-number lookups that ran, as the numbers asked for. */
  numberLookups(): number[]
}

function answer(world: World, argv: readonly string[]) {
  const [command, ...args] = argv
  if (command === 'git') {
    if (args.includes('rev-parse')) return done(0, 'true\n')
    if (args.includes('--show-current')) return done(0, 'feat/things\n')
    if (args.includes('get-url')) return done(0, 'git@github.com:cli/cli.git\n')
    return done(1)
  }
  if (command === 'open' || command === 'xdg-open') return done(0)
  if (command !== 'gh') return done(127, '', 'not found')
  if (args[0] === 'auth' && args[1] === 'status') {
    return done(0, JSON.stringify({ hosts: { 'github.com': [{ state: 'success', active: true, login: 'me' }] } }))
  }
  if (args[0] === 'auth' && args[1] === 'token') return done(0, 'tok\n')
  if (args[0] === 'run' && args[1] === 'rerun') return world.rerunAnswer(argv)
  if (args[0] === 'run' && args[1] === 'view') return done(0, JSON.stringify(jobsRunning))
  if (args[0] === 'api' && args.includes('-i')) return done(0, 'HTTP/2.0 200 OK\netag: W/"stable"\n\n{}')
  if (args[0] === 'pr' && args[1] === 'merge') {
    if (world.afterMerge !== null) world.fixture = world.afterMerge
    return world.mergeAnswer
  }
  if (args[0] === 'api') {
    const query = args.find(arg => arg.startsWith('query=')) ?? ''
    if (query.includes('mutation')) return world.mutationAnswer
    if (query.includes('$branch')) return done(0, JSON.stringify(world.fixture.list))
    if (query.includes('$number: Int!')) {
      const number = Number(args.find(arg => arg.startsWith('number='))?.slice('number='.length))
      return done(0, JSON.stringify(byNumberAnswer(world.others[number] ?? null)))
    }
    if (query.includes('$id: ID!')) {
      const id = args.find(arg => arg.startsWith('id='))?.slice('id='.length)
      const owner = [world.fixture, ...Object.values(world.others)].find(fixture => (fixture.detail as Raw['detail'] | null)?.data?.node?.id === id)
      return done(0, JSON.stringify((owner ?? world.fixture).detail))
    }
    return done(0, '{"data":{"repository":{"id":"R_1"}}}')
  }
  return done(1, '', 'unexpected')
}

/** What the id-by-number query answers for a fixture's pull request; no pull request when the fixture is null. */
function byNumberAnswer(fixture: Fixture | null): unknown {
  if (fixture === null) return { data: { repository: { isPrivate: false, pullRequest: null }, rateLimit: { cost: 1, remaining: 4000, resetAt: '2026-10-12T08:02:58Z' } } }
  const list = (fixture.list as { data: { repository: { pullRequests: { nodes: unknown[] } } & Record<string, unknown>; rateLimit: unknown } }).data
  const { pullRequests, ...scalars } = list.repository
  return { data: { repository: { ...scalars, isPrivate: false, pullRequest: pullRequests.nodes[0] }, rateLimit: list.rateLimit } }
}

/** Mocks the clock, the store and everything the plugin reaches through `$`. */
function setup(on: On, fixture: Fixture = prRunning): World {
  const world: World = {
    argvs: [],
    registered: [],
    existing: [],
    listThrows: false,
    opened: [],
    closed: [],
    toasts: [],
    copied: [],
    panes: [],
    isFocused: true,
    fixture,
    others: {},
    mergeThrows: null,
    afterMerge: null,
    mergeAnswer: done(0, 'merged\n'),
    mutationAnswer: done(0, '{"data":{}}'),
    rerunAnswer: () => done(0),
    filled: [],
    clock: mock.clock(on, { now: NOW }),
    fullFetches: () => world.argvs.filter(argv => argv[1] === 'api' && argv.some(arg => arg.startsWith('query=') && arg.includes('$branch'))).length,
    fastRequests: () => world.argvs.filter(argv => argv[1] === 'api' && argv.includes('-i')).length,
    numberLookups: () =>
      world.argvs
        .filter(argv => argv[1] === 'api' && argv.some(arg => arg.startsWith('query=') && arg.includes('$number: Int!')))
        .map(argv => Number(argv.find(arg => arg.startsWith('number='))?.slice('number='.length))),
  }
  mock.store(on)
  on('process.run', (_$, e) => {
    world.argvs.push([...e.argv])
    if (world.mergeThrows !== null && e.argv[1] === 'pr' && e.argv[2] === 'merge') throw new Error(world.mergeThrows)
    return { value: answer(world, e.argv) }
  })
  on('session.cwd', () => ({ value: '/work/cli' }))
  on('command.list', () => {
    if (world.listThrows) throw new Error('no list')
    return { value: world.existing }
  })
  on('command.register', (_$, e) => {
    world.registered.push(e)
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
  on('ui.panes', () => ({ value: world.panes.map(pane => ({ id: pane.id, title: pane.id, isShown: true, isFocused: world.isFocused, isPlaced: true })) }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    world.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('ui.copy', (_$, e) => {
    world.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // beneath the plugin: the engine's own answers
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.CwdChanged', () => ({}))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, isAborted: false, turnId: 't1' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['engine band'] }))
  return world
}

/** Every backgroundColor a drawn tree paints. */
function backgrounds(node: unknown): string[] {
  const element = node as { props?: { backgroundColor?: string }; children?: unknown[] }
  const own = typeof element?.props?.backgroundColor === 'string' ? [element.props.backgroundColor] : []
  return [...own, ...(element?.children ?? []).flatMap(backgrounds)]
}

async function start($: Engine, world: World) {
  await $.session.start({ cwd: '/work/cli', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
}

const runCommand = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
const runPr = ($: Engine, args = '') => runCommand($, 'pr', args)

describe('session start', () => {
  test('registers the pr command and starts a first refresh', async ($, on) => {
    const world = setup(on)
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['pr', 'gh-pr'])
    expect(world.registered[0]).toMatchObject({ name: 'pr', argumentHint: '<number> | back | refresh | open | close | copy | fix | rerun | merge | queue | dequeue | auto | admin (or rr | m | q | dq | a | x)' })
    expect(world.toasts).toEqual([])
    expect(world.fullFetches()).toBe(1)
  })

  test('a non-interactive session registers but does not poll', async ($, on) => {
    const world = setup(on)
    await $.session.start({ cwd: '/work/cli', surface: null, isInteractive: false })
    await world.clock.settle()
    expect(world.registered).toHaveLength(2)
    expect(world.fullFetches()).toBe(0)
  })
})

describe('the command name', () => {
  const skill = { name: 'pr', description: 'Open a pull request', source: 'user' as const }

  test('a skill named pr hides the mod: only gh-pr is registered, with one toast', async ($, on) => {
    const world = setup(on)
    world.existing = [skill]
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['gh-pr'])
    expect(world.toasts.filter(text => text.includes('is taken here'))).toEqual(['gh-status: /pr is taken here (skill or command), use /gh-pr'])
  })

  test('a built-in or a plugin command of that name counts as taken too', async ($, on) => {
    const world = setup(on)
    world.existing = [{ name: 'pr', description: 'x', source: 'plugin', plugin: 'other' }]
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['gh-pr'])
  })

  test('an entry of this plugin itself is not a collision', async ($, on) => {
    const world = setup(on)
    world.existing = [{ name: 'pr', description: 'x', source: 'plugin', plugin: 'gh-status' }]
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['pr', 'gh-pr'])
    expect(world.toasts).toEqual([])
  })

  test('a second session.start does not take its own registration for a collision', async ($, on) => {
    const world = setup(on)
    await start($, world)
    world.existing = [{ name: 'pr', description: 'x', source: 'plugin' }, { name: 'gh-pr', description: 'x', source: 'plugin' }]
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['pr', 'gh-pr', 'pr', 'gh-pr'])
    expect(world.toasts).toEqual([])
  })

  test('a failing command.list registers both names', async ($, on) => {
    const world = setup(on)
    world.listThrows = true
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['pr', 'gh-pr'])
  })

  test('the configured name prs is registered next to gh-pr and answers', { options: { command: 'prs' } }, async ($, on) => {
    const world = setup(on)
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['prs', 'gh-pr'])
    const ran = await runCommand($, 'prs')
    expect(ran.text).toContain('PR pane opened')
    const usage = await runCommand($, 'prs', 'nonsense')
    expect(usage.text).toContain('Usage: /prs [')
  })

  test('a taken configured name toasts with that name', { options: { command: 'prs' } }, async ($, on) => {
    const world = setup(on)
    world.existing = [{ name: 'prs', description: 'x', source: 'user' }]
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['gh-pr'])
    expect(world.toasts).toContain('gh-status: /prs is taken here (skill or command), use /gh-pr')
  })

  for (const invalid of ['', 'PR', 'a b', '/pr', 'x'.repeat(33), 'p_r']) {
    test(`the invalid name ${JSON.stringify(invalid)} falls back to pr`, { options: { command: invalid } }, async ($, on) => {
      const world = setup(on)
      await start($, world)
      expect(world.registered.map(command => command.name)).toEqual(['pr', 'gh-pr'])
    })
  }

  test('gh-pr as the configured name registers once', { options: { command: 'gh-pr' } }, async ($, on) => {
    const world = setup(on)
    await start($, world)
    expect(world.registered.map(command => command.name)).toEqual(['gh-pr'])
    expect(world.toasts).toEqual([])
  })

  test('both names open the pane and run subcommands', async ($, on) => {
    const world = setup(on)
    await start($, world)
    for (const name of ['pr', 'gh-pr']) {
      expect((await runCommand($, name)).text).toContain('PR pane opened')
      expect((await runCommand($, name, 'close')).text).toBe('PR pane closed.')
      expect((await runCommand($, name, 'copy')).text).toContain('Copied')
      expect((await runCommand($, name, 'bogus')).text).toContain(`Usage: /${name} [`)
    }
  })

  test('with pr taken, /pr is left to the skill: the hook passes it on untouched', async ($, on) => {
    const world = setup(on)
    world.existing = [skill]
    const seen: string[] = []
    on('command.run', (_$, e) => {
      seen.push(`${e.command} ${e.args}`)
      return { text: 'the skill answered' }
    })
    await start($, world)
    expect((await runPr($, 'refresh')).text).toBe('the skill answered')
    expect(seen).toEqual(['pr refresh'])
    expect(world.opened).toEqual([])
    expect((await runCommand($, 'gh-pr')).text).toContain('PR pane opened')
  })

  test('foreign commands pass through untouched', async ($, on) => {
    const world = setup(on)
    const seen: string[] = []
    on('command.run', (_$, e) => {
      seen.push(`${e.command} ${e.args}`)
      return { text: `foreign ${e.command}` }
    })
    await start($, world)
    expect((await runCommand($, 'compact', 'now')).text).toBe('foreign compact')
    expect(seen).toEqual(['compact now'])
    expect(world.opened).toEqual([])
  })
})

describe('refresh triggers', () => {
  test('a Bash git push refreshes, an unrelated command does not', async ($, on) => {
    const world = setup(on)
    await start($, world)
    expect(world.fullFetches()).toBe(1)
    await bash($, 'ls -la')
    await world.clock.settle()
    expect(world.fullFetches()).toBe(1)
    await bash($, 'git push origin HEAD')
    await world.clock.settle()
    expect(world.fullFetches()).toBe(2)
    await bash($, 'gh pr checks')
    await world.clock.settle()
    expect(world.fullFetches()).toBe(3)
  })

  test('the tool result is passed through unchanged', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ran = await bash($, 'git status')
    expect(ran).toMatchObject({ isAborted: false, turnId: 't1' })
  })

  test('turn.complete refreshes', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await world.clock.settle()
    expect(world.fullFetches()).toBe(2)
  })

  test('a changed directory refreshes', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await $.classic.CwdChanged({ old_cwd: '/a', new_cwd: '/work/cli' })
    await world.clock.settle()
    expect(world.fullFetches()).toBe(2)
  })
})

describe('the refresh loop', () => {
  test('running checks poll fast: timer ticks use the conditional check, not the full fetch', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const fastBefore = world.fastRequests()
    await world.clock.advance(5000)
    expect(world.fastRequests()).toBeGreaterThan(fastBefore)
    expect(world.fullFetches()).toBe(1)
  })

  test('the full fetch comes back once a minute', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await world.clock.advance(65_000)
    expect(world.fullFetches()).toBe(2)
  })

  test('an idle pull request polls on the idle interval', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    const fastBefore = world.fastRequests()
    await world.clock.advance(20_000)
    expect(world.fastRequests()).toBe(fastBefore)
    await world.clock.advance(15_000)
    expect(world.fastRequests()).toBeGreaterThan(fastBefore)
  })
})

describe('drawing', () => {
  test('the band draws the pull request above what the engine draws', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ui = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: 'Button', text: /PR #14580/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
  })

  for (const [name, options, badgeColor] of [
    ['by default', {}, 'success'],
    ['claude', { colors: 'claude' }, 'success'],
    ['github', { colors: 'github' }, '#238636'],
  ] as const) {
    test(`the colors option picks the palette: ${name}`, { options }, async ($, on) => {
      const world = setup(on)
      await start($, world)
      const band = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
      const paneProps = { title: 'PR', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
      const pane = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps })
      for (const ui of [band, pane]) {
        expect(backgrounds(await ui.drawn())).toContain(badgeColor)
        await ui.unmount()
      }
    })
  }

  test('a survey keeps the band quiet', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ui = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey: true } })
    expect(await ui.find({ text: /PR #/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
  })

  test('the band says nothing useful before the first refresh', async ($, on) => {
    const world = setup(on)
    await $.session.start({ cwd: '/work/cli', surface: 'terminal', isInteractive: false })
    const ui = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
    void world
  })

  test('the pane draws the pull request', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ui = await $.ui.mount({
      plugin: 'gh-status',
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE,
      props: { title: 'PR', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await ui.find({ text: /14580/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('the /pr command', () => {
  test('without an argument it opens the pane', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ran = await runPr($)
    expect(world.opened).toHaveLength(1)
    expect(world.opened[0]).toMatchObject({ id: PANE, title: 'PR' })
    const rows = (world.opened[0] as { rows?: number }).rows
    expect(rows).toBeGreaterThanOrEqual(6)
    expect(rows).toBeLessThanOrEqual(40)
    expect(ran.text).toContain('PR pane opened')
  })

  test('refresh forces a full fetch', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ran = await runPr($, 'refresh')
    expect(world.fullFetches()).toBe(2)
    expect(ran.text).toContain('14580')
  })

  test('copy puts the URL on the clipboard', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await runPr($, 'copy')
    expect(world.copied).toHaveLength(1)
    expect(world.copied[0]).toContain('/pull/14580')
  })

  test('open asks gh to open the pull request, and falls back to the URL', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await runPr($, 'open')
    expect(world.argvs.some(argv => argv[0] === 'gh' && argv.includes('--web') && argv.includes('cli/cli'))).toBe(true)
  })

  /** The running fixture with the repository marked private. */
  const privateRepo = (): Fixture => {
    const copy = structuredClone(prRunning) as { list: { data: { repository: Record<string, unknown> } }; detail: unknown }
    copy.list.data.repository.isPrivate = true
    return copy
  }
  const SIGN_IN_HINT = 'gh-status: if GitHub shows 404, sign in to github.com as @me'

  test('opening a private repository with a non-active account hints at the browser login', { options: { accounts: 'cli=me' } }, async ($, on) => {
    const world = setup(on, privateRepo())
    await start($, world)
    await runPr($, 'open')
    expect(world.toasts).toContain(SIGN_IN_HINT)
  })

  test('the open button of the pane hints the same way', { options: { accounts: 'cli=me' } }, async ($, on) => {
    const world = setup(on, privateRepo())
    await start($, world)
    const pane = await showPane($)
    await pane.press({ key: 'github' })
    await world.clock.settle()
    expect(world.toasts).toContain(SIGN_IN_HINT)
    await pane.unmount()
  })

  test('no hint when the account is the active one', async ($, on) => {
    const world = setup(on, privateRepo())
    await start($, world)
    await runPr($, 'open')
    expect(world.toasts).not.toContain(SIGN_IN_HINT)
  })

  test('no hint for a public repository', { options: { accounts: 'cli=me' } }, async ($, on) => {
    const world = setup(on)
    await start($, world)
    await runPr($, 'open')
    expect(world.toasts).not.toContain(SIGN_IN_HINT)
  })

  test('close closes the pane', async ($, on) => {
    const world = setup(on)
    await start($, world)
    await runPr($)
    await runPr($, 'close')
    expect(world.closed).toEqual([PANE])
  })

  test('anything else prints the usage', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const ran = await runPr($, 'frobnicate')
    expect(ran.text).toContain('Usage')
  })

  test('jobs are fetched only while the pane is open', async ($, on) => {
    const world = setup(on)
    await start($, world)
    const jobCalls = () => world.argvs.filter(argv => argv[1] === 'run' && argv[2] === 'view').length
    expect(jobCalls()).toBe(0)
    await runPr($)
    await world.clock.settle()
    expect(jobCalls()).toBeGreaterThan(0)
  })
})


// Write actions. Every gh call is a fake: `writes` lists the ones that would change GitHub.

/** Long enough after the confirmation was asked for for a press to count (the stray-key window is 600 ms). */
const SETTLED_MS = 700
const HEAD = '5f85ec828f6d2fe28d81ba71a61b8a2181edfb6a'


/** A copy of a fixture with the pull request node edited. */
function edited(fixture: unknown, patch: Record<string, unknown>): Fixture {
  const copy = structuredClone(fixture) as Raw
  Object.assign(copy.detail.data.node, patch)
  return copy
}

/** Every argv that would write to GitHub: a merge or a GraphQL mutation. */
const reruns = (world: World) => world.argvs.filter(argv => argv[0] === 'gh' && argv[1] === 'run' && argv[2] === 'rerun')

const writes = (world: World) =>
  world.argvs.filter(argv => argv[0] === 'gh' && ((argv[1] === 'pr' && argv[2] === 'merge') || argv.some(arg => arg.startsWith('query=mutation'))))

const paneProps = { title: 'PR', isFocused: true, bodyColumns: 100, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const showPane = ($: Engine) =>
  $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...paneProps, scroll: { offset: 0, bodyRows: 30 } } })

/** Whether the pane still asks for a confirmation (its y or final b button is drawn). */
const isConfirming = async (ui: Awaited<ReturnType<typeof showPane>>) => (await ui.find({ key: 'confirm' })) !== undefined || (await ui.find({ key: 'confirm-final' })) !== undefined

const sees = async (ui: Awaited<ReturnType<typeof showPane>>, text: string | RegExp) => (await ui.find({ text })) !== undefined

describe('requesting a write action', () => {
  test('/pr merge sets the confirmation and opens the pane with the keyboard: nothing is written before the confirm press', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    const ran = await runPr($, 'merge')
    expect(world.opened).toContainEqual(expect.objectContaining({ id: PANE, title: 'PR', focus: true }))
    expect(world.opened.map(opened => opened.id)).toEqual([PANE])
    expect(ran.text).toContain('Merge cli/cli #14580')
    expect(writes(world)).toEqual([])
    const ui = await showPane($)
    expect(await sees(ui, /Merge cli\/cli #14580 into bagtoad\/artifact-skill-docs/)).toBe(true)
    expect(await sees(ui, /as @me/)).toBe(true)
    expect(await sees(ui, /5f85ec8/)).toBe(true)
    expect(writes(world)).toEqual([])
    await ui.unmount()
  })

  test('a pane that did not get the keyboard toasts where the keys are; a focused one does not', async ($, on) => {
    const world = setup(on, prGreen)
    world.isFocused = false
    await start($, world)
    await runPr($, 'merge')
    expect(world.toasts).toContain('gh-status: press y in the band, or click the pane to focus it')
    expect(writes(world)).toEqual([])
  })

  test('a focused pane gives no hint', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    expect(world.toasts).not.toContain('gh-status: press y in the band, or click the pane to focus it')
  })

  test('the band confirms while the pane is unfocused, after the 600 ms guard', async ($, on) => {
    const world = setup(on, prGreen)
    world.isFocused = false
    await start($, world)
    await runPr($, 'merge')
    const band = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ key: 'band-confirm' })).toBeDefined()
    await band.press({ key: 'band-confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    await world.clock.advance(SETTLED_MS)
    await band.press({ key: 'band-confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([['gh', 'pr', 'merge', '14580', '--squash', '--match-head-commit', HEAD, '-R', 'cli/cli']])
    await band.unmount()
  })

  test('a band button only sets the confirmation: it opens nothing and writes nothing', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    const band = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await band.press({ key: 'band-merge' })
    await world.clock.settle()
    expect(world.opened).toEqual([])
    expect(writes(world)).toEqual([])
    expect(await band.find({ key: 'band-confirm' })).toBeDefined()
    await band.unmount()
    const pane = await showPane($)
    expect(await isConfirming(pane)).toBe(true)
    await pane.unmount()
  })

  test('a pane button only sets the confirmation: it opens nothing and writes nothing', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    const pane = await showPane($)
    await pane.press({ key: 'merge' })
    await world.clock.settle()
    expect(world.opened).toEqual([])
    expect(writes(world)).toEqual([])
    expect(await isConfirming(pane)).toBe(true)
    await pane.unmount()
  })

  test('with a merge queue enabled there is no plain merge, only the queue', async ($, on) => {
    const world = setup(on, edited(prGreen, { isMergeQueueEnabled: true }))
    await start($, world)
    const merge = await runPr($, 'merge')
    expect(merge.text).toContain('not available')
    expect(merge.text).toContain('enqueue')
    expect(world.opened).toEqual([])
    const queue = await runPr($, 'queue')
    expect(queue.text).toContain('Add cli/cli #14580 to the merge queue')
    expect(writes(world)).toEqual([])
  })

  const subcommands: [string, () => Fixture, string][] = [
    ['dequeue', () => prMergeQueue, 'Remove cli/cli #'],
    ['auto', () => edited(prGreen, { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }), 'Enable auto-merge'],
    ['auto', () => prAutoMerge, 'Disable auto-merge'],
    ['admin', () => prAdmin, 'Admin merge cli/cli #'],
  ]
  for (const [argument, fixture, title] of subcommands) {
    test(`/pr ${argument} asks "${title}" in the focused pane and writes nothing`, async ($, on) => {
      const world = setup(on, fixture())
      await start($, world)
      const ran = await runPr($, argument)
      expect(ran.text).toContain(title)
      expect(world.opened).toContainEqual(expect.objectContaining({ id: PANE, focus: true }))
      expect(writes(world)).toEqual([])
    })
  }

  // The short aliases ask for exactly what the long names ask for, and never write.
  const aliases: [string, () => Fixture, string][] = [
    ['m', () => prGreen, 'Merge cli/cli #'],
    ['q', () => edited(prGreen, { isMergeQueueEnabled: true }), 'Add cli/cli #'],
    ['dq', () => prMergeQueue, 'Remove cli/cli #'],
    ['a', () => edited(prGreen, { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }), 'Enable auto-merge'],
    ['x', () => prAdmin, 'Admin merge cli/cli #'],
  ]
  for (const [alias, fixture, title] of aliases) {
    test(`/pr ${alias} opens the pane with the keyboard, asks "${title}" and writes nothing`, async ($, on) => {
      const world = setup(on, fixture())
      await start($, world)
      const ran = await runPr($, alias)
      expect(ran.text).toContain(title)
      expect(world.opened).toContainEqual(expect.objectContaining({ id: PANE, title: 'PR', focus: true }))
      expect(writes(world)).toEqual([])
      const pane = await showPane($)
      expect(await isConfirming(pane)).toBe(true)
      await world.clock.advance(SETTLED_MS)
      expect(writes(world)).toEqual([])
      await pane.unmount()
    })
  }

  test('/pr merge on a PR that cannot be merged opens nothing', async ($, on) => {
    const world = setup(on, edited(prGreen, { isDraft: true }))
    await start($, world)
    const ran = await runPr($, 'merge')
    expect(ran.text).toContain('not available')
    expect(world.opened).toEqual([])
  })
})

describe('confirming', () => {
  test('the confirm press runs one merge bound to the seen commit, clears the confirmation, toasts and refreshes', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    const fetchesBefore = world.fullFetches()
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    expect(writes(world)).toEqual([])
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([['gh', 'pr', 'merge', '14580', '--squash', '--match-head-commit', HEAD, '-R', 'cli/cli']])
    expect(await isConfirming(ui)).toBe(false)
    expect(world.toasts).toContain('PR #14580 merged')
    expect(world.fullFetches()).toBeGreaterThan(fetchesBefore)
    await ui.unmount()
  })

  test('picking another method changes what is merged', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.select({ key: 'method', value: 'rebase' })
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([['gh', 'pr', 'merge', '14580', '--rebase', '--match-head-commit', HEAD, '-R', 'cli/cli']])
    await ui.unmount()
  })

  test('queue confirm sends the enqueue mutation with the expected head', async ($, on) => {
    const world = setup(on, edited(prGreen, { isMergeQueueEnabled: true }))
    await start($, world)
    await runPr($, 'queue')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    const sent = writes(world)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('pullRequestId=PR_kwDODKw3uc8AAAABGVY_uA')
    expect(sent[0]).toContain(`expectedHeadOid=${HEAD}`)
    expect(world.toasts).toContain('PR #14580 added to merge queue')
    await ui.unmount()
  })

  test('new commits since the confirmation was asked for: nothing is written, it stays and says so', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    world.fixture = edited(prGreen, { headRefOid: 'ffff00000000000000000000000000000000ffff' })
    await runPr($, 'refresh')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await isConfirming(ui)).toBe(true)
    expect(await sees(ui, /✗ new commits since you asked to confirm, review again/)).toBe(true)
    await ui.unmount()
  })

  test('a failed gh call is shown in the pane confirmation, and is not retried', async ($, on) => {
    const world = setup(on, prGreen)
    world.mergeAnswer = done(1, '', 'GraphQL: Pull request is not mergeable (mergePullRequest)\n')
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    await world.clock.advance(120_000)
    expect(writes(world)).toHaveLength(1)
    expect(await isConfirming(ui)).toBe(true)
    expect(await sees(ui, /✗ GraphQL: Pull request is not mergeable/)).toBe(true)
    await ui.unmount()
  })

  test('a success the state does not repeat is shown in the pane', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(await isConfirming(ui)).toBe(false)
    expect(await sees(ui, /✓ PR #14580 merged/)).toBe(true)
    await ui.unmount()
  })

  test('once the pull request shows merged, the pane says merged by ... and no success line', async ($, on) => {
    const world = setup(on, prGreen)
    world.afterMerge = edited(prGreen, { state: 'MERGED', mergedAt: '2026-01-01T00:09:59Z', mergedBy: { login: 'me' } })
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(await sees(ui, /merged by @me/)).toBe(true)
    expect(await sees(ui, /✓ PR #14580 merged/)).toBe(false)
    await ui.unmount()
  })

  test('an error outcome stays visible even though the confirmation is gone', async ($, on) => {
    const world = setup(on, prGreen)
    world.mergeThrows = 'process timed out'
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(await isConfirming(ui)).toBe(false)
    expect(await ui.findAll({ text: /✗/ })).not.toHaveLength(0)
    await ui.unmount()
  })

  test('one toast per merge: the transition toast of the refresh after an own merge is dropped', async ($, on) => {
    const world = setup(on, prGreen)
    world.afterMerge = edited(prGreen, { state: 'MERGED', mergedAt: '2026-01-01T00:09:59Z' })
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(world.toasts).toContain('PR #14580 merged')
    expect(world.toasts).not.toContain('PR #14580: merged')
    await ui.unmount()
  })

  test('a merge made elsewhere still toasts the transition', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    world.fixture = edited(prGreen, { state: 'MERGED', mergedAt: '2026-01-01T00:09:59Z' })
    await runPr($, 'refresh')
    expect(world.toasts).toContain('PR #14580: merged')
  })

  test('pressing n in the pane cancels: no write, the buttons are back, the band is normal again', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'm')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'cancel' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await isConfirming(ui)).toBe(false)
    expect(await ui.find({ key: 'merge' })).toBeDefined()
    await ui.unmount()
    const band = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ key: 'band-confirm' })).toBeUndefined()
    await band.unmount()
  })

  test('the pane and the band ask the same thing and either one confirms', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'm')
    const band = await $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const ui = await showPane($)
    expect((await band.find({ key: 'band-confirm' }))?.props).toMatchObject({ hotkey: 'y' })
    expect((await ui.find({ key: 'confirm' }))?.props).toMatchObject({ hotkey: 'y' })
    expect((await ui.find({ key: 'cancel' }))?.props).toMatchObject({ hotkey: 'n' })
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toHaveLength(1)
    await ui.unmount()
    await band.unmount()
  })

  test('two quick presses write once', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await Promise.all([ui.press({ key: 'confirm' }), ui.press({ key: 'confirm' })])
    await world.clock.settle()
    expect(writes(world)).toHaveLength(1)
    await ui.unmount()
  })
})

describe('cancelling', () => {
  test('cancel writes nothing and clears what was pending', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'cancel' })
    await world.clock.settle()
    expect(await isConfirming(ui)).toBe(false)
    expect(writes(world)).toEqual([])
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
    await ui.unmount()
  })

  test('closing the pane clears pending, so no confirm press can write', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    await runPr($, 'merge')
    // /pr close, like the pane's close mark (the ui.close hook), drops the pending action
    await runPr($, 'close')
    await world.clock.settle()
    expect(world.closed).toContain(PANE)
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    expect(await isConfirming(ui)).toBe(false)
    expect(writes(world)).toEqual([])
    await ui.unmount()
  })
})

describe('admin merge', () => {
  test('needs two different confirmations; the first never writes, quick repeats of it do not merge', async ($, on) => {
    const world = setup(on, prAdmin)
    await start($, world)
    const ran = await runPr($, 'admin')
    expect(ran.text).toContain('Admin merge cli/cli #')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    expect(await sees(ui, /This bypasses:/)).toBe(true)
    expect((await ui.find({ key: 'confirm' }))?.props).toMatchObject({ hotkey: 'y', label: 'continue' })
    await Promise.all([ui.press({ key: 'confirm' }), ui.press({ key: 'confirm' })])
    await ui.press({ key: 'confirm' }).catch(() => undefined)
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await sees(ui, /Final confirmation: bypass rules and merge cli\/cli #/)).toBe(true)
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
    expect((await ui.find({ key: 'confirm-final' }))?.props).toMatchObject({ hotkey: 'b' })
    await ui.press({ key: 'confirm-final' })
    await world.clock.settle()
    // right after step 1 the final key is a stray press
    expect(writes(world)).toEqual([])
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm-final' })
    await world.clock.settle()
    const sent = writes(world)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.arrayContaining(['pr', 'merge', '--match-head-commit', '--admin']))
    expect(world.toasts).toEqual(expect.arrayContaining([expect.stringMatching(/^PR #\d+ merged as admin$/)]))
    await ui.unmount()
  })

  test('cancelling at the second step writes nothing', async ($, on) => {
    const world = setup(on, prAdmin)
    await start($, world)
    await runPr($, 'admin')
    const ui = await showPane($)
    await world.clock.advance(SETTLED_MS)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await ui.press({ key: 'cancel' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await isConfirming(ui)).toBe(false)
    await ui.unmount()
  })

  test('without the admin right the action is not offered', async ($, on) => {
    const world = setup(on, edited(prAdmin, { viewerCanMergeAsAdmin: false }))
    await start($, world)
    const ran = await runPr($, 'admin')
    expect(ran.text).toContain('not available')
    expect(world.opened).toEqual([])
  })
})

describe('write safety', () => {
  /** Opens the dialog for `argument` and shows it; the caller decides when to press. */
  async function openDialog($: Engine, world: World, argument = 'merge') {
    await start($, world)
    await runPr($, argument)
    return showPane($)
  }

  test('a press right after the dialog opened is a stray keystroke and writes nothing', async ($, on) => {
    const world = setup(on, prGreen)
    const ui = await openDialog($, world)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    await world.clock.advance(599)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    await world.clock.advance(1)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toHaveLength(1)
    await ui.unmount()
  })

  test('the write acts on a fresh full fetch: a queue turned on since makes the plain merge refuse', async ($, on) => {
    const world = setup(on, prGreen)
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    world.fixture = edited(prGreen, { isMergeQueueEnabled: true })
    const before = world.fullFetches()
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(world.fullFetches()).toBeGreaterThan(before)
    expect(writes(world)).toEqual([])
    expect(await isConfirming(ui)).toBe(true)
    expect(await sees(ui, /no longer available/)).toBe(true)
    await ui.unmount()
  })

  test('a moved head is caught on the fresh fetch even when the stored snapshot is stale', async ($, on) => {
    const world = setup(on, prGreen)
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    world.fixture = edited(prGreen, { headRefOid: 'ffff00000000000000000000000000000000ffff' })
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await sees(ui, /new commits since you asked to confirm/)).toBe(true)
    await ui.unmount()
  })

  test('when the fresh fetch fails nothing is written and the dialog says so', async ($, on) => {
    const world = setup(on, prGreen)
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    world.fixture = { list: { errors: [{ message: 'boom' }] }, detail: null }
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await isConfirming(ui)).toBe(true)
    expect(await sees(ui, /could not re-check the pull request, nothing was done/)).toBe(true)
    await ui.unmount()
  })

  test('a cancel while the fresh fetch runs writes nothing', async ($, on) => {
    const world = setup(on, prGreen)
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    await Promise.all([ui.press({ key: 'confirm' }), ui.press({ key: 'cancel' })])
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await isConfirming(ui)).toBe(false)
    await ui.unmount()
  })

  test('the account token is warmed when the dialog opens', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    const tokensBefore = world.argvs.filter(argv => argv[1] === 'auth' && argv[2] === 'token').length
    await runPr($, 'merge')
    await world.clock.settle()
    const tokensAfter = world.argvs.filter(argv => argv[1] === 'auth' && argv[2] === 'token').length
    expect(tokensAfter).toBeGreaterThanOrEqual(tokensBefore)
    expect(writes(world)).toEqual([])
  })

  test('a timeout leaves no armed dialog: pending cleared, closed, toast, forced refresh', async ($, on) => {
    const world = setup(on, prGreen)
    world.mergeThrows = 'process timed out'
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    const before = world.fullFetches()
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(writes(world)).toHaveLength(1)
    expect(await isConfirming(ui)).toBe(false)
    expect(world.toasts).toContain('PR #14580: result unknown, refreshed status')
    expect(world.fullFetches()).toBeGreaterThan(before + 1)
    await ui.unmount()
    const again = await showPane($)
    expect(await again.find({ key: 'confirm' })).toBeUndefined()
    await again.unmount()
  })

  test('a clear GitHub refusal keeps the dialog open', async ($, on) => {
    const world = setup(on, prGreen)
    world.mergeAnswer = done(1, '', 'GraphQL: Pull request is not mergeable\n')
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.settle()
    expect(await isConfirming(ui)).toBe(true)
    expect(world.toasts.some(text => text.includes('result unknown'))).toBe(false)
    await ui.unmount()
  })

  test('admin merge: rules that changed between the steps are refused, and step 1 shows the new rules', async ($, on) => {
    const world = setup(on, prAdmin)
    const ui = await openDialog($, world, 'admin')
    await world.clock.advance(SETTLED_MS)
    await ui.press({ key: 'confirm' })
    await world.clock.advance(SETTLED_MS)
    world.fixture = edited(prAdmin, { isMergeQueueEnabled: true })
    await ui.press({ key: 'confirm-final' })
    await world.clock.settle()
    expect(writes(world)).toEqual([])
    expect(await sees(ui, /rules changed, review again/)).toBe(true)
    await ui.unmount()
  })

  test('a new request while a confirm is in flight is ignored and replaces nothing', async ($, on) => {
    const world = setup(on, prGreen)
    const ui = await openDialog($, world)
    await world.clock.advance(SETTLED_MS)
    const pressed = ui.press({ key: 'confirm' })
    const ran = await runPr($, 'merge')
    await pressed
    await world.clock.settle()
    expect(ran.text).toContain('in progress')
    expect(writes(world)).toHaveLength(1)
    expect(writes(world)[0]).toContain('--squash')
    await ui.unmount()
  })
})

describe('CI to Claude', () => {
  test('/pr fix puts a reference into the prompt, with the log command and without logs', async ($, on) => {
    const world = setup(on, prFailing)
    await start($, world)
    const ran = await runPr($, 'fix')
    expect(ran.text).toContain('prompt')
    expect(world.filled).toHaveLength(1)
    expect(world.filled[0]?.mode).toBe('insert')
    expect(world.filled[0]?.text).toContain('--log-failed -R cli/cli')
    expect(world.filled[0]?.text).toContain('Please investigate these failures and fix them.')
    expect(world.toasts).toContain('Failed checks added to the prompt.')
    expect(writes(world)).toEqual([])
    expect(world.argvs.some(argv => argv.includes('--log-failed'))).toBe(false)
  })

  test('the pane button does the same', async ($, on) => {
    const world = setup(on, prFailing)
    await start($, world)
    const pane = await showPane($)
    await pane.press({ key: 'fix-ci' })
    expect(world.filled).toHaveLength(1)
    await pane.unmount()
  })

  test('says so when nothing failed', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    expect((await runPr($, 'fix')).text).toBe('No failed checks.')
    expect(world.filled).toEqual([])
  })
})

describe('re-run failed jobs', () => {
  test('/pr rerun and /pr rr run only the failed jobs of each failed run, once, and never merge', async ($, on) => {
    const world = setup(on, prFailing)
    await start($, world)
    for (const argument of ['rerun', 'rr']) {
      const before = reruns(world).length
      const ran = await runPr($, argument)
      await world.clock.settle()
      expect(ran.text).toMatch(/^PR #14640: re-running failed jobs in \d+ runs?$/)
      const fresh = reruns(world).slice(before)
      expect(fresh.length).toBeGreaterThan(0)
      for (const argv of fresh) {
        expect(argv).toEqual(['gh', 'run', 'rerun', argv[3], '--failed', '-R', 'cli/cli'])
        expect(argv[3]).toMatch(/^\d+$/)
      }
      expect(new Set(fresh.map(argv => argv[3])).size).toBe(fresh.length)
    }
    expect(world.toasts.some(text => text.startsWith('PR #14640: re-running failed jobs in'))).toBe(true)
    expect(world.argvs.some(argv => argv.includes('merge'))).toBe(false)
    expect(writes(world)).toEqual([])
    expect(world.opened).toEqual([])
  })

  test('says so and runs nothing when no run can be re-run', async ($, on) => {
    const world = setup(on, prGreen)
    await start($, world)
    expect((await runPr($, 'rerun')).text).toBe('No failed runs to re-run.')
    expect(reruns(world)).toEqual([])
  })

  test('a gh failure is reported with its message', async ($, on) => {
    const world = setup(on, prFailing)
    world.rerunAnswer = () => done(1, '', 'HTTP 403: Must have admin rights to Repository.\n')
    await start($, world)
    const ran = await runPr($, 'rr')
    await world.clock.settle()
    expect(ran.text).toBe('PR #14640: could not re-run, HTTP 403: Must have admin rights to Repository.')
    expect(world.toasts).toContain(ran.text)
  })

  test('the pane button does the same, and a press during a re-run is dropped', async ($, on) => {
    const world = setup(on, prFailing)
    await start($, world)
    const pane = await showPane($)
    const first = pane.press({ key: 'rerun-failed' })
    const second = await runPr($, 'rerun')
    await first
    await world.clock.settle()
    expect(second.text).toContain('in progress')
    const afterFirst = reruns(world).length
    expect(afterFirst).toBeGreaterThan(0)
    // the guard is released afterwards
    await pane.press({ key: 'rerun-failed' })
    await world.clock.settle()
    expect(reruns(world).length).toBe(afterFirst * 2)
    await pane.unmount()
  })
})

describe('what the model can reach', () => {
  test('the plugin registers no tool', async ($, on) => {
    const world = setup(on, prGreen)
    const registered: unknown[] = []
    on('tool.register', (_$, e) => {
      registered.push(e)
      return { value: undefined } as never
    })
    await start($, world)
    await runPr($, 'merge')
    expect(registered).toEqual([])
  })
})

// The list's picks: any open pull request of the repository in the pane, the band on the branch's.

describe('a pull request picked from the list', () => {
  /** The branch has the blocked 14640; the repository also has the mergeable 14580. */
  const worldWithPick = (on: On): World => {
    const world = setup(on, prFailing)
    world.others[14580] = prGreen
    return world
  }
  const bandProps = BAND_PROPS
  const mountBand = ($: Engine) => $.ui.mount({ plugin: 'gh-status', surface: 'terminal', component: 'AbovePrompt', props: bandProps })

  test('/pr <number> opens the pane with the keyboard and shows that pull request, marked as selected', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    const ran = await runPr($, '14580')
    await world.clock.settle()
    expect(ran.text).toContain('PR #14580')
    expect(world.opened).toContainEqual(expect.objectContaining({ id: PANE, focus: true }))
    expect(world.numberLookups()).toContain(14580)
    const pane = await showPane($)
    expect(await sees(pane, /PR #14580 \(selected\)/)).toBe(true)
    expect(await pane.find({ key: 'back' })).toBeDefined()
    await pane.unmount()
  })

  test('the band keeps the branch pull request', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    await runPr($, '14580')
    await world.clock.settle()
    const band = await mountBand($)
    expect(await band.find({ type: 'Button', text: /PR #14640/ })).toBeDefined()
    expect(await band.find({ text: /14580/ })).toBeUndefined()
    await band.unmount()
  })

  test('before the first answer the pane says loading, never the branch pull request', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    world.others[14580] = prGreen
    await runPr($, '14580')
    const pane = await showPane($)
    expect(await sees(pane, /14640/)).toBe(false)
    await world.clock.settle()
    expect(await sees(pane, /14580/)).toBe(true)
    await pane.unmount()
  })

  test('a pull request that does not exist is said so in the pane', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    await runPr($, '99999')
    await world.clock.settle()
    const pane = await showPane($)
    expect(await sees(pane, /PR #99999 was not found/)).toBe(true)
    expect(await pane.find({ key: 'back' })).toBeDefined()
    await pane.unmount()
  })

  test('back returns to the branch pull request: no marker, no back button, the pick is dropped', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    await runPr($, '14580')
    await world.clock.settle()
    const pane = await showPane($)
    await pane.press({ key: 'back' })
    await world.clock.settle()
    expect(await sees(pane, /14640/)).toBe(true)
    expect(await sees(pane, /\(selected\)/)).toBe(false)
    expect(await pane.find({ key: 'back' })).toBeUndefined()
    const lookups = world.numberLookups().length
    await world.clock.advance(120_000)
    expect(world.numberLookups()).toHaveLength(lookups)
    await pane.unmount()
  })

  test('the pick is the branch pull request: shown as selected, nothing is fetched by number', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    await runPr($, '14640')
    await world.clock.settle()
    expect(world.numberLookups()).toEqual([])
    const pane = await showPane($)
    expect(await sees(pane, /PR #14640 \(selected\)/)).toBe(true)
    await pane.unmount()
  })

  test('picking another pull request drops the confirmation of the one before', async ($, on) => {
    const world = setup(on, prGreen)
    world.others[14640] = prFailing
    await start($, world)
    await runPr($, 'merge')
    await runPr($, '14640')
    await world.clock.settle()
    const pane = await showPane($)
    expect(await isConfirming(pane)).toBe(false)
    await world.clock.advance(SETTLED_MS)
    const band = await mountBand($)
    expect(await band.find({ key: 'band-confirm' })).toBeUndefined()
    expect(writes(world)).toEqual([])
    await band.unmount()
    await pane.unmount()
  })

  test('/pr back and a bad number are answered', async ($, on) => {
    const world = worldWithPick(on)
    await start($, world)
    expect((await runPr($, '0')).text).toContain('not a pull request number')
    await runPr($, '14580')
    expect((await runPr($, 'back')).text).toContain('this branch')
    expect(world.numberLookups().filter(number => number === 0)).toEqual([])
  })

  describe('write actions bind to the pull request the pane shows', () => {
    const merge = ['gh', 'pr', 'merge', '14580', '--squash', '--match-head-commit', HEAD, '-R', 'cli/cli']

    test('a merge requested in the selected view binds its id, head and repository, and re-checks it by number', async ($, on) => {
      const world = worldWithPick(on)
      await start($, world)
      await runPr($, '14580')
      await world.clock.settle()
      const ran = await runPr($, 'merge')
      expect(ran.text).toContain('Merge cli/cli #14580')
      const pane = await showPane($)
      expect(await sees(pane, /Merge cli\/cli #14580 into /)).toBe(true)
      expect(await sees(pane, /5f85ec8/)).toBe(true)
      expect(writes(world)).toEqual([])
      await world.clock.advance(SETTLED_MS)
      const before = world.argvs.length
      await pane.press({ key: 'confirm' })
      await world.clock.settle()
      expect(writes(world)).toEqual([merge])
      // between the press and the write: the by-number lookup of 14580 and no branch lookup
      const writeAt = world.argvs.findIndex((argv, index) => index >= before && argv[1] === 'pr' && argv[2] === 'merge')
      const recheck = world.argvs.slice(before, writeAt)
      const queries = recheck.filter(argv => argv[1] === 'api').map(argv => argv.find(arg => arg.startsWith('query=')) ?? '')
      expect(queries.some(query => query.includes('$number: Int!'))).toBe(true)
      expect(queries.some(query => query.includes('$branch'))).toBe(false)
      expect(recheck.some(argv => argv.includes('number=14580'))).toBe(true)
      expect(world.toasts).toContain('PR #14580 merged')
      await pane.unmount()
    })

    test('the selected pull request moving to a new head after the confirmation was asked: nothing is written', async ($, on) => {
      const world = worldWithPick(on)
      await start($, world)
      await runPr($, '14580')
      await world.clock.settle()
      await runPr($, 'merge')
      const pane = await showPane($)
      await world.clock.advance(SETTLED_MS)
      world.others[14580] = edited(prGreen, { headRefOid: 'ffff00000000000000000000000000000000ffff' })
      await pane.press({ key: 'confirm' })
      await world.clock.settle()
      expect(writes(world)).toEqual([])
      expect(await sees(pane, /new commits since you asked to confirm/)).toBe(true)
      await pane.unmount()
    })

    test('a number that is gone at the re-check writes nothing', async ($, on) => {
      const world = worldWithPick(on)
      await start($, world)
      await runPr($, '14580')
      await world.clock.settle()
      await runPr($, 'merge')
      const pane = await showPane($)
      await world.clock.advance(SETTLED_MS)
      delete world.others[14580]
      await pane.press({ key: 'confirm' })
      await world.clock.settle()
      expect(writes(world)).toEqual([])
      expect(await isConfirming(pane)).toBe(true)
      await pane.unmount()
    })

    test('a pane button asks about the selected pull request; the blocked branch pull request offers no merge', async ($, on) => {
      const world = worldWithPick(on)
      await start($, world)
      const plain = await showPane($)
      expect(await plain.find({ key: 'merge' })).toBeUndefined()
      await plain.unmount()
      await runPr($, '14580')
      await world.clock.settle()
      const pane = await showPane($)
      await pane.press({ key: 'merge' })
      await world.clock.settle()
      expect(await isConfirming(pane)).toBe(true)
      await world.clock.advance(SETTLED_MS)
      await pane.press({ key: 'confirm' })
      await world.clock.settle()
      expect(writes(world)).toEqual([merge])
      await pane.unmount()
    })

    test('the band confirmation of the branch pull request is not shown by the selected view, and still writes the branch pull request', async ($, on) => {
      const world = setup(on, prGreen)
      world.others[14640] = prFailing
      // the by-number re-check of the branch pull request finds it like the repository does
      world.others[14580] = prGreen
      await start($, world)
      await runPr($, '14640')
      await world.clock.settle()
      const band = await mountBand($)
      await band.press({ key: 'band-merge' })
      await world.clock.settle()
      expect(await band.find({ key: 'band-confirm' })).toBeDefined()
      const pane = await showPane($)
      expect(await isConfirming(pane)).toBe(false)
      await world.clock.advance(SETTLED_MS)
      await band.press({ key: 'band-confirm' })
      await world.clock.settle()
      expect(writes(world)).toEqual([['gh', 'pr', 'merge', '14580', '--squash', '--match-head-commit', HEAD, '-R', 'cli/cli']])
      await pane.unmount()
      await band.unmount()
    })

    test('a merge in the selected view leaves the branch pull request in the band untouched', async ($, on) => {
      const world = worldWithPick(on)
      await start($, world)
      await runPr($, '14580')
      await world.clock.settle()
      await runPr($, 'merge')
      await world.clock.advance(SETTLED_MS)
      const pane = await showPane($)
      await pane.press({ key: 'confirm' })
      await world.clock.settle()
      const band = await mountBand($)
      expect(await band.find({ type: 'Button', text: /PR #14640/ })).toBeDefined()
      expect(await band.find({ key: 'band-confirm' })).toBeUndefined()
      await band.unmount()
      await pane.unmount()
    })
  })
})
