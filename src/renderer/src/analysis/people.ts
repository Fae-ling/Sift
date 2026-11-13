// The people of a shoot.
//
// Faces are told apart, never identified: each sizeable face carries numbers
// taken from a small picture of it plus the colour of its hair and clothes
// (body.ts), and faces that are alike are gathered into one person. The
// photographer names the ones that matter and marks the key people. Every
// correction ("this is her too", "these two are the same person") adds a
// known face to that person, so the gathering improves within the shoot.
//
// The corrections also teach how to tell people apart in general. Every merge
// ("these are the same person") and every removal ("this is not them") is a
// judgement about two faces, kept with how alike the app found them. From
// those judgements the app fits how much to trust the face against hair and
// clothes, and how alike two faces must be to count as one person, and it only
// uses what it fitted if that does better than its defaults on judgements it
// was not fitted on.

import type { FaceInfo, Person, Shot } from '@shared/types'

const clamp = (v: number): number => Math.min(1, Math.max(0, v))

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** How alike two sets of hair and clothes colours are, 0..1. */
function wearLikeness(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b) return 0.5
  let d = 0
  for (let i = 0; i < 6; i++) d += Math.abs(a[i] - b[i])
  return 1 - clamp(d / 6 / 255 / 0.22)
}

/** What decides whether two faces are one person: the weight of the face against hair and clothes, and how alike they must be. */
export interface Tuning {
  faceWeight: number
  threshold: number
}
export const DEFAULT_TUNING: Tuning = { faceWeight: 0.75, threshold: 0.74 }

/** The two ingredients of how alike two faces are, each 0..1. */
export function parts(a: { id?: number[]; wear?: number[] }, b: { id?: number[]; wear?: number[] }): { face: number; wear: number } | null {
  if (!a.id || !b.id) return null
  return { face: clamp(cosine(a.id, b.id)), wear: wearLikeness(a.wear, b.wear) }
}

/** How alike two faces are, 0..1: mostly the face itself, partly hair and clothes. */
export function likeness(a: { id?: number[]; wear?: number[] }, b: { id?: number[]; wear?: number[] }, tuning: Tuning = DEFAULT_TUNING): number {
  const p = parts(a, b)
  return p ? tuning.faceWeight * p.face + (1 - tuning.faceWeight) * p.wear : 0
}

/** Likeness above which two faces are taken for the same person, unless the photographer's corrections say otherwise. */
export const SAME_PERSON = DEFAULT_TUNING.threshold

/** One judgement by the photographer about two faces: how alike they looked, and whether they are the same person. */
export interface Judgement {
  face: number
  wear: number
  same: boolean
}

const MAX_JUDGEMENTS = 3000
const MIN_JUDGEMENTS = 16

/** Judgements about a face against a few of the faces known of a person (the most recent first). */
export function judge(face: { id?: number[]; wear?: number[] }, of: { faces: number[][]; wear: number[][] }, same: boolean, limit = 8): Judgement[] {
  const out: Judgement[] = []
  for (let i = of.faces.length - 1; i >= 0 && out.length < limit; i--) {
    const p = parts(face, { id: of.faces[i], wear: of.wear[i] })
    if (p) out.push({ ...p, same })
  }
  return out
}

export const addJudgements = (list: Judgement[] | undefined, more: Judgement[]): Judgement[] =>
  [...(list ?? []), ...more.map((j) => ({ face: Math.round(j.face * 1000) / 1000, wear: Math.round(j.wear * 1000) / 1000, same: j.same }))].slice(-MAX_JUDGEMENTS)

const accuracy = (js: Judgement[], t: Tuning): number =>
  js.length ? js.filter((j) => (t.faceWeight * j.face + (1 - t.faceWeight) * j.wear >= t.threshold) === j.same).length / js.length : 0

/** A stable split of judgements: about one in five is held back from fitting, and chosen the same way every time. */
const held = (i: number): boolean => (i * 2654435761) % 5 === 0

/** Best settings for a set of judgements, among a grid; ties go to the one nearest the defaults. */
function fit(js: Judgement[]): Tuning {
  let best = DEFAULT_TUNING
  let bestScore = accuracy(js, DEFAULT_TUNING)
  for (const faceWeight of [0.5, 0.6, 0.7, 0.75, 0.85, 1]) {
    for (let t = 40; t <= 98; t++) {
      const tuning = { faceWeight, threshold: t / 100 }
      const a = accuracy(js, tuning)
      const nearer = Math.abs(t / 100 - DEFAULT_TUNING.threshold) + Math.abs(faceWeight - DEFAULT_TUNING.faceWeight) < Math.abs(best.threshold - DEFAULT_TUNING.threshold) + Math.abs(best.faceWeight - DEFAULT_TUNING.faceWeight)
      if (a > bestScore + 1e-9 || (Math.abs(a - bestScore) < 1e-9 && nearer)) {
        best = tuning
        bestScore = a
      }
    }
  }
  return best
}

export interface TuningReport {
  tuning: Tuning
  /** Judgements it was fitted from, and those held back to test the fit on. */
  judgements: number
  tested: number
  /** Share of held-back judgements got right by the defaults and by the fitted settings. */
  defaults: number
  fitted: number
  /** True when the fitted settings are in use: they beat the defaults on the held-back judgements. */
  used: boolean
}

/**
 * Learns how to tell people apart from the photographer's corrections. The
 * settings are fitted on four fifths of the judgements and used only if they do
 * better than the defaults on the fifth held back, by more than chance.
 */
export function learnTuning(judgements: Judgement[] | undefined): TuningReport {
  const all = judgements ?? []
  const training = all.filter((_, i) => !held(i))
  const testing = all.filter((_, i) => held(i))
  const base: TuningReport = { tuning: DEFAULT_TUNING, judgements: all.length, tested: testing.length, defaults: accuracy(testing, DEFAULT_TUNING), fitted: accuracy(testing, DEFAULT_TUNING), used: false }
  const same = all.filter((j) => j.same).length
  if (all.length < MIN_JUDGEMENTS || same < 4 || all.length - same < 4 || testing.length < 4) return base
  const fitted = fit(training)
  const fittedAcc = accuracy(testing, fitted)
  const noise = Math.sqrt((base.defaults * (1 - base.defaults)) / testing.length)
  const better = fittedAcc > base.defaults + Math.max(0.03, noise * 0.5)
  if (!better) return { ...base, fitted: fittedAcc }
  // The settings in use are then refitted on everything, held-back judgements included.
  return { ...base, tuning: fit(all), fitted: fittedAcc, used: true }
}
const MAX_FACES = 14
/** Someone must appear in at least this many frames to be listed, unless the photographer named them. */
export const MIN_APPEARANCES = 2

const bestMatch = (f: FaceInfo, p: Person, t: Tuning): number => p.faces.reduce((m, id, i) => Math.max(m, likeness(f, { id, wear: p.wear[i] }, t)), 0)
/** How like a face is to the faces the photographer said are not this person. */
const worstMatch = (f: FaceInfo, p: Person, t: Tuning): number => (p.not ?? []).reduce((m, n) => Math.max(m, likeness(f, n, t)), 0)

let counter = 0
const newPersonId = (): string => `p${Date.now().toString(36)}${(counter++).toString(36)}`

/**
 * Says who each face is. Faces the photographer has assigned by hand
 * (`shot.peopleSet`) are left alone. People nobody named who turn out to
 * appear only once are dropped again.
 */
export function assignPeople(shots: Shot[], known: Person[], tuning: Tuning = DEFAULT_TUNING): { shots: Shot[]; people: Person[] } {
  const people: Person[] = known.map((p) => ({ ...p, faces: [...p.faces], wear: [...p.wear], not: [...(p.not ?? [])] }))
  const seen = new Map<string, number>()
  const out = shots.map((s) => {
    const faces = s.analysis?.faces ?? []
    if (!faces.some((f) => f.id)) return s.people ? { ...s, people: undefined } : s
    const fixed = new Set(s.peopleSet ?? [])
    const who: (string | null)[] = faces.map((_, i) => (fixed.has(i) ? (s.people?.[i] ?? null) : null))
    const taken = new Set(who.filter(Boolean) as string[])
    faces.forEach((f, i) => {
      if (fixed.has(i) || !f.id) return
      let best: Person | null = null
      let score = 0
      for (const p of people) {
        // One person cannot be two faces of the same frame.
        if (taken.has(p.id)) continue
        const m = bestMatch(f, p, tuning)
        // A face the photographer has said is not this person stays out, however alike it looks to the rest of them.
        if (p.not?.length && worstMatch(f, p, tuning) >= m - 0.02) continue
        if (m > score) {
          score = m
          best = p
        }
      }
      if (!best || score < tuning.threshold) {
        best = { id: newPersonId(), name: '', key: false, faces: [f.id], wear: [f.wear ?? []] }
        people.push(best)
      } else if (score < 0.92 && best.faces.length < MAX_FACES) {
        // A face that matched without being a near-copy widens what is known of the person.
        best.faces.push(f.id)
        best.wear.push(f.wear ?? [])
      }
      who[i] = best.id
      taken.add(best.id)
    })
    for (const id of taken) seen.set(id, (seen.get(id) ?? 0) + 1)
    return { ...s, people: who }
  })
  const keep = new Set(people.filter((p) => p.name || p.key || (seen.get(p.id) ?? 0) >= MIN_APPEARANCES).map((p) => p.id))
  return {
    people: people.filter((p) => keep.has(p.id)),
    shots: out.map((s) => (s.people?.some((id) => id && !keep.has(id)) ? { ...s, people: s.people.map((id) => (id && keep.has(id) ? id : null)) } : s))
  }
}

/** Folds one person into another: they were the same all along. */
export function mergePeople(shots: Shot[], people: Person[], fromId: string, intoId: string): { shots: Shot[]; people: Person[] } {
  const from = people.find((p) => p.id === fromId)
  const into = people.find((p) => p.id === intoId)
  if (!from || !into || from === into) return { shots, people }
  // Both keep a share of the faces: when the one they join is already full, the newcomer's must not be cut off,
  // or the app would no longer know what it looks like and would split it off again.
  const room = MAX_FACES + 6
  const share = Math.min(from.faces.length, Math.max(8, room - into.faces.length))
  const keepInto = Math.min(into.faces.length, room - share)
  const merged: Person = { ...into, key: into.key || from.key, faces: [...into.faces.slice(0, keepInto), ...from.faces.slice(-share)], wear: [...into.wear.slice(0, keepInto), ...from.wear.slice(-share)], thumb: into.thumb ?? from.thumb, not: [...(into.not ?? []), ...(from.not ?? [])].slice(-20) }
  return {
    people: people.filter((p) => p !== from).map((p) => (p === into ? merged : p)),
    // The faces that were theirs are now settled as the other person's: "same person" is the photographer's word,
    // so looking again must not split them off because they look unlike the rest (side view, other light).
    shots: shots.map((s) => {
      if (!s.people?.includes(fromId)) return s
      const moved = s.people.flatMap((id, i) => (id === fromId ? [i] : []))
      return { ...s, people: s.people.map((id) => (id === fromId ? intoId : id)), peopleSet: [...new Set([...(s.peopleSet ?? []), ...moved])] }
    })
  }
}

/** How often each person appears, and in how many kept frames. */
export function appearances(shots: Shot[]): Map<string, { frames: number; kept: number; largest: { shot: Shot; face: number; size: number } | null }> {
  const out = new Map<string, { frames: number; kept: number; largest: { shot: Shot; face: number; size: number } | null }>()
  for (const s of shots) {
    s.people?.forEach((id, i) => {
      if (!id) return
      const f = s.analysis?.faces[i]
      const entry = out.get(id) ?? { frames: 0, kept: 0, largest: null }
      entry.frames++
      if (s.decision === 'pick') entry.kept++
      if (f && (!entry.largest || f.h > entry.largest.size)) entry.largest = { shot: s, face: i, size: f.h }
      out.set(id, entry)
    })
  }
  return out
}

/** The key people in a frame: name and which face. */
export function keyPeopleIn(shot: Shot, people: Person[] | undefined): { name: string; face: number }[] {
  if (!people?.length || !shot.people) return []
  return shot.people.flatMap((id, face) => {
    const p = id ? people.find((x) => x.id === id) : undefined
    return p?.key ? [{ name: p.name || 'a key person', face }] : []
  })
}

/** What to call the people in a frame, for a label: "bride, groom". Only named people. */
export function namesIn(shot: Shot, people: Person[] | undefined): string[] {
  if (!people?.length || !shot.people) return []
  return [...new Set(shot.people.flatMap((id) => (id ? [people.find((x) => x.id === id)?.name ?? ''] : [])).filter(Boolean))]
}

/**
 * Takes a face out of a person: the face stops being one of those known of them
 * (any copy of it), and becomes one of the faces said not to be them, so that
 * similar faces are kept away too.
 */
export function removeFromPerson(person: Person, face: { id?: number[]; wear?: number[] }): Person {
  if (!face.id) return person
  const keep: number[] = []
  person.faces.forEach((id, i) => {
    // Only the very same face is removed as an example, not the others that merely look like it:
    // those are the person's other faces, and the removed one is kept away through `not`.
    if (!id.every((v, k) => v === face.id![k])) keep.push(i)
  })
  return {
    ...person,
    faces: keep.map((i) => person.faces[i]),
    wear: keep.map((i) => person.wear[i]),
    not: [...(person.not ?? []), { id: face.id, wear: face.wear ?? [] }].slice(-20)
  }
}
