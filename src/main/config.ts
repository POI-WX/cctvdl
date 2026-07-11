import Store from 'electron-store'
import { app } from 'electron'
import type { Settings, ProgramInfo, VideoInfo, HistoryEntry, DownloadJob } from '../shared/types'
import { normalizeSettings } from '../shared/settings'
import type { WindowBounds } from '../shared/window-bounds'

const MAX_HISTORY_SIZE = 1000
const QUALITIES = new Set<DownloadJob['quality']>(['auto', 'bluray', 'chaoqing', 'gaoqing', 'biaoqing', 'liuchang'])
const JOB_STATES = new Set<DownloadJob['state']>(['Created', 'Queued', 'ResolvingM3u8', 'Downloading', 'Merging', 'Completed', 'Failed', 'Cancelled'])
const JOB_STAGES = new Set<DownloadJob['stage']>(['None', 'FetchingPlaylist', 'DownloadingShards', 'MergingShards', 'PublishingOutput'])

interface StoreSchema {
  settings: Settings
  programs: ProgramInfo[]
  singleVideos: VideoInfo[]
  downloadHistory: HistoryEntry[]
  pendingJobs: DownloadJob[]
  windowBounds?: WindowBounds
}

const defaults: StoreSchema = {
  settings: {
    savePath: app?.getPath?.('videos') || '',
    threadCount: 8,
    quality: 'auto',
    reencode: false,
    logLevel: 'info',
    darkMode: false,
    logPath: app?.getPath?.('userData') || '',
    autoOpenFolder: false,
    clipboardWatch: false,
    concurrentVideos: 1,
    coverSavePath: app?.getPath?.('pictures') || ''
  },
  programs: [],
  singleVideos: [],
  downloadHistory: [],
  pendingJobs: []
}

export class ConfigStore {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({ defaults })
  }

  getWindowBounds(): WindowBounds | undefined {
    return this.store.get('windowBounds')
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.store.set('windowBounds', bounds)
  }

  getSettings(): Settings {
    // Normalize so corrupt or legacy persisted data never reaches the app.
    return normalizeSettings(this.store.get('settings'), defaults.settings)
  }

  saveSettings(s: Settings): void {
    this.store.set('settings', normalizeSettings(s, defaults.settings))
  }

  getPrograms(): ProgramInfo[] {
    const raw = this.store.get('programs') as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap(item => {
      const p = item as Partial<ProgramInfo>
      if (!p || typeof p.name !== 'string' || !p.name || typeof p.columnId !== 'string' || !p.columnId) return []
      const program: ProgramInfo = { name: p.name, columnId: p.columnId, itemId: typeof p.itemId === 'string' ? p.itemId : '' }
      if (p.kind === 'album' || p.kind === 'column') program.kind = p.kind
      if (p.serviceId === 'tvcctv' || p.serviceId === 'cctv4k') program.serviceId = p.serviceId
      const source = p.listSource
      if (source && (source.type === 'column' || source.type === 'album')
        && typeof source.id === 'string' && source.id
        && (source.serviceId === 'tvcctv' || source.serviceId === 'cctv4k')) {
        program.listSource = { type: source.type, id: source.id, serviceId: source.serviceId }
      }
      if (typeof p.favoritedAt === 'number' && Number.isFinite(p.favoritedAt)) program.favoritedAt = p.favoritedAt
      return [program]
    })
  }

  addProgram(p: ProgramInfo): boolean {
    const programs = this.getPrograms()
    const existingIndex = programs.findIndex((x) => x.columnId === p.columnId)
    if (existingIndex >= 0) {
      const existing = programs[existingIndex]
      // Legacy backups do not know listSource. Never let one downgrade a
      // current entry whose presentation/source split has already been resolved.
      if (existing.listSource && !p.listSource) return false
      const sourceChanged = JSON.stringify(existing.listSource) !== JSON.stringify(p.listSource)
      const kindChanged = (existing.kind ?? 'column') !== (p.kind ?? 'column')
      if (!sourceChanged && !kindChanged) return false
      programs[existingIndex] = {
        ...p,
        ...(existing.favoritedAt == null ? {} : { favoritedAt: existing.favoritedAt })
      }
      this.store.set('programs', programs)
      return true
    }
    programs.push(p)
    this.store.set('programs', programs)
    return true
  }

  // Delete by columnId (safe against index drift)
  deleteProgram(columnId: string): void {
    const programs = this.getPrograms()
    const filtered = programs.filter(p => p.columnId !== columnId)
    this.store.set('programs', filtered)
  }

  clearPrograms(): void {
    this.store.set('programs', [])
  }

  // Import programs from parsed JSON (e.g. a previously exported backup). Validates
  // each entry, dedupes by columnId via addProgram, and returns how many were added.
  importPrograms(data: unknown): number {
    if (!Array.isArray(data)) throw new Error('JSON 格式不正确（应为栏目数组）')
    let added = 0
    for (const item of data) {
      const p = item as Partial<ProgramInfo>
      if (p && typeof p.name === 'string' && typeof p.columnId === 'string') {
        const program: ProgramInfo = {
          name: p.name,
          columnId: p.columnId,
          itemId: typeof p.itemId === 'string' ? p.itemId : ''
        }
        if (p.kind === 'album' || p.kind === 'column') program.kind = p.kind
        if (p.serviceId === 'tvcctv' || p.serviceId === 'cctv4k') program.serviceId = p.serviceId
        const source = p.listSource
        if (source && (source.type === 'column' || source.type === 'album')
          && typeof source.id === 'string' && source.id
          && (source.serviceId === 'tvcctv' || source.serviceId === 'cctv4k')) {
          program.listSource = { type: source.type, id: source.id, serviceId: source.serviceId }
        }
        if (typeof p.favoritedAt === 'number') program.favoritedAt = p.favoritedAt
        if (this.addProgram(program)) added++
      }
    }
    return added
  }

  // Favorite/unfavorite a program. favoritedAt (epoch ms) doubles as the sort key
  // so the most-recently-favorited shows on top; clearing it un-favorites.
  setProgramFavorite(columnId: string, favorite: boolean): void {
    const programs = this.getPrograms()
    const program = programs.find(p => p.columnId === columnId)
    if (!program) return
    if (favorite) program.favoritedAt = Date.now()
    else delete program.favoritedAt
    this.store.set('programs', programs)
  }

  getSingleVideos(): VideoInfo[] {
    const raw = this.store.get('singleVideos') as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap(item => {
      const video = normalizeVideo(item)
      return video ? [video] : []
    })
  }

  // Add a standalone video to the persisted collection (newest first); dedupe by guid.
  addSingleVideo(v: VideoInfo): boolean {
    const list = this.getSingleVideos()
    if (list.some((x) => x.guid === v.guid)) return false
    list.unshift(v)
    this.store.set('singleVideos', list)
    return true
  }

  deleteSingleVideo(guid: string): void {
    this.store.set('singleVideos', this.getSingleVideos().filter((v) => v.guid !== guid))
  }

  clearSingleVideos(): void {
    this.store.set('singleVideos', [])
  }

  exportSingleVideos(): VideoInfo[] {
    return [...this.getSingleVideos()]
  }

  importSingleVideos(data: unknown): number {
    if (!Array.isArray(data)) throw new Error('JSON 格式不正确（应为单视频数组）')
    let added = 0
    for (const item of data) {
      const video = normalizeVideo(item)
      if (video && this.addSingleVideo(video)) added++
    }
    return added
  }

  getDownloadHistory(): HistoryEntry[] {
    const raw = this.store.get('downloadHistory') as unknown
    if (!Array.isArray(raw)) return []
    // Migrate legacy format: string[] → HistoryEntry[]
    return (raw as Array<string | HistoryEntry>).flatMap(item => {
      if (typeof item === 'string') return item ? [{ guid: item, title: '', outputPath: '', fileSize: 0, completedAt: 0 }] : []
      if (!item || typeof item.guid !== 'string' || !item.guid) return []
      return [{
        guid: item.guid,
        title: typeof item.title === 'string' ? item.title : '',
        outputPath: typeof item.outputPath === 'string' ? item.outputPath : '',
        fileSize: typeof item.fileSize === 'number' && Number.isFinite(item.fileSize) ? item.fileSize : 0,
        completedAt: typeof item.completedAt === 'number' && Number.isFinite(item.completedAt) ? item.completedAt : 0,
        ...(typeof item.sourceUrl === 'string' ? { sourceUrl: item.sourceUrl } : {}),
        ...(typeof item.sourceVideoIndex === 'number' && Number.isInteger(item.sourceVideoIndex) ? { sourceVideoIndex: item.sourceVideoIndex } : {})
      }]
    })
  }

  addToDownloadHistory(entry: HistoryEntry): void {
    const history = this.getDownloadHistory()
    if (!history.some(e => e.guid === entry.guid)) {
      history.push(entry)
      const trimmed = history.length > MAX_HISTORY_SIZE
        ? history.slice(history.length - MAX_HISTORY_SIZE)
        : history
      this.store.set('downloadHistory', trimmed as unknown as HistoryEntry[])
    }
  }

  isInDownloadHistory(guid: string): boolean {
    return this.getDownloadHistory().some(e => e.guid === guid)
  }

  clearDownloadHistory(): void {
    this.store.set('downloadHistory', [])
  }

  removeFromDownloadHistory(guid: string): void {
    this.store.set('downloadHistory', this.getDownloadHistory().filter(e => e.guid !== guid))
  }

  getPendingJobs(): DownloadJob[] {
    const raw = this.store.get('pendingJobs') as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap(item => {
      const job = normalizePendingJob(item)
      return job ? [job] : []
    })
  }

  savePendingJobs(jobs: DownloadJob[]): void {
    this.store.set('pendingJobs', jobs)
  }

  clearPendingJobs(): void {
    this.store.set('pendingJobs', [])
  }
}

function normalizeVideo(value: unknown): VideoInfo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const video = value as Partial<VideoInfo>
  if (typeof video.guid !== 'string' || !video.guid || typeof video.title !== 'string') return undefined
  return {
    guid: video.guid,
    title: video.title,
    brief: typeof video.brief === 'string' ? video.brief : '',
    coverUrl: typeof video.coverUrl === 'string' ? video.coverUrl : '',
    time: typeof video.time === 'string' ? video.time : '',
    ...(typeof video.m3u8Url === 'string' ? { m3u8Url: video.m3u8Url } : {}),
    ...(typeof video.sourceUrl === 'string' ? { sourceUrl: video.sourceUrl } : {}),
    ...(typeof video.sourceVideoIndex === 'number' && Number.isInteger(video.sourceVideoIndex) ? { sourceVideoIndex: video.sourceVideoIndex } : {})
  }
}

function normalizePendingJob(value: unknown): DownloadJob | undefined {
  if (!value || typeof value !== 'object') return undefined
  const job = value as Partial<DownloadJob>
  if (
    typeof job.id !== 'string' || !job.id || typeof job.guid !== 'string' || !job.guid ||
    typeof job.sourceUrl !== 'string' || typeof job.title !== 'string' || typeof job.savePath !== 'string' || !job.savePath ||
    !QUALITIES.has(job.quality as DownloadJob['quality']) || !JOB_STATES.has(job.state as DownloadJob['state']) || !JOB_STAGES.has(job.stage as DownloadJob['stage']) ||
    typeof job.threadCount !== 'number' || !Number.isInteger(job.threadCount) || job.threadCount < 1 ||
    typeof job.reencode !== 'boolean' || typeof job.progressPercent !== 'number' || !Number.isFinite(job.progressPercent)
  ) return undefined
  return {
    id: job.id, guid: job.guid, sourceUrl: job.sourceUrl, title: job.title, savePath: job.savePath,
    quality: job.quality as DownloadJob['quality'], threadCount: job.threadCount, reencode: job.reencode,
    state: job.state as DownloadJob['state'], stage: job.stage as DownloadJob['stage'],
    progressPercent: Math.max(0, Math.min(100, job.progressPercent)),
    ...(typeof job.errorMessage === 'string' ? { errorMessage: job.errorMessage } : {}),
    ...(typeof job.errorSegmentIndex === 'number' && Number.isInteger(job.errorSegmentIndex) ? { errorSegmentIndex: job.errorSegmentIndex } : {}),
    ...(typeof job.outputPath === 'string' ? { outputPath: job.outputPath } : {}),
    ...(typeof job.m3u8Url === 'string' ? { m3u8Url: job.m3u8Url } : {}),
    ...(typeof job.sourceVideoIndex === 'number' && Number.isInteger(job.sourceVideoIndex) ? { sourceVideoIndex: job.sourceVideoIndex } : {})
  }
}
