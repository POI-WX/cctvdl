import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDownloadStore } from '../../../src/renderer/stores/download'
import type { BatchStartInfo, DownloadProgress, DownloadJob, BatchResult } from '../../../src/shared/types'

describe('useDownloadStore', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('初始状态', () => {
    const store = useDownloadStore()
    expect(store.jobs).toEqual([])
    expect(store.running).toBe(false)
    expect(store.activeDownloads).toBe(0)
    expect(store.updateVersion).toBe('')
  })

  describe('applyBatchStarted', () => {
    it('填充 jobs 并设置 running', () => {
      const store = useDownloadStore()
      const info: BatchStartInfo = {
        total: 2,
        jobs: [
          { id: 'j1', title: '视频A', guid: 'G1' },
          { id: 'j2', title: '视频B', guid: 'G2' },
        ]
      }
      store.applyBatchStarted(info)
      expect(store.jobs).toHaveLength(2)
      expect(store.jobs[0].state).toBe('Queued')
      expect(store.running).toBe(true)
    })
  })

  describe('applyProgress', () => {
    it('更新对应 job 的进度', () => {
      const store = useDownloadStore()
      store.applyBatchStarted({ total: 1, jobs: [{ id: 'j1', title: 'T', guid: 'G' }] })
      const p: DownloadProgress = {
        jobId: 'j1', percent: 50, state: 'Downloading', stage: 'DownloadingShards',
        speed: 1024, eta: 30, segmentsDone: 5, segmentsTotal: 10,
        batchCompleted: 0, batchTotal: 1
      }
      store.applyProgress(p)
      expect(store.jobs[0].percent).toBe(50)
      expect(store.jobs[0].speed).toBe(1024)
      expect(store.jobs[0].segmentsDone).toBe(5)
      expect(store.activeDownloads).toBe(1)
    })

    it('未知 jobId 不报错', () => {
      const store = useDownloadStore()
      const p: DownloadProgress = { jobId: 'unknown', percent: 50, state: 'Downloading', stage: 'None' }
      expect(() => store.applyProgress(p)).not.toThrow()
    })
  })

  describe('applyJobFinished', () => {
    it('更新 job 状态与错误信息', () => {
      const store = useDownloadStore()
      store.applyBatchStarted({ total: 1, jobs: [{ id: 'j1', title: 'T', guid: 'G' }] })
      const finished = { id: 'j1', state: 'Failed', errorMessage: '网络超时' } as unknown as DownloadJob
      store.applyJobFinished(finished)
      expect(store.jobs[0].state).toBe('Failed')
      expect(store.jobs[0].errorMessage).toBe('网络超时')
    })
  })

  describe('applyBatchFinished', () => {
    it('重置 activeDownloads 并更新 stats', () => {
      const store = useDownloadStore()
      store.activeDownloads = 3
      const result: BatchResult = { completed: 2, failed: 1, cancelled: 0, total: 3, failedJobs: [] }
      store.applyBatchFinished(result)
      expect(store.activeDownloads).toBe(0)
      expect(store.running).toBe(false)
      expect(store.stats.completed).toBe(2)
      expect(store.stats.failed).toBe(1)
    })
  })

  describe('clearFinished', () => {
    it('仅移除已完成/失败/取消的 job', () => {
      const store = useDownloadStore()
      store.applyBatchStarted({ total: 3, jobs: [
        { id: 'j1', title: 'A', guid: 'G1' },
        { id: 'j2', title: 'B', guid: 'G2' },
        { id: 'j3', title: 'C', guid: 'G3' },
      ]})
      store.jobs[0].state = 'Completed'
      store.jobs[1].state = 'Downloading'
      store.jobs[2].state = 'Failed'
      store.clearFinished()
      expect(store.jobs).toHaveLength(1)
      expect(store.jobs[0].id).toBe('j2')
    })
  })

  describe('computed', () => {
    it('batchPercent 计算正确', () => {
      const store = useDownloadStore()
      store.applyBatchStarted({ total: 2, jobs: [
        { id: 'j1', title: 'A', guid: 'G1' },
        { id: 'j2', title: 'B', guid: 'G2' },
      ]})
      store.jobs[0].percent = 60
      store.jobs[1].percent = 40
      expect(store.batchPercent).toBe(50)
    })

    it('downloadBadge 有活跃任务时返回数字字符串', () => {
      const store = useDownloadStore()
      store.activeDownloads = 3
      expect(store.downloadBadge).toBe('3')
      store.activeDownloads = 0
      expect(store.downloadBadge).toBe('')
    })

    it('totalSpeed 返回所有 Downloading 任务速度之和', () => {
      const store = useDownloadStore()
      store.applyBatchStarted({ total: 3, jobs: [
        { id: 'j1', title: 'A', guid: 'G1' },
        { id: 'j2', title: 'B', guid: 'G2' },
        { id: 'j3', title: 'C', guid: 'G3' },
      ]})
      store.jobs[0].state = 'Downloading'; store.jobs[0].speed = 1024 * 1024   // 1 MB/s
      store.jobs[1].state = 'Downloading'; store.jobs[1].speed = 512 * 1024    // 0.5 MB/s
      store.jobs[2].state = 'Queued';      store.jobs[2].speed = 999 * 1024    // not counted
      expect(store.totalSpeed).toBe(1024 * 1024 + 512 * 1024)
    })

    it('totalSpeed 无下载任务时为 0', () => {
      const store = useDownloadStore()
      expect(store.totalSpeed).toBe(0)
    })
  })
})
