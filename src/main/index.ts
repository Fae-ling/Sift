import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GradeRequest, Project, ReadRequest, StoryRequest, XmpItem } from '@shared/types'
import { gradeAdvice, narrativeRead, storyAdvice } from './ai'
import { copySelects, exportXmp } from './exporter'
import { exiftool, extractPreview, savePreview, scanFolder } from './ingest'
import {
  getSettings,
  listProjects,
  loadProject,
  removeProject,
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
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('scan', (folder: string) => scanFolder(folder))
  handle('extract', (projectId: string, shotId: string, path: string) => extractPreview(projectId, shotId, path))
  handle('savePreview', (projectId: string, shotId: string, preview: ArrayBuffer, thumb: ArrayBuffer) =>
    savePreview(projectId, shotId, preview, thumb)
  )
  handle('exportXmp', (items: XmpItem[]) => exportXmp(items))
  handle('copySelects', (paths: string[], dest: string) => copySelects(paths, dest))
  handle('reveal', (path: string) => shell.showItemInFolder(path))
  handle('settings:get', getSettings)
  handle('settings:set', (patch: { apiKey?: string; model?: string }) => setSettings(patch))
  handle('ai:story', (req: StoryRequest) => storyAdvice(req))
  handle('ai:grade', (req: GradeRequest) => gradeAdvice(req))
  handle('ai:read', (req: ReadRequest) => narrativeRead(req))
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
