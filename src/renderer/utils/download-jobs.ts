import type { DownloadEstimate, DownloadJob, Settings, VideoInfo } from '../../shared/types'
import { buildOutputPath } from '../../shared/filename'

export function buildDownloadJobs(videos: VideoInfo[], settings: Settings): DownloadJob[] {
  return videos.map(video => {
    const job: DownloadJob = {
      id: crypto.randomUUID(), guid: video.guid,
      sourceUrl: video.sourceUrl ?? video.guid, title: video.title,
      savePath: buildOutputPath(settings.savePath, video.title),
      quality: settings.quality, threadCount: settings.threadCount,
      reencode: settings.reencode ?? false,
      state: 'Created', stage: 'None', progressPercent: 0
    }
    if (video.m3u8Url) job.m3u8Url = video.m3u8Url
    if (video.sourceVideoIndex != null) job.sourceVideoIndex = video.sourceVideoIndex
    return job
  })
}

export async function prepareDownloadBatch(videos: VideoInfo[], downloaded: Set<string>, forceRedownload = false): Promise<{
  settings: Settings
  candidates: VideoInfo[]
  skippedHistory: number
  estimate: DownloadEstimate
}> {
  const settings = await window.cctvdlApi.getSettings()
  const candidates = forceRedownload ? videos : videos.filter(video => !downloaded.has(video.guid))
  const inputs = candidates.map(video => ({
    guid: video.guid, m3u8Url: video.m3u8Url, estimatedSizeBytes: video.estimatedSizeBytes,
    contentType: video.contentType, time: video.time
  }))
  const estimate = await window.cctvdlApi.estimateDownload(inputs, settings.quality, settings.savePath)
    .catch(() => ({ estimatedBytes: 0, estimatedCount: 0, totalCount: inputs.length, diskFreeBytes: null }))
  return { settings, candidates, skippedHistory: videos.length - candidates.length, estimate }
}

export function startDownloadBatch(videos: VideoInfo[], settings: Settings, autoOpen = false, forceRedownload = false) {
  return window.cctvdlApi.startDownload(buildDownloadJobs(videos, settings), autoOpen, forceRedownload)
}
