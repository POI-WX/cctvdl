import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BatchResult, DownloadProgress, DownloadJob, BatchStartInfo } from '../../shared/types'

interface JobCard {
  id: string; title: string; guid: string
  state: import('../../shared/types').JobState
  stage: import('../../shared/types').JobStage
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

  const activeJobs = computed(() => jobs.value.filter(j => isActive(j.state)))
  const completedJobs = computed(() => jobs.value.filter(j => j.state === 'Completed'))
  const failedCancelledJobs = computed(() => jobs.value.filter(j => j.state === 'Failed' || j.state === 'Cancelled'))
  const doneCount = computed(() => jobs.value.filter(j => j.state === 'Completed').length)
  const finishedCount = computed(() => jobs.value.filter(j => ['Completed', 'Failed', 'Cancelled'].includes(j.state)).length)
  const failedCount = computed(() => jobs.value.filter(j => j.state === 'Failed').length)
  const batchPercent = computed(() => {
    if (!jobs.value.length) return 0
    const total = jobs.value.reduce((s, j) => s + j.percent, 0)
    return Math.round(total / jobs.value.length)
  })
  const downloadBadge = computed(() => activeDownloads.value > 0 ? String(activeDownloads.value) : '')
  const downloadBadgeType = computed(() => activeDownloads.value > 0 ? 'active' : '')

  const ACTIVE_STATES: import('../../shared/types').JobState[] = ['Queued', 'ResolvingM3u8', 'Downloading', 'Merging']
  function isActive(s: import('../../shared/types').JobState) { return ACTIVE_STATES.includes(s) }

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

  return {
    jobs, running, stats, activeDownloads, updateVersion,
    activeJobs, completedJobs, failedCancelledJobs,
    doneCount, finishedCount, failedCount, batchPercent,
    downloadBadge, downloadBadgeType,
    isActive, applyProgress, applyJobFinished, applyBatchFinished, applyBatchStarted, clearFinished
  }
})
