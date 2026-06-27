// Map raw internal error strings to friendly, actionable zh-CN messages for the UI.
// The raw text is preserved separately (e.g. tooltip / failures log) for diagnosis.

export const enum ErrorCode {
  Timeout      = 'TIMEOUT',
  NoStream     = 'NO_STREAM',
  ParseFailed  = 'PARSE_FAILED',
  HttpClient   = 'HTTP_CLIENT',
  HttpServer   = 'HTTP_SERVER',
  FfmpegFailed = 'FFMPEG_FAILED',
  EmptyOutput  = 'EMPTY_OUTPUT',
  DecryptFailed = 'DECRYPT_FAILED',
  Unknown      = 'UNKNOWN',
}

export interface AppError {
  code: ErrorCode
  message: string  // user-facing zh-CN string
  raw: string      // original error text for tooltip / log
}

interface Rule { test: RegExp; code: ErrorCode; message: string }

const RULES: Rule[] = [
  { test: /timed?\s?out|timeout/i,                               code: ErrorCode.Timeout,      message: '网络超时，请检查网络连接后重试' },
  { test: /no hls url|no segment urls|No HLS variants/i,         code: ErrorCode.NoStream,     message: '未找到可下载的视频流（可能是付费、加密或已下架内容）' },
  { test: /无法解析节目信息|cannot parse|resolve.*column/i,        code: ErrorCode.ParseFailed,  message: '无法解析该链接，请确认是央视节目/栏目页面' },
  // Require an explicit "HTTP" prefix so a bare status-like number (e.g. a
  // segment index in "segment 404 failed") isn't misread as an HTTP 4xx error.
  { test: /HTTP\s*4\d\d/i,                                        code: ErrorCode.HttpClient,   message: '资源不可访问（可能已下架或地区受限）' },
  { test: /HTTP\s*5\d\d|fetch failed|ECONN|ENOTFOUND|network|getaddrinfo/i, code: ErrorCode.HttpServer, message: '服务器或网络异常，请稍后重试' },
  { test: /ffmpeg/i,                                              code: ErrorCode.FfmpegFailed,  message: '视频合并失败（ffmpeg 错误），可在设置中尝试「兼容重编码」' },
  { test: /output file missing or empty|empty/i,                  code: ErrorCode.EmptyOutput,  message: '下载结果为空，请重试' },
  { test: /decrypt/i,                                             code: ErrorCode.DecryptFailed, message: '解密失败，请重试' },
]

/** Parse a raw error string into a structured AppError. */
export function parseError(raw: string | undefined | null): AppError {
  const text = (raw ?? '').toString().trim()
  if (!text) return { code: ErrorCode.Unknown, message: '未知错误', raw: '' }
  for (const rule of RULES) {
    if (rule.test.test(text)) return { code: rule.code, message: rule.message, raw: text }
  }
  const message = text.length > 160 ? text.slice(0, 157) + '…' : text
  return { code: ErrorCode.Unknown, message, raw: text }
}

/** Convert a raw error string into a concise, user-friendly zh-CN message. */
export function humanizeError(raw: string | undefined | null): string {
  return parseError(raw).message
}
