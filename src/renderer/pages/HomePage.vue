<template>
  <div class="home-layout">
    <!-- left panel -->
    <div class="home-sidebar">

      <!-- program section -->
      <div class="sidebar-section program-section">
        <div class="section-header">
          <span class="section-title">我的内容</span>
          <div class="section-actions">
            <button class="icon-btn" title="从 JSON 导入节目" @click="importPrograms"><el-icon><Upload /></el-icon></button>
            <button class="icon-btn" title="导出节目" :disabled="!programs.length" @click="exportPrograms"><el-icon><Download /></el-icon></button>
            <button class="icon-btn" title="清空全部节目" :disabled="!programs.length" @click="clearAllPrograms"><el-icon><Delete /></el-icon></button>
          </div>
        </div>
        <!-- import input -->
        <div class="import-row">
          <el-input
            v-model="importUrl"
            :placeholder="importPlaceholder"
            size="small"
            class="import-input"
            clearable
            @keyup.enter="handleImport"
          />
          <el-button size="small" type="primary" :loading="importing" class="import-btn" :class="{ 'import-success': importSuccess }" @click="handleImport">导入</el-button>
        </div>
        <!-- program search -->
        <el-input
          v-if="programs.length > 3"
          v-model="programQuery"
          placeholder="搜索节目…"
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
            <span class="single-entry-icon" aria-hidden="true">📌</span>
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
            <span style="font-size:12px; color: var(--el-text-color-placeholder)">无匹配节目</span>
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
                  ><el-icon><StarFilled v-if="isFav(row.program)" /><Star v-else /></el-icon></button>
                  <button
                    class="prog-action-btn del"
                    :title="`删除${programKindLabel(row.program)}`"
                    @click.stop="deleteProgram(row.program)"
                  ><el-icon><Delete /></el-icon></button>
                </span>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <!-- video section -->
      <div class="sidebar-section video-section">
        <div class="section-header">
          <div v-if="viewMode === 'column' && !selectedIsAlbum" class="month-row">
            <el-date-picker
              v-model="selectedMonth"
              type="month"
              placeholder="月份"
              size="small"
              format="YYYY年M月"
              value-format="YYYYMM"
              style="width: 118px"
              @change="selectedProgram && loadVideos()"
            />
            <span v-if="emptyMonths.has(selectedMonth)" class="month-empty-dot" title="本月暂无视频" />
            <button
              type="button"
              class="month-quick-btn boundary earliest-month-btn"
              title="最早节目月份"
              aria-label="最早节目月份"
              :disabled="monthBoundsLoading || !programMonthBounds?.earliest"
              @click.prevent.stop="jumpToContentBoundary('earliest')"
            >⏮</button>
            <button class="month-quick-btn" title="上个月" @click="jumpMonth(-1)">‹</button>
            <button class="month-quick-btn today" title="跳回本月" @click="jumpMonth(0)">本月</button>
            <button class="month-quick-btn" title="下个月" @click="jumpMonth(1)">›</button>
            <button
              type="button"
              class="month-quick-btn boundary latest-month-btn"
              title="最新节目月份"
              aria-label="最新节目月份"
              :disabled="monthBoundsLoading || !programMonthBounds?.latest"
              @click.prevent.stop="jumpToContentBoundary('latest')"
            >⏭</button>
          </div>
          <div v-else-if="viewMode === 'single'" class="single-mode-label">
            <span class="single-mode-caption"><span aria-hidden="true">📌</span>单个视频 · {{ singleVideos.length }}</span>
            <span class="single-mode-actions">
              <button class="icon-btn" title="从 JSON 导入单视频" @click="importSingleVideos"><el-icon><Upload /></el-icon></button>
              <button class="icon-btn" title="导出单视频备份" :disabled="!singleVideos.length" @click="exportSingleVideos"><el-icon><Download /></el-icon></button>
            </span>
          </div>
          <div v-else class="single-mode-label">
            <span>选集 · {{ loadingVideos ? `正在加载 ${albumLoadedCount} 集` : videos.length }}</span>
            <el-select
              v-model="albumSort"
              size="small"
              class="album-sort-select"
              popper-class="album-sort-popper"
              @change="sortDisplayedAlbum"
            >
              <el-option label="从早到晚" value="asc" />
              <el-option label="从晚到早" value="desc" />
            </el-select>
          </div>
          <div class="section-actions">
            <el-checkbox
              class="select-current-list"
              :model-value="allSelected"
              :indeterminate="someFilteredSelected && !allSelected"
              :title="debouncedSearch ? '全选或取消全选当前搜索结果' : '全选或取消全选当前列表'"
              :aria-label="debouncedSearch ? '全选或取消全选当前搜索结果' : '全选或取消全选当前列表'"
              :disabled="loadingVideos || videoLoadFailed || !filteredVideos.length"
              @change="contentStore.toggleSelectAllFiltered(!allSelected)"
            />
            <button
              v-if="viewMode === 'column'"
              class="icon-btn"
              title="刷新 (F5)"
              :disabled="!selectedProgram"
              :class="{ spinning: loadingVideos }"
              @click="loadVideos(true)"
            ><el-icon><RefreshRight /></el-icon></button>
          </div>
        </div>
        <!-- search -->
        <el-input
          v-model="searchQuery"
          placeholder="搜索标题 / 简介 / 日期…"
          size="small"
          clearable
          :prefix-icon="Search"
          class="video-search"
          @input="onSearchInput"
        />
        <!-- video items -->
        <div class="video-list" ref="videoListEl" @scroll="onVideoListScroll">
          <div v-if="viewMode === 'column' && !selectedProgram" class="video-hint">← 先选择一个节目</div>
          <el-skeleton v-else-if="loadingVideos" :rows="6" animated class="video-skeleton" />
          <div v-else-if="videoLoadFailed" class="video-hint video-load-error">
            <span>视频列表加载失败</span>
            <el-button size="small" plain type="primary" :icon="RefreshRight" @click="loadVideos(true)">重试</el-button>
          </div>
          <div v-else-if="!filteredVideos.length" class="video-hint">{{ emptyHint }}</div>
          <template v-else>
            <!-- Flat single-video/search lists share the same virtual window. -->
            <template v-if="viewMode === 'single' || debouncedSearch.trim()">
              <div v-if="vPadTop" :style="{ height: vPadTop + 'px' }" />
              <div
                v-for="v in vVisibleItems"
                :key="v.guid"
                class="video-item"
                :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                @click="onVideoClick(v)"
              >
                <el-checkbox :model-value="isVideoSelected(v)" @update:model-value="() => toggleVideoSelection(v, selectionSource)" @click.stop size="small" />
                <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                     @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                <div class="video-item-info">
                  <span v-if="viewMode === 'single'" class="video-item-title" :title="v.title">{{ v.title }}</span>
                  <div v-else class="video-item-heading">
                    <span v-if="v.contentType" class="video-type-badge" :class="`video-type-badge--${v.contentType}`">{{ contentTypeLabel(v.contentType) }}</span>
                    <span class="video-item-title" :title="v.title" v-html="highlightText(v.title, debouncedSearch)" />
                  </div>
                  <span v-if="v.time" class="video-item-date">{{ v.time }}</span>
                </div>
                <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
                <button v-if="viewMode === 'single'" class="video-del-btn" title="从单个视频移除" @click.stop="removeSingleVideo(v)"><el-icon><Delete /></el-icon></button>
              </div>
              <div v-if="vPadBot" :style="{ height: vPadBot + 'px' }" />
            </template>
            <!-- grouped by date -->
            <template v-else>
              <div v-for="group in groupedVideos" :key="group.date" class="video-date-group">
                <div class="video-date-header">{{ group.date || '未知日期' }}</div>
                <div
                  v-for="v in group.items"
                  :key="v.guid"
                  class="video-item"
                  :class="{ active: selectedVideo?.guid === v.guid, downloaded: downloadedSet.has(v.guid) }"
                  @click="onVideoClick(v)"
                >
                  <el-checkbox :model-value="isVideoSelected(v)" @update:model-value="() => toggleVideoSelection(v, selectionSource)" @click.stop size="small" />
                  <img v-if="v.coverUrl" :src="v.coverUrl" loading="lazy" class="v-thumb"
                       @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')" />
                  <div class="video-item-info">
                    <div class="video-item-heading">
                      <span
                        v-if="v.contentType"
                        class="video-type-badge"
                        :class="`video-type-badge--${v.contentType}`"
                      >{{ contentTypeLabel(v.contentType) }}</span>
                      <span class="video-item-title" :title="v.title">{{ v.title }}</span>
                    </div>
                  </div>
                  <span v-if="downloadedSet.has(v.guid)" class="v-dl-check" title="已下载">✓</span>
                </div>
              </div>
            </template>
          </template>
        </div>
        <!-- footer toolbar -->
        <div class="video-footer">
          <div class="footer-summary">
            <span v-if="selectedCount" class="footer-selection-count">已选 {{ selectedCount }}<span class="footer-current-count"> · 当前列表 {{ filteredSelectedCount }}/{{ filteredVideos.length }}</span></span>
            <span v-else class="footer-list-count">{{ debouncedSearch ? '搜索结果' : '当前列表' }} {{ filteredVideos.length }}<span v-if="downloadedCount"> · 已下载 {{ downloadedCount }}</span></span>
            <el-popover v-if="selectedCount" placement="top-end" :width="336" trigger="click" popper-class="selected-videos-popper">
              <template #reference>
                <button class="footer-review-btn">查看已选 <el-icon><ArrowRight /></el-icon></button>
              </template>
              <div class="selected-videos-panel">
              <div class="selected-videos-summary">
                <span class="selected-videos-title">已选内容</span>
                <button class="selected-videos-clear" @click="contentStore.clearAllSelection()">清空已选</button>
              </div>
              <div class="selected-videos-scroll">
                <div v-for="group in selectedGroupsByMonth" :key="group.id" class="selected-video-group">
                  <div class="selected-video-group-name">
                    <span :title="group.name">{{ group.name }}</span>
                    <span>{{ group.count }}</span>
                  </div>
                  <div v-for="month in group.months" :key="month.key" class="selected-video-month">
                    <div class="selected-video-month-name">{{ month.label }}</div>
                    <div v-for="video in month.videos" :key="video.guid" class="selected-video-row">
                      <div class="selected-video-info">
                        <span class="selected-video-title" :title="video.title">{{ video.title }}</span>
                        <span class="selected-video-meta">{{ video.time || '日期未知' }}<span v-if="video.contentType" class="video-type-badge" :class="`video-type-badge--${video.contentType}`">{{ contentTypeLabel(video.contentType) }}</span></span>
                      </div>
                      <button title="从已选内容移除" :aria-label="`移除 ${video.title}`" @click="contentStore.removeVideoSelection(video.guid)"><el-icon><Close /></el-icon></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </el-popover>
          </div>
          <div class="footer-actions">
            <button
              v-if="selectedCount"
              class="footer-btn footer-btn-primary"
              :disabled="startingDownload"
              @click="downloadSelected"
            >{{ estimating ? '估算中…' : (allSelectedDownloaded ? '重新下载' : '下载选中') }} <span class="footer-btn-count">{{ selectedCount }}</span></button>
            <button
              v-else-if="canDownloadMonth"
              class="footer-btn footer-btn-primary"
              :disabled="startingDownload || loadingVideos || videoLoadFailed"
              @click="downloadAll"
            >{{ estimating ? '估算中…' : '下载本月' }}</button>
            <button v-else class="footer-btn footer-btn-idle" disabled>选择视频后下载</button>
            <button v-if="!selectedCount && isMonthlyColumn" class="footer-range-btn" :disabled="startingDownload"
              @click="rangeDialogOpen = true">时间范围</button>
            <el-dropdown v-if="selectedCount && isMonthlyColumn" trigger="click" placement="top-end" @command="onDownloadAction">
              <button class="footer-more-btn" title="更多下载方式" aria-label="更多下载方式" :disabled="startingDownload"><el-icon><MoreFilled /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="canDownloadMonth" command="month">下载本月全部 {{ videos.length }} 个视频</el-dropdown-item>
                  <el-dropdown-item command="range">按时间范围下载…</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </div>

    <!-- right preview panel -->
    <div class="home-preview">
        <div v-if="selectedVideo" :key="selectedVideo.guid" class="preview-inner">
          <!-- cover image -->
          <div class="preview-cover-wrap" :class="{ 'cover-missing': !selectedVideo.coverUrl || coverError }">
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
              <span class="preview-placeholder-art" aria-hidden="true">📺</span>
              <span>暂无封面</span>
            </div>
            <!-- bottom gradient overlay -->
            <div class="preview-cover-gradient" />
          </div>
          <!-- content -->
          <div class="preview-content">
            <div class="preview-action-bar">
              <button class="preview-action-btn" title="复制标题" @click="copyTitle">
                <el-icon><CopyDocument /></el-icon>复制标题
              </button>
              <button class="preview-action-btn" title="复制节目简介" @click="copyBrief">
                <el-icon><Document /></el-icon>复制简介
              </button>
              <button
                v-if="selectedVideo.coverUrl && !coverError"
                class="preview-action-btn"
                :disabled="coverDownloading"
                title="保存封面图片"
                @click="downloadCoverImage"
              ><el-icon><Picture /></el-icon>{{ coverDownloading ? '保存中…' : '保存封面' }}</button>
            </div>
            <h2 class="preview-title">{{ selectedVideo.title }}</h2>
            <div class="preview-meta">
              <span v-if="viewMode === 'single'" class="preview-single-badge">📌 单个视频</span>
              <span
                v-if="selectedVideo.contentType"
                class="video-type-badge preview-type-badge"
                :class="`video-type-badge--${selectedVideo.contentType}`"
              >{{ contentTypeLabel(selectedVideo.contentType) }}</span>
              <span v-if="selectedVideo.time" class="preview-date">🗓 {{ selectedVideo.time }}</span>
              <span v-if="selectedVideo.channel" class="preview-date">📺 {{ selectedVideo.channel }}</span>
              <span v-if="selectedVideo.durationSeconds != null" class="preview-date">⏱ {{ formatMediaDuration(selectedVideo.durationSeconds) }}</span>
              <span
                v-if="downloadedSet.has(selectedVideo.guid)"
                class="preview-downloaded-badge"
              >✓ 已下载</span>
            </div>
            <div v-if="selectedVideo.brief" class="preview-brief-wrap">
              <div class="preview-section-label">节目简介</div>
              <p class="preview-brief">{{ selectedVideo.brief }}</p>
            </div>
            <div class="preview-download-wrap">
              <button
                class="preview-download-btn"
                :disabled="startingDownload"
                :class="{
                  downloaded: downloadedSet.has(selectedVideo.guid),
                  dimmed: currentListSelectedCount > 0 && !downloadedSet.has(selectedVideo.guid)
                }"
                @click="downloadVideos([selectedVideo], false, downloadedSet.has(selectedVideo.guid))"
              >
                {{ estimating ? '估算中…' : (downloadedSet.has(selectedVideo.guid) ? '重新下载' : (viewMode === 'single' ? '下载此视频' : '下载此集')) }}
                <el-icon class="preview-download-icon"><Download /></el-icon>
              </button>
            </div>
          </div>
        </div>
        <div v-else class="preview-empty" key="empty">
          <div class="preview-guide">
            <div class="preview-guide-icon" aria-hidden="true">📺</div>
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
                  <span>点击左侧节目，选择要下载的视频</span>
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
    </div>
    <!-- lightbox -->
    <Transition name="lightbox-fade">
      <div v-if="lightboxOpen" class="lightbox" @click="closeLightbox">
        <button class="lightbox-close" title="关闭大图" @click="closeLightbox"><el-icon><Close /></el-icon></button>
        <img
          :src="selectedVideo?.coverUrl"
          class="lightbox-img"
          @click.stop
          referrerpolicy="no-referrer"
        />
      </div>
    </Transition>
    <MonthRangeDialog v-model="rangeDialogOpen" :program="selectedProgram"
      :selected-month="selectedMonth"
      :include-highlights="includeHighlightsEnabled" />
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import {
  ArrowRight, Close, CopyDocument, Delete, Document, Download, MoreFilled,
  Picture, RefreshRight, Search, Star, StarFilled, Upload
} from '@element-plus/icons-vue'
import type { ProgramInfo, ProgramMonthBounds, VideoInfo } from '../../shared/types'
import { isProgramDeleteKey, programKindLabel, snapshotProgram } from '../../shared/programs'
import { humanizeError } from '../../shared/errors'
import { safeFilename } from '../../shared/filename'
import { formatFileSize, formatMediaDuration } from '../../shared/format'
import { describeDownloadEstimate } from '../../shared/estimate-presentation'
import { displayPath } from '../../shared/path-display'
import { QUALITY_LABELS } from '../../shared/settings'
import { createLatestRequestGuard } from '../../shared/latest-request'
import { sortVideosChronologically, VideoMetadataLoader } from '../../shared/video-metadata'
import { useContentStore } from '../stores/content'
import { prepareDownloadBatch, startDownloadBatch } from '../utils/download-jobs'
import MonthRangeDialog from '../components/MonthRangeDialog.vue'

const contentStore = useContentStore()
const {
  programs, singleVideos, videos, viewMode, selectedProgram, selectedVideo,
  selectedMonth, downloadedSet, newContentMap, emptyMonths,
  programQuery, searchQuery, debouncedSearch,
  filteredPrograms, displayRows,
  filteredVideos, allSelected, downloadedCount, allSelectedDownloaded,
  emptyHint, groupedVideos, allSelectedVideos, selectedVideoGroups, selectedCount,
  includeHighlightsEnabled, listLoadedIncludeHighlights, listNeedsReload
} = storeToRefs(contentStore)

const isFav = contentStore.isFav
const isVideoSelected = contentStore.isVideoSelected
const toggleVideoSelection = contentStore.toggleVideoSelection
const selectedIsAlbum = computed(() => (selectedProgram.value?.kind ?? 'column') === 'album')
const isMonthlyColumn = computed(() => viewMode.value === 'column' && !!selectedProgram.value && !selectedIsAlbum.value)
const rangeDialogOpen = ref(false)
let homeReady = false
let homeMounted = false
watch(includeHighlightsEnabled, () => {
  if (homeReady && !loadingVideos.value && viewMode.value === 'column' && selectedProgram.value
    && listLoadedIncludeHighlights.value !== includeHighlightsEnabled.value) {
    void loadVideos(true)
  }
})
const programMonthBounds = ref<ProgramMonthBounds | null>(null)
const monthBoundsLoading = ref(false)
let monthBoundsRequestId = 0
const videoMetadataLoader = new VideoMetadataLoader(guid =>
  window.cctvdlApi.getVideoMediaMetadata(guid)
)

watch(selectedProgram, async program => {
  const requestId = ++monthBoundsRequestId
  programMonthBounds.value = null
  if (!program || (program.kind ?? 'column') === 'album') {
    monthBoundsLoading.value = false
    return
  }
  monthBoundsLoading.value = true
  try {
    const sourceProgram = programs.value.find(item => item.columnId === program.columnId) || program
    const canonical = snapshotProgram(sourceProgram)
    let bounds: ProgramMonthBounds | null = null
    for (let attempt = 0; attempt < 3 && !bounds; attempt++) {
      try { bounds = await window.cctvdlApi.getProgramMonthBounds(canonical) } catch {
        if (attempt === 2) throw new Error('month bounds unavailable')
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }
    if (requestId === monthBoundsRequestId && selectedProgram.value?.columnId === program.columnId) {
      programMonthBounds.value = bounds
    }
  } catch {
    // Boundary navigation is optional; normal month selection remains usable.
  } finally {
    if (requestId === monthBoundsRequestId) monthBoundsLoading.value = false
  }
}, { immediate: true })
// How many videos in the current program/month (or album) are selected. Shown
// next to the cross-program `selectedCount` so users can see both scopes.
const currentListSelectedCount = computed(() =>
  videos.value.filter(v => contentStore.isVideoSelected(v)).length
)
const filteredSelectedCount = computed(() =>
  filteredVideos.value.filter(v => contentStore.isVideoSelected(v)).length
)
const someFilteredSelected = computed(() => filteredSelectedCount.value > 0)
const canDownloadMonth = computed(() =>
  viewMode.value === 'column' && !selectedIsAlbum.value && videos.value.length > 0
)
const selectedGroupsByMonth = computed(() => selectedVideoGroups.value.map(group => {
  const months = new Map<string, VideoInfo[]>()
  for (const video of group.videos) {
    const key = videoMonthKey(video.time) || 'unknown'
    const items = months.get(key) || []
    items.push(video)
    months.set(key, items)
  }
  return {
    id: group.id, name: group.name, count: group.videos.length,
    months: Array.from(months, ([key, monthVideos]) => ({
      key, label: key === 'unknown' ? '日期未知' : `${key.slice(0, 4)}年${Number(key.slice(4))}月`,
      videos: monthVideos
    })).sort((a, b) => b.key.localeCompare(a.key))
  }
}))
const selectionSource = computed(() => selectedProgram.value?.name || (viewMode.value === 'single' ? '单个视频' : '其他视频'))

const isMac = window.cctvdlApi.isMac

// Local-only UI state (not shared across components)
const importUrl = ref('')
const importing = ref(false)
const importSuccess = ref(false)

const IMPORT_PLACEHOLDERS = [
  '粘贴节目 / 视频链接…',
  '示例：https://tv.cctv.com/lm/xwlb/',
  '单视频也支持：直接粘贴影片链接',
  '支持栏目、专辑和视频页链接',
]

const importPlaceholder = ref(IMPORT_PLACEHOLDERS[0])
let placeholderTimer: ReturnType<typeof setInterval> | null = null
let placeholderIdx = 0
const loadingVideos = ref(false)
const videoLoadFailed = ref(false)
const videoLoadGuard = createLatestRequestGuard()
const albumSort = ref<'asc' | 'desc'>('asc')
const albumLoadedCount = ref(0)
const coverError = ref(false)
const coverLoading = ref(false)
const coverDownloading = ref(false)
const lightboxOpen = ref(false)

// ─── 虚拟滚动（> 100 条时启用）─────────────────────────────────────────────
const VITEM_H = 46  // approximate row height (px) — checkbox + thumb + text
const VBUFFER = 8   // extra rows above/below viewport
const videoListEl = ref<HTMLElement | null>(null)
const vScrollTop = ref(0)

const vWindow = computed(() => {
  const total = filteredVideos.value.length
  if (total <= 100) return { start: 0, end: total }
  const containerH = videoListEl.value?.clientHeight ?? 400
  const start = Math.max(0, Math.floor(vScrollTop.value / VITEM_H) - VBUFFER)
  const end = Math.min(total, start + Math.ceil(containerH / VITEM_H) + VBUFFER * 2)
  return { start, end }
})
const vVisibleItems = computed(() => filteredVideos.value.slice(vWindow.value.start, vWindow.value.end))
const vPadTop = computed(() => vWindow.value.start * VITEM_H)
const vPadBot = computed(() => Math.max(0, (filteredVideos.value.length - vWindow.value.end) * VITEM_H))

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
let cleanupNewContent: (() => void) | null = null
let cleanupJobFinished: (() => void) | null = null
let cleanupAlbumProgress: (() => void) | null = null
function onHistoryCleared() { contentStore.refreshDownloadedSet() }

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
  if (rangeDialogOpen.value) return
  if (isEditingTarget()) return
  if (e.key === 'F5') { e.preventDefault(); if (selectedProgram.value) loadVideos(true); return }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault()
    if (!loadingVideos.value && !videoLoadFailed.value && filteredVideos.value.length > 0) {
      contentStore.toggleSelectAllFiltered(!allSelected.value)
    }
    return
  }
  if (isProgramDeleteKey(e.key, isMac) && selectedProgram.value) { e.preventDefault(); deleteProgram(selectedProgram.value) }
}

onMounted(async () => {
  homeMounted = true
  const settings = await window.cctvdlApi.getSettings()
  if (!homeMounted) return
  const includeHighlights = settings.includeHighlights === true
  contentStore.setIncludeHighlightsEnabled(includeHighlights)
  programs.value = await window.cctvdlApi.getPrograms()
  singleVideos.value = await window.cctvdlApi.getSingleVideos()
  if (!homeMounted) return
  contentStore.refreshDownloadedSet()
  // Only seed the month on the very first mount. Subsequent mounts (from
  // v-if tab switching) must preserve whatever month the user last picked
  // — wiping it here was the "切到下载页再切回，月份变 7 月" bug.
  if (!selectedMonth.value) {
    const now = new Date()
    selectedMonth.value = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  }
  window.addEventListener('keydown', onKeydown)

  // Rotate import placeholder
  placeholderTimer = setInterval(() => {
    placeholderIdx = (placeholderIdx + 1) % IMPORT_PLACEHOLDERS.length
    importPlaceholder.value = IMPORT_PLACEHOLDERS[placeholderIdx]
  }, 3000)
  cleanupSkipped = window.cctvdlApi.onDownloadSkipped((info) => {
    ElMessage.info(`跳过：${info.title}（${info.reason}）`)
  })
  cleanupNewContent = window.cctvdlApi.onNewContent(({ columnId, count }) => {
    contentStore.applyNewContent(columnId, count)
  })
  cleanupJobFinished = window.cctvdlApi.onJobFinished((job) => {
    if (job.state === 'Completed') contentStore.markDownloaded(job.guid)
  })
  cleanupAlbumProgress = window.cctvdlApi.onAlbumLoadProgress((info) => {
    if (
      selectedIsAlbum.value
      && selectedProgram.value?.columnId === info.columnId
      && info.requestId != null
      && videoLoadGuard.isCurrent(info.requestId)
    ) {
      const merged = new Map(videos.value.map(video => [video.guid, video]))
      for (const video of info.videos) merged.set(video.guid, video)
      videos.value = sortAlbumList(Array.from(merged.values()))
      albumLoadedCount.value = videos.value.length
    }
  })

  // 设置页清除历史后刷新已下载标记
  window.addEventListener('cctvdl:history-cleared', onHistoryCleared)
  homeReady = true
  if (viewMode.value === 'column' && selectedProgram.value
    && (listNeedsReload.value || listLoadedIncludeHighlights.value !== includeHighlightsEnabled.value)) {
    void loadVideos(true)
  }
})

onUnmounted(() => {
  homeMounted = false
  homeReady = false
  videoLoadGuard.begin()
  loadingVideos.value = false
  cleanupSkipped?.()
  cleanupNewContent?.()
  cleanupJobFinished?.()
  cleanupAlbumProgress?.()
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
    ElMessage.success(`已导入 ${count} 个节目`)
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
    selectSingleMode()
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
      // Not a column page (e.g. a standalone movie, a news article, or a cctvnews
      // snow-book URL) — fall back to resolving it as single video(s). cctvnews
      // articles may return multiple videos; regular pages return one.
      try {
        const settings = await window.cctvdlApi.getSettings()
        const resolvedVideos = await window.cctvdlApi.resolveVideoBatch(url, settings.quality)
        if (resolvedVideos.length === 0) throw columnErr
        if (resolvedVideos.length === 1) {
          await addAndShowSingleVideo(resolvedVideos[0])
        } else {
          let added = 0
          for (const v of resolvedVideos) {
            if (await window.cctvdlApi.addSingleVideo(v)) added++
          }
          singleVideos.value = await window.cctvdlApi.getSingleVideos()
          selectSingleMode()
          selectedVideo.value = resolvedVideos[0]
          coverError.value = false
          coverLoading.value = true
          importUrl.value = ''
          importSuccess.value = true
          setTimeout(() => { importSuccess.value = false }, 800)
          ElMessage.success(added > 0 ? `已导入 ${added} 个视频` : `已在单个视频列表：${resolvedVideos.length} 个视频`)
        }
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

function onProgramClick(row: ProgramInfo) {
  viewMode.value = 'column'
  selectedProgram.value = row
  contentStore.clearEmptyMonths()
  contentStore.clearNewContent(row.columnId)
  selectedVideo.value = null
  loadVideos()
}

// ─── Single-video collection ────────────────────────────────────────────────
function selectSingleMode() {
  videoLoadGuard.begin()
  loadingVideos.value = false
  videoLoadFailed.value = false
  listNeedsReload.value = false
  viewMode.value = 'single'
  selectedProgram.value = null
  selectedVideo.value = null
  searchQuery.value = ''
  debouncedSearch.value = ''
  contentStore.refreshDownloadedSet()
  videos.value = singleVideos.value
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
  contentStore.removeVideoSelection(v.guid)
  if (selectedVideo.value?.guid === v.guid) selectedVideo.value = null
}

async function deleteProgram(row: ProgramInfo) {
  try {
    await ElMessageBox.confirm(`确定删除${programKindLabel(row)}「${row.name}」吗？`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
    })
    await window.cctvdlApi.deleteProgram(row.columnId)
    programs.value = await window.cctvdlApi.getPrograms()
    contentStore.removeProgramSelections(row.columnId)
    if (selectedProgram.value?.columnId === row.columnId) {
      selectedProgram.value = null
      videos.value = []
      listNeedsReload.value = false
    }
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
    await ElMessageBox.confirm(`确定清空全部 ${programs.value.length} 个节目吗？`, '确认清空', {
      confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning'
    })
    await window.cctvdlApi.clearPrograms()
    programs.value = []
    selectedProgram.value = null
    listNeedsReload.value = false
    if (viewMode.value === 'column') videos.value = []
    contentStore.clearProgramSelections()
    ElMessage.success('已清空')
  } catch { /* cancelled */ }
}

async function loadVideos(forceRefresh = false) {
  if (!selectedProgram.value) return
  const program = snapshotProgram(selectedProgram.value)
  const isAlbum = (program.kind ?? 'column') === 'album'
  const month = isAlbum ? '' : selectedMonth.value
  const includeHighlightsForRequest = includeHighlightsEnabled.value
  const requestId = videoLoadGuard.begin()
  loadingVideos.value = true
  videoLoadFailed.value = false
  listNeedsReload.value = true
  albumLoadedCount.value = 0
  videos.value = []
  contentStore.refreshDownloadedSet()
  const isRelevant = () => videoLoadGuard.isCurrent(requestId)
    && viewMode.value === 'column'
    && selectedProgram.value?.columnId === program.columnId
  try {
    const list = await window.cctvdlApi.listVideos(program, month, requestId, forceRefresh)
    if (!isRelevant()) return
    videos.value = isAlbum ? sortAlbumList(list) : list
    listLoadedIncludeHighlights.value = includeHighlightsForRequest
    listNeedsReload.value = false
    // Only drop the preview if its video is no longer in the freshly loaded
    // list (e.g. deleted from the server). Otherwise preserve so users can
    // browse months without losing their preview context.
    if (selectedVideo.value && !list.some(v => v.guid === selectedVideo.value?.guid)) {
      selectedVideo.value = null
    }
    if (!isAlbum) contentStore.recordVideosLoaded(month, list)
  } catch (err) {
    if (isRelevant()) {
      videoLoadFailed.value = true
      ElMessage.error(`加载失败：${humanizeError(String(err))}`)
    }
  } finally {
    if (videoLoadGuard.isCurrent(requestId)) {
      loadingVideos.value = false
      if (isRelevant() && includeHighlightsEnabled.value !== includeHighlightsForRequest) {
        void loadVideos(true)
      }
    }
  }
}

function sortAlbumList(list: VideoInfo[]): VideoInfo[] {
  return sortVideosChronologically(list, albumSort.value)
}

function sortDisplayedAlbum() {
  if (selectedIsAlbum.value) videos.value = sortAlbumList(videos.value)
}

async function onVideoClick(row: VideoInfo) {
  selectedVideo.value = row
  coverError.value = false
  coverLoading.value = true
  if (row.channel && row.durationSeconds != null) return
  const guid = row.guid
  const metadata = await videoMetadataLoader.get(guid)
  // Metadata enrichment is best-effort; list browsing remains usable offline.
  if (!metadata || selectedVideo.value?.guid !== guid) return
  Object.assign(row, metadata)
}

function jumpMonth(offset: number) {
  let target: Date
  if (offset === 0) {
    target = new Date()
  } else {
    const cur = selectedMonth.value || `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`
    target = new Date(Number(cur.slice(0, 4)), Number(cur.slice(4, 6)) - 1 + offset)
  }
  selectedMonth.value = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, '0')}`
  if (selectedProgram.value && !selectedIsAlbum.value) loadVideos()
}

function jumpToContentBoundary(edge: 'earliest' | 'latest') {
  const month = programMonthBounds.value?.[edge]
  if (!month || !selectedProgram.value) return
  selectedMonth.value = month
  loadVideos()
}

function highlightText(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text)
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escapeHtml(text).replace(
    new RegExp(escapeHtml(escaped), 'gi'),
    m => `<mark class="hl">${m}</mark>`
  )
}

function contentTypeLabel(type: NonNullable<VideoInfo['contentType']>): string {
  return type === 'highlight' ? '看点' : '片段'
}

function videoMonthKey(time: string): string {
  const match = time.match(/^(\d{4})[-/]?(\d{2})/)
  return match ? `${match[1]}${match[2]}` : ''
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
async function downloadCoverImage() {
  if (!selectedVideo.value?.coverUrl || coverError.value) return
  const settings = await window.cctvdlApi.getSettings()
  if (!settings.coverSavePath) { ElMessage.warning('请先在设置中配置图片保存目录'); return }
  coverDownloading.value = true
  try {
    const { savedPath } = await window.cctvdlApi.downloadCover(
      selectedVideo.value.coverUrl,
      settings.coverSavePath,
      safeFilename(selectedVideo.value.title)
    )
    ElMessage.success('封面已保存：' + savedPath.split(/[/\\]/).pop())
  } catch (err) {
    ElMessage.error('封面下载失败：' + err)
  } finally {
    coverDownloading.value = false
  }
}

async function downloadSelected() { await downloadVideos(allSelectedVideos.value, true) }

// 下载本月（仅栏目）：始终下载当前月份的完整列表，不受搜索过滤或其他
// 栏目、月份的已选项影响。
async function downloadAll() {
  if (loadingVideos.value || videoLoadFailed.value) return
  await downloadVideos(videos.value)
}

function onDownloadAction(command: string) {
  if (command === 'month') void downloadAll()
  if (command === 'range') rangeDialogOpen.value = true
}

const startingDownload = ref(false)
const estimating = ref(false)

async function downloadVideos(
  videoList: VideoInfo[], consumeSelection = false, forceRedownload = false
) {
  if (startingDownload.value) return
  if (!videoList.length) return
  const validVideos = videoList.filter(v => v.guid)
  if (!validVideos.length) { ElMessage.warning('选中的视频链接无效'); return }
  const selectionGroups = consumeSelection ? selectedVideoGroups.value : []
  const downloadProgram = viewMode.value === 'column' ? selectedProgram.value : null
  const albumIds = new Set(programs.value.filter(program => program.kind === 'album').map(program => program.columnId))
  const programNames = new Map<string, string>()
  if (consumeSelection) {
    for (const group of selectionGroups) {
      if (group.id === '__single__') continue
      const name = programs.value.find(program => program.columnId === group.id)?.name || group.name
      for (const video of group.videos) programNames.set(video.guid, name)
    }
  } else if (downloadProgram) {
    for (const video of validVideos) programNames.set(video.guid, downloadProgram.name)
  }
  const redownloadIntent = forceRedownload || (consumeSelection && allSelectedDownloaded.value)
  const estimateVideos = redownloadIntent
    ? validVideos
    : validVideos.filter(video => !downloadedSet.value.has(video.guid))
  if (!estimateVideos.length) { ElMessage.info('所选视频已下载'); return }
  startingDownload.value = true
  try {
    estimating.value = true
    const { settings, skippedHistory, estimate, destinations } = await prepareDownloadBatch(
      validVideos, downloadedSet.value, redownloadIntent, programNames
    )
    estimating.value = false
    const lowSpace = estimate.diskFreeBytes != null && estimate.estimatedBytes > estimate.diskFreeBytes
    const estimateDetails = describeDownloadEstimate(estimate)
    const months = Array.from(new Set(estimateVideos.map(video => videoMonthKey(video.time)).filter(Boolean))).sort()
    const monthLabel = (key: string) => `${key.slice(0, 4)}年${Number(key.slice(4))}月`
    const monthRange = months.length
      ? months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])}—${monthLabel(months[months.length - 1])}`
      : '日期未知'
    const includedGuids = new Set(estimateVideos.map(video => video.guid))
    const includedGroups = consumeSelection
      ? selectionGroups.filter(group => group.id !== '__single__'
        && group.videos.some(video => includedGuids.has(video.guid)))
      : downloadProgram
        ? [{ id: downloadProgram.columnId }]
        : []
    const albumCount = includedGroups.filter(group => albumIds.has(group.id)).length
    const columnCount = includedGroups.length - albumCount
    const singleCount = consumeSelection
      ? selectionGroups.find(group => group.id === '__single__')?.videos.filter(video => includedGuids.has(video.guid)).length || 0
      : includedGroups.length ? 0 : estimateVideos.length
    const scope = [columnCount ? `${columnCount} 个栏目` : '', albumCount ? `${albumCount} 个专辑` : '', singleCount ? `${singleCount} 个单视频` : '']
      .filter(Boolean).join(' · ')
    const highlightCount = estimateVideos.filter(video => video.contentType === 'highlight').length
    const fragmentCount = estimateVideos.filter(video => video.contentType === 'fragment').length
    const message = h('div', { class: 'download-confirm-details' }, [
      h('div', { class: 'download-confirm-overview' }, [
        h('span', { class: 'download-confirm-scope' }, scope),
        h('span', { class: 'download-confirm-period' }, monthRange),
        ...(highlightCount ? [h('span', { class: 'download-confirm-kind' }, `${highlightCount} 个看点`)] : []),
        ...(fragmentCount ? [h('span', { class: 'download-confirm-kind' }, `${fragmentCount} 个片段`)] : [])
      ]),
      ...[
        ['清晰度', QUALITY_LABELS[settings.quality]],
        [estimateDetails.sizeLabel, estimateDetails.sizeText],
        ['磁盘剩余', estimate.diskFreeBytes == null ? '无法检查' : (formatFileSize(estimate.diskFreeBytes) || '0 B')]
      ].map(([label, value]) => h('div', { class: 'download-confirm-row' }, [
        h('span', { class: 'download-confirm-label' }, label),
        h('span', { class: 'download-confirm-value' }, value)
      ])),
      h('div', { class: 'download-confirm-row' }, [
        h('span', { class: 'download-confirm-label' }, '保存到'),
        destinations.length === 1
          ? h('span', { class: 'download-confirm-value' }, displayPath(destinations[0].path))
          : h('div', { class: 'download-confirm-destinations' }, destinations.map(destination =>
            h('div', { class: 'download-confirm-destination' }, [
              h('span', { title: displayPath(destination.path) }, displayPath(destination.path)),
              h('small', `${destination.count} 个`)
            ])
          ))
      ]),
      ...(skippedHistory > 0
        ? [h('p', { class: 'download-confirm-note' }, `${skippedHistory} 个已下载视频将跳过。`)]
        : []),
      ...(estimateDetails.note
        ? [h('p', { class: 'download-confirm-note' }, estimateDetails.note)] : []),
      ...(lowSpace
        ? [h('p', { class: 'download-confirm-warning' }, '剩余空间可能不足，请释放空间或更换保存位置。')]
        : []),
      h('details', { class: 'download-confirm-list' }, [
        h('summary', `查看待加入的视频（${estimateVideos.length}）`),
        h('div', { class: 'download-confirm-list-scroll' }, estimateVideos.map(video =>
          h('div', { class: 'download-confirm-video', key: video.guid }, [
            h('span', { class: 'download-confirm-video-title', title: video.title }, video.title),
            h('span', { class: 'download-confirm-video-meta' },
              [video.time?.slice(0, 10), video.contentType ? contentTypeLabel(video.contentType) : '']
                .filter(Boolean).join(' · '))
          ])
        ))
      ])
    ])
    try {
      const title = `${redownloadIntent ? '重新下载' : '下载'} ${estimateVideos.length} 个视频`
      await ElMessageBox.confirm(message, title, {
        customClass: 'download-confirm-dialog',
        confirmButtonText: '加入队列', cancelButtonText: '返回检查'
      })
    } catch {
      return
    }
    // Explicit redownload actions bypass history; the coordinator still deduplicates active jobs.
    const result = await startDownloadBatch(validVideos, settings, redownloadIntent, programNames)
    if (consumeSelection) contentStore.removeVideoSelections(result.addedGuids)
    if (result.added > 0) {
      ElMessage.success(`已添加 ${result.added} 个下载任务${result.skipped ? `，忽略 ${result.skipped} 个重复或已下载项` : ''}`)
    } else {
      ElMessage.info('所选视频已下载或已在下载队列中')
    }
  } catch (err) { ElMessage.error(`下载失败：${humanizeError(String(err))}`) }
  finally { estimating.value = false; startingDownload.value = false }
}
</script>

<style scoped>
:global(.download-confirm-dialog) {
  width: min(480px, calc(100vw - 32px));
  padding: 0;
  border-radius: 6px;
  font-family: var(--el-font-family);
}

:global(.download-confirm-dialog .el-message-box__header) { padding: 20px 20px 0; }
:global(.download-confirm-dialog .el-message-box__title) {
  font-family: var(--el-font-family);
  font-size: 16px;
  font-weight: var(--app-font-weight-medium);
}
:global(.download-confirm-dialog .el-message-box__content) { padding: 16px 20px 4px; }
:global(.download-confirm-dialog .el-message-box__message) { width: 100%; }
:global(.download-confirm-dialog .el-message-box__btns) { padding: 14px 20px 20px; }
:global(.download-confirm-dialog .el-message-box__btns .el-button) { min-width: 88px; height: 34px; font-size: 13px; }

:global(.download-confirm-details) {
  display: grid;
  gap: 8px;
  width: 100%;
}
:global(.download-confirm-overview) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 5px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}
:global(.download-confirm-scope) { color: var(--el-text-color-primary); font-weight: var(--app-font-weight-semibold); }

:global(.download-confirm-row) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 62%);
  gap: 12px;
  align-items: start;
  line-height: 1.45;
}

:global(.download-confirm-label) { color: var(--el-text-color-secondary); font-size: 14px; font-weight: 400; }
:global(.download-confirm-value) {
  min-width: 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 400;
  text-align: right;
  overflow-wrap: anywhere;
}
:global(.download-confirm-note) { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
:global(.download-confirm-destinations) { min-width: 0; max-height: 132px; overflow-y: auto; padding-right: 8px; }
:global(.download-confirm-destination) { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; font-size: 13px; }
:global(.download-confirm-destination span) { flex: 1; min-width: 0; overflow-wrap: anywhere; text-align: right; }
:global(.download-confirm-destination small) { flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 11px; }
:global(.download-confirm-warning) {
  margin: 4px 0 0;
  padding: 8px 10px;
  border-left: 3px solid var(--el-color-warning);
  border-radius: 4px;
  background: var(--el-color-warning-light-9);
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.5;
}
:global(.download-confirm-list) { padding-top: 4px; border-top: 1px solid var(--el-border-color-light); }
:global(.download-confirm-list summary) { padding: 5px 0; color: var(--el-color-primary); font-size: 12px; cursor: pointer; }
:global(.download-confirm-list summary:focus-visible) { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
:global(.download-confirm-list-scroll) { max-height: min(220px, 30vh); overflow-y: auto; padding: 3px 0; }
:global(.download-confirm-video) { display: flex; align-items: baseline; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--el-border-color-extra-light); font-size: 12px; }
:global(.download-confirm-video-title) { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--el-text-color-primary); }
:global(.download-confirm-video-meta) { flex-shrink: 0; color: var(--el-text-color-secondary); }

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
  font-size: 12px;
  font-weight: var(--app-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0;
  color: var(--el-text-color-secondary);
}

.section-actions { display: flex; gap: 2px; }

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
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
.icon-btn .el-icon { font-size: 15px; }
@keyframes spin { to { transform: rotate(360deg); } }

.select-current-list { margin: 0 5px 0 0; min-width: 28px; min-height: 28px; justify-content: center; }
.select-current-list :deep(.el-checkbox__label) { display: none; }
.select-current-list :deep(.el-checkbox__inner) { width: 15px; height: 15px; }
.home-sidebar button:focus-visible,
.select-current-list :deep(.el-checkbox__input:focus-visible .el-checkbox__inner),
.selected-video-row button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

/* 导入行 */
.import-row {
  display: flex;
  gap: var(--app-spacing-sm);
}

.import-input { flex: 1; min-width: 0; }
.import-btn {
  font-family: var(--el-font-family);
  font-weight: var(--app-font-weight-medium);
  line-height: 1;
  box-shadow: none;
}
.import-btn :deep(span) { line-height: 1; }
.import-btn:hover,
.import-btn:active { transform: none; box-shadow: none; }

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

html.dark .program-item.active,
html.dark .single-entry.active {
  background: rgba(37, 99, 235, .18);
  color: #93c5fd;
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
  letter-spacing: 0;
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
/* 未收藏：悬停时暗显；已收藏：星标常驻显示 */
.program-item:hover .prog-action-btn.star:not(.faved) { opacity: 0.4; }
.prog-action-btn.star.faved { opacity: 1; }
.prog-action-btn:focus-visible { opacity: 1; }
.prog-action-btn.star.faved { color: var(--el-color-warning); }
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
.single-entry-icon { font-size: 14px; flex-shrink: 0; }
.single-mode-caption { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
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

.album-sort-select { width: 88px; }
.album-sort-select :deep(.el-select__wrapper) {
  gap: 4px;
  padding-right: 6px;
  padding-left: 8px;
}
.album-sort-select :deep(.el-select__selected-item) {
  font-family: var(--el-font-family);
  font-size: 12px;
  font-weight: var(--app-font-weight-normal);
}
:global(.album-sort-popper .el-select-dropdown__item) {
  font-family: var(--el-font-family);
  font-size: 12px;
  font-weight: var(--app-font-weight-normal);
}

/* 视频搜索 */
.video-search { margin-bottom: 0; }

/* 视频列表 */
.video-list {
  flex: 1;
  isolation: isolate;
  overflow-y: auto;
  overflow-x: hidden;
  margin: var(--app-spacing-sm) calc(-1 * var(--app-spacing-md));
  padding: 0 var(--app-spacing-md);
}

.video-hint {
  padding: 20px 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

.video-load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 36px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.video-skeleton {
  padding: 8px 4px;
}

.video-date-header {
  padding: 6px 8px 3px;
  font-size: 12px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-text-color-secondary);
  letter-spacing: 0;
  border-bottom: 1px solid var(--app-border-subtle);
  margin-bottom: 2px;
  user-select: none;
  /* Each header sticks only within its date group, above the row controls. */
  position: sticky;
  top: 0;
  background: var(--app-bg-sidebar);
  z-index: 1;
}

.video-item {
  position: relative;
  z-index: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 5px 8px;
  box-sizing: border-box;
  border-left: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background .12s;
}

.video-item:hover { background: var(--el-fill-color-light); }
.video-item.active {
  border-left-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  padding-left: 6px;
}

html.dark .video-item.active {
  background: rgba(37, 99, 235, .18);
}
html.dark .video-item.active .video-item-title { color: #f8fafc; }
html.dark .video-item.active .video-item-date { color: #bfdbfe; }

.video-item :deep(.el-checkbox) {
  min-width: 28px;
  min-height: 28px;
  margin-right: -4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

html.dark .video-item :deep(.el-checkbox:not(.is-checked) .el-checkbox__inner) {
  background: #111827;
  border-color: #64748b;
}

.video-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.video-item-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary);
}

.video-item-heading {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.video-type-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: var(--app-font-weight-normal);
  line-height: 17px;
  white-space: nowrap;
}

.video-type-badge--highlight {
  color: #b45309;
  background: #fff7ed;
}

.video-type-badge--fragment {
  color: #2563eb;
  background: #eff6ff;
}

html.dark .video-type-badge--highlight {
  color: #fdba74;
  background: rgba(194, 65, 12, .16);
}

html.dark .video-type-badge--fragment {
  color: #93c5fd;
  background: rgba(37, 99, 235, .18);
}

.preview-type-badge {
  padding: 0 7px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 20px;
}

.video-item-date {
  font-size: 12px;
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
.video-del-btn:focus-visible { opacity: 1; }
.video-del-btn:hover { color: var(--el-color-danger); }

.video-item.downloaded {
  border-left: 2px solid var(--el-color-success);
  padding-left: 6px;
  background: rgba(5, 150, 105, .04);
}

.video-item.downloaded .video-item-title {
  color: var(--el-text-color-secondary);
}

.video-item.active.downloaded { border-left-color: var(--el-color-primary); }
html.dark .video-item.active.downloaded .video-item-title { color: #f8fafc; }

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
  flex-direction: column;
  gap: 8px;
  padding: 9px 0 var(--app-spacing-md);
  border-top: 1px solid var(--app-border-subtle);
  margin-top: 0;
}
.footer-summary, .footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}
.footer-summary { min-height: 22px; justify-content: space-between; }
.footer-list-count, .footer-selection-count {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.footer-selection-count { color: var(--el-text-color-primary); font-weight: var(--app-font-weight-medium); }
.footer-current-count { color: var(--el-text-color-secondary); font-weight: var(--app-font-weight-normal); }
.footer-review-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  cursor: pointer;
}
.footer-review-btn:hover { color: var(--el-color-primary-dark-2); }

/* 底部操作按钮基础样式 */
.footer-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: var(--app-control-height);
  padding: 0 12px;
  border-radius: var(--el-border-radius-base);
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
  white-space: nowrap;
}
.footer-more-btn {
  width: var(--app-control-height);
  height: var(--app-control-height);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.footer-more-btn:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.footer-more-btn:disabled { opacity: .5; cursor: not-allowed; }
.footer-range-btn {
  height: var(--app-control-height);
  flex-shrink: 0;
  padding: 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  cursor: pointer;
}
.footer-range-btn:hover { color: var(--el-color-primary); border-color: var(--el-color-primary); }
.footer-range-btn:disabled { opacity: .5; cursor: not-allowed; }

.selected-videos-panel { min-width: 0; }
.selected-videos-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid var(--app-border-subtle);
}
.selected-videos-title { font-size: 14px; font-weight: var(--app-font-weight-semibold); color: var(--el-text-color-primary); }
.selected-videos-clear { border: 0; padding: 3px 0; background: transparent; color: var(--el-color-danger); font-size: 12px; cursor: pointer; }
.selected-videos-clear:hover { text-decoration: underline; }
.selected-videos-scroll { max-height: min(360px, 52vh); overflow-y: auto; }
.selected-video-group + .selected-video-group { margin-top: 12px; }
.selected-video-group-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 2px 5px;
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: var(--app-font-weight-semibold);
}
.selected-video-group-name span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-video-month-name { padding: 5px 3px 3px; color: var(--el-text-color-secondary); font-size: 12px; }
.selected-video-row { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 3px 3px 3px 8px; border-radius: 5px; }
.selected-video-row:hover { background: var(--el-fill-color-light); }
.selected-video-info { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.selected-video-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--el-text-color-primary); }
.selected-video-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--el-text-color-secondary); }
.selected-video-row button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; border: 0; border-radius: 5px; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; }
.selected-video-row button:hover { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }

/* 主操作：有选中时 */
.footer-btn-primary {
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}
.footer-btn-primary:hover { background: var(--el-color-primary-dark-2); border-color: var(--el-color-primary-dark-2); }
.footer-btn-primary:disabled { opacity: .6; cursor: not-allowed; }

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

/* ── 右侧预览区 ─────────────────────────────────── */
.home-preview {
  flex: 1;
  overflow: hidden;
  background: var(--el-bg-color);
  position: relative;
  min-width: 0;
}

.preview-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* 封面 */
.preview-cover-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  height: min(46vh, 380px);
  flex-shrink: 0;
  overflow: hidden;
  background: var(--el-fill-color-light);
  position: relative;
}
.preview-cover-wrap.cover-missing { height: min(24vh, 180px); }

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
  opacity: 1;
}
.preview-placeholder-art { font-size: 34px; line-height: 1; }

/* 内容区 */
.preview-content {
  padding: var(--app-spacing-xl) var(--app-spacing-xl) var(--app-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-md);
  flex: 1;
  min-height: 0;
  overflow: hidden;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.preview-brief-wrap {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.preview-section-label {
  font-size: 11px;
  font-weight: var(--app-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0;
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
  min-height: 30px;
  padding: 0 10px;
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
.preview-action-btn .el-icon { flex-shrink: 0; font-size: 14px; }

/* 单个视频徽章 */
.preview-single-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  width: 100%;
  box-sizing: border-box;
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--app-spacing-md);
  padding-top: var(--app-spacing-sm);
  border-top: 1px solid var(--app-border-subtle);
}

.preview-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: var(--app-control-height);
  padding: 0 12px;
  border: none;
  border-radius: var(--app-control-radius);
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  font-family: var(--el-font-family);
  line-height: 1;
  cursor: pointer;
  box-shadow: none;
  transition: background .15s, color .15s, border-color .15s;
  white-space: nowrap;
  letter-spacing: 0;
}

.preview-download-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  font-size: 14px;
}

.preview-download-btn:hover {
  background: var(--el-color-primary-dark-2);
  box-shadow: none;
}

.preview-download-btn:active {
  box-shadow: none;
}

/* 弱化态：有批量选中时单集按钮降优先级 */
.preview-download-btn.dimmed {
  box-sizing: border-box;
  border: 1px solid var(--el-color-primary-light-5);
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  box-shadow: none;
}
.preview-download-btn.dimmed:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: none;
  transform: none;
}

.preview-download-btn.downloaded {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: none;
}
.preview-download-btn.downloaded:hover {
  background: var(--el-color-primary-light-8);
  box-shadow: none;
  transform: none;
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
  line-height: 1;
  margin-bottom: var(--app-spacing-md);
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

.month-quick-btn.today {
  width: auto;
  padding: 0 7px;
  font-size: 12px;
}

.month-quick-btn:hover {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.month-quick-btn.boundary {
  font-size: 12px;
}

.month-quick-btn:disabled {
  cursor: wait;
  opacity: .45;
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

/* 栏目列表入场 + 收藏重排时的平滑移动动画 */
.prog-list-enter-active { transition: opacity .15s ease, transform .15s ease; }
.prog-list-enter-from { opacity: 0; transform: translateX(-6px); }
.prog-list-move { transition: transform .25s ease; }
</style>
