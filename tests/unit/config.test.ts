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
import type { ProgramInfo, Settings } from '../../src/shared/types'

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
        logPath: '/custom/log'
      }
      store.saveSettings(newSettings)
      const retrieved = store.getSettings()
      expect(retrieved.savePath).toBe('/custom/path')
      expect(retrieved.threadCount).toBe(5)
      expect(retrieved.quality).toBe('chaoqing')
      expect(retrieved.reencode).toBe(true)
      expect(retrieved.logLevel).toBe('debug')
      expect(retrieved.darkMode).toBe(true)
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
  })

  describe('Download History', () => {
    it('getDownloadHistory returns empty initially', () => {
      expect(store.getDownloadHistory()).toEqual([])
    })

    it('addToDownloadHistory adds guid', () => {
      store.addToDownloadHistory('guid-001')
      expect(store.getDownloadHistory()).toContain('guid-001')
    })

    it('addToDownloadHistory deduplicates', () => {
      store.addToDownloadHistory('guid-001')
      store.addToDownloadHistory('guid-001')
      expect(store.getDownloadHistory()).toHaveLength(1)
    })

    it('isInDownloadHistory returns true for existing', () => {
      store.addToDownloadHistory('guid-001')
      expect(store.isInDownloadHistory('guid-001')).toBe(true)
    })

    it('isInDownloadHistory returns false for missing', () => {
      expect(store.isInDownloadHistory('missing')).toBe(false)
    })

    it('clearDownloadHistory empties the list', () => {
      store.addToDownloadHistory('guid-001')
      store.addToDownloadHistory('guid-002')
      store.clearDownloadHistory()
      expect(store.getDownloadHistory()).toEqual([])
    })

    it('caps history at 1000 entries, keeping most recent', () => {
      // Add 1002 items
      for (let i = 0; i < 1002; i++) {
        store.addToDownloadHistory(`guid-${i}`)
      }
      const history = store.getDownloadHistory()
      expect(history.length).toBeLessThanOrEqual(1000)
      // Most recent items should be kept
      expect(history).toContain('guid-1001')
      expect(history).toContain('guid-1000')
      // Oldest items should be dropped
      expect(history).not.toContain('guid-0')
      expect(history).not.toContain('guid-1')
    })
  })
})
