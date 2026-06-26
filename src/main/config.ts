import Store from 'electron-store'
import { app } from 'electron'
import type { Settings, ProgramInfo } from '../shared/types'
import { normalizeSettings } from '../shared/settings'
import type { WindowBounds } from '../shared/window-bounds'

const MAX_HISTORY_SIZE = 1000

interface StoreSchema {
  settings: Settings
  programs: ProgramInfo[]
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
    logPath: app?.getPath?.('userData') || ''
  },
  programs: [],
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
