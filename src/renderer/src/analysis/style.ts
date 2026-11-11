import type { Analysis, ShotType, Style, StyleProfile } from '@shared/types'
import { BLINK_LIMIT, readMoment, type Moment } from './scoring'

const SHOT_TYPES: ShotType[] = ['close-up', 'medium', 'wide', 'group', 'detail']
const pct = (v: number): string => `${Math.round(v * 100)}%`

/** Summarises what a set of chosen frames has in common. */
export function buildProfile(frames: Analysis[]): StyleProfile {
  const n = Math.max(1, frames.length)
  const moments = frames.map((a) => readMoment(a.faces)).filter((m): m is Moment => m !== null)
  const withFaces = Math.max(1, moments.length)
  const mean = (f: (a: Analysis) => number): number => frames.reduce((sum, a) => sum + f(a), 0) / n
  const shotTypes = Object.fromEntries(SHOT_TYPES.map((t) => [t, frames.filter((a) => a.shotType === t).length / n])) as Record<ShotType, number>
  return {
    count: frames.length,
    facesShare: moments.length / n,
    expression: moments.reduce((s, m) => s + m.expression, 0) / withFaces,
    connection: moments.reduce((s, m) => s + m.connection, 0) / withFaces,
    laughShare: moments.filter((m) => m.laughing).length / withFaces,
    closedEyesShare: frames.filter((a) => a.faces.some((f) => f.h >= 0.05 && f.blink > BLINK_LIMIT)).length / withFaces,
    shotTypes,
    luma: mean((a) => a.color.meanLuma),
    contrast: mean((a) => a.color.p95 - a.color.p5),
    saturation: mean((a) => a.color.meanSat),
    warmth: mean((a) => a.color.castWarm)
  }
}

/** Combines several profiles, each weighted by how many frames it was built from. */
export function mergeProfiles(profiles: StyleProfile[]): StyleProfile | undefined {
  if (profiles.length === 0) return undefined
  const total = profiles.reduce((s, p) => s + p.count, 0) || 1
  const w = (f: (p: StyleProfile) => number): number => profiles.reduce((s, p) => s + f(p) * p.count, 0) / total
  return {
    count: total,
    facesShare: w((p) => p.facesShare),
    expression: w((p) => p.expression),
    connection: w((p) => p.connection),
    laughShare: w((p) => p.laughShare),
    closedEyesShare: w((p) => p.closedEyesShare),
    shotTypes: Object.fromEntries(SHOT_TYPES.map((t) => [t, w((p) => p.shotTypes[t])])) as Record<ShotType, number>,
    luma: w((p) => p.luma),
    contrast: w((p) => p.contrast),
    saturation: w((p) => p.saturation),
    warmth: w((p) => p.warmth)
  }
}

/**
 * How many moment points a frame gains or loses for resembling the reference.
 * Deliberately small (about -6 to +14): a reference should tilt close calls,
 * not overrule what is in the frame.
 */
export function styleBonus(profile: StyleProfile, moment: Moment | null, shotType: ShotType): { points: number; reasons: string[] } {
  let points = 0
  const reasons: string[] = []
  if (moment) {
    if (moment.laughing && profile.laughShare > 0.1) {
      points += Math.min(5, profile.laughShare * 20)
      reasons.push('laughter, which the reference keeps often')
    }
    if (moment.connection > 0.4 && profile.connection > 0.2) {
      points += Math.min(6, profile.connection * moment.connection * 12)
      reasons.push('closeness between people, a constant in the reference')
    }
  }
  // Uniform would be 20% per shot type; reward the distances the reference favours.
  const lean = (profile.shotTypes[shotType] - 0.2) * 20
  points += Math.max(-6, Math.min(4, lean))
  if (lean > 1.5) reasons.push(`${shotType} frames, which make up ${pct(profile.shotTypes[shotType])} of the reference`)
  return { points, reasons }
}

/** The balance between craft and moment that a reference implies. */
export const impliedBalance = (p: StyleProfile): number =>
  Math.round(Math.min(0.8, Math.max(0.25, 0.3 + 0.45 * p.expression + 0.35 * p.connection + 0.5 * p.closedEyesShare)) * 20) / 20

/** The measured profile in plain sentences, for the screen and for the essence request. */
export function profileFacts(p: StyleProfile): string[] {
  const top = [...SHOT_TYPES].sort((a, b) => p.shotTypes[b] - p.shotTypes[a])
  const facts = [
    `${p.count} photographs; ${pct(p.facesShare)} show people's faces.`,
    `Mostly ${top[0]} (${pct(p.shotTypes[top[0]])}) and ${top[1]} (${pct(p.shotTypes[top[1]])}) frames; ${pct(p.shotTypes.detail)} are details or scenes without faces.`
  ]
  if (p.facesShare > 0.15) {
    facts.push(
      `Among frames with faces: ${pct(p.laughShare)} show open laughter, and people are close or turned to each other at an average strength of ${pct(p.connection)}.`,
      p.closedEyesShare > 0.08
        ? `${pct(p.closedEyesShare)} have closed or lowered eyes: this photographer keeps them when the feeling is right.`
        : 'Almost every face has open eyes.'
    )
  }
  facts.push(
    `Tonally ${p.luma > 0.55 ? 'bright and airy' : p.luma < 0.35 ? 'dark and moody' : 'mid-toned'}, ${p.contrast > 0.75 ? 'high' : p.contrast < 0.55 ? 'low' : 'moderate'} contrast, ${p.saturation > 0.4 ? 'saturated' : p.saturation < 0.22 ? 'muted' : 'natural'} colour, neutrals leaning ${p.warmth > 0.03 ? 'warm' : p.warmth < -0.03 ? 'cool' : 'neutral'}.`
  )
  return facts
}

/** How a profile's atmosphere words change what the cull rewards. */
export interface Feel {
  /** Added to the weight of joy, of closeness, and of a quiet face (each about -0.15..0.15). */
  expression: number
  connection: number
  quiet: number
  /** Added to the craft/moment balance: positive leans toward the moment. */
  balance: number
  /** Lowers the bar for a flawed frame to count as a hidden gem. */
  forgiving: boolean
}

const FEEL_WORDS: { words: string[]; effect: Partial<Feel> }[] = [
  { words: ['joy', 'happy', 'fun', 'playful', 'lively', 'laugh', 'bright', 'cheerful', 'celebrat'], effect: { expression: 0.12 } },
  { words: ['intimate', 'tender', 'romantic', 'close', 'emotional', 'warm', 'loving', 'gentle', 'family'], effect: { connection: 0.12 } },
  { words: ['quiet', 'calm', 'moody', 'serious', 'editorial', 'minimal', 'elegant', 'dramatic', 'cinematic', 'melanchol', 'still', 'dark', 'fashion'], effect: { quiet: 0.14, expression: -0.2 } },
  { words: ['documentary', 'raw', 'authentic', 'candid', 'energetic', 'party', 'wild', 'honest', 'real', 'movement', 'reportage'], effect: { balance: 0.1, forgiving: true } },
  { words: ['polished', 'clean', 'commercial', 'classic', 'formal', 'perfect', 'crisp', 'timeless', 'corporate'], effect: { balance: -0.1 } }
]

/** Turns atmosphere words into scoring adjustments. Unknown words are simply passed on to the editor's read. */
export function feelOf(tags: string[]): Feel {
  const feel: Feel = { expression: 0, connection: 0, quiet: 0, balance: 0, forgiving: false }
  const text = tags.join(' ').toLowerCase()
  for (const { words, effect } of FEEL_WORDS) {
    if (!words.some((w) => text.includes(w))) continue
    feel.expression += effect.expression ?? 0
    feel.connection += effect.connection ?? 0
    feel.quiet += effect.quiet ?? 0
    feel.balance += effect.balance ?? 0
    feel.forgiving ||= effect.forgiving ?? false
  }
  return feel
}

/** Profiles every installation starts with. They hold no learning yet: only the words. */
export const STARTER_PROFILES: Pick<Style, 'name' | 'tags' | 'feeling'>[] = [
  { name: 'Joyful and candid', tags: ['joyful', 'candid', 'lively'], feeling: 'Real laughter and people enjoying each other. The unposed frame beats the posed one.' },
  { name: 'Intimate and tender', tags: ['intimate', 'tender', 'quiet'], feeling: 'Closeness, touch, small gestures. Soft frames are welcome when the feeling is true.' },
  { name: 'Editorial and composed', tags: ['editorial', 'elegant', 'polished'], feeling: 'Considered frames with strong lines and attitude. Smiles are not the point; craft is.' },
  { name: 'Documentary and raw', tags: ['documentary', 'raw', 'energetic'], feeling: 'What actually happened, with its blur and grain. Moments over polish, every time.' },
  { name: 'Dark and cinematic', tags: ['moody', 'cinematic', 'dramatic'], feeling: 'Atmosphere and tension. Faces half in shadow, stillness, a sense of story outside the frame.' }
]

/** What the active profiles say about choosing, for the editor's read. */
export function styleNotes(styles: Style[]): string {
  return styles
    .map((s) => {
      const lines = [
        s.tags.length ? `Atmosphere: ${s.tags.join(', ')}.` : '',
        s.feeling,
        ...(s.essence
          ? [s.essence.summary, ...s.essence.principles.map((p) => `- ${p}`), ...s.essence.forgive.map((f) => `- Forgives: ${f}`)]
          : s.profile
            ? ['Measured from the photographs this profile has learned from:', ...profileFacts(s.profile)]
            : [])
      ].filter(Boolean)
      return `Culling profile "${s.name}":\n${lines.join('\n')}`
    })
    .join('\n\n')
}
