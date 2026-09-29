import type { DownloadEstimate } from './types'
import { formatFileSize } from './format'

export function describeDownloadEstimate(estimate: DownloadEstimate): {
  sizeLabel: string
  sizeText: string
  note: string
} {
  const projected = estimate.projectedCount || 0
  const unknown = Math.max(0, estimate.totalCount - estimate.estimatedCount - projected)
  return {
    sizeLabel: unknown && estimate.estimatedCount ? '已知部分' : '预计大小',
    sizeText: estimate.estimatedCount ? `约 ${formatFileSize(estimate.estimatedBytes)}` : '暂无法估算',
    note: unknown ? '部分视频大小暂无法估算，实际占用可能更高。' : ''
  }
}
