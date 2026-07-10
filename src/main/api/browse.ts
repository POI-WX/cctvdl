import { createResilientFetch, type Fetcher, uaInit } from './http'
import { CctvNewsService, isCctvNewsSnowBookPage } from './cctvnews'
import type { VideoInfo, ProgramInfo, Quality } from '../../shared/types'

export { isCctvNewsSnowBookPage }

type CctvServiceId = 'tvcctv' | 'cctv4k'

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
      .replace(/节目视频$/, '')
      .replace(/视频$/, '')
      .replace(/节目$/, '')
      .trim()
    const bookMatch = title.match(/《([^》]+)》/)
    return bookMatch ? bookMatch[1] : title
  }
  return ''
}

export class BrowseService {
  constructor(
    private readonly fetch: Fetcher = createResilientFetch(),
    private readonly cctvNewsService: CctvNewsService = new CctvNewsService()
  ) {}

  async getColumnVideoList(columnId: string, page: number, month: string): Promise<VideoInfo[]> {
    const params = new URLSearchParams({
      id: columnId, n: '100', p: String(page), d: month,
      mode: '0', serviceId: 'tvcctv', sort: 'asc'
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
  // Albums can contain more than the API's 100-item page size, so keep fetching
  // consecutive pages until the final short page and dedupe by guid.
  async getAlbumVideoList(albumId: string, page: number, _month: string, serviceId: CctvServiceId = 'tvcctv'): Promise<VideoInfo[]> {
    const pageSize = 100
    const maxPages = 100
    const seen = new Set<string>()
    const videos: VideoInfo[] = []
    for (let currentPage = page; currentPage < page + maxPages; currentPage++) {
      const params = new URLSearchParams({
        id: albumId,
        pub: serviceId === 'cctv4k' ? '2' : '1',
        sort: 'asc',
        mode: '0',
        p: String(currentPage),
        n: String(pageSize),
        serviceId
      })
      const url = `https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?${params}`
      const resp = await this.fetch(url, uaInit())
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByAlbumIdNew`)
      const data = await resp.json() as Record<string, unknown>
      const dataObj = data['data'] as Record<string, unknown> | undefined
      const list = (dataObj?.['list'] as Array<Record<string, unknown>>) || []
      let addedOnPage = 0
      for (const item of list) {
        const video = mapVideoItem(item)
        const key = video.guid || `${video.title}\u0000${video.time}`
        if (!seen.has(key)) { seen.add(key); videos.push(video); addedOnPage++ }
      }
      // Some upstream responses ignore `p` and repeat the same full page. Stop
      // as soon as that happens instead of needlessly requesting all 100 pages.
      if (list.length < pageSize || addedOnPage === 0) break
    }
    return videos
  }

  async resolveColumnInfo(pageUrl: string): Promise<ProgramInfo> {
    const resp = await this.fetch(pageUrl, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching page`)
    const html = await resp.text()

    // Clip pages expose parent program metadata, but the page itself is a
    // standalone playable video. Let the caller fall back to resolveSingleVideo.
    if (isTvClipVideoPage(html)) throw new Error('无法解析节目信息')

    const htmlGuidMatch = html.match(/var\s+guid\s*=\s*["']([^"']+)["']/)
    const guid = htmlGuidMatch ? htmlGuidMatch[1] : ''
    if (guid) {
      const serviceId = detectTvServiceId(pageUrl, html)
      const videoInfo = await this.fetchVideoInfoByGuid(guid, serviceId).catch(() => null)
      if (videoInfo && isClipVideoInfo(videoInfo)) throw new Error('无法解析节目信息')
      if (videoInfo && isAlbumProgram(videoInfo, serviceId)) {
        const albumId = String(videoInfo['album_id'] || '')
        const name = cleanProgramName(String(videoInfo['vset_title'] || '')) || extractTitle(html)
        const itemId = String(videoInfo['cvid'] || extractItemId(html))
        if (albumId && name) {
          return { name, columnId: albumId, itemId, kind: 'album', serviceId }
        }
      }
    }

    // 1. Extract column ID (priority: column_id → topicID → AJAX URL in page JS)
    let columnId = ''
    const colIdMatch = html.match(/var\s+column_id\s*=\s*["']([^"']+)["']/)
    if (colIdMatch) columnId = colIdMatch[1]

    if (!columnId) {
      const topicIdMatch = html.match(/var\s+topicID\s*=\s*["']([^"']+)["']/)
      if (topicIdMatch) columnId = topicIdMatch[1]
    }

    // Some CCTV pages (e.g. /videoset/ sub-pages) don't expose a top-level var
    // declaration, but do embed the real column id inside their own AJAX calls:
    //   getVideoListByColumn?id=TOPC1234567890&...
    // Extract it as a fallback. The zombie-column check in ipc.ts guards against
    // any false positives.
    if (!columnId) {
      const ajaxIdMatch = html.match(/getVideoListByColumn\?[^"'<>]*\bid=(TOPC\d{10,})/)
      if (ajaxIdMatch) columnId = ajaxIdMatch[1]
    }
    // No URL-slug fallback: the video API needs a real column id (TOPC…). Special
    // columns (e.g. 等着我) are standalone microsites with no column_id/topicID —
    // a slug like "dzw" only yields a zombie column whose list never resolves, so
    // we let columnId stay empty and reject below with a clear error.

    // 2. Extract column name (priority: commentTitle → <title> tag)
    const name = extractTitle(html)

    // 3. Extract itemid (optional current-page id, preserved for compatibility)
    const itemId = extractItemId(html)

    if (!name || !columnId) throw new Error('无法解析节目信息')
    return { name, columnId, itemId, kind: 'column', serviceId: 'tvcctv' }
  }

  /**
   * Resolve a standalone video page into the VideoInfo consumed by the download
   * pipeline. Different CCTV page families expose playable guids differently:
   * tv.cctv.com pages declare `var guid`, while news article pages embed
   * `videoCenterId` and need a videoinfoByGuid metadata lookup.
   *
   * URL tokens such as VIDE... or ARTI... are CMS content IDs, not playable
   * guids, so they are never used as fallbacks.
   */
  async resolveSingleVideo(pageUrl: string): Promise<VideoInfo> {
    const resp = await this.fetch(pageUrl, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching page`)
    const html = await resp.text()

    if (isNewsArticlePage(pageUrl)) {
      return this.resolveNewsArticleVideo(pageUrl, html)
    }
    return this.resolveTvVideoPage(pageUrl, html)
  }

  /**
   * Resolve a single URL into all the videos it contains.
   *
   * Most CCTV pages host exactly one playable video, so the returned array has
   * a single element. cctvnews snow-book articles are the exception — they may
   * embed multiple videos, each resolved to its own variant m3u8 URL.
   *
   * `quality` is forwarded to the cctvnews branch (which must pick one of
   * several server-side quality tiers); the regular CCTV branch ignores it
   * because quality selection there happens at segment-resolution time.
   */
  async resolveSingleVideoBatch(pageUrl: string, quality: Quality = 'auto'): Promise<VideoInfo[]> {
    if (isCctvNewsSnowBookPage(pageUrl)) {
      return this.cctvNewsService.resolveFromUrl(pageUrl, quality)
    }
    return [await this.resolveSingleVideo(pageUrl)]
  }

  private async resolveTvVideoPage(pageUrl: string, html: string): Promise<VideoInfo> {
    // URL's VIDE token is a CMS content ID, not the playable guid used by the
    // download API. Require the page's actual guid declaration.
    const htmlGuidMatch = html.match(/var\s+guid\s*=\s*["']([^"']+)["']/)
    const guid = htmlGuidMatch ? htmlGuidMatch[1] : ''
    if (!guid) throw new Error('无法解析视频信息')

    const serviceId = detectTvServiceId(pageUrl, html)

    // Prefer videoinfoByGuid for the canonical title, cover, brief, and full
    // timestamp. getHttpVideoInfo is a best-effort secondary metadata source.
    let apiCoverUrl = ''
    let apiBrief = ''
    let apiTitle = ''
    let apiTime = ''
    try {
      const videoInfo = await this.fetchVideoInfoByGuid(guid, serviceId)
      apiTitle = String(videoInfo['title'] || '')
      apiCoverUrl = String(videoInfo['img'] || videoInfo['image'] || '')
      apiBrief = cleanBrief(String(videoInfo['brief'] || ''))
      apiTime = formatVideoTime(videoInfo['focus_date']) || String(videoInfo['time'] || '')
    } catch { /* fall through to getHttpVideoInfo */ }

    try {
      const infoResp = await this.fetch(
        `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}&type=json&ltype=html5`,
        uaInit()
      )
      if (infoResp.ok) {
        const info = await infoResp.json() as Record<string, unknown>
        if (!apiCoverUrl) apiCoverUrl = String(info['image'] || '')
        if (!apiBrief) apiBrief = cleanBrief(String(info['brief'] || ''))
      }
    } catch { /* silent — og:image fallback below */ }

    const title = apiTitle || extractTitle(html) || '未命名视频'
    const time = apiTime || dateFromUrl(pageUrl)

    // Cover: prefer API image, fall back to og:image from page HTML.
    const coverMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    const coverRaw = apiCoverUrl || (coverMatch ? coverMatch[1] : '')
    const coverUrl = normalizeResourceUrl(coverRaw)

    // Brief: prefer API value, fall back to og:description / name=description.
    const briefMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,}?)["']/i)
      ?? html.match(/<meta[^>]+name=["']?description["']?[^>]+content=["']([^"']{10,}?)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']{10,}?)["'][^>]+property=["']og:description["']/i)
    const brief = apiBrief || (briefMatch ? cleanBrief(briefMatch[1]) : '')

    return { guid, title, brief, coverUrl, time }
  }

  private async resolveNewsArticleVideo(pageUrl: string, html: string): Promise<VideoInfo> {
    const videoCenterId = extractNewsArticleVideoCenterId(html)
    if (!videoCenterId) throw new Error('无法解析视频信息')

    const infoResp = await this.fetch(
      `https://zy.api.cntv.cn/video/videoinfoByGuid?serviceId=tvcctv&guid=${encodeURIComponent(videoCenterId)}`,
      uaInit()
    )
    if (!infoResp.ok) throw new Error(`HTTP ${infoResp.status} from videoinfoByGuid`)
    const info = await infoResp.json() as Record<string, unknown>

    const guid = String(info['vid'] || videoCenterId)
    const title = String(info['title'] || extractTitle(html) || '未命名视频')
    const brief = cleanBrief(String(info['brief'] || ''))
    const coverUrl = normalizeResourceUrl(String(info['img'] || info['image'] || ''))
    const rawTime = String(info['time'] || '')
    const time = formatVideoTime(info['focus_date']) || rawTime || dateFromUrl(pageUrl)

    return { guid, title, brief, coverUrl, time }
  }

  private async fetchVideoInfoByGuid(guid: string, serviceId: CctvServiceId): Promise<Record<string, unknown>> {
    const infoResp = await this.fetch(
      `https://api.cntv.cn/video/videoinfoByGuid?serviceId=${serviceId}&guid=${encodeURIComponent(guid)}`,
      uaInit()
    )
    if (!infoResp.ok) throw new Error(`HTTP ${infoResp.status} from videoinfoByGuid`)
    return await infoResp.json() as Record<string, unknown>
  }
}

function mapVideoItem(item: Record<string, unknown>): VideoInfo {
  const focusDate = formatVideoTime(item['focus_date'])
  return {
    guid: String(item['guid'] || ''),
    title: String(item['title'] || ''),
    brief: cleanBrief(String(item['brief'] || '')),
    coverUrl: String(item['image'] || ''),
    time: focusDate || String(item['time'] || '')
  }
}

function isNewsArticlePage(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl)
    return /^news\.cctv\.(cn|com)$/i.test(url.hostname) && /\/ARTI[A-Za-z0-9]+\.s?html$/i.test(url.pathname)
  } catch {
    return false
  }
}

function isTvClipVideoPage(html: string): boolean {
  const hasParentGuid = /var\s+guid\s*=\s*["'][^"']+["']/.test(html)
    && /var\s+parentGuid\s*=\s*["'][0-9a-fA-F]{32}["']/.test(html)
    && /var\s+commentTitle\s*=\s*["']\[[^\]]+\][^"']+["']/.test(html)
  const commentTitle = extractCommentTitle(html)
  const isGuideClip = /^\[[^\]]+\].*(导视|片段|预告|精彩)/.test(commentTitle)
  return hasParentGuid || isGuideClip
}

function extractNewsArticleVideoCenterId(html: string): string {
  const match = html.match(/["']?\bvideoCenterId\b["']?\s*:\s*["']([0-9a-fA-F]{32})["']/)
  return match ? match[1] : ''
}

function dateFromUrl(pageUrl: string): string {
  const dateMatch = pageUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)
  return dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : ''
}

function normalizeResourceUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

function extractItemId(html: string): string {
  const itemIdMatch = html.match(/var\s+itemid1\s*=\s*["']([^"']+)["']/)
  return itemIdMatch ? itemIdMatch[1] : ''
}

function extractCommentTitle(html: string): string {
  const commentTitleMatch = html.match(/var\s+commentTitle\s*=\s*["']([^"']+)["']/)
  return commentTitleMatch ? commentTitleMatch[1] : ''
}

function detectTvServiceId(pageUrl: string, html: string): CctvServiceId {
  return /cctv4k|4K专区|configType\s*=\s*["']cctv4k["']/i.test(pageUrl + html) ? 'cctv4k' : 'tvcctv'
}

function isAlbumProgram(info: Record<string, unknown>, serviceId: CctvServiceId): boolean {
  if (!String(info['album_id'] || '')) return false
  if (serviceId === 'cctv4k') return true
  const tnum = Number(info['tnum'] || 0)
  const title = String(info['title'] || '')
  return tnum > 0 || /第\s*\d+\s*集/.test(title)
}

function isClipVideoInfo(info: Record<string, unknown>): boolean {
  const title = String(info['title'] || '')
  const len = String(info['len'] || '')
  return /^\[[^\]]+\].*(导视|片段|预告|精彩)/.test(title)
    || (/^(00:00|00:01):/.test(len) && /^\[[^\]]+\]/.test(title))
}

function cleanProgramName(name: string): string {
  return name.trim().replace(/^《([^》]+)》(.*)$/, '$1$2')
}

function formatVideoTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return formatUnixMsChina(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (/^\d+$/.test(trimmed)) return formatUnixMsChina(Number(trimmed))
    return trimmed
  }
  return ''
}

function formatUnixMsChina(ms: number): string {
  const date = new Date(ms + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}
