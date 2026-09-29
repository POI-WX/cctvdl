import type { VideoInfo } from './types'

const MAX_MONTHS = 1200

export function enumerateMonths(start: string, end: string): string[] {
  const parse = (value: string): number => {
    if (!/^\d{6}$/.test(value)) throw new Error('请选择有效的起止月份')
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4))
    if (year < 1900 || month < 1 || month > 12) throw new Error('请选择有效的起止月份')
    return year * 12 + month - 1
  }
  const first = parse(start)
  const last = parse(end)
  if (first > last) throw new Error('起始月份不能晚于结束月份')
  if (last - first + 1 > MAX_MONTHS) throw new Error('时间范围不能超过 100 年')
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const value = first + index
    return `${Math.floor(value / 12)}${String(value % 12 + 1).padStart(2, '0')}`
  })
}

export interface MonthScanProgress {
  completed: number
  total: number
  found: number
  failedMonths: string[]
}

export interface MonthScanResult extends MonthScanProgress {
  byMonth: Map<string, VideoInfo[]>
  errors: Map<string, string>
  videos: VideoInfo[]
  cancelled: boolean
}

function uniqueVideos(months: string[], byMonth: Map<string, VideoInfo[]>): VideoInfo[] {
  const seen = new Set<string>()
  const videos: VideoInfo[] = []
  for (const month of months) {
    for (const video of byMonth.get(month) || []) {
      if (!video.guid || seen.has(video.guid)) continue
      seen.add(video.guid)
      videos.push(video)
    }
  }
  return videos
}

export async function scanMonths(
  months: string[],
  loadMonth: (month: string) => Promise<VideoInfo[]>,
  options: {
    concurrency?: number
    signal?: AbortSignal
    previous?: Map<string, VideoInfo[]>
    onProgress?: (progress: MonthScanProgress) => void
  } = {}
): Promise<MonthScanResult> {
  const byMonth = new Map(months
    .filter(month => options.previous?.has(month))
    .map(month => [month, options.previous?.get(month) || []] as const))
  const foundGuids = new Set(uniqueVideos(months, byMonth).map(video => video.guid))
  const errors = new Map<string, string>()
  const pending = months.filter(month => !byMonth.has(month))
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)))
  let cursor = 0
  let completed = months.length - pending.length
  const report = () => options.onProgress?.({
    completed,
    total: months.length,
    found: foundGuids.size,
    failedMonths: months.filter(month => errors.has(month))
  })

  async function worker(): Promise<void> {
    while (!options.signal?.aborted && cursor < pending.length) {
      const month = pending[cursor++]
      try {
        const videos = await loadMonth(month)
        if (options.signal?.aborted) return
        byMonth.set(month, videos)
        for (const video of videos) if (video.guid) foundGuids.add(video.guid)
      } catch (error) {
        if (options.signal?.aborted) return
        errors.set(month, String(error))
      }
      completed++
      report()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()))
  const videos = uniqueVideos(months, byMonth)
  return {
    byMonth,
    errors,
    videos,
    completed,
    total: months.length,
    found: videos.length,
    failedMonths: months.filter(month => errors.has(month)),
    cancelled: options.signal?.aborted ?? false
  }
}
