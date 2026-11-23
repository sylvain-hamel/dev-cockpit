import type { Card, Phase } from '../types'

export const PHASES: Readonly<Record<Phase, string>> = {
  grilling: 'Grilling',
  coding: 'Coding',
  reviewing: 'Reviewing',
  filming: 'Filming',
  finishing: 'Finishing',
  finished: 'Finished',
  waiting: 'Waiting on user',
}

export const MAX_KEYWORDS = 4

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PHASES, value)
}

/** The issue number when the whole prompt is nothing but an issue: `#1233`, `1233` or its GitHub URL. */
export function bareIssue(text: string): number | null {
  const match = /^\s*(?:#?(\d{1,6})|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d{1,6})\/?)\s*$/.exec(text)
  if (match === null) return null
  return Number(match[1] ?? match[2])
}

/** At most four words, from a model's reply or an issue title: no quotes, punctuation, issue number or line breaks. */
export function keywordsOf(text: string | null): string | null {
  if (text === null) return null
  const line = text.split(/\r?\n/).find(one => one.trim() !== '') ?? ''
  const words = line
    .replace(/#\d+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'_-]/gu, ' ')
    .split(/\s+/)
    .map(word => word.replace(/^['_-]+|['_-]+$/g, ''))
    .filter(word => word !== '')
    .slice(0, MAX_KEYWORDS)
  return words.length === 0 ? null : words.join(' ')
}

export function cardTitle(card: Card): string {
  const subject = card.keywords === null ? `#${card.issue}` : `#${card.issue} ${card.keywords}`
  return card.phase === null ? subject : `${PHASES[card.phase]} - ${subject}`
}

export function newCard(issue: number, keywords: string | null): Card {
  return { issue, keywords, phase: null, resume: null }
}

export function withPhase(card: Card, phase: Phase): Card {
  if (phase !== 'waiting') return { ...card, phase, resume: null }
  return { ...card, phase, resume: card.phase === 'waiting' ? card.resume : card.phase }
}

/** Phases where Claude's turn ending on the user is the phase itself, not a wait. */
const HOLDS_AT_TURN_END: ReadonlySet<Phase | null> = new Set<Phase | null>(['grilling', 'finished', 'waiting'])

/**
 * The card once Claude's turn ends: waiting on the user, unless the phase already says so.
 * A grilling asks the user a question each turn, and a finished card waits on their
 * pull request and merge.
 */
export function atTurnEnd(card: Card): Card {
  if (HOLDS_AT_TURN_END.has(card.phase)) return card
  return { ...card, phase: 'waiting', resume: card.phase }
}

/**
 * The card once Claude works again, on the user's answer or a notification: back to the
 * phase it was in. Claude moves it elsewhere only when the answer clearly says so.
 */
export function atWorkResumed(card: Card): Card {
  if (card.phase !== 'waiting') return card
  return { ...card, phase: card.resume, resume: null }
}

/** What Claude reads with the user's answer, so it corrects the phase the title went back to. */
export function resumeContext(card: Card): string {
  return [
    `dev-cockpit: the user answered, and the conversation title is now "${cardTitle(card)}".`,
    `If their message clearly moves card #${card.issue} to another phase, call card_phase before anything else;`,
    'when unsure, keep the phase. For example:',
    'a question to settle or the spec to refine → grilling; feedback or changes to make → coding;',
    'work validated, or asked to finalize → finishing;',
    'everything finalized, only the pull request and the merge left → finished.',
  ].join(' ')
}

export function cardOf(raw: unknown): Card | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { issue, keywords, phase, resume } = raw as Record<string, unknown>
  if (typeof issue !== 'number') return null
  return {
    issue,
    keywords: typeof keywords === 'string' ? keywords : null,
    phase: isPhase(phase) ? phase : null,
    resume: isPhase(resume) ? resume : null,
  }
}

export function keywordsPrompt(issue: number, title: string): string {
  return [
    `GitHub issue #${issue} is titled: "${title}"`,
    '',
    `Reply with at most ${MAX_KEYWORDS} keywords that clearly identify this issue, in the language of its title,`,
    'separated by spaces, on one line. No issue number, no punctuation, no quotes, nothing else.',
  ].join('\n')
}

type TranscriptRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { result?: unknown }[]
}

const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g
const TASK_ID = /<task-id>([^<]+)<\/task-id>/
const ENDED = /<status>(?:completed|failed|killed|stopped|cancelled)<\/status>/

/**
 * The background tasks Claude launched (a Bash or PowerShell command sent to the background)
 * whose end no task notification has reported yet.
 */
export function runningBackgroundTasks(rows: readonly TranscriptRow[]): string[] {
  const launched = new Set<string>()
  const ended = new Set<string>()
  for (const row of rows) {
    if (row.role === 'assistant') {
      for (const use of row.toolUses) {
        const id = (use.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId
        if (typeof id === 'string' && id !== '') launched.add(id)
      }
    } else {
      for (const [, block = ''] of row.text.matchAll(NOTIFICATION)) {
        const id = TASK_ID.exec(block)?.[1]
        if (id !== undefined && ENDED.test(block)) ended.add(id)
      }
    }
  }
  return [...launched].filter(id => !ended.has(id))
}

