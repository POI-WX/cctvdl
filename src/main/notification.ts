import { Notification, type BrowserWindow } from 'electron'
import { logger } from './logger'
import type { BatchResult } from '../shared/types'

export function revealDownloadWindow(
  getWindow: () => BrowserWindow | undefined,
  createWindow: () => BrowserWindow
): void {
  const current = getWindow()
  const created = !current || current.isDestroyed()
  const win = created ? createWindow() : current
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()

  const navigate = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('navigate-download')
    }
  }
  if (created || win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', navigate)
  } else {
    navigate()
  }
}

export class CompletionNotifier {
  private readonly retained = new Set<Notification>()

  constructor(
    private readonly onClick: () => void,
    private readonly createNotification: (options: { title: string; body: string; silent: boolean }) => Notification =
      options => new Notification(options),
    private readonly isSupported: () => boolean = () => Notification.isSupported()
  ) {}

  show(result: BatchResult): void {
    let notification: Notification | undefined
    try {
      if (!this.isSupported()) return
      const created = this.createNotification({
        title: 'cctvdl',
        body: `下载完成：${result.completed}个，失败：${result.failed}个`,
        silent: true
      })
      notification = created
      created.on('click', () => {
        this.retained.delete(created)
        try { this.onClick() } catch (error) {
          logger.warn(`Download notification click failed: ${String(error)}`)
        }
      })
      created.on('failed', (_event, error) => {
        this.retained.delete(created)
        logger.warn(`Download notification failed: ${error}`)
      })
      this.retained.add(created)
      if (this.retained.size > 16) {
        const oldest = this.retained.values().next().value
        if (oldest) this.retained.delete(oldest)
      }
      created.show()
    } catch (error) {
      if (notification) this.retained.delete(notification)
      logger.warn(`Download notification unavailable: ${String(error)}`)
    }
  }
}
