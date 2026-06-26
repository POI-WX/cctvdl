import { createResilientFetch, type Fetcher, uaInit } from './http'
import type { VideoInfo, ProgramInfo } from '../../shared/types'

/**
 * Clean a CCTV brief field into display-ready plain text.
 * Strips the leading "本期节目主要内容：" prefix and trailing attribution block
 * （《title》date episode）, normalises line endings, and collapses blank lines.
 */
export function cleanBrief(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^(?:本期节目)?(?:主要内容)[：:]\s*/u, '')
    // Greedy match from the last （《 to end so nested parens (e.g. "第（一）集") don't break it
    .replace(/\s*（《[\s\S]*$/u, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export class BrowseService {
  constructor(private readonly fetch: Fetcher = createResilientFetch()) {}

  async getColumnVideoList(columnId: string, page: number, month: string): Promise<VideoInfo[]> {
    const params = new URLSearchParams({
      id: columnId, n: '100', p: String(page), d: month,
      mode: '0', serviceId: 'tvcctv', sort: 'desc'
    })
    const url = `https://api.cntv.cn/NewVideo/getVideoListByColumn?${params}`
    const resp = await this.fetch(url, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByColumn`)
    const data = await resp.json() as Record<string, unknown>
    const dataObj = data['data'] as Record<string, unknown> | undefined
    const list = (dataObj?.['list'] as Array<Record<string, unknown>>) || []
    return list.map(mapVideoItem)
  }

  // `_month` is part of the symmetric signature with getColumnVideoList but the
  // album endpoint doesn't filter by month, so it's intentionally unused.
  async getAlbumVideoList(albumId: string, page: number, _month: string): Promise<VideoInfo[]> {
    const params = new URLSearchParams({
      id: albumId, pub: '1', sort: 'asc', mode: '0',
      p: String(page), n: '100', serviceId: 'tvcctv'
    })
    const url = `https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?${params}`
    const resp = await this.fetch(url, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByAlbumIdNew`)
    const data = await resp.json() as Record<string, unknown>
    const dataObj = data['data'] as Record<string, unknown> | undefined
    const list = (dataObj?.['list'] as Array<Record<string, unknown>>) || []
    return list.map(mapVideoItem)
  }

  async resolveColumnInfo(pageUrl: string): Promise<ProgramInfo> {
    const resp = await this.fetch(pageUrl, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching page`)
    const html = await resp.text()

    // 1. Extract column ID (priority: column_id → topicID → URL path)
    let columnId = ''
    const colIdMatch = html.match(/var\s+column_id\s*=\s*["']([^"']+)["']/)
    if (colIdMatch) columnId = colIdMatch[1]

    if (!columnId) {
      const topicIdMatch = html.match(/var\s+topicID\s*=\s*["']([^"']+)["']/)
      if (topicIdMatch) columnId = topicIdMatch[1]
    }
    // No URL-slug fallback: the video API needs a real column id (TOPC…). Special
    // columns (e.g. 等着我) are standalone microsites with no column_id/topicID —
    // a slug like "dzw" only yields a zombie column whose list never resolves, so
    // we let columnId stay empty and reject below with a clear error.

    // 2. Extract column name (priority: commentTitle → <title> tag)
    let name = ''
    const commentTitleMatch = html.match(/var\s+commentTitle\s*=\s*["']([^"']+)["']/)
    if (commentTitleMatch) {
      // commentTitle format: "《我爱发明》 20190903 集名" — extract name inside 《》
      const bookMatch = commentTitleMatch[1].match(/《([^》]+)》/)
      name = bookMatch ? bookMatch[1] : commentTitleMatch[1].split(/\s+\d/)[0].trim()
    }
    if (!name) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
      if (titleMatch) {
        const title = titleMatch[1].trim()
          .replace(/_CCTV节目官网.*$/i, '')
          .replace(/-CCTV.*$/i, '')
          .replace(/_央视网.*$/i, '')
          .replace(/_央视网\(cctv\.com\).*$/i, '')
          .trim()
        const bookMatch = title.match(/《([^》]+)》/)
        name = bookMatch ? bookMatch[1] : title
      }
    }

    // 3. Extract itemid (optional, used for album fallback)
    let itemId = ''
    const itemIdMatch = html.match(/var\s+itemid1\s*=\s*["']([^"']+)["']/)
    if (itemIdMatch) itemId = itemIdMatch[1]

    if (!name || !columnId) throw new Error('无法解析节目信息')
    return { name, columnId, itemId }
  }
}

function mapVideoItem(item: Record<string, unknown>): VideoInfo {
  return {
    guid: String(item['guid'] || ''),
    title: String(item['title'] || ''),
    brief: cleanBrief(String(item['brief'] || '')),
    coverUrl: String(item['image'] || ''),
    time: String(item['time'] || '')
  }
}
