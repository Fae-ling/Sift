import { create } from 'zustand'
import {
  emptyBrief,
  IMAGE_EXTENSIONS,
  styleCacheId,
  type Analysis,
  type Estimate,
  type Person,
  type Learned,
  type Style,
  type Decision,
  type Genre,
  type Project,
  type ProjectSummary,
  type Settings,
  type Shot
} from '@shared/types'
import { DEFAULT_BALANCE, STORY_PLANS } from '@shared/storyPlans'
import { groupShots } from './analysis/grouping'
import { emptyLearning, examplesOf, FEATURE_VERSION, isBlindBurst, learn as learnTaste, trimmed, type Learned as Taste, type LearningData } from './analysis/learner'
import { ingestShot, previewUrl } from './analysis/pipeline'
import { deriveLook, lookStats } from './analysis/look'
import { loadOriented, PREVIEW_EDGE, resized, rgba } from './analysis/image'
import { metricsOf } from './analysis/diagnose'
import { analyse } from './analysis/reading'
import { scoreAndSuggest, tasteOf, triage, type ScoreOptions, type TriageKind } from './analysis/scoring'
export { triage, type TriageKind }
import { addSamples, addToHouseLook, emptyTraining, limitsFrom, TRAINING_VERSION, type Training, type TrainingEvent } from './analysis/training'
import { emptyEmotions, EMOTION_VERSION, dismissPointer, forgetEmotion, namePointer, notice, readEmotion, teach as teachFace, toCues, centroid, type EmotionStore } from './analysis/emotion'
import { buildProfile, emotionLifts, emotionWeights, feelOf, mergeLifts, mergeProfiles, newStyle, profileFacts, STARTER_STYLES, styleNotes, upgradeStyle } from './analysis/style'
import type { StyleProfile } from '@shared/types'
import { emptyGestures, forgetGesture, GESTURE_VERSION, gestureCentroid, readGesture, teachGesture, type GestureStore } from './analysis/gesture'
import { absorb, addNote, briefing, cleanTag, emptyKnowledge, emptyReasons, KNOWLEDGE_VERSION, learnTags, mergedLedger, READ_WEIGHT, reasonConcepts, sceneVector, tagDirections, vocabulary, withoutExcluded, type Knowledge, type Note, type ProjectLedger } from './analysis/knowledge'
import { appearances, assignPeople, mergePeople, namesIn } from './analysis/people'
import { estimateOf, relookOf, type Relook } from './analysis/estimate'
import { faceThumb } from './analysis/pipeline'
import { FEATURES, tendencies } from './analysis/learner'

type ViewBase = 'projects' | 'profiles' | 'emotions' | 'training' | 'look' | 'diagnose' | 'brief' | 'import' | 'cull' | 'story' | 'export' | 'learn' | 'settings'
export type View = ViewBase | 'people' | 'overview' | 'taste' | 'gestures' | 'words' | 'reasons' | 'claude'
export type Filter = 'all' | 'suggested' | 'undecided' | 'picks' | 'rejects' | 'warnings' | 'gems' | 'unkept' | 'must' | 'relook' | 'key'

interface IngestState {
  running: boolean
  done: number
  total: number
  failed: number
  startedAt: number
}

/** A frame's decision and rating before a change, so the change can be undone. */
interface Before {
  id: string
  decision: Decision
  rating: number
}

interface ReadState {
  running: boolean
  done: number
  total: number
}

/** Frames sent per request to the editor's read: enough context to compare, small enough to stay sharp. */
const READ_CHUNK = 40
/** Rough tokens per frame for the read: one small thumbnail and a label in, one short entry out. */
export const READ_TOKENS = { inPerFrame: 180, outPerFrame: 90, inPerChunk: 900, outPerChunk: 1200, chunk: READ_CHUNK }

const errorText = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The frames worth showing to the editor's read: for each moment its strongest
 * frame, its most expressive frame, and any flawed frame that might be a gem.
 * Sending every frame of every burst would cost several times more for little gain.
 */
export function readCandidates(shots: Shot[]): Shot[] {
  const stacks = new Map<number, Shot[]>()
  for (const s of shots) if (s.analysis && s.score) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
  const chosen = new Set<string>()
  for (const stack of stacks.values()) {
    const by = (f: (s: Shot) => number): Shot => [...stack].sort((a, b) => f(b) - f(a))[0]
    chosen.add(by((s) => s.score!.overall).id)
    chosen.add(by((s) => s.score!.moment ?? 0).id)
    const flawed = stack.filter((s) => s.score!.warnings.some((w) => w === 'blink' || w === 'soft' || w === 'soft-face'))
    if (flawed.length) chosen.add(by((s) => (flawed.includes(s) ? (s.score!.moment ?? 50) : -1)).id)
    for (const s of stack) if (s.decision === 'pick') chosen.add(s.id)
  }
  return shots.filter((s) => chosen.has(s.id) && !s.read)
}

interface State {
  view: View
  summaries: ProjectSummary[]
  project: Project | null
  selectedId: string | null
  filter: Filter
  settings: Settings
  ingest: IngestState
  reading: ReadState
  learned: Learned
  /** Progress of a reference gallery being analysed. */
  learning: { running: boolean; done: number; total: number }
  toast: string | null
  /** Stored examples of the photographer's decisions, across projects. */
  tasteData: LearningData
  /** The taste model trained from them, with its self-check. null until there is something to learn from. */
  taste: Taste | null
  /** What has been learned from photographs provided for training. */
  training: Training
  /** Progress of a training run. */
  teaching: { running: boolean; done: number; total: number; label: string }
  /** Only frames of this chapter are shown in Cull; null shows every chapter. */
  chapter: string | null
  /** Decisions that can be undone and redone: each entry is what the changed frames were before. */
  undoStack: Before[][]
  redoStack: Before[][]

  setView(view: View): void
  setFilter(filter: Filter): void
  select(id: string | null): void
  notify(message: string | null): void
  refreshProjects(): Promise<void>
  createProject(name: string, styleId: string): Promise<void>
  openProject(id: string): Promise<void>
  closeProject(): void
  deleteProject(id: string): Promise<void>
  update(fn: (p: Project) => Project): void
  updateShot(id: string, patch: Partial<Shot>): void
  decide(ids: string[], decision: Decision): void
  acceptSuggestions(ids?: string[]): void
  importFolder(folder: string): Promise<void>
  cancelIngest(): void
  regroup(sceneGapSec?: number): void
  setClockOffset(body: string, seconds: number): void
  setChapter(chapter: string | null): void
  setRating(id: string, rating: number): void
  undo(): void
  redo(): void
  loadLearning(): Promise<void>
  /** What the app knows about emotions: concepts, their examples, and unnamed expressions waiting for a name. */
  emotions: EmotionStore
  loadEmotions(): Promise<void>
  /** Teaches that a face shows a named emotion (creating the emotion if new), then rescoring the open project. */
  teachEmotion(name: string, shapes: number[], thumb?: string, source?: 'you' | 'claude', about?: { description?: string; valence?: number; arousal?: number }): void
  namePointerAs(pointerId: string, name: string, source?: 'you' | 'claude', about?: { description?: string; valence?: number; arousal?: number }): void
  dropPointer(pointerId: string): void
  forgetEmotionNamed(name: string): void
  /** Says which chapter of the story a whole scene belongs to. */
  setSceneChapter(sceneId: number, chapter: string | null): void
  /** Rejects, in one undoable step, the kinds of frame chosen. Returns how many. */
  applyTriage(kinds: TriageKind[]): number
  /** Reads the composition of the strongest frames of each moment, in the background. */
  deepRead(): Promise<void>
  cancelDeepRead(): void
  deep: { running: boolean; done: number; total: number }
  setFastImport(on: boolean): void
  /** What the app knows about gestures. */
  gestures: GestureStore
  /** What it has learned from Claude's descriptions, from mistakes weighed against assets, and its record with Claude. */
  knowledge: Knowledge
  loadKnowledge(): Promise<void>
  /** Teaches that a body (its stored measurements) shows a named gesture. */
  teachGestureNamed(name: string, g: number[], source?: 'you' | 'claude'): void
  forgetGestureNamed(name: string): void
  /** Says, in the photographer's own words, what is happening in a frame. */
  setTags(shotId: string, tags: string[]): void
  forgetTag(name: string): void
  /** Keeps a piece of Claude's advice for later assessments. */
  remember(note: Omit<Note, 'at'>): void
  /** Tells the people of the open shoot apart (again). */
  findPeople(): Promise<void>
  editPerson(id: string, patch: Partial<Pick<Person, 'name' | 'key'>>): void
  mergePerson(fromId: string, intoId: string): void
  /** Says who a face is: an existing person, 'new' for someone not listed yet, or null for nobody in particular. */
  setFacePerson(shotId: string, face: number, personId: string | 'new' | null): void
  /** Frames chosen together in Cull (Ctrl- or Shift-click), to decide in one go. */
  marked: string[]
  setMarked(ids: string[]): void
  /** Says why frames were rejected. Reasons replace any given before. */
  setWhy(ids: string[], why: string[]): void
  /** Frames just rejected, waiting for a reason (the reason row is showing). */
  asking: string[] | null
  setAsking(ids: string[] | null): void
  setAskWhy(on: boolean): Promise<void>
  /** Imports a past shoot as a project, takes the decisions from its ratings or delivered files, learns from them. */
  learnFromPastShoot(input: { folder: string; name: string; styleId: string; from: { stars: number } | { delivered: string }; fast: boolean }): Promise<number>
  /** Puts the open project away without switching view (for the guide and the workshop). */
  putAway(): Promise<void>
  /** Remove or rule out something learned. */
  forgetEmotionExample(name: string, at: number): void
  forgetGestureExamples(name: string): void
  forgetReason(name: string): void
  forgetNote(at: number): void
  forgetClaudeRecord(projectId: string): void
  setExcluded(key: string, excluded: boolean): void
  setIgnoredMeasurement(key: string, ignored: boolean): void
  forgetProjectDecisions(projectId: string): void
  /** Reloads a store another window changed, without saving anything back. */
  reloadChanged(name: string): Promise<void>
  /** Frames a re-estimate of the open project turned up. */
  relook: Relook | null
  /** Scores the open project again with what the app knows today, minus what it learned here. */
  reestimate(): Estimate | null
  /** Does the same for every project, and rebuilds everything learned from their decisions. */
  reestimateAll(): Promise<void>
  estimating: { running: boolean; done: number; total: number }
  loadTraining(): Promise<void>
  /** Learns the photographer's own norms from a folder of finished photographs. */
  trainFinished(folder: string): Promise<void>
  /** Learns their look from unedited frames and the finished versions with the same file names. */
  trainLook(beforeFolder: string, afterFolder: string): Promise<void>
  /** Takes the open project's decisions from ratings given in Lightroom. Returns how many frames were decided. */
  teachFromRatings(minStars: number): Promise<number>
  /** Takes the open project's decisions from a folder of delivered files (matched by name). */
  teachFromDelivered(folder: string): Promise<number>
  giveFeedback(topic: string, agree: boolean): void
  resetTraining(area: 'norms' | 'houseLook' | 'feedback'): void
  /** Retrains the taste model from every stored decision plus the open project's. */
  relearn(): void
  setBlindBursts(on: boolean): void
  forgetLearning(): Promise<void>
  setBalance(balance: number): void
  setGenre(genre: Genre): void
  loadLearned(): Promise<void>
  createProfile(name: string, family: Genre, feeling: string, tags: string[]): Promise<string>
  editProfile(styleId: string, patch: Partial<Style>): Promise<void>
  addGallery(styleId: string, sourceName: string, folder: string): Promise<void>
  rememberPicks(styleId: string): Promise<void>
  distil(styleId: string): Promise<void>
  removeStyle(styleId: string): Promise<void>
  chooseStyle(styleId: string | null): void
  readShoot(): Promise<void>
  cancelRead(): void
  loadSettings(): Promise<void>
  saveSettings(patch: Parameters<StudioSettingsSet>[0]): Promise<void>
}

type StudioSettingsSet = Window['studio']['settings']['set']

const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

let saveTimer: ReturnType<typeof setTimeout> | undefined
let cancelRequested = false
let cancelRead = false

/** True when measurements changed since the last save, so the large analysis file must be rewritten too. */
let analysisDirty = false

function scheduleSave(project: Project): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const dirty = analysisDirty
    analysisDirty = false
    void window.studio.projects.save(project, dirty)
  }, 600)
}

/** At most this many frames of a gallery are kept as samples and shown to Claude for the essence. */
const MAX_SAMPLES = 36

/** Leaves out what was learned from one project, to ask what the app would say without it. */
interface Without {
  projectId: string
  taste: Taste | null
}

/** Everything the scoring needs to know about a project, including its culling profile. */
function scoring(p: Pick<Project, 'genre' | 'balance' | 'styleIds' | 'storyPlan' | 'people'>, learned: Learned, without?: Without): ScoreOptions {
  const active = learned.styles.filter((s) => p.styleIds.includes(s.id))
  const taste = without ? without.taste : currentTaste
  return {
    gestures: { store: currentGestures, centroids: gestureCentroids() },
    concepts: { store: currentKnowledge.concepts, directions: directionsNow() },
    reasons: reasonsNow(),
    ledger: ledgerFor(p.styleIds[0] ?? '', without?.projectId),
    people: p.people,
    emotions: { store: currentEmotions, weights: emotionWeights(active[0]) },
    must: new Set(p.storyPlan.filter((c) => c.must).map((c) => c.name)),
    genre: p.genre,
    balance: p.balance,
    style: mergeProfiles(active.flatMap((s) => (s.profile ? [s.profile] : []))),
    feel: active.length ? feelOf(active.flatMap((s) => s.tags)) : undefined,
    learned: taste ? { model: taste.model, trust: taste.trust } : undefined
  }
}

/** The gesture machine and the knowledge in use. Kept beside the store so the scoring helper can reach them. */
let currentGestures: GestureStore = emptyGestures()
let currentKnowledge: Knowledge = emptyKnowledge()
let gestureCache: { store: GestureStore; list: number[][] } | null = null
function gestureCentroids(): number[][] {
  if (gestureCache?.store !== currentGestures) gestureCache = { store: currentGestures, list: currentGestures.concepts.map(gestureCentroid) }
  return gestureCache.list
}
let directionCache: { of: Knowledge['concepts']; list: ReturnType<typeof tagDirections> } | null = null
function directionsNow(): ReturnType<typeof tagDirections> {
  if (directionCache?.of !== currentKnowledge.concepts) directionCache = { of: currentKnowledge.concepts, list: tagDirections(currentKnowledge.concepts) }
  return directionCache.list
}
let ledgerCache: { of: Knowledge['ledger']; excluded: string[]; key: string; merged: ProjectLedger } | null = null
function ledgerFor(style: string, except?: string): ProjectLedger {
  const key = `${style}|${except ?? ''}`
  const k = currentKnowledge
  if (ledgerCache?.of !== k.ledger || ledgerCache.excluded !== k.excluded || ledgerCache.key !== key)
    ledgerCache = { of: k.ledger, excluded: k.excluded, key, merged: withoutExcluded(mergedLedger(k.ledger, style, except), k.excluded ?? []) }
  return ledgerCache.merged
}
let reasonCache: { of: Knowledge['reasons']; value: { store: ReturnType<typeof reasonConcepts>; directions: ReturnType<typeof tagDirections> } } | null = null
function reasonsNow(): { store: ReturnType<typeof reasonConcepts>; directions: ReturnType<typeof tagDirections> } {
  const r = currentKnowledge.reasons ?? emptyReasons()
  if (reasonCache?.of !== r) {
    const store = reasonConcepts(r)
    reasonCache = { of: r, value: { store, directions: tagDirections(store) } }
  }
  return reasonCache.value
}

function setKnowledge(set: (p: Partial<State>) => void, knowledge: Knowledge, save = true): void {
  currentKnowledge = knowledge
  set({ knowledge })
  if (save) void window.studio.data.save('knowledge', knowledge)
}

function setGestures(set: (p: Partial<State>) => void, store: GestureStore, save = true): void {
  currentGestures = store
  set({ gestures: store })
  if (save) void window.studio.data.save('gestures', store)
}

/** What Claude is told about this photographer before an assessment. Empty when nothing has been learned yet. */
export function claudeContext(): string {
  const { project, taste } = useStore.getState()
  return briefing({
    knowledge: currentKnowledge,
    style: project?.styleIds[0] ?? '',
    tendencies: taste && taste.trust > 0 ? tendencies(taste.model, 6) : [],
    shots: project?.shots ?? [],
    people: project?.people
  })
}

/** What the app would suggest for a project today, had it never learned from that project's own decisions. */
function freshLook(project: Project, get: () => State): Shot[] {
  const learned = get().learned
  const styleId = project.styleIds[0]
  const lifts = Object.entries(learned.lifts?.[styleId] ?? {}).filter(([id]) => id !== project.id)
  const merged = lifts.reduce((acc, [, l]) => mergeLifts(acc, l), {} as Record<string, { w: number; n: number }>)
  const styles = learned.styles.map((x) => (x.id === styleId ? { ...x, emotionLift: merged } : x))
  const projects = { ...get().tasteData.projects }
  delete projects[project.id]
  const has = Object.values(projects).some((p) => p.examples.length)
  const taste = has ? learnTaste({ ...get().tasteData, projects }, project.genre) : null
  return scoreAndSuggest(project.shots, scoring(project, { ...learned, styles }, { projectId: project.id, taste }))
}

/** Gives every listed person a small picture, taken from the frame where their face is largest. */
async function picturePeople(get: () => State): Promise<void> {
  const project = get().project
  if (!project?.people?.some((p) => !p.thumb)) return
  const seen = appearances(project.shots)
  const thumbs = new Map<string, string>()
  for (const p of project.people) {
    const best = seen.get(p.id)?.largest
    if (p.thumb || !best) continue
    try {
      const bitmap = await createImageBitmap(await (await fetch(previewUrl(project.id, best.shot.id))).blob())
      thumbs.set(p.id, faceThumb(bitmap as unknown as HTMLCanvasElement, best.shot.analysis!.faces[best.face]))
    } catch {
      // A person without a picture is still a person.
    }
  }
  if (thumbs.size && get().project?.id === project.id) get().update((p) => ({ ...p, people: p.people?.map((x) => (thumbs.has(x.id) ? { ...x, thumb: thumbs.get(x.id) } : x)) }))
}

/** The emotion machine in use. Kept beside the store so the scoring helper can reach it. */
let currentEmotions: EmotionStore = emptyEmotions()
let cancelDeep = false

/** The taste model in use. Kept beside the store so the scoring helper can reach it. */
let currentTaste: Taste | null = null
/** Decisions made since the model was last retrained. */
let sinceRelearn = 0
const RELEARN_EVERY = 25

export const activeStyles = (p: Project, learned: Learned): Style[] => learned.styles.filter((s) => p.styleIds.includes(s.id))

/**
 * True while a frame's burst is being shown without a suggestion: one burst in
 * ten, until something in it has been decided. Single frames are never hidden.
 */
export function isHidden(projectId: string, shot: Shot, shots: Shot[]): boolean {
  if (!isBlindBurst(projectId, shot.stackId ?? 0)) return false
  const stack = shots.filter((s) => s.stackId === shot.stackId)
  return stack.length > 1 && stack.every((s) => s.decision === null)
}

/** Counts decisions, and retrains the taste model every so often while culling. */
function noteDecisions(get: () => State, count: number): void {
  sinceRelearn += count
  if (sinceRelearn >= RELEARN_EVERY) get().relearn()
}

/** Records the current decision and rating of the frames about to change. */
function remember(get: () => State, set: (p: Partial<State>) => void, changes: (s: Shot) => boolean): void {
  const before = (get().project?.shots ?? []).filter(changes).map((s) => ({ id: s.id, decision: s.decision, rating: s.rating }))
  if (before.length) set({ undoStack: [...get().undoStack.slice(-199), before], redoStack: [] })
}

/** Restores the newest entry of one history stack and files the present state on the other. */
function swap(get: () => State, set: (p: Partial<State>) => void, from: 'undoStack' | 'redoStack', to: 'undoStack' | 'redoStack'): void {
  const entry = get()[from].at(-1)
  if (!entry || !get().project) return
  const byId = new Map(entry.map((b) => [b.id, b]))
  const present = get().project!.shots.filter((s) => byId.has(s.id)).map((s) => ({ id: s.id, decision: s.decision, rating: s.rating }))
  get().update((p) => ({ ...p, shots: p.shots.map((s) => (byId.has(s.id) ? { ...s, decision: byId.get(s.id)!.decision, rating: byId.get(s.id)!.rating } : s)) }))
  set({ [from]: get()[from].slice(0, -1), [to]: [...get()[to], present] } as Partial<State>)
  if (entry.length === 1) set({ selectedId: entry[0].id })
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Opens any photo as an upright preview-sized canvas, through a scratch cache slot. */
async function openPreview(slot: string, path: string): Promise<HTMLCanvasElement> {
  const extracted = await window.studio.extract('train', slot, path)
  const blob = await (await fetch(`${extracted.url}?t=${Date.now()}`)).blob()
  return resized(await loadOriented(blob, extracted.applyOrientation, PREVIEW_EDGE), PREVIEW_EDGE)
}

/** Runs one training step per item, with progress; an item that fails is skipped. */
async function teach(set: (p: Partial<State>) => void, get: () => State, label: string, total: number, step: (i: number) => Promise<void>): Promise<void> {
  if (get().teaching.running) throw new Error('A training run is already in progress.')
  set({ teaching: { running: true, done: 0, total, label } })
  try {
    for (let i = 0; i < total; i++) {
      try {
        await step(i)
      } catch {
        // One unreadable file must not stop the run.
      }
      set({ teaching: { running: true, done: i + 1, total, label } })
    }
  } finally {
    set({ teaching: { running: false, done: total, total, label } })
  }
}

function saveTraining(set: (p: Partial<State>) => void, get: () => State, patch: Partial<Training>, event?: Omit<TrainingEvent, 'at'>): void {
  const training = { ...get().training, ...patch }
  if (event) training.log = [...training.log, { ...event, at: Date.now() }].slice(-60)
  set({ training })
  void window.studio.training.save(training)
}

/**
 * Records decisions the photographer made before Atelier (in Lightroom, or by
 * delivering some files and not others) on the open project, and learns from
 * them. They were made with no suggestion from this app, so they count as
 * unprompted choices. Decisions already made here are left alone.
 */
function applyPastDecisions(get: () => State, keptOf: (s: Shot) => boolean | null, name: string): number {
  let count = 0
  get().update((p) => ({
    ...p,
    shots: p.shots.map((s) => {
      const kept = keptOf(s)
      if (kept === null || s.decision !== null || !s.analysis) return s
      count++
      return { ...s, decision: kept ? ('pick' as const) : ('reject' as const), decidedBy: 'manual' as const, suggestedThen: s.suggestion, blind: true }
    })
  }))
  if (count) {
    get().relearn()
    const training = { ...get().training, log: [...get().training.log, { at: Date.now(), kind: 'decisions' as const, name, count }].slice(-60) }
    useStore.setState({ training })
    void window.studio.training.save(training)
  }
  return count
}

/** The diagnosis limits as trained so far. */
export const currentLimits = (training: Training) => limitsFrom(training)

/** Where each emotion concept sits, worked out once per change to the machine. */
let centroidCache: { store: EmotionStore; list: number[][] } | null = null
function emotionCentroids(): number[][] {
  if (centroidCache?.store !== currentEmotions) centroidCache = { store: currentEmotions, list: currentEmotions.concepts.map(centroid) }
  return centroidCache.list
}

function setEmotions(set: (p: Partial<State>) => void, store: EmotionStore, save = true): void {
  currentEmotions = store
  set({ emotions: store })
  if (save) void window.studio.data.save('emotions', store)
}

type Get = () => State
type Set = (partial: Partial<State>) => void

async function saveStyles(get: Get, set: Set, styles: Style[]): Promise<void> {
  const learned = { ...get().learned, styles }
  set({ learned })
  await window.studio.learned.save(learned)
}

/** Works out the open project's suggestions again, after its profile changed. */
function rescore(get: Get): void {
  if (get().project) get().update((p) => ({ ...p, shots: scoreAndSuggest(p.shots, scoring(p, get().learned)) }))
}

/** Adds a batch of photographs' measurements to a profile. */
async function learn(get: Get, set: Set, styleId: string, source: Style['sources'][0], profile: StyleProfile, samples: string[]): Promise<void> {
  await saveStyles(
    get,
    set,
    get().learned.styles.map((s) =>
      s.id === styleId
        ? { ...s, sources: [...s.sources, source], profile: mergeProfiles([...(s.profile ? [s.profile] : []), profile])!, samples: [...s.samples, ...samples] }
        : s
    )
  )
  rescore(get)
}

export const useStore = create<State>((set, get) => ({
  view: 'projects',
  summaries: [],
  project: null,
  selectedId: null,
  filter: 'all',
  settings: { hasApiKey: false, model: '', guide: { step: 0, done: true }, askWhy: true },
  ingest: { running: false, done: 0, total: 0, failed: 0, startedAt: 0 },
  reading: { running: false, done: 0, total: 0 },
  learned: { styles: [], balance: {} },
  learning: { running: false, done: 0, total: 0 },
  toast: null,
  tasteData: emptyLearning(),
  taste: null,
  emotions: emptyEmotions(),
  deep: { running: false, done: 0, total: 0 },
  gestures: emptyGestures(),
  knowledge: emptyKnowledge(),
  relook: null,
  marked: [],
  asking: null,
  estimating: { running: false, done: 0, total: 0 },
  training: emptyTraining(),
  teaching: { running: false, done: 0, total: 0, label: '' },
  chapter: null,
  undoStack: [],
  redoStack: [],

  setView: (view) => set({ view }),
  setFilter: (filter) => set({ filter }),
  select: (selectedId) => set({ selectedId }),
  notify: (toast) => {
    set({ toast })
    if (toast) setTimeout(() => get().toast === toast && set({ toast: null }), 5000)
  },

  refreshProjects: async () => set({ summaries: await window.studio.projects.list() }),

  createProject: async (name, styleId) => {
    const style = get().learned.styles.find((x) => x.id === styleId)
    const genre = style?.family ?? 'other'
    const now = Date.now()
    const project: Project = {
      id: newId(),
      name,
      genre,
      createdAt: now,
      updatedAt: now,
      brief: emptyBrief(),
      folder: null,
      shots: [],
      sceneGapSec: genre === 'wedding' || genre === 'event' ? 300 : 120,
      balance: style?.balance ?? DEFAULT_BALANCE[genre],
      storyPlan: style?.chapters ?? STORY_PLANS[genre],
      readCostUsd: 0,
      styleIds: style ? [style.id] : [],
      clockOffsets: {},
      storyOrder: []
    }
    await window.studio.projects.save(project)
    set({ project, view: 'brief', selectedId: null, filter: 'all' })
  },

  openProject: async (id) => {
    const loaded = await window.studio.projects.load(id)
    // Projects saved by an earlier version have no story plan or balance yet.
    const project: Project = {
      ...loaded,
      balance: loaded.balance ?? DEFAULT_BALANCE[loaded.genre],
      storyPlan: loaded.storyPlan ?? STORY_PLANS[loaded.genre],
      readCostUsd: loaded.readCostUsd ?? 0,
      clockOffsets: loaded.clockOffsets ?? {},
      styleIds: (loaded.styleIds ?? []).filter((id) => get().learned.styles.some((s) => s.id === id))
    }
    if (loaded.balance === undefined) project.shots = scoreAndSuggest(project.shots, scoring(project, get().learned))
    const has = project.shots.length > 0
    // Open on the frames the cull would keep; everything else is one click away.
    set({ project, view: has ? 'cull' : 'brief', selectedId: null, filter: has ? 'suggested' : 'all', chapter: null, undoStack: [], redoStack: [], relook: null, marked: [], asking: null })
    // Score the project with the taste model as it stands, tuned to this kind of shoot.
    get().relearn()
  },

  closeProject: () => {
    const { project } = get()
    clearTimeout(saveTimer)
    if (project) {
      // Everything decided in this project is learned from before it closes.
      get().relearn()
      void window.studio.projects.save(get().project!).then(get().refreshProjects)
      // Carry what this project's decisions showed into the next project of the same kind.
      const fitted = tasteOf(project.shots).fittedBalance
      if (fitted !== null) {
        const learned = get().learned
        const prev = learned.balance[project.genre]
        const next = prev ? { value: (prev.value * prev.projects + fitted) / (prev.projects + 1), projects: prev.projects + 1 } : { value: fitted, projects: 1 }
        const updated = { ...learned, balance: { ...learned.balance, [project.genre]: next } }
        set({ learned: updated })
        void window.studio.learned.save(updated)
      }
    }
    cancelRequested = true
    cancelRead = true
    set({ project: null, view: 'projects', selectedId: null, reading: { running: false, done: 0, total: 0 } })
  },

  deleteProject: async (id) => {
    await window.studio.projects.remove(id)
    await get().refreshProjects()
  },

  update: (fn) => {
    const { project } = get()
    if (!project) return
    const next = { ...fn(project), updatedAt: Date.now() }
    set({ project: next })
    scheduleSave(next)
  },

  updateShot: (id, patch) =>
    get().update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),

  decide: (ids, decision) => {
    const wanted = new Set(ids)
    remember(get, set, (s) => wanted.has(s.id) && s.decision !== decision)
    const projectId = get().project?.id ?? ''
    const blindOn = get().tasteData.blindBursts
    get().update((p) => ({
      ...p,
      shots: p.shots.map((s) =>
        wanted.has(s.id)
          ? {
              ...s,
              decision,
              why: decision === 'reject' ? s.why : undefined,
              // How the choice was made decides how much it teaches.
              decidedBy: decision ? ('manual' as const) : undefined,
              suggestedThen: decision ? s.suggestion : undefined,
              blind: decision ? blindOn && isHidden(projectId, s, p.shots) : undefined
            }
          : s
      )
    }))
    noteDecisions(get, ids.length)
  },

  setRating: (id, rating) => {
    remember(get, set, (s) => s.id === id && s.rating !== rating)
    get().updateShot(id, { rating })
  },

  // Turns proposals into decisions, but never overrides a choice already made.
  acceptSuggestions: (ids) => {
    const only = ids ? new Set(ids) : null
    const project = get().project
    if (!project) return
    const blindOn = get().tasteData.blindBursts
    // Bursts shown without a suggestion are left for the photographer to decide unprompted.
    const applies = (s: Shot): boolean =>
      (!only || only.has(s.id)) &&
      s.decision === null &&
      (s.suggestion === 'pick' || s.suggestion === 'reject') &&
      !(blindOn && isHidden(project.id, s, project.shots))
    remember(get, set, applies)
    let count = 0
    get().update((p) => ({
      ...p,
      shots: p.shots.map((s) => {
        if (!applies(s)) return s
        count++
        return { ...s, decision: s.suggestion === 'pick' ? 'pick' : 'reject', decidedBy: 'accepted' as const, suggestedThen: s.suggestion, blind: undefined }
      })
    }))
    noteDecisions(get, count)
  },

  undo: () => swap(get, set, 'undoStack', 'redoStack'),
  redo: () => swap(get, set, 'redoStack', 'undoStack'),

  setChapter: (chapter) => set({ chapter }),

  setClockOffset: (body, seconds) => {
    get().update((p) => ({ ...p, clockOffsets: { ...p.clockOffsets, [body]: seconds } }))
    get().regroup()
  },

  importFolder: async (folder) => {
    const start = get().project
    if (!start || get().ingest.running) return
    const files = await window.studio.scan(folder)
    if (files.length === 0) {
      throw new Error(
        `No photos found in ${folder} or its subfolders. Atelier reads ${IMAGE_EXTENSIONS.map((e) => '.' + e.toUpperCase()).join(', ')}.`
      )
    }
    const known = new Set(start.shots.map((s) => s.path))
    const added: Shot[] = files
      .filter((f) => !known.has(f.path))
      .map((f) => ({ id: newId(), path: f.path, name: f.name, time: 0, width: 0, height: 0, decision: null, rating: 0 }))
    get().update((p) => ({ ...p, folder, shots: [...p.shots, ...added] }))

    const todo = get().project!.shots.filter((s) => !s.analysis)
    cancelRequested = false
    set({ ingest: { running: true, done: 0, total: todo.length, failed: 0, startedAt: Date.now() } })
    const projectId = start.id

    let next = 0
    let sinceRegroup = 0
    const worker = async (): Promise<void> => {
      while (next < todo.length && !cancelRequested && get().project?.id === projectId) {
        const shot = todo[next++]
        // Only the measured fields are written back, so a decision made meanwhile survives.
        let result: Partial<Shot>
        try {
          const ingested = await ingestShot(projectId, shot, {
            fast: get().project?.fastImport,
            // Keep a picture of faces whose strong expression the app cannot name, to ask about later.
            wantFace: (shapes) => {
              const r = readEmotion(toCues(shapes), currentEmotions, emotionCentroids())
              return r.name === null && r.intensity >= 0.35
            }
          })
          result = ingested.patch
          analysisDirty = true
          if (ingested.faces.length) {
            let store = get().emotions
            for (const f of ingested.faces) store = notice(store, toCues(f.shapes), f.thumb)
            setEmotions(set, store, false)
          }
        } catch (err) {
          result = { error: (err as Error).message }
        }
        if (get().project?.id !== projectId) return
        get().updateShot(shot.id, result)
        set((s) => ({ ingest: { ...s.ingest, done: s.ingest.done + 1, failed: s.ingest.failed + (result.error ? 1 : 0) } }))
        // Regroup now and then so results appear while the import is still running.
        if (++sinceRegroup >= 12 || get().ingest.done === todo.length) {
          sinceRegroup = 0
          get().regroup()
        }
      }
    }
    // The pixel work shares one thread; a few parallel workers keep ExifTool busy meanwhile.
    await Promise.all([worker(), worker(), worker()])
    if (get().project?.id === projectId) {
      get().regroup()
      set((s) => ({ ingest: { ...s.ingest, running: false }, selectedId: s.selectedId ?? s.project?.shots[0]?.id ?? null }))
      void window.studio.data.save('emotions', get().emotions)
      // With everything measured, tell the people apart and look more closely at the frames most likely to be kept.
      await get().findPeople()
      void get().deepRead()
    }
  },

  cancelIngest: () => {
    cancelRequested = true
    set((s) => ({ ingest: { ...s.ingest, running: false } }))
  },

  regroup: (sceneGapSec) =>
    get().update((p) => {
      const gap = sceneGapSec ?? p.sceneGapSec
      return { ...p, sceneGapSec: gap, shots: scoreAndSuggest(groupShots(p.shots, gap, p.clockOffsets), scoring(p, get().learned)) }
    }),

  setBalance: (balance) =>
    get().update((p) => ({ ...p, balance, shots: scoreAndSuggest(p.shots, scoring({ ...p, balance }, get().learned)) })),

  // Changing the kind of shoot changes what the cull looks for, so suggestions are worked out again.
  setGenre: (genre) =>
    get().update((p) => {
      const balance = get().learned.balance[genre]?.value ?? DEFAULT_BALANCE[genre]
      const next = { ...p, genre, balance, storyPlan: STORY_PLANS[genre] }
      return { ...next, shots: scoreAndSuggest(p.shots, scoring(next, get().learned)) }
    }),

  loadLearned: async () => {
    let learned = await window.studio.learned.get()
    learned = { ...learned, styles: learned.styles.map(upgradeStyle) }
    if (!learned.seededStyles) {
      const have = new Set(learned.styles.map((x) => x.name))
      const starters: Style[] = STARTER_STYLES.filter((p) => !have.has(p.name)).map((p) => ({ ...p, id: newId(), createdAt: Date.now(), sources: [], profile: null, samples: [] }))
      learned = { ...learned, styles: [...starters, ...learned.styles], seeded: true, seededStyles: true }
      await window.studio.learned.save(learned)
    }
    set({ learned })
  },

  createProfile: async (name, family, feeling, tags) => {
    const style = newStyle(newId(), name, family, feeling, tags)
    await saveStyles(get, set, [...get().learned.styles, style])
    return style.id
  },

  editProfile: async (styleId, patch) => {
    await saveStyles(get, set, get().learned.styles.map((s) => (s.id === styleId ? { ...s, ...patch } : s)))
    rescore(get)
  },

  // Analyses a folder of someone's published photographs and adds what they have in
  // common to a profile. Only measurements and a few small thumbnails are kept; the
  // gallery's files are read, never copied or changed.
  addGallery: async (styleId, sourceName, folder) => {
    const target = get().learned.styles.find((s) => s.id === styleId)
    if (!target || get().learning.running) return
    const files = await window.studio.scan(folder, true)
    if (files.length === 0) throw new Error(`No images found in ${folder}.`)
    const cache = styleCacheId(styleId)
    set({ learning: { running: true, done: 0, total: files.length } })
    const analyses: Analysis[] = []
    const samples: string[] = []
    // Spread the kept samples evenly through the gallery.
    const room = Math.max(6, MAX_SAMPLES - target.samples.length)
    const every = Math.max(1, Math.floor(files.length / room))
    const batch = newId().slice(0, 6)
    try {
      for (const [i, file] of files.entries()) {
        const shotId = `${batch}_${i}`
        try {
          const { patch } = await ingestShot(cache, { id: shotId, path: file.path, name: file.name, time: 0, width: 0, height: 0, decision: null, rating: 0 })
          if (patch.analysis) {
            analyses.push(patch.analysis)
            if (i % every === 0 && samples.length < room) samples.push(shotId)
          }
        } catch {
          // An unreadable image is skipped; the rest of the gallery still counts.
        }
        set((s) => ({ learning: { ...s.learning, done: i + 1 } }))
      }
      if (analyses.length === 0) throw new Error('None of the images in that folder could be read.')
      await learn(get, set, styleId, { name: sourceName, kind: 'gallery', count: analyses.length, addedAt: Date.now() }, buildProfile(analyses), samples)
    } finally {
      set((s) => ({ learning: { ...s.learning, running: false } }))
    }
  },

  // The user's own picks from this project are added to a profile, so it keeps learning from them.
  rememberPicks: async (styleId) => {
    const project = get().project
    const picks = project?.shots.filter((s) => s.decision === 'pick' && s.analysis) ?? []
    if (!project || picks.length < 10) throw new Error('Pick at least ten frames first, so there is something to learn from.')
    await learn(get, set, styleId, { name: `My picks: ${project.name}`, kind: 'own-picks', count: picks.length, addedAt: Date.now() }, buildProfile(picks.map((s) => s.analysis!)), [])
  },

  distil: async (styleId) => {
    const style = get().learned.styles.find((s) => s.id === styleId)
    if (!style?.profile) return
    try {
      const essence = await window.studio.ai.essence({
        styleId,
        name: `${style.name} (${style.tags.join(', ')})`,
        samples: style.samples.slice(-MAX_SAMPLES),
        facts: profileFacts(style.profile).join('\n')
      })
      await saveStyles(get, set, get().learned.styles.map((s) => (s.id === styleId ? { ...s, essence, essenceCount: s.profile?.count } : s)))
    } catch (err) {
      get().notify(errorText(err))
    }
  },

  removeStyle: async (styleId) => {
    await saveStyles(get, set, get().learned.styles.filter((s) => s.id !== styleId))
    await window.studio.learned.removeSamples(styleId)
    if (get().project?.styleIds.includes(styleId)) get().chooseStyle(null)
  },

  // Choosing a style sets what the cull looks for: its chapters, its balance, the emotions it values.
  chooseStyle: (styleId) =>
    get().update((p) => {
      const style = get().learned.styles.find((x) => x.id === styleId)
      const next = style
        ? { ...p, styleIds: [style.id], genre: style.family, balance: style.balance, storyPlan: style.chapters }
        : { ...p, styleIds: [] }
      return { ...next, shots: scoreAndSuggest(p.shots, scoring(next, get().learned)) }
    }),

  readShoot: async () => {
    const start = get().project
    if (!start || get().reading.running) return
    const frames = readCandidates(start.shots)
    if (frames.length === 0) return
    cancelRead = false
    set({ reading: { running: true, done: 0, total: frames.length } })
    const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    try {
      for (let i = 0; i < frames.length && !cancelRead && get().project?.id === start.id; i += READ_CHUNK) {
        const chunk = frames.slice(i, i + READ_CHUNK)
        const project = get().project!
        const result = await window.studio.ai.read({
          projectId: project.id,
          genre: project.genre,
          brief: project.brief,
          beats: project.storyPlan,
          styleNotes: styleNotes(activeStyles(project, get().learned)),
          emotions: get().emotions.concepts.map((c) => c.name),
          gestures: get().gestures.concepts.map((c) => c.name),
          happenings: vocabulary(get().knowledge.concepts).slice(0, 60).map((t) => t.name),
          // Everything learned so far, and what has been chosen in this shoot up to this moment.
          context: claudeContext(),
          frames: chunk.map((s) => ({
            people: namesIn(s, project.people).join(', ') || undefined,
            decided: s.decision === 'pick' ? 'kept' : s.decision === 'reject' ? 'rejected' : undefined,
            shotId: s.id,
            scene: s.sceneId ?? 0,
            time: clock(s.time),
            shotType: s.analysis!.shotType,
            flaws: (s.score?.warnings ?? []).join(', ')
          }))
        })
        if (get().project?.id !== start.id) return
        // What Claude saw in a frame teaches the emotion machine about the face that led it.
        let store = get().emotions
        for (const shot of chunk) {
          const named = result.reads[shot.id]?.emotion?.trim().toLowerCase()
          const face = shot.analysis!.faces.find((f) => f.shapes && f.h >= 0.08)
          if (!named || ['calm', 'neutral', 'none', ''].includes(named) || !face || shot.analysis!.faces.filter((f) => f.h >= 0.08).length !== 1) continue
          if (readEmotion(toCues(face.shapes!), store).intensity >= 0.25) store = teachFace(store, named, toCues(face.shapes!), 'claude')
        }
        if (store !== get().emotions) setEmotions(set, store)
        // What Claude said is happening is stored with the frame's measurements, so the app learns to see it
        // by itself; the gesture it named teaches the gesture machine when one body carries the frame.
        let knowledge = get().knowledge
        let gestures = get().gestures
        for (const shot of chunk) {
          const read = result.reads[shot.id]
          if (!read) continue
          if (read.tags?.length) knowledge = { ...knowledge, concepts: learnTags(knowledge.concepts, `${project.id}:${shot.id}`, sceneVector(shot.analysis!), read.tags, 'claude', READ_WEIGHT.open) }
          const named = read.gesture ? cleanTag(read.gesture) : ''
          const moving = (shot.analysis!.bodies ?? []).filter((b) => readGesture(b.g, gestures).intensity >= 0.3)
          if (named && !['none', 'no gesture', 'still'].includes(named) && moving.length === 1) gestures = teachGesture(gestures, named, moving[0].g, 'claude')
        }
        if (knowledge !== get().knowledge) setKnowledge(set, knowledge)
        if (gestures !== get().gestures) setGestures(set, gestures)
        // Each chunk is saved as it arrives, so a pause or an error keeps what was paid for.
        get().update((p) => {
          const shots = p.shots.map((s) => (result.reads[s.id] ? { ...s, read: result.reads[s.id] } : s))
          return { ...p, readCostUsd: p.readCostUsd + result.usage.costUsd, shots: scoreAndSuggest(shots, scoring(p, get().learned)) }
        })
        set((s) => ({ reading: { ...s.reading, done: Math.min(frames.length, i + chunk.length) } }))
      }
    } catch (err) {
      get().notify(errorText(err))
    } finally {
      set((s) => ({ reading: { ...s.reading, running: false } }))
    }
  },

  cancelRead: () => {
    cancelRead = true
  },

  loadLearning: async () => {
    const stored = (await window.studio.learning.get()) as LearningData | null
    // Examples measured by an older version of the app no longer line up with the model.
    const data = stored && stored.version === FEATURE_VERSION ? stored : emptyLearning()
    // Examples stored before a measurement was added lack it; it counts as zero for them.
    for (const p of Object.values(data.projects)) for (const e of p.examples) while (e.x.length < FEATURES.length) e.x.push(0)
    set({ tasteData: data })
    get().relearn()
  },

  relearn: () => {
    sinceRelearn = 0
    const project = get().project
    let learning = get().tasteData
    if (project) {
      const examples = examplesOf(project.shots)
      const projects = { ...learning.projects }
      // The open project's examples replace its earlier ones, so a change of mind is learned too.
      if (examples.length) projects[project.id] = { genre: project.genre, updatedAt: Date.now(), examples }
      else delete projects[project.id]
      learning = trimmed({ ...learning, projects })
    }
    // What this project's decisions say about each emotion is folded into its style.
    const styleId = project?.styleIds[0]
    if (project && styleId) {
      const fresh = emotionLifts(project.shots)
      const learned = get().learned
      const lifts = { ...(learned.lifts ?? {}), [styleId]: { ...(learned.lifts?.[styleId] ?? {}), [project.id]: fresh } }
      const merged = Object.values(lifts[styleId]).reduce((acc, l) => mergeLifts(acc, l), {} as Record<string, { w: number; n: number }>)
      const updated = { ...learned, lifts, styles: learned.styles.map((x) => (x.id === styleId ? { ...x, emotionLift: merged } : x)) }
      set({ learned: updated })
      void window.studio.learned.save(updated)
    }
    // The same decisions, filed as mistakes against assets, and held against what Claude said of each frame.
    if (project) setKnowledge(set, absorb(get().knowledge, project.id, project.shots, project.styleIds[0] ?? ''))
    const total = Object.values(learning.projects).reduce((n, p) => n + p.examples.length, 0)
    const taste = total ? learnTaste(learning, project?.genre ?? 'other') : null
    currentTaste = taste
    set({ tasteData: learning, taste })
    void window.studio.learning.save(learning)
    if (project) get().update((p) => ({ ...p, shots: scoreAndSuggest(p.shots, scoring(p, get().learned)) }))
  },

  setBlindBursts: (on) => {
    const learning = { ...get().tasteData, blindBursts: on }
    set({ tasteData: learning })
    void window.studio.learning.save(learning)
  },

  forgetLearning: async () => {
    const learning = { ...emptyLearning(), blindBursts: get().tasteData.blindBursts }
    currentTaste = null
    set({ tasteData: learning, taste: null })
    await window.studio.learning.save(learning)
    if (get().project) get().update((p) => ({ ...p, shots: scoreAndSuggest(p.shots, scoring(p, get().learned)) }))
  },

  loadTraining: async () => {
    const stored = (await window.studio.training.get()) as Training | null
    set({ training: stored && stored.version === TRAINING_VERSION ? { ...emptyTraining(), ...stored } : emptyTraining() })
  },

  trainFinished: async (folder) => {
    const files = await window.studio.scan(folder, true)
    if (!files.length) throw new Error(`No images found in ${folder}.`)
    let norms = get().training.norms
    let count = 0
    await teach(set, get, 'Studying finished photographs', files.length, async (i) => {
      const preview = await openPreview(`f${i % 4}`, files[i].path)
      const reading = (await analyse(preview)).reading
      // A photograph with no person in it says nothing about separation or skin.
      if (!reading.hasSubject) return
      norms = addSamples(norms, metricsOf(reading))
      count++
    })
    if (!count) throw new Error('No people were found in those photographs, so there was nothing to learn norms from.')
    saveTraining(set, get, { norms }, { kind: 'finished', name: baseName(folder), count })
  },

  trainLook: async (beforeFolder, afterFolder) => {
    const stem = (name: string): string => name.replace(/\.\w+$/, '').toLowerCase()
    const after = new Map((await window.studio.scan(afterFolder, true)).map((f) => [stem(f.name), f.path]))
    const pairs = (await window.studio.scan(beforeFolder, true)).filter((f) => after.has(stem(f.name)) && after.get(stem(f.name)) !== f.path)
    if (!pairs.length) throw new Error('No matching file names in the two folders. The finished photos must keep the names of the originals (IMG_0123.ARW and IMG_0123.jpg).')
    let house = get().training.houseLook
    let count = 0
    await teach(set, get, 'Comparing before and after', pairs.length, async (i) => {
      const before = resized(await openPreview('before', pairs[i].path), 512)
      const finished = resized(await openPreview('after', after.get(stem(pairs[i].name))!), 512)
      house = addToHouseLook(house, deriveLook(lookStats(rgba(finished).data), lookStats(rgba(before).data)))
      count++
    })
    saveTraining(set, get, { houseLook: house }, { kind: 'look', name: baseName(afterFolder), count })
  },

  teachFromRatings: async (minStars) => {
    const project = get().project
    if (!project) return 0
    const ratings = new Map((await window.studio.readRatings(project.shots.map((s) => s.path))).map((r) => [r.path, r]))
    const kept = (path: string): boolean | null => {
      const r = ratings.get(path)
      if (!r || (r.rating === null && r.label === null)) return null
      return (r.rating ?? 0) >= minStars
    }
    return applyPastDecisions(get, (s) => kept(s.path), `Lightroom ratings: ${project.name}`)
  },

  teachFromDelivered: async (folder) => {
    const stem = (name: string): string => name.replace(/\.\w+$/, '').toLowerCase()
    const delivered = new Set((await window.studio.scan(folder, true)).map((f) => stem(f.name)))
    if (!delivered.size) throw new Error(`No images found in ${folder}.`)
    // Exported files often carry a suffix (IMG_0123-Edit, IMG_0123-2): match on the original name at the start.
    const isDelivered = (name: string): boolean => {
      const s = stem(name)
      return delivered.has(s) || [...delivered].some((d) => d.startsWith(s + '-') || d.startsWith(s + '_'))
    }
    return applyPastDecisions(get, (s) => isDelivered(s.name), `Delivered files: ${get().project?.name ?? ''}`)
  },

  giveFeedback: (topic, agree) => {
    const prev = get().training.feedback[topic] ?? { agree: 0, dismiss: 0 }
    const feedback = { ...get().training.feedback, [topic]: agree ? { ...prev, agree: prev.agree + 1 } : { ...prev, dismiss: prev.dismiss + 1 } }
    saveTraining(set, get, { feedback })
  },

  resetTraining: (area) => saveTraining(set, get, { [area]: emptyTraining()[area] } as Partial<Training>),

  loadEmotions: async () => {
    const stored = (await window.studio.data.get('emotions')) as EmotionStore | null
    setEmotions(set, stored && stored.version === EMOTION_VERSION ? stored : emptyEmotions(), false)
  },

  teachEmotion: (name, shapes, thumb, source = 'you', about) => {
    setEmotions(set, teachFace(get().emotions, name, toCues(shapes), source, thumb, about))
    rescore(get)
  },

  namePointerAs: (pointerId, name, source = 'you', about) => {
    setEmotions(set, namePointer(get().emotions, pointerId, name, source, about))
    rescore(get)
  },

  dropPointer: (pointerId) => setEmotions(set, dismissPointer(get().emotions, pointerId)),

  forgetEmotionNamed: (name) => {
    setEmotions(set, forgetEmotion(get().emotions, name))
    rescore(get)
  },

  setSceneChapter: (sceneId, chapter) =>
    get().update((p) => {
      const shots = p.shots.map((x) => (x.sceneId === sceneId ? { ...x, chapter: chapter ?? undefined } : x))
      return { ...p, shots: scoreAndSuggest(shots, scoring(p, get().learned)) }
    }),

  applyTriage: (kinds) => {
    const project = get().project
    if (!project) return 0
    const ids = new Set(kinds.flatMap((k) => triage(project.shots)[k].map((x) => x.id)))
    if (!ids.size) return 0
    remember(get, set, (x) => ids.has(x.id))
    get().update((p) => ({
      ...p,
      shots: p.shots.map((x) => (ids.has(x.id) ? { ...x, decision: 'reject' as const, decidedBy: 'accepted' as const, suggestedThen: x.suggestion, blind: undefined } : x))
    }))
    return ids.size
  },

  deepRead: async () => {
    const start = get().project
    if (!start || get().deep.running) return
    // The two strongest frames of every moment: the ones a decision will be made between.
    const stacks = new Map<number, Shot[]>()
    for (const x of start.shots) if (x.analysis && x.score) stacks.set(x.stackId ?? 0, [...(stacks.get(x.stackId ?? 0) ?? []), x])
    const todo = [...stacks.values()].flatMap((stack) =>
      [...stack].sort((a, b) => b.score!.overall - a.score!.overall).slice(0, 2).filter((x) => !x.analysis!.diag && x.analysis!.faces.length > 0 && !x.score!.warnings.includes('misfire'))
    )
    if (!todo.length) return
    cancelDeep = false
    set({ deep: { running: true, done: 0, total: todo.length } })
    try {
      for (const [i, shot] of todo.entries()) {
        if (cancelDeep || get().project?.id !== start.id) break
        try {
          const blob = await (await fetch(previewUrl(start.id, shot.id))).blob()
          const preview = await loadOriented(blob, 1, PREVIEW_EDGE)
          const a = await analyse(preview, shot.analysis!.faces, undefined, true)
          if (get().project?.id !== start.id) break
          const diag = {
            merged: a.reading.separation?.mergedShare,
            attention: a.reading.hasSubject ? a.reading.attentionOnSubject : undefined,
            pull: a.reading.distractions.reduce((m, d) => Math.max(m, d.pull), 0)
          }
          analysisDirty = true
          get().updateShot(shot.id, { analysis: { ...get().project!.shots.find((x) => x.id === shot.id)!.analysis!, diag } })
        } catch {
          // A frame that cannot be read more closely keeps its first reading.
        }
        set({ deep: { running: true, done: i + 1, total: todo.length } })
        if ((i + 1) % 25 === 0) rescore(get)
      }
    } finally {
      set((x) => ({ deep: { ...x.deep, running: false } }))
      if (get().project?.id === start.id) rescore(get)
    }
  },

  cancelDeepRead: () => {
    cancelDeep = true
  },

  setFastImport: (on) => get().update((p) => ({ ...p, fastImport: on })),

  setMarked: (marked) => set({ marked }),
  setAsking: (asking) => set({ asking }),
  setWhy: (ids, why) => {
    const wanted = new Set(ids)
    const clean = [...new Set(why.map((w) => w.trim().toLowerCase()).filter(Boolean))]
    get().update((p) => ({ ...p, shots: p.shots.map((s) => (wanted.has(s.id) && s.decision === 'reject' ? { ...s, why: clean.length ? clean : undefined } : s)) }))
    // A reason is learned from at once: it is cheap to file, and the next frames should already feel it.
    const p = get().project
    if (p) {
      setKnowledge(set, absorb(get().knowledge, p.id, p.shots, p.styleIds[0] ?? ''))
      rescore(get)
    }
  },
  setAskWhy: async (on) => set({ settings: await window.studio.settings.set({ askWhy: on }) }),

  putAway: async () => {
    const project = get().project
    if (!project) return
    get().relearn()
    clearTimeout(saveTimer)
    await window.studio.projects.save(get().project!, true)
    cancelRequested = true
    set({ project: null, selectedId: null, marked: [], asking: null })
    await get().refreshProjects()
  },

  learnFromPastShoot: async ({ folder, name, styleId, from, fast }) => {
    const view = get().view
    if (get().project) await get().putAway()
    await get().createProject(name, styleId)
    set({ view })
    get().setFastImport(fast)
    await get().importFolder(folder)
    const count = 'stars' in from ? await get().teachFromRatings(from.stars) : await get().teachFromDelivered(from.delivered)
    await get().putAway()
    set({ view })
    return count
  },

  forgetEmotionExample: (name, at) => {
    const e = get().emotions
    setEmotions(set, { ...e, concepts: e.concepts.map((c) => (c.name === name ? { ...c, examples: c.examples.filter((x) => x.at !== at) } : c)) })
    rescore(get)
  },
  forgetGestureExamples: (name) => get().forgetGestureNamed(name),
  forgetReason: (name) => {
    const k = get().knowledge
    const reasons = k.reasons ?? emptyReasons()
    setKnowledge(set, { ...k, reasons: { ...reasons, tags: reasons.tags.filter((t) => t.name !== name) } })
    rescore(get)
  },
  forgetNote: (at) => setKnowledge(set, { ...get().knowledge, notes: get().knowledge.notes.filter((n) => n.at !== at) }),
  forgetClaudeRecord: (projectId) => {
    const claude = { ...get().knowledge.claude }
    delete claude[projectId]
    setKnowledge(set, { ...get().knowledge, claude })
  },
  setExcluded: (key, excluded) => {
    const k = get().knowledge
    const list = new Set(k.excluded ?? [])
    if (excluded) list.add(key)
    else list.delete(key)
    setKnowledge(set, { ...k, excluded: [...list] })
    rescore(get)
  },
  setIgnoredMeasurement: (key, ignored) => {
    const data = get().tasteData
    const list = new Set(data.ignored ?? [])
    if (ignored) list.add(key)
    else list.delete(key)
    set({ tasteData: { ...data, ignored: [...list] } })
    get().relearn()
  },
  forgetProjectDecisions: (projectId) => {
    const data = get().tasteData
    const projects = { ...data.projects }
    delete projects[projectId]
    const k = get().knowledge
    const ledger = { projects: { ...k.ledger.projects } }
    delete ledger.projects[projectId]
    set({ tasteData: { ...data, projects } })
    setKnowledge(set, { ...k, ledger })
    get().relearn()
  },

  reloadChanged: async (name) => {
    // Another window saved this. Load it and score again; never save it back, or the windows would echo forever.
    if (name === 'emotions') {
      const stored = (await window.studio.data.get('emotions')) as EmotionStore | null
      if (stored && stored.version === EMOTION_VERSION) setEmotions(set, stored, false)
    } else if (name === 'knowledge' || name === 'gestures') {
      await get().loadKnowledge()
    } else if (name === 'learned') {
      const learned = await window.studio.learned.get()
      set({ learned: { ...learned, styles: learned.styles.map(upgradeStyle) } })
    } else if (name === 'learning') {
      const stored = (await window.studio.learning.get()) as LearningData | null
      if (!stored || stored.version !== FEATURE_VERSION) return
      for (const p of Object.values(stored.projects)) for (const e of p.examples) while (e.x.length < FEATURES.length) e.x.push(0)
      const total = Object.values(stored.projects).reduce((n, p) => n + p.examples.length, 0)
      currentTaste = total ? learnTaste(stored, get().project?.genre ?? 'other') : null
      set({ tasteData: stored, taste: currentTaste })
    } else if (name === 'training') {
      await get().loadTraining()
    } else if (name === 'settings') {
      await get().loadSettings()
    } else if (name.startsWith('project:')) {
      if (!get().project) await get().refreshProjects()
      return
    } else return
    rescore(get)
  },

  loadKnowledge: async () => {
    const [k, g] = await Promise.all([window.studio.data.get('knowledge'), window.studio.data.get('gestures')])
    const knowledge = k as Knowledge | null
    const gestures = g as GestureStore | null
    setKnowledge(set, knowledge && knowledge.version === KNOWLEDGE_VERSION ? { ...emptyKnowledge(), ...knowledge } : emptyKnowledge(), false)
    setGestures(set, gestures && gestures.version === GESTURE_VERSION ? gestures : emptyGestures(), false)
  },

  teachGestureNamed: (name, g, source = 'you') => {
    setGestures(set, teachGesture(get().gestures, name, g, source))
    rescore(get)
  },

  forgetGestureNamed: (name) => {
    setGestures(set, forgetGesture(get().gestures, name))
    rescore(get)
  },

  setTags: (shotId, tags) => {
    const project = get().project
    const shot = project?.shots.find((x) => x.id === shotId)
    if (!project || !shot?.analysis) return
    const clean = [...new Set(tags.map(cleanTag).filter(Boolean))]
    const k = get().knowledge
    setKnowledge(set, { ...k, concepts: learnTags(k.concepts, `${project.id}:${shotId}`, sceneVector(shot.analysis), clean, 'you', 1) })
    get().update((p) => ({ ...p, shots: scoreAndSuggest(p.shots.map((x) => (x.id === shotId ? { ...x, tags: clean.length ? clean : undefined } : x)), scoring(p, get().learned)) }))
  },

  forgetTag: (name) => {
    const k = get().knowledge
    setKnowledge(set, { ...k, concepts: { ...k.concepts, tags: k.concepts.tags.filter((t) => t.name !== name) } })
    rescore(get)
  },

  remember: (note) => setKnowledge(set, addNote(get().knowledge, { ...note, at: Date.now() })),

  findPeople: async () => {
    const project = get().project
    if (!project) return
    get().update((p) => {
      // People nobody named are gathered afresh; named and key people keep what is known of them.
      const found = assignPeople(p.shots, (p.people ?? []).filter((x) => x.name || x.key))
      return { ...p, people: found.people, shots: scoreAndSuggest(found.shots, scoring({ ...p, people: found.people }, get().learned)) }
    })
    await picturePeople(get)
  },

  editPerson: (id, patch) => {
    const project = get().project
    if (!project?.people) return
    const name = patch.name?.trim()
    // Giving someone the name of a person already listed says they are the same person.
    const twin = name ? project.people.find((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase()) : undefined
    if (twin) return get().mergePerson(id, twin.id)
    get().update((p) => {
      const people = p.people!.map((x) => (x.id === id ? { ...x, ...patch, name: name ?? x.name } : x))
      return { ...p, people, shots: scoreAndSuggest(p.shots, scoring({ ...p, people }, get().learned)) }
    })
  },

  mergePerson: (fromId, intoId) =>
    get().update((p) => {
      const merged = mergePeople(p.shots, p.people ?? [], fromId, intoId)
      // With more faces known of the person, look again for others that are theirs.
      const found = assignPeople(merged.shots, merged.people.filter((x) => x.name || x.key || x.id === intoId))
      return { ...p, people: found.people, shots: scoreAndSuggest(found.shots, scoring({ ...p, people: found.people }, get().learned)) }
    }),

  setFacePerson: (shotId, face, personId) =>
    get().update((p) => {
      const shot = p.shots.find((x) => x.id === shotId)
      const f = shot?.analysis?.faces[face]
      if (!shot || !f) return p
      let people = p.people ?? []
      let id: string | null = personId
      if (personId === 'new') {
        id = `p${Date.now().toString(36)}`
        people = [...people, { id, name: '', key: false, faces: f.id ? [f.id] : [], wear: f.id ? [f.wear ?? []] : [] }]
      } else if (personId && f.id) {
        // The corrected face becomes one of the faces known to be theirs.
        people = people.map((x) => (x.id === personId ? { ...x, faces: [...x.faces, f.id!].slice(-20), wear: [...x.wear, f.wear ?? []].slice(-20) } : x))
      }
      const who = shot.analysis!.faces.map((_, i) => (i === face ? id : (shot.people?.[i] ?? null)))
      const shots = p.shots.map((x) => (x.id === shotId ? { ...x, people: who, peopleSet: [...new Set([...(x.peopleSet ?? []), face])] } : x))
      const found = assignPeople(shots, people.filter((x) => x.name || x.key || x.id === id))
      return { ...p, people: found.people, shots: scoreAndSuggest(found.shots, scoring({ ...p, people: found.people }, get().learned)) }
    }),

  reestimate: () => {
    const project = get().project
    if (!project || !project.shots.some((x) => x.decision !== null)) return null
    // Learn from this project as it stands first, so that "today" really is today.
    get().relearn()
    const now = get().project!
    const fresh = freshLook(now, get)
    const estimate = estimateOf(now.shots, fresh)
    set({ relook: relookOf(fresh) })
    get().update((p) => ({ ...p, estimates: [...(p.estimates ?? []), estimate].slice(-30) }))
    return estimate
  },

  reestimateAll: async () => {
    if (get().estimating.running || get().project) return
    const list = await window.studio.projects.list()
    set({ estimating: { running: true, done: 0, total: list.length * 2 } })
    try {
      // First pass: everything every project's decisions can teach, measured as the app measures today.
      let learning = { ...get().tasteData, projects: {} as LearningData['projects'] }
      let knowledge = get().knowledge
      let learned = get().learned
      for (const [i, summary] of list.entries()) {
        const p = await window.studio.projects.load(summary.id)
        const scored = scoreAndSuggest(p.shots, scoring(p, learned))
        const examples = examplesOf(scored)
        if (examples.length) learning.projects[p.id] = { genre: p.genre, updatedAt: p.updatedAt, examples }
        knowledge = absorb(knowledge, p.id, scored, p.styleIds?.[0] ?? '')
        setKnowledge(set, knowledge, false)
        const styleId = p.styleIds?.[0]
        if (styleId) {
          const lifts = { ...(learned.lifts ?? {}), [styleId]: { ...(learned.lifts?.[styleId] ?? {}), [p.id]: emotionLifts(scored) } }
          const merged = Object.values(lifts[styleId]).reduce((acc, l) => mergeLifts(acc, l), {} as Record<string, { w: number; n: number }>)
          learned = { ...learned, lifts, styles: learned.styles.map((x) => (x.id === styleId ? { ...x, emotionLift: merged } : x)) }
        }
        set({ estimating: { running: true, done: i + 1, total: list.length * 2 } })
      }
      learning = trimmed(learning)
      set({ tasteData: learning, learned })
      void window.studio.learning.save(learning)
      void window.studio.learned.save(learned)
      void window.studio.data.save('knowledge', knowledge)
      const total = Object.values(learning.projects).reduce((n, p) => n + p.examples.length, 0)
      currentTaste = total ? learnTaste(learning, 'other') : null
      set({ taste: currentTaste })
      // Second pass: how well today's app, without each project's own lessons, predicts that project.
      for (const [i, summary] of list.entries()) {
        const p = await window.studio.projects.load(summary.id)
        if (p.shots.some((x) => x.decision !== null && x.decidedBy !== 'accepted')) {
          const estimate = estimateOf(p.shots, freshLook({ ...p, styleIds: p.styleIds ?? [] }, get))
          if (estimate.moments) await window.studio.projects.save({ ...p, estimates: [...(p.estimates ?? []), estimate].slice(-30) }, false)
        }
        set({ estimating: { running: true, done: list.length + i + 1, total: list.length * 2 } })
      }
    } finally {
      set((x) => ({ estimating: { ...x.estimating, running: false } }))
    }
  },

  loadSettings: async () => set({ settings: await window.studio.settings.get() }),
  saveSettings: async (patch) => set({ settings: await window.studio.settings.set(patch) })
}))

/** Shots after the current filter, in capture order. */
export function visibleShots(shots: Shot[], filter: Filter, relook?: Relook | null): Shot[] {
  switch (filter) {
    case 'relook': {
      const ids = new Set([...(relook?.missed ?? []), ...(relook?.doubted ?? [])])
      return shots.filter((s) => ids.has(s.id))
    }
    case 'key':
      return shots.filter((s) => s.score?.keyPeople?.length)
    case 'suggested':
      return shots.filter((s) => s.suggestion === 'pick' || s.decision === 'pick')
    case 'undecided':
      return shots.filter((s) => s.decision === null)
    case 'picks':
      return shots.filter((s) => s.decision === 'pick')
    case 'rejects':
      return shots.filter((s) => s.decision === 'reject')
    case 'warnings':
      return shots.filter((s) => (s.score?.warnings.length ?? 0) > 0)
    case 'gems':
      return shots.filter((s) => s.score?.gem)
    case 'must':
      return shots.filter((s) => s.score?.must)
    case 'unkept': {
      // A second look: for every moment you kept nothing from, its strongest frame.
      const stacks = new Map<number, Shot[]>()
      for (const s of shots) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
      const best = new Set<string>()
      for (const stack of stacks.values()) {
        if (stack.some((s) => s.decision === 'pick')) continue
        best.add([...stack].sort((a, b) => (b.score?.overall ?? 0) - (a.score?.overall ?? 0))[0].id)
      }
      return shots.filter((s) => best.has(s.id))
    }
    default:
      return shots
  }
}
