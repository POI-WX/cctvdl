import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('单视频与搜索列表共用虚拟滚动，过滤和滚动后保留选择', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-flat-list-'))
  const videos = Array.from({ length: 180 }, (_, index) => ({
    guid: `flat-${index}`, title: `测试视频 ${index + 1}`, brief: '', coverUrl: '',
    time: '2026-09-01', contentType: 'fragment'
  }))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: 'C:\\Videos' }, singleVideos: videos,
    programs: [{ name: '测试栏目 1', columnId: 'TOPC-flat', itemId: '' }]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }, items) => {
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202609', latest: '202609' }))
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => items)
    }, videos)
    await expect(page.locator('.single-entry-count')).toHaveText('180')
    for (const single of [true, false]) {
      if (single) await page.locator('.single-entry').click()
      else await page.locator('.program-item', { hasText: '测试栏目 1' }).click()
      await page.locator('.video-search input').fill('测试视频')
      await expect.poll(() => page.locator('.video-item').count()).toBeLessThan(100)
      await expect(page.locator('.video-item').first()).toContainText('测试视频 1')
      const firstCheckbox = page.locator('.video-item').first().locator('.el-checkbox__input')
      if (single) await page.locator('.video-item').first().locator('.el-checkbox').click()
      await expect(firstCheckbox).toHaveClass(/is-checked/)
      await page.locator('.video-list').evaluate(list => { list.scrollTop = list.scrollHeight })
      await expect(page.locator('.video-item').last()).toContainText('测试视频 180')
      await page.locator('.video-list').evaluate(list => { list.scrollTop = 0 })
      await expect(page.locator('.video-item').first()).toContainText('测试视频 1')
      await expect(firstCheckbox).toHaveClass(/is-checked/)
      await page.locator('.video-search input').fill('180')
      await expect(page.locator('.video-item')).toHaveCount(1)
      await expect(page.locator('.video-item-date')).toHaveText('2026-09-01')
      await expect(page.locator('.video-del-btn')).toHaveCount(single ? 1 : 0)
      await expect(page.locator('.video-item .video-type-badge')).toHaveCount(single ? 0 : 1)
      await expect(page.locator('.footer-selection-count')).toContainText('已选 1')
    }
  } finally {
    await app.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('首页选择、已选清单和下载确认在窄窗口保持可核对', async () => {
  test.setTimeout(90_000)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-home-ux-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: 'C:\\Videos', coverSavePath: 'C:\\Images', logPath: 'C:\\Logs' },
    programs: [
      { name: '测试栏目 1', columnId: 'TOPC-ux-a', itemId: '', kind: 'column' },
      { name: '测试栏目 2', columnId: 'TOPC-ux-b', itemId: '', kind: 'column' }
    ]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', (_event, program: { columnId: string }) => program.columnId === 'TOPC-ux-a'
        ? [
            { guid: 'ux-a-full', title: '测试视频：历史影像中的城市变迁、重大事件回顾与人物访谈，追寻时代记忆中的故事', brief: '', coverUrl: '', time: '2026-09-03' },
            { guid: 'ux-a-fragment', title: '测试栏目 1 片段', brief: '', coverUrl: '', time: '2026-08-28', contentType: 'fragment' }
          ]
        : [{ guid: 'ux-b-highlight', title: '测试栏目 2 看点', brief: '', coverUrl: '', time: '2026-07-02', contentType: 'highlight' }])
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202607', latest: '202609' }))
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: unknown[]) => ({
        estimatedBytes: videos.length * 100 * 1024 * 1024,
        estimatedCount: videos.length, totalCount: videos.length, diskFreeBytes: 10 * 1024 ** 3
      }))
    })
    await page.setViewportSize({ width: 720, height: 680 })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await expect(page.locator('.sidebar-nav-icon')).toHaveText(['🏠', '⬇️', '⚙️'])
    await expect(page.locator('button[title="从 JSON 导入节目"] svg')).toBeVisible()
    await page.locator('.program-item', { hasText: '测试栏目 1' }).click()
    await expect(page.locator('.video-item')).toHaveCount(2)
    const selectAll = page.locator('.select-current-list')
    await expect(selectAll).not.toHaveClass(/is-indeterminate/)
    await page.locator('.video-item').first().locator('.el-checkbox__inner').click()
    await expect(selectAll.locator('.el-checkbox__input')).toHaveClass(/is-indeterminate/)
    await selectAll.click()
    await expect(selectAll.locator('.el-checkbox__input')).toHaveClass(/is-checked/)
    await selectAll.click()
    await expect(page.locator('.footer-selection-count')).toHaveCount(0)

    await page.locator('.video-search input').fill('片段')
    await expect(page.locator('.video-item')).toHaveCount(1)
    await selectAll.click()
    await expect(page.locator('.footer-selection-count')).toContainText('已选 1 · 当前列表 1/1')
    await page.locator('.video-search input').clear()
    await expect(page.locator('.video-item')).toHaveCount(2)
    await expect(selectAll.locator('.el-checkbox__input')).toHaveClass(/is-indeterminate/)
    await selectAll.click()
    await selectAll.click()
    await expect(page.locator('.footer-selection-count')).toHaveCount(0)
    await selectAll.locator('.el-checkbox__original').focus()
    await page.keyboard.press('Space')
    await expect(selectAll.locator('.el-checkbox__input')).toHaveClass(/is-checked/)
    await page.keyboard.press('Space')
    await expect(page.locator('.footer-selection-count')).toHaveCount(0)

    await page.locator('.video-item').first().locator('.el-checkbox__inner').click()
    await page.locator('.video-item').nth(1).locator('.el-checkbox__inner').click()
    await page.locator('.program-item', { hasText: '测试栏目 2' }).click()
    await page.locator('.video-item').first().locator('.el-checkbox__inner').click()
    await expect(page.locator('.footer-selection-count')).toContainText('已选 3 · 当前列表 1/1')
    await expect(page.getByRole('button', { name: '下载选中' })).toContainText('3')
    await page.getByRole('button', { name: '查看已选' }).click()
    const selectedPanel = page.locator('.selected-videos-panel')
    await expect(selectedPanel).toBeVisible()
    await expect(selectedPanel.locator('.selected-video-group-name')).toHaveCount(2)
    await expect(selectedPanel.locator('.selected-video-month-name')).toHaveText(['2026年9月', '2026年8月', '2026年7月'])
    await expect(selectedPanel.locator('.selected-video-meta', { hasText: '片段' })).toBeVisible()
    await expect(selectedPanel.locator('.selected-video-meta', { hasText: '看点' })).toBeVisible()
    const primary = await page.getByRole('button', { name: '下载选中' }).boundingBox()
    const panel = await selectedPanel.boundingBox()
    expect(primary && panel && panel.y + panel.height <= primary.y).toBeTruthy()
    await page.getByRole('button', { name: '查看已选' }).click()

    await page.getByRole('button', { name: '下载选中' }).click()
    const dialog = page.locator('.el-message-box')
    await expect(dialog.locator('.download-confirm-overview')).toContainText('2 个栏目')
    await expect(dialog.locator('.download-confirm-overview')).toContainText('2026年7月—2026年9月')
    await expect(dialog.locator('.download-confirm-overview')).toContainText('1 个看点')
    await expect(dialog.locator('.download-confirm-overview')).toContainText('1 个片段')
    await expect(dialog.locator('.download-confirm-row', { hasText: '保存到' })).toContainText('C:\\Videos')
    await dialog.locator('.download-confirm-list summary').click()
    await expect(dialog.locator('.download-confirm-video')).toHaveCount(3)
    await expect(dialog.locator('.download-confirm-video', { hasText: '测试栏目 1 片段' })).toContainText('片段')
    const screenshotDir = path.join(__dirname, '../../test-results/home-ux')
    fs.mkdirSync(screenshotDir, { recursive: true })
    await page.screenshot({ path: path.join(screenshotDir, '720-confirm.png') })
    await dialog.getByRole('button', { name: '返回检查' }).click()
    await expect(dialog).toBeHidden()
    await page.locator('.video-item').first().click()
    await expect(page.locator('.preview-inner')).toBeVisible()
    await expect(page.locator('.preview-placeholder-art')).toBeVisible()
    await expect(page.locator('.preview-placeholder-art')).toHaveText('📺')
    const emptyCover = await page.locator('.preview-cover-wrap.cover-missing').boundingBox()
    expect(emptyCover && emptyCover.height <= 180).toBeTruthy()
    await page.screenshot({ path: path.join(screenshotDir, '720-preview.png') })

    await page.setViewportSize({ width: 960, height: 720 })
    await page.getByRole('button', { name: '查看已选' }).click()
    await expect(selectedPanel).toBeVisible()
    await page.waitForTimeout(250)
    const sidebar = await page.locator('.home-sidebar').boundingBox()
    const selectedBox = await selectedPanel.boundingBox()
    expect(sidebar && selectedBox && selectedBox.x + selectedBox.width <= sidebar.x + sidebar.width + 8).toBeTruthy()
    await page.screenshot({ path: path.join(screenshotDir, '960-selection.png') })
    await page.getByRole('button', { name: '查看已选' }).click()
    await page.getByRole('button', { name: '更多下载方式' }).click()
    await expect(page.getByText('下载本月全部 1 个视频')).toBeVisible()
    await page.getByRole('button', { name: '更多下载方式' }).click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator('.preview-title').click()
    await expect(selectedPanel).toBeHidden()
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(screenshotDir, '1280-dark.png') })
    await page.locator('.sidebar-nav-item', { hasText: '下载' }).click()
    await expect(page.locator('.dl-empty')).toBeVisible()
    await expect(page.locator('.dl-empty-icon')).toHaveText('⬇️')
    await expect(page.locator('.dl-action-btn', { hasText: '打开文件夹' }).locator('svg')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(screenshotDir, '1280-download-dark.png') })
    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await expect(page.locator('.settings-page')).toBeVisible()
    await expect(page.locator('.settings-card-icon')).toHaveText(['⬇️', '🎨', '⚙️', '🕐', 'ℹ️'])
    if (!(await page.locator('html').getAttribute('class'))?.includes('dark')) {
      await page.locator('.settings-item', { hasText: '深色模式' }).locator('.el-switch').click()
    }
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(screenshotDir, '1280-settings-dark.png') })
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-home-ux-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})
