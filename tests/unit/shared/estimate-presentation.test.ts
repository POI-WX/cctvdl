import { describe, expect, it } from 'vitest'
import { describeDownloadEstimate } from '../../../src/shared/estimate-presentation'

describe('describeDownloadEstimate', () => {
  it('labels a complete per-video estimate', () => {
    const view = describeDownloadEstimate({ estimatedBytes: 1024 ** 3, estimatedCount: 3, totalCount: 3, diskFreeBytes: null })
    expect(view.sizeLabel).toBe('预计大小')
    expect(view.note).toBe('')
  })

  it('distinguishes projected items from genuinely unknown items', () => {
    const view = describeDownloadEstimate({
      estimatedBytes: 40 * 1024 ** 3, estimatedCount: 128, projectedCount: 50,
      totalCount: 188, diskFreeBytes: 82 * 1024 ** 3
    })
    expect(view.sizeLabel).toBe('已知部分')
    expect(view.note).toContain('部分视频大小暂无法估算')
  })

  it('does not present a partial sum as the full size', () => {
    const view = describeDownloadEstimate({
      estimatedBytes: 40 * 1024 ** 3, estimatedCount: 128,
      totalCount: 188, diskFreeBytes: null
    })
    expect(view.sizeLabel).toBe('已知部分')
    expect(view.note).toContain('部分视频大小暂无法估算')
  })

  it('explains when repeated missing sizes stop further sampling', () => {
    const view = describeDownloadEstimate({
      estimatedBytes: 0, estimatedCount: 0, totalCount: 1000,
      diskFreeBytes: null, stoppedEarly: true
    })
    expect(view.sizeText).toBe('暂无法估算')
    expect(view.note).toContain('部分视频大小暂无法估算')
  })
})
