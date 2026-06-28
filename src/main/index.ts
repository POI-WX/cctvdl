import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerIpcHandlers } from './ipc'
import { ClipboardWatcher } from './clipboard-watch'
import { CctvApiService } from './api/cctv'
import { BrowseService } from './api/browse'
import { SegmentDecryptor, createDefaultDecrypt } from './download/decryptor'
import { Finalizer } from './download/finalizer'
import { DownloadCoordinator } from './download/coordinator'
import { ConfigStore } from './config'
import { setLogLevel, setLogPath, logger } from './logger'
import { taskbarFraction } from '../shared/progress'
import { sanitizeBounds } from '../shared/window-bounds'
import { checkForUpdate } from '../shared/update-check'
import type { BatchResult, DownloadProgress } from '../shared/types'

const isMac   = process.platform === 'darwin'
const isPackaged = app.isPackaged

// ─── Single-instance lock ──────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// ─── Resource path ─────────────────────────────────────────────────────────
function getResourcePath(...segments: string[]): string {
  if (isPackaged) {
    return path.join(process.resourcesPath, ...segments)
  }
  return path.join(app.getAppPath(), 'resources', ...segments)
}

let mainWindow: BrowserWindow
let tray: Tray | null = null
let coordinatorRef: DownloadCoordinator | null = null
let configRef: ConfigStore | null = null
let clipboardWatcherRef: ClipboardWatcher | null = null

function createMainWindow(): BrowserWindow {
  // Restore saved bounds, clamped to the current screen so we never open off-screen.
  const area = screen.getPrimaryDisplay().workArea
  const restored = sanitizeBounds(configRef?.getWindowBounds(), area)

  const win = new BrowserWindow({
    width: restored?.width ?? 960,
    height: restored?.height ?? 680,
    x: restored?.x,
    y: restored?.y,
    minWidth: 720,
    minHeight: 520,
    title: 'cctvdl',
    icon: getResourcePath('icons', 'icon.png'),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (restored?.maximized) win.maximize()

  // Persist bounds on close (store the normal, non-maximized rect + a flag).
  win.on('close', () => {
    try {
      const maximized = win.isMaximized()
      const b = win.getNormalBounds()
      configRef?.setWindowBounds({ x: b.x, y: b.y, width: b.width, height: b.height, maximized })
    } catch { /* ignore */ }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const config = new ConfigStore()
  configRef = config
  const settings = config.getSettings()
  setLogLevel(settings.logLevel)

  // Apply user-configured log path if set
  if (settings.logPath) {
    setLogPath(settings.logPath)
  }

  logger.info('cctvdl starting...')

  mainWindow = createMainWindow()

  // Menu: minimal on macOS, hidden on Windows/Linux
  if (isMac) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu', submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]},
      // Edit menu wires up Cmd+C/V/X/A — on macOS these shortcuts route through
      // the native menu, so without it paste into inputs silently fails.
      { role: 'editMenu' }
    ]))
  } else {
    Menu.setApplicationMenu(null)
  }

  // System tray (macOS uses different click/menu behaviour than Win/Linux)
  const iconPath = getResourcePath('icons', 'icon.png')
  if (fs.existsSync(iconPath)) {
    try {
      // Tray uses the app icon on every platform.
      // TODO: consider a dedicated monochrome template image for macOS via setTemplateImage
      const trayIcon = nativeImage.createFromPath(iconPath)

      tray = new Tray(trayIcon)
      tray.setToolTip('cctvdl')

      const contextMenu = Menu.buildFromTemplate([
        { label: '显示窗口', click: () => mainWindow.show() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])

      // Consistent across platforms: left-click shows the window, right-click
      // pops the menu. Linux tray click events are unreliable on many distros,
      // so also bind the menu via setContextMenu as a dependable fallback there.
      tray.on('click', () => mainWindow.show())
      tray.on('right-click', () => tray?.popUpContextMenu(contextMenu))
      if (process.platform === 'linux') tray.setContextMenu(contextMenu)
    } catch {
      logger.warn('System tray not available')
    }
  } else {
    logger.info('Tray icon not found, skipping tray creation')
  }

  const api = new CctvApiService()
  const browse = new BrowseService()
  const decryptor = new SegmentDecryptor(createDefaultDecrypt(), settings.threadCount)
  const finalizer = new Finalizer()
  const coordinator = new DownloadCoordinator(api, decryptor, finalizer, config)
  coordinatorRef = coordinator

  // IPC handlers resolve the live window lazily so they survive recreation on macOS.
  registerIpcHandlers(() => mainWindow, coordinator, browse, config)

  // OS taskbar (Windows) / dock (macOS) progress + tray indicator during downloads.
  coordinator.on('progress', (p: DownloadProgress) => {
    const frac = taskbarFraction(p.batchCompleted ?? 0, p.batchTotal ?? 0, p.percent)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(frac)
    if (tray && frac >= 0) {
      if (isMac) {
        // macOS menu bar: show percentage as text next to icon
        tray.setTitle(` ${Math.round(frac * 100)}%`)
      } else {
        tray.setToolTip(`cctvdl - 下载中 ${Math.round(frac * 100)}%`)
      }
    }
  })

  coordinator.on('batchFinished', (result: BatchResult) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1)
    if (tray) {
      if (result.failed > 0) {
        if (isMac) tray.setTitle(' ⚠')
        else tray.setToolTip(`cctvdl — ${result.failed} 个任务失败`)
        setTimeout(() => {
          if (tray) {
            if (isMac) tray.setTitle('')
            else tray.setToolTip('cctvdl')
          }
        }, 5000)
      } else {
        if (isMac) tray.setTitle('')
        else tray.setToolTip('cctvdl')
      }
    }
    if (!mainWindow || !mainWindow.isVisible() || mainWindow.isMinimized()) {
      if (Notification.isSupported()) {
        new Notification({
          title: 'cctvdl',
          body: `下载完成：${result.completed}个，失败：${result.failed}个`
        }).show()
      }
    }
  })

  // Clipboard watcher: only reads the clipboard while the user opted in (default
  // off), then offers to import a copied CCTV link.
  clipboardWatcherRef = new ClipboardWatcher(
    () => config.getSettings().clipboardWatch === true,
    (url) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clipboard-link', url) }
  )
  clipboardWatcherRef.start()

  // Background checks: fire once the renderer has loaded so send() is safe.
  mainWindow.webContents.once('did-finish-load', () => {
    // Resume any queued jobs that were persisted before the last app exit.
    const pending = config.getPendingJobs()
    if (pending.length > 0) {
      logger.info(`Resuming ${pending.length} pending job(s) from previous session`)
      coordinator.resumePending(pending)
      mainWindow.webContents.send('batch-started', {
        total: pending.length,
        jobs: pending.map(j => ({ id: j.id, title: j.title, guid: j.guid }))
      })
    }

    // Version update check — env override for testing (no real fetch needed in GUI tests)
    const mockVersion = process.env['MOCK_UPDATE_VERSION']
    if (mockVersion) {
      mainWindow.webContents.send('update-available', { version: mockVersion })
    } else {
      checkForUpdate(app.getVersion()).then(result => {
        if (result.available && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', { version: result.version })
        }
      }).catch(() => { /* silent */ })
    }

    // New-content check: compare latest video guid of each favorited program against download history.
    // Run concurrently — each fetch is independent.
    const programs = config.getPrograms().filter(p => p.favoritedAt != null)
    if (programs.length === 0) return
    const history = new Set(config.getDownloadHistory().map(e => e.guid))
    const now = new Date()
    const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    Promise.allSettled(programs.map(async (program) => {
      let list = await browse.getColumnVideoList(program.columnId, 1, month)
      if (!list.length && program.itemId) {
        list = await browse.getAlbumVideoList(program.itemId, 1, month)
      }
      const newCount = list.filter(v => !history.has(v.guid)).length
      if (newCount > 0 && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-content', { columnId: program.columnId, count: newCount })
      }
    })).catch(() => { /* silent — network may be unavailable */ })
  })

  logger.info('cctvdl ready')
})

// Flush in-progress resume state and stop child processes before the app exits.
app.on('before-quit', () => {
  coordinatorRef?.shutdown()
  clipboardWatcherRef?.stop()
})

// macOS: keep the app alive in the Dock when all windows are closed
app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

// macOS: recreate the window when clicking the Dock icon with no windows open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow()
  } else {
    mainWindow?.show()
  }
})
