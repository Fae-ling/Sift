import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { ExifTool, type Tags } from 'exiftool-vendored'
import { IMAGE_EXTENSIONS, RAW_EXTENSIONS, type ExtractResult, type ScannedFile } from '@shared/types'
import { cacheDir, safeId, tmpDir } from './store'
import { readJpegOrientation } from './jpegOrientation'

export const exiftool = new ExifTool({ maxProcs: 4, taskTimeoutMillis: 30_000 })

const ext = (path: string): string => extname(path).slice(1).toLowerCase()
export const isRaw = (path: string): boolean => RAW_EXTENSIONS.includes(ext(path))

/** Lists supported photos in a folder and its subfolders, in name order. */
export async function scanFolder(folder: string): Promise<ScannedFile[]> {
  const out: ScannedFile[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 4) await walk(full, depth + 1)
      } else if (IMAGE_EXTENSIONS.includes(ext(entry.name))) {
        out.push({ path: full, name: entry.name, size: (await fs.stat(full)).size })
      }
    }
  }
  await walk(folder, 0)
  out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  // A camera set to RAW+JPEG writes both; keep the RAW and drop its JPEG twin.
  const raws = new Set(out.filter((f) => isRaw(f.path)).map((f) => stem(f.path)))
  return out.filter((f) => isRaw(f.path) || !raws.has(stem(f.path)))
}

const stem = (path: string): string => path.slice(0, path.length - extname(path).length).toLowerCase()

/** Embedded JPEGs a RAW file may carry, largest first where we can tell. */
const PREVIEW_TAGS = ['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage'] as const

function binarySize(value: unknown): number {
  const m = /(\d+) bytes/.exec(String((value as { rawValue?: string })?.rawValue ?? value ?? ''))
  return m ? Number(m[1]) : 0
}

/**
 * Pulls the camera's own embedded JPEG out of a photo (no RAW development, so
 * it is fast and matches what the camera showed) and reads the capture data.
 */
export async function extractPreview(projectId: string, shotId: string, path: string): Promise<ExtractResult> {
  safeId(shotId)
  const tmp = tmpDir(projectId)
  await fs.mkdir(tmp, { recursive: true })
  await fs.mkdir(cacheDir(projectId), { recursive: true })
  const dest = join(tmp, `${shotId}.jpg`)
  await fs.rm(dest, { force: true })

  const tags = await exiftool.read(path)
  if (isRaw(path)) {
    const best = PREVIEW_TAGS.map((tag) => ({ tag, size: binarySize((tags as Record<string, unknown>)[tag]) }))
      .filter((t) => t.size > 0)
      .sort((a, b) => b.size - a.size)[0]
    if (!best) throw new Error('No embedded preview in this RAW file')
    await exiftool.extractBinaryTag(best.tag, path, dest)
  } else {
    await fs.copyFile(path, dest)
  }

  const handle = await fs.open(dest, 'r')
  const head = new Uint8Array(256 * 1024)
  const { bytesRead } = await handle.read(head, 0, head.length, 0)
  await handle.close()
  const embedded = readJpegOrientation(head.subarray(0, bytesRead))
  const rawOrientation = typeof tags.Orientation === 'number' ? tags.Orientation : 1

  return {
    url: `media://local/${projectId}/tmp/${shotId}.jpg`,
    // If the preview states its own rotation the browser applies it for us.
    applyOrientation: embedded > 1 ? 1 : rawOrientation,
    meta: await readMeta(tags, path)
  }
}

async function readMeta(tags: Tags, path: string): Promise<ExtractResult['meta']> {
  const t = tags.SubSecDateTimeOriginal ?? tags.DateTimeOriginal ?? tags.CreateDate
  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
    return Number.isFinite(n) ? n : undefined
  }
  return {
    // Without a capture time, fall back to the file date so ordering still works.
    time: t && typeof t === 'object' && 'toMillis' in t ? t.toMillis() : (await fs.stat(path)).mtimeMs,
    iso: num(tags.ISO),
    shutter: tags.ExposureTime != null ? String(tags.ExposureTime) : undefined,
    aperture: num(tags.FNumber),
    focal: num(tags.FocalLength),
    lens: tags.LensModel ?? (tags.LensID != null ? String(tags.LensID) : undefined),
    camera: tags.Model
  }
}

/** Stores the downsized preview and thumbnail made by the renderer, then drops the temp file. */
export async function savePreview(
  projectId: string,
  shotId: string,
  preview: ArrayBuffer,
  thumb: ArrayBuffer
): Promise<void> {
  safeId(shotId)
  const dir = cacheDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, `${shotId}.jpg`), Buffer.from(preview))
  await fs.writeFile(join(dir, `${shotId}_t.jpg`), Buffer.from(thumb))
  await fs.rm(join(tmpDir(projectId), `${shotId}.jpg`), { force: true })
}
