import type { ProgramMonthBounds, VideoInfo } from '../../shared/types'
import { readVideoDurationSeconds } from '../../shared/video-metadata'

/** Clean a CCTV brief field into display-ready plain text. */
export function cleanBrief(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^(?:本期节目)?(?:主要内容)[：:]\s*/u, '')
    // Match the final attribution as a whole so nested episode parentheses do not truncate it.
    .replace(/\s*（《[\s\S]*$/u, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extract a display name using CCTV's stable metadata priority. */
export function extractTitle(html: string): string {
  const commentTitleMatch = html.match(/var\s+commentTitle\s*=\s*["']([^"']+)["']/)
  if (commentTitleMatch) {
    const bookMatch = commentTitleMatch[1].match(/《([^》]+)》/)
    return bookMatch ? bookMatch[1] : commentTitleMatch[1].split(/\s+\d/)[0].trim()
  }
  const ogTitleMatch = html.match(/<meta\b(?=[^>]*\bproperty=["']og:title["'])(?=[^>]*\bcontent=["']([^"']+)["'])[^>]*>/i)
  if (ogTitleMatch) return normalizePageTitle(ogTitleMatch[1])
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
  return titleMatch ? normalizePageTitle(titleMatch[1]) : ''
}

function normalizePageTitle(raw: string): string {
  const title = raw.trim()
    .replace(/_CCTV节目官网.*$/i, '')
    .replace(/-CCTV.*$/i, '')
    .replace(/_央视网.*$/i, '')
    .replace(/\s+(?:CCTV节目官网|央视节目官网|央视网)$/i, '')
    .replace(/节目视频$/, '')
    .replace(/视频$/, '')
    .replace(/节目$/, '')
    .trim()
  const bookMatch = title.match(/《([^》]+)》/)
  return bookMatch ? bookMatch[1].trim() : title
}

export function mapVideoItem(item: Record<string, unknown>): VideoInfo {
  const focusDate = formatVideoTime(item['focus_date'])
  const channel = readVideoChannel(item)
  const durationSeconds = readVideoDurationSeconds(item)
  return {
    guid: String(item['guid'] || ''),
    title: String(item['title'] || ''),
    brief: cleanBrief(String(item['brief'] || '')),
    coverUrl: String(item['image'] || ''),
    time: focusDate || String(item['time'] || ''),
    ...(channel ? { channel } : {}),
    ...(durationSeconds != null ? { durationSeconds } : {})
  }
}

export function mapVcctvVideoItem(item: Record<string, unknown>): VideoInfo {
  const channel = String(item['mediaName'] || '').trim()
  const durationSeconds = readVideoDurationSeconds({ len: item['vduration'] })
  return {
    guid: String(item['guid'] || ''),
    title: String(item['title'] || ''),
    brief: cleanBrief(String(item['vbrief'] || '')),
    coverUrl: String(item['image1'] || ''),
    time: formatVideoTime(item['pubTime']),
    ...(channel ? { channel } : {}),
    ...(durationSeconds != null ? { durationSeconds } : {})
  }
}

export function mapTopicFragment(item: Record<string, unknown>): VideoInfo {
  return {
    guid: String(item['guid'] || ''),
    title: String(item['video_title'] || item['title'] || ''),
    brief: cleanBrief(String(item['sc'] || item['brief'] || '')),
    coverUrl: String(item['video_key_frame_url'] || item['image'] || ''),
    time: formatVideoTime(item['video_shared_code']) || String(item['time'] || ''),
    contentType: 'fragment'
  }
}

export function readVideoChannel(item: Record<string, unknown>): string {
  return String(item['channel'] || item['play_channel'] || '').trim()
}

export function cleanProgramName(name: string): string {
  return name.trim().replace(/^《([^》]+)》(.*)$/, '$1$2')
}

export function formatVideoTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return formatUnixMsChina(value)
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^\d+$/.test(trimmed) ? formatUnixMsChina(Number(trimmed)) : trimmed
}

function formatUnixMsChina(ms: number): string {
  const date = new Date(ms + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export function monthFromVideoTime(time: string): string {
  const match = time.match(/^(\d{4})[-/]?(\d{2})/)
  return match ? `${match[1]}${match[2]}` : ''
}

export function monthBoundsFromEdges(
  earliestItems: Array<Record<string, unknown>>,
  latestItems: Array<Record<string, unknown>>
): ProgramMonthBounds {
  const months = (items: Array<Record<string, unknown>>): string[] => items
    .map(item => monthFromVideoTime(formatVideoTime(item['focus_date']) || String(item['time'] || '')))
    .filter(Boolean)
  const earliestMonths = months(earliestItems)
  const latestMonths = months(latestItems)
  return {
    earliest: earliestMonths.length ? earliestMonths.reduce((a, b) => a < b ? a : b) : null,
    latest: latestMonths.length ? latestMonths.reduce((a, b) => a > b ? a : b) : null
  }
}

export function monthNumber(value: string): number | null {
  const month = monthFromVideoTime(value)
  return month ? Number(month.slice(0, 4)) * 12 + Number(month.slice(4, 6)) - 1 : null
}
