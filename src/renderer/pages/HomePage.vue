<template>
  <div class="home-layout">
    <!-- left panel -->
    <div class="home-sidebar">

      <!-- program section -->
      <div class="sidebar-section program-section">
        <div class="section-header">
          <span class="section-title">我的内容</span>
          <div class="section-actions">
            <button class="icon-btn" title="从 JSON 导入栏目" @click="importPrograms">↓</button>
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
        <!-- content list: 单个视频集合（常驻）+ 栏目 -->
        <div class="program-list" :class="{ empty: !programs.length }">
          <!-- 单个视频：常驻特殊条目，选中即切到「单视频集合」 -->
          <div
            class="single-entry"
            :class="{ active: viewMode === 'single' }"
            @click="selectSingleMode()"
          >
            <span class="single-entry-icon">📌</span>
            <span class="single-entry-label">单个视频</span>
            <span class="single-entry-count">{{ singleVideos.length }}</span>
          </div>
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
                <span v-if="newContentMap.has(row.program.columnId)" class="program-new-dot"
                      :title="`${newContentMap.get(row.program.columnId)} 个新视频`" />
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
          <div v-if="viewMode === 'column'" class="month-row">
            <el-date-picker
              v-model="selectedMonth"
              type="month"
              placeholder="月份"
              size="small"
              format="YYYY年M月"
              value-format="YYYYMM"
              style="width: 118px"
            />
            <span v-if="emptyMonths.has(selectedMonth)" class="month-empty-dot" title="本月暂无视频" />
            <button class="month-quick-btn" title="上个月" @click="jumpMonth(-1)">‹</button>
            <button class="month-quick-btn" title="本月" @click="jumpMonth(0)">今</button>
            <button class="month-quick-btn" title="下个月" @click="jumpMonth(1)">›</button>
          </div>
          <div v-else class="single-mode-label">
            <span>📌 单个视频 · {{ singleVideos.length }}</span>
            <span class="single-mode-actions">
              <button class="icon-btn" title="从 JSON 导入单视频" @click="importSingleVideos">↓</button>
              <button class="icon-btn" title="导出单视频备份" :disabled="!singleVideos.length" @click="exportSingleVideos">↑</button>
            </span>
          </div>
          <div class="section-actions">
            <button
              class="icon-btn"
              title="全选 / 取消全选"
              :disabled="!filteredVideos.length"
              @click="toggleSelectAll"
            >{{ allSelected ? '☑' : '☐' }}</button>
            <button
              v-if="viewMode === 'column'"
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
        <div class="video-list" ref="videoListEl" @scroll="onVideoListScroll">
          <div v-if="viewMode === 'column' && !selectedProgram" class="video-hint">← 先选择一个栏目</div>
          <el-skeleton v-else-if="loadingVideos" :rows="6" animated class="video-skeleton" />
          <div v-else-if="!filteredVideos.length" class="video-hint">{{ emptyHint }}</div>
          <template v-else>
            <!-- 单视频集合：扁平列表 + 行内移除（> 100 条用虚拟滚动） -->
            <template v-if="viewMode === 'single'">
              <template v-if="filteredVideos.length > 100">
                <div :style="{ height: vPadTop + 'px' }" />
                <div
                  v-for="v in vVisibleItems"
                  :key="v.guid"
                  class="video-item"
                  :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                  @click="onVideoClick(v)"
                >
                  <el-checkbox v-model="v.selected" @click.stop size="small" />
                  <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                       @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                  <div class="video-item-info">
                    <span class="video-item-title" :title="v.title">{{ v.title }}</span>
                    <span v-if="v.time" class="video-item-date">{{ v.time }}</span>
                  </div>
                  <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
                  <button class="video-del-btn" title="从单个视频移除" @click.stop="removeSingleVideo(v)">🗑</button>
                </div>
                <div :style="{ height: vPadBot + 'px' }" />
              </template>
              <template v-else>
                <div
                  v-for="v in filteredVideos"
                  :key="v.guid"
                  class="video-item"
                  :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                  @click="onVideoClick(v)"
                >
                  <el-checkbox v-model="v.selected" @click.stop size="small" />
                  <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                       @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                  <div class="video-item-info">
                    <span class="video-item-title" :title="v.title">{{ v.title }}</span>
                    <span v-if="v.time" class="video-item-date">{{ v.time }}</span>
                  </div>
                  <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
                  <button class="video-del-btn" title="从单个视频移除" @click.stop="removeSingleVideo(v)">🗑</button>
                </div>
              </template>
            </template>
            <!-- 栏目·搜索：扁平高亮（> 100 条用虚拟滚动） -->
            <template v-else-if="debouncedSearch.trim()">
              <template v-if="filteredVideos.length > 100">
                <div :style="{ height: vPadTop + 'px' }" />
                <div
                  v-for="v in vVisibleItems"
                  :key="v.guid"
                  class="video-item"
                  :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                  @click="onVideoClick(v)"
                >
                  <el-checkbox v-model="v.selected" @click.stop size="small" />
                  <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                       @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                  <div class="video-item-info">
                    <span class="video-item-title" :title="v.title" v-html="highlightText(v.title, debouncedSearch)" />
                    <span v-if="v.time" class="video-item-date">{{ v.time }}</span>
                  </div>
                  <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
                </div>
                <div :style="{ height: vPadBot + 'px' }" />
              </template>
              <template v-else>
                <div
                  v-for="v in filteredVideos"
                  :key="v.guid"
                  class="video-item"
                  :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                  @click="onVideoClick(v)"
                >
                  <el-checkbox v-model="v.selected" @click.stop size="small" />
                  <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                       @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                  <div class="video-item-info">
                    <span class="video-item-title" :title="v.title" v-html="highlightText(v.title, debouncedSearch)" />
                    <span v-if="v.time" class="video-item-date">{{ v.time }}</span>
                  </div>
                  <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
                </div>
              </template>
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
                  <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                       @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                  <div class="video-item-info">
                    <span class="video-item-title" :title="v.title">{{ v.title }}</span>
                  </div>
                  <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
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
            <span v-if="selectedVideos.length" class="video-selected-count"> · 已选 {{ selectedVideos.length }}</span>
          </span>
          <button
            v-if="viewMode === 'column' && filteredVideos.length"
            class="footer-btn footer-btn-ghost"
            @click="downloadAll"
          >下载本月</button>
          <button
            v-if="viewMode === 'column'"
            class="footer-btn"
            :class="selectedVideos.length ? 'footer-btn-primary' : 'footer-btn-idle'"
            :disabled="!selectedVideos.length"
            @click="downloadSelected"
          >
            {{ allSelectedDownloaded ? '重新下载' : '下载选中' }}
            <span v-if="selectedVideos.length" class="footer-btn-count">{{ selectedVideos.length }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- right preview panel -->
    <div class="home-preview" :class="{ collapsed: previewCollapsed }">
      <button class="preview-toggle" :title="previewCollapsed ? '展开预览' : '折叠预览'" @click="previewCollapsed = !previewCollapsed">
        {{ previewCollapsed ? '›' : '‹' }}
      </button>
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
              <span v-if="viewMode === 'single'" class="preview-single-badge">📌 单个视频</span>
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
            <div class="preview-download-wrap">
              <button
                class="preview-download-btn"
                :class="{
                  downloaded: downloadedSet.has(selectedVideo.guid),
                  dimmed: selectedVideos.length > 0 && !downloadedSet.has(selectedVideo.guid)
                }"
                @click="downloadVideos([selectedVideo], viewMode === 'single')"
              >
                <span>⬇</span>
                {{ downloadedSet.has(selectedVideo.guid) ? '重新下载' : (viewMode === 'single' ? '下载此视频' : '下载此集') }}
              </button>
              <span v-if="selectedVideos.length > 0" class="preview-download-hint">
                已选 {{ selectedVideos.length }} 个，可在下方批量下载
              </span>
            </div>
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
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { Search } from '@element-plus/icons-vue'
import type { ProgramInfo, VideoInfo, DownloadJob } from '../../shared/types'
import { isProgramDeleteKey } from '../../shared/programs'
import { humanizeError } from '../../shared/errors'
import { buildOutputPath } from '../../shared/filename'
import { useContentStore } from '../stores/content'

const contentStore = useContentStore()
const {
  programs, singleVideos, videos, viewMode, selectedProgram, selectedVideo,
  selectedMonth, downloadedSet, newContentMap, emptyMonths,
  programQuery, searchQuery, debouncedSearch,
  filteredPrograms, displayRows,
  filteredVideos, allSelected, selectedVideos, downloadedCount, allSelectedDownloaded,
  emptyHint, groupedVideos
} = storeToRefs(contentStore)

const isFav = contentStore.isFav

const isMac = window.cctvdlApi.isMac

// Local-only UI state (not shared across components)
const importUrl = ref('')
const importing = ref(false)
const importSuccess = ref(false)

const IMPORT_PLACEHOLDERS = [
  '粘贴栏目 / 单视频链接…',
  '示例：https://tv.cctv.com/lm/xwlb/',
  '单视频也支持：直接粘贴影片链接',
  '支持栏目页 / 单视频页链接',
]

const importPlaceholder = ref(IMPORT_PLACEHOLDERS[0])
let placeholderTimer: ReturnType<typeof setInterval> | null = null
let placeholderIdx = 0
const loadingVideos = ref(false)
const coverError = ref(false)
const coverLoading = ref(false)
const lightboxOpen = ref(false)
const previewCollapsed = ref(false)

// ─── 虚拟滚动（> 100 条时启用）─────────────────────────────────────────────
const VITEM_H = 46  // approximate row height (px) — checkbox + thumb + text
const VBUFFER = 8   // extra rows above/below viewport
const videoListEl = ref<HTMLElement | null>(null)
const vScrollTop = ref(0)

const vVisibleItems = computed(() => {
  if (filteredVideos.value.length <= 100) return filteredVideos.value
  const containerH = videoListEl.value?.clientHeight ?? 400
  const start = Math.max(0, Math.floor(vScrollTop.value / VITEM_H) - VBUFFER)
  const end = Math.min(filteredVideos.value.length, start + Math.ceil(containerH / VITEM_H) + VBUFFER * 2)
  return filteredVideos.value.slice(start, end)
})

const vPadTop = computed(() => {
  if (filteredVideos.value.length <= 100) return 0
  const start = Math.max(0, Math.floor(vScrollTop.value / VITEM_H) - VBUFFER)
  return start * VITEM_H
})

const vPadBot = computed(() => {
  if (filteredVideos.value.length <= 100) return 0
  const containerH = videoListEl.value?.clientHeight ?? 400
  const start = Math.max(0, Math.floor(vScrollTop.value / VITEM_H) - VBUFFER)
  const end = Math.min(filteredVideos.value.length, start + Math.ceil(containerH / VITEM_H) + VBUFFER * 2)
  return Math.max(0, (filteredVideos.value.length - end) * VITEM_H)
})

function onVideoListScroll(e: Event) {
  vScrollTop.value = (e.target as HTMLElement).scrollTop
}

function resetVideoListScroll() {
  vScrollTop.value = 0
  if (videoListEl.value) videoListEl.value.scrollTop = 0
}

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

let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput(val: string) {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedSearch.value = val }, 200)
}

let cleanupSkipped: (() => void) | null = null
let cleanupClipboard: (() => void) | null = null
let cleanupNewContent: (() => void) | null = null
let lastClipboardUrl = ''
function onHistoryCleared() { contentStore.refreshDownloadedSet() }

// Clipboard auto-import (opt-in): the main process only sends a link while the
// user enabled the feature; here we confirm before importing, deduping repeats.
async function onClipboardLink(url: string) {
  if (url === lastClipboardUrl) return
  lastClipboardUrl = url
  try {
    await ElMessageBox.confirm(`检测到央视链接，是否导入？\n${url}`, '剪贴板导入', {
      confirmButtonText: '导入', cancelButtonText: '忽略', type: 'info'
    })
    importUrl.value = url
    await doImport(url)
  } catch { /* user ignored */ }
}

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
  singleVideos.value = await window.cctvdlApi.getSingleVideos()
  contentStore.refreshDownloadedSet()
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
  cleanupClipboard = window.cctvdlApi.onClipboardLink(onClipboardLink)
  cleanupNewContent = window.cctvdlApi.onNewContent(({ columnId, count }) => {
    contentStore.applyNewContent(columnId, count)
  })

  // 设置页清除历史后刷新已下载标记
  window.addEventListener('cctvdl:history-cleared', onHistoryCleared)
})

onUnmounted(() => {
  cleanupSkipped?.()
  cleanupClipboard?.()
  cleanupNewContent?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('cctvdl:history-cleared', onHistoryCleared)
  if (placeholderTimer) clearInterval(placeholderTimer)
  document.body.style.overflow = ''
})

async function exportPrograms() {
  try {
    const result = await window.cctvdlApi.exportPrograms()
    if (result) ElMessage.success(`已导出 ${programs.value.length} 个节目`)
  } catch (err) { ElMessage.error(`导出失败：${err}`) }
}

async function importPrograms() {
  try {
    const count = await window.cctvdlApi.importPrograms()
    if (count < 0) return // cancelled
    programs.value = await window.cctvdlApi.getPrograms()
    ElMessage.success(`已导入 ${count} 个栏目`)
  } catch (err) { ElMessage.error(`导入失败：${humanizeError(String(err))}`) }
}

async function exportSingleVideos() {
  try {
    const result = await window.cctvdlApi.exportSingleVideos()
    if (result) ElMessage.success(`已导出 ${singleVideos.value.length} 个单视频`)
  } catch (err) { ElMessage.error(`导出失败：${err}`) }
}

async function importSingleVideos() {
  try {
    const count = await window.cctvdlApi.importSingleVideos()
    if (count < 0) return // cancelled
    singleVideos.value = await window.cctvdlApi.getSingleVideos()
    videos.value = singleVideos.value.map(v => ({ ...v, selected: false }))
    resetVideoListScroll()
    ElMessage.success(`已导入 ${count} 个单视频`)
  } catch (err) { ElMessage.error(`导入失败：${humanizeError(String(err))}`) }
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
    let info: ProgramInfo
    try {
      info = await window.cctvdlApi.browseProgram(url)
    } catch (columnErr) {
      // Not a column page (e.g. a standalone movie with no column) — fall back to
      // resolving it as a single video and add it to the persisted collection.
      try {
        const video = await window.cctvdlApi.resolveSingleVideo(url)
        await addAndShowSingleVideo(video)
        return
      } catch {
        throw columnErr
      }
    }
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
        viewMode.value = 'column'
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

function onProgramClick(row: ProgramInfo) { viewMode.value = 'column'; selectedProgram.value = row; contentStore.clearEmptyMonths(); loadVideos() }

// ─── Single-video collection ────────────────────────────────────────────────
function selectSingleMode() {
  viewMode.value = 'single'
  selectedProgram.value = null
  selectedVideo.value = null
  searchQuery.value = ''
  debouncedSearch.value = ''
  contentStore.refreshDownloadedSet()
  videos.value = singleVideos.value.map(v => ({ ...v, selected: false }))
  resetVideoListScroll()
}

// Resolved on paste → persisted (dedup by guid) → switch to the collection and
// preview the new video. The download button then reuses the normal pipeline.
async function addAndShowSingleVideo(video: VideoInfo) {
  const added = await window.cctvdlApi.addSingleVideo(video)
  singleVideos.value = await window.cctvdlApi.getSingleVideos()
  importUrl.value = ''
  importSuccess.value = true
  setTimeout(() => { importSuccess.value = false }, 800)
  selectSingleMode()
  selectedVideo.value = video
  coverError.value = false
  coverLoading.value = true
  ElMessage.success(added ? `已识别单个视频：${video.title}` : `已在单个视频列表：${video.title}`)
}

async function removeSingleVideo(v: VideoInfo) {
  await window.cctvdlApi.deleteSingleVideo(v.guid)
  singleVideos.value = await window.cctvdlApi.getSingleVideos()
  videos.value = videos.value.filter(x => x.guid !== v.guid)
  if (selectedVideo.value?.guid === v.guid) selectedVideo.value = null
}

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
  contentStore.refreshDownloadedSet()
  try {
    const list = await window.cctvdlApi.listVideos(selectedProgram.value.columnId, selectedProgram.value.itemId, selectedMonth.value)
    videos.value = list.map(v => ({ ...v, selected: false }))
    searchQuery.value = ''
    debouncedSearch.value = ''
    selectedVideo.value = null
    resetVideoListScroll()
    contentStore.recordVideosLoaded(selectedMonth.value, list)
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

// Selected items: auto-open only for single videos (column partial selections don't).
async function downloadSelected() { await downloadVideos(selectedVideos.value, viewMode.value === 'single') }

// 下载本月（仅栏目）：先勾选当前列表的全部期数（复选框打勾），再整批下载；
// 这是「全量下载」意图，会触发自动打开文件夹。
async function downloadAll() {
  filteredVideos.value.forEach(v => { v.selected = true })
  await downloadVideos(filteredVideos.value, true)
}

async function downloadVideos(videoList: VideoInfo[], autoOpen = false) {
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
    await window.cctvdlApi.startDownload(jobs, autoOpen)
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
  width: 360px;
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sidebar-section.video-section {
  flex: 1.5;
  min-height: 0;
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
  flex: 1;
  min-height: 0;
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

.program-new-dot {
  flex-shrink: 0;
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-danger);
  margin-right: 2px;
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

/* 单个视频：常驻特殊条目 */
.single-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--app-border-subtle);
  transition: background .12s;
}
.single-entry:hover { background: var(--el-fill-color-light); }
.single-entry.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.single-entry-icon { font-size: 13px; flex-shrink: 0; }
.single-entry-label { flex: 1; min-width: 0; font-size: 13px; font-weight: var(--app-font-weight-medium); }
.single-entry-count {
  flex-shrink: 0;
  font-size: 11px;
  min-width: 18px;
  text-align: center;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.single-entry.active .single-entry-count { background: var(--el-color-primary-light-7); color: var(--el-color-primary); }

.single-mode-label {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  color: var(--el-text-color-secondary);
}

.single-mode-actions {
  display: flex;
  gap: 2px;
}

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

.video-skeleton {
  padding: 8px 4px;
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

/* 单视频集合：行内移除按钮（悬停显示） */
.video-del-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s, color .12s;
}
.video-item:hover .video-del-btn { opacity: 1; }
.video-del-btn:hover { color: var(--el-color-danger); }

.video-item.downloaded {
  border-left: 2px solid var(--el-color-success);
  padding-left: 6px;
  background: rgba(5, 150, 105, .04);
}

.video-item.downloaded .video-item-title {
  color: var(--el-text-color-secondary);
}

.v-dl-check {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--el-color-success);
  opacity: .6;
  pointer-events: none;
  margin-left: auto;
  margin-right: 2px;
}

.v-thumb {
  flex-shrink: 0;
  width: 40px;
  height: 30px;
  object-fit: cover;
  border-radius: 2px;
  background: var(--el-fill-color-light);
}

/* 视频底部工具栏 */
.video-footer {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  padding: var(--app-spacing-sm) 0 var(--app-spacing-md);
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
.video-selected-count   { color: var(--el-color-primary);  font-weight: var(--app-font-weight-medium); }

/* 底部操作按钮基础样式 */
.footer-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--el-border-radius-base);
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
  white-space: nowrap;
}

/* 幽灵/次要：下载本月 */
.footer-btn-ghost {
  border: 1px solid var(--el-border-color);
  background: transparent;
  color: var(--el-text-color-regular);
}
.footer-btn-ghost:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

/* 主操作：有选中时 */
.footer-btn-primary {
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}
.footer-btn-primary:hover { background: var(--el-color-primary-dark-2); border-color: var(--el-color-primary-dark-2); }

/* 空闲态：无选中时（视觉弱化但仍占位） */
.footer-btn-idle {
  border: 1px solid var(--el-border-color-light);
  background: transparent;
  color: var(--el-text-color-placeholder);
  cursor: not-allowed;
}

/* 选中数量角标 */
.footer-btn-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: rgba(255,255,255,.25);
  font-size: 11px;
  font-weight: var(--app-font-weight-bold);
  line-height: 1;
}
.footer-btn-idle .footer-btn-count { background: var(--el-fill-color); color: var(--el-text-color-placeholder); }

/* ── 右侧预览区 ─────────────────────────────────── */
.home-preview {
  flex: 1;
  overflow-y: auto;
  background: var(--el-bg-color);
  position: relative;
  min-width: 0;
  transition: flex .2s ease, min-width .2s ease;
}

.home-preview.collapsed {
  flex: 0 0 28px;
  overflow: hidden;
}

.preview-toggle {
  position: absolute;
  top: 8px;
  left: 4px;
  z-index: 2;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: .5;
  transition: opacity .15s;
}

.preview-toggle:hover { opacity: 1; background: var(--el-fill-color); }

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

/* 单个视频徽章 */
.preview-single-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary-light-5);
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

.preview-download-wrap {
  align-self: flex-start;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: 20px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: var(--app-font-weight-semibold);
  font-family: var(--el-font-family);
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(37, 99, 235, .3);
  transition: background .15s, box-shadow .15s, transform .15s, color .15s;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.preview-download-btn:hover {
  background: var(--el-color-primary-dark-2);
  box-shadow: 0 4px 16px rgba(37, 99, 235, .4);
  transform: translateY(-1px);
}

.preview-download-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 5px rgba(37, 99, 235, .3);
}

/* 弱化态：有批量选中时单集按钮降优先级 */
.preview-download-btn.dimmed {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
  box-shadow: none;
}
.preview-download-btn.dimmed:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: none;
  transform: none;
}

.preview-download-btn.downloaded {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  box-shadow: none;
}
.preview-download-btn.downloaded:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: none;
  transform: translateY(-1px);
}

.preview-download-hint {
  font-size: 11px;
  color: var(--el-color-primary);
  opacity: .8;
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

.month-empty-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-warning);
  opacity: .7;
  flex-shrink: 0;
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
