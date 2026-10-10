import type { AppLink, ConfiguredApp, DetectedApp, Issue, NodeProcess } from '../types'

export type { ConfiguredApp, DetectedApp }

export type ProbeRow = {
  pid: number
  ppid?: number
  name: string
  cmd: string
  cwd?: string | null
  mem: number
  ports: number[] | number | null
}



export type Classified = { processes: NodeProcess[]; helperCount: number; detected: DetectedApp[] }

export type PackageInfo = { scripts: Record<string, string>; isElectron: boolean }



export type ProjectConfig = { apps?: ConfiguredApp[]; startCommand?: string }

const PREFERRED_PORTS = [5173, 3000, 4200, 8080, 8000]
const DEBUG_PORTS = new Set([9229, 9230])
const START_SCRIPTS = ['dev', 'start', 'serve', 'watch']
const CONTAINER_DIRS = new Set(['apps', 'packages', 'services', 'projects', 'src', 'dist', 'bin', 'build', 'out', 'lib'])

const TOOLS: [RegExp, string][] = [
  [/electron-vite[^ ]*\s+dev\b/, 'Dev server (electron-vite)'],
  [/electron-vite/, 'electron-vite'],
  [/[\\/]next[\\/]|next(\.js)?["']?\s+(dev|start)\b/, 'Next.js'],
  [/[\\/]nuxi?[\\/]|nuxt/, 'Nuxt'],
  [/[\\/]astro[\\/]/, 'Astro'],
  [/[\\/]@remix-run[\\/]/, 'Remix'],
  [/[\\/]@angular[\\/]cli|[\\/]ng["']?\s+serve/, 'Angular'],
  [/react-scripts/, 'Create React App'],
  [/webpack-dev-server|webpack["']?\s+serve/, 'webpack dev server'],
  [/[\\/]parcel[\\/]/, 'Parcel'],
  [/[\\/]vitest[\\/]|vitest/, 'Vitest'],
  [/[\\/]vite[\\/]|vite\.js|[\\/]vite["']?\s/, 'Vite'],
  [/[\\/]@nestjs[\\/]cli|nest["']?\s+start/, 'NestJS'],
  [/nodemon/, 'nodemon'],
  [/[\\/]tsx[\\/]|tsx["']?\s+watch/, 'tsx'],
  [/ts-node/, 'ts-node'],
  [/jest/, 'Jest'],
  [/playwright/, 'Playwright'],
  [/[\\/]typescript[\\/]|\btsc\b/, 'Type check'],
  [/eslint/, 'ESLint'],
  [/storybook/, 'Storybook'],
]

export function toWindowsPath(path: string): string {
  return path.trim().replace(/\//g, '\\')
}

export function baseName(path: string): string {
  const parts = path.trim().split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function scriptOf(cmd: string): string | null {
  const args = cmd.match(/"[^"]*"|\S+/g) ?? []
  const script = args.slice(1).find(arg => !arg.startsWith('-'))
  return script === undefined ? null : baseName(script.replace(/"/g, ''))
}

export function appOf(cmd: string, root: string): string | null {
  const command = cmd.replace(/\//g, '\\')
  const start = command.toLowerCase().indexOf(`${root.toLowerCase().replace(/[\\/]+$/, '')}\\`)
  if (start === -1) return null
  const rest = command.slice(start + root.replace(/[\\/]+$/, '').length + 1).split(/["\s]/)[0] ?? ''
  const segments = rest.split('\\').filter(Boolean)
  const cut = segments.indexOf('node_modules')
  const dirs = (cut === -1 ? segments.slice(0, -1) : segments.slice(0, cut)).filter(
    dir => !CONTAINER_DIRS.has(dir.toLowerCase()) && !dir.startsWith('.'),
  )
  return dirs[dirs.length - 1] ?? null
}

export function roleOf(name: string, cmd: string): string | null {
  const command = cmd.toLowerCase()
  const exe = name.toLowerCase()
  if (exe === 'electron.exe') {
    const type = /--type=([\w-]+)/.exec(command)?.[1]
    if (type === undefined) return 'Electron main'
    if (type === 'renderer') return 'Renderer'
    if (type === 'utility' && command.includes('node.mojom.nodeservice')) return 'Electron utility'
    return null
  }
  if (
    /(^|[\\/"\s])(pnpm|npm|yarn|npx|bun)(\.cjs|\.js|-cli\.js)?["']?(\s|$)/.test(command) ||
    /[\\/](pnpm|npm|yarn)[\\/]bin[\\/]/.test(command)
  ) {
    return null
  }
  const tool = TOOLS.find(([pattern]) => pattern.test(command))
  if (tool !== undefined) return tool[1]
  const script = scriptOf(cmd)
  return script === null ? 'Node' : `Node · ${script}`
}

export function portsOf(row: ProbeRow): number[] {
  if (row.ports === null || row.ports === undefined) return []
  const list = Array.isArray(row.ports) ? row.ports : [row.ports]
  return [...new Set(list)].sort((a, b) => a - b)
}

export function parseProbe(stdout: string): ProbeRow[] {
  const text = stdout.trim()
  if (text === '') return []
  const parsed: unknown = JSON.parse(text)
  if (parsed === null) return []
  return (Array.isArray(parsed) ? parsed : [parsed]) as ProbeRow[]
}

function rank(port: number): number {
  const index = PREFERRED_PORTS.indexOf(port)
  return index === -1 ? PREFERRED_PORTS.length : index
}

export function detectedOf(processes: readonly NodeProcess[]): DetectedApp[] {
  const seen = new Map<number, DetectedApp>()
  for (const one of processes) {
    if (/electron/i.test(one.role)) continue
    for (const port of one.ports) {
      if (!DEBUG_PORTS.has(port) && !seen.has(port)) seen.set(port, { port, app: one.app, dir: one.dir })
    }
  }
  return [...seen.values()].sort((a, b) => rank(a.port) - rank(b.port) || a.port - b.port)
}

export function relativeDir(cwd: string | null | undefined, root: string): string | null {
  if (cwd === null || cwd === undefined || cwd.trim() === '') return null
  const path = normalizePath(cwd)
  const base = normalizePath(root)
  if (path === base) return '.'
  if (!path.startsWith(`${base}\\`)) return null
  const original = cwd.trim().replace(/\//g, '\\').replace(/\\+$/, '')
  return original.slice(base.length + 1).replace(/\\/g, '/')
}

function normalizePath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function isUnder(cmd: string, path: string): boolean {
  const command = cmd.replace(/\//g, '\\').toLowerCase()
  const target = normalizePath(path)
  if (target === '') return false
  let index = command.indexOf(target)
  while (index !== -1) {
    const after = command[index + target.length]
    if (after === undefined || after === '\\' || after === '"' || after === "'" || after === ' ') return true
    index = command.indexOf(target, index + 1)
  }
  return false
}

export function worktreesOf(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
}

export function isMainCheckout(worktrees: readonly string[], root: string): boolean {
  const main = worktrees[0]
  return main === undefined || normalizePath(main) === normalizePath(root)
}

export function processOfPort(processes: readonly NodeProcess[], port: number): NodeProcess | undefined {
  return processes.find(one => one.ports.includes(port))
}

export function describeProcess(owner: NodeProcess | undefined, url: string): string[] {
  if (owner === undefined) return [url]
  return [
    owner.role,
    ...(owner.dir === null ? [] : [owner.dir === '.' ? 'launched from ./' : `launched from ./${owner.dir}`]),
    `pid ${owner.pid} · ${owner.memoryMb} MB`,
    url,
  ]
}

export function nestedWorktrees(worktrees: readonly string[], root: string): string[] {
  const base = normalizePath(root)
  return worktrees.filter(path => normalizePath(path).startsWith(`${base}\\`))
}

export function selectWorktree(rows: readonly ProbeRow[], root: string, excluded: readonly string[]): ProbeRow[] {
  const isOwn = (row: ProbeRow) =>
    isUnder(row.cmd ?? '', root) && !excluded.some(path => isUnder(row.cmd ?? '', path))
  const isOther = (row: ProbeRow) => excluded.some(path => isUnder(row.cmd ?? '', path))
  const selected = new Set(rows.filter(isOwn).map(row => row.pid))
  let isGrowing = true
  while (isGrowing) {
    isGrowing = false
    for (const row of rows) {
      if (!selected.has(row.pid) && row.ppid !== undefined && selected.has(row.ppid) && !isOther(row)) {
        selected.add(row.pid)
        isGrowing = true
      }
    }
  }
  return rows.filter(row => selected.has(row.pid))
}

export function classify(rows: readonly ProbeRow[], root: string): Classified {
  const processes: NodeProcess[] = []
  let helperCount = 0
  for (const row of rows) {
    const role = roleOf(row.name, row.cmd ?? '')
    if (role === null) {
      helperCount += 1
      continue
    }
    const dir = relativeDir(row.cwd, root)
    processes.push({
      pid: row.pid,
      role,
      app: dir === null ? appOf(row.cmd ?? '', root) : dir === '.' ? null : baseName(dir),
      dir,
      memoryMb: Math.round(row.mem / 1048576),
      ports: portsOf(row),
    })
  }
  processes.sort((a, b) => a.role.localeCompare(b.role) || a.pid - b.pid)
  return { processes, helperCount, detected: detectedOf(processes) }
}

export function portOfUrl(url: string): number | null {
  const match = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?/i.exec(url)
  if (match === null) return null
  return match[1] === undefined ? (url.toLowerCase().startsWith('https') ? 443 : 80) : Number(match[1])
}

export function defaultAppName(dir: string | null, app: string | null, worktree: string): string {
  if (dir === '.') return worktree
  if (dir !== null) return baseName(dir)
  return app ?? 'app'
}

export function launchApps(
  configured: readonly ConfiguredApp[],
  detected: readonly DetectedApp[],
  labels: Readonly<Record<string, string>>,
  worktree: string,
): AppLink[] {
  const running = new Set(detected.map(one => one.port))
  const claimed = new Set<number | null>()
  const links: AppLink[] = configured.map(app => {
    const port = portOfUrl(app.url)
    claimed.add(port)
    return { dir: null, port, label: app.label ?? app.name, url: app.url, isRunning: port === null ? null : running.has(port) }
  })
  for (const one of detected.filter(item => !claimed.has(item.port))) {
    const name = (one.dir === null ? undefined : labels[one.dir]) ?? defaultAppName(one.dir, one.app, worktree)
    links.push({ dir: one.dir, port: one.port, label: `${name} (${one.port})`, url: `http://localhost:${one.port}`, isRunning: true })
  }
  return links
}

export type AppDir = { dir: string; ports: number[] }

export function appDirsOf(detected: readonly DetectedApp[], labels: Readonly<Record<string, string>>): AppDir[] {
  const dirs = new Map<string, number[]>()
  for (const one of detected) {
    if (one.dir !== null) dirs.set(one.dir, [...(dirs.get(one.dir) ?? []), one.port])
  }
  for (const dir of Object.keys(labels)) {
    if (!dirs.has(dir)) dirs.set(dir, [])
  }
  return [...dirs.entries()]
    .map(([dir, ports]) => ({ dir, ports: [...ports].sort((a, b) => a - b) }))
    .sort((a, b) => (a.dir === '.' ? -1 : 0) - (b.dir === '.' ? -1 : 0) || a.dir.localeCompare(b.dir))
}

export function labelsOf(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
    ),
  )
}

export function withLabel(labels: Readonly<Record<string, string>>, dir: string, label: string): Record<string, string> {
  const { [dir]: _, ...rest } = labels
  const trimmed = label.trim()
  return trimmed === '' ? rest : { ...rest, [dir]: trimmed }
}

export function labelsKey(repoRoot: string): string {
  return `labels:${repoRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`
}

export function parsePackage(text: string | null): PackageInfo | null {
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const objectOf = (value: unknown) => (typeof value === 'object' && value !== null ? value : {})
    const scripts = objectOf(parsed.scripts) as Record<string, string>
    const isElectron = 'electron' in objectOf(parsed.dependencies) || 'electron' in objectOf(parsed.devDependencies)
    return { scripts, isElectron }
  } catch {
    return { scripts: {}, isElectron: false }
  }
}

function appsOf(raw: unknown): ConfiguredApp[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const { name, url, label } = item as Record<string, unknown>
    if (typeof name !== 'string' || name === '' || typeof url !== 'string' || !/^https?:\/\//.test(url)) return []
    return [{ name, url, ...(typeof label === 'string' ? { label } : {}) }]
  })
}

export function parseConfig(text: string | null): ProjectConfig {
  if (text === null) return {}
  try {
    const parsed = JSON.parse(text) as { apps?: unknown; startCommand?: unknown }
    const apps = appsOf(parsed.apps)
    const startCommand = typeof parsed.startCommand === 'string' ? parsed.startCommand : undefined
    return { ...(apps.length > 0 ? { apps } : {}), ...(startCommand === undefined ? {} : { startCommand }) }
  } catch {
    return {}
  }
}

export function startCommandOf(pkg: PackageInfo | null, manager: string): string | null {
  if (pkg === null) return null
  const script = START_SCRIPTS.find(name => name in pkg.scripts)
  if (script === undefined) return null
  return manager === 'npm' && script !== 'start' ? `npm run ${script}` : `${manager} ${script}`
}

export function managerOf(files: readonly string[]): string {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm'
  if (files.includes('yarn.lock')) return 'yarn'
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun'
  return 'npm'
}

export function repoUrl(remote: string | null): string | null {
  if (remote === null) return null
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return match === null ? null : `https://github.com/${match[1]}/${match[2]}`
}

export function issueFromText(text: string): number | null {
  const match = /(?:github\.com\/[\w.-]+\/[\w.-]+\/issues\/|(?:^|[^\w&/])#)(\d{1,6})\b/.exec(text)
  return match === null ? null : Number(match[1])
}

export function issueFromBranch(branch: string | null): number | null {
  if (branch === null) return null
  const match = /(?:^|\/)(?:issues?[-_]?|gh[-_]?)?(\d{1,6})(?:[-_]|$)/i.exec(branch)
  return match === null ? null : Number(match[1])
}

export function vsCodeInstallDirs(localAppData: string | undefined, programFiles: string | undefined): string[] {
  return [
    ...(localAppData === undefined ? [] : [`${localAppData}\\Programs\\Microsoft VS Code`]),
    ...(programFiles === undefined ? [] : [`${programFiles}\\Microsoft VS Code`]),
  ]
}

export function vsCodeCliOf(launcher: string, installDir: string): string | null {
  const match = /%~dp0\.\.\\((?:[^"\\]+\\)*)resources\\app\\out\\cli\.js/i.exec(launcher)
  if (match === null) return null
  return `${installDir}\\${match[1] ?? ''}resources\\app\\out\\cli.js`
}

export function issueOf(raw: unknown): Issue | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { number, url, title, source } = raw as Record<string, unknown>
  if (typeof number !== 'number' || typeof url !== 'string' || !/^https:\/\//.test(url)) return null
  if (source !== 'command' && source !== 'prompt' && source !== 'branch') return null
  return { number, url, title: typeof title === 'string' ? title : null, source }
}

export function issueFromArgs(args: string): number | null | 'clear' {
  const text = args.trim()
  if (/^(clear|none|-)$/i.test(text)) return 'clear'
  const url = issueFromText(text)
  if (url !== null) return url
  const match = /^#?(\d{1,6})$/.exec(text)
  return match === null ? null : Number(match[1])
}
