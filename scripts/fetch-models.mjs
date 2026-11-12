// Downloads the on-device face and person models and copies the MediaPipe WASM runtime
// into the renderer's public folder. Runs on `npm install`; safe to re-run.
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'src/renderer/public/mediapipe')
mkdirSync(pub, { recursive: true })

const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
if (existsSync(wasmSrc)) cpSync(wasmSrc, join(pub, 'wasm'), { recursive: true })
else console.warn('[fetch-models] @mediapipe/tasks-vision not installed yet; skipping WASM copy')

const models = {
  // Reads eyes, expression and head turn from a face.
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  // Finds people, so that small faces in group and wide shots can be read up close.
  'efficientdet_lite0.tflite':
    'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
  // Separates a person into hair, skin, clothes and background, for the photo diagnosis.
  'selfie_multiclass.tflite':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
}

for (const [name, url] of Object.entries(models)) {
  const file = join(pub, name)
  if (existsSync(file)) continue
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    console.log(`[fetch-models] downloaded ${name}`)
  } catch (err) {
    console.warn(
      `[fetch-models] could not download ${name} (${err.message}). ` +
        `Face checks will be limited until you place it at ${file}\n  ${url}`
    )
  }
}
