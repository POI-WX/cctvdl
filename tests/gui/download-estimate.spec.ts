import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('单个与批量下载确认显示自适应大小和磁盘提醒', async () => {
  test.setTimeout(60_000)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-estimate-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(os.homedir(), 'Videos') },
    programs: [{ name: '测试栏目', columnId: 'TOPC-test', itemId: '', kind: 'column' }],
    singleVideos: [
      { guid: 'single-known', title: '单个已知视频', time: '2026-09-01' },
      { guid: 'single-unknown', title: '单个未知视频', time: '2026-09-02' }
    ]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userDataDir)
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: Array<{ guid: string }>) => {
        if (videos[0]?.guid === 'single-unknown') {
          return { estimatedBytes: 0, estimatedCount: 0, totalCount: 1, diskFreeBytes: null }
        }
        if (videos.length === 1) {
          return { estimatedBytes: 10 * 1024 ** 2, estimatedCount: 1, totalCount: 1, diskFreeBytes: 2 * 1024 ** 3 }
        }
        return { estimatedBytes: 1.5 * 1024 ** 3, estimatedCount: 1, totalCount: 2, diskFreeBytes: 1024 ** 3 }
      })
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => [
        { guid: 'batch-1', title: '批量视频一', brief: '', coverUrl: '', time: '2026-09-01' },
        { guid: 'batch-2', title: '批量视频二', brief: '', coverUrl: '', time: '2026-09-02' }
      ])
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202609', latest: '202609' }))
    })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await expect(page.locator('.single-entry-count')).toHaveText('2')
    await page.locator('.single-entry').click()
    await page.locator('.video-item', { hasText: '单个已知视频' }).click()
    await page.locator('.preview-download-btn').click()

    const dialog = page.locator('.el-message-box')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.el-message-box__title')).toHaveText('下载 1 个视频')
    await expect(dialog.locator('.download-confirm-row', { hasText: '预计大小' })).toContainText('10.0 MB')
    await expect(dialog.locator('.download-confirm-row', { hasText: '估算范围' })).toContainText('1 / 1 个')
    await expect(dialog.locator('.download-confirm-row', { hasText: '磁盘剩余' })).toContainText('2.0 GB')
    await expect(dialog.locator('.download-confirm-row', { hasText: '保存到' })).toContainText('~')
    expect(await dialog.textContent()).not.toContain(os.userInfo().username)
    const screenshotDir = path.join(__dirname, '../../test-results/gui')
    fs.mkdirSync(screenshotDir, { recursive: true })
    await page.mouse.move(1200, 800)
    await expect(page.locator('.el-popper[role="tooltip"]')).toBeHidden()
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(screenshotDir, 'single-download-confirm.png') })
    await dialog.getByRole('button', { name: '返回检查' }).click()

    await page.locator('.video-item', { hasText: '单个未知视频' }).click()
    await page.locator('.preview-download-btn').click()
    await expect(dialog.locator('.download-confirm-row', { hasText: '预计大小' })).toContainText('暂无法估算')
    await expect(dialog.locator('.download-confirm-row', { hasText: '磁盘剩余' })).toContainText('无法检查')
    await dialog.getByRole('button', { name: '返回检查' }).click()

    await page.locator('.program-item', { hasText: '测试栏目' }).click()
    await expect(page.locator('.video-item')).toHaveCount(2)
    await page.locator('.video-item').nth(0).locator('.el-checkbox__inner').click()
    await page.locator('.video-item').nth(1).locator('.el-checkbox__inner').click()
    await page.locator('button', { hasText: '下载选中' }).click()
    await expect(dialog.locator('.el-message-box__title')).toHaveText('下载 2 个视频')
    await expect(dialog.locator('.download-confirm-row', { hasText: '预计大小' })).toContainText('1.5 GB')
    await expect(dialog.locator('.download-confirm-row', { hasText: '估算范围' })).toContainText('1 / 2 个')
    await expect(dialog.locator('.download-confirm-row', { hasText: '磁盘剩余' })).toContainText('1.0 GB')
    await expect(dialog.locator('.download-confirm-warning'))
      .toContainText('剩余空间可能不足，请释放空间或更换保存位置。')
    await expect(dialog.locator('.download-confirm-note')).toContainText('1 个视频大小未知')
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(screenshotDir, 'batch-download-confirm.png') })
    await dialog.getByRole('button', { name: '返回检查' }).click()

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get-download-history')
      ipcMain.handle('get-download-history', () => [{
        guid: 'batch-1', title: '批量视频一', outputPath: '', fileSize: 0, completedAt: 1
      }])
    })
    await page.locator('.program-item', { hasText: '测试栏目' }).click()
    await expect(page.locator('.video-item', { hasText: '批量视频一' })).toHaveClass(/downloaded/)
    await page.locator('button', { hasText: '下载选中' }).click()
    await expect(dialog.locator('.el-message-box__title')).toHaveText('下载 1 个视频')
    await expect(dialog.locator('.download-confirm-note', { hasText: '已下载' }))
      .toContainText('1 个已下载视频将跳过')
    await expect(dialog.locator('.download-confirm-row', { hasText: '估算范围' })).toContainText('1 / 1 个')
    await dialog.getByRole('button', { name: '返回检查' }).click()
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-estimate-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})
