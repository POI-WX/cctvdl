import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useContentStore } from '../../../src/renderer/stores/content'

// Mock window.cctvdlApi for refreshDownloadedSet
const mockGetDownloadHistory = vi.fn().mockResolvedValue(['GUID001', 'GUID002'])
vi.stubGlobal('window', {
  cctvdlApi: { getDownloadHistory: mockGetDownloadHistory }
})

describe('useContentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockGetDownloadHistory.mockResolvedValue(['GUID001', 'GUID002'])
  })

  it('初始状态', () => {
    const store = useContentStore()
    expect(store.programs).toEqual([])
    expect(store.videos).toEqual([])
    expect(store.viewMode).toBe('column')
    expect(store.selectedProgram).toBeNull()
    expect(store.emptyMonths.size).toBe(0)
    expect(store.newContentMap.size).toBe(0)
  })

  describe('isFav', () => {
    it('有 favoritedAt 返回 true', () => {
      const store = useContentStore()
      expect(store.isFav({ name: 'X', columnId: 'C1', itemId: '', favoritedAt: 1000 })).toBe(true)
    })
    it('无 favoritedAt 返回 false', () => {
      const store = useContentStore()
      expect(store.isFav({ name: 'X', columnId: 'C1', itemId: '' })).toBe(false)
    })
  })

  describe('recordVideosLoaded', () => {
    it('空列表时加入 emptyMonths', () => {
      const store = useContentStore()
      store.recordVideosLoaded('202601', [])
      expect(store.emptyMonths.has('202601')).toBe(true)
    })
    it('非空列表时从 emptyMonths 移除', () => {
      const store = useContentStore()
      store.recordVideosLoaded('202601', [])
      store.recordVideosLoaded('202601', [{ guid: 'G', title: 'T', brief: '', coverUrl: '', time: '' }])
      expect(store.emptyMonths.has('202601')).toBe(false)
    })
  })

  describe('clearEmptyMonths', () => {
    it('清空所有空月记录', () => {
      const store = useContentStore()
      store.recordVideosLoaded('202601', [])
      store.recordVideosLoaded('202602', [])
      store.clearEmptyMonths()
      expect(store.emptyMonths.size).toBe(0)
    })
  })

  describe('applyNewContent', () => {
    it('更新 newContentMap', () => {
      const store = useContentStore()
      store.applyNewContent('COL001', 3)
      expect(store.newContentMap.get('COL001')).toBe(3)
    })
    it('多次调用各自记录', () => {
      const store = useContentStore()
      store.applyNewContent('COL001', 2)
      store.applyNewContent('COL002', 5)
      expect(store.newContentMap.get('COL001')).toBe(2)
      expect(store.newContentMap.get('COL002')).toBe(5)
    })
  })

  describe('refreshDownloadedSet', () => {
    it('从 API 更新 downloadedSet', async () => {
      const store = useContentStore()
      await store.refreshDownloadedSet()
      expect(store.downloadedSet.has('GUID001')).toBe(true)
      expect(store.downloadedSet.has('GUID002')).toBe(true)
    })
    it('API 报错时静默处理', async () => {
      mockGetDownloadHistory.mockRejectedValueOnce(new Error('fail'))
      const store = useContentStore()
      await expect(store.refreshDownloadedSet()).resolves.not.toThrow()
    })
  })

  describe('computed', () => {
    it('filteredPrograms 按 programQuery 过滤', () => {
      const store = useContentStore()
      store.programs = [
        { name: '新闻联播', columnId: 'C1', itemId: '' },
        { name: '焦点访谈', columnId: 'C2', itemId: '' },
      ]
      store.programQuery = '新闻'
      expect(store.filteredPrograms).toHaveLength(1)
      expect(store.filteredPrograms[0].name).toBe('新闻联播')
    })

    it('emptyHint 单视频模式无视频时正确', () => {
      const store = useContentStore()
      store.viewMode = 'single'
      store.videos = []
      expect(store.emptyHint).toBe('粘贴单个视频链接添加')
    })

    it('emptyHint 栏目模式无视频时正确', () => {
      const store = useContentStore()
      store.viewMode = 'column'
      store.videos = []
      expect(store.emptyHint).toBe('该月份暂无视频')
    })

    it('allSelected 全选时为 true', () => {
      const store = useContentStore()
      store.videos = [
        { guid: 'G1', title: 'T1', brief: '', coverUrl: '', time: '', selected: true },
        { guid: 'G2', title: 'T2', brief: '', coverUrl: '', time: '', selected: true },
      ]
      expect(store.allSelected).toBe(true)
    })

    it('downloadedCount 只计已下载的', () => {
      const store = useContentStore()
      store.videos = [
        { guid: 'G1', title: 'T1', brief: '', coverUrl: '', time: '' },
        { guid: 'G2', title: 'T2', brief: '', coverUrl: '', time: '' },
      ]
      store.downloadedSet = new Set(['G1'])
      expect(store.downloadedCount).toBe(1)
    })
  })
})
