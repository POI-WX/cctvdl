import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BatchResult, DownloadProgress, DownloadJob, BatchStartInfo, JobState, JobStage } from '../../shared/types'

interface JobCard {
  id: string; title: string; guid: string
  state: JobState
  stage: JobStage
  percent: number; segmentsDone: number; segmentsTotal: number
  speed: number; eta: number; errorMessage: string
  sourceJob?: DownloadJob
}

export const useDownloadStore = defineStore('download', () => {
  const jobs = ref<JobCard[]>([])
  const running = ref(false)
  const stats = ref({ completed: 0, failed: 0, cancelled: 0 })
  const activeDownloads = ref(0)
  const updateVersion = ref('')

  const ACTIVE_STATES: JobState[] = ['Queued', 'ResolvingM3u8', 'Downloading', 'Merging']
  function isActive(s: JobState) { return ACTIVE_STATES.includes(s) }

  const activeJobs = computed(() => jobs.value.filter(j => isActive(j.state)))
  const completedJobs = computed(() => jobs.value.filter(j => j.state === 'Completed'))
  const failedCancelledJobs = computed(() => jobs.value.filter(j => j.state === 'Failed' || j.state === 'Cancelled'))
  const doneCount = computed(() => completedJobs.value.length)
  const finishedCount = computed(() => completedJobs.value.length + failedCancelledJobs.value.length)
  const failedCount = computed(() => jobs.value.filter(j => j.state === 'Failed').length)
  const batchPercent = computed(() => {
    if (!jobs.value.length) return 0
    const total = jobs.value.reduce((s, j) => s + j.percent, 0)
    return Math.round(total / jobs.value.length)
  })
  const downloadBadge = computed(() => activeDownloads.value > 0 ? String(activeDownloads.value) : '')
  // Sum of speeds of all actively downloading jobs (bytes/sec)
  const totalSpeed = computed(() =>
    jobs.value.filter(j => j.state === 'Downloading').reduce((s, j) => s + (j.speed || 0), 0)
  )

  function applyProgress(p: DownloadProgress) {
    const idx = jobs.value.findIndex(j => j.id === p.jobId)
    if (idx === -1) return
    const j = jobs.value[idx]
    j.state = p.state; j.stage = p.stage; j.percent = p.percent
    if (p.segmentsDone != null) j.segmentsDone = p.segmentsDone
    if (p.segmentsTotal != null) j.segmentsTotal = p.segmentsTotal
    if (p.speed != null) j.speed = p.speed
    if (p.eta != null) j.eta = p.eta
    running.value = jobs.value.some(j => isActive(j.state))
    if (p.batchTotal != null && p.batchCompleted != null) {
      activeDownloads.value = Math.max(0, p.batchTotal - p.batchCompleted)
    }
  }

  function applyJobFinished(job: DownloadJob) {
    const idx = jobs.value.findIndex(j => j.id === job.id)
    if (idx === -1) return
    jobs.value[idx].state = job.state
    jobs.value[idx].errorMessage = job.errorMessage ?? ''
    jobs.value[idx].sourceJob = job
    running.value = jobs.value.some(j => isActive(j.state))
  }

  function applyBatchFinished(result: BatchResult) {
    activeDownloads.value = 0
    running.value = false
    stats.value = { completed: result.completed, failed: result.failed, cancelled: result.cancelled }
  }

  function applyBatchStarted(info: BatchStartInfo) {
    jobs.value = info.jobs.map(j => ({
      id: j.id, title: j.title, guid: j.guid,
      state: 'Queued' as const, stage: 'None' as const,
      percent: 0, segmentsDone: 0, segmentsTotal: 0,
      speed: 0, eta: 0, errorMessage: ''
    }))
    running.value = true
  }

  function clearFinished() {
    jobs.value = jobs.value.filter(j => isActive(j.state))
  }

  function reorderJobs(ids: string[]) {
    const idxMap = new Map(ids.map((id, i) => [id, i]))
    const queued = jobs.value.filter(j => j.state === 'Queued')
    const rest = jobs.value.filter(j => j.state !== 'Queued')
    queued.sort((a, b) => (idxMap.get(a.id) ?? Infinity) - (idxMap.get(b.id) ?? Infinity))
    jobs.value = [...rest, ...queued]
    window.cctvdlApi.reorderQueue(ids)
  }

  return {
    jobs, running, stats, activeDownloads, updateVersion,
    activeJobs, completedJobs, failedCancelledJobs,
    doneCount, finishedCount, failedCount, batchPercent, totalSpeed,
    downloadBadge,
    isActive, applyProgress, applyJobFinished, applyBatchFinished, applyBatchStarted,
    clearFinished, reorderJobs
  }
})
