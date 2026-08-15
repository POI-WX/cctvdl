import { createResilientFetch, type Fetcher, uaInit } from './http'
import { CctvNewsService, isCctvNewsSnowBookPage } from './cctvnews'
import type { VideoInfo, ProgramInfo, ProgramMonthBounds, Quality } from '../../shared/types'
import { isCctvPageHostname } from '../../shared/cctv-link'
import { getProgramListSource } from '../../shared/programs'
import { readVideoDurationSeconds, sortVideosChronologically } from '../../shared/video-metadata'
import {
  cleanBrief, cleanProgramName, extractTitle, formatVideoTime, mapTopicFragment,
  mapVcctvVideoItem, mapVideoItem, monthBoundsFromEdges, monthFromVideoTime,
  monthNumber, readVideoChannel
} from './browse-data'

export { isCctvNewsSnowBookPage }

type CctvServiceId = 'tvcctv' | 'cctv4k'

export class BrowseService {
  private readonly albumCache = new Map<string, { expiresAt: number; videos: VideoInfo[] }>()
  private readonly albumMonthCache = new Map<string, { expiresAt: number; videos: VideoInfo[] }>()
  private readonly monthBoundsCache = new Map<string, { expiresAt: number; bounds: ProgramMonthBounds }>()
  private readonly monthBoundsInflight = new Map<string, Promise<ProgramMonthBounds>>()
  private readonly albumInflight = new Map<string, Promise<VideoInfo[]>>()
  private readonly albumColumnEdges = new Map<string, Promise<Set<string>>>()
  private readonly albumPrimaryModes = new Map<string, 0 | 1>()
  private readonly albumPrimaryModeInflight = new Map<string, Promise<{
    mode: 0 | 1 | null
    items: Array<Record<string, unknown>>
    page: number
    pageSize: number
    sort: 'asc' | 'desc'
  }>>()

  constructor(
    private readonly fetch: Fetcher = createResilientFetch(),
    private readonly cctvNewsService: CctvNewsService = new CctvNewsService()
  ) {}

  clearAlbumCache(albumId: string, serviceId: CctvServiceId = 'tvcctv'): void {
    this.albumCache.delete(`${serviceId}:${albumId}`)
    this.albumPrimaryModes.delete(`${serviceId}:${albumId}`)
    this.albumPrimaryModeInflight.delete(`${serviceId}:${albumId}`)
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

  async getVcctvVideoList(mid: string, chid: string, month: string): Promise<VideoInfo[]> {
    const pageSize = 100
    const videos: VideoInfo[] = []
    const seen = new Set<string>()
    let actualPageSize = pageSize
    for (let page = 1; page <= 100; page++) {
      const { items, total } = await this.fetchVcctvPage(mid, chid, page, pageSize)
      if (!items.length) break
      if (page === 1) actualPageSize = items.length
      let oldestMonth = ''
      for (const item of items) {
        const video = mapVcctvVideoItem(item)
        const itemMonth = monthFromVideoTime(video.time)
        if (!oldestMonth || (itemMonth && itemMonth < oldestMonth)) oldestMonth = itemMonth
        if (month && itemMonth !== month) continue
        if (!seen.has(video.guid)) { seen.add(video.guid); videos.push(video) }
      }
      if (page * actualPageSize >= total || (month && oldestMonth && oldestMonth < month)) break
    }
    return sortVideosChronologically(videos)
  }

  async getLatestVcctvVideos(mid: string, chid: string): Promise<VideoInfo[]> {
    const { items } = await this.fetchVcctvPage(mid, chid, 1, 100)
    return items.map(mapVcctvVideoItem)
  }

  async getVcctvMonthBounds(mid: string, chid: string): Promise<ProgramMonthBounds> {
    const pageSize = 100
    const first = await this.fetchVcctvPage(mid, chid, 1, pageSize)
    if (!first.items.length) return { earliest: null, latest: null }
    const totalPages = Math.max(1, Math.ceil(first.total / first.items.length))
    const last = totalPages === 1 ? first : await this.fetchVcctvPage(mid, chid, totalPages, pageSize)
    const months = [...first.items, ...last.items]
      .map(item => monthFromVideoTime(formatVideoTime(item['pubTime'])))
      .filter(Boolean)
    return {
      earliest: months.length ? months.reduce((a, b) => a < b ? a : b) : null,
      latest: months.length ? months.reduce((a, b) => a > b ? a : b) : null
    }
  }

  private async fetchVcctvPage(
    mid: string, chid: string, page: number, pageSize: number
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const params = new URLSearchParams({ mid, chid, p: String(page), n: String(pageSize) })
    let resp: Awaited<ReturnType<Fetcher>>
    try {
      resp = await this.fetch(`https://media.app.cctv.com/vapi/video/vplist.do?${params}`, uaInit())
    } catch {
      // This legacy host still negotiates TLS in a way Node/OpenSSL may reject.
      // Its public read-only HTTP endpoint serves the same JSON, so use it only
      // as a compatibility fallback instead of weakening TLS globally.
      resp = await this.fetch(`http://media.app.cctv.com/vapi/video/vplist.do?${params}`, uaInit())
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from vplist.do`)
    const root = await resp.json() as Record<string, unknown>
    const items = Array.isArray(root['data']) ? root['data'] as Array<Record<string, unknown>> : []
    const total = Number(root['count'])
    return { items, total: Number.isFinite(total) && total > 0 ? total : items.length }
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

  // The album endpoint cannot filter by month. For a requested month, start
  // from the closer chronological edge and stop once paging passes the target;
  // for an unfiltered list, traverse all pages and dedupe by guid.
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
    if (sortedVideos.length) {
      this.albumMonthCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, videos: sortedVideos })
      return sortedVideos
    }

    // Some legacy VIDA archives do not honour the requested sort/page
    // consistently. If edge-directed paging misses the requested month, fall
    // back to the complete ascending catalogue before declaring it empty.
    const allVideos = await this.fetchAllAlbumVideos(albumId, 1, serviceId)
    const fallback = sortVideosChronologically(
      allVideos.filter(video => monthFromVideoTime(video.time) === month)
    )
    if (fallback.length) onProgress?.(fallback)
    this.albumMonthCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, videos: fallback })
    return fallback
  }

  async getVideoMediaMetadata(guid: string): Promise<Pick<VideoInfo, 'channel' | 'durationSeconds'>> {
    const resp = await this.fetch(
      `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${encodeURIComponent(guid)}&type=json&ltype=html5`,
      uaInit()
    )
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getHttpVideoInfo.do`)
    const info = await resp.json() as Record<string, unknown>
    const channel = readVideoChannel(info)
    const durationSeconds = readVideoDurationSeconds(info)
    return {
      ...(channel ? { channel } : {}),
      ...(durationSeconds != null ? { durationSeconds } : {})
    }
  }

  async getSupplementaryVideos(program: ProgramInfo, month = ''): Promise<VideoInfo[]> {
    const result: VideoInfo[] = []
    const source = getProgramListSource(program)
    if (source.type === 'vcctv') return []
    const serviceId = source.serviceId
    let albumId = source.type === 'album' ? source.id : ''
    if (!albumId && program.itemId) albumId = await this.resolveAlbumId(program.itemId, serviceId).catch(() => '')
    if (albumId) result.push(...await this.fetchAlbumModeVideos(albumId, serviceId, 1, 'highlight').catch(() => []))
    const topicId = program.topicId || (/^TOPC/.test(program.columnId) ? program.columnId : '')
    if (program.itemId && topicId) {
      result.push(...await this.fetchTopicFragments(topicId, program.itemId, serviceId).catch(() => []))
    }
    const seen = new Set<string>()
    return sortVideosChronologically(result.filter(video => {
      if (!video.guid || seen.has(video.guid)) return false
      if (month && monthFromVideoTime(video.time) !== month) return false
      seen.add(video.guid)
      return true
    }))
  }

  private async resolveAlbumId(itemId: string, serviceId: CctvServiceId): Promise<string> {
    const params = new URLSearchParams({ id: itemId, serviceId })
    const resp = await this.fetch(`https://api.cntv.cn/NewVideoset/getVideoAlbumInfoByVideoId?${params}`, uaInit())
    if (!resp.ok) return ''
    const root = await resp.json() as Record<string, unknown>
    const data = root['data'] as Record<string, unknown> | undefined
    return String(data?.['id'] || '')
  }

  private async fetchAlbumModeVideos(
    albumId: string, serviceId: CctvServiceId, mode: 0 | 1, contentType: 'highlight'
  ): Promise<VideoInfo[]> {
    const result: VideoInfo[] = []
    const pageSize = 100
    for (let page = 1; page <= 100; page++) {
      let pageResult: { items: Array<Record<string, unknown>>; total: number }
      try {
        pageResult = await this.fetchAlbumModePage(albumId, page, pageSize, serviceId, 'asc', mode)
      } catch {
        break
      }
      const { items, total } = pageResult
      result.push(...items.map(item => ({ ...mapVideoItem(item), contentType })))
      if (items.length < pageSize || page * pageSize >= total) break
    }
    return result
  }

  private async fetchTopicFragments(
    columnId: string, itemId: string, serviceId: CctvServiceId
  ): Promise<VideoInfo[]> {
    const params = new URLSearchParams({
      videoid: itemId, topicid: columnId, serviceId, type: '1'
    })
    const resp = await this.fetch(`https://api.cntv.cn/video/getVideoListByTopicIdInfo?${params}`, uaInit())
    if (!resp.ok) return []
    const root = await resp.json() as Record<string, unknown>
    const items = Array.isArray(root['data']) ? root['data'] as Array<Record<string, unknown>> : []
    return items.map(mapTopicFragment)
  }

  private async fetchAlbumPage(
    albumId: string, page: number, pageSize: number, serviceId: CctvServiceId, sort: 'asc' | 'desc'
  ): Promise<Array<Record<string, unknown>>> {
    const cacheKey = `${serviceId}:${albumId}`
    const selectedMode = this.albumPrimaryModes.get(cacheKey)
    if (selectedMode != null) {
      return this.fetchAlbumPageByMode(albumId, page, pageSize, serviceId, sort, selectedMode)
    }
    let resolution = this.albumPrimaryModeInflight.get(cacheKey)
    if (!resolution) {
      resolution = this.resolveAlbumPrimaryMode(albumId, page, pageSize, serviceId, sort)
      this.albumPrimaryModeInflight.set(cacheKey, resolution)
    }
    try {
      const resolved = await resolution
      if (resolved.mode == null) return []
      this.albumPrimaryModes.set(cacheKey, resolved.mode)
      if (resolved.page === page && resolved.pageSize === pageSize && resolved.sort === sort) return resolved.items
      return this.fetchAlbumPageByMode(albumId, page, pageSize, serviceId, sort, resolved.mode)
    } finally {
      if (this.albumPrimaryModeInflight.get(cacheKey) === resolution) this.albumPrimaryModeInflight.delete(cacheKey)
    }
  }

  private async resolveAlbumPrimaryMode(
    albumId: string, page: number, pageSize: number, serviceId: CctvServiceId, sort: 'asc' | 'desc'
  ): Promise<{
    mode: 0 | 1 | null
    items: Array<Record<string, unknown>>
    page: number
    pageSize: number
    sort: 'asc' | 'desc'
  }> {
    const primary = await this.fetchAlbumPageByMode(albumId, page, pageSize, serviceId, sort, 0)
    if (primary.length) return { mode: 0, items: primary, page, pageSize, sort }
    // A small family of VIDA sets (notably upstream issue #98) stores full
    // episodes in mode=1 while mode=0 is empty. Accept mode=1 only when at
    // least 80% of its titles look like complete episodes; this keeps ordinary
    // highlight catalogues out of the default programme list.
    const fallback = await this.fetchAlbumPageByMode(albumId, page, pageSize, serviceId, sort, 1)
    return looksLikeFullEpisodeCatalogue(fallback)
      ? { mode: 1, items: fallback, page, pageSize, sort }
      : { mode: null, items: [], page, pageSize, sort }
  }

  private async fetchAlbumPageByMode(
    albumId: string, page: number, pageSize: number, serviceId: CctvServiceId,
    sort: 'asc' | 'desc', mode: 0 | 1
  ): Promise<Array<Record<string, unknown>>> {
    return (await this.fetchAlbumModePage(albumId, page, pageSize, serviceId, sort, mode)).items
  }

  /** Single boundary for the album API's parameters and response normalization. */
  private async fetchAlbumModePage(
    albumId: string, page: number, pageSize: number, serviceId: CctvServiceId,
    sort: 'asc' | 'desc', mode: 0 | 1
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const params = new URLSearchParams({
      id: albumId, pub: serviceId === 'cctv4k' ? '2' : '1', sort,
      mode: String(mode), p: String(page), n: String(pageSize), serviceId
    })
    const resp = await this.fetch(`https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?${params}`, uaInit())
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getVideoListByAlbumIdNew`)
    const data = await resp.json() as Record<string, unknown>
    const dataObj = data['data'] as Record<string, unknown> | undefined
    const items = (dataObj?.['list'] as Array<Record<string, unknown>>) || []
    const rawTotal = Number(dataObj?.['total'])
    return {
      items,
      total: Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : items.length
    }
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
      const list = await this.fetchAlbumPage(albumId, currentPage, pageSize, serviceId, 'asc')
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
    return (await this.fetchAlbumPage(albumId, 1, 100, serviceId, 'desc')).map(mapVideoItem)
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

    const vcctv = isVcctvProgrammePage(pageUrl) ? extractVcctvCatalogue(html) : null
    if (vcctv) {
      const name = extractTitle(html)
      if (!name) throw new Error('无法解析节目信息')
      return {
        name, columnId: `vcctv:${vcctv.mid}`, itemId: vcctv.mid, kind: 'column', serviceId: 'tvcctv',
        listSource: { type: 'vcctv', id: vcctv.mid, chid: vcctv.chid, serviceId: 'tvcctv' }
      }
    }

    // Some culture/travel pages expose a real playable itemguid alongside a
    // decorative TOPC column id, but no videotvCodes album marker. They are
    // single videos; allowing the generic column fallback below would import a
    // misleading or empty programme instead.
    if (isCultureTravelSingleVideoPage(pageUrl, html)) throw new Error('无法解析节目信息')

    // Clip pages expose parent programme metadata. Prefer that album when it is
    // available; otherwise reject column resolution so the caller imports the
    // pasted clip itself as a single video.
    const clipPage = isTvClipVideoPage(html)

    const guid = extractPageGuid(html)
    if (guid) {
      const guidProgram = await this.resolveGuidBackedProgram(pageUrl, html, guid, clipPage)
      if (guidProgram) return guidProgram
    }
    if (clipPage) throw new Error('无法解析节目信息')

    const overviewProgram = await this.resolveOverviewProgram(pageUrl, html)
    if (overviewProgram) return overviewProgram

    // 1. Extract column ID (priority: column_id → topicID/lmtopId → AJAX URL in page JS)
    let columnId = extractColumnId(html)

    if (!columnId) {
      const topicIdMatch = html.match(/var\s+(?:topicID|lmtopId)\s*=\s*["']([^"']+)["']/)
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

  private async resolveGuidBackedProgram(
    pageUrl: string, html: string, guid: string, clipPage: boolean
  ): Promise<ProgramInfo | null> {
    const serviceId = detectTvServiceId(pageUrl, html)
    const videoInfo = await this.fetchVideoInfoByGuid(guid, serviceId).catch(() => null)
    if (!videoInfo) return null
    const title = extractTitle(html)
    const itemId = extractItemId(html)

    if (clipPage) {
      const album = this.albumProgramFromVideoInfo(videoInfo, serviceId, title, itemId, true)
      if (album) return album
    }
    if (isLegacyThemedVideoPage(pageUrl)) {
      const album = await this.multiVideoAlbumFromVideoInfo(videoInfo, serviceId, title, itemId)
      if (album) return album
      // A year-themed direct video URL is not collection evidence by itself.
      throw new Error('无法解析节目信息')
    }
    if (isClipVideoInfo(videoInfo)) throw new Error('无法解析节目信息')

    const aggregate = await this.monthlyColumnFromEpisode(
      videoInfo, serviceId, title, itemId, extractColumnId(html)
    )
    if (aggregate) return aggregate
    // A programme TOPC is also attached to many short editorial segments; the
    // pasted link still represents that single segment (upstream issue #96).
    if (isStandaloneSegmentVideoInfo(videoInfo)) throw new Error('无法解析节目信息')
    return this.albumProgramFromVideoInfo(videoInfo, serviceId, title, itemId)
  }

  private async resolveOverviewProgram(pageUrl: string, html: string): Promise<ProgramInfo | null> {
    // Static overview pages can be identified through one representative episode.
    const episodeUrl = extractRepresentativeEpisodeUrl(pageUrl, html)
    if (episodeUrl) {
      const episodeResp = await this.fetch(episodeUrl, uaInit())
      if (episodeResp.ok) {
        const episodeHtml = await episodeResp.text()
        const episodeGuid = extractPageGuid(episodeHtml)
        if (episodeGuid) {
          const serviceId = detectTvServiceId(episodeUrl, episodeHtml)
          const videoInfo = await this.fetchVideoInfoByGuid(episodeGuid, serviceId).catch(() => null)
          const itemId = extractItemId(html)
          const isAlbumOverview = /^VIDA[A-Za-z0-9]+$/.test(itemId)
          const overviewColumnId = extractColumnId(html)
          const episodeColumnId = extractColumnId(episodeHtml)
          const columnsChanged = Boolean(
            overviewColumnId && episodeColumnId && overviewColumnId !== episodeColumnId
          )
          if (videoInfo && isAlbumOverview && columnsChanged) {
            const aggregate = this.monthlyAlbumColumnFromVideoInfo(videoInfo, serviceId, extractTitle(html), itemId)
            if (aggregate) return aggregate
          }
          // VIDA itself is explicit collection evidence even when metadata reports tnum=0 (#98).
          if (videoInfo) {
            const album = this.albumProgramFromVideoInfo(
              videoInfo, serviceId, extractTitle(html), itemId, isAlbumOverview
            )
            if (album) return album
          }
        }
      }
    }

    // Dynamic overview templates may omit episode links; their VIDA item id is sufficient.
    const albumId = extractItemId(html)
    const name = extractTitle(html)
    if (!/^VIDA[A-Za-z0-9]+$/.test(albumId) || !name) return null
    return {
      name, columnId: albumId, itemId: albumId, kind: 'album', serviceId: 'tvcctv',
      listSource: { type: 'album', id: albumId, serviceId: 'tvcctv' }
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
    const guid = htmlGuidMatch ? htmlGuidMatch[1] : extractAuthoritativeItemGuid(html)
    if (!guid) throw new Error('无法解析视频信息')

    const serviceId = detectTvServiceId(pageUrl, html)

    // Prefer videoinfoByGuid for the canonical title, cover, brief, and full
    // timestamp. getHttpVideoInfo is a best-effort secondary metadata source.
    let apiCoverUrl = ''
    let apiBrief = ''
    let apiTitle = ''
    let apiTime = ''
    let channel = ''
    let durationSeconds: number | undefined
    try {
      const videoInfo = await this.fetchVideoInfoByGuid(guid, serviceId)
      apiTitle = String(videoInfo['title'] || '')
      apiCoverUrl = String(videoInfo['img'] || videoInfo['image'] || '')
      apiBrief = cleanBrief(String(videoInfo['brief'] || ''))
      apiTime = formatVideoTime(videoInfo['focus_date']) || String(videoInfo['time'] || '')
      channel = readVideoChannel(videoInfo)
      durationSeconds = readVideoDurationSeconds(videoInfo)
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
        if (!channel) channel = readVideoChannel(info)
        if (durationSeconds == null) durationSeconds = readVideoDurationSeconds(info)
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

    return {
      guid, title, brief, coverUrl, time,
      ...(channel ? { channel } : {}),
      ...(durationSeconds != null ? { durationSeconds } : {})
    }
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

    const channel = readVideoChannel(info)
    const durationSeconds = readVideoDurationSeconds(info)
    return {
      guid, title, brief, coverUrl, time,
      ...(channel ? { channel } : {}),
      ...(durationSeconds != null ? { durationSeconds } : {})
    }
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
    info: Record<string, unknown>, serviceId: CctvServiceId, fallbackName: string, fallbackItemId: string,
    forceCollection = false
  ): ProgramInfo | null {
    if (!forceCollection && !isAlbumProgram(info, serviceId)) return null
    const columnId = String(info['album_id'] || '')
    const name = cleanProgramName(String(info['vset_title'] || '')) || fallbackName
    if (!columnId || !name) return null
    return {
      name, columnId, itemId: String(info['cvid'] || fallbackItemId), kind: 'album', serviceId,
      listSource: { type: 'album', id: columnId, serviceId },
      ...(String(info['ctid'] || '') ? { topicId: String(info['ctid']) } : {})
    }
  }

  private async multiVideoAlbumFromVideoInfo(
    info: Record<string, unknown>, serviceId: CctvServiceId, fallbackName: string, fallbackItemId: string
  ): Promise<ProgramInfo | null> {
    const program = this.albumProgramFromVideoInfo(info, serviceId, fallbackName, fallbackItemId, true)
    if (!program) return null
    for (const mode of [0, 1] as const) {
      try {
        const { items, total } = await this.fetchAlbumModePage(program.columnId, 1, 2, serviceId, 'asc', mode)
        if (total > 1 || items.length > 1) return program
      } catch {
        // Try the alternate legacy album mode before treating the page as a single video.
      }
    }
    return null
  }

  private monthlyAlbumColumnFromVideoInfo(
    info: Record<string, unknown>, serviceId: CctvServiceId, fallbackName: string, fallbackItemId: string
  ): ProgramInfo | null {
    const sourceId = String(info['album_id'] || '')
    const name = cleanProgramName(String(info['vset_title'] || '')) || fallbackName
    if (!sourceId || !name) return null
    return {
      name, columnId: sourceId, itemId: fallbackItemId, kind: 'column', serviceId,
      listSource: { type: 'album', id: sourceId, serviceId },
      ...(String(info['ctid'] || '') ? { topicId: String(info['ctid']) } : {})
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
    for (const sort of ['asc', 'desc'] as const) {
      try {
        const { items } = await this.fetchAlbumModePage(albumId, 1, 1, serviceId, sort, 0)
        const url = String(items[0]?.['url'] || '')
        if (url) edgeUrls.push(url)
      } catch {
        // One unavailable edge must not discard evidence from the other edge.
      }
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

function extractVcctvCatalogue(html: string): { mid: string; chid: string } | null {
  const requestIndex = html.search(/vplist\.do\?/i)
  if (requestIndex < 0) return null
  const requestSource = html.slice(requestIndex, requestIndex + 1600)
  const extract = (name: 'mid' | 'chid'): string => {
    const direct = requestSource.match(new RegExp(`\\b${name}\\s*=\\s*([A-Za-z0-9_-]+)`, 'i'))
    if (direct) return direct[1].trim()
    const variable = requestSource.match(
      new RegExp(`\\b${name}\\s*=\\s*["']?\\s*\\+\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, 'i')
    )?.[1]
    if (!variable) return ''
    const declaration = html.match(new RegExp(`\\b${escapeRegExp(variable)}\\s*=\\s*["']([^"']+)["']`))
    return (declaration?.[1] || '').replace(/(?:\\t|\t)+$/g, '').trim()
  }
  const mid = extract('mid')
  const chid = extract('chid')
  return mid && chid ? { mid, chid } : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isLegacyThemedVideoPage(pageUrl: string): boolean {
  try {
    return /^\d{4}\.cctv\.com$/i.test(new URL(pageUrl).hostname)
  } catch {
    return false
  }
}

function isVcctvProgrammePage(pageUrl: string): boolean {
  try {
    return new URL(pageUrl).hostname.toLowerCase() === 'v.cctv.com'
  } catch {
    return false
  }
}

function isCultureTravelSingleVideoPage(pageUrl: string, html: string): boolean {
  try {
    return new URL(pageUrl).hostname.toLowerCase() === 'culture-travel.cctv.com'
      && Boolean(extractAuthoritativeItemGuid(html))
  } catch {
    return false
  }
}

function extractAuthoritativeItemGuid(html: string): string {
  if (/\bvar\s+videotvCodes\s*=/i.test(html)) return ''
  const match = html.match(/\bvar\s+itemguid\s*=\s*["']([0-9a-fA-F]{32})["']/i)
  return match ? match[1] : ''
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
  return /cctv4k/i.test(pageUrl)
    || /configType\s*=\s*["']cctv4k["']/i.test(html)
    || /<title[^>]*>[^<]*4K专区/i.test(html)
    ? 'cctv4k' : 'tvcctv'
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

function isStandaloneSegmentVideoInfo(info: Record<string, unknown>): boolean {
  const title = String(info['title'] || '').trim()
  return /^\[视频\]/.test(title) || /^【视频】/.test(title)
}

function looksLikeFullEpisodeCatalogue(items: Array<Record<string, unknown>>): boolean {
  const titles = items.map(item => String(item['title'] || '').trim()).filter(Boolean)
  if (!titles.length) return false
  const fullEpisodeCount = titles.filter(title =>
    /第\s*[0-9一-龥]+\s*[集期回部]/.test(title) || /(?:全集|完整版)/.test(title)
  ).length
  // Keep the fallback conservative: a few episode-like titles mixed into a
  // highlight catalogue must not turn the entire mode into default full videos.
  return fullEpisodeCount / titles.length >= 0.8
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
