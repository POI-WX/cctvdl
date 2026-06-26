import { describe, it, expect } from 'vitest'
import { humanizeError, parseError, ErrorCode } from '../../src/shared/errors'

describe('humanizeError（向后兼容）', () => {
  it('handles empty/nullish input', () => {
    expect(humanizeError('')).toBe('未知错误')
    expect(humanizeError(undefined)).toBe('未知错误')
    expect(humanizeError(null)).toBe('未知错误')
  })

  it('maps timeout errors', () => {
    expect(humanizeError('decrypt timed out after 180s')).toContain('超时')
    expect(humanizeError('Error: request timeout')).toContain('超时')
  })

  it('maps missing-stream errors', () => {
    expect(humanizeError('No HLS URL found')).toContain('未找到可下载的视频流')
    expect(humanizeError('no segment urls')).toContain('未找到可下载的视频流')
  })

  it('maps HTTP 4xx to access error', () => {
    expect(humanizeError('HTTP 404 fetching page')).toContain('不可访问')
  })

  it('maps HTTP 5xx / network to server error', () => {
    expect(humanizeError('HTTP 503 from API')).toContain('服务器或网络异常')
    expect(humanizeError('fetch failed after 3 attempts: Error: ECONNRESET')).toContain('服务器或网络异常')
  })

  it('maps ffmpeg errors and suggests reencode', () => {
    expect(humanizeError('ffmpeg copy exit 1: ...')).toContain('合并失败')
  })

  it('maps empty-output errors', () => {
    expect(humanizeError('output file missing or empty: /x.mp4')).toContain('为空')
  })

  it('maps decrypt errors', () => {
    expect(humanizeError('segment 5 failed: decrypt exit 1')).toContain('解密失败')
  })

  it('does not misread a segment index as an HTTP 4xx error', () => {
    expect(humanizeError('segment 404 failed: decrypt exit 1')).toContain('解密失败')
    expect(humanizeError('segment 500 failed: decrypt timed out')).toContain('超时')
  })

  it('falls back to a trimmed original for unknown errors', () => {
    expect(humanizeError('some weird unmatched thing')).toBe('some weird unmatched thing')
    const long = 'x'.repeat(300)
    const out = humanizeError(long)
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('prioritises specific rules (timeout beats network combo)', () => {
    expect(humanizeError('timed out: ECONNRESET')).toContain('超时')
  })
})

describe('parseError — ErrorCode 枚举覆盖', () => {
  it('空/null → Unknown', () => {
    expect(parseError('').code).toBe(ErrorCode.Unknown)
    expect(parseError(null).code).toBe(ErrorCode.Unknown)
    expect(parseError(undefined).code).toBe(ErrorCode.Unknown)
    expect(parseError('').message).toBe('未知错误')
  })

  it('Timeout', () => {
    expect(parseError('timed out').code).toBe(ErrorCode.Timeout)
    expect(parseError('request timeout').code).toBe(ErrorCode.Timeout)
  })

  it('NoStream', () => {
    expect(parseError('No HLS URL found').code).toBe(ErrorCode.NoStream)
    expect(parseError('no segment urls returned').code).toBe(ErrorCode.NoStream)
  })

  it('ParseFailed', () => {
    expect(parseError('无法解析节目信息').code).toBe(ErrorCode.ParseFailed)
    expect(parseError('cannot parse column_id').code).toBe(ErrorCode.ParseFailed)
  })

  it('HttpClient', () => {
    expect(parseError('HTTP 404 not found').code).toBe(ErrorCode.HttpClient)
    expect(parseError('HTTP 403 forbidden').code).toBe(ErrorCode.HttpClient)
  })

  it('HttpServer', () => {
    expect(parseError('HTTP 500 internal server error').code).toBe(ErrorCode.HttpServer)
    expect(parseError('fetch failed: ENOTFOUND').code).toBe(ErrorCode.HttpServer)
  })

  it('FfmpegFailed', () => {
    expect(parseError('ffmpeg exit code 1').code).toBe(ErrorCode.FfmpegFailed)
  })

  it('EmptyOutput', () => {
    expect(parseError('output file missing or empty').code).toBe(ErrorCode.EmptyOutput)
  })

  it('DecryptFailed', () => {
    expect(parseError('decrypt failed on segment 3').code).toBe(ErrorCode.DecryptFailed)
  })

  it('Unknown 时 raw 保留原始文本', () => {
    const result = parseError('some unknown error text')
    expect(result.code).toBe(ErrorCode.Unknown)
    expect(result.raw).toBe('some unknown error text')
    expect(result.message).toBe('some unknown error text')
  })

  it('raw 始终保留原始文本，即使命中规则', () => {
    const result = parseError('ffmpeg exit code 1: details here')
    expect(result.raw).toBe('ffmpeg exit code 1: details here')
    expect(result.code).toBe(ErrorCode.FfmpegFailed)
  })
})
