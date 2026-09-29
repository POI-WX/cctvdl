import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDownloadJobs, prepareDownloadBatch, startDownloadBatch } from '../../../src/renderer/utils/download-jobs'
import type { Settings, VideoInfo } from '../../../src/shared/types'

const settings: Settings = {
  savePath: 'C:\\Videos', quality: 'auto', threadCount: 8, reencode: false,
  logLevel: 'info'
}
const videos: VideoInfo[] = [
  { guid: 'old', title: '已下载', brief: '', coverUrl: '', time: '2024-01-01' },
  { guid: 'new', title: '待下载', brief: '', coverUrl: '', time: '2024-02-01', sourceUrl: 'https://example.test/video', sourceVideoIndex: 2 }
]
const getSettings = vi.fn().mockResolvedValue(settings)
const estimateDownload = vi.fn().mockResolvedValue({
  estimatedBytes: 1024, estimatedCount: 1, totalCount: 1, diskFreeBytes: 2048
})
const startDownload = vi.fn().mockResolvedValue({ added: 1, skipped: 1, addedGuids: ['new'] })
vi.stubGlobal('window', { cctvdlApi: { getSettings, estimateDownload, startDownload } })

describe('shared renderer download batch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('estimates only videos not in history and preserves all jobs for coordinator dedupe', async () => {
    const prepared = await prepareDownloadBatch(videos, new Set(['old']))
    expect(prepared.candidates.map(video => video.guid)).toEqual(['new'])
    expect(prepared.skippedHistory).toBe(1)
    expect(estimateDownload).toHaveBeenCalledWith([
      { guid: 'new', m3u8Url: undefined, estimatedSizeBytes: undefined,
        contentType: undefined, time: '2024-02-01' }
    ], 'auto', 'C:\\Videos')

    await startDownloadBatch(videos, prepared.settings, true)
    const jobs = startDownload.mock.calls[0][0]
    expect(jobs.map((job: { guid: string }) => job.guid)).toEqual(['old', 'new'])
    expect(jobs[1]).toMatchObject({
      sourceUrl: 'https://example.test/video', sourceVideoIndex: 2,
      quality: 'auto', threadCount: 8, state: 'Created', stage: 'None'
    })
    expect(startDownload).toHaveBeenCalledWith(jobs, true, false)
  })

  it('redownload includes history in the estimate and carries direct m3u8 jobs', async () => {
    const direct = { ...videos[0], m3u8Url: 'https://example.test/playlist.m3u8' }
    const prepared = await prepareDownloadBatch([direct], new Set(['old']), true)
    expect(prepared.candidates).toHaveLength(1)
    expect(buildDownloadJobs([direct], settings)[0].m3u8Url).toBe(direct.m3u8Url)
    await startDownloadBatch([direct], settings, false, true)
    expect(startDownload.mock.calls[0][2]).toBe(true)
  })

  it('keeps download usable when only size estimation fails', async () => {
    estimateDownload.mockRejectedValueOnce(new Error('estimate unavailable'))
    const prepared = await prepareDownloadBatch(videos, new Set(['old']))
    expect(prepared.estimate).toEqual({
      estimatedBytes: 0, estimatedCount: 0, totalCount: 1, diskFreeBytes: null
    })
  })
})
