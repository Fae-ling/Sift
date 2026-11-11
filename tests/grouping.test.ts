import { describe, expect, it } from 'vitest'
import type { Analysis, Shot } from '@shared/types'
import { groupShots, hamming } from '../src/renderer/src/analysis/grouping'
import { classifyShot, relativeFocus, scoreAndSuggest } from '../src/renderer/src/analysis/scoring'

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
    const out = scoreAndSuggest(groupShots([blink, open], 120))
    const byId = new Map(out.map((s) => [s.id, s]))
    expect(byId.get(open.id)!.suggestion).toBe('pick')
    expect(byId.get(blink.id)!.suggestion).toBe('reject')
    expect(byId.get(blink.id)!.score!.warnings).toContain('blink')
  })

  it('flags a frame much softer than its scene', () => {
    const sharp = Array.from({ length: 9 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0'), { sharpness: 400 }))
    const soft = shot(400, 'f'.repeat(16), { sharpness: 20 })
    const out = scoreAndSuggest(groupShots([...sharp, soft], 600))
    expect(out.find((s) => s.id === soft.id)!.score!.warnings).toContain('soft')
    expect(out.find((s) => s.id === sharp[0].id)!.score!.warnings).not.toContain('soft')
  })

  it('never suggests a flawed frame as the keeper, even alone in its stack', () => {
    const sharp = Array.from({ length: 9 }, (_, i) => shot(i * 30, i.toString(16).padStart(16, '0')))
    const lone = shot(400, 'f'.repeat(16), { faces: [face({ blink: 0.95 })], shotType: 'medium' })
    const out = scoreAndSuggest(groupShots([...sharp, lone], 600))
    expect(out.find((s) => s.id === lone.id)!.suggestion).toBe('reject')
  })
})
