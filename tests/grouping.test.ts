import { describe, expect, it } from 'vitest'
import type { Analysis, Shot } from '@shared/types'
import { groupShots, hamming } from '../src/renderer/src/analysis/grouping'
import { classifyShot, readMoment, relativeFocus, scoreAndSuggest, tasteOf } from '../src/renderer/src/analysis/scoring'

const wedding = { genre: 'wedding' as const, balance: 0.55 }

const color = { meanLuma: 0.45, p5: 0.05, p95: 0.9, clipLow: 0, clipHigh: 0, meanSat: 0.3, castWarm: 0, castTint: 0, palette: [] }
const face = (over: Partial<Analysis['faces'][0]> = {}): Analysis['faces'][0] => ({
  x: 0.4, y: 0.2, w: 0.2, h: 0.3, blink: 0.05, smile: 0.2, sharpness: 400, skinHue: 22, skinSat: 0.4, ...over
})
let n = 0
const shot = (timeSec: number, hash: string, analysis: Partial<Analysis> = {}): Shot => ({
  id: `s${++n}`, path: `/x/${n}.arw`, name: `${n}.arw`, time: timeSec * 1000, width: 6000, height: 4000,
  decision: null, rating: 0,
  analysis: { sharpness: 400, hash, color, faces: [], shotType: 'detail', ...analysis }
})

describe('hamming', () => {
  it('counts differing bits', () => {
    expect(hamming('0000000000000000', '0000000000000000')).toBe(0)
    expect(hamming('ffffffffffffffff', '0000000000000000')).toBe(64)
    expect(hamming('8000000000000001', '0000000000000000')).toBe(2)
  })
})

describe('groupShots', () => {
  it('stacks near-identical frames taken seconds apart', () => {
    const out = groupShots([shot(0, 'ff00ff00ff00ff00'), shot(1, 'ff00ff00ff00ff01'), shot(2, '00ff00ff00ff00ff')], 120)
    expect(out.map((s) => s.stackId)).toEqual([1, 1, 2])
    expect(new Set(out.map((s) => s.sceneId)).size).toBe(1)
  })

  it('does not stack look-alikes taken far apart', () => {
    const out = groupShots([shot(0, 'ff00ff00ff00ff00'), shot(60, 'ff00ff00ff00ff00')], 120)
    expect(out[0].stackId).not.toBe(out[1].stackId)
  })

  it('starts a new scene after a pause, and returns capture order', () => {
    const out = groupShots([shot(1000, 'aa'.repeat(8)), shot(0, 'aa'.repeat(8)), shot(5, 'aa'.repeat(8))], 120)
    expect(out.map((s) => s.time)).toEqual([0, 5000, 1000000])
    expect(out.map((s) => s.sceneId)).toEqual([1, 1, 2])
  })
})

describe('scoring', () => {
  it('halving sharpness costs 25 focus points', () => {
    expect(relativeFocus(400, 400)).toBe(100)
    expect(relativeFocus(200, 400)).toBe(75)
    expect(relativeFocus(1, 400)).toBe(0)
  })

  it('classifies by the size and number of faces', () => {
    expect(classifyShot([])).toBe('detail')
    expect(classifyShot([face({ h: 0.5 })])).toBe('close-up')
    expect(classifyShot([face({ h: 0.2 })])).toBe('medium')
    expect(classifyShot([face({ h: 0.08 })])).toBe('wide')
    expect(classifyShot([face(), face(), face()])).toBe('group')
    expect(classifyShot([face({ h: 0.02 })])).toBe('detail')
  })

  it('suggests the open-eyed frame of a stack and rejects the blink', () => {
    const hash = 'ff00ff00ff00ff00'
    const open = shot(0, hash, { faces: [face()], shotType: 'medium' })
    const blink = shot(1, hash, { faces: [face({ blink: 0.9 })], shotType: 'medium' })
    const out = scoreAndSuggest(groupShots([blink, open], 120), wedding)
    const byId = new Map(out.map((s) => [s.id, s]))
    expect(byId.get(open.id)!.suggestion).toBe('pick')
    expect(byId.get(blink.id)!.suggestion).toBe('reject')
    expect(byId.get(blink.id)!.score!.warnings).toContain('blink')
  })

  it('flags a frame much softer than its scene', () => {
    const sharp = Array.from({ length: 9 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0'), { sharpness: 400 }))
    const soft = shot(400, 'f'.repeat(16), { sharpness: 20 })
    const out = scoreAndSuggest(groupShots([...sharp, soft], 600), wedding)
    expect(out.find((s) => s.id === soft.id)!.score!.warnings).toContain('soft')
    expect(out.find((s) => s.id === sharp[0].id)!.score!.warnings).not.toContain('soft')
  })

  it('never suggests a flawed frame as the keeper, even alone in its stack', () => {
    const sharp = Array.from({ length: 9 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0')))
    const lone = shot(400, 'f'.repeat(16), { faces: [face({ blink: 0.95 })], shotType: 'medium' })
    const out = scoreAndSuggest(groupShots([...sharp, lone], 600), wedding)
    expect(out.find((s) => s.id === lone.id)!.suggestion).toBe('reject')
  })
})

describe('the moment', () => {
  const laughing = face({ smile: 0.9, jawOpen: 0.6, squint: 0.6, blink: 0.9 })

  it('reads closed eyes inside a laugh as the moment, not a blink', () => {
    const moment = readMoment([laughing])!
    expect(moment.laughing).toBe(true)
    expect(moment.eyesExplained.has(0)).toBe(true)
    const [out] = scoreAndSuggest(groupShots([shot(0, 'a'.repeat(16), { faces: [laughing], shotType: 'medium' })], 120), wedding)
    expect(out.score!.warnings).not.toContain('blink')
    expect(out.score!.tags).toContain('laugh')
    expect(out.suggestion).toBe('pick')
  })

  it('sees two people turned toward each other, and an embrace', () => {
    const left = face({ x: 0.2, yaw: 0.5 })
    const right = face({ x: 0.6, yaw: -0.5 })
    expect(readMoment([left, right])!.connection).toBeGreaterThan(0.4)
    expect(readMoment([face({ x: 0.2, yaw: -0.5 }), face({ x: 0.6, yaw: 0.5 })])!.connection).toBeLessThan(0.1)
    expect(readMoment([face({ x: 0.3 }), face({ x: 0.45 })])!.connection).toBeGreaterThan(0.75)
  })

  it('prefers the laughing frame of a burst when the moment counts, the sharper one when it does not', () => {
    const hash = 'ff00ff00ff00ff00'
    const calm = shot(0, hash, { sharpness: 400, faces: [face({ sharpness: 400 })], shotType: 'medium' })
    const laugh = shot(1, hash, { sharpness: 300, faces: [face({ smile: 0.9, jawOpen: 0.6, squint: 0.6, sharpness: 300 })], shotType: 'medium' })
    const pick = (balance: number): string =>
      scoreAndSuggest(groupShots([calm, laugh], 120), { genre: 'wedding', balance }).find((s) => s.suggestion === 'pick')!.id
    expect(pick(0.6)).toBe(laugh.id)
    expect(pick(0)).toBe(calm.id)
  })

  it('keeps a flawed frame in front of the photographer when the editor calls it a gem', () => {
    const sharp = Array.from({ length: 9 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0')))
    const blurred: Shot = { ...shot(400, 'f'.repeat(16), { sharpness: 20 }), read: { beat: 'First dance and party', moment: 9, gem: true, note: 'x' } }
    const twin = shot(401, 'f'.repeat(16), { sharpness: 400 })
    const out = scoreAndSuggest(groupShots([...sharp, blurred, twin], 600), wedding)
    const gem = out.find((s) => s.id === blurred.id)!
    expect(gem.score!.gem).toBe(true)
    expect(gem.suggestion).toBe('alternate')
  })

  it('does not count a quiet face against a fashion frame', () => {
    const quiet = shot(0, 'a'.repeat(16), { faces: [face({ smile: 0 })], shotType: 'medium' })
    const score = (genre: 'fashion' | 'wedding'): number => scoreAndSuggest(groupShots([quiet], 120), { genre, balance: 0.5 })[0].score!.moment!
    expect(score('fashion')).toBeGreaterThan(score('wedding'))
  })
})

describe('tasteOf', () => {
  it('finds the balance that matches the photographer\'s choices', () => {
    const shots: Shot[] = []
    for (let i = 0; i < 14; i++) {
      const hash = i.toString(16).padStart(16, '0')
      const calm = shot(i * 100, hash, { sharpness: 400, faces: [face({ sharpness: 400 })], shotType: 'medium' })
      const laugh = shot(i * 100 + 1, hash, { sharpness: 250, faces: [face({ smile: 0.9, jawOpen: 0.6, squint: 0.6, sharpness: 250 })], shotType: 'medium' })
      shots.push({ ...calm, decision: 'reject' }, { ...laugh, decision: 'pick' })
    }
    const taste = tasteOf(scoreAndSuggest(groupShots(shots, 50), { genre: 'wedding', balance: 0 }))
    expect(taste.rescued).toBe(14)
    expect(taste.fittedBalance).toBeGreaterThan(0.2)
  })
})
