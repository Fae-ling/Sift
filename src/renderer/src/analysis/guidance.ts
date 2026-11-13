// Claude's review of what the app has collected.
//
// The app learns by counting: which frames were kept, which mistakes were
// forgiven, what was rejected and why. Counting is slow when there are few
// decisions, and it cannot tell taste from coincidence. Here everything
// collected is summarised as text (no photographs) for Claude, which reasons
// about it and proposes settings:
//
//   - a starting weight for each measurement of the taste model, with a
//     confidence that sets how many decisions' worth it counts for;
//   - rules for which mistakes are forgiven, and with which asset;
//   - patterns to stop using, because they look like coincidence;
//   - changes to how shoot styles weigh emotions, and their balance;
//   - questions only the photographer can settle.
//
// Nothing is used until the photographer approves it, and the taste-model
// guidance is tested on held-back decisions like everything else: if it makes
// the model worse there, it is set aside.

import type { Confidence, Style, TuneRequest, TuneResult } from '@shared/types'
import type { EmotionStore } from './emotion'
import { emptyReasons, ledgerEntries, mergedLedger, reasonCounts, type ForgivePrior, type Knowledge } from './knowledge'
import { FEATURES, type Learned as Taste, type LearningData, type Prior } from './learner'

/** How many decisions' worth a proposed weight counts for, by confidence. */
export const PRIOR_STRENGTH: Record<Confidence, number> = { low: 10, medium: 25, high: 50 }

export interface Proposal {
  id: string
  kind: 'prior' | 'forgive' | 'exclude' | 'style'
  confidence: Confidence
  why: string
  /** In words, for the list the photographer approves from. */
  text: string
  prior?: { feature: string; weight: number; current: number | null }
  forgive?: ForgivePrior
  exclude?: { key: string }
  style?: { styleId: string; emotions: { name: string; weight: number; current: number | null }[]; balance: number | null }
}

export interface Review {
  at: number
  model: string
  costUsd: number
  reading: string
  questions: string[]
  proposals: Proposal[]
  /** Ids of the proposals the photographer approved; absent while undecided. */
  applied?: string[]
  /** The self-check before and after the approved guidance was applied. */
  check?: { before: Check; after: Check }
}

export interface Check {
  trust: number
  testedPairs: number
  learnedAgree: number
  rulesAgree: number
  /** With and without the guidance, on held-back bursts. */
  guidance?: { used: boolean; guided: number; unguided: number; pairs: number }
}

export interface ActivePrior {
  weight: number
  confidence: Confidence
  why: string
  at: number
}

export interface Guidance {
  version: number
  reviews: Review[]
  /** Taste-model starting weights in use, by measurement key. */
  priors: Record<string, ActivePrior>
  /** Forgiveness rules in use. */
  forgive: (ForgivePrior & { why: string; at: number })[]
}

export const GUIDANCE_VERSION = 1
export const emptyGuidance = (): Guidance => ({ version: GUIDANCE_VERSION, reviews: [], priors: {}, forgive: [] })

/** The taste model's starting point from the guidance in use. */
export function priorOf(g: Guidance): Prior | undefined {
  const keys = Object.keys(g.priors)
  if (!keys.length) return undefined
  const w = FEATURES.map((f) => g.priors[f.key]?.weight ?? 0)
  const strength = FEATURES.map((f) => (g.priors[f.key] ? PRIOR_STRENGTH[g.priors[f.key].confidence] : 0))
  return { w, strength }
}

export const forgivePriors = (g: Guidance): ForgivePrior[] => g.forgive.map(({ flaw, asset, factor, confidence }) => ({ flaw, asset, factor, confidence }))

/** Flaws and assets the app can name, beyond those already seen in decisions. */
const KNOWN_FLAWS = ['closed eyes', 'soft eyes', 'soft overall', 'blown highlights', 'very dark', 'subject merges with background', 'a distraction']
const KNOWN_ASSETS = ['a strong expression', 'closeness', 'the peak of a burst', 'a rare emotion', 'a must-have chapter', 'a key person', "Claude's high rating", 'a subject that holds the eye']

const pct = (v: number): string => `${Math.round(v * 100)}%`
const r2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2)

export interface DigestInput {
  learning: LearningData
  taste: Taste | null
  knowledge: Knowledge
  styles: Style[]
  emotions: EmotionStore
  gestures: string[]
  guidance: Guidance
}

/**
 * Everything collected, as text Claude can reason over, and the names it may
 * use in its answer. Numbers only, no photographs and no names of people.
 */
export function digest(input: DigestInput): TuneRequest {
  const { learning, taste, knowledge: k, styles, emotions, guidance } = input
  const parts: string[] = []
  const projects = Object.values(learning.projects)
  const all = projects.flatMap((p) => p.examples)
  const decided = all.filter((e) => e.y !== -1)
  const byGenre = new Map<string, number>()
  for (const p of projects) byGenre.set(p.genre, (byGenre.get(p.genre) ?? 0) + p.examples.filter((e) => e.y !== -1).length)
  parts.push(
    `## Decisions
${projects.length} projects; ${decided.length} decided frames (${decided.filter((e) => e.y === 1).length} kept, ${decided.filter((e) => e.y === 0).length} rejected) and ${all.length - decided.length} frame${all.length - decided.length === 1 ? '' : 's'} passed over beside a keeper.
By kind of shoot: ${[...byGenre].map(([g, n]) => `${g} ${n}`).join(', ') || 'none'}.
Made with no suggestion shown (the least biased): ${all.filter((e) => e.blind).length}. Accepted suggestions count for 0.3 of a hand-made choice.`
  )

  if (taste) {
    const r = taste.report
    parts.push(
      `## Self-check of the taste model
Held-back comparisons: ${r.testedPairs} (30 needed before the model may influence suggestions).${
        r.testedPairs
          ? `\nOn those, the built-in rules rank the kept frame first ${pct(r.rulesAgree)} of the time; the learned model ${pct(r.learnedAgree)}. Its current say in suggestions: ${pct(r.trust)}.`
          : '\nNone yet, so nothing can be said about how well the model or the rules predict this photographer.'
      }${r.guidance && r.guidance.pairs ? `\nWith your earlier guidance: ${pct(r.guidance.guided)}; without: ${pct(r.guidance.unguided)} (${r.guidance.used ? 'in use' : 'set aside'}).` : ''}`
    )
  }

  // Each measurement: what the model learned, and the plain difference between kept and not-kept frames.
  const rows: string[] = []
  const ignored = new Set(learning.ignored ?? [])
  FEATURES.forEach((f, i) => {
    if (f.key === 'bias') return
    let kw = 0, ks = 0, nw = 0, ns = 0
    for (const e of all) {
      const v = e.x[i] ?? 0
      if (e.y === 1) {
        kw += e.w
        ks += e.w * v
      } else {
        nw += e.w
        ns += e.w * v
      }
    }
    const kept = kw ? ks / kw : null
    const not = nw ? ns / nw : null
    const w = taste?.model.weights[i]
    const prior = guidance.priors[f.key]
    rows.push(
      `${f.key} | ${w === undefined ? '–' : r2(w)} | ${kept === null ? '–' : r2(kept)} vs ${not === null ? '–' : r2(not)}${ignored.has(f.key) ? ' | switched off by the photographer' : ''}${prior ? ` | your earlier guidance ${r2(prior.weight)} (${prior.confidence})` : ''}`
    )
  })
  parts.push(`## Measurements (0..1 each)
key | learned weight | mean among kept vs not kept
${rows.join('\n')}`)

  const ledger = mergedLedger(k.ledger, '', undefined, 1)
  const entries = ledgerEntries(ledger)
  const excluded = new Set(k.excluded ?? [])
  if (ledger.all.n) {
    parts.push(
      `## Mistakes against assets (weighted decisions)
All decided frames: kept ${Math.round(ledger.all.k)} of ${Math.round(ledger.all.n)}. Frames with no flaw: kept ${Math.round(ledger.clean.k)} of ${Math.round(ledger.clean.n)}.
${entries
  .slice(0, 60)
  .map((e) => `${e.key}: kept ${Math.round(e.k)} of ${Math.round(e.n)}${excluded.has(e.key) ? ' (switched off by the photographer)' : ''}`)
  .join('\n')}`
    )
  }
  if (guidance.forgive.length) parts.push(`## Forgiveness rules in use from earlier guidance\n${guidance.forgive.map((f) => `${f.flaw}${f.asset ? ` with ${f.asset}` : ''}: ${r2(f.factor)} (${f.confidence})`).join('\n')}`)

  const reasons = reasonCounts(k.reasons ?? emptyReasons())
  if (reasons.length) parts.push(`## Reasons the photographer gave for rejecting\n${reasons.map((r) => `${r.name}: ${r.count}`).join('\n')}`)

  const records = Object.values(k.claude)
  const agreed = records.reduce((n, r) => n + r.agreed, 0)
  const disagreed = records.reduce((n, r) => n + r.disagreed, 0)
  if (agreed + disagreed) {
    parts.push(`## Claude's frame reads against the photographer's decisions
With Claude: ${agreed}; against: ${disagreed}.
Kept although Claude rated it low: ${records.flatMap((r) => r.keptAnyway).slice(-6).join('; ') || 'none'}
Dropped although Claude rated it high: ${records.flatMap((r) => r.droppedAnyway).slice(-6).join('; ') || 'none'}`)
  }

  parts.push(
    `## Shoot styles
${styles
  .map((s) => {
    const lifts = Object.entries(s.emotionLift ?? {})
      .filter(([, l]) => l.n >= 3)
      .map(([name, l]) => `${name} ${l.w >= 0 ? '+' : ''}${r2(l.w)} over ${l.n} frames`)
    return `${s.id} "${s.name}" (${s.family}), balance ${r2(s.balance)}. Emotion weights: ${Object.entries(s.emotions).map(([n, w]) => `${n} ${r2(w)}`).join(', ') || 'family defaults'}.${lifts.length ? ` What decisions in it showed: ${lifts.join(', ')}.` : ''}${s.feeling ? ` Feeling: ${s.feeling}` : ''}`
  })
  .join('\n')}`
  )
  parts.push(`## Emotions the app knows\n${emotions.concepts.map((c) => `${c.name} (${c.examples.length} examples)`).join(', ')}`)
  const notes = k.notes.filter((n) => n.source !== 'review').slice(-4)
  if (notes.length) parts.push(`## Advice the photographer acted on\n${notes.map((n) => `- ${n.text}`).join('\n')}`)

  const assets = new Set([...KNOWN_ASSETS, ...Object.keys(ledger.assets), ...emotions.concepts.map((c) => c.name), ...input.gestures])
  return {
    digest: parts.join('\n\n').slice(0, 16000),
    allowed: {
      features: FEATURES.filter((f) => f.key !== 'bias').map((f) => ({ key: f.key, meaning: f.more })),
      flaws: [...new Set([...KNOWN_FLAWS, ...Object.keys(ledger.flaws)])],
      assets: [...assets],
      ledgerKeys: entries.map((e) => e.key),
      styles: styles.map((s) => ({ id: s.id, name: s.name }))
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))

/**
 * Turns Claude's answer into proposals the photographer can approve one by
 * one. Anything that names a measurement, flaw, style or key the app does not
 * know is dropped, and every number is held to its range.
 */
export function toProposals(result: TuneResult, req: TuneRequest, current: { weights?: number[]; styles: Style[] }): Proposal[] {
  const out: Proposal[] = []
  const features = new Map(req.allowed.features.map((f) => [f.key, f.meaning]))
  const flaws = new Set(req.allowed.flaws)
  const assets = new Set(req.allowed.assets)
  const ledgerKeys = new Set(req.allowed.ledgerKeys)
  for (const p of result.priors) {
    if (!features.has(p.feature)) continue
    const i = FEATURES.findIndex((f) => f.key === p.feature)
    const weight = Math.round(clamp(p.weight, -4, 4) * 100) / 100
    const f = FEATURES[i]
    out.push({
      id: `prior:${p.feature}`,
      kind: 'prior',
      confidence: p.confidence,
      why: p.why,
      text: Math.abs(weight) < 0.1 ? `Do not judge by ${f.more.replace(/^you /, '')}` : weight > 0 ? `Lean toward ${f.more}` : `Lean away: ${f.less}`,
      prior: { feature: p.feature, weight, current: current.weights?.[i] ?? null }
    })
  }
  for (const f of result.forgive) {
    if (!flaws.has(f.flaw) || (f.asset !== null && !assets.has(f.asset))) continue
    const factor = Math.round(clamp(f.factor, 0, 1) * 100) / 100
    out.push({
      id: `forgive:${f.flaw}|${f.asset ?? '*'}`,
      kind: 'forgive',
      confidence: f.confidence,
      why: f.why,
      text: `${factor >= 0.6 ? 'Forgive' : factor <= 0.3 ? 'Do not forgive' : 'Weigh case by case'}: ${f.flaw}${f.asset ? ` when there is ${f.asset}` : ''}`,
      forgive: { flaw: f.flaw, asset: f.asset, factor, confidence: f.confidence }
    })
  }
  for (const x of result.exclude) {
    const isFeature = x.key.startsWith('feature:') && features.has(x.key.slice(8))
    if (!isFeature && !ledgerKeys.has(x.key)) continue
    out.push({ id: `exclude:${x.key}`, kind: 'exclude', confidence: 'medium', why: x.why, text: `Stop using: ${isFeature ? features.get(x.key.slice(8)) : x.key.replace(/^\w+:/, '').replace('|', ', with ')}`, exclude: { key: x.key } })
  }
  for (const s of result.styles) {
    const style = current.styles.find((x) => x.id === s.styleId)
    if (!style) continue
    const emotions = s.emotions
      .filter((e) => e.name.trim())
      .map((e) => ({ name: e.name.trim().toLowerCase(), weight: Math.round(clamp(e.weight, -1, 1) * 100) / 100, current: style.emotions[e.name.trim().toLowerCase()] ?? null }))
    const balance = s.balance === null ? null : Math.round(clamp(s.balance, 0.15, 0.85) * 100) / 100
    if (!emotions.length && balance === null) continue
    out.push({
      id: `style:${style.id}`,
      kind: 'style',
      confidence: 'medium',
      why: s.why,
      text: `Adjust “${style.name}”: ${[...emotions.map((e) => `${e.name} ${e.weight >= 0 ? '+' : ''}${e.weight}`), ...(balance !== null ? [`balance ${balance}`] : [])].join(', ')}`,
      style: { styleId: style.id, emotions, balance }
    })
  }
  return out
}
