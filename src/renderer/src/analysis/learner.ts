// Learns the photographer's taste from their own decisions, and checks itself.
//
// Every decided frame becomes an example: the same named measurements the
// suggestions already use, plus what the photographer did. A small linear model
// is trained to rank the frame they kept above the frames they passed over in
// the same burst, and to tell keepers from rejects overall. Because the inputs
// are named measurements, what it has learned can be read out in words.
//
// Three things keep the learning honest:
//  1. A fifth of all bursts are held back and never trained on. The learned
//     model only gets a say in suggestions to the extent it beats the built-in
//     rules on those held-back bursts.
//  2. A suggestion accepted with one key teaches little (the suggestion may
//     have caused the choice); a choice made by hand teaches more; a choice
//     made with no suggestion shown teaches the most. Examples are weighted
//     accordingly, in training and in the self-check alike.
//  3. The model is retrained from the stored examples each time, so a change of
//     mind in an old project, or a change to the measurements, cannot leave it
//     in a stale state.

import type { Genre, Shot } from '@shared/types'
import { readMoment } from './scoring'

/** Bump when the feature list changes: older stored examples are then set aside. */
export const FEATURE_VERSION = 2

interface Feature {
  key: string
  /** How to say "the photographer favours this" / "avoids this". */
  more: string
  less: string
}

export const FEATURES: Feature[] = [
  { key: 'bias', more: '', less: '' },
  { key: 'focus', more: 'sharp frames', less: 'sharpness matters little to you' },
  { key: 'eyes', more: 'open, sharp eyes', less: 'you forgive eyes that are closed or soft' },
  { key: 'exposure', more: 'clean exposure', less: 'you forgive exposure problems' },
  { key: 'hasFace', more: 'frames with people', less: 'frames without people' },
  { key: 'expression', more: 'joy on faces', less: 'quiet, unsmiling faces' },
  { key: 'connection', more: 'closeness between people', less: 'people apart or alone' },
  { key: 'laughing', more: 'open laughter', less: 'you pass over open laughter' },
  { key: 'blink', more: 'you often keep closed or lowered eyes', less: 'you avoid closed eyes' },
  { key: 'softFace', more: 'you often keep frames with soft eyes', less: 'you avoid soft eyes' },
  { key: 'soft', more: 'you often keep blurred frames', less: 'you avoid blurred frames' },
  { key: 'badExposure', more: 'you often keep very bright or very dark frames', less: 'you avoid clipped or very dark frames' },
  { key: 'faceSize', more: 'faces large in the frame', less: 'faces small in the frame' },
  { key: 'manyFaces', more: 'frames with many people', less: 'frames with few people' },
  { key: 'closeUp', more: 'close-ups', less: 'fewer close-ups' },
  { key: 'medium', more: 'medium shots', less: 'fewer medium shots' },
  { key: 'wide', more: 'wide shots', less: 'fewer wide shots' },
  { key: 'group', more: 'group shots', less: 'fewer group shots' },
  { key: 'detail', more: 'details and scenes', less: 'fewer details' },
  { key: 'claude', more: "frames Claude's read rated highly", less: "you often disagree with Claude's read" },
  { key: 'peak', more: 'the peak of a burst', less: 'the frame beside the peak' },
  { key: 'focusVsBest', more: 'the sharpest take of a moment', less: 'you do not insist on the sharpest take' },
  { key: 'exprVsBest', more: 'the most expressive take of a moment', less: 'you do not insist on the most expressive take' },
  { key: 'bright', more: 'brighter frames', less: 'darker frames' },
  { key: 'contrast', more: 'contrasty frames', less: 'softer, flatter frames' },
  { key: 'saturation', more: 'colourful frames', less: 'muted frames' },
  { key: 'emotionValue', more: 'the emotions your style looks for', less: 'frames whose emotion your style does not look for' },
  { key: 'intensity', more: 'strong expressions', less: 'quiet faces' },
  { key: 'rare', more: 'emotions that are rare in the shoot', less: 'you pass over rare emotions' },
  { key: 'separation', more: 'subjects that stand clear of the background', less: 'you do not mind a subject merging with the background' },
  { key: 'holdsEye', more: 'frames where the subject holds the eye', less: 'frames where the eye wanders' },
  { key: 'keyPerson', more: 'frames with a key person', less: 'frames without the key people' },
  { key: 'gesture', more: 'a telling gesture', less: 'bodies at rest' },
  { key: 'happening', more: 'frames where something recognisable is happening', less: 'frames where nothing in particular happens' }
]

const index = Object.fromEntries(FEATURES.map((f, i) => [f.key, i])) as Record<string, number>

/** The measurements of one frame as numbers between about 0 and 1, in FEATURES order. */
export function featuresOf(shot: Shot, stack: Shot[]): number[] {
  const a = shot.analysis!
  const score = shot.score!
  const moment = readMoment(a.faces)
  const x = new Array<number>(FEATURES.length).fill(0)
  const set = (key: string, v: number): void => void (x[index[key]] = Math.round(v * 1000) / 1000)
  const warn = (w: string): number => (score.warnings.includes(w as never) ? 1 : 0)
  const bestFocus = Math.max(...stack.map((s) => s.score?.focus ?? 0))
  const bestExpr = Math.max(...stack.map((s) => readMoment(s.analysis!.faces)?.expression ?? 0))

  set('bias', 1)
  set('focus', score.focus / 100)
  set('eyes', score.faces === null ? 0.5 : score.faces / 100)
  set('exposure', score.exposure / 100)
  set('hasFace', moment ? 1 : 0)
  set('expression', moment?.expression ?? 0)
  set('connection', moment?.connection ?? 0)
  set('laughing', moment?.laughing ? 1 : 0)
  set('blink', warn('blink'))
  set('softFace', warn('soft-face'))
  set('soft', warn('soft'))
  set('badExposure', Math.max(warn('clipped'), warn('dark')))
  set('faceSize', Math.min(1, (a.faces[0]?.h ?? 0) * 2))
  set('manyFaces', Math.min(1, a.faces.length / 6))
  set('closeUp', a.shotType === 'close-up' ? 1 : 0)
  set('medium', a.shotType === 'medium' ? 1 : 0)
  set('wide', a.shotType === 'wide' ? 1 : 0)
  set('group', a.shotType === 'group' ? 1 : 0)
  set('detail', a.shotType === 'detail' ? 1 : 0)
  // Centred on 5, so an unread frame (0) is neutral rather than "rated low".
  set('claude', shot.read ? (shot.read.moment - 5) / 5 : 0)
  set('peak', score.tags.includes('peak') ? 1 : 0)
  set('focusVsBest', (score.focus - bestFocus) / 100)
  set('exprVsBest', (moment?.expression ?? 0) - bestExpr)
  set('bright', a.color.meanLuma)
  set('contrast', a.color.p95 - a.color.p5)
  set('saturation', a.color.meanSat)
  set('emotionValue', score.emotionValue ?? 0)
  set('intensity', score.emotion?.intensity ?? 0)
  set('rare', score.tags.includes('rare') ? 1 : 0)
  // Unknown composition is neutral, not bad.
  set('separation', a.diag?.merged !== undefined ? 1 - a.diag.merged : 0.7)
  set('holdsEye', a.diag?.attention ?? 0.5)
  set('keyPerson', score.keyPeople?.length ? 1 : 0)
  set('gesture', score.gesture?.intensity ?? 0)
  set('happening', score.happens?.length ? 1 : 0)
  return x
}

/** One frame the photographer has dealt with. */
export interface Example {
  /** Features, in FEATURES order. */
  x: number[]
  /** 1 kept, 0 rejected, -1 passed over (another frame of its burst was kept). */
  y: 1 | 0 | -1
  /** How much this example should count. */
  w: number
  stack: number
  /** The built-in score at the time, for comparing the rules with the learned model. */
  h: number
  /** Chosen with no suggestion shown: the least biased evidence there is. */
  blind?: boolean
}

export interface ProjectExamples {
  genre: Genre
  updatedAt: number
  examples: Example[]
}

export interface LearningData {
  version: number
  /** Whether some bursts are shown without a suggestion, to collect unprompted choices. */
  blindBursts: boolean
  projects: Record<string, ProjectExamples>
  /** Measurements the photographer told the model not to use (FEATURES keys). */
  ignored?: string[]
}

export const emptyLearning = (): LearningData => ({ version: FEATURE_VERSION, blindBursts: true, projects: {} })

/**
 * How much a decision teaches, by how it was made. A choice made by hand counts
 * the same whether it agrees with the suggestion or overrules it: weighting
 * disagreement more would teach the model to be contrary, and would make the
 * built-in rules look worse than they are when the two are compared.
 */
function weightOf(shot: Shot): number {
  if (shot.blind) return 2
  return shot.decidedBy === 'accepted' ? 0.3 : 1
}

/** Turns a project's decisions into examples. Bursts nothing was decided in teach nothing. */
export function examplesOf(shots: Shot[]): Example[] {
  const stacks = new Map<number, Shot[]>()
  for (const s of shots) if (s.analysis && s.score) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
  const out: Example[] = []
  for (const [id, stack] of stacks) {
    const kept = stack.some((s) => s.decision === 'pick')
    for (const s of stack) {
      if (s.decision === null && !kept) continue
      out.push({
        x: featuresOf(s, stack),
        y: s.decision === 'pick' ? 1 : s.decision === 'reject' ? 0 : -1,
        // A frame left undecided beside a pick was passed over: weaker evidence than a reject.
        w: s.decision === null ? 0.5 : weightOf(s),
        stack: id,
        h: s.score!.rules ?? s.score!.overall,
        blind: s.blind || undefined
      })
    }
  }
  return out
}

export interface Model {
  weights: number[]
  /** Examples it was trained on. */
  trainedOn: number
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const dot = (w: number[], x: number[]): number => {
  let s = 0
  for (let i = 0; i < w.length; i++) s += w[i] * (x[i] ?? 0)
  return s
}

/** The learned probability (0..1) that the photographer keeps a frame. */
export const predict = (model: Model, x: number[]): number => sigmoid(dot(model.weights, x))

interface Pair {
  kept: Example
  passed: Example
  w: number
}

/** Within each burst: every kept frame against every frame not kept. */
function pairsOf(examples: Example[], keyOf: (e: Example) => string): Pair[] {
  const groups = new Map<string, Example[]>()
  for (const e of examples) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e])
  const pairs: Pair[] = []
  for (const g of groups.values()) {
    for (const kept of g.filter((e) => e.y === 1)) {
      // A frame merely passed over is weaker evidence than one actively rejected.
      for (const passed of g.filter((e) => e.y !== 1)) pairs.push({ kept, passed, w: Math.min(kept.w, passed.w) * (passed.y === -1 ? 0.6 : 1) })
    }
  }
  return pairs
}

/**
 * Fits the model: logistic regression on kept-versus-rejected, plus a ranking
 * term that pushes each kept frame above the others in its burst. Plain
 * gradient descent with a little shrinkage, so that with few examples the
 * weights stay small and the built-in rules keep the say.
 */
/**
 * A starting point for the weights, from Claude's review of the collected data:
 * for each measurement a weight and how many examples' worth of belief it
 * carries. The model starts there and is pulled toward it, so with few
 * decisions it follows the guidance, and as decisions pile up they take over.
 */
export interface Prior {
  w: number[]
  /** Pseudo-examples per measurement; 0 means no guidance for it. */
  strength: number[]
}

/**
 * Weights usually differ by a few units, and one decision pulls on a weight with a force of at most 1.
 * Dividing the guidance's pull by this spread makes "worth N decisions" mean what it says: a guided
 * weight several units off resists about as hard as N decisions that disagree with it.
 */
const PRIOR_SPREAD = 4

export function train(examples: Example[], keyOf: (e: Example) => string, prior?: Prior): Model {
  const n = FEATURES.length
  const guided = (i: number): boolean => !!prior && (prior.strength[i] ?? 0) > 0
  const w = new Array<number>(n).fill(0).map((_, i) => (guided(i) ? prior!.w[i] : 0))
  const decided = examples.filter((e) => e.y !== -1)
  const pairs = pairsOf(examples, keyOf)
  const total = decided.reduce((s, e) => s + e.w, 0) + pairs.reduce((s, p) => s + p.w, 0)
  if (total === 0) return { weights: w, trainedOn: 0 }
  // The guidance counts as extra examples, so the steps are scaled by evidence plus guidance; that keeps
  // gradient descent stable however strong the guidance is against little data.
  const extra = prior ? Math.max(0, ...prior.strength) / PRIOR_SPREAD : 0
  const denom = total + extra
  const rate = 0.8
  const grad = new Array<number>(n)
  for (let step = 0; step < 300; step++) {
    grad.fill(0)
    for (const e of decided) {
      const err = (sigmoid(dot(w, e.x)) - e.y) * e.w
      for (let i = 0; i < n; i++) grad[i] += err * e.x[i]
    }
    for (const p of pairs) {
      let z = 0
      for (let i = 0; i < n; i++) z += w[i] * (p.kept.x[i] - p.passed.x[i])
      const err = (sigmoid(z) - 1) * p.w
      for (let i = 0; i < n; i++) grad[i] += err * (p.kept.x[i] - p.passed.x[i])
    }
    for (let i = 0; i < n; i++) {
      // Without guidance a weight is pulled gently toward zero; with it, toward the guided value,
      // as firmly as the guidance's worth in examples against the evidence there is.
      const pull = guided(i) ? (prior!.strength[i] / PRIOR_SPREAD) * (w[i] - prior!.w[i]) : i === 0 ? 0 : 2 * w[i]
      w[i] -= rate * ((grad[i] + pull) / denom)
    }
  }
  return { weights: w.map((v) => Math.round(v * 10000) / 10000), trainedOn: examples.length }
}

export interface Report {
  /** Frames learned from, and how many of them were decisions rather than pass-overs. */
  examples: number
  decisions: number
  projects: number
  /** Held-back bursts with a kept and a not-kept frame: what the model is checked on. */
  testedPairs: number
  /** Share of held-back pairs where each ranked the kept frame higher. */
  rulesAgree: number
  learnedAgree: number
  blendedAgree: number
  /** How much say the learned model has in suggestions, 0..0.8. */
  trust: number
  /** Unprompted choices collected so far. */
  blindDecisions: number
  /**
   * Whether Claude's guidance helped, judged on the held-back bursts: agreement of the
   * model learned with it and without it. Guidance that makes the model worse is set aside.
   */
  guidance?: { used: boolean; guided: number; unguided: number; pairs: number }
}

export interface Learned {
  model: Model
  trust: number
  report: Report
}

/** Pairs needed in the held-back bursts before the learned model may influence suggestions. */
export const MIN_TESTED_PAIRS = 30

/** A stable pseudo-random number in 0..1 from a string. */
export function hash01(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** One burst in ten is shown without a suggestion, when that is switched on. */
export const isBlindBurst = (projectId: string, stackId: number): boolean => hash01(`blind:${projectId}:${stackId}`) < 0.1

/**
 * Trains on four fifths of the bursts, tests on the rest, and decides how much
 * the learned model should count: whichever share gives the best agreement on
 * the held-back bursts, and none at all until there are enough of them.
 * Recent projects count more than old ones, so the model follows a changing eye.
 */
export function learn(data: LearningData, genre: Genre, prior?: Prior): Learned {
  const projects = Object.entries(data.projects).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const all: { e: Example; key: string }[] = []
  // A measurement the photographer ruled out is invisible to the model: always zero, so its weight stays zero.
  const off = new Set((data.ignored ?? []).map((k) => FEATURES.findIndex((f) => f.key === k)).filter((i) => i > 0))
  const clean = (x: number[]): number[] => (off.size ? x.map((v, i) => (off.has(i) ? 0 : v)) : x)
  projects.forEach(([id, p], age) => {
    // Each older project counts a little less; a different kind of shoot counts for half.
    const scale = Math.pow(0.93, age) * (p.genre === genre ? 1 : 0.5)
    for (const e of p.examples) all.push({ e: { ...e, x: clean(e.x), w: e.w * scale }, key: `${id}:${e.stack}` })
  })
  const keyOf = new Map(all.map(({ e, key }) => [e, key]))
  const key = (e: Example): string => keyOf.get(e)!
  const held = (k: string): boolean => hash01(`holdout:${k}`) < 0.2
  const training = all.filter(({ key: k }) => !held(k)).map(({ e }) => e)
  const testing = all.filter(({ key: k }) => held(k)).map(({ e }) => e)

  const pairs = pairsOf(testing, key)
  const agree = (scoreOf: (e: Example) => number): number => {
    const weight = pairs.reduce((s, p) => s + p.w, 0)
    return weight ? pairs.reduce((s, p) => s + (scoreOf(p.kept) > scoreOf(p.passed) ? p.w : 0), 0) / weight : 0
  }
  // Claude's guidance is tested like everything else: on bursts neither it nor the model learned from.
  const plain = train(training, key)
  let usePrior = false
  let guidance: Report['guidance']
  if (prior && prior.strength.some((s) => s > 0)) {
    const guidedModel = train(training, key, prior)
    const unguided = agree((e) => predict(plain, e.x))
    const guidedAgree = agree((e) => predict(guidedModel, e.x))
    // Kept unless it measurably hurts; with too few held-back comparisons to tell, the photographer's approval stands.
    const noise = pairs.length ? 1.64 * Math.sqrt(Math.max(0.01, unguided * (1 - unguided)) / pairs.length) : 1
    usePrior = pairs.length < 10 || guidedAgree >= unguided - noise
    guidance = { used: usePrior, guided: guidedAgree, unguided, pairs: pairs.length }
  }
  const model = usePrior ? train(training, key, prior) : plain
  const rules = (e: Example): number => e.h
  const learnedScore = (e: Example): number => 100 * predict(model, e.x)
  const blend = (t: number) => (e: Example): number => (1 - t) * rules(e) + t * learnedScore(e)

  let trust = 0
  const base = agree(rules)
  let blendedAgree = base
  if (pairs.length >= MIN_TESTED_PAIRS) {
    // With few held-back comparisons a small gain can be luck. The learned model must beat
    // the rules by more than the measurement's own uncertainty before it gets any say.
    // (1.64 standard errors: about a one-in-twenty chance of being fooled.)
    const noise = 1.64 * Math.sqrt((base * (1 - base)) / pairs.length)
    const bar = base + Math.max(0.02, noise)
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const a = agree(blend(t))
      // And a larger share must earn its place over a smaller one.
      if (a >= bar && a > blendedAgree + 0.005) {
        blendedAgree = a
        trust = t
      }
    }
  }
  // The model that is used is then refitted on everything, held-back bursts included.
  const final = trust > 0 ? train(all.map(({ e }) => e), key, usePrior ? prior : undefined) : model
  return {
    model: final,
    trust,
    report: {
      examples: all.length,
      decisions: all.filter(({ e }) => e.y !== -1).length,
      projects: projects.length,
      testedPairs: pairs.length,
      rulesAgree: agree(rules),
      learnedAgree: agree(learnedScore),
      blendedAgree,
      trust,
      blindDecisions: all.filter(({ e }) => e.blind).length,
      guidance
    }
  }
}

/** Each measurement and how strongly the model leans on it, in words: for showing and ruling out. */
export function leanings(model: Model): { key: string; text: string; w: number }[] {
  return model.weights
    .map((w, i) => ({ w, f: FEATURES[i] }))
    .filter(({ f }) => f.key !== 'bias')
    .map(({ w, f }) => ({ key: f.key, text: w >= 0 ? f.more : f.less, w }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
}

/** What the model has learned, strongest tendencies first, in words. */
export function tendencies(model: Model, limit = 6): string[] {
  return model.weights
    .map((w, i) => ({ w, f: FEATURES[i] }))
    .filter(({ f, w }) => f.key !== 'bias' && Math.abs(w) > 0.25)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, limit)
    .map(({ w, f }) => (w > 0 ? f.more : f.less))
}

/** Why the learned model leans the way it does on one frame: its largest contributions. */
export function reasonsFor(model: Model, x: number[], limit = 3): string[] {
  return model.weights
    .map((w, i) => ({ c: w * x[i], w, f: FEATURES[i] }))
    .filter(({ f, c }) => f.key !== 'bias' && Math.abs(c) > 0.15)
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
    .slice(0, limit)
    .map(({ c, w, f }) => `${c > 0 ? '+' : '−'} ${w > 0 ? f.more : f.less}`)
}

/** Drops the oldest projects once the store grows past a sensible size. */
export function trimmed(data: LearningData, maxExamples = 40000): LearningData {
  const entries = Object.entries(data.projects).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const kept: [string, ProjectExamples][] = []
  let count = 0
  for (const entry of entries) {
    count += entry[1].examples.length
    if (kept.length && count > maxExamples) break
    kept.push(entry)
  }
  return { ...data, projects: Object.fromEntries(kept) }
}
