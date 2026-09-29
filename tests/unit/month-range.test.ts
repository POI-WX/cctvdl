import { describe, expect, it } from 'vitest'
import { enumerateMonths, scanMonths } from '../../src/shared/month-range'
import type { VideoInfo } from '../../src/shared/types'

const video = (guid: string): VideoInfo => ({ guid, title: guid, brief: '', coverUrl: '', time: '' })

describe('enumerateMonths', () => {
  it('跨年包含两个边界月份', () => {
    expect(enumerateMonths('202512', '202602')).toEqual(['202512', '202601', '202602'])
    expect(enumerateMonths('202609', '202609')).toEqual(['202609'])
  })

  it('拒绝无效、反向和过长范围', () => {
    expect(() => enumerateMonths('202613', '202701')).toThrow('有效')
    expect(() => enumerateMonths('202603', '202602')).toThrow('起始月份')
    expect(() => enumerateMonths('190001', '200001')).toThrow('100 年')
    expect(enumerateMonths('201501', '202012')).toHaveLength(72)
  })
})

describe('scanMonths', () => {
  it('限制并发、保留月份顺序并按 GUID 去重，空月仍算成功', async () => {
    let active = 0
    let peak = 0
    const months = ['202601', '202602', '202603', '202604']
    const lists: Record<string, VideoInfo[]> = {
      '202601': [video('a'), video('shared')],
      '202602': [],
      '202603': [video('shared'), video('c')],
      '202604': [video('d')]
    }
    const progress: number[] = []
    const result = await scanMonths(months, async month => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, month === '202601' ? 12 : 2))
      active--
      return lists[month]
    }, { concurrency: 2, onProgress: value => progress.push(value.completed) })
    expect(peak).toBe(2)
    expect(result.videos.map(item => item.guid)).toEqual(['a', 'shared', 'c', 'd'])
    expect(result.byMonth.has('202602')).toBe(true)
    expect(result.failedMonths).toEqual([])
    expect(result.found).toBe(4)
    expect(progress).toEqual([1, 2, 3, 4])
  })

  it('失败月份不当作空月，重试时只请求失败月份', async () => {
    const months = ['202601', '202602', '202603']
    const calls: string[] = []
    const first = await scanMonths(months, async month => {
      calls.push(month)
      if (month === '202602') throw new Error('HTTP 503')
      return month === '202601' ? [video('a')] : []
    }, { concurrency: 1 })
    expect(first.failedMonths).toEqual(['202602'])
    expect(first.errors.get('202602')).toContain('503')
    expect(first.byMonth.has('202602')).toBe(false)

    calls.length = 0
    const retried = await scanMonths(months, async month => {
      calls.push(month)
      return [video('b')]
    }, { previous: first.byMonth })
    expect(calls).toEqual(['202602'])
    expect(retried.failedMonths).toEqual([])
    expect(retried.videos.map(item => item.guid)).toEqual(['a', 'b'])
  })

  it('取消后停止调度剩余月份，不会得到完整结果', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    const result = await scanMonths(['202601', '202602', '202603'], async month => {
      calls.push(month)
      return [video(month)]
    }, {
      concurrency: 1,
      signal: controller.signal,
      onProgress: () => controller.abort()
    })
    expect(calls).toEqual(['202601'])
    expect(result.cancelled).toBe(true)
    expect(result.completed).toBe(1)
    expect(result.videos).toHaveLength(1)
  })
})
