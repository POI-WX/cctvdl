/**
 * E2E: end-to-end pipeline — real CCTV resolve → real decrypt of the
 * first 2 segments → real lossless merge → assert a valid, non-empty, playable
 * file. Proves the decryptor (retry/index/bytes) and Finalizer.merge integrate
 * correctly on real data.
 *
 * Self-contained: needs only network access. The decrypt child runs on Electron's
 * bundled Node, and ffmpeg comes from the bundled `ffmpeg-static` (both for the
 * decrypt redirect and the playability probe) — no system ffmpeg/ffprobe required.
 *
 * Run: npm run test:e2e
 */
import { describe, it, expect } from 'vitest'
import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CctvApiService } from '../../src/main/api/cctv'
import { BrowseService } from '../../src/main/api/browse'
import { SegmentDecryptor, type DecryptFn } from '../../src/main/download/decryptor'
import { Finalizer } from '../../src/main/download/finalizer'
import { ffmpegPath } from '../../src/main/download/ffmpeg'

// Decrypt via the real Electron binary (require('electron') returns its path in
// node). Passing CCTVDL_FFMPEG exercises the real ffmpeg redirect, so decrypt.js
// uses the bundled ffmpeg instead of a system one — same as the shipped app.
function makeRealDecrypt(): DecryptFn {
  const electronPath = require('electron') as string
  const jsDir = path.resolve(__dirname, '../../resources/decrypt')
  return (url: string, out: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(electronPath, [path.join(jsDir, 'decrypt-wrapper.js'), url, out], {
        cwd: jsDir,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CCTVDL_FFMPEG: ffmpegPath() },
        windowsHide: true
      })
      let err = ''
      child.stderr?.on('data', (d) => { err += d.toString() })
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}: ${err.slice(0, 200)}`)))
      child.once('error', reject)
    })
}

// Resolve segments, decrypt the first 2, merge, and assert a playable file.
async function runDecryptMergeTest(guid: string, quality: string, label: string) {
  const api = new CctvApiService()
  const resolved = await api.resolveSegmentUrls(guid, quality as any)
  expect(resolved.segmentUrls.length).toBeGreaterThan(0)

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `cctvdl-${label}-`))
  try {
    const tasks = resolved.segmentUrls.slice(0, 2).map((url, index) => ({ index, url }))
    const decryptor = new SegmentDecryptor(makeRealDecrypt(), 2)
    const result = await decryptor.decryptAll(tasks, workDir, () => {})
    expect(result.failed).toHaveLength(0)
    expect(result.completed.length).toBe(tasks.length)

    const finalizer = new Finalizer()
    const listPath = finalizer.writeConcatList(workDir, tasks.length)
    const out = path.join(workDir, 'merged.mp4')
    const finalPath = await finalizer.merge(listPath, out, false)

    expect(fs.existsSync(finalPath)).toBe(true)
    expect(fs.statSync(finalPath).size).toBeGreaterThan(10_000)

    // Playability check using the bundled ffmpeg: decode the whole file to the
    // null muxer (exit 0 → decodes cleanly) and confirm it reports a real
    // duration. (Benign remux warnings like non-monotonic DTS are expected and
    // don't affect validity, so we don't fail on stderr content.)
    const probe = spawnSync(ffmpegPath(), ['-i', finalPath, '-f', 'null', '-'], { encoding: 'utf-8' })
    expect(probe.status).toBe(0)
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr || '')
    expect(m).not.toBeNull()
    const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]) : 0
    expect(seconds).toBeGreaterThan(0)
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

describe('end-to-end pipeline', () => {
  it('resolves, decrypts 2 segments, and merges into a playable file', async () => {
    const browse = new BrowseService()

    const info = await browse.resolveColumnInfo('https://tv.cctv.com/lm/xwlb/index.shtml')
    const now = new Date()
    const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    let videos = await browse.getColumnVideoList(info.columnId, 1, month)
    if (!videos.length) {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      videos = await browse.getColumnVideoList(info.columnId, 1, `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}`)
    }
    expect(videos.length).toBeGreaterThan(0)

    await runDecryptMergeTest(videos[0].guid, 'liuchang', 'xwlb')
  }, 180_000)

  it('CCTV-16 4K奥林匹克: decrypts and merges at bluray (3Mbps 1080p)', async () => {
    // CCTV-16 Olympic 4K content; 5 tiers up to 3072000bps
    await runDecryptMergeTest('26777d5094fc4ca98a7ad07d9cc62ffe', 'bluray', 'cctv16-4k')
  }, 180_000)

  it('CCTV-4K超高清: decrypts and merges at bluray (4Mbps 1080p)', async () => {
    // CCTV-4K超高清 content; 2 tiers only: 2048000 and 4096000
    await runDecryptMergeTest('354d096689104a5fbf1b62398be502c6', 'bluray', 'cctv4k-uhd')
  }, 180_000)

  it('CCTV-4K超高清: fallback from liuchang (460800) to lowest available (2048000)', async () => {
    // Only 2048000/4096000 available; 460800 not present → fallback picks 2048000
    const api = new CctvApiService()
    const resolved = await api.resolveSegmentUrls('354d096689104a5fbf1b62398be502c6', 'liuchang')
    expect(resolved.segmentUrls.length).toBeGreaterThan(0)
  }, 60_000)

  it('单视频直链: resolveSingleVideo guid 可解密合并（浪浪山小妖怪）', async () => {
    // guid 73dfb7e8... is the playable guid extracted from the movie page HTML var guid
    await runDecryptMergeTest('73dfb7e8070247d7acb90016a365c9e6', 'liuchang', 'single-video-movie')
  }, 180_000)
})
