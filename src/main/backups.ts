// Keeping copies of what Sift has learned, without letting them pile up.
//
// Three kinds of copy live in <userData>/backups, each in a folder named
// `<kind>-<time in ms>[-detail]`, and each with its own rule for how many stay:
//
//   auto            made by the app itself, at most once a day and only if
//                   something changed since the last one. Kept: the newest of
//                   each of the last 7 days, then the newest of each of the
//                   following 4 weeks. Older ones go.
//   before-update   made just before an installer runs. The newest 3 stay.
//   before-restore  made just before a backup is put back. The newest 2 stay.
//
// Nothing here depends on Electron, so it can be tested on its own.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const MARKER = 'sift-backup.txt'
const DAY = 24 * 60 * 60 * 1000

export type BackupKind = 'auto' | 'before-update' | 'before-restore'

/** How many of each hand-triggered kind to keep. Automatic copies follow the day/week rule instead. */
export const KEEP: Record<Exclude<BackupKind, 'auto'>, number> = { 'before-update': 3, 'before-restore': 2 }
export const AUTO_DAYS = 7
export const AUTO_WEEKS = 4

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)

/** Everything learned and decided, without the preview caches (which can be rebuilt). Paths are relative to root. */
export async function dataFiles(root: string): Promise<string[]> {
  const out: string[] = []
  for (const name of await fs.readdir(root)) if (name.endsWith('.json') && name !== 'update.json') out.push(name)
  const projects = join(root, 'projects')
  for (const id of await fs.readdir(projects).catch(() => [] as string[])) {
    for (const f of ['project.json', 'analysis.json']) {
      const rel = join('projects', id, f)
      if (await exists(join(root, rel))) out.push(rel)
    }
  }
  return out
}

/**
 * Copies the data files into a folder and checks each copy came out the same size,
 * so a full disk or an interrupted copy is an error, not a backup that looks fine.
 * Returns how many files.
 */
export async function backupTo(root: string, folder: string, version: string): Promise<number> {
  const files = await dataFiles(root)
  for (const rel of files) {
    const to = join(folder, rel)
    await fs.mkdir(join(to, '..'), { recursive: true })
    await fs.copyFile(join(root, rel), to)
    const [a, b] = await Promise.all([fs.stat(join(root, rel)), fs.stat(to)])
    // The source may have been legitimately rewritten while copying; only a short copy is wrong.
    if (b.size === 0 && a.size > 0) throw new Error(`The backup of ${rel} is empty. Is the disk full?`)
  }
  // The marker goes last: a folder without it is an unfinished backup, and is cleared away.
  await fs.writeFile(join(folder, MARKER), `Sift ${version} backup, ${new Date().toISOString()}\n`)
  return files.length
}

interface Found {
  name: string
  kind: BackupKind
  time: number
}

/** The backups in the folder, newest first. Folders the app did not make are left out, and never touched. */
export async function listBackups(dir: string): Promise<Found[]> {
  const out: Found[] = []
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    // `before-update-<version>-<ms>` carries a version in the middle; the others are `<kind>-<ms>`.
    const m = /^(auto|before-update|before-restore)-(?:.*-)?(\d{10,})$/.exec(name)
    if (m) out.push({ name, kind: m[1] as BackupKind, time: Number(m[2]) })
  }
  return out.sort((a, b) => b.time - a.time)
}

/** Which of the automatic backups (newest first) stay. Pure, so the rule can be tested. */
export function autoToKeep(times: number[], now: number): Set<number> {
  const keep = new Set<number>()
  const days = new Set<number>()
  const weeks = new Set<number>()
  for (const t of times) {
    const age = now - t
    if (age <= AUTO_DAYS * DAY) {
      const day = Math.floor(t / DAY)
      if (!days.has(day)) (days.add(day), keep.add(t))
    } else if (age <= (AUTO_DAYS + AUTO_WEEKS * 7) * DAY) {
      const week = Math.floor(t / (7 * DAY))
      if (!weeks.has(week)) (weeks.add(week), keep.add(t))
    }
  }
  // Whatever else happens, the very newest stays.
  if (times.length) keep.add(times[0])
  return keep
}

/** Removes backups beyond what each kind keeps, and any unfinished ones. Returns the names removed. */
export async function prune(dir: string, now = Date.now()): Promise<string[]> {
  const all = await listBackups(dir)
  const drop: string[] = []
  for (const b of all) if (!(await exists(join(dir, b.name, MARKER))) && now - b.time > 60 * 60 * 1000) drop.push(b.name)
  const finished = all.filter((b) => !drop.includes(b.name))
  const keepAuto = autoToKeep(finished.filter((b) => b.kind === 'auto').map((b) => b.time), now)
  for (const b of finished.filter((b) => b.kind === 'auto')) if (!keepAuto.has(b.time)) drop.push(b.name)
  for (const kind of Object.keys(KEEP) as (keyof typeof KEEP)[]) {
    for (const b of finished.filter((x) => x.kind === kind).slice(KEEP[kind])) drop.push(b.name)
  }
  for (const name of drop) await fs.rm(join(dir, name), { recursive: true, force: true })
  return drop
}

/** Makes a backup of the given kind inside `<root>/backups`, then trims the folder. */
export async function makeBackup(root: string, kind: BackupKind, version: string, now = Date.now()): Promise<string> {
  const dir = join(root, 'backups')
  const folder = join(dir, kind === 'before-update' ? `${kind}-${version}-${now}` : `${kind}-${now}`)
  await backupTo(root, folder, version)
  await prune(dir, now).catch(() => {
    // Trimming is housekeeping; a failure must not turn a good backup into an error.
  })
  return folder
}

/** True when any data file has changed since the newest backup was made. */
export async function changedSinceLastBackup(root: string): Promise<boolean> {
  const [latest] = await listBackups(join(root, 'backups'))
  if (!latest) return true
  const files = await dataFiles(root)
  for (const rel of files) {
    const st = await fs.stat(join(root, rel)).catch(() => null)
    if (st && st.mtimeMs > latest.time) return true
  }
  return false
}

/** The daily backup: skipped when there is nothing new, or when one was made in the last day. */
export async function autoBackup(root: string, version: string, now = Date.now()): Promise<string | null> {
  const [latest] = (await listBackups(join(root, 'backups'))).filter((b) => b.kind === 'auto')
  if (latest && now - latest.time < DAY) return null
  if (!(await changedSinceLastBackup(root))) return null
  return makeBackup(root, 'auto', version, now)
}
