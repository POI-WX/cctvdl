// Pure, framework-free helpers for the video list. Unit-tested; the UI just calls them.

export interface FilterableVideo {
  title: string
  brief?: string
  time?: string
}

/**
 * Filter videos by a free-text query (case-insensitive). Matches against title,
 * brief, and time so users can search by episode name, keyword, or date. An empty
 * or whitespace-only query returns the list unchanged.
 */
export function filterVideos<T extends FilterableVideo>(videos: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return videos
  return videos.filter((v) => {
    const hay = `${v.title} ${v.brief ?? ''} ${v.time ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
}
