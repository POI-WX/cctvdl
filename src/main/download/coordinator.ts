import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type { DownloadJob, JobState, JobStage, DownloadProgress, BatchResult } from '../../shared/types'
import type { CctvApiService } from '../api/cctv'
import type { SegmentDecryptor, ProgressInfo } from './decryptor'
import { segmentFileName } from './decryptor'
import type { Finalizer } from './finalizer'
import { ensureMp4Extension } from '../../shared/filename'
import { estimateEta } from '../../shared/progress'
import { logger } from '../logger'

const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  Created: ['Queued'],
  Queued: ['ResolvingM3u8', 'Cancelled'],
  ResolvingM3u8: ['Downloading', 'Merging', 'Failed', 'Cancelled'],
  Downloading: ['Merging', 'Failed', 'Cancelled'],
  Merging: ['Completed', 'Failed', 'Cancelled'],
  Completed: [],
  Failed: [],
  Cancelled: []
}

interface StateFile {
  guid: string
  segmentUrls: string[]
  completed: number[]
  pending: number[]
}

interface HistoryStore {
  addToDownloadHistory(guid: string): void
}

export class DownloadCoordinator extends EventEmitter {
  private queue: DownloadJob[] = []
  private currentJob: DownloadJob | null = null
  private abortController: AbortController | null = null
  private batchStats = { completed: 0, failed: 0, cancelled: 0, total: 0 }
  private failedJobs: Array<{ title: string; sourceUrl: string; errorMessage: string }> = []
  private jobStartTime: number = 0
  private lastProgressTime: number = 0
  private lastBytes: number = 0
  private totalBytes: number = 0
  // Count of segments that contributed to totalBytes IN THIS RUN — used so the
  // average-bytes-per-segment (for ETA) isn't diluted by resumed segments whose
  // bytes were written in a previous run.
  private bytesSampleCount: number = 0
  private segments: Array<{ index: number; status: 'pending' | 'completed' | 'failed'; progress: number; error?: string }> = []
  private config: HistoryStore | undefined
  private saveStateTimer: NodeJS.Timeout | null = null
  private pendingState: { workDir: string; state: StateFile } | null = null
  private isCancellingAll = false

  constructor(
    private readonly api: CctvApiService,
    private readonly decryptor: SegmentDecryptor,
    private readonly finalizer: Finalizer,
    config?: HistoryStore
  ) {
    super()
    this.config = config
  }

  get isBusy(): boolean {
    return this.currentJob !== null
  }

  addJob(job: DownloadJob): void {
    job.state = 'Queued'
    job.stage = 'None'
    job.progressPercent = 0
    this.queue.push(job)
    this.batchStats.total++
  }

  startBatch(jobs: DownloadJob[]): void {
    this.queue = []  // clear any stale entries from the previous batch
    this.batchStats = { completed: 0, failed: 0, cancelled: 0, total: 0 }
    this.failedJobs = []
    this.isCancellingAll = false
    for (const job of jobs) this.addJob(job)
    this.startNext()
  }

  cancel(jobId: string): void {
    const queuedJob = this.queue.find((j) => j.id === jobId && j.state === 'Queued')
    const job = queuedJob || (this.currentJob?.id === jobId ? this.currentJob : null)
    if (!job) return
    if (job === this.currentJob) {
      this.abortController?.abort()
      // Also remove from queue so it doesn't accumulate as a Cancelled zombie
      this.queue = this.queue.filter(j => j.id !== jobId)
    } else {
      // Remove queued job from queue immediately
      this.queue = this.queue.filter(j => j.id !== jobId)
    }
    // Only count the cancellation if the transition actually took effect.
    this.markCancelled(job)
  }

  /**
   * Best-effort cleanup when the app is quitting mid-download: abort the running
   * child processes and synchronously flush any debounced resume state to disk so
   * the next launch can resume. Does NOT emit events (the app is going away).
   */
  shutdown(): void {
    this.abortController?.abort()
    if (this.saveStateTimer) {
      clearTimeout(this.saveStateTimer)
      this.saveStateTimer = null
    }
    if (this.pendingState) {
      const { workDir, state } = this.pendingState
      try {
        if (fs.existsSync(workDir)) {
          fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(state), 'utf-8')
        }
      } catch {
        logger.warn(`shutdown: failed to flush state to ${workDir}`)
      }
      this.pendingState = null
    }
  }

  cancelAll(): void {
    this.isCancellingAll = true
    this.abortController?.abort()
    for (const job of this.queue) {
      this.markCancelled(job)
    }
    if (this.currentJob) {
      this.markCancelled(this.currentJob)
    }
    this.currentJob = null
    this.queue = []  // clear cancelled zombies
    this.emitBatchFinished()
  }

  private async startNext(): Promise<void> {
    if (this.isCancellingAll) return
    const nextJob = this.queue.find((j) => j.state === 'Queued')
    if (!nextJob) {
      this.currentJob = null
      this.emitBatchFinished()
      return
    }
    this.currentJob = nextJob
    this.abortController = new AbortController()
    this.jobStartTime = Date.now()
    this.lastProgressTime = this.jobStartTime
    this.lastBytes = 0
    this.totalBytes = 0
    this.bytesSampleCount = 0
    this.segments = []
    await this.executeJob(nextJob)
  }

  private async executeJob(job: DownloadJob): Promise<void> {
    // Use guid for workDir to enable resume across sessions
    const workDir = path.join(path.dirname(job.savePath), `.cctvdl_${job.guid}`)
    try {
      fs.mkdirSync(workDir, { recursive: true })

      this.transition(job, 'ResolvingM3u8')
      this.setStage(job, 'FetchingPlaylist')
      this.emitProgress(job, true)

      const result = await this.api.resolveSegmentUrls(job.guid, job.quality, this.abortController?.signal)

      if (this.abortController?.signal.aborted) {
        // cancel()/cancelAll() may have already transitioned + counted this job.
        this.markCancelled(job)
        this.flushState(workDir)
        this.startNext()
        return
      }

      const segments = result.segmentUrls
      if (!segments.length) {
        this.markFailed(job, 'no segment urls')
        this.cleanWorkDir(workDir)
        this.startNext()
        return
      }

      // Resume: match state file by guid AND segment count, and only trust a
      // "completed" entry if its decrypted file is actually present on disk.
      const stateFile = this.loadState(workDir)
      let completedIndices: number[] = []
      if (
        stateFile &&
        stateFile.guid === job.guid &&
        Array.isArray(stateFile.segmentUrls) &&
        stateFile.segmentUrls.length === segments.length
      ) {
        completedIndices = (stateFile.completed || []).filter((i) => {
          if (i < 0 || i >= segments.length) return false
          const segPath = path.join(workDir, segmentFileName(i))
          try { return fs.statSync(segPath).size > 0 } catch { return false }
        })
      }
      const completedSet = new Set(completedIndices)
      const pendingIndices = segments
        .map((_, i) => i)
        .filter((i) => !completedSet.has(i))

      logger.debug(`[${job.guid}] quality=${job.quality}, ${segments.length} segments; resume: ${completedSet.size} done, ${pendingIndices.length} to decrypt`)

      // Initialize segment tracking
      this.segments = segments.map((_, i) => ({
        index: i,
        status: completedSet.has(i) ? 'completed' : 'pending',
        progress: completedSet.has(i) ? 100 : 0
      }))

      this.transition(job, 'Downloading')
      this.setStage(job, 'DownloadingShards')
      this.emitProgress(job, true)

      const totalSegments = segments.length
      const decryptResult = await this.decryptor.decryptAll(
        pendingIndices.map((i) => ({ index: i, url: segments[i] })),
        workDir,
        (info: ProgressInfo) => {
          // completedIndex is now the ORIGINAL global index — no remapping needed.
          const idx = info.completedIndex
          if (this.segments[idx]) {
            if (info.failed) {
              this.segments[idx].status = 'failed'
              this.segments[idx].error = 'decrypt failed'
            } else {
              this.segments[idx].status = 'completed'
              this.segments[idx].progress = 100
              this.totalBytes += info.bytes
              this.bytesSampleCount++
            }
          }
          // Percent reflects overall completion (prior + this run), download phase = 0..80%.
          const completedCount = this.segments.filter(s => s.status === 'completed').length
          job.progressPercent = totalSegments > 0
            ? Math.round((completedCount / totalSegments) * 80)
            : 0
          this.emitProgress(job)  // throttled - high frequency callback
          // Persist resume state from the live segment map (single source of truth).
          const completed = this.segments.filter(s => s.status === 'completed').map(s => s.index)
          const pending = this.segments.filter(s => s.status !== 'completed').map(s => s.index)
          this.saveState(workDir, { guid: job.guid, segmentUrls: segments, completed, pending })
        },
        this.abortController?.signal,
        job.threadCount
      )

      if (this.abortController?.signal.aborted) {
        // cancel()/cancelAll() may have already transitioned + counted this job.
        this.markCancelled(job)
        this.flushState(workDir)
        this.startNext()
        return
      }

      if (decryptResult.failed.length > 0) {
        const firstFail = decryptResult.failed[0]
        logger.debug(`[${job.guid}] ${decryptResult.failed.length} segment(s) failed: ` +
          decryptResult.failed.slice(0, 3).map(f => `#${f.index} ${f.error}`).join('; '))
        this.markFailed(job, `segment ${firstFail.index} failed: ${firstFail.error}`, firstFail.index)
        // Keep workDir + state.json so a retry resumes from completed segments.
        this.flushState(workDir)
        this.startNext()
        return
      }

      this.transition(job, 'Merging')
      this.setStage(job, 'MergingShards')
      job.progressPercent = 85
      this.emitProgress(job, true)

      const listPath = this.finalizer.writeConcatList(workDir, segments.length)

      const outputPath = ensureMp4Extension(job.savePath)

      logger.debug(`[${job.guid}] merging ${segments.length} segments → ${outputPath} (reencode=${job.reencode})`)
      const finalPath = await this.finalizer.merge(listPath, outputPath, job.reencode)
      this.assertNonEmptyOutput(finalPath)

      // If the job was cancelled during merge, the transition fails — don't count it.
      if (!this.transition(job, 'Completed')) {
        this.flushState(workDir)
        this.startNext()
        return
      }
      job.outputPath = finalPath
      logger.debug(`[${job.guid}] completed → ${finalPath}`)
      this.setStage(job, 'PublishingOutput')
      job.progressPercent = 100
      this.batchStats.completed++

      if (job.guid && this.config) {
        this.config.addToDownloadHistory(job.guid)
      }

      this.emit('jobFinished', job)
      this.emitProgress(job, true)

      this.cleanWorkDir(workDir)
    } catch (err) {
      // Only marks Failed if not already in a terminal state (e.g. cancelled mid-flight).
      this.markFailed(job, String(err))
      logger.error(`Job ${job.id} failed: ${err}`)
      // Keep workDir so a retry can resume any segments already decrypted.
      this.flushState(workDir)
    }

    this.startNext()
  }

  /**
   * Attempt a state transition. Returns true if the state actually changed.
   * No-ops silently when the job is already in the requested state (idempotent),
   * and warns only on genuinely illegal transitions.
   */
  private transition(job: DownloadJob, newState: JobState): boolean {
    if (job.state === newState) return false
    const allowed = VALID_TRANSITIONS[job.state]
    if (!allowed?.includes(newState)) {
      logger.warn(`Invalid transition ${job.state} → ${newState} for job ${job.id}`)
      return false
    }
    job.state = newState
    return true
  }

  /** Cancel a job: transition and, only if it actually changed, count + emit once. */
  private markCancelled(job: DownloadJob): void {
    if (this.transition(job, 'Cancelled')) {
      this.batchStats.cancelled++
      this.emit('jobFinished', job)
    }
  }

  /** Fail a job: record the error, transition, and (if it changed) count + emit once. */
  private markFailed(job: DownloadJob, message: string, segmentIndex?: number): void {
    job.errorMessage = message
    if (segmentIndex !== undefined) job.errorSegmentIndex = segmentIndex
    if (this.transition(job, 'Failed')) {
      this.batchStats.failed++
      this.failedJobs.push({ title: job.title, sourceUrl: job.sourceUrl, errorMessage: message })
      this.emit('jobFinished', job)
    }
  }

  private setStage(job: DownloadJob, stage: JobStage): void {
    job.stage = stage
  }

  /** Guard against a silent ffmpeg success that produced a missing/empty file. */
  private assertNonEmptyOutput(p: string): void {
    let size = 0
    try { size = fs.statSync(p).size } catch { /* missing */ }
    if (size <= 0) {
      throw new Error(`output file missing or empty: ${p}`)
    }
  }

  private lastEmitTime: number = 0
  private readonly EMIT_THROTTLE_MS = 250  // max 4 UI updates/second

  private emitProgress(job: DownloadJob, forceEmit = false): void {
    const now = Date.now()

    // Skip non-forced emits that arrive within the throttle window
    if (!forceEmit && now - this.lastEmitTime < this.EMIT_THROTTLE_MS) {
      return
    }
    this.lastEmitTime = now

    // Real throughput: bytes of decrypted output written since the last sample.
    const bytesDelta = this.totalBytes - this.lastBytes
    const timeDelta = (now - this.lastProgressTime) / 1000

    let speed = 0
    if (timeDelta > 0 && bytesDelta > 0) {
      speed = bytesDelta / timeDelta // bytes/second
    }

    const completedCount = this.segments.filter(s => s.status === 'completed').length
    const totalCount = this.segments.length
    const eta = estimateEta(this.totalBytes, this.bytesSampleCount, completedCount, totalCount, speed)

    if (bytesDelta > 0) {
      this.lastProgressTime = now
      this.lastBytes = this.totalBytes
    }

    const progress: DownloadProgress = {
      jobId: job.id,
      percent: job.progressPercent,
      state: job.state,
      stage: job.stage,
      speed,
      eta,
      title: job.title,
      segmentsDone: completedCount > 0 ? completedCount : undefined,
      segmentsTotal: totalCount > 0 ? totalCount : undefined,
      batchCompleted: this.batchStats.completed + this.batchStats.failed + this.batchStats.cancelled,
      batchTotal: this.batchStats.total,
    }
    this.emit('progress', progress)
  }

  private emitBatchFinished(): void {
    const result: BatchResult = {
      ...this.batchStats,
      failedJobs: this.failedJobs
    }
    this.emit('batchFinished', result)
  }

  private loadState(workDir: string): StateFile | null {
    const stateFilePath = path.join(workDir, 'state.json')
    if (!fs.existsSync(stateFilePath)) return null
    try {
      return JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'))
    } catch {
      return null
    }
  }

  private saveState(workDir: string, state: StateFile): void {
    // Debounce: only write to disk 500ms after the last update.
    // Prevents high-frequency sync I/O during concurrent segment downloads.
    this.pendingState = { workDir, state }
    if (this.saveStateTimer) clearTimeout(this.saveStateTimer)
    this.saveStateTimer = setTimeout(() => this.flushState(workDir), 500)
  }

  /** Force-write any debounced resume state immediately (called at terminal points). */
  private flushState(workDir: string): void {
    if (this.saveStateTimer) {
      clearTimeout(this.saveStateTimer)
      this.saveStateTimer = null
    }
    if (!this.pendingState || this.pendingState.workDir !== workDir) return
    try {
      if (fs.existsSync(workDir)) {
        fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(this.pendingState.state), 'utf-8')
      }
    } catch {
      logger.warn(`Failed to save state to ${workDir}`)
    }
    this.pendingState = null
  }

  private cleanWorkDir(workDir: string): void {
    if (this.saveStateTimer) {
      clearTimeout(this.saveStateTimer)
      this.saveStateTimer = null
    }
    this.pendingState = null
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch {
      logger.warn(`Failed to clean work dir: ${workDir}`)
    }
  }
}
