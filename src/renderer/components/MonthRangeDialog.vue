<template>
  <el-dialog
    v-model="dialogOpen"
    class="month-range-dialog"
    :close-on-click-modal="false"
    :before-close="beforeClose"
    width="560px"
    append-to-body
  >
    <template #header>
      <div class="range-heading">
        <span class="range-heading-icon" aria-hidden="true">🗓️</span>
        <div>
          <h2>按时间范围下载</h2>
          <p :title="program?.name">{{ program?.name }}</p>
        </div>
      </div>
    </template>

    <div v-if="phase === 'review' && !failedMonths.length" class="range-review-period">
      <div><span>时间范围</span><strong>{{ formatMonth(startMonth) }} — {{ formatMonth(endMonth) }}</strong></div>
      <button class="range-boundary-btn" :disabled="busy" @click="resetResult">修改范围</button>
    </div>
    <div v-else class="range-form">
      <div class="range-picker-row">
        <label class="range-picker-field">
          <span>起始月份</span>
          <el-date-picker v-model="startMonth" type="month" value-format="YYYYMM"
            format="YYYY年M月" placeholder="选择月份" :disabled-date="disableMonth"
            :disabled="busy" />
        </label>
        <span class="range-picker-separator" aria-hidden="true">至</span>
        <label class="range-picker-field">
          <span>结束月份</span>
          <el-date-picker v-model="endMonth" type="month" value-format="YYYYMM"
            format="YYYY年M月" placeholder="选择月份" :disabled-date="disableMonth"
            :disabled="busy" />
        </label>
      </div>
      <div class="range-form-bottom">
        <span v-if="boundaryError" class="range-validation">{{ boundaryError }}</span>
        <span v-else-if="validationMessage" class="range-validation">{{ validationMessage }}</span>
        <span v-else class="range-month-count">{{ months.length }} 个月</span>
        <button class="range-boundary-btn" :disabled="busy || boundaryLoading || !program"
          @click="fillAllHistory">{{ boundaryLoading ? '查询中…' : '最早至最新' }}</button>
      </div>
    </div>

    <div v-if="phase === 'scanning'" class="range-progress" role="status" aria-live="polite">
      <div class="range-progress-label">
        <strong>正在扫描节目列表</strong>
        <span>{{ progress.completed }}/{{ progress.total }} 个月</span>
      </div>
      <el-progress :percentage="progressPercent" :stroke-width="6" :show-text="false" />
      <p>已找到 {{ progress.found }} 个视频<template v-if="progress.failedMonths.length"> · {{ progress.failedMonths.length }} 个月需重试</template></p>
    </div>

    <div v-if="phase === 'review' && failedMonths.length" class="range-issue" role="status">
      <strong>{{ failedMonths.length }} 个月加载失败</strong>
      <p>已找到 {{ resultVideos.length }} 个视频。失败月份完成前不会加入下载队列。</p>
      <div class="range-failed-months">
        <span v-for="month in failedMonths" :key="month" :title="errors.get(month)" class="range-failed-month">
          {{ formatMonth(month) }}
        </span>
      </div>
    </div>

    <div v-if="errorMessage" class="range-issue" role="alert">{{ errorMessage }}</div>
    <div v-if="estimating" class="range-status-note">
      <el-icon class="is-loading"><Loading /></el-icon>正在计算预计大小…
    </div>

    <template v-if="phase === 'review' && prepared">
      <div class="range-result-stats">
        <div><strong>{{ resultVideos.length }}</strong><span>找到视频</span></div>
        <div><strong>{{ downloadedCount }}</strong><span>已下载</span></div>
        <div><strong>{{ eligibleVideos.length }}</strong><span>待加入</span></div>
      </div>
      <p v-if="!resultVideos.length" class="range-result-note">所选月份没有视频，可调整范围后重新扫描。</p>
      <p v-else-if="!eligibleVideos.length" class="range-result-note">扫描到的视频均已下载。</p>
      <div class="range-result-details">
        <div><span>节目内容</span><strong>{{ lockedHighlights ? '含看点和片段' : '仅节目视频' }}</strong></div>
        <div><span>清晰度</span><strong>{{ settings ? QUALITY_LABELS[settings.quality] : '—' }}</strong></div>
        <div><span>{{ estimateDetails?.sizeLabel || '预计大小' }}</span><strong>{{ estimateDetails?.sizeText || '暂无法估算' }}</strong></div>
        <div><span>磁盘剩余</span><strong>{{ estimate?.diskFreeBytes == null ? '无法检查' : (formatFileSize(estimate.diskFreeBytes) || '0 B') }}</strong></div>
        <div><span>保存到</span><strong class="range-save-path">{{ settings ? displayPath(settings.savePath) : '—' }}</strong></div>
      </div>
      <p v-if="estimateDetails?.note" class="range-result-note">{{ estimateDetails.note }}</p>
      <details v-if="resultVideos.length" class="range-video-list">
        <summary>查看扫描到的视频（{{ resultVideos.length }}）</summary>
        <div class="range-video-scroll">
          <div v-for="video in visibleReviewVideos" :key="video.guid" class="range-video-row">
            <span :title="video.title">{{ video.title }}</span>
            <small>{{ video.time?.slice(0, 10) }}<template v-if="video.contentType"> · {{ video.contentType === 'highlight' ? '看点' : '片段' }}</template></small>
          </div>
          <button v-if="visibleReviewCount < resultVideos.length" class="range-review-more"
            @click="visibleReviewCount += 100">继续显示（{{ visibleReviewCount }}/{{ resultVideos.length }}）</button>
        </div>
      </details>
    </template>

    <template #footer>
      <div v-if="phase === 'review' && prepared && lowSpace" class="range-footer-warnings">
        <el-icon class="range-warning-icon" aria-hidden="true"><WarningFilled /></el-icon>
        <p class="range-result-warning">按当前估算，磁盘空间可能不足；建议更换保存位置或释放空间。</p>
      </div>
      <div class="range-footer">
        <el-button :disabled="starting" @click="phase === 'scanning' ? cancelScan() : closeDialog()">{{ phase === 'scanning' ? '取消扫描' : '关闭' }}</el-button>
        <el-button v-if="phase === 'idle'" type="primary"
          :disabled="busy || !months.length || !!validationMessage" @click="beginScan(false)">
          扫描 {{ months.length }} 个月
        </el-button>
        <el-button v-else-if="phase === 'review' && failedMonths.length" type="primary" @click="beginScan(true)">
          重试失败月份
        </el-button>
        <el-button v-else-if="phase === 'review' && estimating" type="primary" loading disabled>估算中…</el-button>
        <el-button v-else-if="phase === 'review' && errorMessage" type="primary" @click="prepareSummary">重试</el-button>
        <el-button v-else-if="phase === 'review' && prepared" type="primary" :loading="starting"
          :disabled="!eligibleVideos.length" @click="addToQueue">加入队列</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import type { ProgramInfo, VideoInfo } from '../../shared/types'
import { enumerateMonths, scanMonths } from '../../shared/month-range'
import type { MonthScanProgress } from '../../shared/month-range'
import { formatFileSize } from '../../shared/format'
import { describeDownloadEstimate } from '../../shared/estimate-presentation'
import { displayPath } from '../../shared/path-display'
import { QUALITY_LABELS } from '../../shared/settings'
import { humanizeError } from '../../shared/errors'
import { prepareDownloadBatch, startDownloadBatch } from '../utils/download-jobs'

const LARGE_BATCH = 100
const props = defineProps<{
  modelValue: boolean
  program: ProgramInfo | null
  selectedMonth: string
  includeHighlights: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const dialogOpen = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const startMonth = ref('')
const endMonth = ref('')
const boundaryLoading = ref(false)
const boundaryError = ref('')
type Phase = 'idle' | 'scanning' | 'review'
interface RangeScan {
  program: ProgramInfo
  months: string[]
  includeHighlights: boolean
  byMonth: Map<string, VideoInfo[]>
  videos: VideoInfo[]
  failedMonths: string[]
  errors: Map<string, string>
}
const phase = ref<Phase>('idle')
const progress = ref<MonthScanProgress>({ completed: 0, total: 0, found: 0, failedMonths: [] })
const scanState = shallowRef<RangeScan | null>(null)
const prepared = shallowRef<Awaited<ReturnType<typeof prepareDownloadBatch>> | null>(null)
const visibleReviewCount = ref(100)
const estimating = ref(false)
const errorMessage = ref('')
const starting = ref(false)
let scanController: AbortController | null = null
let runId = 0
let boundaryRequestId = 0

const busy = computed(() => phase.value === 'scanning' || boundaryLoading.value || estimating.value || starting.value)
const selectedRange = computed(() => {
  if (!startMonth.value || !endMonth.value) return { months: [], error: '请选择起止月份' }
  try {
    const months = enumerateMonths(startMonth.value, endMonth.value)
    const now = new Date()
    const current = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    return endMonth.value > current
      ? { months: [], error: '结束月份不能晚于本月' }
      : { months, error: '' }
  } catch (error) { return { months: [], error: String(error instanceof Error ? error.message : error) } }
})
const validationMessage = computed(() => selectedRange.value.error)
const months = computed(() => selectedRange.value.months)
const progressPercent = computed(() => progress.value.total
  ? Math.round(progress.value.completed / progress.value.total * 100) : 0)
const resultVideos = computed(() => scanState.value?.videos || [])
const failedMonths = computed(() => scanState.value?.failedMonths || [])
const errors = computed(() => scanState.value?.errors || new Map<string, string>())
const eligibleVideos = computed(() => prepared.value?.candidates || [])
const downloadedCount = computed(() => prepared.value?.skippedHistory || 0)
const settings = computed(() => prepared.value?.settings || null)
const estimate = computed(() => prepared.value?.estimate || null)
const lockedHighlights = computed(() => scanState.value?.includeHighlights || false)
const lowSpace = computed(() => estimate.value?.diskFreeBytes != null
  && estimate.value.estimatedBytes > estimate.value.diskFreeBytes)
const estimateDetails = computed(() => estimate.value ? describeDownloadEstimate(estimate.value) : null)
const visibleReviewVideos = computed(() => resultVideos.value.slice(0, visibleReviewCount.value))

function formatMonth(month: string): string { return `${month.slice(0, 4)}年${Number(month.slice(4))}月` }
function disableMonth(date: Date): boolean {
  const now = new Date()
  return date.getFullYear() < 1900 || date.getFullYear() > now.getFullYear()
    || (date.getFullYear() === now.getFullYear() && date.getMonth() > now.getMonth())
}
async function fillAllHistory() {
  if (!props.program || boundaryLoading.value) return
  const program: ProgramInfo = {
    ...props.program,
    ...(props.program.listSource ? { listSource: { ...props.program.listSource } } : {})
  }
  const requestId = ++boundaryRequestId
  boundaryError.value = ''
  boundaryLoading.value = true
  try {
    const bounds = await window.cctvdlApi.getProgramMonthBounds(program)
    if (!bounds.earliest || !bounds.latest) throw new Error('missing month bounds')
    if (requestId !== boundaryRequestId || !props.modelValue || props.program?.columnId !== program.columnId) return
    startMonth.value = bounds.earliest
    endMonth.value = bounds.latest
  } catch {
    if (requestId === boundaryRequestId && props.modelValue && props.program?.columnId === program.columnId) {
      boundaryError.value = '无法获取节目起止月份，可重试或手动选择'
    }
  } finally { if (requestId === boundaryRequestId) boundaryLoading.value = false }
}
function resetResult() {
  phase.value = 'idle'
  progress.value = { completed: 0, total: 0, found: 0, failedMonths: [] }
  scanState.value = null
  prepared.value = null
  visibleReviewCount.value = 100
  estimating.value = false
  errorMessage.value = ''
}
watch(() => props.modelValue, open => {
  boundaryRequestId++
  boundaryLoading.value = false
  boundaryError.value = ''
  if (open) {
    resetResult()
    const now = new Date()
    const current = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    startMonth.value = props.selectedMonth || current
    endMonth.value = props.selectedMonth || current
  }
})
watch([startMonth, endMonth], () => {
  boundaryError.value = ''
  if (!busy.value && phase.value !== 'idle') resetResult()
})
function invalidateRun() {
  scanController?.abort()
  scanController = null
  runId++
}
onBeforeUnmount(invalidateRun)

function closeDialog() {
  if (starting.value) return
  invalidateRun()
  dialogOpen.value = false
}
function cancelScan() {
  invalidateRun()
  resetResult()
  ElMessage.info('扫描已取消，未创建下载任务')
}
function beforeClose(done: () => void) {
  if (starting.value) return
  invalidateRun()
  done()
}

async function beginScan(retry: boolean) {
  if (busy.value) return
  const previous = retry ? scanState.value : null
  if (retry && !previous) return
  if (!retry && (!props.program || validationMessage.value)) return
  const current: RangeScan = previous || {
    program: {
      ...props.program!,
      ...(props.program!.listSource ? { listSource: { ...props.program!.listSource } } : {})
    },
    months: months.value,
    includeHighlights: props.includeHighlights,
    byMonth: new Map(), videos: [], failedMonths: [], errors: new Map()
  }
  const currentRun = ++runId
  const controller = scanController = new AbortController()
  progress.value = {
    completed: current.byMonth.size,
    total: current.months.length,
    found: new Set(Array.from(current.byMonth.values()).flat().map(video => video.guid)).size,
    failedMonths: []
  }
  prepared.value = null
  errorMessage.value = ''
  phase.value = 'scanning'
  try {
    const result = await scanMonths(current.months, month => window.cctvdlApi.listVideos(
      current.program, month, undefined, false,
      { includeHighlights: current.includeHighlights, strictSupplementary: true }
    ), {
      concurrency: 2, signal: controller.signal,
      previous: retry ? current.byMonth : undefined,
      onProgress: value => { if (runId === currentRun) progress.value = value }
    })
    if (runId !== currentRun || result.cancelled) return
    scanState.value = {
      ...current,
      byMonth: result.byMonth, videos: result.videos,
      failedMonths: result.failedMonths, errors: result.errors
    }
    visibleReviewCount.value = 100
    phase.value = 'review'
    if (!result.failedMonths.length) await prepareSummary()
  } catch (error) {
    if (runId !== currentRun) return
    errorMessage.value = `扫描失败：${humanizeError(String(error))}`
    phase.value = retry ? 'review' : 'idle'
  }
}

async function prepareSummary() {
  if (!scanState.value || scanState.value.failedMonths.length) return
  const currentRun = runId
  estimating.value = true
  errorMessage.value = ''
  try {
    const history = await window.cctvdlApi.getDownloadHistory()
    if (currentRun !== runId) return
    const downloaded = new Set(history.map(item => item.guid))
    const next = await prepareDownloadBatch(scanState.value.videos, downloaded)
    if (currentRun !== runId) return
    prepared.value = next
  } catch (error) {
    if (currentRun !== runId) return
    errorMessage.value = `无法准备下载：${humanizeError(String(error))}`
  } finally { if (currentRun === runId) estimating.value = false }
}

async function addToQueue() {
  if (starting.value || !settings.value || !eligibleVideos.value.length) return
  starting.value = true
  try {
    if (eligibleVideos.value.length >= LARGE_BATCH) {
      await ElMessageBox.confirm(
        `将向下载队列加入最多 ${eligibleVideos.value.length} 个视频。请确认保存目录和磁盘空间。`,
        '确认大量下载任务', { type: 'warning', confirmButtonText: '继续加入', cancelButtonText: '返回检查' }
      )
    }
    const result = await startDownloadBatch(resultVideos.value, settings.value, true)
    if (result.added > 0) {
      ElMessage.success(`已添加 ${result.added} 个下载任务${result.skipped ? `，忽略 ${result.skipped} 个重复或已下载项` : ''}`)
      dialogOpen.value = false
    } else {
      ElMessage.info('扫描到的视频已下载或已在下载队列中')
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(`加入队列失败：${humanizeError(String(error))}`)
  } finally { starting.value = false }
}
</script>

<style scoped>
:global(.month-range-dialog) { display: flex; flex-direction: column; width: min(560px, calc(100vw - 28px)) !important; max-height: calc(100vh - min(20vh, 144px)); margin: min(10vh, 72px) auto !important; border-radius: 6px; }
:global(.month-range-dialog .el-dialog__header) { flex-shrink: 0; padding: 18px 20px 14px; margin: 0; border-bottom: 1px solid var(--app-border-subtle); }
:global(.month-range-dialog .el-dialog__body) { flex: 1; min-height: 0; padding: 18px 20px 8px; overflow-y: auto; }
:global(.month-range-dialog .el-dialog__footer) { flex-shrink: 0; padding: 14px 20px 18px; border-top: 1px solid var(--app-border-subtle); }
.range-heading { display: flex; align-items: center; gap: 10px; min-width: 0; padding-right: 22px; }
.range-heading-icon { font-size: 24px; line-height: 1; }
.range-heading h2 { margin: 0; font-size: 16px; font-weight: var(--app-font-weight-semibold); line-height: 1.3; color: var(--el-text-color-primary); }
.range-heading p { max-width: 420px; margin: 3px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--el-text-color-secondary); }
.range-form { display: grid; gap: 7px; }
.range-review-period { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--app-border-subtle); }
.range-review-period div { display: flex; flex-direction: column; gap: 3px; }
.range-review-period span { color: var(--el-text-color-secondary); font-size: 12px; }
.range-review-period strong { color: var(--el-text-color-primary); font-size: 13px; font-weight: var(--app-font-weight-medium); }
.range-picker-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 10px; }
.range-picker-field { display: grid; gap: 7px; min-width: 0; font-size: 12px; font-weight: var(--app-font-weight-medium); color: var(--el-text-color-secondary); }
.range-picker-field :deep(.el-date-editor) { width: 100%; }
.range-picker-separator { padding-bottom: 7px; font-size: 12px; color: var(--el-text-color-placeholder); }
.range-form-bottom { display: flex; align-items: center; justify-content: space-between; min-height: 25px; gap: 8px; }
.range-month-count { font-size: 12px; color: var(--el-text-color-secondary); }
.range-validation { font-size: 12px; color: var(--el-color-danger); }
.range-boundary-btn { padding: 4px 0; border: 0; background: transparent; color: var(--el-color-primary); font-size: 12px; cursor: pointer; }
.range-boundary-btn:disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
.range-progress, .range-issue, .range-status-note { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--app-border-subtle); }
.range-progress-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 12px; font-size: 13px; }
.range-progress-label strong { font-weight: var(--app-font-weight-medium); }
.range-progress-label span, .range-progress p { color: var(--el-text-color-secondary); }
.range-progress p, .range-issue p { margin: 10px 0 0; font-size: 12px; line-height: 1.5; }
.range-issue strong { color: var(--el-color-danger); font-size: 13px; }
.range-status-note { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-secondary); font-size: 13px; }
.range-failed-months { display: flex; flex-wrap: wrap; gap: 6px; max-height: 112px; overflow-y: auto; margin-top: 12px; }
.range-failed-month { padding: 3px 7px; border: 1px solid var(--el-color-danger-light-5); border-radius: 4px; color: var(--el-color-danger); font-size: 12px; }
.range-result-stats { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 18px; padding: 13px 0; border-top: 1px solid var(--app-border-subtle); border-bottom: 1px solid var(--app-border-subtle); }
.range-result-stats div { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.range-result-stats div + div { border-left: 1px solid var(--app-border-subtle); }
.range-result-stats strong { font-size: 20px; font-weight: var(--app-font-weight-semibold); line-height: 1.2; color: var(--el-text-color-primary); }
.range-result-stats span { font-size: 12px; color: var(--el-text-color-secondary); }
.range-result-details { display: grid; gap: 8px; margin-top: 14px; }
.range-result-details > div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px; line-height: 1.45; }
.range-result-details span { flex-shrink: 0; color: var(--el-text-color-secondary); }
.range-result-details strong { min-width: 0; overflow-wrap: anywhere; text-align: right; color: var(--el-text-color-primary); font-weight: var(--app-font-weight-normal); }
.range-result-note { margin: 10px 0 0; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.5; }
.range-footer-warnings { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; padding: 9px 10px; border-left: 2px solid var(--el-color-warning); border-radius: 4px; background: var(--el-color-warning-light-9); }
.range-warning-icon { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; color: var(--el-color-warning-dark-2); font-size: 16px; }
.range-result-warning { margin: 0; color: var(--el-text-color-primary); font-family: var(--el-font-family); font-size: 13px; font-weight: var(--app-font-weight-normal); line-height: 1.5; text-align: left; }
.range-video-list { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--app-border-subtle); }
.range-video-list summary { color: var(--el-color-primary); font-size: 12px; cursor: pointer; }
.range-video-scroll { max-height: 180px; overflow-y: auto; margin-top: 8px; padding-right: 14px; }
.range-video-row { display: grid; grid-template-columns: minmax(0, 1fr) max-content; align-items: start; gap: 14px; padding: 6px 4px 6px 0; border-bottom: 1px solid var(--app-border-subtle); font-size: 12px; line-height: 1.5; }
.range-video-row span { min-width: 0; overflow-wrap: anywhere; }
.range-video-row small { color: var(--el-text-color-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.range-review-more { width: 100%; padding: 8px 0; border: 0; background: transparent; color: var(--el-color-primary); font-size: 12px; cursor: pointer; }
.range-review-more:hover { text-decoration: underline; }
.range-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
@media (max-width: 720px) { .range-result-details > div { font-size: 12px; } }
</style>
