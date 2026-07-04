import crypto from 'crypto'
import { createResilientFetch, type Fetcher, DEFAULT_UA } from './http'
import type { VideoInfo, Quality } from '../../shared/types'

/**
 * 央视新闻（cctvnews.cctv.com）雪书视频页解析服务。
 *
 * 雪书页面形如 `https://content-static.cctvnews.cctv.com/snow-book/{video,index}.html?item_id=<digits>`，
 * 其视频元数据通过 Emas 网关 API 拉取：
 *   GET https://emas-api.cctvnews.cctv.com/h5/emas.feed.article.server.getArticle/1.0.0
 *     ?articleId=<item_id>&appcode=video_web
 * 请求需 HMAC-SHA256 签名（见 computeEmasSignature）。响应为
 *   { "response": "<base64 of inner JSON>" }
 * 解码后得到 data.videos[].qualities[]，每条 quality 是一个 m3u8（HLS，未加密）。
 *
 * 与常规 tv.cctv.com 流（hls_h5e_url + WASM 解密）的关键差异：
 *   - 不需要 fetch HTML 解析 guid
 *   - 没有 master playlist（每条 quality 都是独立的 variant m3u8）
 *   - segment 未加密（AES-128 不存在），可直接 HTTP GET
 *
 * 参考实现：E:/CNTV/videodl/videodl/modules/sources/cctvnews.py
 */

export const EMAS_APP_KEY = '20000009'
export const EMAS_API_NAME = 'emas.feed.article.server.getArticle'
export const EMAS_API_VER = '1.0.0'
export const EMAS_SECRET = 'emasgatewayh5'
export const EMAS_HOST = 'https://emas-api.cctvnews.cctv.com'
export const EMAS_PV = '6.1'
export const EMAS_CLIENT = 'h5'
export const EMAS_APPCODE = 'video_web'

export interface CctvNewsQuality {
  url: string
  width: number
  height: number
  size: number
  bitRate: number
  title: string
}

export interface CctvNewsVideo {
  title: string
  coverUrl: string
  qualities: CctvNewsQuality[]
}

export interface CctvNewsArticle {
  id: string
  title: string
  publishTime: number   // epoch ms
  videos: CctvNewsVideo[]
}

/**
 * Emas 网关签名：
 *   1. 按 key 字典序排列 params，拼接为 `k1=v1&k2=v2` 形式
 *   2. MD5 该字符串（hex）
 *   3. 拼接 sign 原文：`&&&<appKey>&<md5>&<timestamp>&<apiName>&<apiVer>&&&&&`
 *      —— 前缀 3 个 &、后缀 5 个 &，共 7 段被 & 分隔
 *   4. HMAC-SHA256(secret, 原文) hex 编码
 *
 * 等价于 Python 的 "&".join(["&&", app_key, md5, ts, api_name, api_ver, "&&&&"])，
 * 其结果首段 "&&" + 分隔符 "&" = "&&&"，末段 "&&&&" 前置分隔符 = "&&&&&"。
 */
export function computeEmasSignature(
  appKey: string,
  apiName: string,
  apiVer: string,
  params: Record<string, string>,
  timestamp: string,
  secret: string
): string {
  const sortedKeys = Object.keys(params).sort()
  const queryString = sortedKeys.map(k => `${k}=${params[k]}`).join('&')
  const md5 = crypto.createHash('md5').update(queryString).digest('hex')
  const signStr = `&&&${appKey}&${md5}&${timestamp}&${apiName}&${apiVer}&&&&&`
  return crypto.createHmac('sha256', secret).update(signStr).digest('hex')
}

/**
 * 组装 Emas 网关请求头。timestamp 默认取当前秒；测试可注入固定值以便固化向量。
 */
export function buildEmasHeaders(
  params: Record<string, string>,
  timestamp?: string
): Record<string, string> {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000))
  const sign = computeEmasSignature(EMAS_APP_KEY, EMAS_API_NAME, EMAS_API_VER, params, ts, EMAS_SECRET)
  return {
    'User-Agent': DEFAULT_UA,
    'Referer': 'https://content-static.cctvnews.cctv.com/',
    Origin: 'https://content-static.cctvnews.cctv.com',
    'Content-Type': 'application/json; charset=utf8',
    'from-client': EMAS_CLIENT,
    'x-emas-gw-appkey': EMAS_APP_KEY,
    'x-emas-gw-pv': EMAS_PV,
    'x-emas-gw-t': ts,
    'x-emas-gw-sign': sign
  }
}

function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 按画质选择最佳 m3u8。优先按 (width*height, bitRate, size) 降序；
 * 若用户指定了 quality tier，则挑选不超过对应带宽上限的最高画质，找不到时
 * fallback 到最低画质（与 cctv.ts CCTVHLSBestParser 的降级策略一致）。
 */
export function pickQuality(
  qualities: CctvNewsQuality[],
  maxBandwidth: number
): CctvNewsQuality | null {
  if (!qualities.length) return null
  const eligible = qualities.filter(q => q.url && q.bitRate <= maxBandwidth)
  if (eligible.length > 0) {
    return eligible.reduce((best, q) => {
      const bestPx = best.width * best.height
      const qPx = q.width * q.height
      return qPx > bestPx || (qPx === bestPx && q.bitRate > best.bitRate) ? q : best
    })
  }
  // 全部超过带宽上限，选最低画质保证可下载
  return qualities.reduce((lowest, q) =>
    q.url && (q.bitRate < lowest.bitRate || !lowest.url) ? q : lowest
  )
}

/**
 * 把 Quality tier 映射为带宽上限（bps）。与 cctv.ts QUALITY_MAP 对齐，
 * 但 cctvnews 实际可用带宽档位不同，故独立映射。
 */
export function qualityToBandwidth(quality: Quality): number {
  switch (quality) {
    case 'liuchang': return 600_000     // ~360p
    case 'biaoqing': return 1_000_000   // ~540p
    case 'gaoqing':  return 2_000_000   // ~720p
    case 'chaoqing': return 3_500_000   // ~1080p 低码
    case 'bluray':   return Infinity
    case 'auto':     return Infinity
  }
}

export class CctvNewsService {
  constructor(private readonly fetch: Fetcher = createResilientFetch()) {}

  /**
   * 调用 Emas 网关拉取 article 元数据。返回结构化结果；base64 解码失败 / 响应
   * 缺字段都抛错，由上层统一 humanize。
   */
  async fetchArticle(itemId: string): Promise<CctvNewsArticle> {
    const params: Record<string, string> = { articleId: itemId, appcode: EMAS_APPCODE }
    const queryString = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
    const url = `${EMAS_HOST}/h5/${EMAS_API_NAME}/${EMAS_API_VER}?${queryString}`
    const headers = buildEmasHeaders(params)
    const resp = await this.fetch(url, { headers })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from cctvnews emas api`)
    const outer = (await resp.json()) as Record<string, unknown>
    const responseB64 = safeString(outer['response'])
    if (!responseB64) {
      // 空响应：常见于已下架或仅限 App 内观看的内容
      throw new Error('cctvnews 接口返回空数据（内容可能已下架或仅限 App 观看）')
    }
    let inner: Record<string, unknown>
    try {
      inner = JSON.parse(Buffer.from(responseB64, 'base64').toString('utf-8')) as Record<string, unknown>
    } catch {
      throw new Error('cctvnews 响应 base64 解码失败')
    }
    const data = (inner['data'] ?? {}) as Record<string, unknown>
    const rawVideos = (Array.isArray(data['videos']) ? data['videos'] : []) as Array<Record<string, unknown>>
    const videos: CctvNewsVideo[] = rawVideos
      .filter(v => v && Array.isArray(v['qualities']) && (v['qualities'] as unknown[]).length > 0)
      .map(v => ({
        title: safeString(v['title']) || safeString(data['title']) || '',
        coverUrl: extractCoverUrl(v),
        qualities: (v['qualities'] as Array<Record<string, unknown>>).map(q => ({
          url: safeString(q['url']),
          width: safeNumber(q['width']),
          height: safeNumber(q['height']),
          size: safeNumber(q['size']),
          bitRate: safeNumber(q['bitRate']),
          title: safeString(q['title'])
        })).filter(q => q.url.startsWith('http'))
      }))
      .filter(v => v.qualities.length > 0)

    return {
      id: safeString(data['id']) || itemId,
      title: safeString(data['title']) || '',
      publishTime: safeNumber(data['publish_time']),
      videos
    }
  }

  /**
   * 解析雪书页面 URL 为 VideoInfo 数组。一个 item_id 可能含多条视频；
   * 每条视频按用户偏好画质选择 m3u8 URL。空 videos 时返回空数组（由上层
   * IPC 决定是否抛错）。
   */
  async resolveFromUrl(pageUrl: string, quality: Quality = 'auto'): Promise<VideoInfo[]> {
    const itemId = extractSnowBookItemId(pageUrl)
    if (!itemId) throw new Error('cctvnews 链接缺少 item_id 参数')
    const article = await this.fetchArticle(itemId)
    const maxBw = qualityToBandwidth(quality)
    return article.videos.map((v, idx) => {
      const picked = pickQuality(v.qualities, maxBw) ?? v.qualities[0]
      const guid = `cctvnews_${article.id}_${idx}`
      const time = article.publishTime > 0
        ? formatEpochMsChina(article.publishTime)
        : ''
      return {
        guid,
        title: v.title || article.title || '央视新闻视频',
        brief: '',
        coverUrl: v.coverUrl,
        time,
        m3u8Url: picked.url
      }
    })
  }
}

function extractCoverUrl(video: Record<string, unknown>): string {
  const cover = video['cover'] as Record<string, unknown> | undefined
  const url = cover && typeof cover['url'] === 'string' ? cover['url'] : ''
  return url.startsWith('//') ? `https:${url}` : url
}

function extractSnowBookItemId(pageUrl: string): string {
  try {
    const u = new URL(pageUrl)
    return u.searchParams.get('item_id') ?? ''
  } catch {
    return ''
  }
}

/** 识别雪书视频页（含 content-static 子域）。 */
export function isCctvNewsSnowBookPage(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl)
    return /^(content-static\.)?cctvnews\.cctv\.com$/i.test(u.hostname)
      && u.searchParams.has('item_id')
  } catch {
    return false
  }
}

function formatEpochMsChina(ms: number): string {
  const d = new Date(ms + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
