// Map raw internal error strings to friendly, actionable zh-CN messages for the UI.
// The raw text is preserved separately (e.g. tooltip / failures log) for diagnosis.

interface Rule { test: RegExp; message: string }

const RULES: Rule[] = [
  { test: /timed?\s?out|timeout/i, message: '网络超时，请检查网络连接后重试' },
  { test: /no hls url|no segment urls|No HLS variants/i, message: '未找到可下载的视频流（可能是付费、加密或已下架内容）' },
  { test: /无法解析节目信息|cannot parse|resolve.*column/i, message: '无法解析该链接，请确认是央视节目/栏目页面' },
  // Require an explicit "HTTP" prefix so a bare status-like number (e.g. a
  // segment index in "segment 404 failed") isn't misread as an HTTP 4xx error.
  { test: /HTTP\s*4\d\d/i, message: '资源不可访问（可能已下架或地区受限）' },
  { test: /HTTP\s*5\d\d|fetch failed|ECONN|ENOTFOUND|network|getaddrinfo/i, message: '服务器或网络异常，请稍后重试' },
  { test: /ffmpeg/i, message: '视频合并失败（ffmpeg 错误），可在设置中尝试「兼容重编码」' },
  { test: /output file missing or empty|empty/i, message: '下载结果为空，请重试' },
  { test: /decrypt/i, message: '解密失败，请重试' },
]

/**
 * Convert a raw error string into a concise, user-friendly message.
 * Falls back to a trimmed version of the original when no rule matches.
 */
export function humanizeError(raw: string | undefined | null): string {
  const text = (raw ?? '').toString().trim()
  if (!text) return '未知错误'
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.message
  }
  // Unknown: surface a trimmed original so nothing is hidden.
  return text.length > 160 ? text.slice(0, 157) + '…' : text
}
