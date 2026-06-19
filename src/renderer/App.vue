<template>
  <div
    class="app-root"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- sidebar -->
    <aside class="app-sidebar" :class="{ expanded: sidebarExpanded }">
      <button class="sidebar-brand" title="关于 cctvdl" @click="aboutOpen = true">
        <div class="sidebar-logo-wrap">
          <span class="sidebar-logo">📺</span>
        </div>
        <span class="sidebar-app-name">cctvdl</span>
      </button>

      <nav class="sidebar-nav" role="navigation" aria-label="主导航">
        <button
          v-for="tab in tabs"
          :key="tab.name"
          class="sidebar-nav-item"
          :class="{ active: activeTab === tab.name }"
          :aria-current="activeTab === tab.name ? 'page' : undefined"
          :title="`${tab.label}  [${tab.shortcut}]`"
          @click="activeTab = tab.name"
        >
          <span class="sidebar-nav-icon" aria-hidden="true">{{ tab.icon }}</span>
          <span class="sidebar-nav-label">{{ tab.label }}</span>
          <!-- download badge -->
          <span
            v-if="tab.name === 'download' && downloadBadge"
            class="sidebar-nav-badge"
            :class="downloadBadgeType"
          >{{ downloadBadge }}</span>
        </button>
      </nav>

      <!-- status footer -->
      <div class="sidebar-status" :class="{ visible: !!statusMessage }">
        <span class="sidebar-status-dot" :class="statusType" />
        <span class="sidebar-status-text">{{ statusMessage }}</span>
      </div>

      <!-- collapse toggle -->
      <button
        class="sidebar-toggle"
        :title="sidebarExpanded ? '收起导航' : '展开导航'"
        @click="toggleSidebar"
      >{{ sidebarExpanded ? '◀' : '▶' }}</button>
    </aside>

    <!-- drag overlay -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="drag-overlay-inner">
        <span class="drag-overlay-icon">🔗</span>
        <span class="drag-overlay-text">松手导入央视链接</span>
      </div>
    </div>

    <!-- main content -->
    <main class="app-content">
      <!-- DownloadPage always mounted (v-show) so in-flight jobs aren't lost on tab switch -->
      <DownloadPage v-show="activeTab === 'download'" />
      <Transition name="page-fade" mode="out-in">
        <HomePage v-if="activeTab === 'home'" ref="homePageRef" />
        <SettingsPage v-else-if="activeTab === 'settings'" />
      </Transition>
    </main>

    <!-- about modal -->
    <Transition name="about-fade">
      <div v-if="aboutOpen" class="about-overlay" @click.self="aboutOpen = false">
        <div class="about-card">
          <button class="about-close" @click="aboutOpen = false" title="关闭">✕</button>
          <div class="about-logo">📺</div>
          <div class="about-name">cctvdl</div>
          <div class="about-version">v{{ appVersion }}</div>
          <div class="about-desc">将央视节目轻松下载到本地</div>
          <div class="about-divider" />
          <div class="about-feat">批量下载 · 高清画质 · 断点续传</div>
          <div class="about-feat">开箱即用，无需额外配置</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import HomePage from './pages/HomePage.vue'
import DownloadPage from './pages/DownloadPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import type { BatchResult, DownloadProgress } from '../shared/types'

const activeTab = ref('home')
const statusMessage = ref('')
const statusType = ref<'success' | 'error' | ''>('')
const homePageRef = ref<InstanceType<typeof HomePage> | null>(null)
const isDragging = ref(false)
const aboutOpen = ref(false)
const sidebarExpanded = ref(localStorage.getItem('cctvdl-sidebar-expanded') === 'true')
const appVersion = __APP_VERSION__ // replaced by vite define at build/dev time

function toggleSidebar() {
  sidebarExpanded.value = !sidebarExpanded.value
  localStorage.setItem('cctvdl-sidebar-expanded', String(sidebarExpanded.value))
}

const activeDownloads = ref(0)
const downloadBadge = computed(() => activeDownloads.value > 0 ? String(activeDownloads.value) : '')
const downloadBadgeType = computed(() => activeDownloads.value > 0 ? 'active' : '')

const tabs = [
  { name: 'home', label: '首页', icon: '🏠', shortcut: '1' },
  { name: 'download', label: '下载', icon: '⬇️', shortcut: '2' },
  { name: 'settings', label: '设置', icon: '⚙️', shortcut: '3' },
]

let cleanups: Array<() => void> = []

function onKeydown(e: KeyboardEvent) {
  // Escape closes the about modal
  if (e.key === 'Escape' && aboutOpen.value) { aboutOpen.value = false; return }
  // 1/2/3 switch tabs when no input is focused
  if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === '1') activeTab.value = 'home'
  else if (e.key === '2') activeTab.value = 'download'
  else if (e.key === '3') activeTab.value = 'settings'
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  cleanups.push(window.cctvdlApi.onBatchFinished((result: BatchResult) => {
    activeDownloads.value = 0
    if (result.failed > 0) {
      statusMessage.value = `完成 ${result.completed}，失败 ${result.failed}`
      statusType.value = 'error'
    } else if (result.completed > 0) {
      statusMessage.value = `${result.completed} 个下载完成`
      statusType.value = 'success'
      setTimeout(() => { statusMessage.value = ''; statusType.value = '' }, 6000)
    }
  }))

  cleanups.push(window.cctvdlApi.onDownloadProgress((p: DownloadProgress) => {
    if (p.batchTotal != null && p.batchCompleted != null) {
      const remaining = p.batchTotal - p.batchCompleted
      activeDownloads.value = remaining > 0 ? remaining : 0
    }
  }))
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  cleanups.forEach(fn => fn())
  cleanups = []
})

let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
  isDragging.value = true
}

function onDragLeave() {
  dragLeaveTimer = setTimeout(() => { isDragging.value = false }, 100)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const text = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text/uri-list') || ''
  if (/cctv\.com|cntv\.cn/i.test(text)) {
    activeTab.value = 'home'
    nextTick(() => homePageRef.value?.handleDropImport(text.trim()))
  } else {
    ElMessage.warning('仅支持央视节目链接')
  }
}
</script>

<style scoped>
/* ── 根布局：左侧栏 + 内容区 ───────────────────── */
.app-root {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--el-bg-color);
}

/* ── 左侧导航栏 ───────────────────────────────── */
.app-sidebar {
  width: 76px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--app-spacing-md) 0 var(--app-spacing-sm);
  gap: 0;
  background: var(--app-bg-sidebar);
  border-right: 1px solid var(--app-border-subtle);
  -webkit-app-region: drag;
  user-select: none;
  transition: width .2s ease;
  overflow: hidden;
}

/* 展开状态 */
.app-sidebar.expanded {
  width: 160px;
  align-items: stretch;
}

.app-sidebar.expanded .sidebar-brand {
  flex-direction: row;
  justify-content: flex-start;
  padding: var(--app-spacing-sm) var(--app-spacing-md);
  margin-bottom: var(--app-spacing-md);
}

.app-sidebar.expanded .sidebar-nav { align-items: stretch; }

.app-sidebar.expanded .sidebar-nav-item {
  flex-direction: row;
  width: auto;
  height: 40px;
  padding: 0 var(--app-spacing-md);
  justify-content: flex-start;
  gap: var(--app-spacing-md);
  border-radius: 0;
}

.app-sidebar.expanded .sidebar-nav-item.active::before {
  left: 0;
  top: 0;
  bottom: 0;
  transform: none;
  width: 3px;
  height: auto;
  border-radius: 0 2px 2px 0;
}

.app-sidebar.expanded .sidebar-status {
  flex-direction: row;
  max-width: none;
  padding: 0 var(--app-spacing-md);
  text-align: left;
}

.app-sidebar.expanded .sidebar-toggle {
  align-self: flex-start;
  margin-left: var(--app-spacing-md);
}

.app-sidebar.expanded .sidebar-nav-label { font-size: 13px; }

.sidebar-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--app-spacing-xl);
  -webkit-app-region: no-drag;
  padding-top: var(--app-spacing-sm);
  /* button reset */
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: var(--el-font-family);
  border-radius: var(--el-border-radius-base);
  transition: opacity .15s;
}

.sidebar-brand:hover { opacity: .75; }

.sidebar-logo-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-logo { font-size: 18px; line-height: 1; }

.sidebar-app-name {
  font-size: 10px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-text-color-secondary);
  letter-spacing: 1px;
  text-transform: uppercase;
}

/* 导航项列表 */
.sidebar-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--app-spacing-xs);
  flex: 1;
  -webkit-app-region: no-drag;
}

.sidebar-nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: var(--el-border-radius-large);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: var(--app-font-weight-medium);
  font-family: var(--el-font-family);
  cursor: pointer;
  transition: background .15s, color .15s;
}

.sidebar-nav-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.sidebar-nav-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

/* 活动指示条（左侧） */
.sidebar-nav-item.active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 2px 2px 0;
  background: var(--el-color-primary);
}

.sidebar-nav-icon { font-size: 20px; line-height: 1; }
.sidebar-nav-label { font-size: 10px; line-height: 1; }

/* 下载徽章 */
.sidebar-nav-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: var(--app-font-weight-bold);
  line-height: 16px;
  text-align: center;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.sidebar-nav-badge.active {
  background: var(--el-color-primary);
  color: #fff;
  animation: badge-pulse 2s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .7; }
}

/* 状态区（底部） */
.sidebar-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0 var(--app-spacing-sm);
  font-size: 10px;
  color: var(--el-text-color-secondary);
  text-align: center;
  opacity: 0;
  transition: opacity .3s;
  max-width: 68px;
  -webkit-app-region: no-drag;
}

.sidebar-status.visible { opacity: 1; }

.sidebar-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--el-text-color-placeholder);
}

.sidebar-status-dot.success { background: var(--el-color-success); }
.sidebar-status-dot.error   { background: var(--el-color-danger); }

.sidebar-status-text {
  overflow: hidden;
  word-break: break-all;
  line-height: 1.4;
}

/* 展开/折叠按钮 */
.sidebar-toggle {
  margin-top: var(--app-spacing-sm);
  margin-bottom: var(--app-spacing-sm);
  width: 28px;
  height: 28px;
  border: 1px solid var(--app-border-subtle);
  border-radius: 50%;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .12s;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.sidebar-toggle:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

/* ── 主内容区 ─────────────────────────────────── */
.app-content {
  flex: 1;
  overflow: hidden;
  background: var(--el-bg-color);
  position: relative;
}

/* 拖拽遮罩 */
.drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(37, 99, 235, .12);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  border: 3px dashed var(--el-color-primary);
  border-radius: 12px;
  margin: 6px;
  box-sizing: border-box;
  animation: drag-pulse .6s ease-in-out infinite alternate;
}

@keyframes drag-pulse {
  from { border-color: var(--el-color-primary); background: rgba(37,99,235,.10); }
  to   { border-color: var(--el-color-primary-light-3); background: rgba(37,99,235,.18); }
}

.drag-overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--app-spacing-md);
}

.drag-overlay-icon { font-size: 48px; }

.drag-overlay-text {
  font-size: 18px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-color-primary);
}

/* 页面切换过渡 */
.page-fade-enter-active,
.page-fade-leave-active { transition: opacity .15s ease; }
.page-fade-enter-from,
.page-fade-leave-to { opacity: 0; }

/* About 浮层 */
.about-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, .45);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.about-card {
  position: relative;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--app-border-subtle);
  border-radius: 16px;
  box-shadow: var(--app-shadow-lg);
  padding: 32px 40px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 260px;
  text-align: center;
}

.about-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .12s;
}
.about-close:hover { background: var(--el-fill-color); }

.about-logo { font-size: 48px; line-height: 1; margin-bottom: 4px; }
.about-name  { font-size: 20px; font-weight: var(--app-font-weight-bold); color: var(--el-text-color-primary); }
.about-version { font-size: 12px; color: var(--el-color-primary); font-weight: var(--app-font-weight-semibold); }
.about-desc  { font-size: 13px; color: var(--el-text-color-secondary); margin-top: 2px; }

.about-divider {
  width: 100%;
  height: 1px;
  background: var(--app-border-subtle);
  margin: 10px 0 6px;
}

.about-feat {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}

.about-fade-enter-active,
.about-fade-leave-active { transition: opacity .2s ease; }
.about-fade-enter-from,
.about-fade-leave-to { opacity: 0; }
</style>
