import Store from 'electron-store'
import { app } from 'electron'
import type { Settings, ProgramInfo, VideoInfo } from '../shared/types'
import { normalizeSettings } from '../shared/settings'
import type { WindowBounds } from '../shared/window-bounds'

const MAX_HISTORY_SIZE = 1000

interface StoreSchema {
  settings: Settings
  programs: ProgramInfo[]
  singleVideos: VideoInfo[]
  downloadHistory: string[]
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
    autoOpenFolder: false
  },
  programs: [],
  singleVideos: [],
  downloadHistory: []
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
    return this.store.get('programs')
  }

  addProgram(p: ProgramInfo): boolean {
    const programs = this.getPrograms()
    if (programs.some((x) => x.columnId === p.columnId)) return false
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
    return this.store.get('singleVideos')
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

  getDownloadHistory(): string[] {
    return this.store.get('downloadHistory')
  }

  addToDownloadHistory(guid: string): void {
    const history = this.getDownloadHistory()
    if (!history.includes(guid)) {
      history.push(guid)
      // Cap at MAX_HISTORY_SIZE, removing oldest entries first
      const trimmed = history.length > MAX_HISTORY_SIZE
        ? history.slice(history.length - MAX_HISTORY_SIZE)
        : history
      this.store.set('downloadHistory', trimmed)
    }
  }

  isInDownloadHistory(guid: string): boolean {
    return this.getDownloadHistory().includes(guid)
  }

  clearDownloadHistory(): void {
    this.store.set('downloadHistory', [])
  }
}
