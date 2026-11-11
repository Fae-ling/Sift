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
  scan: call('scan'),
  extract: call('extract'),
  savePreview: call('savePreview'),
  exportXmp: call('exportXmp'),
  copySelects: call('copySelects'),
  reveal: call('reveal'),
  settings: { get: call('settings:get'), set: call('settings:set') },
  ai: { story: call('ai:story'), grade: call('ai:grade') }
}

contextBridge.exposeInMainWorld('studio', api)
