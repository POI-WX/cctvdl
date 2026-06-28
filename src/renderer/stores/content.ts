import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProgramInfo, VideoInfo } from '../../shared/types'
import { sortPrograms } from '../../shared/programs'
import { filterVideos } from '../../shared/video-filter'
import { recordMonthResult } from '../../shared/month-tracker'

export const useContentStore = defineStore('content', () => {
  const programs = ref<ProgramInfo[]>([])
  const singleVideos = ref<VideoInfo[]>([])
  const videos = ref<(VideoInfo & { selected?: boolean })[]>([])
  const viewMode = ref<'column' | 'single'>('column')
  const selectedProgram = ref<ProgramInfo | null>(null)
  const selectedVideo = ref<VideoInfo | null>(null)
  const selectedMonth = ref('')
  const downloadedSet = ref<Set<string>>(new Set())
  const newContentMap = ref<Map<string, number>>(new Map())
  const emptyMonths = ref<Set<string>>(new Set())
  const programQuery = ref('')
  const searchQuery = ref('')
  const debouncedSearch = ref('')

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
    // Single pass: partition into favs and others simultaneously
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
  const allSelected = computed(() => filteredVideos.value.length > 0 && filteredVideos.value.every(v => v.selected))
  const selectedVideos = computed(() => videos.value.filter(v => v.selected))
  const downloadedCount = computed(() => videos.value.filter(v => downloadedSet.value.has(v.guid)).length)
  const allSelectedDownloaded = computed(() =>
    selectedVideos.value.length > 0 && selectedVideos.value.every(v => downloadedSet.value.has(v.guid))
  )
  const emptyHint = computed(() => {
    if (viewMode.value === 'single') return videos.value.length ? '没有匹配的视频' : '粘贴单个视频链接添加'
    return videos.value.length ? '没有匹配的视频' : '该月份暂无视频'
  })
  const groupedVideos = computed(() => {
    const groups: Array<{ date: string; items: typeof filteredVideos.value }> = []
    for (const v of filteredVideos.value) {
      const date = v.time || ''
      const last = groups[groups.length - 1]
      if (last && last.date === date) last.items.push(v)
      else groups.push({ date, items: [v] })
    }
    return groups
  })

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

  return {
    programs, singleVideos, videos, viewMode, selectedProgram, selectedVideo,
    selectedMonth, downloadedSet, newContentMap, emptyMonths,
    programQuery, searchQuery, debouncedSearch,
    isFav, filteredPrograms, displayRows,
    filteredVideos, allSelected, selectedVideos, downloadedCount, allSelectedDownloaded,
    emptyHint, groupedVideos,
    refreshDownloadedSet, recordVideosLoaded, clearEmptyMonths, applyNewContent, clearNewContent
  }
})
