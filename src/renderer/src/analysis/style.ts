import { DEFAULT_BALANCE, STORY_PLANS } from '@shared/storyPlans'
import type { Analysis, Shot, ShotType, Style, StyleProfile } from '@shared/types'
import { DEFAULT_EMOTION_VALUE, FAMILY_EMOTIONS } from './emotion'
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

type Starter = Pick<Style, 'name' | 'tags' | 'feeling' | 'family' | 'chapters' | 'emotions' | 'balance' | 'lookFor' | 'forgive'>

/**
 * Shoot styles every installation starts with. They are starting points: the
 * photographer edits them, adds their own (a LARP battle, a boudoir session, a
 * birthday), and each keeps learning from the work done in it.
 */
export const STARTER_STYLES: Starter[] = [
  {
    name: 'Wedding', family: 'wedding', tags: ['joyful', 'intimate', 'documentary'], balance: 0.55,
    feeling: 'The day as it felt: real emotion between people, and everyone who mattered.',
    chapters: STORY_PLANS.wedding.map((c) => ({ ...c, must: ['Ceremony', 'Family and group portraits', 'Couple portraits', 'First dance and party'].includes(c.name) })),
    emotions: {}, lookFor: ['Reactions as much as actions', 'Tears and laughter during the ceremony and speeches', 'The frame after the pose'], forgive: ['Motion blur on the dance floor', 'Grain in dark rooms', 'Closed eyes inside a laugh or a kiss']
  },
  {
    name: 'Celebration or party', family: 'event', tags: ['joyful', 'lively', 'candid'], balance: 0.55,
    feeling: 'A birthday, an anniversary, a gathering: people enjoying each other.',
    chapters: [
      { name: 'Place and details', look: 'The room, the table, the cake, the decorations before they are touched.' },
      { name: 'Arrivals and greetings', look: 'Hugs at the door, first reactions.' },
      { name: 'The main moment', look: 'Candles, the toast, the gift, the surprise: the guest of honour and everyone watching.', must: true },
      { name: 'People together', look: 'Groups laughing, conversations, generations side by side.', must: true },
      { name: 'Play and dancing', look: 'Movement and abandon. Blur belongs here.' },
      { name: 'Winding down', look: 'Tired children, last embraces, the empty table.' }
    ],
    emotions: { laughter: 1, joy: 0.8, surprise: 0.9, awe: 0.7 }, lookFor: ['The guest of honour reacting', 'Children unaware of the camera'], forgive: ['Blur in play', 'Mixed light']
  },
  {
    name: 'Portrait', family: 'portrait', tags: ['honest', 'calm'], balance: 0.45,
    feeling: 'The person at their most themselves.',
    chapters: STORY_PLANS.portrait.map((c) => ({ ...c, must: c.name === 'Classic portrait' })),
    emotions: {}, lookFor: ['The expression between expressions', 'Eyes that are present'], forgive: ['A soft frame if it is the alive one']
  },
  {
    name: 'Intimate portrait and boudoir', family: 'portrait', tags: ['intimate', 'tender', 'quiet'], balance: 0.5,
    feeling: 'Closeness and trust. Confidence, vulnerability, the body at ease.',
    chapters: [
      { name: 'Settling in', look: 'First frames while trust builds: hands, fabric, light on skin.' },
      { name: 'Portraits', look: 'Face and gaze. Presence over pose.', must: true },
      { name: 'Body and form', look: 'Line, curve and light. The silhouette must read.', must: true },
      { name: 'In-between', look: 'Laughing at themselves, a breath out, adjusting hair: the unguarded frames.' },
      { name: 'Details', look: 'Skin, lace, a hand on a collarbone.' }
    ],
    emotions: { tenderness: 1, concentration: 0.6, pout: 0.6, joy: 0.5, laughter: 0.6, sadness: 0.4, contempt: 0.3, awe: 0.4 },
    lookFor: ['Relaxed hands and shoulders', 'A gaze that holds or deliberately avoids the lens', 'Even, flattering skin'], forgive: ['Closed or lowered eyes', 'Soft focus that suits the mood']
  },
  {
    name: 'Fashion and editorial', family: 'fashion', tags: ['editorial', 'elegant', 'polished'], balance: 0.35,
    feeling: 'Line, attitude and the garment. Considered, never accidental.',
    chapters: STORY_PLANS.fashion.map((c) => ({ ...c, must: c.name === 'Hero look' })),
    emotions: {}, lookFor: ['The garment readable', 'Tension in the pose', 'A clean silhouette'], forgive: ['Motion in fabric']
  },
  {
    name: 'LARP and battle', family: 'event', tags: ['documentary', 'energetic', 'dramatic'], balance: 0.6,
    feeling: 'People inside the story: fury, fear, triumph, exhaustion. It should look like the world they built, not like a field with costumes.',
    chapters: [
      { name: 'World and camp', look: 'Place, banners, tents, gear: the setting without modern intrusions.' },
      { name: 'Characters', look: 'Portraits in character. Costume and make-up readable, the look in role.', must: true },
      { name: 'Before the fight', look: 'Lines forming, tension, orders, last looks between allies.' },
      { name: 'Battle', look: 'Peak action: weapons mid-swing, shields meeting, shouting faces. Motion is welcome.', must: true },
      { name: 'Drama and ritual', look: 'Scenes played between characters: confrontation, mourning, oaths.', must: true },
      { name: 'Aftermath', look: 'Exhaustion, the fallen, victors, laughter out of character.' }
    ],
    emotions: { fury: 1, anger: 0.9, fear: 0.9, concentration: 0.8, crying: 0.8, sadness: 0.7, awe: 0.7, surprise: 0.6, laughter: 0.5, joy: 0.4, contempt: 0.6, disgust: 0.3 },
    lookFor: ['Faces at full intensity', 'Clean backgrounds with no modern objects', 'Readable silhouettes of weapons and armour', 'Two fighters connected in one frame'],
    forgive: ['Motion blur in action', 'Dust, smoke and grain', 'Eyes closed in a shout']
  },
  {
    name: 'Fantasy and conceptual', family: 'portrait', tags: ['cinematic', 'dramatic', 'moody'], balance: 0.45,
    feeling: 'A character and a world in one frame. Atmosphere first.',
    chapters: [
      { name: 'Hero image', look: 'The one frame that is the concept: character, costume, light and place together.', must: true },
      { name: 'Character portraits', look: 'Face in role: the expression that belongs to this character.', must: true },
      { name: 'Wide and atmosphere', look: 'The figure small in the world; smoke, light, scale.' },
      { name: 'Movement', look: 'Fabric, hair, a gesture of power.' },
      { name: 'Details', look: 'Props, hands, costume work.' }
    ],
    emotions: { concentration: 0.8, awe: 0.8, anger: 0.6, fury: 0.6, sadness: 0.7, fear: 0.6, tenderness: 0.6, contempt: 0.5, joy: 0.1, laughter: 0 },
    lookFor: ['A silhouette that reads at thumbnail size', 'Light with direction', 'Nothing modern in the frame'], forgive: ['Deep shadows', 'Deliberate blur and haze']
  }
]

/** A new, empty style in a family, ready to be developed. */
export function newStyle(id: string, name: string, family: Style['family'], feeling = '', tags: string[] = []): Style {
  return {
    id, name, tags, feeling, family, createdAt: Date.now(), sources: [], profile: null, samples: [],
    chapters: STORY_PLANS[family], emotions: {}, balance: DEFAULT_BALANCE[family], lookFor: [], forgive: []
  }
}

/** Brings a style saved by an earlier version up to date. */
export function upgradeStyle(s: Style): Style {
  const family = s.family ?? 'other'
  return { ...s, family, chapters: s.chapters ?? STORY_PLANS[family], emotions: s.emotions ?? {}, balance: s.balance ?? DEFAULT_BALANCE[family], lookFor: s.lookFor ?? [], forgive: s.forgive ?? [] }
}

/** How much the style values each emotion: what was declared, moved by what the photographer's decisions showed. */
export function emotionWeights(style: Style | undefined): Record<string, number> {
  if (!style) return {}
  const out: Record<string, number> = { ...(FAMILY_EMOTIONS[style.family] ?? {}), ...style.emotions }
  for (const [name, lift] of Object.entries(style.emotionLift ?? {})) {
    if (lift.n < 8) continue
    out[name] = Math.max(-1, Math.min(1, (out[name] ?? DEFAULT_EMOTION_VALUE) + 0.5 * lift.w))
  }
  return out
}

/**
 * What the photographer's decisions say about each emotion: how much more (or
 * less) often frames showing it were kept than frames in general. Returned as
 * lifts to fold into the style.
 */
export function emotionLifts(shots: Shot[]): Record<string, { w: number; n: number }> {
  const decided = shots.filter((s) => s.decision && s.score)
  if (decided.length < 30) return {}
  const keptRate = decided.filter((s) => s.decision === 'pick').length / decided.length
  if (keptRate === 0 || keptRate === 1) return {}
  const by = new Map<string, { kept: number; n: number }>()
  for (const s of decided) {
    const e = s.score!.emotion
    if (!e || e.intensity < 0.3 || e.name === 'unnamed') continue
    const c = by.get(e.name) ?? { kept: 0, n: 0 }
    c.n++
    if (s.decision === 'pick') c.kept++
    by.set(e.name, c)
  }
  const out: Record<string, { w: number; n: number }> = {}
  for (const [name, c] of by) if (c.n >= 5) out[name] = { w: Math.max(-1, Math.min(1, (c.kept / c.n - keptRate) / Math.max(keptRate, 1 - keptRate))), n: c.n }
  return out
}

/** Folds one project's lifts into a style's running lifts, weighted by how many frames each rests on. */
export function mergeLifts(old: Style['emotionLift'], fresh: Record<string, { w: number; n: number }>): NonNullable<Style['emotionLift']> {
  const out = { ...(old ?? {}) }
  for (const [name, f] of Object.entries(fresh)) {
    const o = out[name]
    out[name] = o ? { w: (o.w * o.n + f.w * f.n) / (o.n + f.n), n: Math.min(2000, o.n + f.n) } : f
  }
  return out
}

/** What the active profiles say about choosing, for the editor's read. */
export function styleNotes(styles: Style[]): string {
  return styles
    .map((s) => {
      const lines = [
        s.tags.length ? `Atmosphere: ${s.tags.join(', ')}.` : '',
        s.feeling,
        s.lookFor?.length ? `Look for: ${s.lookFor.join('; ')}.` : '',
        s.forgive?.length ? `Forgive: ${s.forgive.join('; ')}.` : '',
        Object.keys(emotionWeights(s)).length
          ? `Emotions this style values most: ${Object.entries(emotionWeights(s)).filter(([, w]) => w >= 0.6).map(([n]) => n).join(', ') || 'none in particular'}; works against: ${Object.entries(emotionWeights(s)).filter(([, w]) => w <= -0.2).map(([n]) => n).join(', ') || 'none'}.`
          : '',
        ...(s.essence
          ? [s.essence.summary, ...s.essence.principles.map((p) => `- ${p}`), ...s.essence.forgive.map((f) => `- Forgives: ${f}`)]
          : s.profile
            ? ['Measured from the photographs this profile has learned from:', ...profileFacts(s.profile)]
            : [])
      ].filter(Boolean)
      return `Shoot style "${s.name}":\n${lines.join('\n')}`
    })
    .join('\n\n')
}
