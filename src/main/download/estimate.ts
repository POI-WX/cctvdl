import fs from 'fs'
import path from 'path'
import { CctvApiService } from '../api/cctv'
import type { DownloadEstimate, DownloadEstimateInput, Quality } from '../../shared/types'

const MAX_SAMPLES = 120
const SAMPLES_PER_STRATUM = 3

function monthIndex(time: string | undefined): number | null {
  const match = time?.match(/^(\d{4})[-/]?(\d{2})/)
  if (!match) return null
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? Number(match[1]) * 12 + month - 1 : null
}

function planSamples(videos: DownloadEstimateInput[]): {
  selected: number[]
  groups: Map<string, number[]>
  groupKeys: string[]
} {
  const dates = videos.map(video => monthIndex(video.time))
  const types = videos.map(video => `${video.m3u8Url ? 'direct' : 'cctv'}:${video.contentType || 'episode'}`)
  const earliest = dates.reduce<number>((min, value) => value == null ? min : Math.min(min, value), Infinity)
  const latest = dates.reduce<number>((max, value) => value == null ? max : Math.max(max, value), -Infinity)
  const span = Number.isFinite(earliest) ? latest - earliest + 1 : 1
  const typeCount = new Set(types).size || 1
  const maxBuckets = Math.max(1, Math.floor(MAX_SAMPLES / (SAMPLES_PER_STRATUM * typeCount)) - 1)
  const bucketWidth = Math.max(1, Math.ceil(span / maxBuckets))
  const groups = new Map<string, number[]>()
  const groupKeys: string[] = []
  videos.forEach((video, index) => {
    const month = dates[index]
    const key = `${types[index]}:${month == null ? 'unknown' : Math.floor((month - earliest) / bucketWidth)}`
    groupKeys.push(key)
    const items = groups.get(key) || []
    items.push(index)
    groups.set(key, items)
  })
  const groupSamples: number[][] = []
  for (const items of groups.values()) {
    const count = Math.min(SAMPLES_PER_STRATUM, items.length)
    const samples: number[] = []
    for (let index = 0; index < count; index++) {
      samples.push(items[Math.floor((index + 0.5) * items.length / count)])
    }
    groupSamples.push(samples)
  }
  const selected: number[] = []
  const sampleCount = groupSamples.reduce((sum, samples) => sum + samples.length, 0)
  for (let position = 0; selected.length < sampleCount; position++) {
    for (const samples of groupSamples) if (position < samples.length) selected.push(samples[position])
  }
  return { selected, groups, groupKeys }
}

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
  private readonly sizeCache = new Map<string, number>()

  constructor(
    private readonly api: Pick<CctvApiService, 'resolveSegmentUrls'> & Partial<Pick<CctvApiService, 'estimateSizeFromMaster'>> = new CctvApiService(),
    private readonly diskFree: (savePath: string) => number | null = readDiskFreeBytes,
    private readonly timeoutMs = 12_000,
    private readonly concurrency = 8
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
    const { selected, groups, groupKeys } = planSamples(videos)
    const known = new Set<number>()
    const knownByGroup = new Map<string, { count: number; bytes: number }>()
    const record = (index: number, bytes: number) => {
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || known.has(index)) return
      known.add(index)
      result.estimatedBytes += bytes
      result.estimatedCount++
      const key = groupKeys[index]
      const group = knownByGroup.get(key) || { count: 0, bytes: 0 }
      group.count++
      group.bytes += bytes
      knownByGroup.set(key, group)
    }
    videos.forEach((video, index) => {
      const bytes = video.estimatedSizeBytes ?? this.sizeCache.get(`${quality}:${video.guid}`)
      if (typeof bytes === 'number') record(index, bytes)
    })
    const work = selected.filter(index => !known.has(index))
    let next = 0
    let consecutiveFailures = 0
    let stoppedEarly = false
    const worker = async (): Promise<void> => {
      while (!stoppedEarly && next < work.length) {
        const index = work[next++]
        const video = videos[index]
        const cacheKey = `${quality}:${video.guid}`
        let bytes: number | undefined
        if (!video.m3u8Url) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), this.timeoutMs)
          try {
            bytes = this.api.estimateSizeFromMaster
              ? await this.api.estimateSizeFromMaster(video.guid, quality, controller.signal).catch(() => undefined)
              : undefined
            if (!(typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0) && !controller.signal.aborted) {
              const stream = await this.api.resolveSegmentUrls(video.guid, quality, controller.signal)
              const { estimatedBandwidth, durationSeconds } = stream
              bytes = estimatedBandwidth && durationSeconds && durationSeconds <= 24 * 3600
                ? Math.round(estimatedBandwidth * durationSeconds / 8)
                : undefined
            }
          } catch { /* Missing upstream metadata leaves this item unestimated. */ }
          finally { clearTimeout(timer) }
          if (typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0) {
            this.sizeCache.set(cacheKey, bytes)
            if (this.sizeCache.size > 4096) this.sizeCache.delete(this.sizeCache.keys().next().value!)
          }
          if (typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0) consecutiveFailures = 0
          else consecutiveFailures++
          if (selected.length < videos.length && consecutiveFailures >= 32) stoppedEarly = true
        }
        if (typeof bytes === 'number') record(index, bytes)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, work.length) }, worker))
    if (stoppedEarly) result.stoppedEarly = true
    if (selected.length < videos.length) {
      let projected = 0
      for (const [key, indices] of groups) {
        const group = knownByGroup.get(key)
        if (!group?.count) continue
        const remaining = indices.length - group.count
        if (!remaining) continue
        result.estimatedBytes += Math.round(group.bytes / group.count * remaining)
        projected += remaining
      }
      if (projected) result.projectedCount = projected
    }
    return result
  }
}
