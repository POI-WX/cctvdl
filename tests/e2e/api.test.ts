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
})
