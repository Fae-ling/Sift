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
  /** The face model's 51 expression measurements, 0..100 each, in the order of SHAPES in emotion.ts. */
  shapes?: number[]
  /** What tells this face from others in the shoot: 48 numbers (-100..100) from a small picture of it. */
  id?: number[]
  /** Hair and clothes colour (r, g, b each, 0..255): people rarely change either during a shoot. */
  wear?: number[]
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

/** One body found in the frame, and what its limbs are doing. */
export interface BodyInfo {
  /** Bounding box in 0..1 image coordinates. */
  x: number
  y: number
  w: number
  h: number
  /** Gesture measurements, 0..100 each, in the order of GESTURE_CUES in gesture.ts. */
  g: number[]
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
  /** The bodies in the frame and their gestures. Absent for frames measured before gestures were read. */
  bodies?: BodyInfo[]
  /** Composition readings from the photo diagnosis, taken for the strongest frames of each moment. */
  diag?: { merged?: number; attention?: number; pull?: number }
}

export type Decision = 'pick' | 'reject' | null
export type Suggestion = 'pick' | 'alternate' | 'reject'

export type MomentTag = 'laugh' | 'joy' | 'connection' | 'embrace' | 'peak' | 'rare'

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
  /** The strongest emotion read in the frame, and how strongly it shows (0..1). */
  emotion?: { name: string; intensity: number }
  /** The emotion read on each face, in the order of the analysis' faces; null for a face at rest. */
  faceEmotions?: (string | null)[]
  /** How much the style values the emotions shown, -1..1. */
  emotionValue?: number
  /** The strongest gesture read in the frame, and how strongly it shows (0..1). */
  gesture?: { name: string; intensity: number }
  /** What is happening in the frame, in a sentence, as far as the app can tell by itself. */
  happening?: string
  /** What is happening, as words: Claude's where it has looked, else what the app recognises from what Claude taught it. */
  happens?: string[]
  /** Names of the key people the app believes are in the frame. */
  keyPeople?: string[]
  /** What the frame brings (emotion, gesture, a key person, a rare moment...) and what is wrong with it. */
  assets?: string[]
  flaws?: string[]
  /** How the photographer's past choices weigh this frame's mistakes against what it brings. */
  tradeoff?: string
  /** Belongs to a chapter the style says must not be missed. */
  must?: boolean
  /** The overall score from the built-in rules alone, before the learned taste is mixed in. */
  rules?: number
  /** How likely the photographer is to keep it, 0..100, learned from their own decisions. */
  learned?: number
  /** The measurements that most moved the learned figure. */
  learnedWhy?: string[]
}

/** One chapter of the story a shoot of this kind is expected to tell. */
export interface Beat {
  name: string
  /** A chapter the shoot must not come back without. */
  must?: boolean
  /** What makes a frame from this chapter worth keeping. */
  look: string
}

/**
 * What a set of chosen photographs has in common, measured on-device. Built
 * from a photographer's gallery or from the user's own picks.
 */
export interface StyleProfile {
  count: number
  /** Share of frames with at least one face. */
  facesShare: number
  /** Mean joy and closeness (0..1) among frames with faces. */
  expression: number
  connection: number
  laughShare: number
  /** Share of frames with faces where eyes are closed or lowered: chosen anyway. */
  closedEyesShare: number
  shotTypes: Record<ShotType, number>
  luma: number
  contrast: number
  saturation: number
  warmth: number
}

/** What Claude distilled from looking at a reference gallery. */
export interface StyleEssence {
  summary: string
  /** How this photographer seems to choose. */
  principles: string[]
  lookFor: string[]
  forgive: string[]
  usage?: Usage
}

/** Something a culling profile has learned from. */
export interface StyleSource {
  name: string
  kind: 'gallery' | 'own-picks'
  count: number
  addedAt: number
}

/**
 * A culling profile: a feeling to cull for. It holds the words that describe
 * the atmosphere and everything learned from the galleries and picks added to
 * it. Shared by all projects. (Called "Style" in code.)
 */
export interface Style {
  id: string
  name: string
  /** Atmosphere words, e.g. "intimate", "joyful", "editorial". They steer the cull. */
  tags: string[]
  /** The feeling in a sentence or two, in the photographer's words. */
  feeling: string
  /** The broad kind of work it belongs to, which sets sensible starting weights. */
  family: Genre
  /** The chapters a shoot in this style should contain; some are marked as not to be missed. */
  chapters: Beat[]
  /** How much this style values each emotion, -1..1. Emotions not listed take the family's default. */
  emotions: Record<string, number>
  /** What the photographer's own decisions in this style say about each emotion: lift -1..1 over n frames. */
  emotionLift?: Record<string, { w: number; n: number }>
  /** How much the moment counts against craft in this style, 0..1. */
  balance: number
  /** Markers: what to look for, and what to forgive, in this style. */
  lookFor: string[]
  forgive: string[]
  createdAt: number
  sources: StyleSource[]
  /** What the added photographs have in common. null until something is added. */
  profile: StyleProfile | null
  /** Ids of the sample thumbnails kept for display and for the essence. */
  samples: string[]
  essence?: StyleEssence
  /** How many photographs the profile held when the essence was distilled. */
  essenceCount?: number
}

/** What the app has learned across projects. */
export interface Learned {
  styles: Style[]
  /** The craft/moment balance that matched the user's own choices, per kind of shoot. */
  balance: Partial<Record<Genre, { value: number; projects: number }>>
  /** True once the starter profiles have been created (so deleting them sticks). */
  seeded?: boolean
  /** True once the starter shoot styles of the second generation have been created. */
  seededStyles?: boolean
  /** Per style, per project: what that project's decisions said about each emotion. */
  lifts?: Record<string, Record<string, Record<string, { w: number; n: number }>>>
}

/** A picture editor's reading of one frame (from the optional AI read). */
export interface NarrativeRead {
  beat: string
  /** The emotion Claude saw in the frame, in a word or two. */
  emotion?: string
  /** 0..10: how much the frame carries emotionally and for the story. */
  moment: number
  gem: boolean
  note: string
  /** What is happening in the frame, in one plain sentence. */
  what?: string
  /** What is happening, as two to five lowercase words or short phrases ("first dance", "toast"). */
  tags?: string[]
  /** The gesture that carries the frame, if one does. */
  gesture?: string
}

/** Someone who appears in a shoot. Belongs to one project: faces are told apart, never identified. */
export interface Person {
  id: string
  /** What the photographer calls them: "bride", "Marta", "the duke". Empty until named. */
  name: string
  /** A key person: frames of them count for more, and the story should not come back without them. */
  key: boolean
  /** A few faces known to be theirs (id vectors), and what they wore. */
  faces: number[][]
  wear: number[][]
  /** A small picture of them, as a data URL. */
  thumb?: string
}

/** One re-estimate of a culled project: how well today's app would have predicted the decisions made in it. */
export interface Estimate {
  at: number
  /** Decided frames it was measured on. */
  frames: number
  /** Share of moments where the app's keeper is a frame the photographer kept: at the time of deciding, and now. */
  then: number | null
  now: number
  /** Moments compared. */
  moments: number
}

export type Warning = 'blink' | 'soft' | 'soft-face' | 'clipped' | 'dark' | 'misfire' | 'blurred'

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
  /** Which camera body took it (model plus serial number), for clock correction. */
  body?: string
  analysis?: Analysis
  score?: Score
  sceneId?: number
  stackId?: number
  suggestion?: Suggestion
  read?: NarrativeRead
  /** Who each face is (a Person id, or null), in the order of the analysis' faces. */
  people?: (string | null)[]
  /** Indices of faces the photographer assigned to a person by hand: left alone when people are found again. */
  peopleSet?: number[]
  /** What is happening, in the photographer's own words, where they have said so. */
  tags?: string[]
  /** The chapter of the story this frame belongs to, when the photographer has said so. */
  chapter?: string
  decision: Decision
  /** How the decision was made: by hand, or by accepting a suggestion. */
  decidedBy?: 'manual' | 'accepted'
  /** What was being suggested when the decision was made. */
  suggestedThen?: Suggestion
  /** Decided while no suggestion was shown for its burst. */
  blind?: boolean
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
  /** Seconds to add to each camera body's clock so that two cameras line up. */
  clockOffsets: Record<string, number>
  /** The shoot style this project is culled with. */
  styleIds: string[]
  /** Faster analysis for very large shoots: smaller focus measurement, no second look for small faces. */
  fastImport?: boolean
  storyOrder: string[]
  storyAdvice?: StoryAdvice
  /** The people of this shoot, as far as the app has told them apart. */
  people?: Person[]
  /** Re-estimates of this project over time. */
  estimates?: Estimate[]
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
  meta: Pick<Shot, 'time' | 'iso' | 'shutter' | 'aperture' | 'focal' | 'lens' | 'camera' | 'body'>
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
    /** `analysisChanged` says the measurements changed too, so the (large) analysis file is rewritten. */
    save(project: Project, analysisChanged?: boolean): Promise<void>
    remove(id: string): Promise<void>
  }
  pickFolder(): Promise<string | null>
  /** Lets the user choose one image file of any kind. */
  pickImage(): Promise<string | null>
  /** Asks where to save, then writes the text. Returns the path, or null if cancelled. */
  saveText(defaultName: string, content: string): Promise<string | null>
  /** Writes several files (masks) into a folder. Files that already exist are left alone. */
  saveFiles(folder: string, files: { name: string; data: ArrayBuffer }[]): Promise<ExportResult>
  /** `anyImage` also lists PNG and WebP, for reference galleries saved from the web. */
  scan(folder: string, anyImage?: boolean): Promise<ScannedFile[]>
  learned: {
    get(): Promise<Learned>
    save(learned: Learned): Promise<void>
    /** Deletes the sample thumbnails of a removed style. */
    removeSamples(styleId: string): Promise<void>
  }
  extract(projectId: string, shotId: string, path: string): Promise<ExtractResult>
  savePreview(projectId: string, shotId: string, preview: ArrayBuffer, thumb: ArrayBuffer): Promise<void>
  exportXmp(items: XmpItem[]): Promise<ExportResult>
  copySelects(paths: string[], dest: string): Promise<ExportResult>
  reveal(path: string): Promise<void>
  /** Named stores of what the app has learned (emotions, ...), opaque to the main process. */
  data: {
    get(name: string): Promise<unknown>
    save(name: string, value: unknown): Promise<void>
  }
  /** The stored examples the taste model is trained on (opaque to the main process). */
  learning: {
    get(): Promise<unknown>
    save(data: unknown): Promise<void>
  }
  /** What has been learned from photographs the user provided for training (opaque to the main process). */
  training: {
    get(): Promise<unknown>
    save(data: unknown): Promise<void>
  }
  /** Star ratings and colour labels already given to photos, from their sidecars or the files themselves. */
  readRatings(paths: string[]): Promise<{ path: string; rating: number | null; label: string | null }[]>
  /** What the optional Claude advice has cost, by month (YYYY-MM) in US dollars. */
  spend(): Promise<Record<string, number>>
  settings: {
    get(): Promise<Settings>
    set(patch: { apiKey?: string; model?: string }): Promise<Settings>
  }
  ai: {
    story(req: StoryRequest): Promise<StoryAdvice>
    read(req: ReadRequest): Promise<ReadResult>
    essence(req: EssenceRequest): Promise<StyleEssence>
    diagnose(req: DiagnoseRequest): Promise<DiagnosisAdvice>
    nameFaces(req: NameFacesRequest): Promise<NameFacesResult>
    developStyle(req: DevelopStyleRequest): Promise<StyleProposal>
    atmosphere(req: AtmosphereRequest): Promise<AtmosphereAdvice>
  }
}

export interface StoryRequest {
  projectId: string
  genre: Genre
  brief: Brief
  /** What the app has learned about this photographer so far, in plain text. */
  context?: string
  frames: { shotId: string; scene: number; time: string; shotType: ShotType; faces: number; picked: boolean }[]
}

/** Asks Claude what emotion each of a set of faces shows. */
export interface NameFacesRequest {
  /** Small JPEGs of faces, as base64 without the data-URL prefix. */
  faces: { id: string; jpeg: string }[]
  /** Emotions the app already knows, to be reused where they fit. */
  vocabulary: { name: string; description: string }[]
  /** What kind of work these faces come from, so that names fit it. */
  context: string
}

export interface NameFacesResult {
  names: { id: string; emotion: string; description: string; valence: number; arousal: number }[]
  usage: Usage
}

/** Asks Claude to develop or refine a shoot style. */
export interface DevelopStyleRequest {
  name: string
  family: Genre
  /** The style as it stands, in plain text. */
  current: string
  /** What the photographer's own work in this style shows, in plain text; empty for a new style. */
  evidence: string
  vocabulary: string[]
  /** Frames the photographer kept in this style, to look at. */
  samples?: { cacheId: string; shotIds: string[] }
}

export interface StyleProposal {
  feeling: string
  tags: string[]
  chapters: Beat[]
  emotions: { name: string; weight: number; why: string }[]
  lookFor: string[]
  forgive: string[]
  balance: number
  /** What changed and why, for the photographer to read before accepting. */
  notes: string
  usage?: Usage
}

/** Asks Claude how a look could be shaped to carry a shoot's concept. */
export interface AtmosphereRequest {
  concept: string
  /** The look as measured, in plain sentences. */
  measured: string
  /** A JPEG of the photo the look is for, as base64 without the data-URL prefix. */
  jpeg: string
}

/** A look described by the handful of controls it is made of. */
export interface LookParams {
  /** Black point 0..0.15 and white point 0.85..1. */
  blackLift: number
  whiteHold: number
  /** Midtone contrast, -0.4 (flatter) .. 0.4 (steeper). */
  contrast: number
  /** Tint of shadows, midtones and highlights: hue 0..360 and strength 0..40. */
  shadowHue: number
  shadowStrength: number
  midHue: number
  midStrength: number
  highlightHue: number
  highlightStrength: number
  /** Colourfulness, 0.5 (muted) .. 1.5 (vivid). */
  saturation: number
}

export interface AtmosphereAdvice {
  reading: string
  moves: { what: string; why: string }[]
  look: LookParams
  usage?: Usage
}

export interface DiagnoseRequest {
  /** Cache folder the preview lives in: a project id, or 'diagnose' for a photo opened by itself. */
  cacheId: string
  shotId: string
  /** The brief, when the photo belongs to a project. */
  brief: string
  /** What the on-device analysis measured, in plain sentences. */
  measured: string
  /** What the app has learned about this photographer so far, in plain text. */
  context?: string
}

/** Claude's reading of one photograph: what it is, what holds it back, what to do. */
export interface DiagnosisAdvice {
  description: string
  diagnosis: string
  adjustments: { what: string; where: string; strength: string; why: string }[]
  /** The part that is a matter of taste and stays with the photographer. */
  yours: string
  usage?: Usage
}

export interface EssenceRequest {
  styleId: string
  name: string
  samples: string[]
  /** The measured profile, in words. */
  facts: string
}

export interface ReadRequest {
  projectId: string
  genre: Genre
  brief: Brief
  beats: Beat[]
  /** The feeling being culled for and what the active profile has learned, if any. */
  styleNotes: string
  /** Emotions the app already knows by name, so that Claude reuses them where they fit. */
  emotions: string[]
  /** Gestures and "what is happening" words the app already knows, to be reused where they fit. */
  gestures?: string[]
  happenings?: string[]
  /** What the app has learned about this photographer and what they have chosen so far, in plain text. */
  context?: string
  frames: { shotId: string; scene: number; time: string; shotType: ShotType; flaws: string; people?: string; decided?: string }[]
}

export interface ReadResult {
  reads: Record<string, NarrativeRead>
  usage: Usage
}

export const RAW_EXTENSIONS = ['arw', 'raf', 'cr2', 'cr3', 'nef', 'dng', 'orf', 'rw2', 'pef', 'srw']
export const IMAGE_EXTENSIONS = [...RAW_EXTENSIONS, 'jpg', 'jpeg']
export const WEB_EXTENSIONS = ['png', 'webp']
/** Styles keep their sample thumbnails in a cache folder named like a project. */
export const styleCacheId = (styleId: string): string => `style-${styleId}`

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
