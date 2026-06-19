import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { DownloadCoordinator } from '../../../src/main/download/coordinator'
import type { CctvApiService } from '../../../src/main/api/cctv'
import type { SegmentDecryptor } from '../../../src/main/download/decryptor'
import type { Finalizer } from '../../../src/main/download/finalizer'
import type { DownloadJob } from '../../../src/shared/types'

describe('DownloadCoordinator', () => {
  let coordinator: DownloadCoordinator
  let mockApi: CctvApiService
  let mockDecryptor: SegmentDecryptor
  let mockFinalizer: Finalizer
  let outDir: string
  // Helper: a finalizer mock method that writes a real non-empty file and returns its path.
  const writeOut = (name: string) => vi.fn().mockImplementation(async () => {
    const p = path.join(outDir, name)
    fs.writeFileSync(p, 'video-bytes')
    return p
  })

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-out-'))
    mockApi = {
      resolveSegmentUrls: vi.fn().mockResolvedValue({
        segmentUrls: ['https://example.com/seg1.ts', 'https://example.com/seg2.ts'],
      }),
    } as unknown as CctvApiService

    mockDecryptor = {
      decryptAll: vi.fn().mockResolvedValue({
        completed: [0, 1],
        failed: []
      })
    } as unknown as SegmentDecryptor

    mockFinalizer = {
      writeConcatList: vi.fn().mockReturnValue('/tmp/concat.txt'),
      merge: writeOut('merged.mp4'),
      uniquePath: vi.fn((p: string) => p)
    } as unknown as Finalizer

    coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)
  })

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  describe('state transitions', () => {
    it('transitions job from Created to Queued when added', () => {
      const job: DownloadJob = {
        id: 'test-1',
        guid: 'guid-1',
        sourceUrl: 'https://tv.cctv.com/test',
        title: 'Test Video',
        savePath: '/tmp/test.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      coordinator.addJob(job)
      expect(job.state).toBe('Queued')
    })

    it('emits progress events during download', async () => {
      const progressHandler = vi.fn()
      coordinator.on('progress', progressHandler)

      const job: DownloadJob = {
        id: 'test-1',
        guid: 'guid-1',
        sourceUrl: 'https://tv.cctv.com/test',
        title: 'Test Video',
        savePath: '/tmp/test.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      coordinator.addJob(job)
      coordinator.startBatch([job])

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(progressHandler).toHaveBeenCalled()
    })
  })

  describe('batch processing', () => {
    it('processes jobs serially', async () => {
      const job1: DownloadJob = {
        id: 'job-1',
        guid: 'guid-1',
        sourceUrl: 'https://tv.cctv.com/1',
        title: 'Video 1',
        savePath: '/tmp/video1.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      const job2: DownloadJob = {
        id: 'job-2',
        guid: 'guid-2',
        sourceUrl: 'https://tv.cctv.com/2',
        title: 'Video 2',
        savePath: '/tmp/video2.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)

      coordinator.startBatch([job1, job2])

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(finishedHandler).toHaveBeenCalledTimes(2)
      expect(finishedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }))
      expect(finishedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-2' }))
    })

    it('emits batchFinished when all jobs complete', async () => {
      const batchHandler = vi.fn()
      coordinator.on('batchFinished', batchHandler)

      const job: DownloadJob = {
        id: 'test-1',
        guid: 'guid-1',
        sourceUrl: 'https://tv.cctv.com/test',
        title: 'Test Video',
        savePath: '/tmp/test.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      coordinator.startBatch([job])

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(batchHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: 1,
          failed: 0,
          cancelled: 0,
          total: 1
        })
      )
    })
  })

  describe('error handling', () => {
    it('marks job as Failed when decryptor fails', async () => {
      ;(mockDecryptor.decryptAll as any).mockResolvedValue({
        completed: [0],
        failed: [{ index: 1, error: 'decrypt error' }]
      })

      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)

      const job: DownloadJob = {
        id: 'test-1',
        guid: 'guid-1',
        sourceUrl: 'https://tv.cctv.com/test',
        title: 'Test Video',
        savePath: '/tmp/test.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      coordinator.startBatch([job])

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(finishedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-1',
          state: 'Failed',
          errorMessage: expect.stringContaining('decrypt error')
        })
      )
    })

    it('continues queue when a job fails', async () => {
      ;(mockDecryptor.decryptAll as any)
        .mockResolvedValueOnce({
          completed: [0],
          failed: [{ index: 1, error: 'error' }]
        })
        .mockResolvedValueOnce({
          completed: [0, 1],
          failed: []
        })

      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)

      const job1: DownloadJob = {
        id: 'job-1',
        guid: 'guid-1',
        sourceUrl: 'https://tv.cctv.com/1',
        title: 'Video 1',
        savePath: '/tmp/video1.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      const job2: DownloadJob = {
        id: 'job-2',
        guid: 'guid-2',
        sourceUrl: 'https://tv.cctv.com/2',
        title: 'Video 2',
        savePath: '/tmp/video2.mp4',
        quality: 'auto',
        threadCount: 8,

        state: 'Created',
        stage: 'None',
        progressPercent: 0
      }

      coordinator.startBatch([job1, job2])

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(finishedHandler).toHaveBeenCalledTimes(2)
      expect(finishedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', state: 'Failed' }))
      expect(finishedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-2', state: 'Completed' }))
    })
  })

  describe('CCTV-4K content (via normal decrypt path)', () => {
    it('handles CCTV-4K content via normal segment decrypt (same path as regular content)', async () => {
      // All content goes through decryptAll + merge regardless of channel type.
      ;(mockApi.resolveSegmentUrls as any).mockResolvedValue({
        segmentUrls: ['https://example.com/seg1.ts', 'https://example.com/seg2.ts'],
      })

      const job: DownloadJob = {
        id: 'test-4k', guid: 'guid-4k', sourceUrl: 'https://tv.cctv.com/4k',
        title: 'CCTV-4K Video', savePath: '/tmp/4k.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Must go through decryptAll (no shortcut)
      expect(mockDecryptor.decryptAll).toHaveBeenCalled()
    })

    it('adds CCTV-4K job to download history on completion', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn() }
      coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer, mockConfig)

      // 4K content goes through normal path, resolveSegmentUrls returns segmentUrls only
      ;(mockApi.resolveSegmentUrls as any).mockResolvedValue({
        segmentUrls: ['https://example.com/seg1.ts'],
      })

      const job: DownloadJob = {
        id: 'test-4k-h', guid: 'guid-4k-h', sourceUrl: 'https://tv.cctv.com/4k',
        title: 'CCTV-4K Video', savePath: '/tmp/4k.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(mockConfig.addToDownloadHistory).toHaveBeenCalledWith('guid-4k-h')
    })
  })

  describe('cancel', () => {
    it('cancel marks job as Cancelled and decrements nothing', async () => {
      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)

      const job: DownloadJob = {
        id: 'test-cancel', guid: 'guid-c', sourceUrl: '',
        title: 'Cancel Test', savePath: '/tmp/test.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.addJob(job)
      coordinator.cancel('test-cancel')

      expect(job.state).toBe('Cancelled')
    })
  })

  describe('output file', () => {
    it('reports the real output path on completion', async () => {
      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)
      const job: DownloadJob = {
        id: 'test-out', guid: 'g-out', sourceUrl: '', title: 'Out', savePath: '/tmp/out.mp4',
        quality: 'auto', threadCount: 8, reencode: false,
        state: 'Created', stage: 'None', progressPercent: 0
      }
      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 200))

      expect(finishedHandler).toHaveBeenCalledWith(expect.objectContaining({
        state: 'Completed',
        outputPath: expect.stringContaining('merged.mp4')
      }))
    })

    it('passes job.reencode flag to finalizer.merge', async () => {
      const job: DownloadJob = {
        id: 'test-reencode', guid: 'g-re', sourceUrl: '', title: 'Reencode', savePath: '/tmp/re.mp4',
        quality: 'auto', threadCount: 8, reencode: true,
        state: 'Created', stage: 'None', progressPercent: 0
      }
      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 200))

      // merge is called with (listPath, outputPath, reencode)
      const mergeArgs = (mockFinalizer.merge as any).mock.calls[0]
      expect(mergeArgs[2]).toBe(true)
    })

    it('fails the job if the merged file is missing/empty', async () => {
      // merge "succeeds" but returns a path that does not exist
      ;(mockFinalizer.merge as any).mockResolvedValue('/tmp/does-not-exist-xyz.mp4')
      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)
      const job: DownloadJob = {
        id: 'test-empty', guid: 'g-empty', sourceUrl: '', title: 'Empty', savePath: '/tmp/e.mp4',
        quality: 'auto', threadCount: 8, reencode: false,
        state: 'Created', stage: 'None', progressPercent: 0
      }
      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 200))

      expect(finishedHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-empty', state: 'Failed',
        errorMessage: expect.stringContaining('empty')
      }))
    })
  })

  describe('cancel counting', () => {
    it('counts a cancellation exactly once even with overlapping abort handling', async () => {
      const batchHandler = vi.fn()
      coordinator.on('batchFinished', batchHandler)

      // Decryptor resolves to cancelled state after abort.
      ;(mockDecryptor.decryptAll as any).mockImplementation(
        (_t: any, _d: any, _cb: any, signal: AbortSignal) =>
          new Promise(resolve => {
            const timer = setTimeout(() => resolve({ completed: [], failed: [] }), 300)
            signal?.addEventListener('abort', () => { clearTimeout(timer); resolve({ completed: [], failed: [] }) })
          })
      )

      const job: DownloadJob = {
        id: 'test-once', guid: 'g', sourceUrl: '', title: 'Once', savePath: '/tmp/o.mp4',
        quality: 'auto', threadCount: 8, reencode: false,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 50))
      coordinator.cancel('test-once')   // current job: abort + transition + count
      await new Promise(r => setTimeout(r, 200)) // executeJob's abort branch runs

      const result = batchHandler.mock.calls.at(-1)?.[0]
      // The single job is counted once as cancelled, not twice.
      expect(result.cancelled).toBe(1)
      expect(result.cancelled + result.completed + result.failed).toBeLessThanOrEqual(result.total)
    })
  })

  describe('cancelAll', () => {
    it('cancelAll emits batchFinished exactly once', async () => {
      const batchHandler = vi.fn()
      coordinator.on('batchFinished', batchHandler)

      // Slow decryptor
      ;(mockDecryptor.decryptAll as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ completed: [], failed: [] }), 500))
      )

      const job: DownloadJob = {
        id: 'test-ca', guid: 'guid-ca', sourceUrl: '',
        title: 'CancelAll', savePath: '/tmp/ca.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 50))
      coordinator.cancelAll()
      await new Promise(r => setTimeout(r, 200))

      // batchFinished should be emitted exactly once from cancelAll
      expect(batchHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('threadCount passing', () => {
    it('passes job.threadCount to decryptAll', async () => {
      const job: DownloadJob = {
        id: 'test-threads', guid: 'guid-t', sourceUrl: '',
        title: 'Thread Test', savePath: '/tmp/test.mp4', quality: 'auto',
        threadCount: 3,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 200))

      const callArgs = (mockDecryptor.decryptAll as any).mock.calls[0]
      // 5th argument is concurrency
      expect(callArgs[4]).toBe(3)
    })
  })

  describe('download history', () => {
    it('adds normal job to download history on success', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn() }
      coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer, mockConfig)

      const job: DownloadJob = {
        id: 'test-h', guid: 'guid-history', sourceUrl: '',
        title: 'History Test', savePath: '/tmp/test.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 200))

      expect(mockConfig.addToDownloadHistory).toHaveBeenCalledWith('guid-history')
    })

    it('does not add to history on failure', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn() }
      coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer, mockConfig)

      ;(mockDecryptor.decryptAll as any).mockResolvedValue({
        completed: [], failed: [{ index: 0, error: 'fail' }]
      })

      const job: DownloadJob = {
        id: 'test-hf', guid: 'guid-hf', sourceUrl: '',
        title: 'Fail Test', savePath: '/tmp/test.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 200))

      expect(mockConfig.addToDownloadHistory).not.toHaveBeenCalled()
    })
  })

  describe('cancel running job', () => {
    it('cancels the currently running job via abort', async () => {
      let abortTriggered = false
      ;(mockDecryptor.decryptAll as any).mockImplementation(
        (_segs: any, _dir: any, _cb: any, signal: AbortSignal) =>
          new Promise(resolve => {
            const timer = setTimeout(() => resolve({ completed: [0, 1], failed: [] }), 500)
            signal?.addEventListener('abort', () => {
              clearTimeout(timer)
              abortTriggered = true
              resolve({ completed: [], failed: [] })
            })
          })
      )

      const finishedHandler = vi.fn()
      coordinator.on('jobFinished', finishedHandler)

      const job: DownloadJob = {
        id: 'test-running', guid: 'guid-r', sourceUrl: '',
        title: 'Running Job', savePath: '/tmp/running.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.startBatch([job])
      await new Promise(r => setTimeout(r, 50)) // let job start
      coordinator.cancel('test-running')
      await new Promise(r => setTimeout(r, 200))

      expect(abortTriggered).toBe(true)
    })

    it('cancel queued job removes it from queue', () => {
      const job1: DownloadJob = {
        id: 'job-q-1', guid: 'g1', sourceUrl: '',
        title: 'Q1', savePath: '/tmp/q1.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }
      const job2: DownloadJob = {
        id: 'job-q-2', guid: 'g2', sourceUrl: '',
        title: 'Q2', savePath: '/tmp/q2.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }
      coordinator.addJob(job1)
      coordinator.addJob(job2)
      // job1 is current (startBatch hasn't been called, so just queued)
      coordinator.cancel('job-q-2')
      expect(job2.state).toBe('Cancelled')
    })
  })
})
