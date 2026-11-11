// Pixel-level measurements. Everything here runs on the user's machine.

export interface Gray {
  data: Uint8Array
  w: number
  h: number
}

/** Longest edge used for focus measurement: enough to tell critical focus from a near miss. */
export const ANALYSIS_EDGE = 3200
export const PREVIEW_EDGE = 1600
export const THUMB_EDGE = 360

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** Decodes a JPEG and returns it upright, no larger than `maxEdge`. */
export async function loadOriented(blob: Blob, orientation: number, maxEdge = ANALYSIS_EDGE): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = bmp.width * scale
  const h = bmp.height * scale
  const swap = orientation >= 5 && orientation <= 8
  const out = canvas(swap ? h : w, swap ? w : h)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  // EXIF orientation -> canvas transform (a, b, c, d, e, f).
  const W = out.width
  const H = out.height
  const t: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, W, 0],
    3: [-1, 0, 0, -1, W, H],
    4: [1, 0, 0, -1, 0, H],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, W, 0],
    7: [0, -1, -1, 0, W, H],
    8: [0, -1, 1, 0, 0, H]
  }
  if (t[orientation]) ctx.setTransform(...t[orientation])
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return out
}

export function resized(src: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height))
  if (scale === 1) return src
  // Halve repeatedly: one big bilinear step would alias fine detail.
  let cur = src
  while (Math.max(cur.width, cur.height) / 2 > maxEdge) {
    const half = canvas(cur.width / 2, cur.height / 2)
    half.getContext('2d')!.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
  }
  const out = canvas(src.width * scale, src.height * scale)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, out.width, out.height)
  return out
}

export async function toJpeg(src: HTMLCanvasElement, quality: number): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((res) => src.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not encode preview')
  return blob.arrayBuffer()
}

export function rgba(src: HTMLCanvasElement): ImageData {
  return src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, src.width, src.height)
}

export function toGray(img: ImageData): Gray {
  const { data, width: w, height: h } = img
  const out = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 54 + data[p + 1] * 183 + data[p + 2] * 19) >> 8
  }
  return { data: out, w, h }
}

/**
 * Variance of the Laplacian inside a rectangle: a standard focus measure.
 * Sharp edges produce large second derivatives; blur flattens them.
 * The result is divided by the area's brightness so that an underexposed
 * frame is not mistaken for a soft one (darker pixels mean smaller differences).
 */
export function laplacianVariance(g: Gray, x0: number, y0: number, x1: number, y1: number): number {
  x0 = Math.max(1, Math.floor(x0))
  y0 = Math.max(1, Math.floor(y0))
  x1 = Math.min(g.w - 1, Math.ceil(x1))
  y1 = Math.min(g.h - 1, Math.ceil(y1))
  let sum = 0
  let sumSq = 0
  let level = 0
  let n = 0
  const d = g.data
  for (let y = y0; y < y1; y++) {
    let i = y * g.w + x0
    for (let x = x0; x < x1; x++, i++) {
      const v = d[i - 1] + d[i + 1] + d[i - g.w] + d[i + g.w] - 4 * d[i]
      sum += v
      sumSq += v * v
      level += d[i]
      n++
    }
  }
  if (n < 16) return 0
  const mean = sum / n
  // The +16 keeps noise in near-black areas from being amplified into "detail".
  const gain = (level / n + 16) / 128
  return (sumSq / n - mean * mean) / (gain * gain)
}

/**
 * Sharpness of whatever is in focus. A portrait at f/1.4 is mostly blur by
 * design, so averaging the whole frame would punish shallow depth of field;
 * instead we take the sharpest tenth of the frame.
 */
export function subjectSharpness(g: Gray): number {
  const cols = 16
  const rows = Math.max(4, Math.round((cols * g.h) / g.w))
  const tiles: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(laplacianVariance(g, (c * g.w) / cols, (r * g.h) / rows, ((c + 1) * g.w) / cols, ((r + 1) * g.h) / rows))
    }
  }
  tiles.sort((a, b) => b - a)
  const top = tiles.slice(0, Math.max(1, Math.round(tiles.length / 10)))
  return top.reduce((a, b) => a + b, 0) / top.length
}

/** 64-bit difference hash: similar-looking frames differ in only a few bits. */
export function dHash(src: HTMLCanvasElement): string {
  const small = canvas(9, 8)
  const ctx = small.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(resized(src, 72), 0, 0, 9, 8)
  const g = toGray(ctx.getImageData(0, 0, 9, 8))
  let hex = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (g.data[y * 9 + x] > g.data[y * 9 + x + 1] ? 1 : 0)
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}
