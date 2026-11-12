// What the app knows beyond single measurements, and how it comes to know it.
//
// Three things are kept here, all learned, all rebuilt from stored evidence:
//
//  1. WHAT IS HAPPENING. When Claude reads a frame it says what is going on
//     ("first dance", "toast", "sword clash"). Each such word is stored with
//     the frame's measurements. Once a word has enough examples, the app
//     recognises it by itself in frames Claude never saw. A reading counts
//     for more once the photographer's decision agreed with Claude's
//     judgement of that frame, and for less once it went against it.
//
//  2. ASSETS AGAINST MISTAKES. Every decided frame is filed as: what was
//     wrong with it (closed eyes, soft, blown highlights...), what it brought
//     (an emotion, a gesture, a key person, a rare moment...), and whether it
//     was kept. From that the app learns which mistakes this photographer
//     forgives for which assets, and which assets they value at all.
//
//  3. THE RECORD WITH CLAUDE. Where the photographer kept what Claude rated
//     low, or dropped what it rated high. Claude is shown this before every
//     new assessment, with everything else the app has learned, so that it
//     judges for this photographer and not for photographers in general.

import type { Analysis, NarrativeRead, Person, Shot } from '@shared/types'
import { toCues } from './emotion'
import { GESTURE_CUES } from './gesture'
import { namesIn } from './people'

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v))

// --- 1. what is happening ---------------------------------------------------------

const SHOT_TYPES = ['close-up', 'medium', 'wide', 'group', 'detail'] as const

/** A frame as numbers, for recognising what is happening in it: people, faces, gestures, framing, light. */
export function sceneVector(a: Analysis): number[] {
  const main = a.faces.filter((f) => f.h >= 0.05)
  let closeness = 0
  for (let i = 0; i < main.length; i++) {
    for (let j = i + 1; j < main.length; j++) {
      const width = (main[i].w + main[j].w) / 2
      const d = Math.hypot(main[i].x + main[i].w / 2 - main[j].x - main[j].w / 2, main[i].y + main[i].h / 2 - main[j].y - main[j].h / 2) / Math.max(width, 1e-4)
      closeness = Math.max(closeness, 1 - clamp((d - 1) / 2))
    }
  }
  const cues = main[0]?.shapes ? toCues(main[0].shapes) : new Array<number>(21).fill(0)
  const gesture = GESTURE_CUES.map((_, i) => (a.bodies ?? []).reduce((m, b) => Math.max(m, (b.g[i] ?? 0) / 100), 0))
  const c = a.color
  return [
    clamp(main.length / 6), clamp((main[0]?.h ?? 0) * 2), closeness,
    ...cues, ...gesture,
    clamp((a.bodies?.length ?? 0) / 6),
    ...SHOT_TYPES.map((t) => (a.shotType === t ? 1 : 0)),
    c.meanLuma, c.p95 - c.p5, c.meanSat, clamp(0.5 + c.castWarm * 4)
  ].map((v) => Math.round(v * 100) / 100)
}

export interface TagExample {
  v: number[]
  /** Who said so. */
  source: 'you' | 'claude'
  /** The frame it came from, as project:shot, so its weight can follow the photographer's decision. */
  key: string
  w: number
}

export interface TagConcept {
  name: string
  examples: TagExample[]
}

export interface Concepts {
  /** The average frame, against which a kind of moment stands out. */
  mean: number[]
  seen: number
  tags: TagConcept[]
}

const MAX_TAG_EXAMPLES = 40
const MAX_TAGS = 200
/** A word needs this much evidence before the app uses it by itself. */
export const MIN_TAG_WEIGHT = 3
const TAG_MATCH = 0.62

export const cleanTag = (t: string): string => t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)

/** How much a reading by Claude counts, by what the photographer then did with the frame. */
export const READ_WEIGHT = { open: 0.5, accepted: 0.75, agreed: 1, disagreed: 0.3 } as const
export type Verdict = keyof typeof READ_WEIGHT

/** Stores that a frame shows these happenings. A frame described again replaces its earlier description. */
export function learnTags(c: Concepts, key: string, v: number[], tags: string[], source: TagExample['source'], w: number): Concepts {
  const names = [...new Set(tags.map(cleanTag).filter(Boolean))]
  const isNew = !c.tags.some((t) => t.examples.some((e) => e.key === key))
  let list = c.tags.map((t) => ({ ...t, examples: t.examples.filter((e) => !(e.key === key && e.source === source)) }))
  for (const name of names) {
    const example: TagExample = { v, source, key, w }
    const existing = list.find((t) => t.name === name)
    if (existing) {
      existing.examples = [...existing.examples, example]
      // When full, the least trusted go first.
      if (existing.examples.length > MAX_TAG_EXAMPLES) existing.examples = [...existing.examples].sort((x, y) => y.w - x.w).slice(0, MAX_TAG_EXAMPLES)
    } else list.push({ name, examples: [example] })
  }
  list = list.filter((t) => t.examples.length)
  if (list.length > MAX_TAGS) list = [...list].sort((x, y) => y.examples.length - x.examples.length).slice(0, MAX_TAGS)
  if (!isNew || !names.length) return { ...c, tags: list }
  const seen = c.seen + 1
  const mean = c.mean.length === v.length ? c.mean.map((m, i) => m + (v[i] - m) / seen) : [...v]
  return { mean, seen: c.mean.length === v.length ? seen : 1, tags: list }
}

/** Sets how much Claude's readings of a project's frames count, from what the photographer decided. */
export function settleTags(c: Concepts, projectId: string, verdicts: Map<string, Verdict>): Concepts {
  const prefix = projectId + ':'
  let changed = false
  const tags = c.tags.map((t) => ({
    ...t,
    examples: t.examples.map((e) => {
      if (e.source !== 'claude' || !e.key.startsWith(prefix)) return e
      const w = READ_WEIGHT[verdicts.get(e.key.slice(prefix.length)) ?? 'open']
      if (w === e.w) return e
      changed = true
      return { ...e, w }
    })
  }))
  return changed ? { ...c, tags } : c
}

const tagWeight = (t: TagConcept): number => t.examples.reduce((s, e) => s + e.w, 0)

/** Where each word the app can use by itself sits, relative to the average frame. Worked out once per change. */
export function tagDirections(c: Concepts): { name: string; dir: number[]; length: number }[] {
  return c.tags.flatMap((t) => {
    const weight = tagWeight(t)
    if (weight < MIN_TAG_WEIGHT || t.examples.length < 4) return []
    const dir = c.mean.map((m, i) => t.examples.reduce((s, e) => s + e.w * (e.v[i] ?? 0), 0) / weight - m)
    const length = Math.sqrt(dir.reduce((s, x) => s + x * x, 0))
    // A word whose frames look like every other frame cannot be recognised from measurements.
    return length > 0.12 ? [{ name: t.name, dir, length }] : []
  })
}

/** What the app thinks is happening in a frame, from what it has been taught: up to three words, likeliest first. */
export function recogniseTags(v: number[], c: Concepts, directions = tagDirections(c)): string[] {
  if (!directions.length || c.mean.length !== v.length) return []
  const z = v.map((x, i) => x - c.mean[i])
  const zn = Math.sqrt(z.reduce((s, x) => s + x * x, 0))
  if (zn < 0.1) return []
  return directions
    .map((d) => ({ name: d.name, sim: d.dir.reduce((s, x, i) => s + x * z[i], 0) / (d.length * zn) }))
    .filter((x) => x.sim >= TAG_MATCH)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3)
    .map((x) => x.name)
}

/** Words the app has heard, most used first, with whether it can already recognise each by itself. */
export function vocabulary(c: Concepts): { name: string; examples: number; confirmed: number; usable: boolean }[] {
  const usable = new Set(tagDirections(c).map((d) => d.name))
  return c.tags
    .map((t) => ({ name: t.name, examples: t.examples.length, confirmed: t.examples.filter((e) => e.w >= 1).length, usable: usable.has(t.name) }))
    .sort((a, b) => b.examples - a.examples)
}

// --- 2. assets against mistakes -----------------------------------------------------

export interface Tally {
  /** Kept, and seen, both weighted by how the decision was made. */
  k: number
  n: number
}

/** One project's decisions, filed by what was wrong with each frame and what it brought. */
export interface ProjectLedger {
  style: string
  /** Every decided frame, and those with nothing wrong. */
  all: Tally
  clean: Tally
  assets: Record<string, Tally>
  /** Mistake, then the asset that was present ('*' for the mistake whatever came with it). */
  flaws: Record<string, Record<string, Tally>>
}

export interface Ledger {
  projects: Record<string, ProjectLedger>
}

const tally = (): Tally => ({ k: 0, n: 0 })
const add = (t: Tally, kept: boolean, w: number): void => {
  t.n += w
  if (kept) t.k += w
}

/** Files a project's decided frames. Frames passed over beside a keeper count as dropped, at half weight. */
export function ledgerOf(shots: Shot[], style: string): ProjectLedger {
  const out: ProjectLedger = { style, all: tally(), clean: tally(), assets: {}, flaws: {} }
  const keptStacks = new Set(shots.filter((s) => s.decision === 'pick').map((s) => s.stackId))
  for (const s of shots) {
    if (!s.score) continue
    const passedOver = s.decision === null && keptStacks.has(s.stackId)
    if (s.decision === null && !passedOver) continue
    const kept = s.decision === 'pick'
    const w = passedOver ? 0.5 : s.blind ? 2 : s.decidedBy === 'accepted' ? 0.3 : 1
    const flaws = s.score.flaws ?? []
    const assets = s.score.assets ?? []
    add(out.all, kept, w)
    if (!flaws.length) add(out.clean, kept, w)
    for (const a of assets) add((out.assets[a] ??= tally()), kept, w)
    for (const f of flaws) {
      const row = (out.flaws[f] ??= {})
      add((row['*'] ??= tally()), kept, w)
      for (const a of assets) add((row[a] ??= tally()), kept, w)
    }
  }
  const round = (t: Tally): void => {
    t.k = Math.round(t.k * 10) / 10
    t.n = Math.round(t.n * 10) / 10
  }
  ;[out.all, out.clean, ...Object.values(out.assets), ...Object.values(out.flaws).flatMap((r) => Object.values(r))].forEach(round)
  return out
}

/** Everything filed so far as one ledger: projects of the same style count fully, others for less. */
export function mergedLedger(ledger: Ledger, style: string, except?: string): ProjectLedger {
  const out: ProjectLedger = { style, all: tally(), clean: tally(), assets: {}, flaws: {} }
  const sum = (into: Tally, t: Tally, w: number): void => {
    into.k += t.k * w
    into.n += t.n * w
  }
  for (const [id, p] of Object.entries(ledger.projects)) {
    if (id === except) continue
    const w = p.style === style ? 1 : 0.4
    sum(out.all, p.all, w)
    sum(out.clean, p.clean, w)
    for (const [a, t] of Object.entries(p.assets)) sum((out.assets[a] ??= tally()), t, w)
    for (const [f, row] of Object.entries(p.flaws)) for (const [a, t] of Object.entries(row)) sum(((out.flaws[f] ??= {})[a] ??= tally()), t, w)
  }
  return out
}

/** Evidence below this says nothing yet. */
const MIN_EVIDENCE = 4

/** How much more (or less) often frames with an asset are kept than frames in general, -1..1, cautious while evidence is thin. */
export function assetLift(l: ProjectLedger, asset: string): { lift: number; k: number; n: number } | null {
  const t = l.assets[asset]
  if (!t || t.n < MIN_EVIDENCE || l.all.n < 20) return null
  const base = l.all.k / l.all.n
  return { lift: (t.k - t.n * base) / (t.n + 6), k: t.k, n: t.n }
}

export interface Forgiveness {
  /** 0 (the mistake counts fully) .. 1 (with this asset, frames like this are kept as often as clean ones). */
  factor: number
  flaw: string
  /** The asset that most often redeems the mistake, among those the frame has; null when the mistake is forgiven by itself. */
  asset: string | null
  k: number
  n: number
}

/** How far this photographer's past choices forgive a frame's mistakes, given what it brings. */
export function forgiveness(l: ProjectLedger, flaws: string[], assets: string[]): Forgiveness | null {
  if (l.clean.n < 10 || !flaws.length) return null
  const cleanRate = Math.max(0.05, l.clean.k / l.clean.n)
  let worst: Forgiveness | null = null
  for (const flaw of flaws) {
    const row = l.flaws[flaw]
    const base = row?.['*']
    if (!base || base.n < MIN_EVIDENCE) return null
    let best: Forgiveness = { factor: clamp(base.k / base.n / cleanRate), flaw, asset: null, k: base.k, n: base.n }
    for (const a of assets) {
      const t = row[a]
      if (!t || t.n < MIN_EVIDENCE) continue
      // Pulled toward the mistake's own rate while examples are few.
      const rate = (t.k + 3 * (base.k / base.n)) / (t.n + 3)
      const factor = clamp(rate / cleanRate)
      if (factor > best.factor) best = { factor, flaw, asset: a, k: t.k, n: t.n }
    }
    // A frame is only as forgiven as its least forgiven mistake.
    if (!worst || best.factor < worst.factor) worst = best
  }
  return worst
}

/** The trade-offs the ledger shows most clearly, in words. */
export function tradeoffLines(l: ProjectLedger, limit = 6): string[] {
  if (l.clean.n < 10) return []
  const cleanRate = Math.max(0.05, l.clean.k / l.clean.n)
  const lines: { text: string; weight: number }[] = []
  for (const [flaw, row] of Object.entries(l.flaws)) {
    const base = row['*']
    if (!base || base.n < MIN_EVIDENCE) continue
    const baseRate = base.k / base.n
    lines.push({ text: `${flaw}: kept ${Math.round(base.k)} of ${Math.round(base.n)} (clean frames: ${Math.round(cleanRate * 100)}%)`, weight: base.n * Math.abs(baseRate - cleanRate) })
    for (const [asset, t] of Object.entries(row)) {
      if (asset === '*' || t.n < MIN_EVIDENCE) continue
      const rate = t.k / t.n
      if (rate - baseRate > 0.2) lines.push({ text: `${flaw} is forgiven when there is ${asset}: kept ${Math.round(t.k)} of ${Math.round(t.n)}`, weight: t.n * (rate - baseRate) * 2 })
    }
  }
  return lines.sort((a, b) => b.weight - a.weight).slice(0, limit).map((x) => x.text)
}

/** The assets this photographer keeps most and least often, in words. */
export function assetLines(l: ProjectLedger, limit = 5): { valued: string[]; passed: string[] } {
  const lifts = Object.keys(l.assets).flatMap((a) => {
    const x = assetLift(l, a)
    return x ? [{ a, ...x }] : []
  })
  const say = (x: { a: string; k: number; n: number }): string => `${x.a} (kept ${Math.round(x.k)} of ${Math.round(x.n)})`
  return {
    valued: lifts.filter((x) => x.lift > 0.08).sort((a, b) => b.lift - a.lift).slice(0, limit).map(say),
    passed: lifts.filter((x) => x.lift < -0.08).sort((a, b) => a.lift - b.lift).slice(0, limit).map(say)
  }
}

// --- 3. the record with Claude -------------------------------------------------------

/** Whether a read amounts to "keep this" or "leave this", or neither. */
export const claudeSays = (r: NarrativeRead): 'keep' | 'leave' | null => (r.moment >= 6.5 || r.gem ? 'keep' : r.moment <= 4 ? 'leave' : null)

/** What the photographer's decision says about Claude's reading of a frame. */
export function verdictOf(s: Shot): Verdict {
  if (!s.read || s.decision === null) return 'open'
  const says = claudeSays(s.read)
  if (!says) return 'open'
  const same = (says === 'keep') === (s.decision === 'pick')
  if (!same) return 'disagreed'
  return s.decidedBy === 'accepted' ? 'accepted' : 'agreed'
}

export interface ClaudeRecord {
  agreed: number
  disagreed: number
  /** Frames kept although Claude rated them low, and dropped although it rated them high, as Claude described them. */
  keptAnyway: string[]
  droppedAnyway: string[]
}

export function claudeRecord(shots: Shot[]): ClaudeRecord {
  const out: ClaudeRecord = { agreed: 0, disagreed: 0, keptAnyway: [], droppedAnyway: [] }
  for (const s of shots) {
    const v = verdictOf(s)
    if (v === 'agreed' || v === 'accepted') out.agreed++
    else if (v === 'disagreed') {
      out.disagreed++
      const text = `${s.read!.what || s.read!.note} (you rated it ${s.read!.moment}/10)`
      const list = s.decision === 'pick' ? out.keptAnyway : out.droppedAnyway
      if (list.length < 8) list.push(text)
    }
  }
  return out
}

/** Advice from Claude worth remembering beyond the call it came from. */
export interface Note {
  at: number
  source: 'story' | 'style' | 'essence' | 'diagnose'
  text: string
  project?: string
}

export interface Knowledge {
  version: number
  concepts: Concepts
  ledger: Ledger
  claude: Record<string, ClaudeRecord>
  notes: Note[]
}

export const KNOWLEDGE_VERSION = 1
export const emptyKnowledge = (): Knowledge => ({ version: KNOWLEDGE_VERSION, concepts: { mean: [], seen: 0, tags: [] }, ledger: { projects: {} }, claude: {}, notes: [] })

export const addNote = (k: Knowledge, note: Note): Knowledge => ({ ...k, notes: [...k.notes.filter((n) => n.text !== note.text), note].slice(-24) })

/** Folds the open project's decisions into everything above. Safe to repeat: a project's entries replace its earlier ones. */
export function absorb(k: Knowledge, projectId: string, shots: Shot[], style: string): Knowledge {
  const decided = shots.some((s) => s.decision !== null)
  const projects = { ...k.ledger.projects }
  if (decided) projects[projectId] = ledgerOf(shots, style)
  else delete projects[projectId]
  const claude = { ...k.claude }
  const record = claudeRecord(shots)
  if (record.agreed + record.disagreed) claude[projectId] = record
  else delete claude[projectId]
  const verdicts = new Map(shots.filter((s) => s.read).map((s) => [s.id, verdictOf(s)]))
  return { ...k, ledger: { projects }, claude, concepts: settleTags(k.concepts, projectId, verdicts) }
}

/**
 * What Claude is told before every assessment: what this photographer's
 * decisions have shown, where they and Claude have differed, and what has been
 * chosen in this shoot so far.
 */
export function briefing(input: {
  knowledge: Knowledge
  style: string
  /** What the taste model has learned, in words. */
  tendencies: string[]
  shots: Shot[]
  people?: Person[]
}): string {
  const { knowledge: k, shots } = input
  const parts: string[] = []
  if (input.tendencies.length) parts.push(`Their past decisions show they favour: ${input.tendencies.join('; ')}.`)
  const ledger = mergedLedger(k.ledger, input.style)
  const trade = tradeoffLines(ledger, 5)
  if (trade.length) parts.push(`Mistakes against assets, from their own culls:\n${trade.map((t) => `- ${t}`).join('\n')}`)
  const { valued, passed } = assetLines(ledger, 5)
  if (valued.length) parts.push(`They keep more often than average: ${valued.join('; ')}.`)
  if (passed.length) parts.push(`They keep less often than average: ${passed.join('; ')}.`)

  const records = Object.values(k.claude)
  const agreed = records.reduce((n, r) => n + r.agreed, 0)
  const disagreed = records.reduce((n, r) => n + r.disagreed, 0)
  if (agreed + disagreed >= 5) {
    const lines = [`Your earlier reads and their decisions: they went with your judgement ${agreed} times and against it ${disagreed} times.`]
    const kept = records.flatMap((r) => r.keptAnyway).slice(-6)
    const dropped = records.flatMap((r) => r.droppedAnyway).slice(-6)
    if (kept.length) lines.push(`Kept although you rated them low:\n${kept.map((t) => `- ${t}`).join('\n')}`)
    if (dropped.length) lines.push(`Dropped although you rated them high:\n${dropped.map((t) => `- ${t}`).join('\n')}`)
    parts.push(lines.join('\n'))
  }
  const notes = k.notes.slice(-4)
  if (notes.length) parts.push(`Advice you gave earlier that they kept:\n${notes.map((n) => `- ${n.text}`).join('\n')}`)

  const key = (input.people ?? []).filter((p) => p.key)
  if (key.length) parts.push(`Key people of this shoot (frames are labelled with who the app believes is in them): ${key.map((p) => p.name || 'unnamed').join(', ')}.`)

  const picks = shots.filter((s) => s.decision === 'pick')
  const rejects = shots.filter((s) => s.decision === 'reject')
  if (picks.length + rejects.length) {
    const say = (s: Shot): string => {
      const who = namesIn(s, input.people)
      const what = s.read?.what || s.score?.happening || s.analysis?.shotType || 'a frame'
      return `- ${what}${who.length ? ` [${who.join(', ')}]` : ''}`
    }
    // The most recent decisions made by hand say most about what they are looking for today.
    const recent = (list: Shot[], n: number): Shot[] => list.filter((s) => s.decidedBy !== 'accepted').slice(-n)
    const lines = [`In this shoot so far they have kept ${picks.length} and rejected ${rejects.length} frames.`]
    if (recent(picks, 1).length) lines.push(`Recently kept:\n${recent(picks, 8).map(say).join('\n')}`)
    if (recent(rejects, 1).length) lines.push(`Recently rejected:\n${recent(rejects, 5).map(say).join('\n')}`)
    parts.push(lines.join('\n'))
  }
  return parts.join('\n\n').slice(0, 6000)
}
