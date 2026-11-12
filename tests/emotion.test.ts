import { describe, expect, it } from 'vitest'
import type { Analysis, Shot } from '@shared/types'
import { CUES, emptyEmotions, forgetEmotion, namePointer, notice, readEmotion, SHAPES, signature, teach, toCues, type Cue } from '../src/renderer/src/analysis/emotion'
import { groupShots } from '../src/renderer/src/analysis/grouping'
import { scoreAndSuggest, triage, type ScoreOptions } from '../src/renderer/src/analysis/scoring'
import { emotionLifts, emotionWeights, mergeLifts, newStyle, STARTER_STYLES } from '../src/renderer/src/analysis/style'

/** A face's stored measurements from named shapes (0..1). */
const shapes = (set: Record<string, number>): number[] => SHAPES.map((n) => Math.round(100 * (set[n] ?? 0)))
const both = (name: string, v: number): Record<string, number> => ({ [`${name}Left`]: v, [`${name}Right`]: v })
const cuesOf = (set: Partial<Record<Cue, number>>): number[] => CUES.map((c) => set[c] ?? 0)

const LAUGH = shapes({ ...both('mouthSmile', 0.9), jawOpen: 0.6, ...both('cheekSquint', 0.6), ...both('eyeSquint', 0.5) })
const FURY = shapes({ ...both('browDown', 0.8), jawOpen: 0.8, ...both('noseSneer', 0.5), ...both('mouthStretch', 0.4), ...both('mouthUpperUp', 0.4) })
const SAD = shapes({ browInnerUp: 0.7, ...both('mouthFrown', 0.6), mouthShrugLower: 0.3 })
const REST = shapes({ ...both('mouthSmile', 0.04) })
// An expression unlike any starting emotion: cheeks puffed, lips rounded.
const ODD = shapes({ cheekPuff: 0.9, mouthFunnel: 0.7 })

describe('reading a face', () => {
  const store = emptyEmotions()
  it('turns left and right measurements into expression cues, ignoring where the eyes look', () => {
    const cues = toCues(shapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0.4, eyeLookDownLeft: 1 }))
    expect(cues[CUES.indexOf('mouthSmile')]).toBeCloseTo(0.6)
    expect(cues[CUES.indexOf('smileAsym')]).toBeCloseTo(0.4)
    expect(cues.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0)
  })

  it('names the starting emotions from their descriptions', () => {
    expect(readEmotion(toCues(LAUGH), store).name).toBe('laughter')
    expect(readEmotion(toCues(FURY), store).name).toBe('fury')
    expect(readEmotion(toCues(SAD), store).name).toBe('sadness')
  })

  it('calls a face at rest calm, and admits when it cannot name a strong expression', () => {
    expect(readEmotion(toCues(REST), store).name).toBe('calm')
    const odd = readEmotion(toCues(ODD), store)
    expect(odd.name).toBeNull()
    expect(odd.intensity).toBeGreaterThan(0.5)
  })
})

describe('teaching', () => {
  it('learns a new emotion from one example and recognises it afterwards', () => {
    const taught = teach(emptyEmotions(), 'Mischief', toCues(ODD), 'you')
    expect(taught.concepts.at(-1)!.name).toBe('mischief')
    expect(taught.concepts.at(-1)!.builtin).toBe(false)
    expect(readEmotion(toCues(ODD), taught).name).toBe('mischief')
    expect(signature(taught.concepts.at(-1)!)).toContain('cheeks puffed')
  })

  it('moves a starting emotion toward what the photographer shows it', () => {
    // This photographer's "tenderness" has open eyes and raised inner brows, unlike the description.
    const theirs = cuesOf({ browInnerUp: 0.6, mouthSmile: 0.35, cheekSquint: 0.2 })
    let store = emptyEmotions()
    expect(readEmotion(theirs, store).name).not.toBe('tenderness')
    for (let i = 0; i < 12; i++) store = teach(store, 'tenderness', theirs, 'you')
    expect(readEmotion(theirs, store).name).toBe('tenderness')
  })

  it('weighs the photographer above Claude', () => {
    const a = cuesOf({ cheekPuff: 1 })
    const b = cuesOf({ mouthFunnel: 1 })
    let store = teach(emptyEmotions(), 'x', a, 'you')
    store = teach(store, 'x', b, 'claude')
    const c = store.concepts.at(-1)!
    // Centre sits nearer the photographer's example.
    const mid = c.examples.length
    expect(mid).toBe(2)
    expect(readEmotion(a, store).similarity).toBeGreaterThan(readEmotion(b, store).similarity)
  })

  it('gathers unnamed expressions into pointers, and one name teaches about all of them', () => {
    let store = emptyEmotions()
    for (let i = 0; i < 5; i++) store = notice(store, toCues(ODD), `thumb${i}`)
    store = notice(store, toCues(shapes({ ...both('mouthDimple', 0.9), ...both('eyeWide', 0.8) })), 'other')
    expect(store.pointers.length).toBe(2)
    expect(store.pointers[0].count).toBe(5)
    const named = namePointer(store, store.pointers[0].id, 'whistle', 'you')
    expect(named.pointers.length).toBe(1)
    expect(readEmotion(toCues(ODD), named).name).toBe('whistle')
    expect(named.concepts.find((c) => c.name === 'whistle')!.examples.length).toBe(4)
  })

  it('forgetting removes a taught emotion and resets a starting one', () => {
    let store = teach(teach(emptyEmotions(), 'mischief', toCues(ODD), 'you'), 'joy', toCues(LAUGH), 'you')
    store = forgetEmotion(forgetEmotion(store, 'mischief'), 'joy')
    expect(store.concepts.some((c) => c.name === 'mischief')).toBe(false)
    expect(store.concepts.find((c) => c.name === 'joy')!.examples.length).toBe(0)
  })
})

describe('emotion in the cull', () => {
  const color = { meanLuma: 0.45, p5: 0.05, p95: 0.9, clipLow: 0, clipHigh: 0, meanSat: 0.3, castWarm: 0, castTint: 0, palette: [] }
  const face = (s: number[], over = {}): Analysis['faces'][0] => ({ x: 0.4, y: 0.2, w: 0.2, h: 0.3, blink: 0.05, smile: 0.1, sharpness: 400, skinHue: 22, skinSat: 0.4, shapes: s, ...over })
  let n = 0
  const shot = (t: number, hash: string, faces: Analysis['faces'], over: Partial<Analysis> = {}): Shot => ({
    id: `s${++n}`, path: `/x/${n}.arw`, name: `${n}.arw`, time: t * 1000, width: 6000, height: 4000, decision: null, rating: 0,
    analysis: { sharpness: 400, hash, color, faces, shotType: faces.length ? 'medium' : 'detail', ...over }
  })
  const options = (styleName: string): ScoreOptions => {
    const s = STARTER_STYLES.find((x) => x.name === styleName)!
    const style = { ...newStyle('id', s.name, s.family), ...s }
    return { genre: s.family, balance: s.balance, emotions: { store: emptyEmotions(), weights: emotionWeights(style) }, must: new Set(s.chapters.filter((c) => c.must).map((c) => c.name)) }
  }

  it('a battle style keeps the shout a wedding style would pass over', () => {
    const hash = 'ff00ff00ff00ff00'
    const pick = (styleName: string): string => {
      const calm = shot(0, hash, [face(REST)])
      const shout = shot(1, hash, [face(FURY)])
      const out = scoreAndSuggest(groupShots([calm, shout], 120), options(styleName))
      return out.find((s) => s.suggestion === 'pick')!.id === shout.id ? 'shout' : 'calm'
    }
    expect(pick('LARP and battle')).toBe('shout')
    expect(pick('Wedding')).toBe('calm')
  })

  it('reports the emotion it read, and what the style thinks of it', () => {
    const [out] = scoreAndSuggest(groupShots([shot(0, 'a'.repeat(16), [face(FURY)])], 120), options('LARP and battle'))
    expect(out.score!.emotion!.name).toBe('fury')
    expect(out.score!.faceEmotions).toEqual(['fury'])
    expect(out.score!.emotionValue).toBeGreaterThan(0.5)
    expect(out.score!.momentNotes.join(' ')).toMatch(/Reads as fury.*looking for it/)
  })

  it('does not count eyes closed in tears as a blink', () => {
    const crying = shapes({ browInnerUp: 0.7, ...both('eyeSquint', 0.6), ...both('mouthFrown', 0.5), ...both('mouthStretch', 0.4), jawOpen: 0.3, ...both('cheekSquint', 0.3) })
    const [out] = scoreAndSuggest(groupShots([shot(0, 'a'.repeat(16), [face(crying, { blink: 0.9 })])], 120), options('Wedding'))
    expect(out.score!.emotion!.name).toBe('crying')
    expect(out.score!.warnings).not.toContain('blink')
  })

  it('marks an emotion shown in a handful of frames as rare', () => {
    const many = Array.from({ length: 60 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0'), [face(LAUGH)]))
    const one = shot(5000, 'f'.repeat(16), [face(SAD)])
    const out = scoreAndSuggest(groupShots([...many, one], 100000), options('Wedding'))
    expect(out.find((s) => s.id === one.id)!.score!.tags).toContain('rare')
    expect(out.find((s) => s.id === many[0].id)!.score!.tags).not.toContain('rare')
  })

  it('never suggests rejecting the only frame of a must-have chapter, and flags misfires', () => {
    const sharp = Array.from({ length: 9 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0'), []))
    const soft: Shot = { ...shot(900, 'e'.repeat(16), [], { sharpness: 30 }), chapter: 'Ceremony' }
    const softElsewhere = shot(1200, 'd'.repeat(16), [], { sharpness: 30 })
    const black = shot(1500, 'c'.repeat(16), [], { color: { ...color, p5: 0.01, p95: 0.03, meanLuma: 0.02 } })
    const out = scoreAndSuggest(groupShots([...sharp, soft, softElsewhere, black], 100000), options('Wedding'))
    const by = (id: string): Shot => out.find((s) => s.id === id)!
    expect(by(soft.id).score!.must).toBe(true)
    expect(by(soft.id).suggestion).toBe('alternate')
    expect(by(softElsewhere.id).suggestion).toBe('reject')
    expect(by(black.id).score!.warnings).toContain('misfire')
    const t = triage(out)
    expect(t.misfire.map((s) => s.id)).toEqual([black.id])
    expect([...t.blurred, ...t.flawedTwin, ...t.spare].map((s) => s.id)).not.toContain(soft.id)
  })

  it('counts composition, where the diagnosis has looked', () => {
    const clear = shot(0, 'a'.repeat(16), [face(REST)], { diag: { merged: 0.02, attention: 0.7, pull: 0 } })
    const lost = shot(100, 'b'.repeat(16), [face(REST)], { diag: { merged: 0.7, attention: 0.15, pull: 0.25 } })
    const out = scoreAndSuggest(groupShots([clear, lost], 50), options('Portrait'))
    expect(out.find((s) => s.id === clear.id)!.score!.craft).toBeGreaterThan(out.find((s) => s.id === lost.id)!.score!.craft + 8)
  })
})

describe('a style learns which emotions its photographer keeps', () => {
  it('lifts an emotion that is kept more often than average, and folds projects together', () => {
    const frame = (emotion: string, kept: boolean, i: number): Shot => ({
      id: `${emotion}${i}`, path: '', name: '', time: 0, width: 0, height: 0, rating: 0, decision: kept ? 'pick' : 'reject',
      score: { emotion: { name: emotion, intensity: 0.8 } } as Shot['score']
    })
    const shots = [
      ...Array.from({ length: 20 }, (_, i) => frame('fury', i < 16, i)),
      ...Array.from({ length: 40 }, (_, i) => frame('joy', i < 8, i))
    ]
    const lifts = emotionLifts(shots)
    expect(lifts.fury.w).toBeGreaterThan(0.3)
    expect(lifts.joy.w).toBeLessThan(0)
    const style = { ...newStyle('id', 'x', 'event'), emotionLift: mergeLifts(mergeLifts(undefined, lifts), lifts) }
    expect(style.emotionLift.fury.n).toBe(40)
    expect(emotionWeights(style).fury).toBeGreaterThan(emotionWeights(newStyle('id', 'x', 'event')).fury)
  })
})
