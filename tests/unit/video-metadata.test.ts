import { describe, expect, it, vi } from 'vitest'
import {
  readVideoDurationSeconds,
  sortVideosChronologically,
  VideoMetadataLoader
} from '../../src/shared/video-metadata'
import type { VideoMetadata } from '../../src/shared/video-metadata'

describe('video metadata helpers', () => {
  it('parses numeric and clock-formatted CCTV durations', () => {
    expect(readVideoDurationSeconds({ video: { totalLength: '3723.84' } })).toBe(3724)
    expect(readVideoDurationSeconds({ len: '01:02:03' })).toBe(3723)
    expect(readVideoDurationSeconds({ len: 'invalid' })).toBeUndefined()
  })

  it('sorts dated videos oldest-first and keeps unknown dates stable at the end', () => {
    const videos = [
      { guid: 'unknown-1', title: '', brief: '', coverUrl: '', time: '' },
      { guid: 'new', title: '', brief: '', coverUrl: '', time: '2026-02-01' },
      { guid: 'old', title: '', brief: '', coverUrl: '', time: '2026-01-01' },
      { guid: 'unknown-2', title: '', brief: '', coverUrl: '', time: '' }
    ]
    expect(sortVideosChronologically(videos).map(video => video.guid)).toEqual([
      'old', 'new', 'unknown-1', 'unknown-2'
    ])
  })

  it('coalesces concurrent requests and caches even an empty successful result', async () => {
    let release!: (value: VideoMetadata) => void
    const pending = new Promise<VideoMetadata>(resolve => { release = resolve })
    const fetchMetadata = vi.fn(() => pending)
    const loader = new VideoMetadataLoader(fetchMetadata)

    const first = loader.get('guid')
    const second = loader.get('guid')
    release({})

    await expect(Promise.all([first, second])).resolves.toEqual([{}, {}])
    await expect(loader.get('guid')).resolves.toEqual({})
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
  })

  it('cools down failures and retries after the cooldown expires', async () => {
    let now = 1_000
    const fetchMetadata = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ channel: 'CCTV-1' })
    const loader = new VideoMetadataLoader(fetchMetadata, 30_000, () => now)

    await expect(loader.get('guid')).resolves.toBeUndefined()
    await expect(loader.get('guid')).resolves.toBeUndefined()
    expect(fetchMetadata).toHaveBeenCalledTimes(1)

    now += 30_001
    await expect(loader.get('guid')).resolves.toEqual({ channel: 'CCTV-1' })
    expect(fetchMetadata).toHaveBeenCalledTimes(2)
  })
})
