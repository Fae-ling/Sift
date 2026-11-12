// Updating the app in place, and keeping what it has learned safe.
//
// Everything Sift learns lives in its data folder (%APPDATA%\Sift on
// Windows), never in the folder the app is installed to. Installing a newer
// version over the old one replaces the program and leaves the data alone.
// This module finds a newer installer (on GitHub, with a read-only token the
// photographer adds once, or a file they downloaded), backs the data up, runs
// the installer silently and restarts the app.

import { app, BrowserWindow, safeStorage } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { newer } from '@shared/version'

/** Where releases are published. */
export const UPDATE_REPO = 'Fae-ling/symmetrical-goggles'

const tokenFile = (): string => join(app.getPath('userData'), 'update.json')

async function readToken(): Promise<string | null> {
  try {
    const { tokenEnc } = JSON.parse(await fs.readFile(tokenFile(), 'utf8')) as { tokenEnc?: string }
    if (tokenEnc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(tokenEnc, 'base64'))
  } catch {
    // No token saved.
  }
  return null
}

export async function setUpdateToken(token: string): Promise<void> {
  const t = token.trim()
  if (!t) return fs.rm(tokenFile(), { force: true })
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer offers no encrypted storage, so the token cannot be kept safely.')
  await fs.writeFile(tokenFile(), JSON.stringify({ tokenEnc: safeStorage.encryptString(t).toString('base64') }))
}

/** The app's version. Run from source, Electron reports its own, so the project's is read instead. */
export function appVersion(): string {
  if (app.isPackaged) return app.getVersion()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require(join(app.getAppPath(), '..', '..', 'package.json')) as { version: string }).version
  } catch {
    return app.getVersion()
  }
}

export interface UpdateStatus {
  current: string
  hasToken: boolean
  dataFolder: string
  latest?: { version: string; notes: string; published: string; assetId: number; size: number }
  error?: string
}

const api = async (path: string, token: string, accept = 'application/vnd.github+json'): Promise<Response> =>
  fetch(`https://api.github.com/repos/${UPDATE_REPO}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': 'Sift-updater', 'X-GitHub-Api-Version': '2022-11-28' }
  })

export async function checkForUpdate(): Promise<UpdateStatus> {
  const status: UpdateStatus = { current: appVersion(), hasToken: false, dataFolder: app.getPath('userData') }
  const token = await readToken()
  status.hasToken = !!token
  if (!token) return status
  try {
    const res = await api('/releases/latest', token)
    if (res.status === 401 || res.status === 403) throw new Error('GitHub refused the token. Check that it can read this repository’s contents.')
    if (res.status === 404) throw new Error('No release found yet. A release is made each time a new version is built.')
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
    const release = (await res.json()) as { tag_name: string; body?: string; published_at: string; assets: { id: number; name: string; size: number }[] }
    const asset = release.assets.find((a) => /\.exe$/i.test(a.name))
    if (asset && newer(release.tag_name, status.current)) {
      status.latest = { version: release.tag_name.replace(/^v/, ''), notes: release.body ?? '', published: release.published_at, assetId: asset.id, size: asset.size }
    }
  } catch (err) {
    status.error = (err as Error).message
  }
  return status
}

// --- keeping the data safe -----------------------------------------------------------

/** Everything learned and decided, without the preview caches (which can be rebuilt). */
async function dataFiles(): Promise<string[]> {
  const root = app.getPath('userData')
  const out: string[] = []
  for (const name of await fs.readdir(root)) if (name.endsWith('.json') && name !== 'update.json') out.push(name)
  const projects = join(root, 'projects')
  for (const id of await fs.readdir(projects).catch(() => [] as string[])) {
    for (const f of ['project.json', 'analysis.json']) {
      const rel = join('projects', id, f)
      if (await fs.stat(join(root, rel)).then(() => true, () => false)) out.push(rel)
    }
  }
  return out
}

/** Copies what the app has learned and every project's decisions into a folder. Returns how many files. */
export async function backupTo(folder: string): Promise<number> {
  const root = app.getPath('userData')
  const files = await dataFiles()
  for (const rel of files) {
    await fs.mkdir(join(folder, rel, '..'), { recursive: true })
    await fs.copyFile(join(root, rel), join(folder, rel))
  }
  await fs.writeFile(join(folder, 'sift-backup.txt'), `Sift ${appVersion()} backup, ${new Date().toISOString()}\n`)
  return files.length
}

/** Puts a backup back. The app then reloads, since everything it holds in memory is out of date. */
export async function restoreFrom(folder: string): Promise<number> {
  const marked = async (name: string): Promise<boolean> => fs.stat(join(folder, name)).then(() => true, () => false)
  if (!(await marked('sift-backup.txt')) && !(await marked('atelier-backup.txt'))) throw new Error('That folder is not a Sift backup.')
  const root = app.getPath('userData')
  // The present state is kept too, in case the restore was a mistake.
  await backupTo(join(root, 'backups', `before-restore-${Date.now()}`))
  let n = 0
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(join(folder, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name)
      if (entry.isDirectory()) await walk(rel)
      else if (entry.name.endsWith('.json')) {
        await fs.mkdir(join(root, dir), { recursive: true })
        await fs.copyFile(join(folder, rel), join(root, rel))
        n++
      }
    }
  }
  await walk('')
  for (const w of BrowserWindow.getAllWindows()) w.reload()
  return n
}

/** A backup inside the data folder before every update; the three newest are kept. */
async function autoBackup(): Promise<void> {
  const dir = join(app.getPath('userData'), 'backups')
  await backupTo(join(dir, `before-update-${appVersion()}-${Date.now()}`))
  const old = (await fs.readdir(dir)).filter((d) => d.startsWith('before-update-')).sort()
  for (const d of old.slice(0, -3)) await fs.rm(join(dir, d), { recursive: true, force: true })
}

// --- installing --------------------------------------------------------------------

function runInstaller(file: string): void {
  if (process.platform !== 'win32') throw new Error('Updating in place works on Windows. On this system, install the new version by hand.')
  // Silent install over the existing one, then start the new version. The data folder is not touched.
  spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 500)
}

export async function installFromFile(file: string): Promise<void> {
  if (!/\.exe$/i.test(file)) throw new Error('Choose the Sift installer (a .exe file).')
  await autoBackup()
  runInstaller(file)
}

/** Downloads the newest installer, reporting progress to the window that asked, then installs it. */
export async function downloadAndInstall(assetId: number, sender: Electron.WebContents): Promise<void> {
  const token = await readToken()
  if (!token) throw new Error('Add a GitHub token first.')
  const res = await api(`/releases/assets/${assetId}`, token, 'application/octet-stream')
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const file = join(app.getPath('temp'), `Sift-update-${Date.now()}.exe`)
  let done = 0
  let last = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    done += chunk.length
    if (Date.now() - last > 200) {
      last = Date.now()
      if (!sender.isDestroyed()) sender.send('update:progress', total ? done / total : 0)
    }
  })
  await pipeline(body, createWriteStream(file))
  await autoBackup()
  runInstaller(file)
}
