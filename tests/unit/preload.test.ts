import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { CctvdlApi } from '../../src/shared/types'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  return {
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: Object.assign(new EventEmitter(), { invoke: vi.fn() })
  }
})

import { contextBridge, ipcRenderer } from 'electron'
import '../../src/preload/index'

const api = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][1] as CctvdlApi
const events = ipcRenderer as unknown as EventEmitter
const subscriptions = [
  ['onDownloadProgress', 'download-progress'],
  ['onJobFinished', 'job-finished'],
  ['onBatchFinished', 'batch-finished'],
  ['onBatchStarted', 'batch-started'],
  ['onDownloadSkipped', 'download-skipped'],
  ['onAlbumLoadProgress', 'album-load-progress'],
  ['onClipboardLink', 'clipboard-link'],
  ['onUpdateAvailable', 'update-available'],
  ['onNewContent', 'new-content']
] as const

describe('preload subscriptions', () => {
  it.each(subscriptions)('%s forwards only the payload and unsubscribes independently', (method, channel) => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = api[method](first)
    const offSecond = api[method](second)
    const payload = { value: 'test' }
    try {
      events.emit(channel, { sender: 'private Electron event' }, payload)
      expect(first).toHaveBeenCalledWith(payload)
      expect(second).toHaveBeenCalledWith(payload)
      offFirst()
      first.mockClear()
      second.mockClear()
      events.emit(channel, {}, payload)
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledOnce()
    } finally {
      offFirst()
      offSecond()
    }
    expect(events.listenerCount(channel)).toBe(0)
  })

  it('navigation callbacks receive no Electron event', () => {
    const callback = vi.fn()
    const off = api.onNavigateDownload(callback)
    events.emit('navigate-download', { sender: 'private Electron event' })
    expect(callback).toHaveBeenCalledWith()
    off()
    expect(events.listenerCount('navigate-download')).toBe(0)
  })
})
