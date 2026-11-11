import { useEffect, useRef } from 'react'

/**
 * Histogram and vectorscope drawn from the preview: the same two instruments
 * Lightroom and DaVinci Resolve offer, so reading them here transfers there.
 */
export function Scopes({ src }: { src: string }): React.JSX.Element {
  const histRef = useRef<HTMLCanvasElement>(null)
  const vecRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    // Fetched rather than loaded through an <img>, so the pixels can be read back.
    void (async () => {
      const bmp = await createImageBitmap(await (await fetch(src)).blob())
      if (!live || !histRef.current || !vecRef.current) return
      const scale = 320 / Math.max(bmp.width, bmp.height)
      const tmp = document.createElement('canvas')
      tmp.width = Math.round(bmp.width * scale)
      tmp.height = Math.round(bmp.height * scale)
      const ctx = tmp.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, tmp.width, tmp.height)
      bmp.close()
      const { data } = ctx.getImageData(0, 0, tmp.width, tmp.height)
      drawHistogram(histRef.current, data)
      drawVectorscope(vecRef.current, data)
    })()
    return () => {
      live = false
    }
  }, [src])

  return (
    <div className="scopes">
      <div>
        <canvas ref={histRef} width={360} height={220} aria-label="Histogram" />
        <div className="muted small">Histogram: shadows left, highlights right</div>
      </div>
      <div>
        <canvas ref={vecRef} width={220} height={220} aria-label="Vectorscope" />
        <div className="muted small">Vectorscope: hue is angle, saturation is distance. The line marks skin.</div>
      </div>
    </div>
  )
}

function drawHistogram(canvas: HTMLCanvasElement, data: Uint8ClampedArray): void {
  const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256), new Float32Array(256)]
  for (let p = 0; p < data.length; p += 4) {
    bins[0][data[p]]++
    bins[1][data[p + 1]]++
    bins[2][data[p + 2]]++
    bins[3][Math.round(0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2])]++
  }
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  ctx.clearRect(0, 0, w, h)
  // Ignore the end bins when scaling so a clipped spike does not flatten everything else.
  let max = 1
  for (const b of bins) for (let i = 2; i < 254; i++) max = Math.max(max, b[i])
  ctx.strokeStyle = '#2a2a2a'
  for (const q of [0.25, 0.5, 0.75]) {
    ctx.beginPath()
    ctx.moveTo(q * w, 0)
    ctx.lineTo(q * w, h)
    ctx.stroke()
  }
  const path = (b: Float32Array): void => {
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, h - Math.min(1, b[i] / max) * (h - 4))
    ctx.lineTo(w, h)
  }
  path(bins[3])
  ctx.fillStyle = 'rgba(200,200,200,.35)'
  ctx.fill()
  ctx.globalCompositeOperation = 'lighter'
  ;['#c04040', '#40a040', '#4060d0'].forEach((colour, i) => {
    path(bins[i])
    ctx.strokeStyle = colour
    ctx.stroke()
  })
  ctx.globalCompositeOperation = 'source-over'
}

function drawVectorscope(canvas: HTMLCanvasElement, data: Uint8ClampedArray): void {
  const ctx = canvas.getContext('2d')!
  const size = canvas.width
  const mid = size / 2
  const radius = mid - 6
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = '#333'
  for (const r of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath()
    ctx.arc(mid, mid, radius * r, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Skin tone line: about 123 degrees on a standard vectorscope, between red and yellow.
  const skin = (123 * Math.PI) / 180
  ctx.strokeStyle = '#8a6a50'
  ctx.beginPath()
  ctx.moveTo(mid, mid)
  ctx.lineTo(mid + Math.cos(skin) * radius, mid - Math.sin(skin) * radius)
  ctx.stroke()

  ctx.globalCompositeOperation = 'lighter'
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    // Rec.709 colour difference; 0.5 is the largest value either can take.
    const cb = (-0.1146 * r - 0.3854 * g + 0.5 * b) / 255
    const cr = (0.5 * r - 0.4542 * g - 0.0458 * b) / 255
    ctx.fillStyle = `rgba(${r},${g},${b},.22)`
    ctx.fillRect(mid + cb * 2 * radius, mid - cr * 2 * radius, 1.5, 1.5)
  }
  ctx.globalCompositeOperation = 'source-over'
}
