import { describe, it, expect, vi } from 'vitest'
import { BrowseService, cleanBrief } from '../../../src/main/api/browse'

describe('cleanBrief', () => {
  it('returns empty string for empty input', () => {
    expect(cleanBrief('')).toBe('')
  })

  it('normalises \\r\\n and \\r to \\n without touching spaces', () => {
    // Spaces in Chinese text must be preserved as-is
    expect(cleanBrief('Hello World\r\nTest')).toBe('Hello World\nTest')
    expect(cleanBrief('Hello\rWorld')).toBe('Hello\nWorld')
  })

  it('strips 本期节目主要内容： prefix', () => {
    expect(cleanBrief('本期节目主要内容：actual content')).toBe('actual content')
    expect(cleanBrief('本期节目主要内容:actual content')).toBe('actual content')
    expect(cleanBrief('主要内容：actual content')).toBe('actual content')
  })

  it('strips trailing attribution block （《栏目名》…）', () => {
    const raw = '正文内容。（《世界战史》\n20260619\n突袭雷达站）'
    expect(cleanBrief(raw)).toBe('正文内容。')
  })

  it('strips trailing attribution even when title contains nested parentheses', () => {
    // Real-world: "3D打印...试用。 （《创新进行时》 20260619 建房新妙招（一））"
    const raw = '3D打印房屋结构牢固，现场用工少，已经开始在低层建筑、特色场馆、应急用房等场景落地试用。 （《创新进行时》 20260619 建房新妙招（一））'
    const result = cleanBrief(raw)
    expect(result).toBe('3D打印房屋结构牢固，现场用工少，已经开始在低层建筑、特色场馆、应急用房等场景落地试用。')
    expect(result).not.toContain('《创新进行时》')
    expect(result).not.toContain('（一）')
  })

  it('handles full CCTV brief format', () => {
    const raw = '本期节目主要内容：1942年2月27日，英军伞兵执行任务。（《世界战史》\r\n20260619\r\n突袭雷达站）'
    const result = cleanBrief(raw)
    expect(result).toBe('1942年2月27日，英军伞兵执行任务。')
    // must NOT have prefix
    expect(result).not.toContain('本期节目')
    // must NOT have attribution
    expect(result).not.toContain('《世界战史》')
  })

  it('preserves internal spaces in Chinese text', () => {
    const raw = '本期节目主要内容：内容 A 内容 B'
    expect(cleanBrief(raw)).toBe('内容 A 内容 B')
  })

  it('collapses 3+ consecutive newlines to 2', () => {
    expect(cleanBrief('A\n\n\nB')).toBe('A\n\nB')
    expect(cleanBrief('A\n\n\n\nB')).toBe('A\n\nB')
  })

  it('trims leading and trailing whitespace', () => {
    expect(cleanBrief('  content  ')).toBe('content')
  })

  it('leaves Unicode line separators as-is (pre-line CSS handles them)', () => {
    const raw = 'A\u2028B\u2029C'
    const result = cleanBrief(raw)
    // Should not crash, and content should be preserved
    expect(result).toContain('A')
    expect(result).toContain('B')
    expect(result).toContain('C')
  })
})

describe('BrowseService', () => {
  describe('getColumnVideoList', () => {
    it('fetches and parses column video list', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            list: [
              {
                guid: 'abc123',
                title: 'Video 1',
                brief: 'Brief 1',
                image: 'https://example.com/1.jpg',
                time: '2024-01-01'
              },
              {
                guid: 'def456',
                title: 'Video 2',
                brief: 'Brief 2',
                image: 'https://example.com/2.jpg',
                time: '2024-01-02'
              }
            ]
          }
        })
      })

      const service = new BrowseService(mockFetch)
      const videos = await service.getColumnVideoList('col1', 1, '202401')

      expect(videos).toHaveLength(2)
      expect(videos[0].guid).toBe('abc123')
      expect(videos[0].title).toBe('Video 1')
      expect(videos[0].brief).toBe('Brief 1')
      expect(videos[1].guid).toBe('def456')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when list is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} })
      })

      const service = new BrowseService(mockFetch)
      const videos = await service.getColumnVideoList('col1', 1, '202401')

      expect(videos).toEqual([])
    })

    it('throws error on HTTP failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      })

      const service = new BrowseService(mockFetch)
      await expect(service.getColumnVideoList('col1', 1, '202401')).rejects.toThrow('HTTP 500')
    })
  })

  describe('resolveColumnInfo', () => {
    it('extracts program info from page HTML', async () => {
      const html = `
        <html>
          <script>var commentTitle = "新闻联播";</script>
          <script>var column_id = "col123";</script>
          <script>var itemid1 = "item456";</script>
        </html>
      `
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html)
      })

      const service = new BrowseService(mockFetch)
      const info = await service.resolveColumnInfo('https://tv.cctv.com/lm/xwlb/')

      expect(info.name).toBe('新闻联播')
      expect(info.columnId).toBe('col123')
      expect(info.itemId).toBe('item456')
    })

    it('handles missing itemid1', async () => {
      const html = `
        <script>var commentTitle = "Test";</script>
        <script>var column_id = "col1";</script>
      `
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html)
      })

      const service = new BrowseService(mockFetch)
      const info = await service.resolveColumnInfo('https://example.com')

      expect(info.name).toBe('Test')
      expect(info.columnId).toBe('col1')
      expect(info.itemId).toBe('')
    })

    it('throws error when required fields missing', async () => {
      const html = '<html>No program info here</html>'
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html)
      })

      const service = new BrowseService(mockFetch)
      await expect(service.resolveColumnInfo('https://example.com')).rejects.toThrow('无法解析节目信息')
    })
  })

  describe('getAlbumVideoList', () => {
    it('fetches and parses album video list', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            list: [
              { guid: 'album-1', title: 'Album Video 1', brief: 'Brief A', image: 'img1.jpg', time: '2024-01-01' }
            ]
          }
        })
      })
      const service = new BrowseService(mockFetch)
      const videos = await service.getAlbumVideoList('album123', 1, '202401')
      expect(videos).toHaveLength(1)
      expect(videos[0].guid).toBe('album-1')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when list is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} })
      })
      const service = new BrowseService(mockFetch)
      const videos = await service.getAlbumVideoList('album123', 1, '202401')
      expect(videos).toEqual([])
    })

    it('throws on HTTP error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      const service = new BrowseService(mockFetch)
      await expect(service.getAlbumVideoList('album123', 1, '202401')).rejects.toThrow('HTTP 500')
    })
  })

  describe('resolveColumnInfo - additional cases', () => {
    it('extracts column ID from topicID (column homepage)', async () => {
      const html = `<script>var topicID = 'TOPC1564110396694880';</script>
        <title>世界战史_CCTV节目官网</title>`
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)
      const info = await service.resolveColumnInfo('https://tv.cctv.com/lm/sjzs/')
      expect(info.columnId).toBe('TOPC1564110396694880')
      expect(info.name).toBe('世界战史')
    })

    it('extracts column name from 《》 in commentTitle', async () => {
      const html = `<script>var commentTitle = "《我爱发明》 20191010 沟渠美容师";</script>
        <script>var column_id = "TOPC1451557970755294";</script>`
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)
      const info = await service.resolveColumnInfo('https://tv.cctv.com/2019/10/10/VIDE.shtml')
      expect(info.name).toBe('我爱发明')
      expect(info.columnId).toBe('TOPC1451557970755294')
    })

    it('cleans title tag suffixes', async () => {
      const html = `<title>新闻联播_CCTV节目官网-CCTV-1_央视网(cctv.com)</title>
        <script>var topicID = 'TOPC1451557970755294';</script>`
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)
      const info = await service.resolveColumnInfo('https://tv.cctv.com/lm/xwlb/')
      expect(info.name).toBe('新闻联播')
    })

    it('extracts itemId from page', async () => {
      const html = `<script>var commentTitle = "《测试》 20240101";</script>
        <script>var column_id = "TOPC123";</script>
        <script>var itemid1 = "VIDE123456";</script>`
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)
      const info = await service.resolveColumnInfo('https://tv.cctv.com/test')
      expect(info.itemId).toBe('VIDE123456')
    })

    it('rejects special columns with a name but no column_id/topicID (no URL-slug fallback)', async () => {
      // 等着我-style microsite: a messy <title> resolves a name, but none of the
      // standard column vars exist. Without the old slug fallback, columnId stays
      // empty so we reject instead of importing a zombie column.
      const html = `<title>等着我官网_CCTV等着我栏目唯一官方平台 寻亲报名_CCTV节目官网-CCTV</title>`
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)
      await expect(service.resolveColumnInfo('https://tv.cctv.com/lm/dzw/index.shtml'))
        .rejects.toThrow('无法解析节目信息')
    })
  })
})
