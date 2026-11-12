import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ExportResult, XmpItem } from '@shared/types'
import { exiftool, isRaw } from './ingest'

const sidecarPath = (path: string): string => path.slice(0, path.length - extname(path).length) + '.xmp'

const exists = (path: string): Promise<boolean> =>
  fs.access(path).then(
    () => true,
    () => false
  )

const escapeXml = (s: string): string =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

export function newSidecar(rating: number, label: string | null): string {
  const attrs = [`xmp:Rating="${rating}"`, ...(label ? [`xmp:Label="${escapeXml(label)}"`] : [])].join(' ')
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Sift">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ${attrs}/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`
}

/**
 * Writes star ratings and colour labels into XMP sidecars next to the RAW
 * files, the form Lightroom Classic reads on import. An existing sidecar
 * (which may hold your develop settings) is updated in place, never replaced.
 * The RAW files themselves are not touched.
 */
export async function exportXmp(items: XmpItem[]): Promise<ExportResult> {
  const result: ExportResult = { written: 0, failed: [] }
  for (const item of items) {
    try {
      if (!isRaw(item.path)) {
        throw new Error('JPEG originals keep ratings inside the file; Sift never modifies originals.')
      }
      const sidecar = sidecarPath(item.path)
      if (await exists(sidecar)) {
        await exiftool.write(
          sidecar,
          { 'XMP-xmp:Rating': item.rating, 'XMP-xmp:Label': item.label } as never,
          { writeArgs: ['-overwrite_original'] }
        )
      } else {
        await fs.writeFile(sidecar, newSidecar(item.rating, item.label), { flag: 'wx' })
      }
      result.written++
    } catch (err) {
      result.failed.push({ path: item.path, error: (err as Error).message })
    }
  }
  return result
}

/** Copies the chosen originals (and their sidecars) into a folder. Existing files are left alone. */
export async function copySelects(paths: string[], dest: string): Promise<ExportResult> {
  const result: ExportResult = { written: 0, failed: [] }
  await fs.mkdir(dest, { recursive: true })
  for (const path of paths) {
    try {
      await fs.copyFile(path, join(dest, basename(path)), fs.constants.COPYFILE_EXCL)
      const sidecar = sidecarPath(path)
      if (isRaw(path) && (await exists(sidecar))) {
        await fs.copyFile(sidecar, join(dest, basename(sidecar)), fs.constants.COPYFILE_EXCL).catch(() => {})
      }
      result.written++
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      result.failed.push({ path, error: e.code === 'EEXIST' ? 'A file with this name is already there.' : e.message })
    }
  }
  return result
}

/** Writes several files into a folder the user chose. Names are reduced to a safe base name; existing files are kept. */
export async function saveFiles(folder: string, files: { name: string; data: ArrayBuffer }[]): Promise<ExportResult> {
  const result: ExportResult = { written: 0, failed: [] }
  await fs.mkdir(folder, { recursive: true })
  for (const file of files) {
    const name = basename(file.name).replace(/[^\w.\- ]+/g, '_')
    try {
      await fs.writeFile(join(folder, name), Buffer.from(file.data), { flag: 'wx' })
      result.written++
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      result.failed.push({ path: name, error: e.code === 'EEXIST' ? 'A file with this name is already there.' : e.message })
    }
  }
  return result
}

/**
 * Reads the star rating and colour label a photo already carries: from the XMP
 * sidecar for a RAW, from the file itself otherwise. Used to learn from shoots
 * that were culled in Lightroom before Sift existed.
 */
export async function readRatings(paths: string[]): Promise<{ path: string; rating: number | null; label: string | null }[]> {
  const out: { path: string; rating: number | null; label: string | null }[] = []
  for (const path of paths) {
    const sidecar = sidecarPath(path)
    const source = isRaw(path) ? ((await exists(sidecar)) ? sidecar : null) : path
    if (!source) {
      out.push({ path, rating: null, label: null })
      continue
    }
    try {
      const tags = (await exiftool.read(source)) as unknown as Record<string, unknown>
      out.push({ path, rating: typeof tags.Rating === 'number' ? tags.Rating : null, label: typeof tags.Label === 'string' ? tags.Label : null })
    } catch {
      out.push({ path, rating: null, label: null })
    }
  }
  return out
}
