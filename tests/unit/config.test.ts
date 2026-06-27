import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron-store to test ConfigStore logic in isolation
vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private data: any
      constructor(opts: any) {
        this.data = JSON.parse(JSON.stringify(opts.defaults || {}))
      }
      get(key: string) { return this.data[key] }
      set(key: string, val: any) { this.data[key] = val }
    }
  }
})

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    isPackaged: false
  }
}))

import { ConfigStore } from '../../src/main/config'
import type { ProgramInfo, Settings, VideoInfo } from '../../src/shared/types'

describe('ConfigStore', () => {
  let store: ConfigStore

  beforeEach(() => {
    store = new ConfigStore()
  })

  describe('Settings', () => {
    it('getSettings returns default values', () => {
      const settings = store.getSettings()
      expect(settings.threadCount).toBe(8)
      expect(settings.quality).toBe('auto')
      expect(settings.reencode).toBe(false)
      expect(settings.logLevel).toBe('info')
      expect(settings.darkMode).toBe(false)
    })

    it('saveSettings persists and getSettings returns saved values', () => {
      const newSettings: Settings = {
        savePath: '/custom/path',
        threadCount: 5,
        quality: 'chaoqing',
        reencode: true,
        logLevel: 'debug',
        darkMode: true,
        logPath: '/custom/log',
        autoOpenFolder: true,
        clipboardWatch: true
      }
      store.saveSettings(newSettings)
      const retrieved = store.getSettings()
      expect(retrieved.savePath).toBe('/custom/path')
      expect(retrieved.threadCount).toBe(5)
      expect(retrieved.quality).toBe('chaoqing')
      expect(retrieved.reencode).toBe(true)
      expect(retrieved.logLevel).toBe('debug')
      expect(retrieved.darkMode).toBe(true)
      expect(retrieved.autoOpenFolder).toBe(true)
      expect(retrieved.clipboardWatch).toBe(true)
    })
  })

  describe('Programs', () => {
    it('getPrograms returns empty list initially', () => {
      expect(store.getPrograms()).toEqual([])
    })

    it('addProgram adds program and returns true', () => {
      const program: ProgramInfo = { name: '新闻联播', columnId: 'TOPC001', itemId: '' }
      const result = store.addProgram(program)
      expect(result).toBe(true)
      expect(store.getPrograms()).toHaveLength(1)
      expect(store.getPrograms()[0].name).toBe('新闻联播')
    })

    it('addProgram deduplicates by columnId', () => {
      const program1: ProgramInfo = { name: '新闻联播', columnId: 'TOPC001', itemId: 'item1' }
      const program2: ProgramInfo = { name: '新闻联播', columnId: 'TOPC001', itemId: 'item2' }
      expect(store.addProgram(program1)).toBe(true)
      expect(store.addProgram(program2)).toBe(false)
      expect(store.getPrograms()).toHaveLength(1)
    })

    it('addProgram allows different columnIds', () => {
      const program1: ProgramInfo = { name: '新闻联播', columnId: 'TOPC001', itemId: '' }
      const program2: ProgramInfo = { name: '世界战史', columnId: 'TOPC002', itemId: '' }
      expect(store.addProgram(program1)).toBe(true)
      expect(store.addProgram(program2)).toBe(true)
      expect(store.getPrograms()).toHaveLength(2)
    })

    it('deleteProgram removes by columnId', () => {
      store.addProgram({ name: 'A', columnId: 'TOPC001', itemId: '' })
      store.addProgram({ name: 'B', columnId: 'TOPC002', itemId: '' })
      store.deleteProgram('TOPC001')
      const programs = store.getPrograms()
      expect(programs).toHaveLength(1)
      expect(programs[0].name).toBe('B')
    })

    it('deleteProgram with non-existent columnId does nothing', () => {
      store.addProgram({ name: 'A', columnId: 'TOPC001', itemId: '' })
      store.deleteProgram('TOPC999')
      expect(store.getPrograms()).toHaveLength(1)
    })

    it('clearPrograms removes all programs', () => {
      store.addProgram({ name: 'A', columnId: 'TOPC001', itemId: '' })
      store.addProgram({ name: 'B', columnId: 'TOPC002', itemId: '' })
      store.clearPrograms()
      expect(store.getPrograms()).toEqual([])
    })

    it('setProgramFavorite stamps favoritedAt, then clears it', () => {
      store.addProgram({ name: 'A', columnId: 'TOPC001', itemId: '' })
      const before = Date.now()
      store.setProgramFavorite('TOPC001', true)
      const fav = store.getPrograms()[0].favoritedAt
      expect(typeof fav).toBe('number')
      expect(fav!).toBeGreaterThanOrEqual(before)

      store.setProgramFavorite('TOPC001', false)
      expect(store.getPrograms()[0].favoritedAt).toBeUndefined()
    })

    it('setProgramFavorite on non-existent columnId does nothing', () => {
      store.addProgram({ name: 'A', columnId: 'TOPC001', itemId: '' })
      store.setProgramFavorite('TOPC999', true)
      expect(store.getPrograms()[0].favoritedAt).toBeUndefined()
    })

    it('importPrograms adds valid entries, dedupes, skips invalid, returns count', () => {
      store.addProgram({ name: 'Existing', columnId: 'TOPC001', itemId: '' })
      const added = store.importPrograms([
        { name: 'A', columnId: 'TOPC002', itemId: 'i' },
        { name: 'Existing', columnId: 'TOPC001', itemId: '' }, // duplicate columnId
        { columnId: 'TOPC003' },                               // invalid: no name
        { name: 'B', columnId: 'TOPC004' },                    // missing itemId → ''
        'garbage'                                              // invalid: not an object
      ])
      expect(added).toBe(2)
      expect(store.getPrograms().map((p) => p.columnId)).toEqual(['TOPC001', 'TOPC002', 'TOPC004'])
    })

    it('importPrograms throws on non-array input', () => {
      expect(() => store.importPrograms({ not: 'an array' })).toThrow()
    })
  })

  describe('Single videos', () => {
    const mk = (guid: string): VideoInfo => ({ guid, title: `t-${guid}`, brief: '', coverUrl: '', time: '' })

    it('getSingleVideos returns empty initially', () => {
      expect(store.getSingleVideos()).toEqual([])
    })

    it('addSingleVideo adds newest-first and dedupes by guid', () => {
      expect(store.addSingleVideo(mk('A'))).toBe(true)
      expect(store.addSingleVideo(mk('B'))).toBe(true)
      expect(store.getSingleVideos().map((v) => v.guid)).toEqual(['B', 'A'])
      expect(store.addSingleVideo(mk('A'))).toBe(false)
      expect(store.getSingleVideos()).toHaveLength(2)
    })

    it('deleteSingleVideo removes by guid', () => {
      store.addSingleVideo(mk('A'))
      store.addSingleVideo(mk('B'))
      store.deleteSingleVideo('A')
      expect(store.getSingleVideos().map((v) => v.guid)).toEqual(['B'])
    })

    it('clearSingleVideos empties the list', () => {
      store.addSingleVideo(mk('A'))
      store.clearSingleVideos()
      expect(store.getSingleVideos()).toEqual([])
    })

    it('exportSingleVideos returns a copy of the current list', () => {
      store.addSingleVideo(mk('A'))
      store.addSingleVideo(mk('B'))
      const exported = store.exportSingleVideos()
      expect(exported.map(v => v.guid)).toEqual(['B', 'A'])
      // Mutation of returned array must not affect store
      exported.pop()
      expect(store.getSingleVideos()).toHaveLength(2)
    })

    it('importSingleVideos adds valid entries and dedupes by guid', () => {
      store.addSingleVideo(mk('A'))
      const added = store.importSingleVideos([mk('B'), mk('A'), mk('C')])
      expect(added).toBe(2) // A already exists
      expect(store.getSingleVideos().map(v => v.guid)).toContain('B')
      expect(store.getSingleVideos().map(v => v.guid)).toContain('C')
    })

    it('importSingleVideos skips entries with missing or invalid guid', () => {
      const added = store.importSingleVideos([
        { title: 'no guid' },
        { guid: '', title: 'empty guid' },
        { guid: 123, title: 'non-string guid' },
        mk('valid-1')
      ])
      expect(added).toBe(1)
    })

    it('importSingleVideos throws on non-array input', () => {
      expect(() => store.importSingleVideos({ not: 'array' })).toThrow()
    })

    it('importSingleVideos returns 0 for empty array', () => {
      expect(store.importSingleVideos([])).toBe(0)
    })
  })

  describe('Download History', () => {
    const mkEntry = (guid: string): import('../../src/shared/types').HistoryEntry =>
      ({ guid, title: `t-${guid}`, outputPath: `/tmp/${guid}.mp4`, fileSize: 1024, completedAt: Date.now() })

    it('getDownloadHistory returns empty initially', () => {
      expect(store.getDownloadHistory()).toEqual([])
    })

    it('addToDownloadHistory adds entry', () => {
      store.addToDownloadHistory(mkEntry('guid-001'))
      expect(store.getDownloadHistory().map(e => e.guid)).toContain('guid-001')
    })

    it('addToDownloadHistory stores title and outputPath', () => {
      store.addToDownloadHistory(mkEntry('guid-001'))
      const entry = store.getDownloadHistory().find(e => e.guid === 'guid-001')
      expect(entry?.title).toBe('t-guid-001')
      expect(entry?.outputPath).toBe('/tmp/guid-001.mp4')
    })

    it('addToDownloadHistory deduplicates by guid', () => {
      store.addToDownloadHistory(mkEntry('guid-001'))
      store.addToDownloadHistory(mkEntry('guid-001'))
      expect(store.getDownloadHistory()).toHaveLength(1)
    })

    it('isInDownloadHistory returns true for existing', () => {
      store.addToDownloadHistory(mkEntry('guid-001'))
      expect(store.isInDownloadHistory('guid-001')).toBe(true)
    })

    it('isInDownloadHistory returns false for missing', () => {
      expect(store.isInDownloadHistory('missing')).toBe(false)
    })

    it('clearDownloadHistory empties the list', () => {
      store.addToDownloadHistory(mkEntry('guid-001'))
      store.addToDownloadHistory(mkEntry('guid-002'))
      store.clearDownloadHistory()
      expect(store.getDownloadHistory()).toEqual([])
    })

    it('caps history at 1000 entries, keeping most recent', () => {
      for (let i = 0; i < 1002; i++) {
        store.addToDownloadHistory(mkEntry(`guid-${i}`))
      }
      const history = store.getDownloadHistory()
      expect(history.length).toBeLessThanOrEqual(1000)
      expect(history.map(e => e.guid)).toContain('guid-1001')
      expect(history.map(e => e.guid)).toContain('guid-1000')
      expect(history.map(e => e.guid)).not.toContain('guid-0')
      expect(history.map(e => e.guid)).not.toContain('guid-1')
    })

    it('migrates legacy string[] format to HistoryEntry[]', () => {
      // Simulate old format: write raw strings directly into store
      ;(store as any).store.set('downloadHistory', ['legacy-guid-a', 'legacy-guid-b'])
      const history = store.getDownloadHistory()
      expect(history).toHaveLength(2)
      expect(history[0].guid).toBe('legacy-guid-a')
      expect(history[0].title).toBe('')
      expect(history[0].fileSize).toBe(0)
      expect(store.isInDownloadHistory('legacy-guid-a')).toBe(true)
    })
  })

  describe('Pending Jobs', () => {
    const mkJob = (id: string): import('../../src/shared/types').DownloadJob => ({
      id, guid: `guid-${id}`, sourceUrl: '', title: `Job ${id}`,
      savePath: `/tmp/${id}.mp4`, quality: 'auto', threadCount: 8, reencode: false,
      state: 'Queued', stage: 'None', progressPercent: 0
    })

    it('getPendingJobs returns empty initially', () => {
      expect(store.getPendingJobs()).toEqual([])
    })

    it('savePendingJobs persists jobs', () => {
      store.savePendingJobs([mkJob('a'), mkJob('b')])
      const jobs = store.getPendingJobs()
      expect(jobs).toHaveLength(2)
      expect(jobs[0].id).toBe('a')
      expect(jobs[1].id).toBe('b')
    })

    it('clearPendingJobs empties the list', () => {
      store.savePendingJobs([mkJob('a')])
      store.clearPendingJobs()
      expect(store.getPendingJobs()).toEqual([])
    })

    it('savePendingJobs overwrites previous state', () => {
      store.savePendingJobs([mkJob('a')])
      store.savePendingJobs([mkJob('b'), mkJob('c')])
      const jobs = store.getPendingJobs()
      expect(jobs).toHaveLength(2)
      expect(jobs[0].id).toBe('b')
    })
  })
})
