import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import type { DownloadCoordinator } from './download/coordinator'
import type { BrowseService } from './api/browse'
import type { ConfigStore } from './config'
import path from 'path'
import fs from 'fs'
import { appendFailures, logger, setLogLevel, setLogPath } from './logger'
import { downloadCoverToDir } from './api/cover'
import { checkSaveDir } from './preflight'
import type { ProgramInfo, VideoInfo, Settings, DownloadJob, DownloadProgress, BatchResult } from '../shared/types'
import { getProgramListSource } from '../shared/programs'

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
  // OR-accumulates across appends within the same batch so a later "下载选中"
  // (autoOpen=false) cannot wipe an earlier "下载本月" (autoOpen=true) that was
  // appended while the batch was in flight. Reset to false when a fresh batch
  // starts (coordinator is idle at launch time).
  let currentBatchAutoOpen = false
  ipcMain.handle('browse-program', async (_, url: string) => {
    const info = await browse.resolveColumnInfo(url)
    const source = getProgramListSource(info)
    if (source.type === 'album') {
      const anyVideos = await browse.getAlbumVideoList(source.id, 1, '', source.serviceId).catch(() => [])
      if (!anyVideos.length) throw new Error('无法解析节目信息')
      return info
    }
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

  ipcMain.handle('list-videos', async (_, program: ProgramInfo, month: string, requestId?: number, forceRefresh = false) => {
    const source = getProgramListSource(program)
    if (source.type === 'album') {
      if (forceRefresh) browse.clearAlbumCache(source.id, source.serviceId)
      const videos = await browse.getAlbumVideoList(
        source.id,
        1,
        month,
        source.serviceId,
        videos => send('album-load-progress', {
          columnId: program.columnId,
          ...(requestId == null ? {} : { requestId }),
          videos
        })
      )
      logger.debug(`list-videos: ${program.name}, source=album:${source.id}, month=${month || 'all'}, count=${videos.length}`)
      return videos
    }
    const videos = await browse.getColumnVideoList(source.id, 1, month)
    logger.debug(`list-videos: ${program.name}, source=column:${source.id}, month=${month || 'all'}, count=${videos.length}`)
    return videos
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
  ipcMain.handle('resolve-video-batch', (_, url: string, quality?: Settings['quality']) =>
    browse.resolveSingleVideoBatch(url, quality))
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
    return config.importPrograms(readJsonFile(result.filePaths[0]))
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
    return config.importSingleVideos(readJsonFile(result.filePaths[0]))
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
      // Apply current concurrentVideos setting before starting
      const settings = config.getSettings()
      coordinator.setConcurrentVideos(settings.concurrentVideos ?? 1)
      const addedJobs = coordinator.appendJobs(newJobs)
      const addedIds = new Set(addedJobs.map(job => job.id))
      for (const job of newJobs) {
        if (!addedIds.has(job.id)) send('download-skipped', { guid: job.guid, title: job.title, reason: '已在下载队列中' })
      }
      if (addedJobs.length > 0) {
        currentBatchAutoOpen = currentBatchAutoOpen || !!autoOpen
        send('batch-started', {
          total: addedJobs.length,
          jobs: addedJobs.map(j => ({ id: j.id, title: j.title, guid: j.guid }))
        })
      }
    } else {
      // All jobs were already downloaded - send empty batch-finished to reset UI
      currentBatchAutoOpen = false
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

  ipcMain.handle('reorder-queue', (_, ids: string[]) => coordinator.reorderQueue(ids))

  ipcMain.handle('get-settings', () => {
    const settings = config.getSettings()
    logger.info(`get-settings: savePath=${settings.savePath}, threadCount=${settings.threadCount}`)
    return settings
  })

  ipcMain.handle('save-settings', (_, settings: Settings) => {
    logger.info(`save-settings: savePath=${settings.savePath}, threadCount=${settings.threadCount}`)
    config.saveSettings(settings)
    const saved = config.getSettings()
    setLogLevel(saved.logLevel)
    setLogPath(saved.logPath ?? '')
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

  ipcMain.handle('open-url', (_, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持打开 HTTP(S) 链接')
    return shell.openExternal(parsed.href)
  })

  ipcMain.handle('reveal-file', (_, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('download-cover', async (_, url: string, saveDir: string, baseName: string) => {
    try {
      return await downloadCoverToDir(url, saveDir, baseName)
    } catch (err) {
      throw new Error(`封面下载失败：${err instanceof Error ? err.message : err}`)
    }
  })

  coordinator.on('progress', (p: DownloadProgress) => {
    send('download-progress', p)
  })

  coordinator.on('jobFinished', (job: DownloadJob) => {
    send('job-finished', job)
  })

  coordinator.on('batchFinished', (result: BatchResult) => {
    const shouldAutoOpen = currentBatchAutoOpen
    currentBatchAutoOpen = false
    send('batch-finished', result)
    if (result.failedJobs.length > 0) {
      appendFailures(new Date().toISOString(), result.failedJobs)
    }
    // Auto-open the save folder only for full-set downloads (flagged at launch),
    // when the user enabled it and something actually completed.
    if (shouldAutoOpen && result.completed > 0 && config.getSettings().autoOpenFolder) {
      const dir = config.getSettings().savePath
      if (dir) shell.openPath(dir)
    }
  })
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('JSON 文件格式不正确')
    throw error
  }
}
