// Gestures: what bodies are doing.
//
// The pose model reports where shoulders, elbows, wrists, hips, knees and
// ankles are. From those, a handful of measurements are taken per body (arms
// up, hand to face, leaning, close to someone...). A gesture, like an emotion,
// is a named region of that measurement space: it starts from a description
// and is pulled toward the examples it is taught, by the photographer or by
// Claude's reads. New gestures ("sword raised", "bouquet toss") can be added
// at any time.

import type { BodyInfo } from '@shared/types'

export const GESTURE_CUES = [
  'armsUp', 'oneArmUp', 'armsWide', 'handToFace', 'handsTogether', 'armsCrossed', 'handsOnHips', 'reach',
  'lean', 'headDown', 'headTilt', 'turnedAway', 'stride', 'low', 'near', 'touch'
] as const
export type GestureCue = (typeof GESTURE_CUES)[number]

export interface Mark {
  x: number
  y: number
  /** How sure the model is that the point is visible, 0..1. */
  v: number
}

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v))
const SEEN = 0.5
// Indices of the pose model's landmarks.
const NOSE = 0, EAR_L = 7, EAR_R = 8, SH_L = 11, SH_R = 12, EL_L = 13, EL_R = 14, WR_L = 15, WR_R = 16, HIP_L = 23, HIP_R = 24, KN_L = 25, KN_R = 26, AN_L = 27, AN_R = 28

/**
 * The gesture measurements of one body, 0..1 each, without the two that depend
 * on other people (`near`, `touch`), which `withOthers` fills in. `marks` are
 * the pose model's 33 points in 0..1 image coordinates; `aspect` is the
 * image's width over its height, so that distances are true.
 */
export function poseCues(marks: Mark[], aspect: number): number[] {
  const p = (i: number): Mark => ({ x: marks[i].x * aspect, y: marks[i].y, v: marks[i].v })
  const seen = (...ids: number[]): boolean => ids.every((i) => marks[i].v >= SEEN)
  const dist = (a: Mark, b: Mark): number => Math.hypot(a.x - b.x, a.y - b.y)
  const mid = (a: Mark, b: Mark): Mark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) })
  const out = Object.fromEntries(GESTURE_CUES.map((c) => [c, 0])) as Record<GestureCue, number>
  if (!seen(SH_L, SH_R)) return GESTURE_CUES.map(() => 0)

  const shL = p(SH_L), shR = p(SH_R)
  const shoulders = mid(shL, shR)
  const hasHips = seen(HIP_L, HIP_R)
  const hips = hasHips ? mid(p(HIP_L), p(HIP_R)) : { x: shoulders.x, y: shoulders.y + dist(shL, shR) * 1.5, v: 0 }
  const torso = dist(shoulders, hips)
  // A body turned sideways has narrow shoulders, so the torso length steadies the scale.
  const s = Math.max(dist(shL, shR), 0.6 * torso, 1e-4)

  const arms = [
    { sh: shL, el: p(EL_L), wr: p(WR_L), hip: p(HIP_L), ok: seen(WR_L), okEl: seen(EL_L) },
    { sh: shR, el: p(EL_R), wr: p(WR_R), hip: p(HIP_R), ok: seen(WR_R), okEl: seen(EL_R) }
  ]
  const up = arms.map((a) => (a.ok ? clamp((a.sh.y - a.wr.y) / s + 0.1) : 0))
  out.armsUp = Math.min(up[0], up[1]) * 0.7 + ((up[0] + up[1]) / 2) * 0.3
  out.oneArmUp = Math.abs(up[0] - up[1])
  out.armsWide = arms.reduce((sum, a) => sum + (a.ok ? clamp((Math.abs(a.wr.x - a.sh.x) / s - 0.35) / 1.1) : 0), 0) / 2
  if (seen(NOSE)) out.handToFace = Math.max(...arms.map((a) => (a.ok ? 1 - clamp(dist(a.wr, p(NOSE)) / s / 0.9) : 0)))
  if (arms[0].ok && arms[1].ok) {
    const chest = arms.every((a) => a.wr.y > a.sh.y - 0.1 * s && a.wr.y < hips.y)
    out.handsTogether = 1 - clamp(dist(arms[0].wr, arms[1].wr) / s / 0.6)
    // Facing the camera the left wrist is on the image's right; crossed, each sits on the other's side.
    const facing = shL.x > shR.x ? 1 : -1
    const crossed = clamp((facing * (arms[1].wr.x - arms[0].wr.x)) / s / 0.5)
    out.armsCrossed = chest ? crossed : 0
  }
  if (hasHips) {
    out.handsOnHips = arms.reduce((sum, a) => sum + (a.ok && a.okEl ? (1 - clamp(dist(a.wr, a.hip) / s / 0.55)) * clamp((Math.abs(a.el.x - a.sh.x) / s - 0.15) / 0.3) : 0), 0) / 2
    out.lean = clamp(Math.abs(shoulders.x - hips.x) / Math.max(torso, 1e-4) / 0.5)
  }
  out.reach = Math.max(
    ...arms.map((a) => {
      if (!a.ok || !a.okEl) return 0
      const upper = dist(a.sh, a.el)
      const fore = dist(a.el, a.wr)
      const straight = clamp((dist(a.sh, a.wr) / Math.max(upper + fore, 1e-4) - 0.85) / 0.13)
      return straight * clamp((Math.abs(a.wr.x - a.sh.x) / s - 0.5) / 0.8)
    })
  )
  if (seen(NOSE, EAR_L, EAR_R)) {
    const earL = p(EAR_L), earR = p(EAR_R)
    const ears = mid(earL, earR)
    out.headDown = clamp((p(NOSE).y - ears.y) / s / 0.3 - 0.25)
    out.headTilt = clamp(Math.abs(earL.y - earR.y) / Math.max(dist(earL, earR), 1e-4) / 0.6 - 0.2)
  }
  // Seen from behind, the left shoulder is on the image's left.
  out.turnedAway = shL.x < shR.x ? clamp((shR.x - shL.x) / Math.max(0.6 * torso, 1e-4) / 0.5) : 0
  if (seen(AN_L, AN_R)) out.stride = clamp((Math.abs(p(AN_L).x - p(AN_R).x) / s - 0.6) / 1.0)
  if (hasHips && seen(KN_L, KN_R)) out.low = 1 - clamp((mid(p(KN_L), p(KN_R)).y - hips.y) / Math.max(torso, 1e-4) / 0.6)
  return GESTURE_CUES.map((c) => Math.round(out[c] * 100) / 100)
}

const NEAR = GESTURE_CUES.indexOf('near')
const TOUCH = GESTURE_CUES.indexOf('touch')

/**
 * Fills in what a body's gesture owes to other people: how close the nearest
 * one is, and whether their boxes overlap enough to be touching or embracing.
 * Boxes are in 0..1 image coordinates; cues are 0..1.
 */
export function withOthers(bodies: { x: number; y: number; w: number; h: number; g: number[] }[], aspect: number): void {
  bodies.forEach((a, i) => {
    let near = 0
    let touch = 0
    bodies.forEach((b, j) => {
      if (i === j) return
      const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) * aspect
      const width = ((a.w + b.w) / 2) * aspect
      const level = 1 - clamp(Math.abs(a.y - b.y) / Math.max(a.h, b.h) / 0.6)
      near = Math.max(near, level * (1 - clamp((gap / Math.max(width, 1e-4) - 0.8) / 1.2)))
      const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) / Math.max(1e-4, Math.min(a.w, b.w))
      touch = Math.max(touch, level * clamp((overlap - 0.25) / 0.4))
    })
    a.g[NEAR] = Math.round(near * 100) / 100
    a.g[TOUCH] = Math.round(touch * 100) / 100
  })
}

// --- the gesture machine -------------------------------------------------------

export interface GestureExample {
  v: number[]
  source: 'you' | 'claude'
  at: number
}

export interface GestureConcept {
  name: string
  description: string
  /** How much a gesture is worth to a picture before any style or decision says otherwise, -1..1. */
  value: number
  seed: Partial<Record<GestureCue, number>>
  examples: GestureExample[]
  builtin: boolean
}

export interface GestureStore {
  version: number
  concepts: GestureConcept[]
}

export const GESTURE_VERSION = 1
const MAX_EXAMPLES = 120
const SEED_WEIGHT = 4

const start = (name: string, description: string, value: number, seed: Partial<Record<GestureCue, number>>): GestureConcept => ({ name, description, value, seed, examples: [], builtin: true })

export const STARTING_GESTURES: GestureConcept[] = [
  start('arms raised', 'Both arms above the shoulders: a cheer, a victory, a dance.', 0.7, { armsUp: 0.9, armsWide: 0.3 }),
  start('raised hand', 'One arm up: a wave, a toast, a point, a weapon lifted.', 0.55, { oneArmUp: 0.9, armsUp: 0.3 }),
  start('open arms', 'Arms spread wide: a welcome, a run-up to an embrace.', 0.6, { armsWide: 0.9 }),
  start('hand to face', 'A hand at the mouth, cheek or eyes: wiping a tear, hiding a laugh, thinking.', 0.5, { handToFace: 0.9 }),
  start('hands together', 'Hands meeting in front of the body: clapping, praying, holding something small.', 0.3, { handsTogether: 0.9 }),
  start('arms crossed', 'Arms folded across the chest.', 0.05, { armsCrossed: 0.9, handsTogether: 0.3 }),
  start('hands on hips', 'Hands at the hips, elbows out.', 0.15, { handsOnHips: 0.9 }),
  start('reaching', 'An arm stretched out toward someone or something.', 0.5, { reach: 0.9, armsWide: 0.4 }),
  start('embrace', 'Two bodies overlapping: a hug, a hold, a dance in hold.', 0.85, { touch: 0.9, near: 0.7 }),
  start('side by side', 'Standing close to someone without touching.', 0.2, { near: 0.9 }),
  start('leaning', 'The upper body tipped away from upright: leaning in, leaning on, off balance.', 0.35, { lean: 0.9 }),
  start('bowed head', 'The head lowered: reading, praying, shy, overcome.', 0.4, { headDown: 0.9 }),
  start('turned away', 'Seen from behind.', 0.15, { turnedAway: 0.9 }),
  start('in motion', 'Legs wide apart: a stride, a run, a lunge, a dance step.', 0.55, { stride: 0.9 }),
  start('seated or crouched', 'Knees up near the hips: sitting, kneeling, crouching.', 0.1, { low: 0.9 })
]

export const emptyGestures = (): GestureStore => ({ version: GESTURE_VERSION, concepts: STARTING_GESTURES.map((c) => ({ ...c, examples: [] })) })

const norm = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
const cosine = (a: number[], b: number[]): number => {
  const na = norm(a)
  const nb = norm(b)
  return na && nb ? a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0) / (na * nb) : 0
}

/** Where a gesture sits: its description blended with what it has been taught. */
export function gestureCentroid(c: GestureConcept): number[] {
  let weight = Object.keys(c.seed).length ? SEED_WEIGHT : 0
  const sum = GESTURE_CUES.map((cue) => (c.seed[cue] ?? 0) * weight)
  for (const e of c.examples) {
    const w = e.source === 'you' ? 1 : 0.5
    weight += w
    for (let i = 0; i < sum.length; i++) sum[i] += (e.v[i] ?? 0) * w
  }
  return weight ? sum.map((v) => v / weight) : sum
}

/** Below this a body is simply standing or sitting there. */
export const AT_REST = 0.3
const RECOGNISED = 0.68

export interface GestureRead {
  /** The gesture's name; null when the body is at rest or doing something the machine has no name for. */
  name: string | null
  intensity: number
  value: number
}

/** Reads one body's gesture from its stored measurements (0..100 each). */
export function readGesture(g: number[], store: GestureStore, centroids = store.concepts.map(gestureCentroid)): GestureRead {
  const cues = g.map((x) => x / 100)
  const intensity = Math.min(1, norm(cues) / 1.0)
  if (intensity < AT_REST) return { name: null, intensity, value: 0 }
  let best = -1
  let bestSim = 0
  centroids.forEach((c, i) => {
    const sim = cosine(cues, c)
    if (sim > bestSim) {
      best = i
      bestSim = sim
    }
  })
  if (best < 0 || bestSim < RECOGNISED) return { name: null, intensity, value: 0 }
  return { name: store.concepts[best].name, intensity, value: store.concepts[best].value }
}

/** The gesture that leads a frame: the strongest named one, larger bodies counting for more. */
export function leadGesture(bodies: BodyInfo[] | undefined, store: GestureStore, centroids?: number[][]): (GestureRead & { name: string }) | null {
  let lead: (GestureRead & { name: string }) | null = null
  let strongest = 0
  for (const b of bodies ?? []) {
    const r = readGesture(b.g, store, centroids)
    if (!r.name) continue
    const pull = r.intensity * Math.sqrt(b.w * b.h) * (0.5 + Math.max(0, r.value))
    if (pull > strongest) {
      strongest = pull
      lead = r as GestureRead & { name: string }
    }
  }
  return lead
}

/** Teaches that a body (its stored measurements) shows a named gesture, creating the gesture if it is new. */
export function teachGesture(store: GestureStore, name: string, g: number[], source: GestureExample['source'], description = ''): GestureStore {
  const key = name.trim().toLowerCase()
  if (!key) return store
  const example: GestureExample = { v: g.map((x) => x / 100), source, at: Date.now() }
  const existing = store.concepts.find((c) => c.name === key)
  if (!existing) return { ...store, concepts: [...store.concepts, { name: key, description, value: 0.45, seed: {}, examples: [example], builtin: false }] }
  return {
    ...store,
    concepts: store.concepts.map((c) => {
      if (c !== existing) return c
      let examples = [...c.examples, example]
      while (examples.length > MAX_EXAMPLES) {
        const drop = examples.findIndex((e) => e.source === 'claude')
        examples = examples.filter((_, i) => i !== (drop >= 0 ? drop : 0))
      }
      return { ...c, examples, description: c.description || description }
    })
  }
}

export const forgetGesture = (store: GestureStore, name: string): GestureStore => ({
  ...store,
  concepts: store.concepts.flatMap((c) => (c.name !== name ? [c] : c.builtin ? [{ ...c, examples: [] }] : []))
})
