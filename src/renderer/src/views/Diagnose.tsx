import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiagnosisAdvice, FaceInfo } from '@shared/types'
import {
  attentionMap,
  attentionOn,
  blur,
  channels,
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
  type Plane,
  type Reading
} from '../analysis/diagnose'
import { analyseFaces, faceParts, type FaceParts } from '../analysis/faces'
import { loadOriented, PREVIEW_EDGE, resized, rgba, THUMB_EDGE, toGray, toJpeg } from '../analysis/image'
import { previewUrl } from '../analysis/pipeline'
import { segmentPeople, type PersonMasks } from '../analysis/segment'
import { estimateCost, formatCost } from '../components/AiCost'
import { Thumb } from '../components/Thumb'
import { useStore } from '../store'

/** Long edge of the maps. These are questions about masses and edges, not detail. */
const WORK_EDGE = 384

interface Analysis {
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
function polygonMask(polygons: { x: number; y: number }[][], plane: Plane): Uint8Array {
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

async function analyse(preview: HTMLCanvasElement, known?: FaceInfo[]): Promise<Analysis> {
  const small = resized(preview, WORK_EDGE)
  const plane = { w: small.width, h: small.height }
  const pixels = rgba(small)
  const n = plane.w * plane.h
  const faces = known ?? (await analyseFaces(preview, rgba(preview), toGray(rgba(preview))))
  const parts = await faceParts(preview, faces)
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
    levels: tones.levels, edge: sep?.edge ?? null, skinMap: skin?.map ?? null, sky, green, reading, findings: findings(reading)
  }
}

// --- drawing ---------------------------------------------------------------------------------

type Paint = (i: number) => [number, number, number, number] | null

/** Draws the photo (optionally dimmed) with a per-pixel overlay computed at the working size. */
function drawPanel(canvas: HTMLCanvasElement, a: Analysis, paint: Paint | null, options: { dim?: number; base?: boolean } = {}): CanvasRenderingContext2D {
  canvas.width = a.plane.w * 2
  canvas.height = a.plane.h * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (options.base !== false) {
    ctx.globalAlpha = 1 - (options.dim ?? 0)
    ctx.drawImage(a.preview, 0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1
  }
  if (paint) {
    const layer = document.createElement('canvas')
    layer.width = a.plane.w
    layer.height = a.plane.h
    const img = new ImageData(a.plane.w, a.plane.h)
    for (let i = 0; i < a.plane.w * a.plane.h; i++) {
      const c = paint(i)
      if (c) img.data.set(c, i * 4)
    }
    layer.getContext('2d')!.putImageData(img, 0, 0)
    ctx.drawImage(layer, 0, 0, canvas.width, canvas.height)
  }
  return ctx
}

/** Dark purple through orange to pale yellow, for heat maps. */
function heat(v: number, alpha = 1): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, v))
  return [Math.round(255 * Math.min(1, t * 1.6)), Math.round(255 * Math.max(0, t * 1.5 - 0.5)), Math.round(255 * (t < 0.5 ? 0.5 + t * 0.4 : Math.max(0, 1.4 - t * 1.4))), Math.round(255 * alpha * Math.min(1, t * 1.8))]
}

function boxes(ctx: CanvasRenderingContext2D, list: { x: number; y: number; w: number; h: number }[], colour: string): void {
  ctx.strokeStyle = colour
  ctx.lineWidth = 3
  for (const b of list) ctx.strokeRect(b.x * ctx.canvas.width, b.y * ctx.canvas.height, b.w * ctx.canvas.width, b.h * ctx.canvas.height)
}

const PANELS: { key: string; title: string; note: string }[] = [
  { key: 'subject', title: 'Subject and faces', note: 'What the app takes to be the subject (blue) and the faces it found (yellow).' },
  { key: 'skin', title: 'Skin, eyes, lips', note: 'Skin in green, eyes in yellow, lips in magenta.' },
  { key: 'attention', title: 'Where the eye goes', note: 'Attention from contrast and structure, plus faces. Red boxes: things that pull the eye and are not the subject.' },
  { key: 'notan', title: 'Three masses', note: 'The picture as dark, middle and light. If it still reads, the structure is sound.' },
  { key: 'edge', title: 'Outline', note: 'Green where the subject stands clear of the background, red where it merges.' },
  { key: 'even', title: 'Skin evenness', note: 'Brighter where a patch of skin departs from the skin around it.' },
  { key: 'sky', title: 'Sky and vegetation', note: 'A rough guess from colour and position: sky in orange, vegetation in green.' },
  { key: 'mask', title: 'Silhouette', note: 'The subject mask. If you cannot tell what the figure is doing from this shape alone, the pose does not read.' }
]

function paintPanel(key: string, canvas: HTMLCanvasElement, a: Analysis): void {
  const m = a.masks
  if (key === 'subject') {
    const ctx = drawPanel(canvas, a, m ? (i) => (m.subject[i] ? [40, 90, 255, 150] : null) : null)
    boxes(ctx, a.faces, '#f5e050')
  } else if (key === 'skin') {
    const eyes = polygonMask(a.parts.flatMap((p) => p.eyes), a.plane)
    const lips = polygonMask(a.parts.map((p) => p.lips), a.plane)
    drawPanel(canvas, a, (i) => (lips[i] ? [230, 60, 200, 220] : eyes[i] ? [250, 230, 60, 230] : m?.skin[i] ? [60, 220, 110, 150] : null))
  } else if (key === 'attention') {
    const ctx = drawPanel(canvas, a, (i) => heat(a.attentionWithFaces[i], 0.85), { dim: 0.45 })
    boxes(ctx, a.distracting.filter((d) => d.pull > 0.035), '#e53935')
  } else if (key === 'notan') {
    drawPanel(canvas, a, (i) => {
      const v = [18, 128, 238][a.levels[i]]
      return [v, v, v, 255]
    }, { base: false })
  } else if (key === 'edge') {
    // Thicken the outline so it can be seen: each outline pixel colours its neighbours.
    const edge = a.edge
    const thick = new Float32Array(a.plane.w * a.plane.h).fill(-1)
    if (edge) {
      for (let i = 0; i < edge.length; i++) {
        if (edge[i] < 0) continue
        for (const j of [i, i - 1, i + 1, i - a.plane.w, i + a.plane.w]) if (j >= 0 && j < thick.length && (thick[j] < 0 || edge[i] < thick[j])) thick[j] = edge[i]
      }
    }
    drawPanel(canvas, a, (i) => (thick[i] < 0 ? null : thick[i] < 0.09 ? [240, 50, 40, 255] : [60, 220, 110, 230]), { dim: 0.55 })
  } else if (key === 'even') {
    drawPanel(canvas, a, a.skinMap ? (i) => (a.skinMap![i] < 0 ? null : heat(a.skinMap![i], 1)) : null, { dim: 0.6 })
  } else if (key === 'sky') {
    drawPanel(canvas, a, (i) => (a.sky[i] ? [255, 150, 40, 150] : a.green[i] ? [50, 200, 90, 150] : null))
  } else if (key === 'mask') {
    drawPanel(canvas, a, (i) => (m?.subject[i] ? [255, 255, 255, 255] : null), { base: false })
  }
}

// --- trying an adjustment --------------------------------------------------------------------

interface Trial {
  skinUnify: number
  skinHue: number
  bgBright: number
  bgContrast: number
  bgSat: number
  separate: number
}
const NEUTRAL: Trial = { skinUnify: 0, skinHue: 0, bgBright: 0, bgContrast: 0, bgSat: 0, separate: 0 }

/**
 * Shows roughly what the proposed adjustments would do, on a small copy of the
 * preview. It is a sketch to judge direction and amount before doing the work
 * properly on the RAW: nothing is saved and no file is changed.
 */
function drawTrial(canvas: HTMLCanvasElement, a: Analysis, t: Trial): void {
  const { w, h } = a.plane
  canvas.width = w
  canvas.height = h
  const out = new ImageData(new Uint8ClampedArray(a.pixels.data), w, h)
  const m = a.masks
  if (m) {
    const n = w * h
    const size = Math.max(w, h)
    const { luma } = channels(a.pixels.data, n)
    const feather = (mask: Uint8Array, r: number): Float32Array => blur(Float32Array.from(mask), a.plane, r)
    const skinW = feather(m.skin, size / 160)
    const subjW = feather(m.subject, size / 120)
    const nearW = blur(Float32Array.from(ring(m.subject, a.plane, size / 12)), a.plane, size / 40)
    // Local averages over skin, for unifying it.
    const skinF = Float32Array.from(m.skin)
    const den = blur(skinF, a.plane, size / 22)
    const local = [0, 1, 2].map((ch) => {
      const src = new Float32Array(n)
      for (let i = 0; i < n; i++) src[i] = a.pixels.data[i * 4 + ch] * skinF[i]
      const num = blur(src, a.plane, size / 22)
      return num.map((v, i) => (den[i] > 1e-3 ? v / den[i] : 0))
    })
    // Is the subject darker or lighter than what is just behind it?
    const subjL = blur(luma.map((v, i) => v * m.subject[i]), a.plane, size / 16)
    const subjD = blur(Float32Array.from(m.subject), a.plane, size / 16)
    const meanBg = luma.reduce((s, v, i) => s + (m.subject[i] ? 0 : v), 0) / Math.max(1, n - m.subject.reduce((s, v) => s + v, 0))
    const bgSoft = blur(luma, a.plane, size / 24)
    const hueTurn = (t.skinHue * Math.PI) / 180
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      let r = out.data[p]
      let g = out.data[p + 1]
      let b = out.data[p + 2]
      const bg = 1 - subjW[i]
      if (bg > 0.01) {
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const sat = 1 + t.bgSat * bg
        const con = 1 + t.bgContrast * bg
        const gain = Math.pow(2, t.bgBright * bg)
        // Push the background beside the outline away from the subject's own brightness.
        const s = subjD[i] > 0.02 ? subjL[i] / subjD[i] : meanBg
        // Decided on the smoothed background, so the push is even across an area rather than pixel by pixel.
        const away = Math.max(-1, Math.min(1, (bgSoft[i] - s) / 0.12 || 1))
        const push = t.separate * nearW[i] * 45 * (Math.abs(away) < 0.25 ? Math.sign(away || 1) * 0.25 : away)
        const shade = (v: number): number => ((y + (v - y) * sat - meanBg * 255) * con + meanBg * 255) * gain + push
        r = shade(r)
        g = shade(g)
        b = shade(b)
      }
      const sk = skinW[i]
      if (sk > 0.01 && (t.skinUnify || t.skinHue)) {
        const k = t.skinUnify * sk * 0.8
        r += (local[0][i] - r) * k
        g += (local[1][i] - g) * k
        b += (local[2][i] - b) * k
        if (hueTurn) {
          // Rotate the colour around grey: positive moves red toward yellow.
          const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
          const cb = (b - y) / 1.8556
          const cr = (r - y) / 1.5748
          const turn = -hueTurn * sk
          const cb2 = cb * Math.cos(turn) - cr * Math.sin(turn)
          const cr2 = cb * Math.sin(turn) + cr * Math.cos(turn)
          r = y + 1.5748 * cr2
          b = y + 1.8556 * cb2
          g = (y - 0.2126 * r - 0.0722 * b) / 0.7152
        }
      }
      out.data[p] = r
      out.data[p + 1] = g
      out.data[p + 2] = b
    }
  }
  canvas.getContext('2d')!.putImageData(out, 0, 0)
}

const SLIDERS: { key: keyof Trial; label: string; min: number; max: number; step: number; how: string }[] = [
  { key: 'separate', label: 'Separate from background', min: 0, max: 1, step: 0.05, how: 'Lightroom: a brush or inverted subject mask along the lost edge; Exposure up where the subject is dark, down where it is light.' },
  { key: 'bgBright', label: 'Background brightness', min: -1, max: 1, step: 0.05, how: 'Lightroom: Masking → Select Subject → Invert; Exposure.' },
  { key: 'bgContrast', label: 'Background contrast', min: -0.6, max: 0.3, step: 0.05, how: 'Same mask: Contrast, Clarity and Texture down.' },
  { key: 'bgSat', label: 'Background saturation', min: -0.8, max: 0.3, step: 0.05, how: 'Same mask: Saturation down.' },
  { key: 'skinUnify', label: 'Unify skin', min: 0, max: 1, step: 0.05, how: 'Photoshop: dodge and burn on a 50% grey Soft Light layer, plus a low-opacity Color layer for red patches. Not a blur.' },
  { key: 'skinHue', label: 'Skin hue, red → yellow', min: -12, max: 12, step: 0.5, how: 'Lightroom: Masking → People → skin; Hue. Or Color Mixer: Red and Orange hue.' }
]

// --- the screen --------------------------------------------------------------------------------

export function Diagnose(): React.JSX.Element {
  const { project, settings, notify } = useStore()
  const picks = useMemo(() => project?.shots.filter((s) => s.decision === 'pick' && s.analysis) ?? [], [project?.shots])
  const [source, setSource] = useState<{ cacheId: string; shotId: string; name: string; url: string; orientation: number; faces?: FaceInfo[]; opened?: boolean } | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [working, setWorking] = useState(false)
  const [trial, setTrial] = useState<Trial>(NEUTRAL)
  const [advice, setAdvice] = useState<DiagnosisAdvice | null>(null)
  const [asking, setAsking] = useState(false)
  const panelRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const originalRef = useRef<HTMLCanvasElement>(null)
  const trialRef = useRef<HTMLCanvasElement>(null)

  // Start with the first pick of the open project, if there is one.
  useEffect(() => {
    if (!source && project && picks[0]) choosePick(picks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, picks.length])

  const choosePick = (id: string): void => {
    const shot = picks.find((s) => s.id === id)
    if (shot && project) setSource({ cacheId: project.id, shotId: shot.id, name: shot.name, url: previewUrl(project.id, shot.id), orientation: 1, faces: shot.analysis!.faces })
  }

  const open = async (): Promise<void> => {
    try {
      const path = await window.studio.pickImage()
      if (!path) return
      const extracted = await window.studio.extract('diagnose', 'open', path)
      setSource({ cacheId: 'diagnose', shotId: 'open', name: path.split(/[\\/]/).pop()!, url: `${extracted.url}?t=${Date.now()}`, orientation: extracted.applyOrientation, opened: true })
    } catch (err) {
      notify(`Could not open that file: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    }
  }

  useEffect(() => {
    if (!source) return
    let live = true
    setWorking(true)
    setAnalysis(null)
    setAdvice(null)
    setTrial(NEUTRAL)
    void (async () => {
      try {
        const blob = await (await fetch(source.url)).blob()
        const preview = resized(await loadOriented(blob, source.orientation, PREVIEW_EDGE), PREVIEW_EDGE)
        // A photo opened by itself needs a cached preview, in case Claude is asked about it.
        if (source.opened) await window.studio.savePreview('diagnose', 'open', await toJpeg(preview, 0.86), await toJpeg(resized(preview, THUMB_EDGE), 0.8))
        const result = await analyse(preview, source.faces)
        if (live) setAnalysis(result)
      } catch (err) {
        if (live) notify(`The photo could not be analysed: ${(err as Error).message}`)
      } finally {
        if (live) setWorking(false)
      }
    })()
    return () => {
      live = false
    }
  }, [source, notify])

  useEffect(() => {
    if (!analysis) return
    if (originalRef.current) drawPanel(originalRef.current, analysis, null)
    for (const p of PANELS) {
      const c = panelRefs.current[p.key]
      if (c) paintPanel(p.key, c, analysis)
    }
  }, [analysis])

  useEffect(() => {
    if (analysis && trialRef.current) drawTrial(trialRef.current, analysis, trial)
  }, [analysis, trial])

  const measured = (a: Analysis): string => a.findings.map((f) => `${f.topic}: ${f.finding}`).join('\n')

  const ask = async (): Promise<void> => {
    if (!analysis || !source) return
    setAsking(true)
    try {
      const b = project?.brief
      setAdvice(
        await window.studio.ai.diagnose({
          cacheId: source.cacheId,
          shotId: source.shotId,
          brief: b && !source.opened ? `Brief. Client asked for: ${b.clientAsk || 'not given'}. Intention: ${b.intention || 'not given'}. Mood: ${b.moodWords || 'not given'}.` : '',
          measured: measured(analysis)
        })
      )
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setAsking(false)
    }
  }

  /** Saves the masks as PNG files at preview size, for use as layer masks in Photoshop. */
  const exportMasks = async (): Promise<void> => {
    const a = analysis
    if (!a?.masks || !source) return
    const folder = await window.studio.pickFolder()
    if (!folder) return
    const png = async (mask: Uint8Array, invert = false): Promise<ArrayBuffer> => {
      const small = document.createElement('canvas')
      small.width = a.plane.w
      small.height = a.plane.h
      const img = new ImageData(a.plane.w, a.plane.h)
      for (let i = 0; i < mask.length; i++) {
        const v = (mask[i] ? 1 : 0) !== (invert ? 1 : 0) ? 255 : 0
        img.data.set([v, v, v, 255], i * 4)
      }
      small.getContext('2d')!.putImageData(img, 0, 0)
      const big = document.createElement('canvas')
      big.width = a.preview.width
      big.height = a.preview.height
      const ctx = big.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, big.width, big.height)
      return (await new Promise<Blob | null>((res) => big.toBlob(res, 'image/png')))!.arrayBuffer()
    }
    const base = source.name.replace(/\.\w+$/, '')
    const result = await window.studio.saveFiles(folder, [
      { name: `${base}_mask_subject.png`, data: await png(a.masks.subject) },
      { name: `${base}_mask_background.png`, data: await png(a.masks.subject, true) },
      { name: `${base}_mask_skin.png`, data: await png(a.masks.skin) }
    ])
    notify(result.failed.length ? `${result.written} masks saved; ${result.failed.length} skipped (${result.failed[0].error})` : `${result.written} masks saved to ${folder}`)
  }

  const problems = analysis?.findings.filter((f) => f.level === 'attention') ?? []
  const fine = analysis?.findings.filter((f) => f.level === 'good') ?? []

  return (
    <div className="page wide">
      <h1>Diagnose a photo</h1>
      <p className="lead">
        Before you retouch: what is wrong with this picture? Where the subject merges with the background, where skin is
        uneven, what pulls the eye away, where attention actually goes. Most of these questions have a measurable
        answer. What the picture should feel like is not one of them, and stays yours.
      </p>

      <div className="row">
        <button className="primary" onClick={() => void open()}>
          Open a photo…
        </button>
        {source && <span className="muted small">{source.name}</span>}
      </div>
      {picks.length > 0 && (
        <div className="compare" style={{ marginTop: 12, borderRadius: 6, border: '1px solid var(--line)' }}>
          {picks.map((s) => (
            <Thumb key={s.id} projectId={project!.id} shot={s} selected={!source?.opened && s.id === source?.shotId} onSelect={choosePick} />
          ))}
        </div>
      )}

      {working && <p className="muted" style={{ marginTop: 16 }}>Reading the photo…</p>}
      {!source && !working && picks.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>Open any photo, or pick frames in a project and they appear here.</p>
      )}

      {analysis && (
        <>
          <div className="diag-grid">
            <figure>
              <canvas ref={originalRef} />
              <figcaption>
                <b>Original</b>
              </figcaption>
            </figure>
            {PANELS.map((p) => (
              <figure key={p.key}>
                <canvas ref={(el) => void (panelRefs.current[p.key] = el)} />
                <figcaption>
                  <b>{p.title}.</b> {p.note}
                </figcaption>
              </figure>
            ))}
          </div>
          {!analysis.masks && (
            <div className="note warn">
              <p>No person could be separated from the background in this photo, so the subject, outline and skin panels are empty. Attention and the three masses still apply.</p>
            </div>
          )}

          <h2>Diagnosis</h2>
          {problems.length === 0 && <p className="muted">Nothing measurable stands out as a problem.</p>}
          {problems.map((f, i) => (
            <div className="note warn" key={i}>
              <p>
                <b>{f.topic}.</b> {f.finding}
              </p>
              <p className="small">
                {f.advice}
                {f.mask && <span className="muted"> · mask: {f.mask}{f.strength ? `, strength ${f.strength.toFixed(1)}` : ''}</span>}
              </p>
            </div>
          ))}
          {fine.length > 0 && (
            <>
              <h3>What already works</h3>
              {fine.map((f, i) => (
                <div className="note teach" key={i}>
                  <p className="small">
                    <b>{f.topic}.</b> {f.finding} {f.advice}
                  </p>
                </div>
              ))}
            </>
          )}

          {analysis.masks && (
            <>
              <h2>Try it</h2>
              <p className="muted small" style={{ maxWidth: 720 }}>
                A sketch of what the proposed adjustments would do, on a small copy. It is here so you can judge direction
                and amount before doing the work properly on the RAW. Nothing is saved and no file is changed.
              </p>
              <div className="trial">
                <canvas ref={trialRef} />
                <div>
                  {SLIDERS.map((s) => (
                    <div key={s.key} style={{ marginBottom: 10 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <label htmlFor={s.key} style={{ margin: 0 }}>
                          {s.label}
                        </label>
                        <span className="muted small">{trial[s.key].toFixed(2)}</span>
                      </div>
                      <input id={s.key} type="range" min={s.min} max={s.max} step={s.step} value={trial[s.key]} onChange={(e) => setTrial({ ...trial, [s.key]: Number(e.target.value) })} style={{ padding: 0, border: 0, background: 'none' }} />
                      <div className="muted small">{s.how}</div>
                    </div>
                  ))}
                  <div className="row">
                    <button onClick={() => setTrial(NEUTRAL)}>Reset</button>
                    <button onClick={() => void exportMasks()}>Save masks for Photoshop…</button>
                  </div>
                  <p className="muted small" style={{ marginTop: 8 }}>
                    Masks are saved as PNG (subject, background, skin). They come from a small model, so their edges are
                    soft: a starting point to refine, not a finished cut-out.
                  </p>
                </div>
              </div>
            </>
          )}

          <h2>Describe, diagnose, propose</h2>
          <p className="muted small" style={{ maxWidth: 720 }}>
            Optional: Claude looks at the photo and the measurements above and writes a retoucher's first read: what is
            there, what holds it back, and the technical adjustments in the order to make them.
          </p>
          {settings.hasApiKey ? (
            <div className="row">
              <button className="primary" disabled={asking} onClick={() => void ask()}>
                {asking ? 'Reading…' : advice ? 'Ask again' : 'Ask Claude'}
              </button>
              <span className="muted small">{estimateCost(settings.model, 3500, 2500)}</span>
            </div>
          ) : (
            <p className="muted small">Add an API key in Settings to use this.</p>
          )}
          {advice && (
            <div style={{ marginTop: 12 }}>
              <div className="note">
                <p>
                  <b>1. Description.</b> {advice.description}
                </p>
                <p>
                  <b>2. Diagnosis.</b> {advice.diagnosis}
                </p>
              </div>
              <h3>3. Proposed adjustments</h3>
              {advice.adjustments.map((s, i) => (
                <div className="step-row" key={i}>
                  <b>
                    {i + 1}. {s.what}
                  </b>
                  <span className="muted small">
                    {s.where} · {s.strength}
                  </span>
                  <div className="muted small">Why: {s.why}</div>
                </div>
              ))}
              <div className="note teach">
                <p>
                  <b>Yours to decide.</b> {advice.yours}
                </p>
              </div>
              {advice.usage && <p className="muted small">This read cost {formatCost(advice.usage.costUsd)}.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
