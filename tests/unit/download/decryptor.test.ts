import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SegmentDecryptor, segmentFileName } from '../../../src/main/download/decryptor'
import type { DecryptFn, SegmentTask } from '../../../src/main/download/decryptor'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Helper: build tasks from URLs using their array position as the original index.
const tasks = (urls: string[]): SegmentTask[] => urls.map((url, index) => ({ index, url }))

describe('SegmentDecryptor', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decryptor-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('decryptAll', () => {
    it('completes all segments successfully', async () => {
      const mockDecrypt: DecryptFn = vi.fn().mockResolvedValue(undefined)
      const decryptor = new SegmentDecryptor(mockDecrypt, 2)

      const segments = ['url1', 'url2', 'url3']
      const result = await decryptor.decryptAll(
        tasks(segments), tempDir,
        () => {},
        undefined
      )

      expect(result.completed).toHaveLength(3)
      expect(result.failed).toHaveLength(0)
      expect(mockDecrypt).toHaveBeenCalledTimes(3)
    })

    it('collects failures without stopping', async () => {
      const mockDecrypt: DecryptFn = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('decrypt fail'))
        .mockResolvedValueOnce(undefined)

      // maxAttempts=1 to assert single-attempt failure semantics
      const decryptor = new SegmentDecryptor(mockDecrypt, 1, 1)
      const segments = ['url1', 'url2', 'url3']
      const result = await decryptor.decryptAll(
        tasks(segments), tempDir,
        () => {},
        undefined
      )

      expect(result.completed).toHaveLength(2)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].index).toBe(1)
      expect(result.failed[0].error).toContain('decrypt fail')
    })

    it('respects concurrency parameter', async () => {
      let activeCount = 0
      let maxActive = 0

      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async () => {
        activeCount++
        maxActive = Math.max(maxActive, activeCount)
        await new Promise(r => setTimeout(r, 50))
        activeCount--
      })

      const decryptor = new SegmentDecryptor(mockDecrypt, 3)
      const segments = ['url1', 'url2', 'url3', 'url4', 'url5', 'url6']
      await decryptor.decryptAll(tasks(segments), tempDir, () => {}, undefined, 3)

      expect(maxActive).toBeLessThanOrEqual(3)
    })

    it('passes concurrency from decryptAll parameter', async () => {
      let activeCount = 0
      let maxActive = 0

      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async () => {
        activeCount++
        maxActive = Math.max(maxActive, activeCount)
        await new Promise(r => setTimeout(r, 50))
        activeCount--
      })

      const decryptor = new SegmentDecryptor(mockDecrypt, 8)
      const segments = ['url1', 'url2', 'url3', 'url4']
      // Override concurrency to 1
      await decryptor.decryptAll(tasks(segments), tempDir, () => {}, undefined, 1)

      expect(maxActive).toBe(1)
    })

    it('stops on abort signal', async () => {
      const controller = new AbortController()
      let callCount = 0

      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          controller.abort()
        }
        await new Promise(r => setTimeout(r, 50))
      })

      const decryptor = new SegmentDecryptor(mockDecrypt, 1)
      const segments = ['url1', 'url2', 'url3', 'url4', 'url5']
      await decryptor.decryptAll(
        tasks(segments), tempDir,
        () => {},
        controller.signal
      )

      // Should not process all segments
      expect(callCount).toBeLessThan(segments.length)
    })

    it('calls onProgress with correct completedIndex', async () => {
      const mockDecrypt: DecryptFn = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined)

      const decryptor = new SegmentDecryptor(mockDecrypt, 1, 1)
      const segments = ['url1', 'url2', 'url3']
      const progressCalls: any[] = []

      await decryptor.decryptAll(
        tasks(segments), tempDir,
        (info) => progressCalls.push(info),
        undefined
      )

      expect(progressCalls).toHaveLength(3)
      // Each progress call should have correct index and done count
      expect(progressCalls[0].done).toBe(1)
      expect(progressCalls[0].total).toBe(3)
      expect(progressCalls[1].failed).toBe(true)
      expect(progressCalls[2].done).toBe(3)
    })

    it('handles empty segments array', async () => {
      const mockDecrypt: DecryptFn = vi.fn()
      const decryptor = new SegmentDecryptor(mockDecrypt, 4)

      const result = await decryptor.decryptAll([], tempDir, () => {}, undefined)

      expect(result.completed).toEqual([])
      expect(result.failed).toEqual([])
      expect(mockDecrypt).not.toHaveBeenCalled()
    })

    it('creates segment files with correct naming', async () => {
      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async (_url, outPath) => {
        fs.writeFileSync(outPath, 'fake-content')
      })

      const decryptor = new SegmentDecryptor(mockDecrypt, 2)
      const segments = ['url1', 'url2']
      await decryptor.decryptAll(tasks(segments), tempDir, () => {}, undefined)

      expect(fs.existsSync(path.join(tempDir, 'segment_00000000.mp4'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, 'segment_00000001.mp4'))).toBe(true)
    })

    it('names files by ORIGINAL index on resume (no collision with prior segments)', async () => {
      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async (_url, outPath) => {
        fs.writeFileSync(outPath, 'data')
      })
      const decryptor = new SegmentDecryptor(mockDecrypt, 2)

      // Resume: only segments 3 and 4 are pending (0-2 already done in a prior run).
      const pending: SegmentTask[] = [
        { index: 3, url: 'url3' },
        { index: 4, url: 'url4' }
      ]
      const result = await decryptor.decryptAll(pending, tempDir, () => {}, undefined)

      // Must write segment_00000003 / _00000004, NOT _00000000 / _00000001.
      expect(fs.existsSync(path.join(tempDir, segmentFileName(3)))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, segmentFileName(4)))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, segmentFileName(0)))).toBe(false)
      expect(result.completed.sort()).toEqual([3, 4])
    })

    it('reports real bytes written per completed segment', async () => {
      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async (_url, outPath) => {
        fs.writeFileSync(outPath, 'hello world') // 11 bytes
      })
      const decryptor = new SegmentDecryptor(mockDecrypt, 1)
      const calls: any[] = []
      await decryptor.decryptAll(tasks(['u1']), tempDir, (info) => calls.push(info), undefined)

      expect(calls[0].bytes).toBe(11)
      expect(calls[0].completedIndex).toBe(0)
      expect(calls[0].attempts).toBe(1)
    })
  })

  describe('retry behaviour', () => {
    it('retries a transient failure and succeeds', async () => {
      let n = 0
      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async (_url, outPath) => {
        n++
        if (n < 3) throw new Error('transient')
        fs.writeFileSync(outPath, 'ok')
      })
      // 3 attempts, tiny backoff to keep the test fast
      const decryptor = new SegmentDecryptor(mockDecrypt, 1, 3, 1)
      const calls: any[] = []
      const result = await decryptor.decryptAll(tasks(['u1']), tempDir, (i) => calls.push(i), undefined)

      expect(result.completed).toEqual([0])
      expect(result.failed).toHaveLength(0)
      expect(mockDecrypt).toHaveBeenCalledTimes(3)
      expect(calls[0].attempts).toBe(3)
    })

    it('gives up after maxAttempts and reports failure', async () => {
      const mockDecrypt: DecryptFn = vi.fn().mockRejectedValue(new Error('always fails'))
      const decryptor = new SegmentDecryptor(mockDecrypt, 1, 3, 1)
      const calls: any[] = []
      const result = await decryptor.decryptAll(tasks(['u1']), tempDir, (i) => calls.push(i), undefined)

      expect(result.completed).toHaveLength(0)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('always fails')
      expect(mockDecrypt).toHaveBeenCalledTimes(3)
      expect(calls[0].attempts).toBe(3)
    })

    it('stops retrying once aborted', async () => {
      const controller = new AbortController()
      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async () => {
        controller.abort()
        throw new Error('fail then abort')
      })
      // long backoff: if it waited, the test would hang; abort must short-circuit it
      const decryptor = new SegmentDecryptor(mockDecrypt, 1, 5, 10_000)
      const result = await decryptor.decryptAll(tasks(['u1']), tempDir, () => {}, controller.signal)

      expect(mockDecrypt).toHaveBeenCalledTimes(1)
      expect(result.completed).toHaveLength(0)
    })

    it('removes partial output between retries', async () => {
      let n = 0
      const outFile = path.join(tempDir, 'segment_00000000.mp4')
      const mockDecrypt: DecryptFn = vi.fn().mockImplementation(async (_url, outPath) => {
        n++
        fs.writeFileSync(outPath, 'partial') // simulate a half-written file
        if (n < 2) throw new Error('fail after partial write')
        fs.writeFileSync(outPath, 'final-good')
      })
      const decryptor = new SegmentDecryptor(mockDecrypt, 1, 3, 1)
      await decryptor.decryptAll(tasks(['u1']), tempDir, () => {}, undefined)

      // Final content should be the successful write, not a stale partial
      expect(fs.readFileSync(outFile, 'utf-8')).toBe('final-good')
    })
  })
})
