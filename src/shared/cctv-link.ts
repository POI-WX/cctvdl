/** True for a CCTV page URL that cctvdl can import. */
export function isCctvLink(text: string): boolean {
  try {
    const url = new URL(text.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return false
    return [
      'tv.cctv.com', 'tv.cctv.cn',
      'news.cctv.com', 'news.cctv.cn',
      'cctvnews.cctv.com', 'content-static.cctvnews.cctv.com'
    ].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}
