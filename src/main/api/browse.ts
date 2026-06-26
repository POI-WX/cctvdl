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

/**
 * Extract a display name from a CCTV page's HTML — the column name on a column
 * page, or the video title on a single-video page. Priority: commentTitle 《》 →
 * cleaned <title>. Returns '' when neither is present.
 */
export function extractTitle(html: string): string {
  const commentTitleMatch = html.match(/var\s+commentTitle\s*=\s*["']([^"']+)["']/)
  if (commentTitleMatch) {
    // "《我爱发明》 20190903 集名" — prefer the name inside 《》
    const bookMatch = commentTitleMatch[1].match(/《([^》]+)》/)
    return bookMatch ? bookMatch[1] : commentTitleMatch[1].split(/\s+\d/)[0].trim()
  }
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
  if (titleMatch) {
    const title = titleMatch[1].trim()
      .replace(/_CCTV节目官网.*$/i, '')
      .replace(/-CCTV.*$/i, '')
      .replace(/_央视网.*$/i, '')
      .replace(/_央视网\(cctv\.com\).*$/i, '')
      .trim()
    const bookMatch = title.match(/《([^》]+)》/)
    return bookMatch ? bookMatch[1] : title
  }
  return ''
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
    const name = extractTitle(html)

    // 3. Extract itemid (optional, used for album fallback)
    let itemId = ''
    const itemIdMatch = html.match(/var\s+itemid1\s*=\s*["']([^"']+)["']/)
    if (itemIdMatch) itemId = itemIdMatch[1]

    if (!name || !columnId) throw new Error('无法解析节目信息')
    return { name, columnId, itemId }
  }

  /**
   * Resolve a standalone video page (e.g. a movie that belongs to no column) into
   * a downloadable VideoInfo. The whole download pipeline only needs the guid, so
   * we extract the guid (from the VIDE… token in the URL, falling back to a page
   * variable) plus a best-effort title / cover / date.
   */
  async resolveSingleVideo(pageUrl: string): Promise<VideoInfo> {
    const resp = await this.fetch(pageUrl, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching page`)
    const html = await resp.text()

    // Prefer var guid from HTML (actual playable guid for download API).
    // URL's VIDE token is a CMS content ID, not the video guid — fall back to it
    // only when the page has no var guid declaration.
    let guid = ''
    const htmlGuidMatch = html.match(/var\s+guid\s*=\s*["']([^"']+)["']/)
    if (htmlGuidMatch) guid = htmlGuidMatch[1]
    if (!guid) {
      const urlGuidMatch = pageUrl.match(/(VIDE[A-Za-z0-9]+)\.s?html/i)
      if (urlGuidMatch) guid = urlGuidMatch[1]
    }
    if (!guid) throw new Error('无法解析视频信息')

    const title = extractTitle(html) || '未命名视频'

    // Date from the /YYYY/MM/DD/ path segment, if present.
    const dateMatch = pageUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)
    const time = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : ''

    // Fetch the real cover and brief from getHttpVideoInfo (best-effort, non-blocking).
    // This gives the actual episode thumbnail (fmspic) instead of the generic og:image
    // placeholder that many CCTV pages use.
    let apiCoverUrl = ''
    let apiBrief = ''
    try {
      const infoResp = await this.fetch(
        `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}&type=json&ltype=html5`,
        uaInit()
      )
      if (infoResp.ok) {
        const info = await infoResp.json() as Record<string, unknown>
        apiCoverUrl = String(info['image'] || '')
        apiBrief = cleanBrief(String(info['brief'] || ''))
      }
    } catch { /* silent — og:image fallback below */ }

    // Cover: prefer API image, fall back to og:image from page HTML.
    const coverMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    const coverRaw = apiCoverUrl || (coverMatch ? coverMatch[1] : '')
    const coverUrl = coverRaw.startsWith('//') ? `https:${coverRaw}` : coverRaw

    // Brief: prefer API value, fall back to og:description / name=description.
    const briefMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,}?)["']/i)
      ?? html.match(/<meta[^>]+name=["']?description["']?[^>]+content=["']([^"']{10,}?)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']{10,}?)["'][^>]+property=["']og:description["']/i)
    const brief = apiBrief || (briefMatch ? cleanBrief(briefMatch[1]) : '')

    return { guid, title, brief, coverUrl, time }
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
