import { FaceLandmarker, FilesetResolver, ObjectDetector, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import type { FaceInfo } from '@shared/types'
import { rgbToHsv } from './color'
import { laplacianVariance, type Gray } from './image'

type Delegate = 'GPU' | 'CPU'
let delegate: Delegate = document.createElement('canvas').getContext('webgl2') ? 'GPU' : 'CPU'
let landmarker: Promise<FaceLandmarker | null> | null = null

/** Loads the on-device face model once. Resolves to null if it is unavailable. */
function getLandmarker(): Promise<FaceLandmarker | null> {
  landmarker ??= (async () => {
    const base = new URL('mediapipe/', document.baseURI).href
    try {
      const fileset = await FilesetResolver.forVisionTasks(base + 'wasm')
      return await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate },
        runningMode: 'IMAGE',
        numFaces: 10,
        outputFaceBlendshapes: true
      })
    } catch (err) {
      console.warn('Face model unavailable; face checks are off.', err)
      return null
    }
  })()
  return landmarker
}

/**
 * Runs the model. If the graphics-card path fails it retries on the processor;
 * if that fails too, face checks are switched off rather than failing the import.
 */
async function detect(image: HTMLCanvasElement): Promise<FaceLandmarkerResult | null> {
  for (;;) {
    const model = await getLandmarker()
    if (!model) return null
    try {
      return model.detect(image)
    } catch (err) {
      if (delegate === 'CPU') {
        console.warn('Face detection failed; face checks are off.', err)
        landmarker = Promise.resolve(null)
        return null
      }
      delegate = 'CPU'
      landmarker = null
    }
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

let peopleFinder: Promise<ObjectDetector | null> | null = null
/** At most this many people per frame get a close look; beyond that the frame is a crowd. */
const MAX_PEOPLE = 14

/** Finds the people in a frame (boxes in pixels). Empty if the model is not installed. */
async function findPeople(image: HTMLCanvasElement): Promise<Box[]> {
  peopleFinder ??= (async () => {
    const base = new URL('mediapipe/', document.baseURI).href
    try {
      const fileset = await FilesetResolver.forVisionTasks(base + 'wasm')
      return await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'efficientdet_lite0.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
        scoreThreshold: 0.3,
        maxResults: MAX_PEOPLE
      })
    } catch (err) {
      console.warn('Person model unavailable; small faces in group shots may be missed.', err)
      return null
    }
  })()
  const model = await peopleFinder
  if (!model) return []
  try {
    return model.detect(image).detections.flatMap((d) =>
      d.boundingBox ? [{ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height }] : []
    )
  } catch (err) {
    console.warn('Person detection failed; continuing without it.', err)
    peopleFinder = Promise.resolve(null)
    return []
  }
}

/** True when faces can actually be analysed on this machine (checked with a blank test image). */
export async function facesAvailable(): Promise<boolean> {
  const probe = document.createElement('canvas')
  probe.width = probe.height = 64
  probe.getContext('2d')!.fillRect(0, 0, 64, 64)
  return (await detect(probe)) !== null
}

interface Mark {
  x: number
  y: number
}
interface Category {
  categoryName: string
  score: number
}

// Landmark indices of the MediaPipe face mesh.
const EYES = [33, 133, 159, 145, 362, 263, 386, 374]
const CHEEKS = [50, 280]
const NOSE = 1
const EDGE_A = 234
const EDGE_B = 454

/**
 * Finds faces and reads, for each: whether the eyes are open, how much it is
 * smiling, how sharp the eyes are, and the skin colour on the cheeks.
 * `preview` is what the model looks at; `gray` (possibly larger) is where
 * eye sharpness is measured.
 */
export async function analyseFaces(preview: HTMLCanvasElement, pixels: ImageData, gray: Gray): Promise<FaceInfo[]> {
  const result = await detect(preview)
  if (!result) return []
  const faces: FaceInfo[] = []

  const add = (marks: Mark[], categories: Category[] | undefined): void => {
    let minX = 1
    let minY = 1
    let maxX = 0
    let maxY = 0
    for (const m of marks) {
      minX = Math.min(minX, m.x)
      minY = Math.min(minY, m.y)
      maxX = Math.max(maxX, m.x)
      maxY = Math.max(maxY, m.y)
    }
    const w = maxX - minX
    const h = maxY - minY
    if (w <= 0 || h <= 0) return

    // A face found again in an overlapping tile is the same face.
    const cx = minX + w / 2
    const cy = minY + h / 2
    if (faces.some((f) => cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h)) return

    const shape = (name: string): number => categories?.find((c) => c.categoryName === name)?.score ?? 0

    // Eye band, padded a little so lashes and brows (the sharpest detail) are included.
    const ex = EYES.map((k) => marks[k].x)
    const ey = EYES.map((k) => marks[k].y)
    const padX = w * 0.08
    const padY = h * 0.06
    const sharpness = laplacianVariance(
      gray,
      (Math.min(...ex) - padX) * gray.w,
      (Math.min(...ey) - padY) * gray.h,
      (Math.max(...ex) + padX) * gray.w,
      (Math.max(...ey) + padY) * gray.h
    )

    // Average a small patch on each cheek for skin colour.
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    const radius = Math.max(2, Math.round(w * pixels.width * 0.04))
    for (const k of CHEEKS) {
      const cx = Math.round(marks[k].x * pixels.width)
      const cy = Math.round(marks[k].y * pixels.height)
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue
          const p = (y * pixels.width + x) * 4
          r += pixels.data[p]
          g += pixels.data[p + 1]
          b += pixels.data[p + 2]
          n++
        }
      }
    }
    const skin = n ? rgbToHsv(r / n, g / n, b / n) : null

    faces.push({
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      w,
      h,
      blink: Math.max(shape('eyeBlinkLeft'), shape('eyeBlinkRight')),
      smile: (shape('mouthSmileLeft') + shape('mouthSmileRight')) / 2,
      jawOpen: shape('jawOpen'),
      squint: (shape('cheekSquintLeft') + shape('cheekSquintRight') + shape('eyeSquintLeft') + shape('eyeSquintRight')) / 4,
      // Where the nose sits between the two edges of the face tells which way the head is turned.
      yaw: Math.max(-1, Math.min(1, ((marks[NOSE].x - (marks[EDGE_A].x + marks[EDGE_B].x) / 2) / Math.max(1e-6, Math.abs(marks[EDGE_B].x - marks[EDGE_A].x))) * 2)),
      sharpness,
      skinHue: skin ? skin[0] : null,
      skinSat: skin ? skin[1] : null
    })
  }

  result.faceLandmarks.forEach((marks, i) => add(marks, result.faceBlendshapes?.[i]?.categories))

  // The face model only finds faces that fill a fair part of what it is shown, so faces
  // far from the camera vanish: exactly the ones that matter in a group portrait or a
  // wide shot of the ceremony. When the first look finds nobody, several people, or only
  // small faces, find the people instead, and look at each person's head up close.
  const worthASecondLook = faces.length === 0 || faces.length >= 2 || faces.some((f) => f.h < 0.16)
  const people = worthASecondLook ? await findPeople(preview) : []
  if (people.length) {
    const crop = document.createElement('canvas')
    const ctx = crop.getContext('2d')!
    for (const person of people) {
      // The head is at the top of a person: the upper half of a standing figure,
      // most of the box when only head and shoulders are in frame.
      const cw = Math.min(preview.width, person.w * 1.2)
      const ch = Math.min(preview.height, Math.max(person.h * 0.5, Math.min(person.h, person.w)) * 1.1)
      const cx = Math.max(0, Math.min(preview.width - cw, person.x - person.w * 0.1))
      const cy = Math.max(0, Math.min(preview.height - ch, person.y - person.h * 0.05))
      crop.width = Math.round(cw)
      crop.height = Math.round(ch)
      ctx.drawImage(preview, cx, cy, cw, ch, 0, 0, crop.width, crop.height)
      const found = await detect(crop)
      found?.faceLandmarks.forEach((marks, i) =>
        add(
          marks.map((m) => ({ x: (cx + m.x * cw) / preview.width, y: (cy + m.y * ch) / preview.height })),
          found.faceBlendshapes?.[i]?.categories
        )
      )
    }
  }
  // Largest (most important) face first.
  return faces.sort((a, b) => b.w * b.h - a.w * a.h)
}
