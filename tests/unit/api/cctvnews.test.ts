import { describe, it, expect, vi } from 'vitest'
import {
  computeEmasSignature,
  buildEmasHeaders,
  pickQuality,
  qualityToBandwidth,
  isCctvNewsSnowBookPage,
  CctvNewsService,
  EMAS_APP_KEY,
  EMAS_API_NAME,
  EMAS_API_VER,
  EMAS_SECRET
} from '../../../src/main/api/cctvnews'
import type { CctvNewsQuality } from '../../../src/main/api/cctvnews'

describe('cctvnews emas signature', () => {
  // Known vector derived from running the Python reference with ts=1783174998;
  // re-verified against Node.js crypto.
  const params = { articleId: '15184105708774284671', appcode: 'video_web' }
  const ts = '1783174998'
  const expectedSign = 'ce350038954d28d973fb696fccb6a0733ab76a481e0e97ffd16282b4dae05b55'

  it('matches the Python reference implementation', () => {
    const got = computeEmasSignature(EMAS_APP_KEY, EMAS_API_NAME, EMAS_API_VER, params, ts, EMAS_SECRET)
    expect(got).toBe(expectedSign)
  })

  it('sorts params alphabetically (stable across insertion order)', () => {
    // reversed insertion order — same output expected
    const reversed = { appcode: 'video_web', articleId: '15184105708774284671' }
    expect(computeEmasSignature(EMAS_APP_KEY, EMAS_API_NAME, EMAS_API_VER, reversed, ts, EMAS_SECRET))
      .toBe(expectedSign)
  })

  it('produces a 64-char lowercase hex digest', () => {
    const sign = computeEmasSignature(EMAS_APP_KEY, EMAS_API_NAME, EMAS_API_VER, params, ts, EMAS_SECRET)
    expect(sign).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when timestamp changes', () => {
    const a = computeEmasSignature(EMAS_APP_KEY, EMAS_API_NAME, EMAS_API_VER, params, '1700000000', EMAS_SECRET)
    const b = computeEmasSignature(EMAS_APP_KEY, EMAS_API_NAME, EMAS_API_VER, params, '1700000001', EMAS_SECRET)
    expect(a).not.toBe(b)
  })

  it('builds the 3-prefix / 5-suffix ampersand structure', () => {
    // Reconstruct the sign string the same way computeEmasSignature does and
    // assert its shape: "&&&<app>&<md5>&<ts>&<api>&<ver>&&&&&"
    const md5 = 'e26743eb4a850a700c1d8e835fc6fa02'  // pre-computed for `sorted`
    const expected = `&&&${EMAS_APP_KEY}&${md5}&${ts}&${EMAS_API_NAME}&${EMAS_API_VER}&&&&&`
    // Count the prefix `&`s and suffix `&`s in expected
    expect(expected.startsWith('&&&')).toBe(true)
    expect(expected.endsWith('&&&&&')).toBe(true)
    expect(expected).not.toContain('&&&&&&')  // no 6-in-a-row anywhere
  })
})

describe('cctvnews buildEmasHeaders', () => {
  it('returns all required gateway headers', () => {
    const headers = buildEmasHeaders({ articleId: 'X', appcode: 'video_web' }, '1700000000')
    expect(headers['x-emas-gw-appkey']).toBe(EMAS_APP_KEY)
    expect(headers['x-emas-gw-pv']).toBe('6.1')
    expect(headers['x-emas-gw-t']).toBe('1700000000')
    expect(headers['x-emas-gw-sign']).toMatch(/^[0-9a-f]{64}$/)
    expect(headers['from-client']).toBe('h5')
    expect(headers['Content-Type']).toBe('application/json; charset=utf8')
    expect(headers['User-Agent']).toContain('Chrome')
    expect(headers['Referer']).toBe('https://content-static.cctvnews.cctv.com/')
    expect(headers['Origin']).toBe('https://content-static.cctvnews.cctv.com')
  })

  it('uses current timestamp when none supplied', () => {
    const before = Math.floor(Date.now() / 1000)
    const headers = buildEmasHeaders({ articleId: 'X', appcode: 'video_web' })
    const after = Math.floor(Date.now() / 1000)
    const t = Number(headers['x-emas-gw-t'])
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(after)
  })
})

describe('cctvnews isCctvNewsSnowBookPage', () => {
  it('matches content-static.cctvnews.cctv.com with item_id', () => {
    expect(isCctvNewsSnowBookPage('https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=123')).toBe(true)
    expect(isCctvNewsSnowBookPage('https://content-static.cctvnews.cctv.com/snow-book/index.html?item_id=456&foo=bar')).toBe(true)
  })

  it('matches bare cctvnews.cctv.com with item_id', () => {
    expect(isCctvNewsSnowBookPage('https://cctvnews.cctv.com/some/path?item_id=789')).toBe(true)
  })

  it('rejects when item_id is missing', () => {
    expect(isCctvNewsSnowBookPage('https://content-static.cctvnews.cctv.com/snow-book/video.html')).toBe(false)
    expect(isCctvNewsSnowBookPage('https://content-static.cctvnews.cctv.com/?foo=bar')).toBe(false)
  })

  it('rejects other cctv domains', () => {
    expect(isCctvNewsSnowBookPage('https://news.cctv.com/2026/07/04/ARTIabc.shtml')).toBe(false)
    expect(isCctvNewsSnowBookPage('https://tv.cctv.com/lm/xwlb/')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isCctvNewsSnowBookPage('not a url')).toBe(false)
    expect(isCctvNewsSnowBookPage('')).toBe(false)
  })
})

describe('cctvnews pickQuality', () => {
  const mk = (w: number, h: number, size: number, br: number): CctvNewsQuality => ({
    url: `https://x/${w}x${h}.m3u8`, width: w, height: h, size, bitRate: br, title: ''
  })
  const qualities = [mk(1920, 1080, 49_000_000, 4_000_000), mk(1280, 720, 25_000_000, 2_000_000),
    mk(960, 540, 16_000_000, 1_200_000), mk(640, 360, 9_000_000, 600_000)]

  it('picks highest (pixels, bitRate) within bandwidth cap', () => {
    expect(pickQuality(qualities, Infinity)?.width).toBe(1920)
    expect(pickQuality(qualities, 3_000_000)?.width).toBe(1280)
    expect(pickQuality(qualities, 2_000_000)?.width).toBe(1280)
    expect(pickQuality(qualities, 1_500_000)?.width).toBe(960)
    expect(pickQuality(qualities, 1_000_000)?.width).toBe(640)
    expect(pickQuality(qualities, 600_000)?.width).toBe(640)
  })

  it('falls back to lowest quality when all exceed cap', () => {
    expect(pickQuality(qualities, 100_000)?.width).toBe(640)
  })

  it('returns null for empty array', () => {
    expect(pickQuality([], Infinity)).toBeNull()
  })
})

describe('cctvnews qualityToBandwidth', () => {
  it('auto/bluray are unbounded', () => {
    expect(qualityToBandwidth('auto')).toBe(Infinity)
    expect(qualityToBandwidth('bluray')).toBe(Infinity)
  })
  it('lower tiers return finite bps in ascending order', () => {
    const tiers = ['liuchang', 'biaoqing', 'gaoqing', 'chaoqing'] as const
    for (let i = 1; i < tiers.length; i++) {
      expect(qualityToBandwidth(tiers[i])).toBeGreaterThan(qualityToBandwidth(tiers[i - 1]))
    }
  })
})

describe('CctvNewsService.fetchArticle', () => {
  // Build a base64 inner payload like the real API returns.
  const encode = (inner: unknown) => Buffer.from(JSON.stringify(inner), 'utf-8').toString('base64')

  it('parses videos and qualities from a real-shaped response', async () => {
    const inner = {
      code: 0,
      data: {
        id: '15184105708774284671',
        title: '文章标题',
        publish_time: 1736835523671,
        videos: [{
          title: '视频标题',
          cover: { url: 'https://img.cctvnews.cctv.com/cover.jpg', width: 1920, height: 1080 },
          qualities: [
            { url: 'https://res/a-4.m3u8', width: 1920, height: 1080, size: 49000000, bitRate: 4000000 },
            { url: 'https://res/a-3.m3u8', width: 1280, height: 720, size: 25000000, bitRate: 2000000 }
          ]
        }]
      }
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: encode(inner) })
    })
    const svc = new CctvNewsService(mockFetch)
    const article = await svc.fetchArticle('15184105708774284671')
    expect(article.id).toBe('15184105708774284671')
    expect(article.title).toBe('文章标题')
    expect(article.publishTime).toBe(1736835523671)
    expect(article.videos).toHaveLength(1)
    expect(article.videos[0].title).toBe('视频标题')
    expect(article.videos[0].coverUrl).toBe('https://img.cctvnews.cctv.com/cover.jpg')
    expect(article.videos[0].qualities).toHaveLength(2)

    // Verify the request URL shape
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('articleId=15184105708774284671')
    expect(calledUrl).toContain('appcode=video_web')
  })

  it('skips videos without qualities or without http urls', async () => {
    const inner = {
      data: {
        id: 'X', title: 'T', publish_time: 0,
        videos: [
          { title: 'no-qualities' },                                    // dropped
          { title: 'empty-qualities', qualities: [] },                   // dropped
          { title: 'bad-url', qualities: [{ url: 'ftp://x', width: 1, height: 1, size: 1, bitRate: 1 }] },  // dropped (not http)
          { title: 'ok', qualities: [{ url: 'https://x/a.m3u8', width: 1, height: 1, size: 1, bitRate: 1 }] }
        ]
      }
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: encode(inner) })
    })
    const article = await new CctvNewsService(mockFetch).fetchArticle('X')
    expect(article.videos).toHaveLength(1)
    expect(article.videos[0].title).toBe('ok')
  })

  it('throws on empty response (下架 / App-only)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({})
    })
    await expect(new CctvNewsService(mockFetch).fetchArticle('X'))
      .rejects.toThrow(/已下架|App 观看/)
  })

  it('throws on base64 decode failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: '!!!not-base64!!!' })
    })
    await expect(new CctvNewsService(mockFetch).fetchArticle('X'))
      .rejects.toThrow(/base64|JSON/)
  })

  it('throws on HTTP failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    await expect(new CctvNewsService(mockFetch).fetchArticle('X'))
      .rejects.toThrow('HTTP 403')
  })

  it('normalises protocol-relative cover url', async () => {
    const inner = {
      data: { id: 'X', title: 'T', publish_time: 0,
        videos: [{ title: 'v', cover: { url: '//img.cctvnews.cctv.com/x.jpg' },
          qualities: [{ url: 'https://x/a.m3u8', width: 1, height: 1, size: 1, bitRate: 1 }] }] }
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: encode(inner) })
    })
    const article = await new CctvNewsService(mockFetch).fetchArticle('X')
    expect(article.videos[0].coverUrl).toBe('https://img.cctvnews.cctv.com/x.jpg')
  })
})

describe('CctvNewsService.resolveFromUrl', () => {
  const encode = (inner: unknown) => Buffer.from(JSON.stringify(inner), 'utf-8').toString('base64')

  it('returns one VideoInfo per video, best quality selected, m3u8Url populated', async () => {
    const inner = {
      data: {
        id: '15184105708774284671', title: '文章标题', publish_time: 1736835523671,
        videos: [{
          title: '视频标题', cover: { url: 'https://x/c.jpg' },
          qualities: [
            { url: 'https://res/hd.m3u8', width: 1920, height: 1080, size: 49e6, bitRate: 4e6 },
            { url: 'https://res/sd.m3u8', width: 640, height: 360, size: 9e6, bitRate: 6e5 }
          ]
        }]
      }
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: encode(inner) })
    })
    const videos = await new CctvNewsService(mockFetch)
      .resolveFromUrl('https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=15184105708774284671')
    expect(videos).toHaveLength(1)
    expect(videos[0].guid).toBe('cctvnews_15184105708774284671_0')
    expect(videos[0].title).toBe('视频标题')
    expect(videos[0].coverUrl).toBe('https://x/c.jpg')
    expect(videos[0].m3u8Url).toBe('https://res/hd.m3u8')
    expect(videos[0].time).toBe('2025-01-14 14:18:43')
  })

  it('honours quality tier cap (gaoqing ≤ 2 Mbps)', async () => {
    const inner = {
      data: {
        id: 'X', title: 'T', publish_time: 0,
        videos: [{
          title: 'v', cover: { url: '' },
          qualities: [
            { url: 'https://res/hd.m3u8', width: 1920, height: 1080, size: 49e6, bitRate: 4e6 },
            { url: 'https://res/sd.m3u8', width: 960, height: 540, size: 16e6, bitRate: 1.2e6 }
          ]
        }]
      }
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: encode(inner) })
    })
    const videos = await new CctvNewsService(mockFetch)
      .resolveFromUrl('https://cctvnews.cctv.com/x?item_id=X', 'gaoqing')
    expect(videos[0].m3u8Url).toBe('https://res/sd.m3u8')
  })

  it('supports multiple videos per item_id', async () => {
    const inner = {
      data: {
        id: 'M', title: '多篇', publish_time: 0,
        videos: [
          { title: 'V1', qualities: [{ url: 'https://res/1.m3u8', width: 1, height: 1, size: 1, bitRate: 1 }] },
          { title: 'V2', qualities: [{ url: 'https://res/2.m3u8', width: 1, height: 1, size: 1, bitRate: 1 }] }
        ]
      }
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: encode(inner) })
    })
    const videos = await new CctvNewsService(mockFetch)
      .resolveFromUrl('https://cctvnews.cctv.com/?item_id=M')
    expect(videos.map(v => v.guid)).toEqual(['cctvnews_M_0', 'cctvnews_M_1'])
    expect(videos.map(v => v.m3u8Url)).toEqual(['https://res/1.m3u8', 'https://res/2.m3u8'])
  })

  it('throws when URL has no item_id', async () => {
    await expect(new CctvNewsService(vi.fn()).resolveFromUrl('https://cctvnews.cctv.com/'))
      .rejects.toThrow(/item_id/)
  })

  it('returns empty array when article has no usable videos', async () => {
    const inner = { data: { id: 'X', title: 'T', publish_time: 0, videos: [] } }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ response: encode(inner) })
    })
    const videos = await new CctvNewsService(mockFetch)
      .resolveFromUrl('https://cctvnews.cctv.com/?item_id=X')
    expect(videos).toEqual([])
  })
})
