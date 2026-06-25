import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerIpcHandlers } from './ipc'
import { CctvApiService } from './api/cctv'
import { BrowseService } from './api/browse'
import { SegmentDecryptor, createDefaultDecrypt } from './download/decryptor'
import { Finalizer } from './download/finalizer'
import { DownloadCoordinator } from './download/coordinator'
import { ConfigStore } from './config'
import { setLogLevel, setLogPath, logger } from './logger'
import { taskbarFraction } from '../shared/progress'
import { sanitizeBounds } from '../shared/window-bounds'
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
      // Tray uses the app icon on every platform. (A dedicated monochrome macOS
      // template image could be added later via setTemplateImage if desired.)
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
  const decryptor = new SegmentDecryptor(createDefaultDecrypt(), settings.threadCount || 8)
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
      if (isMac) tray.setTitle('')
      else tray.setToolTip('cctvdl')
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

  logger.info('cctvdl ready')
})

// Flush in-progress resume state and stop child processes before the app exits.
app.on('before-quit', () => {
  coordinatorRef?.shutdown()
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
