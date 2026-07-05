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
      coordinator.appendJobs([job])

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

      coordinator.appendJobs([job1, job2])

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

      coordinator.appendJobs([job])

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

      coordinator.appendJobs([job])

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

      coordinator.appendJobs([job1, job2])

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

      coordinator.appendJobs([job])
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Must go through decryptAll (no shortcut)
      expect(mockDecryptor.decryptAll).toHaveBeenCalled()
    })

    it('adds CCTV-4K job to download history on completion', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn(), savePendingJobs: vi.fn(), clearPendingJobs: vi.fn() }
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

      coordinator.appendJobs([job])
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(mockConfig.addToDownloadHistory).toHaveBeenCalledWith(expect.objectContaining({ guid: 'guid-4k-h' }))
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
      coordinator.appendJobs([job])
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
      coordinator.appendJobs([job])
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
      coordinator.appendJobs([job])
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

      coordinator.appendJobs([job])
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

      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 50))
      coordinator.cancelAll()
      await new Promise(r => setTimeout(r, 200))

      // batchFinished should be emitted exactly once from cancelAll
      expect(batchHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('threadCount passing', () => {
    it('passes job.threadCount to decryptAll when concurrentVideos=1', async () => {
      const job: DownloadJob = {
        id: 'test-threads', guid: 'guid-t', sourceUrl: '',
        title: 'Thread Test', savePath: '/tmp/test.mp4', quality: 'auto',
        threadCount: 3,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 200))

      const callArgs = (mockDecryptor.decryptAll as any).mock.calls[0]
      // concurrentVideos=1 → floor(3/1)=3, no reduction
      expect(callArgs[4]).toBe(3)
    })

    it('scales down threadCount proportionally when concurrentVideos=2', async () => {
      coordinator.setConcurrentVideos(2)
      const job: DownloadJob = {
        id: 'test-threads-2', guid: 'guid-t2', sourceUrl: '',
        title: 'Thread Scale', savePath: '/tmp/test2.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 200))

      const callArgs = (mockDecryptor.decryptAll as any).mock.calls[0]
      // concurrentVideos=2 → floor(8/2)=4
      expect(callArgs[4]).toBe(4)
    })
  })

  describe('download history', () => {
    it('adds normal job to download history on success', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn(), savePendingJobs: vi.fn(), clearPendingJobs: vi.fn() }
      coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer, mockConfig)

      const job: DownloadJob = {
        id: 'test-h', guid: 'guid-history', sourceUrl: '',
        title: 'History Test', savePath: '/tmp/test.mp4', quality: 'auto',
        threadCount: 8,
        state: 'Created', stage: 'None', progressPercent: 0
      }

      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 200))

      expect(mockConfig.addToDownloadHistory).toHaveBeenCalledWith(expect.objectContaining({ guid: 'guid-history' }))
    })

    it('does not add to history on failure', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn(), savePendingJobs: vi.fn(), clearPendingJobs: vi.fn() }
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

      coordinator.appendJobs([job])
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

      coordinator.appendJobs([job])
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
      // job1 is current (appendJobs hasn't been called, so just queued)
      coordinator.cancel('job-q-2')
      expect(job2.state).toBe('Cancelled')
    })
  })

  describe('parallel download (concurrentVideos)', () => {
    it('setConcurrentVideos clamps to 1–3', () => {
      const c = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)
      c.setConcurrentVideos(0)
      expect((c as any).concurrentVideos).toBe(1)
      c.setConcurrentVideos(5)
      expect((c as any).concurrentVideos).toBe(3)
      c.setConcurrentVideos(2)
      expect((c as any).concurrentVideos).toBe(2)
    })

    it('with concurrentVideos=2, starts two jobs simultaneously', async () => {
      coordinator.setConcurrentVideos(2)
      // decryptAll hangs indefinitely until aborted
      ;(mockDecryptor.decryptAll as any).mockImplementation(
        (_tasks: any, _dir: any, _cb: any, signal: AbortSignal) =>
          new Promise<{ completed: number[]; failed: any[] }>((resolve) => {
            signal?.addEventListener('abort', () => resolve({ completed: [], failed: [] }))
          })
      )
      const jobA: DownloadJob = { id: 'par-a', guid: 'guid-par-a', sourceUrl: '', title: 'A', savePath: '/tmp/a.mp4', quality: 'auto', threadCount: 2, reencode: false, state: 'Created', stage: 'None', progressPercent: 0 }
      const jobB: DownloadJob = { id: 'par-b', guid: 'guid-par-b', sourceUrl: '', title: 'B', savePath: '/tmp/b.mp4', quality: 'auto', threadCount: 2, reencode: false, state: 'Created', stage: 'None', progressPercent: 0 }
      const jobC: DownloadJob = { id: 'par-c', guid: 'guid-par-c', sourceUrl: '', title: 'C', savePath: '/tmp/c.mp4', quality: 'auto', threadCount: 2, reencode: false, state: 'Created', stage: 'None', progressPercent: 0 }
      coordinator.appendJobs([jobA, jobB, jobC])
      await new Promise((r) => setTimeout(r, 30))

      // At least 2 active (resolving/downloading) and 1 still queued
      const active = [jobA, jobB, jobC].filter(j => !['Queued', 'Created'].includes(j.state))
      expect(active.length).toBeGreaterThanOrEqual(2)
      expect([jobA, jobB, jobC].some(j => j.state === 'Queued')).toBe(true)

      coordinator.cancelAll()
      await new Promise((r) => setTimeout(r, 30))
    })
  })

  describe('reorderQueue', () => {
    it('reorders queued jobs by new id sequence', () => {
      const mkJob = (id: string): DownloadJob => ({
        id, guid: `guid-${id}`, sourceUrl: '', title: id,
        savePath: `/tmp/${id}.mp4`, quality: 'auto', threadCount: 2, reencode: false,
        state: 'Created', stage: 'None', progressPercent: 0
      })
      const j1 = mkJob('rq-1')
      const j2 = mkJob('rq-2')
      const j3 = mkJob('rq-3')
      coordinator.addJob(j1)
      coordinator.addJob(j2)
      coordinator.addJob(j3)
      coordinator.reorderQueue(['rq-3', 'rq-1', 'rq-2'])
      // queue order should now be rq-3, rq-1, rq-2
      const ids = (coordinator as any).queue.map((j: DownloadJob) => j.id)
      expect(ids).toEqual(['rq-3', 'rq-1', 'rq-2'])
    })

    it('empty newOrder is a no-op', () => {
      const j = {
        id: 'rq-noop', guid: 'g', sourceUrl: '', title: 'N',
        savePath: '/tmp/n.mp4', quality: 'auto' as const, threadCount: 2, reencode: false,
        state: 'Created' as const, stage: 'None' as const, progressPercent: 0
      }
      coordinator.addJob(j)
      const before = [...(coordinator as any).queue]
      coordinator.reorderQueue([])
      expect((coordinator as any).queue).toEqual(before)
    })

    it('ids not in queue are silently ignored', () => {
      const j1 = {
        id: 'rq-a', guid: 'ga', sourceUrl: '', title: 'A',
        savePath: '/tmp/a.mp4', quality: 'auto' as const, threadCount: 2, reencode: false,
        state: 'Created' as const, stage: 'None' as const, progressPercent: 0
      }
      const j2 = {
        id: 'rq-b', guid: 'gb', sourceUrl: '', title: 'B',
        savePath: '/tmp/b.mp4', quality: 'auto' as const, threadCount: 2, reencode: false,
        state: 'Created' as const, stage: 'None' as const, progressPercent: 0
      }
      coordinator.addJob(j1)
      coordinator.addJob(j2)
      coordinator.reorderQueue(['rq-b', 'rq-nonexistent', 'rq-a'])
      const ids = (coordinator as any).queue.map((j: DownloadJob) => j.id)
      expect(ids).toEqual(['rq-b', 'rq-a'])
    })
  })

  describe('m3u8Url branch (cctvnews)', () => {
    // Build a fetch mock whose call log we can inspect. Each call resolves to
    // the next queued response; unmatched URLs fall through to a 404.
    function buildFetchMock(responses: Array<{ match: (u: string) => boolean; body: string | Buffer; ok?: boolean; status?: number }>) {
      const calls: string[] = []
      const fn = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
        calls.push(u)
        const hit = responses.find(r => r.match(u))
        if (!hit) return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0), headers: new Map() }
        const bodyBuf = typeof hit.body === 'string' ? Buffer.from(hit.body, 'utf-8') : hit.body
        return {
          ok: hit.ok ?? true,
          status: hit.status ?? 200,
          text: async () => bodyBuf.toString('utf-8'),
          arrayBuffer: async () => bodyBuf.buffer.slice(bodyBuf.byteOffset, bodyBuf.byteOffset + bodyBuf.byteLength),
          headers: new Map([['content-length', String(bodyBuf.byteLength)]])
        }
      })
      return { fn, calls }
    }

    it('downloads segments directly and merges into a completed mp4', async () => {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXTINF:10,', 'seg1.ts',
        '#EXTINF:10,', 'seg2.ts',
        '#EXT-X-ENDLIST'
      ].join('\n')
      const fetchMock = buildFetchMock([
        { match: u => u.endsWith('.m3u8'), body: m3u8 },
        { match: u => u.includes('seg1.ts'), body: Buffer.from('AAAA-seg1') },
        { match: u => u.includes('seg2.ts'), body: Buffer.from('BBBB-seg2') }
      ])
      vi.stubGlobal('fetch', fetchMock.fn)

      // Add mergeCopy alongside the existing merge mock
      const mergedOut = path.join(outDir, 'm3u8-merged.mp4')
      ;(mockFinalizer as any).mergeCopy = vi.fn().mockImplementation(async () => {
        fs.writeFileSync(mergedOut, 'final-bytes')
        return mergedOut
      })

      const finished = vi.fn()
      coordinator.on('jobFinished', finished)

      const job: DownloadJob = {
        id: 'm3u8-1', guid: 'guid-m3u8', sourceUrl: 'https://x', title: 'M',
        savePath: path.join(outDir, 'out.mp4'), quality: 'auto', threadCount: 2,
        reencode: false, state: 'Created', stage: 'None', progressPercent: 0,
        m3u8Url: 'https://res.example.com/v/foo.m3u8'
      }
      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 200))

      // API must NOT have been called — m3u8Url bypasses resolveSegmentUrls
      expect(mockApi.resolveSegmentUrls).not.toHaveBeenCalled()
      // Decryptor must NOT have been called — segments are plain
      expect(mockDecryptor.decryptAll).not.toHaveBeenCalled()
      // The m3u8 URL + 2 segment URLs should have been fetched
      expect(fetchMock.calls).toHaveLength(3)
      expect(fetchMock.calls[0]).toBe('https://res.example.com/v/foo.m3u8')
      expect(fetchMock.calls.slice(1).sort()).toEqual([
        'https://res.example.com/v/seg1.ts',
        'https://res.example.com/v/seg2.ts'
      ])
      // mergeCopy was called (not merge) with the concat list + outputPath
      expect((mockFinalizer as any).mergeCopy).toHaveBeenCalledTimes(1)
      // Job transitioned to Completed with outputPath set
      expect(finished).toHaveBeenCalledWith(expect.objectContaining({ id: 'm3u8-1', state: 'Completed', outputPath: mergedOut }))
    })

    it('marks job Failed when m3u8 fetch fails', async () => {
      const fetchMock = buildFetchMock([
        { match: u => u.endsWith('.m3u8'), body: '', ok: false, status: 503 }
      ])
      vi.stubGlobal('fetch', fetchMock.fn)
      ;(mockFinalizer as any).mergeCopy = vi.fn()

      const finished = vi.fn()
      coordinator.on('jobFinished', finished)

      const job: DownloadJob = {
        id: 'm3u8-err', guid: 'guid-m3u8-err', sourceUrl: 'https://x', title: 'M',
        savePath: path.join(outDir, 'out.mp4'), quality: 'auto', threadCount: 2,
        reencode: false, state: 'Created', stage: 'None', progressPercent: 0,
        m3u8Url: 'https://res.example.com/v/bad.m3u8'
      }
      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 200))

      expect(finished).toHaveBeenCalledWith(expect.objectContaining({
        id: 'm3u8-err', state: 'Failed',
        errorMessage: expect.stringContaining('HTTP 503')
      }))
      expect((mockFinalizer as any).mergeCopy).not.toHaveBeenCalled()
    })

    it('marks job Failed when a segment fetch fails', async () => {
      const m3u8 = '#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXTINF:10,\nseg2.ts\n'
      const fetchMock = buildFetchMock([
        { match: u => u.endsWith('.m3u8'), body: m3u8 },
        { match: u => u.includes('seg1.ts'), body: '', ok: false, status: 404 },
        { match: u => u.includes('seg2.ts'), body: Buffer.from('ok-seg2') }
      ])
      vi.stubGlobal('fetch', fetchMock.fn)
      ;(mockFinalizer as any).mergeCopy = vi.fn()

      const finished = vi.fn()
      coordinator.on('jobFinished', finished)

      const job: DownloadJob = {
        id: 'm3u8-seg', guid: 'guid-m3u8-seg', sourceUrl: 'https://x', title: 'M',
        savePath: path.join(outDir, 'out.mp4'), quality: 'auto', threadCount: 1,
        reencode: false, state: 'Created', stage: 'None', progressPercent: 0,
        m3u8Url: 'https://res.example.com/v/foo.m3u8'
      }
      coordinator.appendJobs([job])
      await new Promise(r => setTimeout(r, 200))

      expect(finished).toHaveBeenCalledWith(expect.objectContaining({
        id: 'm3u8-seg', state: 'Failed',
        errorMessage: expect.stringContaining('segment 0 failed')
      }))
      expect((mockFinalizer as any).mergeCopy).not.toHaveBeenCalled()
    })
  })

  describe('appendJobs (cross-month / cross-column accumulation)', () => {
    // Build a slow decryptor so jobs stay in the queue / active set across
    // multiple appendJobs calls within a single test.
    const installSlowDecryptor = () => {
      ;(mockDecryptor.decryptAll as any).mockImplementation(
        (_tasks: any, _dir: any, _cb: any, signal: AbortSignal) =>
          new Promise(resolve => {
            const timer = setTimeout(() => resolve({ completed: [0, 1], failed: [] }), 300)
            signal?.addEventListener('abort', () => {
              clearTimeout(timer)
              resolve({ completed: [], failed: [] })
            })
          })
      )
    }

    const mkJob = (id: string): DownloadJob => ({
      id, guid: `guid-${id}`, sourceUrl: '', title: id, savePath: `/tmp/${id}.mp4`,
      quality: 'auto', threadCount: 8, reencode: false,
      state: 'Created', stage: 'None', progressPercent: 0
    })

    it('second launch while first is running appends instead of replacing', async () => {
      installSlowDecryptor()
      const jobA = mkJob('A')
      const jobB = mkJob('B')

      coordinator.appendJobs([jobA])
      await new Promise(r => setTimeout(r, 30))  // A is active
      coordinator.appendJobs([jobB])               // B should land behind A
      await new Promise(r => setTimeout(r, 30))

      // Both are tracked — A active, B either queued or active depending on
      // concurrency. Crucially, A was NOT wiped when B was appended.
      expect(['Queued', 'ResolvingM3u8', 'Downloading', 'Merging']).toContain(jobA.state)
      expect(['Queued', 'ResolvingM3u8', 'Downloading', 'Merging']).toContain(jobB.state)
    })

    it('batchStats reset when coordinator is idle at append time', async () => {
      // Fast decryptor so the first batch fully completes before the second append.
      const batchHandler = vi.fn()
      coordinator.on('batchFinished', batchHandler)

      coordinator.appendJobs([mkJob('first')])
      await new Promise(r => setTimeout(r, 200))

      // First batch settled: one batchFinished with total=1.
      expect(batchHandler).toHaveBeenCalledTimes(1)
      expect(batchHandler.mock.calls[0][0]).toMatchObject({ completed: 1, total: 1 })

      coordinator.appendJobs([mkJob('second')])
      await new Promise(r => setTimeout(r, 200))

      // Second batch started from zero (idle at launch), so its stats stand
      // alone rather than being summed with the first.
      expect(batchHandler).toHaveBeenCalledTimes(2)
      expect(batchHandler.mock.calls[1][0]).toMatchObject({ completed: 1, total: 1 })
    })

    it('batchFinished accumulates counts across multiple in-flight appends', async () => {
      installSlowDecryptor()
      coordinator.setConcurrentVideos(3)  // so all 3 run in parallel
      const batchHandler = vi.fn()
      coordinator.on('batchFinished', batchHandler)

      coordinator.appendJobs([mkJob('A')])
      await new Promise(r => setTimeout(r, 20))
      coordinator.appendJobs([mkJob('B')])
      await new Promise(r => setTimeout(r, 20))
      coordinator.appendJobs([mkJob('C')])

      // Let all 3 finish.
      await new Promise(r => setTimeout(r, 600))

      // A single batchFinished reports the accumulated total.
      expect(batchHandler).toHaveBeenCalledTimes(1)
      expect(batchHandler.mock.calls[0][0]).toMatchObject({ completed: 3, total: 3 })
    })

    it('appendJobs accumulates the queue across multiple launches', async () => {
      installSlowDecryptor()
      coordinator.setConcurrentVideos(1)  // serial so only A runs; B, C, D stay Queued

      const jobA = mkJob('A')
      const jobB = mkJob('B')
      coordinator.appendJobs([jobA, jobB])
      await new Promise(r => setTimeout(r, 30))  // A runs; B queued

      const jobC = mkJob('C')
      const jobD = mkJob('D')
      coordinator.appendJobs([jobC, jobD])        // append while A still runs
      await new Promise(r => setTimeout(r, 30))

      // Queue contains every job that hasn't finished — nothing was wiped when
      // the second appendJobs fired mid-flight.
      const queueIds = (coordinator as any).queue.map((j: DownloadJob) => j.id)
      expect(queueIds).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']))
    })

    it('resetQueue clears queue, stats, and pending persistence', async () => {
      const mockConfig = { addToDownloadHistory: vi.fn(), savePendingJobs: vi.fn(), clearPendingJobs: vi.fn() }
      coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer, mockConfig)

      coordinator.appendJobs([mkJob('A'), mkJob('B')])
      coordinator.resetQueue()

      expect((coordinator as any).queue).toEqual([])
      expect((coordinator as any).batchStats).toEqual({ completed: 0, failed: 0, cancelled: 0, total: 0 })
      expect(mockConfig.clearPendingJobs).toHaveBeenCalled()
    })

    it('cancelAll clears queue and leaves the coordinator ready for a fresh appendJobs', async () => {
      installSlowDecryptor()
      const batchHandler = vi.fn()
      coordinator.on('batchFinished', batchHandler)

      coordinator.appendJobs([mkJob('A')])
      await new Promise(r => setTimeout(r, 20))
      coordinator.cancelAll()
      await new Promise(r => setTimeout(r, 50))

      // After cancelAll the coordinator is idle; a new appendJobs starts a
      // fresh batch with its own stats (completed/failed/cancelled reset).
      coordinator.appendJobs([mkJob('B')])
      await new Promise(r => setTimeout(r, 30))
      coordinator.cancel('B')
      await new Promise(r => setTimeout(r, 50))

      const lastBatch = batchHandler.mock.calls.at(-1)?.[0]
      expect(lastBatch).toMatchObject({ completed: 0, failed: 0, cancelled: 1, total: 1 })
    })
  })
})
