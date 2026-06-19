import { describe, it, expect } from 'vitest'
import { formatBytes, formatSpeed, formatTime } from '../../../src/shared/format'

describe('shared/format', () => {
  describe('formatBytes', () => {
    it('formats bytes', () => {
      expect(formatBytes(0)).toBe('0 B')
      expect(formatBytes(512)).toBe('512 B')
    })
    it('formats KB/MB/GB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
      expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
    })
    it('drops decimals for large magnitudes', () => {
      expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB')
    })
    it('handles invalid input', () => {
      expect(formatBytes(-1)).toBe('0 B')
      expect(formatBytes(NaN)).toBe('0 B')
    })
  })

  describe('formatSpeed', () => {
    it('formats a real byte/s rate', () => {
      expect(formatSpeed(1024)).toBe('1.0 KB/s')
      expect(formatSpeed(3 * 1024 * 1024)).toBe('3.0 MB/s')
    })
    it('shows a dash when there is no throughput', () => {
      expect(formatSpeed(0)).toBe('—')
      expect(formatSpeed(-5)).toBe('—')
      expect(formatSpeed(NaN)).toBe('—')
    })
    // Regression: speed must never be the old fabricated "percent*10 = GB/s" value.
    it('does not invent absurd GB/s figures', () => {
      expect(formatSpeed(48.8)).not.toContain('GB')
    })
  })

  describe('formatTime', () => {
    it('returns 计算中 for non-positive/invalid', () => {
      expect(formatTime(0)).toBe('计算中...')
      expect(formatTime(-5)).toBe('计算中...')
      expect(formatTime(NaN)).toBe('计算中...')
    })
    it('formats seconds only', () => {
      expect(formatTime(45)).toBe('45秒')
    })
    it('formats minutes and seconds', () => {
      expect(formatTime(125)).toBe('2分5秒')
    })
    it('formats hours and minutes', () => {
      expect(formatTime(3661)).toBe('1时1分')
    })
  })
})
