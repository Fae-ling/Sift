// Downloads the on-device face model and copies the MediaPipe WASM runtime
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

const model = join(pub, 'face_landmarker.task')
const url =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
if (!existsSync(model)) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(model, Buffer.from(await res.arrayBuffer()))
    console.log('[fetch-models] downloaded face_landmarker.task')
  } catch (err) {
    console.warn(
      `[fetch-models] could not download the face model (${err.message}). ` +
        `Face checks will be disabled until you place it at ${model}\n  ${url}`
    )
  }
}
