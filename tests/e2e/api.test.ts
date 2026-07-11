/**
 * E2E: CCTV API smoke test — guards against upstream endpoint/signing
 * drift that would silently break scraping. Requires network access.
 *
 * Run: npm run test:e2e
 */
import { describe, it, expect } from 'vitest'
import { CctvApiService } from '../../src/main/api/cctv'
import { BrowseService } from '../../src/main/api/browse'

describe('CCTV API smoke', () => {
  const browse = new BrowseService()
  const api = new CctvApiService()

  it('resolves a column, lists videos, and resolves segment URLs', async () => {
    // 新闻联播 column home page
    const info = await browse.resolveColumnInfo('https://tv.cctv.com/lm/xwlb/index.shtml')
    expect(info.columnId).toBeTruthy()
    expect(info.name).toBeTruthy()

    // Recent month list
    const now = new Date()
    const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    let videos = await browse.getColumnVideoList(info.columnId, 1, month)
    if (!videos.length) {
      // fall back to previous month if the current one is empty
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const pmonth = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}`
      videos = await browse.getColumnVideoList(info.columnId, 1, pmonth)
    }
    expect(videos.length).toBeGreaterThan(0)
    expect(videos[0].guid).toBeTruthy()

    // Resolve playable stream for the first video (low quality for speed)
    const r = await api.resolveSegmentUrls(videos[0].guid, 'liuchang')
    expect(r.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)

  it('resolveSingleVideo: extracts guid, title, coverUrl and brief from real movie page', async () => {
    const url = 'https://tv.cctv.com/2026/06/12/VIDEfgJBdxtUMoAkH5c89ZYZ260612.shtml'
    const v = await browse.resolveSingleVideo(url)

    // HTML var guid takes precedence over URL VIDE token
    expect(v.guid).toBe('73dfb7e8070247d7acb90016a365c9e6')
    expect(v.title).toBeTruthy()
    expect(v.title).not.toBe('未命名视频')
    // coverUrl is the real episode thumbnail from getHttpVideoInfo (fmspic), not the
    // generic og:image placeholder (/photoAlbum/page/performance/...)
    expect(v.coverUrl).toMatch(/^https:\/\//)
    expect(v.coverUrl).not.toContain('photoAlbum/page/performance')
    // brief extracted from og:description or name=description
    expect(v.brief.length).toBeGreaterThan(10)
    // full display time from videoinfoByGuid metadata
    expect(v.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    // Confirm the resolved guid is downloadable
    const r = await new CctvApiService().resolveSegmentUrls(v.guid, 'liuchang')
    expect(r.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)

  it('resolveSingleVideo: resolves real news article page and its downloadable stream', async () => {
    const url = 'https://news.cctv.cn/2026/06/28/ARTIjYR3vK99sMNjxITajoyS260628.shtml'
    const v = await browse.resolveSingleVideo(url)

    expect(v.guid).toBe('6ef3fbbea4924a0a87a8cb12b76cc109')
    expect(v.title).toBe('星火成炬 沃野新篇｜村里来了个年轻人')
    expect(v.coverUrl).toMatch(/^https:\/\//)
    expect(v.brief.length).toBeGreaterThan(10)
    expect(v.time).toMatch(/^2026-06-28 \d{2}:\d{2}:\d{2}$/)

    const r = await api.resolveSegmentUrls(v.guid, 'liuchang')
    expect(r.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)

  it('classifies real complex CCTV pages by their content shape', async () => {
    const fourK = await browse.resolveColumnInfo('https://tv.cctv.com/2024/11/30/VIDEkLRS36ABdGAb0llIYJAR241130.shtml')
    expect(fourK.kind).toBe('album')
    expect(fourK.serviceId).toBe('cctv4k')
    expect(fourK.columnId).toBeTruthy()
    const fourKList = await browse.getAlbumVideoList(fourK.columnId, 1, '', fourK.serviceId)
    expect(fourKList.length).toBeGreaterThan(1)
    expect(fourKList.some(v => v.title.includes('第5集'))).toBe(true)

    const drama = await browse.resolveColumnInfo('https://tv.cctv.com/2026/06/12/VIDElk5c6FRjXLZhcppxIHhL260612.shtml')
    expect(drama.kind).toBe('album')
    expect(drama.serviceId).toBe('tvcctv')
    const dramaList = await browse.getAlbumVideoList(drama.columnId, 1, '', drama.serviceId)
    expect(dramaList.length).toBeGreaterThan(1)
    expect(dramaList[0].title).toContain('第1集')

    const column = await browse.resolveColumnInfo('https://tv.cctv.com/2026/07/02/VIDEgkpWAAVCNkSdEnYSK5GO260702.shtml')
    expect(column.kind).toBe('column')
    expect(column.columnId).toMatch(/^TOPC/)

    await expect(browse.resolveColumnInfo('https://tv.cctv.com/2019/11/16/VIDEDvCPMR7rm10QI5chA4In191116.shtml'))
      .rejects.toThrow('无法解析节目信息')
    const clip = await browse.resolveSingleVideo('https://tv.cctv.com/2019/11/16/VIDEDvCPMR7rm10QI5chA4In191116.shtml')
    expect(clip.title).toContain('导视')
    expect(clip.time).toMatch(/^2019-11-16 \d{2}:\d{2}:\d{2}$/)
  }, 90_000)

  it('recognizes a program overview page through its episode links', async () => {
    const overview = await browse.resolveColumnInfo('https://tv.cctv.com/2021/10/09/VIDAlliMaCI9BiLxf3UhAGA8211009.shtml')
    const episode = await browse.resolveColumnInfo('https://tv.cctv.com/2021/10/13/VIDEeLV5WaJ6xHBNsqAeoaDe211013.shtml')

    expect(overview.kind).toBe('album')
    expect(overview.name).toContain('极限火力')
    expect(overview.columnId).toBe(episode.columnId)
    const videos = await browse.getAlbumVideoList(overview.columnId, 1, '', overview.serviceId)
    expect(videos.length).toBeGreaterThan(1)
  }, 60_000)

  it('keeps a legacy VIDA archive with changed TOPC as a monthly column', async () => {
    const info = await browse.resolveColumnInfo(
      'https://jishi.cctv.com/2015/03/03/VIDA1425372752043217.shtml?open_source=weibo_search'
    )
    expect(info).toMatchObject({
      name: '上海纪实《档案》',
      kind: 'column',
      listSource: { type: 'album', id: 'VIDA1425372752043217', serviceId: 'tvcctv' }
    })
    const march = await browse.getAlbumVideoList('VIDA1425372752043217', 1, '201503')
    expect(march.some(v => v.guid === '074fe7898bce4142ad74cdffc505946a')).toBe(true)
    expect(march.every(v => v.time.startsWith('2015-03'))).toBe(true)

    const oldEpisode = await browse.resolveColumnInfo('https://jishi.cctv.com/2015/03/24/VIDE1427145150264630.shtml')
    const newEpisode = await browse.resolveColumnInfo('https://jishi.cctv.com/2019/06/16/VIDE9dr4xvEdkaXlvenDzLtr190616.shtml')
    expect(oldEpisode).toMatchObject({ columnId: info.columnId, kind: 'column', listSource: info.listSource })
    expect(newEpisode).toMatchObject({ columnId: info.columnId, kind: 'column', listSource: info.listSource })
  }, 60_000)
})
