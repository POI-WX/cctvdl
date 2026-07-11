import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProgramInfo, VideoInfo } from '../../shared/types'
import { sortPrograms } from '../../shared/programs'
import { filterVideos } from '../../shared/video-filter'
import { recordMonthResult } from '../../shared/month-tracker'

interface SelectedVideoEntry {
  video: VideoInfo
  source: string
}

export const useContentStore = defineStore('content', () => {
  // ─── Persisted / long-lived refs ───────────────────────────────────────
  const programs = ref<ProgramInfo[]>([])
  const singleVideos = ref<VideoInfo[]>([])
  // Currently displayed video list (driven by selectedProgram + selectedMonth,
  // or by singleVideos when viewMode === 'single'). Plain VideoInfo — no
  // per-item selection flag. Selection lives in selectedVideoMap below so it
  // survives month switches (the old "videos.value = list.map(v => ({...v,
  // selected: false}))" pattern wiped cross-month selection on every switch).
  const videos = ref<VideoInfo[]>([])
  const viewMode = ref<'column' | 'single'>('column')
  const selectedProgram = ref<ProgramInfo | null>(null)
  const selectedVideo = ref<VideoInfo | null>(null)
  const selectedMonth = ref('')
  const downloadedSet = ref<Set<string>>(new Set())
  const newContentMap = ref<Map<string, number>>(new Map())
  const emptyMonths = ref<Set<string>>(new Set())
  // Cross-month and cross-program selection. Keyed by guid so selections stay
  // intact while users switch months or programs before batch downloading.
  const selectedVideoMap = ref<Map<string, SelectedVideoEntry>>(new Map())
  const programQuery = ref('')
  const searchQuery = ref('')
  const debouncedSearch = ref('')

  // ─── Derived state ─────────────────────────────────────────────────────
  const isFav = (p: ProgramInfo) => p.favoritedAt != null
  const sortedPrograms = computed(() => sortPrograms(programs.value))
  const filteredPrograms = computed(() => {
    const q = programQuery.value.trim().toLowerCase()
    if (!q) return sortedPrograms.value
    return sortedPrograms.value.filter(p => p.name.toLowerCase().includes(q))
  })

  type ProgramRow =
    | { type: 'header'; label: string; key: string; program?: undefined }
    | { type: 'item'; label?: undefined; key: string; program: ProgramInfo }

  const displayRows = computed<ProgramRow[]>(() => {
    const list = filteredPrograms.value
    if (programQuery.value.trim()) return list.map(p => ({ type: 'item' as const, program: p, key: p.columnId }))
    const favs: ProgramInfo[] = []
    const others: ProgramInfo[] = []
    for (const p of list) { if (isFav(p)) favs.push(p); else others.push(p) }
    if (!favs.length) return others.map(p => ({ type: 'item' as const, program: p, key: p.columnId }))
    const rows: ProgramRow[] = [{ type: 'header', label: '⭐ 收藏', key: '__hdr_fav' }]
    for (const p of favs) rows.push({ type: 'item', program: p, key: p.columnId })
    rows.push({ type: 'header', label: '全部栏目', key: '__hdr_all' })
    for (const p of others) rows.push({ type: 'item', program: p, key: p.columnId })
    return rows
  })

  const filteredVideos = computed(() => filterVideos(videos.value, debouncedSearch.value))
  // Per-video predicate (used by template checkboxes). Reads from the map so
  // a video checked in June still renders as checked after the user visits
  // July and returns to June.
  const isVideoSelected = (v: VideoInfo) => selectedVideoMap.value.has(v.guid)
  // Cross-month / cross-program accumulation. Drives "下载选中" — this is what
  // actually gets sent to the download pipeline.
  const allSelectedVideos = computed(() => Array.from(selectedVideoMap.value.values(), entry => entry.video))
  const selectedVideoGroups = computed(() => {
    const groups = new Map<string, VideoInfo[]>()
    for (const { video, source } of selectedVideoMap.value.values()) {
      const list = groups.get(source) ?? []
      list.push(video)
      groups.set(source, list)
    }
    return Array.from(groups, ([name, videos]) => ({ name, videos }))
  })
  const selectedCount = computed(() => selectedVideoMap.value.size)
  const allSelected = computed(() =>
    filteredVideos.value.length > 0
    && filteredVideos.value.every(v => selectedVideoMap.value.has(v.guid))
  )
  const downloadedCount = computed(() => videos.value.filter(v => downloadedSet.value.has(v.guid)).length)
  const allSelectedDownloaded = computed(() =>
    allSelectedVideos.value.length > 0 && allSelectedVideos.value.every(v => downloadedSet.value.has(v.guid))
  )
  const emptyHint = computed(() => {
    if (viewMode.value === 'single') return videos.value.length ? '没有匹配的视频' : '粘贴单个视频链接添加'
    if ((selectedProgram.value?.kind ?? 'column') === 'album') return videos.value.length ? '没有匹配的视频' : '暂无选集'
    return videos.value.length ? '没有匹配的视频' : '该月份暂无视频'
  })
  const groupedVideos = computed(() => {
    const groups: Array<{ date: string; items: typeof filteredVideos.value }> = []
    for (const v of filteredVideos.value) {
      const date = (v.time || '').slice(0, 10)
      const last = groups[groups.length - 1]
      if (last && last.date === date) last.items.push(v)
      else groups.push({ date, items: [v] })
    }
    return groups
  })

  // ─── Actions ───────────────────────────────────────────────────────────
  async function refreshDownloadedSet() {
    try {
      const history = await window.cctvdlApi.getDownloadHistory()
      downloadedSet.value = new Set(history.map(e => e.guid))
    } catch { /* best-effort */ }
  }

  function recordVideosLoaded(month: string, list: VideoInfo[]) {
    emptyMonths.value = recordMonthResult(emptyMonths.value, month, list.length === 0)
  }

  function clearEmptyMonths() {
    emptyMonths.value = new Set()
  }

  function applyNewContent(columnId: string, count: number) {
    const next = new Map(newContentMap.value)
    next.set(columnId, count)
    newContentMap.value = next
  }

  function clearNewContent(columnId: string) {
    if (!newContentMap.value.has(columnId)) return
    const next = new Map(newContentMap.value)
    next.delete(columnId)
    newContentMap.value = next
  }

  // Toggle one video's membership in the cross-month selection map.
  // Idempotent and safe to call from any view mode (single mode is no-op in
  // practice because singleVideos don't typically go through this flow, but
  // the function handles it correctly if called).
  function toggleVideoSelection(v: VideoInfo, source = '') {
    const next = new Map(selectedVideoMap.value)
    if (next.has(v.guid)) {
      next.delete(v.guid)
    } else {
      next.set(v.guid, { video: v, source: source || '其他视频' })
    }
    selectedVideoMap.value = next
  }

  function removeVideoSelection(guid: string) {
    if (!selectedVideoMap.value.has(guid)) return
    const next = new Map(selectedVideoMap.value)
    next.delete(guid)
    selectedVideoMap.value = next
  }

  function removeVideoSelections(guids: Iterable<string>) {
    const next = new Map(selectedVideoMap.value)
    let changed = false
    for (const guid of guids) changed = next.delete(guid) || changed
    if (changed) selectedVideoMap.value = next
  }

  // Select / deselect every video in the current filtered list. Used by the
  // header checkbox. Operates on filteredVideos so search results can be
  // bulk-selected without touching hidden rows.
  function toggleSelectAllFiltered(select: boolean) {
    const next = new Map(selectedVideoMap.value)
    for (const v of filteredVideos.value) {
      if (select) {
        next.set(v.guid, { video: v, source: selectedProgram.value?.name || '其他视频' })
      } else {
        next.delete(v.guid)
      }
    }
    selectedVideoMap.value = next
  }

  // Drop every entry from the selection map. Called when entering the separate
  // single-video collection and can also be exposed as a "清空选择" action.
  function clearAllSelection() {
    if (selectedVideoMap.value.size === 0) return
    selectedVideoMap.value = new Map()
  }

  function markDownloaded(guid: string) {
    if (!guid || downloadedSet.value.has(guid)) return
    const next = new Set(downloadedSet.value)
    next.add(guid)
    downloadedSet.value = next
  }

  return {
    programs, singleVideos, videos, viewMode, selectedProgram, selectedVideo,
    selectedMonth, downloadedSet, newContentMap, emptyMonths, selectedVideoMap,
    programQuery, searchQuery, debouncedSearch,
    isFav, filteredPrograms, displayRows,
    filteredVideos, isVideoSelected, allSelectedVideos, selectedVideoGroups, selectedCount,
    allSelected, downloadedCount, allSelectedDownloaded,
    emptyHint, groupedVideos,
    refreshDownloadedSet, recordVideosLoaded, clearEmptyMonths, applyNewContent, clearNewContent,
    toggleVideoSelection, removeVideoSelection, removeVideoSelections, toggleSelectAllFiltered, clearAllSelection, markDownloaded
  }
})
