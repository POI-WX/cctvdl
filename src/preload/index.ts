import { contextBridge, ipcRenderer } from 'electron'
import type {
  ProgramInfo, VideoInfo, Settings, DownloadJob,
  CctvdlApi, Quality, DownloadEstimateInput, ListVideosOptions
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: CctvdlApi = {
  browseProgram: (url: string) => ipcRenderer.invoke('browse-program', url),
  listVideos: (program: ProgramInfo, month: string, requestId?: number, forceRefresh?: boolean, options?: ListVideosOptions) =>
    ipcRenderer.invoke('list-videos', program, month, requestId, forceRefresh, options),
  getProgramMonthBounds: (program: ProgramInfo) => ipcRenderer.invoke('get-program-month-bounds', program),
  importProgram: (p: ProgramInfo) => ipcRenderer.invoke('import-program', p),
  importPrograms: () => ipcRenderer.invoke('import-programs'),
  deleteProgram: (columnId: string) => ipcRenderer.invoke('delete-program', columnId),
  clearPrograms: () => ipcRenderer.invoke('clear-programs'),
  setProgramFavorite: (columnId: string, favorite: boolean) =>
    ipcRenderer.invoke('set-program-favorite', columnId, favorite),
  getPrograms: () => ipcRenderer.invoke('get-programs'),
  resolveVideoBatch: (url: string, quality?: Quality) => ipcRenderer.invoke('resolve-video-batch', url, quality),
  getVideoMediaMetadata: (guid: string) => ipcRenderer.invoke('get-video-media-metadata', guid),
  getSingleVideos: () => ipcRenderer.invoke('get-single-videos'),
  addSingleVideo: (v: VideoInfo) => ipcRenderer.invoke('add-single-video', v),
  deleteSingleVideo: (guid: string) => ipcRenderer.invoke('delete-single-video', guid),
  clearSingleVideos: () => ipcRenderer.invoke('clear-single-videos'),
  importSingleVideos: () => ipcRenderer.invoke('import-single-videos'),
  exportSingleVideos: () => ipcRenderer.invoke('export-single-videos'),
  exportPrograms: () => ipcRenderer.invoke('export-programs'),
  startDownload: (jobs: DownloadJob[], forceRedownload?: boolean) =>
    ipcRenderer.invoke('start-download', jobs, forceRedownload),
  estimateDownload: (videos: DownloadEstimateInput[], quality: Quality, savePath: string) =>
    ipcRenderer.invoke('estimate-download', videos, quality, savePath),
  retryJob: (job: DownloadJob) => ipcRenderer.invoke('retry-job', job),
  retryJobs: (jobs: DownloadJob[]) => ipcRenderer.invoke('retry-jobs', jobs),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  cancelAllDownloads: () => ipcRenderer.invoke('cancel-all-downloads'),
  reorderQueue: (ids: string[]) => ipcRenderer.invoke('reorder-queue', ids),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: Settings) => ipcRenderer.invoke('save-settings', s),
  checkClipboardNow: () => ipcRenderer.invoke('check-clipboard-now'),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('select-directory', defaultPath),
  openPath: (p: string) => ipcRenderer.invoke('open-path', p),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  revealFile: (p: string) => ipcRenderer.invoke('reveal-file', p),
  downloadCover: (url: string, saveDir: string, baseName: string) => ipcRenderer.invoke('download-cover', url, saveDir, baseName),
  onDownloadProgress: cb => subscribe('download-progress', cb),
  onJobFinished: cb => subscribe('job-finished', cb),
  onBatchFinished: cb => subscribe('batch-finished', cb),
  onBatchStarted: cb => subscribe('batch-started', cb),
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),
  clearDownloadHistory: () => ipcRenderer.invoke('clear-download-history'),
  removeFromDownloadHistory: (guid: string) => ipcRenderer.invoke('remove-from-download-history', guid),
  onDownloadSkipped: cb => subscribe('download-skipped', cb),
  onAlbumLoadProgress: cb => subscribe('album-load-progress', cb),
  onClipboardLink: cb => subscribe('clipboard-link', cb),
  onUpdateAvailable: cb => subscribe('update-available', cb),
  onNewContent: cb => subscribe('new-content', cb),
  onNavigateDownload: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('navigate-download', handler)
    return () => ipcRenderer.removeListener('navigate-download', handler)
  },
  isMac: process.platform === 'darwin'
}

contextBridge.exposeInMainWorld('cctvdlApi', api)
