import type { AppLink, NodeProcess } from '../types'

export type ProbeRow = {
  pid: number
  name: string
  cmd: string
  mem: number
  ports: number[] | number | null
}

export type DetectedApp = { port: number; app: string | null }

export type Classified = { processes: NodeProcess[]; helperCount: number; detected: DetectedApp[] }

export type PackageInfo = { scripts: Record<string, string>; isElectron: boolean }

export type ConfiguredApp = { name: string; url: string; label?: string }

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
  const seen = new Map<number, string | null>()
  for (const one of processes) {
    if (/electron/i.test(one.role)) continue
    for (const port of one.ports) {
      if (!DEBUG_PORTS.has(port) && !seen.has(port)) seen.set(port, one.app)
    }
  }
  return [...seen.entries()]
    .map(([port, app]) => ({ port, app }))
    .sort((a, b) => rank(a.port) - rank(b.port) || a.port - b.port)
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
    processes.push({
      pid: row.pid,
      role,
      app: appOf(row.cmd ?? '', root),
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

export function launchApps(configured: readonly ConfiguredApp[], detected: readonly DetectedApp[]): AppLink[] {
  const running = new Set(detected.map(one => one.port))
  const links: AppLink[] = configured.map(app => {
    const port = portOfUrl(app.url)
    return {
      name: app.name,
      label: app.label ?? `Open ${app.name}`,
      url: app.url,
      isRunning: port === null ? null : running.has(port),
    }
  })
  const claimed = new Set(configured.map(app => portOfUrl(app.url)))
  const rest = detected.filter(one => !claimed.has(one.port))
  const names = rest.map(one => one.app)
  for (const one of rest) {
    const isUnique = one.app !== null && names.filter(name => name === one.app).length === 1
    const name = isUnique ? (one.app as string) : rest.length === 1 && configured.length === 0 ? 'app' : `app :${one.port}`
    links.push({ name, label: `Open ${name}`, url: `http://localhost:${one.port}`, isRunning: true })
  }
  return links
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
    if (typeof name !== 'string' || typeof url !== 'string' || !/^https?:\/\//.test(url)) return []
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

export function issueFromArgs(args: string): number | null | 'clear' {
  const text = args.trim()
  if (/^(clear|none|-)$/i.test(text)) return 'clear'
  const url = issueFromText(text)
  if (url !== null) return url
  const match = /^#?(\d{1,6})$/.exec(text)
  return match === null ? null : Number(match[1])
}
