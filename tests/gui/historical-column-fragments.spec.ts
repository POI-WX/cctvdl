import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('历史栏目片段遵循看点和片段开关', async () => {
  test.setTimeout(90_000)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-fragments-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(userDataDir, 'videos'), includeHighlights: false }
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const program = {
        name: '经济信息联播', columnId: 'TOPC1451533782742171',
        itemId: 'VIDE1336929662017714', kind: 'column',
        listSource: { type: 'column', id: 'TOPC1451533782742171', serviceId: 'tvcctv' }
      }
      const episode = {
        guid: 'full-episode', title: '《经济信息联播》 20110816',
        brief: '', coverUrl: '', time: '2011-08-16 20:30:00'
      }
      const fragment = {
        guid: '002E74F78B6A49eaB6B1CD41FBDFC41B',
        title: '“贴吧”变“骂吧” 清华大学教授状告百度',
        brief: '', coverUrl: '', time: '2011-08-16 22:03:44',
        channel: 'CCTV-2', durationSeconds: 390, contentType: 'fragment'
      }
      let includeHighlights = false
      ipcMain.removeHandler('browse-program')
      ipcMain.handle('browse-program', () => program)
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => includeHighlights ? [episode, fragment] : [episode])
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '201108', latest: '201108' }))
      ipcMain.removeHandler('save-settings')
      ipcMain.handle('save-settings', (_event, settings: { includeHighlights?: boolean }) => {
        includeHighlights = settings.includeHighlights === true
        return true
      })
    })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    const input = page.locator('.import-row input')
    await input.fill('https://tv.cctv.cn/2011/08/16/VIDE1336929662017714.shtml')
    await input.press('Enter')

    const program = page.locator('.program-item', { hasText: '经济信息联播' })
    await expect(program).toBeVisible()
    const imported = await page.evaluate(() => window.cctvdlApi.getPrograms())
    expect(imported).toMatchObject([{
      name: '经济信息联播', kind: 'column',
      listSource: { type: 'column', id: 'TOPC1451533782742171' }
    }])
    await expect(page.locator('.single-entry-count')).toHaveText('0')
    const month = page.locator('.month-row input')
    await month.fill('2011-08')
    await month.press('Enter')
    await expect(page.locator('.video-item').first()).toBeVisible()
    await page.locator('.video-search input').fill('贴吧')
    await expect(page.locator('.video-item')).toHaveCount(0)

    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await page.locator('.settings-item', { hasText: '加载节目看点和片段' }).locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await expect(page.locator('.settings-save-btn')).toBeDisabled()

    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: '经济信息联播' }).click()
    await page.locator('.video-search input').fill('贴吧')
    const fragment = page.locator('.video-item', { hasText: '清华大学教授状告百度' })
    await expect(fragment).toBeVisible()
    await expect(fragment.locator('.video-type-badge')).toHaveText('片段')
    await fragment.click()
    await expect(page.locator('.preview-title')).toContainText('清华大学教授状告百度')

    await expect(page.locator('.el-message')).toHaveCount(0, { timeout: 10_000 })
    const screenshotPath = path.join(__dirname, '../../test-results/gui/historical-column-fragment.png')
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
    await page.screenshot({ path: screenshotPath })
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-fragments-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})
