import { describe, it, expect, vi } from 'vitest'
import { computeSignature, CCTVHLSBestParser, parseSegmentUrls, CctvApiService } from '../../../src/main/api/cctv'

describe('computeSignature', () => {
  it('computes MD5 signature with fixed tsp', () => {
    const tsp = '1700000000'
    const result = computeSignature(tsp)
    expect(result).toMatch(/^[a-f0-9]{32}$/)
  })

  it('produces different signatures for different timestamps', () => {
    const sig1 = computeSignature('1700000000')
    const sig2 = computeSignature('1700000001')
    expect(sig1).not.toBe(sig2)
  })
})

describe('CCTVHLSBestParser', () => {
  const threeVariants = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2048000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=870400,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=460800,RESOLUTION=480x270
270p.m3u8`

  describe('基础解析', () => {
    it('selects highest quality variant by default (no cap)', () => {
      const result = CCTVHLSBestParser.best(threeVariants, 'https://example.com/')
      expect(result.bandwidth).toBe(2048000)
      expect(result.resolution).toEqual({ width: 1280, height: 720 })
      expect(result.uri).toBe('https://example.com/720p.m3u8')
    })

    it('handles missing BANDWIDTH attribute (treats as 0)', () => {
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:RESOLUTION=1280x720
720p.m3u8`
      const result = CCTVHLSBestParser.best(playlist, 'https://example.com/')
      expect(result.bandwidth).toBe(0)
      expect(result.resolution).toEqual({ width: 1280, height: 720 })
    })

    it('handles missing RESOLUTION attribute (treats as [0,0])', () => {
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000
1m.m3u8`
      const result = CCTVHLSBestParser.best(playlist, 'https://example.com/')
      expect(result.bandwidth).toBe(1000000)
      expect(result.resolution).toEqual({ width: 0, height: 0 })
    })

    it('selects highest bandwidth when resolution is equal', () => {
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
b.m3u8`
      const result = CCTVHLSBestParser.best(playlist, 'https://example.com/')
      expect(result.bandwidth).toBe(2000000)
      expect(result.uri).toBe('https://example.com/b.m3u8')
    })

    it('throws when playlist has no stream entries', () => {
      expect(() => CCTVHLSBestParser.best('#EXTM3U\n#EXT-X-ENDLIST', 'https://example.com/')).toThrow('No HLS variants found')
    })
  })

  describe('maxBandwidth 过滤', () => {
    it('selects highest variant within bandwidth cap', () => {
      const result = CCTVHLSBestParser.best(threeVariants, 'https://example.com/', 1_000_000)
      expect(result.bandwidth).toBe(870400)
      expect(result.resolution).toEqual({ width: 640, height: 360 })
    })

    it('selects single variant exactly at cap boundary', () => {
      const result = CCTVHLSBestParser.best(threeVariants, 'https://example.com/', 870_400)
      expect(result.bandwidth).toBe(870400)
    })

    it('selects higher-resolution variant over same-cap lower-res when both qualify', () => {
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
720p.m3u8`
      const result = CCTVHLSBestParser.best(playlist, 'https://example.com/', 2_000_000)
      expect(result.bandwidth).toBe(1000000)
    })
  })

  describe('fallback 降级（CCTV-4K 场景）', () => {
    // CCTV-4K超高清 只有 2Mbps 和 4Mbps 两档。
    // 用户选低档（如高清/标清/流畅）时，eligible 为空，应 fallback 到最低可用档。
    const cctv4kPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2048000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4096000,RESOLUTION=1920x1080
1080p.m3u8`

    it('fallback to lowest tier when requested cap is below all variants (gaoqing on 4K content)', () => {
      // gaoqing = 1228800, both 2Mbps and 4Mbps exceed it → fallback picks 2048000 (lowest)
      const result = CCTVHLSBestParser.best(cctv4kPlaylist, 'https://example.com/', 1_228_800)
      expect(result.bandwidth).toBe(2048000)
      expect(result.resolution).toEqual({ width: 1280, height: 720 })
    })

    it('fallback to lowest tier when requested cap is liuchang (460800) on 4K content', () => {
      const result = CCTVHLSBestParser.best(cctv4kPlaylist, 'https://example.com/', 460_800)
      expect(result.bandwidth).toBe(2048000)
    })

    it('fallback picks the minimum bandwidth variant, not maximum, when all exceed cap', () => {
      // 3 variants all above cap: 3M, 5M, 10M → fallback must pick 3M (lowest), not 10M
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
3m.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
5m.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=10000000,RESOLUTION=3840x2160
10m.m3u8`
      const result = CCTVHLSBestParser.best(playlist, 'https://example.com/', 1_000_000)
      expect(result.bandwidth).toBe(3000000)
      expect(result.uri).toBe('https://example.com/3m.m3u8')
    })

    it('single variant exceeding cap: fallback returns it (only option available)', () => {
      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8`
      const result = CCTVHLSBestParser.best(playlist, 'https://example.com/', 1_000_000)
      expect(result.bandwidth).toBe(5000000)
    })
  })
})

describe('parseSegmentUrls', () => {
  describe('基础提取', () => {
    it('extracts relative segment URLs using base URL', () => {
      const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment001.ts
#EXTINF:10.0,
segment002.ts
#EXT-X-ENDLIST`
      const urls = parseSegmentUrls(playlist, 'https://example.com/path/')
      expect(urls).toEqual([
        'https://example.com/path/segment001.ts',
        'https://example.com/path/segment002.ts'
      ])
    })

    it('preserves absolute URLs in playlist', () => {
      const playlist = `#EXTM3U
#EXTINF:10.0,
https://cdn.example.com/segment001.ts`
      const urls = parseSegmentUrls(playlist, 'https://example.com/')
      expect(urls).toEqual(['https://cdn.example.com/segment001.ts'])
    })
  })

  describe('边界情况', () => {
    it('returns empty array for end-list-only playlist', () => {
      expect(parseSegmentUrls('#EXTM3U\n#EXT-X-ENDLIST', 'https://example.com/')).toEqual([])
    })

    it('returns empty array for comment-only playlist', () => {
      expect(parseSegmentUrls('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10', 'https://example.com/')).toEqual([])
    })

    it('handles mixed comments and segments (ignores EXT-X-DISCONTINUITY etc.)', () => {
      const playlist = `#EXTM3U
#EXTINF:10.0,
seg1.ts
#EXT-X-DISCONTINUITY
#EXTINF:5.0,
seg2.ts`
      const urls = parseSegmentUrls(playlist, 'https://example.com/p/')
      expect(urls).toEqual([
        'https://example.com/p/seg1.ts',
        'https://example.com/p/seg2.ts'
      ])
    })
  })
})

describe('CctvApiService', () => {
  describe('fetchVideoInfo', () => {
    it('parses the HLS stream URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hls_h5e_url: 'https://example.com/master.m3u8' })
      })
      const api = new CctvApiService(mockFetch)
      const info = await api.fetchVideoInfo('test-guid')

      expect(info.hlsH5eUrl).toBe('https://example.com/master.m3u8')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('throws on HTTP failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      const api = new CctvApiService(mockFetch)
      await expect(api.fetchVideoInfo('bad-guid')).rejects.toThrow('HTTP 404')
    })
  })

  describe('resolveSegmentUrls', () => {
    function makeChainedFetch(masterPlaylist: string, variantPlaylist: string) {
      return vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: 'Test', image: 'img.jpg',
            hls_h5e_url: 'https://example.com/master.m3u8',
            play_channel: 'CCTV-1'
          })
        })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(masterPlaylist) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(variantPlaylist) })
    }

    it('resolves segment URLs through full fetch chain (quality=auto)', async () => {
      const mockFetch = makeChainedFetch(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720p.m3u8',
        '#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXTINF:10,\nseg2.ts\n#EXT-X-ENDLIST'
      )
      const api = new CctvApiService(mockFetch)
      const result = await api.resolveSegmentUrls('test-guid', 'auto')

      expect(result.segmentUrls).toHaveLength(2)
    })

    it('passes quality tier bandwidth cap to variant selection (liuchang → 460800)', async () => {
      // Master has two variants; liuchang cap (460800) should select the lower one
      const mockFetch = makeChainedFetch(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=460800,RESOLUTION=480x270\n270p.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2048000,RESOLUTION=1280x720\n720p.m3u8',
        '#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXT-X-ENDLIST'
      )
      const api = new CctvApiService(mockFetch)
      await api.resolveSegmentUrls('test-guid', 'liuchang')

      // The second fetch (master) is followed by a third fetch (variant).
      // The variant URI requested must be the 270p one (460800 is within liuchang cap).
      const variantFetchUrl = (mockFetch.mock.calls[2][0] as string)
      expect(variantFetchUrl).toContain('270p.m3u8')
    })

    it('handles CCTV-4K content via hls_h5e_url (same path as regular content)', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: '4K Video', image: '4k.jpg',
            hls_h5e_url: 'https://example.com/4k-master.m3u8',
            play_channel: 'CCTV-4K超高清'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2048000,RESOLUTION=1280x720\n720p.m3u8\n' +
            '#EXT-X-STREAM-INF:BANDWIDTH=4096000,RESOLUTION=1920x1080\n1080p.m3u8'
          )
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXTINF:10,\nseg2.ts\n#EXT-X-ENDLIST')
        })

      const api = new CctvApiService(mockFetch)
      const result = await api.resolveSegmentUrls('4k-guid', 'auto')

      expect(result.segmentUrls).toHaveLength(2)
    })

    it('forwards the abort signal to every fetch in the chain', async () => {
      const controller = new AbortController()
      const mockFetch = makeChainedFetch(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720p.m3u8',
        '#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXT-X-ENDLIST'
      )
      const api = new CctvApiService(mockFetch)
      await api.resolveSegmentUrls('test-guid', 'auto', controller.signal)

      expect(mockFetch).toHaveBeenCalledTimes(3)
      for (const call of mockFetch.mock.calls) {
        expect((call[1] as RequestInit).signal).toBe(controller.signal)
      }
    })

    it('throws when no HLS URL found in API response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ title: 'No URL', play_channel: 'CCTV-1' })
      })
      const api = new CctvApiService(mockFetch)
      await expect(api.resolveSegmentUrls('no-url-guid', 'auto')).rejects.toThrow('No HLS URL found')
    })

    it('throws when master playlist fetch fails', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            title: 'Test', hls_h5e_url: 'https://example.com/master.m3u8', play_channel: 'CCTV-1'
          })
        })
        .mockResolvedValueOnce({ ok: false, status: 404 })

      const api = new CctvApiService(mockFetch)
      await expect(api.resolveSegmentUrls('test-guid', 'auto')).rejects.toThrow('HTTP 404')
    })
  })
})
