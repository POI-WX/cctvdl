import { describe, it, expect } from 'vitest'
import { ffmpegPath } from '../../../src/main/download/ffmpeg'

describe('ffmpegPath', () => {
  it('resolves a non-empty path string', () => {
    const p = ffmpegPath()
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
  })

  it('points at the bundled ffmpeg-static binary in dev/test', () => {
    // In dev/test there is no asar, so it should resolve to the real binary
    // (not the bare "ffmpeg" PATH fallback).
    const p = ffmpegPath()
    expect(p.toLowerCase()).toContain('ffmpeg-static')
  })

  it('never returns an un-rewritten app.asar path', () => {
    // The asar → asar.unpacked rewrite must not leave a spawnable path inside
    // the archive. (No-op in dev, but the invariant must hold everywhere.)
    const p = ffmpegPath()
    expect(p.includes('app.asar' + require('path').sep)).toBe(false)
  })
})
