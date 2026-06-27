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
import { ipcMain, shell } from 'electron'

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
      setConcurrentVideos: vi.fn(),
      reorderQueue: vi.fn(),
      on: vi.fn()
    } as unknown as DownloadCoordinator


    mockBrowse = {
      resolveColumnInfo: vi.fn().mockResolvedValue({ name: 'Test', columnId: 'TOPC1', itemId: '' }),
      resolveSingleVideo: vi.fn().mockResolvedValue({ guid: 'VIDE1', title: 'Movie', brief: '', coverUrl: '', time: '' }),
      getColumnVideoList: vi.fn().mockResolvedValue([{ guid: 'g1', title: 'V1', brief: '', coverUrl: '', time: '' }]),
      getAlbumVideoList: vi.fn().mockResolvedValue([])
    } as unknown as BrowseService

    mockConfig = {
      getSettings: vi.fn().mockReturnValue({ savePath: '/tmp', threadCount: 8, quality: 'auto', logLevel: 'info', concurrentVideos: 1 }),
      saveSettings: vi.fn(),
      getPrograms: vi.fn().mockReturnValue([]),
      addProgram: vi.fn().mockReturnValue(true),
      importPrograms: vi.fn().mockReturnValue(2),
      deleteProgram: vi.fn(),
      clearPrograms: vi.fn(),
      setProgramFavorite: vi.fn(),
      getSingleVideos: vi.fn().mockReturnValue([]),
      addSingleVideo: vi.fn().mockReturnValue(true),
      deleteSingleVideo: vi.fn(),
      clearSingleVideos: vi.fn(),
      getDownloadHistory: vi.fn().mockReturnValue([]),
      addToDownloadHistory: vi.fn(),
      isInDownloadHistory: vi.fn().mockReturnValue(false),
      clearDownloadHistory: vi.fn()
    } as unknown as ConfigStore

    registerIpcHandlers(() => mockWindow, mockCoordinator, mockBrowse, mockConfig)
  })

  describe('browse-program', () => {
    it('resolves column info and probes for all-time content', async () => {
      // mockBrowse.getColumnVideoList returns 1 video by default
      const result = await handlers['browse-program']({}, 'https://tv.cctv.com/lm/test/')
      expect(mockBrowse.resolveColumnInfo).toHaveBeenCalledWith('https://tv.cctv.com/lm/test/')
      // probe uses empty month string to get all-time content
      expect(mockBrowse.getColumnVideoList).toHaveBeenCalledWith('TOPC1', 1, '')
      expect(result).toEqual({ name: 'Test', columnId: 'TOPC1', itemId: '' })
    })

    it('throws when all-time list is empty (zombie column)', async () => {
      vi.mocked(mockBrowse.getColumnVideoList).mockResolvedValueOnce([])
      await expect(handlers['browse-program']({}, 'https://tv.cctv.com/lm/test/')).rejects.toThrow('无法解析节目信息')
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

  describe('import-programs', () => {
    it('returns -1 and does not import when the dialog is cancelled', async () => {
      const result = await handlers['import-programs']({})
      expect(result).toBe(-1)
      expect(mockConfig.importPrograms).not.toHaveBeenCalled()
    })
  })

  describe('auto-open folder on batch finish', () => {
    const job = {
      id: '1', guid: 'g', sourceUrl: 'g', title: 't', savePath: '/tmp/save/a.mp4',
      quality: 'auto', threadCount: 8, reencode: false, state: 'Created', stage: 'None', progressPercent: 0
    } as any
    const done = { completed: 1, failed: 0, cancelled: 0, total: 1, failedJobs: [] }
    function batchFinishedHandler() {
      const call = vi.mocked(mockCoordinator.on).mock.calls.find((c) => c[0] === 'batchFinished')
      return call?.[1] as (r: any) => void
    }
    const settingsWith = (autoOpenFolder: boolean) =>
      vi.mocked(mockConfig.getSettings).mockReturnValue(
        { savePath: '/tmp/save', autoOpenFolder, threadCount: 8, quality: 'auto', logLevel: 'info', reencode: false } as any
      )

    beforeEach(() => vi.mocked(shell.openPath).mockClear())

    it('opens the save folder for a full-set download (autoOpen) when enabled', async () => {
      settingsWith(true)
      await handlers['start-download']({}, [job], true)
      batchFinishedHandler()(done)
      expect(shell.openPath).toHaveBeenCalledWith('/tmp/save')
    })

    it('does NOT open for a partial download (autoOpen false)', async () => {
      settingsWith(true)
      await handlers['start-download']({}, [job], false)
      batchFinishedHandler()(done)
      expect(shell.openPath).not.toHaveBeenCalled()
    })

    it('does NOT open when the setting is off', async () => {
      settingsWith(false)
      await handlers['start-download']({}, [job], true)
      batchFinishedHandler()(done)
      expect(shell.openPath).not.toHaveBeenCalled()
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

  describe('single videos', () => {
    it('resolve-single-video delegates to browse.resolveSingleVideo', async () => {
      const result = await handlers['resolve-single-video']({}, 'https://tv.cctv.com/x.shtml')
      expect(mockBrowse.resolveSingleVideo).toHaveBeenCalledWith('https://tv.cctv.com/x.shtml')
      expect(result).toEqual({ guid: 'VIDE1', title: 'Movie', brief: '', coverUrl: '', time: '' })
    })
    it('add-single-video delegates to config.addSingleVideo', async () => {
      const v = { guid: 'VIDE1', title: 'Movie', brief: '', coverUrl: '', time: '' }
      await handlers['add-single-video']({}, v)
      expect(mockConfig.addSingleVideo).toHaveBeenCalledWith(v)
    })
    it('delete-single-video delegates to config.deleteSingleVideo', async () => {
      await handlers['delete-single-video']({}, 'VIDE1')
      expect(mockConfig.deleteSingleVideo).toHaveBeenCalledWith('VIDE1')
    })
    it('clear-single-videos delegates to config.clearSingleVideos', async () => {
      await handlers['clear-single-videos']({})
      expect(mockConfig.clearSingleVideos).toHaveBeenCalled()
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
    it('get-download-history returns HistoryEntry[]', async () => {
      const entries = [
        { guid: 'guid-1', title: '测试视频一', outputPath: '/tmp/a.mp4', fileSize: 1024, completedAt: 1000 },
        { guid: 'guid-2', title: '测试视频二', outputPath: '/tmp/b.mp4', fileSize: 2048, completedAt: 2000 }
      ]
      vi.mocked(mockConfig.getDownloadHistory).mockReturnValue(entries)
      const result = await handlers['get-download-history']({})
      expect(result).toEqual(entries)
    })

    it('clear-download-history delegates to config', async () => {
      await handlers['clear-download-history']({})
      expect(mockConfig.clearDownloadHistory).toHaveBeenCalled()
    })
  })
})
