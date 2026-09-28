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

  it('limits concurrent requests and stops unresolved work at the deadline', async () => {
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
    const videos = Array.from({ length: 12 }, (_, i) => ({ guid: `video-${i}` }))
    const result = await new DownloadEstimator({ resolveSegmentUrls }, () => 100, 20)
      .estimate(videos, 'auto', '/unused')

    expect(maxActive).toBe(4)
    expect(result.estimatedCount).toBeLessThan(12)
    expect(result.totalCount).toBe(12)
    expect(active).toBe(0)
  })
})
