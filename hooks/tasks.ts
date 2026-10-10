import type { Script } from '../types'

export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  'tmp',
  'temp',
  'test-results',
  'playwright-report',
])

const SAFE_SCRIPT_NAME = /^[\w:.@/+-]+$/

export function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name.toLowerCase())
}

export function taskId(dir: string, name: string): string {
  return `${dir}#${name}`
}

export function scriptsOf(dir: string, text: string): Script[] {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    return []
  }
  const scripts = typeof parsed.scripts === 'object' && parsed.scripts !== null ? parsed.scripts : {}
  const packageName = typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : dir === '.' ? 'root' : dir
  return Object.entries(scripts as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && SAFE_SCRIPT_NAME.test(entry[0]))
    .map(([name, command]) => ({ id: taskId(dir, name), dir, packageName, name, command }))
}

export function sortScripts(scripts: readonly Script[]): Script[] {
  return [...scripts].sort(
    (a, b) =>
      (a.dir === '.' ? -1 : 0) - (b.dir === '.' ? -1 : 0) || a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name),
  )
}

export function terminalArgv(title: string, dir: string, manager: string, script: string): string[] {
  return ['wt.exe', '-w', '0', 'new-tab', '--title', title, '-d', dir, 'cmd.exe', '/k', manager, 'run', script]
}

export function fallbackTerminalArgv(dir: string, manager: string, script: string): string[] {
  return ['cmd.exe', '/d', '/c', 'start', '', '/D', dir, 'cmd.exe', '/k', manager, 'run', script]
}

export function titleOf(script: Script): string {
  const base = script.dir === '.' ? script.name : `${baseOf(script.dir)}:${script.name}`
  return base.replace(/[^\w:.-]/g, '-')
}

function baseOf(dir: string): string {
  const parts = dir.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

export function favoritesKey(repoRoot: string): string {
  return `favorites:${repoRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`
}

export function favoritesOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string') : []
}

export function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter(one => one !== id) : [...list, id]
}

export function groupByPackage(scripts: readonly Script[]): Script[][] {
  return scripts.reduce<Script[][]>((groups, script) => {
    const last = groups[groups.length - 1]
    if (last !== undefined && last[0]?.dir === script.dir) last.push(script)
    else groups.push([script])
    return groups
  }, [])
}
