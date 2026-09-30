import type { DownloadEstimate, DownloadJob, Settings, VideoInfo } from '../../shared/types'
import { buildOutputPath, buildProgramDirectory } from '../../shared/filename'

export function downloadDirectory(settings: Settings, programName?: string): string {
  return buildProgramDirectory(settings.savePath, settings.groupByProgram ? programName : undefined)
}

type DownloadSource = Pick<VideoInfo, 'guid' | 'title' | 'sourceUrl' | 'm3u8Url' | 'sourceVideoIndex'>

export function buildDownloadJob(video: DownloadSource, settings: Settings,
  options: { id?: string; programName?: string } = {}): DownloadJob {
  const { programName } = options
  const job: DownloadJob = {
    id: options.id ?? crypto.randomUUID(), guid: video.guid,
    sourceUrl: video.sourceUrl ?? video.guid, title: video.title,
    savePath: buildOutputPath(downloadDirectory(settings, programName), video.title),
    saveRoot: settings.savePath,
    quality: settings.quality, threadCount: settings.threadCount,
    reencode: settings.reencode ?? false,
    state: 'Created', stage: 'None', progressPercent: 0
  }
  if (programName) job.programName = programName
  if (video.m3u8Url) job.m3u8Url = video.m3u8Url
  if (video.sourceVideoIndex != null) job.sourceVideoIndex = video.sourceVideoIndex
  return job
}

export function buildDownloadJobs(videos: readonly DownloadSource[], settings: Settings, programNames: ReadonlyMap<string, string> = new Map()): DownloadJob[] {
  return videos.map(video => buildDownloadJob(video, settings, { programName: programNames.get(video.guid) }))
}

export async function prepareDownloadBatch(videos: VideoInfo[], downloaded: Set<string>, forceRedownload = false,
  programNames: ReadonlyMap<string, string> = new Map()): Promise<{
  settings: Settings
  candidates: VideoInfo[]
  skippedHistory: number
  estimate: DownloadEstimate
  programNames: ReadonlyMap<string, string>
  destinations: Array<{ path: string; count: number }>
}> {
  const settings = await window.cctvdlApi.getSettings()
  const candidates = forceRedownload ? videos : videos.filter(video => !downloaded.has(video.guid))
  const inputs = candidates.map(video => ({
    guid: video.guid, m3u8Url: video.m3u8Url, estimatedSizeBytes: video.estimatedSizeBytes,
    contentType: video.contentType, time: video.time
  }))
  const estimate = await window.cctvdlApi.estimateDownload(inputs, settings.quality, settings.savePath)
    .catch(() => ({ estimatedBytes: 0, estimatedCount: 0, totalCount: inputs.length, diskFreeBytes: null }))
  const destinations = new Map<string, number>()
  for (const video of candidates) {
    const directory = downloadDirectory(settings, programNames.get(video.guid))
    destinations.set(directory, (destinations.get(directory) ?? 0) + 1)
  }
  return { settings, candidates, skippedHistory: videos.length - candidates.length, estimate,
    programNames: new Map(programNames),
    destinations: Array.from(destinations, ([path, count]) => ({ path, count })) }
}

export function startDownloadBatch(videos: VideoInfo[], settings: Settings, forceRedownload = false,
  programNames: ReadonlyMap<string, string> = new Map()) {
  return window.cctvdlApi.startDownload(buildDownloadJobs(videos, settings, programNames), forceRedownload)
}
