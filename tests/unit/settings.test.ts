import { describe, it, expect } from 'vitest'
import { normalizeSettings, QUALITIES, MIN_THREADS, MAX_THREADS } from '../../src/shared/settings'
import type { Settings } from '../../src/shared/types'

const fallback: Settings = {
  savePath: '/videos',
  threadCount: 8,
  quality: 'auto',
  reencode: false,
  logLevel: 'info',
  darkMode: false,
  logPath: '/logs',
  autoOpenFolder: false,
  clipboardWatch: false
}

describe('normalizeSettings', () => {
  it('returns full defaults for undefined/garbage input', () => {
    expect(normalizeSettings(undefined, fallback)).toEqual(fallback)
    expect(normalizeSettings('not an object', fallback)).toEqual(fallback)
    expect(normalizeSettings(null, fallback)).toEqual(fallback)
  })

  it('fills missing fields from fallback (legacy config migration)', () => {
    const legacy = { savePath: '/x', threadCount: 4, quality: 'chaoqing', logLevel: 'debug' }
    const out = normalizeSettings(legacy, fallback)
    expect(out.reencode).toBe(false)      // new field filled from fallback
    expect(out.darkMode).toBe(false)
    expect(out.savePath).toBe('/x')
    expect(out.threadCount).toBe(4)
    expect(out.quality).toBe('chaoqing')
  })

  it('migrates legacy quality values (hd/sd/low) to fallback auto', () => {
    // Old keys no longer exist in QUALITIES; they normalise to 'auto'
    expect(normalizeSettings({ quality: 'hd' }, fallback).quality).toBe('auto')
    expect(normalizeSettings({ quality: 'sd' }, fallback).quality).toBe('auto')
    expect(normalizeSettings({ quality: 'low' }, fallback).quality).toBe('auto')
  })

  it('clamps threadCount into [MIN, MAX]', () => {
    expect(normalizeSettings({ threadCount: 999 }, fallback).threadCount).toBe(MAX_THREADS)
    expect(normalizeSettings({ threadCount: 0 }, fallback).threadCount).toBe(MIN_THREADS)
    expect(normalizeSettings({ threadCount: -5 }, fallback).threadCount).toBe(MIN_THREADS)
    expect(normalizeSettings({ threadCount: 6 }, fallback).threadCount).toBe(6)
  })

  it('falls back threadCount when not a number', () => {
    expect(normalizeSettings({ threadCount: 'eight' }, fallback).threadCount).toBe(8)
    expect(normalizeSettings({ threadCount: NaN }, fallback).threadCount).toBe(8)
  })

  it('validates enum fields, replacing invalid with fallback', () => {
    expect(normalizeSettings({ quality: 'ultra' }, fallback).quality).toBe('auto')
    expect(normalizeSettings({ logLevel: 'trace' }, fallback).logLevel).toBe('info')
    // 'warn' is no longer a supported level → migrates to the default 'info'.
    expect(normalizeSettings({ logLevel: 'warn' }, fallback).logLevel).toBe('info')
    expect(normalizeSettings({ logLevel: 'debug' }, fallback).logLevel).toBe('debug')
  })

  it('accepts all valid Quality values', () => {
    for (const q of QUALITIES) {
      expect(normalizeSettings({ quality: q }, fallback).quality).toBe(q)
    }
  })

  it('coerces boolean fields', () => {
    expect(normalizeSettings({ reencode: 1 }, fallback).reencode).toBe(false)
    expect(normalizeSettings({ darkMode: 'yes' }, fallback).darkMode).toBe(false)
    expect(normalizeSettings({ reencode: true }, fallback).reencode).toBe(true)
  })

  it('keeps a fully valid settings object intact', () => {
    const valid: Settings = { ...fallback, threadCount: 3, quality: 'liuchang', reencode: true, darkMode: true }
    expect(normalizeSettings(valid, fallback)).toEqual(valid)
  })
})
