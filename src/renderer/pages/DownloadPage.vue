<template>
  <div class="dl-page">
    <!-- toolbar -->
    <div class="dl-toolbar">
      <div class="dl-overview">
        <span class="dl-overview-title">下载队列</span>
        <span v-if="jobs.length" class="dl-overview-sub">
          {{ doneCount }}/{{ jobs.length }} 完成
          <span v-if="stats.failed" class="text-danger"> · {{ stats.failed }} 失败</span>
          <span v-if="stats.cancelled" class="text-muted"> · {{ stats.cancelled }} 取消</span>
        </span>
      </div>
      <div class="dl-actions">
        <button v-if="running" class="dl-action-btn danger" @click="cancelAll">⏹ 全部取消</button>
        <button v-if="!running && failedCount > 0" class="dl-action-btn primary" @click="retryAllFailed">
          ↺ 重试失败 ({{ failedCount }})
        </button>
        <button v-if="!running && finishedCount > 0" class="dl-action-btn" @click="dlStore.clearFinished()">清除完成</button>
        <button class="dl-action-btn" @click="openFolder">📂 打开文件夹</button>
      </div>
    </div>

    <!-- batch progress bar -->
    <div v-if="jobs.length > 1" class="dl-batch-bar">
      <div class="dl-batch-info">
        <span class="dl-batch-label">批次进度</span>
        <span class="dl-batch-desc">{{ doneCount }}/{{ jobs.length }} 完成</span>
      </div>
      <div class="dl-batch-track">
        <div
          class="dl-batch-fill"
          :class="{
            complete: batchPercent === 100,
            running: running && batchPercent < 100
          }"
          :style="{ width: batchPercent + '%' }"
        />
      </div>
      <span class="dl-batch-pct">{{ batchPercent }}%</span>
    </div>

    <!-- job list -->
    <div class="dl-list">
      <!-- empty state -->
      <div v-if="!jobs.length" class="dl-empty">
        <div class="dl-empty-icon">⬇️</div>
        <p class="dl-empty-title">暂无下载任务</p>
        <p class="dl-empty-hint">在「首页」选择视频并点击「下载选中」</p>
        <el-button size="small" @click="emit('go-home')">去首页选择视频</el-button>
      </div>

      <!-- group: active -->
      <div v-if="activeJobs.length" class="dl-group">
        <button class="dl-group-header" @click="toggleGroup('active')">
          <span class="dl-group-icon">⬇</span>
          <span class="dl-group-title">进行中</span>
          <span class="dl-group-count">{{ activeJobs.length }}</span>
          <span class="dl-group-chevron" :class="{ collapsed: groupCollapsed.active }">›</span>
        </button>
        <div v-if="!groupCollapsed.active" class="dl-group-body"
             @dragover.prevent @drop.prevent="onDrop($event)">
          <div v-for="(job, idx) in activeJobs" :key="job.id" class="dl-card active"
               :class="{ 'drag-over': dragOverId === job.id }"
               :draggable="job.state === 'Queued'"
               @dragstart="job.state === 'Queued' && onDragStart($event, job.id)"
               @dragend="onDragEnd"
               @dragover.prevent="job.state === 'Queued' && (dragOverId = job.id)"
               @dragleave="dragOverId = null"
               @contextmenu.prevent="openContextMenu($event, job)">
              <div class="dl-card-head">
                <span v-if="job.state === 'Queued'" class="dl-drag-handle" title="拖拽排序">⠿</span>
                <div class="dl-card-indicator" :class="indicatorClass(job.state)">
                  <span class="dl-card-indicator-icon">{{ stateIcon(job.state) }}</span>
                </div>
                <div class="dl-card-info">
                  <span class="dl-card-title" :title="job.title">{{ job.title }}</span>
                  <div class="dl-card-sub">
                    <template v-if="job.state === 'Queued'">
                      <span class="dl-card-stage dl-queue-pos">第 {{ idx + 1 }} 位排队</span>
                    </template>
                    <template v-else>
                      <span class="dl-card-stage">{{ stageText(job.stage) }}</span>
                      <template v-if="job.segmentsTotal">
                        <span class="dl-card-sep">·</span>
                        <span>{{ job.segmentsDone }}/{{ job.segmentsTotal }} 分片</span>
                      </template>
                    </template>
                  </div>
                  <div v-if="job.state === 'Downloading' && job.speed" class="dl-card-speed-row">
                    <span class="dl-card-speed">{{ formatSpeed(job.speed) }}</span>
                    <span v-if="job.eta > 0" class="dl-card-eta">剩余 {{ formatTime(job.eta) }}</span>
                  </div>
                </div>
                <div class="dl-card-right">
                  <button
                    v-if="job.state === 'Queued' && idx > 0"
                    class="dl-card-btn dl-pin-btn"
                    title="置顶"
                    @click.stop="pinToTop(job.id)"
                  >↑ 置顶</button>
                  <span v-else class="dl-card-pct">{{ job.percent }}%</span>
                </div>
              </div>
              <div class="dl-card-progress">
                <div class="dl-progress-track">
                  <div class="dl-progress-fill"
                    :class="{
                      indeterminate: job.stage === 'MergingShards',
                      stripe: job.state === 'Downloading'
                    }"
                    :style="job.stage !== 'MergingShards' ? { width: job.percent + '%' } : {}" />
                </div>
              </div>
              <div class="dl-card-actions">
                <button class="dl-card-btn" @click="cancel(job.id)">取消</button>
              </div>
          </div>
        </div>
      </div>

      <!-- group: completed -->
      <div v-if="completedJobs.length" class="dl-group">
        <button class="dl-group-header" @click="toggleGroup('completed')">
          <span class="dl-group-icon success">✓</span>
          <span class="dl-group-title">已完成</span>
          <span class="dl-group-count">{{ completedJobs.length }}</span>
          <span class="dl-group-chevron" :class="{ collapsed: groupCollapsed.completed }">›</span>
        </button>
        <TransitionGroup v-if="!groupCollapsed.completed" name="card-list" tag="div" class="dl-group-body">
          <div v-for="job in completedJobs" :key="job.id" class="dl-card"
            @contextmenu.prevent="openContextMenu($event, job)">
            <div class="dl-card-head">
              <div class="dl-card-indicator ind-success">
                <span class="dl-card-indicator-icon">✓</span>
              </div>
              <div class="dl-card-info">
                <span class="dl-card-title" :title="job.title">{{ job.title }}</span>
                <div class="dl-card-sub">
                  <span class="dl-card-stage">下载完成</span>
                  <template v-if="job.sourceJob?.outputPath">
                    <span class="dl-card-sep">·</span>
                    <span class="dl-card-filename" :title="job.sourceJob.outputPath">
                      {{ job.sourceJob.outputPath.split(/[\\/]/).pop() }}
                    </span>
                  </template>
                </div>
              </div>
              <div class="dl-card-right">
                <span class="dl-card-badge badge-success">已完成</span>
              </div>
            </div>
            <div class="dl-card-progress">
              <div class="dl-progress-track">
                <div class="dl-progress-fill complete" style="width:100%" />
              </div>
            </div>
            <div class="dl-card-actions">
              <button class="dl-card-btn primary" @click="playFile(job)">▶ 播放</button>
              <button class="dl-card-btn" @click="revealFile(job)">📂 文件夹</button>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- group: failed / cancelled -->
      <div v-if="failedCancelledJobs.length" class="dl-group">
        <button class="dl-group-header" @click="toggleGroup('failed')">
          <span class="dl-group-icon danger">✗</span>
          <span class="dl-group-title">失败 / 取消</span>
          <span class="dl-group-count">{{ failedCancelledJobs.length }}</span>
          <span class="dl-group-chevron" :class="{ collapsed: groupCollapsed.failed }">›</span>
        </button>
        <TransitionGroup v-if="!groupCollapsed.failed" name="card-list" tag="div" class="dl-group-body">
          <div v-for="job in failedCancelledJobs" :key="job.id" class="dl-card"
            @contextmenu.prevent="openContextMenu($event, job)">
            <div class="dl-card-head">
              <div class="dl-card-indicator" :class="job.state === 'Failed' ? 'ind-error' : 'ind-muted'">
                <span class="dl-card-indicator-icon">{{ job.state === 'Failed' ? '✗' : '○' }}</span>
              </div>
              <div class="dl-card-info">
                <span class="dl-card-title" :title="job.title">{{ job.title }}</span>
                <div class="dl-card-sub">
                  <span class="dl-card-stage">{{ stateText(job.state) }}</span>
                </div>
              </div>
              <div class="dl-card-right">
                <span class="dl-card-badge" :class="badgeClass(job.state)">{{ stateText(job.state) }}</span>
              </div>
            </div>
            <div v-if="job.errorMessage && job.state === 'Failed'" class="dl-card-error">
              <span class="dl-card-error-icon">⚠</span>
              <span class="dl-card-error-text">
                <template v-if="expandedErrors.has(job.id) || job.errorMessage.length <= 80">
                  {{ humanizeError(job.errorMessage) }}
                </template>
                <template v-else>
                  {{ humanizeError(job.errorMessage).slice(0, 80) }}…
                </template>
                <button
                  v-if="job.errorMessage.length > 80"
                  class="dl-card-error-toggle"
                  @click="toggleError(job.id)"
                >{{ expandedErrors.has(job.id) ? '收起' : '展开' }}</button>
              </span>
            </div>
            <div class="dl-card-actions">
              <button v-if="!running" class="dl-card-btn primary" @click="retry(job)">↺ 重试</button>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenu.visible" class="dl-ctx-overlay" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu">
        <div class="dl-ctx-menu" :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }">
          <button class="dl-ctx-item" @click="ctxCopyTitle">📋 复制标题</button>
          <button v-if="ctxMenu.job?.sourceJob?.outputPath" class="dl-ctx-item" @click="ctxOpenFile">▶ 播放</button>
          <button v-if="ctxMenu.job?.sourceJob?.outputPath" class="dl-ctx-item" @click="ctxRevealFile">📂 定位文件</button>
          <button v-if="ctxMenu.job?.state === 'Failed'" class="dl-ctx-item" @click="ctxRetry">↺ 重试</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useDownloadStore } from '../stores/download'
const emit = defineEmits<{ 'go-home': [] }>()
import type { DownloadProgress, DownloadJob, BatchStartInfo, JobState, JobStage } from '../../shared/types'
import { formatSpeed, formatTime } from '../../shared/format'
import { humanizeError } from '../../shared/errors'
import { buildOutputPath } from '../../shared/filename'

const dlStore = useDownloadStore()
const { jobs, running, stats, doneCount, finishedCount, failedCount, batchPercent,
        activeJobs, completedJobs, failedCancelledJobs } = storeToRefs(dlStore)

// ─── 拖拽排序 ──────────────────────────────────────────────────────────────
const dragOverId = ref<string | null>(null)
let dragSrcId: string | null = null

function onDragStart(e: DragEvent, id: string) {
  dragSrcId = id
  e.dataTransfer?.setData('text/plain', id)
}

function onDragEnd() {
  dragSrcId = null
  dragOverId.value = null
}

function onDrop(_e: DragEvent) {
  const targetId = dragOverId.value
  dragOverId.value = null
  if (!dragSrcId || !targetId || dragSrcId === targetId) return
  const queued = activeJobs.value.filter(j => j.state === 'Queued').map(j => j.id)
  const srcIdx = queued.indexOf(dragSrcId)
  const dstIdx = queued.indexOf(targetId)
  if (srcIdx === -1 || dstIdx === -1) return
  queued.splice(srcIdx, 1)
  queued.splice(dstIdx, 0, dragSrcId)
  dlStore.reorderJobs(queued)
  dragSrcId = null
}

function pinToTop(id: string) {
  const queued = activeJobs.value.filter(j => j.state === 'Queued').map(j => j.id)
  const idx = queued.indexOf(id)
  if (idx <= 0) return
  queued.splice(idx, 1)
  queued.unshift(id)
  dlStore.reorderJobs(queued)
}

const STATE_TEXT: Record<JobState | 'None', string> = {
  None: '就绪', Created: '已创建', Queued: '排队中', ResolvingM3u8: '解析中',
  Downloading: '下载中', Merging: '合并中', Completed: '已完成',
  Failed: '失败', Cancelled: '已取消'
}
const STATE_ICON: Partial<Record<JobState | 'None', string>> = {
  Queued: '⏳', ResolvingM3u8: '🔍', Downloading: '⬇', Merging: '🔗',
  Completed: '✓', Failed: '✗', Cancelled: '○', Created: '·'
}
const STAGE_TEXT: Record<JobStage, string> = {
  None: '等待开始', FetchingPlaylist: '获取播放列表',
  DownloadingShards: '下载并解密分片', MergingShards: '合并封装中',
  PublishingOutput: '写入文件'
}

const groupCollapsed = ref({ active: false, completed: false, failed: false })
function toggleGroup(key: 'active' | 'completed' | 'failed') {
  groupCollapsed.value[key] = !groupCollapsed.value[key]
}

const expandedErrors = ref(new Set<string>())
function toggleError(jobId: string) {
  if (expandedErrors.value.has(jobId)) expandedErrors.value.delete(jobId)
  else expandedErrors.value.add(jobId)
}

const stateText = (s: string) => STATE_TEXT[s] ?? s
const stageText = (s: string) => STAGE_TEXT[s] ?? ''
const stateIcon = (s: JobState) => STATE_ICON[s] ?? '·'

function indicatorClass(s: JobState) {
  if (s === 'Completed') return 'ind-success'
  if (s === 'Failed') return 'ind-error'
  if (s === 'Cancelled') return 'ind-muted'
  if (dlStore.isActive(s)) return 'ind-active'
  return 'ind-muted'
}

function badgeClass(s: JobState) {
  if (s === 'Completed') return 'badge-success'
  if (s === 'Failed') return 'badge-error'
  if (s === 'Cancelled') return 'badge-muted'
  return ''
}

onMounted(() => {
  window.cctvdlApi.onBatchStarted((info: BatchStartInfo) => {
    dlStore.applyBatchStarted(info)
  })

  window.cctvdlApi.onDownloadProgress((p: DownloadProgress) => {
    dlStore.applyProgress(p)
  })

  window.cctvdlApi.onJobFinished((finished: DownloadJob) => {
    dlStore.applyJobFinished(finished)
  })

  window.cctvdlApi.onBatchFinished((result) => {
    dlStore.applyBatchFinished(result)
    if (result.total > 0) {
      const msg = result.failed > 0
        ? `完成 ${result.completed} 个，失败 ${result.failed} 个`
        : `${result.completed} 个视频下载完成`
      ElNotification({
        title: '下载完成',
        message: msg,
        type: result.failed > 0 ? 'warning' : 'success',
        duration: 4000,
        position: 'bottom-right'
      })
    }
  })
})

function cancel(id: string) { window.cctvdlApi.cancelDownload(id) }
function cancelAll() { window.cctvdlApi.cancelAllDownloads() }

async function retry(job: typeof jobs.value[0]) {
  const sourceJob = job.sourceJob ?? await rebuildJob(job)
  if (!sourceJob) return
  job.state = 'Queued'; job.stage = 'None'; job.percent = 0; job.errorMessage = ''
  window.cctvdlApi.retryJob({ ...sourceJob, state: 'Created', stage: 'None', progressPercent: 0 })
}

async function rebuildJob(job: typeof jobs.value[0]): Promise<DownloadJob | null> {
  const settings = await window.cctvdlApi.getSettings()
  if (!settings.savePath) { ElMessage.warning('请先在设置中配置保存位置'); return null }
  return {
    id: job.id, guid: job.guid, sourceUrl: job.guid, title: job.title,
    savePath: buildOutputPath(settings.savePath, job.title),
    quality: settings.quality, threadCount: settings.threadCount,
    reencode: settings.reencode ?? false,
    state: 'Created', stage: 'None', progressPercent: 0
  }
}

async function retryAllFailed() {
  const failed = jobs.value.filter(j => j.state === 'Failed')
  if (!failed.length) return
  const built = await Promise.all(failed.map(j => j.sourceJob ?? rebuildJob(j)))
  const validJobs = built.filter((j): j is DownloadJob => !!j)
  if (!validJobs.length) return
  failed.forEach(j => { j.state = 'Queued'; j.stage = 'None'; j.percent = 0; j.errorMessage = '' })
  window.cctvdlApi.retryJobs(validJobs.map(j => ({ ...j, state: 'Created', stage: 'None', progressPercent: 0 })))
}

async function openFolder() {
  const s = await window.cctvdlApi.getSettings()
  if (s.savePath) window.cctvdlApi.openPath(s.savePath)
}

async function playFile(job: typeof jobs.value[0]) {
  const out = job.sourceJob?.outputPath
  if (out) window.cctvdlApi.openPath(out); else openFolder()
}

async function revealFile(job: typeof jobs.value[0]) {
  const out = job.sourceJob?.outputPath
  if (out) window.cctvdlApi.revealFile(out); else openFolder()
}

// ─── 右键菜单 ──────────────────────────────────────────────────────────────
const ctxMenu = ref<{ visible: boolean; x: number; y: number; job: typeof jobs.value[0] | null }>({
  visible: false, x: 0, y: 0, job: null
})

function openContextMenu(e: MouseEvent, job: typeof jobs.value[0]) {
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, job }
}

function closeContextMenu() { ctxMenu.value.visible = false }

function ctxCopyTitle() {
  if (ctxMenu.value.job) navigator.clipboard.writeText(ctxMenu.value.job.title)
  closeContextMenu()
}

function ctxOpenFile() {
  if (ctxMenu.value.job) playFile(ctxMenu.value.job)
  closeContextMenu()
}

function ctxRevealFile() {
  if (ctxMenu.value.job) revealFile(ctxMenu.value.job)
  closeContextMenu()
}

function ctxRetry() {
  if (ctxMenu.value.job) retry(ctxMenu.value.job)
  closeContextMenu()
}
</script>

<style scoped>
/* ── 页面骨架 ─────────────────────────────────────── */
.dl-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--app-spacing-lg);
  box-sizing: border-box;
  gap: var(--app-spacing-md);
}

/* ── 工具栏 ───────────────────────────────────────── */
.dl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.dl-overview-title {
  font-size: 16px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-text-color-primary);
}

.dl-overview-sub {
  margin-left: var(--app-spacing-sm);
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.text-danger { color: var(--el-color-danger); }
.text-muted  { color: var(--el-text-color-secondary); }

.dl-actions { display: flex; gap: var(--app-spacing-sm); align-items: center; }

.dl-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: all .12s;
}

.dl-action-btn:hover {
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-darker);
  color: var(--el-text-color-primary);
}

.dl-action-btn.primary {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}

.dl-action-btn.primary:hover { background: var(--el-color-primary-dark-2); }

.dl-action-btn.danger {
  background: var(--el-color-danger);
  border-color: var(--el-color-danger);
  color: #fff;
}

.dl-action-btn.danger:hover { opacity: .9; }

/* ── 批次总进度 ──────────────────────────────────── */
.dl-batch-bar {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  flex-shrink: 0;
}

.dl-batch-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-shrink: 0;
  min-width: 72px;
}

.dl-batch-label {
  font-size: 10px;
  font-weight: var(--app-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--el-text-color-secondary);
}

.dl-batch-desc {
  font-size: 12px;
  color: var(--el-text-color-primary);
  font-weight: var(--app-font-weight-medium);
}

.dl-batch-track {
  flex: 1;
  height: 6px;
  background: var(--el-fill-color);
  border-radius: 3px;
  overflow: hidden;
}

.dl-batch-fill {
  height: 100%;
  background: var(--el-color-primary);
  border-radius: 3px;
  transition: width .4s ease;
}

.dl-batch-fill.complete { background: var(--el-color-success); }

/* 运行中：轻微闪光动画 */
.dl-batch-fill.running {
  background: linear-gradient(90deg,
    var(--el-color-primary) 0%,
    var(--el-color-primary-light-3) 50%,
    var(--el-color-primary) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% center; }
  100% { background-position: 0% center; }
}

.dl-batch-pct {
  font-size: 13px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-color-primary);
  min-width: 40px;
  text-align: right;
}

/* ── 任务列表 ─────────────────────────────────────── */
.dl-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-sm);
}

/* 空状态 */
.dl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: var(--app-spacing-sm);
  color: var(--el-text-color-secondary);
}

.dl-empty-icon { font-size: 40px; opacity: .4; }
.dl-empty-title { margin: 0; font-size: 15px; font-weight: var(--app-font-weight-medium); }
.dl-empty-hint { margin: 0; font-size: 12px; color: var(--el-text-color-placeholder); }

/* ── 任务卡片 ─────────────────────────────────────── */
.dl-card {
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--el-border-radius-large);
  padding: var(--app-spacing-md) var(--app-spacing-lg);
  background: var(--app-bg-card);
  box-shadow: var(--app-shadow-sm);
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-sm);
  transition: box-shadow .2s, border-color .2s;
}

.dl-card.active {
  border-color: var(--el-color-primary-light-5);
  box-shadow: var(--app-shadow-md);
}

/* 卡片头部 */
.dl-card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--app-spacing-md);
}

/* 状态指示器圆点 */
.dl-card-indicator {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  transition: background .2s;
}

.dl-card-indicator-icon { line-height: 1; }

.ind-active  { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.ind-success { background: #f0fdf4; color: var(--el-color-success); }
.ind-error   { background: #fef2f2; color: var(--el-color-danger); }
.ind-muted   { background: var(--el-fill-color-light); color: var(--el-text-color-secondary); }

html.dark .ind-success { background: #052e16; }
html.dark .ind-error   { background: #2d0a0a; }

/* 卡片信息区 */
.dl-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }

.dl-card-title {
  font-size: 14px;
  font-weight: var(--app-font-weight-medium);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dl-card-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dl-card-sep { opacity: .5; }
.dl-card-filename {
  color: var(--el-text-color-secondary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

/* 右侧徽章/百分比 */
.dl-card-right { flex-shrink: 0; }

.dl-card-pct {
  font-size: 16px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-color-primary);
  min-width: 44px;
  text-align: right;
}

.dl-card-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: var(--app-font-weight-medium);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.badge-success { background: #f0fdf4; color: var(--el-color-success); }
.badge-error   { background: #fef2f2; color: var(--el-color-danger); }
.badge-muted   { background: var(--el-fill-color-light); }

html.dark .badge-success { background: #052e16; }
html.dark .badge-error   { background: #2d0a0a; }

/* 进度条 */
.dl-progress-track {
  height: 4px;
  background: var(--el-fill-color);
  border-radius: 2px;
  overflow: hidden;
}

.dl-progress-fill {
  height: 100%;
  background: var(--el-color-primary);
  border-radius: 2px;
  transition: width .2s;
}

.dl-progress-fill.complete { background: var(--el-color-success); }

/* 不确定进度：扫描动画 */
.dl-progress-fill.indeterminate {
  width: 40% !important;
  animation: progress-scan 1.4s ease-in-out infinite;
}

@keyframes progress-scan {
  0%   { transform: translateX(-150%); }
  100% { transform: translateX(350%); }
}

/* 错误提示 */
.dl-card-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  background: var(--el-color-danger-light-9);
  border-radius: var(--el-border-radius-base);
  font-size: 12px;
  color: var(--el-color-danger);
}

.dl-card-error-icon { flex-shrink: 0; }

.dl-card-error-text {
  flex: 1;
  word-break: break-word;
  line-height: 1.5;
}

.dl-card-error-toggle {
  display: inline;
  margin-left: 4px;
  border: none;
  background: transparent;
  color: var(--el-color-danger);
  font-size: 11px;
  font-weight: var(--app-font-weight-semibold);
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  font-family: var(--el-font-family);
}

/* 操作按钮 */
.dl-card-actions {
  display: flex;
  gap: var(--app-spacing-sm);
}

.dl-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: all .12s;
}

.dl-card-btn:hover { background: var(--el-fill-color-light); }
.dl-card-btn.primary { color: var(--el-color-primary); border-color: var(--el-color-primary-light-5); }
.dl-card-btn.primary:hover { background: var(--el-color-primary-light-9); }

.dl-drag-handle {
  flex-shrink: 0;
  cursor: grab;
  color: var(--el-text-color-placeholder);
  font-size: 14px;
  padding: 0 4px 0 0;
  user-select: none;
  line-height: 1;
}
.dl-drag-handle:active { cursor: grabbing; }

.dl-pin-btn {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
  font-size: 11px;
  padding: 3px 8px;
}
.dl-pin-btn:hover { background: var(--el-color-primary-light-9); }

.dl-card.drag-over {
  outline: 2px dashed var(--el-color-primary-light-5);
  outline-offset: -2px;
  background: var(--el-color-primary-light-9);
}

/* 卡片列表动画 */
.card-list-enter-active,
.card-list-leave-active { transition: opacity .2s ease, transform .2s ease; }
.card-list-enter-from,
.card-list-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── 任务分组 ─────────────────────────────────────── */
.dl-group {
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-sm);
}

.dl-group-header {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  padding: 6px var(--app-spacing-sm);
  border: none;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  cursor: pointer;
  font-family: var(--el-font-family);
  text-align: left;
  width: 100%;
  transition: background .12s;
}

.dl-group-header:hover { background: var(--el-fill-color-light); }

.dl-group-icon {
  font-size: 12px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.dl-group-icon.success { background: #f0fdf4; color: var(--el-color-success); }
.dl-group-icon.danger  { background: #fef2f2; color: var(--el-color-danger); }

html.dark .dl-group-icon.success { background: #052e16; }
html.dark .dl-group-icon.danger  { background: #2d0a0a; }

.dl-group-title {
  font-size: 12px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex: 1;
}

.dl-group-count {
  font-size: 12px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 10px;
  padding: 1px 7px;
}

.dl-group-chevron {
  font-size: 16px;
  color: var(--el-text-color-secondary);
  transition: transform .2s;
  transform: rotate(90deg);
}

.dl-group-chevron.collapsed { transform: rotate(0deg); }

.dl-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-sm);
}

/* 速度独立行 */
.dl-card-speed-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.dl-card-speed {
  font-size: 13px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-color-primary);
}

.dl-card-eta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

/* 排队序号 */
.dl-queue-pos {
  color: var(--el-text-color-secondary);
  font-style: italic;
}

/* 进度条条纹动画（下载中） */
.dl-progress-fill.stripe {
  background-image: linear-gradient(
    45deg,
    rgba(255,255,255,.15) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255,255,255,.15) 50%,
    rgba(255,255,255,.15) 75%,
    transparent 75%
  );
  background-size: 20px 20px;
  animation: stripe-move 1s linear infinite;
}

@keyframes stripe-move {
  from { background-position: 0 0; }
  to   { background-position: 20px 0; }
}

/* 右键菜单 */
.dl-ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.dl-ctx-menu {
  position: fixed;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  box-shadow: var(--app-shadow-md);
  padding: 4px 0;
  min-width: 140px;
  z-index: 10000;
}

.dl-ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 14px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  white-space: nowrap;
}
.dl-ctx-item:hover { background: var(--el-fill-color-light); }
</style>
