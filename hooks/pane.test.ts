import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
} as const

const DIALOG = {
  component: 'Pane',
  requestId: 'dev-cockpit-settings',
  props: { title: 'Settings', isFocused: true, bodyColumns: 100, placement: 'inline' },
} as const

const SURFACES = ['terminal', 'desktop'] as const

type Typing = {
  find: (query: { type: string; text: RegExp }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  unmount: () => Promise<void>
}
const ROOT = 'C:/work/app'

type Project = {
  files: Record<string, string>
  probe: unknown[]
  branch: string
  favorites?: string[]
  terminalFails?: boolean
  isCodeMissing?: boolean
  isLinkedWorktree?: boolean
  store?: Record<string, unknown>
}

type Calls = { ran: string[][]; opened: string[]; closed: string[] }

const MAIN_FIRST = ['worktree C:/work/app', '', 'worktree C:/work/app/.claude/worktrees/wt2', '', 'worktree C:/work/app-stable']
const OTHER_FIRST = ['worktree C:/work/main-repo', '', 'worktree C:/work/app', '', 'worktree C:/work/app/.claude/worktrees/wt2']

function ok(stdout: string, exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function relative(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized === ROOT ? '' : normalized.startsWith(`${ROOT}/`) ? normalized.slice(ROOT.length + 1) : normalized
}

function childrenOf(project: Project, path: string) {
  const prefix = relative(path) === '' ? '' : `${relative(path)}/`
  const seen = new Map<string, 'file' | 'dir'>()
  for (const file of Object.keys(project.files)) {
    if (!file.startsWith(prefix)) continue
    const [name, ...rest] = file.slice(prefix.length).split('/')
    if (name !== undefined && name !== '') seen.set(name, rest.length > 0 ? 'dir' : 'file')
  }
  return [...seen.entries()].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false }))
}

function mockProject(on: On, project: Project): Calls {
  const calls: Calls = { ran: [], opened: [], closed: [] }
  mock.store(on, {
    ...(project.favorites === undefined ? {} : { 'favorites:c:/work/app': project.favorites }),
    ...project.store,
  })
  on('session.id', () => ({ value: 'S1' }))
  on('session.messages', () => ({ value: [] }) as never)
  on('session.cwd', () => ({ value: ROOT }))
  on('session.repo', () => ({
    value: { root: ROOT, remote: 'https://github.com/sylvain-hamel/app.git', internal: false, name: 'app' },
  }))
  on('ui.open', ($, e) => {
    calls.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    calls.closed.push(e.id)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({ value: childrenOf(project, e.path) }))
  on('fs.exists', ($, e) => ({ value: relative(e.path) in project.files }))
  on('fs.read', ($, e) => {
    const text = project.files[relative(e.path)]
    return text === undefined ? { deny: 'missing' } : { value: text }
  })
  on('process.run', ($, e) => {
    calls.ran.push([...e.argv])
    const [command, ...args] = e.argv
    if (command === 'git' && args[1] === '--show-toplevel') return ok(`${ROOT}\n`)
    if (command === 'git' && args[0] === 'worktree') {
      return ok((project.isLinkedWorktree === true ? OTHER_FIRST : MAIN_FIRST).join('\n'))
    }
    if (command === 'git' && args[1] === '--abbrev-ref') return ok(`${project.branch}\n`)
    if (command === 'powershell.exe') return ok(JSON.stringify(project.probe))
    if (command === 'gh') return ok('Actions on messages\n')
    if (command === 'wt.exe' && project.terminalFails === true) return ok('', 1)
    if (command === 'cmd.exe' && args[2] === 'code' && project.isCodeMissing === true) return ok('', 1)
    return ok('')
  })
  return calls
}

const MONOREPO = {
  'package.json': JSON.stringify({ name: 'acme', scripts: { lint: 'eslint .', test: 'vitest run' } }),
  'pnpm-lock.yaml': '',
  'apps/portal/package.json': JSON.stringify({ name: '@acme/portal', scripts: { dev: 'next dev', build: 'next build' } }),
  'apps/portal/node_modules/x/package.json': JSON.stringify({ scripts: { hidden: 'x' } }),
  'services/api/package.json': JSON.stringify({ name: '@acme/api', scripts: { dev: 'nodemon src/index.js' } }),
  '.git/package.json': JSON.stringify({ scripts: { hidden: 'x' } }),
}

const PROCESSES = [
  { pid: 9, ppid: 1, name: 'node.exe', cmd: 'node C:\\pnpm\\bin\\pnpm.cjs dev', mem: 0, ports: [] },
  { pid: 10, ppid: 9, name: 'node.exe', cmd: 'node C:\\work\\app\\apps\\portal\\node_modules\\vite\\bin\\vite.js', cwd: 'C:\\work\\app\\apps\\portal\\', mem: 0, ports: [5173] },
  { pid: 11, ppid: 9, name: 'node.exe', cmd: 'node C:\\work\\app\\services\\api\\node_modules\\nodemon\\bin\\nodemon.js', cwd: 'C:\\work\\app\\services\\api\\', mem: 0, ports: [4000, 9229] },
  { pid: 20, ppid: 1, name: 'node.exe', cmd: 'node C:\\work\\app\\.claude\\worktrees\\wt2\\node_modules\\vite\\bin\\vite.js', mem: 0, ports: [5174] },
  { pid: 30, ppid: 1, name: 'node.exe', cmd: 'node C:\\work\\app-stable\\node_modules\\vite\\bin\\vite.js', mem: 0, ports: [5175] },
]

test('the band shows the worktree, its app ports, favorite tasks and the issue', async ($, on) => {
  const calls = mockProject(on, {
    files: MONOREPO,
    probe: PROCESSES,
    branch: 'issue-6-actions',
    favorites: ['.#test', 'apps/portal#dev'],
  })

  await $.command.run({ command: 'cockpit', args: '' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'vscode' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /launched from \.\/apps\/portal/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /pid 10 · 0 MB/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /launched from \.\/services\/api/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'app:http://localhost:5173' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'app:http://localhost:4000' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'app:http://localhost:5174' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'app:http://localhost:5175' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'run:.#test' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'run:apps/portal#dev' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'run:.#lint' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'issue' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('"label":"#6"')
    expect((await ui.findAll({ type: 'Text', text: /^│$/ })).length).toBe(3)
    await ui.press({ key: 'issue' })
    await ui.press({ key: 'vscode' })
    await ui.press({ key: 'app:http://localhost:5173' })
    await ui.press({ key: 'run:apps/portal#dev' })
    await ui.unmount()
  }

  expect(calls.ran).toContainEqual(['cmd.exe', '/d', '/c', 'code', 'C:\\work\\app'])
  expect(calls.ran).toContainEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'https://github.com/sylvain-hamel/app/issues/6'])
  expect(calls.ran).toContainEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'http://localhost:5173'])
  expect(calls.ran).toContainEqual([
    'wt.exe', '-w', '0', 'new-tab', '--title', 'portal:dev', '-d', 'C:\\work\\app\\apps\\portal', 'cmd.exe', '/k', 'pnpm', 'run', 'dev',
  ])
})

test('the band labels app buttons with their port only', async ($, on) => {
  mockProject(on, { files: MONOREPO, probe: PROCESSES, branch: 'main' })

  await $.command.run({ command: 'cockpit', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"label":"portal (5173)"')
  expect(drawn).toContain('"label":"api (4000)"')
  expect(drawn).not.toContain('(9229)')
  expect(drawn).not.toContain('Ask Claude')
  expect(drawn).not.toContain('Refresh')
  await ui.unmount()
})

test('the dialog lists every package task, stars favorites and runs one once', async ($, on) => {
  const calls = mockProject(on, { files: MONOREPO, probe: [], branch: 'main', favorites: ['.#test'] })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  expect(calls.opened).toContain('dev-cockpit-settings')

  for (const surface of SURFACES) {
    const dialog = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...DIALOG } as never)
    expect(await dialog.find({ type: 'Text', text: /@acme\/portal \(apps\/portal\)/ })).toBeDefined()
    expect(await dialog.find({ type: 'Button', key: 'once:services/api#dev' })).toBeDefined()
    expect(await dialog.find({ type: 'Button', key: 'once:apps/portal/node_modules/x#hidden' })).toBeUndefined()
    expect(await dialog.find({ type: 'Button', key: 'once:.git#hidden' })).toBeUndefined()

    await dialog.press({ key: 'fav:apps/portal#build' })
    const band = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...BAND } as never)
    expect(await band.find({ type: 'Button', key: 'run:apps/portal#build' })).toBeDefined()
    await dialog.press({ key: 'fav:apps/portal#build' })
    expect(await band.find({ type: 'Button', key: 'run:apps/portal#build' })).toBeUndefined()
    await band.unmount()

    await dialog.press({ key: 'once:.#lint' })
    await dialog.press({ key: 'close' })
    await dialog.unmount()
  }

  expect(calls.ran).toContainEqual(['wt.exe', '-w', '0', 'new-tab', '--title', 'lint', '-d', 'C:\\work\\app', 'cmd.exe', '/k', 'pnpm', 'run', 'lint'])
  expect(calls.closed).toContain('dev-cockpit-settings')
})

test('a task falls back to a cmd window without Windows Terminal', async ($, on) => {
  const calls = mockProject(on, { files: MONOREPO, probe: [], branch: 'main', favorites: ['.#test'], terminalFails: true })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'run:.#test' })
  await ui.unmount()

  expect(calls.ran).toContainEqual(['cmd.exe', '/d', '/c', 'start', '', '/D', 'C:\\work\\app', 'cmd.exe', '/k', 'pnpm', 'run', 'test'])
})

test('an Electron project shows no app port and a project without Node shows no tasks', async ($, on) => {
  mockProject(on, {
    files: { 'package.json': '{"scripts":{"dev":"electron-vite dev"},"devDependencies":{"electron":"44"}}' },
    probe: [
      { pid: 30, ppid: 1, name: 'node.exe', cmd: 'node C:\\work\\app\\node_modules\\electron-vite\\bin\\electron-vite.js dev', mem: 0, ports: [5173] },
      { pid: 31, ppid: 30, name: 'electron.exe', cmd: 'C:\\work\\app\\node_modules\\electron\\dist\\electron.exe .', mem: 0, ports: [] },
    ],
    branch: 'main',
  })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  expect(JSON.stringify(await ui.drawn())).not.toContain('5173')
  expect(await ui.find({ type: 'Button', key: 'settings' })).toBeDefined()
  await ui.unmount()
})

test('a project without package scripts has no task controls', async ($, on) => {
  mockProject(on, { files: { 'README.md': '# docs' }, probe: [], branch: 'feature', isLinkedWorktree: true })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /^app$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'settings' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'issue' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^no app running$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^│$/ })).length).toBe(1)
  await ui.unmount()

  const dialog = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...DIALOG } as never)
  expect(await dialog.find({ type: 'Text', text: /No package scripts/ })).toBeDefined()
  await dialog.unmount()
})

test('an app gets a custom label from its launch folder in the settings', async ($, on) => {
  mockProject(on, { files: MONOREPO, probe: PROCESSES, branch: 'main' })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const settings = (await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...DIALOG } as never)) as unknown as Typing
  expect(await settings.find({ type: 'Text', text: /\.\/apps\/portal · 5173/ })).toBeDefined()
  expect(await settings.find({ type: 'Text', text: /\.\/services\/api · 4000/ })).toBeDefined()
  await settings.input({ key: 'label:apps/portal', text: 'Portail' })

  const band = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('"label":"Portail (5173)"')
  expect(drawn).toContain('"label":"api (4000)"')
  await band.unmount()

  await settings.input({ key: 'label:apps/portal', text: '' })
  const again = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  expect(JSON.stringify(await again.drawn())).toContain('"label":"portal (5173)"')
  await again.unmount()
  await settings.unmount()
})

test('a saved label comes back for the same folder on another port', async ($, on) => {
  const moved = PROCESSES.map(row => (row.pid === 10 ? { ...row, ports: [5200] } : row))
  mockProject(on, { files: MONOREPO, probe: moved, branch: 'main', store: { 'labels:c:/work/app': { 'apps/portal': 'Portail' } } })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const band = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Button', key: 'app:http://localhost:5200' })).toBeDefined()
  expect(JSON.stringify(await band.drawn())).toContain('"label":"Portail (5200)"')
  await band.unmount()
})

async function issueShown(ui: { drawn: () => Promise<unknown> }): Promise<string | null> {
  return /"label":"(#\d+)"/.exec(JSON.stringify(await ui.drawn()))?.[1] ?? null
}

test('the issue stays on the main card when other cards are mentioned', async ($, on) => {
  mockProject(on, { files: {}, probe: [], branch: 'main' })
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)

  await $.prompt.submit({ text: 'Work on #12 please' } as never)
  expect(await issueShown(ui)).toBe('#12')
  await $.prompt.submit({ text: 'Also create a follow-up like #13 and see #14' } as never)
  expect(await issueShown(ui)).toBe('#12')

  expect((await $.command.run({ command: 'issue', args: '42' } as never))?.text).toBe('Session issue: #42')
  expect(await issueShown(ui)).toBe('#42')
  expect((await $.command.run({ command: 'issue', args: 'nope' } as never))?.text).toContain('Usage')
  expect((await $.command.run({ command: 'issue', args: 'clear' } as never))?.text).toBe('Session issue cleared.')
  expect(await issueShown(ui)).toBeNull()
  await ui.unmount()
})

test('a branch issue is not replaced by a card mentioned later', async ($, on) => {
  mockProject(on, { files: {}, probe: [], branch: 'issue-7-fishing' })
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  expect(await issueShown(ui)).toBe('#7')
  await $.prompt.submit({ text: 'Open a new card #99' } as never)
  expect(await issueShown(ui)).toBe('#7')
  await ui.unmount()
})


test('VS Code opens from its install folder when code is not on PATH', async ($, on) => {
  const install = 'C:/Users/me/AppData/Local/Programs/Microsoft VS Code'
  const calls = mockProject(on, {
    files: {
      ...MONOREPO,
      [`${install}/bin/code.cmd`]: '"%~dp0..\\Code.exe" "%~dp0..\\abc123\\resources\\app\\out\\cli.js" %*',
    },
    probe: [],
    branch: 'main',
    isCodeMissing: true,
  })
  mock.env(on, { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })

  await $.command.run({ command: 'cockpit', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'vscode' })
  await ui.unmount()

  const program = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code'
  expect(calls.ran).toContainEqual([
    `${program}\\Code.exe`,
    `${program}\\abc123\\resources\\app\\out\\cli.js`,
    'C:\\work\\app',
  ])
})
