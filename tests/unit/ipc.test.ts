import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { DownloadCoordinator } from '../../src/main/download/coordinator'
import type { BrowseService } from '../../src/main/api/browse'
import type { ConfigStore } from '../../src/main/config'

// Mock electron (include `app` so logger.resolvePathFn doesn't throw during handler logging)
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
  ipcMain: {
    handle: vi.fn()
  },
  dialog: {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

// Preflight does real fs work; stub it so these delegation tests stay hermetic.
vi.mock('../../src/main/preflight', () => ({
  checkSaveDir: vi.fn(() => ({ ok: true }))
}))

import { registerIpcHandlers } from '../../src/main/ipc'
import { ipcMain } from 'electron'

describe('IPC Handlers', () => {
  let handlers: Record<string, Function>
  let mockWindow: BrowserWindow
  let mockCoordinator: DownloadCoordinator
  let mockBrowse: BrowseService
  let mockConfig: ConfigStore

  beforeEach(() => {
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
      handlers[channel] = handler
      return ipcMain as any
    })

    mockWindow = {
      webContents: { send: vi.fn(), isDestroyed: () => false }
    } as unknown as BrowserWindow

    mockCoordinator = {
      startBatch: vi.fn(),
      cancel: vi.fn(),
      cancelAll: vi.fn(),
      on: vi.fn()
    } as unknown as DownloadCoordinator


    mockBrowse = {
      resolveColumnInfo: vi.fn().mockResolvedValue({ name: 'Test', columnId: 'TOPC1', itemId: '' }),
      getColumnVideoList: vi.fn().mockResolvedValue([{ guid: 'g1', title: 'V1', brief: '', coverUrl: '', time: '' }]),
      getAlbumVideoList: vi.fn().mockResolvedValue([])
    } as unknown as BrowseService

    mockConfig = {
      getSettings: vi.fn().mockReturnValue({ savePath: '/tmp', threadCount: 8, quality: 'auto', logLevel: 'info' }),
      saveSettings: vi.fn(),
      getPrograms: vi.fn().mockReturnValue([]),
      addProgram: vi.fn().mockReturnValue(true),
      deleteProgram: vi.fn(),
      clearPrograms: vi.fn(),
      setProgramFavorite: vi.fn(),
      getDownloadHistory: vi.fn().mockReturnValue([]),
      addToDownloadHistory: vi.fn(),
      isInDownloadHistory: vi.fn().mockReturnValue(false),
      clearDownloadHistory: vi.fn()
    } as unknown as ConfigStore

    registerIpcHandlers(() => mockWindow, mockCoordinator, mockBrowse, mockConfig)
  })

  describe('browse-program', () => {
    it('delegates to browseService.resolveColumnInfo', async () => {
      const result = await handlers['browse-program']({}, 'https://tv.cctv.com/lm/test/')
      expect(mockBrowse.resolveColumnInfo).toHaveBeenCalledWith('https://tv.cctv.com/lm/test/')
      expect(result).toEqual({ name: 'Test', columnId: 'TOPC1', itemId: '' })
    })
  })

  describe('list-videos', () => {
    it('calls getColumnVideoList', async () => {
      const result = await handlers['list-videos']({}, 'TOPC1', '', '202601')
      expect(mockBrowse.getColumnVideoList).toHaveBeenCalledWith('TOPC1', 1, '202601')
      expect(result).toHaveLength(1)
    })

    it('falls back to getAlbumVideoList when column list is empty and itemId provided', async () => {
      vi.mocked(mockBrowse.getColumnVideoList).mockResolvedValueOnce([])
      await handlers['list-videos']({}, 'TOPC1', 'album123', '202601')
      expect(mockBrowse.getAlbumVideoList).toHaveBeenCalledWith('album123', 1, '202601')
    })

    it('does not fall back on network error (propagates directly)', async () => {
      vi.mocked(mockBrowse.getColumnVideoList).mockRejectedValueOnce(new Error('HTTP 503'))
      await expect(handlers['list-videos']({}, 'TOPC1', 'album123', '202601')).rejects.toThrow('HTTP 503')
      expect(mockBrowse.getAlbumVideoList).not.toHaveBeenCalled()
    })
  })

  describe('import-program', () => {
    it('delegates to config.addProgram', async () => {
      const program = { name: 'Test', columnId: 'TOPC1', itemId: '' }
      await handlers['import-program']({}, program)
      expect(mockConfig.addProgram).toHaveBeenCalledWith(program)
    })
  })

  describe('delete-program', () => {
    it('delegates to config.deleteProgram with columnId', async () => {
      await handlers['delete-program']({}, 'TOPC1')
      expect(mockConfig.deleteProgram).toHaveBeenCalledWith('TOPC1')
    })
  })

  describe('clear-programs', () => {
    it('delegates to config.clearPrograms', async () => {
      await handlers['clear-programs']({})
      expect(mockConfig.clearPrograms).toHaveBeenCalled()
    })
  })

  describe('set-program-favorite', () => {
    it('delegates to config.setProgramFavorite with columnId and flag', async () => {
      await handlers['set-program-favorite']({}, 'TOPC1', true)
      expect(mockConfig.setProgramFavorite).toHaveBeenCalledWith('TOPC1', true)
    })
  })

  describe('get-settings', () => {
    it('returns settings from config', async () => {
      const result = await handlers['get-settings']({})
      expect(mockConfig.getSettings).toHaveBeenCalled()
      expect(result.threadCount).toBe(8)
    })
  })

  describe('save-settings', () => {
    it('delegates to config.saveSettings', async () => {
      const settings = { savePath: '/new', threadCount: 4, quality: 'chaoqing' as const, logLevel: 'debug' as const }
      await handlers['save-settings']({}, settings)
      expect(mockConfig.saveSettings).toHaveBeenCalledWith(settings)
    })
  })

  describe('start-download', () => {
    it('calls coordinator.startBatch for new jobs', async () => {
      const jobs = [{ id: 'j1', guid: 'g1', title: 'T', savePath: '/tmp/t.mp4', state: 'Created' as const, stage: 'None' as const, progressPercent: 0, quality: 'auto' as const, threadCount: 8, sourceUrl: '' }]
      vi.mocked(mockConfig.isInDownloadHistory).mockReturnValue(false)
      await handlers['start-download']({}, jobs)
      expect(mockCoordinator.startBatch).toHaveBeenCalledWith(jobs)
    })

    it('skips already-downloaded jobs', async () => {
      const jobs = [{ id: 'j1', guid: 'g1', title: 'T', savePath: '/tmp/t.mp4', state: 'Created' as const, stage: 'None' as const, progressPercent: 0, quality: 'auto' as const, threadCount: 8, sourceUrl: '' }]
      vi.mocked(mockConfig.isInDownloadHistory).mockReturnValue(true)
      await handlers['start-download']({}, jobs)
      expect(mockCoordinator.startBatch).not.toHaveBeenCalled()
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('download-skipped', expect.any(Object))
    })

    it('sends batch-finished when all jobs skipped', async () => {
      const jobs = [{ id: 'j1', guid: 'g1', title: 'T', savePath: '/tmp/t.mp4', state: 'Created' as const, stage: 'None' as const, progressPercent: 0, quality: 'auto' as const, threadCount: 8, sourceUrl: '' }]
      vi.mocked(mockConfig.isInDownloadHistory).mockReturnValue(true)
      await handlers['start-download']({}, jobs)
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('batch-finished', expect.objectContaining({ total: 0 }))
    })
  })

  describe('retry-job', () => {
    it('starts a single-job batch bypassing the download-history filter', async () => {
      const job = { id: 'j1', guid: 'g1', title: 'T', savePath: '/tmp/t.mp4', state: 'Created' as const, stage: 'None' as const, progressPercent: 0, quality: 'auto' as const, threadCount: 8, reencode: false, sourceUrl: '' }
      // Even though it's in history, retry should still run it.
      vi.mocked(mockConfig.isInDownloadHistory).mockReturnValue(true)
      await handlers['retry-job']({}, job)
      expect(mockCoordinator.startBatch).toHaveBeenCalledWith([job])
      expect(mockConfig.isInDownloadHistory).not.toHaveBeenCalled()
    })
  })

  describe('retry-jobs', () => {
    it('starts a multi-job batch bypassing the history filter', async () => {
      const jobs = [
        { id: 'j1', guid: 'g1', title: 'A', savePath: '/tmp/a.mp4', state: 'Created' as const, stage: 'None' as const, progressPercent: 0, quality: 'auto' as const, threadCount: 8, reencode: false, sourceUrl: '' },
        { id: 'j2', guid: 'g2', title: 'B', savePath: '/tmp/b.mp4', state: 'Created' as const, stage: 'None' as const, progressPercent: 0, quality: 'auto' as const, threadCount: 8, reencode: false, sourceUrl: '' },
      ]
      vi.mocked(mockConfig.isInDownloadHistory).mockReturnValue(true)
      await handlers['retry-jobs']({}, jobs)
      expect(mockCoordinator.startBatch).toHaveBeenCalledWith(jobs)
      expect(mockConfig.isInDownloadHistory).not.toHaveBeenCalled()
    })
  })

  describe('reveal-file', () => {
    it('delegates to shell.showItemInFolder', async () => {
      const { shell } = await import('electron')
      await handlers['reveal-file']({}, 'C:/videos/a.mp4')
      expect(shell.showItemInFolder).toHaveBeenCalledWith('C:/videos/a.mp4')
    })
  })

  describe('cancel-download', () => {
    it('delegates to coordinator.cancel', async () => {
      await handlers['cancel-download']({}, 'job-123')
      expect(mockCoordinator.cancel).toHaveBeenCalledWith('job-123')
    })
  })

  describe('cancel-all-downloads', () => {
    it('delegates to coordinator.cancelAll', async () => {
      await handlers['cancel-all-downloads']({})
      expect(mockCoordinator.cancelAll).toHaveBeenCalled()
    })
  })

  describe('download history', () => {
    it('get-download-history returns history', async () => {
      vi.mocked(mockConfig.getDownloadHistory).mockReturnValue(['guid-1', 'guid-2'])
      const result = await handlers['get-download-history']({})
      expect(result).toEqual(['guid-1', 'guid-2'])
    })

    it('clear-download-history delegates to config', async () => {
      await handlers['clear-download-history']({})
      expect(mockConfig.clearDownloadHistory).toHaveBeenCalled()
    })
  })
})
