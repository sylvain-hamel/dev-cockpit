import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AppLink, Issue, NodeProcess, Snapshot } from '../types'
import {
  baseName,
  classify,
  issueFromArgs,
  issueFromBranch,
  issueFromText,
  launchApps,
  managerOf,
  parseConfig,
  parsePackage,
  parseProbe,
  repoUrl,
  startCommandOf,
  toWindowsPath,
} from './lib'

const PANE = 'dev-cockpit'
const TITLE = 'Dev cockpit'
const POLL_MS = 10000
const CONFIG_FILE = '.claude/dev-cockpit.json'

const snapshot = atom({ plugin: 'dev-cockpit', key: 'snapshot' } as const, null)
const issue = atom({ plugin: 'dev-cockpit', key: 'issue' } as const, null)

const PROBE = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$root = $env:DEV_COCKPIT_ROOT.ToLower()',
  "$all = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='electron.exe' OR Name='bun.exe' OR Name='deno.exe'\")",
  '$ids = @{}',
  'foreach ($p in $all) { if ($p.CommandLine -and $p.CommandLine.ToLower().Contains($root)) { $ids[$p.ProcessId] = $true } }',
  'do { $added = $false; foreach ($p in $all) { if (-not $ids[$p.ProcessId] -and $ids[$p.ParentProcessId]) { $ids[$p.ProcessId] = $true; $added = $true } } } while ($added)',
  '$procs = $all | Where-Object { $ids[$_.ProcessId] }',
  '$rows = foreach ($p in $procs) {',
  '  $ports = @(Get-NetTCPConnection -State Listen -OwningProcess $p.ProcessId | Select-Object -ExpandProperty LocalPort -Unique)',
  '  [pscustomobject]@{ pid = [int]$p.ProcessId; name = $p.Name; cmd = $p.CommandLine; mem = [double]$p.WorkingSetSize; ports = $ports }',
  '}',
  'ConvertTo-Json -InputObject @($rows) -Compress -Depth 3',
].join('\n')

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

async function probeProcesses($: EngineInterface, path: string) {
  try {
    const ran = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', PROBE], {
      env: { DEV_COCKPIT_ROOT: path },
      timeoutMs: 20000,
    })
    if (ran.exitCode !== 0) {
      return { processes: [], helperCount: 0, detected: [], error: ran.stderr.trim() || 'Process probe failed' }
    }
    return { ...classify(parseProbe(ran.stdout), path), error: null }
  } catch (error) {
    return { processes: [], helperCount: 0, detected: [], error: String(error) }
  }
}

async function probe($: EngineInterface): Promise<Snapshot> {
  const cwd = await $.session.cwd()
  const top = (await git($, cwd, ['rev-parse', '--show-toplevel'])) ?? cwd
  const path = toWindowsPath(top)
  const ref = await git($, top, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const sha = ref === 'HEAD' ? await git($, top, ['rev-parse', '--short', 'HEAD']) : null
  const branch = ref === null ? null : ref === 'HEAD' ? `detached at ${sha ?? '?'}` : ref
  const files = await listNames($, top)
  const pkg = files.includes('package.json') ? parsePackage(await readText($, `${top}/package.json`)) : null
  const config = parseConfig(await readText($, `${top}/${CONFIG_FILE}`))
  const { detected, ...found } = await probeProcesses($, path)
  return {
    worktree: baseName(path),
    path,
    branch,
    isNodeProject: pkg !== null,
    isDesktopApp: pkg?.isElectron ?? false,
    startCommand: config.startCommand ?? startCommandOf(pkg, managerOf(files)),
    ...found,
    apps: launchApps(config.apps ?? [], detected),
  }
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

async function setIssue($: EngineInterface, number: number, source: Issue['source']): Promise<Issue | null> {
  const repo = repoUrl((await $.session.repo())?.remote ?? null)
  if (repo === null) return null
  const next: Issue = { number, url: `${repo}/issues/${number}`, title: null, source }
  await update($, issue, () => next)
  const title = await issueTitle($, number)
  if (title !== null) {
    await update($, issue, current => (current?.number === number ? { ...current, title } : current))
  }
  return next
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

function hasRuntime(snap: Snapshot): boolean {
  return snap.isNodeProject || snap.processes.length > 0 || snap.apps.length > 0
}

function hasLaunch(snap: Snapshot): boolean {
  return snap.apps.length > 0 || (snap.isNodeProject && !snap.isDesktopApp)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the dev cockpit pane' })
    await $.command.register({
      name: 'issue',
      description: 'Set the GitHub issue this session is about',
      argumentHint: '<number | url | clear>',
    })
    const ran = await next(e)
    if ((await read($, issue)) === null) {
      const first = (await $.session.messages()).find(one => one.role === 'user' && issueFromText(one.text) !== null)
      if (first !== undefined) void setIssue($, issueFromText(first.text) as number, 'prompt')
    }
    void refresh($)
    $.clock.every(POLL_MS, () => refresh($))
    void $.ui.open({ id: PANE, title: TITLE })
    return ran
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    return { text: 'Dev cockpit opened.' }
  })

  on('command.run', { command: 'issue' }, async ($, e) => {
    const parsed = issueFromArgs(e.args)
    if (parsed === 'clear') {
      await update($, issue, () => null)
      return { text: 'Session issue cleared.' }
    }
    if (parsed === null) return { text: 'Usage: /issue <number | url | clear>' }
    const set = await setIssue($, parsed, 'command')
    return { text: set === null ? 'No GitHub remote found.' : `Session issue: #${parsed}` }
  })

  on('prompt.submit', async ($, e, next) => {
    const current = await read($, issue)
    const mentioned = issueFromText(e.text)
    if (mentioned !== null && (current === null || current.source === 'branch')) {
      void setIssue($, mentioned, 'prompt')
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const current = await read($, issue)

    if (snap === null) return <Text dimColor>Probing the worktree…</Text>

    const processRow = (one: NodeProcess) => (
      <Text>
        <Text color="green">●</Text> {one.role} <Text dimColor>pid {one.pid} · {one.memoryMb} MB</Text>
        {one.ports.length > 0 && <Text color="cyan"> :{one.ports.join(', :')}</Text>}
      </Text>
    )

    const appRow = (app: AppLink) => (
      <Box>
        <Button key={`launch-${app.name}`} label={app.label} onPress={() => openExternal($, app.url)} />
        <Text dimColor>
          {' '}
          {app.url}
          {app.isRunning === false && ' (not running)'}
        </Text>
      </Box>
    )
    const isAnyRunning = snap.apps.some(app => app.isRunning !== false)

    return (
      <Box flexDirection="column">
        <Text bold>Worktree</Text>
        <Box>
          <Text>
            {snap.worktree}
            {snap.branch !== null && <Text dimColor> ({snap.branch})</Text>}{' '}
          </Text>
          <Button key="vscode" label="Open in VS Code" onPress={() => openInVsCode($, snap.path)} />
        </Box>
        <Text dimColor>{snap.path}</Text>

        {hasLaunch(snap) && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Launch app</Text>
            {snap.apps.map(appRow)}
            {!isAnyRunning && (
              <Text dimColor>
                No app running.{snap.startCommand !== null && ` Start it with ${snap.startCommand}.`}
              </Text>
            )}
          </Box>
        )}

        {hasRuntime(snap) && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Node processes ({snap.processes.length})</Text>
            {snap.error !== null && <Text color="red">{snap.error}</Text>}
            {snap.processes.length === 0 && snap.error === null && <Text dimColor>None for this worktree.</Text>}
            {snap.processes.map(processRow)}
            {snap.helperCount > 0 && <Text dimColor>+ {snap.helperCount} helper processes</Text>}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Issue</Text>
          {current === null ? (
            <Text dimColor>None. Set it with /issue &lt;number&gt;.</Text>
          ) : (
            <Box flexDirection="column">
              <Box>
                <Link href={current.url} label={`#${current.number}`} />
                <Text> </Text>
                <Button key="open-issue" label="Open" onPress={() => openExternal($, current.url)} />
              </Box>
              {current.title !== null && <Text>{current.title}</Text>}
            </Box>
          )}
        </Box>

        <Box marginTop={1}>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
