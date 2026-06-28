import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock localStorage before importing the store (store reads it at define time)
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((_key: string) => null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

import { useAppStore } from '../../../src/renderer/stores/app'

describe('useAppStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.clearAllMocks()
    localStorageMock.getItem.mockImplementation((_key: string) => null)
  })

  it('初始状态', () => {
    const store = useAppStore()
    expect(store.activeTab).toBe('home')
    expect(store.aboutOpen).toBe(false)
    expect(store.isDragging).toBe(false)
    expect(store.statusMessage).toBe('')
    expect(store.statusType).toBe('')
  })

  it('toggleSidebar 切换展开状态并写入 localStorage', () => {
    const store = useAppStore()
    const initial = store.sidebarExpanded
    store.toggleSidebar()
    expect(store.sidebarExpanded).toBe(!initial)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('cctvdl-sidebar-expanded', String(!initial))
    store.toggleSidebar()
    expect(store.sidebarExpanded).toBe(initial)
  })
})
