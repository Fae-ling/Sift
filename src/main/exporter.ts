import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DevelopSettings, ExportResult, XmpItem } from '@shared/types'
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
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Atelier">
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
        throw new Error('JPEG originals keep ratings inside the file; Atelier never modifies originals.')
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

/** The develop settings the edit coach knows how to comment on. */
const DEVELOP_TAGS = [
  'ProcessVersion', 'WhiteBalance', 'Temperature', 'Tint', 'Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012',
  'Whites2012', 'Blacks2012', 'Texture', 'Clarity2012', 'Dehaze', 'Vibrance', 'Saturation', 'ToneCurveName2012',
  'ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights',
  'HueAdjustmentRed', 'HueAdjustmentOrange', 'HueAdjustmentYellow', 'HueAdjustmentGreen',
  'SaturationAdjustmentRed', 'SaturationAdjustmentOrange', 'SaturationAdjustmentYellow', 'SaturationAdjustmentGreen', 'SaturationAdjustmentBlue',
  'LuminanceAdjustmentOrange', 'LuminanceAdjustmentBlue',
  'ColorGradeShadowSat', 'ColorGradeMidtoneSat', 'ColorGradeHighlightSat', 'SplitToningShadowHue', 'SplitToningShadowSaturation',
  'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeMidtoneHue',
  'Sharpness', 'SharpenEdgeMasking', 'LuminanceSmoothing', 'ColorNoiseReduction', 'GrainAmount', 'PostCropVignetteAmount',
  'HasCrop', 'LensProfileEnable', 'CameraProfile', 'Look'
]

/**
 * Reads what Lightroom has written into the sidecar next to a RAW. Lightroom
 * only does that when "Automatically write changes into XMP" is on (or after
 * Ctrl+S), so the coach can follow an edit in progress without touching it.
 */
export async function readDevelop(path: string): Promise<DevelopSettings | null> {
  const sidecar = sidecarPath(path)
  let modified: number
  try {
    modified = (await fs.stat(sidecar)).mtimeMs
  } catch {
    return null
  }
  const tags = (await exiftool.read(sidecar)) as unknown as Record<string, unknown>
  const values: DevelopSettings['values'] = {}
  for (const name of DEVELOP_TAGS) {
    const v = tags[name]
    if (typeof v === 'number' || typeof v === 'string') values[name] = v
    else if (typeof v === 'boolean') values[name] = v ? 1 : 0
  }
  return { modified, values }
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
