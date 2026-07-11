import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(rootDir, 'out', 'main', 'index.js')
const assetsDir = path.join(rootDir, 'docs', 'assets')
const viewport = { width: 1280, height: 800 }

// 这些链接用于生成 README 的真实页面截图。若来源页面失效，可在运行时用同名
// 环境变量替换；不要改用本地 mock，以免文档图与实际央视内容脱节。
const urls = {
  column: process.env.CCTV_DOCS_COLUMN_URL ?? 'https://tv.cctv.com/lm/xwlb/index.shtml',
  album: process.env.CCTV_DOCS_ALBUM_URL ?? 'https://tv.cctv.com/2021/10/09/VIDAlliMaCI9BiLxf3UhAGA8211009.shtml',
  single: process.env.CCTV_DOCS_SINGLE_URL ?? 'https://tv.cctv.com/2026/06/12/VIDEfgJBdxtUMoAkH5c89ZYZ260612.shtml'
}

function temporaryUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-docs-'))
}

async function withApp(callback) {
  const userDataDir = temporaryUserData()
  let app
  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'test' }
    })
    const page = await app.firstWindow()
    await page.setViewportSize(viewport)
    await page.waitForSelector('.sidebar-nav-item', { timeout: 15_000 })
    return await callback(app, page)
  } finally {
    await app?.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

async function screenshot(page, filename) {
  // Import/save confirmations are useful during interaction, but would make a
  // long-lived documentation image look transient and dated.
  await page.locator('.el-message').evaluateAll(messages => messages.forEach(message => message.remove()))
  await page.mouse.move(viewport.width - 20, viewport.height - 20)
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(assetsDir, filename), animations: 'disabled' })
}

function nav(page, name) {
  return page.locator('.sidebar-nav-item', { hasText: name }).click()
}

async function importLink(page, url) {
  await nav(page, '首页')
  const input = page.locator('.import-row input')
  await input.fill(url)
  await input.press('Enter')
  await page.locator('.el-message').last().waitFor({ timeout: 30_000 })
}

async function openImportedProgram(page) {
  const row = page.locator('.program-item').first()
  await row.waitFor({ timeout: 15_000 })
  await row.click()
  await page.locator('.video-item').first().waitFor({ timeout: 40_000 })
}

async function selectFirstVideo(page) {
  await page.locator('.video-item').first().click()
  await page.locator('.preview-title').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(800)
}

async function send(app, channel, payload) {
  await app.evaluate(({ BrowserWindow }, { channel, payload }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
  }, { channel, payload })
}

async function captureColumnScreenshots() {
  return withApp(async (_app, page) => {
    await importLink(page, urls.column)
    await openImportedProgram(page)
    const titles = (await page.locator('.video-item-title').allTextContents())
      .map(title => title.trim())
      .filter(Boolean)
    if (titles.length < 2) throw new Error('截图栏目未返回足够节目，无法生成“已选内容”截图')
    await selectFirstVideo(page)
    await screenshot(page, 'home.png')

    await page.locator('.video-item').first().locator('.el-checkbox__inner').click()
    await page.locator('.video-item').nth(1).locator('.el-checkbox__inner').click()
    await page.getByRole('button', { name: '查看已选' }).click()
    await page.locator('.selected-videos-panel').waitFor({ timeout: 5_000 })
    await screenshot(page, 'selected-videos.png')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '清空已选' }).click()

    await nav(page, '设置')
    await screenshot(page, 'settings.png')

    await page.locator('.settings-item', { hasText: '深色模式' }).locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await nav(page, '首页')
    await screenshot(page, 'home-dark.png')
    return titles
  })
}

async function captureAlbumScreenshot() {
  await withApp(async (_app, page) => {
    await importLink(page, urls.album)
    await openImportedProgram(page)
    await selectFirstVideo(page)
    await screenshot(page, 'album.png')
  })
}

async function captureSingleScreenshots() {
  return withApp(async (_app, page) => {
    await importLink(page, urls.single)
    await page.locator('.single-entry').click()
    await selectFirstVideo(page)
    await screenshot(page, 'single-video.png')

    await page.locator('.preview-cover.clickable').click()
    await page.locator('.lightbox').waitFor({ timeout: 10_000 })
    await screenshot(page, 'lightbox.png')
    return (await page.locator('.preview-title').textContent())?.trim() || '央视视频'
  })
}

async function captureDownloadScreenshots(titles) {
  const [first = '央视视频', second = first, third = second] = titles
  const queueJobs = [
    { id: 'docs-job-1', title: first, guid: 'docs-job-guid-1' },
    { id: 'docs-job-2', title: second, guid: 'docs-job-guid-2' },
    { id: 'docs-job-3', title: third, guid: 'docs-job-guid-3' }
  ]

  // 队列状态由应用已有 IPC 事件驱动，标题来自上一步实际解析的页面；不启动真实
  // 下载，避免为了更新 README 而写入视频文件或消耗大量网络流量。
  await withApp(async (app, page) => {
    await nav(page, '下载')
    await send(app, 'batch-started', { total: queueJobs.length, jobs: queueJobs })
    await page.locator('.dl-card').first().waitFor()
    await screenshot(page, 'download-queue.png')
  })

  await withApp(async (app, page) => {
    await nav(page, '下载')
    await send(app, 'batch-started', { total: queueJobs.length, jobs: queueJobs })
    await send(app, 'download-progress', {
      jobId: 'docs-job-1', state: 'Downloading', stage: 'DownloadingShards', percent: 62,
      segmentsDone: 186, segmentsTotal: 300, speed: 2_621_440, eta: 18,
      batchCompleted: 0, batchTotal: queueJobs.length
    })
    await send(app, 'download-progress', {
      jobId: 'docs-job-2', state: 'Completed', stage: 'PublishingOutput', percent: 100,
      batchCompleted: 1, batchTotal: queueJobs.length
    })
    await send(app, 'job-finished', {
      id: 'docs-job-2', title: queueJobs[1].title, guid: 'docs-job-guid-2',
      state: 'Completed', stage: 'PublishingOutput', progressPercent: 100,
      sourceUrl: '', savePath: '', quality: 'gaoqing', threadCount: 8, reencode: false,
      outputPath: `${queueJobs[1].title}.mp4`
    })
    await page.locator('.dl-card.active').first().waitFor()
    await screenshot(page, 'download.png')
  })
}

fs.mkdirSync(assetsDir, { recursive: true })
const columnTitles = await captureColumnScreenshots()
await captureAlbumScreenshot()
const singleTitle = await captureSingleScreenshots()
await captureDownloadScreenshots([...columnTitles, singleTitle])
console.log(`已更新真实页面文档截图：${assetsDir}`)
