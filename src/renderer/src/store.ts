import { create } from 'zustand'
import {
  emptyBrief,
  IMAGE_EXTENSIONS,
  styleCacheId,
  type Analysis,
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
import { ingestShot } from './analysis/pipeline'
import { deriveLook, lookStats } from './analysis/look'
import { loadOriented, PREVIEW_EDGE, resized, rgba } from './analysis/image'
import { metricsOf } from './analysis/diagnose'
import { analyse } from './analysis/reading'
import { scoreAndSuggest, tasteOf, type ScoreOptions } from './analysis/scoring'
import { addSamples, addToHouseLook, emptyTraining, HABIT_KEYS, limitsFrom, TRAINING_VERSION, type Training, type TrainingEvent } from './analysis/training'
import { buildProfile, feelOf, mergeProfiles, profileFacts, STARTER_PROFILES, styleNotes } from './analysis/style'
import type { StyleProfile } from '@shared/types'

export type View = 'projects' | 'profiles' | 'training' | 'look' | 'diagnose' | 'brief' | 'import' | 'cull' | 'story' | 'coach' | 'export' | 'learn' | 'settings'
export type Filter = 'all' | 'suggested' | 'undecided' | 'picks' | 'rejects' | 'warnings' | 'gems' | 'unkept'

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
  createProject(name: string, genre: Genre): Promise<void>
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
  loadTraining(): Promise<void>
  /** Learns the photographer's own norms from a folder of finished photographs. */
  trainFinished(folder: string): Promise<void>
  /** Learns their editing habits from a folder of RAW files with Lightroom sidecars. */
  trainEdits(folder: string): Promise<void>
  /** Learns their look from unedited frames and the finished versions with the same file names. */
  trainLook(beforeFolder: string, afterFolder: string): Promise<void>
  /** Takes the open project's decisions from ratings given in Lightroom. Returns how many frames were decided. */
  teachFromRatings(minStars: number): Promise<number>
  /** Takes the open project's decisions from a folder of delivered files (matched by name). */
  teachFromDelivered(folder: string): Promise<number>
  giveFeedback(topic: string, agree: boolean): void
  resetTraining(area: 'norms' | 'habits' | 'houseLook' | 'feedback'): void
  /** Retrains the taste model from every stored decision plus the open project's. */
  relearn(): void
  setBlindBursts(on: boolean): void
  forgetLearning(): Promise<void>
  setBalance(balance: number): void
  setGenre(genre: Genre): void
  loadLearned(): Promise<void>
  createProfile(name: string, tags: string[], feeling: string): Promise<void>
  editProfile(styleId: string, patch: Partial<Pick<Style, 'name' | 'tags' | 'feeling'>>): Promise<void>
  addGallery(styleId: string, sourceName: string, folder: string): Promise<void>
  rememberPicks(styleId: string): Promise<void>
  distil(styleId: string): Promise<void>
  removeStyle(styleId: string): Promise<void>
  chooseStyle(styleId: string | null): void
  readShoot(): Promise<void>
  cancelRead(): void
  loadSettings(): Promise<void>
  saveSettings(patch: { apiKey?: string; model?: string }): Promise<void>
}

const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

let saveTimer: ReturnType<typeof setTimeout> | undefined
let cancelRequested = false
let cancelRead = false

function scheduleSave(project: Project): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.studio.projects.save(project), 600)
}

/** At most this many frames of a gallery are kept as samples and shown to Claude for the essence. */
const MAX_SAMPLES = 36

/** Everything the scoring needs to know about a project, including its culling profile. */
function scoring(p: Pick<Project, 'genre' | 'balance' | 'styleIds'>, learned: Learned): ScoreOptions {
  const active = learned.styles.filter((s) => p.styleIds.includes(s.id))
  return {
    genre: p.genre,
    balance: p.balance,
    style: mergeProfiles(active.flatMap((s) => (s.profile ? [s.profile] : []))),
    feel: active.length ? feelOf(active.flatMap((s) => s.tags)) : undefined,
    learned: currentTaste ? { model: currentTaste.model, trust: currentTaste.trust } : undefined
  }
}

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
  settings: { hasApiKey: false, model: '' },
  ingest: { running: false, done: 0, total: 0, failed: 0, startedAt: 0 },
  reading: { running: false, done: 0, total: 0 },
  learned: { styles: [], balance: {} },
  learning: { running: false, done: 0, total: 0 },
  toast: null,
  tasteData: emptyLearning(),
  taste: null,
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

  createProject: async (name, genre) => {
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
      // Start from what earlier projects of this kind taught, if anything.
      balance: get().learned.balance[genre]?.value ?? DEFAULT_BALANCE[genre],
      storyPlan: STORY_PLANS[genre],
      readCostUsd: 0,
      styleIds: [],
      clockOffsets: {},
      storyOrder: [],
      gradeAdvice: {}
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
    set({ project, view: has ? 'cull' : 'brief', selectedId: null, filter: has ? 'suggested' : 'all', chapter: null, undoStack: [], redoStack: [] })
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
          result = await ingestShot(projectId, shot)
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
    if (!learned.seeded) {
      const starters: Style[] = STARTER_PROFILES.map((p) => ({ ...p, id: newId(), createdAt: Date.now(), sources: [], profile: null, samples: [] }))
      learned = { ...learned, styles: [...learned.styles, ...starters], seeded: true }
      await window.studio.learned.save(learned)
    }
    set({ learned })
  },

  createProfile: async (name, tags, feeling) => {
    const style: Style = { id: newId(), name, tags, feeling, createdAt: Date.now(), sources: [], profile: null, samples: [] }
    await saveStyles(get, set, [...get().learned.styles, style])
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
          const patch = await ingestShot(cache, { id: shotId, path: file.path, name: file.name, time: 0, width: 0, height: 0, decision: null, rating: 0 })
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

  chooseStyle: (styleId) =>
    get().update((p) => {
      const styleIds = styleId ? [styleId] : []
      return { ...p, styleIds, shots: scoreAndSuggest(p.shots, scoring({ ...p, styleIds }, get().learned)) }
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
          frames: chunk.map((s) => ({
            shotId: s.id,
            scene: s.sceneId ?? 0,
            time: clock(s.time),
            shotType: s.analysis!.shotType,
            flaws: (s.score?.warnings ?? []).join(', ')
          }))
        })
        if (get().project?.id !== start.id) return
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
    set({ tasteData: stored && stored.version === FEATURE_VERSION ? stored : emptyLearning() })
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

  trainEdits: async (folder) => {
    const files = (await window.studio.scan(folder)).filter((f) => !/\.jpe?g$/i.test(f.name))
    if (!files.length) throw new Error(`No RAW files found in ${folder}.`)
    let habits = get().training.habits
    let count = 0
    await teach(set, get, 'Reading Lightroom settings', files.length, async (i) => {
      const develop = await window.studio.readDevelop(files[i].path)
      if (!develop || Object.keys(develop.values).length < 4) return
      const values: Record<string, number> = {}
      for (const key of HABIT_KEYS) if (typeof develop.values[key] === 'number') values[key] = develop.values[key] as number
      habits = addSamples(habits, values)
      count++
    })
    if (!count) throw new Error('None of those files has Lightroom settings beside it. Turn on "Automatically write changes into XMP" in Lightroom, or select the photos and press Ctrl+S, then try again.')
    saveTraining(set, get, { habits }, { kind: 'edits', name: baseName(folder), count })
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

  loadSettings: async () => set({ settings: await window.studio.settings.get() }),
  saveSettings: async (patch) => set({ settings: await window.studio.settings.set(patch) })
}))

/** Shots after the current filter, in capture order. */
export function visibleShots(shots: Shot[], filter: Filter): Shot[] {
  switch (filter) {
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
