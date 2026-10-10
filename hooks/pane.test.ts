import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'dev-cockpit',
  props: { title: 'Dev cockpit', isFocused: false, bodyColumns: 80, placement: 'dock' },
} as const

const SURFACES = ['terminal', 'desktop'] as const

function ok(stdout: string) {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function entry(name: string) {
  return { name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }
}

type Project = { files: Record<string, string>; probe: unknown[]; branch: string }

function fileAt(project: Project, path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/')
  return Object.keys(project.files).find(name => normalized.endsWith(`/${name}`))
}

function mockProject(on: On, project: Project, ran: string[][]) {
  on('session.cwd', () => ({ value: 'C:/work/app' }))
  on('session.repo', () => ({
    value: { root: 'C:/work/app', remote: 'https://github.com/sylvain-hamel/app.git', internal: false, name: 'app' },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.list', () => ({ value: Object.keys(project.files).map(entry) }))
  on('fs.exists', ($, e) => ({ value: fileAt(project, e.path) !== undefined }))
  on('fs.read', ($, e) => {
    const name = fileAt(project, e.path)
    return name === undefined ? { deny: 'missing' } : { value: project.files[name] as string }
  })
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const [command, ...args] = e.argv
    if (command === 'git' && args[1] === '--show-toplevel') return ok('C:/work/app\n')
    if (command === 'git' && args[1] === '--abbrev-ref') return ok(`${project.branch}\n`)
    if (command === 'powershell.exe') return ok(JSON.stringify(project.probe))
    if (command === 'gh') return ok('Actions on messages\n')
    return ok('')
  })
}

test('a running Node project shows its app, processes and issue', async ($, on) => {
  const ran: string[][] = []
  mockProject(
    on,
    {
      files: { 'package.json': '{"scripts":{"dev":"vite"}}', 'pnpm-lock.yaml': '' },
      probe: [
        { pid: 10, name: 'node.exe', cmd: 'node C:\\work\\app\\node_modules\\vite\\bin\\vite.js', mem: 52428800, ports: [5173] },
        { pid: 12, name: 'node.exe', cmd: 'node C:\\pnpm\\bin\\pnpm.cjs dev', mem: 0, ports: [] },
      ],
      branch: 'issue-6-actions',
    },
    ran,
  )

  await $.command.run({ command: 'cockpit', args: '' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: /issue-6-actions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Launch app/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Vite/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 helper/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Actions on messages/ })).toBeDefined()
    await ui.press({ key: 'launch-app' })
    await ui.press({ key: 'vscode' })
    await ui.unmount()
  }

  expect(ran).toContainEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'http://localhost:5173'])
  expect(ran).toContainEqual(['cmd.exe', '/d', '/c', 'code', 'C:\\work\\app'])
})

test('a project with several frontends shows one launch button per app', async ($, on) => {
  const ran: string[][] = []
  const config = {
    apps: [
      { name: 'portal', url: 'http://localhost:3001', label: 'Ouvrir le portail' },
      { name: 'backoffice', url: 'http://localhost:3002', label: 'Lancer le backoffice' },
    ],
  }
  mockProject(
    on,
    {
      files: { 'package.json': '{"scripts":{"dev":"turbo dev"}}', '.claude/dev-cockpit.json': JSON.stringify(config) },
      probe: [{ pid: 20, name: 'node.exe', cmd: 'node C:\\work\\app\\apps\\portal\\node_modules\\next\\dist\\bin\\next dev', mem: 0, ports: [3001] }],
      branch: 'main',
    },
    ran,
  )

  await $.command.run({ command: 'cockpit', args: '' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Button', key: 'launch-portal' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'launch-backoffice' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3002 \(not running\)/ })).toBeDefined()
    await ui.press({ key: 'launch-backoffice' })
    await ui.unmount()
  }

  expect(ran).toContainEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'http://localhost:3002'])
})

test('a stopped Node project says how to start it', async ($, on) => {
  mockProject(on, { files: { 'package.json': '{"scripts":{"dev":"vite"}}', 'yarn.lock': '' }, probe: [], branch: 'main' }, [])

  await $.command.run({ command: 'cockpit', args: '' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: /Start it with yarn dev/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /None for this worktree/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an Electron project shows its processes but no app to launch', async ($, on) => {
  mockProject(
    on,
    {
      files: { 'package.json': '{"scripts":{"dev":"electron-vite dev"},"devDependencies":{"electron":"44"}}' },
      probe: [
        { pid: 30, name: 'node.exe', cmd: 'node C:\\work\\app\\node_modules\\electron-vite\\bin\\electron-vite.js dev', mem: 0, ports: [5173] },
        { pid: 31, name: 'electron.exe', cmd: 'C:\\work\\app\\node_modules\\electron\\dist\\electron.exe .', mem: 0, ports: [] },
      ],
      branch: 'main',
    },
    [],
  )

  await $.command.run({ command: 'cockpit', args: '' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: /Launch app/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Electron main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /electron-vite/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a project without Node hides the launch and process sections', async ($, on) => {
  mockProject(on, { files: { 'README.md': '# docs' }, probe: [], branch: 'main' }, [])

  await $.command.run({ command: 'cockpit', args: '' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: /Worktree/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Launch app/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Node processes/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a configured app shows even for a project without Node', async ($, on) => {
  const config = { apps: [{ name: 'site', url: 'http://localhost:8080' }] }
  mockProject(on, { files: { '.claude/dev-cockpit.json': JSON.stringify(config) }, probe: [], branch: 'main' }, [])

  await $.command.run({ command: 'cockpit', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'dev-cockpit', surface: 'terminal', ...PANE } as never)
  expect(await ui.find({ type: 'Text', text: /Launch app/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'launch-site' })).toBeDefined()
  await ui.unmount()
})

test('sets and clears the issue by command', async ($, on) => {
  mockProject(on, { files: {}, probe: [], branch: 'main' }, [])

  expect((await $.command.run({ command: 'issue', args: '42' } as never))?.text).toBe('Session issue: #42')
  expect((await $.command.run({ command: 'issue', args: 'nope' } as never))?.text).toContain('Usage')
  expect((await $.command.run({ command: 'issue', args: 'clear' } as never))?.text).toBe('Session issue cleared.')
})
