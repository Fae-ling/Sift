// What Atelier learns from photographs the photographer provides, beyond the
// culling taste (which has its own module, learner.ts):
//
//  - norms:     how their finished photographs measure, so the diagnosis judges a
//               new photo against their own work rather than a general standard
//  - houseLook: the average change from their unedited frames to their finished ones
//  - feedback:  which findings they agree with and which they wave away
//
// Everything is stored as plain samples and recomputed on use, so more training
// always refines the result and nothing has to be migrated.

import { DEFAULT_LIMITS, type Limits } from './diagnose'
import type { Look } from './look'

export const TRAINING_VERSION = 1
/** Samples kept per measurement; the oldest are dropped first. */
const MAX_SAMPLES = 3000
/** Samples needed before a personal norm replaces a general default. */
export const MIN_NORM = 12

export interface TrainingEvent {
  at: number
  kind: 'finished' | 'look' | 'decisions'
  name: string
  count: number
}

export interface Training {
  version: number
  /** Diagnosis measurements of finished photographs: metric name to samples. */
  norms: Record<string, number[]>
  /** The learned look, and how many before/after pairs it is the average of. */
  houseLook: { curve: number[]; shift: [number, number][]; saturation: number; pairs: number } | null
  /** Per finding topic: how often the photographer agreed, and how often they said it is not a problem. */
  feedback: Record<string, { agree: number; dismiss: number }>
  log: TrainingEvent[]
}

export const emptyTraining = (): Training => ({ version: TRAINING_VERSION, norms: {}, houseLook: null, feedback: {}, log: [] })

/** Adds one photograph's measurements to a store of samples. */
export function addSamples(store: Record<string, number[]>, values: Record<string, number>): Record<string, number[]> {
  const out = { ...store }
  for (const [key, v] of Object.entries(values)) {
    if (!Number.isFinite(v)) continue
    out[key] = [...(out[key] ?? []), Math.round(v * 1000) / 1000].slice(-MAX_SAMPLES)
  }
  return out
}

export function quantile(samples: number[], q: number): number {
  const s = [...samples].sort((a, b) => a - b)
  if (!s.length) return NaN
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo)
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Which limits each finding topic depends on, and whether a larger limit is more lenient. */
const TOPIC_LIMITS: Record<string, { keys: (keyof Limits)[]; lenientWhenLarger: boolean }> = {
  'Subject merges with the background': { keys: ['mergedMost', 'mergedSome'], lenientWhenLarger: true },
  Separation: { keys: ['mergedSome'], lenientWhenLarger: true },
  'Where the eye goes': { keys: ['attentionLow'], lenientWhenLarger: false },
  Skin: { keys: ['blotchySome', 'blotchyMost'], lenientWhenLarger: true },
  'Skin colour varies': { keys: ['skinSpread'], lenientWhenLarger: true },
  'Face and body do not match': { keys: ['faceVsBody'], lenientWhenLarger: true },
  'Background clutter at the outline': { keys: ['clutter'], lenientWhenLarger: true },
  'Background more colourful than the subject': { keys: ['bgSaturation'], lenientWhenLarger: true },
  'Background busier than the subject': { keys: ['bgContrast'], lenientWhenLarger: true }
}
export const canGiveFeedback = (topic: string): boolean => topic in TOPIC_LIMITS

/**
 * How much a limit is relaxed (above 1) or tightened (below 1) by feedback:
 * each net "not a problem" moves it 8%, each net "agree" moves it back, within bounds.
 */
export function leniency(feedback: Training['feedback'][string] | undefined): number {
  if (!feedback) return 1
  return clamp(1 + 0.08 * (feedback.dismiss - feedback.agree), 0.7, 1.8)
}

/**
 * The diagnosis limits for this photographer. Where they have provided enough
 * finished work, a measurement becomes a finding when it is worse than 85% of
 * their own finished photographs, kept within sensible bounds of the general
 * default so that a small or unusual training set cannot switch a check off.
 * Feedback then relaxes or tightens each limit.
 */
export function limitsFrom(t: Training): Limits {
  const L: Limits = { ...DEFAULT_LIMITS, skinHue: [...DEFAULT_LIMITS.skinHue] }
  const D = DEFAULT_LIMITS
  const has = (key: string): boolean => (t.norms[key]?.length ?? 0) >= MIN_NORM
  const high = (key: string, fallback: number, lo = 0.6, hi = 2): number =>
    has(key) ? clamp(quantile(t.norms[key], 0.85), fallback * lo, fallback * hi) : fallback
  const learned: string[] = []
  const note = (key: string): void => void (has(key) && learned.push(key))

  L.mergedSome = high('merged', D.mergedSome)
  L.mergedMost = Math.max(L.mergedSome * 1.6, high('merged', D.mergedMost, 0.6, 1.8))
  note('merged')
  if (has('attention')) L.attentionLow = clamp(quantile(t.norms.attention, 0.15), D.attentionLow * 0.5, D.attentionLow * 1.4)
  note('attention')
  L.blotchySome = high('blotchy', D.blotchySome)
  L.blotchyMost = Math.max(L.blotchySome * 1.3, D.blotchyMost)
  note('blotchy')
  if (has('skinHue')) {
    // Their own band, a little widened, but never drifting far from where human skin lies.
    L.skinHue = [clamp(quantile(t.norms.skinHue, 0.05) - 2, 30, 55), clamp(quantile(t.norms.skinHue, 0.95) + 2, 50, 75)]
  }
  note('skinHue')
  L.skinSpread = high('skinSpread', D.skinSpread)
  L.faceVsBody = high('faceVsBody', D.faceVsBody)
  L.clutter = high('clutter', D.clutter, 0.8, 1.8)
  L.bgSaturation = high('bgSaturation', D.bgSaturation, 0.8, 1.8)
  L.bgContrast = high('bgContrast', D.bgContrast, 0.8, 1.8)
  note('clutter')

  for (const [topic, { keys, lenientWhenLarger }] of Object.entries(TOPIC_LIMITS)) {
    const k = leniency(t.feedback[topic])
    if (k === 1) continue
    for (const key of keys) (L[key] as number) = (L[key] as number) * (lenientWhenLarger ? k : 1 / k)
  }
  const photos = Math.max(0, ...Object.values(t.norms).map((s) => s.length))
  L.basis = learned.length ? `your ${photos} finished photographs` : ''
  return L
}

/** Folds one more before/after look into the running average. */
export function addToHouseLook(house: Training['houseLook'], look: Look): NonNullable<Training['houseLook']> {
  const n = house?.pairs ?? 0
  const mix = (old: number, fresh: number): number => (old * n + fresh) / (n + 1)
  return {
    curve: Array.from(look.curve, (v, i) => Math.round(mix(house?.curve[i] ?? v, v) * 10000) / 10000),
    shift: look.shift.map(([cb, cr], z) => [mix(house?.shift[z][0] ?? cb, cb), mix(house?.shift[z][1] ?? cr, cr)] as [number, number]),
    saturation: mix(house?.saturation ?? look.saturation, look.saturation),
    pairs: n + 1
  }
}

export const houseLookAsLook = (h: NonNullable<Training['houseLook']>): Look => ({
  curve: Float32Array.from(h.curve),
  shift: h.shift,
  saturation: h.saturation,
  estimated: false
})

/** A plain-language account of what has been learned, for the Training screen. */
export function trainingSummary(t: Training): { diagnosis: string; look: string } {
  const photos = Math.max(0, ...Object.values(t.norms).map((s) => s.length))
  const med = (key: string): string => quantile(t.norms[key] ?? [], 0.5).toFixed(key === 'skinHue' ? 0 : 2)
  return {
    diagnosis:
      photos === 0
        ? 'Nothing yet. The diagnosis uses general limits.'
        : photos < MIN_NORM
          ? `${photos} finished photographs so far; ${MIN_NORM} are needed before your own norms replace the general limits.`
          : `Learned from ${photos} finished photographs. In your work the subject typically holds ${Math.round(Number(med('attention')) * 100)}% of the attention and loses ${Math.round(Number(med('merged')) * 100)}% of its outline${t.norms.skinHue?.length >= MIN_NORM ? `; skin hue sits around ${med('skinHue')}°` : ''}. A new photo is flagged when it is worse than 85% of these.`,
    look: t.houseLook ? `Averaged from ${t.houseLook.pairs} before/after pair${t.houseLook.pairs === 1 ? '' : 's'}. Save it as a LUT or preset from the Look extractor.` : 'Nothing yet.'
  }
}
