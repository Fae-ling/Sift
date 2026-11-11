import type { Analysis, Shot } from '@shared/types'
import { colorStats } from './color'
import { analyseFaces } from './faces'
import { dHash, loadOriented, PREVIEW_EDGE, resized, rgba, subjectSharpness, THUMB_EDGE, toGray, toJpeg } from './image'
import { classifyShot } from './scoring'

/**
 * Brings one photo into the project: extracts the camera's embedded preview,
 * caches a preview and thumbnail, and measures it. Nothing leaves the machine.
 */
export async function ingestShot(projectId: string, shot: Shot): Promise<Partial<Shot>> {
  const extracted = await window.studio.extract(projectId, shot.id, shot.path)
  const blob = await (await fetch(extracted.url)).blob()
  const full = await loadOriented(blob, extracted.applyOrientation)
  const preview = resized(full, PREVIEW_EDGE)
  const thumb = resized(preview, THUMB_EDGE)

  await window.studio.savePreview(projectId, shot.id, await toJpeg(preview, 0.86), await toJpeg(thumb, 0.8))

  const previewPixels = rgba(preview)
  const gray = toGray(full === preview ? previewPixels : rgba(full))
  const faces = await analyseFaces(preview, previewPixels, gray)
  const analysis: Analysis = {
    sharpness: subjectSharpness(gray),
    hash: dHash(preview),
    color: colorStats(rgba(thumb)),
    faces,
    shotType: classifyShot(faces)
  }
  return { ...extracted.meta, width: full.width, height: full.height, analysis, error: undefined }
}

export const previewUrl = (projectId: string, shotId: string): string => `media://local/${projectId}/cache/${shotId}.jpg`
export const thumbUrl = (projectId: string, shotId: string): string => `media://local/${projectId}/cache/${shotId}_t.jpg`
