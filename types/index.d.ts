export type NodeProcess = {
  pid: number
  role: string
  app: string | null
  dir: string | null
  memoryMb: number
  ports: number[]
}

export type DetectedApp = { port: number; app: string | null; dir: string | null }

export type ConfiguredApp = { name: string; url: string; label?: string }

export type AppLink = {
  dir: string | null
  port: number | null
  label: string
  url: string
  isRunning: boolean | null
}

export type Snapshot = {
  worktree: string
  isMainCheckout: boolean
  path: string
  branch: string | null
  isNodeProject: boolean
  isDesktopApp: boolean
  startCommand: string | null
  processes: NodeProcess[]
  helperCount: number
  detected: DetectedApp[]
  configuredApps: ConfiguredApp[]
  error: string | null
}

export type Issue = {
  number: number
  url: string
  title: string | null
  source: 'command' | 'prompt' | 'branch'
}

export type Script = {
  id: string
  dir: string
  packageName: string
  name: string
  command: string
}

export type TaskCatalog = {
  root: string
  manager: string
  favoritesKey: string
  scripts: Script[]
}

declare module 'claude-code' {
  interface PluginState {
    'dev-cockpit': {
      snapshot: Snapshot | null
      issue: Issue | null
      catalog: TaskCatalog | null
      favorites: string[]
      labels: Record<string, string>
    }
  }
}
