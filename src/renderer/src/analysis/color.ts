import type { ColorStats } from '@shared/types'

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

export const luma = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Tonal and colour statistics of a (small) image. */
export function colorStats(img: ImageData): ColorStats {
  const { data } = img
  const n = data.length / 4
  const hist = new Uint32Array(256)
  let sumL = 0
  let sumS = 0
  let clipLow = 0
  let clipHigh = 0
  let neutralN = 0
  let castWarm = 0
  let castTint = 0
  // Coarse colour buckets (4 bits per channel) for the palette.
  const buckets = new Map<number, [number, number, number, number]>()

  for (let p = 0; p < data.length; p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const l = luma(r, g, b)
    hist[Math.min(255, Math.round(l * 255))]++
    sumL += l
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    sumS += sat
    if (max <= 4) clipLow++
    if (min >= 251) clipHigh++
    // Low-saturation midtones should be grey; any lean they share is a cast.
    if (sat < 0.18 && l > 0.2 && l < 0.85) {
      neutralN++
      castWarm += (r - b) / 255
      castTint += ((r + b) / 2 - g) / 255
    }
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket[0] += r
      bucket[1] += g
      bucket[2] += b
      bucket[3]++
    } else buckets.set(key, [r, g, b, 1])
  }

  const percentile = (q: number): number => {
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += hist[i]
      if (acc >= q * n) return i / 255
    }
    return 1
  }

  // Palette: most common buckets, skipping any too close to one already chosen.
  const ranked = [...buckets.values()].sort((a, b) => b[3] - a[3])
  const palette: [number, number, number][] = []
  for (const [r, g, b, c] of ranked) {
    const col: [number, number, number] = [r / c, g / c, b / c]
    if (palette.every((p) => Math.hypot(p[0] - col[0], p[1] - col[1], p[2] - col[2]) > 60)) palette.push(col)
    if (palette.length === 5) break
  }

  return {
    meanLuma: sumL / n,
    p5: percentile(0.05),
    p95: percentile(0.95),
    clipLow: clipLow / n,
    clipHigh: clipHigh / n,
    meanSat: sumS / n,
    castWarm: neutralN > n * 0.02 ? castWarm / neutralN : 0,
    castTint: neutralN > n * 0.02 ? castTint / neutralN : 0,
    palette: palette.map((p) => hex(...p))
  }
}

/** Smallest distance between two hue angles, in degrees. */
export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const HUE_NAMES: [number, string][] = [
  [15, 'red'],
  [45, 'orange'],
  [70, 'yellow'],
  [160, 'green'],
  [200, 'cyan / teal'],
  [260, 'blue'],
  [300, 'purple'],
  [345, 'magenta'],
  [360, 'red']
]
export const hueName = (h: number): string => HUE_NAMES.find(([limit]) => h <= limit)![1]

export interface Harmony {
  name: string
  explain: string
}

/** Names the relationship between the dominant colourful hues of a palette. */
export function describeHarmony(palette: string[]): Harmony {
  const hues = palette
    .map((c) => rgbToHsv(parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)))
    .filter(([, s, v]) => s > 0.22 && v > 0.15)
    .map(([h]) => h)
  if (hues.length === 0) {
    return {
      name: 'Neutral / near-monochrome',
      explain:
        'Almost no saturated colour: the image is carried by tone. Contrast and the shape of the light matter more here than hue. A gentle tint in shadows or highlights will read strongly.'
    }
  }
  const spread = Math.max(...hues.flatMap((a) => hues.map((b) => hueDistance(a, b))))
  const names = [...new Set(hues.map(hueName))].join(' + ')
  if (spread < 35) {
    return {
      name: `Monochromatic (${names})`,
      explain:
        'One hue family in different tones. Calm and unified. To add depth without breaking it, vary luminance and saturation rather than introducing a new hue.'
    }
  }
  if (spread < 75) {
    return {
      name: `Analogous (${names})`,
      explain:
        'Neighbouring hues on the wheel. Harmonious and natural, like most landscapes and golden-hour light. It can feel flat: a small accent from the opposite side of the wheel gives the eye somewhere to land.'
    }
  }
  if (spread > 140) {
    return {
      name: `Complementary (${names})`,
      explain:
        'Hues from opposite sides of the wheel. Each makes the other look more vivid, which separates subject from background (warm skin against cool surroundings is the classic case). Let one colour dominate and the other accent, or the frame fights itself.'
    }
  }
  return {
    name: `Split / triadic (${names})`,
    explain:
      'Hues spaced widely but not opposite. Lively and varied. It needs a clear hierarchy: pick the colour that belongs to the subject and quieten the others in saturation or brightness.'
  }
}
