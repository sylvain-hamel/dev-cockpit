import { describe, expect, test } from 'claude-code/testing'

import {
  appOf,
  baseName,
  classify,
  launchApps,
  portOfUrl,
  issueFromArgs,
  issueFromBranch,
  issueFromText,
  managerOf,
  parseConfig,
  parsePackage,
  parseProbe,
  repoUrl,
  roleOf,
  scriptOf,
  startCommandOf,
  toWindowsPath,
} from './lib'

describe('worktree paths', () => {
  test('converts git paths to Windows paths and names the worktree', async () => {
    expect(toWindowsPath('C:/Users/me/app\n')).toBe('C:\\Users\\me\\app')
    expect(baseName('C:\\Users\\me\\app-stable')).toBe('app-stable')
  })
})

describe('process roles', () => {
  test('tells the Electron processes apart and hides helpers', async () => {
    expect(roleOf('electron.exe', 'C:\\app\\node_modules\\electron\\dist\\electron.exe .')).toBe('Electron main')
    expect(roleOf('electron.exe', 'electron.exe --type=renderer')).toBe('Renderer')
    expect(roleOf('electron.exe', 'electron.exe --type=utility --utility-sub-type=node.mojom.NodeService')).toBe(
      'Electron utility',
    )
    expect(roleOf('electron.exe', 'electron.exe --type=gpu-process')).toBeNull()
  })

  test('names common Node tools', async () => {
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\electron-vite\\bin\\electron-vite.js dev')).toBe(
      'Dev server (electron-vite)',
    )
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\vite\\bin\\vite.js')).toBe('Vite')
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\next\\dist\\bin\\next dev')).toBe('Next.js')
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\@nestjs\\cli\\bin\\nest.js start --watch')).toBe('NestJS')
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\nodemon\\bin\\nodemon.js server.js')).toBe('nodemon')
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\vitest\\vitest.mjs run')).toBe('Vitest')
    expect(roleOf('node.exe', 'node C:\\app\\node_modules\\typescript\\bin\\tsc --noEmit')).toBe('Type check')
  })

  test('hides package manager launchers and names plain scripts', async () => {
    expect(roleOf('node.exe', '"C:\\nodejs\\node.exe" "C:\\pnpm\\bin\\pnpm.cjs" dev')).toBeNull()
    expect(roleOf('node.exe', 'node C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js run dev')).toBeNull()
    expect(roleOf('node.exe', '"C:\\nodejs\\node.exe" --inspect C:\\app\\server\\index.js')).toBe('Node · index.js')
    expect(roleOf('node.exe', 'node')).toBe('Node')
    expect(scriptOf('node')).toBeNull()
  })
})

describe('probe output', () => {
  test('reads empty, single and list outputs', async () => {
    expect(parseProbe('')).toEqual([])
    expect(parseProbe('null')).toEqual([])
    expect(parseProbe('{"pid":1,"name":"node.exe","cmd":"x","mem":0,"ports":[]}')).toHaveLength(1)
    expect(parseProbe('[{"pid":1},{"pid":2}]')).toHaveLength(2)
  })

  test('detects listening apps, preferred ports first, without debug or Electron ports', async () => {
    const result = classify(
      [
        { pid: 3, name: 'node.exe', cmd: 'node C:\\app\\apps\\api\\server.js', mem: 104857600, ports: [9229, 4000, 4000] },
        { pid: 5, name: 'node.exe', cmd: 'node C:\\app\\apps\\portal\\node_modules\\vite\\bin\\vite.js', mem: 0, ports: 5173 },
        { pid: 4, name: 'electron.exe', cmd: 'electron.exe --type=gpu-process', mem: 0, ports: null },
        { pid: 2, name: 'electron.exe', cmd: 'electron.exe .', mem: 0, ports: [7000] },
      ],
      'C:\\app',
    )
    expect(result.detected).toEqual([
      { port: 5173, app: 'portal' },
      { port: 4000, app: 'api' },
    ])
    expect(result.helperCount).toBe(1)
    expect(result.processes.map(one => one.role)).toEqual(['Electron main', 'Node · server.js', 'Vite'])
    expect(result.processes[1]?.ports).toEqual([4000, 9229])
    expect(result.processes[1]?.memoryMb).toBe(100)
    expect(classify([], 'C:\\app').detected).toEqual([])
  })
})

describe('apps to launch', () => {
  test('names an app from the folder it runs in', async () => {
    expect(appOf('node C:\\App\\apps\\backoffice\\node_modules\\vite\\bin\\vite.js', 'c:\\app')).toBe('backoffice')
    expect(appOf('node "C:/app/portal/server.js"', 'C:\\app\\')).toBe('portal')
    expect(appOf('node C:\\app\\node_modules\\vite\\bin\\vite.js', 'C:\\app')).toBeNull()
    expect(appOf('node C:\\elsewhere\\x.js', 'C:\\app')).toBeNull()
  })

  test('reads the port of a local URL', async () => {
    expect(portOfUrl('http://localhost:3001/admin')).toBe(3001)
    expect(portOfUrl('http://127.0.0.1')).toBe(80)
    expect(portOfUrl('https://localhost')).toBe(443)
    expect(portOfUrl('https://staging.example.com')).toBeNull()
  })

  test('lists configured apps first, with their state, then the other detected ones', async () => {
    const apps = launchApps(
      [
        { name: 'portal', url: 'http://localhost:3001', label: 'Ouvrir le portail' },
        { name: 'backoffice', url: 'http://localhost:3002' },
        { name: 'staging', url: 'https://staging.example.com' },
      ],
      [
        { port: 3001, app: 'web' },
        { port: 6006, app: 'storybook' },
      ],
    )
    expect(apps).toEqual([
      { name: 'portal', label: 'Ouvrir le portail', url: 'http://localhost:3001', isRunning: true },
      { name: 'backoffice', label: 'Open backoffice', url: 'http://localhost:3002', isRunning: false },
      { name: 'staging', label: 'Open staging', url: 'https://staging.example.com', isRunning: null },
      { name: 'storybook', label: 'Open storybook', url: 'http://localhost:6006', isRunning: true },
    ])
  })

  test('names detected apps without config', async () => {
    expect(launchApps([], [{ port: 5173, app: null }]).map(one => one.label)).toEqual(['Open app'])
    expect(
      launchApps(
        [],
        [
          { port: 5173, app: 'web' },
          { port: 5174, app: 'web' },
          { port: 3000, app: 'admin' },
        ],
      ).map(one => one.label),
    ).toEqual(['Open app :5173', 'Open app :5174', 'Open admin'])
  })
})

describe('project files', () => {
  test('reads package scripts and picks the start command', async () => {
    expect(parsePackage(null)).toBeNull()
    expect(parsePackage('not json')).toEqual({ scripts: {}, isElectron: false })
    expect(parsePackage('{"name":"x"}')).toEqual({ scripts: {}, isElectron: false })
    expect(parsePackage('{"devDependencies":{"electron":"44"}}')?.isElectron).toBe(true)
    expect(parsePackage('{"dependencies":{"electron":"44"}}')?.isElectron).toBe(true)
    const pkg = parsePackage('{"scripts":{"build":"x","dev":"vite"}}')
    expect(startCommandOf(pkg, 'pnpm')).toBe('pnpm dev')
    expect(startCommandOf(pkg, 'npm')).toBe('npm run dev')
    expect(startCommandOf({ scripts: { start: 'node .' }, isElectron: false }, 'npm')).toBe('npm start')
    expect(startCommandOf({ scripts: { build: 'x' }, isElectron: false }, 'npm')).toBeNull()
    expect(startCommandOf(null, 'npm')).toBeNull()
  })

  test('detects the package manager from lockfiles', async () => {
    expect(managerOf(['pnpm-lock.yaml'])).toBe('pnpm')
    expect(managerOf(['yarn.lock'])).toBe('yarn')
    expect(managerOf(['bun.lock'])).toBe('bun')
    expect(managerOf(['package-lock.json'])).toBe('npm')
  })

  test('reads the per-project config', async () => {
    expect(parseConfig(null)).toEqual({})
    expect(parseConfig('oops')).toEqual({})
    expect(parseConfig('{"apps":"nope"}')).toEqual({})
    expect(
      parseConfig(
        JSON.stringify({
          apps: [
            { name: 'portal', url: 'http://localhost:3001', label: 'Ouvrir le portail' },
            { name: 'ftp', url: 'ftp://x' },
            { url: 'http://localhost:1' },
            3,
            null,
          ],
          startCommand: 'docker compose up',
        }),
      ),
    ).toEqual({
      apps: [{ name: 'portal', url: 'http://localhost:3001', label: 'Ouvrir le portail' }],
      startCommand: 'docker compose up',
    })
  })
})

describe('GitHub issue', () => {
  test('builds the repository URL from the remote', async () => {
    expect(repoUrl('https://github.com/sylvain-hamel/my-mail.git')).toBe('https://github.com/sylvain-hamel/my-mail')
    expect(repoUrl('git@github.com:sylvain-hamel/my-mail.git')).toBe('https://github.com/sylvain-hamel/my-mail')
    expect(repoUrl('https://gitlab.com/a/b.git')).toBeNull()
    expect(repoUrl(null)).toBeNull()
  })

  test('finds an issue mentioned in a prompt', async () => {
    expect(issueFromText('work on #7 please')).toBe(7)
    expect(issueFromText('#12')).toBe(12)
    expect(issueFromText('see https://github.com/a/b/issues/42')).toBe(42)
    expect(issueFromText('colour &#39; and a#3')).toBeNull()
    expect(issueFromText('nothing here')).toBeNull()
  })

  test('finds an issue in a branch name', async () => {
    expect(issueFromBranch('issue-7-compose')).toBe(7)
    expect(issueFromBranch('feature/12-reading')).toBe(12)
    expect(issueFromBranch('claude/gh-5')).toBe(5)
    expect(issueFromBranch('main')).toBeNull()
    expect(issueFromBranch(null)).toBeNull()
  })

  test('reads the /issue argument', async () => {
    expect(issueFromArgs(' 7 ')).toBe(7)
    expect(issueFromArgs('#8')).toBe(8)
    expect(issueFromArgs('https://github.com/a/b/issues/9')).toBe(9)
    expect(issueFromArgs('clear')).toBe('clear')
    expect(issueFromArgs('abc')).toBeNull()
  })
})
