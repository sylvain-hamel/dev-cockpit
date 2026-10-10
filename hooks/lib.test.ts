import { describe, expect, test } from 'claude-code/testing'

import {
  appOf,
  appDirsOf,
  baseName,
  classify,
  defaultAppName,
  labelsKey,
  labelsOf,
  launchApps,
  relativeDir,
  withLabel,
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
  isUnder,
  isMainCheckout,
  describeProcess,
  processOfPort,
  issueOf,
  nestedWorktrees,
  selectWorktree,
  worktreesOf,
} from './lib'

describe('band details', () => {
  test('tells the main checkout from a linked worktree', async () => {
    expect(isMainCheckout(['C:/r', 'C:/r/.claude/worktrees/b'], 'C:\\r\\')).toBe(true)
    expect(isMainCheckout(['C:/r', 'C:/r/.claude/worktrees/b'], 'C:/r/.claude/worktrees/b')).toBe(false)
    expect(isMainCheckout([], 'C:/anything')).toBe(true)
  })

  test('describes the process behind a port for its tooltip', async () => {
    const vite = { pid: 10, role: 'Vite', app: 'portal', dir: 'apps/portal', memoryMb: 80, ports: [5173] }
    const node = { pid: 11, role: 'Node · server.js', app: null, dir: '.', memoryMb: 40, ports: [4000] }
    const unknown = { pid: 12, role: 'Node', app: null, dir: null, memoryMb: 1, ports: [1] }
    expect(processOfPort([vite, node], 4000)).toBe(node)
    expect(processOfPort([vite], 1)).toBeUndefined()
    expect(describeProcess(vite, 'http://localhost:5173')).toEqual([
      'Vite',
      'launched from ./apps/portal',
      'pid 10 · 80 MB',
      'http://localhost:5173',
    ])
    expect(describeProcess(node, 'u')[1]).toBe('launched from ./')
    expect(describeProcess(unknown, 'u')).toEqual(['Node', 'pid 12 · 1 MB', 'u'])
    expect(describeProcess(undefined, 'http://localhost:8080')).toEqual(['http://localhost:8080'])
  })

  test('reads a stored issue back', async () => {
    const stored = { number: 6, url: 'https://github.com/a/b/issues/6', title: 'T', source: 'prompt' }
    expect(issueOf(stored)).toEqual(stored)
    expect(issueOf({ ...stored, title: 3 })).toEqual({ ...stored, title: null })
    expect(issueOf({ ...stored, url: 'javascript:x' })).toBeNull()
    expect(issueOf({ ...stored, source: 'x' })).toBeNull()
    expect(issueOf({ ...stored, number: '6' })).toBeNull()
    expect(issueOf(null)).toBeNull()
  })
})

describe('worktree scope', () => {
  test('matches a path only as a whole folder', async () => {
    expect(isUnder('node C:\\Work\\App\\x.js', 'c:/work/app')).toBe(true)
    expect(isUnder('node "C:/work/app"', 'C:\\work\\app\\')).toBe(true)
    expect(isUnder('electron.exe C:\\work\\app .', 'C:\\work\\app')).toBe(true)
    expect(isUnder('node C:\\work\\app-stable\\x.js', 'C:\\work\\app')).toBe(false)
    expect(isUnder('node C:\\work\\app-stable\\x.js C:\\work\\app\\y.js', 'C:\\work\\app')).toBe(true)
    expect(isUnder('node x.js', '')).toBe(false)
  })

  test('finds the other worktrees nested in this one', async () => {
    const all = worktreesOf('worktree C:/r\nHEAD a\n\nworktree C:/r/.claude/worktrees/b\r\nbranch x\n\nworktree C:/r-stable\n')
    expect(all).toEqual(['C:/r', 'C:/r/.claude/worktrees/b', 'C:/r-stable'])
    expect(nestedWorktrees(all, 'C:/r')).toEqual(['C:/r/.claude/worktrees/b'])
    expect(nestedWorktrees(all, 'C:/r/.claude/worktrees/b')).toEqual([])
  })

  test('keeps the processes of this worktree and their children only', async () => {
    const row = (pid: number, ppid: number, cmd: string) => ({ pid, ppid, name: 'node.exe', cmd, mem: 0, ports: [] })
    const rows = [
      row(1, 0, 'node C:\\r\\vite.js'),
      row(2, 1, 'node esbuild --service'),
      row(3, 2, 'node deeper'),
      row(4, 0, 'node C:\\r\\.claude\\worktrees\\b\\vite.js'),
      row(5, 4, 'node child-of-b'),
      row(6, 1, 'node C:\\r\\.claude\\worktrees\\b\\spawned.js'),
      row(7, 0, 'node C:\\r-stable\\vite.js'),
      { pid: 8, name: 'node.exe', cmd: 'node unrelated', mem: 0, ports: [] },
    ]
    expect(selectWorktree(rows, 'C:/r', ['C:/r/.claude/worktrees/b']).map(one => one.pid)).toEqual([1, 2, 3])
    expect(selectWorktree(rows, 'C:/r/.claude/worktrees/b', []).map(one => one.pid)).toEqual([4, 5, 6])
  })
})

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
        {
          pid: 5,
          name: 'node.exe',
          cmd: 'node C:\\app\\node_modules\\vite\\bin\\vite.js',
          cwd: 'C:\\App\\apps\\Portal\\',
          mem: 0,
          ports: 5173,
        },
        { pid: 6, name: 'node.exe', cmd: 'node C:\\app\\server.js', cwd: 'C:\\app\\', mem: 0, ports: [8080] },
        { pid: 4, name: 'electron.exe', cmd: 'electron.exe --type=gpu-process', mem: 0, ports: null },
        { pid: 2, name: 'electron.exe', cmd: 'electron.exe .', mem: 0, ports: [7000] },
      ],
      'C:\\app',
    )
    expect(result.detected).toEqual([
      { port: 5173, app: 'Portal', dir: 'apps/Portal' },
      { port: 8080, app: null, dir: '.' },
      { port: 4000, app: 'api', dir: null },
    ])
    expect(result.helperCount).toBe(1)
    expect(result.processes.map(one => one.role)).toEqual(['Electron main', 'Node · server.js', 'Node · server.js', 'Vite'])
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

  test('reads the launch folder relative to the worktree', async () => {
    expect(relativeDir('C:\\App\\', 'c:/app')).toBe('.')
    expect(relativeDir('C:\\app\\apps\\Portal\\', 'C:/app')).toBe('apps/Portal')
    expect(relativeDir('C:\\app-stable\\x', 'C:/app')).toBeNull()
    expect(relativeDir(null, 'C:/app')).toBeNull()
    expect(relativeDir('  ', 'C:/app')).toBeNull()
  })

  test('names an app by its folder and port until it gets a label', async () => {
    const detected = [
      { port: 5120, app: 'something', dir: 'apps/something' },
      { port: 5121, app: 'somethingElse', dir: 'apps/somethingElse' },
      { port: 8080, app: null, dir: '.' },
      { port: 9000, app: 'api', dir: null },
      { port: 9001, app: null, dir: null },
    ]
    expect(launchApps([], detected, {}, 'fish1').map(one => one.label)).toEqual([
      'something (5120)',
      'somethingElse (5121)',
      'fish1 (8080)',
      'api (9000)',
      'app (9001)',
    ])
    const labels = { 'apps/something': 'App', 'apps/somethingElse': 'Portail' }
    expect(launchApps([], detected.slice(0, 2), labels, 'fish1')).toEqual([
      { dir: 'apps/something', port: 5120, label: 'App (5120)', url: 'http://localhost:5120', isRunning: true },
      { dir: 'apps/somethingElse', port: 5121, label: 'Portail (5121)', url: 'http://localhost:5121', isRunning: true },
    ])
  })

  test('tells apart two servers launched from one labelled folder', async () => {
    const detected = [
      { port: 5173, app: null, dir: '.' },
      { port: 5175, app: null, dir: '.' },
    ]
    expect(launchApps([], detected, { '.': 'App' }, 'fish1').map(one => one.label)).toEqual(['App (5173)', 'App (5175)'])
  })

  test('lists configured URLs first, with their state', async () => {
    const apps = launchApps(
      [
        { name: 'docs', url: 'http://localhost:3001', label: 'Docs' },
        { name: 'staging', url: 'https://staging.example.com' },
      ],
      [
        { port: 3001, app: 'web', dir: 'web' },
        { port: 6006, app: 'storybook', dir: 'storybook' },
      ],
      {},
      'repo',
    )
    expect(apps).toEqual([
      { dir: null, port: 3001, label: 'Docs', url: 'http://localhost:3001', isRunning: true },
      { dir: null, port: null, label: 'staging', url: 'https://staging.example.com', isRunning: null },
      { dir: 'storybook', port: 6006, label: 'storybook (6006)', url: 'http://localhost:6006', isRunning: true },
    ])
  })

  test('keeps labels per folder and lists the folders to name', async () => {
    expect(labelsKey('C:\\Users\\Me\\Repo\\')).toBe('labels:c:/users/me/repo')
    expect(labelsOf({ a: 'App', b: '  ', c: 3 })).toEqual({ a: 'App' })
    expect(labelsOf(['x'])).toEqual({})
    expect(labelsOf(null)).toEqual({})
    expect(withLabel({ a: 'App' }, 'b', '  Portail ')).toEqual({ a: 'App', b: 'Portail' })
    expect(withLabel({ a: 'App', b: 'Portail' }, 'a', '')).toEqual({ b: 'Portail' })
    expect(
      appDirsOf(
        [
          { port: 5121, app: 'x', dir: 'apps/x' },
          { port: 5120, app: 'x', dir: 'apps/x' },
          { port: 8080, app: null, dir: '.' },
          { port: 9000, app: null, dir: null },
        ],
        { 'apps/old': 'Old', 'apps/x': 'X' },
      ),
    ).toEqual([
      { dir: '.', ports: [8080] },
      { dir: 'apps/old', ports: [] },
      { dir: 'apps/x', ports: [5120, 5121] },
    ])
    expect(defaultAppName('apps/x', null, 'w')).toBe('x')
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
            { name: 'backoffice' },
            { name: '' },
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
    expect(parseConfig('{"taskModes":{"dev":"inline"}}')).toEqual({})
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
