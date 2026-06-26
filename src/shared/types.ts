export interface ProgramInfo {
  name: string
  columnId: string
  itemId: string
  // Epoch ms when favorited (pinned to top); undefined = not favorited.
  favoritedAt?: number
}

export interface VideoInfo {
  guid: string
  title: string
  brief: string
  coverUrl: string
  time: string
}

export interface DownloadJob {
  id: string
  guid: string
  sourceUrl: string
  title: string
  savePath: string
  quality: Quality
  threadCount: number
  // When true, merge re-encodes with libx264 (compatibility); when false, lossless stream-copy concat (fast, default)
  reencode: boolean
  state: JobState
  stage: JobStage
  progressPercent: number
  errorMessage?: string
  errorSegmentIndex?: number
  // The actual file written on success (may differ from savePath due to dedupe suffix / ext).
  outputPath?: string
}

export type Quality = 'auto' | 'bluray' | 'chaoqing' | 'gaoqing' | 'biaoqing' | 'liuchang'

export type JobState =
  | 'Created'
  | 'Queued'
  | 'ResolvingM3u8'
  | 'Downloading'
  | 'Merging'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'

export type JobStage =
  | 'None'
  | 'FetchingPlaylist'
  | 'DownloadingShards'
  | 'MergingShards'
  | 'PublishingOutput'

export interface DownloadProgress {
  jobId: string
  percent: number
  state: JobState
  stage: JobStage
  segmentsDone?: number
  segmentsTotal?: number
  // speed: real bytes/second of decrypted output written to disk
  speed?: number
  eta?: number    // seconds remaining
  title?: string
  batchCompleted?: number  // jobs finished (completed+failed+cancelled) in this batch
  batchTotal?: number      // total jobs in this batch
}

export interface BatchResult {
  completed: number
  failed: number
  cancelled: number
  total: number
  failedJobs: Array<{ title: string; sourceUrl: string; errorMessage: string }>
}

// Lightweight job descriptor sent to the renderer when a batch starts, so the
// download page can render one card per queued job.
export interface BatchStartInfo {
  total: number
  jobs: Array<{ id: string; title: string; guid: string }>
}

export interface Settings {
  savePath: string
  threadCount: number
  quality: Quality
  // false (default) = lossless stream-copy merge; true = libx264 re-encode (slower, max compatibility)
  reencode: boolean
  // 'info' = normal; 'debug' = verbose (detailed download-pipeline logs for troubleshooting)
  logLevel: 'info' | 'debug'
  darkMode?: boolean
  logPath?: string
  // When true, open the save folder automatically after a batch finishes.
  autoOpenFolder?: boolean
  // When true, watch the clipboard and offer to import copied CCTV links (opt-in).
  clipboardWatch?: boolean
}

export interface CctvdlApi {
  browseProgram(url: string): Promise<ProgramInfo>
  listVideos(columnId: string, itemId: string, month: string): Promise<VideoInfo[]>
  importProgram(p: ProgramInfo): Promise<boolean>
  importPrograms(): Promise<number>
  deleteProgram(columnId: string): Promise<void>
  clearPrograms(): Promise<void>
  setProgramFavorite(columnId: string, favorite: boolean): Promise<void>
  getPrograms(): Promise<ProgramInfo[]>
  resolveSingleVideo(url: string): Promise<VideoInfo>
  getSingleVideos(): Promise<VideoInfo[]>
  addSingleVideo(v: VideoInfo): Promise<boolean>
  deleteSingleVideo(guid: string): Promise<void>
  clearSingleVideos(): Promise<void>
  exportPrograms(): Promise<boolean>
  startDownload(jobs: DownloadJob[], autoOpen?: boolean): Promise<void>
  retryJob(job: DownloadJob): Promise<void>
  retryJobs(jobs: DownloadJob[]): Promise<void>
  cancelDownload(id: string): Promise<void>
  cancelAllDownloads(): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  selectDirectory(defaultPath?: string): Promise<string | null>
  openPath(p: string): Promise<void>
  openUrl(url: string): Promise<void>
  revealFile(p: string): Promise<void>
  onDownloadProgress(cb: (p: DownloadProgress) => void): () => void
  onJobFinished(cb: (job: DownloadJob) => void): () => void
  onBatchFinished(cb: (result: BatchResult) => void): () => void
  onBatchStarted(cb: (info: BatchStartInfo) => void): () => void
  onDownloadSkipped(cb: (info: { guid: string; title: string; reason: string }) => void): () => void
  onClipboardLink(cb: (url: string) => void): () => void
  onUpdateAvailable(cb: (payload: { version: string }) => void): () => void
  onNewContent(cb: (payload: { columnId: string; count: number }) => void): () => void
  getDownloadHistory(): Promise<string[]>
  clearDownloadHistory(): Promise<void>
  // Static platform flag (from preload) — lets the renderer adapt shortcuts, e.g.
  // accepting Backspace as the delete key on macOS.
  isMac: boolean
}

declare global {
  interface Window {
    cctvdlApi: CctvdlApi
  }
}
