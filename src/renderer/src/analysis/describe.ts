// Reading a frame as a picture editor would file it: what is happening in it,
// what it brings, and what is wrong with it.
//
// The sentence is put together from what the app can tell by itself (how many
// people, how close, what their faces and bodies are doing, who they are, how
// it is framed and lit) plus whatever it has learned to recognise from
// Claude's descriptions. Claude's own sentence, where it has looked, replaces it.

import type { Analysis, Score, Shot } from '@shared/types'

const count = (n: number): string => (n === 1 ? 'One person' : n === 2 ? 'Two people' : n <= 5 ? `${['Three', 'Four', 'Five'][n - 3]} people` : `A group of ${n}`)
const list = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

export interface Told {
  /** The emotion on each main face (null for a face at rest), largest face first. */
  emotions: (string | null)[]
  gesture?: string
  connection: number
  keyPeople: string[]
  happens: string[]
}

/** What is happening in the frame, in a sentence or two, from measurements alone. */
export function describeFrame(a: Analysis, t: Told): string {
  const faces = a.faces.filter((f) => f.h >= 0.05).length
  const people = Math.max(faces, a.bodies?.length ?? 0)
  const c = a.color
  const light = c.meanLuma < 0.18 ? 'dark, low-key' : c.meanLuma > 0.68 ? 'bright, high-key' : c.p95 - c.p5 > 0.8 ? 'contrasty light' : ''
  if (people === 0) return `No people: a detail or a scene${light ? `, ${light}` : ''}.${t.happens.length ? ` Looks like: ${list(t.happens)}.` : ''}`

  let who = count(people)
  if (t.keyPeople.length) {
    const others = people - t.keyPeople.length
    who = `${list(t.keyPeople)}${others > 0 ? ` and ${others === 1 ? 'one other' : `${others} others`}` : ''}`
    who = who[0].toUpperCase() + who.slice(1)
  }
  const framing = faces === 0 ? 'no face visible' : a.shotType === 'group' ? 'group shot' : a.shotType
  const together = people >= 2 ? (t.connection > 0.75 ? 'faces touching or nearly so' : t.connection > 0.4 ? 'turned toward each other' : '') : ''
  const first = [who, together, framing, light].filter(Boolean).join(', ') + '.'

  const felt = [...new Set(t.emotions.filter((e): e is string => !!e && e !== 'unnamed'))].slice(0, 2)
  const doing: string[] = []
  if (felt.length) doing.push(`${list(felt)} on ${faces > 1 ? 'the faces' : 'the face'}`)
  else if (t.emotions.includes('unnamed')) doing.push('a strong expression the app has no name for')
  else if (faces) doing.push(faces > 1 ? 'quiet faces' : 'a quiet face')
  if (t.gesture) doing.push(t.gesture)
  const second = doing.length ? ` ${doing.join('; ')[0].toUpperCase()}${doing.join('; ').slice(1)}.` : ''
  return `${first}${second}${t.happens.length ? ` Looks like: ${list(t.happens)}.` : ''}`
}

/** What is wrong with a frame, in the words the ledger files it under. */
export function flawsOf(score: Score, a: Analysis): string[] {
  const out: string[] = []
  const w = score.warnings
  if (w.includes('blink')) out.push('closed eyes')
  if (w.includes('soft-face')) out.push('soft eyes')
  if (w.includes('soft') || w.includes('blurred')) out.push('soft overall')
  if (w.includes('clipped')) out.push('blown highlights')
  if (w.includes('dark')) out.push('very dark')
  if ((a.diag?.merged ?? 0) > 0.35) out.push('subject merges with background')
  if ((a.diag?.pull ?? 0) > 0.1) out.push('a distraction')
  return out
}

/** What a frame brings, in the words the ledger files it under. */
export function assetsOf(score: Score, shot: Pick<Shot, 'read'>, a: Analysis): string[] {
  const out: string[] = []
  if (score.emotion && score.emotion.intensity >= 0.35 && score.emotion.name !== 'unnamed') out.push(score.emotion.name)
  else if (score.emotion && score.emotion.intensity >= 0.5) out.push('a strong expression')
  if (score.gesture) out.push(score.gesture.name)
  for (const t of score.happens ?? []) if (!out.includes(t)) out.push(t)
  if (score.tags.includes('embrace') || score.tags.includes('connection')) out.push('closeness')
  if (score.tags.includes('peak')) out.push('the peak of a burst')
  if (score.tags.includes('rare')) out.push('a rare emotion')
  if (score.must) out.push('a must-have chapter')
  if (score.keyPeople?.length) out.push('a key person')
  if (shot.read && shot.read.moment >= 7) out.push("Claude's high rating")
  if ((a.diag?.attention ?? 0) > 0.6 && (a.diag?.merged ?? 0) < 0.15) out.push('a subject that holds the eye')
  return out
}
