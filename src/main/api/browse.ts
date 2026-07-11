import { createResilientFetch, type Fetcher, uaInit } from './http'
import { CctvNewsService, isCctvNewsSnowBookPage } from './cctvnews'
import type { VideoInfo, ProgramInfo, ProgramMonthBounds, Quality } from '../../shared/types'
import { isCctvPageHostname } from '../../shared/cctv-link'

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
  private readonly albumCache = new Map<string, { expiresAt: number; videos: VideoInfo[] }>()
  private readonly albumMonthCache = new Map<string, { expiresAt: number; videos: VideoInfo[] }>()
  private readonly monthBoundsCache = new Map<string, { expiresAt: number; bounds: ProgramMonthBounds }>()
  private readonly monthBoundsInflight = new Map<string, Promise<ProgramMonthBounds>>()
  private readonly albumInflight = new Map<string, Promise<VideoInfo[]>>()
  private readonly albumColumnEdges = new Map<string, Promise<Set<string>>>()

  constructor(
    private readonly fetch: Fetcher = createResilientFetch(),
    private readonly cctvNewsService: CctvNewsService = new CctvNewsService()
  ) {}

  clearAlbumCache(albumId: string, serviceId: CctvServiceId = 'tvcctv'): void {
    this.albumCache.delete(`${serviceId}:${albumId}`)
    const prefix = `${serviceId}:${albumId}:`
    for (const key of this.albumMonthCache.keys()) {
      if (key.startsWith(prefix)) this.albumMonthCache.delete(key)
    }
    this.monthBoundsCache.delete(`album:${serviceId}:${albumId}`)
  }

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
    return sortVideosChronologically(list.map(mapVideoItem))
  }

  async getColumnMonthBounds(columnId: string): Promise<ProgramMonthBounds> {
    const cacheKey = `column:${columnId}`
    const cached = this.monthBoundsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.bounds
    let request = this.monthBoundsInflight.get(cacheKey)
    if (!request) {
      request = (async () => {
        const fetchEdge = async (sort: 'asc' | 'desc'): Promise<Array<Record<string, unknown>>> => {
          const params = new URLSearchParams({
            id: columnId, n: '100', p: '1', d: '', mode: '0', serviceId: 'tvcctv', sort
          })
          const resp = await this.fetch(`https://api.cntv.cn/NewVideo/getVideoListByColumn?${params}`, uaInit())
          if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByColumn`)
          const data = await resp.json() as Record<string, unknown>
          const dataObj = data['data'] as Record<string, unknown> | undefined
          return (dataObj?.['list'] as Array<Record<string, unknown>>) || []
        }
        const [earliestItems, latestItems] = await Promise.all([fetchEdge('asc'), fetchEdge('desc')])
        const bounds = monthBoundsFromEdges(earliestItems, latestItems)
        this.monthBoundsCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, bounds })
        return bounds
      })()
      this.monthBoundsInflight.set(cacheKey, request)
    }
    try { return await request } finally {
      if (this.monthBoundsInflight.get(cacheKey) === request) this.monthBoundsInflight.delete(cacheKey)
    }
  }

  // `_month` is part of the symmetric signature with getColumnVideoList but the
  // album endpoint doesn't filter by month, so it's intentionally unused.
  // Albums can contain more than the API's 100-item page size, so keep fetching
  // consecutive pages until the final short page and dedupe by guid.
  async getAlbumVideoList(
    albumId: string,
    page: number,
    month: string,
    serviceId: CctvServiceId = 'tvcctv',
    onProgress?: (newVideos: VideoInfo[]) => void
  ): Promise<VideoInfo[]> {
    const cacheKey = `${serviceId}:${albumId}`
    const cached = this.albumCache.get(cacheKey)
    if (month && (!cached || cached.expiresAt <= Date.now())) {
      return this.fetchAlbumVideosByMonth(albumId, month, serviceId, onProgress)
    }
    let allVideos: VideoInfo[]
    if (cached && cached.expiresAt > Date.now()) {
      allVideos = cached.videos
    } else {
      let request = this.albumInflight.get(cacheKey)
      if (!request) {
        request = this.fetchAllAlbumVideos(albumId, page, serviceId, onProgress)
        this.albumInflight.set(cacheKey, request)
      }
      try {
        allVideos = await request
        this.albumCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, videos: allVideos })
      } finally {
        if (this.albumInflight.get(cacheKey) === request) this.albumInflight.delete(cacheKey)
      }
    }
    return month ? allVideos.filter(video => monthFromVideoTime(video.time) === month) : allVideos
  }

  private async fetchAlbumVideosByMonth(
    albumId: string,
    month: string,
    serviceId: CctvServiceId,
    onProgress?: (newVideos: VideoInfo[]) => void
  ): Promise<VideoInfo[]> {
    const cacheKey = `${serviceId}:${albumId}:${month}`
    const cached = this.albumMonthCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.videos

    const pageSize = 100
    const [ascFirst, descFirst] = await Promise.all([
      this.fetchAlbumPage(albumId, 1, pageSize, serviceId, 'asc'),
      this.fetchAlbumPage(albumId, 1, pageSize, serviceId, 'desc')
    ])
    const target = monthNumber(month)
    if (target == null) return []
    const distance = (items: Array<Record<string, unknown>>): number => {
      const values = items.map(item => monthNumber(formatVideoTime(item['focus_date']) || String(item['time'] || '')))
        .filter((value): value is number => value != null)
      return values.length ? Math.min(...values.map(value => Math.abs(value - target))) : Number.POSITIVE_INFINITY
    }
    const sort: 'asc' | 'desc' = distance(ascFirst) <= distance(descFirst) ? 'asc' : 'desc'
    const first = sort === 'asc' ? ascFirst : descFirst
    const seen = new Set<string>()
    const videos: VideoInfo[] = []

    for (let page = 1; page <= 100; page++) {
      const list = page === 1 ? first : await this.fetchAlbumPage(albumId, page, pageSize, serviceId, sort)
      const matching: VideoInfo[] = []
      for (const item of list) {
        const video = mapVideoItem(item)
        if (monthFromVideoTime(video.time) !== month) continue
        const key = video.guid || `${video.title}\u0000${video.time}`
        if (!seen.has(key)) { seen.add(key); videos.push(video); matching.push(video) }
      }
      if (matching.length) onProgress?.(sortVideosChronologically(matching))

      const months = list.map(item => monthNumber(formatVideoTime(item['focus_date']) || String(item['time'] || '')))
        .filter((value): value is number => value != null)
      const passedTarget = months.length > 0 && (sort === 'asc'
        ? Math.max(...months) > target
        : Math.min(...months) < target)
      if (list.length < pageSize || passedTarget) break
    }

    const sortedVideos = sortVideosChronologically(videos)
    this.albumMonthCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, videos: sortedVideos })
    return sortedVideos
  }

  private async fetchAlbumPage(
    albumId: string, page: number, pageSize: number, serviceId: CctvServiceId, sort: 'asc' | 'desc'
  ): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams({
      id: albumId, pub: serviceId === 'cctv4k' ? '2' : '1', sort,
      mode: '0', p: String(page), n: String(pageSize), serviceId
    })
    const resp = await this.fetch(`https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?${params}`, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByAlbumIdNew`)
    const data = await resp.json() as Record<string, unknown>
    const dataObj = data['data'] as Record<string, unknown> | undefined
    return (dataObj?.['list'] as Array<Record<string, unknown>>) || []
  }

  private async fetchAllAlbumVideos(
    albumId: string,
    page: number,
    serviceId: CctvServiceId,
    onProgress?: (newVideos: VideoInfo[]) => void
  ): Promise<VideoInfo[]> {
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
      const newVideos: VideoInfo[] = []
      for (const item of list) {
        const video = mapVideoItem(item)
        const key = video.guid || `${video.title}\u0000${video.time}`
        if (!seen.has(key)) { seen.add(key); videos.push(video); newVideos.push(video); addedOnPage++ }
      }
      if (newVideos.length) onProgress?.(newVideos)
      // Some upstream responses ignore `p` and repeat the same full page. Stop
      // as soon as that happens instead of needlessly requesting all 100 pages.
      if (list.length < pageSize || addedOnPage === 0) break
    }
    return videos
  }

  // Used by background notification checks. Unlike the preview loader this
  // deliberately asks for only the newest API page, avoiding a full traversal
  // of long-running programmes at every application startup.
  async getLatestAlbumVideos(albumId: string, serviceId: CctvServiceId = 'tvcctv'): Promise<VideoInfo[]> {
    const params = new URLSearchParams({
      id: albumId,
      pub: serviceId === 'cctv4k' ? '2' : '1',
      sort: 'desc',
      mode: '0',
      p: '1',
      n: '100',
      serviceId
    })
    const resp = await this.fetch(`https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?${params}`, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByAlbumIdNew`)
    const data = await resp.json() as Record<string, unknown>
    const dataObj = data['data'] as Record<string, unknown> | undefined
    const list = (dataObj?.['list'] as Array<Record<string, unknown>>) || []
    return list.map(mapVideoItem)
  }

  async getAlbumMonthBounds(
    albumId: string, serviceId: CctvServiceId = 'tvcctv'
  ): Promise<ProgramMonthBounds> {
    const cacheKey = `album:${serviceId}:${albumId}`
    const cached = this.monthBoundsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.bounds
    let request = this.monthBoundsInflight.get(cacheKey)
    if (!request) {
      request = Promise.all([
        this.fetchAlbumPage(albumId, 1, 100, serviceId, 'asc'),
        this.fetchAlbumPage(albumId, 1, 100, serviceId, 'desc')
      ]).then(([earliestItems, latestItems]) => {
        const bounds = monthBoundsFromEdges(earliestItems, latestItems)
        this.monthBoundsCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, bounds })
        return bounds
      })
      this.monthBoundsInflight.set(cacheKey, request)
    }
    try { return await request } finally {
      if (this.monthBoundsInflight.get(cacheKey) === request) this.monthBoundsInflight.delete(cacheKey)
    }
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
      const aggregate = videoInfo && await this.monthlyColumnFromEpisode(
        videoInfo, serviceId, extractTitle(html), extractItemId(html), extractColumnId(html)
      )
      if (aggregate) return aggregate
      const album = videoInfo && this.albumProgramFromVideoInfo(videoInfo, serviceId, extractTitle(html), extractItemId(html))
      if (album) return album
    }

    // Some programme overview pages list episodes but do not expose their own
    // playable guid or a column id. Resolve one linked episode through the same
    // metadata path as a directly pasted episode, then identify its album.
    const episodeUrl = extractRepresentativeEpisodeUrl(pageUrl, html)
    if (episodeUrl) {
      const episodeResp = await this.fetch(episodeUrl, uaInit())
      if (episodeResp.ok) {
        const episodeHtml = await episodeResp.text()
        const episodeGuid = extractPageGuid(episodeHtml)
        if (episodeGuid) {
          const serviceId = detectTvServiceId(episodeUrl, episodeHtml)
          const videoInfo = await this.fetchVideoInfoByGuid(episodeGuid, serviceId).catch(() => null)
          const overviewItemId = extractItemId(html)
          const overviewColumnId = extractColumnId(html)
          const episodeColumnId = extractColumnId(episodeHtml)
          const aggregate = videoInfo && /^VIDA[A-Za-z0-9]+$/.test(overviewItemId)
            && overviewColumnId && episodeColumnId && overviewColumnId !== episodeColumnId
            ? this.monthlyAlbumColumnFromVideoInfo(videoInfo, serviceId, extractTitle(html), overviewItemId)
            : null
          if (aggregate) return aggregate
          const album = videoInfo && this.albumProgramFromVideoInfo(videoInfo, serviceId, extractTitle(html), overviewItemId)
          if (album) return album
        }
      }
    }

    // 1. Extract column ID (priority: column_id → topicID → AJAX URL in page JS)
    let columnId = extractColumnId(html)

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
    return {
      name, columnId, itemId, kind: 'column', serviceId: 'tvcctv',
      listSource: { type: 'column', id: columnId, serviceId: 'tvcctv' }
    }
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

  private albumProgramFromVideoInfo(
    info: Record<string, unknown>, serviceId: CctvServiceId, fallbackName: string, fallbackItemId: string
  ): ProgramInfo | null {
    if (!isAlbumProgram(info, serviceId)) return null
    const columnId = String(info['album_id'] || '')
    const name = cleanProgramName(String(info['vset_title'] || '')) || fallbackName
    if (!columnId || !name) return null
    return {
      name, columnId, itemId: String(info['cvid'] || fallbackItemId), kind: 'album', serviceId,
      listSource: { type: 'album', id: columnId, serviceId }
    }
  }

  private monthlyAlbumColumnFromVideoInfo(
    info: Record<string, unknown>, serviceId: CctvServiceId, fallbackName: string, fallbackItemId: string
  ): ProgramInfo | null {
    const sourceId = String(info['album_id'] || '')
    const name = cleanProgramName(String(info['vset_title'] || '')) || fallbackName
    if (!sourceId || !name) return null
    return {
      name, columnId: sourceId, itemId: fallbackItemId, kind: 'column', serviceId,
      listSource: { type: 'album', id: sourceId, serviceId }
    }
  }

  private async monthlyColumnFromEpisode(
    info: Record<string, unknown>, serviceId: CctvServiceId,
    fallbackName: string, itemId: string, currentColumnId: string
  ): Promise<ProgramInfo | null> {
    const albumId = String(info['album_id'] || '')
    if (Number(info['tnum'] || 0) > 0 || !albumId || !currentColumnId || !/^VIDE[A-Za-z0-9]+$/.test(itemId)) return null
    if (!await this.albumShowsColumnMigration(albumId, serviceId, currentColumnId)) return null
    return this.monthlyAlbumColumnFromVideoInfo(info, serviceId, fallbackName, itemId)
  }

  private albumShowsColumnMigration(
    albumId: string, serviceId: CctvServiceId, currentColumnId: string
  ): Promise<boolean> {
    const key = `${serviceId}:${albumId}`
    let request = this.albumColumnEdges.get(key)
    if (!request) {
      request = this.fetchAlbumColumnEdges(albumId, serviceId).catch(() => new Set<string>())
      this.albumColumnEdges.set(key, request)
    }
    // A different album column alone is not evidence of an ID migration. CCTV
    // movie pages, for example, can be mounted under a movie-page column while
    // their album belongs to a long-running scheduling column. A migration is
    // only established when the album history contains the pasted page's
    // column as well as another column.
    return request.then(columns => columns.has(currentColumnId) && columns.size > 1)
  }

  private async fetchAlbumColumnEdges(
    albumId: string, serviceId: CctvServiceId
  ): Promise<Set<string>> {
    const columns = new Set<string>()
    const edgeUrls: string[] = []
    for (const sort of ['asc', 'desc']) {
      const params = new URLSearchParams({
        id: albumId, pub: serviceId === 'cctv4k' ? '2' : '1', sort,
        mode: '0', p: '1', n: '1', serviceId
      })
      const resp = await this.fetch(`https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?${params}`, uaInit())
      if (!resp.ok) continue
      const data = await resp.json() as Record<string, unknown>
      const dataObj = data['data'] as Record<string, unknown> | undefined
      const list = (dataObj?.['list'] as Array<Record<string, unknown>>) || []
      const url = String(list[0]?.['url'] || '')
      if (url) edgeUrls.push(url)
    }
    for (const edgeUrl of new Set(edgeUrls)) {
      let parsed: URL
      try { parsed = new URL(edgeUrl) } catch { continue }
      if (!isCctvPageHostname(parsed.hostname)) continue
      const resp = await this.fetch(parsed.href, uaInit())
      if (!resp.ok) continue
      const columnId = extractColumnId(await resp.text())
      if (columnId) columns.add(columnId)
    }
    return columns
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

function extractColumnId(html: string): string {
  return html.match(/var\s+column_id\s*=\s*["']([^"']+)["']/)?.[1] || ''
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

function extractPageGuid(html: string): string {
  return html.match(/var\s+guid\s*=\s*["']([^"']+)["']/)?.[1] || ''
}

function extractRepresentativeEpisodeUrl(pageUrl: string, html: string): string {
  const candidates = new Set<string>()
  const hrefPattern = /href=["']([^"']*VIDE[A-Za-z0-9]+[^"']*\.shtml[^"']*)["']/gi
  for (const match of html.matchAll(hrefPattern)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), pageUrl)
      if (isCctvPageHostname(url.hostname)) candidates.add(url.href)
    } catch { /* ignore malformed links */ }
  }
  // Requiring several episode links avoids turning a page with one related-video
  // link into a programme set.
  return candidates.size >= 2 ? [...candidates][0] : ''
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

function monthFromVideoTime(time: string): string {
  const match = time.match(/^(\d{4})[-/]?(\d{2})/)
  return match ? `${match[1]}${match[2]}` : ''
}

// CCTV's legacy column/album endpoints do not consistently honor their
// `sort` parameter. Normalize at our boundary so old and new column IDs render
// in the same (oldest-to-newest) order. Unknown dates retain their source order
// and are placed after dated entries.
function sortVideosChronologically(videos: VideoInfo[]): VideoInfo[] {
  return videos
    .map((video, index) => ({ video, index }))
    .sort((a, b) => {
      if (!a.video.time && !b.video.time) return a.index - b.index
      if (!a.video.time) return 1
      if (!b.video.time) return -1
      return a.video.time.localeCompare(b.video.time) || a.index - b.index
    })
    .map(({ video }) => video)
}

function monthBoundsFromEdges(
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

function monthNumber(value: string): number | null {
  const month = monthFromVideoTime(value)
  if (!month) return null
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(4, 6)) - 1
}
