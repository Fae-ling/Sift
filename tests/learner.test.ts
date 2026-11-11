import { describe, expect, it } from 'vitest'
import type { Analysis, Shot } from '@shared/types'
import { groupShots } from '../src/renderer/src/analysis/grouping'
import { emptyLearning, examplesOf, FEATURES, featuresOf, isBlindBurst, learn, MIN_TESTED_PAIRS, tendencies, trimmed } from '../src/renderer/src/analysis/learner'
import { scoreAndSuggest } from '../src/renderer/src/analysis/scoring'

const color = { meanLuma: 0.45, p5: 0.05, p95: 0.9, clipLow: 0, clipHigh: 0, meanSat: 0.3, castWarm: 0, castTint: 0, palette: [] }
const face = (over = {}): Analysis['faces'][0] => ({ x: 0.4, y: 0.2, w: 0.2, h: 0.3, blink: 0.05, smile: 0.1, sharpness: 400, skinHue: 22, skinSat: 0.4, ...over })

/**
 * A shoot of two-frame bursts: a calm, sharp take and a laughing, softer one.
 * `choose` plays the photographer.
 */
function shoot(bursts: number, choose: (i: number) => 'calm' | 'laugh', how: Partial<Shot> = { decidedBy: 'manual' }): Shot[] {
  const shots: Shot[] = []
  for (let i = 0; i < bursts; i++) {
    const hash = i.toString(16).padStart(16, '0')
    const make = (id: string, t: number, sharp: number, faces: Analysis['faces']): Shot => ({
      id: `${id}${i}`, path: `/x/${id}${i}.arw`, name: `${id}${i}`, time: (i * 100 + t) * 1000, width: 6000, height: 4000, decision: null, rating: 0,
      analysis: { sharpness: sharp, hash, color, faces, shotType: 'medium' }
    })
    // Vary the sharpness a little so the examples are not all identical.
    const wobble = 1 + ((i * 37) % 10) / 50
    shots.push(make('calm', 0, 400 * wobble, [face({ sharpness: 400 * wobble })]))
    shots.push(make('laugh', 1, 250 * wobble, [face({ smile: 0.9, jawOpen: 0.6, squint: 0.6, sharpness: 250 * wobble })]))
  }
  // Craft-only rules: they will always prefer the calm, sharp take.
  const scored = scoreAndSuggest(groupShots(shots, 50), { genre: 'wedding', balance: 0 })
  return scored.map((s) => {
    const i = Number(s.id.replace(/\D/g, ''))
    const kept = s.id.startsWith(choose(i))
    return { ...s, decision: kept ? 'pick' : 'reject', suggestedThen: s.suggestion, ...how } as Shot
  })
}
const dataFrom = (shots: Shot[]) => ({ ...emptyLearning(), projects: { p1: { genre: 'wedding' as const, updatedAt: 1, examples: examplesOf(shots) } } })

describe('learning the photographer\'s taste', () => {
  it('describes every frame with the full list of named measurements', () => {
    const shots = shoot(1, () => 'laugh')
    const x = featuresOf(shots[1], shots)
    expect(x.length).toBe(FEATURES.length)
    expect(x[FEATURES.findIndex((f) => f.key === 'laughing')]).toBe(1)
    expect(x[FEATURES.findIndex((f) => f.key === 'focusVsBest')]).toBeLessThan(0)
  })

  it('learns that this photographer keeps the laugh, and earns a say in suggestions', () => {
    const taste = learn(dataFrom(shoot(240, () => 'laugh')), 'wedding')
    expect(taste.report.testedPairs).toBeGreaterThanOrEqual(MIN_TESTED_PAIRS)
    expect(taste.report.rulesAgree).toBeLessThan(0.1)
    expect(taste.report.learnedAgree).toBeGreaterThan(0.9)
    expect(taste.trust).toBeGreaterThan(0)
    expect(taste.report.blendedAgree).toBeGreaterThan(taste.report.rulesAgree)
    expect(tendencies(taste.model).join(' ')).toMatch(/laughter|joy|expressive/)
  })

  it('then changes what is suggested in a new shoot', () => {
    const taste = learn(dataFrom(shoot(240, () => 'laugh')), 'wedding')
    const fresh = shoot(1, () => 'calm').map((s) => ({ ...s, decision: null }) as Shot)
    const before = scoreAndSuggest(fresh, { genre: 'wedding', balance: 0 }).find((s) => s.suggestion === 'pick')!.id
    const after = scoreAndSuggest(fresh, { genre: 'wedding', balance: 0, learned: { model: taste.model, trust: 0.8 } }).find((s) => s.suggestion === 'pick')!.id
    expect(before).toBe('calm0')
    expect(after).toBe('laugh0')
  })

  it('stays out of the way until there is enough evidence', () => {
    const taste = learn(dataFrom(shoot(20, () => 'laugh')), 'wedding')
    expect(taste.report.testedPairs).toBeLessThan(MIN_TESTED_PAIRS)
    expect(taste.trust).toBe(0)
  })

  it('earns no say when the built-in rules already match the photographer', () => {
    // This photographer always keeps the sharp take, exactly as the rules suggest.
    expect(learn(dataFrom(shoot(240, () => 'calm')), 'wedding').trust).toBe(0)
  })

  it('earns no say from choices with no pattern in them', () => {
    const taste = learn(dataFrom(shoot(240, (i) => ((i * 7919) % 13 < 6 ? 'calm' : 'laugh'))), 'wedding')
    expect(taste.report.learnedAgree).toBeLessThan(0.75)
    expect(taste.trust).toBe(0)
  })

  it('counts a choice made by hand for more than an accepted suggestion, and an unprompted one for most', () => {
    const w = (how: Partial<Shot>, choice: 'calm' | 'laugh' = 'calm'): number => examplesOf(shoot(1, () => choice, how)).find((e) => e.y === 1)!.w
    expect(w({ decidedBy: 'manual' })).toBeGreaterThan(w({ decidedBy: 'accepted' }))
    expect(w({ decidedBy: 'manual', blind: true })).toBeGreaterThan(w({ decidedBy: 'manual' }))
    // Overruling a suggestion counts the same as agreeing with it by hand: no reward for being contrary.
    expect(w({ decidedBy: 'manual' }, 'laugh')).toBe(w({ decidedBy: 'manual' }, 'calm'))
  })

  it('treats frames passed over beside a pick as weak evidence, and ignores untouched bursts', () => {
    const shots = shoot(2, () => 'laugh').map((s) => (s.id === 'calm0' || s.id.endsWith('1') ? { ...s, decision: null } : s) as Shot)
    const examples = examplesOf(shots)
    expect(examples.length).toBe(2) // burst 0 only; burst 1 was not touched
    expect(examples.find((e) => e.y === -1)!.w).toBe(0.5)
  })

  it('hides about one burst in ten, the same ones every time', () => {
    const hidden = Array.from({ length: 2000 }, (_, i) => isBlindBurst('project', i)).filter(Boolean).length
    expect(hidden).toBeGreaterThan(140)
    expect(hidden).toBeLessThan(260)
    expect(isBlindBurst('project', 7)).toBe(isBlindBurst('project', 7))
  })

  it('forgets the oldest projects first when the store is full', () => {
    const examples = examplesOf(shoot(10, () => 'laugh'))
    const data = { ...emptyLearning(), projects: { old: { genre: 'wedding' as const, updatedAt: 1, examples }, recent: { genre: 'wedding' as const, updatedAt: 2, examples } } }
    expect(Object.keys(trimmed(data, 25).projects)).toEqual(['recent'])
  })
})
