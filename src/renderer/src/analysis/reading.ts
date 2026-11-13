// Runs every measurement of the photo diagnosis on one preview and gathers the
// results. Used by the cull and by training on finished photos.

import type { FaceInfo } from '@shared/types'
import {
  attentionMap,
  attentionOn,
  blur,
  channels,
  DEFAULT_LIMITS,
  distractions,
  findings,
  notan,
  readBackground,
  ring,
  separation,
  share,
  skinColour,
  skinEvenness,
  skyAndGreen,
  withFaces,
  type Box,
  type Finding,
  type Limits,
  type Plane,
  type Reading
} from './diagnose'
import { analyseFaces, faceParts, type FaceParts } from './faces'
import { resized, rgba, toGray } from './image'
import { segmentPeople, type PersonMasks } from './segment'

/** Long edge of the maps. These are questions about masses and edges, not detail. */
const WORK_EDGE = 384

export interface Analysis {
  preview: HTMLCanvasElement
  plane: Plane
  pixels: ImageData
  faces: FaceInfo[]
  parts: FaceParts[]
  masks: PersonMasks | null
  attention: Float32Array
  attentionWithFaces: Float32Array
  distracting: Box[]
  levels: Uint8Array
  edge: Float32Array | null
  skinMap: Float32Array | null
  sky: Uint8Array
  green: Uint8Array
  reading: Reading
  findings: Finding[]
}

/** Rasterises outlines (points in 0..1) into a 0/1 mask at the working size. */
export function polygonMask(polygons: { x: number; y: number }[][], plane: Plane): Uint8Array {
  const c = document.createElement('canvas')
  c.width = plane.w
  c.height = plane.h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  for (const poly of polygons) {
    ctx.beginPath()
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x * plane.w, p.y * plane.h) : ctx.moveTo(p.x * plane.w, p.y * plane.h)))
    ctx.closePath()
    ctx.fill()
  }
  const data = ctx.getImageData(0, 0, plane.w, plane.h).data
  const out = new Uint8Array(plane.w * plane.h)
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > 127 ? 1 : 0
  return out
}

/** Mean saturation and local contrast inside a mask. */
function character(data: Uint8ClampedArray, luma: Float32Array, soft: Float32Array, mask: Uint8Array): { sat: number; contrast: number } {
  let sat = 0
  let contrast = 0
  let n = 0
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue
    const max = Math.max(data[p], data[p + 1], data[p + 2])
    sat += max ? (max - Math.min(data[p], data[p + 1], data[p + 2])) / max : 0
    contrast += Math.abs(luma[i] - soft[i])
    n++
  }
  return n ? { sat: sat / n, contrast: contrast / n } : { sat: 0, contrast: 0 }
}

/** A band around the subject, cached per mask. */
const margins = new WeakMap<Uint8Array, Uint8Array>()
function margin(subject: Uint8Array, plane: Plane): Uint8Array {
  let m = margins.get(subject)
  if (!m) margins.set(subject, (m = ring(subject, plane, Math.max(plane.w, plane.h) / 30)))
  return m
}

/** `light` skips the eye and lip outlines, for reading many frames quickly during a cull. */
export async function analyse(preview: HTMLCanvasElement, known?: FaceInfo[], limits: Limits = DEFAULT_LIMITS, light = false): Promise<Analysis> {
  const small = resized(preview, WORK_EDGE)
  const plane = { w: small.width, h: small.height }
  const pixels = rgba(small)
  const n = plane.w * plane.h
  const faces = known ?? (await analyseFaces(preview, rgba(preview), toGray(rgba(preview))))
  const parts = light ? [] : await faceParts(preview, faces)
  const masks = await segmentPeople(preview, plane.w, plane.h)
  const { luma } = channels(pixels.data, n)

  const attention = attentionMap(pixels.data, plane)
  const attentionWithFaces = withFaces(attention, plane, faces)
  const subject = masks?.subject ?? null
  // Distractions are judged on what the picture alone does to the eye, without the pull of
  // faces, and outside a margin around the subject so its own halo is not held against it.
  const guarded = subject ? subject.map((v, i) => (v || margin(subject, plane)[i] ? 1 : 0)) : null
  const distracting = distractions(attention, guarded, plane)
  const tones = notan(luma, plane, subject)
  const sep = subject ? separation(pixels.data, subject, plane) : null
  // Eyes, brows and mouth are not skin: left in, they would read as blotches.
  const lips = parts.length ? polygonMask(parts.map((p) => p.lips), plane) : null
  const features = parts.length
    ? blur(Float32Array.from(polygonMask(parts.flatMap((p) => [...p.eyes, p.lips]), plane)), plane, Math.max(plane.w, plane.h) / 90)
    : null
  const bare = (mask: Uint8Array): Uint8Array => (features ? mask.map((v, i) => (v && features[i] < 0.03 ? 1 : 0)) : mask)
  const skin = masks && share(masks.skin) > 0.004 ? skinEvenness(pixels.data, bare(masks.skin), plane) : null
  const colour = masks ? skinColour(pixels.data, bare(masks.faceSkin), bare(masks.bodySkin), lips) : null
  const { sky, green } = skyAndGreen(pixels.data, plane)
  const soft = blur(luma, plane, Math.max(plane.w, plane.h) / 40)
  const background = subject ? subject.map((v) => (v ? 0 : 1)) : null
  const subjectLook = subject ? character(pixels.data, luma, soft, subject) : { sat: 0, contrast: 0 }
  const backgroundLook = background ? character(pixels.data, luma, soft, background) : { sat: 0, contrast: 0 }

  const reading: Reading = {
    hasSubject: !!subject,
    attentionOnSubject: subject ? attentionOn(attentionWithFaces, subject) : 0,
    distractions: distracting,
    notan: { subject: tones.subject, surroundings: tones.surroundings },
    separation: sep,
    skin,
    skinColour: colour,
    background: subject ? readBackground(pixels.data, subject, plane) : null,
    faces,
    skyShare: share(sky),
    greenShare: share(green),
    subjectSat: subjectLook.sat,
    backgroundSat: backgroundLook.sat,
    subjectContrast: subjectLook.contrast,
    backgroundContrast: backgroundLook.contrast
  }
  return {
    preview, plane, pixels, faces, parts, masks, attention, attentionWithFaces, distracting,
    levels: tones.levels, edge: sep?.edge ?? null, skinMap: skin?.map ?? null, sky, green, reading, findings: findings(reading, limits)
  }
}
