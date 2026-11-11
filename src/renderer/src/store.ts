import { create } from 'zustand'
import {
  emptyBrief,
  type Decision,
  type Genre,
  type Project,
  type ProjectSummary,
  type Settings,
  type Shot
} from '@shared/types'
import { groupShots } from './analysis/grouping'
import { ingestShot } from './analysis/pipeline'
import { scoreAndSuggest } from './analysis/scoring'

export type View = 'projects' | 'brief' | 'import' | 'cull' | 'story' | 'coach' | 'export' | 'learn' | 'settings'
export type Filter = 'all' | 'suggested' | 'undecided' | 'picks' | 'rejects' | 'warnings'

interface IngestState {
  running: boolean
  done: number
  total: number
  failed: number
  startedAt: number
}

interface State {
  view: View
  summaries: ProjectSummary[]
  project: Project | null
  selectedId: string | null
  filter: Filter
  settings: Settings
  ingest: IngestState
  toast: string | null

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
  loadSettings(): Promise<void>
  saveSettings(patch: { apiKey?: string; model?: string }): Promise<void>
}

const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

let saveTimer: ReturnType<typeof setTimeout> | undefined
let cancelRequested = false

function scheduleSave(project: Project): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.studio.projects.save(project), 600)
}

export const useStore = create<State>((set, get) => ({
  view: 'projects',
  summaries: [],
  project: null,
  selectedId: null,
  filter: 'all',
  settings: { hasApiKey: false, model: '' },
  ingest: { running: false, done: 0, total: 0, failed: 0, startedAt: 0 },
  toast: null,

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
      storyOrder: [],
      gradeAdvice: {}
    }
    await window.studio.projects.save(project)
    set({ project, view: 'brief', selectedId: null, filter: 'all' })
  },

  openProject: async (id) => {
    const project = await window.studio.projects.load(id)
    set({ project, view: project.shots.length ? 'cull' : 'brief', selectedId: project.shots[0]?.id ?? null, filter: 'all' })
  },

  closeProject: () => {
    const { project } = get()
    clearTimeout(saveTimer)
    if (project) void window.studio.projects.save(project).then(get().refreshProjects)
    cancelRequested = true
    set({ project: null, view: 'projects', selectedId: null })
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
    const set_ = new Set(ids)
    get().update((p) => ({ ...p, shots: p.shots.map((s) => (set_.has(s.id) ? { ...s, decision } : s)) }))
  },

  // Turns proposals into decisions, but never overrides a choice already made.
  acceptSuggestions: (ids) => {
    const only = ids ? new Set(ids) : null
    get().update((p) => ({
      ...p,
      shots: p.shots.map((s) => {
        if ((only && !only.has(s.id)) || s.decision !== null || !s.suggestion) return s
        return { ...s, decision: s.suggestion === 'pick' ? 'pick' : s.suggestion === 'reject' ? 'reject' : null }
      })
    }))
  },

  importFolder: async (folder) => {
    const start = get().project
    if (!start || get().ingest.running) return
    const files = await window.studio.scan(folder)
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
      return { ...p, sceneGapSec: gap, shots: scoreAndSuggest(groupShots(p.shots, gap)) }
    }),

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
    default:
      return shots
  }
}
