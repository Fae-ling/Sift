// The emotion machine.
//
// The face model reports 51 measurements of a face's muscles (brows lowered,
// eyes wide, jaw open, lip corners up...). An emotion, here, is a named region
// of that measurement space: a "concept" with a starting description taken from
// the Facial Action Coding System and, increasingly, the examples it has been
// taught. Reading a face means finding the concept it lies closest to.
//
// It learns in three ways, all of them stored as plain examples:
//   - the photographer names a face ("this is grief", "this is battle fury");
//   - Claude names faces, during a read of the shoot or when asked directly;
//   - faces it cannot name are gathered into "pointers": groups of similar
//     unnamed expressions, kept until someone says what they are.
// New emotions can be created at any time, so the vocabulary grows with the
// photographer's work.

/** The face model's measurements, in the order they are stored on each face. */
export const SHAPES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen',
  'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft',
  'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper',
  'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft',
  'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight'
] as const

const at = (name: string): number => SHAPES.indexOf(name as (typeof SHAPES)[number])

/**
 * Expression cues: the measurements that carry emotion, left and right
 * averaged. Where the eyes are looking is left out: it says where someone
 * looks, not what they feel.
 */
export const CUES = [
  'browDown', 'browInnerUp', 'browOuterUp', 'eyeWide', 'eyeSquint', 'eyeClosed', 'cheekSquint', 'noseSneer', 'jawOpen', 'mouthSmile', 'mouthFrown',
  'mouthPress', 'mouthPucker', 'mouthFunnel', 'mouthStretch', 'mouthUpperUp', 'mouthLowerDown', 'chinRaise', 'mouthDimple', 'cheekPuff', 'smileAsym'
] as const
export type Cue = (typeof CUES)[number]

const PAIRS: Record<string, [string, string] | [string]> = {
  browDown: ['browDownLeft', 'browDownRight'], browInnerUp: ['browInnerUp'], browOuterUp: ['browOuterUpLeft', 'browOuterUpRight'],
  eyeWide: ['eyeWideLeft', 'eyeWideRight'], eyeSquint: ['eyeSquintLeft', 'eyeSquintRight'], eyeClosed: ['eyeBlinkLeft', 'eyeBlinkRight'],
  cheekSquint: ['cheekSquintLeft', 'cheekSquintRight'], noseSneer: ['noseSneerLeft', 'noseSneerRight'], jawOpen: ['jawOpen'],
  mouthSmile: ['mouthSmileLeft', 'mouthSmileRight'], mouthFrown: ['mouthFrownLeft', 'mouthFrownRight'], mouthPress: ['mouthPressLeft', 'mouthPressRight'],
  mouthPucker: ['mouthPucker'], mouthFunnel: ['mouthFunnel'], mouthStretch: ['mouthStretchLeft', 'mouthStretchRight'],
  mouthUpperUp: ['mouthUpperUpLeft', 'mouthUpperUpRight'], mouthLowerDown: ['mouthLowerDownLeft', 'mouthLowerDownRight'], chinRaise: ['mouthShrugLower'],
  mouthDimple: ['mouthDimpleLeft', 'mouthDimpleRight'], cheekPuff: ['cheekPuff']
}

/** A face's stored measurements (0..100 each) as expression cues (0..1 each). */
export function toCues(shapes: number[]): number[] {
  return CUES.map((cue) => {
    if (cue === 'smileAsym') return Math.abs(shapes[at('mouthSmileLeft')] - shapes[at('mouthSmileRight')]) / 100
    const names = PAIRS[cue]
    return names.reduce((s, n) => s + (shapes[at(n)] ?? 0), 0) / names.length / 100
  })
}

export interface EmotionExample {
  /** Expression cues, 0..1, in CUES order. */
  v: number[]
  source: 'you' | 'claude'
  at: number
  /** A small picture of the face, so the example can be shown and reviewed. */
  thumb?: string
}

export interface EmotionConcept {
  name: string
  description: string
  /** -1 painful .. 1 pleasant, and 0 still .. 1 intense: how the emotion feels, for grouping. */
  valence: number
  arousal: number
  /** Where the concept starts before it has examples: cue name to strength. */
  seed: Partial<Record<Cue, number>>
  examples: EmotionExample[]
  builtin: boolean
}

/** A group of similar strong expressions nobody has named yet. */
export interface Pointer {
  id: string
  centroid: number[]
  count: number
  thumbs: string[]
  firstSeen: number
}

export interface EmotionStore {
  version: number
  concepts: EmotionConcept[]
  pointers: Pointer[]
}

export const EMOTION_VERSION = 1
/** Examples kept per concept; the photographer's own are kept in preference to Claude's. */
const MAX_EXAMPLES = 160
const MAX_POINTERS = 36
/** How many imagined examples the starting description counts for, against real ones. */
const SEED_WEIGHT = 4

const builtin = (name: string, description: string, valence: number, arousal: number, seed: Partial<Record<Cue, number>>): EmotionConcept => ({
  name, description, valence, arousal, seed, examples: [], builtin: true
})

/**
 * The starting vocabulary, described with the Facial Action Coding System's
 * accounts of each expression. These are starting points: every example taught
 * pulls a concept toward what it actually looks like in this photographer's work.
 */
export const STARTING_EMOTIONS: EmotionConcept[] = [
  // On real faces the model reports a broad smile with the upper lip raised (teeth) and the brows pulled
  // down by the squint, so both are part of what joy and laughter look like to it.
  builtin('joy', 'A smile that reaches the eyes.', 0.8, 0.5, { mouthSmile: 0.85, eyeSquint: 0.6, cheekSquint: 0.4, mouthUpperUp: 0.55, browDown: 0.5 }),
  builtin('laughter', 'Open-mouthed laughing, eyes creased.', 0.9, 0.9, { mouthSmile: 0.9, jawOpen: 0.6, cheekSquint: 0.6, eyeSquint: 0.5, mouthUpperUp: 0.5, browDown: 0.4 }),
  builtin('tenderness', 'Soft, lowered or closed eyes with a faint smile.', 0.7, 0.2, { eyeClosed: 0.6, mouthSmile: 0.3 }),
  builtin('sadness', 'Inner brows raised, lip corners down.', -0.7, 0.3, { browInnerUp: 0.7, mouthFrown: 0.6, chinRaise: 0.3 }),
  builtin('crying', 'Face crumpled: brows up and together, eyes squeezed, mouth pulled wide.', -0.6, 0.8, { browInnerUp: 0.7, eyeSquint: 0.6, mouthFrown: 0.5, mouthStretch: 0.4, jawOpen: 0.3, cheekSquint: 0.3 }),
  builtin('anger', 'Brows lowered, eyes narrowed, lips pressed.', -0.7, 0.7, { browDown: 0.8, eyeSquint: 0.4, mouthPress: 0.5, noseSneer: 0.3 }),
  builtin('fury', 'A shout or battle cry: brows down, mouth wide open, nose wrinkled.', -0.5, 1, { browDown: 0.8, jawOpen: 0.8, noseSneer: 0.5, mouthStretch: 0.4, mouthUpperUp: 0.4 }),
  builtin('surprise', 'Brows up, eyes wide, jaw dropped.', 0.2, 0.8, { browInnerUp: 0.6, browOuterUp: 0.7, eyeWide: 0.7, jawOpen: 0.5 }),
  builtin('fear', 'Brows raised and drawn together, eyes wide, mouth stretched back.', -0.8, 0.9, { browInnerUp: 0.7, browOuterUp: 0.4, eyeWide: 0.8, mouthStretch: 0.6, jawOpen: 0.3 }),
  builtin('awe', 'Brows lifted, mouth softly open: wonder.', 0.6, 0.6, { browOuterUp: 0.5, browInnerUp: 0.4, eyeWide: 0.4, jawOpen: 0.4 }),
  builtin('disgust', 'Nose wrinkled, upper lip raised.', -0.7, 0.5, { noseSneer: 0.8, mouthUpperUp: 0.6, browDown: 0.3 }),
  builtin('contempt', 'One lip corner tightened: a smirk.', -0.3, 0.3, { smileAsym: 0.7, mouthDimple: 0.3, mouthPress: 0.2 }),
  builtin('concentration', 'Brows slightly lowered, mouth set: focus or determination.', 0, 0.5, { browDown: 0.5, mouthPress: 0.4, eyeSquint: 0.2 }),
  builtin('pout', 'Lips pushed forward: a kiss, a pout, a whistle.', 0.3, 0.4, { mouthPucker: 0.8 })
]

export const emptyEmotions = (): EmotionStore => ({ version: EMOTION_VERSION, concepts: STARTING_EMOTIONS.map((c) => ({ ...c, examples: [] })), pointers: [] })

const seedVector = (c: EmotionConcept): number[] => CUES.map((cue) => c.seed[cue] ?? 0)
const norm = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
const cosine = (a: number[], b: number[]): number => {
  const na = norm(a)
  const nb = norm(b)
  return na && nb ? a.reduce((s, x, i) => s + x * b[i], 0) / (na * nb) : 0
}

/** Where a concept currently sits: its starting description blended with what it has been taught. */
export function centroid(c: EmotionConcept): number[] {
  const hasSeed = Object.keys(c.seed).length > 0
  const seed = seedVector(c)
  // The photographer's examples count fully; Claude's count for half.
  let weight = hasSeed ? SEED_WEIGHT : 0
  const sum = seed.map((v) => v * weight)
  for (const e of c.examples) {
    const w = e.source === 'you' ? 1 : 0.5
    weight += w
    for (let i = 0; i < sum.length; i++) sum[i] += e.v[i] * w
  }
  return weight ? sum.map((v) => v / weight) : sum
}

/** How strongly a face is expressing anything at all, 0..1. */
export const intensityOf = (cues: number[]): number => Math.min(1, norm(cues) / 1.1)

/** Below this a face is at rest. */
export const CALM = 0.16
/** Similarity a face needs to its nearest concept to be given that name. */
export const RECOGNISED = 0.7

export interface EmotionRead {
  /** The nearest concept's name; 'calm' for a face at rest; null for a strong expression nothing matches. */
  name: string | null
  /** How alike the face and the concept are, 0..1. */
  similarity: number
  intensity: number
  /** The next nearest concept, when it is close enough to matter. */
  also?: string
}

/** Reads one face. `centroids` can be passed in to avoid recomputing them for every face of a shoot. */
export function readEmotion(cues: number[], store: EmotionStore, centroids = store.concepts.map(centroid)): EmotionRead {
  const intensity = intensityOf(cues)
  if (intensity < CALM) return { name: 'calm', similarity: 1, intensity }
  let best = -1
  let second = -1
  let bestSim = 0
  let secondSim = 0
  centroids.forEach((c, i) => {
    const sim = cosine(cues, c)
    if (sim > bestSim) {
      second = best
      secondSim = bestSim
      best = i
      bestSim = sim
    } else if (sim > secondSim) {
      second = i
      secondSim = sim
    }
  })
  if (best < 0 || bestSim < RECOGNISED) return { name: null, similarity: bestSim, intensity }
  return {
    name: store.concepts[best].name,
    similarity: bestSim,
    intensity,
    also: second >= 0 && secondSim > RECOGNISED && bestSim - secondSim < 0.06 ? store.concepts[second].name : undefined
  }
}

/** Teaches the machine that a face shows a named emotion, creating the emotion if it is new. */
export function teach(
  store: EmotionStore,
  name: string,
  cues: number[],
  source: EmotionExample['source'],
  thumb?: string,
  about?: { description?: string; valence?: number; arousal?: number }
): EmotionStore {
  const key = name.trim().toLowerCase()
  if (!key || key === 'calm') return store
  const example: EmotionExample = { v: cues.map((x) => Math.round(x * 100) / 100), source, at: Date.now(), thumb }
  const existing = store.concepts.find((c) => c.name === key)
  const concepts = existing
    ? store.concepts.map((c) => {
        if (c !== existing) return c
        let examples = [...c.examples, example]
        // When full, the oldest of Claude's go first, then the oldest of the photographer's.
        while (examples.length > MAX_EXAMPLES) {
          const drop = examples.findIndex((e) => e.source === 'claude')
          examples = examples.filter((_, i) => i !== (drop >= 0 ? drop : 0))
        }
        return { ...c, examples, description: c.description || about?.description || '' }
      })
    : [
        ...store.concepts,
        { name: key, description: about?.description ?? '', valence: about?.valence ?? 0, arousal: about?.arousal ?? 0.6, seed: {}, examples: [example], builtin: false }
      ]
  return { ...store, concepts }
}

/** Similarity above which two unnamed expressions belong to the same pointer. */
const SAME_POINTER = 0.9

/**
 * Notes a strong expression the machine could not name. Similar ones gather
 * into a pointer, so that one answer from the photographer or Claude teaches
 * the machine about all of them.
 */
export function notice(store: EmotionStore, cues: number[], thumb: string | undefined): EmotionStore {
  let nearest = -1
  let sim = 0
  store.pointers.forEach((p, i) => {
    const s = cosine(cues, p.centroid)
    if (s > sim) {
      sim = s
      nearest = i
    }
  })
  if (nearest >= 0 && sim >= SAME_POINTER) {
    const pointers = store.pointers.map((p, i) =>
      i === nearest
        ? {
            ...p,
            centroid: p.centroid.map((v, k) => (v * p.count + cues[k]) / (p.count + 1)),
            count: p.count + 1,
            thumbs: thumb && p.thumbs.length < 6 ? [...p.thumbs, thumb] : p.thumbs
          }
        : p
    )
    return { ...store, pointers }
  }
  const fresh: Pointer = { id: `p${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`, centroid: [...cues], count: 1, thumbs: thumb ? [thumb] : [], firstSeen: Date.now() }
  // When full, the smallest pointers make room: an expression seen once is the least worth asking about.
  const pointers = [...store.pointers, fresh].sort((a, b) => b.count - a.count).slice(0, MAX_POINTERS)
  return { ...store, pointers }
}

/** Names a pointer: everything it gathered becomes what the machine knows about that emotion. */
export function namePointer(store: EmotionStore, pointerId: string, name: string, source: EmotionExample['source'], about?: Parameters<typeof teach>[5]): EmotionStore {
  const p = store.pointers.find((x) => x.id === pointerId)
  if (!p) return store
  let next = teach(store, name, p.centroid, source, p.thumbs[0], about)
  // A pointer seen many times is stronger evidence than a single face.
  for (let i = 1; i < Math.min(4, p.count); i++) next = teach(next, name, p.centroid, source, p.thumbs[i])
  return { ...next, pointers: next.pointers.filter((x) => x.id !== pointerId) }
}

export const dismissPointer = (store: EmotionStore, pointerId: string): EmotionStore => ({ ...store, pointers: store.pointers.filter((p) => p.id !== pointerId) })

/** Removes a taught emotion, or resets a starting one to its description. */
export function forgetEmotion(store: EmotionStore, name: string): EmotionStore {
  return { ...store, concepts: store.concepts.flatMap((c) => (c.name !== name ? [c] : c.builtin ? [{ ...c, examples: [] }] : [])) }
}

/** The cue names an emotion is most made of, for showing what the machine looks for. */
export function signature(c: EmotionConcept, limit = 4): string[] {
  const v = centroid(c)
  return CUES.map((cue, i) => ({ cue, w: v[i] }))
    .filter((x) => x.w > 0.18)
    .sort((a, b) => b.w - a.w)
    .slice(0, limit)
    .map((x) => CUE_WORDS[x.cue])
}

const CUE_WORDS: Record<Cue, string> = {
  browDown: 'brows lowered', browInnerUp: 'inner brows raised', browOuterUp: 'brows lifted', eyeWide: 'eyes wide', eyeSquint: 'eyes narrowed',
  eyeClosed: 'eyes closed or lowered', cheekSquint: 'cheeks raised', noseSneer: 'nose wrinkled', jawOpen: 'mouth open', mouthSmile: 'lip corners up',
  mouthFrown: 'lip corners down', mouthPress: 'lips pressed', mouthPucker: 'lips pushed forward', mouthFunnel: 'lips rounded', mouthStretch: 'mouth stretched wide',
  mouthUpperUp: 'upper lip raised', mouthLowerDown: 'lower lip pulled down', chinRaise: 'chin pushed up', mouthDimple: 'lip corners tightened',
  cheekPuff: 'cheeks puffed', smileAsym: 'one-sided smile'
}

/**
 * How much each kind of shoot values an emotion, from -1 (works against the
 * picture) to 1 (what the picture is for), before a style says otherwise.
 * Any strong, recognised emotion is worth something everywhere.
 */
export const FAMILY_EMOTIONS: Record<string, Record<string, number>> = {
  wedding: { joy: 0.8, laughter: 1, tenderness: 0.9, crying: 0.9, surprise: 0.7, awe: 0.7, sadness: 0.4, pout: 0.4, concentration: 0.1, anger: -0.3, fury: -0.2, fear: -0.2, disgust: -0.5, contempt: -0.5 },
  event: { joy: 0.7, laughter: 0.9, surprise: 0.7, awe: 0.7, tenderness: 0.5, concentration: 0.3, crying: 0.4, pout: 0.2, sadness: 0.1, anger: -0.2, fury: 0, fear: -0.1, disgust: -0.4, contempt: -0.4 },
  portrait: { joy: 0.5, laughter: 0.6, tenderness: 0.7, sadness: 0.5, concentration: 0.5, awe: 0.5, surprise: 0.4, contempt: 0.3, pout: 0.3, crying: 0.5, anger: 0.3, fury: 0.2, fear: 0.2, disgust: -0.2 },
  fashion: { concentration: 0.6, contempt: 0.5, pout: 0.5, anger: 0.4, fury: 0.4, awe: 0.3, tenderness: 0.3, sadness: 0.3, joy: 0.1, laughter: 0.2, surprise: 0.2, crying: 0.1, fear: 0.2, disgust: -0.1 },
  other: { joy: 0.5, laughter: 0.6, tenderness: 0.5, surprise: 0.5, awe: 0.5, sadness: 0.4, crying: 0.5, anger: 0.4, fury: 0.5, fear: 0.4, concentration: 0.4, contempt: 0.2, pout: 0.3, disgust: 0 }
}
/** An emotion a style has no opinion about, including one taught later: strong feeling is worth a look. */
export const DEFAULT_EMOTION_VALUE = 0.45
/** A strong expression the machine cannot name is still an expression. */
export const UNNAMED_EMOTION_VALUE = 0.35
