import { describe, expect, it } from 'vitest'
import type { Style, TuneResult } from '@shared/types'
import { emptyEmotions } from '../src/renderer/src/analysis/emotion'
import { digest, emptyGuidance, priorOf, toProposals, type Guidance } from '../src/renderer/src/analysis/guidance'
import { emptyKnowledge, forgiveness, ledgerOf, mergedLedger } from '../src/renderer/src/analysis/knowledge'
import { FEATURES, learn, train, type Example, type LearningData } from '../src/renderer/src/analysis/learner'
import { newStyle } from '../src/renderer/src/analysis/style'

const at = (key: string): number => FEATURES.findIndex((f) => f.key === key)
const EYES = at('eyes')
const LAUGH = at('laughing')

/** A frame where only `eyes` and `laughing` vary. */
function ex(eyes: number, laughing: number, y: 0 | 1, stack: number): Example {
  const x = new Array(FEATURES.length).fill(0)
  x[0] = 1
  x[EYES] = eyes
  x[LAUGH] = laughing
  return { x, y, w: 1, stack, h: 50 }
}
const key = (e: Example): string => String(e.stack)
const guidance = (weights: Record<string, number>, confidence: 'low' | 'medium' | 'high' = 'high'): Guidance => ({
  ...emptyGuidance(),
  priors: Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, { weight: w, confidence, why: '', at: 0 }]))
})

describe('guided training', () => {
  it('starts from the guidance when there is nothing to learn from', () => {
    const m = train([], key, priorOf(guidance({ laughing: 2 })))
    expect(m.weights[LAUGH]).toBe(2)
    expect(m.weights[EYES]).toBe(0)
  })
  it('stays close to the guidance with few decisions, and lets many decisions overrule it', () => {
    const prior = priorOf(guidance({ laughing: 2 }))
    // The photographer in fact keeps frames without laughter.
    const few = [ex(1, 0, 1, 1), ex(1, 1, 0, 2)]
    const many = Array.from({ length: 400 }, (_, i) => (i % 2 ? ex(1, 0, 1, i) : ex(1, 1, 0, i)))
    expect(train(few, key, prior).weights[LAUGH]).toBeGreaterThan(1)
    expect(train(many, key, prior).weights[LAUGH]).toBeLessThan(0)
  })

  // Many projects of a photographer who keeps laughter and does not care about eyes.
  const data = (n: number): LearningData => ({
    version: 2,
    blindBursts: false,
    projects: {
      p: {
        genre: 'wedding',
        updatedAt: 1,
        examples: Array.from({ length: n }, (_, i) => {
          const s = Math.floor(i / 2)
          // Within each burst: the laughing frame is kept, whatever the eyes.
          return i % 2 ? ex((s * 7) % 3 === 0 ? 0.2 : 0.9, 1, 1, s) : ex((s * 5) % 3 === 0 ? 0.9 : 0.3, 0, 0, s)
        })
      }
    }
  })
  it('reports whether the guidance helped on held-back bursts, and keeps it when it does', () => {
    const r = learn(data(400), 'wedding', priorOf(guidance({ laughing: 3 })))
    expect(r.report.guidance?.pairs).toBeGreaterThanOrEqual(10)
    expect(r.report.guidance?.used).toBe(true)
  })
  it('sets guidance aside when it makes the model worse there', () => {
    const r = learn(data(300), 'wedding', priorOf(guidance({ laughing: -4, eyes: 4 })))
    expect(r.report.guidance?.guided).toBeLessThan(r.report.guidance!.unguided)
    expect(r.report.guidance?.used).toBe(false)
  })
})

describe('guided forgiveness', () => {
  const empty = mergedLedger({ projects: {} }, 's')
  it('acts on an approved rule when there is no evidence yet', () => {
    const f = forgiveness(empty, ['closed eyes'], ['laughter'], [{ flaw: 'closed eyes', asset: 'laughter', factor: 0.9, confidence: 'medium' }])
    expect(f?.factor).toBe(0.9)
    expect(f?.guided).toBe(true)
    expect(forgiveness(empty, ['closed eyes'], [], [{ flaw: 'closed eyes', asset: 'laughter', factor: 0.9, confidence: 'medium' }])).toBeNull()
  })
  it('is outweighed as the photographer’s own record grows', () => {
    const shots = [
      ...Array.from({ length: 20 }, (_, i) => ({ decision: i % 2 ? 'pick' : 'reject', flaws: [], assets: [] })),
      ...Array.from({ length: 40 }, () => ({ decision: 'reject', flaws: ['closed eyes'], assets: ['laughter'] }))
    ].map((s, i) => ({ id: `s${i}`, path: '', name: '', time: 0, width: 0, height: 0, rating: 0, stackId: i, decision: s.decision as 'pick' | 'reject', decidedBy: 'manual' as const, analysis: undefined, score: { overall: 50, craft: 50, moment: 50, focus: 50, exposure: 50, faces: null, notes: [], momentNotes: [], tags: [], warnings: [], gem: false, flaws: s.flaws, assets: s.assets } }))
    const l = mergedLedger({ projects: { a: ledgerOf(shots, 's') } }, 's')
    const f = forgiveness(l, ['closed eyes'], ['laughter'], [{ flaw: 'closed eyes', asset: 'laughter', factor: 0.9, confidence: 'high' }])!
    // 40 frames of evidence that it is not forgiven against 16 frames' worth of the rule.
    expect(f.factor).toBeLessThan(0.35)
  })
})

describe('the review', () => {
  const styles: Style[] = [newStyle('st1', 'Wedding', 'wedding')]
  const req = digest({
    learning: { version: 2, blindBursts: true, projects: { p: { genre: 'wedding', updatedAt: 1, examples: [ex(1, 1, 1, 1), ex(0.2, 0, 0, 1)] } } },
    taste: null,
    knowledge: emptyKnowledge(),
    styles,
    emotions: emptyEmotions(),
    gestures: ['embrace'],
    guidance: emptyGuidance()
  })
  it('summarises what was collected, with the names Claude may use', () => {
    expect(req.digest).toContain('1 projects; 2 decided frames (1 kept, 1 rejected)')
    expect(req.digest).toContain('laughing | – | 1.00 vs 0.00')
    expect(req.allowed.features.map((f) => f.key)).toContain('eyes')
    expect(req.allowed.features.map((f) => f.key)).not.toContain('bias')
    expect(req.allowed.flaws).toContain('closed eyes')
    expect(req.allowed.assets).toEqual(expect.arrayContaining(['laughter', 'embrace']))
    expect(req.allowed.styles).toEqual([{ id: 'st1', name: 'Wedding' }])
  })
  it('keeps only proposals that name what the app knows, and holds numbers to their range', () => {
    const result: TuneResult = {
      reading: 'r',
      questions: [],
      priors: [
        { feature: 'laughing', weight: 9, confidence: 'high', why: '' },
        { feature: 'made-up', weight: 1, confidence: 'high', why: '' }
      ],
      forgive: [
        { flaw: 'closed eyes', asset: 'laughter', factor: 1.4, confidence: 'medium', why: '' },
        { flaw: 'invented flaw', asset: null, factor: 0.5, confidence: 'low', why: '' }
      ],
      exclude: [
        { key: 'feature:bright', why: '' },
        { key: 'asset:nothing', why: '' }
      ],
      styles: [
        { styleId: 'st1', emotions: [{ name: 'Joy', weight: 3, why: '' }], balance: 2, why: '' },
        { styleId: 'nope', emotions: [{ name: 'joy', weight: 1, why: '' }], balance: null, why: '' }
      ]
    }
    const out = toProposals(result, req, { styles })
    expect(out.map((p) => p.id)).toEqual(['prior:laughing', 'forgive:closed eyes|laughter', 'exclude:feature:bright', 'style:st1'])
    expect(out[0].prior!.weight).toBe(4)
    expect(out[1].forgive!.factor).toBe(1)
    expect(out[3].style).toEqual({ styleId: 'st1', emotions: [{ name: 'joy', weight: 1, current: null }], balance: 0.85 })
  })
})
