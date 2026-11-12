// Bodies and identities, measured on-device at import.
//
//  - The pose model finds up to six bodies and the position of their joints,
//    which gesture.ts turns into gesture measurements.
//  - A small general-purpose image model turns a tight picture of each face
//    into numbers. Together with hair and clothes colour, that is enough to
//    tell the people of one shoot apart (people.ts). It is not face
//    recognition: it cannot say who someone is, only "the same person as there".

import { FilesetResolver, ImageEmbedder, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { BodyInfo, FaceInfo } from '@shared/types'
import { poseCues, withOthers } from './gesture'

const base = (): string => new URL('mediapipe/', document.baseURI).href

let pose: Promise<PoseLandmarker | null> | null = null
function getPose(): Promise<PoseLandmarker | null> {
  pose ??= (async () => {
    try {
      const fileset = await FilesetResolver.forVisionTasks(base() + 'wasm')
      return await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base() + 'pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 6,
        minPoseDetectionConfidence: 0.4
      })
    } catch (err) {
      console.warn('Pose model unavailable; gestures are not read.', err)
      return null
    }
  })()
  return pose
}

/** The bodies in a frame and what each is doing. Empty when the model is not installed. */
export async function analyseBodies(preview: HTMLCanvasElement): Promise<BodyInfo[]> {
  const model = await getPose()
  if (!model) return []
  let found
  try {
    found = model.detect(preview)
  } catch (err) {
    console.warn('Pose detection failed; gestures are not read.', err)
    pose = Promise.resolve(null)
    return []
  }
  const aspect = preview.width / preview.height
  const bodies: BodyInfo[] = []
  for (const marks of found.landmarks) {
    const seen = marks.filter((m) => (m.visibility ?? 0) >= 0.5)
    if (seen.length < 6) continue
    const xs = seen.map((m) => m.x)
    const ys = seen.map((m) => m.y)
    const x = Math.max(0, Math.min(...xs))
    const y = Math.max(0, Math.min(...ys))
    const g = poseCues(marks.map((m) => ({ x: m.x, y: m.y, v: m.visibility ?? 0 })), aspect)
    bodies.push({ x, y, w: Math.min(1, Math.max(...xs)) - x, h: Math.min(1, Math.max(...ys)) - y, g })
  }
  withOthers(bodies, aspect)
  for (const b of bodies) b.g = b.g.map((v) => Math.round(v * 100))
  return bodies.sort((a, b) => b.w * b.h - a.w * a.h)
}

let embedder: Promise<ImageEmbedder | null> | null = null
function getEmbedder(): Promise<ImageEmbedder | null> {
  embedder ??= (async () => {
    try {
      const fileset = await FilesetResolver.forVisionTasks(base() + 'wasm')
      return await ImageEmbedder.createFromOptions(fileset, { baseOptions: { modelAssetPath: base() + 'image_embedder.tflite', delegate: 'CPU' }, runningMode: 'IMAGE' })
    } catch (err) {
      console.warn('Embedding model unavailable; people are told apart by hair and clothes only.', err)
      return null
    }
  })()
  return embedder
}

export const ID_SIZE = 48
let projection: Int8Array | null = null
/** A fixed random projection (the same on every machine), so that a long embedding can be stored as 48 numbers. */
function project(v: Float32Array | number[]): number[] {
  if (!projection || projection.length !== v.length * ID_SIZE) {
    projection = new Int8Array(v.length * ID_SIZE)
    let seed = 0x2545f491
    for (let i = 0; i < projection.length; i++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      projection[i] = seed & 1 ? 1 : -1
    }
  }
  const out = new Array<number>(ID_SIZE).fill(0)
  for (let k = 0; k < ID_SIZE; k++) {
    let sum = 0
    const row = k * v.length
    for (let i = 0; i < v.length; i++) sum += v[i] * projection[row + i]
    out[k] = sum
  }
  const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1
  return out.map((x) => Math.round((100 * x) / n))
}

/** Mean colour of a rectangle of the preview (0..1 coordinates), as r, g, b. */
function meanColour(pixels: ImageData, x0: number, y0: number, x1: number, y1: number): number[] {
  const ax = Math.max(0, Math.round(x0 * pixels.width)), bx = Math.min(pixels.width, Math.round(x1 * pixels.width))
  const ay = Math.max(0, Math.round(y0 * pixels.height)), by = Math.min(pixels.height, Math.round(y1 * pixels.height))
  let r = 0, g = 0, b = 0, n = 0
  const step = Math.max(1, Math.floor(Math.min(bx - ax, by - ay) / 12))
  for (let y = ay; y < by; y += step) {
    for (let x = ax; x < bx; x += step) {
      const p = (y * pixels.width + x) * 4
      r += pixels.data[p]
      g += pixels.data[p + 1]
      b += pixels.data[p + 2]
      n++
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0]
}

/** At most this many faces per frame are told apart; smaller ones are background. */
const MAX_IDS = 6

/**
 * Adds to each sizeable face what tells it from others: numbers from a tight
 * picture of it, and the colour of the hair above it and the clothes below.
 */
export async function identify(preview: HTMLCanvasElement, pixels: ImageData, faces: FaceInfo[]): Promise<void> {
  const model = await getEmbedder()
  const crop = document.createElement('canvas')
  crop.width = crop.height = 112
  const ctx = crop.getContext('2d')!
  for (const f of faces.filter((x) => x.h >= 0.06).slice(0, MAX_IDS)) {
    f.wear = [
      ...meanColour(pixels, f.x + f.w * 0.15, f.y - f.h * 0.3, f.x + f.w * 0.85, f.y + f.h * 0.02),
      ...meanColour(pixels, f.x - f.w * 0.2, f.y + f.h * 1.45, f.x + f.w * 1.2, f.y + f.h * 2.4)
    ]
    if (!model) continue
    const side = Math.max(f.w * preview.width, f.h * preview.height) * 1.15
    ctx.drawImage(preview, (f.x + f.w / 2) * preview.width - side / 2, (f.y + f.h / 2) * preview.height - side / 2, side, side, 0, 0, 112, 112)
    try {
      const e = model.embed(crop).embeddings[0]
      if (e?.floatEmbedding) f.id = project(e.floatEmbedding)
    } catch (err) {
      console.warn('Embedding failed; continuing without it.', err)
      embedder = Promise.resolve(null)
      return
    }
  }
}
