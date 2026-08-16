// Map raw internal error strings to friendly, actionable zh-CN messages for the UI.

interface Rule { test: RegExp; message: string }

const RULES: Rule[] = [
  { test: /timed?\s?out|timeout/i,                               message: '网络超时，请检查网络连接后重试' },
  { test: /no hls url|no segment urls|No HLS variants/i,         message: '未找到可下载的视频流（可能是付费、加密或已下架内容）' },
  { test: /无法解析节目信息|无法解析视频信息|cannot parse|resolve.*column/i, message: '无法解析该链接，请确认是央视节目/栏目页面' },
  { test: /pagination (?:ended|repeated|made no progress)/i,     message: '央视节目列表分页异常，请稍后重试' },
  // cctvnews (snow-book) specific: emas gateway signing, base64 decode, empty data.
  { test: /cctvnews 接口返回空|已下架|App 观看/i,                message: '该央视新闻视频无法下载（可能已下架或仅限 App 观看）' },
  { test: /cctvnews.*base64|base64.*解码失败/i,                  message: '央视新闻数据解析失败，请稍后重试' },
  { test: /emas.*api|cctvnews emas/i,                            message: '央视新闻 API 请求失败，请检查网络连接' },
  { test: /item_id/i,                                            message: '央视新闻链接格式不正确（缺少 item_id 参数）' },
  // Require an explicit "HTTP" prefix so a bare status-like number (e.g. a
  // segment index in "segment 404 failed") isn't misread as an HTTP 4xx error.
  { test: /HTTP\s*4\d\d/i,                                        message: '资源不可访问（可能已下架或地区受限）' },
  { test: /HTTP\s*5\d\d|fetch failed|ECONN|ENOTFOUND|network|getaddrinfo/i, message: '服务器或网络异常，请稍后重试' },
  { test: /ffmpeg/i,                                              message: '视频合并失败（ffmpeg 错误），可在设置中尝试「兼容重编码」' },
  { test: /output file missing or empty|empty/i,                  message: '下载结果为空，请重试' },
  { test: /decrypt/i,                                             message: '解密失败，请重试' },
]

/** Convert a raw error string into a concise, user-friendly zh-CN message. */
export function humanizeError(raw: string | undefined | null): string {
  const text = (raw ?? '').toString().trim()
  if (!text) return '未知错误'
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.message
  }
  return text.length > 160 ? text.slice(0, 157) + '…' : text
}
