export type NodeProcess = {
  pid: number
  role: string
  app: string | null
  memoryMb: number
  ports: number[]
}

export type AppLink = {
  name: string
  label: string
  url: string
  isRunning: boolean | null
}

export type Snapshot = {
  worktree: string
  path: string
  branch: string | null
  isNodeProject: boolean
  isDesktopApp: boolean
  startCommand: string | null
  processes: NodeProcess[]
  helperCount: number
  apps: AppLink[]
  error: string | null
}

export type Issue = {
  number: number
  url: string
  title: string | null
  source: 'command' | 'prompt' | 'branch'
}

declare module 'claude-code' {
  interface PluginState {
    'dev-cockpit': {
      snapshot: Snapshot | null
      issue: Issue | null
    }
  }
}
