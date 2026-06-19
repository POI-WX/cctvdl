import { describe, it, expect } from 'vitest'
// The redirect helper lives with the wrapper layer (plain CommonJS).
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { resolveFfmpegCommand } = require('../../../resources/decrypt/ffmpeg-redirect')

const BUNDLED = '/opt/app/ffmpeg-static/ffmpeg'

describe('resolveFfmpegCommand', () => {
  it('rewrites a bare ffmpeg command to the bundled binary', () => {
    expect(resolveFfmpegCommand('ffmpeg', { CCTVDL_FFMPEG: BUNDLED })).toBe(BUNDLED)
  })

  it('rewrites ffmpeg.exe (Windows) case-insensitively', () => {
    expect(resolveFfmpegCommand('FFmpeg.EXE', { CCTVDL_FFMPEG: BUNDLED })).toBe(BUNDLED)
  })

  it('leaves the command unchanged when no bundled path is set', () => {
    expect(resolveFfmpegCommand('ffmpeg', {})).toBe('ffmpeg')
  })

  it('does not touch non-ffmpeg commands', () => {
    expect(resolveFfmpegCommand('node', { CCTVDL_FFMPEG: BUNDLED })).toBe('node')
  })

  it('only matches a bare invocation, not an unrelated path ending in ffmpeg', () => {
    // A full path whose basename is ffmpeg is still the binary we want to swap;
    // but an arbitrary other executable must be left alone.
    expect(resolveFfmpegCommand('/usr/bin/ffmpeg', { CCTVDL_FFMPEG: BUNDLED })).toBe(BUNDLED)
    expect(resolveFfmpegCommand('/usr/bin/myffmpeg', { CCTVDL_FFMPEG: BUNDLED })).toBe('/usr/bin/myffmpeg')
  })

  it('handles non-string input gracefully', () => {
    expect(resolveFfmpegCommand(undefined, { CCTVDL_FFMPEG: BUNDLED })).toBe(undefined)
  })
})
