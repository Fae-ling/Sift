import { describe, expect, it } from 'vitest'
import { attentionMap, attentionOn, distractions, findings, notan, readBackground, separation, skinColour, skinEvenness, toLab, channels, type Reading } from '../src/renderer/src/analysis/diagnose'

const W = 96
const H = 64
const plane = { w: W, h: H }

/** Builds a small RGBA picture from a function of position. */
function picture(colour: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...colour(x, y), 255], (y * W + x) * 4)
  return data
}
const rect = (x0: number, y0: number, x1: number, y1: number): Uint8Array => {
  const m = new Uint8Array(W * H)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1
  return m
}
const inside = (x: number, y: number, r: [number, number, number, number]): boolean => x >= r[0] && x < r[2] && y >= r[1] && y < r[3]
const figure: [number, number, number, number] = [36, 12, 60, 60]

describe('attention', () => {
  it('goes to contrast and structure, not to a large even bright area', () => {
    // Left half: flat white. Right side: a small dark, detailed patch on grey.
    const data = picture((x, y) => (x < 40 ? [250, 250, 250] : inside(x, y, [64, 24, 80, 40]) ? ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? [20, 20, 20] : [220, 220, 220]) : [128, 128, 128]))
    const map = attentionMap(data, plane)
    const at = (x: number, y: number): number => map[y * W + x]
    expect(at(72, 32)).toBeGreaterThan(0.5)
    expect(at(12, 32)).toBeLessThan(0.1)
    expect(at(72, 32)).toBeGreaterThan(at(12, 32) * 5)
  })

  it('reports a contrasty object outside the subject as a distraction, and where it is', () => {
    const data = picture((x, y) => (inside(x, y, [4, 4, 14, 14]) ? [255, 240, 60] : inside(x, y, figure) ? [90, 70, 60] : [60, 60, 64]))
    const subject = rect(...figure)
    const map = attentionMap(data, plane)
    const found = distractions(map, subject, plane)
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].x).toBeLessThan(0.25)
    expect(found[0].y).toBeLessThan(0.35)
    expect(attentionOn(map, subject)).toBeLessThan(0.8)
  })
})

describe('separation of subject and background', () => {
  it('finds that a dark figure on a dark wall merges, and a dark figure on a light wall does not', () => {
    const subject = rect(...figure)
    const merged = separation(picture((x, y) => (inside(x, y, figure) ? [40, 40, 44] : [44, 44, 46])), subject, plane)
    const clear = separation(picture((x, y) => (inside(x, y, figure) ? [40, 40, 44] : [200, 200, 200])), subject, plane)
    expect(merged.mergedShare).toBeGreaterThan(0.9)
    expect(clear.mergedShare).toBeLessThan(0.05)
    expect(clear.mean).toBeGreaterThan(merged.mean)
  })

  it('says where the outline is lost when only one side merges', () => {
    // Background: dark on the left of the figure, light on the right.
    const data = picture((x, y) => (inside(x, y, figure) ? [40, 40, 44] : x < 48 ? [42, 42, 45] : [210, 210, 210]))
    const s = separation(data, rect(...figure), plane)
    expect(s.mergedShare).toBeGreaterThan(0.25)
    expect(s.mergedShare).toBeLessThan(0.75)
    expect(s.merged[0].x + s.merged[0].w / 2).toBeLessThan(0.5)
  })

  it('counts colour as separation when brightness is equal', () => {
    const subject = rect(...figure)
    const s = separation(picture((x, y) => (inside(x, y, figure) ? [200, 60, 60] : [60, 140, 60])), subject, plane)
    expect(s.mergedShare).toBeLessThan(0.1)
  })
})

describe('three masses', () => {
  it('puts a dark figure and a light wall in different masses, and a matching pair in the same one', () => {
    const subject = rect(...figure)
    const { luma: apart } = channels(picture((x, y) => (inside(x, y, figure) ? [20, 20, 20] : x < 20 ? [128, 128, 128] : [235, 235, 235])), W * H)
    const a = notan(apart, plane, subject)
    expect(a.subject).toBe(0)
    expect(a.surroundings).toBe(2)
    const { luma: same } = channels(picture((x, y) => (inside(x, y, figure) ? [22, 22, 22] : x < 20 ? [128, 128, 128] : x > 80 ? [235, 235, 235] : [20, 20, 20])), W * H)
    const b = notan(same, plane, subject)
    expect(b.subject).toBe(b.surroundings)
  })
})

describe('skin', () => {
  const skin = rect(30, 10, 66, 54)
  it('scores blotchy skin as less even than smooth skin', () => {
    const smooth = picture(() => [205, 160, 140])
    const blotchy = picture((x, y) => (Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? [225, 130, 125] : [190, 165, 145])
    expect(skinEvenness(blotchy, skin, plane).blotchiness).toBeGreaterThan(skinEvenness(smooth, skin, plane).blotchiness + 0.2)
    expect(skinEvenness(smooth, skin, plane).blotchiness).toBeLessThan(0.05)
  })

  it('measures hue in CIELAB, and the difference between face and body', () => {
    const [, a, b] = toLab(205, 160, 140)
    const hue = (Math.atan2(b, a) * 180) / Math.PI
    expect(hue).toBeGreaterThan(40)
    expect(hue).toBeLessThan(65)
    const face = rect(30, 10, 66, 30)
    const body = rect(30, 34, 66, 54)
    const matched = skinColour(picture(() => [205, 160, 140]), face, body, null)!
    const mismatched = skinColour(picture((_x, y) => (y < 32 ? [215, 150, 150] : [190, 165, 130])), face, body, null)!
    expect(matched.faceVsBody).toBeLessThan(1)
    expect(mismatched.faceVsBody).toBeGreaterThan(5)
    expect(mismatched.hue).toBeLessThan(matched.hue) // the redder face has the lower hue angle
  })
})

describe('background', () => {
  it('notices clutter crossing the outline, and counts the colour families', () => {
    const subject = rect(...figure)
    const calm = readBackground(picture((x, y) => (inside(x, y, figure) ? [90, 70, 60] : [70, 110, 150])), subject, plane)
    // Stripes only in a band beside the figure.
    const busy = readBackground(picture((x, y) => (inside(x, y, figure) ? [90, 70, 60] : x > 28 && x < 68 ? (y % 4 < 2 ? [230, 230, 230] : [30, 30, 30]) : [70, 110, 150])), subject, plane)
    expect(busy.edgesAtOutline).toBeGreaterThan(1.35)
    expect(calm.families.map((f) => f.name)).toEqual(['blue'])
    const mixed = readBackground(picture((x, y) => (inside(x, y, figure) ? [90, 70, 60] : y < 16 ? [200, 60, 50] : y < 32 ? [60, 170, 70] : y < 48 ? [60, 80, 200] : [220, 200, 50])), subject, plane)
    expect(mixed.families.length).toBe(4)
    expect(mixed.hueSpread).toBeGreaterThan(calm.hueSpread)
  })
})

describe('findings', () => {
  const base: Reading = {
    hasSubject: true, attentionOnSubject: 0.6, distractions: [], notan: { subject: 0, surroundings: 2 },
    separation: { mergedShare: 0.02, merged: [], mean: 0.4 }, skin: { blotchiness: 0.1, share: 0.1 }, skinColour: null, background: null,
    faces: [], skyShare: 0, greenShare: 0, subjectSat: 0.3, backgroundSat: 0.2, subjectContrast: 0.05, backgroundContrast: 0.03
  }
  it('has nothing to complain about in a clean picture', () => {
    expect(findings(base).filter((f) => f.level === 'attention')).toEqual([])
  })
  it('advises quietening the surroundings, not pushing the subject, when attention is elsewhere', () => {
    const f = findings({ ...base, attentionOnSubject: 0.2 }).find((x) => x.topic === 'Where the eye goes')!
    expect(f.level).toBe('attention')
    expect(f.advice).toMatch(/quieten/)
  })
  it('names a merging silhouette, a shared mass, red skin and a gaze that leaves the frame', () => {
    const out = findings({
      ...base,
      separation: { mergedShare: 0.5, merged: [{ x: 0.1, y: 0.4, w: 0.1, h: 0.3, pull: 0.01 }], mean: 0.05 },
      notan: { subject: 1, surroundings: 1 },
      skinColour: { hue: 25, hueSpread: 10, unevenness: 4, faceVsBody: 7, lips: null },
      faces: [{ x: 0.8, y: 0.2, w: 0.15, h: 0.25, yaw: 0.6 }]
    })
    const topics = out.filter((f) => f.level === 'attention').map((f) => f.topic)
    expect(topics).toEqual(expect.arrayContaining(['Subject merges with the background', 'Three masses', 'Skin hue', 'Face and body do not match', 'Gaze']))
    expect(out.find((f) => f.topic === 'Skin hue')!.mask).toBe('skin')
  })
})
