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
    // date from URL path
    expect(v.time).toBe('2026-06-12')

    // Confirm the resolved guid is downloadable
    const r = await new CctvApiService().resolveSegmentUrls(v.guid, 'liuchang')
    expect(r.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)
})
