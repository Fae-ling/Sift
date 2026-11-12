import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DiagnoseRequest, EssenceRequest, GradeRequest, Learned, Project, ReadRequest, StoryRequest, XmpItem } from '@shared/types'
import { diagnose, gradeAdvice, narrativeRead, storyAdvice, styleEssence } from './ai'
import { promises as fs } from 'node:fs'
import { copySelects, exportXmp, readDevelop, readRatings, saveFiles } from './exporter'
import { exiftool, extractPreview, savePreview, scanFolder } from './ingest'
import {
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

// media:// serves cached previews to the renderer. It can only read inside the
// app's own projects folder, never arbitrary files.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1c1c1c',
    autoHideMenuBar: true,
    title: 'Atelier',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as A)))
  }
  handle('projects:list', listProjects)
  handle('projects:load', (id: string) => loadProject(id))
  handle('projects:save', (project: Project) => saveProject(project))
  handle('projects:remove', (id: string) => removeProject(id))
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
  handle('readDevelop', (path: string) => readDevelop(path))
  handle('scan', (folder: string, anyImage?: boolean) => scanFolder(folder, anyImage))
  handle('learned:get', getLearned)
  handle('learned:save', (learned: Learned) => saveLearned(learned))
  handle('learned:removeSamples', (styleId: string) => removeStyleSamples(styleId))
  handle('extract', (projectId: string, shotId: string, path: string) => extractPreview(projectId, shotId, path))
  handle('savePreview', (projectId: string, shotId: string, preview: ArrayBuffer, thumb: ArrayBuffer) =>
    savePreview(projectId, shotId, preview, thumb)
  )
  handle('exportXmp', (items: XmpItem[]) => exportXmp(items))
  handle('copySelects', (paths: string[], dest: string) => copySelects(paths, dest))
  handle('reveal', (path: string) => shell.showItemInFolder(path))
  handle('learning:get', getLearning)
  handle('learning:save', (data: unknown) => saveLearning(data))
  handle('training:get', getTraining)
  handle('training:save', (data: unknown) => saveTraining(data))
  handle('readRatings', (paths: string[]) => readRatings(paths))
  handle('spend', getSpend)
  handle('settings:get', getSettings)
  handle('settings:set', (patch: { apiKey?: string; model?: string }) => setSettings(patch))
  handle('ai:story', (req: StoryRequest) => storyAdvice(req))
  handle('ai:grade', (req: GradeRequest) => gradeAdvice(req))
  handle('ai:read', (req: ReadRequest) => narrativeRead(req))
  handle('ai:diagnose', (req: DiagnoseRequest) => diagnose(req))
  handle('ai:essence', (req: EssenceRequest) => styleEssence(req))
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void exiftool.end()
  if (process.platform !== 'darwin') app.quit()
})
