import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { atTurnEnd, atWorkResumed, bareIssue, runningBackgroundTasks, cardOf, cardTitle, keywordsOf, newCard, withPhase } from './card'

const SET_TITLE = 'mcp__ccd_session_mgmt__set_session_title'
const PHASE_TOOL = 'mcp__dev-cockpit__card_phase'

describe('card helpers', () => {
  test('a prompt that is nothing but an issue', async () => {
    expect(bareIssue('#1233')).toBe(1233)
    expect(bareIssue('  1233 ')).toBe(1233)
    expect(bareIssue('https://github.com/acme/app/issues/1233')).toBe(1233)
    expect(bareIssue('https://github.com/acme/app/issues/1233/')).toBe(1233)
    expect(bareIssue('look at #1233')).toBeNull()
    expect(bareIssue('#1233 please')).toBeNull()
    expect(bareIssue('')).toBeNull()
  })

  test('keywords keep four words, no punctuation or number', async () => {
    expect(keywordsOf('"Role Admin"')).toBe('Role Admin')
    expect(keywordsOf('Rôle admin, permissions: équipe, export, csv')).toBe('Rôle admin permissions équipe')
    expect(keywordsOf('#1233 Role Admin\nsecond line')).toBe('Role Admin')
    expect(keywordsOf('  ...  ')).toBeNull()
    expect(keywordsOf(null)).toBeNull()
  })

  test('the title puts the phase in front of the card', async () => {
    const card = newCard(1233, 'Role Admin')
    expect(cardTitle(card)).toBe('#1233 Role Admin')
    expect(cardTitle(withPhase(card, 'grilling'))).toBe('Grilling - #1233 Role Admin')
    expect(cardTitle(withPhase(card, 'coding'))).toBe('Coding - #1233 Role Admin')
    expect(cardTitle(withPhase(card, 'reviewing'))).toBe('Reviewing - #1233 Role Admin')
    expect(cardTitle(withPhase(card, 'filming'))).toBe('Filming - #1233 Role Admin')
    expect(cardTitle(withPhase(card, 'waiting'))).toBe('Waiting on user - #1233 Role Admin')
    expect(cardTitle(withPhase(card, 'finishing'))).toBe('Finishing - #1233 Role Admin')
    expect(cardTitle(withPhase(card, 'finished'))).toBe('Finished - #1233 Role Admin')
    expect(cardTitle(newCard(7, null))).toBe('#7')
  })

  test('after waiting on the user, the card goes back to the phase it was in', async () => {
    const card = newCard(1, 'x')
    for (const phase of ['coding', 'reviewing', 'filming', 'finishing'] as const) {
      const waiting = atTurnEnd(withPhase(card, phase))
      expect(waiting.phase).toBe('waiting')
      expect(atWorkResumed(waiting).phase).toBe(phase)
      expect(atWorkResumed(withPhase(waiting, 'waiting')).phase).toBe(phase)
    }
    expect(atWorkResumed(atTurnEnd(card)).phase).toBeNull()
  })

  test('grilling and finished stay through the end of a turn', async () => {
    expect(atTurnEnd(withPhase(newCard(1, 'x'), 'grilling')).phase).toBe('grilling')
    expect(atTurnEnd(withPhase(newCard(1, 'x'), 'finished')).phase).toBe('finished')
  })

  test('a background command runs until its notification reports its end', async () => {
    const launch = (id: string) => ({ role: 'assistant' as const, text: '', toolUses: [{ result: { stdout: '', backgroundTaskId: id } }] })
    const note = (id: string, status: string) => ({
      role: 'user' as const,
      text: `<task-notification>
<task-id>${id}</task-id>
<status>${status}</status>
</task-notification>`,
      toolUses: [],
    })
    expect(runningBackgroundTasks([launch('b1'), launch('b2')])).toEqual(['b1', 'b2'])
    expect(runningBackgroundTasks([launch('b1'), launch('b2'), note('b1', 'completed')])).toEqual(['b2'])
    expect(runningBackgroundTasks([launch('b1'), note('b1', 'killed')])).toEqual([])
    expect(runningBackgroundTasks([launch('b1'), { ...note('x', 'running'), text: note('x', 'running').text + note('b2', 'completed').text }])).toEqual(['b1'])
    expect(runningBackgroundTasks([{ role: 'assistant', text: '', toolUses: [{ result: { stdout: 'ok' } }] }])).toEqual([])
  })

  test('a background command that outlived a message of the user, such as a dev server, is not awaited', async () => {
    const launch = (id: string) => ({ role: 'assistant' as const, text: '', toolUses: [{ result: { stdout: '', backgroundTaskId: id } }] })
    const user = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
    const notification = user('<task-notification><task-id>a1</task-id><status>completed</status></task-notification>')
    expect(runningBackgroundTasks([launch('dev'), user('go implemente')])).toEqual([])
    expect(runningBackgroundTasks([launch('dev'), user('go'), launch('test')])).toEqual(['test'])
    expect(runningBackgroundTasks([launch('test'), notification])).toEqual(['test'])
    expect(runningBackgroundTasks([launch('test'), user('<system-reminder>x</system-reminder>')])).toEqual(['test'])
  })

  test('a stored card is read back, junk is not', async () => {
    const card = withPhase(newCard(5, 'a b'), 'reviewing')
    expect(cardOf(JSON.parse(JSON.stringify(card)))).toEqual(card)
    expect(cardOf({ issue: 5, phase: 'dancing' })?.phase).toBeNull()
    expect(cardOf('x')).toBeNull()
  })
})

type Session = { titles: string[]; store?: Record<string, unknown>; agents?: unknown[]; messages?: unknown[] }

function ok(stdout: string) {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function mockSession(on: On, session: Session): void {
  mock.store(on, session.store ?? {})
  on('prompt.submit', ($, e) => ({ text: e.text, ...(e.context === undefined ? {} : { context: e.context }) }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('agent.list', () => ({ value: session.agents ?? [] }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.messages', () => ({ value: session.messages ?? [] }) as never)
  on('session.cwd', () => ({ value: 'C:/work/app' }))
  on('session.repo', () => ({
    value: { root: 'C:/work/app', remote: 'https://github.com/acme/app.git', internal: false, name: 'app' },
  }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'gh') return ok('Add an admin role to the team settings\n')
    if (e.argv[0] === 'git' && e.argv[2] === '--abbrev-ref') return ok('main\n')
    return ok('')
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'Role Admin', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } },
  }) as never)
  on('tool.call', { tool: SET_TITLE } as never, ($, e) => {
    session.titles.push(String((e as unknown as { title: string }).title))
    return { result: 'renamed' } as never
  })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 500; i += 1) await Promise.resolve()
}

type Turns = { turn: { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> } }
type Prompts = { prompt: { submit: (e: unknown) => Promise<{ text?: string; context?: readonly string[] }> } }

async function endTurn($: Engine): Promise<void> {
  await ($ as unknown as Turns).turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await settle()
}

async function startTurn($: Engine): Promise<void> {
  await ($ as unknown as Turns).turn.start({ text: '', turnId: 't2' })
  await settle()
}

async function prompt($: Engine, text: string) {
  const answered = await ($ as unknown as Prompts).prompt.submit({ text, wait: false })
  await startTurn($)
  return { additionalContext: answered.context }
}

test('an issue alone names the conversation, and the phase prefixes it', async ($, on) => {
  const session: Session = { titles: [] }
  mockSession(on, session)

  await prompt($, '#1233')
  await settle()
  expect(session.titles.at(-1)).toBe('#1233 Role Admin')

  const coded = await $.tool.call({ tool: PHASE_TOOL, phase: 'coding' } as never)
  expect(coded.text ?? JSON.stringify(coded.result)).toContain('Coding - #1233 Role Admin')
  expect(session.titles.at(-1)).toBe('Coding - #1233 Role Admin')

  await endTurn($)
  expect(session.titles.at(-1)).toBe('Waiting on user - #1233 Role Admin')

  await prompt($, 'ok, continue')
  await settle()
  expect(session.titles.at(-1)).toBe('Coding - #1233 Role Admin')

  await $.tool.call({ tool: PHASE_TOOL, phase: 'reviewing' } as never)
  expect(session.titles.at(-1)).toBe('Reviewing - #1233 Role Admin')
  await $.tool.call({ tool: PHASE_TOOL, phase: 'filming', keywords: 'Admin role demo' } as never)
  expect(session.titles.at(-1)).toBe('Filming - #1233 Admin role demo')
  await $.tool.call({ tool: PHASE_TOOL, phase: 'finished' } as never)
  await endTurn($)
  expect(session.titles.at(-1)).toBe('Finished - #1233 Admin role demo')
})

test('a prompt that says more than an issue does not rename', async ($, on) => {
  const session: Session = { titles: [] }
  mockSession(on, session)

  await prompt($, 'can you look at #1233?')
  await settle()
  await endTurn($)
  expect(session.titles).toEqual([])
})

test('the phase tool asks for an issue when the session has none', async ($, on) => {
  const session: Session = { titles: [] }
  mockSession(on, session)

  const refused = await $.tool.call({ tool: PHASE_TOOL, phase: 'coding' } as never)
  expect(JSON.stringify(refused)).toContain('pass `issue`')

  await $.tool.call({ tool: PHASE_TOOL, phase: 'coding', issue: 42 } as never)
  expect(session.titles.at(-1)).toBe('Coding - #42 Role Admin')
})

test('the user answer after waiting brings back the phase and asks Claude to correct it', async ($, on) => {
  const session: Session = {
    titles: [],
    store: { 'card:S1': { issue: 9, keywords: 'Export', phase: 'finishing', resume: null } },
  }
  mockSession(on, session)

  await endTurn($)
  expect(session.titles.at(-1)).toBe('Waiting on user - #9 Export')

  const answered = await prompt($, 'ok pour la carte, continue')
  await settle()
  expect(session.titles.at(-1)).toBe('Finishing - #9 Export')
  expect(answered.additionalContext?.join(' ')).toContain('"Finishing - #9 Export"')
  expect(answered.additionalContext?.join(' ')).toContain('call card_phase')

  await $.tool.call({ tool: PHASE_TOOL, phase: 'finished' } as never)
  await endTurn($)
  const later = await prompt($, 'place la PR')
  expect(session.titles.at(-1)).toBe('Finished - #9 Export')
  expect(later.additionalContext?.join(' ')).toContain('"Finished - #9 Export"')
})

test('a turn that leaves background work running does not wait on the user', async ($, on) => {
  const session: Session = {
    titles: [],
    store: { 'card:S1': { issue: 1721, keywords: 'Résumé IA', phase: 'reviewing', resume: null } },
    agents: [{ id: 'a1', kind: 'local_agent', status: 'running', taskStatus: 'running', type: 'general-purpose' }],
  }
  mockSession(on, session)

  await endTurn($)
  expect(session.titles).toEqual([])

  session.agents = []
  session.messages = [{ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', result: { backgroundTaskId: 'b7' } }] }]
  await endTurn($)
  expect(session.titles).toEqual([])

  session.messages.push({
    role: 'user',
    text: '<task-notification><task-id>b7</task-id><status>completed</status></task-notification>',
    toolUses: [],
  })

  await endTurn($)
  expect(session.titles.at(-1)).toBe('Waiting on user - #1721 Résumé IA')
})

test('a turn started by a notification lifts the wait', async ($, on) => {
  const session: Session = {
    titles: [],
    store: { 'card:S1': { issue: 1721, keywords: 'Résumé IA', phase: 'waiting', resume: 'reviewing' } },
  }
  mockSession(on, session)

  await startTurn($)
  expect(session.titles.at(-1)).toBe('Reviewing - #1721 Résumé IA')
})

test('after a grilling, the go-ahead and the first file edit remind Claude to leave grilling', async ($, on) => {
  const session: Session = {
    titles: [],
    store: { 'card:S1': { issue: 1783, keywords: 'Portail équipe', phase: 'grilling', resume: null } },
  }
  mockSession(on, session)
  on('tool.call', { tool: 'Edit' } as never, () => ({ result: { filePath: 'a.ts' } }) as never)

  await endTurn($)
  expect(session.titles.at(-1)).toBe('Grilling - #1783 Portail équipe')

  const answered = await prompt($, 'oui, vas-y')
  expect(answered.additionalContext?.join(' ')).toContain('"Grilling - #1783 Portail équipe"')
  expect(answered.additionalContext?.join(' ')).toContain('the go-ahead to build')

  const edit = () => $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  const first = await edit()
  expect(JSON.stringify(first)).toContain('call card_phase now')
  const second = await edit()
  expect(JSON.stringify(second)).not.toContain('call card_phase now')

  await $.tool.call({ tool: PHASE_TOOL, phase: 'coding' } as never)
  const coding = await edit()
  expect(JSON.stringify(coding)).not.toContain('call card_phase now')
  expect(session.titles.at(-1)).toBe('Coding - #1783 Portail équipe')
})
