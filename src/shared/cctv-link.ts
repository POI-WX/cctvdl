/** True for official CCTV/CNTV web hosts, including legacy channel subdomains. */
export function isCctvPageHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return ['cctv.com', 'cctv.cn', 'cntv.cn'].some(
    domain => host === domain || host.endsWith(`.${domain}`)
  )
}

/** True for a CCTV page URL that cctvdl can import. */
export function isCctvLink(text: string): boolean {
  try {
    const url = new URL(text.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return false
    return isCctvPageHostname(url.hostname)
  } catch {
    return false
  }
}
