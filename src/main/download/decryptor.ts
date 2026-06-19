import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import PQueue from 'p-queue'
import { ffmpegPath } from './ffmpeg'

export type DecryptFn = (segmentUrl: string, outputPath: string) => Promise<void>

const DEFAULT_DECRYPT_TIMEOUT_MS = 180_000

export function createDefaultDecrypt(timeoutMs: number = DEFAULT_DECRYPT_TIMEOUT_MS): DecryptFn {
  return (segmentUrl: string, outputPath: string) => {
    // `require('electron')` is the API object when running inside Electron, but
    // just the path string to the Electron binary when required from plain Node
    // (e.g. under vitest). Use that to ALWAYS launch the decrypt child on
    // Electron's bundled Node — the only version the decrypt scripts are verified
    // against — so neither users nor developers need a particular system Node.
    const electronMod: unknown = require('electron')
    const runningInElectron = typeof electronMod !== 'string'
    const app = runningInElectron ? (electronMod as typeof import('electron')).app : undefined
    const electronExec = runningInElectron ? process.execPath : (electronMod as string)

    // Resolve decrypt scripts: packaged → process.resourcesPath/decrypt, dev → resources/decrypt
    const decryptDir = app?.isPackaged
      ? path.join(process.resourcesPath, 'decrypt')
      : path.join(__dirname, '../../resources/decrypt')

    // Bundled ffmpeg path, handed to the wrapper so decrypt.js's `spawn('ffmpeg')`
    // is redirected to it instead of requiring ffmpeg on the user's PATH.
    const bundledFfmpeg = ffmpegPath()

    return new Promise<void>((resolve, reject) => {
      const child = spawn(electronExec, [path.join(decryptDir, 'decrypt-wrapper.js'), segmentUrl, outputPath], {
        cwd: decryptDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          // Minimal environment: only what the child needs.
          // Spreading process.env would forward NODE_OPTIONS, debug flags, etc.
          ELECTRON_RUN_AS_NODE: '1',
          PATH: process.env['PATH'] ?? '',
          // Redirect decrypt.js's bare `ffmpeg` calls to the bundled binary.
          CCTVDL_FFMPEG: bundledFfmpeg
        },
        windowsHide: true
      })

      let stderr = ''
      let stdout = ''
      let settled = false
      // Kill a hung child so it never holds a concurrency slot forever.
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { child.kill() } catch { /* already gone */ }
        reject(new Error(`decrypt timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)

      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })

      child.once('close', (code: number) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          resolve()
        } else {
          const errInfo = stderr || stdout
          reject(new Error(`decrypt exit ${code}${errInfo ? ': ' + errInfo.slice(0, 300) : ''}`))
        }
      })

      child.once('error', (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`decrypt failed: ${err.message}`))
      })
    })
  }
}

/** Sleep that resolves early (rejecting) if the abort signal fires. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface DecryptResult {
  completed: number[]
  failed: Array<{ index: number; error: string }>
}

/** A unit of work: the segment's original (global) index plus its source URL. */
export interface SegmentTask {
  index: number
  url: string
}

export interface ProgressInfo {
  done: number          // segments processed in THIS run
  total: number         // segments scheduled in THIS run
  completedIndex: number // the segment's ORIGINAL global index that just finished
  failed: boolean
  bytes: number         // bytes written for this segment (0 on failure)
  attempts: number      // how many decrypt attempts this segment took
}

/** Build the on-disk output path for a segment from its original global index. */
export function segmentFileName(index: number): string {
  return `segment_${String(index).padStart(8, '0')}.mp4`
}

export class SegmentDecryptor {
  constructor(
    private readonly decrypt: DecryptFn = createDefaultDecrypt(),
    private readonly defaultConcurrency: number = 8,
    private readonly maxAttempts: number = 3,
    private readonly retryBaseDelayMs: number = 600
  ) {}

  async decryptAll(
    tasks: SegmentTask[],
    workDir: string,
    onProgress: (info: ProgressInfo) => void,
    signal?: AbortSignal,
    concurrency?: number
  ): Promise<DecryptResult> {
    const queue = new PQueue({ concurrency: concurrency || this.defaultConcurrency })
    const completed: number[] = []
    const failed: Array<{ index: number; error: string }> = []
    const total = tasks.length
    let done = 0

    for (const task of tasks) {
      if (signal?.aborted) break
      // Name by ORIGINAL index so resume never collides with previously completed segments.
      const outPath = path.join(workDir, segmentFileName(task.index))
      queue.add(async () => {
        if (signal?.aborted) {
          done++
          return
        }
        const { ok, error, attempts } = await this.decryptWithRetry(task.url, outPath, signal)
        if (ok) {
          completed.push(task.index)
          let bytes = 0
          try { bytes = fs.statSync(outPath).size } catch { /* size best-effort */ }
          onProgress({ done: ++done, total, completedIndex: task.index, failed: false, bytes, attempts })
        } else {
          failed.push({ index: task.index, error: error || 'decrypt failed' })
          onProgress({ done: ++done, total, completedIndex: task.index, failed: true, bytes: 0, attempts })
        }
      })
    }

    await queue.onIdle()
    return { completed, failed }
  }

  /**
   * Decrypt one segment with bounded retries + exponential backoff.
   * Transient failures (network blips, flaky child process) are absorbed so a
   * single segment no longer dooms the whole download. Aborting stops retries.
   */
  private async decryptWithRetry(
    url: string,
    outPath: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; error?: string; attempts: number }> {
    let lastError = ''
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) return { ok: false, error: 'aborted', attempts: attempt - 1 }
      try {
        await this.decrypt(url, outPath)
        return { ok: true, attempts: attempt }
      } catch (err) {
        lastError = String(err)
        // Drop any partial output before the next attempt so a half-written file can't poison the merge.
        try { fs.rmSync(outPath, { force: true }) } catch { /* best effort */ }
        if (attempt < this.maxAttempts && !signal?.aborted) {
          try {
            await abortableDelay(this.retryBaseDelayMs * 2 ** (attempt - 1), signal)
          } catch {
            return { ok: false, error: 'aborted', attempts: attempt }
          }
        }
      }
    }
    return { ok: false, error: lastError, attempts: this.maxAttempts }
  }
}
