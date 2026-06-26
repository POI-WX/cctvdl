import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * 离线 GUI：单视频集合（持久化 + 隐式切换）。
 * 启动前把 singleVideos 预置进 electron-store，验证「📌 单个视频」集合的
 * 显示 / 切换 / 预览 / 移除，全程不联网。
 */

test.describe('单个视频集合', () => {
  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-single-'))
    const seed = {
      programs: [{ name: '新闻联播', columnId: 'TOPC001', itemId: '' }],
      singleVideos: [
        { guid: 'VIDEmovie1', title: '建国大业', brief: '', coverUrl: '', time: '2026-06-12' },
        { guid: 'VIDEmovie2', title: '长津湖', brief: '', coverUrl: '', time: '2026-06-10' }
      ]
    }
    fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(seed), 'utf-8')

    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
    })
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.waitForTimeout(500)
  })

  test.afterAll(async () => {
    if (electronApp) await electronApp.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  test('「单个视频」条目常驻并显示数量', async () => {
    const entry = page.locator('.single-entry')
    await expect(entry).toBeVisible()
    await expect(entry).toContainText('单个视频')
    await expect(page.locator('.single-entry-count')).toHaveText('2')
  })

  test('选中条目进入集合：列出单视频、月份选择器隐藏', async () => {
    await page.locator('.single-entry').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.single-entry')).toHaveClass(/active/)
    await expect(page.locator('.video-item')).toHaveCount(2)
    await expect(page.locator('.video-item', { hasText: '建国大业' })).toBeVisible()
    // 单视频模式下无月份选择器，显示单视频标签
    await expect(page.locator('.month-row')).toHaveCount(0)
    await expect(page.locator('.single-mode-label')).toBeVisible()
    // 「下载本月」仅栏目模式，单视频模式不显示
    await expect(page.locator('.download-all-btn')).toHaveCount(0)
  })

  test('选中单视频：预览显示「单个视频」徽标与「下载此视频」', async () => {
    await page.locator('.video-item', { hasText: '建国大业' }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('.preview-single-badge')).toBeVisible()
    await expect(page.locator('.preview-download-btn')).toContainText('下载此视频')
  })

  test('悬停行内移除单视频', async () => {
    const target = page.locator('.video-item', { hasText: '长津湖' })
    await target.hover()
    await target.locator('.video-del-btn').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.video-item')).toHaveCount(1)
    await expect(page.locator('.single-entry-count')).toHaveText('1')
  })

  test('切回栏目：月份选择器恢复、单视频条目取消高亮', async () => {
    await page.locator('.program-item', { hasText: '新闻联播' }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('.month-row')).toBeVisible()
    await expect(page.locator('.single-entry')).not.toHaveClass(/active/)
  })
})
