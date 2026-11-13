import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Shot } from '@shared/types'
import { loadOriented } from '../analysis/image'
import { previewUrl } from '../analysis/pipeline'
import { BLINK_LIMIT } from '../analysis/scoring'

/** Full-size images loaded for zooming, kept for the last few frames. */
const full = new Map<string, Promise<{ url: string; w: number; h: number } | null>>()
const KEEP = 8
let slot = 0

/**
 * The largest image the original holds (for a RAW, the camera's full-size
 * embedded JPEG), loaded on demand: the cached preview is only 1600 pixels,
 * too small to judge focus on eyes.
 */
function fullImage(projectId: string, shot: Shot): Promise<{ url: string; w: number; h: number } | null> {
  const key = `${projectId}:${shot.id}`
  let job = full.get(key)
  if (!job) {
    job = (async () => {
      try {
        const ex = await window.studio.extract(projectId, `zoom${slot++ % 4}`, shot.path)
        const blob = await (await fetch(`${ex.url}?t=${Date.now()}`)).blob()
        const upright = ex.applyOrientation > 1 ? await new Promise<Blob>((ok) => void loadOriented(blob, ex.applyOrientation, 12000).then((c) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.95))) : blob
        const bmp = await createImageBitmap(upright)
        const size = { w: bmp.width, h: bmp.height }
        bmp.close()
        return { url: URL.createObjectURL(upright), ...size }
      } catch {
        return null
      }
    })()
    full.set(key, job)
    // Only the newest few are kept; each one is a large image in memory.
    while (full.size > KEEP) {
      const [oldest, old] = full.entries().next().value!
      full.delete(oldest)
      void old.then((x) => x && URL.revokeObjectURL(x.url))
    }
  }
  return job
}

/** How far in: k times the size that fits the view, around (cx, cy), a point of the image in 0..1. */
interface View {
  k: number
  cx: number
  cy: number
  /** At 100%: stays at 100% when the full-size image arrives and its true size is known. */
  actual?: boolean
}
const FIT: View = { k: 1, cx: 0.5, cy: 0.5 }

/**
 * The photo, fitted to the space, with zoom as in Lightroom: click to see 100%
 * at that point and click again to fit; Z zooms to the eyes of the main face;
 * the wheel zooms smoothly around the pointer; drag to move around. The zoom
 * is kept from frame to frame, so the eyes of every take can be compared.
 */
export function Loupe({ projectId, shot }: { projectId: string; shot: Shot }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [aspect, setAspect] = useState(shot.width && shot.height ? shot.width / shot.height : 1.5)
  const [hi, setHi] = useState<{ id: string; url: string; w: number; h: number } | null>(null)
  const [view, setView] = useState<View>(FIT)
  const drag = useRef<{ x: number; y: number; moved: boolean; start: View } | null>(null)
  const faces = shot.analysis?.faces ?? []

  // Another frame: its own proportions from the start, until its image has loaded and says exactly.
  useEffect(() => {
    if (shot.width && shot.height) setAspect(shot.width / shot.height)
  }, [shot.id, shot.width, shot.height])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The full-size image is fetched as soon as it is needed, and kept while moving through takes.
  const zoomed = view.k > 1.001
  useEffect(() => {
    if (!zoomed || hi?.id === shot.id) return
    let live = true
    void fullImage(projectId, shot).then((x) => live && x && setHi({ id: shot.id, ...x }))
    return () => {
      live = false
    }
  }, [zoomed, shot, projectId, hi?.id])

  const pad = zoomed ? 0 : 14
  const fitW = Math.max(1, Math.min(size.w - 2 * pad, (size.h - 2 * pad) * aspect))
  const highRes = hi?.id === shot.id ? hi : null
  /** The zoom at which one pixel of the original is one pixel on screen. */
  const actual = Math.max(2, (highRes?.w ?? Math.max(shot.width, 3200 * Math.min(1, aspect))) / fitW / window.devicePixelRatio)
  const k = view.actual ? actual : view.k
  const W = fitW * k
  const H = W / aspect
  const clampCenter = (c: number, viewLen: number, imgLen: number): number => (imgLen <= viewLen ? 0.5 : Math.min(1 - viewLen / 2 / imgLen, Math.max(viewLen / 2 / imgLen, c)))
  const cx = clampCenter(view.cx, size.w, W)
  const cy = clampCenter(view.cy, size.h, H)
  const left = size.w / 2 - cx * W
  const top = size.h / 2 - cy * H

  /** Zooms to k, keeping the image point under (px, py) where it is. */
  const zoomAt = useCallback(
    (k: number, px: number, py: number) => {
      const ix = (px - left) / W
      const iy = (py - top) / H
      const k2 = Math.min(actual * 2, Math.max(1, k))
      const W2 = fitW * k2
      setView(k2 <= 1.001 ? FIT : { k: k2, actual: Math.abs(k2 - actual) < 1e-6, cx: (size.w / 2 - px) / W2 + ix, cy: (size.h / 2 - py) / (W2 / aspect) + iy })
    },
    [left, top, W, H, actual, fitW, size, aspect]
  )

  /** Z: to 100% on the eyes of the largest face, or back to fit. */
  const toggle = useCallback(() => {
    if (zoomed) return setView(FIT)
    const f = [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0]
    setView({ k: actual, actual: true, cx: f ? f.x + f.w / 2 : 0.5, cy: f ? f.y + f.h * 0.4 : 0.5 })
  }, [zoomed, faces, actual])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="listbox"]') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'z' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  return (
    <div
      ref={box}
      className={`loupe-img ${zoomed ? 'zoomed' : ''}`}
      onWheel={(e) => {
        const [x, y] = point(e)
        zoomAt(k * Math.exp(-e.deltaY * 0.0018), x, y)
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY, moved: false, start: { ...view, k, cx, cy } }
      }}
      onMouseMove={(e) => {
        const d = drag.current
        if (!d || !(e.buttons & 1)) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (!d.moved && Math.hypot(dx, dy) < 4) return
        d.moved = true
        if (zoomed) setView({ ...d.start, cx: d.start.cx - dx / W, cy: d.start.cy - dy / H })
      }}
      onMouseUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d || d.moved) return
        const [x, y] = point(e)
        if (zoomed) setView(FIT)
        else zoomAt(actual, x, y)
      }}
      onMouseLeave={() => (drag.current = null)}
      title={zoomed ? 'Drag to move, click to fit, wheel to zoom' : 'Click to see 100% there, Z for the eyes, wheel to zoom'}
    >
      <img
        src={highRes?.url ?? previewUrl(projectId, shot.id)}
        alt={shot.name}
        draggable={false}
        // The proportions come from the image on show, whichever it is, so it can never be stretched to another's.
        onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        style={{ left, top, width: W, height: H, objectFit: 'contain' }}
      />
      {!zoomed &&
        faces.map((f, i) => (
          <div
            key={i}
            className={`facebox ${f.blink > BLINK_LIMIT ? 'bad' : ''}`}
            style={{ left: left + f.x * W, top: top + f.y * H, width: f.w * W, height: f.h * H }}
          />
        ))}
      <div className="zoom-badge" onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
        <button className={!zoomed ? 'on' : ''} onClick={() => setView(FIT)}>
          Fit
        </button>
        <button className={view.actual ? 'on' : ''} onClick={() => setView({ k: actual, actual: true, cx, cy })}>
          100%
        </button>
        {zoomed && (!view.actual || !highRes) && <span>{view.actual ? '' : `${Math.round((k / actual) * 100)}%`}{!highRes && ' loading full size…'}</span>}
      </div>
    </div>
  )
}
