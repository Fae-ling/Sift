// Reads a photograph the way a retoucher does before touching it: where does
// the eye go, does the subject separate from the background, is the skin even,
// what pulls attention that should not. Everything here is plain arithmetic on
// pixels and masks, done on the user's machine.
//
// All maps share one small working size (about 384 px on the long edge): these
// are questions about masses and edges, not about fine detail.

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v))

export interface Plane {
  w: number
  h: number
}

/** Luminance (0..1) and two colour-opponent channels of an RGBA image. */
export function channels(data: Uint8ClampedArray, n: number): { luma: Float32Array; rg: Float32Array; by: Float32Array } {
  const luma = new Float32Array(n)
  const rg = new Float32Array(n)
  const by = new Float32Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p] / 255
    const g = data[p + 1] / 255
    const b = data[p + 2] / 255
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
    rg[i] = r - g
    by[i] = b - (r + g) / 2
  }
  return { luma, rg, by }
}

/** Box blur with the given radius (two passes give a good-enough soft blur). */
export function blur(src: Float32Array, { w, h }: Plane, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius))
  const pass = (input: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(input.length)
    const len = horizontal ? w : h
    const lines = horizontal ? h : w
    for (let line = 0; line < lines; line++) {
      let sum = 0
      let count = 0
      const at = (k: number): number => input[horizontal ? line * w + k : k * w + line]
      for (let k = 0; k <= Math.min(r, len - 1); k++) {
        sum += at(k)
        count++
      }
      for (let k = 0; k < len; k++) {
        out[horizontal ? line * w + k : k * w + line] = sum / count
        const add = k + r + 1
        const drop = k - r
        if (add < len) {
          sum += at(add)
          count++
        }
        if (drop >= 0) {
          sum -= at(drop)
          count--
        }
      }
    }
    return out
  }
  return pass(pass(pass(pass(src, true), false), true), false)
}

function normalise(map: Float32Array): Float32Array {
  let max = 0
  for (const v of map) max = Math.max(max, v)
  if (max > 0) for (let i = 0; i < map.length; i++) map[i] /= max
  return map
}

/**
 * Where the eye is drawn by the picture alone, before it recognises anything.
 * Attention follows local contrast: places that differ from their surroundings
 * in brightness or colour, and above all edges with structure. A large, even,
 * bright area scores nothing here, which matches what eye-tracking finds: the
 * eye does not go to the brightest place, it goes to contrast.
 */
export function attentionMap(data: Uint8ClampedArray, plane: Plane): Float32Array {
  const n = plane.w * plane.h
  const { luma, rg, by } = channels(data, n)
  const out = new Float32Array(n)
  const size = Math.max(plane.w, plane.h)
  // Centre-surround: how much each place differs from its neighbourhood, at two scales.
  for (const [channel, weight] of [[luma, 1], [rg, 0.7], [by, 0.7]] as [Float32Array, number][]) {
    for (const [fine, coarse] of [[size / 96, size / 16], [size / 40, size / 6]]) {
      const a = blur(channel, plane, fine)
      const b = blur(channel, plane, coarse)
      for (let i = 0; i < n; i++) out[i] += weight * Math.abs(a[i] - b[i])
    }
  }
  // Edges: where brightness changes sharply. Structure holds the eye; flat areas do not.
  const edges = new Float32Array(n)
  for (let y = 1; y < plane.h - 1; y++) {
    for (let x = 1; x < plane.w - 1; x++) {
      const i = y * plane.w + x
      edges[i] = Math.hypot(luma[i + 1] - luma[i - 1], luma[i + plane.w] - luma[i - plane.w])
    }
  }
  const soft = blur(edges, plane, size / 48)
  for (let i = 0; i < n; i++) out[i] += 2.5 * soft[i]
  return normalise(blur(out, plane, size / 64))
}

/** Adds what the eye does once it recognises a face: go there first. */
export function withFaces(attention: Float32Array, plane: Plane, faces: { x: number; y: number; w: number; h: number }[]): Float32Array {
  const out = Float32Array.from(attention)
  for (const f of faces) {
    const cx = (f.x + f.w / 2) * plane.w
    const cy = (f.y + f.h * 0.42) * plane.h
    const rx = Math.max(2, (f.w * plane.w) / 1.6)
    const ry = Math.max(2, (f.h * plane.h) / 1.6)
    for (let y = Math.max(0, Math.floor(cy - 2 * ry)); y < Math.min(plane.h, cy + 2 * ry); y++) {
      for (let x = Math.max(0, Math.floor(cx - 2 * rx)); x < Math.min(plane.w, cx + 2 * rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        out[y * plane.w + x] += 1.4 * Math.exp(-d)
      }
    }
  }
  return normalise(out)
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** Share of the picture's total attention this region takes. */
  pull: number
}

/**
 * Things that pull the eye without being the subject: compact regions of high
 * attention outside the subject. Returned strongest first, as fractions of the frame.
 */
export function distractions(attention: Float32Array, subject: Uint8Array | null, plane: Plane, limit = 3): Box[] {
  const { w, h } = plane
  let total = 0
  let peak = 0
  for (let i = 0; i < attention.length; i++) {
    total += attention[i]
    if (!subject?.[i]) peak = Math.max(peak, attention[i])
  }
  const threshold = Math.max(0.45, peak * 0.6)
  const seen = new Uint8Array(w * h)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || subject?.[start] || attention[start] < threshold) continue
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let mass = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w
      const y = (i / w) | 0
      mass += attention[i]
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || subject?.[j] || attention[j] < threshold * 0.7) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    const area = (maxX - minX + 1) * (maxY - minY + 1)
    // Specks are noise; anything covering a third of the frame is the scene, not a distraction.
    if (area < w * h * 0.002 || area > w * h * 0.33) continue
    boxes.push({ x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h, pull: mass / total })
  }
  return boxes.sort((a, b) => b.pull - a.pull).slice(0, limit)
}

/** Share of all attention that falls on the subject. */
export function attentionOn(attention: Float32Array, subject: Uint8Array): number {
  let on = 0
  let total = 0
  for (let i = 0; i < attention.length; i++) {
    total += attention[i]
    if (subject[i]) on += attention[i]
  }
  return total ? on / total : 0
}

export interface Notan {
  /** 0 dark, 1 middle, 2 light, per pixel. */
  levels: Uint8Array
  /** Which of the three masses the subject and its surroundings mostly sit in. */
  subject: number | null
  surroundings: number | null
}

/**
 * Notan: the picture reduced to three masses of dark, middle and light, the
 * way painters squint at a subject. If the picture still reads like this, its
 * structure is sound; if the subject sits in the same mass as what is behind
 * it, it will merge.
 */
export function notan(luma: Float32Array, plane: Plane, subject: Uint8Array | null): Notan {
  const soft = blur(luma, plane, Math.max(plane.w, plane.h) / 160)
  const sorted = Float32Array.from(soft).sort()
  // Split at the terciles of the picture's own tones, so a dark picture still shows three masses.
  const lo = sorted[Math.floor(sorted.length / 3)]
  const hi = sorted[Math.floor((sorted.length * 2) / 3)]
  const levels = new Uint8Array(soft.length)
  for (let i = 0; i < soft.length; i++) levels[i] = soft[i] < lo ? 0 : soft[i] < hi ? 1 : 2
  if (!subject) return { levels, subject: null, surroundings: null }
  const near = ring(subject, plane, Math.max(plane.w, plane.h) / 14)
  const mode = (mask: Uint8Array): number | null => {
    const count = [0, 0, 0]
    for (let i = 0; i < mask.length; i++) if (mask[i]) count[levels[i]]++
    return count[0] + count[1] + count[2] ? count.indexOf(Math.max(...count)) : null
  }
  return { levels, subject: mode(subject), surroundings: mode(near) }
}

/** The band of background just outside a mask. */
export function ring(mask: Uint8Array, plane: Plane, radius: number): Uint8Array {
  const f = Float32Array.from(mask)
  const grown = blur(f, plane, radius)
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = !mask[i] && grown[i] > 0.04 ? 1 : 0
  return out
}

export interface Separation {
  /** Per outline pixel: how clearly the subject differs from what is behind it there (0..1); -1 elsewhere. */
  edge: Float32Array
  /** Share of the outline where the subject merges with the background. */
  mergedShare: number
  /** Stretches of outline that merge, as boxes, longest first. */
  merged: Box[]
  /** Mean contrast along the outline. */
  mean: number
}

/** Outline contrast below this reads as "merging". */
const MERGE_LIMIT = 0.09

/**
 * Walks the subject's outline and asks, at each point, whether the subject
 * just inside differs from the background just outside: in brightness first,
 * then in colour. Where it does not, the silhouette is lost.
 */
export function separation(data: Uint8ClampedArray, subject: Uint8Array, plane: Plane): Separation {
  const { w, h } = plane
  const n = w * h
  const { luma, rg, by } = channels(data, n)
  const radius = Math.max(w, h) / 70
  const inside = Float32Array.from(subject)
  const outside = inside.map((v) => 1 - v)
  // Local averages taken only over the subject, and only over the background.
  const avg = (channel: Float32Array, weight: Float32Array): Float32Array => {
    const num = blur(channel.map((v, i) => v * weight[i]), plane, radius)
    const den = blur(weight, plane, radius)
    return num.map((v, i) => (den[i] > 1e-3 ? v / den[i] : 0))
  }
  const inL = avg(luma, inside)
  const outL = avg(luma, outside)
  const inRg = avg(rg, inside)
  const outRg = avg(rg, outside)
  const inBy = avg(by, inside)
  const outBy = avg(by, outside)

  const edge = new Float32Array(n).fill(-1)
  const weak = new Uint8Array(n)
  let count = 0
  let merged = 0
  let sum = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!subject[i] || (subject[i - 1] && subject[i + 1] && subject[i - w] && subject[i + w])) continue
      // Brightness separates most strongly; colour difference counts for somewhat less.
      const contrast = clamp(Math.abs(inL[i] - outL[i]) + 0.6 * Math.hypot(inRg[i] - outRg[i], inBy[i] - outBy[i]))
      edge[i] = contrast
      sum += contrast
      count++
      if (contrast < MERGE_LIMIT) {
        merged++
        weak[i] = 1
      }
    }
  }
  // Group merging outline pixels that lie close together into stretches.
  const grouped = blur(Float32Array.from(weak), plane, Math.max(w, h) / 50)
  const blob = new Uint8Array(n)
  for (let i = 0; i < n; i++) blob[i] = grouped[i] > 0.012 ? 1 : 0
  const fake = new Float32Array(n)
  for (let i = 0; i < n; i++) fake[i] = blob[i]
  const boxes = distractionsLike(fake, plane).filter((b) => Math.max(b.w, b.h) > 0.06)
  return { edge, mergedShare: count ? merged / count : 0, merged: boxes.slice(0, 3), mean: count ? sum / count : 0 }
}

/** Connected regions of a 0/1 map as boxes, largest first. */
function distractionsLike(map: Float32Array, plane: Plane): Box[] {
  const { w, h } = plane
  const seen = new Uint8Array(w * h)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !map[start]) continue
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let size = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w
      const y = (i / w) | 0
      size++
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || !map[j]) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    boxes.push({ x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h, pull: size / (w * h) })
  }
  return boxes.sort((a, b) => b.pull - a.pull)
}

export interface SkinReport {
  /** 0 perfectly even, 1 very blotchy. */
  blotchiness: number
  /** Per skin pixel: how far it departs from the skin around it (0..1); -1 off the skin. */
  map: Float32Array
  /** Share of the frame that is skin. */
  share: number
}

/**
 * Skin evenness. Viewers judge skin less by its exact colour than by how
 * uniform it is: patches of redness and uneven tone read as age and tiredness.
 * Measured as the variation in brightness and redness that remains at the
 * scale of blotches, after ignoring both fine texture (pores) and the broad
 * shading that light and form produce.
 */
export function skinEvenness(data: Uint8ClampedArray, skin: Uint8Array, plane: Plane): SkinReport {
  const n = plane.w * plane.h
  const { luma, rg } = channels(data, n)
  const weight = Float32Array.from(skin)
  const size = Math.max(plane.w, plane.h)
  const local = (channel: Float32Array, radius: number): Float32Array => {
    const num = blur(channel.map((v, i) => v * weight[i]), plane, radius)
    const den = blur(weight, plane, radius)
    return num.map((v, i) => (den[i] > 1e-3 ? v / den[i] : 0))
  }
  // Between "finer than a blotch" and "broader than a blotch".
  // (Broader than this and the measure picks up the shading of the face's own form.)
  const fineL = local(luma, size / 300)
  const broadL = local(luma, size / 64)
  const fineR = local(rg, size / 300)
  const broadR = local(rg, size / 64)
  const map = new Float32Array(n).fill(-1)
  let sum = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue
    // Redness varies less in absolute terms but is noticed more, so it is weighted up.
    const d = Math.abs(fineL[i] - broadL[i]) + 2.2 * Math.abs(fineR[i] - broadR[i])
    map[i] = clamp(d / 0.3)
    sum += d
    count++
  }
  // Scale set so that an ordinary, well-lit portrait lands around a third.
  return { blotchiness: count ? clamp(sum / count / 0.24) : 0, map, share: count / n }
}

/**
 * A rough guess at sky and vegetation from colour and position alone: sky is
 * blue or bright, smooth and near the top; vegetation is green. Good enough to
 * say "a third of this frame is bright sky", not to cut a mask.
 */
export function skyAndGreen(data: Uint8ClampedArray, plane: Plane): { sky: Uint8Array; green: Uint8Array } {
  const n = plane.w * plane.h
  const { luma } = channels(data, n)
  const texture = blur(luma.map((v, i) => Math.abs(v - (luma[i - 1] ?? v)) + Math.abs(v - (luma[i - plane.w] ?? v))), plane, 3)
  const sky = new Uint8Array(n)
  const green = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const y = ((i / plane.w) | 0) / plane.h
    const blue = b > r + 12 && b > g - 6 && luma[i] > 0.35
    const white = luma[i] > 0.85 && Math.max(r, g, b) - Math.min(r, g, b) < 30
    if ((blue || white) && texture[i] < 0.03 && y < 0.7) sky[i] = 1
    if (g > r + 10 && g > b + 10 && luma[i] > 0.08) green[i] = 1
  }
  return { sky, green }
}

/** The share of a mask that is set. */
export const share = (mask: Uint8Array): number => {
  let c = 0
  for (const v of mask) c += v
  return c / mask.length
}

// --- colour of skin and of the background ---------------------------------------------

/** sRGB (0..255) to CIELAB, the space in which colour differences match what people see. */
export function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

interface LabStats {
  n: number
  L: number
  a: number
  b: number
  /** Mean colour difference (delta E) of the pixels from their own average. */
  spread: number
  /** Spread of hue angle in degrees (10th to 90th percentile). */
  hueSpread: number
}

function labStats(data: Uint8ClampedArray, mask: Uint8Array): LabStats | null {
  const labs: [number, number, number][] = []
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) if (mask[i]) labs.push(toLab(data[p], data[p + 1], data[p + 2]))
  if (labs.length < 12) return null
  const mean = [0, 1, 2].map((k) => labs.reduce((s, l) => s + l[k], 0) / labs.length)
  const hues = labs.map((l) => (Math.atan2(l[2], l[1]) * 180) / Math.PI).sort((x, y) => x - y)
  return {
    n: labs.length,
    L: mean[0],
    a: mean[1],
    b: mean[2],
    spread: labs.reduce((s, l) => s + Math.hypot(l[0] - mean[0], l[1] - mean[1], l[2] - mean[2]), 0) / labs.length,
    hueSpread: hues[Math.floor(hues.length * 0.9)] - hues[Math.floor(hues.length * 0.1)]
  }
}

/** Hue angle in CIELAB, in degrees: about 0 is red-magenta, 90 is yellow. */
const labHue = (s: { a: number; b: number }): number => ((Math.atan2(s.b, s.a) * 180) / Math.PI + 360) % 360

/** Skin of most people falls in this band of CIELAB hue; outside it, skin looks ruddy or sallow. */
export const SKIN_HUE_BAND: [number, number] = [45, 58]

export interface SkinColour {
  /** CIELAB hue of the face (or all skin if no face skin was found). */
  hue: number
  /** How far apart the hues within the face are, in degrees. */
  hueSpread: number
  /** Mean colour difference within the face skin, in delta E. */
  unevenness: number
  /** Colour difference between face skin and the rest of the skin, or null. */
  faceVsBody: number | null
  /** How much the lips stand out from the skin in lightness and in colourfulness, or null. */
  lips: { lightness: number; chroma: number } | null
}

export function skinColour(data: Uint8ClampedArray, faceSkin: Uint8Array, bodySkin: Uint8Array, lips: Uint8Array | null): SkinColour | null {
  const face = labStats(data, faceSkin)
  const body = labStats(data, bodySkin)
  const main = face ?? body
  if (!main) return null
  const lip = lips ? labStats(data, lips) : null
  return {
    hue: labHue(main),
    hueSpread: main.hueSpread,
    unevenness: main.spread,
    faceVsBody: face && body ? Math.hypot(face.L - body.L, face.a - body.a, face.b - body.b) : null,
    lips: lip && face ? { lightness: Math.abs(lip.L - face.L), chroma: Math.hypot(lip.a, lip.b) - Math.hypot(face.a, face.b) } : null
  }
}

const HUE_FAMILIES: [number, string][] = [[20, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'teal'], [255, 'blue'], [290, 'purple'], [345, 'magenta'], [361, 'red']]
const family = (h: number): string => HUE_FAMILIES.find(([limit]) => h < limit)![1]

export interface BackgroundRead {
  /** Edge density in the band around the subject, relative to the picture's average. Above 1, the outline is being camouflaged. */
  edgesAtOutline: number
  /** Colour families that each cover at least 6% of the coloured background, largest first. */
  families: { name: string; share: number }[]
  /** How far apart the background's hues are, in degrees around the wheel. */
  hueSpread: number
}

/** What the background is doing to the subject: clutter at the outline, and how many colours compete. */
export function readBackground(data: Uint8ClampedArray, subject: Uint8Array, plane: Plane): BackgroundRead {
  const n = plane.w * plane.h
  const { luma } = channels(data, n)
  const near = ring(subject, plane, Math.max(plane.w, plane.h) / 18)
  let edgeNear = 0
  let nearCount = 0
  let edgeAll = 0
  let allCount = 0
  for (let y = 1; y < plane.h - 1; y++) {
    for (let x = 1; x < plane.w - 1; x++) {
      const i = y * plane.w + x
      const e = Math.hypot(luma[i + 1] - luma[i - 1], luma[i + plane.w] - luma[i - plane.w])
      edgeAll += e
      allCount++
      if (near[i]) {
        edgeNear += e
        nearCount++
      }
    }
  }
  const bins = new Float32Array(36)
  const byFamily = new Map<string, number>()
  let coloured = 0
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (subject[i]) continue
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    // Near-greys have no hue worth counting.
    if (max < 30 || d / max < 0.15) continue
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    bins[Math.floor(h / 10)]++
    byFamily.set(family(h), (byFamily.get(family(h)) ?? 0) + 1)
    coloured++
  }
  // Hue spread: the smallest arc of the wheel that holds 80% of the coloured background.
  let hueSpread = 0
  if (coloured) {
    hueSpread = 360
    for (let start = 0; start < 36; start++) {
      let sum = 0
      for (let len = 1; len <= 36; len++) {
        sum += bins[(start + len - 1) % 36]
        if (sum >= coloured * 0.8) {
          hueSpread = Math.min(hueSpread, len * 10)
          break
        }
      }
    }
  }
  return {
    edgesAtOutline: nearCount && edgeAll ? edgeNear / nearCount / (edgeAll / allCount) : 1,
    families: [...byFamily].map(([name, c]) => ({ name, share: c / coloured })).filter((f) => f.share >= 0.06).sort((a, b) => b.share - a.share),
    hueSpread
  }
}

// --- from measurements to words --------------------------------------------------------

export interface Reading {
  hasSubject: boolean
  attentionOnSubject: number
  distractions: Box[]
  notan: Pick<Notan, 'subject' | 'surroundings'>
  separation: Pick<Separation, 'mergedShare' | 'merged' | 'mean'> | null
  skin: Pick<SkinReport, 'blotchiness' | 'share'> | null
  skinColour: SkinColour | null
  background: BackgroundRead | null
  faces: { x: number; y: number; w: number; h: number; yaw?: number }[]
  skyShare: number
  greenShare: number
  /** Mean saturation and contrast of subject and of background, for the "quieten the rest" advice. */
  subjectSat: number
  backgroundSat: number
  subjectContrast: number
  backgroundContrast: number
}

export interface Finding {
  topic: string
  /** Which mask the proposed adjustment applies to, and how strongly (0..1), when there is one. */
  mask?: 'subject' | 'skin' | 'background' | 'frame'
  strength?: number
  /** What was measured. */
  finding: string
  /** What to do about it, and the principle behind it. */
  advice: string
  level: 'good' | 'attention'
}

const MASS = ['dark', 'middle', 'light']
const place = (b: { x: number; y: number; w: number; h: number }): string => {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const v = cy < 0.34 ? 'upper' : cy > 0.66 ? 'lower' : 'middle'
  const hz = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'centre'
  return v === 'middle' && hz === 'centre' ? 'the centre' : `the ${v} ${hz}`
}
const pct = (v: number): string => `${Math.round(v * 100)}%`

/**
 * The points at which a measurement becomes a finding. The defaults are general;
 * training on the photographer's own finished work replaces them with their own.
 */
export interface Limits {
  /** Share of outline lost: "partly", and "merges". */
  mergedSome: number
  mergedMost: number
  /** Below this share of attention on the subject, the subject is not holding the eye. */
  attentionLow: number
  /** Skin unevenness (0..1): "slightly", and "noticeably". */
  blotchySome: number
  blotchyMost: number
  /** CIELAB hue band for skin, in degrees. */
  skinHue: [number, number]
  /** Colour difference within the face, and between face and body, in delta E. */
  skinSpread: number
  faceVsBody: number
  /** Edge density at the outline relative to the picture's average. */
  clutter: number
  /** Background saturation and local contrast relative to the subject's. */
  bgSaturation: number
  bgContrast: number
  /** What these limits were learned from, for the screen. Empty for the defaults. */
  basis: string
}

export const DEFAULT_LIMITS: Limits = {
  mergedSome: 0.12,
  mergedMost: 0.3,
  attentionLow: 0.4,
  blotchySome: 0.42,
  blotchyMost: 0.6,
  skinHue: SKIN_HUE_BAND,
  skinSpread: 9,
  faceVsBody: 5,
  clutter: 1.35,
  bgSaturation: 1.3,
  bgContrast: 1.25,
  basis: ''
}

/** The numbers a finished photograph is characterised by, for learning the photographer's own norms. */
export function metricsOf(r: Reading): Record<string, number> {
  const m: Record<string, number> = {}
  if (r.separation) m.merged = r.separation.mergedShare
  if (r.hasSubject) {
    m.attention = r.attentionOnSubject
    if (r.subjectSat > 0.02) m.bgSaturation = r.backgroundSat / r.subjectSat
    if (r.subjectContrast > 0.002) m.bgContrast = r.backgroundContrast / r.subjectContrast
  }
  if (r.skin && r.skin.share > 0.004) m.blotchy = r.skin.blotchiness
  if (r.skinColour) {
    m.skinHue = r.skinColour.hue
    m.skinSpread = r.skinColour.unevenness
    if (r.skinColour.faceVsBody !== null) m.faceVsBody = r.skinColour.faceVsBody
  }
  if (r.background && r.hasSubject) m.clutter = r.background.edgesAtOutline
  return m
}

/** Turns the measurements into a diagnosis and proposed adjustments, with reasons. */
export function findings(r: Reading, L: Limits = DEFAULT_LIMITS): Finding[] {
  const out: Finding[] = []
  if (!r.hasSubject) {
    out.push({
      topic: 'Subject',
      finding: 'No person was found to treat as the subject, so separation and skin are not assessed.',
      advice: 'The attention map and the three-mass view still apply: check that the eye lands where you mean it to.',
      level: 'attention'
    })
  }

  // Separation of subject and background.
  if (r.separation) {
    const s = r.separation
    if (s.mergedShare > L.mergedMost) {
      out.push({
        topic: 'Subject merges with the background',
        finding: `Along ${pct(s.mergedShare)} of the outline the subject is nearly the same brightness and colour as what is behind it${s.merged.length ? `, most of all in ${s.merged.map(place).join(' and ')}` : ''}.`,
        advice:
          'A silhouette that cannot be read is the most common reason a picture feels flat. Do not sharpen or brighten the subject: change the background beside the lost edge. Lighten it where the subject is dark, darken it where the subject is light (a soft brush mask along the edge, a third to two thirds of a stop), or shift its colour away from the subject\'s.',
        level: 'attention'
      })
    } else if (s.mergedShare > L.mergedSome) {
      out.push({
        topic: 'Separation',
        finding: `The subject reads against the background for most of its outline; ${pct(s.mergedShare)} of it is lost${s.merged.length ? `, in ${s.merged.map(place).join(' and ')}` : ''}.`,
        advice: 'A lost edge is fine where it does not matter (a dark coat into shadow can be beautiful). Check the places listed: if a shoulder, the jaw or a hand disappears, lift or lower the background just there.',
        level: 'attention'
      })
    } else {
      out.push({ topic: 'Separation', finding: 'The subject stands clear of the background along nearly all of its outline.', advice: 'Nothing to fix. Protect this when grading: a look that lowers contrast can bring edges together again.', level: 'good' })
    }
  }
  if (r.notan.subject !== null && r.notan.surroundings !== null) {
    const same = r.notan.subject === r.notan.surroundings
    out.push({
      topic: 'Three masses',
      finding: `Reduced to dark, middle and light, the subject sits mostly in the ${MASS[r.notan.subject]} mass and its surroundings in the ${MASS[r.notan.surroundings]} mass.`,
      advice: same
        ? 'Subject and surroundings share a mass, so in tone alone they are one shape. Colour or focus may still separate them, but tone is what survives at thumbnail size and in print. Move one of them: darken or lighten the background as a whole, not the figure.'
        : 'They sit in different masses: the picture has a readable structure. Squint at the three-mass view; if you can still tell what the picture is, the foundation is sound.',
      level: same ? 'attention' : 'good'
    })
  }

  // Attention.
  if (r.hasSubject) {
    const on = r.attentionOnSubject
    out.push({
      topic: 'Where the eye goes',
      finding: `About ${pct(on)} of what draws the eye lies on the subject.`,
      advice:
        on < L.attentionLow
          ? 'Most of the pull is elsewhere. To make the subject stand out, do not push it harder: quieten what surrounds it. Less colour in the background, less contrast, softer edges. The eye then arrives by itself, and nobody can tell the picture was worked on.'
          : 'The subject holds the eye. Further emphasis is better achieved by calming the rest than by adding contrast or saturation to the subject.',
      level: on < L.attentionLow ? 'attention' : 'good'
    })
  }
  for (const d of r.distractions.filter((d) => d.pull > 0.035)) {
    const edge = d.x < 0.06 || d.y < 0.06 || d.x + d.w > 0.94 || d.y + d.h > 0.94
    out.push({
      topic: 'Something else pulls the eye',
      finding: `A contrasty area in ${place(d)} takes about ${pct(d.pull)} of the picture's attention and is not part of the subject${edge ? '; it touches the edge of the frame, which draws the eye out of the picture' : ''}.`,
      advice: edge
        ? 'Crop it out if the composition allows; otherwise darken and desaturate it until it stops competing. Bright or contrasty things at the border are the first to remove.'
        : 'Decide whether it belongs to the story. If not, lower its contrast and saturation, or remove it in Photoshop. If it does, make sure it is clearly second: weaker than the face.',
      level: 'attention'
    })
  }
  if (r.backgroundContrast > r.subjectContrast * L.bgContrast && r.hasSubject) {
    out.push({
      topic: 'Background busier than the subject',
      finding: 'The background has more local contrast than the subject.',
      advice: 'Reduce Clarity, Texture or contrast on the background with a mask (invert the subject mask). The eye follows contrast with structure, so a busy background outvotes a calm subject.',
      level: 'attention'
    })
  }
  if (r.backgroundSat > r.subjectSat * L.bgSaturation && r.backgroundSat > 0.25 && r.hasSubject) {
    out.push({
      topic: 'Background more colourful than the subject',
      finding: `Background saturation is ${pct(r.backgroundSat)} against ${pct(r.subjectSat)} on the subject.`,
      advice: 'Lower the saturation of the background, or of its loudest colour in the Color Mixer. Saturation directs the eye as surely as brightness does.',
      level: 'attention'
    })
  }

  // Faces and gaze.
  if (r.faces.length) {
    const f = r.faces[0]
    const yaw = f.yaw ?? 0
    if (Math.abs(yaw) > 0.25) {
      const toward = yaw > 0 ? 'right' : 'left'
      const room = yaw > 0 ? 1 - (f.x + f.w) : f.x
      out.push({
        topic: 'Gaze',
        finding: `The main face is turned to the ${toward}, with ${pct(room)} of the frame in that direction.`,
        advice:
          room < 0.18
            ? 'A face is the strongest thing in any picture, and its gaze is the strongest arrow: viewers look where it looks. Here it points straight out of the frame. Give the gaze room when cropping, unless the tension is what you want.'
            : 'Viewers will follow the gaze into that part of the frame. Make sure what lies there is worth arriving at, or is quiet enough not to matter.',
        level: room < 0.18 ? 'attention' : 'good'
      })
    }
  }

  // Skin.
  if (r.skin && r.skin.share > 0.004) {
    const b = r.skin.blotchiness
    out.push({
      topic: 'Skin',
      finding: `${b > L.blotchyMost ? 'The skin is noticeably uneven: patches differ in brightness and redness from the skin around them' : b > L.blotchySome ? 'The skin is slightly uneven in tone' : 'The skin is reasonably even in tone'} (unevenness ${Math.round(b * 100)} of 100).`,
      advice:
        b > L.blotchySome
          ? 'Viewers carry a memory of skin and notice unevenness before they notice the wrong hue; blotchy skin reads as older and more tired. Even it out, do not blur it: dodge and burn at low flow to level the patches, and for redness lower Red saturation slightly or shift Red hue toward orange on a skin mask. Keep the texture.'
          : 'Leave it alone. Skin that is already even is easily over-retouched.',
      level: b > L.blotchySome ? 'attention' : 'good'
    })
  }

  if (r.skinColour) {
    const c = r.skinColour
    const [lo, hi] = L.skinHue
    if (c.hue < lo - 4 || c.hue > hi + 4) {
      const red = c.hue < lo
      out.push({
        topic: 'Skin hue',
        mask: 'skin',
        strength: clamp(Math.abs(c.hue - (red ? lo : hi)) / 30, 0.2, 0.9),
        finding: `Skin hue measures ${c.hue.toFixed(1)}°, outside ${L.basis ? 'the band of your own finished work' : 'the usual band'} of ${lo.toFixed(0)}° to ${hi.toFixed(0)}°: shifted toward ${red ? 'red and magenta' : 'yellow and green'}.`,
        advice: red
          ? 'Move it back toward the band without touching brightness: on a skin mask shift hue from red toward yellow (in Lightroom, Color Mixer → Red and Orange hue to the right, or Tint toward green on the mask). Check that it is not white balance first: if the whole picture is magenta, fix that globally.'
          : 'Move it back toward the band: Orange hue slightly toward red on a skin mask, or Tint toward magenta. If the cause is light reflected from grass or walls, a mask on the affected side is cleaner than a global change.',
        level: 'attention'
      })
    }
    if (c.unevenness > L.skinSpread || c.hueSpread > 22) {
      out.push({
        topic: 'Skin colour varies',
        mask: 'skin',
        strength: clamp(c.unevenness / 12, 0.3, 0.9),
        finding: `Within the face, hue ranges over ${c.hueSpread.toFixed(0)}° and colour differs from its average by ${c.unevenness.toFixed(1)} ΔE.`,
        advice: 'Evenness matters more than the exact hue. Unify colour before brightness: a low-opacity colour layer or a hue range mask that pulls outliers (red nose and cheeks, yellow forehead) toward the average. Then level brightness with dodge and burn.',
        level: 'attention'
      })
    }
    if (c.faceVsBody !== null && c.faceVsBody > L.faceVsBody) {
      out.push({
        topic: 'Face and body do not match',
        mask: 'skin',
        strength: clamp(c.faceVsBody / 12, 0.3, 0.8),
        finding: `The face differs from the rest of the skin (neck, arms, hands) by ${c.faceVsBody.toFixed(1)} ΔE. A difference above about 5 is visible at a glance.`,
        advice: 'Common with make-up on the face only, or a face lit differently from the body. Match the body to the face (or the reverse) on separate masks: brightness first, then hue and saturation.',
        level: 'attention'
      })
    }
    if (c.lips && c.lips.lightness < 4 && c.lips.chroma < 4) {
      out.push({
        topic: 'Lips',
        mask: 'skin',
        strength: 0.3,
        finding: 'The lips differ little from the skin around them in both lightness and colour.',
        advice: 'Lips give a face its second point of interest after the eyes. A small rise in saturation on the lips alone (not redder, just clearer) is enough.',
        level: 'attention'
      })
    }
  }

  if (r.background && r.hasSubject) {
    const b = r.background
    if (b.edgesAtOutline > L.clutter) {
      out.push({
        topic: 'Background clutter at the outline',
        mask: 'background',
        strength: clamp((b.edgesAtOutline - 1) / 1.2, 0.3, 0.8),
        finding: `Right around the subject the background has ${b.edgesAtOutline.toFixed(2)} times the picture's average density of edges. Lines that cross an outline camouflage it.`,
        advice: 'Soften the background in a band around the outline: lower Clarity and Texture, or a slight blur, on the inverted subject mask with a wide feather. Unify its colour there too, so a door frame or branch stops cutting into the figure.',
        level: 'attention'
      })
    }
    if (b.families.length >= 4 || b.hueSpread > 120) {
      out.push({
        topic: 'Many colours behind the subject',
        mask: 'background',
        strength: 0.4,
        finding: `The background holds ${b.families.length} colour families (${b.families.slice(0, 4).map((f) => `${f.name} ${pct(f.share)}`).join(', ')}), spread over ${b.hueSpread}° of the wheel.`,
        advice: `A varied surround lowers the apparent saturation of the subject. Fewer colours and one accent hold together better: pull the background toward its main colour (${b.families[0]?.name ?? 'its dominant hue'}) with hue shifts in the Color Mixer, and desaturate what is left over.`,
        level: 'attention'
      })
    }
  }

  if (r.skyShare > 0.25) {
    out.push({
      topic: 'Large bright area',
      finding: `About ${pct(r.skyShare)} of the frame is bright, even sky or backdrop.`,
      advice: 'A large empty bright area does not hold the eye: it is skipped. It costs you only if it clips or if its edge against the subject is weak. No need to darken it for attention\'s sake.',
      level: 'good'
    })
  }
  return out
}
