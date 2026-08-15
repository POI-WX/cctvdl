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

    const clipProgram = await browse.resolveColumnInfo(
      'https://tv.cctv.com/2019/11/16/VIDEDvCPMR7rm10QI5chA4In191116.shtml'
    )
    expect(clipProgram).toMatchObject({ name: '创新进行时', kind: 'album', serviceId: 'tvcctv' })
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
    const june2019 = await browse.getAlbumVideoList('VIDA1425372752043217', 1, '201906')
    expect(june2019.length).toBeGreaterThan(0)
    expect(june2019.every(v => v.time.startsWith('2019-06'))).toBe(true)

    const oldEpisode = await browse.resolveColumnInfo('https://jishi.cctv.com/2015/03/24/VIDE1427145150264630.shtml')
    const newEpisode = await browse.resolveColumnInfo('https://jishi.cctv.com/2019/06/16/VIDE9dr4xvEdkaXlvenDzLtr190616.shtml')
    expect(oldEpisode).toMatchObject({ columnId: info.columnId, kind: 'column', listSource: info.listSource })
    expect(newEpisode).toMatchObject({ columnId: info.columnId, kind: 'column', listSource: info.listSource })
  }, 60_000)

  it('upstream #99: resolves the legacy sports page and its 2011 archive', async () => {
    const info = await browse.resolveColumnInfo(
      'https://sports.cctv.com/2011/12/22/VIDE0tOb7LbbAcQsiTpDpZwf111222.shtml'
    )
    expect(info.columnId).toBeTruthy()
    const videos = info.listSource?.type === 'album'
      ? await browse.getAlbumVideoList(info.listSource.id, 1, '201112', info.listSource.serviceId)
      : await browse.getColumnVideoList(info.listSource?.id || info.columnId, 1, '201112')
    expect(videos.some(video => video.time.startsWith('2011-12'))).toBe(true)
  }, 60_000)

  it('upstream #96: keeps an editorial programme segment as the pasted single video', async () => {
    const url = 'https://tv.cctv.com/2021/11/16/VIDE9lJuIH1R3ee7BcFluJZ5211116.shtml'
    await expect(browse.resolveColumnInfo(url)).rejects.toThrow('无法解析节目信息')
    const pasted = await browse.resolveSingleVideo(url)
    expect(pasted.guid).toBe('36a90b852caf401b887cdafb0dc9d08c')
  }, 60_000)

  it('upstream #98: VIDA overview and episode resolve to the same multi-episode album', async () => {
    const overview = await browse.resolveColumnInfo(
      'https://tv.cctv.com/2024/03/19/VIDAs4QKnv232uJm4BjzaI6u240319.shtml'
    )
    const episode = await browse.resolveColumnInfo(
      'https://tv.cctv.com/2026/03/18/VIDENGxMKPgX3qgwirTrWHD0260318.shtml'
    )
    expect(overview.kind).toBe('album')
    expect(episode.columnId).toBe(overview.columnId)
    expect((await browse.getLatestAlbumVideos(overview.columnId, overview.serviceId)).length).toBeGreaterThan(1)
    const videos = await browse.getAlbumVideoList(overview.columnId, 1, '', overview.serviceId)
    expect(videos.length).toBeGreaterThan(1)
    expect(videos[0].title).toMatch(/第\s*1\s*集/)
  }, 90_000)

  it('upstream #104: resolves CCTV-16 from clear HLS rather than H5E', async () => {
    const video = await browse.resolveSingleVideo(
      'https://tv.cctv.cn/2026/07/25/VIDE3hJ88s2Emprtnumwfy4Q260725.shtml'
    )
    expect(video.channel).toMatch(/CCTV-16/i)
    const resolved = await api.resolveSegmentUrls(video.guid, 'auto')
    expect(resolved.encrypted).toBe(false)
    expect(resolved.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)

  it('upstream v4.4.3: treats culture/travel itemguid as the playable single video', async () => {
    const url = 'https://culture-travel.cctv.com/2024/12/21/VIDEvVu5prXSM14Y8yQk6aiq241221.shtml'
    await expect(browse.resolveColumnInfo(url)).rejects.toThrow('无法解析节目信息')
    const video = await browse.resolveSingleVideo(url)
    expect(video.guid).toBe('19e5f94bf6fe4c53b9df44d6885af4c4')
    expect(video.durationSeconds).toBe(377)
  }, 60_000)

  // The original #103 URL has expired; the stable #106 album exercises both
  // its full-episode classification and #103's optional-highlight separation.
  it('upstream #106 and #103 behaviour: separates full episodes from optional highlights', async () => {
    const info = await browse.resolveColumnInfo(
      'https://tv.cctv.com/2026/08/02/VIDECtLnpaVTtX2Xx5aTKZ4A260802.shtml'
    )
    expect(info.kind).toBe('album')
    const videos = await browse.getAlbumVideoList(info.columnId, 1, '', info.serviceId)
    expect(videos.map(video => video.title)).toEqual([
      '《南戏九百年》 第1集',
      '《南戏九百年》 第2集'
    ])
    const supplementary = await browse.getSupplementaryVideos(info)
    expect(supplementary.length).toBeGreaterThan(2)
    expect(supplementary.every(video => video.contentType === 'highlight' || video.contentType === 'fragment')).toBe(true)
    expect(new Set([...videos, ...supplementary].map(video => video.guid)).size)
      .toBe(videos.length + supplementary.length)
  }, 60_000)

  it('upstream #108: routes the 2016 event page to its 161-video album, not a single video', async () => {
    const info = await browse.resolveColumnInfo(
      'https://2016.cctv.com/2016/08/18/VIDEFXKSsL0eOPfC4Z3GqpIv160818.shtml'
    )
    expect(info).toMatchObject({
      name: '里约奥运-乒乓球', kind: 'album',
      listSource: { type: 'album', id: 'VIDAJWCgstBc3Q3ADY9VIGGE160801' }
    })
    const videos = await browse.getAlbumVideoList('VIDAJWCgstBc3Q3ADY9VIGGE160801', 1, '201608')
    expect(videos.length).toBeGreaterThan(100)
    expect(videos.some(video => video.guid === '6860a7d7945043bba8aabea4d102c364')).toBe(true)
  }, 90_000)

  it('upstream #101: lists a v.cctv mid/chid catalogue through the surviving API', async () => {
    const videos = await browse.getLatestVcctvVideos('24iQzAZ30426', 'EPGC1525679284945000')
    expect(videos.length).toBeGreaterThan(0)
    expect(videos[0].guid).toBeTruthy()
  }, 60_000)

})
