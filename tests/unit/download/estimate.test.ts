import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DownloadEstimator, readDiskFreeBytes } from '../../../src/main/download/estimate'

describe('readDiskFreeBytes', () => {
  it('reads the volume of the nearest existing parent without creating the save directory', () => {
    const savePath = path.join(os.tmpdir(), `cctvdl-estimate-${Date.now()}`, 'videos')
    expect(readDiskFreeBytes(savePath)).toBeGreaterThan(0)
    expect(fs.existsSync(savePath)).toBe(false)
    expect(readDiskFreeBytes('')).toBeNull()
  })
})

describe('DownloadEstimator', () => {
  it('uses fast master metadata when available and falls back to full resolution otherwise', async () => {
    const estimateSizeFromMaster = vi.fn()
      .mockResolvedValueOnce(5_000_000)
      .mockResolvedValueOnce(undefined)
    const resolveSegmentUrls = vi.fn().mockResolvedValue({
      segmentUrls: ['segment.ts'], encrypted: true,
      estimatedBandwidth: 800_000, durationSeconds: 10
    })
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls }, () => null)
      .estimate([{ guid: 'fast' }, { guid: 'fallback' }], 'auto', '/unused')

    expect(result.estimatedBytes).toBe(6_000_000)
    expect(result.estimatedCount).toBe(2)
    expect(resolveSegmentUrls).toHaveBeenCalledOnce()
    expect(resolveSegmentUrls).toHaveBeenCalledWith('fallback', 'auto', expect.any(AbortSignal))
  })

  it('combines selected direct sizes and actual HLS stream metadata', async () => {
    const resolveSegmentUrls = vi.fn().mockResolvedValue({
      segmentUrls: ['segment.ts'], encrypted: true,
      estimatedBandwidth: 800_000, durationSeconds: 10
    })
    const estimator = new DownloadEstimator({ resolveSegmentUrls }, () => 80_000_000)
    const result = await estimator.estimate([
      { guid: 'news', m3u8Url: 'https://example.com/news.m3u8', estimatedSizeBytes: 20_000_000 },
      { guid: 'episode' },
      { guid: 'unknown-direct', m3u8Url: 'https://example.com/unknown.m3u8' }
    ], 'liuchang', '/unused')

    expect(result).toEqual({
      estimatedBytes: 21_000_000, estimatedCount: 2, totalCount: 3,
      diskFreeBytes: 80_000_000
    })
    expect(resolveSegmentUrls).toHaveBeenCalledTimes(1)
    expect(resolveSegmentUrls).toHaveBeenCalledWith('episode', 'liuchang', expect.any(AbortSignal))
  })

  it('leaves unavailable stream metadata out of the estimate', async () => {
    const resolveSegmentUrls = vi.fn()
      .mockResolvedValueOnce({ segmentUrls: [], encrypted: false })
      .mockRejectedValueOnce(new Error('unavailable'))
    const result = await new DownloadEstimator({ resolveSegmentUrls }, () => null)
      .estimate([{ guid: 'missing-rate' }, { guid: 'unavailable' }], 'auto', '/unused')

    expect(result).toEqual({ estimatedBytes: 0, estimatedCount: 0, totalCount: 2, diskFreeBytes: null })
  })

  it('limits concurrency but attempts every item despite individual timeouts', async () => {
    let active = 0
    let maxActive = 0
    const resolveSegmentUrls = vi.fn(async (_guid: string, _quality: string, signal?: AbortSignal) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 50)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
      }).finally(() => { active-- })
      return { segmentUrls: ['segment.ts'], encrypted: true, estimatedBandwidth: 800_000, durationSeconds: 10 }
    })
    const videos = Array.from({ length: 12 }, (_, i) => ({
      guid: `video-${i}`, time: `2024-${String(i + 1).padStart(2, '0')}-01`
    }))
    const result = await new DownloadEstimator({ resolveSegmentUrls }, () => 100, 20, 4)
      .estimate(videos, 'auto', '/unused')

    expect(maxActive).toBe(4)
    expect(resolveSegmentUrls).toHaveBeenCalledTimes(12)
    expect(result.estimatedCount).toBe(0)
    expect(result.totalCount).toBe(12)
    expect(active).toBe(0)
  })

  it('reuses positive per-video estimates for the same quality', async () => {
    const estimateSizeFromMaster = vi.fn().mockResolvedValue(2_000_000)
    const resolveSegmentUrls = vi.fn()
    const estimator = new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls }, () => null)
    const videos = [{ guid: 'same-video' }]
    await estimator.estimate(videos, 'auto', '/unused')
    await estimator.estimate(videos, 'auto', '/unused')
    expect(estimateSizeFromMaster).toHaveBeenCalledOnce()
    expect(resolveSegmentUrls).not.toHaveBeenCalled()
    await estimator.estimate(videos, 'liuchang', '/unused')
    expect(estimateSizeFromMaster).toHaveBeenCalledTimes(2)
  })

  it('samples large month/type strata and includes projected items in the total', async () => {
    const videos = [
      ...Array.from({ length: 900 }, (_, index) => ({
        guid: `episode-${index}`, time: `${2020 + Math.floor(index / 90)}-01-01`
      })),
      ...Array.from({ length: 60 }, (_, index) => ({
        guid: `highlight-${index}`, time: `${2020 + Math.floor(index / 6)}-02-01`,
        contentType: 'highlight' as const
      })),
      ...Array.from({ length: 40 }, (_, index) => ({
        guid: `fragment-${index}`, time: `${2020 + Math.floor(index / 4)}-03-01`,
        contentType: 'fragment' as const
      }))
    ]
    const estimateSizeFromMaster = vi.fn(async (guid: string) =>
      guid.startsWith('episode-') ? 1000 : guid.startsWith('highlight-') ? 100 : 50)
    const resolveSegmentUrls = vi.fn()
    const estimator = new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls }, () => null)

    const result = await estimator.estimate(videos, 'auto', '/unused')
    expect(estimateSizeFromMaster.mock.calls.length).toBeLessThanOrEqual(120)
    expect(result.estimatedCount + (result.projectedCount || 0)).toBe(1000)
    expect(result.estimatedBytes).toBe(908_000)
    expect(resolveSegmentUrls).not.toHaveBeenCalled()
    const sampled = estimateSizeFromMaster.mock.calls.map(call => call[0])
    const episodeIndices = sampled.filter(guid => guid.startsWith('episode-'))
      .map(guid => Number(guid.slice('episode-'.length)))
    expect(Math.min(...episodeIndices)).toBeLessThan(90)
    expect(Math.max(...episodeIndices)).toBeGreaterThanOrEqual(810)
    expect(sampled.some(guid => guid.startsWith('highlight-'))).toBe(true)
    expect(sampled.some(guid => guid.startsWith('fragment-'))).toBe(true)

    await estimator.estimate(videos, 'auto', '/unused')
    expect(estimateSizeFromMaster).toHaveBeenCalledTimes(result.estimatedCount)
  })

  it('does not borrow an episode average for a fragment stratum without a valid sample', async () => {
    const videos = [
      ...Array.from({ length: 500 }, (_, index) => ({ guid: `episode-${index}`, time: '2024-01-01' })),
      ...Array.from({ length: 20 }, (_, index) => ({
        guid: `fragment-${index}`, time: '2024-01-01', contentType: 'fragment' as const
      }))
    ]
    const estimateSizeFromMaster = vi.fn(async (guid: string) => guid.startsWith('episode-') ? 1000 : undefined)
    const resolveSegmentUrls = vi.fn().mockResolvedValue({ segmentUrls: [], encrypted: false })
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls }, () => null)
      .estimate(videos, 'auto', '/unused')

    expect(result.estimatedBytes).toBe(500_000)
    expect(result.estimatedCount + (result.projectedCount || 0)).toBe(500)
    expect(result.totalCount).toBe(520)
  })

  it('does not project a direct m3u8 item from ordinary CCTV episodes', async () => {
    const videos = [
      ...Array.from({ length: 500 }, (_, index) => ({ guid: `episode-${index}`, time: '2024-01-01' })),
      ...Array.from({ length: 20 }, (_, index) => ({
        guid: `direct-${index}`, time: '2024-01-01', m3u8Url: 'https://example.com/direct.m3u8'
      }))
    ]
    const estimateSizeFromMaster = vi.fn().mockResolvedValue(1000)
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls: vi.fn() }, () => null)
      .estimate(videos, 'auto', '/unused')
    expect(result.estimatedBytes).toBe(500_000)
    expect(result.estimatedCount + (result.projectedCount || 0)).toBe(500)
    expect(result.totalCount).toBe(520)
  })

  it('estimates a small batch individually', async () => {
    const estimateSizeFromMaster = vi.fn().mockResolvedValue(1000)
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls: vi.fn() }, () => null)
      .estimate(Array.from({ length: 2 }, (_, index) => ({ guid: `episode-${index}` })), 'auto', '/unused')
    expect(estimateSizeFromMaster).toHaveBeenCalledTimes(2)
    expect(result.projectedCount).toBeUndefined()
  })

  it('covers all 188 videos by monthly sampling rather than leaving unvisited items unknown', async () => {
    const videos = Array.from({ length: 188 }, (_, index) => ({
      guid: `episode-${index}`,
      time: `2026-${String(Math.min(9, Math.floor(index / 21) + 1)).padStart(2, '0')}-01`
    }))
    const estimateSizeFromMaster = vi.fn().mockResolvedValue(1000)
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls: vi.fn() }, () => null)
      .estimate(videos, 'auto', '/unused')
    expect(estimateSizeFromMaster).toHaveBeenCalledTimes(27)
    expect(result.estimatedCount).toBe(27)
    expect(result.projectedCount).toBe(161)
    expect(result.estimatedBytes).toBe(188_000)
  })

  it('keeps different yearly video sizes separate over a very large history', async () => {
    const videos = Array.from({ length: 20_000 }, (_, index) => ({
      guid: `history-${index}`,
      time: `${2000 + Math.floor(index / 200)}-01-01`
    }))
    const estimateSizeFromMaster = vi.fn(async (guid: string) => {
      const yearOffset = Math.floor(Number(guid.slice('history-'.length)) / 200)
      return 1000 + yearOffset * 10
    })
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls: vi.fn() }, () => null)
      .estimate(videos, 'auto', '/unused')
    const exactTotal = videos.reduce((sum, _video, index) => sum + 1000 + Math.floor(index / 200) * 10, 0)
    expect(estimateSizeFromMaster.mock.calls.length).toBeLessThanOrEqual(120)
    expect(result.estimatedCount + (result.projectedCount || 0)).toBe(20_000)
    expect(Math.abs(result.estimatedBytes - exactTotal) / exactTotal).toBeLessThan(0.01)
  })

  it('stops a large sampled batch when the upstream estimator is consistently unavailable', async () => {
    const estimateSizeFromMaster = vi.fn().mockRejectedValue(new Error('network unavailable'))
    const resolveSegmentUrls = vi.fn().mockRejectedValue(new Error('network unavailable'))
    const result = await new DownloadEstimator({ estimateSizeFromMaster, resolveSegmentUrls }, () => null)
      .estimate(Array.from({ length: 1000 }, (_, index) => ({
        guid: `video-${index}`,
        time: `${2020 + Math.floor(index / 100)}-${String(Math.floor(index % 100 / 10) + 1).padStart(2, '0')}-01`
      })), 'auto', '/unused')
    expect(result.stoppedEarly).toBe(true)
    expect(result.estimatedCount).toBe(0)
    expect(result.projectedCount).toBeUndefined()
    expect(estimateSizeFromMaster.mock.calls.length).toBeLessThan(50)
  })
})
