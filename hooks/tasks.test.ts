import { describe, expect, test } from 'claude-code/testing'

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

const make = (dir: string, name: string) => ({ id: `${dir}#${name}`, dir, packageName: dir, name, command: '' })

describe('scripts of a package', () => {
  test('lists the scripts with their package', async () => {
    const scripts = scriptsOf(
      'apps/portal',
      JSON.stringify({ name: '@acme/portal', scripts: { dev: 'next dev', test: 'vitest run', 'bad name;rm': 'x', n: 3 } }),
    )
    expect(scripts).toEqual([
      { id: 'apps/portal#dev', dir: 'apps/portal', packageName: '@acme/portal', name: 'dev', command: 'next dev' },
      { id: 'apps/portal#test', dir: 'apps/portal', packageName: '@acme/portal', name: 'test', command: 'vitest run' },
    ])
  })

  test('names unnamed packages and survives broken files', async () => {
    expect(scriptsOf('.', '{"scripts":{"a":"x"}}')[0]?.packageName).toBe('root')
    expect(scriptsOf('server', '{"scripts":{"a":"x"}}')[0]?.packageName).toBe('server')
    expect(scriptsOf('.', '{"name":"x"}')).toEqual([])
    expect(scriptsOf('.', 'oops')).toEqual([])
  })

  test('sorts the root package first, then by folder and name, and groups by package', async () => {
    const sorted = sortScripts([make('b', 'x'), make('.', 'z'), make('a', 'y'), make('.', 'a')])
    expect(sorted.map(one => one.id)).toEqual(['.#a', '.#z', 'a#y', 'b#x'])
    expect(groupByPackage(sorted).map(group => group.map(one => one.id))).toEqual([['.#a', '.#z'], ['a#y'], ['b#x']])
    expect(groupByPackage([])).toEqual([])
  })
})

describe('terminal', () => {
  test('opens a Windows Terminal tab that stays open, or a cmd window', async () => {
    expect(terminalArgv('portal:dev', 'C:\\app\\apps\\portal', 'pnpm', 'dev')).toEqual([
      'wt.exe', '-w', '0', 'new-tab', '--title', 'portal:dev', '-d', 'C:\\app\\apps\\portal', 'cmd.exe', '/k', 'pnpm', 'run', 'dev',
    ])
    expect(fallbackTerminalArgv('C:\\app', 'npm', 'dev')).toEqual([
      'cmd.exe', '/d', '/c', 'start', '', '/D', 'C:\\app', 'cmd.exe', '/k', 'npm', 'run', 'dev',
    ])
  })

  test('titles a task after its package folder and script', async () => {
    expect(titleOf({ ...make('apps/back office', 'dev') })).toBe('back-office:dev')
    expect(titleOf(make('.', 'test'))).toBe('test')
  })
})

describe('favorites', () => {
  test('are keyed by repository and toggled', async () => {
    expect(favoritesKey('C:\\Users\\Me\\App\\')).toBe('favorites:c:/users/me/app')
    expect(favoritesOf(['a', 2, 'b'])).toEqual(['a', 'b'])
    expect(favoritesOf(undefined)).toEqual([])
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })

  test('skip hidden and generated folders', async () => {
    expect(isIgnoredDir('.git')).toBe(true)
    expect(isIgnoredDir('node_modules')).toBe(true)
    expect(isIgnoredDir('Dist')).toBe(true)
    expect(isIgnoredDir('apps')).toBe(false)
  })
})
