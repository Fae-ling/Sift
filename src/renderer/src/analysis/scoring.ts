import type { Analysis, FaceInfo, Genre, MomentTag, NarrativeRead, Person, Score, Shot, ShotType, StyleProfile, Suggestion, Warning } from '@shared/types'
import { assetsOf, describeFrame, flawsOf } from './describe'
import { gestureCentroid, leadGesture, type GestureStore } from './gesture'
import { assetLift, cleanTag, forgiveness, recogniseTags, sceneVector, tagDirections, type Concepts, type ForgivePrior, type ProjectLedger } from './knowledge'
import { keyPeopleIn } from './people'
import { centroid, DEFAULT_EMOTION_VALUE, FAMILY_EMOTIONS, readEmotion, toCues, UNNAMED_EMOTION_VALUE, type EmotionRead, type EmotionStore } from './emotion'
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
  /** The emotion machine, and how much the style in use values each emotion (-1..1). */
  emotions?: { store: EmotionStore; weights: Record<string, number>; centroids?: number[][] }
  /** Chapters the style says must not be missed. */
  must?: Set<string>
  /** The gesture machine. */
  gestures?: { store: GestureStore; centroids?: number[][] }
  /** What the app has learned to recognise as happening in a frame. */
  concepts?: { store: Concepts; directions?: ReturnType<typeof tagDirections> }
  /** Why the photographer has rejected frames before, as something that can be recognised. */
  reasons?: { store: Concepts; directions?: ReturnType<typeof tagDirections> }
  /** Forgiveness rules from Claude's review that the photographer approved. */
  forgive?: ForgivePrior[]
  /** The photographer's decisions so far, filed by mistake and asset. */
  ledger?: ProjectLedger
  /** The people of this shoot; the key ones count for more. */
  people?: Person[]
  /** The model of the photographer's own taste, and how much say it has earned (0..0.8). */
  learned?: { model: Model; trust: number }
}

const FATAL: Warning[] = ['blink', 'soft', 'soft-face', 'misfire', 'blurred']
/** Emotions in which closed eyes are part of the expression, not a blink. */
const EYES_CLOSE_IN = ['laughter', 'tenderness', 'crying', 'pout', 'joy']
/** A moment this strong can outweigh a technical flaw. */
const GEM_MOMENT = 72

/** The balance after the profile's atmosphere words have nudged it. */
const effectiveBalance = (o: ScoreOptions): number => clamp(o.balance + (o.feel?.balance ?? 0))

/** The emotion on every face of a frame, and the one that leads it. */
export function readFaces(a: Analysis, options: ScoreOptions): { reads: (EmotionRead | null)[]; lead: { name: string; intensity: number } | null } {
  const e = options.emotions
  if (!e) return { reads: a.faces.map(() => null), lead: null }
  const centroids = e.centroids ?? e.store.concepts.map(centroid)
  const reads = a.faces.map((f) => (f.shapes ? readEmotion(toCues(f.shapes), e.store, centroids) : null))
  let lead: { name: string; intensity: number } | null = null
  let strongest = 0
  a.faces.forEach((f, i) => {
    const r = reads[i]
    if (!r || r.name === 'calm' || f.h < MIN_FACE) return
    const pull = r.intensity * Math.sqrt(f.w * f.h)
    if (pull > strongest) {
      strongest = pull
      lead = { name: r.name ?? 'unnamed', intensity: r.intensity }
    }
  })
  return { reads, lead }
}

/** What a style thinks of an emotion: its own weight, else the family's, else a general regard for strong feeling. */
export function emotionWeight(weights: Record<string, number>, genre: Genre, name: string | null): number {
  if (name === null) return UNNAMED_EMOTION_VALUE
  return weights[name] ?? FAMILY_EMOTIONS[genre]?.[name] ?? DEFAULT_EMOTION_VALUE
}

export interface FrameContext {
  /** This frame's leading emotion is rare in the shoot. */
  rare?: boolean
  /** The frame belongs to a chapter that must not be missed. */
  must?: boolean
  /** The key people in the frame, and which face each is. */
  keyPeople?: { name: string; face: number }[]
  /** What is happening in the frame, as words. */
  happens?: string[]
}

export function scoreShot(a: Analysis, refs: Refs, options: ScoreOptions, read?: NarrativeRead, ctx: FrameContext = {}): Score {
  const balance = effectiveBalance(options)
  const { reads, lead } = readFaces(a, options)
  const notes: string[] = []
  const momentNotes: string[] = []
  const warnings: Warning[] = []
  const tags: MomentTag[] = []
  const focus = relativeFocus(a.sharpness, refs.frame)
  const exposure = exposureScore(a, notes, warnings)
  const main = mainFaces(a.faces)
  const moment = readMoment(a.faces)
  // A key person's face counts three times: their closed eyes matter more than a bystander's.
  const keyFaces = new Set((ctx.keyPeople ?? []).map((k) => k.face))
  const weightOf = (f: FaceInfo): number => f.w * f.h * (keyFaces.has(a.faces.indexOf(f)) ? 3 : 1)

  // Craft of the faces: open eyes and sharp eyes. Expression is not craft.
  let faces: number | null = null
  if (main.length) {
    let total = 0
    let weight = 0
    let blinks = 0
    let softFaces = 0
    main.forEach((f, i) => {
      const w = weightOf(f)
      const emotion = reads[a.faces.indexOf(f)]
      const explained = (moment?.eyesExplained.has(i) ?? false) || (!!emotion?.name && EYES_CLOSE_IN.includes(emotion.name) && emotion.intensity > 0.3)
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
    } else if (main.some((f) => f.blink > BLINK_LIMIT)) {
      momentNotes.push('Eyes are closed inside the expression (a laugh, an embrace, tears). That is the moment, not a blink.')
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
  // A frame with nothing in it, or blurred beyond any use, is not a candidate at all.
  const c = a.color
  if (c.p95 < 0.06 || c.p95 - c.p5 < 0.035) {
    warnings.push('misfire')
    notes.unshift('A misfire: the frame is almost entirely black, white or blank.')
  } else if (focus < 18 && !main.length) {
    warnings.push('blurred')
    notes.unshift('Blurred throughout, far beyond the frames around it.')
  }
  let craft = faces === null ? 0.75 * focus + 0.25 * exposure : 0.45 * faces + 0.4 * focus + 0.15 * exposure
  // Composition, where the photo diagnosis has looked at this frame: does the subject
  // stand clear of the background, hold the eye, and is anything pulling it away?
  if (a.diag) {
    const d = a.diag
    const parts: number[] = []
    if (d.merged !== undefined) parts.push(1 - smooth(0.1, 0.6, d.merged))
    if (d.attention !== undefined) parts.push(smooth(0.15, 0.6, d.attention))
    if (d.pull !== undefined) parts.push(1 - smooth(0.04, 0.2, d.pull))
    if (parts.length) {
      const composition = (100 * parts.reduce((x, y) => x + y, 0)) / parts.length
      craft = 0.82 * craft + 0.18 * composition
      if (d.merged !== undefined && d.merged > 0.35) notes.push(`The subject merges with the background along ${Math.round(d.merged * 100)}% of its outline.`)
      if (d.pull !== undefined && d.pull > 0.1) notes.push('Something other than the subject pulls the eye strongly.')
      if (d.attention !== undefined && d.attention > 0.6 && (d.merged ?? 0) < 0.15) notes.push('The subject stands clear and holds the eye.')
    }
  }

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
  // Emotion: what each face is showing, weighed by what this style of shoot is looking for.
  let emotionValue: number | undefined
  if (moment && options.emotions && main.some((f) => f.shapes)) {
    let total = 0
    let weight = 0
    for (const f of main) {
      const r = reads[a.faces.indexOf(f)]
      if (!r) continue
      const w = weightOf(f)
      weight += w
      if (r.name !== 'calm') total += w * r.intensity * emotionWeight(options.emotions.weights, options.genre, r.name)
    }
    emotionValue = weight ? total / weight : 0
    const g = MOMENT_WEIGHTS[options.genre]
    const base = g.base + (options.feel?.quiet ?? 0)
    const connection = Math.max(0, g.connection + (options.feel?.connection ?? 0))
    // Replaces the simpler joy-only reading above: every emotion counts, for or against.
    local = 100 * clamp(base + 0.55 * emotionValue + connection * moment.connection)
    if (lead) {
      const value = emotionWeight(options.emotions.weights, options.genre, lead.name === 'unnamed' ? null : lead.name)
      momentNotes.unshift(
        lead.name === 'unnamed'
          ? `A strong expression (${Math.round(lead.intensity * 100)}%) the app has not been taught a name for yet. Teach it under Emotions.`
          : `Reads as ${lead.name}, at ${Math.round(lead.intensity * 100)}% strength. ${value >= 0.6 ? 'This style is looking for it.' : value <= -0.2 ? 'This style usually works against it.' : 'This style is neutral about it.'}`
      )
    }
    if (ctx.rare && lead) {
      local = Math.min(100, local + 10 * lead.intensity)
      tags.push('rare')
      momentNotes.push(`Rare in this shoot: few frames show ${lead.name === 'unnamed' ? 'an expression like this' : lead.name}. Uncommon moments are the ones a set is remembered for.`)
    }
  }
  // Gesture: what the bodies are doing. It can carry a frame in which no face is visible.
  const gesture = options.gestures ? leadGesture(a.bodies, options.gestures.store, options.gestures.centroids) : null
  if (gesture) {
    const worth = gesture.intensity * gesture.value
    if (local !== null) local = Math.max(0, Math.min(100, local + 14 * worth))
    else if (!read) local = 100 * clamp(0.42 + 0.45 * worth)
    momentNotes.push(moment ? `Gesture: ${gesture.name}.` : `No face to read, but the body speaks: ${gesture.name}.`)
  }
  if (ctx.keyPeople?.length) {
    if (local !== null) local = Math.min(100, local + 6)
    momentNotes.push(`With ${[...new Set(ctx.keyPeople.map((k) => k.name))].join(' and ')}: ${ctx.keyPeople.length > 1 ? 'key people' : 'a key person'} of this shoot.`)
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
  // A frame with nothing in it is never a gem, whatever anyone says about it.
  const gem = flawed && !warnings.includes('misfire') && (read?.gem === true || (momentScore !== null && momentScore >= gemBar && balance >= 0.4))
  if (gem) {
    momentNotes.unshift(
      'Possible hidden gem: technically imperfect, but the moment may be worth more than the flaw. Look at it at the size it will be seen.'
    )
  }

  const overall = momentScore === null ? craft : (1 - balance) * craft + balance * momentScore
  if (ctx.must) momentNotes.push('Belongs to a chapter this style says must not be missed.')
  return {
    overall, craft, moment: momentScore, focus, exposure, faces, notes, momentNotes, tags, warnings, gem,
    emotion: lead ?? undefined,
    faceEmotions: options.emotions ? reads.map((r) => (r ? (r.name === 'calm' ? null : (r.name ?? 'unnamed')) : null)) : undefined,
    emotionValue,
    must: ctx.must || undefined,
    gesture: gesture ? { name: gesture.name, intensity: gesture.intensity } : undefined,
    keyPeople: ctx.keyPeople?.length ? [...new Set(ctx.keyPeople.map((k) => k.name))] : undefined,
    happens: ctx.happens?.length ? ctx.happens : undefined,
    happening: describeFrame(a, {
      emotions: main.map((f) => {
        const r = reads[a.faces.indexOf(f)]
        return r && r.name !== 'calm' ? (r.name ?? 'unnamed') : null
      }),
      gesture: gesture?.name,
      connection: moment?.connection ?? 0,
      keyPeople: [...new Set((ctx.keyPeople ?? []).map((k) => k.name))],
      happens: read?.tags?.length ? [] : (ctx.happens ?? [])
    })
  }
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

  // Work out where each emotion concept sits once, not once per face.
  if (options.emotions && !options.emotions.centroids) options = { ...options, emotions: { ...options.emotions, centroids: options.emotions.store.concepts.map(centroid) } }
  // How common each emotion is in this shoot: an emotion shown in a handful of frames is special.
  const leads = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const s of analysed) {
    const lead = readFaces(s.analysis!, options).lead
    if (!lead || lead.intensity < 0.35) continue
    leads.set(s.id, lead.name)
    seen.set(lead.name, (seen.get(lead.name) ?? 0) + 1)
  }
  const rare = (id: string): boolean => {
    const name = leads.get(id)
    return !!name && analysed.length >= 40 && seen.get(name)! / analysed.length < 0.04
  }
  if (options.gestures && !options.gestures.centroids) options = { ...options, gestures: { ...options.gestures, centroids: options.gestures.store.concepts.map(gestureCentroid) } }
  const directions = options.concepts ? (options.concepts.directions ?? tagDirections(options.concepts.store)) : []
  // What is happening: the photographer's own words first, then Claude's, then what the app recognises by itself.
  const happensIn = (s: Shot): string[] => {
    const said = [...new Set([...(s.tags ?? []), ...(s.read?.tags ?? [])].map(cleanTag).filter(Boolean))]
    if (said.length || !options.concepts || !directions.length) return said
    return recogniseTags(sceneVector(s.analysis!), options.concepts.store, directions)
  }
  const reasonDirections = options.reasons ? (options.reasons.directions ?? tagDirections(options.reasons.store)) : []
  const mustChapter = (s: Shot): boolean => !!options.must?.has(s.chapter ?? s.read?.beat ?? '')

  const scores = new Map<string, Score>()
  for (const s of analysed) scores.set(s.id, scoreShot(s.analysis!, refs.get(s.sceneId ?? 0)!, options, s.read, { rare: rare(s.id), must: mustChapter(s), keyPeople: keyPeopleIn(s, options.people), happens: happensIn(s) }))

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
    // Mistakes against assets: what is wrong with each frame, what it brings, and what
    // the photographer's own culls say about that trade.
    for (const s of stack) {
      const score = scores.get(s.id)!
      const flaws = (score.flaws = flawsOf(score, s.analysis!))
      // A frame that looks like frames the photographer rejected for a reason they gave.
      if (options.reasons && reasonDirections.length && s.decision === null) {
        const like = recogniseTags(sceneVector(s.analysis!), options.reasons.store, reasonDirections).slice(0, 2)
        for (const r of like) {
          flaws.push(`looks like: ${r}`)
          score.overall = Math.max(0, score.overall - 5)
        }
        if (like.length) score.notes.push(`Looks like frames you rejected for ${like.join(' and ')}.`)
      }
      const assets = (score.assets = assetsOf(score, s, s.analysis!))
      const ledger = options.ledger
      if (!ledger) continue
      const lifts = assets.flatMap((x) => {
        const l = assetLift(ledger, x)
        return l ? [{ asset: x, ...l }] : []
      })
      const up = lifts.filter((l) => l.lift > 0).sort((x, y) => y.lift - x.lift).slice(0, 2)
      const down = lifts.filter((l) => l.lift < 0).sort((x, y) => x.lift - y.lift)[0]
      const shift = Math.max(-10, Math.min(10, 40 * (up.reduce((n, l) => n + l.lift, 0) / Math.max(1, up.length)) + 40 * (down?.lift ?? 0)))
      if (Math.abs(shift) >= 1) {
        score.overall = Math.max(0, Math.min(100, score.overall + shift))
        const lead = shift > 0 ? up[0] : down
        if (lead) score.momentNotes.push(`${shift > 0 ? 'You keep' : 'You tend to pass over'} frames with ${lead.asset} ${shift > 0 ? 'more often than others' : ''} (kept ${Math.round(lead.k)} of ${Math.round(lead.n)}).`.replace('  ', ' '))
      }
      const f = forgiveness(ledger, flaws, assets, options.forgive)
      if (!f) continue
      const said = `${Math.round(f.k)} of ${Math.round(f.n)} frames with ${f.flaw}${f.asset ? ` that also had ${f.asset}` : ''}`
      // With little evidence of its own the rule is Claude's reading of your culls, and says so.
      const thin = f.guided && f.n < 4
      const what = `${f.flaw}${f.asset ? ` when there is ${f.asset}` : ''}`
      if (f.factor >= 0.6 && isFlawed(score) && !score.warnings.includes('misfire') && !score.warnings.includes('blurred')) {
        score.tradeoff = thin
          ? `From the review of your culls: ${what} is worth less to you than what the frame brings.`
          : `You have kept ${said}. Here the mistake is worth less to you than what the frame brings.`
        score.overall = Math.min(100, score.overall + f.factor * 0.5 * Math.max(0, 75 - score.craft) * (1 - effectiveBalance(options)))
        if (!score.gem) {
          score.gem = true
          score.momentNotes.unshift(score.tradeoff)
        }
      } else if (f.factor <= 0.3) {
        score.tradeoff = thin ? `From the review of your culls: ${what} usually outweighs what a frame brings.` : `You have kept only ${said}. To you this mistake usually outweighs what a frame brings.`
      } else {
        score.tradeoff = thin ? `From the review of your culls: ${what} is a close call, yours to make.` : `You have kept ${said}: a close call, yours to make.`
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
      // Nor is the only frame of a moment from a chapter that must not be missed, unless it is a misfire.
      else if (score.must && !best && s === ranked[0] && !score.warnings.includes('misfire')) suggestion.set(s.id, 'alternate')
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

// --- the ultrafast cull ----------------------------------------------------------

/** The kinds of frame the ultrafast cull can reject. */
export type TriageKind = 'misfire' | 'blurred' | 'flawedTwin' | 'spare'

/**
 * What the ultrafast cull would reject, by kind. Only frames nobody has decided,
 * never a hidden gem, never the only frame of a chapter that must not be missed.
 */
export function triage(shots: Shot[]): Record<TriageKind, Shot[]> {
  const out: Record<TriageKind, Shot[]> = { misfire: [], blurred: [], flawedTwin: [], spare: [] }
  const hasKeeper = new Set(shots.filter((x) => x.suggestion === 'pick' || x.decision === 'pick').map((x) => x.stackId))
  for (const x of shots) {
    if (x.decision !== null || !x.score) continue
    const w = x.score.warnings
    if (w.includes('misfire')) out.misfire.push(x)
    else if (x.score.gem || x.suggestion !== 'reject') continue
    else if (w.includes('blurred') || (w.includes('soft') && x.score.focus < 25)) out.blurred.push(x)
    else if (hasKeeper.has(x.stackId) && w.some((k) => k === 'blink' || k === 'soft' || k === 'soft-face')) out.flawedTwin.push(x)
    else if (hasKeeper.has(x.stackId)) out.spare.push(x)
  }
  return out
}

