import type { Analysis, FaceInfo, Genre, MomentTag, NarrativeRead, Score, Shot, ShotType, StyleProfile, Suggestion, Warning } from '@shared/types'
import { featuresOf, predict, reasonsFor, type Model } from './learner'
import { styleBonus, type Feel } from './style'

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
const mainFaces = (faces: FaceInfo[]): FaceInfo[] => faces.filter((f) => f.h >= MIN_FACE)

export function classifyShot(faces: FaceInfo[]): ShotType {
  const main = mainFaces(faces)
  if (main.length === 0) return 'detail'
  if (main.length >= 3) return 'group'
  if (main[0].h > 0.38) return 'close-up'
  if (main[0].h > 0.14) return 'medium'
  return 'wide'
}

// --- the moment ---------------------------------------------------------------

export interface Moment {
  /** 0..1: how strongly the faces are expressing joy. Weighted toward the largest faces. */
  expression: number
  /** 0..1: how much two people are turned toward, or touching, each other. */
  connection: number
  laughing: boolean
  /** Indices (into the main faces) whose closed eyes belong to a laugh or an embrace. */
  eyesExplained: Set<number>
}

/** How much a face is laughing: a real smile with the mouth open. */
const laugh = (f: FaceInfo): number => smooth(0.4, 0.7, f.smile) * smooth(0.12, 0.4, f.jawOpen ?? 0)
/** A smile that reaches the eyes counts for more than one that does not. */
const joy = (f: FaceInfo): number => Math.max(laugh(f), f.smile * (0.6 + 0.4 * clamp((f.squint ?? 0) * 2)))

/**
 * What can be read about the moment from faces alone: joy, laughter, and
 * closeness between people. It cannot see intensity, tension or tenderness in a
 * quiet face; that is what the editor's read and the photographer are for.
 */
export function readMoment(faces: FaceInfo[]): Moment | null {
  const main = mainFaces(faces).slice(0, 6)
  if (main.length === 0) return null

  let expression = 0
  let weight = 0
  for (const f of main) {
    const w = f.w * f.h
    expression += w * joy(f)
    weight += w
  }
  expression /= weight

  let connection = 0
  const close = new Set<number>()
  for (let i = 0; i < main.length; i++) {
    for (let j = i + 1; j < main.length; j++) {
      const [a, b] = main[i].x < main[j].x ? [main[i], main[j]] : [main[j], main[i]]
      const width = (a.w + b.w) / 2
      const distance = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) / width
      // Faces within about one face-width are touching or nearly so.
      const near = 1 - smooth(1.0, 2.2, distance)
      // The left person turned right and the right person turned left: looking at each other.
      const toward = clamp(((a.yaw ?? 0) - (b.yaw ?? 0)) / 0.9) * (1 - smooth(2.5, 5, distance))
      connection = Math.max(connection, near, toward * 0.85)
      if (near > 0.6) {
        close.add(i)
        close.add(j)
      }
    }
  }

  const eyesExplained = new Set<number>()
  main.forEach((f, i) => {
    if (f.blink > BLINK_LIMIT && (laugh(f) > 0.4 || close.has(i))) eyesExplained.add(i)
  })
  return { expression, connection, laughing: main.some((f) => laugh(f) > 0.5), eyesExplained }
}

/**
 * How the local moment signals are weighed for each kind of shoot. A wedding
 * lives on joy and closeness; a fashion frame is often deliberately unsmiling,
 * so a quiet face must not count against it.
 */
const MOMENT_WEIGHTS: Record<Genre, { base: number; expression: number; connection: number }> = {
  wedding: { base: 0.3, expression: 0.45, connection: 0.35 },
  event: { base: 0.3, expression: 0.5, connection: 0.3 },
  portrait: { base: 0.45, expression: 0.3, connection: 0.25 },
  fashion: { base: 0.55, expression: 0.12, connection: 0.2 },
  other: { base: 0.45, expression: 0.3, connection: 0.25 }
}

// --- craft ----------------------------------------------------------------------

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

export interface ScoreOptions {
  genre: Genre
  /** How much the moment counts against craft, 0..1. */
  balance: number
  /** What the active culling profile has learned, merged. Tilts close calls toward what it favours. */
  style?: StyleProfile
  /** What the profile's atmosphere words ask for. */
  feel?: Feel
  /** The model of the photographer's own taste, and how much say it has earned (0..0.8). */
  learned?: { model: Model; trust: number }
}

const FATAL: Warning[] = ['blink', 'soft', 'soft-face']
/** A moment this strong can outweigh a technical flaw. */
const GEM_MOMENT = 72

/** The balance after the profile's atmosphere words have nudged it. */
const effectiveBalance = (o: ScoreOptions): number => clamp(o.balance + (o.feel?.balance ?? 0))

export function scoreShot(a: Analysis, refs: Refs, options: ScoreOptions, read?: NarrativeRead): Score {
  const balance = effectiveBalance(options)
  const notes: string[] = []
  const momentNotes: string[] = []
  const warnings: Warning[] = []
  const tags: MomentTag[] = []
  const focus = relativeFocus(a.sharpness, refs.frame)
  const exposure = exposureScore(a, notes, warnings)
  const main = mainFaces(a.faces)
  const moment = readMoment(a.faces)

  // Craft of the faces: open eyes and sharp eyes. Expression is not craft.
  let faces: number | null = null
  if (main.length) {
    let total = 0
    let weight = 0
    let blinks = 0
    let softFaces = 0
    main.forEach((f, i) => {
      const w = f.w * f.h
      const explained = moment?.eyesExplained.has(i) ?? false
      const eyes = explained ? 1 : 1 - smooth(0.35, 0.7, f.blink)
      const faceFocus = relativeFocus(f.sharpness, refs.face) / 100
      total += w * (0.55 * eyes + 0.45 * faceFocus)
      weight += w
      if (f.blink > BLINK_LIMIT && !explained) blinks++
      if (faceFocus < 0.4) softFaces++
    })
    faces = (100 * total) / weight
    if (blinks) {
      warnings.push('blink')
      notes.push(
        main.length === 1
          ? 'Eyes closed, or looking down. A downward glance can be the best frame of a quiet moment, so judge it yourself.'
          : `${blinks} of ${main.length} faces have closed or lowered eyes.`
      )
    } else if (moment?.eyesExplained.size) {
      momentNotes.push('Eyes are closed inside a laugh or an embrace. That is the moment, not a blink.')
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
  }
  if (focus < 45 && !warnings.includes('soft-face')) {
    warnings.push('soft')
    notes.push(
      'Nothing in the frame is as crisp as the sharp frames around it. Likely motion blur or missed focus; fine if the blur is the point.'
    )
  } else if (focus > 85 && !main.length) {
    notes.push('Crisp where it counts.')
  }
  const craft = faces === null ? 0.75 * focus + 0.25 * exposure : 0.45 * faces + 0.4 * focus + 0.15 * exposure

  // The moment: what the faces show, and what the editor's read saw if there is one.
  let local: number | null = null
  if (moment) {
    const g = MOMENT_WEIGHTS[options.genre]
    const feel = options.feel
    // The profile's atmosphere words shift what counts: joy, closeness, or a quiet face.
    const w = {
      base: g.base + (feel?.quiet ?? 0),
      expression: Math.max(0, g.expression + (feel?.expression ?? 0)),
      connection: Math.max(0, g.connection + (feel?.connection ?? 0))
    }
    local = 100 * clamp(w.base + w.expression * moment.expression + w.connection * moment.connection)
    if (moment.laughing) {
      tags.push('laugh')
      momentNotes.push('Laughter: mouths open, eyes creased. Unposed joy is hard to repeat.')
    } else if (moment.expression > 0.5) {
      tags.push('joy')
      momentNotes.push('A smile that reaches the eyes.')
    }
    if (moment.connection > 0.75) {
      tags.push('embrace')
      momentNotes.push('Faces touching or nearly so: an embrace, a kiss, a whisper.')
    } else if (moment.connection > 0.4) {
      tags.push('connection')
      momentNotes.push('People turned toward each other. The picture is about what is between them.')
    }
    if (!tags.length) {
      momentNotes.push(
        'A quiet face. The measurements can see joy and closeness, not intensity or tenderness, so the value of this frame is yours to judge.'
      )
    }
  } else if (!read) {
    momentNotes.push('No faces to read. Whether this frame matters to the story is yours to judge.')
  }
  if (options.style) {
    const bonus = styleBonus(options.style, moment, a.shotType)
    if (local !== null) local = Math.max(0, Math.min(100, local + bonus.points))
    if (bonus.reasons.length) momentNotes.push(`Fits your reference: ${bonus.reasons.join('; ')}.`)
  }
  const momentScore = read ? (local === null ? read.moment * 10 : 0.4 * local + 0.6 * read.moment * 10) : local

  const flawed = warnings.some((w) => FATAL.includes(w))
  // A reference whose photographer keeps closed-eye frames lowers the bar for a gem.
  const gemBar = GEM_MOMENT - (options.style && options.style.closedEyesShare > 0.08 ? 8 : 0) - (options.feel?.forgiving ? 8 : 0)
  const gem = flawed && (read?.gem === true || (momentScore !== null && momentScore >= gemBar && balance >= 0.4))
  if (gem) {
    momentNotes.unshift(
      'Possible hidden gem: technically imperfect, but the moment may be worth more than the flaw. Look at it at the size it will be seen.'
    )
  }

  const overall = momentScore === null ? craft : (1 - balance) * craft + balance * momentScore
  return { overall, craft, moment: momentScore, focus, exposure, faces, notes, momentNotes, tags, warnings, gem }
}

const isFlawed = (s: Score): boolean => s.warnings.some((w) => FATAL.includes(w))

/**
 * Scores every analysed shot against its scene and proposes, per stack, which
 * frame to keep. These are proposals: the photographer's own decision always wins.
 */
export function scoreAndSuggest(shots: Shot[], options: ScoreOptions): Shot[] {
  const analysed = shots.filter((s) => s.analysis)
  const frameAll = percentile(analysed.map((s) => s.analysis!.sharpness), 0.9)
  const faceValues = (list: Shot[]): number[] => list.flatMap((s) => mainFaces(s.analysis!.faces).map((f) => f.sharpness))
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

  const scores = new Map<string, Score>()
  for (const s of analysed) scores.set(s.id, scoreShot(s.analysis!, refs.get(s.sceneId ?? 0)!, options, s.read))

  const stacks = new Map<number, Shot[]>()
  for (const s of analysed) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
  const suggestion = new Map<string, Suggestion>()
  for (const stack of stacks.values()) {
    // The peak of a burst: the frame where the expression crests.
    // (Skipped when the profile asks for quiet, composed frames: there the crest of a smile is not the goal.)
    if (stack.length > 1 && (options.feel?.expression ?? 0) >= 0) {
      const expr = stack.map((s) => readMoment(s.analysis!.faces)?.expression ?? 0)
      const top = Math.max(...expr)
      const mean = expr.reduce((a, b) => a + b, 0) / expr.length
      if (top > 0.35 && top - mean > 0.1) {
        const peak = scores.get(stack[expr.indexOf(top)].id)!
        peak.tags.push('peak')
        peak.momentNotes.push('The peak of this burst: the expression crests here and is weaker in the frames around it.')
        if (peak.moment !== null) {
          peak.moment = Math.min(100, peak.moment + 8)
          const balance = effectiveBalance(options)
          peak.overall = (1 - balance) * peak.craft + balance * peak.moment
        }
      }
    }
    // What the photographer's own past choices say about each frame of this moment.
    if (options.learned) {
      const { model, trust } = options.learned
      const scored = stack.map((s) => ({ ...s, score: scores.get(s.id)! }))
      for (const s of scored) {
        const x = featuresOf(s, scored)
        const likely = 100 * predict(model, x)
        s.score.learned = likely
        s.score.rules = s.score.overall
        s.score.learnedWhy = reasonsFor(model, x)
        s.score.overall = (1 - trust) * s.score.overall + trust * likely
        // Someone who keeps frames like this despite the flaw should be shown it, not have it hidden.
        if (trust > 0 && isFlawed(s.score) && !s.score.gem && likely >= 65) {
          s.score.gem = true
          s.score.momentNotes.unshift('You often keep frames like this one despite the flaw, so it is not being suggested as a reject.')
        }
      }
    }
    const ranked = [...stack].sort((a, b) => scores.get(b.id)!.overall - scores.get(a.id)!.overall)
    const best = ranked.find((s) => !isFlawed(scores.get(s.id)!))
    for (const s of ranked) {
      const score = scores.get(s.id)!
      if (s === best) suggestion.set(s.id, 'pick')
      // A gem is never thrown out on the app's say-so; it is put in front of the photographer.
      else if (score.gem) suggestion.set(s.id, 'alternate')
      else if (isFlawed(score)) suggestion.set(s.id, 'reject')
      // A clean frame nearly as good as the best is worth a second look.
      else if (best && scores.get(best.id)!.overall - score.overall < 6) suggestion.set(s.id, 'alternate')
      else suggestion.set(s.id, 'reject')
    }
  }
  return shots.map((s) => ({ ...s, score: scores.get(s.id), suggestion: suggestion.get(s.id) }))
}

// --- what the photographer's own choices say -------------------------------------

export interface Taste {
  decided: number
  /** Picks the app had suggested rejecting. */
  rescued: number
  /** Of those, how many were technically flawed. */
  rescuedFlawed: number
  /** Suggested keepers the photographer rejected. */
  overruled: number
  /** Mean craft and moment of picks minus those of rejects. */
  craftGap: number
  momentGap: number
  /** The balance that would have matched these decisions best, or null if too few. */
  fittedBalance: number | null
}

/**
 * Compares decisions with suggestions. Where the photographer keeps disagreeing
 * in one direction, the balance can be moved to follow their eye.
 */
export function tasteOf(shots: Shot[]): Taste {
  const judged = shots.filter((s) => s.decision && s.score && s.score.moment !== null)
  const picks = judged.filter((s) => s.decision === 'pick')
  const rejects = judged.filter((s) => s.decision === 'reject')
  const mean = (list: Shot[], f: (s: Score) => number): number =>
    list.length ? list.reduce((a, s) => a + f(s.score!), 0) / list.length : 0
  const all = shots.filter((s) => s.decision && s.score)
  const rescued = all.filter((s) => s.decision === 'pick' && s.suggestion === 'reject')

  // Try each balance and count how often the photographer's pick outranks their reject within a stack.
  let fittedBalance: number | null = null
  const stacks = new Map<number, Shot[]>()
  for (const s of judged) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
  const pairs: [Score, Score][] = []
  for (const stack of stacks.values()) {
    for (const p of stack.filter((s) => s.decision === 'pick')) {
      for (const r of stack.filter((s) => s.decision === 'reject')) pairs.push([p.score!, r.score!])
    }
  }
  if (pairs.length >= 12) {
    // Several balances usually agree equally well; take the middle of that range, not its edge.
    const tried = Array.from({ length: 21 }, (_, i) => i / 20)
    const agree = tried.map((b) => pairs.filter(([p, r]) => (1 - b) * p.craft + b * p.moment! > (1 - b) * r.craft + b * r.moment!).length)
    const best = tried.filter((_, i) => agree[i] === Math.max(...agree))
    fittedBalance = best[Math.floor(best.length / 2)]
  }
  return {
    decided: all.length,
    rescued: rescued.length,
    rescuedFlawed: rescued.filter((s) => isFlawed(s.score!)).length,
    overruled: all.filter((s) => s.decision === 'reject' && s.suggestion === 'pick').length,
    craftGap: mean(picks, (s) => s.craft) - mean(rejects, (s) => s.craft),
    momentGap: mean(picks, (s) => s.moment!) - mean(rejects, (s) => s.moment!),
    fittedBalance
  }
}
