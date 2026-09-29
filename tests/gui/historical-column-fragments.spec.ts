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
      ipcMain.removeHandler('get-settings')
      ipcMain.handle('get-settings', () => ({ savePath: '/tmp/cctvdl-test-videos', includeHighlights }))
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
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: unknown[]) => ({
        estimatedBytes: 10 * 1024 * 1024, estimatedCount: videos.length,
        totalCount: videos.length, diskFreeBytes: 1024 * 1024 * 1024
      }))
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

    await fragment.locator('.el-checkbox__inner').click()
    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await page.locator('.settings-item', { hasText: '加载节目看点和片段' }).locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await expect(page.locator('.video-hint', { hasText: '没有匹配的视频' })).toBeVisible()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')
    await page.locator('button', { hasText: '查看已选' }).click()
    await expect(page.locator('.selected-video-row', { hasText: '清华大学教授状告百度' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('button', { hasText: '下载选中' }).click()
    await expect(page.locator('.el-message-box__title')).toHaveText('下载 1 个视频')
    await page.locator('.el-message-box').getByRole('button', { name: '返回检查' }).click()
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-fragments-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})

test('设置保存晚于返回首页时仍会刷新当前节目列表', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-late-settings-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(userDataDir, 'videos'), includeHighlights: false },
    programs: [{ name: '测试栏目', columnId: 'TOPC-late-save', itemId: '', kind: 'column' }]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        lateSettingsTest?: { enabled: boolean; listCalls: number; finishSave?: () => void }
      }
      const testState = state.lateSettingsTest = { enabled: false, listCalls: 0 }
      ipcMain.removeHandler('get-settings')
      ipcMain.handle('get-settings', () => ({ savePath: '/tmp/cctvdl-test-videos', includeHighlights: testState.enabled }))
      ipcMain.removeHandler('save-settings')
      ipcMain.handle('save-settings', () => new Promise(resolve => {
        testState.finishSave = () => { testState.enabled = true; resolve(true) }
      }))
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => {
        testState.listCalls++
        const episode = { guid: 'episode', title: '完整节目', brief: '', coverUrl: '', time: '2026-09-01' }
        const clip = { guid: 'clip', title: '栏目片段', brief: '', coverUrl: '', time: '2026-09-02', contentType: 'fragment' }
        return testState.enabled ? [episode, clip] : [episode]
      })
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202609', latest: '202609' }))
    })

    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: '测试栏目' }).click()
    await expect(page.locator('.video-item', { hasText: '完整节目' })).toBeVisible()
    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await page.locator('.settings-item', { hasText: '加载节目看点和片段' }).locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & {
      lateSettingsTest?: { finishSave?: unknown }
    }).lateSettingsTest?.finishSave))).toBe(true)
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await expect(page.locator('.video-item', { hasText: '完整节目' })).toBeVisible()

    await app.evaluate(() => (globalThis as typeof globalThis & {
      lateSettingsTest?: { finishSave?: () => void }
    }).lateSettingsTest?.finishSave?.())
    await expect(page.locator('.video-item', { hasText: '栏目片段' })).toBeVisible()
    expect(await app.evaluate(() => (globalThis as typeof globalThis & {
      lateSettingsTest?: { listCalls: number }
    }).lateSettingsTest?.listCalls)).toBe(2)
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-late-settings-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})
