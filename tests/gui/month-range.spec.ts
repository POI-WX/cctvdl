import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const column = { name: '测试跨月栏目', columnId: 'TOPC-range', itemId: '', kind: 'column' }
const monthlyVida = {
  name: '测试长期栏目', columnId: 'VIDA-range', itemId: '', kind: 'column',
  listSource: { type: 'album', id: 'VIDA-range', serviceId: 'tvcctv' }
}
const album = { name: '测试专辑 1', columnId: 'VIDA-album', itemId: '', kind: 'album' }

async function launch(programs = [column, monthlyVida, album], includeHighlights = false) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-range-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: 'C:\\Videos', includeHighlights }, programs
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

async function close(app: Awaited<ReturnType<typeof launch>>['app'], userDataDir: string) {
  await app.close()
  if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-range-')) {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

test('范围扫描失败月重试后才入队，且入口按栏目类型而非列表来源判断', async () => {
  test.setTimeout(90_000)
  const { app, page, userDataDir } = await launch([column, monthlyVida, album], true)
  try {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        rangeTest?: { calls: Array<{ month: string; highlights?: boolean; strict?: boolean }>; starts: string[][] }
      }
      const testState = state.rangeTest = { calls: [], starts: [] }
      let failedOnce = false
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', async (_event, _program: unknown, month: string, _requestId: unknown,
        _refresh: unknown, options?: { includeHighlights?: boolean; strictSupplementary?: boolean }) => {
        if (!options?.strictSupplementary) return []
        testState.calls.push({ month, highlights: options.includeHighlights, strict: options.strictSupplementary })
        if (month === '202402' && !failedOnce) { failedOnce = true; throw new Error('HTTP 503') }
        if (month === '202401') return [
          { guid: 'history', title: '测试已下载视频', brief: '', coverUrl: '', time: '2024-01-02' },
          { guid: 'shared', title: '测试视频 1', brief: '', coverUrl: '', time: '2024-01-03' }
        ]
        if (month === '202402') return [
          { guid: 'shared', title: '重复节目', brief: '', coverUrl: '', time: '2024-02-01' },
          { guid: 'new', title: '测试视频 2', brief: '', coverUrl: '', time: '2024-02-02', contentType: 'fragment' }
        ]
        return []
      })
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202401', latest: '202403' }))
      ipcMain.removeHandler('get-download-history')
      ipcMain.handle('get-download-history', () => [{
        guid: 'history', title: '测试已下载视频', outputPath: 'C:\\Videos\\history.mp4', fileSize: 1024, completedAt: 1
      }])
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: unknown[]) => ({
        estimatedBytes: 512 * 1024 ** 2, estimatedCount: videos.length,
        totalCount: videos.length, diskFreeBytes: 2 * 1024 ** 3
      }))
      ipcMain.removeHandler('start-download')
      ipcMain.handle('start-download', (_event, jobs: Array<{ guid: string }>) => {
        testState.starts.push(jobs.map(job => job.guid))
        return { added: 2, skipped: 1, addedGuids: ['shared', 'new'] }
      })
    })
    await page.setViewportSize({ width: 720, height: 680 })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: column.name }).click()
    await expect(page.locator('.footer-range-btn')).toBeVisible()
    await expect(page.locator('.footer-range-btn')).toHaveText('按月份下载')
    await page.locator('.footer-range-btn').click()
    const dialog = page.locator('.month-range-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.range-heading h2')).toHaveText(column.name)
    await expect(dialog.locator('.range-heading-stage')).toHaveText('选择月份')
    await expect(dialog.getByRole('button', { name: '全部月份' })).toBeEnabled()
    await dialog.getByRole('button', { name: '全部月份' }).click()
    await expect(dialog.locator('.range-month-count')).toHaveText('3 个月')
    await page.keyboard.press('2')
    await expect(page.locator('.sidebar-nav-item.active')).toContainText('首页')
    await page.keyboard.press('Delete')
    await expect(page.locator('.el-message-box')).toHaveCount(0)
    const screenshots = path.join(__dirname, '../../test-results/month-range')
    fs.mkdirSync(screenshots, { recursive: true })
    await page.screenshot({ path: path.join(screenshots, '720-range.png') })
    await dialog.getByRole('button', { name: '查找视频' }).click()
    await expect(dialog.locator('.range-issue')).toContainText('1 个月加载失败')
    await expect(dialog.locator('.range-failed-month')).toHaveText('2024年2月')
    await page.screenshot({ path: path.join(screenshots, '720-failed.png') })
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { rangeTest?: { starts: string[][] } }).rangeTest?.starts)).toEqual([])
    await dialog.getByRole('button', { name: '重试失败月份' }).click()
    await expect(dialog.locator('.range-result-stats')).toContainText('3')
    await expect(dialog.locator('.range-result-stats')).toContainText('已下载')
    await expect(dialog.locator('.range-heading-stage')).toHaveText('核对下载')
    await expect(dialog.locator('.range-result-details')).toContainText('512 MB')
    await expect(dialog.locator('.range-result-details')).toContainText('C:\\Videos')
    await page.screenshot({ path: path.join(screenshots, '720-ready.png') })
    await page.setViewportSize({ width: 960, height: 720 })
    await page.screenshot({ path: path.join(screenshots, '960-ready.png') })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(screenshots, '1280-ready-dark.png') })
    await dialog.getByRole('button', { name: '加入队列' }).click()
    await expect(dialog).toBeHidden()

    const state = await app.evaluate(() => (globalThis as typeof globalThis & {
      rangeTest?: { calls: Array<{ month: string; highlights?: boolean; strict?: boolean }>; starts: string[][] }
    }).rangeTest)
    expect(state?.calls.map(call => call.month)).toEqual(['202401', '202402', '202403', '202402'])
    expect(state?.calls.every(call => call.highlights === true && call.strict === true)).toBe(true)
    expect(state?.starts).toEqual([['history', 'shared', 'new']])

    await page.locator('.program-item', { hasText: monthlyVida.name }).click()
    await expect(page.locator('.footer-range-btn')).toBeVisible()
    await page.locator('.program-item', { hasText: album.name }).click()
    await expect(page.locator('.footer-range-btn')).toHaveCount(0)
  } finally { await close(app, userDataDir) }
})

test('取消扫描不创建任务，当前月空列表仍可打开范围入口', async () => {
  const { app, page, userDataDir } = await launch([column])
  try {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { rangeCancelTest?: { starts: number; calls: number } }
      const testState = state.rangeCancelTest = { starts: 0, calls: 0 }
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202401', latest: '202403' }))
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', async (_event, _program: unknown, _month: string, _requestId: unknown,
        _refresh: unknown, options?: { strictSupplementary?: boolean }) => {
        if (!options?.strictSupplementary) return []
        testState.calls++
        await new Promise(resolve => setTimeout(resolve, 450))
        return [{ guid: 'late', title: '晚到视频', brief: '', coverUrl: '', time: '2024-01-01' }]
      })
      ipcMain.removeHandler('start-download')
      ipcMain.handle('start-download', () => { testState.starts++; return { added: 1, skipped: 0, addedGuids: ['late'] } })
    })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: column.name }).click()
    await expect(page.locator('.video-hint', { hasText: '该月份暂无视频' })).toBeVisible()
    await page.locator('.footer-range-btn').click()
    const dialog = page.locator('.month-range-dialog')
    await dialog.getByRole('button', { name: '全部月份' }).click()
    await dialog.getByRole('button', { name: '查找视频' }).click()
    await expect(dialog.locator('.range-progress')).toBeVisible()
    await dialog.getByRole('button', { name: '取消查找' }).click()
    await expect(dialog.getByRole('button', { name: '查找视频' })).toBeVisible()
    await expect(page.locator('.el-message', { hasText: '已取消查找' })).toBeVisible()
    await page.waitForTimeout(550)
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      rangeCancelTest?: { starts: number; calls: number }
    }).rangeCancelTest?.starts)).toBe(0)
  } finally { await close(app, userDataDir) }
})

test('大量范围任务显示警示并要求再次确认', async () => {
  test.setTimeout(60_000)
  const { app, page, userDataDir } = await launch([column])
  try {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { rangeLargeTest?: { starts: number } }
      const testState = state.rangeLargeTest = { starts: 0 }
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202601', latest: '202609' }))
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', (_event, _program: unknown, month: string, _requestId: unknown,
        _refresh: unknown, options?: { strictSupplementary?: boolean }) => {
        if (!options?.strictSupplementary) return []
        const start = (Number(month.slice(4)) - 1) * 21
        return Array.from({ length: Math.min(21, 188 - start) }, (_, offset) => ({
          guid: `large-${start + offset}`, title: `测试视频 ${start + offset}`,
          brief: '', coverUrl: '', time: `${month.slice(0, 4)}-${month.slice(4)}-01`
        }))
      })
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: unknown[]) => ({
        estimatedBytes: 63_178_845_754, estimatedCount: 27, projectedCount: 161,
        totalCount: videos.length, diskFreeBytes: 40 * 1024 ** 3
      }))
      ipcMain.removeHandler('start-download')
      ipcMain.handle('start-download', () => { testState.starts++; return { added: 188, skipped: 0, addedGuids: [] } })
    })
    await page.setViewportSize({ width: 720, height: 680 })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: column.name }).click()
    await page.locator('.footer-range-btn').click()
    const dialog = page.locator('.month-range-dialog')
    await dialog.getByRole('button', { name: '全部月份' }).click()
    await dialog.getByRole('button', { name: '查找视频' }).click()
    await expect(dialog.locator('.range-result-warning'))
      .toHaveText('按当前估算，磁盘空间可能不足；建议更换保存位置或释放空间。')
    await expect(dialog.locator('.range-result-details')).toContainText('预计大小')
    await expect(dialog.locator('.range-result-details')).toContainText('40.0 GB')
    await expect(dialog.locator('.range-result-note')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '加入队列' })).toBeInViewport()
    await expect(dialog.locator('.range-result-warning')).toHaveCount(1)
    await expect(dialog.locator('.range-warning-icon svg')).toHaveCount(1)
    await expect(dialog.locator('.range-footer-warnings')).toBeInViewport()
    const warningFontSize = await dialog.locator('.range-result-warning').evaluate(row => getComputedStyle(row).fontSize)
    expect(warningFontSize).toBe('13px')
    const warningIcon = await dialog.locator('.range-warning-icon').boundingBox()
    expect(warningIcon?.width).toBe(16)
    expect(warningIcon?.height).toBe(16)
    const screenshotDir = path.join(__dirname, '../../test-results/month-range')
    fs.mkdirSync(screenshotDir, { recursive: true })
    await page.screenshot({ path: path.join(screenshotDir, '720-space-warning.png') })
    await page.setViewportSize({ width: 720, height: 520 })
    await expect(dialog.getByRole('button', { name: '加入队列' })).toBeInViewport({ ratio: 1 })
    await expect(dialog.locator('.range-footer-warnings')).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: path.join(screenshotDir, '720-520-space-warning.png') })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(screenshotDir, '1280-space-warning-dark.png') })
    await dialog.getByRole('button', { name: '加入队列' }).click()
    const warning = page.locator('.el-message-box', { hasText: '确认大量下载任务' })
    await expect(warning).toBeVisible()
    await warning.getByRole('button', { name: '返回检查' }).click()
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { rangeLargeTest?: { starts: number } }).rangeLargeTest?.starts)).toBe(0)
    await dialog.getByRole('button', { name: '加入队列' }).click()
    await warning.getByRole('button', { name: '继续加入' }).click()
    await expect(dialog).toBeHidden()
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { rangeLargeTest?: { starts: number } }).rangeLargeTest?.starts)).toBe(1)
  } finally { await close(app, userDataDir) }
})

test('空间足够时大范围结果不展示冗余警示或采样细节', async () => {
  test.setTimeout(60_000)
  const { app, page, userDataDir } = await launch([column])
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202401', latest: '202401' }))
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', (_event, _program: unknown, _month: string, _requestId: unknown,
        _refresh: unknown, options?: { strictSupplementary?: boolean }) => options?.strictSupplementary
        ? Array.from({ length: 1000 }, (_, index) => ({
            guid: `sample-${index}`,
            title: index === 98 ? '测试视频：跨月份专题回顾、历史事件与人物访谈，记录不同年代的社会变迁与时代记忆' : `测试视频 ${index}`,
            brief: '', coverUrl: '', time: '2024-01-01'
          })) : [])
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', () => ({
        estimatedBytes: 210 * 1024 ** 3, estimatedCount: 3,
        projectedCount: 997, totalCount: 1000, diskFreeBytes: 300 * 1024 ** 3
      }))
    })
    await page.setViewportSize({ width: 720, height: 680 })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: column.name }).click()
    await page.locator('.footer-range-btn').click()
    const dialog = page.locator('.month-range-dialog')
    await dialog.getByRole('button', { name: '全部月份' }).click()
    await dialog.getByRole('button', { name: '查找视频' }).click()
    await expect(dialog.locator('.range-result-details')).toContainText('预计大小')
    await expect(dialog.locator('.range-result-details')).not.toContainText('逐条')
    await expect(dialog.locator('.range-result-note')).toHaveCount(0)
    await expect(dialog.locator('.range-footer-warnings')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '加入队列' })).toBeEnabled()
    await dialog.locator('.range-video-list summary').click()
    await expect(dialog.locator('.range-video-row')).toHaveCount(100)
    await dialog.getByRole('button', { name: '继续显示（100/1000）' }).click()
    await expect(dialog.locator('.range-video-row')).toHaveCount(200)
    const dateGutter = await dialog.locator('.range-video-scroll').evaluate((scroll) =>
      scroll.getBoundingClientRect().right - scroll.querySelector('small')!.getBoundingClientRect().right)
    expect(dateGutter).toBeGreaterThanOrEqual(14)
    const screenshotDir = path.join(__dirname, '../../test-results/month-range')
    fs.mkdirSync(screenshotDir, { recursive: true })
    await page.screenshot({ path: path.join(screenshotDir, '720-video-list.png') })
    await dialog.locator('.range-video-list summary').click()
    await page.screenshot({ path: path.join(screenshotDir, '720-sampled-estimate.png') })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(screenshotDir, '1280-sampled-dark.png') })
    await dialog.locator('.range-video-list summary').click()
    await page.screenshot({ path: path.join(screenshotDir, '1280-video-list-dark.png') })
  } finally { await close(app, userDataDir) }
})

test('月份边界预加载失败后快捷入口可重试，返回首页后仍会重新查询', async () => {
  const { app, page, userDataDir } = await launch([column])
  try {
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { boundsTest?: { calls: number } }
      const testState = state.boundsTest = { calls: 0 }
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => {
        testState.calls++
        if (testState.calls <= 3) throw new Error('temporary bounds failure')
        return { earliest: '202401', latest: '202403' }
      })
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => [])
    })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: column.name }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & {
      boundsTest?: { calls: number }
    }).boundsTest?.calls)).toBe(3)
    await page.locator('.footer-range-btn').click()
    const dialog = page.locator('.month-range-dialog')
    const shortcut = dialog.getByRole('button', { name: '全部月份' })
    await expect(shortcut).toBeEnabled()
    await shortcut.click()
    await expect(dialog.locator('.range-month-count')).toHaveText('3 个月')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()

    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await expect(page.locator('.earliest-month-btn')).toBeEnabled()
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      boundsTest?: { calls: number }
    }).boundsTest?.calls)).toBeGreaterThan(4)
  } finally { await close(app, userDataDir) }
})
