import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useContentStore } from '../../../src/renderer/stores/content'

// Mock window.cctvdlApi for refreshDownloadedSet
const mockGetDownloadHistory = vi.fn().mockResolvedValue([
  { guid: 'GUID001', title: '', outputPath: '', fileSize: 0, completedAt: 0 },
  { guid: 'GUID002', title: '', outputPath: '', fileSize: 0, completedAt: 0 }
])
vi.stubGlobal('window', {
  cctvdlApi: { getDownloadHistory: mockGetDownloadHistory }
})

describe('useContentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockGetDownloadHistory.mockResolvedValue([
      { guid: 'GUID001', title: '', outputPath: '', fileSize: 0, completedAt: 0 },
      { guid: 'GUID002', title: '', outputPath: '', fileSize: 0, completedAt: 0 }
    ])
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

  describe('clearNewContent', () => {
    it('点击栏目后清除对应红点', () => {
      const store = useContentStore()
      store.applyNewContent('COL001', 3)
      store.applyNewContent('COL002', 1)
      store.clearNewContent('COL001')
      expect(store.newContentMap.has('COL001')).toBe(false)
      expect(store.newContentMap.get('COL002')).toBe(1)
    })
    it('对不存在的 columnId 是 no-op', () => {
      const store = useContentStore()
      store.clearNewContent('NON_EXIST')
      expect(store.newContentMap.size).toBe(0)
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

      it('emptyHint 选集模式无视频时正确', () => {
        const store = useContentStore()
        store.viewMode = 'column'
        store.selectedProgram = { name: '星月征途', columnId: 'VIDA1', itemId: '', kind: 'album' }
        store.videos = []
        expect(store.emptyHint).toBe('暂无选集')
      })

      it('groupedVideos groups full timestamps by date', () => {
        const store = useContentStore()
        store.videos = [
          { guid: 'G1', title: 'T1', brief: '', coverUrl: '', time: '2026-06-12 15:50:36' },
          { guid: 'G2', title: 'T2', brief: '', coverUrl: '', time: '2026-06-12 17:26:37' },
          { guid: 'G3', title: 'T3', brief: '', coverUrl: '', time: '2026-06-13 09:00:00' },
        ]

        expect(store.groupedVideos).toHaveLength(2)
        expect(store.groupedVideos[0].date).toBe('2026-06-12')
        expect(store.groupedVideos[0].items).toHaveLength(2)
      })

    it('allSelected 全选时为 true', () => {
      const store = useContentStore()
      const v1 = { guid: 'G1', title: 'T1', brief: '', coverUrl: '', time: '' }
      const v2 = { guid: 'G2', title: 'T2', brief: '', coverUrl: '', time: '' }
      store.videos = [v1, v2]
      store.toggleVideoSelection(v1)
      store.toggleVideoSelection(v2)
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

  describe('cross-month selection (selectedVideoMap)', () => {
    const mkVideo = (guid: string, title = `T-${guid}`) =>
      ({ guid, title, brief: '', coverUrl: '', time: '' })

    it('isVideoSelected reflects the map, not any per-video flag', () => {
      const store = useContentStore()
      const v = mkVideo('G1')
      expect(store.isVideoSelected(v)).toBe(false)
      store.toggleVideoSelection(v)
      expect(store.isVideoSelected(v)).toBe(true)
    })

    it('toggleVideoSelection is idempotent across two calls (toggle on → off)', () => {
      const store = useContentStore()
      const v = mkVideo('G1')
      store.toggleVideoSelection(v)
      store.toggleVideoSelection(v)
      expect(store.isVideoSelected(v)).toBe(false)
      expect(store.selectedCount).toBe(0)
    })

    it('selection accumulates across videos (cross-month simulation)', () => {
      const store = useContentStore()
      const v1 = mkVideo('G1')
      const v2 = mkVideo('G2')
      const v3 = mkVideo('G3')

      store.toggleVideoSelection(v1)
      store.toggleVideoSelection(v2)
      store.videos = [v1, v2]                // month A
      expect(store.selectedCount).toBe(2)

      // Switch to month B (videos ref is replaced). Prior selections survive.
      store.videos = [v3]
      expect(store.selectedCount).toBe(2)
      expect(store.allSelectedVideos.map(v => v.guid).sort()).toEqual(['G1', 'G2'])

      // Select a video in month B; the total becomes 3.
      store.toggleVideoSelection(v3)
      expect(store.selectedCount).toBe(3)
      expect(store.allSelectedVideos.map(v => v.guid).sort()).toEqual(['G1', 'G2', 'G3'])
    })

    it('selection persists across programs and download state covers the whole batch', () => {
      const store = useContentStore()
      const columnAVideo = mkVideo('COLUMN-A-1')
      const columnBVideo = mkVideo('COLUMN-B-1')

      store.toggleVideoSelection(columnAVideo)
      store.videos = [columnBVideo] // Simulates switching to another program.
      store.toggleVideoSelection(columnBVideo)

      expect(store.allSelectedVideos.map(v => v.guid).sort()).toEqual(['COLUMN-A-1', 'COLUMN-B-1'])
      store.downloadedSet = new Set([columnBVideo.guid])
      expect(store.allSelectedDownloaded).toBe(false)
      store.downloadedSet = new Set([columnAVideo.guid, columnBVideo.guid])
      expect(store.allSelectedDownloaded).toBe(true)
    })

    it('groups selected videos by their source program', () => {
      const store = useContentStore()
      store.toggleVideoSelection(mkVideo('A1'), '栏目 A')
      store.toggleVideoSelection(mkVideo('B1'), '栏目 B')
      store.toggleVideoSelection(mkVideo('A2'), '栏目 A')

      expect(store.selectedVideoGroups).toEqual([
        { name: '栏目 A', videos: [expect.objectContaining({ guid: 'A1' }), expect.objectContaining({ guid: 'A2' })] },
        { name: '栏目 B', videos: [expect.objectContaining({ guid: 'B1' })] }
      ])
    })

    it('toggleSelectAllFiltered(true) adds every filtered video; (false) removes them', () => {
      const store = useContentStore()
      const v1 = mkVideo('G1')
      const v2 = mkVideo('G2')
      const v3 = mkVideo('G3')
      store.videos = [v1, v2, v3]

      store.toggleSelectAllFiltered(true)
      expect(store.selectedCount).toBe(3)

      // Selecting only the visible list leaves no extras, so toggling off
      // empties the whole map.
      store.toggleSelectAllFiltered(false)
      expect(store.selectedCount).toBe(0)
    })

    it('toggleSelectAllFiltered only affects the current filtered list, not off-screen selections', () => {
      const store = useContentStore()
      const v1 = mkVideo('G1')
      const v2 = mkVideo('G2')
      const vOff = mkVideo('G-OFF')

      // Select something that is NOT in the current list.
      store.toggleVideoSelection(vOff)
      expect(store.selectedCount).toBe(1)

      store.videos = [v1, v2]
      store.toggleSelectAllFiltered(true)
      expect(store.selectedCount).toBe(3)   // vOff + v1 + v2

      store.toggleSelectAllFiltered(false)
      // vOff was never in the current filtered list → unaffected.
      expect(store.selectedCount).toBe(1)
      expect(store.isVideoSelected(vOff)).toBe(true)
    })

    it('clearAllSelection empties the map', () => {
      const store = useContentStore()
      const v1 = mkVideo('G1')
      const v2 = mkVideo('G2')
      store.toggleVideoSelection(v1)
      store.toggleVideoSelection(v2)
      expect(store.selectedCount).toBe(2)

      store.clearAllSelection()
      expect(store.selectedCount).toBe(0)
      expect(store.isVideoSelected(v1)).toBe(false)
    })

    it('removeVideoSelection removes only the requested cross-program item', () => {
      const store = useContentStore()
      const v1 = mkVideo('G1')
      const v2 = mkVideo('G2')
      store.toggleVideoSelection(v1)
      store.toggleVideoSelection(v2)

      store.removeVideoSelection('G1')
      expect(store.allSelectedVideos.map(v => v.guid)).toEqual(['G2'])
    })

    it('clearAllSelection is a no-op when nothing is selected', () => {
      const store = useContentStore()
      expect(() => store.clearAllSelection()).not.toThrow()
      expect(store.selectedCount).toBe(0)
    })

    it('allSelected is false when the filtered list is empty', () => {
      const store = useContentStore()
      store.videos = []
      expect(store.allSelected).toBe(false)
    })
  })
})
