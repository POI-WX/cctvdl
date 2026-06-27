import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import type { DownloadCoordinator } from './download/coordinator'
import type { BrowseService } from './api/browse'
import type { ConfigStore } from './config'
import path from 'path'
import fs from 'fs'
import { appendFailures, logger } from './logger'
import { checkSaveDir } from './preflight'
import type { ProgramInfo, VideoInfo, Settings, DownloadJob, DownloadProgress, BatchResult } from '../shared/types'

export function registerIpcHandlers(
  getWindow: () => BrowserWindow,
  coordinator: DownloadCoordinator,
  browse: BrowseService,
  config: ConfigStore
): void {
  // Resolve the current window lazily so handlers survive window recreation (macOS).
  const send = (channel: string, payload?: unknown): void => {
    const wc = getWindow()?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }
  // Whether the *current* batch should auto-open the save folder when it finishes.
  // Set per launch so partial downloads (下载选中 / 下载此集) and retries don't pop
  // the folder — only 下载本月（全部）and single-video downloads do.
  let currentBatchAutoOpen = false
  ipcMain.handle('browse-program', async (_, url: string) => {
    const info = await browse.resolveColumnInfo(url)
    // Guard against zombie columns: pages that carry a column_id but whose
    // video list is permanently empty (e.g. standalone movie pages on CCTV).
    // A single no-month query (d='') returns all-time content — real columns
    // always have historical videos; zombie columns return empty regardless of
    // time range. One request is enough; no month-loop needed.
    const anyVideos = await browse.getColumnVideoList(info.columnId, 1, '').catch(() => [])
    if (!anyVideos.length) {
      throw new Error('无法解析节目信息')
    }
    return info
  })

  ipcMain.handle('list-videos', async (_, columnId: string, itemId: string, month: string) => {
    const result = await browse.getColumnVideoList(columnId, 1, month)
    if (!result.length && itemId) {
      return browse.getAlbumVideoList(itemId, 1, month)
    }
    return result
  })

  ipcMain.handle('import-program', (_, program: ProgramInfo) => config.addProgram(program))

  // Delete by columnId (safe against index drift)
  ipcMain.handle('delete-program', (_, columnId: string) => config.deleteProgram(columnId))

  ipcMain.handle('clear-programs', () => config.clearPrograms())

  ipcMain.handle('set-program-favorite', (_, columnId: string, favorite: boolean) =>
    config.setProgramFavorite(columnId, favorite))

  ipcMain.handle('get-programs', () => config.getPrograms())

  // Standalone (non-column) videos: resolve a video page → persist/list/remove.
  ipcMain.handle('resolve-single-video', (_, url: string) => browse.resolveSingleVideo(url))
  ipcMain.handle('get-single-videos', () => config.getSingleVideos())
  ipcMain.handle('add-single-video', (_, v: VideoInfo) => config.addSingleVideo(v))
  ipcMain.handle('delete-single-video', (_, guid: string) => config.deleteSingleVideo(guid))
  ipcMain.handle('clear-single-videos', () => config.clearSingleVideos())

  // Import columns from a user-picked JSON file (symmetric with export). Returns
  // the number added, or -1 when the dialog was cancelled.
  ipcMain.handle('import-programs', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return -1
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
    return config.importPrograms(JSON.parse(raw))
  })

  ipcMain.handle('export-programs', async () => {
    const programs = config.getPrograms()
    if (!programs.length) return false
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: 'programs.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, JSON.stringify(programs, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle('import-single-videos', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return -1
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
    return config.importSingleVideos(JSON.parse(raw))
  })

  ipcMain.handle('export-single-videos', async () => {
    const videos = config.exportSingleVideos()
    if (!videos.length) return false
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: 'single-videos.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, JSON.stringify(videos, null, 2), 'utf-8')
    return true
  })

  const launchBatch = (jobs: DownloadJob[], skipHistory: boolean, autoOpen = false): void => {
    currentBatchAutoOpen = autoOpen
    // Pre-flight: make sure the target directory exists and is writable before
    // spawning any work. Throws so the renderer's catch surfaces the reason.
    const saveDir = jobs.length ? path.dirname(jobs[0].savePath) : ''
    const pf = checkSaveDir(saveDir)
    if (!pf.ok) throw new Error(pf.reason)

    // Filter out already-downloaded videos (unless this is an explicit retry).
    const newJobs = skipHistory
      ? jobs
      : jobs.filter(job => {
          if (job.guid && config.isInDownloadHistory(job.guid)) {
            send('download-skipped', { guid: job.guid, title: job.title, reason: '已下载' })
            return false
          }
          return true
        })
    if (newJobs.length > 0) {
      send('batch-started', {
        total: newJobs.length,
        jobs: newJobs.map(j => ({ id: j.id, title: j.title, guid: j.guid }))
      })
      // Apply current concurrentVideos setting before starting
      const settings = config.getSettings()
      coordinator.setConcurrentVideos(settings.concurrentVideos ?? 1)
      coordinator.startBatch(newJobs)
    } else {
      // All jobs were already downloaded - send empty batch-finished to reset UI
      send('batch-finished', {
        completed: 0, failed: 0, cancelled: 0, total: 0, failedJobs: []
      })
    }
  }

  ipcMain.handle('start-download', (_, jobs: DownloadJob[], autoOpen?: boolean) => launchBatch(jobs, false, !!autoOpen))

  // Retry bypasses the download-history filter and resumes from any cached segments.
  ipcMain.handle('retry-job', (_, job: DownloadJob) => launchBatch([job], true))
  ipcMain.handle('retry-jobs', (_, jobs: DownloadJob[]) => launchBatch(jobs, true))

  ipcMain.handle('cancel-download', (_, jobId: string) => coordinator.cancel(jobId))

  ipcMain.handle('cancel-all-downloads', () => coordinator.cancelAll())

  ipcMain.handle('get-settings', () => {
    const settings = config.getSettings()
    logger.info(`get-settings: savePath=${settings.savePath}, threadCount=${settings.threadCount}`)
    return settings
  })

  ipcMain.handle('save-settings', (_, settings: Settings) => {
    logger.info(`save-settings: savePath=${settings.savePath}, threadCount=${settings.threadCount}`)
    config.saveSettings(settings)
    return true
  })

  ipcMain.handle('get-download-history', () => config.getDownloadHistory())

  ipcMain.handle('clear-download-history', () => config.clearDownloadHistory())
  ipcMain.handle('remove-from-download-history', (_, guid: string) => config.removeFromDownloadHistory(guid))

  ipcMain.handle('select-directory', async (_, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openDirectory'],
      defaultPath: defaultPath || undefined
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('open-path', (_, p: string) => shell.openPath(p))

  ipcMain.handle('open-url', (_, url: string) => shell.openExternal(url))

  // Reveal a specific file in the OS file manager (selects it).
  ipcMain.handle('reveal-file', (_, p: string) => shell.showItemInFolder(p))

  coordinator.on('progress', (p: DownloadProgress) => {
    send('download-progress', p)
  })

  coordinator.on('jobFinished', (job: DownloadJob) => {
    send('job-finished', job)
  })

  coordinator.on('batchFinished', (result: BatchResult) => {
    send('batch-finished', result)
    if (result.failedJobs.length > 0) {
      appendFailures(new Date().toISOString(), result.failedJobs)
    }
    // Auto-open the save folder only for full-set downloads (flagged at launch),
    // when the user enabled it and something actually completed.
    if (currentBatchAutoOpen && result.completed > 0 && config.getSettings().autoOpenFolder) {
      const dir = config.getSettings().savePath
      if (dir) shell.openPath(dir)
    }
  })
}
