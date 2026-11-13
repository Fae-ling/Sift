import { describe, expect, it } from 'vitest'
import type { Analysis, FaceInfo, Score, Shot } from '@shared/types'
import { estimateOf, relookOf } from '../src/renderer/src/analysis/estimate'
import { emptyGestures, GESTURE_CUES, leadGesture, poseCues, readGesture, teachGesture, withOthers, type Mark } from '../src/renderer/src/analysis/gesture'
import { newer } from '../src/shared/version'
import { learn as learnTaste, FEATURES } from '../src/renderer/src/analysis/learner'
import { absorbReasons, emptyReasons, ledgerEntries, reasonConcepts, withoutExcluded, tagDirections } from '../src/renderer/src/analysis/knowledge'
import { absorb, assetLift, briefing, claudeRecord, emptyKnowledge, forgiveness, learnTags, ledgerOf, mergedLedger, recogniseTags, settleTags, verdictOf, vocabulary, type Concepts } from '../src/renderer/src/analysis/knowledge'
import { scoreAndSuggest } from '../src/renderer/src/analysis/scoring'
import { addJudgements, assignPeople, DEFAULT_TUNING, judge, keyPeopleIn, learnTuning, likeness, mergePeople, removeFromPerson, type Judgement } from '../src/renderer/src/analysis/people'

// A body facing the camera: left shoulder on the image's right.
function body(over: Record<number, [number, number]> = {}): Mark[] {
  const marks: Mark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0 }))
  const set = (i: number, x: number, y: number): void => void (marks[i] = { x, y, v: 0.95 })
  set(0, 0.5, 0.2) // nose
  set(7, 0.53, 0.19); set(8, 0.47, 0.19) // ears
  set(11, 0.58, 0.3); set(12, 0.42, 0.3) // shoulders
  set(13, 0.6, 0.42); set(14, 0.4, 0.42) // elbows
  set(15, 0.6, 0.54); set(16, 0.4, 0.54) // wrists hanging
  set(23, 0.55, 0.56); set(24, 0.45, 0.56) // hips
  set(25, 0.55, 0.74); set(26, 0.45, 0.74) // knees
  set(27, 0.55, 0.92); set(28, 0.45, 0.92) // ankles
  for (const [i, [x, y]] of Object.entries(over)) set(Number(i), x, y)
  return marks
}
const cue = (g: number[], name: (typeof GESTURE_CUES)[number]): number => g[GESTURE_CUES.indexOf(name)]
const stored = (g: number[]): number[] => g.map((v) => Math.round(v * 100))

describe('gestures', () => {
  it('reads a body standing with its arms down as at rest', () => {
    const g = poseCues(body(), 1)
    expect(readGesture(stored(g), emptyGestures()).name).toBeNull()
  })
  it('reads both arms above the head as arms raised', () => {
    const g = poseCues(body({ 13: [0.62, 0.2], 14: [0.38, 0.2], 15: [0.62, 0.06], 16: [0.38, 0.06] }), 1)
    expect(cue(g, 'armsUp')).toBeGreaterThan(0.8)
    expect(readGesture(stored(g), emptyGestures()).name).toBe('arms raised')
  })
  it('reads one arm up as a raised hand, and a hand at the face as hand to face', () => {
    const one = poseCues(body({ 13: [0.62, 0.2], 15: [0.62, 0.06] }), 1)
    expect(readGesture(stored(one), emptyGestures()).name).toBe('raised hand')
    const face = poseCues(body({ 13: [0.6, 0.36], 15: [0.52, 0.22] }), 1)
    expect(readGesture(stored(face), emptyGestures()).name).toBe('hand to face')
  })
  it('reads someone seen from behind as turned away', () => {
    const g = poseCues(body({ 11: [0.42, 0.3], 12: [0.58, 0.3] }), 1)
    expect(cue(g, 'turnedAway')).toBeGreaterThan(0.8)
  })
  it('reads two overlapping bodies as an embrace', () => {
    const bodies = [
      { x: 0.3, y: 0.1, w: 0.25, h: 0.8, g: poseCues(body(), 1) },
      { x: 0.42, y: 0.12, w: 0.25, h: 0.8, g: poseCues(body(), 1) }
    ]
    withOthers(bodies, 1.5)
    expect(readGesture(stored(bodies[0].g), emptyGestures()).name).toBe('embrace')
    const lead = leadGesture(bodies.map((b) => ({ ...b, g: stored(b.g) })), emptyGestures())
    expect(lead?.name).toBe('embrace')
  })
  it('learns a new gesture from examples', () => {
    const lunge = stored(poseCues(body({ 27: [0.75, 0.92], 28: [0.3, 0.92], 13: [0.72, 0.3], 15: [0.86, 0.3] }), 1))
    let store = emptyGestures()
    for (let i = 0; i < 6; i++) store = teachGesture(store, 'Sword Lunge', lunge, 'you')
    expect(readGesture(lunge, store).name).toBe('sword lunge')
  })
})

const color = { meanLuma: 0.45, p5: 0.05, p95: 0.9, clipLow: 0, clipHigh: 0, meanSat: 0.3, castWarm: 0, castTint: 0, palette: [] }
const face = (over: Partial<FaceInfo> = {}): FaceInfo => ({ x: 0.4, y: 0.2, w: 0.2, h: 0.3, blink: 0, smile: 0, sharpness: 100, skinHue: 20, skinSat: 0.3, ...over })
const analysis = (over: Partial<Analysis> = {}): Analysis => ({ sharpness: 100, hash: '0', color, faces: [face()], shotType: 'medium', ...over })
const score = (over: Partial<Score> = {}): Score => ({ overall: 60, craft: 60, moment: 60, focus: 80, exposure: 90, faces: 80, notes: [], momentNotes: [], tags: [], warnings: [], gem: false, ...over })
let n = 0
const shot = (over: Partial<Shot> = {}): Shot => ({ id: `s${n++}`, path: '', name: '', time: 0, width: 0, height: 0, decision: null, rating: 0, analysis: analysis(), score: score(), stackId: n, ...over })

describe('what is happening', () => {
  // Two kinds of frame that differ in measurements: bright wide groups, and dark close-ups.
  const dance = (): number[] => [0.6, 0.2, 0.8, 0.9, 0.1].map((v) => v + (Math.random() - 0.5) * 0.05)
  const prep = (): number[] => [0.1, 0.9, 0.1, 0.2, 0.8].map((v) => v + (Math.random() - 0.5) * 0.05)
  const taught = (): Concepts => {
    let c: Concepts = { mean: [], seen: 0, tags: [] }
    for (let i = 0; i < 8; i++) {
      c = learnTags(c, `p:d${i}`, dance(), ['First Dance '], 'claude', 0.5)
      c = learnTags(c, `p:g${i}`, prep(), ['getting ready'], 'claude', 0.5)
    }
    return c
  }
  it('recognises by itself what it was shown often enough', () => {
    const c = taught()
    expect(recogniseTags(dance(), c)).toEqual(['first dance'])
    expect(recogniseTags(prep(), c)).toEqual(['getting ready'])
    expect(vocabulary(c).every((w) => w.usable)).toBe(true)
  })
  it('does not use a word it has seen only a couple of times', () => {
    let c: Concepts = { mean: [], seen: 0, tags: [] }
    c = learnTags(c, 'p:1', dance(), ['first dance'], 'claude', 0.5)
    c = learnTags(c, 'p:2', prep(), ['getting ready'], 'claude', 0.5)
    expect(recogniseTags(dance(), c)).toEqual([])
  })
  it('a frame described again replaces its earlier description', () => {
    let c = taught()
    c = learnTags(c, 'p:d0', dance(), ['toast'], 'claude', 0.5)
    expect(c.tags.find((t) => t.name === 'first dance')!.examples).toHaveLength(7)
    expect(c.tags.find((t) => t.name === 'toast')!.examples).toHaveLength(1)
  })
  it('weighs a description by whether the photographer agreed with Claude about the frame', () => {
    const c = settleTags(taught(), 'p', new Map([['d0', 'agreed'], ['d1', 'disagreed']]))
    const ex = c.tags.find((t) => t.name === 'first dance')!.examples
    expect(ex.find((e) => e.key === 'p:d0')!.w).toBe(1)
    expect(ex.find((e) => e.key === 'p:d1')!.w).toBe(0.3)
    expect(ex.find((e) => e.key === 'p:d2')!.w).toBe(0.5)
  })
})

describe('mistakes against assets', () => {
  // A photographer who keeps closed eyes when there is laughter, and not otherwise.
  const cull = (): Shot[] => {
    const out: Shot[] = []
    const add = (count: number, flaws: string[], assets: string[], kept: boolean): void => {
      for (let i = 0; i < count; i++) out.push(shot({ decision: kept ? 'pick' : 'reject', decidedBy: 'manual', score: score({ flaws, assets }) }))
    }
    add(20, [], [], true)
    add(20, [], [], false)
    add(9, ['closed eyes'], ['laughter'], true)
    add(1, ['closed eyes'], ['laughter'], false)
    add(1, ['closed eyes'], [], true)
    add(11, ['closed eyes'], [], false)
    return out
  }
  const ledger = mergedLedger({ projects: { a: ledgerOf(cull(), 'wedding') } }, 'wedding')

  it('learns that a mistake is forgiven when a particular asset is present', () => {
    const f = forgiveness(ledger, ['closed eyes'], ['laughter'])!
    expect(f.asset).toBe('laughter')
    expect(f.factor).toBeGreaterThan(0.9)
  })
  it('and that it is not forgiven without it', () => {
    const f = forgiveness(ledger, ['closed eyes'], [])!
    expect(f.asset).toBeNull()
    expect(f.factor).toBeLessThan(0.95)
    expect(forgiveness(ledger, ['closed eyes'], ['a rare emotion'])!.factor).toBe(f.factor)
  })
  it('says nothing about a mistake it has no evidence for', () => {
    expect(forgiveness(ledger, ['very dark'], ['laughter'])).toBeNull()
  })
  it('learns which assets are kept more often than frames in general', () => {
    expect(assetLift(ledger, 'laughter')!.lift).toBeGreaterThan(0.15)
    expect(assetLift(ledger, 'never seen')).toBeNull()
  })
  it('counts another style\'s decisions for less, and can leave a project out', () => {
    const other = mergedLedger({ projects: { a: ledgerOf(cull(), 'wedding') } }, 'larp')
    expect(other.all.n).toBeCloseTo(ledger.all.n * 0.4)
    expect(mergedLedger({ projects: { a: ledgerOf(cull(), 'wedding') } }, 'wedding', 'a').all.n).toBe(0)
  })
})

describe('the record with Claude', () => {
  const read = (moment: number, what: string): Shot['read'] => ({ beat: 'Other', moment, gem: false, note: '', what })
  const shots = [
    shot({ read: read(8, 'the couple laughing'), decision: 'pick', decidedBy: 'manual' }),
    shot({ read: read(8, 'a posed group'), decision: 'reject', decidedBy: 'manual' }),
    shot({ read: read(3, 'a blurred hand on a shoulder'), decision: 'pick', decidedBy: 'manual' }),
    shot({ read: read(8, 'the toast'), decision: 'pick', decidedBy: 'accepted' }),
    shot({ read: read(5, 'a guest'), decision: 'reject', decidedBy: 'manual' }),
    shot({ read: read(9, 'the kiss') })
  ]
  it('says whether the photographer went with Claude or against it', () => {
    expect(shots.map(verdictOf)).toEqual(['agreed', 'disagreed', 'disagreed', 'accepted', 'open', 'open'])
  })
  it('keeps what was kept or dropped against its judgement', () => {
    const r = claudeRecord(shots)
    expect(r.agreed).toBe(2)
    expect(r.disagreed).toBe(2)
    expect(r.keptAnyway[0]).toContain('blurred hand')
    expect(r.droppedAnyway[0]).toContain('posed group')
  })
  it('tells Claude what has been learned and chosen before its next assessment', () => {
    let k = emptyKnowledge()
    k = absorb(k, 'p', [...shots, ...shots, ...shots], 'wedding')
    const text = briefing({ knowledge: k, style: 'wedding', tendencies: ['closeness between people'], shots })
    expect(text).toContain('closeness between people')
    expect(text).toContain('against it 6 times')
    expect(text).toContain('a blurred hand on a shoulder')
    expect(text).toContain('kept 3 and rejected 2')
  })
  it('says nothing when there is nothing to say', () => {
    expect(briefing({ knowledge: emptyKnowledge(), style: '', tendencies: [], shots: [] })).toBe('')
  })
})

describe('people', () => {
  const idA = Array.from({ length: 48 }, (_, i) => (i % 2 ? 60 : -40))
  const idB = Array.from({ length: 48 }, (_, i) => (i % 3 ? -50 : 70))
  const noisy = (id: number[]): number[] => id.map((v) => v + Math.round((Math.random() - 0.5) * 16))
  const withFaces = (...ids: number[][]): Shot => shot({ analysis: analysis({ faces: ids.map((id, i) => face({ x: 0.1 + i * 0.3, id: noisy(id), wear: id === idA ? [30, 20, 10, 240, 240, 240] : [200, 180, 120, 20, 20, 30] })) }) })

  it('finds the same two people across frames', () => {
    const shots = [withFaces(idA, idB), withFaces(idB), withFaces(idA), withFaces(idB, idA)]
    const found = assignPeople(shots, [])
    expect(found.people).toHaveLength(2)
    const [a, b] = found.shots[0].people!
    expect(a).not.toBe(b)
    expect(found.shots[3].people).toEqual([b, a])
    expect(likeness(shots[0].analysis!.faces[0], shots[2].analysis!.faces[0])).toBeGreaterThan(likeness(shots[0].analysis!.faces[0], shots[1].analysis!.faces[0]))
  })
  it('drops someone who appears once, unless named', () => {
    const idC = Array.from({ length: 48 }, (_, i) => (i % 5 ? 30 : -90))
    const found = assignPeople([withFaces(idA), withFaces(idA), withFaces(idC)], [])
    expect(found.people).toHaveLength(1)
    expect(found.shots[2].people).toEqual([null])
  })
  it('keeps a hand-made assignment and marks key people', () => {
    const shots = [withFaces(idA), withFaces(idA), withFaces(idB), withFaces(idB)]
    const first = assignPeople(shots, [])
    const bride = first.people[0]
    const people = first.people.map((p) => (p === bride ? { ...p, name: 'bride', key: true } : p))
    expect(keyPeopleIn(first.shots[0], people)).toEqual([{ name: 'bride', face: 0 }])
    expect(keyPeopleIn(first.shots[2], people)).toEqual([])
    const merged = mergePeople(first.shots, people, first.people[1].id, bride.id)
    expect(merged.people).toHaveLength(1)
    expect(merged.shots.every((s) => s.people![0] === bride.id)).toBe(true)
  })
  it('joins any number of people into one, one after another, keeping the key mark and everyone’s faces', () => {
    const idC = Array.from({ length: 48 }, (_, i) => (i % 5 ? 30 : -90))
    const shots = [withFaces(idA), withFaces(idA), withFaces(idB), withFaces(idB), withFaces(idC), withFaces(idC)]
    const first = assignPeople(shots, [])
    expect(first.people).toHaveLength(3)
    const [a, b, c] = first.people
    const people = first.people.map((p) => (p === c ? { ...p, key: true } : p))
    let joined = { shots: first.shots, people }
    for (const from of [b.id, c.id]) joined = mergePeople(joined.shots, joined.people, from, a.id)
    expect(joined.people).toHaveLength(1)
    expect(joined.people[0].id).toBe(a.id)
    expect(joined.people[0].key).toBe(true)
    expect(joined.people[0].faces.length).toBe(a.faces.length + b.faces.length + c.faces.length)
    expect(joined.shots.every((s) => s.people![0] === a.id)).toBe(true)
  })
  it('joining a person with itself changes nothing', () => {
    const first = assignPeople([withFaces(idA), withFaces(idA)], [])
    const same = mergePeople(first.shots, first.people, first.people[0].id, first.people[0].id)
    expect(same.people).toBe(first.people)
  })
})

describe('re-estimating a culled project', () => {
  const stack = (id: number, frames: Partial<Shot>[]): Shot[] => frames.map((f) => shot({ stackId: id, ...f }))
  // Three moments: in two the photographer kept a frame the app had suggested rejecting.
  const decided = [
    ...stack(1, [{ id: 'a1', decision: 'pick', decidedBy: 'manual', suggestedThen: 'reject' }, { id: 'a2', decision: 'reject', decidedBy: 'manual', suggestedThen: 'pick' }]),
    ...stack(2, [{ id: 'b1', decision: 'pick', decidedBy: 'manual', suggestedThen: 'reject' }, { id: 'b2', decision: 'reject', decidedBy: 'manual', suggestedThen: 'pick' }]),
    ...stack(3, [{ id: 'c1', decision: 'pick', decidedBy: 'manual', suggestedThen: 'pick' }, { id: 'c2', decision: 'reject', decidedBy: 'manual', suggestedThen: 'reject' }]),
    ...stack(4, [{ id: 'd1', decision: 'reject', decidedBy: 'manual', suggestedThen: 'pick' }, { id: 'd2', decision: 'reject', decidedBy: 'manual', suggestedThen: 'reject' }])
  ]
  const now = (pick: string[]): Shot[] => decided.map((s) => ({ ...s, suggestion: pick.includes(s.id) ? ('pick' as const) : ('reject' as const) }))

  it('measures how many of the photographer\'s calls the app makes, then and now', () => {
    const e = estimateOf(decided, now(['a1', 'b2', 'c1']))
    // Then: only moment 3 of the three with a keeper, and one of the two frames of moment 4.
    expect(e.then).toBeCloseTo(2 / 5)
    // Now: moments 1 and 3, and both frames of moment 4.
    expect(e.now).toBeCloseTo(4 / 5)
    expect(e.moments).toBe(5)
  })
  it('ignores decisions that only accepted a suggestion', () => {
    const accepted = decided.map((s) => ({ ...s, decidedBy: 'accepted' as const }))
    expect(estimateOf(accepted, now(['a1'])).moments).toBe(0)
  })
  it('turns up moments nothing was kept from, and picks it would now question', () => {
    const r = relookOf(now(['a2', 'd1']))
    expect(r.missed).toEqual(['d1'])
    expect(r.doubted).toEqual(['a1', 'b1', 'c1'])
  })
})

describe('the ledger in the cull', () => {
  // Two frames of one moment: one clean, one with closed eyes.
  const frames = (): Shot[] => [
    shot({ id: 'open', stackId: 900, sceneId: 1, analysis: analysis(), score: undefined }),
    shot({ id: 'closed', stackId: 900, sceneId: 1, analysis: analysis({ faces: [face({ blink: 0.95 })] }), score: undefined })
  ]
  const history = (keptWithClosedEyes: number): Shot[] => {
    const out: Shot[] = []
    for (let i = 0; i < 30; i++) out.push(shot({ decision: i % 2 ? 'pick' : 'reject', decidedBy: 'manual', score: score({ flaws: [], assets: [] }) }))
    for (let i = 0; i < 10; i++) out.push(shot({ decision: i < keptWithClosedEyes ? 'pick' : 'reject', decidedBy: 'manual', score: score({ flaws: ['closed eyes'], assets: [] }) }))
    return out
  }
  const cull = (kept: number): Shot => scoreAndSuggest(frames(), { genre: 'portrait', balance: 0.5, ledger: mergedLedger({ projects: { a: ledgerOf(history(kept), 's') } }, 's') }).find((s) => s.id === 'closed')!

  it('files what is wrong with a frame and what it brings', () => {
    const s = scoreAndSuggest(frames(), { genre: 'portrait', balance: 0.5 }).find((x) => x.id === 'closed')!
    expect(s.score!.flaws).toEqual(['closed eyes'])
    expect(s.score!.happening).toContain('One person')
    expect(s.suggestion).toBe('reject')
  })
  it('stops rejecting a mistake the photographer has shown they forgive', () => {
    const s = cull(9)
    expect(s.score!.gem).toBe(true)
    expect(s.suggestion).toBe('alternate')
    expect(s.score!.tradeoff).toContain('kept 9 of 10 frames with closed eyes')
  })
  it('and keeps rejecting one they do not', () => {
    const s = cull(1)
    expect(s.score!.gem).toBe(false)
    expect(s.suggestion).toBe('reject')
    expect(s.score!.tradeoff).toContain('only 1 of 10')
  })
})

describe('reasons for rejecting', () => {
  // Frames rejected for an awkward pose share a gesture; the rest do not.
  const awkward = (): Analysis => analysis({ bodies: [{ x: 0.3, y: 0.1, w: 0.4, h: 0.8, g: [0, 0, 0, 0, 0, 90, 0, 0, 80, 0, 0, 0, 0, 0, 0, 0] }] })
  const plain = (): Analysis => analysis({ bodies: [{ x: 0.3, y: 0.1, w: 0.4, h: 0.8, g: new Array(16).fill(0) }] })
  const shots = (): Shot[] => [
    ...Array.from({ length: 6 }, () => shot({ analysis: awkward(), decision: 'reject', why: ['awkward pose'] })),
    ...Array.from({ length: 12 }, () => shot({ analysis: plain(), decision: 'pick' })),
    shot({ analysis: plain(), decision: 'reject', why: ['a better take exists'] })
  ]
  it('learns what a reason looks like, and recognises it in a new frame', () => {
    const r = absorbReasons(emptyReasons(), 'p', shots())
    expect(r.tags.map((t) => t.name)).toEqual(['awkward pose'])
    const c = reasonConcepts(r)
    expect(tagDirections(c).map((d) => d.name)).toEqual(['awkward pose'])
  })
  it('marks a frame that looks like those down, with a note', () => {
    const r = reasonConcepts(absorbReasons(emptyReasons(), 'p', shots()))
    const fresh = [shot({ id: 'new-awkward', stackId: 990, analysis: awkward(), score: undefined }), shot({ id: 'new-plain', stackId: 991, analysis: plain(), score: undefined })]
    const out = scoreAndSuggest(fresh, { genre: 'portrait', balance: 0.5, reasons: { store: r } })
    expect(out[0].score!.flaws).toContain('looks like: awkward pose')
    expect(out[0].score!.notes.join(' ')).toContain('rejected for awkward pose')
    expect(out[1].score!.flaws).not.toContain('looks like: awkward pose')
  })
  it('rebuilds a project\'s reasons when they change', () => {
    const once = absorbReasons(emptyReasons(), 'p', shots())
    const again = absorbReasons(once, 'p', shots().map((s) => ({ ...s, why: undefined })))
    expect(again.tags).toEqual([])
  })
})

describe('removing what was learned', () => {
  const l = mergedLedger(
    {
      projects: {
        a: ledgerOf(
          [
            ...Array.from({ length: 20 }, (_, i) => shot({ decision: i % 2 ? 'pick' : 'reject', decidedBy: 'manual', score: score({ flaws: [], assets: [] }) })),
            ...Array.from({ length: 6 }, () => shot({ decision: 'pick', decidedBy: 'manual', score: score({ flaws: ['closed eyes'], assets: ['laughter'] }) }))
          ],
          's'
        )
      }
    },
    's'
  )
  it('lists each mistake, trade-off and asset', () => {
    expect(ledgerEntries(l).map((e) => e.key).sort()).toEqual(['asset:laughter', 'flaw:closed eyes', 'trade:closed eyes|laughter'])
  })
  it('leaves out what was switched off', () => {
    expect(forgiveness(withoutExcluded(l, ['trade:closed eyes|laughter']), ['closed eyes'], ['laughter'])!.asset).toBeNull()
    expect(assetLift(withoutExcluded(l, ['asset:laughter']), 'laughter')).toBeNull()
    expect(withoutExcluded(l, ['flaw:closed eyes']).flaws['closed eyes']).toBeUndefined()
  })
  it('trains the taste model without a measurement that was ruled out', () => {
    const i = FEATURES.findIndex((f) => f.key === 'focus')
    const examples = Array.from({ length: 80 }, (_, k) => {
      const x = new Array(FEATURES.length).fill(0)
      x[0] = 1
      x[i] = k % 2
      return { x, y: (k % 2) as 0 | 1, w: 1, stack: k, h: 50 }
    })
    const data = { version: 2, blindBursts: false, projects: { a: { genre: 'portrait' as const, updatedAt: 1, examples } } }
    expect(Math.abs(learnTaste(data, 'portrait').model.weights[i])).toBeGreaterThan(0.5)
    expect(learnTaste({ ...data, ignored: ['focus'] }, 'portrait').model.weights[i]).toBe(0)
  })
})

describe('updates', () => {
  it('compares versions numerically', () => {
    expect(newer('v0.2.14', '0.2.9')).toBe(true)
    expect(newer('0.2.9', '0.2.14')).toBe(false)
    expect(newer('0.3.0', '0.2.99')).toBe(true)
    expect(newer('0.2.5', '0.2.5')).toBe(false)
  })
})

describe('learning from corrections to who is who', () => {
  const vec = (seed: number): number[] => Array.from({ length: 48 }, (_, i) => Math.round(Math.sin(seed * 12.9898 + i * 78.233) * 90))
  const near = (id: number[], n: number): number[] => id.map((v, i) => v + Math.round(Math.sin(n * 3.1 + i) * 14))
  const wear = [30, 20, 10, 240, 240, 240]
  const face = (id: number[]): FaceInfo => face0({ id, wear })
  const face0 = (over: Partial<FaceInfo>): FaceInfo => ({ x: 0.3, y: 0.2, w: 0.2, h: 0.3, blink: 0, smile: 0, sharpness: 100, skinHue: 20, skinSat: 0.3, ...over })
  const frame = (...ids: number[][]): Shot => shot({ analysis: analysis({ faces: ids.map((id, i) => ({ ...face(id), x: 0.1 + i * 0.3 })) }) })
  const A = vec(1)

  it('takes a face out of a person, and keeps similar faces away from them', () => {
    const shots = [frame(near(A, 1)), frame(near(A, 2)), frame(near(A, 3))]
    const first = assignPeople(shots, [])
    const person = first.people[0]
    const odd = { id: near(A, 3), wear }
    const after = removeFromPerson({ ...person, faces: [...person.faces, odd.id], wear: [...person.wear, wear] }, odd)
    expect(after.faces.length).toBe(person.faces.length)
    expect(after.not).toHaveLength(1)
    // A new frame that looks like the removed face is no longer put with this person.
    const again = assignPeople([frame(near(A, 3))], [{ ...after, name: 'her' }])
    expect(again.shots[0].people![0]).not.toBe(person.id)
    // Without the correction it would have been.
    const without = assignPeople([frame(near(A, 3))], [{ ...person, name: 'her' }])
    expect(without.shots[0].people![0]).toBe(person.id)
  })

  it('turns merges and removals into judgements about pairs of faces', () => {
    const person = { id: 'p', name: '', key: false, faces: [vec(2), vec(2).map((v) => v + 3)], wear: [wear, wear] }
    expect(judge({ id: vec(2), wear }, person, true)).toHaveLength(2)
    expect(judge({ id: vec(2), wear }, person, true)[0].face).toBeGreaterThan(0.95)
    expect(addJudgements(undefined, [{ face: 0.123456, wear: 0.5, same: true }])[0].face).toBe(0.123)
  })

  // The photographer's people look alike only a little (face .6): the standard settings call them different.
  const jitter = (i: number): number => Math.sin(i * 7.7) * 0.05
  const corrections = (n: number): Judgement[] =>
    Array.from({ length: n }, (_, i) => (i % 2 ? { face: 0.62 + jitter(i), wear: 0.55 + jitter(i + 1), same: true } : { face: 0.3 + jitter(i), wear: 0.4 + jitter(i + 2), same: false }))

  it('does nothing with too few corrections', () => {
    const r = learnTuning(corrections(8))
    expect(r.used).toBe(false)
    expect(r.tuning).toEqual(DEFAULT_TUNING)
  })
  it('fits how alike faces must be, and uses it when it does better on corrections held back', () => {
    const r = learnTuning(corrections(120))
    expect(r.tested).toBeGreaterThan(10)
    expect(r.defaults).toBeLessThan(0.7)
    expect(r.fitted).toBeGreaterThan(0.95)
    expect(r.used).toBe(true)
    expect(r.tuning.threshold).toBeLessThan(0.6)
    // The new setting says what the corrections said.
    expect(likeness({ id: vec(5), wear }, { id: near(vec(5), 1), wear }, r.tuning)).toBeGreaterThan(r.tuning.threshold)
  })
  it('keeps the standard settings when they already do as well', () => {
    const fine: Judgement[] = Array.from({ length: 120 }, (_, i) => (i % 2 ? { face: 0.95 + jitter(i) / 5, wear: 0.9, same: true } : { face: 0.2 + jitter(i), wear: 0.3, same: false }))
    const r = learnTuning(fine)
    expect(r.used).toBe(false)
    expect(r.tuning).toEqual(DEFAULT_TUNING)
  })
})
