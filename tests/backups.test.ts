import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autoBackup, autoToKeep, listBackups, makeBackup, prune, MARKER } from '../src/main/backups'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 13, 12)

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sift-backups-'))
  await writeFile(join(root, 'learned.json'), '{"styles":[]}')
  await writeFile(join(root, 'update.json'), 'secret')
  await mkdir(join(root, 'projects', 'p1', 'cache'), { recursive: true })
  await writeFile(join(root, 'projects', 'p1', 'project.json'), '{"id":"p1"}')
  await writeFile(join(root, 'projects', 'p1', 'analysis.json'), '{}')
  await writeFile(join(root, 'projects', 'p1', 'cache', 'a.jpg'), 'big')
  // The tests run on a made-up clock; make the files older than it.
  const old = new Date(NOW - 10 * DAY)
  for (const f of ['learned.json', 'projects/p1/project.json', 'projects/p1/analysis.json']) await utimes(join(root, f), old, old)
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('autoToKeep', () => {
  it('keeps one per day for a week, one per week for four more, and drops the rest', () => {
    // Four a day for 60 days.
    const times: number[] = []
    for (let d = 0; d < 60; d++) for (let h = 0; h < 4; h++) times.push(NOW - d * DAY - h * 3_600_000)
    const kept = [...autoToKeep(times, NOW)]
    expect(kept.length).toBeGreaterThanOrEqual(10)
    expect(kept.length).toBeLessThanOrEqual(13) // ~7 days + ~4-5 weeks
    expect(kept).toContain(times[0])
    expect(kept.every((t) => NOW - t <= 35 * DAY)).toBe(true)
  })
  it('keeps the newest even when it is old', () => {
    expect([...autoToKeep([NOW - 90 * DAY], NOW)]).toEqual([NOW - 90 * DAY])
  })
})

describe('backups on disk', () => {
  it('copies data files, not caches or the update token, and marks the folder done', async () => {
    const folder = await makeBackup(root, 'auto', '0.2.12', NOW)
    expect((await readdir(folder)).sort()).toEqual(['learned.json', 'projects', MARKER].sort())
    expect(await readdir(join(folder, 'projects', 'p1'))).toEqual(expect.arrayContaining(['project.json', 'analysis.json']))
    expect(await readdir(join(folder, 'projects', 'p1'))).not.toContain('cache')
  })

  it('keeps the newest 3 before-update backups, ordering by time not by version text', async () => {
    // As text, "0.2.9" sorts after "0.2.12"; ordering must follow the time.
    const versions = ['0.2.9', '0.2.10', '0.2.11', '0.2.12', '0.2.13']
    for (const [i, v] of versions.entries()) await makeBackup(root, 'before-update', v, NOW + i * 1000)
    const left = (await listBackups(join(root, 'backups'))).map((b) => b.name)
    expect(left).toEqual(['before-update-0.2.13-' + (NOW + 4000), 'before-update-0.2.12-' + (NOW + 3000), 'before-update-0.2.11-' + (NOW + 2000)])
  })

  it('keeps the newest 2 before-restore backups', async () => {
    for (let i = 0; i < 4; i++) await makeBackup(root, 'before-restore', '0.2.12', NOW + i * 1000)
    expect(await listBackups(join(root, 'backups'))).toHaveLength(2)
  })

  it('removes unfinished folders, leaves folders it did not make, and keeps a fresh one that may still be written', async () => {
    const dir = join(root, 'backups')
    await mkdir(join(dir, `auto-${NOW - 5 * 3_600_000}`), { recursive: true }) // no marker, old: unfinished
    await mkdir(join(dir, `auto-${NOW - 60_000}`), { recursive: true }) // no marker, a minute old: maybe in progress
    await mkdir(join(dir, 'my-own-notes'), { recursive: true })
    await prune(dir, NOW)
    expect((await readdir(dir)).sort()).toEqual([`auto-${NOW - 60_000}`, 'my-own-notes'].sort())
  })

  it('makes an automatic backup only when a day has passed and something changed', async () => {
    expect(await autoBackup(root, '0.2.12', NOW)).not.toBeNull() // first ever
    expect(await autoBackup(root, '0.2.12', NOW + 2 * 3_600_000)).toBeNull() // too soon
    expect(await autoBackup(root, '0.2.12', NOW + 2 * DAY)).toBeNull() // a day on, but nothing changed
    const later = new Date(NOW + 3 * DAY)
    await utimes(join(root, 'learned.json'), later, later)
    expect(await autoBackup(root, '0.2.12', NOW + 3 * DAY + 1000)).not.toBeNull() // changed
    expect(await listBackups(join(root, 'backups'))).toHaveLength(2)
  })

  it('never lets automatic backups pile up', async () => {
    for (let d = 0; d < 120; d++) await makeBackup(root, 'auto', '0.2.12', NOW + d * DAY)
    expect((await listBackups(join(root, 'backups'))).length).toBeLessThanOrEqual(13)
  })

  it('links files unchanged since the last backup instead of copying them, and copies the ones that changed', async () => {
    const first = await makeBackup(root, 'auto', '0.2.12', NOW)
    const later = new Date(NOW + DAY)
    await writeFile(join(root, 'projects', 'p1', 'project.json'), '{"id":"p1","edited":true}')
    await utimes(join(root, 'projects', 'p1', 'project.json'), later, later)
    const second = await makeBackup(root, 'auto', '0.2.12', NOW + DAY + 2000)
    const same = async (f: string): Promise<boolean> => (await stat(join(first, f))).ino === (await stat(join(second, f))).ino
    expect(await same('projects/p1/analysis.json')).toBe(true) // unchanged: shared on disk
    expect(await same('learned.json')).toBe(true)
    expect(await same('projects/p1/project.json')).toBe(false) // changed: its own copy
    expect(await readFile(join(first, 'projects/p1/project.json'), 'utf8')).toBe('{"id":"p1"}') // the old one is untouched
    expect(await readFile(join(second, 'projects/p1/project.json'), 'utf8')).toContain('edited')
  })

  it('keeps a backup whole after the older one it shares files with is removed', async () => {
    await makeBackup(root, 'before-restore', '0.2.12', NOW)
    await makeBackup(root, 'before-restore', '0.2.12', NOW + 1000)
    const last = await makeBackup(root, 'before-restore', '0.2.12', NOW + 2000) // the first is pruned now
    expect(await readdir(join(root, 'backups'))).toHaveLength(2)
    expect(await readFile(join(last, 'projects/p1/analysis.json'), 'utf8')).toBe('{}')
    expect(await readFile(join(last, 'learned.json'), 'utf8')).toBe('{"styles":[]}')
  })

  it('does not link to a file changed after the previous backup began', async () => {
    const first = await makeBackup(root, 'auto', '0.2.12', NOW)
    const later = new Date(NOW + DAY - 500)
    await writeFile(join(root, 'learned.json'), '{"styles":[1]}') // same size, newer
    await utimes(join(root, 'learned.json'), later, later)
    const second = await makeBackup(root, 'auto', '0.2.12', NOW + DAY)
    expect(await readFile(join(second, 'learned.json'), 'utf8')).toBe('{"styles":[1]}')
    expect(await readFile(join(first, 'learned.json'), 'utf8')).toBe('{"styles":[]}')
  })
})
