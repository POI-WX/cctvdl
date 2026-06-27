import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type { DownloadJob, JobState, JobStage, DownloadProgress, BatchResult, HistoryEntry } from '../../shared/types'
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
  addToDownloadHistory(entry: HistoryEntry): void
  savePendingJobs(jobs: DownloadJob[]): void
  clearPendingJobs(): void
}

export class DownloadCoordinator extends EventEmitter {
  private queue: DownloadJob[] = []
  // Map<jobId, AbortController> — all currently executing jobs
  private activeJobs: Map<string, AbortController> = new Map()
  private concurrentVideos: number = 1
  private batchStats = { completed: 0, failed: 0, cancelled: 0, total: 0 }
  private failedJobs: Array<{ title: string; sourceUrl: string; errorMessage: string }> = []
  private config: HistoryStore | undefined
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
    return this.activeJobs.size > 0
  }

  setConcurrentVideos(n: number): void {
    this.concurrentVideos = Math.max(1, Math.min(3, Math.floor(n)))
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
    this.config?.savePendingJobs(jobs)
    this.startNext()
  }

  // Resume a previously persisted batch (e.g. after app restart). Unlike startBatch,
  // does not reset stats so partial progress is preserved.
  resumePending(jobs: DownloadJob[]): void {
    this.queue = []
    this.isCancellingAll = false
    for (const job of jobs) this.addJob(job)
    this.startNext()
  }

  cancel(jobId: string): void {
    // Check if active (running)
    const activeAbort = this.activeJobs.get(jobId)
    if (activeAbort) {
      activeAbort.abort()
      this.queue = this.queue.filter(j => j.id !== jobId)
      return
    }
    // Check if queued
    const queuedJob = this.queue.find((j) => j.id === jobId && j.state === 'Queued')
    if (queuedJob) {
      this.queue = this.queue.filter(j => j.id !== jobId)
      this.markCancelled(queuedJob)
    }
  }

  /**
   * Best-effort cleanup when the app is quitting mid-download.
   */
  shutdown(): void {
    for (const abort of this.activeJobs.values()) abort.abort()
  }

  cancelAll(): void {
    this.isCancellingAll = true
    for (const abort of this.activeJobs.values()) abort.abort()
    for (const job of this.queue) {
      this.markCancelled(job)
    }
    this.activeJobs.clear()
    this.queue = []  // clear cancelled zombies
    this.emitBatchFinished()
  }

  private startNext(): void {
    if (this.isCancellingAll) return
    // Launch up to concurrentVideos jobs simultaneously
    const slots = this.concurrentVideos - this.activeJobs.size
    for (let i = 0; i < slots; i++) {
      const nextJob = this.queue.find((j) => j.state === 'Queued')
      if (!nextJob) break
      const abort = new AbortController()
      this.activeJobs.set(nextJob.id, abort)
      void this.executeJob(nextJob, abort)
    }
    // If nothing is running and nothing is queued, batch is done
    if (this.activeJobs.size === 0 && !this.queue.some(j => j.state === 'Queued')) {
      this.emitBatchFinished()
    }
  }

  private async executeJob(job: DownloadJob, abort: AbortController): Promise<void> {
    // Per-job runtime state (not shared between parallel jobs)
    let jobTotalBytes = 0
    let jobLastBytes = 0
    let jobBytesSampleCount = 0
    let jobLastProgressTime = Date.now()
    let jobLastEmitTime = 0
    let jobSegments: Array<{ index: number; status: 'pending' | 'completed' | 'failed'; progress: number; error?: string }> = []
    let jobSaveStateTimer: NodeJS.Timeout | null = null
    let jobPendingState: { workDir: string; state: StateFile } | null = null

    const emitJobProgress = (forceEmit = false): void => {
      const now = Date.now()
      if (!forceEmit && now - jobLastEmitTime < 250) return
      jobLastEmitTime = now
      const bytesDelta = jobTotalBytes - jobLastBytes
      const timeDelta = (now - jobLastProgressTime) / 1000
      let speed = 0
      if (timeDelta > 0 && bytesDelta > 0) speed = bytesDelta / timeDelta
      const completedCount = jobSegments.filter(s => s.status === 'completed').length
      const totalCount = jobSegments.length
      const eta = estimateEta(jobTotalBytes, jobBytesSampleCount, completedCount, totalCount, speed)
      if (bytesDelta > 0) { jobLastProgressTime = now; jobLastBytes = jobTotalBytes }
      const progress: DownloadProgress = {
        jobId: job.id, percent: job.progressPercent,
        state: job.state, stage: job.stage,
        speed, eta, title: job.title,
        segmentsDone: completedCount > 0 ? completedCount : undefined,
        segmentsTotal: totalCount > 0 ? totalCount : undefined,
        batchCompleted: this.batchStats.completed + this.batchStats.failed + this.batchStats.cancelled,
        batchTotal: this.batchStats.total,
      }
      this.emit('progress', progress)
    }

    const saveJobState = (workDir: string, state: StateFile): void => {
      jobPendingState = { workDir, state }
      if (jobSaveStateTimer) clearTimeout(jobSaveStateTimer)
      jobSaveStateTimer = setTimeout(() => {
        if (jobPendingState && fs.existsSync(jobPendingState.workDir)) {
          try { fs.writeFileSync(path.join(jobPendingState.workDir, 'state.json'), JSON.stringify(jobPendingState.state), 'utf-8') } catch { /* best effort */ }
        }
        jobSaveStateTimer = null
      }, 500)
    }

    const flushJobState = (workDir: string): void => {
      if (jobSaveStateTimer) { clearTimeout(jobSaveStateTimer); jobSaveStateTimer = null }
      if (jobPendingState && fs.existsSync(workDir)) {
        try { fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(jobPendingState.state), 'utf-8') } catch { /* best effort */ }
        jobPendingState = null
      }
    }

    // Use guid for workDir to enable resume across sessions
    const workDir = path.join(path.dirname(job.savePath), `.cctvdl_${job.guid}`)
    try {
      fs.mkdirSync(workDir, { recursive: true })

      this.transition(job, 'ResolvingM3u8')
      this.setStage(job, 'FetchingPlaylist')
      emitJobProgress(true)

      const result = await this.api.resolveSegmentUrls(job.guid, job.quality, abort.signal)

      if (abort.signal.aborted) {
        this.markCancelled(job)
        flushJobState(workDir)
        this.activeJobs.delete(job.id)
        this.startNext()
        return
      }

      const segments = result.segmentUrls
      if (!segments.length) {
        this.markFailed(job, 'no segment urls')
        this.cleanWorkDir(workDir)
        this.activeJobs.delete(job.id)
        this.startNext()
        return
      }

      const stateFile = this.loadState(workDir)
      let completedIndices: number[] = []
      if (stateFile && stateFile.guid === job.guid && Array.isArray(stateFile.segmentUrls) && stateFile.segmentUrls.length === segments.length) {
        completedIndices = (stateFile.completed || []).filter((i) => {
          if (i < 0 || i >= segments.length) return false
          const segPath = path.join(workDir, segmentFileName(i))
          try { return fs.statSync(segPath).size > 0 } catch { return false }
        })
      }
      const completedSet = new Set(completedIndices)
      const pendingIndices = segments.map((_, i) => i).filter((i) => !completedSet.has(i))

      logger.debug(`[${job.guid}] quality=${job.quality}, ${segments.length} segments; resume: ${completedSet.size} done, ${pendingIndices.length} to decrypt`)

      jobSegments = segments.map((_, i) => ({
        index: i,
        status: completedSet.has(i) ? 'completed' : 'pending',
        progress: completedSet.has(i) ? 100 : 0
      }))

      this.transition(job, 'Downloading')
      this.setStage(job, 'DownloadingShards')
      emitJobProgress(true)

      const totalSegments = segments.length
      const decryptResult = await this.decryptor.decryptAll(
        pendingIndices.map((i) => ({ index: i, url: segments[i] })),
        workDir,
        (info: ProgressInfo) => {
          const idx = info.completedIndex
          if (jobSegments[idx]) {
            if (info.failed) {
              jobSegments[idx].status = 'failed'
              jobSegments[idx].error = 'decrypt failed'
            } else {
              jobSegments[idx].status = 'completed'
              jobSegments[idx].progress = 100
              jobTotalBytes += info.bytes
              jobBytesSampleCount++
            }
          }
          let completedCount = 0
          const completed: number[] = []
          const pending: number[] = []
          for (const seg of jobSegments) {
            if (seg.status === 'completed') { completedCount++; completed.push(seg.index) }
            else { pending.push(seg.index) }
          }
          job.progressPercent = totalSegments > 0 ? Math.round((completedCount / totalSegments) * 80) : 0
          emitJobProgress()
          saveJobState(workDir, { guid: job.guid, segmentUrls: segments, completed, pending })
        },
        abort.signal,
        job.threadCount
      )

      if (abort.signal.aborted) {
        this.markCancelled(job)
        flushJobState(workDir)
        this.activeJobs.delete(job.id)
        this.startNext()
        return
      }

      if (decryptResult.failed.length > 0) {
        const firstFail = decryptResult.failed[0]
        logger.debug(`[${job.guid}] ${decryptResult.failed.length} segment(s) failed: ` + decryptResult.failed.slice(0, 3).map(f => `#${f.index} ${f.error}`).join('; '))
        this.markFailed(job, `segment ${firstFail.index} failed: ${firstFail.error}`, firstFail.index)
        flushJobState(workDir)
        this.activeJobs.delete(job.id)
        this.startNext()
        return
      }

      this.transition(job, 'Merging')
      this.setStage(job, 'MergingShards')
      job.progressPercent = 85
      emitJobProgress(true)

      const listPath = this.finalizer.writeConcatList(workDir, segments.length)
      const outputPath = ensureMp4Extension(job.savePath)
      logger.debug(`[${job.guid}] merging ${segments.length} segments → ${outputPath} (reencode=${job.reencode})`)
      const finalPath = await this.finalizer.merge(listPath, outputPath, job.reencode)
      this.assertNonEmptyOutput(finalPath)

      if (!this.transition(job, 'Completed')) {
        flushJobState(workDir)
        this.activeJobs.delete(job.id)
        this.startNext()
        return
      }
      job.outputPath = finalPath
      logger.debug(`[${job.guid}] completed → ${finalPath}`)
      this.setStage(job, 'PublishingOutput')
      job.progressPercent = 100
      this.batchStats.completed++

      if (job.guid && this.config) {
        const fileSize = (() => { try { return fs.statSync(finalPath).size } catch { return 0 } })()
        this.config.addToDownloadHistory({ guid: job.guid, title: job.title, outputPath: finalPath, fileSize, completedAt: Date.now() })
      }

      this.emit('jobFinished', job)
      emitJobProgress(true)
      this.cleanWorkDir(workDir)
    } catch (err) {
      this.markFailed(job, String(err))
      logger.error(`Job ${job.id} failed: ${err}`)
      if (jobSaveStateTimer) { clearTimeout(jobSaveStateTimer); jobSaveStateTimer = null }
    }

    this.activeJobs.delete(job.id)
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

  private emitBatchFinished(): void {
    this.config?.clearPendingJobs()
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

  private cleanWorkDir(workDir: string): void {
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch {
      logger.warn(`Failed to clean work dir: ${workDir}`)
    }
  }
}
