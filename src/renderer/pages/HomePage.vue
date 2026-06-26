<template>
  <div class="home-layout">
    <!-- left panel -->
    <div class="home-sidebar">

      <!-- program section -->
      <div class="sidebar-section program-section">
        <div class="section-header">
          <span class="section-title">我的栏目</span>
          <div class="section-actions">
            <button class="icon-btn" title="导出栏目" :disabled="!programs.length" @click="exportPrograms">↑</button>
            <button class="icon-btn" title="清空全部栏目" :disabled="!programs.length" @click="clearAllPrograms">🧹</button>
          </div>
        </div>
        <!-- import input -->
        <div class="import-row">
          <el-input
            v-model="importUrl"
            :placeholder="importPlaceholder"
            size="small"
            clearable
            @keyup.enter="handleImport"
          />
          <el-button size="small" type="primary" :loading="importing" :class="{ 'import-success': importSuccess }" @click="handleImport">导入</el-button>
        </div>
        <!-- program search -->
        <el-input
          v-if="programs.length > 3"
          v-model="programQuery"
          placeholder="搜索栏目…"
          size="small"
          clearable
          style="margin-bottom: 4px"
        />
        <!-- program list -->
        <div class="program-list" :class="{ empty: !programs.length }">
          <div v-if="!programs.length" class="program-empty-state">
            <div class="program-empty-steps">
              <div class="empty-step">
                <span class="empty-step-num">1</span>
                <span class="empty-step-text">粘贴央视节目链接</span>
              </div>
              <div class="empty-step-arrow">↓</div>
              <div class="empty-step">
                <span class="empty-step-num">2</span>
                <span class="empty-step-text">选择视频 → 下载</span>
              </div>
            </div>
          </div>
          <div v-else-if="filteredPrograms.length === 0" class="program-empty">
            <span style="font-size:12px; color: var(--el-text-color-placeholder)">无匹配栏目</span>
          </div>
          <TransitionGroup v-else name="prog-list" tag="div">
            <div v-for="row in displayRows" :key="row.key" class="program-row">
              <div v-if="row.type === 'header'" class="program-group-header">{{ row.label }}</div>
              <div
                v-else
                class="program-item"
                :class="{ active: selectedProgram?.columnId === row.program.columnId }"
                @click="onProgramClick(row.program)"
                @contextmenu.prevent="onProgramContext(row.program, $event)"
              >
                <span class="program-dot" />
                <span class="program-name" :title="row.program.name">{{ row.program.name }}</span>
                <span class="program-actions">
                  <button
                    class="prog-action-btn star"
                    :class="{ faved: isFav(row.program) }"
                    :title="isFav(row.program) ? '取消收藏' : '收藏'"
                    @click.stop="toggleFavorite(row.program)"
                  >⭐</button>
                  <button
                    class="prog-action-btn del"
                    title="删除栏目"
                    @click.stop="deleteProgram(row.program)"
                  >🗑</button>
                </span>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <!-- video section -->
      <div class="sidebar-section video-section">
        <div class="section-header">
          <div class="month-row">
            <el-date-picker
              v-model="selectedMonth"
              type="month"
              placeholder="月份"
              size="small"
              format="YYYY年M月"
              value-format="YYYYMM"
              style="width: 118px"
            />
            <button class="month-quick-btn" title="上个月" @click="jumpMonth(-1)">‹</button>
            <button class="month-quick-btn" title="本月" @click="jumpMonth(0)">今</button>
            <button class="month-quick-btn" title="下个月" @click="jumpMonth(1)">›</button>
          </div>
          <div class="section-actions">
            <button
              class="icon-btn"
              title="全选 / 取消全选"
              :disabled="!filteredVideos.length"
              @click="toggleSelectAll"
            >{{ allSelected ? '☑' : '☐' }}</button>
            <button
              class="icon-btn"
              title="刷新 (F5)"
              :disabled="!selectedProgram"
              :class="{ spinning: loadingVideos }"
              @click="loadVideos"
            >↻</button>
          </div>
        </div>
        <!-- search -->
        <el-input
          v-model="searchQuery"
          placeholder="搜索标题 / 日期…"
          size="small"
          clearable
          :prefix-icon="Search"
          class="video-search"
          @input="onSearchInput"
        />
        <!-- video items -->
        <div class="video-list">
          <div v-if="!selectedProgram" class="video-hint">← 先选择一个栏目</div>
          <div v-else-if="loadingVideos" class="video-hint">加载中…</div>
          <div v-else-if="!filteredVideos.length" class="video-hint">
            {{ videos.length ? '没有匹配的视频' : '该月份暂无视频' }}
          </div>
          <template v-else>
            <!-- flat list when searching, grouped by date otherwise -->
            <template v-if="debouncedSearch.trim()">
              <div
                v-for="v in filteredVideos"
                :key="v.guid"
                class="video-item"
                :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                @click="onVideoClick(v)"
              >
                <el-checkbox v-model="v.selected" @click.stop size="small" />
                <div class="video-item-info">
                  <span class="video-item-title" :title="v.title" v-html="highlightText(v.title, debouncedSearch)" />
                  <span v-if="v.time" class="video-item-date">{{ v.time }}</span>
                </div>
              </div>
            </template>
            <!-- grouped by date -->
            <template v-else>
              <template v-for="group in groupedVideos" :key="group.date">
                <div class="video-date-header">{{ group.date || '未知日期' }}</div>
                <div
                  v-for="v in group.items"
                  :key="v.guid"
                  class="video-item"
                  :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                  @click="onVideoClick(v)"
                >
                  <el-checkbox v-model="v.selected" @click.stop size="small" />
                  <div class="video-item-info">
                    <span class="video-item-title" :title="v.title">{{ v.title }}</span>
                  </div>
                </div>
              </template>
            </template>
          </template>
        </div>
        <!-- footer toolbar -->
        <div class="video-footer">
          <span class="video-count" v-if="videos.length">
            {{ filteredVideos.length }} 个{{ debouncedSearch ? '（过滤）' : '' }}
            <span v-if="downloadedCount" class="video-downloaded-count"> · ✓{{ downloadedCount }}</span>
            · 选中 {{ selectedVideos.length }}
          </span>
          <el-button
            :type="allSelectedDownloaded ? 'default' : 'primary'"
            size="small"
            :disabled="!selectedVideos.length"
            @click="downloadSelected"
          >
            {{ allSelectedDownloaded ? '重新下载' : '下载选中' }}{{ selectedVideos.length ? ` (${selectedVideos.length})` : '' }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- right preview panel -->
    <div class="home-preview">
      <Transition name="preview-fade" mode="out-in">
        <div v-if="selectedVideo" :key="selectedVideo.guid" class="preview-inner">
          <!-- cover image -->
          <div class="preview-cover-wrap">
            <!-- blurred background layer -->
            <div
              v-if="selectedVideo.coverUrl && !coverError"
              class="preview-cover-blur"
              :style="{ backgroundImage: `url(${selectedVideo.coverUrl})` }"
            />
            <div v-if="coverLoading && selectedVideo.coverUrl && !coverError" class="preview-skeleton" />
            <img
              v-if="selectedVideo.coverUrl && !coverError"
              :src="selectedVideo.coverUrl"
              loading="lazy"
              referrerpolicy="no-referrer"
              class="preview-cover"
              :class="{ loaded: !coverLoading, clickable: true }"
              @load="coverLoading = false"
              @error="coverError = true; coverLoading = false"
              @click="openLightbox"
              title="点击查看大图"
            />
            <div v-else class="preview-cover preview-cover--empty">
              <span>📺</span>
              <span>暂无封面</span>
            </div>
            <!-- bottom gradient overlay -->
            <div class="preview-cover-gradient" />
          </div>
          <!-- content -->
          <div class="preview-content">
            <div class="preview-action-bar">
              <button class="preview-action-btn" title="复制标题" @click="copyTitle">
                📋 复制标题
              </button>
              <button class="preview-action-btn" title="复制节目简介" @click="copyBrief">
                📄 复制简介
              </button>
            </div>
            <h2 class="preview-title">{{ selectedVideo.title }}</h2>
            <div class="preview-meta">
              <span v-if="selectedVideo.time" class="preview-date">🗓 {{ selectedVideo.time }}</span>
              <span
                v-if="downloadedSet.has(selectedVideo.guid)"
                class="preview-downloaded-badge"
              >✓ 已下载</span>
            </div>
            <div v-if="selectedVideo.brief" class="preview-brief-wrap">
              <div class="preview-section-label">节目简介</div>
              <p class="preview-brief">{{ selectedVideo.brief }}</p>
            </div>
            <!-- download button -->
            <button
              class="preview-download-btn"
              :class="{ downloaded: downloadedSet.has(selectedVideo.guid) }"
              @click="downloadVideos([selectedVideo])"
            >
              <span>⬇</span>
              {{ downloadedSet.has(selectedVideo.guid) ? '重新下载' : '下载此集' }}
            </button>
          </div>
        </div>
        <div v-else class="preview-empty" key="empty">
          <div class="preview-guide">
            <div class="preview-guide-icon">📺</div>
            <h3 class="preview-guide-title">开始下载央视视频</h3>
            <p class="preview-guide-desc">按以下步骤快速开始：</p>
            <div class="preview-guide-steps">
              <div class="guide-step">
                <span class="guide-step-num">1</span>
                <div class="guide-step-content">
                  <strong>导入节目</strong>
                  <span>将央视节目页面链接粘贴到左侧输入框，按回车</span>
                </div>
              </div>
              <div class="guide-step">
                <span class="guide-step-num">2</span>
                <div class="guide-step-content">
                  <strong>选择视频</strong>
                  <span>点击左侧栏目，选择要下载的期数</span>
                </div>
              </div>
              <div class="guide-step">
                <span class="guide-step-num">3</span>
                <div class="guide-step-content">
                  <strong>下载</strong>
                  <span>勾选视频后点击「下载选中」，或单集点击「下载此集」</span>
                </div>
              </div>
            </div>
            <p class="preview-guide-tip">💡 也可以将链接直接拖入窗口快速导入</p>
          </div>
        </div>
      </Transition>
    </div>
    <!-- lightbox -->
    <Transition name="lightbox-fade">
      <div v-if="lightboxOpen" class="lightbox" @click="closeLightbox">
        <button class="lightbox-close" @click="closeLightbox">✕</button>
        <img
          :src="selectedVideo?.coverUrl"
          class="lightbox-img"
          @click.stop
          referrerpolicy="no-referrer"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import type { ProgramInfo, VideoInfo, DownloadJob } from '../../shared/types'
import { filterVideos } from '../../shared/video-filter'
import { sortPrograms, isProgramDeleteKey } from '../../shared/programs'
import { humanizeError } from '../../shared/errors'
import { buildOutputPath } from '../../shared/filename'

const isMac = window.cctvdlApi.isMac

const programs = ref<ProgramInfo[]>([])
const programQuery = ref('')

const isFav = (p: ProgramInfo): boolean => p.favoritedAt != null

// Favorites first (most-recently-favorited on top), then import order; then the
// optional name filter on top of that order.
const sortedPrograms = computed(() => sortPrograms(programs.value))
const filteredPrograms = computed(() => {
  const q = programQuery.value.trim().toLowerCase()
  if (!q) return sortedPrograms.value
  return sortedPrograms.value.filter(p => p.name.toLowerCase().includes(q))
})

// Flatten into a render list of group headers + items. When searching we drop the
// headers (flat results); otherwise we show 收藏 / 全部 groups, but only once
// something is actually favorited (avoids extra chrome on a fresh list).
type ProgramRow =
  | { type: 'header'; label: string; key: string; program?: undefined }
  | { type: 'item'; label?: undefined; key: string; program: ProgramInfo }
const displayRows = computed<ProgramRow[]>(() => {
  const list = filteredPrograms.value
  if (programQuery.value.trim()) {
    return list.map(p => ({ type: 'item', program: p, key: p.columnId }))
  }
  const favs = list.filter(isFav)
  const others = list.filter(p => !isFav(p))
  if (!favs.length) {
    return others.map(p => ({ type: 'item', program: p, key: p.columnId }))
  }
  const rows: ProgramRow[] = [{ type: 'header', label: '⭐ 收藏', key: '__hdr_fav' }]
  for (const p of favs) rows.push({ type: 'item', program: p, key: p.columnId })
  rows.push({ type: 'header', label: '全部栏目', key: '__hdr_all' })
  for (const p of others) rows.push({ type: 'item', program: p, key: p.columnId })
  return rows
})
const videos = ref<(VideoInfo & { selected?: boolean })[]>([])
const selectedProgram = ref<ProgramInfo | null>(null)
const selectedVideo = ref<VideoInfo | null>(null)
const selectedMonth = ref('')
const importUrl = ref('')
const importing = ref(false)
const importSuccess = ref(false)

const IMPORT_PLACEHOLDERS = [
  '粘贴节目链接导入…',
  '示例：https://tv.cctv.com/lm/xwlb/',
  '示例：https://tv.cctv.com/lm/sjzs/',
  '支持栏目页 / 具体视频页链接',
]

const importPlaceholder = ref(IMPORT_PLACEHOLDERS[0])
let placeholderTimer: ReturnType<typeof setInterval> | null = null
let placeholderIdx = 0
const loadingVideos = ref(false)
const coverError = ref(false)
const coverLoading = ref(false)
const lightboxOpen = ref(false)

function openLightbox() {
  if (selectedVideo.value?.coverUrl && !coverError.value) {
    lightboxOpen.value = true
    document.body.style.overflow = 'hidden'
  }
}
function closeLightbox() {
  lightboxOpen.value = false
  document.body.style.overflow = ''
}
const searchQuery = ref('')
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput(val: string) {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedSearch.value = val }, 200)
}
const downloadedSet = ref<Set<string>>(new Set())

const filteredVideos = computed(() => filterVideos(videos.value, debouncedSearch.value))
const allSelected = computed(() => filteredVideos.value.length > 0 && filteredVideos.value.every(v => v.selected))
const selectedVideos = computed(() => videos.value.filter(v => v.selected))
const downloadedCount = computed(() => videos.value.filter(v => downloadedSet.value.has(v.guid)).length)
const allSelectedDownloaded = computed(() =>
  selectedVideos.value.length > 0 && selectedVideos.value.every(v => downloadedSet.value.has(v.guid))
)

const groupedVideos = computed(() => {
  const groups: Array<{ date: string; items: typeof filteredVideos.value }> = []
  for (const v of filteredVideos.value) {
    const date = v.time || ''
    const last = groups[groups.length - 1]
    if (last && last.date === date) {
      last.items.push(v)
    } else {
      groups.push({ date, items: [v] })
    }
  }
  return groups
})

async function refreshDownloadedSet() {
  try {
    const history = await window.cctvdlApi.getDownloadHistory()
    downloadedSet.value = new Set(history)
  } catch { /* best-effort */ }
}

let cleanupSkipped: (() => void) | null = null

// True when focus is in a text-entry field, so global shortcuts don't hijack
// typing (e.g. forward-delete while editing the search box must not delete a
// program). Excludes non-text inputs like the video checkboxes, so Ctrl+A still
// works after toggling a selection.
function isEditingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit'
  }
  return false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && lightboxOpen.value) { e.preventDefault(); closeLightbox(); return }
  if (isEditingTarget()) return
  if (e.key === 'F5') { e.preventDefault(); if (selectedProgram.value) loadVideos(); return }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); if (videos.value.length > 0) toggleSelectAll(); return }
  if (isProgramDeleteKey(e.key, isMac) && selectedProgram.value) { e.preventDefault(); deleteProgram(selectedProgram.value) }
}

onMounted(async () => {
  programs.value = await window.cctvdlApi.getPrograms()
  refreshDownloadedSet()
  const now = new Date()
  selectedMonth.value = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  window.addEventListener('keydown', onKeydown)

  // Rotate import placeholder
  placeholderTimer = setInterval(() => {
    placeholderIdx = (placeholderIdx + 1) % IMPORT_PLACEHOLDERS.length
    importPlaceholder.value = IMPORT_PLACEHOLDERS[placeholderIdx]
  }, 3000)
  cleanupSkipped = window.cctvdlApi.onDownloadSkipped((info) => {
    ElMessage.info(`跳过：${info.title}（${info.reason}）`)
  })

  // 设置页清除历史后刷新已下载标记
  window.addEventListener('cctvdl:history-cleared', refreshDownloadedSet)
})

onUnmounted(() => {
  cleanupSkipped?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('cctvdl:history-cleared', refreshDownloadedSet)
  if (placeholderTimer) clearInterval(placeholderTimer)
  document.body.style.overflow = ''
})

async function exportPrograms() {
  try {
    const result = await window.cctvdlApi.exportPrograms()
    if (result) ElMessage.success(`已导出 ${programs.value.length} 个节目`)
  } catch (err) { ElMessage.error(`导出失败：${err}`) }
}

async function handleImport() {
  const url = importUrl.value.trim()
  if (!url) { ElMessage.warning('请输入节目链接'); return }
  await doImport(url)
}

function handleDropImport(url: string) { importUrl.value = url; doImport(url) }

async function doImport(url: string) {
  importing.value = true
  try {
    const info = await window.cctvdlApi.browseProgram(url)
    const success = await window.cctvdlApi.importProgram(info)
    if (success) {
      programs.value = await window.cctvdlApi.getPrograms()
      ElMessage.success(`导入成功：${info.name}`)
      importUrl.value = ''
      importSuccess.value = true
      setTimeout(() => { importSuccess.value = false }, 800)
      // 自动选中并加载该栏目
      const newProgram = programs.value.find(p => p.columnId === info.columnId)
      if (newProgram) {
        selectedProgram.value = newProgram
        loadVideos()
      }
    } else {
      ElMessage.info('该节目已存在')
    }
  } catch (err) { ElMessage.error(`导入失败：${humanizeError(String(err))}`) }
  finally { importing.value = false }
}

defineExpose({ handleDropImport })

function onProgramClick(row: ProgramInfo) { selectedProgram.value = row; loadVideos() }

async function deleteProgram(row: ProgramInfo) {
  try {
    await ElMessageBox.confirm(`确定删除节目「${row.name}」吗？`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
    })
    await window.cctvdlApi.deleteProgram(row.columnId)
    programs.value = await window.cctvdlApi.getPrograms()
    if (selectedProgram.value?.columnId === row.columnId) { selectedProgram.value = null; videos.value = [] }
    ElMessage.success('已删除')
  } catch { /* cancelled */ }
}

function onProgramContext(row: ProgramInfo, _event: MouseEvent) { deleteProgram(row) }

// Optimistic toggle: update the local flag (the list re-sorts reactively and the
// row animates to/from the 收藏 group), then persist. Re-sync from store on error.
async function toggleFavorite(row: ProgramInfo) {
  const favorite = !isFav(row)
  if (favorite) row.favoritedAt = Date.now()
  else delete row.favoritedAt
  try {
    await window.cctvdlApi.setProgramFavorite(row.columnId, favorite)
  } catch (err) {
    programs.value = await window.cctvdlApi.getPrograms()
    ElMessage.error(`操作失败：${err}`)
  }
}

async function clearAllPrograms() {
  if (!programs.value.length) return
  try {
    await ElMessageBox.confirm(`确定清空全部 ${programs.value.length} 个栏目吗？`, '确认清空', {
      confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning'
    })
    await window.cctvdlApi.clearPrograms()
    programs.value = []
    selectedProgram.value = null
    videos.value = []
    ElMessage.success('已清空')
  } catch { /* cancelled */ }
}

async function loadVideos() {
  if (!selectedProgram.value) return
  loadingVideos.value = true
  refreshDownloadedSet()
  try {
    const list = await window.cctvdlApi.listVideos(selectedProgram.value.columnId, selectedProgram.value.itemId, selectedMonth.value)
    videos.value = list.map(v => ({ ...v, selected: false }))
    searchQuery.value = ''
    debouncedSearch.value = ''
    selectedVideo.value = null
    if (list.length === 0) ElMessage.info('该月份暂无视频')
  } catch (err) { ElMessage.error(`加载失败：${humanizeError(String(err))}`) }
  finally { loadingVideos.value = false }
}

function onVideoClick(row: VideoInfo & { selected?: boolean }) {
  selectedVideo.value = row
  coverError.value = false
  coverLoading.value = true
}

function toggleSelectAll() { const s = !allSelected.value; filteredVideos.value.forEach(v => v.selected = s) }

function jumpMonth(offset: number) {
  let target: Date
  if (offset === 0) {
    target = new Date()
  } else {
    const cur = selectedMonth.value || `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`
    target = new Date(Number(cur.slice(0, 4)), Number(cur.slice(4, 6)) - 1 + offset)
  }
  selectedMonth.value = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, '0')}`
  if (selectedProgram.value) loadVideos()
}

function highlightText(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text)
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escapeHtml(text).replace(
    new RegExp(escapeHtml(escaped), 'gi'),
    m => `<mark class="hl">${m}</mark>`
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function copyTitle() {
  if (!selectedVideo.value) return
  await navigator.clipboard.writeText(selectedVideo.value.title)
  ElMessage.success('标题已复制')
}

async function copyBrief() {
  if (!selectedVideo.value) return
  const text = selectedVideo.value.brief || selectedVideo.value.title
  await navigator.clipboard.writeText(text)
  ElMessage.success('简介已复制')
}

async function downloadSelected() { await downloadVideos(selectedVideos.value) }

async function downloadVideos(videoList: VideoInfo[]) {
  if (!videoList.length) return
  const validVideos = videoList.filter(v => v.guid)
  if (!validVideos.length) { ElMessage.warning('选中的视频缺少 GUID'); return }
  try {
    const settings = await window.cctvdlApi.getSettings()
    const jobs: DownloadJob[] = validVideos.map(v => {
      return {
        id: crypto.randomUUID(), guid: v.guid, sourceUrl: v.guid, title: v.title,
        savePath: buildOutputPath(settings.savePath, v.title),
        quality: settings.quality, threadCount: settings.threadCount,
        reencode: settings.reencode ?? false,
        state: 'Created' as const, stage: 'None' as const, progressPercent: 0
      }
    })
    await window.cctvdlApi.startDownload(jobs)
    ElMessage.success(`已添加 ${jobs.length} 个下载任务`)
  } catch (err) { ElMessage.error(`下载失败：${humanizeError(String(err))}`) }
}
</script>

<style scoped>
/* ── 整体布局 ───────────────────────────────────── */
.home-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* ── 左侧面板 ───────────────────────────────────── */
.home-sidebar {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--app-border-subtle);
  background: var(--app-bg-sidebar);
  overflow: hidden;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  padding: var(--app-spacing-md);
  gap: var(--app-spacing-sm);
}

/* 栏目区：略深背景，与视频区形成层次 */
.sidebar-section.program-section {
  background: var(--el-fill-color-blank);
  border-bottom: 2px solid var(--app-border-subtle);
}

.sidebar-section.video-section {
  flex: 1;
  overflow: hidden;
  padding-bottom: 0;
  background: var(--app-bg-sidebar);
}

/* 区域标题行 */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-spacing-sm);
  min-height: 28px;
}

.section-title {
  font-size: 11px;
  font-weight: var(--app-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--el-text-color-secondary);
}

.section-actions { display: flex; gap: 2px; }

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background .12s, color .12s;
}
.icon-btn:hover { background: var(--el-fill-color); color: var(--el-text-color-primary); }
.icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.icon-btn.spinning { animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 导入行 */
.import-row {
  display: flex;
  gap: var(--app-spacing-sm);
}

/* 栏目列表 */
.program-list {
  max-height: 180px;
  overflow-y: auto;
  border-radius: var(--el-border-radius-base);
}

.program-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

.program-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background .12s;
  user-select: none;
}

.program-item:hover { background: var(--el-fill-color-light); }
.program-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.program-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-border-color);
  flex-shrink: 0;
}
.program-item.active .program-dot { background: var(--el-color-primary); }

.program-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 收藏 / 全部 分组头（复用视频列表日期头的视觉语言） */
.program-group-header {
  padding: 6px 8px 3px;
  font-size: 11px;
  font-weight: var(--app-font-weight-semibold);
  letter-spacing: 0.3px;
  color: var(--el-text-color-secondary);
  user-select: none;
}

/* 行内悬停操作：固定占位避免名字截断点抖动；收藏星标常驻显示 */
.program-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.prog-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s, background .12s, color .12s;
}

.program-item:hover .prog-action-btn { opacity: 1; }
/* 未收藏：悬停时暗显（点亮即收藏）；已收藏：⭐ 常驻显示 */
.program-item:hover .prog-action-btn.star:not(.faved) { opacity: 0.4; }
.prog-action-btn.star.faved { opacity: 1; }
.prog-action-btn:hover { background: var(--el-fill-color); }
.prog-action-btn.del:hover { color: var(--el-color-danger); }

/* 视频搜索 */
.video-search { margin-bottom: 0; }

/* 视频列表 */
.video-list {
  flex: 1;
  overflow-y: auto;
  margin: var(--app-spacing-sm) calc(-1 * var(--app-spacing-md));
  padding: 0 var(--app-spacing-md);
}

.video-hint {
  padding: 20px 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

.video-date-header {
  padding: 6px 8px 3px;
  font-size: 11px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-text-color-secondary);
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--app-border-subtle);
  margin-bottom: 2px;
  user-select: none;
  /* Sticky: sticks to top of .video-list container */
  position: sticky;
  top: 0;
  background: var(--app-bg-sidebar);
  z-index: 1;
}

.video-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background .12s;
}

.video-item:hover { background: var(--el-fill-color-light); }
.video-item.active { background: var(--el-color-primary-light-9); }

.video-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.video-item-title {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary);
}

.video-item-date {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.video-item.downloaded {
  border-left: 2px solid var(--el-color-success);
  padding-left: 6px;
  background: rgba(5, 150, 105, .04);
}

.video-item.downloaded .video-item-title {
  color: var(--el-text-color-secondary);
}

/* 视频底部工具栏 */
.video-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--app-spacing-sm) 0 var(--app-spacing-md);
  gap: var(--app-spacing-sm);
  border-top: 1px solid var(--app-border-subtle);
  margin-top: var(--app-spacing-sm);
}

.video-count {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-downloaded-count { color: var(--el-color-success); font-weight: var(--app-font-weight-medium); }

/* ── 右侧预览区 ─────────────────────────────────── */
.home-preview {
  flex: 1;
  overflow-y: auto;
  background: var(--el-bg-color);
  position: relative;
}

.preview-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 封面 */
.preview-cover-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--el-fill-color-light);
  position: relative;
}

/* 模糊背景层 */
.preview-cover-blur {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(20px) saturate(1.2) brightness(0.7);
  transform: scale(1.1);
  z-index: 0;
}

/* 底部渐变过渡 */
.preview-cover-gradient {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(to bottom, transparent, var(--el-bg-color));
  z-index: 4;
  pointer-events: none;
}

/* 封面骨架屏 */
.preview-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    var(--el-fill-color-light) 25%,
    var(--el-fill-color) 50%,
    var(--el-fill-color-light) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  z-index: 2;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% center; }
  100% { background-position: 0% center; }
}

.preview-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity .3s ease;
  position: relative;
  z-index: 3;
}

.preview-cover.loaded { opacity: 1; }

.preview-cover--empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.preview-cover--empty span:first-child { font-size: 32px; }

/* 内容区 */
.preview-content {
  padding: var(--app-spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-md);
  flex: 1;
}

.preview-title {
  margin: 0;
  font-size: 18px;
  font-weight: var(--app-font-weight-bold);
  line-height: 1.4;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-md);
  flex-wrap: wrap;
}

.preview-date {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.preview-brief-wrap { display: flex; flex-direction: column; gap: 6px; }

.preview-section-label {
  font-size: 11px;
  font-weight: var(--app-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--el-text-color-secondary);
}

.preview-brief {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  white-space: pre-line;
  word-break: break-word;
}

/* 预览操作栏 */
.preview-action-bar {
  display: flex;
  gap: var(--app-spacing-sm);
  flex-wrap: wrap;
}

.preview-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: all .12s;
}

.preview-action-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  border-color: var(--el-border-color-darker);
}

/* 已下载徽章 */
.preview-downloaded-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  background: #f0fdf4;
  color: var(--el-color-success);
  border: 1px solid var(--el-color-success-light-5);
}

html.dark .preview-downloaded-badge {
  background: #052e16;
  border-color: #166534;
}

.preview-download-btn {
  align-self: flex-start;
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border: none;
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: var(--app-font-weight-semibold);
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: background .12s;
}

.preview-download-btn:hover { background: var(--el-color-primary-dark-2); }

.preview-download-btn.downloaded {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.preview-download-btn.downloaded:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

/* 预览空状态 / 引导 */
.preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--app-spacing-xl);
}

.preview-guide {
  max-width: 380px;
  text-align: left;
}

.preview-guide-icon {
  font-size: 40px;
  margin-bottom: var(--app-spacing-md);
  line-height: 1;
}

.preview-guide-title {
  margin: 0 0 var(--app-spacing-sm);
  font-size: 18px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-text-color-primary);
}

.preview-guide-desc {
  margin: 0 0 var(--app-spacing-md);
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.preview-guide-steps {
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-md);
  margin-bottom: var(--app-spacing-lg);
}

.guide-step {
  display: flex;
  align-items: flex-start;
  gap: var(--app-spacing-md);
}

.guide-step-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: var(--app-font-weight-bold);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.guide-step-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.guide-step-content strong {
  font-size: 14px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-text-color-primary);
}

.guide-step-content span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.preview-guide-tip {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: var(--app-spacing-sm) var(--app-spacing-md);
  background: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);
}

/* 导入成功按钮闪光 */
:deep(.import-success) {
  animation: import-flash .6s ease;
}

@keyframes import-flash {
  0%   { background: var(--el-color-primary); }
  40%  { background: var(--el-color-success); }
  100% { background: var(--el-color-primary); }
}
.program-empty-state {
  padding: var(--app-spacing-md) var(--app-spacing-sm);
}

.program-empty-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-step {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
}

.empty-step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11px;
  font-weight: var(--app-font-weight-bold);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.empty-step-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.empty-step-arrow {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding-left: 6px;
}

/* 封面可点击提示 */
.preview-cover.clickable { cursor: zoom-in; }

/* 光箱 */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, .85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}

.lightbox-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0,0,0,.5);
  cursor: default;
}

.lightbox-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255,255,255,.15);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s;
}

.lightbox-close:hover { background: rgba(255,255,255,.25); }

.lightbox-fade-enter-active,
.lightbox-fade-leave-active { transition: opacity .2s ease; }
.lightbox-fade-enter-from,
.lightbox-fade-leave-to { opacity: 0; }
.month-row {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
}

.month-quick-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all .12s;
  flex-shrink: 0;
}

.month-quick-btn:hover {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

/* 关键词高亮 */
:deep(.hl) {
  background: var(--el-color-warning-light-7);
  color: var(--el-color-warning-dark-2);
  border-radius: 2px;
  padding: 0 1px;
  font-style: normal;
}

html.dark :deep(.hl) {
  background: rgba(234, 179, 8, .25);
  color: #fbbf24;
}

/* 预览过渡动画 */
.preview-fade-enter-active,
.preview-fade-leave-active { transition: opacity .2s ease; }
.preview-fade-enter-from,
.preview-fade-leave-to { opacity: 0; }

/* 栏目列表入场 + 收藏重排时的平滑移动动画 */
.prog-list-enter-active { transition: opacity .15s ease, transform .15s ease; }
.prog-list-enter-from { opacity: 0; transform: translateX(-6px); }
.prog-list-move { transition: transform .25s ease; }
</style>
