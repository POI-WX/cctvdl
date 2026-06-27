/**
 * 断点续传（Resume）单元测试
 *
 * 策略：直接测试源码级的 coordinator，用真实 fs 操作验证 state.json
 * 无需网络，无需 Electron 运行时
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock electron
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => os.tmpdir()) }
}))

import { DownloadCoordinator } from '../../../src/main/download/coordinator'
import type { CctvApiService } from '../../../src/main/api/cctv'
import type { SegmentDecryptor } from '../../../src/main/download/decryptor'
import type { Finalizer } from '../../../src/main/download/finalizer'
import type { DownloadJob } from '../../../src/shared/types'

function makeJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: 'job-resume', guid: 'guid-resume', sourceUrl: '',
    title: 'Resume Test', savePath: '/tmp/resume.mp4',
    quality: 'auto', threadCount: 2,
    state: 'Created', stage: 'None', progressPercent: 0,
    ...overrides
  }
}

describe('Resume 功能测试（真实 fs）', () => {
  let tempDir: string
  let mockApi: CctvApiService
  let mockDecryptor: SegmentDecryptor
  let mockFinalizer: Finalizer

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-resume-'))

    mockApi = {
      resolveSegmentUrls: vi.fn().mockResolvedValue({
        segmentUrls: ['url0', 'url1', 'url2', 'url3', 'url4'],
      }),
    } as unknown as CctvApiService

    mockDecryptor = {
      decryptAll: vi.fn().mockResolvedValue({ completed: [0, 1], failed: [] })
    } as unknown as SegmentDecryptor

    mockFinalizer = {
      writeConcatList: vi.fn().mockImplementation((workDir: string) => {
        const p = path.join(workDir, 'concat.txt')
        fs.writeFileSync(p, '')
        return p
      }),
      // Write a real non-empty file so the coordinator's output validation passes.
      merge: vi.fn().mockImplementation(async (_list: string, outPath: string) => {
        fs.writeFileSync(outPath, 'video'); return outPath
      }),
      uniquePath: vi.fn((p: string) => p)
    } as unknown as Finalizer
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('第一次下载完成后不存在 state.json（成功完成后清理）', async () => {
    const job = makeJob({ savePath: path.join(tempDir, 'out.mp4') })
    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)

    await new Promise<void>((resolve, reject) => {
      coordinator.on('batchFinished', resolve)
      coordinator.startBatch([job])
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })

    const workDir = path.join(tempDir, '.cctvdl_guid-resume')
    // workDir itself should be cleaned up after success
    expect(fs.existsSync(workDir)).toBe(false)
  })

  it('预先写入 state.json 后，coordinator 只解密 pending segments', async () => {
    const job = makeJob({ savePath: path.join(tempDir, 'out.mp4') })
    const workDir = path.join(tempDir, '.cctvdl_guid-resume')
    fs.mkdirSync(workDir, { recursive: true })

    // Simulate partial completion: segments 0,1,2 done, 3,4 pending.
    // The completed segments must actually exist on disk to be trusted on resume.
    for (const i of [0, 1, 2]) {
      fs.writeFileSync(path.join(workDir, `segment_${String(i).padStart(8, '0')}.mp4`), 'x')
    }
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({
      guid: 'guid-resume',
      segmentUrls: ['url0', 'url1', 'url2', 'url3', 'url4'],
      completed: [0, 1, 2],
      pending: [3, 4]
    }))

    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)

    await new Promise<void>((resolve, reject) => {
      coordinator.on('batchFinished', resolve)
      coordinator.startBatch([job])
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })

    // decryptAll should have been called with only the 2 pending tasks,
    // each carrying its ORIGINAL index so resumed files don't collide.
    const callArgs = (mockDecryptor.decryptAll as any).mock.calls[0]
    const passed: Array<{ index: number; url: string }> = callArgs[0]
    expect(passed).toHaveLength(2)
    expect(passed).toEqual(expect.arrayContaining([
      { index: 3, url: 'url3' },
      { index: 4, url: 'url4' }
    ]))
    const urls = passed.map(t => t.url)
    expect(urls).not.toContain('url0')
    expect(urls).not.toContain('url1')
    expect(urls).not.toContain('url2')
  })

  it('state.json 中的 guid 不匹配时忽略状态文件，全量重新下载', async () => {
    const job = makeJob({ savePath: path.join(tempDir, 'out.mp4') })
    const workDir = path.join(tempDir, '.cctvdl_guid-resume')
    fs.mkdirSync(workDir, { recursive: true })

    // Write state.json with DIFFERENT guid
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({
      guid: 'different-guid',  // Mismatch!
      segmentUrls: ['url0', 'url1', 'url2'],
      completed: [0, 1],
      pending: [2]
    }))

    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)

    await new Promise<void>((resolve, reject) => {
      coordinator.on('batchFinished', resolve)
      coordinator.startBatch([job])
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })

    // Should download all 5 segments (ignoring stale state.json)
    const callArgs = (mockDecryptor.decryptAll as any).mock.calls[0]
    const passedSegments: string[] = callArgs[0]
    expect(passedSegments).toHaveLength(5)
  })

  it('失败时保留 workDir 与 state.json，以便重试续传', async () => {
    const job = makeJob({ savePath: path.join(tempDir, 'out.mp4') })

    // Segment 0 succeeds, segment 1 fails -> job fails but progress should persist.
    ;(mockDecryptor.decryptAll as any).mockImplementation(
      async (_tasks: any, _dir: any, onProgress: any) => {
        onProgress({ done: 1, total: 2, completedIndex: 0, failed: false, bytes: 10 })
        return { completed: [0], failed: [{ index: 1, error: 'network error' }] }
      }
    )

    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)

    await new Promise<void>((resolve, reject) => {
      coordinator.on('batchFinished', resolve)
      coordinator.startBatch([job])
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })

    const workDir = path.join(tempDir, '.cctvdl_guid-resume')
    // workDir + state.json must survive failure so a retry resumes.
    expect(fs.existsSync(workDir)).toBe(true)
    const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf-8'))
    expect(state.completed).toContain(0)
    expect(state.pending).toContain(1)
  })

  it('shutdown() 中断正在进行的下载', async () => {
    const job = makeJob({ savePath: path.join(tempDir, 'out.mp4') })

    // decryptAll hangs until aborted — simulating an in-flight download
    ;(mockDecryptor.decryptAll as any).mockImplementation(
      (_tasks: any, _dir: any, onProgress: any, signal: AbortSignal) =>
        new Promise((resolve) => {
          onProgress({ done: 1, total: 5, completedIndex: 0, failed: false, bytes: 10, attempts: 1 })
          signal?.addEventListener('abort', () => resolve({ completed: [0], failed: [] }))
        })
    )

    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)
    coordinator.startBatch([job])
    // let it reach the Downloading phase
    await new Promise((r) => setTimeout(r, 50))

    // shutdown aborts the active job — after a brief wait it finishes and is no longer busy
    coordinator.shutdown()
    await new Promise((r) => setTimeout(r, 50))
    expect(coordinator.isBusy).toBe(false)
  })

  it('空 segmentUrls 时标记为 Failed 并清理 workDir', async () => {
    // When the API returns an empty segment list, the job should immediately fail
    // and the workDir should be cleaned up (no partial data to resume).
    const job = makeJob({ savePath: path.join(tempDir, 'empty.mp4') })
    ;(mockApi.resolveSegmentUrls as any).mockResolvedValue({
      segmentUrls: []
    })

    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)
    let finishedJob: any

    await new Promise<void>((resolve, reject) => {
      coordinator.on('jobFinished', (j) => { finishedJob = j })
      coordinator.on('batchFinished', resolve)
      coordinator.startBatch([job])
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })

    expect(finishedJob.state).toBe('Failed')
    expect(finishedJob.errorMessage).toContain('no segment urls')

    const workDir = path.join(tempDir, '.cctvdl_guid-resume')
    expect(fs.existsSync(workDir)).toBe(false)
  })

  it('零字节已完成分片不被信任，会被重新下载', async () => {
    // segment 0 exists but is 0-byte (decrypt exited 0 but wrote nothing)
    // segment 1 is non-empty (properly completed)
    // segment 2 doesn't exist
    const job = makeJob({ savePath: path.join(tempDir, 'out.mp4') })
    const workDir = path.join(tempDir, '.cctvdl_guid-resume')
    fs.mkdirSync(workDir, { recursive: true })

    // 0-byte file — must NOT be trusted
    fs.writeFileSync(path.join(workDir, 'segment_00000000.mp4'), '')
    // non-empty file — must be trusted
    fs.writeFileSync(path.join(workDir, 'segment_00000001.mp4'), 'valid data')

    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({
      guid: 'guid-resume',
      segmentUrls: ['url0', 'url1', 'url2', 'url3', 'url4'],
      completed: [0, 1],
      pending: [2, 3, 4]
    }))

    const coordinator = new DownloadCoordinator(mockApi, mockDecryptor, mockFinalizer)

    await new Promise<void>((resolve, reject) => {
      coordinator.on('batchFinished', resolve)
      coordinator.startBatch([job])
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })

    const callArgs = (mockDecryptor.decryptAll as any).mock.calls[0]
    const passed: Array<{ index: number; url: string }> = callArgs[0]
    // segment 0 (0-byte) must be included in pending, segment 1 (non-empty) must not
    const passedIndices = passed.map((t: any) => t.index)
    expect(passedIndices).toContain(0)   // 0-byte: must re-download
    expect(passedIndices).not.toContain(1) // non-empty: trusted as completed
  })
})
