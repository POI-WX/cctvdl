import type { VideoInfo } from './types'

export type VideoMetadata = Pick<VideoInfo, 'channel' | 'durationSeconds'>
export type VideoMetadataFetcher = (guid: string) => Promise<VideoMetadata>

/** Parse the duration formats returned by CCTV's old and new JSON APIs. */
export function readVideoDurationSeconds(data: Record<string, unknown>): number | undefined {
  const video = (data['video'] as Record<string, unknown> | undefined) || {}
  const raw = video['totalLength'] ?? data['totalLength'] ?? data['len']
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.round(raw)
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  if (/^\d+(?:\.\d+)?$/.test(raw.trim())) return Math.round(Number(raw))
  const parts = raw.trim().split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return undefined
  return Math.round(parts.reduce((total, part) => total * 60 + part, 0))
}

/** Sort dated videos oldest-to-newest and keep unknown dates stable at the end. */
export function sortVideosChronologically(videos: VideoInfo[]): VideoInfo[] {
  return videos
    .map((video, index) => ({ video, index }))
    .sort((a, b) => {
      if (!a.video.time && !b.video.time) return a.index - b.index
      if (!a.video.time) return 1
      if (!b.video.time) return -1
      return a.video.time.localeCompare(b.video.time) || a.index - b.index
    })
    .map(({ video }) => video)
}

/**
 * Coalesces metadata requests by guid, caches successful results (including an
 * empty result), and briefly cools down failures so repeated clicks do not
 * amplify a slow or unavailable upstream request.
 */
export class VideoMetadataLoader {
  private readonly cache = new Map<string, VideoMetadata>()
  private readonly inflight = new Map<string, Promise<VideoMetadata | undefined>>()
  private readonly retryAfter = new Map<string, number>()

  constructor(
    private readonly fetchMetadata: VideoMetadataFetcher,
    private readonly failureCooldownMs = 30_000,
    private readonly now: () => number = Date.now
  ) {}

  async get(guid: string): Promise<VideoMetadata | undefined> {
    if (this.cache.has(guid)) return this.cache.get(guid)
    if ((this.retryAfter.get(guid) || 0) > this.now()) return undefined

    let request = this.inflight.get(guid)
    if (!request) {
      request = this.fetchMetadata(guid)
        .then(metadata => {
          this.cache.set(guid, metadata)
          this.retryAfter.delete(guid)
          return metadata
        })
        .catch(() => {
          this.retryAfter.set(guid, this.now() + this.failureCooldownMs)
          return undefined
        })
        .finally(() => {
          this.inflight.delete(guid)
        })
      this.inflight.set(guid, request)
    }
    return request
  }
}
