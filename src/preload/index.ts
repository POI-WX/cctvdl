import { contextBridge, ipcRenderer } from 'electron'
import type { ProgramInfo, Settings, DownloadJob, DownloadProgress, BatchResult, BatchStartInfo, CctvdlApi } from '../shared/types'

const api: CctvdlApi = {
  browseProgram: (url: string) => ipcRenderer.invoke('browse-program', url),
  listVideos: (columnId: string, itemId: string, month: string) =>
    ipcRenderer.invoke('list-videos', columnId, itemId, month),
  importProgram: (p: ProgramInfo) => ipcRenderer.invoke('import-program', p),
  deleteProgram: (columnId: string) => ipcRenderer.invoke('delete-program', columnId),
  clearPrograms: () => ipcRenderer.invoke('clear-programs'),
  setProgramFavorite: (columnId: string, favorite: boolean) =>
    ipcRenderer.invoke('set-program-favorite', columnId, favorite),
  getPrograms: () => ipcRenderer.invoke('get-programs'),
  exportPrograms: () => ipcRenderer.invoke('export-programs'),
  startDownload: (jobs: DownloadJob[]) => ipcRenderer.invoke('start-download', jobs),
  retryJob: (job: DownloadJob) => ipcRenderer.invoke('retry-job', job),
  retryJobs: (jobs: DownloadJob[]) => ipcRenderer.invoke('retry-jobs', jobs),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  cancelAllDownloads: () => ipcRenderer.invoke('cancel-all-downloads'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: Settings) => ipcRenderer.invoke('save-settings', s),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('select-directory', defaultPath),
  openPath: (p: string) => ipcRenderer.invoke('open-path', p),
  revealFile: (p: string) => ipcRenderer.invoke('reveal-file', p),
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => {
    const handler = (_: unknown, p: DownloadProgress) => cb(p)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
  onJobFinished: (cb: (job: DownloadJob) => void) => {
    const handler = (_: unknown, job: DownloadJob) => cb(job)
    ipcRenderer.on('job-finished', handler)
    return () => ipcRenderer.removeListener('job-finished', handler)
  },
  onBatchFinished: (cb: (result: BatchResult) => void) => {
    const handler = (_: unknown, result: BatchResult) => cb(result)
    ipcRenderer.on('batch-finished', handler)
    return () => ipcRenderer.removeListener('batch-finished', handler)
  },
  onBatchStarted: (cb: (info: BatchStartInfo) => void) => {
    const handler = (_: unknown, info: BatchStartInfo) => cb(info)
    ipcRenderer.on('batch-started', handler)
    return () => ipcRenderer.removeListener('batch-started', handler)
  },
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),
  clearDownloadHistory: () => ipcRenderer.invoke('clear-download-history'),
  onDownloadSkipped: (cb: (info: { guid: string; title: string; reason: string }) => void) => {
    const handler = (_: unknown, info: { guid: string; title: string; reason: string }) => cb(info)
    ipcRenderer.on('download-skipped', handler)
    return () => ipcRenderer.removeListener('download-skipped', handler)
  },
  isMac: process.platform === 'darwin'
}

contextBridge.exposeInMainWorld('cctvdlApi', api)
