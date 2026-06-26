export interface UpdateCheckResult {
  available: boolean
  version: string
}

/** Compare two "X.Y.Z" strings; returns true when remote > local. */
export function isNewerVersion(local: string, remote: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [lMaj, lMin, lPat] = parse(local)
  const [rMaj, rMin, rPat] = parse(remote)
  if (rMaj !== lMaj) return rMaj > lMaj
  if (rMin !== lMin) return rMin > lMin
  return rPat > lPat
}

/**
 * Fetch the latest GitHub release tag and compare with the running version.
 * Never throws — returns { available: false } on any network/parse error.
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchFn: typeof fetch = fetch
): Promise<UpdateCheckResult> {
  try {
    const res = await fetchFn(
      'https://api.github.com/repos/POI-WX/cctvdl/releases/latest',
      { headers: { 'User-Agent': 'cctvdl-update-check' } }
    )
    if (!res.ok) return { available: false, version: '' }
    const data = await res.json() as { tag_name?: string }
    const remote = (data.tag_name ?? '').replace(/^v/, '')
    if (!remote) return { available: false, version: '' }
    return { available: isNewerVersion(currentVersion, remote), version: remote }
  } catch {
    return { available: false, version: '' }
  }
}
