import { describe, it, expect } from 'vitest'
import { taskbarFraction, estimateEta } from '../../src/shared/progress'

describe('taskbarFraction', () => {
  it('returns -1 when there is no batch', () => {
    expect(taskbarFraction(0, 0, 0)).toBe(-1)
    expect(taskbarFraction(0, -1, 50)).toBe(-1)
  })

  it('reflects the in-progress job within a single-job batch', () => {
    expect(taskbarFraction(0, 1, 0)).toBe(0)
    expect(taskbarFraction(0, 1, 50)).toBeCloseTo(0.5)
    expect(taskbarFraction(0, 1, 100)).toBeCloseTo(1)
  })

  it('combines finished jobs with current job progress', () => {
    // 1 of 4 done + current at 50% => (1 + 0.5)/4 = 0.375
    expect(taskbarFraction(1, 4, 50)).toBeCloseTo(0.375)
    // 2 of 4 done, current 0% => 0.5
    expect(taskbarFraction(2, 4, 0)).toBeCloseTo(0.5)
  })

  it('is 1 when all jobs finished (no partial added past total)', () => {
    expect(taskbarFraction(4, 4, 0)).toBe(1)
    expect(taskbarFraction(4, 4, 80)).toBe(1)
  })

  it('clamps out-of-range percent', () => {
    expect(taskbarFraction(0, 1, 150)).toBe(1)
    expect(taskbarFraction(0, 1, -20)).toBe(0)
  })

  it('never exceeds 1 or drops below 0', () => {
    expect(taskbarFraction(10, 4, 50)).toBe(1)
    expect(taskbarFraction(-3, 4, -50)).toBe(0)
  })
})

describe('estimateEta', () => {
  it('projects remaining time from average bytes/segment', () => {
    // 4 done of 10, 4000 bytes over 4 samples => 1000 B/seg; 6 remaining => 6000 B
    // at 2000 B/s => 3s
    expect(estimateEta(4000, 4, 4, 10, 2000)).toBeCloseTo(3)
  })

  it('averages over THIS run samples, not all completed (resume case)', () => {
    // Resume: 1 segment completed THIS run (2000 bytes), but 2 completed overall
    // (1 resumed). Average must use sampleCount=1 → 2000 B/seg, not 1000.
    // 1 remaining of 3, speed 1000 B/s => 2000/1000 = 2s.
    expect(estimateEta(2000, 1, 2, 3, 1000)).toBeCloseTo(2)
    // If it had (incorrectly) divided by completedCount=2 it would be 1s.
    expect(estimateEta(2000, 1, 2, 3, 1000)).not.toBeCloseTo(1)
  })

  it('returns 0 when speed is non-positive', () => {
    expect(estimateEta(4000, 4, 4, 10, 0)).toBe(0)
    expect(estimateEta(4000, 4, 4, 10, -5)).toBe(0)
  })

  it('returns 0 before any this-run sample exists', () => {
    expect(estimateEta(0, 0, 2, 5, 1000)).toBe(0)
  })

  it('returns 0 when nothing remains', () => {
    expect(estimateEta(5000, 5, 5, 5, 1000)).toBe(0)
    expect(estimateEta(5000, 5, 6, 5, 1000)).toBe(0)
  })
})
