import { contextBridge, ipcRenderer } from 'electron'
import type { StudioApi } from '@shared/types'

const call =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

function listen<T>(channel: string, fn: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T): void => fn(value)
  ipcRenderer.on(channel, handler)
  return () => void ipcRenderer.removeListener(channel, handler)
}

const api: StudioApi = {
  projects: {
    list: call('projects:list'),
    load: call('projects:load'),
    save: call('projects:save'),
    remove: call('projects:remove')
  },
  pickFolder: call('pickFolder'),
  pickImage: call('pickImage'),
  saveText: call('saveText'),
  saveFiles: call('saveFiles'),
  scan: call('scan'),
  learned: { get: call('learned:get'), save: call('learned:save'), removeSamples: call('learned:removeSamples') },
  extract: call('extract'),
  savePreview: call('savePreview'),
  exportXmp: call('exportXmp'),
  copySelects: call('copySelects'),
  reveal: call('reveal'),
  data: { get: call('data:get'), save: call('data:save') },
  learning: { get: call('learning:get'), save: call('learning:save') },
  training: { get: call('training:get'), save: call('training:save') },
  readRatings: call('readRatings'),
  spend: call('spend'),
  settings: { get: call('settings:get'), set: call('settings:set') },
  openWorkshop: call('workshop:open'),
  focusStudio: call('studio:focus'),
  onChanged: (fn) => listen('changed', fn),
  onWorkshopGo: (fn) => listen('workshop:go', fn),
  version: call('app:version'),
  update: {
    check: call('update:check'),
    setToken: call('update:setToken'),
    download: call('update:download'),
    onProgress: (fn) => listen('update:progress', fn),
    installFile: call('update:installFile')
  },
  backup: { save: call('data:backup'), restore: call('data:restore'), reveal: call('data:folder'), safety: call('data:safety'), list: call('data:backups'), restoreNamed: call('data:restoreNamed') },
  ai: { story: call('ai:story'), read: call('ai:read'), essence: call('ai:essence'), diagnose: call('ai:diagnose'), nameFaces: call('ai:nameFaces'), developStyle: call('ai:developStyle'), atmosphere: call('ai:atmosphere'), tune: call('ai:tune') }
}

contextBridge.exposeInMainWorld('studio', api)
