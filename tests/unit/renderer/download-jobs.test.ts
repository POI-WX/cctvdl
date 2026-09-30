import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDownloadJob, buildDownloadJobs, prepareDownloadBatch, startDownloadBatch } from '../../../src/renderer/utils/download-jobs'
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

  it('rebuilds a minimal retry with its original id and current settings', () => {
    const job = buildDownloadJob({ guid: 'retry', title: '测试视频 1' }, settings, { id: 'original-id' })
    expect(job).toEqual({
      id: 'original-id', guid: 'retry', sourceUrl: 'retry', title: '测试视频 1',
      savePath: 'C:\\Videos/测试视频 1.mp4', saveRoot: 'C:\\Videos',
      quality: 'auto', threadCount: 8, reencode: false,
      state: 'Created', stage: 'None', progressPercent: 0
    })
  })

  it('creates independent jobs retaining source metadata and a settings snapshot', () => {
    const selectedSettings = { ...settings, groupByProgram: true }
    const source = { guid: 'direct', title: '测试视频 1', sourceUrl: 'https://example.test/article',
      m3u8Url: 'https://example.test/stream.m3u8', sourceVideoIndex: 0 }
    const job = buildDownloadJob(source, selectedSettings, { programName: '测试专辑 1' })
    const second = buildDownloadJob(source, selectedSettings)
    expect(job.id).not.toBe(second.id)
    selectedSettings.savePath = 'C:\\OtherVideos'
    selectedSettings.quality = 'liuchang'
    expect(job).toMatchObject({
      savePath: 'C:\\Videos\\测试专辑 1/测试视频 1.mp4', saveRoot: 'C:\\Videos', quality: 'auto',
      sourceUrl: source.sourceUrl, m3u8Url: source.m3u8Url, sourceVideoIndex: 0, programName: '测试专辑 1'
    })
  })

  it('estimates only videos not in history and preserves all jobs for coordinator dedupe', async () => {
    const prepared = await prepareDownloadBatch(videos, new Set(['old']))
    expect(prepared.candidates.map(video => video.guid)).toEqual(['new'])
    expect(prepared.skippedHistory).toBe(1)
    expect(estimateDownload).toHaveBeenCalledWith([
      { guid: 'new', m3u8Url: undefined, estimatedSizeBytes: undefined,
        contentType: undefined, time: '2024-02-01' }
    ], 'auto', 'C:\\Videos')

    await startDownloadBatch(videos, prepared.settings)
    const jobs = startDownload.mock.calls[0][0]
    expect(jobs.map((job: { guid: string }) => job.guid)).toEqual(['old', 'new'])
    expect(jobs[1]).toMatchObject({
      sourceUrl: 'https://example.test/video', sourceVideoIndex: 2,
      quality: 'auto', threadCount: 8, state: 'Created', stage: 'None'
    })
    expect(startDownload).toHaveBeenCalledWith(jobs, false)
  })

  it('redownload includes history in the estimate and carries direct m3u8 jobs', async () => {
    const direct = { ...videos[0], m3u8Url: 'https://example.test/playlist.m3u8' }
    const prepared = await prepareDownloadBatch([direct], new Set(['old']), true)
    expect(prepared.candidates).toHaveLength(1)
    expect(buildDownloadJobs([direct], settings)[0].m3u8Url).toBe(direct.m3u8Url)
    await startDownloadBatch([direct], settings, true)
    expect(startDownload.mock.calls[0][1]).toBe(true)
  })

  it('keeps download usable when only size estimation fails', async () => {
    estimateDownload.mockRejectedValueOnce(new Error('estimate unavailable'))
    const prepared = await prepareDownloadBatch(videos, new Set(['old']))
    expect(prepared.estimate).toEqual({
      estimatedBytes: 0, estimatedCount: 0, totalCount: 1, diskFreeBytes: null
    })
  })

  it('separates mixed programme and independent videos when enabled', async () => {
    const mixed = [...videos, { ...videos[1], guid: 'single', title: '独立视频' }]
    const names = new Map([['old', '测试栏目 1'], ['new', '测试专辑 2']])
    const grouped = { ...settings, groupByProgram: true }
    getSettings.mockResolvedValueOnce(grouped)
    const prepared = await prepareDownloadBatch(mixed, new Set(), false, names)

    expect(prepared.destinations).toEqual([
      { path: 'C:\\Videos\\测试栏目 1', count: 1 },
      { path: 'C:\\Videos\\测试专辑 2', count: 1 },
      { path: 'C:\\Videos', count: 1 }
    ])
    const jobs = buildDownloadJobs(mixed, grouped, prepared.programNames)
    expect(jobs.map(job => job.savePath)).toEqual([
      'C:\\Videos\\测试栏目 1/已下载.mp4', 'C:\\Videos\\测试专辑 2/待下载.mp4', 'C:\\Videos/独立视频.mp4'
    ])
    expect(jobs.map(job => job.programName)).toEqual(['测试栏目 1', '测试专辑 2', undefined])
  })

  it('keeps flat output when disabled and retains origin for history redownload', () => {
    const jobs = buildDownloadJobs(videos, settings, new Map([['new', '栏目']]))
    expect(jobs[1]).toMatchObject({ savePath: 'C:\\Videos/待下载.mp4', programName: '栏目' })
  })

  it('previews only pending destinations and carries the same paths into the queue', async () => {
    const names = new Map([['old', '已下载节目'], ['new', '待下载节目']])
    getSettings.mockResolvedValueOnce({ ...settings, groupByProgram: true })
    const prepared = await prepareDownloadBatch(videos, new Set(['old']), false, names)
    expect(prepared.destinations).toEqual([{ path: 'C:\\Videos\\待下载节目', count: 1 }])
    await startDownloadBatch(videos, prepared.settings, false, prepared.programNames)
    expect(startDownload.mock.calls[0][0][1].savePath).toBe('C:\\Videos\\待下载节目/待下载.mp4')
  })
})
