import type { Analysis, Shot } from '@shared/types'
import { colorStats } from './color'
import { analyseBodies, identify } from './body'
import { analyseFaces } from './faces'
import { ANALYSIS_EDGE, dHash, loadOriented, PREVIEW_EDGE, resized, rgba, subjectSharpness, THUMB_EDGE, toGray, toJpeg } from './image'
import { classifyShot } from './scoring'

export interface IngestOptions {
  /** Faster analysis for very large shoots: focus measured on the preview, no second look for small faces. */
  fast?: boolean
  /** Asked for each expressive face: should a small picture of it be kept (because the app cannot name the expression)? */
  wantFace?: (shapes: number[]) => boolean
}

export interface Ingested {
  patch: Partial<Shot>
  /** Faces whose expression the app could not name, with a small picture of each. */
  faces: { shapes: number[]; thumb: string }[]
}

/** A small picture of one face, as a data URL, for teaching the emotion machine. */
export function faceThumb(preview: HTMLCanvasElement | HTMLImageElement, f: { x: number; y: number; w: number; h: number }, size = 88): string {
  const pw = 'naturalWidth' in preview ? preview.naturalWidth : preview.width
  const ph = 'naturalHeight' in preview ? preview.naturalHeight : preview.height
  const side = Math.max(f.w * pw, f.h * ph) * 1.3
  const c = document.createElement('canvas')
  c.width = c.height = size
  c.getContext('2d')!.drawImage(preview, (f.x + f.w / 2) * pw - side / 2, (f.y + f.h / 2) * ph - side / 2, side, side, 0, 0, size, size)
  return c.toDataURL('image/jpeg', 0.72)
}

/**
 * Brings one photo into the project: extracts the camera's embedded preview,
 * caches a preview and thumbnail, and measures it. Nothing leaves the machine.
 */
export async function ingestShot(projectId: string, shot: Shot, options: IngestOptions = {}): Promise<Ingested> {
  const extracted = await window.studio.extract(projectId, shot.id, shot.path)
  const blob = await (await fetch(extracted.url)).blob()
  const full = await loadOriented(blob, extracted.applyOrientation, options.fast ? PREVIEW_EDGE : ANALYSIS_EDGE)
  const preview = resized(full, PREVIEW_EDGE)
  const thumb = resized(preview, THUMB_EDGE)

  await window.studio.savePreview(projectId, shot.id, await toJpeg(preview, 0.86), await toJpeg(thumb, 0.8))

  const previewPixels = rgba(preview)
  const gray = toGray(full === preview ? previewPixels : rgba(full))
  const faces = await analyseFaces(preview, previewPixels, gray, !options.fast)
  const analysis: Analysis = {
    sharpness: subjectSharpness(gray),
    hash: dHash(preview),
    color: colorStats(rgba(thumb)),
    faces,
    shotType: classifyShot(faces),
    bodies: await analyseBodies(preview)
  }
  // Telling people apart costs a model run per face, so the fast import leaves it out.
  if (!options.fast) await identify(preview, previewPixels, faces)
  const unnamed = options.wantFace
    ? faces.filter((f) => f.shapes && f.h >= 0.05 && options.wantFace!(f.shapes)).slice(0, 3).map((f) => ({ shapes: f.shapes!, thumb: faceThumb(preview, f) }))
    : []
  return { patch: { ...extracted.meta, width: full.width, height: full.height, analysis, error: undefined }, faces: unnamed }
}

export const previewUrl = (projectId: string, shotId: string): string => `media://local/${projectId}/cache/${shotId}.jpg`
export const thumbUrl = (projectId: string, shotId: string): string => `media://local/${projectId}/cache/${shotId}_t.jpg`
