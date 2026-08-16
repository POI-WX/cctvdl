import { formatVideoTime } from './browse-data'

export interface PageResult<T> {
  items: T[]
  total: number
}

/** Read every available page while rejecting responses that cannot prove completeness. */
export async function collectAllPages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  pageSize: number,
  keyOf: (item: T) => string,
  onNewItems?: (items: T[]) => void
): Promise<T[]> {
  const result: T[] = []
  const seenItems = new Set<string>()
  const seenPages = new Set<string>()
  let reportedTotal = 0
  let receivedItems = 0

  for (let page = 1; ; page++) {
    const pageResult = await fetchPage(page)
    const items = pageResult.items
    reportedTotal = Math.max(reportedTotal, pageResult.total)
    if (!items.length) {
      if (reportedTotal > receivedItems) {
        throw new Error(`pagination ended on page ${page} before all ${reportedTotal} items were received`)
      }
      break
    }

    const keys = items.map(keyOf)
    const fingerprint = keys.join('\u0001')
    if (seenPages.has(fingerprint)) {
      if (reportedTotal > receivedItems) {
        throw new Error(`pagination repeated page ${page} before all ${reportedTotal} items were received`)
      }
      break
    }
    seenPages.add(fingerprint)
    receivedItems += items.length

    const newItems: T[] = []
    for (let i = 0; i < items.length; i++) {
      const key = keys[i]
      if (seenItems.has(key)) continue
      seenItems.add(key)
      result.push(items[i])
      newItems.push(items[i])
    }
    if (newItems.length) onNewItems?.(newItems)
    else if (reportedTotal > receivedItems) {
      throw new Error(`pagination made no progress on page ${page} before all ${reportedTotal} items were received`)
    } else break

    // Probe past a full reported boundary so an understated total cannot hide content.
    if (items.length < pageSize && receivedItems >= reportedTotal) break
  }
  return result
}

export function sortableVideoTime(value: unknown): string | null {
  const formatted = formatVideoTime(value)
  const match = formatted.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  )
  if (!match) return null
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1
    || date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3]
    || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) return null
  return `${year}${month}${day}${hour}${minute}${second}`
}

export function filterItemsByMonth<T>(items: T[], month: string, timeOf: (item: T) => unknown): T[] {
  return items.filter(item => sortableVideoTime(timeOf(item))?.startsWith(month))
}

interface DescendingPage<T> extends PageResult<T> {
  newestKey: string
  oldestKey: string
}

/**
 * Locate one month in a newest-first catalogue. Null means the declared total
 * or ordering is unsafe, so the caller must fall back to a complete scan.
 */
export async function locateMonthInDescendingPages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  pageSize: number,
  month: string,
  timeOf: (item: T) => unknown
): Promise<{ items: T[] | null; cachedFetch: (page: number) => Promise<PageResult<T>> }> {
  const rawCache = new Map<number, PageResult<T>>()
  const analysedCache = new Map<number, DescendingPage<T>>()
  const cachedFetch = async (page: number): Promise<PageResult<T>> => {
    let result = rawCache.get(page)
    if (!result) {
      result = await fetchPage(page)
      rawCache.set(page, result)
    }
    return result
  }
  const load = async (page: number): Promise<DescendingPage<T> | null> => {
    const cached = analysedCache.get(page)
    if (cached) return cached
    const result = await cachedFetch(page)
    if (!result.items.length) return null
    const keys = result.items.map(item => sortableVideoTime(timeOf(item)))
    if (keys.some(key => key == null)) return null
    const validKeys = keys as string[]
    for (let i = 1; i < validKeys.length; i++) {
      if (validKeys[i] > validKeys[i - 1]) return null
    }
    const analysed: DescendingPage<T> = {
      ...result,
      newestKey: validKeys[0],
      oldestKey: validKeys.at(-1)!
    }
    for (const [otherPage, other] of analysedCache) {
      if ((otherPage < page && other.oldestKey < analysed.newestKey)
        || (otherPage > page && analysed.oldestKey < other.newestKey)) return null
    }
    analysedCache.set(page, analysed)
    return analysed
  }

  const firstRaw = await cachedFetch(1)
  if (!firstRaw.items.length) return { items: firstRaw.total > 0 ? null : [], cachedFetch }
  const first = await load(1)
  if (!first) return { items: null, cachedFetch }
  const effectivePageSize = first.items.length
  const totalPages = Math.max(1, Math.ceil(Math.max(first.total, first.items.length) / effectivePageSize))

  const last = totalPages === 1 ? first : await load(totalPages)
  if (!last) return { items: null, cachedFetch }
  if (last.items.length >= pageSize) {
    const afterLast = await cachedFetch(totalPages + 1)
    if (afterLast.items.length) return { items: null, cachedFetch }
  }

  let low = 1
  let high = totalPages
  let firstCandidate = totalPages + 1
  while (low <= high) {
    const page = Math.floor((low + high) / 2)
    const current = await load(page)
    if (!current) return { items: null, cachedFetch }
    if (current.oldestKey.slice(0, 6) <= month) {
      firstCandidate = page
      high = page - 1
    } else low = page + 1
  }
  if (firstCandidate > totalPages) return { items: [], cachedFetch }

  const items: T[] = []
  for (let page = firstCandidate; page <= totalPages; page++) {
    const current = await load(page)
    if (!current) return { items: null, cachedFetch }
    if (current.newestKey.slice(0, 6) < month) break
    for (const item of current.items) {
      if (sortableVideoTime(timeOf(item))?.startsWith(month)) items.push(item)
    }
    if (current.oldestKey.slice(0, 6) < month) break
  }
  return { items, cachedFetch }
}
