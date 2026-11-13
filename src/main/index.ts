import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, renameSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { TuneRequest, AtmosphereRequest, DevelopStyleRequest, NameFacesRequest, EssenceRequest, Learned, Project, ReadRequest, StoryRequest, XmpItem } from '@shared/types'
import { atmosphere, developStyle, nameFaces, narrativeRead, storyAdvice, styleEssence, tuneLearning } from './ai'
import { promises as fs } from 'node:fs'
import { copySelects, exportXmp, readRatings, saveFiles } from './exporter'
import { exiftool, extractPreview, savePreview, scanFolder } from './ingest'
import { appVersion, backupTo, checkForUpdate, downloadAndInstall, installFromFile, restoreFrom, setUpdateToken, startAutoBackup } from './updater'
import {
  getData,
  saveData,
  getLearned,
  getLearning,
  getTraining,
  saveTraining,
  saveLearning,
  getSpend,
  getSettings,
  listProjects,
  loadProject,
  removeProject,
  removeStyleSamples,
  saveLearned,
  resolveMediaPath,
  saveProject,
  setSettings
} from './store'

// A separate profile lets automated tests run without touching real projects.
if (process.env.ATELIER_USER_DATA) app.setPath('userData', process.env.ATELIER_USER_DATA)
else keepData()

/**
 * The app was called Atelier, and its data folder was named after it
 * (%APPDATA%\Atelier). Renamed to Sift, it would look in %APPDATA%\Sift and
 * find nothing. On first start the old folder is moved to the new name; if
 * that is not possible, the old folder simply goes on being used.
 */
function keepData(): void {
  const appData = app.getPath('appData')
  const old = join(appData, 'Atelier')
  const now = join(appData, 'Sift')
  if (!existsSync(old)) return
  if (!existsSync(now)) {
    try {
      renameSync(old, now)
      app.setPath('userData', now)
      return
    } catch {
      // Something holds the old folder open; keep using it where it is.
    }
  }
  // Both exist only if Sift has run before without moving; prefer whichever holds projects.
  if (!existsSync(join(now, 'projects')) && existsSync(join(old, 'projects'))) app.setPath('userData', old)
  else app.setPath('userData', now)
}

// media:// serves cached previews to the renderer. It can only read inside the
// app's own projects folder, never arbitrary files.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

const BACKGROUND = '#2e2e2e'
const ICON = join(__dirname, '../renderer/icon.png')

function newWindow(options: Electron.BrowserWindowConstructorOptions, hash = ''): BrowserWindow {
  const win = new BrowserWindow({
    backgroundColor: BACKGROUND,
    icon: ICON,
    autoHideMenuBar: true,
    ...options,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + hash)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.replace(/^#/, '') })
  return win
}

let mainWindow: BrowserWindow | null = null
let workshop: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = newWindow({ width: 1480, height: 940, minWidth: 1100, minHeight: 700, title: 'Sift' })
  mainWindow.on('closed', () => {
    mainWindow = null
    // The workshop has no use without the studio.
    workshop?.close()
  })
}

/** The workshop: everything the app has learned and the training, in a window of its own. */
function openWorkshop(section?: string): void {
  if (workshop && !workshop.isDestroyed()) {
    if (section) workshop.webContents.send('workshop:go', section)
    workshop.focus()
    return
  }
  workshop = newWindow({ width: 1240, height: 880, minWidth: 960, minHeight: 640, title: 'Sift · Workshop' }, `#workshop${section ? '/' + section : ''}`)
  workshop.on('closed', () => (workshop = null))
}

/** Tells the other windows that a store on disk changed, so they reload it. */
function changed(sender: Electron.WebContents, name: string): void {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== sender && !w.isDestroyed()) w.webContents.send('changed', name)
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as A)))
  }
  /** A save that the other windows must hear about. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saving = <A extends any[]>(channel: string, name: (...args: A) => string, fn: (...args: A) => Promise<void>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      await fn(...(args as A))
      changed(event.sender, name(...(args as A)))
    })
  }
  handle('projects:list', listProjects)
  handle('projects:load', (id: string) => loadProject(id))
  saving('projects:save', (p: Project, _a?: boolean) => `project:${p.id}`, (project: Project, analysisChanged?: boolean) => saveProject(project, analysisChanged))
  saving('projects:remove', (id: string) => `project:${id}`, (id: string) => removeProject(id))
  handle('pickFolder', async () => {
    // A folder picker lists folders only, so a folder full of photos looks empty in it.
    const result = await dialog.showOpenDialog({
      title: 'Choose the folder that holds the photos (files are not listed here, only folders)',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('pickImage', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose a photo', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('saveText', async (defaultName: string, content: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, content)
    return result.filePath
  })
  handle('saveFiles', (folder: string, files: { name: string; data: ArrayBuffer }[]) => saveFiles(folder, files))
  handle('scan', (folder: string, anyImage?: boolean) => scanFolder(folder, anyImage))
  handle('learned:get', getLearned)
  saving('learned:save', (_l: Learned) => 'learned', (learned: Learned) => saveLearned(learned))
  handle('learned:removeSamples', (styleId: string) => removeStyleSamples(styleId))
  handle('extract', (projectId: string, shotId: string, path: string) => extractPreview(projectId, shotId, path))
  handle('savePreview', (projectId: string, shotId: string, preview: ArrayBuffer, thumb: ArrayBuffer) =>
    savePreview(projectId, shotId, preview, thumb)
  )
  handle('exportXmp', (items: XmpItem[]) => exportXmp(items))
  handle('copySelects', (paths: string[], dest: string) => copySelects(paths, dest))
  handle('reveal', (path: string) => shell.showItemInFolder(path))
  handle('data:get', (name: string) => getData(name))
  saving('data:save', (name: string, _v: unknown) => name, (name: string, value: unknown) => saveData(name, value))
  handle('learning:get', getLearning)
  saving('learning:save', (_d: unknown) => 'learning', (data: unknown) => saveLearning(data))
  handle('training:get', getTraining)
  saving('training:save', (_d: unknown) => 'training', (data: unknown) => saveTraining(data))
  handle('readRatings', (paths: string[]) => readRatings(paths))
  handle('spend', getSpend)
  handle('settings:get', getSettings)
  ipcMain.handle('settings:set', async (event, patch: Parameters<typeof setSettings>[0]) => {
    const s = await setSettings(patch)
    changed(event.sender, 'settings')
    return s
  })
  handle('workshop:open', (section?: string) => openWorkshop(section))
  handle('studio:focus', () => mainWindow?.focus())
  handle('update:check', checkForUpdate)
  handle('update:setToken', (token: string) => setUpdateToken(token))
  ipcMain.handle('update:download', (event, assetId: number) => downloadAndInstall(assetId, event.sender))
  handle('update:installFile', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose the new Sift installer', filters: [{ name: 'Installer', extensions: ['exe'] }], properties: ['openFile'] })
    if (result.canceled) return false
    await installFromFile(result.filePaths[0])
    return true
  })
  handle('data:backup', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose where to put the backup', buttonLabel: 'Back up here', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled) return null
    const folder = join(result.filePaths[0], `Sift backup ${new Date().toISOString().slice(0, 10)}`)
    await backupTo(folder)
    return folder
  })
  handle('data:restore', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose a Sift backup folder', properties: ['openDirectory'] })
    if (result.canceled) return null
    return restoreFrom(result.filePaths[0])
  })
  handle('data:folder', () => shell.openPath(app.getPath('userData')))
  handle('app:version', appVersion)
  handle('ai:story', (req: StoryRequest) => storyAdvice(req))
  handle('ai:read', (req: ReadRequest) => narrativeRead(req))
  handle('ai:nameFaces', (req: NameFacesRequest) => nameFaces(req))
  handle('ai:developStyle', (req: DevelopStyleRequest) => developStyle(req))
  handle('ai:atmosphere', (req: AtmosphereRequest) => atmosphere(req))
  handle('ai:essence', (req: EssenceRequest) => styleEssence(req))
  handle('ai:tune', (req: TuneRequest) => tuneLearning(req))
}

void app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    try {
      const { pathname } = new URL(request.url)
      return net.fetch(pathToFileURL(resolveMediaPath(decodeURIComponent(pathname).replace(/^\/+/, ''))).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  registerIpc()
  createWindow()
  startAutoBackup()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void exiftool.end()
  if (process.platform !== 'darwin') app.quit()
})
