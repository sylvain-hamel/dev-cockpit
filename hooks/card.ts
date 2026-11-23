import type { Card, Phase } from '../types'

export const PHASES: Readonly<Record<Phase, string>> = {
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

/** The card once Claude's turn ends: waiting on the user, unless the work is finished. */
export function atTurnEnd(card: Card): Card {
  if (card.phase === 'finished' || card.phase === 'waiting') return card
  return { ...card, phase: 'waiting', resume: card.phase }
}

/**
 * The card once the user answers: back to coding, or to finishing when the card was being
 * finalized. Claude moves it elsewhere when the answer says so (work validated, feedback).
 */
export function atUserPrompt(card: Card): Card {
  if (card.phase !== 'waiting') return card
  const phase = card.resume === null ? null : card.resume === 'finishing' ? 'finishing' : 'coding'
  return { ...card, phase, resume: null }
}

/** What Claude reads with the user's answer, so it corrects the phase the title went back to. */
export function resumeContext(card: Card): string {
  return [
    `dev-cockpit: the user answered, and the conversation title is now "${cardTitle(card)}".`,
    `If their message moves card #${card.issue} to another phase, call card_phase before anything else:`,
    'feedback or changes to make → coding; work validated, or asked to finalize → finishing;',
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
