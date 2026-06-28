import crypto from 'crypto'
import { createResilientFetch, type Fetcher, uaInit } from './http'
import { logger } from '../logger'
import type { Quality } from '../../shared/types'
const API_SALT = '47899B86370B879139C08EA3B5E88267'
const API_UID = '826D8646DEBBFD97A82D23CAE45A55BE'
const API_VN = '2049'

// Bandwidth caps per quality tier (bps).
// Verified against live CCTV HLS master playlists (2026-06-21).
// Available tiers vary by channel:
//   普通节目:       460800 / 870400 / 1228800 / 2048000          (max 720p 超清)
//   CCTV-16 4K奥运: 460800 / 870400 / 1228800 / 2048000 / 3072000 (max 1080p 蓝光)
//   CCTV-4K超高清:  2048000 / 4096000 only                       (max 1080p 蓝光, 2 tiers)
//   老节目:         460800 / 870400 only                         (max 360p, 2 tiers)
// Falls back to the lowest available tier when the requested one is absent.
export const QUALITY_MAP: Record<Quality, number> = {
  auto:      Infinity,   // 自动（最高画质）
  bluray:    4_096_000,  // 蓝光 1080p（3Mbps 和 4Mbps 两档）
  chaoqing:  2_048_000,  // 超清 720p
  gaoqing:   1_228_800,  // 高清 720p
  biaoqing:    870_400,  // 标清 360p
  liuchang:    460_800,  // 流畅 270p
}

export interface HLSVariant {
  uri: string
  bandwidth: number
  resolution: { width: number; height: number }
  score: [number, number]
}

export interface ResolveResult {
  segmentUrls: string[]
}

export function computeSignature(tsp: string): string {
  return crypto
    .createHash('md5')
    .update(tsp + API_VN + API_SALT + API_UID)
    .digest('hex')
}

export class CCTVHLSBestParser {
  private static KV = /([A-Z0-9-]+)=(".*?"|[^,]*)/g

  static best(masterText: string, baseUrl: string, maxBandwidth = Infinity): HLSVariant {
    const lines = masterText.split('\n').map((l) => l.trim()).filter(Boolean)
    const variants: HLSVariant[] = []
    let idx = 0
    while (idx < lines.length) {
      const line = lines[idx]
      if (!line.startsWith('#EXT-X-STREAM-INF:')) {
        idx++
        continue
      }
      const attrStr = line.split(':', 2)[1]
      const attrs: Record<string, string> = {}
      let m: RegExpExecArray | null
      const re = new RegExp(CCTVHLSBestParser.KV.source, 'g')
      while ((m = re.exec(attrStr))) {
        let val = m[2]
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
        attrs[m[1]] = val.trim()
      }
      let uriIdx = idx + 1
      while (uriIdx < lines.length && (lines[uriIdx].startsWith('#') || !lines[uriIdx])) uriIdx++
      if (uriIdx >= lines.length) break
      const uri = new URL(lines[uriIdx], baseUrl).href
      const bandwidth = parseInt(attrs['BANDWIDTH'] || '0', 10) || 0
      const res = attrs['RESOLUTION'] || ''
      let width = 0, height = 0
      if (res.includes('x')) {
        const parts = res.toLowerCase().split('x')
        width = parseInt(parts[0], 10) || 0
        height = parseInt(parts[1], 10) || 0
      }
      // Collect ALL variants regardless of bandwidth cap; filtering happens below
      variants.push({ uri, bandwidth, resolution: { width, height }, score: [width * height, bandwidth] })
      idx = uriIdx + 1
    }
    if (!variants.length) throw new Error('No HLS variants found')
    // Filter to requested quality tier. If nothing qualifies (e.g. CCTV-4K超高清 only has
    // 2/4Mbps tiers but user requested 高清/标清/流畅), fall back to the lowest available
    // tier rather than failing with an error.
    const eligible = variants.filter(v => v.bandwidth <= maxBandwidth)
    if (eligible.length > 0) {
      // Normal path: pick highest-quality within the cap
      return eligible.reduce((best, v) =>
        v.score[0] > best.score[0] || (v.score[0] === best.score[0] && v.score[1] > best.score[1]) ? v : best
      )
    }
    // Fallback: requested tier doesn't exist in this content (e.g. user wants 标清 but
    // content only has 2Mbps and 4Mbps). Pick the lowest available tier so the download
    // still works rather than failing.
    return variants.reduce((lowest, v) => v.bandwidth < lowest.bandwidth ? v : lowest)
  }
}

export function parseSegmentUrls(variantText: string, baseUrl: string): string[] {
  return variantText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new URL(l, baseUrl).href)
}

export class CctvApiService {
  constructor(private readonly fetch: Fetcher = createResilientFetch()) {}

  async fetchVideoInfo(guid: string, signal?: AbortSignal): Promise<{
    hlsH5eUrl: string | null
    hlsUrl: string | null
  }> {
    const tsp = String(Math.floor(Date.now() / 1000))
    const vc = computeSignature(tsp)
    const params = new URLSearchParams({
      pid: guid, client: 'flash', im: '0', tsp, vn: API_VN, vc, uid: API_UID, wlan: ''
    })
    const apiUrl = `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?${params}`
    const resp = await this.fetch(apiUrl, uaInit(signal))
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from getHttpVideoInfo.do`)
    const data = await resp.json() as Record<string, unknown>
    const manifest = (data['manifest'] as Record<string, unknown>) || {}
    const hlsH5eUrl = (data['hls_h5e_url'] as string) || (manifest['hls_h5e_url'] as string) || null
    const hlsUrl = (data['hls_url'] as string) || (manifest['hls_url'] as string) || null
    return { hlsH5eUrl, hlsUrl }
  }

  async resolveSegmentUrls(guid: string, quality: Quality = 'auto', signal?: AbortSignal): Promise<ResolveResult> {
    const info = await this.fetchVideoInfo(guid, signal)

    const streamUrl = info.hlsH5eUrl || info.hlsUrl
    if (!streamUrl) throw new Error('No HLS URL found')

    const masterResp = await this.fetch(streamUrl, uaInit(signal))
    if (!masterResp.ok) throw new Error(`HTTP ${masterResp.status} fetching master playlist`)
    const masterText = await masterResp.text()
    const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1)
    const maxBw = QUALITY_MAP[quality] ?? Infinity
    const variant = CCTVHLSBestParser.best(masterText, baseUrl, maxBw)

    const variantResp = await this.fetch(variant.uri, uaInit(signal))
    if (!variantResp.ok) throw new Error(`HTTP ${variantResp.status} fetching variant playlist`)
    const variantText = await variantResp.text()
    const variantBase = variant.uri.substring(0, variant.uri.lastIndexOf('/') + 1)
    const segmentUrls = parseSegmentUrls(variantText, variantBase)

    logger.debug(`HLS variant: ${variant.bandwidth}bps ${variant.resolution.width}x${variant.resolution.height}, ${segmentUrls.length} segments`)
    return { segmentUrls }
  }
}
