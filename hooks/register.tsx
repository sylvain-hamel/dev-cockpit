import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { AppLink, Issue, Script, Snapshot, TaskCatalog } from '../types'
import type { AppDir } from './lib'
import {
  appDirsOf,
  baseName,
  classify,
  describeProcess,
  issueFromArgs,
  issueOf,
  processOfPort,
  issueFromBranch,
  issueFromText,
  isMainCheckout,
  labelsKey,
  labelsOf,
  launchApps,
  withLabel,
  defaultAppName,
  managerOf,
  nestedWorktrees,
  parseConfig,
  parsePackage,
  parseProbe,
  repoUrl,
  selectWorktree,
  startCommandOf,
  toWindowsPath,
  worktreesOf,
} from './lib'
import {
  fallbackTerminalArgv,
  favoritesKey,
  favoritesOf,
  groupByPackage,
  isIgnoredDir,
  scriptsOf,
  sortScripts,
  terminalArgv,
  titleOf,
  toggle,
} from './tasks'

const LEGACY_PANE = 'dev-cockpit'
const SETTINGS = 'dev-cockpit-settings'
const LEGACY_DIALOG = 'dev-cockpit-tasks'
const POLL_MS = 10000
const CONFIG_FILE = '.claude/dev-cockpit.json'
const MAX_DEPTH = 3
const MAX_DIRS = 300
const ITEM_GAP = 1
const SECTION_GAP = 1

const snapshot = atom({ plugin: 'dev-cockpit', key: 'snapshot' } as const, null)
const issue = atom({ plugin: 'dev-cockpit', key: 'issue' } as const, null)
const catalog = atom({ plugin: 'dev-cockpit', key: 'catalog' } as const, null)
const favorites = atom({ plugin: 'dev-cockpit', key: 'favorites' } as const, [])
const labels = atom({ plugin: 'dev-cockpit', key: 'labels' } as const, {})

const CWD_READER = String.raw`using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DevCockpitCwd {
  [StructLayout(LayoutKind.Sequential)]
  struct Basic { public IntPtr A; public IntPtr Peb; public IntPtr B; public IntPtr C; public IntPtr Pid; public IntPtr D; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, ref Basic i, int l, out int r);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static byte[] Read(IntPtr h, IntPtr at, int size) { var b = new byte[size]; IntPtr r; return ReadProcessMemory(h, at, b, size, out r) ? b : null; }
  public static string Get(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      var i = new Basic(); int r;
      if (NtQueryInformationProcess(h, 0, ref i, Marshal.SizeOf(i), out r) != 0) return null;
      var p = Read(h, IntPtr.Add(i.Peb, 0x20), 8); if (p == null) return null;
      var parameters = new IntPtr(BitConverter.ToInt64(p, 0));
      var l = Read(h, IntPtr.Add(parameters, 0x38), 2); if (l == null) return null;
      var bp = Read(h, IntPtr.Add(parameters, 0x40), 8); if (bp == null) return null;
      var s = Read(h, new IntPtr(BitConverter.ToInt64(bp, 0)), BitConverter.ToUInt16(l, 0)); if (s == null) return null;
      return Encoding.Unicode.GetString(s);
    } finally { CloseHandle(h); }
  }
}`

const PROBE = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$dll = Join-Path $env:TEMP 'dev-cockpit-cwd-1.dll'
if (-not (Test-Path $dll)) { Add-Type -TypeDefinition $env:DEV_COCKPIT_CWD_READER -OutputAssembly $dll }
Add-Type -Path $dll
$all = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='electron.exe' OR Name='bun.exe' OR Name='deno.exe'")
$listening = @{}
foreach ($c in @(Get-NetTCPConnection -State Listen)) { $k = [int]$c.OwningProcess; if (-not $listening.ContainsKey($k)) { $listening[$k] = @() }; $listening[$k] += [int]$c.LocalPort }
$rows = foreach ($p in $all) {
  $ports = @(); $cwd = $null
  if ($listening.ContainsKey([int]$p.ProcessId)) { $ports = @($listening[[int]$p.ProcessId]); $cwd = [DevCockpitCwd]::Get([int]$p.ProcessId) }
  [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = $p.Name; cmd = [string]$p.CommandLine; cwd = $cwd; mem = [double]$p.WorkingSetSize; ports = $ports }
}
ConvertTo-Json -InputObject @($rows) -Compress -Depth 3`

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', ...args], { cwd })
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null
  } catch {
    return null
  }
}

async function listNames($: EngineInterface, path: string): Promise<string[]> {
  try {
    return (await $.fs.list(path)).map(entry => entry.name)
  } catch {
    return []
  }
}

async function worktreeTop($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  return (await git($, cwd, ['rev-parse', '--show-toplevel'])) ?? cwd
}

function absoluteDir(root: string, dir: string): string {
  return dir === '.' ? root : `${root}/${dir}`
}

async function probeProcesses($: EngineInterface, top: string, path: string, worktrees: readonly string[]) {
  try {
    const excluded = nestedWorktrees(worktrees, top)
    const ran = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', PROBE], {
      env: { DEV_COCKPIT_CWD_READER: CWD_READER },
      timeoutMs: 20000,
    })
    if (ran.exitCode !== 0) {
      return { processes: [], helperCount: 0, detected: [], error: ran.stderr.trim() || 'Process probe failed' }
    }
    return { ...classify(selectWorktree(parseProbe(ran.stdout), path, excluded), path), error: null }
  } catch (error) {
    return { processes: [], helperCount: 0, detected: [], error: String(error) }
  }
}

async function probe($: EngineInterface): Promise<Snapshot> {
  const top = await worktreeTop($)
  const path = toWindowsPath(top)
  const ref = await git($, top, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const sha = ref === 'HEAD' ? await git($, top, ['rev-parse', '--short', 'HEAD']) : null
  const branch = ref === null ? null : ref === 'HEAD' ? `detached at ${sha ?? '?'}` : ref
  const files = await listNames($, top)
  const pkg = files.includes('package.json') ? parsePackage(await readText($, `${top}/package.json`)) : null
  const config = parseConfig(await readText($, `${top}/${CONFIG_FILE}`))
  const worktrees = worktreesOf((await git($, top, ['worktree', 'list', '--porcelain'])) ?? '')
  const { detected, ...found } = await probeProcesses($, top, path, worktrees)
  return {
    worktree: baseName(path),
    isMainCheckout: isMainCheckout(worktrees, top),
    path,
    branch,
    isNodeProject: pkg !== null,
    isDesktopApp: pkg?.isElectron ?? false,
    startCommand: config.startCommand ?? startCommandOf(pkg, managerOf(files)),
    ...found,
    detected,
    configuredApps: config.apps ?? [],
  }
}

async function findPackageDirs(
  $: EngineInterface,
  root: string,
  dir: string,
  depth: number,
  found: string[],
  budget: { dirs: number },
): Promise<void> {
  if (budget.dirs <= 0) return
  budget.dirs -= 1
  let entries: { name: string; kind: string }[]
  try {
    entries = await $.fs.list(absoluteDir(root, dir))
  } catch {
    return
  }
  if (entries.some(entry => entry.kind === 'file' && entry.name === 'package.json')) found.push(dir)
  if (depth >= MAX_DEPTH) return
  for (const entry of entries) {
    if (entry.kind === 'dir' && !isIgnoredDir(entry.name)) {
      await findPackageDirs($, root, dir === '.' ? entry.name : `${dir}/${entry.name}`, depth + 1, found, budget)
    }
  }
}

async function loadTasks($: EngineInterface): Promise<void> {
  const root = await worktreeTop($)
  const dirs: string[] = []
  await findPackageDirs($, root, '.', 0, dirs, { dirs: MAX_DIRS })
  const scripts: Script[] = []
  for (const dir of dirs) {
    const text = await readText($, `${absoluteDir(root, dir)}/package.json`)
    if (text !== null) scripts.push(...scriptsOf(dir, text))
  }
  if (scripts.length === 0) {
    await update($, catalog, () => null)
    return
  }
  const repoRoot = (await $.session.repo())?.root ?? root
  const next: TaskCatalog = {
    root,
    manager: managerOf(await listNames($, root)),
    favoritesKey: favoritesKey(repoRoot),
    scripts: sortScripts(scripts),
  }
  await update($, catalog, () => next)
  const stored = favoritesOf(await $.store.get(next.favoritesKey))
  await update($, favorites, () => stored)
}

async function repoLabelsKey($: EngineInterface): Promise<string> {
  return labelsKey((await $.session.repo())?.root ?? (await worktreeTop($)))
}

async function loadLabels($: EngineInterface): Promise<void> {
  const stored = labelsOf(await $.store.get(await repoLabelsKey($)))
  await update($, labels, () => stored)
}

async function saveLabel($: EngineInterface, dir: string, label: string): Promise<void> {
  await update($, labels, current => withLabel(current, dir, label))
  await $.store.set(await repoLabelsKey($), await read($, labels))
}

async function runTask($: EngineInterface, id: string): Promise<void> {
  const tasks = await read($, catalog)
  const script = tasks?.scripts.find(one => one.id === id)
  if (tasks === null || script === undefined) return
  const dir = toWindowsPath(absoluteDir(tasks.root, script.dir))
  let isLaunched = false
  try {
    isLaunched = (await $.process.run(terminalArgv(titleOf(script), dir, tasks.manager, script.name))).exitCode === 0
  } catch {
    isLaunched = false
  }
  if (!isLaunched) {
    try {
      isLaunched = (await $.process.run(fallbackTerminalArgv(dir, tasks.manager, script.name))).exitCode === 0
    } catch {
      isLaunched = false
    }
  }
  if (!isLaunched) $.ui.toast(`Could not open a terminal for ${titleOf(script)}`)
}

async function toggleFavorite($: EngineInterface, id: string): Promise<void> {
  const tasks = await read($, catalog)
  if (tasks === null) return
  await update($, favorites, list => toggle(list, id))
  await $.store.set(tasks.favoritesKey, await read($, favorites))
}

async function openSettings($: EngineInterface): Promise<void> {
  const tasks = await read($, catalog)
  const apps = appDirsOf((await read($, snapshot))?.detected ?? [], await read($, labels))
  const taskRows = tasks === null ? 2 : tasks.scripts.length + groupByPackage(tasks.scripts).length * 2 + 1
  const rows = Math.min(taskRows + apps.length + 6, 34)
  await $.ui.open({ id: SETTINGS, title: 'Settings', focus: true, closeOnEscape: true, holdToasts: true, rows })
}

async function closeSettings($: EngineInterface): Promise<void> {
  await $.ui.close({ id: SETTINGS })
}

async function issueTitle($: EngineInterface, number: number): Promise<string | null> {
  try {
    const ran = await $.process.run(['gh', 'issue', 'view', String(number), '--json', 'title', '-q', '.title'], {
      timeoutMs: 15000,
    })
    return ran.exitCode === 0 && ran.stdout.trim() !== '' ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function issueKey($: EngineInterface): Promise<string> {
  return `issue:${await $.session.id()}`
}

async function setIssue($: EngineInterface, number: number, source: Issue['source']): Promise<Issue | null> {
  const repo = repoUrl((await $.session.repo())?.remote ?? null)
  if (repo === null) return null
  const next: Issue = { number, url: `${repo}/issues/${number}`, title: null, source }
  await update($, issue, () => next)
  await $.store.set(await issueKey($), next)
  const title = await issueTitle($, number)
  if (title !== null) {
    await update($, issue, current => (current?.number === number ? { ...current, title } : current))
  }
  return next
}

async function clearIssue($: EngineInterface): Promise<void> {
  await update($, issue, () => null)
  await $.store.delete(await issueKey($))
}

async function restoreIssue($: EngineInterface): Promise<void> {
  if ((await read($, issue)) !== null) return
  const stored = issueOf(await $.store.get(await issueKey($)))
  if (stored !== null) {
    await update($, issue, () => stored)
    return
  }
  const first = (await $.session.messages()).find(one => one.role === 'user' && issueFromText(one.text) !== null)
  if (first !== undefined) await setIssue($, issueFromText(first.text) as number, 'prompt')
}

async function openExternal($: EngineInterface, target: string): Promise<void> {
  await $.process.run(['rundll32.exe', 'url.dll,FileProtocolHandler', target])
}

async function openInVsCode($: EngineInterface, path: string): Promise<void> {
  const ran = await $.process.run(['cmd.exe', '/d', '/c', 'code', path])
  if (ran.exitCode !== 0) $.ui.toast('Could not start VS Code (is `code` on PATH?)')
}

let isProbing = false

async function refresh($: EngineInterface): Promise<void> {
  if (isProbing) return
  isProbing = true
  try {
    const next = await probe($)
    await update($, snapshot, () => next)
    if ((await read($, issue)) === null) {
      const fromBranch = issueFromBranch(next.branch)
      if (fromBranch !== null) await setIssue($, fromBranch, 'branch')
    }
  } finally {
    isProbing = false
  }
}

async function refreshAll($: EngineInterface): Promise<void> {
  await Promise.all([refresh($), loadTasks($), loadLabels($)])
}

async function performAction($: EngineInterface, key: string): Promise<void> {
  const snap = await read($, snapshot)
  if (key === 'settings') return openSettings($)
  if (key === 'vscode') return snap === null ? undefined : openInVsCode($, snap.path)
  if (key === 'issue') {
    const current = await read($, issue)
    return current === null ? undefined : openExternal($, current.url)
  }
  if (key.startsWith('run:')) return runTask($, key.slice('run:'.length))
  if (key.startsWith('app:') && snap !== null) {
    const url = key.slice('app:'.length)
    const known = launchApps(snap.configuredApps, snap.detected, await read($, labels), snap.worktree)
    if (known.some(app => app.url === url)) return openExternal($, url)
  }
}

async function drawCockpit($: EngineInterface, e: RenderInput<'AbovePrompt'>, snap: Snapshot) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const current = await read($, issue)
  const tasks = await read($, catalog)
  const favoriteIds = await read($, favorites)
  const apps = launchApps(snap.configuredApps, snap.detected, await read($, labels), snap.worktree)
  const favoriteScripts = (tasks?.scripts ?? []).filter(script => favoriteIds.includes(script.id))

  const chip = (key: string, label: string, tone: 'normal' | 'muted' = 'normal') => (
    <Button key={key} label={label} plain dimColor={tone === 'muted'} onPress={() => performAction($, key)} />
  )

  const appButton = (app: AppLink) => {
    const url = app.url
    const scope = `dev-cockpit-app-${app.port ?? url}`.slice(0, 64)
    const lines = describeProcess(app.port === null ? undefined : processOfPort(snap.processes, app.port), url)
    return (
      <Box key={`port:${url}`} hover={{ scope }}>
        {chip(`app:${url}`, app.label)}
        <Box
          position="absolute"
          top={-(lines.length + 2)}
          left={0}
          display="none"
          hover={{ scope, display: 'flex' }}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
          paddingX={1}
        >
          {lines.map(line => (
            <Text wrap="truncate-end">{line}</Text>
          ))}
        </Box>
      </Box>
    )
  }

  const sections = [
    <Box key="worktree" columnGap={ITEM_GAP}>
      <Text dimColor>{snap.isMainCheckout ? 'main' : snap.worktree}</Text>
      {chip('vscode', '⧉', 'muted')}
    </Box>,
    <Box key="apps" columnGap={ITEM_GAP}>
      {apps.length === 0 ? <Text dimColor>no app running</Text> : apps.map(appButton)}
    </Box>,
    ...(favoriteScripts.length > 0
      ? [
          <Box key="tasks" columnGap={ITEM_GAP}>
            {favoriteScripts.map(script => chip(`run:${script.id}`, titleOf(script)))}
          </Box>,
        ]
      : []),
    ...(current === null ? [] : [<Box key="issue">{chip('issue', `#${current.number}`)}</Box>]),
  ]

  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Box flexDirection="row" columnGap={SECTION_GAP}>
        {sections.flatMap((section, index) =>
          index === 0
            ? [section]
            : [
                <Text key={`separator:${index}`} dimColor>
                  │
                </Text>,
                section,
              ],
        )}
      </Box>
      {chip('settings', '…', 'muted')}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the dev cockpit settings: app names and tasks' })
    await $.command.register({
      name: 'issue',
      description: 'Set the GitHub issue this session is about',
      argumentHint: '<number | url | clear>',
    })
    const ran = await next(e)
    void $.ui.close({ id: LEGACY_PANE })
    void $.ui.close({ id: LEGACY_DIALOG })
    await restoreIssue($)
    void refreshAll($)
    $.clock.every(POLL_MS, () => refresh($))
    return ran
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await refreshAll($)
    await openSettings($)
    return { text: 'Settings opened.' }
  })

  on('command.run', { command: 'issue' }, async ($, e) => {
    const parsed = issueFromArgs(e.args)
    if (parsed === 'clear') {
      await clearIssue($)
      return { text: 'Session issue cleared.' }
    }
    if (parsed === null) return { text: 'Usage: /issue <number | url | clear>' }
    const set = await setIssue($, parsed, 'command')
    return { text: set === null ? 'No GitHub remote found.' : `Session issue: #${parsed}` }
  })

  on('prompt.submit', async ($, e, next) => {
    const mentioned = issueFromText(e.text)
    if (mentioned !== null && (await read($, issue)) === null) void setIssue($, mentioned, 'prompt')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) return next(e)
    return drawCockpit($, e, snap)
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const snap = await read($, snapshot)
    const tasks = await read($, catalog)
    const favoriteIds = await read($, favorites)
    const appLabels = await read($, labels)
    const appDirs = appDirsOf(snap?.detected ?? [], appLabels)
    const worktree = snap?.worktree ?? ''

    const appRow = (one: AppDir) => {
      const fallback = defaultAppName(one.dir, null, worktree)
      const where = one.dir === '.' ? './' : `./${one.dir}`
      const running = one.ports.length === 0 ? 'not running' : one.ports.join(', ')
      return (
        <Box columnGap={1}>
          <Text dimColor wrap="truncate-end">
            {where} · {running}
          </Text>
          {Input === undefined ? (
            <Text>{appLabels[one.dir] ?? fallback}</Text>
          ) : (
            <Input
              key={`label:${one.dir}`}
              value={appLabels[one.dir] ?? ''}
              placeholder={fallback}
              submitLabel="Save"
              onSubmit={(value: string) => saveLabel($, one.dir, value)}
            />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Apps</Text>
        {appDirs.length === 0 && <Text dimColor>No app server running in this worktree.</Text>}
        {appDirs.map(appRow)}
        <Box marginTop={1}>
          <Text bold>Tasks</Text>
        </Box>
        {tasks === null && <Text dimColor>No package scripts in this worktree.</Text>}
        {groupByPackage(tasks?.scripts ?? []).map(group => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold dimColor>
              {group[0]?.packageName}
              {group[0]?.dir !== '.' && ` (${group[0]?.dir})`}
            </Text>
            {group.map(script => (
              <Box columnGap={1}>
                <Button
                  key={`fav:${script.id}`}
                  label={favoriteIds.includes(script.id) ? '★' : '☆'}
                  plain
                  onPress={() => toggleFavorite($, script.id)}
                />
                <Button key={`once:${script.id}`} label={`▶ ${script.name}`} plain onPress={() => runTask($, script.id)} />
                <Text dimColor wrap="truncate-end">
                  {script.command}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
        <Button key="close" label="Close" role="dismiss" onPress={() => closeSettings($)} />
      </Box>
    )
  })
}
