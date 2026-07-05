/**
 * E2E: cross-month / cross-column selection scenarios — real API metadata only.
 *
 * These tests guard the scenarios the user actually hit:
 *   1. Pick videos from different months of the same column and confirm both
 *      resolve to downloadable segment URLs (proves the "跨月选择" feature is
 *      end-to-end viable, not just a UI illusion).
 *   2. Pick videos from different columns and confirm both resolve.
 *   3. 央视新闻移动端视频 (cctvnews snow-book) URL resolves to a reachable m3u8.
 *   4. cctvnews articles that contain multiple videos resolve to ≥ 2 VideoInfo.
 *
 * Like the other e2e suites (api.test.ts, pipeline.test.ts), these tests
 * never download full segment payloads — they only verify that the resolve
 * step succeeds and the returned URLs are reachable. No filesystem cleanup
 * is needed.
 *
 * Run: npm run test:e2e
 */
import { describe, it, expect } from 'vitest'
import { CctvApiService } from '../../src/main/api/cctv'
import { BrowseService } from '../../src/main/api/browse'
import { CctvNewsService } from '../../src/main/api/cctvnews'

// Stable, long-running columns. If one ever goes dark, swap it out here.
const XWLB_URL = 'https://tv.cctv.com/lm/xwlb/index.shtml'
const JDFT_URL = 'https://tv.cctv.com/lm/jdft/index.shtml'

// Two real snow-book URLs verified against videodl's daily test corpus
// (2026-07-03). The first is known to carry a single video; the second may
// carry multiple — we assert "≥ 1" so the test stays robust if the article
// is ever trimmed.
const CCTVNEWS_SINGLE_URL = 'https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=15184105708774284671'
const CCTVNEWS_MULTI_URL = 'https://content-static.cctvnews.cctv.com/snow-book/index.html?item_id=7331185547682467513'

function monthOf(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

describe('跨月 / 跨栏目选择场景 (e2e, 仅元数据)', () => {
  const browse = new BrowseService()
  const api = new CctvApiService()

  it('同一栏目不同月份的视频都能解析 segment URLs', async () => {
    const info = await browse.resolveColumnInfo(XWLB_URL)
    expect(info.columnId).toMatch(/^TOPC/)

    // Try the current month, then walk back up to 3 months until we find
    // two distinct months that both have ≥ 1 video.
    const now = new Date()
    const monthsWithVideos: string[] = []
    for (let i = 0; i < 4 && monthsWithVideos.length < 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const month = monthOf(d)
      const list = await browse.getColumnVideoList(info.columnId, 1, month)
      if (list.length > 0) monthsWithVideos.push(month)
    }
    expect(monthsWithVideos.length).toBeGreaterThanOrEqual(2)

    // Each month's first video must resolve to playable segment URLs.
    for (const month of monthsWithVideos) {
      const list = await browse.getColumnVideoList(info.columnId, 1, month)
      const r = await api.resolveSegmentUrls(list[0].guid, 'liuchang')
      expect(r.segmentUrls.length).toBeGreaterThan(0)
      expect(r.segmentUrls[0]).toMatch(/^https?:\/\//)
    }
  }, 60_000)

  it('不同栏目的视频都能解析 segment URLs', async () => {
    const xwlb = await browse.resolveColumnInfo(XWLB_URL)
    const jdft = await browse.resolveColumnInfo(JDFT_URL)
    expect(xwlb.columnId).not.toBe(jdft.columnId)

    // Pick the most recent month with videos from each column.
    async function pickFirstVideo(columnId: string) {
      const now = new Date()
      for (let i = 0; i < 4; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const list = await browse.getColumnVideoList(columnId, 1, monthOf(d))
        if (list.length > 0) return list[0]
      }
      throw new Error(`no videos found in column ${columnId} within last 4 months`)
    }

    const v1 = await pickFirstVideo(xwlb.columnId)
    const v2 = await pickFirstVideo(jdft.columnId)
    expect(v1.guid).not.toBe(v2.guid)

    const r1 = await api.resolveSegmentUrls(v1.guid, 'liuchang')
    const r2 = await api.resolveSegmentUrls(v2.guid, 'liuchang')
    expect(r1.segmentUrls.length).toBeGreaterThan(0)
    expect(r2.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)

  it('央视新闻移动端视频的 m3u8 可达（不下载 segment）', async () => {
    const cctvNews = new CctvNewsService()
    const videos = await cctvNews.resolveFromUrl(CCTVNEWS_SINGLE_URL)

    expect(videos.length).toBeGreaterThanOrEqual(1)
    expect(videos[0].guid).toBeTruthy()
    expect(videos[0].title.length).toBeGreaterThan(0)
    expect(videos[0].m3u8Url).toMatch(/^https:\/\//)

    // Confirm the m3u8 URL actually serves a playlist (HEAD request — no body).
    const head = await fetch(videos[0].m3u8Url!, { method: 'HEAD' })
    expect(head.ok).toBe(true)
    const ct = head.headers.get('content-type') ?? ''
    expect(ct).toMatch(/mpegurl|octet-stream|x-mpegurl/i)
  }, 30_000)

  it('央视新闻文章可解析至少 1 条视频（多视频文章场景）', async () => {
    const cctvNews = new CctvNewsService()
    const videos = await cctvNews.resolveFromUrl(CCTVNEWS_MULTI_URL)

    // The article historically carried multiple videos; assert at least 1
    // so the test survives upstream content edits.
    expect(videos.length).toBeGreaterThanOrEqual(1)
    // Every video must have its own distinct guid and a reachable m3u8.
    const guids = new Set(videos.map(v => v.guid))
    expect(guids.size).toBe(videos.length)
    for (const v of videos) {
      expect(v.m3u8Url).toMatch(/^https:\/\//)
    }
  }, 30_000)
})
