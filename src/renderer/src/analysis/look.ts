// Works out the "look" of an edited photograph (its tone curve, the tint of its
// shadows, midtones and highlights, and its saturation) and writes it out as a
// 3D LUT or a Lightroom preset. Runs entirely on the user's machine.
//
// A look is the difference between a starting image and an edited one. Given
// only the edited one, the starting point has to be assumed, so the result is
// an estimate. Given one of the user's own unedited frames as the starting
// point, it becomes a measured colour transfer from that frame to the reference.

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v))
const smooth = (lo: number, hi: number, v: number): number => {
  const t = clamp((v - lo) / (hi - lo))
  return t * t * (3 - 2 * t)
}

/** Shadows, midtones, highlights: weights that always add up to 1. */
function zones(y: number): [number, number, number] {
  const s = 1 - smooth(0.15, 0.5, y)
  const h = smooth(0.5, 0.85, y)
  return [s, 1 - s - h, h]
}

// Rec.709 luma and colour difference, on display-encoded values.
const toYcc = (r: number, g: number, b: number): [number, number, number] => {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return [y, (b - y) / 1.8556, (r - y) / 1.5748]
}
const toRgb = (y: number, cb: number, cr: number): [number, number, number] => {
  const r = y + 1.5748 * cr
  const b = y + 1.8556 * cb
  return [r, (y - 0.2126 * r - 0.0722 * b) / 0.7152, b]
}

export interface LookStats {
  /** Cumulative share of pixels at or below each of 256 brightness levels. */
  cdf: Float32Array
  /** Mean colour offset (cb, cr) of all pixels in shadows, midtones, highlights. */
  zoneMean: [number, number][]
  /** The same for near-neutral pixels only: the tint laid over each zone. */
  zoneTint: [number, number][]
  /** Spread of colour: how saturated the image is overall. */
  chromaSpread: number
  meanSat: number
  /** Darkest and brightest levels actually used (0.5th and 99.5th percentile). */
  black: number
  white: number
}

export function lookStats(data: Uint8ClampedArray): LookStats {
  const hist = new Float64Array(256)
  const sum = [0, 1, 2].map(() => [0, 0, 0])
  const tint = [0, 1, 2].map(() => [0, 0, 0])
  let spread = 0
  let sat = 0
  const n = data.length / 4
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p] / 255
    const g = data[p + 1] / 255
    const b = data[p + 2] / 255
    const [y, cb, cr] = toYcc(r, g, b)
    hist[Math.round(clamp(y) * 255)]++
    spread += cb * cb + cr * cr
    const max = Math.max(r, g, b)
    const s = max === 0 ? 0 : (max - Math.min(r, g, b)) / max
    sat += s
    const w = zones(y)
    for (let z = 0; z < 3; z++) {
      sum[z][0] += w[z] * cb
      sum[z][1] += w[z] * cr
      sum[z][2] += w[z]
      // Greys show a tint most clearly: a coloured object says nothing about the grade.
      if (s < 0.25) {
        tint[z][0] += w[z] * cb
        tint[z][1] += w[z] * cr
        tint[z][2] += w[z]
      }
    }
  }
  const cdf = new Float32Array(256)
  let acc = 0
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    cdf[i] = acc / n
  }
  const level = (q: number): number => cdf.findIndex((c) => c >= q) / 255
  const mean = (t: number[], enough: number): [number, number] => (t[2] > enough ? [t[0] / t[2], t[1] / t[2]] : [0, 0])
  return {
    cdf,
    zoneMean: sum.map((t) => mean(t, 1)),
    zoneTint: tint.map((t) => mean(t, n * 0.005)),
    chromaSpread: Math.sqrt(spread / n),
    meanSat: sat / n,
    black: level(0.005),
    white: level(0.995)
  }
}

export interface Look {
  /** Output brightness (0..1) for each of 256 input levels. */
  curve: Float32Array
  /** Colour shift (cb, cr) added in shadows, midtones, highlights. */
  shift: [number, number][]
  /** Multiplier on colourfulness. */
  saturation: number
  /** True when no starting image was given, so the starting point was assumed. */
  estimated: boolean
}

/** Typical saturation of an unedited photograph, used when no starting image is given. */
const TYPICAL_SAT = 0.3

/** The look that turns `source` into `reference`, or an estimate from the reference alone. */
export function deriveLook(reference: LookStats, source?: LookStats): Look {
  const curve = new Float32Array(256)
  if (source) {
    // Histogram matching: a source level maps to the reference level with the same rank.
    let j = 0
    for (let i = 0; i < 256; i++) {
      while (j < 255 && reference.cdf[j] < source.cdf[i]) j++
      curve[i] = j / 255
    }
    // Histograms are noisy; a grade is smooth. Average over neighbours, then keep it rising.
    const raw = Float32Array.from(curve)
    for (let i = 0; i < 256; i++) {
      let total = 0
      let count = 0
      for (let k = Math.max(0, i - 10); k <= Math.min(255, i + 10); k++) {
        total += raw[k]
        count++
      }
      curve[i] = total / count
    }
    for (let i = 1; i < 256; i++) curve[i] = Math.max(curve[i], curve[i - 1])
    const saturation = clamp(reference.chromaSpread / Math.max(source.chromaSpread, 1e-4), 0.5, 1.5)
    return {
      curve,
      saturation,
      shift: [0, 1, 2].map((z) => [
        reference.zoneMean[z][0] - saturation * source.zoneMean[z][0],
        reference.zoneMean[z][1] - saturation * source.zoneMean[z][1]
      ]),
      estimated: false
    }
  }
  // No starting image: read only what the reference shows unambiguously.
  // Lifted blacks and lowered whites are deliberate; so is a tint on the greys.
  const black = reference.black > 0.025 ? reference.black : 0
  const white = reference.white < 0.975 ? reference.white : 1
  for (let i = 0; i < 256; i++) curve[i] = black + (white - black) * (i / 255)
  return {
    curve,
    shift: reference.zoneTint.map(([cb, cr]) => [cb * 0.9, cr * 0.9] as [number, number]),
    saturation: clamp(reference.meanSat / TYPICAL_SAT, 0.6, 1.4),
    estimated: true
  }
}

/** The same look at reduced strength: 0 leaves the image alone, 1 is the full look. */
export function scaleLook(look: Look, strength: number): Look {
  const t = clamp(strength)
  return {
    curve: look.curve.map((v, i) => i / 255 + (v - i / 255) * t),
    shift: look.shift.map(([cb, cr]) => [cb * t, cr * t] as [number, number]),
    saturation: 1 + (look.saturation - 1) * t,
    estimated: look.estimated
  }
}

/**
 * How unlike two photos are in overall brightness, 0..1. A look measured
 * between very different scenes mostly records the difference in subject
 * matter, not the edit.
 */
export function mismatch(a: LookStats, b: LookStats): number {
  let d = 0
  for (let i = 0; i < 256; i++) d += Math.abs(a.cdf[i] - b.cdf[i])
  return d / 256
}

/** Applies a look to one colour (components 0..1). */
export function applyLook(look: Look, r: number, g: number, b: number): [number, number, number] {
  const [y, cb, cr] = toYcc(r, g, b)
  const x = clamp(y) * 255
  const i = Math.floor(x)
  const f = x - i
  const y2 = look.curve[i] * (1 - f) + look.curve[Math.min(255, i + 1)] * f
  const w = zones(y2)
  const cb2 = cb * look.saturation + w[0] * look.shift[0][0] + w[1] * look.shift[1][0] + w[2] * look.shift[2][0]
  const cr2 = cr * look.saturation + w[0] * look.shift[0][1] + w[1] * look.shift[1][1] + w[2] * look.shift[2][1]
  const [r2, g2, b2] = toRgb(y2, cb2, cr2)
  return [clamp(r2), clamp(g2), clamp(b2)]
}

/** Applies a look to an image in place. */
export function applyLookToImage(look: Look, data: Uint8ClampedArray): void {
  for (let p = 0; p < data.length; p += 4) {
    const [r, g, b] = applyLook(look, data[p] / 255, data[p + 1] / 255, data[p + 2] / 255)
    data[p] = r * 255
    data[p + 1] = g * 255
    data[p + 2] = b * 255
  }
}

/**
 * A 3D LUT in the .cube format read by DaVinci Resolve, Premiere, Photoshop
 * and most other tools. Meant for display-referred (Rec.709 / sRGB) images.
 */
export function toCube(look: Look, title: string, size = 33): string {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, '# Made by Atelier. Apply to a Rec.709 / sRGB image, after any log conversion.', `LUT_3D_SIZE ${size}`, '']
  // .cube order: red changes fastest, then green, then blue.
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = applyLook(look, r / (size - 1), g / (size - 1), b / (size - 1))
        lines.push(out.map((v) => v.toFixed(6)).join(' '))
      }
    }
  }
  return lines.join('\n') + '\n'
}

/** Hue (0..360, as Lightroom's colour grading wheel uses) and strength (0..100) of a colour shift. */
export function shiftToHueSat([cb, cr]: [number, number]): { hue: number; sat: number } {
  const [r, g, b] = toRgb(0.5, cb, cr)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let hue = 0
  if (d > 1e-6) {
    if (max === r) hue = ((g - b) / d) % 6
    else if (max === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue = (hue * 60 + 360) % 360
  }
  // A shift of 0.03 is a clearly visible tint; Lightroom's 100 is extreme.
  return { hue: Math.round(hue), sat: Math.round(clamp(Math.hypot(cb, cr) * 800, 0, 70)) }
}

const xml = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/**
 * A Lightroom / Camera Raw preset (.xmp) carrying the same look with
 * Lightroom's own tools: a point tone curve, colour grading for shadows,
 * midtones and highlights, and saturation. It is an approximation of the LUT,
 * and stays editable: every value is a normal slider afterwards.
 */
export function toLightroomPreset(look: Look, name: string): string {
  const points = [0, 32, 64, 96, 128, 160, 192, 224, 255].map((x) => `<rdf:li>${x}, ${Math.round(look.curve[x] * 255)}</rdf:li>`)
  const [s, m, h] = look.shift.map(shiftToHueSat)
  const sat = Math.round(clamp((look.saturation - 1) * 60, -40, 40))
  const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase()
  const alt = (tag: string, value: string): string =>
    `   <crs:${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xml(value)}</rdf:li></rdf:Alt></crs:${tag}>`
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Atelier">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Cluster=""
   crs:UUID="${uuid}"
   crs:SupportsAmount="False"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="False"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:CameraModelRestriction=""
   crs:Copyright=""
   crs:ContactInfo=""
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
   crs:Saturation="${sat > 0 ? '+' : ''}${sat}"
   crs:SplitToningShadowHue="${s.hue}"
   crs:SplitToningShadowSaturation="${s.sat}"
   crs:SplitToningHighlightHue="${h.hue}"
   crs:SplitToningHighlightSaturation="${h.sat}"
   crs:SplitToningBalance="0"
   crs:ColorGradeMidtoneHue="${m.hue}"
   crs:ColorGradeMidtoneSat="${m.sat}"
   crs:ColorGradeShadowLum="0"
   crs:ColorGradeMidtoneLum="0"
   crs:ColorGradeHighlightLum="0"
   crs:ColorGradeBlending="50"
   crs:ColorGradeGlobalHue="0"
   crs:ColorGradeGlobalSat="0"
   crs:ColorGradeGlobalLum="0"
   crs:ToneCurveName2012="Custom"
   crs:HasSettings="True">
${alt('Name', name)}
${alt('ShortName', '')}
${alt('SortName', '')}
${alt('Group', 'Atelier')}
${alt('Description', look.estimated ? 'Look estimated from a reference photo' : 'Look matched from a reference photo')}
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     ${points.join('\n     ')}
    </rdf:Seq>
   </crs:ToneCurvePV2012>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
}

const HUES: [number, string][] = [
  [20, 'red'], [45, 'orange'], [70, 'yellow'], [165, 'green'], [200, 'teal'], [255, 'blue'], [290, 'purple'], [340, 'magenta'], [361, 'red']
]
const hueWord = (h: number): string => HUES.find(([limit]) => h < limit)![1]

/** The look in words: what was done, so it can be understood and rebuilt by hand. */
export function describeLook(look: Look): string[] {
  const out: string[] = []
  const black = look.curve[0]
  const white = look.curve[255]
  const mid = look.curve[128]
  if (black > 0.03) out.push(`Blacks are lifted to ${Math.round(black * 100)}%: the matte, faded-film shadow. Depth is traded for softness.`)
  if (white < 0.97) out.push(`Whites are held down to ${Math.round(white * 100)}%: highlights roll off gently instead of hitting pure white.`)
  if (!look.estimated) {
    const slope = (look.curve[176] - look.curve[80]) / (96 / 255)
    if (slope > 1.12) out.push('Midtone contrast is increased: a steeper curve through the middle, where faces live.')
    else if (slope < 0.9) out.push('Midtone contrast is reduced: a flatter, gentler curve through the middle.')
    if (mid > 0.54) out.push('Midtones are raised: the image is brightened without pushing the highlights.')
    else if (mid < 0.46) out.push('Midtones are lowered: a darker, heavier overall feel.')
  }
  const names = ['Shadows', 'Midtones', 'Highlights']
  look.shift.forEach((shift, z) => {
    const { hue, sat } = shiftToHueSat(shift)
    if (sat >= 4) out.push(`${names[z]} are tinted ${hueWord(hue)} (hue ${hue}°, strength ${sat}).`)
  })
  const [s, , h] = look.shift.map(shiftToHueSat)
  if (s.sat >= 4 && h.sat >= 4) {
    const apart = Math.abs(((s.hue - h.hue + 540) % 360) - 180)
    if (apart > 110) out.push('Shadows and highlights are tinted in opposing colours: a complementary split-tone, which adds colour contrast between dark and light.')
  }
  if (look.saturation > 1.08) out.push(`Colour is about ${Math.round((look.saturation - 1) * 100)}% more saturated${look.estimated ? ' than a typical unedited photo' : ' than your starting frame'}.`)
  else if (look.saturation < 0.92) out.push(`Colour is about ${Math.round((1 - look.saturation) * 100)}% more muted${look.estimated ? ' than a typical unedited photo' : ' than your starting frame'}.`)
  if (!out.length) out.push('Very little was changed in tone or colour: the look is close to neutral.')
  return out
}

/** Builds a look from the handful of controls it is made of (as Claude's atmosphere advice gives them). */
export function lookFromParams(p: {
  blackLift: number; whiteHold: number; contrast: number; shadowHue: number; shadowStrength: number; midHue: number; midStrength: number
  highlightHue: number; highlightStrength: number; saturation: number
}): Look {
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    // An S through the middle: darker below, brighter above, the ends left where they are.
    const shaped = clamp(x + p.contrast * 0.16 * Math.sin(2 * Math.PI * (x - 0.5)))
    curve[i] = p.blackLift + (p.whiteHold - p.blackLift) * shaped
  }
  // The inverse of shiftToHueSat: a hue and strength back to a colour shift.
  const shift = (hue: number, strength: number): [number, number] => {
    const h = ((hue % 360) + 360) % 360
    const f = (n: number): number => {
      const k = (n + h / 60) % 6
      return 1 - Math.max(0, Math.min(k, 4 - k, 1))
    }
    const [r, g, b] = [f(5), f(3), f(1)]
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const cb = (b - y) / 1.8556
    const cr = (r - y) / 1.5748
    const size = Math.hypot(cb, cr) || 1
    const magnitude = strength / 800
    return [(cb / size) * magnitude, (cr / size) * magnitude]
  }
  return {
    curve,
    shift: [shift(p.shadowHue, p.shadowStrength), shift(p.midHue, p.midStrength), shift(p.highlightHue, p.highlightStrength)],
    saturation: p.saturation,
    estimated: false
  }
}
