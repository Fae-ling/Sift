// The people of a shoot.
//
// Faces are told apart, never identified: each sizeable face carries numbers
// taken from a small picture of it plus the colour of its hair and clothes
// (body.ts), and faces that are alike are gathered into one person. The
// photographer names the ones that matter and marks the key people. Every
// correction ("this is her too", "these two are the same person") adds a
// known face to that person, so the gathering improves within the shoot.

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

/** How alike two faces are, 0..1: mostly the face itself, partly hair and clothes. */
export function likeness(a: { id?: number[]; wear?: number[] }, b: { id?: number[]; wear?: number[] }): number {
  if (!a.id || !b.id) return 0
  return 0.75 * clamp(cosine(a.id, b.id)) + 0.25 * wearLikeness(a.wear, b.wear)
}

/** Likeness above which two faces are taken for the same person. */
export const SAME_PERSON = 0.74
const MAX_FACES = 14
/** Someone must appear in at least this many frames to be listed, unless the photographer named them. */
export const MIN_APPEARANCES = 2

const bestMatch = (f: FaceInfo, p: Person): number => p.faces.reduce((m, id, i) => Math.max(m, likeness(f, { id, wear: p.wear[i] })), 0)

let counter = 0
const newPersonId = (): string => `p${Date.now().toString(36)}${(counter++).toString(36)}`

/**
 * Says who each face is. Faces the photographer has assigned by hand
 * (`shot.peopleSet`) are left alone. People nobody named who turn out to
 * appear only once are dropped again.
 */
export function assignPeople(shots: Shot[], known: Person[]): { shots: Shot[]; people: Person[] } {
  const people = known.map((p) => ({ ...p, faces: [...p.faces], wear: [...p.wear] }))
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
        const m = bestMatch(f, p)
        if (m > score) {
          score = m
          best = p
        }
      }
      if (!best || score < SAME_PERSON) {
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
  const merged: Person = { ...into, key: into.key || from.key, faces: [...into.faces, ...from.faces].slice(0, MAX_FACES + 6), wear: [...into.wear, ...from.wear].slice(0, MAX_FACES + 6), thumb: into.thumb ?? from.thumb }
  return {
    people: people.filter((p) => p !== from).map((p) => (p === into ? merged : p)),
    shots: shots.map((s) => (s.people?.includes(fromId) ? { ...s, people: s.people.map((id) => (id === fromId ? intoId : id)) } : s))
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
