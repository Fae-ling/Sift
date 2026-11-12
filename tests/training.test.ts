import { describe, expect, it } from 'vitest'
import type { Shot } from '@shared/types'
import { developTips } from '../src/renderer/src/analysis/coach'
import { DEFAULT_LIMITS, findings, type Reading } from '../src/renderer/src/analysis/diagnose'
import { deriveLook, lookStats } from '../src/renderer/src/analysis/look'
import { addSamples, addToHouseLook, emptyTraining, habitsFrom, houseLookAsLook, leniency, limitsFrom, MIN_NORM, quantile, trainingSummary } from '../src/renderer/src/analysis/training'

const many = (value: (i: number) => number, n = 40): number[] => Array.from({ length: n }, (_, i) => value(i))

describe('learning norms from finished photographs', () => {
  it('keeps the general limits until there are enough photographs', () => {
    const t = { ...emptyTraining(), norms: { merged: many(() => 0.4, MIN_NORM - 1) } }
    expect(limitsFrom(t).mergedSome).toBe(DEFAULT_LIMITS.mergedSome)
    expect(limitsFrom(t).basis).toBe('')
  })

  it('judges against the photographer\'s own finished work once there are', () => {
    // This photographer's finished pictures often lose a fifth of the outline (dark, moody work).
    const t = { ...emptyTraining(), norms: { merged: many((i) => 0.1 + (i % 10) / 50), attention: many((i) => 0.2 + (i % 10) / 40), skinHue: many((i) => 36 + (i % 8)) } }
    const L = limitsFrom(t)
    expect(L.mergedSome).toBeGreaterThan(DEFAULT_LIMITS.mergedSome)
    expect(L.attentionLow).toBeLessThan(DEFAULT_LIMITS.attentionLow)
    expect(L.skinHue[0]).toBeLessThan(DEFAULT_LIMITS.skinHue[0])
    expect(L.basis).toMatch(/40 finished photographs/)
    expect(trainingSummary(t).diagnosis).toMatch(/Learned from 40/)
  })

  it('changes what the diagnosis reports', () => {
    const reading: Reading = {
      hasSubject: true, attentionOnSubject: 0.6, distractions: [], notan: { subject: 0, surroundings: 2 },
      separation: { mergedShare: 0.2, merged: [], mean: 0.2 }, skin: null, skinColour: null, background: null,
      faces: [], skyShare: 0, greenShare: 0, subjectSat: 0.3, backgroundSat: 0.2, subjectContrast: 0.05, backgroundContrast: 0.03
    }
    const problems = (limits = DEFAULT_LIMITS): string[] => findings(reading, limits).filter((f) => f.level === 'attention').map((f) => f.topic)
    expect(problems()).toContain('Separation')
    const trained = limitsFrom({ ...emptyTraining(), norms: { merged: many((i) => 0.1 + (i % 10) / 50) } })
    expect(problems(trained)).not.toContain('Separation')
  })

  it('cannot be trained into switching a check off', () => {
    const t = { ...emptyTraining(), norms: { merged: many(() => 0.95), clutter: many(() => 9) } }
    expect(limitsFrom(t).mergedSome).toBeLessThanOrEqual(DEFAULT_LIMITS.mergedSome * 2)
    expect(limitsFrom(t).clutter).toBeLessThanOrEqual(DEFAULT_LIMITS.clutter * 1.8)
  })

  it('caps the samples it keeps and ignores values that are not numbers', () => {
    let store: Record<string, number[]> = {}
    for (let i = 0; i < 3100; i++) store = addSamples(store, { a: i, b: NaN })
    expect(store.a.length).toBe(3000)
    expect(store.a[0]).toBe(100)
    expect(store.b).toBeUndefined()
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })
})

describe('feedback', () => {
  it('relaxes a check the photographer keeps waving away, and tightens one they keep agreeing with', () => {
    expect(leniency(undefined)).toBe(1)
    expect(leniency({ agree: 0, dismiss: 3 })).toBeGreaterThan(1.2)
    expect(leniency({ agree: 3, dismiss: 0 })).toBeLessThan(0.8)
    expect(leniency({ agree: 0, dismiss: 100 })).toBe(1.8)
    const relaxed = limitsFrom({ ...emptyTraining(), feedback: { Skin: { agree: 0, dismiss: 4 } } })
    expect(relaxed.blotchySome).toBeGreaterThan(DEFAULT_LIMITS.blotchySome)
    // "Where the eye goes" is a lower bound: lenient means lower.
    const eye = limitsFrom({ ...emptyTraining(), feedback: { 'Where the eye goes': { agree: 0, dismiss: 4 } } })
    expect(eye.attentionLow).toBeLessThan(DEFAULT_LIMITS.attentionLow)
  })
})

describe('editing habits', () => {
  const shot = { analysis: { faces: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }] } } as unknown as Shot
  const brief = { moodWords: '', intention: '', clientAsk: '' } as never

  it('learns the usual range of each slider', () => {
    const h = habitsFrom({ ...emptyTraining(), habits: { Clarity2012: many((i) => 20 + (i % 11)), Saturation: many(() => 0, 5) } })
    expect(h.Clarity2012.lo).toBeGreaterThanOrEqual(20)
    expect(h.Clarity2012.hi).toBeLessThanOrEqual(30)
    expect(h.Saturation).toBeUndefined() // too few edits to call it a habit
  })

  it('stops flagging a value that is this photographer\'s style, and flags a departure from it', () => {
    const habits = habitsFrom({ ...emptyTraining(), habits: { Clarity2012: many((i) => 20 + (i % 11)), Contrast2012: many((i) => i % 6) } })
    const general = developTips({ Clarity2012: 26 }, shot, brief).find((t) => t.topic === 'Clarity')!
    const personal = developTips({ Clarity2012: 26 }, shot, brief, habits).find((t) => t.topic === 'Clarity')!
    expect(general.level).toBe('attention')
    expect(personal.level).toBe('info')
    expect(personal.finding).toMatch(/within your usual range/)
    const unusual = developTips({ Clarity2012: 26, Contrast2012: 35 }, shot, brief, habits).find((t) => t.topic === 'Outside your own habits')!
    expect(unusual.finding).toMatch(/Contrast 35/)
  })
})

describe('house look', () => {
  const image = (edit: (v: number) => number): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(1024 * 4)
    for (let i = 0; i < 1024; i++) {
      const v = edit((i % 256) / 255) * 255
      data.set([v, v, v, 255], i * 4)
    }
    return data
  }
  it('averages the looks of several before/after pairs', () => {
    const before = lookStats(image((v) => v))
    const a = deriveLook(lookStats(image((v) => 0.1 + 0.9 * v)), before)
    const b = deriveLook(lookStats(image((v) => 0.3 + 0.7 * v)), before)
    const house = addToHouseLook(addToHouseLook(null, a), b)
    expect(house.pairs).toBe(2)
    expect(house.curve[0]).toBeCloseTo((a.curve[0] + b.curve[0]) / 2, 3)
    expect(houseLookAsLook(house).curve.length).toBe(256)
  })
})
