import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, Notification } from 'electron'
import { CompletionNotifier, revealDownloadWindow } from '../../src/main/notification'

const batch = { completed: 2, failed: 1, cancelled: 0, total: 3, failedJobs: [] }

class FakeNotification extends EventEmitter {
  show = vi.fn()
}

function fakeWindow(options: { destroyed?: boolean; minimized?: boolean; loading?: boolean } = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => options.loading ?? false),
    send: vi.fn()
  })
  const win = {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents
  }
  return win
}

describe('CompletionNotifier', () => {
  it('shows a silent notification and handles its click', () => {
    const notification = new FakeNotification()
    const create = vi.fn(() => notification as unknown as Notification)
    const clicked = vi.fn()
    const notifier = new CompletionNotifier(clicked, create, () => true)

    notifier.show(batch)
    notification.emit('click')

    expect(create).toHaveBeenCalledWith({
      title: 'cctvdl', body: '下载完成：2个，失败：1个', silent: true
    })
    expect(notification.show).toHaveBeenCalledOnce()
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('does nothing when desktop notifications are unavailable', () => {
    const create = vi.fn()
    new CompletionNotifier(vi.fn(), create, () => false).show(batch)
    expect(create).not.toHaveBeenCalled()
  })

  it('does not let a notification error alter the batch result', () => {
    const create = vi.fn(() => { throw new Error('unavailable') })
    const notifier = new CompletionNotifier(vi.fn(), create, () => true)
    expect(() => notifier.show(batch)).not.toThrow()
  })

  it('contains native show and click failures', () => {
    const notification = new FakeNotification()
    notification.show.mockImplementationOnce(() => { throw new Error('show failed') })
    const create = vi.fn(() => notification as unknown as Notification)
    const notifier = new CompletionNotifier(() => { throw new Error('window failed') }, create, () => true)

    expect(() => notifier.show(batch)).not.toThrow()
    expect(() => notification.emit('click')).not.toThrow()
  })
})

describe('revealDownloadWindow', () => {
  it('restores and focuses a minimized window before navigating', () => {
    const win = fakeWindow({ minimized: true })
    const create = vi.fn()

    revealDownloadWindow(() => win as unknown as BrowserWindow, create)

    expect(create).not.toHaveBeenCalled()
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('navigate-download')
  })

  it('shows a hidden window without restoring it', () => {
    const win = fakeWindow()

    revealDownloadWindow(() => win as unknown as BrowserWindow, vi.fn())

    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('navigate-download')
  })

  it('recreates a destroyed window and waits for its renderer', () => {
    const destroyed = fakeWindow({ destroyed: true })
    const replacement = fakeWindow()
    const create = vi.fn(() => replacement as unknown as BrowserWindow)

    revealDownloadWindow(() => destroyed as unknown as BrowserWindow, create)

    expect(create).toHaveBeenCalledOnce()
    expect(replacement.webContents.send).not.toHaveBeenCalled()
    replacement.webContents.emit('did-finish-load')
    expect(replacement.webContents.send).toHaveBeenCalledWith('navigate-download')
  })

  it('waits for an existing loading renderer', () => {
    const win = fakeWindow({ loading: true })

    revealDownloadWindow(() => win as unknown as BrowserWindow, vi.fn())

    expect(win.webContents.send).not.toHaveBeenCalled()
    win.webContents.emit('did-finish-load')
    expect(win.webContents.send).toHaveBeenCalledWith('navigate-download')
  })
})
