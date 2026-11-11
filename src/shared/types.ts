// Types shared by the main process, the preload bridge and the renderer.

export type Genre = 'portrait' | 'wedding' | 'event' | 'fashion' | 'other'

export interface Brief {
  client: string
  /** What the client asked for, in their words. */
  clientAsk: string
  /** What you want the work to say. */
  intention: string
  /** Three to six mood words, e.g. "warm, quiet, nostalgic". */
  moodWords: string
  /** Colour direction, references, films, photographers. */
  references: string
  deliverables: string
  /** How many final images to deliver. 0 = undecided. */
  targetCount: number
  deadline: string
}

export interface FaceInfo {
  /** Bounding box in 0..1 image coordinates. */
  x: number
  y: number
  w: number
  h: number
  /** 0 = wide open, 1 = fully closed (worst of the two eyes). */
  blink: number
  smile: number
  /** Relative sharpness of the eye region, comparable between frames. */
  sharpness: number
  /** How open the mouth is, 0..1. With a smile, this is a laugh. */
  jawOpen?: number
  /** Cheeks raised and eyes narrowed, 0..1: what separates a felt smile from a posed one. */
  squint?: number
  /** Head turn, about -1 (facing image-left) to 1 (facing image-right). */
  yaw?: number
  /** Mean skin hue (degrees) and saturation (0..1) sampled on the cheeks. */
  skinHue: number | null
  skinSat: number | null
}

export interface ColorStats {
  /** Mean luminance 0..1 (display-referred). */
  meanLuma: number
  /** 5th and 95th luminance percentiles: the working tonal range. */
  p5: number
  p95: number
  /** Fraction of pixels crushed to black / blown to white. */
  clipLow: number
  clipHigh: number
  meanSat: number
  /** Average chroma offset of near-neutral pixels: + = warm, - = cool. */
  castWarm: number
  /** + = magenta, - = green. */
  castTint: number
  /** Five dominant colours as hex, most common first. */
  palette: string[]
}

export type ShotType = 'close-up' | 'medium' | 'wide' | 'group' | 'detail'

export interface Analysis {
  /** Sharpness of the sharpest regions (what was focused on), raw value. */
  sharpness: number
  /** 64-bit difference hash as 16 hex chars, for near-duplicate grouping. */
  hash: string
  color: ColorStats
  faces: FaceInfo[]
  shotType: ShotType
}

export type Decision = 'pick' | 'reject' | null
export type Suggestion = 'pick' | 'alternate' | 'reject'

export type MomentTag = 'laugh' | 'joy' | 'connection' | 'embrace' | 'peak'

export interface Score {
  /** Craft and moment combined by the project's balance, 0..100. */
  overall: number
  /** Technical quality: focus, eyes, exposure. */
  craft: number
  /** What the frame carries emotionally. null when it cannot be judged (no faces, no read). */
  moment: number | null
  focus: number
  exposure: number
  /** null when there are no faces. */
  faces: number | null
  /** Plain-language reasons about craft. */
  notes: string[]
  /** Plain-language reasons about the moment. */
  momentNotes: string[]
  tags: MomentTag[]
  warnings: Warning[]
  /** Technically imperfect, but the moment may be worth more than the flaw. */
  gem: boolean
}

/** One chapter of the story a shoot of this kind is expected to tell. */
export interface Beat {
  name: string
  /** What makes a frame from this chapter worth keeping. */
  look: string
}

/** A picture editor's reading of one frame (from the optional AI read). */
export interface NarrativeRead {
  beat: string
  /** 0..10: how much the frame carries emotionally and for the story. */
  moment: number
  gem: boolean
  note: string
}

export type Warning = 'blink' | 'soft' | 'soft-face' | 'clipped' | 'dark'

export interface Shot {
  id: string
  /** Absolute path to the original file on disk. Never modified. */
  path: string
  name: string
  /** Capture time in ms since epoch (camera clock). */
  time: number
  width: number
  height: number
  iso?: number
  shutter?: string
  aperture?: number
  focal?: number
  lens?: string
  camera?: string
  analysis?: Analysis
  score?: Score
  sceneId?: number
  stackId?: number
  suggestion?: Suggestion
  read?: NarrativeRead
  decision: Decision
  rating: number
  /** Set when the file could not be read or analysed. */
  error?: string
}

export interface StoryAdvice {
  summary: string
  sequence: { shotId: string; role: string; why: string }[]
  cut: { shotId: string; why: string }[]
  gaps: string[]
  lesson: string
  usage?: Usage
}

export interface GradeAdvice {
  read: string
  direction: string
  steps: { panel: string; move: string; why: string }[]
  watchOut: string[]
  resolveNote: string
  lesson: string
  usage?: Usage
}

export interface Usage {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface Project {
  id: string
  name: string
  genre: Genre
  createdAt: number
  updatedAt: number
  brief: Brief
  folder: string | null
  shots: Shot[]
  /** Seconds of inactivity that start a new scene. */
  sceneGapSec: number
  /** How much the moment counts against craft when suggesting keepers, 0..1. */
  balance: number
  /** The chapters this shoot should contain. */
  storyPlan: Beat[]
  /** Running total spent on editor's reads for this project. */
  readCostUsd: number
  storyOrder: string[]
  storyAdvice?: StoryAdvice
  gradeAdvice: Record<string, GradeAdvice>
}

export interface ProjectSummary {
  id: string
  name: string
  genre: Genre
  client: string
  updatedAt: number
  shotCount: number
  pickCount: number
}

export interface Settings {
  hasApiKey: boolean
  model: string
}

export interface ScannedFile {
  path: string
  name: string
  size: number
}

export interface ExtractResult {
  /** media:// URL of the embedded preview JPEG, ready for the renderer. */
  url: string
  /** EXIF orientation (1..8) the renderer still has to apply itself. */
  applyOrientation: number
  meta: Pick<Shot, 'time' | 'iso' | 'shutter' | 'aperture' | 'focal' | 'lens' | 'camera'>
}

export interface XmpItem {
  path: string
  rating: number
  label: string | null
}

export interface ExportResult {
  written: number
  failed: { path: string; error: string }[]
}

export interface StudioApi {
  projects: {
    list(): Promise<ProjectSummary[]>
    load(id: string): Promise<Project>
    save(project: Project): Promise<void>
    remove(id: string): Promise<void>
  }
  pickFolder(): Promise<string | null>
  scan(folder: string): Promise<ScannedFile[]>
  extract(projectId: string, shotId: string, path: string): Promise<ExtractResult>
  savePreview(projectId: string, shotId: string, preview: ArrayBuffer, thumb: ArrayBuffer): Promise<void>
  exportXmp(items: XmpItem[]): Promise<ExportResult>
  copySelects(paths: string[], dest: string): Promise<ExportResult>
  reveal(path: string): Promise<void>
  settings: {
    get(): Promise<Settings>
    set(patch: { apiKey?: string; model?: string }): Promise<Settings>
  }
  ai: {
    story(req: StoryRequest): Promise<StoryAdvice>
    grade(req: GradeRequest): Promise<GradeAdvice>
    read(req: ReadRequest): Promise<ReadResult>
  }
}

export interface StoryRequest {
  projectId: string
  genre: Genre
  brief: Brief
  frames: { shotId: string; scene: number; time: string; shotType: ShotType; faces: number; picked: boolean }[]
}

export interface ReadRequest {
  projectId: string
  genre: Genre
  brief: Brief
  beats: Beat[]
  frames: { shotId: string; scene: number; time: string; shotType: ShotType; flaws: string }[]
}

export interface ReadResult {
  reads: Record<string, NarrativeRead>
  usage: Usage
}

export interface GradeRequest {
  projectId: string
  genre: Genre
  brief: Brief
  shotId: string
  measurements: string
}

export const RAW_EXTENSIONS = ['arw', 'raf', 'cr2', 'cr3', 'nef', 'dng', 'orf', 'rw2', 'pef', 'srw']
export const IMAGE_EXTENSIONS = [...RAW_EXTENSIONS, 'jpg', 'jpeg']

export const MODELS: { id: string; label: string; inPerM: number; outPerM: number }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best advice', inPerM: 4, outPerM: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — cheaper', inPerM: 2, outPerM: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — cheapest', inPerM: 0.1, outPerM: 0.5 }
]
export const DEFAULT_MODEL = MODELS[0].id

export function emptyBrief(): Brief {
  return {
    client: '',
    clientAsk: '',
    intention: '',
    moodWords: '',
    references: '',
    deliverables: '',
    targetCount: 0,
    deadline: ''
  }
}
