import fsDefault from 'fs'
import path from 'path'

export interface PreflightResult {
  ok: boolean
  reason?: string
}

// Minimal fs surface we depend on (injectable for tests).
export interface FsLike {
  mkdirSync: (p: string, opts: { recursive: boolean }) => unknown
  writeFileSync: (p: string, data: string) => void
  rmSync: (p: string, opts: { force: boolean }) => void
}

/**
 * Verify the download target directory exists (creating it if needed) and is
 * actually writable, by writing and deleting a tiny probe file. Returns a
 * friendly reason on failure so the UI can tell the user what to fix before any
 * segment work begins.
 */
export function checkSaveDir(dir: string, fs: FsLike = fsDefault): PreflightResult {
  if (!dir || !dir.trim()) return { ok: false, reason: '未设置保存位置，请在设置中选择保存目录' }
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return { ok: false, reason: `无法创建保存目录：${dir}` }
  }
  try {
    const probe = path.join(dir, `.cctvdl_write_test_${Date.now()}`)
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
  } catch {
    return { ok: false, reason: `保存目录不可写，请检查权限或更换目录：${dir}` }
  }
  return { ok: true }
}
