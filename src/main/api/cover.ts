import fs from 'fs'
import path from 'path'
import { DEFAULT_UA, DEFAULT_REFERER } from './http'

/**
 * Download a remote cover image to a local directory.
 * Infers the file extension from Content-Type (png/webp/jpg).
 * Appends _2/_3 suffix when the target path already exists.
 */
export async function downloadCoverToDir(
  url: string,
  saveDir: string,
  baseName: string
): Promise<{ savedPath: string }> {
  const resp = await fetch(url, { headers: { 'User-Agent': DEFAULT_UA, 'Referer': DEFAULT_REFERER } })
  if (!resp.ok) throw new Error(`服务器返回 ${resp.status}`)
  const ct = resp.headers.get('content-type') || ''
  const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg'
  fs.mkdirSync(saveDir, { recursive: true })
  let fullPath = path.join(saveDir, baseName + ext)
  let n = 2
  while (fs.existsSync(fullPath)) fullPath = path.join(saveDir, `${baseName}_${n++}${ext}`)
  fs.writeFileSync(fullPath, Buffer.from(await resp.arrayBuffer()))
  return { savedPath: fullPath }
}
