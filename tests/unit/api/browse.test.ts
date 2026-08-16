import { describe, it, expect, vi } from 'vitest'
import { BrowseService, isCctvNewsSnowBookPage } from '../../../src/main/api/browse'

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

    it('reads a server-filtered month beyond 100 short pages without truncation', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('p'))
        return {
          ok: true,
          json: async () => ({ data: {
            total: 101,
            list: page <= 101
              ? [{ guid: `column-${page}`, title: `Video ${page}`, time: `2024-01-${String((page % 28) + 1).padStart(2, '0')}` }]
              : []
          } })
        }
      })

      const videos = await new BrowseService(mockFetch).getColumnVideoList('TOPC-deep', 1, '202401')

      expect(videos).toHaveLength(101)
      expect(videos.some(video => video.guid === 'column-101')).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(101)
    })

    it('rejects a repeated page before the reported month total is reached', async () => {
      const page = Array.from({ length: 100 }, (_, i) => ({
        guid: `column-${i}`, title: `Video ${i}`, time: '2024-01-01'
      }))
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { total: 150, list: page } })
      })

      await expect(new BrowseService(mockFetch).getColumnVideoList('TOPC-repeat', 1, '202401'))
        .rejects.toThrow('pagination repeated page 2')
    })

    it('prefers focus_date as the display time when present', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            list: [
              {
                guid: '773935b913f3422886bd982ebf3bcaa9',
                title: '《海峡两岸》 20260514',
                brief: 'Brief',
                image: 'https://example.com/hxla.jpg',
                time: '2026-05-14 20:30:00',
                focus_date: 1782994865121
              }
            ]
          }
        })
      })

      const service = new BrowseService(mockFetch)
      const videos = await service.getColumnVideoList('TOPC1451540328102649', 1, '202607')

      expect(videos[0].time).toBe('2026-07-02 20:21:05')
    })

    it('keeps string focus_date as the display time when present', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: {
            list: [
              {
                guid: '2ab3dd8eef8b4228bdff85656649a714',
                title: '《星月征途》 第1集',
                brief: 'Brief',
                image: 'https://example.com/xingyue.jpg',
                time: '2026-06-12 15:48:04',
                focus_date: '2026-06-12 15:50:36'
              }
            ]
          }
        })
      })

      const service = new BrowseService(mockFetch)
      const videos = await service.getColumnVideoList('TOPC1460958001056237', 1, '202606')

      expect(videos[0].time).toBe('2026-06-12 15:50:36')
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

  describe('program month bounds', () => {
    it('reads the earliest and latest months from column edges', async () => {
      const mockFetch = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: { list: url.includes('sort=desc')
          ? [{ focus_date: '2024-12-30 20:00:00' }, { time: '2024-11-01' }]
          : [{ focus_date: '2018-03-02 20:00:00' }, { time: '2018-04-01' }]
        } })
      }))

      await expect(new BrowseService(mockFetch).getColumnMonthBounds('TOPC1')).resolves.toEqual({
        earliest: '201803', latest: '202412'
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('reads the earliest and latest months from album edges', async () => {
      const mockFetch = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: { list: url.includes('sort=desc')
          ? [{ focus_date: '2019-06-16 10:00:00' }]
          : [{ focus_date: '2015-03-03 10:00:00' }]
        } })
      }))

      const service = new BrowseService(mockFetch)
      const [first, concurrent] = await Promise.all([
        service.getAlbumMonthBounds('VIDA1'),
        service.getAlbumMonthBounds('VIDA1')
      ])
      expect(first).toEqual({ earliest: '201503', latest: '201906' })
      expect(concurrent).toEqual(first)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('returns null boundaries when edge items have no usable dates', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, json: async () => ({ data: { list: [{ title: 'No date' }] } })
      })
      await expect(new BrowseService(mockFetch).getAlbumMonthBounds('VIDA1')).resolves.toEqual({
        earliest: null, latest: null
      })
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
      const videos = await service.getAlbumVideoList('album123', '202401')
      expect(videos).toHaveLength(1)
      expect(videos[0].guid).toBe('album-1')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('filters an album-backed monthly column by month and caches each month', async () => {
      const items = [
        { guid: 'march', title: 'March', time: '2015-03-24 05:10:04' },
        { guid: 'april', title: 'April', time: '2015-04-01 10:00:00' }
      ]
      const mockFetch = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: { total: 2, list: url.includes('sort=desc') ? [...items].reverse() : items } })
      }))
      const service = new BrowseService(mockFetch)

      await expect(service.getAlbumVideoList('VIDA1', '201503')).resolves.toMatchObject([{ guid: 'march' }])
      await expect(service.getAlbumVideoList('VIDA1', '201503')).resolves.toMatchObject([{ guid: 'march' }])
      await expect(service.getAlbumVideoList('VIDA1', '201504')).resolves.toMatchObject([{ guid: 'april' }])
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('chooses the nearer album edge so recent months are not lost behind the page cap', async () => {
      const mockFetch = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: { list: url.includes('sort=desc')
          ? [{ guid: 'recent', title: 'Recent', focus_date: '2019-06-16 10:00:00' }]
          : [{ guid: 'old', title: 'Old', focus_date: '2015-03-24 10:00:00' }]
        } })
      }))

      const videos = await new BrowseService(mockFetch).getAlbumVideoList('VIDA1', '201906')

      expect(videos).toMatchObject([{ guid: 'recent' }])
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('sort=desc'))).toBe(true)
    })

    it('normalizes a reverse legacy album response to chronological order', async () => {
      const reverse = [
        { guid: 'new', title: 'New', focus_date: '2019-06-16 10:00:00' },
        { guid: 'old', title: 'Old', focus_date: '2019-06-01 10:00:00' }
      ]
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { list: reverse } })
      })

      const videos = await new BrowseService(mockFetch).getAlbumVideoList('VIDA1', '201906')

      expect(videos.map(video => video.guid)).toEqual(['old', 'new'])
    })

    it('uses mode=1 as the full catalogue only when an album has no mode=0 videos', async () => {
      const mockFetch = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: { list: url.includes('mode=1')
          ? [{ guid: 'episode', title: '第1集', time: '2024-03-19 10:00:00' }]
          : [] } })
      }))
      const service = new BrowseService(mockFetch)

      await expect(service.getLatestAlbumVideos('VIDA-mode1')).resolves.toMatchObject([{ guid: 'episode' }])
      expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringContaining('mode=0'),
        expect.stringContaining('mode=1')
      ])
    })

    it('does not promote a mode=1 highlights-only catalogue to default full videos', async () => {
      const mockFetch = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ data: { list: url.includes('mode=1')
          ? [
              { guid: 'highlight-1', title: '节目看点：精彩片段' },
              { guid: 'highlight-2', title: '预告：明日内容' }
            ]
          : [] } })
      }))

      await expect(new BrowseService(mockFetch).getLatestAlbumVideos('VIDA-highlights-only'))
        .resolves.toEqual([])
    })

    it('shares one primary-mode probe across concurrent album requests', async () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const mockFetch = vi.fn(async () => {
        await gate
        return { ok: true, json: async () => ({ data: { list: [
          { guid: 'episode', title: '第1集', time: '2024-03-19 10:00:00' }
        ] } }) }
      })
      const service = new BrowseService(mockFetch)

      const first = service.getLatestAlbumVideos('VIDA-shared-probe')
      const second = service.getLatestAlbumVideos('VIDA-shared-probe')
      release()

      await expect(Promise.all([first, second])).resolves.toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('falls back to the full ascending catalogue when legacy month paging misses', async () => {
      const matching = { guid: 'legacy', title: 'Legacy', time: '2011-12-22 10:00:00' }
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { list: [
          { guid: 'old-edge', title: 'Old', time: '2010-01-01 10:00:00' }
        ] } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { list: [
          { guid: 'new-edge', title: 'New', time: '2013-01-01 10:00:00' }
        ] } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { list: [matching] } }) })
      const videos = await new BrowseService(mockFetch).getAlbumVideoList('VIDA-legacy', '201112')
      expect(videos).toMatchObject([{ guid: 'legacy' }])
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('loads every album page and deduplicates repeated videos', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ({ guid: `album-${i}`, title: `Episode ${i}`, brief: '', image: '', time: '' }))
      const secondPage = [
        { guid: 'album-99', title: 'Episode 99', brief: '', image: '', time: '' },
        { guid: 'album-100', title: 'Episode 100', brief: '', image: '', time: '' }
      ]
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { list: firstPage } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { list: secondPage } }) })
      const service = new BrowseService(mockFetch)

      const videos = await service.getAlbumVideoList('album123', '')

      expect(videos).toHaveLength(101)
      expect(videos.at(-1)?.guid).toBe('album-100')
      expect(mockFetch.mock.calls[1][0]).toContain('p=2')
    })

    it('loads an unfiltered album catalogue beyond page 100', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('p'))
        return {
          ok: true,
          json: async () => ({ data: {
            total: 101,
            list: page <= 101
              ? [{ guid: `album-${page}`, title: `Episode ${page}`, time: '2024-01-01' }]
              : []
          } })
        }
      })

      const videos = await new BrowseService(mockFetch).getAlbumVideoList('VIDA-deep', '')

      expect(videos).toHaveLength(101)
      expect(videos.some(video => video.guid === 'album-101')).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(101)
    })

    it('binary-locates an album month after page 100', async () => {
      const monthAtPage = (page: number): string => {
        const index = 2020 * 12 - (page - 1)
        return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`
      }
      const targetMonth = monthAtPage(101).replace('-', '')
      const mockFetch = vi.fn(async (url: string) => {
        const parsed = new URL(url)
        const page = Number(parsed.searchParams.get('p'))
        const desc = parsed.searchParams.get('sort') === 'desc'
        const sourcePage = desc ? page : 102 - page
        return {
          ok: true,
          json: async () => ({ data: {
            total: 101,
            list: sourcePage >= 1 && sourcePage <= 101
              ? [{ guid: `album-${sourcePage}`, title: `Episode ${sourcePage}`, focus_date: `${monthAtPage(sourcePage)}-15 12:00:00` }]
              : []
          } })
        }
      })

      const videos = await new BrowseService(mockFetch).getAlbumVideoList('VIDA-deep-month', targetMonth)

      expect(videos.map(video => video.guid)).toEqual(['album-101'])
      expect(mockFetch.mock.calls.some(([url]) => new URL(String(url)).searchParams.get('p') === '101')).toBe(true)
      expect(mockFetch.mock.calls.length).toBeLessThan(20)
    })

    it('reports the accumulated unique episode count after each page', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ({ guid: `album-${i}`, title: `Episode ${i}`, brief: '', image: '', time: '' }))
      const secondPage = [{ guid: 'album-100', title: 'Episode 100', brief: '', image: '', time: '' }]
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { list: firstPage } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { list: secondPage } }) })
      const onProgress = vi.fn()

      await new BrowseService(mockFetch).getAlbumVideoList('album123', '', 'tvcctv', onProgress)

      expect(onProgress.mock.calls[0][0]).toHaveLength(100)
      expect(onProgress.mock.calls[1][0]).toHaveLength(1)
    })

    it('stops when an upstream page repeats without adding videos', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({ guid: `g${i}`, title: `E${i}`, brief: '', image: '', time: '' }))
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { list: fullPage } }) })
      const service = new BrowseService(mockFetch)

      const videos = await service.getAlbumVideoList('album123', '')

      expect(videos).toHaveLength(100)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('returns empty array when list is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} })
      })
      const service = new BrowseService(mockFetch)
      const videos = await service.getAlbumVideoList('album123', '202401')
      expect(videos).toEqual([])
    })

    it('throws on HTTP error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      const service = new BrowseService(mockFetch)
      await expect(service.getAlbumVideoList('album123', '202401')).rejects.toThrow('HTTP 500')
    })
  })

  describe('getVideoMediaMetadata', () => {
    it('reads channel with fallback and parses len duration', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ play_channel: 'CCTV-纪录', len: '00:24:05' })
      })
      await expect(new BrowseService(mockFetch).getVideoMediaMetadata('guid')).resolves.toEqual({
        channel: 'CCTV-纪录', durationSeconds: 1445
      })
    })
  })

  describe('getLatestAlbumVideos', () => {
    it('fetches only the newest album page for background checks', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { list: [{ guid: 'newest', title: '最新一集' }] } })
      })
      const videos = await new BrowseService(mockFetch).getLatestAlbumVideos('album123', 'cctv4k')

      expect(videos).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][0]).toContain('sort=desc')
      expect(mockFetch.mock.calls[0][0]).toContain('pub=2')
    })
  })

  describe('resolveColumnInfo - additional cases', () => {
    it('routes v.cctv programme pages by their mid/chid catalogue instead of TOPC', async () => {
      const html = `<meta property="og:title" content="望海观潮"><script>
        var lm_mid = '24iQzAZ30426\\t';
        var pd_id = 'EPGC1525679284945000';
        var api = 'vapi/video/vplist.do?chid='+pd_id+'&mid='+lm_mid+'&p=1';
      </script>`
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })
      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://v.cctv.com/programme/whgc.shtml'))
        .resolves.toEqual({
          name: '望海观潮', columnId: 'vcctv:24iQzAZ30426', itemId: '24iQzAZ30426',
          kind: 'column', serviceId: 'tvcctv',
          listSource: { type: 'vcctv', id: '24iQzAZ30426', chid: 'EPGC1525679284945000', serviceId: 'tvcctv' }
        })
    })

    it('does not treat an embedded v.cctv widget on another CCTV host as the page catalogue', async () => {
      const html = `<meta property="og:title" content="普通栏目_CCTV节目官网">
        <script>var topicID = 'TOPC1234567890123';</script>
        <script>var related = 'vapi/video/vplist.do?chid=RELATED&mid=WIDGET&p=1';</script>`
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/lm/example/'))
        .resolves.toMatchObject({ name: '普通栏目', columnId: 'TOPC1234567890123', kind: 'column' })
    })

    it('routes a legacy event page with an empty TOPC to its real multi-video album', async () => {
      const html = `<title>奥运乒乓球</title><script>
        var itemid1='VIDEFXKSsL0eOPfC4Z3GqpIv160818';
        var column_id='TOPC1468147144785955';
        var guid='6860a7d7945043bba8aabea4d102c364';
      </script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: async () => html })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          title: '[奥运会]乒乓球男子团体决赛', cvid: 'VIDEFXKSsL0eOPfC4Z3GqpIv160818',
          album_id: 'VIDAJWCgstBc3Q3ADY9VIGGE160801', vset_title: '《里约奥运-乒乓球》', tnum: '0'
        }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          data: { total: 161, list: [{ guid: 'one' }, { guid: 'two' }] }
        }) })
      await expect(new BrowseService(mockFetch).resolveColumnInfo(
        'https://2016.cctv.com/2016/08/18/VIDEFXKSsL0eOPfC4Z3GqpIv160818.shtml'
      )).resolves.toMatchObject({
        name: '里约奥运-乒乓球', columnId: 'VIDAJWCgstBc3Q3ADY9VIGGE160801', kind: 'album',
        listSource: { type: 'album', id: 'VIDAJWCgstBc3Q3ADY9VIGGE160801', serviceId: 'tvcctv' }
      })
    })

    it('keeps a year-subdomain video single when its referenced album is not multi-video', async () => {
      const html = `<title>单条专题视频_CCTV节目官网</title><script>
        var itemid1='VIDEsingle'; var column_id='TOPC1234567890123'; var guid='single-guid';
      </script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: async () => html })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          title: '单条专题视频', cvid: 'VIDEsingle', album_id: 'VIDAone', vset_title: '单条专题视频', tnum: '0'
        }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { total: 1, list: [{ guid: 'only' }] } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { total: 0, list: [] } }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo(
        'https://2019.cctv.com/2019/01/01/VIDEsingle.shtml'
      )).rejects.toThrow('无法解析节目信息')
    })

    it('does not let itemguid block a regular column outside culture-travel', async () => {
      const html = `<title>常规栏目_CCTV节目官网</title><script>
        var itemguid='19e5f94bf6fe4c53b9df44d6885af4c4'; var topicID='TOPC1234567890123';
      </script>`
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/lm/regular/'))
        .resolves.toMatchObject({ name: '常规栏目', columnId: 'TOPC1234567890123', kind: 'column' })
    })

    it('uses a clip page album as the programme while retaining the clip item for optional highlights', async () => {
      const html = `<script>
        var commentTitle='[节目]精彩片段'; var itemid1='VIDEclip';
        var column_id='TOPC123'; var parentGuid='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        var guid='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      </script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: async () => html })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          title: '[节目]精彩片段', cvid: 'VIDEclip', album_id: 'VIDAfull', vset_title: '《节目》', tnum: '0'
        }) })
      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/clip.shtml'))
        .resolves.toMatchObject({ name: '节目', columnId: 'VIDAfull', itemId: 'VIDEclip', kind: 'album' })
    })

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

    it('extracts legacy column ID from lmtopId videoset pages', async () => {
      const html = `<script>var lmtopId = 'TOPC1451528971114112';</script><title>新闻联播_CCTV</title>`
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })
      const info = await new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/lm/xwlb/videoset/')
      expect(info.columnId).toBe('TOPC1451528971114112')
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

    it('resolves CCTV-4K video pages as album programs', async () => {
      const html = `<title>《跟着唐诗去旅行 第二季》 第5集 双星会_4K专区_央视网</title>
        <script>var itemid1="VIDEkLRS36ABdGAb0llIYJAR241130"; var guid = "d638c455bf834cbb851b8bf345b7ee2d"; var configType ="cctv4k";</script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: '《跟着唐诗去旅行 第二季》 第5集 双星会',
            album_id: 'VIDAjM8fGS3rvZWYKznnUUTu220708',
            vset_title: '《跟着唐诗去旅行》4K',
            cvid: 'VIDEkLRS36ABdGAb0llIYJAR241130',
            tnum: '6'
          })
        })
      const service = new BrowseService(mockFetch)

      const info = await service.resolveColumnInfo('https://tv.cctv.com/2024/11/30/VIDEkLRS36ABdGAb0llIYJAR241130.shtml')

      expect(info).toEqual({
        name: '跟着唐诗去旅行4K',
        columnId: 'VIDAjM8fGS3rvZWYKznnUUTu220708',
        itemId: 'VIDEkLRS36ABdGAb0llIYJAR241130',
        kind: 'album',
        serviceId: 'cctv4k',
        listSource: { type: 'album', id: 'VIDAjM8fGS3rvZWYKznnUUTu220708', serviceId: 'cctv4k' }
      })
    })

    it('resolves episode pages as album programs', async () => {
      const html = `<title>《星月征途》 第1集</title>
        <script>var commentTitle = "《星月征途》 第1集"; var column_id = "TOPC1460958001056237"; var itemid1="VIDElk5c6FRjXLZhcppxIHhL260612"; var guid = "2ab3dd8eef8b4228bdff85656649a714";</script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: '《星月征途》 第1集',
            album_id: 'VIDAo7h09tLB0WMqOC7e1775260609',
            vset_title: '《星月征途》',
            cvid: 'VIDElk5c6FRjXLZhcppxIHhL260612',
            tnum: '36'
          })
        })
      const service = new BrowseService(mockFetch)

      const info = await service.resolveColumnInfo('https://tv.cctv.com/2026/06/12/VIDElk5c6FRjXLZhcppxIHhL260612.shtml')

      expect(info).toEqual({
        name: '星月征途',
        columnId: 'VIDAo7h09tLB0WMqOC7e1775260609',
        itemId: 'VIDElk5c6FRjXLZhcppxIHhL260612',
        kind: 'album',
        serviceId: 'tvcctv',
        listSource: { type: 'album', id: 'VIDAo7h09tLB0WMqOC7e1775260609', serviceId: 'tvcctv' }
      })
    })

    it('recognizes an overview page with several episode links as the same album', async () => {
      const overview = `<title>《极限火力》_CCTV节目官网</title>
        <a href="/2021/10/13/VIDEeLV5WaJ6xHBNsqAeoaDe211013.shtml">第1集</a>
        <a href="/2021/10/15/VIDEVbdZluoj27TlgPZXJVlr211015.shtml">第2集</a>`
      const episode = `<script>var guid = "real-guid";</script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(overview) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(episode) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
          title: '《极限火力》 第1集', album_id: 'album-fire', vset_title: '《极限火力》',
          cvid: 'VIDEeLV5WaJ6xHBNsqAeoaDe211013', tnum: '6'
        }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/2021/10/09/VIDAlliMaCI9BiLxf3UhAGA8211009.shtml'))
        .resolves.toMatchObject({ name: '极限火力', columnId: 'album-fire', itemId: 'VIDEeLV5WaJ6xHBNsqAeoaDe211013', kind: 'album', serviceId: 'tvcctv' })
    })

    it('recognizes a tv.cctv.cn overview page through its own episode links', async () => {
      const overview = `<title>节目概览_CCTV节目官网</title>
        <a href="/2021/10/13/VIDEeLV5WaJ6xHBNsqAeoaDe211013.shtml">第1集</a>
        <a href="/2021/10/15/VIDEVbdZluoj27TlgPZXJVlr211015.shtml">第2集</a>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(overview) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(`<script>var guid = "real-guid";</script>`) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ album_id: 'album-cn', vset_title: '节目概览', cvid: 'episode-id', tnum: '2' }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.cn/2021/10/09/VIDAlliMaCI9BiLxf3UhAGA8211009.shtml'))
        .resolves.toMatchObject({ columnId: 'album-cn', kind: 'album' })
      expect(mockFetch.mock.calls[1][0]).toContain('tv.cctv.cn')
    })

    it('recognizes a jishi.cctv.com VIDA overview with changed TOPC as a monthly album-backed column', async () => {
      const overview = `<title>上海纪实《档案》_纪实台_央视网(cctv.com)</title>
        <script>var commentTitle = "上海纪实《档案》"; var column_id = "TOPC1354673616621733"; var itemid1 = "VIDA1425372752043217";</script>
        <a href="/2019/06/16/VIDE9dr4xvEdkaXlvenDzLtr190616.shtml">2019年节目</a>
        <a href="/2015/03/24/VIDE1427145150264630.shtml">2015年节目</a>`
      const episode = `<script>var guid = "real-guid"; var column_id = "TOPC1355056930229941";</script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(overview) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(episode) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
          title: '《上海纪实-档案》 20190615 第四集',
          album_id: 'VIDA1425372752043217',
          vset_title: '上海纪实《档案》',
          cvid: 'VIDE9dr4xvEdkaXlvenDzLtr190616',
          // Real legacy metadata reports 0 despite this being an album episode.
          tnum: '0'
        }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://jishi.cctv.com/2015/03/03/VIDA1425372752043217.shtml'))
        .resolves.toEqual({
          name: '上海纪实《档案》',
          columnId: 'VIDA1425372752043217',
          itemId: 'VIDA1425372752043217',
          kind: 'column',
          serviceId: 'tvcctv',
          listSource: { type: 'album', id: 'VIDA1425372752043217', serviceId: 'tvcctv' }
        })
      expect(mockFetch.mock.calls[1][0]).toBe('https://jishi.cctv.com/2019/06/16/VIDE9dr4xvEdkaXlvenDzLtr190616.shtml')
    })

    it('accepts episode links from any official legacy CCTV subdomain', async () => {
      const overview = `<title>文化十分_央视网</title>
        <a href="https://ent.cctv.com/2015/07/21/VIDEepisode1.shtml">第1期</a>
        <a href="https://ent.cctv.com/2015/07/22/VIDEepisode2.shtml">第2期</a>
        <a href="https://cctv.com.evil.example/2015/07/23/VIDEepisode3.shtml">伪装链接</a>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(overview) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<script>var guid = "episode-guid";</script>') })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
          title: '《文化十分》 第1期', album_id: 'VIDA1437462909085973',
          vset_title: '文化十分', cvid: 'VIDEepisode1', tnum: '20'
        }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://ent.cctv.com/2015/07/21/VIDA1437462909085973.shtml'))
        .resolves.toMatchObject({ columnId: 'VIDA1437462909085973', kind: 'album' })
      expect(mockFetch.mock.calls[1][0]).toBe('https://ent.cctv.com/2015/07/21/VIDEepisode1.shtml')
    })

    it('maps episodes from both sides of a TOPC change to the same monthly VIDA column', async () => {
      const oldUrl = 'https://jishi.cctv.com/2015/03/24/VIDEold.shtml'
      const newUrl = 'https://jishi.cctv.com/2019/06/16/VIDEnew.shtml'
      const mockFetch = vi.fn(async (url: string) => {
        if (url === oldUrl) return { ok: true, text: async () => '<script>var guid="old-guid"; var itemid1="VIDEold"; var column_id="TOPC-old";</script>' }
        if (url === newUrl) return { ok: true, text: async () => '<script>var guid="new-guid"; var itemid1="VIDEnew"; var column_id="TOPC-new";</script>' }
        if (url.includes('videoinfoByGuid')) return { ok: true, json: async () => ({
          title: '《上海纪实-档案》 某期', album_id: 'VIDA-shared',
          vset_title: '上海纪实《档案》', tnum: '0'
        }) }
        if (url.includes('getVideoListByAlbumIdNew') && url.includes('sort=asc')) {
          return { ok: true, json: async () => ({ data: { list: [{ url: oldUrl }] } }) }
        }
        if (url.includes('getVideoListByAlbumIdNew') && url.includes('sort=desc')) {
          return { ok: true, json: async () => ({ data: { list: [{ url: newUrl }] } }) }
        }
        throw new Error(`unexpected URL: ${url}`)
      })
      const service = new BrowseService(mockFetch)

      const newer = await service.resolveColumnInfo(newUrl)
      const older = await service.resolveColumnInfo(oldUrl)

      expect(newer).toMatchObject({
        name: '上海纪实《档案》', columnId: 'VIDA-shared', kind: 'column',
        listSource: { type: 'album', id: 'VIDA-shared', serviceId: 'tvcctv' }
      })
      expect(older).toMatchObject({ columnId: 'VIDA-shared', kind: 'column' })
      expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('sort=asc'))).toHaveLength(1)
    })

    it('does not confuse a movie page column with an album column migration', async () => {
      const movieUrl = 'https://tv.cctv.com/2026/06/12/VIDEmovie.shtml'
      const firstUrl = 'https://tv.cctv.com/2011/12/31/VIDEfirst.shtml'
      const lastUrl = 'https://tv.cctv.com/2026/07/11/VIDElast.shtml'
      const mockFetch = vi.fn(async (url: string) => {
        if (url === movieUrl) return { ok: true, text: async () => '<script>var guid="movie-guid"; var itemid1="VIDEmovie"; var column_id="TOPC-movie"; var commentTitle="电影《测试电影》";</script>' }
        if (url === firstUrl || url === lastUrl) {
          return { ok: true, text: async () => '<script>var column_id="TOPC-album";</script>' }
        }
        if (url.includes('videoinfoByGuid')) return { ok: true, json: async () => ({
          title: '电影《测试电影》', album_id: 'VIDA-schedule',
          vset_title: '动画大放映-CCTV14', cvid: 'VIDEmovie', tnum: '0'
        }) }
        if (url.includes('getVideoListByAlbumIdNew') && url.includes('sort=asc')) {
          return { ok: true, json: async () => ({ data: { list: [{ url: firstUrl }] } }) }
        }
        if (url.includes('getVideoListByAlbumIdNew') && url.includes('sort=desc')) {
          return { ok: true, json: async () => ({ data: { list: [{ url: lastUrl }] } }) }
        }
        throw new Error(`unexpected URL: ${url}`)
      })

      await expect(new BrowseService(mockFetch).resolveColumnInfo(movieUrl)).resolves.toEqual({
        name: '测试电影',
        columnId: 'TOPC-movie',
        itemId: 'VIDEmovie',
        kind: 'column',
        serviceId: 'tvcctv',
        listSource: { type: 'column', id: 'TOPC-movie', serviceId: 'tvcctv' }
      })
    })

    it('keeps dated program pages as column programs even when metadata has album_id', async () => {
      const html = `<title>《解码科技史》 20260701 筑基苍穹</title>
        <script>var commentTitle = "《解码科技史》 20260701 筑基苍穹"; var column_id = "TOPC1570876640457386"; var itemid1="VIDEgkpWAAVCNkSdEnYSK5GO260702"; var guid = "3a922317e4fe47379c3b5e9efd746562";</script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: '《解码科技史》 20260701 筑基苍穹',
            album_id: 'VIDAAlajJpqBqqF4vjvuAyHS191015',
            vset_title: '解码科技史',
            cvid: 'VIDEgkpWAAVCNkSdEnYSK5GO260702',
            tnum: '0'
          })
        })
      const service = new BrowseService(mockFetch)

      const info = await service.resolveColumnInfo('https://tv.cctv.com/2026/07/02/VIDEgkpWAAVCNkSdEnYSK5GO260702.shtml')

      expect(info).toEqual({
        name: '解码科技史',
        columnId: 'TOPC1570876640457386',
        itemId: 'VIDEgkpWAAVCNkSdEnYSK5GO260702',
        kind: 'column',
        serviceId: 'tvcctv',
        listSource: { type: 'column', id: 'TOPC1570876640457386', serviceId: 'tvcctv' }
      })
    })

    it('keeps [视频] editorial segments as single-video imports instead of the parent TOPC', async () => {
      const html = `<title>[视频] 独立新闻报道</title><script>
        var commentTitle = "[视频] 独立新闻报道";
        var column_id = "TOPC1451528971114112";
        var itemid1 = "OTHER";
        var guid = "segment-guid";
      </script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
          title: '[视频] 独立新闻报道', album_id: 'VIDA-parent', vset_title: '新闻联播', tnum: '0'
        }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/segment.shtml'))
        .rejects.toThrow('无法解析节目信息')
    })

    it('forces an explicit VIDA overview to its album when the representative episode has tnum=0', async () => {
      const overview = `<title>合集页</title><script>
        var itemid1 = "VIDAoverview"; var column_id = "TOPC1";
      </script>
      <a href="https://tv.cctv.com/VIDEepisodeOne.shtml">1</a>
      <a href="https://tv.cctv.com/VIDEepisodeTwo.shtml">2</a>`
      const episode = `<script>var guid = "episode-guid"; var column_id = "TOPC1";</script>`
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(overview) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(episode) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
          album_id: 'VIDAoverview', vset_title: '合集页', cvid: 'VIDEepisode', tnum: '0'
        }) })

      await expect(new BrowseService(mockFetch).resolveColumnInfo('https://tv.cctv.com/overview.shtml'))
        .resolves.toMatchObject({
          kind: 'album', columnId: 'VIDAoverview',
          listSource: { type: 'album', id: 'VIDAoverview' }
        })
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

    it('rejects clip video pages so they fall back to single-video import', async () => {
      const html = `
        <title>[海峡两岸]郑丽文启程访美 岛内有何忠告？</title>
        <script>
          var commentTitle = "[海峡两岸]郑丽文启程访美 岛内有何忠告？";
          var column_id = "TOPC1451540328102649";
          var itemid1 = "VIDEWlCudM1meuAyGrF6c2Ba260601";
          var parentGuid = "cb6c6d3309f343d5b42af9a1dca9c46e";
          var guid = "6782ab8382cd4307923de0e47b8f4808";
        </script>
      `
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)

      await expect(service.resolveColumnInfo('https://tv.cctv.cn/2026/06/01/VIDEWlCudM1meuAyGrF6c2Ba260601.shtml'))
        .rejects.toThrow('无法解析节目信息')
    })

    it('rejects old guide clip pages so they fall back to single-video import', async () => {
      const html = `<title>[创新进行时]《养“鱼”神器》导视_CCTV节目官网-CCTV-10</title>
        <script>
          var commentTitle = "[创新进行时]《养“鱼”神器》导视";
          var column_id = "TOPC1570875218228998";
          var itemid1="VIDEDvCPMR7rm10QI5chA4In191116";
          var guid = "04165fc7a85cc5d2aab930f2381bab6e";
        </script>`
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true, text: () => Promise.resolve(html)
      })
      const service = new BrowseService(mockFetch)

      await expect(service.resolveColumnInfo('https://tv.cctv.com/2019/11/16/VIDEDvCPMR7rm10QI5chA4In191116.shtml'))
        .rejects.toThrow('无法解析节目信息')
    })
  })

  describe('v.cctv and supplementary lists', () => {
    it('paginates v.cctv results even when the server returns fewer than the requested 100 items', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 3, data: [
          { guid: 'new', title: '新', pubTime: '2026-07-02 12:00:00', vduration: '00:02:00', mediaName: 'CCTV' },
          { guid: 'middle', title: '中', pubTime: '2026-07-01 12:00:00', vduration: 60 }
        ] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 3, data: [
          { guid: 'old', title: '旧', pubTime: '2026-06-30 12:00:00' }
        ] }) })
      const videos = await new BrowseService(mockFetch).getVcctvVideoList('mid', 'chid', '')
      expect(videos.map(video => video.guid)).toEqual(['old', 'middle', 'new'])
      expect(videos[2]).toMatchObject({ channel: 'CCTV', durationSeconds: 120 })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('binary-locates a v.cctv month after page 100', async () => {
      const monthAtPage = (page: number): string => {
        const index = 2020 * 12 - (page - 1)
        return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`
      }
      const targetMonth = monthAtPage(101).replace('-', '')
      const mockFetch = vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('p'))
        return {
          ok: true,
          json: async () => ({
            count: 101,
            data: page >= 1 && page <= 101
              ? [{ guid: `vcctv-${page}`, title: `Video ${page}`, pubTime: `${monthAtPage(page)}-15 12:00:00` }]
              : []
          })
        }
      })

      const videos = await new BrowseService(mockFetch).getVcctvVideoList('mid', 'chid', targetMonth)

      expect(videos.map(video => video.guid)).toEqual(['vcctv-101'])
      expect(mockFetch.mock.calls.length).toBeLessThan(15)
    })

    it('falls back to a complete v.cctv scan when a page is not newest-first', async () => {
      const pages = [
        [
          { guid: 'older-on-first', title: 'Older', pubTime: '2024-01-01 10:00:00' },
          { guid: 'newer-on-first', title: 'Newer', pubTime: '2024-02-01 10:00:00' }
        ],
        [{ guid: 'target', title: 'Target', pubTime: '2023-12-15 10:00:00' }]
      ]
      const mockFetch = vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('p'))
        return { ok: true, json: async () => ({ count: 3, data: pages[page - 1] ?? [] }) }
      })

      const videos = await new BrowseService(mockFetch).getVcctvVideoList('mid', 'chid', '202312')

      expect(videos.map(video => video.guid)).toEqual(['target'])
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('binary-locates monthly highlights through the album mode=1 pages', async () => {
      const monthAtPage = (page: number): string => {
        const index = 2020 * 12 - (page - 1)
        return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`
      }
      const targetMonth = monthAtPage(101).replace('-', '')
      const mockFetch = vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('p'))
        return {
          ok: true,
          json: async () => ({ data: {
            total: 101,
            list: page >= 1 && page <= 101
              ? [{ guid: `highlight-${page}`, title: `Highlight ${page}`, focus_date: `${monthAtPage(page)}-15 12:00:00` }]
              : []
          } })
        }
      })

      const videos = await new BrowseService(mockFetch).getSupplementaryVideos({
        name: 'Program', columnId: 'VIDA-deep', itemId: '', kind: 'album',
        listSource: { type: 'album', id: 'VIDA-deep', serviceId: 'tvcctv' }
      }, targetMonth)

      expect(videos.map(video => video.guid)).toEqual(['highlight-101'])
      expect(videos[0].contentType).toBe('highlight')
      expect(mockFetch.mock.calls.length).toBeLessThan(15)
    })

    it('labels and deduplicates optional highlights and topic fragments', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('getVideoListByAlbumIdNew')) return { ok: true, json: async () => ({ data: {
          total: 2, list: [
            { guid: 'highlight', title: '看点', time: '2026-08-03 10:00:00' },
            { guid: 'duplicate', title: '重复', time: '2026-08-03 11:00:00' }
          ]
        } }) }
        return { ok: true, json: async () => ({ data: [
          { guid: 'duplicate', video_title: '重复片段' },
          { guid: 'fragment', video_title: '片段', video_key_frame_url: 'fragment.jpg', video_shared_code: '2026-08-03' }
        ] }) }
      })
      const videos = await new BrowseService(mockFetch).getSupplementaryVideos({
        name: '节目', columnId: 'TOPC1', itemId: 'VIDE1', kind: 'album',
        listSource: { type: 'album', id: 'VIDA1', serviceId: 'tvcctv' }
      })
      expect(videos.map(video => [video.guid, video.contentType])).toEqual([
        ['fragment', 'fragment'], ['highlight', 'highlight'], ['duplicate', 'highlight']
      ])
    })

    it('uses cctv4k service parameters when loading optional highlights', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { total: 1, list: [{ guid: '4k-highlight', title: '4K 看点' }] } })
      })

      await new BrowseService(mockFetch).getSupplementaryVideos({
        name: '4K 节目', columnId: 'VIDA4K', itemId: 'VIDE4K', topicId: 'TOPC4K', kind: 'album', serviceId: 'cctv4k',
        listSource: { type: 'album', id: 'VIDA4K', serviceId: 'cctv4k' }
      })

      const urls = mockFetch.mock.calls.map(([url]) => String(url))
      const albumRequest = new URL(urls.find(url => url.includes('getVideoListByAlbumIdNew'))!)
      const topicRequest = new URL(urls.find(url => url.includes('getVideoListByTopicIdInfo'))!)
      expect(albumRequest.searchParams.get('serviceId')).toBe('cctv4k')
      expect(albumRequest.searchParams.get('pub')).toBe('2')
      expect(topicRequest.searchParams.get('serviceId')).toBe('cctv4k')
    })

    it('does not probe unsupported supplementary content for v.cctv catalogues', async () => {
      const mockFetch = vi.fn()
      const videos = await new BrowseService(mockFetch).getSupplementaryVideos({
        name: 'v.cctv 节目', columnId: 'vcctv:mid', itemId: 'mid', kind: 'column',
        listSource: { type: 'vcctv', id: 'mid', chid: 'chid', serviceId: 'tvcctv' }
      })
      expect(videos).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('resolveSingleVideo', () => {
    // First fetch = page HTML; second fetch = getHttpVideoInfo (returns empty image/brief
    // so existing assertions still hold — real cover/brief tested in e2e)
    const fetchHtml = (html: string) =>
      vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ image: '', brief: '' }) })

    it('uses var guid from HTML even when URL contains a VIDE token', async () => {
      // Real pages: URL contains CMS content ID (VIDE...), HTML has actual playable guid
      const html = '<title>电影名_CCTV</title><script>var guid = "73dfb7e8070247d7acb90016a365c9e6";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEfgJBdxtUMoAkH5c89ZYZ260612.shtml')
      expect(v.guid).toBe('73dfb7e8070247d7acb90016a365c9e6')
    })

    it('routes culture/travel itemguid pages to a single video even with a TOPC id', async () => {
      const html = `<script>
        var commentTitle = '《二十四节气七十二候》系列高清视频：冬至';
        var itemid1 = 'VIDEvVu5prXSM14Y8yQk6aiq241221';
        var itemguid = '19e5f94bf6fe4c53b9df44d6885af4c4';
        var column_id = 'TOPC1606206918061828';
      </script>`
      const pageUrl = 'https://culture-travel.cctv.com/2024/12/21/VIDEvVu5prXSM14Y8yQk6aiq241221.shtml'
      const columnService = new BrowseService(vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) }))
      await expect(columnService.resolveColumnInfo(pageUrl)).rejects.toThrow('无法解析节目信息')

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
          vid: '19e5f94bf6fe4c53b9df44d6885af4c4', title: '冬至', len: '00:06:17', channel: 'CCTV-文化'
        }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      const video = await new BrowseService(mockFetch).resolveSingleVideo(pageUrl)
      expect(video.guid).toBe('19e5f94bf6fe4c53b9df44d6885af4c4')
      expect(video.durationSeconds).toBe(377)
      expect(video.channel).toBe('CCTV-文化')
    })

    it('does not treat itemguid as authoritative when videotvCodes marks an album page', async () => {
      const html = `<script>
        var itemguid = '19e5f94bf6fe4c53b9df44d6885af4c4';
        var videotvCodes = 'VIDA123';
      </script>`
      const service = new BrowseService(fetchHtml(html))
      await expect(service.resolveSingleVideo('https://tv.cctv.com/x.shtml')).rejects.toThrow('无法解析视频信息')
    })

    it('uses var guid when URL has no VIDE token', async () => {
      const html = '<title>电影名_央视网</title><script>var guid = "VIDEfallback999";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/somepage.shtml')
      expect(v.guid).toBe('VIDEfallback999')
      expect(v.title).toBe('电影名')
    })

    it('uses video metadata title and full display time for TV single videos', async () => {
      const html = '<title>页面标题_CCTV</title><script>var guid = "04165fc7a85cc5d2aab930f2381bab6e";</script>'
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: '[创新进行时]《养“鱼”神器》导视',
            brief: '[创新进行时]《养“鱼”神器》导视',
            img: 'https://p1.img.cctvpic.com/fmspic/2019/11/16/04165fc7a85cc5d2aab930f2381bab6e-1.jpg',
            time: '2019-11-16 17:46:03'
          })
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ image: '', brief: '' }) })
      const service = new BrowseService(mockFetch)

      const v = await service.resolveSingleVideo('https://tv.cctv.com/2019/11/16/VIDEDvCPMR7rm10QI5chA4In191116.shtml')

      expect(v.title).toBe('[创新进行时]《养“鱼”神器》导视')
      expect(v.time).toBe('2019-11-16 17:46:03')
      expect(v.coverUrl).toBe('https://p1.img.cctvpic.com/fmspic/2019/11/16/04165fc7a85cc5d2aab930f2381bab6e-1.jpg')
    })

    it('preserves the parsed title for clip video pages', async () => {
      const html = `
        <title>[海峡两岸]郑丽文启程访美 岛内有何忠告？</title>
        <script>
          var commentTitle = "[海峡两岸]郑丽文启程访美 岛内有何忠告？";
          var column_id = "TOPC1451540328102649";
          var itemid1 = "VIDEWlCudM1meuAyGrF6c2Ba260601";
          var parentGuid = "cb6c6d3309f343d5b42af9a1dca9c46e";
          var guid = "6782ab8382cd4307923de0e47b8f4808";
        </script>
      `
      const service = new BrowseService(fetchHtml(html))

      const v = await service.resolveSingleVideo('https://tv.cctv.cn/2026/06/01/VIDEWlCudM1meuAyGrF6c2Ba260601.shtml')

      expect(v.guid).toBe('6782ab8382cd4307923de0e47b8f4808')
      expect(v.title).toBe('[海峡两岸]郑丽文启程访美 岛内有何忠告？')
      expect(v.time).toBe('2026-06-01')
    })

    it('extracts cover from og:image meta', async () => {
      const html = '<meta property="og:image" content="https://img.cctv.com/c.jpg"><title>片名_CCTV节目官网</title><script>var guid = "test000000000000000000000000101";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEcover260612.shtml')
      expect(v.coverUrl).toBe('https://img.cctv.com/c.jpg')
    })

    it('extracts cover when content attr comes before property attr', async () => {
      const html = '<meta content="https://img.cctv.com/rev.jpg" property="og:image"><title>片名_CCTV</title><script>var guid = "test000000000000000000000000102";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDErevattr260612.shtml')
      expect(v.coverUrl).toBe('https://img.cctv.com/rev.jpg')
    })

    it('extracts brief from og:description meta', async () => {
      const html = '<meta property="og:description" content="这是一段测试简介文字"><title>测试片名_CCTV</title><script>var guid = "test000000000000000000000000001";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEtest-ogdesc260612.shtml')
      expect(v.brief).toBe('这是一段测试简介文字')
    })

    it('extracts brief from name=description meta', async () => {
      const html = '<meta name="description" content="这是另一段测试简介文字"><title>测试片名乙_CCTV</title><script>var guid = "test000000000000000000000000002";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEtest-namedesc260612.shtml')
      expect(v.brief).toBe('这是另一段测试简介文字')
    })

    it('prepends https: for protocol-relative og:image URL', async () => {
      const html = '<meta property="og:image" content="//p4.img.cctvpic.com/photo.jpg"><title>片名_CCTV</title><script>var guid = "test000000000000000000000000103";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEproto260612.shtml')
      expect(v.coverUrl).toBe('https://p4.img.cctvpic.com/photo.jpg')
    })

    it('extracts brief from unquoted name=description meta (real CCTV format)', async () => {
      const html = '<meta name=description content="该片讲述了小猪妖的故事。"><title>浪浪山_CCTV</title><script>var guid = "test000000000000000000000000104";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEunquoted260612.shtml')
      expect(v.brief).toContain('小猪妖')
    })

    it('returns empty brief when no description meta found', async () => {
      const html = '<title>片名_CCTV节目官网</title><script>var guid = "test000000000000000000000000105";</script>'
      const service = new BrowseService(fetchHtml(html))
      const v = await service.resolveSingleVideo('https://tv.cctv.com/2026/06/12/VIDEnobriefXY260612.shtml')
      expect(v.brief).toBe('')
    })

    it('uses 未命名视频 when no title and throws when no guid', async () => {
      const withGuidNoTitle = new BrowseService(fetchHtml('<script>var guid = "VIDExyz";</script>'))
      expect((await withGuidNoTitle.resolveSingleVideo('https://tv.cctv.com/x.shtml')).title).toBe('未命名视频')

      const noGuid = new BrowseService(fetchHtml('<html>nothing</html>'))
      await expect(noGuid.resolveSingleVideo('https://tv.cctv.com/x.shtml')).rejects.toThrow('无法解析视频信息')
    })

    it('resolves news article page via videoCenterId metadata lookup', async () => {
      const pageUrl = 'https://news.cctv.cn/2026/06/28/ARTIjYR3vK99sMNjxITajoyS260628.shtml'
      const html = `
        <html>
          <title>央视新闻文章页</title>
          <script>
            var playerParas = {
              videoCenterId: "6ef3fbbea4924a0a87a8cb12b76cc109",
              videoId: "VIDEOKiskwnhFAi08Xhw7CLN260628"
            };
          </script>
        </html>
      `
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            vid: '6ef3fbbea4924a0a87a8cb12b76cc109',
            title: '星火成炬 沃野新篇｜村里来了个年轻人',
            brief: '星火成炬 沃野新篇｜村里来了个年轻人',
            img: 'https://p5.img.cntv.cn/fmspic/2026/06/28/6ef3fbbea4924a0a87a8cb12b76cc109-1.png',
            time: '2026-06-28 17:45:30'
          })
        })
      const service = new BrowseService(mockFetch)

      const v = await service.resolveSingleVideo(pageUrl)

      expect(v).toEqual({
        guid: '6ef3fbbea4924a0a87a8cb12b76cc109',
        title: '星火成炬 沃野新篇｜村里来了个年轻人',
        brief: '星火成炬 沃野新篇｜村里来了个年轻人',
        coverUrl: 'https://p5.img.cntv.cn/fmspic/2026/06/28/6ef3fbbea4924a0a87a8cb12b76cc109-1.png',
        time: '2026-06-28 17:45:30'
      })
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'https://zy.api.cntv.cn/video/videoinfoByGuid?serviceId=tvcctv&guid=6ef3fbbea4924a0a87a8cb12b76cc109',
        expect.any(Object)
      )
    })

    it('uses videoCenterId when news metadata has no vid', async () => {
      const html = '<script>var playerParas = { videoCenterId: "6ef3fbbea4924a0a87a8cb12b76cc109" };</script>'
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: '新闻文章视频',
            img: '//p5.img.cntv.cn/news.jpg',
            time: ''
          })
        })
      const service = new BrowseService(mockFetch)

      const v = await service.resolveSingleVideo('https://news.cctv.cn/2026/06/28/ARTIjYR3vK99sMNjxITajoyS260628.shtml')

      expect(v.guid).toBe('6ef3fbbea4924a0a87a8cb12b76cc109')
      expect(v.coverUrl).toBe('https://p5.img.cntv.cn/news.jpg')
      expect(v.time).toBe('2026-06-28')
    })

    it('rejects news article page when videoCenterId is missing', async () => {
      const service = new BrowseService(vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><title>新闻文章页</title></html>')
      }))

      await expect(service.resolveSingleVideo('https://news.cctv.cn/2026/06/28/ARTIjYR3vK99sMNjxITajoyS260628.shtml'))
        .rejects.toThrow('无法解析视频信息')
    })
  })

  describe('cctvnews snow-book routing', () => {
    it('isCctvNewsSnowBookPage matches content-static subdomain with item_id', () => {
      expect(isCctvNewsSnowBookPage('https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=123')).toBe(true)
      expect(isCctvNewsSnowBookPage('https://cctvnews.cctv.com/snow-book/index.html?item_id=456&foo=bar')).toBe(true)
    })
    it('isCctvNewsSnowBookPage rejects other domains or missing item_id', () => {
      expect(isCctvNewsSnowBookPage('https://news.cctv.com/2026/07/04/ARTIabc.shtml')).toBe(false)
      expect(isCctvNewsSnowBookPage('https://content-static.cctvnews.cctv.com/snow-book/video.html')).toBe(false)
      expect(isCctvNewsSnowBookPage('https://tv.cctv.com/lm/xwlb/')).toBe(false)
    })

    it('resolveSingleVideoBatch dispatches cctvnews URLs to the injected service', async () => {
      const fakeVideos = [
        { guid: 'cctvnews_X_0', title: 'V1', brief: '', coverUrl: '', time: '', m3u8Url: 'https://res/a.m3u8' },
        { guid: 'cctvnews_X_1', title: 'V2', brief: '', coverUrl: '', time: '', m3u8Url: 'https://res/b.m3u8' }
      ]
      const mockCctvNews = { resolveFromUrl: vi.fn().mockResolvedValue(fakeVideos) } as unknown as import('../../../src/main/api/cctvnews').CctvNewsService
      const mockFetch = vi.fn()  // must NOT be called for cctvnews URLs
      const service = new BrowseService(mockFetch, mockCctvNews)

      const result = await service.resolveSingleVideoBatch('https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=X')

      expect(mockCctvNews.resolveFromUrl).toHaveBeenCalledWith(
        'https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=X',
        'auto'
      )
      expect(result).toEqual(fakeVideos)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('resolveSingleVideoBatch forwards quality tier to the cctvnews service', async () => {
      const mockCctvNews = { resolveFromUrl: vi.fn().mockResolvedValue([]) } as unknown as import('../../../src/main/api/cctvnews').CctvNewsService
      const service = new BrowseService(vi.fn(), mockCctvNews)
      await service.resolveSingleVideoBatch('https://cctvnews.cctv.com/?item_id=X', 'gaoqing')
      expect(mockCctvNews.resolveFromUrl).toHaveBeenCalledWith(expect.stringContaining('item_id=X'), 'gaoqing')
    })

    it('resolveSingleVideoBatch wraps non-cctvnews URLs in a single-element array', async () => {
      const html = '<title>电影名_CCTV</title><script>var guid = "73dfb7e8070247d7acb90016a365c9e6";</script>'
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ image: '', brief: '' }) })
      const mockCctvNews = { resolveFromUrl: vi.fn() } as unknown as import('../../../src/main/api/cctvnews').CctvNewsService
      const service = new BrowseService(mockFetch, mockCctvNews)

      const result = await service.resolveSingleVideoBatch('https://tv.cctv.com/2026/06/12/VIDExxx.shtml')

      expect(mockCctvNews.resolveFromUrl).not.toHaveBeenCalled()
      expect(result).toHaveLength(1)
      expect(result[0].guid).toBe('73dfb7e8070247d7acb90016a365c9e6')
    })
  })
})
