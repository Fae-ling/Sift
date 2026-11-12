import { contextBridge, ipcRenderer } from 'electron'
import type { StudioApi } from '@shared/types'

const call =
  (channel: string) =>
  (...args: unknown[]): Promise<never> =>
    ipcRenderer.invoke(channel, ...args) as Promise<never>

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
  readDevelop: call('readDevelop'),
  saveFiles: call('saveFiles'),
  scan: call('scan'),
  learned: { get: call('learned:get'), save: call('learned:save'), removeSamples: call('learned:removeSamples') },
  extract: call('extract'),
  savePreview: call('savePreview'),
  exportXmp: call('exportXmp'),
  copySelects: call('copySelects'),
  reveal: call('reveal'),
  learning: { get: call('learning:get'), save: call('learning:save') },
  spend: call('spend'),
  settings: { get: call('settings:get'), set: call('settings:set') },
  ai: { story: call('ai:story'), grade: call('ai:grade'), read: call('ai:read'), essence: call('ai:essence'), diagnose: call('ai:diagnose') }
}

contextBridge.exposeInMainWorld('studio', api)
