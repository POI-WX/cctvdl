import { describe, it, expect } from 'vitest'
import { safeFilename, ensureMp4Extension, buildOutputPath } from '../../src/shared/filename'

describe('safeFilename', () => {
  it('keeps a normal title intact', () => {
    expect(safeFilename('新闻联播 20260101')).toBe('新闻联播 20260101')
  })

  it('replaces illegal characters', () => {
    expect(safeFilename('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })

  it('strips trailing spaces and dots (illegal on Windows)', () => {
    expect(safeFilename('title...   ')).toBe('title')
    expect(safeFilename('name. ')).toBe('name')
  })

  it('escapes Windows reserved device names', () => {
    expect(safeFilename('CON')).toBe('_CON')
    expect(safeFilename('nul')).toBe('_nul')
    expect(safeFilename('COM1')).toBe('_COM1')
    expect(safeFilename('LPT9')).toBe('_LPT9')
    // not reserved if it has more text
    expect(safeFilename('CONTROL')).toBe('CONTROL')
  })

  it('falls back when nothing usable remains', () => {
    expect(safeFilename('')).toBe('video')
    expect(safeFilename('   ')).toBe('video')
    expect(safeFilename('...')).toBe('video')
    expect(safeFilename('', 'fallbackname')).toBe('fallbackname')
  })

  it('caps very long names and re-trims', () => {
    const out = safeFilename('x'.repeat(300))
    expect(out.length).toBeLessThanOrEqual(120)
  })

  it('handles 120+ CJK characters without producing invalid strings', () => {
    // 150 CJK characters — each is a single code unit, so slice is safe
    const cjk = '世'.repeat(150)
    const out = safeFilename(cjk)
    expect(out.length).toBeLessThanOrEqual(120)
    // Result must be valid UTF-16 (no lone surrogates) — encodeURIComponent would throw on malformed
    expect(() => encodeURIComponent(out)).not.toThrow()
    // Content must be non-empty
    expect(out.length).toBeGreaterThan(0)
  })

  it('handles control characters', () => {
    const withControls = 'a' + String.fromCharCode(9) + 'b' + String.fromCharCode(10) + 'c'
    expect(safeFilename(withControls)).toBe('a_b_c')
  })
})

describe('ensureMp4Extension', () => {
  it('appends .mp4 when missing', () => {
    expect(ensureMp4Extension('/tmp/video')).toBe('/tmp/video.mp4')
  })

  it('leaves an existing .mp4 untouched (idempotent, case-insensitive)', () => {
    expect(ensureMp4Extension('/tmp/video.mp4')).toBe('/tmp/video.mp4')
    expect(ensureMp4Extension('/tmp/video.MP4')).toBe('/tmp/video.MP4')
  })

  it('does NOT truncate names that contain dots (the bug this replaced)', () => {
    expect(ensureMp4Extension('/tmp/节目 2026.06.19')).toBe('/tmp/节目 2026.06.19.mp4')
  })

  it('never strips a different extension (appends instead of corrupting)', () => {
    expect(ensureMp4Extension('/tmp/clip.mkv')).toBe('/tmp/clip.mkv.mp4')
  })
})

describe('buildOutputPath', () => {
  it('joins dir + safe title + .mp4', () => {
    expect(buildOutputPath('/videos', '新闻联播')).toBe('/videos/新闻联播.mp4')
  })

  it('normalises trailing slashes/backslashes on the directory', () => {
    expect(buildOutputPath('/videos/', 'x')).toBe('/videos/x.mp4')
    expect(buildOutputPath('C:\\videos\\', 'x')).toBe('C:\\videos/x.mp4')
  })

  it('sanitises the title via safeFilename', () => {
    expect(buildOutputPath('/v', 'a/b:c')).toBe('/v/a_b_c.mp4')
  })

  it('falls back when the title is empty', () => {
    expect(buildOutputPath('/v', '')).toBe('/v/video.mp4')
  })
})
