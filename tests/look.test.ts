import { describe, expect, it } from 'vitest'
import { applyLook, deriveLook, describeLook, lookStats, mismatch, scaleLook, shiftToHueSat, toCube, toLightroomPreset } from '../src/renderer/src/analysis/look'
import { buildProfile, feelOf, mergeProfiles } from '../src/renderer/src/analysis/style'
import { groupShots } from '../src/renderer/src/analysis/grouping'
import { scoreAndSuggest } from '../src/renderer/src/analysis/scoring'
import type { Analysis, Shot } from '@shared/types'

/** A synthetic photo: a brightness ramp with some coloured and some grey pixels. */
function image(edit: (r: number, g: number, b: number) => [number, number, number] = (r, g, b) => [r, g, b]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(4096 * 4)
  for (let i = 0; i < 4096; i++) {
    const y = (i % 256) / 255
    const tint = [0, 0.15, -0.15, 0.05][i % 4]
    const [r, g, b] = edit(Math.min(1, Math.max(0, y + tint)), y, Math.min(1, Math.max(0, y - tint)))
    data.set([r * 255, g * 255, b * 255, 255], i * 4)
  }
  return data
}
const mean = (d: Uint8ClampedArray, ch: number): number => {
  let s = 0
  for (let p = ch; p < d.length; p += 4) s += d[p]
  return s / (d.length / 4) / 255
}

describe('look extraction', () => {
  // A known edit: lifted blacks, lowered whites, a warm shift.
  const graded = image((r, g, b) => [0.1 + 0.8 * r + 0.04, 0.1 + 0.8 * g, 0.1 + 0.8 * b - 0.04])

  it('recovers a known edit when given the starting image', () => {
    const look = deriveLook(lookStats(graded), lookStats(image()))
    expect(look.estimated).toBe(false)
    const out = image((r, g, b) => applyLook(look, r, g, b))
    for (const ch of [0, 1, 2]) expect(Math.abs(mean(out, ch) - mean(graded, ch))).toBeLessThan(0.02)
    expect(look.curve[0]).toBeGreaterThan(0.06)
    expect(look.curve[255]).toBeLessThan(0.94)
  })

  it('reads lifted blacks and a warm tint from the reference alone', () => {
    const look = deriveLook(lookStats(graded))
    expect(look.estimated).toBe(true)
    expect(look.curve[0]).toBeGreaterThan(0.06)
    const { hue } = shiftToHueSat(look.shift[1])
    expect(hue).toBeGreaterThan(10)
    expect(hue).toBeLessThan(70)
    expect(describeLook(look).join(' ')).toMatch(/Blacks are lifted/)
  })

  it('leaves a neutral image alone', () => {
    const look = deriveLook(lookStats(image()), lookStats(image()))
    const [r, g, b] = applyLook(look, 0.5, 0.4, 0.3)
    expect(r).toBeCloseTo(0.5, 1)
    expect(g).toBeCloseTo(0.4, 1)
    expect(b).toBeCloseTo(0.3, 1)
  })

  it('can be dialled back, and notices when two photos are too unlike to compare', () => {
    const look = deriveLook(lookStats(graded), lookStats(image()))
    expect(applyLook(scaleLook(look, 0), 0.5, 0.4, 0.3).map((v) => +v.toFixed(2))).toEqual([0.5, 0.4, 0.3])
    expect(scaleLook(look, 0.5).curve[0]).toBeCloseTo(look.curve[0] / 2, 2)
    expect(mismatch(lookStats(image()), lookStats(image()))).toBe(0)
    expect(mismatch(lookStats(image()), lookStats(image((r, g, b) => [r * 0.2, g * 0.2, b * 0.2])))).toBeGreaterThan(0.16)
  })

  it('writes a well-formed .cube file and Lightroom preset', () => {
    const look = deriveLook(lookStats(graded), lookStats(image()))
    const lines = toCube(look, 'Test "look"', 17).trim().split('\n')
    expect(lines).toContain('LUT_3D_SIZE 17')
    const rows = lines.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l))
    expect(rows.length).toBe(17 ** 3)
    // Red changes fastest: the second entry differs from the first in red.
    expect(rows[1].split(' ')[0]).not.toBe(rows[0].split(' ')[0])
    const preset = toLightroomPreset(look, 'A & B')
    expect(preset).toContain('crs:PresetType="Normal"')
    expect(preset).toContain('A &amp; B')
    expect((preset.match(/<rdf:li>\d+, \d+<\/rdf:li>/g) ?? []).length).toBe(9)
  })
})

describe('culling profiles', () => {
  const color = { meanLuma: 0.45, p5: 0.05, p95: 0.9, clipLow: 0, clipHigh: 0, meanSat: 0.3, castWarm: 0, castTint: 0, palette: [] }
  const face = (over = {}): Analysis['faces'][0] => ({ x: 0.4, y: 0.2, w: 0.2, h: 0.3, blink: 0.05, smile: 0.1, sharpness: 400, skinHue: 22, skinSat: 0.4, ...over })
  const frame = (faces: Analysis['faces'], shotType: Analysis['shotType'] = 'medium'): Analysis => ({ sharpness: 400, hash: 'a'.repeat(16), color, faces, shotType })

  it('summarises what a gallery has in common', () => {
    const laughing = face({ smile: 0.9, jawOpen: 0.6, squint: 0.6, blink: 0.9 })
    const p = buildProfile([frame([laughing]), frame([laughing]), frame([face()]), frame([], 'detail')])
    expect(p.count).toBe(4)
    expect(p.facesShare).toBeCloseTo(0.75)
    expect(p.laughShare).toBeCloseTo(2 / 3)
    expect(p.closedEyesShare).toBeCloseTo(2 / 3)
    expect(p.shotTypes.detail).toBeCloseTo(0.25)
  })

  it('keeps learning: merging weights each source by its size', () => {
    const a = buildProfile([frame([face({ smile: 0.9, jawOpen: 0.6 })])])
    const b = buildProfile([frame([face()]), frame([face()]), frame([face()])])
    const merged = mergeProfiles([a, b])!
    expect(merged.count).toBe(4)
    expect(merged.laughShare).toBeCloseTo(0.25)
  })

  it('turns atmosphere words into what the cull rewards', () => {
    expect(feelOf(['joyful', 'candid']).expression).toBeGreaterThan(0)
    expect(feelOf(['Intimate']).connection).toBeGreaterThan(0)
    expect(feelOf(['moody', 'editorial']).expression).toBeLessThan(0)
    expect(feelOf(['documentary']).forgiving).toBe(true)
    expect(feelOf(['unknown word'])).toEqual({ expression: 0, connection: 0, quiet: 0, balance: 0, forgiving: false })
  })

  it('a joyful profile prefers the laughing frame; an editorial one the composed frame', () => {
    const hash = 'ff00ff00ff00ff00'
    const shot = (id: string, t: number, faces: Analysis['faces'], sharpness: number): Shot => ({
      id, path: `/x/${id}.arw`, name: id, time: t * 1000, width: 6000, height: 4000, decision: null, rating: 0,
      analysis: { ...frame(faces), sharpness, hash }
    })
    const calm = shot('calm', 0, [face({ sharpness: 400 })], 400)
    const laugh = shot('laugh', 1, [face({ smile: 0.9, jawOpen: 0.6, squint: 0.6, sharpness: 330 })], 330)
    const pick = (tags: string[]): string =>
      scoreAndSuggest(groupShots([calm, laugh], 120), { genre: 'portrait', balance: 0.3, feel: feelOf(tags) }).find((s) => s.suggestion === 'pick')!.id
    expect(pick(['joyful', 'documentary'])).toBe('laugh')
    expect(pick(['editorial', 'polished'])).toBe('calm')
  })
})
