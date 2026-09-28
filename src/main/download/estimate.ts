import fs from 'fs'
import path from 'path'
import { CctvApiService } from '../api/cctv'
import type { DownloadEstimate, DownloadEstimateInput, Quality } from '../../shared/types'

export function readDiskFreeBytes(savePath: string): number | null {
  if (!savePath.trim()) return null
  try {
    let existing = path.resolve(savePath)
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing)
      if (parent === existing) return null
      existing = parent
    }
    const stats = fs.statfsSync(existing, { bigint: true })
    const bytes = stats.bavail * stats.bsize
    return bytes >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null
  } catch {
    return null
  }
}

export class DownloadEstimator {
  constructor(
    private readonly api: Pick<CctvApiService, 'resolveSegmentUrls'> = new CctvApiService(),
    private readonly diskFree: (savePath: string) => number | null = readDiskFreeBytes,
    private readonly timeoutMs = 12_000
  ) {}

  async estimate(
    videos: DownloadEstimateInput[], quality: Quality, savePath: string
  ): Promise<DownloadEstimate> {
    const result: DownloadEstimate = {
      estimatedBytes: 0,
      estimatedCount: 0,
      totalCount: videos.length,
      diskFreeBytes: this.diskFree(savePath)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let next = 0
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted && next < videos.length) {
        const video = videos[next++]
        let bytes = video.estimatedSizeBytes
        if (!(typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0) && !video.m3u8Url) {
          try {
            const stream = await this.api.resolveSegmentUrls(video.guid, quality, controller.signal)
            const { estimatedBandwidth, durationSeconds } = stream
            bytes = estimatedBandwidth && durationSeconds && durationSeconds <= 24 * 3600
              ? Math.round(estimatedBandwidth * durationSeconds / 8)
              : undefined
          } catch { /* Missing upstream metadata leaves this item unestimated. */ }
        }
        if (typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0) {
          result.estimatedBytes += bytes
          result.estimatedCount++
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, videos.length) }, worker))
    } finally {
      clearTimeout(timer)
    }
    return result
  }
}
