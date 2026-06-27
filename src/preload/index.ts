import { contextBridge, ipcRenderer } from 'electron'
import type { ProgramInfo, VideoInfo, Settings, DownloadJob, DownloadProgress, BatchResult, BatchStartInfo, CctvdlApi } from '../shared/types'

const api: CctvdlApi = {
  browseProgram: (url: string) => ipcRenderer.invoke('browse-program', url),
  listVideos: (columnId: string, itemId: string, month: string) =>
    ipcRenderer.invoke('list-videos', columnId, itemId, month),
  importProgram: (p: ProgramInfo) => ipcRenderer.invoke('import-program', p),
  importPrograms: () => ipcRenderer.invoke('import-programs'),
  deleteProgram: (columnId: string) => ipcRenderer.invoke('delete-program', columnId),
  clearPrograms: () => ipcRenderer.invoke('clear-programs'),
  setProgramFavorite: (columnId: string, favorite: boolean) =>
    ipcRenderer.invoke('set-program-favorite', columnId, favorite),
  getPrograms: () => ipcRenderer.invoke('get-programs'),
  resolveSingleVideo: (url: string) => ipcRenderer.invoke('resolve-single-video', url),
  getSingleVideos: () => ipcRenderer.invoke('get-single-videos'),
  addSingleVideo: (v: VideoInfo) => ipcRenderer.invoke('add-single-video', v),
  deleteSingleVideo: (guid: string) => ipcRenderer.invoke('delete-single-video', guid),
  clearSingleVideos: () => ipcRenderer.invoke('clear-single-videos'),
  importSingleVideos: () => ipcRenderer.invoke('import-single-videos'),
  exportSingleVideos: () => ipcRenderer.invoke('export-single-videos'),
  exportPrograms: () => ipcRenderer.invoke('export-programs'),
  startDownload: (jobs: DownloadJob[], autoOpen?: boolean) => ipcRenderer.invoke('start-download', jobs, autoOpen),
  retryJob: (job: DownloadJob) => ipcRenderer.invoke('retry-job', job),
  retryJobs: (jobs: DownloadJob[]) => ipcRenderer.invoke('retry-jobs', jobs),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  cancelAllDownloads: () => ipcRenderer.invoke('cancel-all-downloads'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: Settings) => ipcRenderer.invoke('save-settings', s),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('select-directory', defaultPath),
  openPath: (p: string) => ipcRenderer.invoke('open-path', p),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
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
  onClipboardLink: (cb: (url: string) => void) => {
    const handler = (_: unknown, url: string) => cb(url)
    ipcRenderer.on('clipboard-link', handler)
    return () => ipcRenderer.removeListener('clipboard-link', handler)
  },
  onUpdateAvailable: (cb: (payload: { version: string }) => void) => {
    const handler = (_: unknown, payload: { version: string }) => cb(payload)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onNewContent: (cb: (payload: { columnId: string; count: number }) => void) => {
    const handler = (_: unknown, payload: { columnId: string; count: number }) => cb(payload)
    ipcRenderer.on('new-content', handler)
    return () => ipcRenderer.removeListener('new-content', handler)
  },
  isMac: process.platform === 'darwin'
}

contextBridge.exposeInMainWorld('cctvdlApi', api)
