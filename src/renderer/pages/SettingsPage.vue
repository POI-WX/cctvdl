<template>
  <div class="settings-page">
    <div class="settings-inner">

      <!-- header -->
      <div class="settings-header">
        <h1 class="settings-title">设置</h1>
      </div>

      <!-- section: download -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-icon">⬇️</span>
          <span class="settings-card-title">下载</span>
        </div>

        <!-- save path -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">文件保存位置</span>
            <span class="settings-item-desc">下载的视频文件将保存到此目录</span>
          </div>
          <div class="settings-item-control path-control">
            <el-input
              :model-value="displayPath(form.savePath)"
              readonly size="small" class="path-input"
              :title="form.savePath"
            />
            <button class="browse-btn" @click="selectDir">浏览…</button>
          </div>
        </div>

        <!-- thread count -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">并发下载数</span>
            <span class="settings-item-desc">单个视频内部的并行线程数，调高可加速下载，但会增加 CPU 占用</span>
            <span class="settings-item-hint" :class="threadHintClass">{{ threadHint }}</span>
          </div>
          <div class="settings-item-control thread-control">
            <el-slider
              v-model="form.threadCount"
              :min="MIN_THREADS"
              :max="MAX_THREADS"
              :step="1"
              class="thread-slider"
            />
            <span class="thread-value">{{ form.threadCount }}</span>
          </div>
        </div>

        <!-- concurrent videos -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">并行下载视频数</span>
            <span class="settings-item-desc">同时下载的视频数，每路线程数自动均分，总并发保持不变，建议不超过 2</span>
          </div>
          <div class="settings-item-control thread-control">
            <el-slider
              v-model="form.concurrentVideos"
              :min="MIN_CONCURRENT_VIDEOS"
              :max="MAX_CONCURRENT_VIDEOS"
              :step="1"
              class="thread-slider"
            />
            <span class="thread-value">{{ form.concurrentVideos ?? 1 }}</span>
          </div>
        </div>

        <!-- quality -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">视频清晰度</span>
            <span class="settings-item-desc">优先下载的画质档位，所选档位不可用时自动降级</span>
          </div>
          <div class="settings-item-control">
            <el-select v-model="form.quality" size="small" style="width: 160px">
              <el-option label="自动（最高画质）" value="auto" />
              <el-option label="蓝光 1080p" value="bluray" />
              <el-option label="超清 720p" value="chaoqing" />
              <el-option label="高清 720p" value="gaoqing" />
              <el-option label="标清 360p" value="biaoqing" />
              <el-option label="流畅 270p" value="liuchang" />
            </el-select>
          </div>
        </div>

        <!-- merge mode -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">合并方式</span>
            <span class="settings-item-desc">推荐使用无损快速；仅在视频播放异常时改用兼容重编码</span>
          </div>
          <div class="settings-item-control">
            <div class="radio-group">
              <label class="radio-option" :class="{ active: !form.reencode }">
                <input type="radio" :value="false" v-model="form.reencode" />
                <span class="radio-label">无损快速</span>
              </label>
              <label class="radio-option" :class="{ active: form.reencode }">
                <input type="radio" :value="true" v-model="form.reencode" />
                <span class="radio-label">兼容重编码</span>
              </label>
            </div>
          </div>
        </div>

        <!-- auto-open folder -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">下载完成后打开文件夹</span>
            <span class="settings-item-desc">批量下载或单视频下载完成后，自动在文件管理器中打开保存目录</span>
          </div>
          <div class="settings-item-control">
            <el-switch v-model="form.autoOpenFolder" />
          </div>
        </div>
      </div>

      <!-- section: appearance -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-icon">🎨</span>
          <span class="settings-card-title">外观</span>
        </div>

        <!-- dark mode -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">深色模式</span>
            <span class="settings-item-desc">切换后立即生效</span>
          </div>
          <div class="settings-item-control">
            <el-switch v-model="form.darkMode" @change="onDarkModeChange" />
          </div>
        </div>

        <!-- accent colour -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">主题色</span>
            <span class="settings-item-desc">点击色块立即切换，重启后保持</span>
          </div>
          <div class="settings-item-control">
            <div class="accent-swatches">
              <button
                v-for="c in ACCENT_COLORS"
                :key="c.value"
                class="accent-swatch"
                :class="{ active: accentColor === c.value }"
                :title="c.label"
                :style="{ background: c.value }"
                @click="setAccent(c.value)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- section: advanced -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-icon">⚙️</span>
          <span class="settings-card-title">高级</span>
        </div>

        <!-- clipboard auto-import -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">剪贴板自动导入</span>
            <span class="settings-item-desc">复制央视链接时弹窗提示是否导入，默认关闭</span>
          </div>
          <div class="settings-item-control">
            <el-switch v-model="form.clipboardWatch" />
          </div>
        </div>

        <!-- log level -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">日志级别</span>
            <span class="settings-item-desc">日常使用选「日常」；遇到问题时切换到「调试」可获取详细信息</span>
          </div>
          <div class="settings-item-control">
            <el-select v-model="form.logLevel" size="small" style="width: 140px">
              <el-option label="日常" value="info" />
              <el-option label="调试" value="debug" />
            </el-select>
          </div>
        </div>

        <!-- log directory -->
        <div class="settings-item">
          <div class="settings-item-label">
            <span class="settings-item-name">日志目录</span>
            <span class="settings-item-desc">失败记录文件的存放位置</span>
          </div>
          <div class="settings-item-control path-control">
            <el-input
              :model-value="displayPath(form.logPath)"
              readonly size="small" class="path-input"
              :title="form.logPath"
            />
            <button class="browse-btn" @click="selectLogDir">浏览…</button>
          </div>
        </div>
      </div>

      <!-- section: download history -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-icon">🕐</span>
          <span class="settings-card-title">下载历史</span>
          <span class="settings-card-count" v-if="history.length">{{ history.length }} 条</span>
        </div>

        <div class="settings-item" v-if="!history.length">
          <div class="settings-item-label">
            <span class="settings-item-name">暂无下载记录</span>
            <span class="settings-item-desc">已下载的视频会显示在这里</span>
          </div>
        </div>

        <div v-if="history.length" class="history-search">
          <el-input
            v-model="historyQuery"
            placeholder="搜索标题…"
            size="small"
            clearable
          />
        </div>

        <div v-if="history.length" class="history-list">
          <div v-if="!filteredHistory.length" class="history-empty">无匹配记录</div>
          <div v-for="entry in filteredHistory" :key="entry.guid" class="history-item">
            <div class="history-item-info">
              <span class="history-item-title" :title="entry.title || entry.guid">
                {{ entry.title || entry.guid }}
              </span>
              <span class="history-item-meta">
                <span v-if="entry.completedAt">{{ relativeTime(entry.completedAt) }}</span>
                <span v-if="entry.fileSize" class="history-item-sep">·</span>
                <span v-if="entry.fileSize">{{ formatFileSize(entry.fileSize) }}</span>
                <span v-if="entry.outputPath" class="history-item-sep">·</span>
                <span v-if="entry.outputPath" class="history-item-path" :title="entry.outputPath">
                  {{ entry.outputPath.split(/[\\/]/).pop() }}
                </span>
              </span>
            </div>
            <div class="history-item-actions">
              <button
                class="history-action-btn"
                title="重新下载"
                @click="redownload(entry)"
              >↺</button>
              <button
                v-if="entry.outputPath"
                class="history-action-btn"
                title="在文件管理器中定位"
                @click="revealHistoryFile(entry.outputPath)"
              >📂</button>
              <button
                class="history-action-btn danger"
                title="删除此条记录"
                @click="removeHistoryEntry(entry.guid)"
              >🗑</button>
            </div>
          </div>
        </div>

        <div v-if="history.length" class="settings-item history-footer">
          <div class="settings-item-label">
            <span class="settings-item-desc">清除后视频列表中的已下载标记将同步消失</span>
          </div>
          <div class="settings-item-control">
            <button class="browse-btn danger" @click="clearHistory">清除全部</button>
          </div>
        </div>
      </div>

      <!-- section: about -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-card-icon">ℹ️</span>
          <span class="settings-card-title">关于</span>
        </div>

        <div class="settings-about">
          <div class="about-logo">📺</div>
          <div class="about-info">
            <div class="about-name">cctvdl</div>
            <div class="about-version">v{{ appVersion }}</div>
            <div class="about-desc">将央视节目轻松下载到本地</div>
            <div class="about-note">批量下载 · 高清画质 · 断点续传，开箱即用。</div>
          </div>
        </div>
      </div>

      <!-- sticky save footer -->
      <div class="settings-save-footer">
        <Transition name="saved-fade">
          <span v-if="lastSaved" class="settings-last-saved">✓ {{ lastSaved }}</span>
        </Transition>
        <button class="settings-save-btn" @click="save">保存设置</button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, toRaw } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Settings } from '../../shared/types'
import { MIN_THREADS, MAX_THREADS, MIN_CONCURRENT_VIDEOS, MAX_CONCURRENT_VIDEOS } from '../../shared/settings'
import { applyAccentColor } from '../utils/accent'
import { displayPath } from '../../shared/path-display'
import { relativeTime, formatFileSize } from '../../shared/format'

const form = ref<Settings>({
  savePath: '', threadCount: 8, quality: 'auto',
  reencode: false, logLevel: 'info', darkMode: false, logPath: '', autoOpenFolder: false, clipboardWatch: false,
  concurrentVideos: 1
})

const history = ref<import('../../shared/types').HistoryEntry[]>([])
const historyQuery = ref('')
const filteredHistory = computed(() => {
  const q = historyQuery.value.trim().toLowerCase()
  if (!q) return history.value
  return history.value.filter(e => (e.title || e.guid).toLowerCase().includes(q))
})
const appVersion = __APP_VERSION__ // replaced by vite define at build/dev time
const lastSaved = ref('')

const threadHint = computed(() => {
  const n = form.value.threadCount
  if (n <= 2) return '🐢 轻量模式（低 CPU 占用）'
  if (n <= 5) return '⚖️ 均衡模式（推荐）'
  if (n <= 10) return '⚡ 高速模式'
  return '🔥 极限模式（可能影响系统响应）'
})

const threadHintClass = computed(() => {
  const n = form.value.threadCount
  if (n <= 2) return 'hint-slow'
  if (n <= 5) return 'hint-good'
  if (n <= 10) return 'hint-fast'
  return 'hint-extreme'
})

const ACCENT_COLORS = [
  { label: '品牌蓝（默认）', value: '#2563EB' },
  { label: '翡翠绿', value: '#059669' },
  { label: '紫罗兰', value: '#7C3AED' },
  { label: '玫瑰红', value: '#E11D48' },
  { label: '琥珀橙', value: '#D97706' },
  { label: '石板灰', value: '#475569' },
]

const ACCENT_STORAGE_KEY = 'cctvdl-accent-color'
const accentColor = ref(localStorage.getItem(ACCENT_STORAGE_KEY) || '#2563EB')

function setAccent(color: string) {
  accentColor.value = color
  localStorage.setItem(ACCENT_STORAGE_KEY, color)
  applyAccentColor(color)
}

onMounted(async () => {
  const loaded = await window.cctvdlApi.getSettings()
  form.value = { ...form.value, ...loaded }
  applyDarkMode(form.value.darkMode ?? false)
  applyAccentColor(accentColor.value)
  history.value = await window.cctvdlApi.getDownloadHistory()
})

function applyDarkMode(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
}

function onDarkModeChange(isDark: boolean) { applyDarkMode(isDark) }

async function selectDir() {
  const dir = await window.cctvdlApi.selectDirectory(form.value.savePath || undefined)
  if (dir) form.value.savePath = dir
}

async function selectLogDir() {
  const dir = await window.cctvdlApi.selectDirectory(form.value.logPath || undefined)
  if (dir) form.value.logPath = dir
}

async function clearHistory() {
  try {
    await ElMessageBox.confirm(
      `确定清除全部 ${history.value.length} 条下载历史吗？清除后视频列表中的「已下载」标记将消失。`,
      '清除下载历史',
      { confirmButtonText: '清除', cancelButtonText: '取消', type: 'warning' }
    )
    await window.cctvdlApi.clearDownloadHistory()
    history.value = []
    window.dispatchEvent(new CustomEvent('cctvdl:history-cleared'))
    ElMessage.success('下载历史已清除')
  } catch { /* cancelled */ }
}

async function removeHistoryEntry(guid: string) {
  await window.cctvdlApi.removeFromDownloadHistory(guid)
  history.value = history.value.filter(e => e.guid !== guid)
  window.dispatchEvent(new CustomEvent('cctvdl:history-cleared'))
}

function revealHistoryFile(outputPath: string) {
  window.cctvdlApi.revealFile(outputPath)
}

async function redownload(entry: import('../../shared/types').HistoryEntry) {
  const settings = await window.cctvdlApi.getSettings()
  if (!settings.savePath) { ElMessage.warning('请先在设置中配置保存位置'); return }
  const { buildOutputPath } = await import('../../shared/filename')
  const job: import('../../shared/types').DownloadJob = {
    id: crypto.randomUUID(),
    guid: entry.guid,
    sourceUrl: entry.guid,
    title: entry.title || entry.guid,
    savePath: buildOutputPath(settings.savePath, entry.title || entry.guid),
    quality: settings.quality,
    threadCount: settings.threadCount,
    reencode: settings.reencode ?? false,
    state: 'Created',
    stage: 'None',
    progressPercent: 0
  }
  // Use retryJob (skipHistory=true) so the history dedup filter is bypassed —
  // startDownload would silently skip it if the guid is still in history.
  await window.cctvdlApi.retryJob(job)
  ElMessage.success(`已添加到下载队列：${job.title}`)
}

async function save() {
  if (!form.value.savePath) { ElMessage.warning('请先设置文件保存位置'); return }
  await window.cctvdlApi.saveSettings(toRaw(form.value))
  const now = new Date()
  lastSaved.value = `已保存 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  ElMessage.success('保存成功')
}
</script>

<style scoped>
/* ── 页面 ──────────────────────────────────────────── */
.settings-page {
  height: 100%;
  overflow-y: auto;
  background: var(--el-bg-color);
}

.settings-inner {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--app-spacing-xl) var(--app-spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-lg);
}

/* ── 页头 ──────────────────────────────────────────── */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-header-right {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-md);
}

.settings-last-saved {
  font-size: 12px;
  color: var(--el-color-success);
  font-weight: var(--app-font-weight-medium);
}

.settings-save-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--app-spacing-md);
  padding: var(--app-spacing-sm) 0 var(--app-spacing-lg);
  border-top: 1px solid var(--app-border-subtle);
  margin-top: var(--app-spacing-md);
  position: sticky;
  bottom: 0;
  background: var(--app-bg-page);
}

.settings-save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 22px;
  border: none;
  border-radius: 18px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: var(--app-font-weight-semibold);
  font-family: var(--el-font-family);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(37, 99, 235, .3);
  transition: background .15s, box-shadow .15s, transform .15s;
}

.settings-save-btn:hover {
  background: var(--el-color-primary-dark-2);
  box-shadow: 0 4px 14px rgba(37, 99, 235, .4);
  transform: translateY(-1px);
}

.settings-save-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(37, 99, 235, .3);
}

.saved-fade-enter-active, .saved-fade-leave-active { transition: opacity .3s ease; }
.saved-fade-enter-from, .saved-fade-leave-to { opacity: 0; }

.settings-item-hint {
  font-size: 12px;
  font-weight: var(--app-font-weight-medium);
  margin-top: 2px;
}

.hint-slow    { color: var(--el-text-color-secondary); }
.hint-good    { color: var(--el-color-success); }
.hint-fast    { color: var(--el-color-primary); }
.hint-extreme { color: var(--el-color-danger); }

.settings-title {
  margin: 0;
  font-size: 20px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-text-color-primary);
}

/* ── 卡片 ──────────────────────────────────────────── */
.settings-card {
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--el-border-radius-large);
  background: var(--app-bg-card);
  box-shadow: var(--app-shadow-sm);
  overflow: hidden;
}

.settings-card-header {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  padding: var(--app-spacing-md) var(--app-spacing-lg);
  border-bottom: 1px solid var(--app-border-subtle);
  background: var(--el-fill-color-blank);
}

.settings-card-icon { font-size: 16px; line-height: 1; }

.settings-card-title {
  font-size: 13px;
  font-weight: var(--app-font-weight-semibold);
  color: var(--el-text-color-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── 设置项 ─────────────────────────────────────────── */
.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-spacing-xl);
  padding: var(--app-spacing-lg);
  border-bottom: 1px solid var(--app-border-subtle);
}

.settings-item:last-child { border-bottom: none; }

.settings-item-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.settings-item-name {
  font-size: 14px;
  font-weight: var(--app-font-weight-medium);
  color: var(--el-text-color-primary);
}

.settings-item-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.settings-item-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

/* 路径控件 */
.path-control { gap: var(--app-spacing-sm); max-width: 280px; width: 280px; }
.path-input { flex: 1; }

.browse-btn {
  padding: 5px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 12px;
  font-family: var(--el-font-family);
  cursor: pointer;
  white-space: nowrap;
  transition: all .12s;
}
.browse-btn:hover { background: var(--el-fill-color-light); }

.browse-btn.danger {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger-light-5);
}
.browse-btn.danger:hover {
  background: var(--el-color-danger-light-9);
}
.browse-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

/* 线程滑块 */
.thread-control { gap: var(--app-spacing-md); width: 220px; }
.thread-slider { flex: 1; }
.thread-value {
  font-size: 18px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-color-primary);
  min-width: 28px;
  text-align: right;
}

/* 主题色色板 */
.accent-swatches {
  display: flex;
  gap: var(--app-spacing-sm);
  align-items: center;
}

.accent-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform .15s, border-color .15s;
  outline: none;
}

.accent-swatch:hover { transform: scale(1.15); }
.accent-swatch.active { border-color: var(--el-text-color-primary); transform: scale(1.1); }

.radio-group { display: flex; gap: var(--app-spacing-sm); }

.radio-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  cursor: pointer;
  transition: all .12s;
  user-select: none;
}

.radio-option input[type="radio"] { display: none; }

.radio-option:hover { border-color: var(--el-color-primary-light-5); }

.radio-option.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.radio-label { font-size: 13px; font-weight: var(--app-font-weight-medium); }

/* 关于区 */
.settings-about {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-xl);
  padding: var(--app-spacing-xl);
}

.about-logo {
  font-size: 40px;
  flex-shrink: 0;
}

.about-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about-name {
  font-size: 18px;
  font-weight: var(--app-font-weight-bold);
  color: var(--el-text-color-primary);
}

.about-version {
  font-size: 12px;
  color: var(--el-color-primary);
  font-weight: var(--app-font-weight-medium);
}

.about-desc {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.about-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin-top: 4px;
}

.settings-card-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 1px 6px;
  border-radius: 10px;
}

.history-search {
  padding: var(--app-spacing-sm) var(--app-spacing-lg);
  border-bottom: 1px solid var(--app-border-subtle);
}

.history-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

.history-list {
  max-height: 320px;
  overflow-y: auto;
  border-bottom: 1px solid var(--app-border-subtle);
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  padding: 8px var(--app-spacing-lg);
  border-bottom: 1px solid var(--app-border-subtle);
  transition: background .1s;
}
.history-item:last-child { border-bottom: none; }
.history-item:hover { background: var(--el-fill-color-light); }

.history-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-item-title {
  font-size: 13px;
  font-weight: var(--app-font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.history-item-sep { opacity: .4; }

.history-item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.history-item-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.history-action-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  padding: 3px 5px;
  border-radius: 4px;
  opacity: .6;
  transition: opacity .12s, background .12s;
}
.history-action-btn:hover { opacity: 1; background: var(--el-fill-color); }
.history-action-btn.danger:hover { background: var(--el-color-danger-light-9); }

.history-footer {
  border-top: 1px solid var(--app-border-subtle);
}
</style>
