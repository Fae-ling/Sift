import type { Analysis, FaceInfo, Score, Shot, ShotType, Suggestion, Warning } from '@shared/types'

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v))
const smooth = (lo: number, hi: number, v: number): number => {
  const t = clamp((v - lo) / (hi - lo))
  return t * t * (3 - 2 * t)
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

/**
 * Sharpness relative to the best frames shot in the same conditions. Absolute
 * numbers depend on lens, ISO and subject; "half as crisp as its neighbours"
 * does not. Each halving costs 25 points.
 */
export const relativeFocus = (value: number, reference: number): number =>
  reference <= 0 ? 50 : 100 * clamp(1 + Math.log2(Math.max(value, 1e-6) / reference) / 4)

/** A face smaller than this fraction of the frame height is background. */
const MIN_FACE = 0.05
export const BLINK_LIMIT = 0.6

export function classifyShot(faces: FaceInfo[]): ShotType {
  const main = faces.filter((f) => f.h >= MIN_FACE)
  if (main.length === 0) return 'detail'
  if (main.length >= 3) return 'group'
  if (main[0].h > 0.38) return 'close-up'
  if (main[0].h > 0.14) return 'medium'
  return 'wide'
}

function exposureScore(a: Analysis, notes: string[], warnings: Warning[]): number {
  const c = a.color
  let score = 100
  if (c.clipHigh > 0.01) {
    score -= 30 * smooth(0.01, 0.15, c.clipHigh)
    notes.push(
      `${(c.clipHigh * 100).toFixed(1)}% of the preview is pure white. That is fine for a white backdrop or a bright sky; if it is skin or a dress, check the RAW, which usually holds about a stop more highlight detail than this preview.`
    )
    if (c.clipHigh > 0.06) warnings.push('clipped')
  }
  if (c.clipLow > 0.05) score -= 25 * smooth(0.05, 0.3, c.clipLow)
  if (c.meanLuma < 0.14) {
    score -= 35 * smooth(0.14, 0.04, c.meanLuma)
    notes.push('Very dark overall. Lifting it in the RAW will bring up noise in the shadows.')
    if (c.meanLuma < 0.08) warnings.push('dark')
  }
  if (c.meanLuma > 0.82) score -= 25 * smooth(0.82, 0.95, c.meanLuma)
  return clamp(score, 0, 100)
}

interface Refs {
  frame: number
  face: number
}

export function scoreShot(a: Analysis, refs: Refs): Score {
  const notes: string[] = []
  const warnings: Warning[] = []
  const focus = relativeFocus(a.sharpness, refs.frame)
  const exposure = exposureScore(a, notes, warnings)
  const main = a.faces.filter((f) => f.h >= MIN_FACE)

  let faces: number | null = null
  if (main.length) {
    let total = 0
    let weight = 0
    let blinks = 0
    let softFaces = 0
    for (const f of main) {
      const w = f.w * f.h
      const eyes = 1 - smooth(0.35, 0.7, f.blink)
      const faceFocus = relativeFocus(f.sharpness, refs.face) / 100
      total += w * (0.5 * eyes + 0.4 * faceFocus + 0.1 * clamp(f.smile * 1.5))
      weight += w
      if (f.blink > BLINK_LIMIT) blinks++
      if (faceFocus < 0.4) softFaces++
    }
    faces = (100 * total) / weight
    if (blinks) {
      warnings.push('blink')
      notes.push(
        main.length === 1
          ? 'Eyes closed, or looking down. A downward glance can be the best frame of a quiet moment, so judge it yourself.'
          : `${blinks} of ${main.length} faces have closed or lowered eyes.`
      )
    } else {
      notes.push(main.length === 1 ? 'Eyes open.' : `All ${main.length} faces have open eyes.`)
    }
    if (softFaces) {
      warnings.push('soft-face')
      notes.push(
        'The eyes are noticeably softer than in the sharpest frames of this scene: focus probably landed elsewhere, or the subject moved.'
      )
    } else if (relativeFocus(main[0].sharpness, refs.face) > 80) {
      notes.push('Critical focus on the eyes.')
    }
    if (main[0].smile > 0.5) notes.push('Strong smile on the main face.')
  }

  if (focus < 45 && !warnings.includes('soft-face')) {
    warnings.push('soft')
    notes.push(
      'Nothing in the frame is as crisp as the sharp frames around it. Likely motion blur or missed focus; fine if the blur is the point.'
    )
  } else if (focus > 85 && !main.length) {
    notes.push('Crisp where it counts.')
  }

  const overall = faces === null ? 0.75 * focus + 0.25 * exposure : 0.45 * faces + 0.4 * focus + 0.15 * exposure
  return { overall, focus, exposure, faces, notes, warnings }
}

const FATAL: Warning[] = ['blink', 'soft', 'soft-face']
const isFlawed = (s: Score): boolean => s.warnings.some((w) => FATAL.includes(w))

/**
 * Scores every analysed shot against its scene and proposes, per stack, which
 * frame to keep. These are proposals: the photographer's own decision always wins.
 */
export function scoreAndSuggest(shots: Shot[]): Shot[] {
  const analysed = shots.filter((s) => s.analysis)
  const frameAll = percentile(analysed.map((s) => s.analysis!.sharpness), 0.9)
  const faceValues = (list: Shot[]): number[] =>
    list.flatMap((s) => s.analysis!.faces.filter((f) => f.h >= MIN_FACE).map((f) => f.sharpness))
  const faceAll = percentile(faceValues(analysed), 0.9)

  const byScene = new Map<number, Shot[]>()
  for (const s of analysed) byScene.set(s.sceneId ?? 0, [...(byScene.get(s.sceneId ?? 0) ?? []), s])
  const refs = new Map<number, Refs>()
  for (const [id, list] of byScene) {
    // A scene needs enough frames for its own reference to be trustworthy.
    const faces = faceValues(list)
    refs.set(id, {
      frame: list.length >= 8 ? percentile(list.map((s) => s.analysis!.sharpness), 0.9) : frameAll,
      face: faces.length >= 8 ? percentile(faces, 0.9) : faceAll
    })
  }

  const scored = shots.map((s) =>
    s.analysis ? { ...s, score: scoreShot(s.analysis, refs.get(s.sceneId ?? 0)!) } : { ...s, score: undefined }
  )

  const stacks = new Map<number, Shot[]>()
  for (const s of scored) if (s.score) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
  const suggestion = new Map<string, Suggestion>()
  for (const stack of stacks.values()) {
    const ranked = [...stack].sort((a, b) => b.score!.overall - a.score!.overall)
    const best = ranked.find((s) => !isFlawed(s.score!))
    for (const s of ranked) {
      if (s === best) suggestion.set(s.id, 'pick')
      else if (isFlawed(s.score!)) suggestion.set(s.id, 'reject')
      // A clean frame nearly as good as the best is worth a second look.
      else if (best && best.score!.overall - s.score!.overall < 6) suggestion.set(s.id, 'alternate')
      else suggestion.set(s.id, 'reject')
    }
  }
  return scored.map((s) => ({ ...s, suggestion: suggestion.get(s.id) }))
}
