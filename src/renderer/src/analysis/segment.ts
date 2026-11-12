import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

/** What each pixel of a person is. */
export interface PersonMasks {
  w: number
  h: number
  /** Everything that belongs to a person: hair, skin, clothes, accessories. */
  subject: Uint8Array
  /** Face and body skin. */
  skin: Uint8Array
  /** Skin of the face only, and of everything else (neck, arms, hands, legs). */
  faceSkin: Uint8Array
  bodySkin: Uint8Array
  hair: Uint8Array
  clothes: Uint8Array
}

// Categories of the selfie multiclass model.
const HAIR = 1
const BODY_SKIN = 2
const FACE_SKIN = 3
const CLOTHES = 4

let segmenter: Promise<ImageSegmenter | null> | null = null

function getSegmenter(): Promise<ImageSegmenter | null> {
  segmenter ??= (async () => {
    const base = new URL('mediapipe/', document.baseURI).href
    try {
      const fileset = await FilesetResolver.forVisionTasks(base + 'wasm')
      return await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'selfie_multiclass.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false
      })
    } catch (err) {
      console.warn('Segmentation model unavailable; the diagnosis will work without subject and skin masks.', err)
      return null
    }
  })()
  return segmenter
}

/**
 * Separates people from background and marks their skin, hair and clothes,
 * returned at the requested size. null when the model is unavailable or finds
 * nobody. The model works at 256 px, so masks are soft: right for reading a
 * picture, a starting point rather than a finished mask for retouching.
 */
export async function segmentPeople(image: HTMLCanvasElement, w: number, h: number): Promise<PersonMasks | null> {
  const model = await getSegmenter()
  if (!model) return null
  let result
  try {
    result = model.segment(image)
  } catch (err) {
    console.warn('Segmentation failed; continuing without masks.', err)
    segmenter = Promise.resolve(null)
    return null
  }
  const mask = result.categoryMask
  if (!mask) return null
  const src = mask.getAsUint8Array()
  const out: PersonMasks = { w, h, subject: new Uint8Array(w * h), skin: new Uint8Array(w * h), faceSkin: new Uint8Array(w * h), bodySkin: new Uint8Array(w * h), hair: new Uint8Array(w * h), clothes: new Uint8Array(w * h) }
  let found = 0
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mask.height - 1, Math.floor(((y + 0.5) / h) * mask.height))
    for (let x = 0; x < w; x++) {
      const c = src[sy * mask.width + Math.min(mask.width - 1, Math.floor(((x + 0.5) / w) * mask.width))]
      if (!c) continue
      const i = y * w + x
      out.subject[i] = 1
      found++
      if (c === BODY_SKIN || c === FACE_SKIN) {
        out.skin[i] = 1
        ;(c === FACE_SKIN ? out.faceSkin : out.bodySkin)[i] = 1
      }
      if (c === HAIR) out.hair[i] = 1
      else if (c === CLOTHES) out.clothes[i] = 1
    }
  }
  result.close()
  // A handful of stray pixels is not a person.
  return found > w * h * 0.004 ? out : null
}
