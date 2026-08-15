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
            <span>📌 单个视频 · {{ singleVideos.length }}</span>
            <span class="single-mode-actions">
              <button class="icon-btn" title="从 JSON 导入单视频" @click="importSingleVideos">↓</button>
              <button class="icon-btn" title="导出单视频备份" :disabled="!singleVideos.length" @click="exportSingleVideos">↑</button>
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
            <button
              class="icon-btn"
              title="全选 / 取消全选"
              :disabled="!filteredVideos.length"
              @click="contentStore.toggleSelectAllFiltered(!allSelected)"
            >{{ allSelected ? '☑' : '☐' }}</button>
            <button
              v-if="viewMode === 'column'"
              class="icon-btn"
              title="刷新 (F5)"
              :disabled="!selectedProgram"
              :class="{ spinning: loadingVideos }"
              @click="loadVideos(true)"
            >↻</button>
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
                  <el-checkbox :model-value="isVideoSelected(v)" @update:model-value="() => toggleVideoSelection(v, selectionSource)" @click.stop size="small" />
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
                  <el-checkbox :model-value="isVideoSelected(v)" @update:model-value="() => toggleVideoSelection(v, selectionSource)" @click.stop size="small" />
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
                      <span class="video-item-title" :title="v.title" v-html="highlightText(v.title, debouncedSearch)" />
                    </div>
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
                      <span class="video-item-title" :title="v.title" v-html="highlightText(v.title, debouncedSearch)" />
                    </div>
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
              </template>
            </template>
          </template>
        </div>
        <!-- footer toolbar -->
        <div class="video-footer">
          <span class="video-count" v-if="videos.length">
            {{ filteredVideos.length }} 个{{ debouncedSearch ? '（过滤）' : '' }}
            <span v-if="downloadedCount" class="video-downloaded-count"> · ✓{{ downloadedCount }}</span>
            <span v-if="selectedCount" class="video-selected-count"> · 已选 {{ selectedCount }}<template v-if="currentListSelectedCount && currentListSelectedCount !== selectedCount">（当前列表 {{ currentListSelectedCount }}）</template></span>
          </span>
          <button
            v-if="viewMode === 'column' && !selectedIsAlbum && videos.length"
            class="footer-btn footer-btn-ghost"
            @click="downloadAll"
          >下载本月</button>
          <button
            v-if="selectedCount"
            class="footer-btn footer-btn-clear"
            @click="contentStore.clearAllSelection()"
          >清空已选</button>
          <el-popover v-if="selectedCount" placement="top" :width="340" trigger="click">
            <template #reference>
              <button class="footer-btn footer-btn-ghost">查看已选</button>
            </template>
            <div class="selected-videos-panel">
              <div class="selected-videos-summary">
                <span class="selected-videos-title">已选内容</span>
                <span class="selected-videos-count">{{ selectedCount }} 个视频</span>
              </div>
              <div v-for="group in selectedVideoGroups" :key="group.name" class="selected-video-group">
                <div class="selected-video-group-name">
                  <span :title="group.name">{{ group.name }}</span>
                  <span>{{ group.videos.length }}</span>
                </div>
                <div v-for="video in group.videos" :key="video.guid" class="selected-video-row">
                  <span :title="video.title">{{ video.title }}</span>
                  <button title="从已选内容移除" aria-label="从已选内容移除" @click="contentStore.removeVideoSelection(video.guid)">×</button>
                </div>
              </div>
            </div>
          </el-popover>
          <button
            v-if="viewMode === 'column'"
            class="footer-btn"
            :class="selectedCount ? 'footer-btn-primary' : 'footer-btn-idle'"
            :disabled="!selectedCount || startingDownload"
            @click="downloadSelected"
          >
            {{ allSelectedDownloaded ? '重新下载' : '下载选中' }}
            <span v-if="selectedCount" class="footer-btn-count">{{ selectedCount }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- right preview panel -->
    <div class="home-preview">
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
              <button
                v-if="selectedVideo.coverUrl && !coverError"
                class="preview-action-btn"
                :disabled="coverDownloading"
                title="保存封面图片"
                @click="downloadCoverImage"
              >{{ coverDownloading ? '…' : '🖼 保存封面' }}</button>
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
                :class="{
                  downloaded: downloadedSet.has(selectedVideo.guid),
                  dimmed: currentListSelectedCount > 0 && !downloadedSet.has(selectedVideo.guid)
                }"
                @click="downloadVideos([selectedVideo], viewMode === 'single')"
              >
                {{ downloadedSet.has(selectedVideo.guid) ? '重新下载' : (viewMode === 'single' ? '下载此视频' : '下载此集') }}
                <el-icon class="preview-download-icon"><Download /></el-icon>
              </button>
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
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { Download, Search } from '@element-plus/icons-vue'
import type { ProgramInfo, ProgramMonthBounds, VideoInfo, DownloadJob } from '../../shared/types'
import { isProgramDeleteKey } from '../../shared/programs'
import { humanizeError } from '../../shared/errors'
import { buildOutputPath, safeFilename } from '../../shared/filename'
import { formatMediaDuration } from '../../shared/format'
import { QUALITY_LABELS } from '../../shared/settings'
import { createLatestRequestGuard } from '../../shared/latest-request'
import { VideoMetadataLoader } from '../../shared/video-metadata'
import { useContentStore } from '../stores/content'

const contentStore = useContentStore()
const {
  programs, singleVideos, videos, viewMode, selectedProgram, selectedVideo,
  selectedMonth, downloadedSet, newContentMap, emptyMonths,
  programQuery, searchQuery, debouncedSearch,
  filteredPrograms, displayRows,
  filteredVideos, allSelected, downloadedCount, allSelectedDownloaded,
  emptyHint, groupedVideos, allSelectedVideos, selectedVideoGroups, selectedCount
} = storeToRefs(contentStore)

const isFav = contentStore.isFav
const isVideoSelected = contentStore.isVideoSelected
const toggleVideoSelection = contentStore.toggleVideoSelection
const selectedIsAlbum = computed(() => (selectedProgram.value?.kind ?? 'column') === 'album')
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
    const canonical: ProgramInfo = {
      ...sourceProgram,
      ...(sourceProgram.listSource ? { listSource: { ...sourceProgram.listSource } } : {})
    }
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
})
// How many videos in the current program/month (or album) are selected. Shown
// next to the cross-program `selectedCount` so users can see both scopes.
const currentListSelectedCount = computed(() =>
  videos.value.filter(v => contentStore.isVideoSelected(v)).length
)
const selectionSource = computed(() => selectedProgram.value?.name || (viewMode.value === 'single' ? '单个视频' : '其他视频'))

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
  if (isEditingTarget()) return
  if (e.key === 'F5') { e.preventDefault(); if (selectedProgram.value) loadVideos(true); return }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); if (filteredVideos.value.length > 0) contentStore.toggleSelectAllFiltered(!allSelected.value); return }
  if (isProgramDeleteKey(e.key, isMac) && selectedProgram.value) { e.preventDefault(); deleteProgram(selectedProgram.value) }
}

onMounted(async () => {
  programs.value = await window.cctvdlApi.getPrograms()
  singleVideos.value = await window.cctvdlApi.getSingleVideos()
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
})

onUnmounted(() => {
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
        const videos = await window.cctvdlApi.resolveVideoBatch(url, settings.quality)
        if (videos.length === 0) throw columnErr
        if (videos.length === 1) {
          await addAndShowSingleVideo(videos[0])
        } else {
          let added = 0
          for (const v of videos) {
            if (await window.cctvdlApi.addSingleVideo(v)) added++
          }
          singleVideos.value = await window.cctvdlApi.getSingleVideos()
          videos.value = singleVideos.value
          viewMode.value = 'single'
          selectedProgram.value = null
          contentStore.clearAllSelection()
          selectedVideo.value = videos[0]
          coverError.value = false
          coverLoading.value = true
          importUrl.value = ''
          importSuccess.value = true
          setTimeout(() => { importSuccess.value = false }, 800)
          ElMessage.success(added > 0 ? `已导入 ${added} 个视频` : `已在单个视频列表：${videos.length} 个视频`)
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
  viewMode.value = 'single'
  selectedProgram.value = null
  selectedVideo.value = null
  searchQuery.value = ''
  debouncedSearch.value = ''
  contentStore.clearAllSelection()
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
  if (selectedVideo.value?.guid === v.guid) selectedVideo.value = null
}

async function deleteProgram(row: ProgramInfo) {
  try {
    await ElMessageBox.confirm(`确定删除栏目「${row.name}」吗？`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
    })
    await window.cctvdlApi.deleteProgram(row.columnId)
    programs.value = await window.cctvdlApi.getPrograms()
    contentStore.clearAllSelection()
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
    contentStore.clearAllSelection()
    ElMessage.success('已清空')
  } catch { /* cancelled */ }
}

async function loadVideos(forceRefresh = false) {
  if (!selectedProgram.value) return
  const requestId = videoLoadGuard.begin()
  loadingVideos.value = true
  albumLoadedCount.value = 0
  if (selectedIsAlbum.value) videos.value = []
  contentStore.refreshDownloadedSet()
  try {
    const program: ProgramInfo = {
      ...selectedProgram.value,
      ...(selectedProgram.value.listSource
        ? { listSource: { ...selectedProgram.value.listSource } }
        : {})
    }
    const list = await window.cctvdlApi.listVideos(
      program, selectedIsAlbum.value ? '' : selectedMonth.value, requestId, forceRefresh
    )
    if (!videoLoadGuard.isCurrent(requestId)) return
    videos.value = selectedIsAlbum.value ? sortAlbumList(list) : list
    // Only drop the preview if its video is no longer in the freshly loaded
    // list (e.g. deleted from the server). Otherwise preserve so users can
    // browse months without losing their preview context.
    if (selectedVideo.value && !list.some(v => v.guid === selectedVideo.value?.guid)) {
      selectedVideo.value = null
    }
    if (!selectedIsAlbum.value) contentStore.recordVideosLoaded(selectedMonth.value, list)
  } catch (err) {
    if (videoLoadGuard.isCurrent(requestId)) ElMessage.error(`加载失败：${humanizeError(String(err))}`)
  } finally {
    if (videoLoadGuard.isCurrent(requestId)) loadingVideos.value = false
  }
}

function sortAlbumList(list: VideoInfo[]): VideoInfo[] {
  const direction = albumSort.value === 'asc' ? 1 : -1
  return list
    .map((video, index) => ({ video, index }))
    .sort((a, b) => {
      // Undated entries cannot participate in chronological ordering. Keep
      // them stable at the end in both ascending and descending modes.
      if (!a.video.time && !b.video.time) return a.index - b.index
      if (!a.video.time) return 1
      if (!b.video.time) return -1
      const byTime = a.video.time.localeCompare(b.video.time)
      return byTime === 0 ? a.index - b.index : direction * byTime
    })
    .map(({ video }) => video)
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

// Selected items: auto-open only for single videos (column partial selections don't).
async function downloadSelected() { await downloadVideos(allSelectedVideos.value, viewMode.value === 'single', true) }

// 下载本月（仅栏目）：始终下载当前月份的完整列表，不受搜索过滤或其他
// 栏目、月份的已选项影响；这是「全量下载」意图，会触发自动打开文件夹。
async function downloadAll() {
  await downloadVideos(videos.value, true)
}

const startingDownload = ref(false)

async function downloadVideos(videoList: VideoInfo[], autoOpen = false, consumeSelection = false) {
  if (startingDownload.value) return
  if (!videoList.length) return
  const validVideos = videoList.filter(v => v.guid)
  if (!validVideos.length) { ElMessage.warning('选中的视频链接无效'); return }
  startingDownload.value = true
  try {
    const settings = await window.cctvdlApi.getSettings()
    const jobs: DownloadJob[] = validVideos.map(v => {
      const job: DownloadJob = {
        id: crypto.randomUUID(), guid: v.guid, sourceUrl: v.sourceUrl ?? v.guid, title: v.title,
        savePath: buildOutputPath(settings.savePath, v.title),
        quality: settings.quality, threadCount: settings.threadCount,
        reencode: settings.reencode ?? false,
        state: 'Created' as const, stage: 'None' as const, progressPercent: 0
      }
      if (v.m3u8Url) job.m3u8Url = v.m3u8Url
      if (v.sourceVideoIndex != null) job.sourceVideoIndex = v.sourceVideoIndex
      return job
    })
    if (jobs.length > 1) {
      try {
        await ElMessageBox.confirm(
          `将下载 ${jobs.length} 个视频\n清晰度：${QUALITY_LABELS[settings.quality]}\n保存到：${settings.savePath}`,
          '确认下载',
          { confirmButtonText: '加入队列', cancelButtonText: '返回检查', type: 'info' }
        )
      } catch {
        return
      }
    }
    // The button explicitly says “重新下载” only when every selected item is
    // already in history. In that case bypass history, while the coordinator's
    // active-guid dedupe still protects any job currently in flight.
    const result = await window.cctvdlApi.startDownload(jobs, autoOpen, consumeSelection && allSelectedDownloaded.value)
    if (consumeSelection) contentStore.removeVideoSelections(validVideos.map(v => v.guid))
    if (result.added > 0) {
      ElMessage.success(`已添加 ${result.added} 个下载任务${result.skipped ? `，忽略 ${result.skipped} 个重复或已下载项` : ''}`)
    } else {
      ElMessage.info('所选视频已下载或已在下载队列中')
    }
  } catch (err) { ElMessage.error(`下载失败：${humanizeError(String(err))}`) }
  finally { startingDownload.value = false }
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
@keyframes spin { to { transform: rotate(360deg); } }

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
  font-size: 12px;
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

.footer-btn-clear {
  border: 1px solid transparent;
  background: transparent;
  color: var(--el-color-danger);
  padding: 0 6px;
}
.footer-btn-clear:hover { background: var(--el-color-danger-light-9); }

.selected-videos-panel { max-height: 300px; overflow: auto; padding: 2px; }
.selected-videos-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--app-border-subtle);
}
.selected-videos-title { font-size: 14px; font-weight: var(--app-font-weight-semibold); color: var(--el-text-color-primary); }
.selected-videos-count { font-size: 12px; color: var(--el-text-color-secondary); }
.selected-video-group + .selected-video-group { margin-top: 12px; }
.selected-video-group-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 4px 4px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: var(--app-font-weight-medium);
}
.selected-video-group-name span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-video-row { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 2px 4px 2px 8px; border-radius: 6px; }
.selected-video-row:hover { background: var(--el-fill-color-light); }
.selected-video-row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-video-row button { width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; font-size: 17px; line-height: 1; }
.selected-video-row button:hover { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }

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
  letter-spacing: 0.2px;
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
