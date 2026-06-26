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
      programs: [{ name: '测试栏目甲', columnId: 'TEST_COL_001', itemId: '' }],
      singleVideos: [
        { guid: 'test-single-guid-001', title: '测试单视频壹', brief: '', coverUrl: '', time: '2026-06-12' },
        { guid: 'test-single-guid-002', title: '测试单视频贰', brief: '', coverUrl: '', time: '2026-06-10' }
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
    await expect(page.locator('.video-item', { hasText: '测试单视频壹' })).toBeVisible()
    await expect(page.locator('.month-row')).toHaveCount(0)
    await expect(page.locator('.single-mode-label')).toBeVisible()
    await expect(page.locator('.download-all-btn')).toHaveCount(0)
  })

  test('选中单视频：预览显示「单个视频」徽标与「下载此视频」', async () => {
    await page.locator('.video-item', { hasText: '测试单视频壹' }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('.preview-single-badge')).toBeVisible()
    await expect(page.locator('.preview-download-btn')).toContainText('下载此视频')
  })

  test('悬停行内移除单视频', async () => {
    const target = page.locator('.video-item', { hasText: '测试单视频贰' })
    await target.hover()
    await target.locator('.video-del-btn').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.video-item')).toHaveCount(1)
    await expect(page.locator('.single-entry-count')).toHaveText('1')
  })

  test('切回栏目：月份选择器恢复、单视频条目取消高亮', async () => {
    await page.locator('.program-item', { hasText: '测试栏目甲' }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('.month-row')).toBeVisible()
    await expect(page.locator('.single-entry')).not.toHaveClass(/active/)
  })
})

/**
 * 联网 GUI：粘贴真实电影链接（僵尸栏目页面）→ 应识别为单视频并导入集合，
 * 预览面板显示正确封面与简介。
 * 验证 browse-program 僵尸栏目检测 + resolveSingleVideo IPC 链路。
 */
test.describe('单视频真实链接导入（联网）', () => {
  // 浪浪山小妖怪：page has column_id but the column has no videos (zombie column)
  // → should fall back to resolveSingleVideo and appear in 单个视频 collection
  const MOVIE_URL = 'https://tv.cctv.com/2026/06/12/VIDEfgJBdxtUMoAkH5c89ZYZ260612.shtml'

  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-real-import-'))
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env }
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

  test('粘贴僵尸栏目电影链接：进入单个视频集合，预览有封面和简介', async () => {
    const importInput = page.locator('.import-row input')
    await importInput.fill(MOVIE_URL)
    await importInput.press('Enter')

    // 解析需联网（两次 API 探测 + resolveSingleVideo），最多等 20s
    await page.waitForTimeout(12000)

    // 应进入单个视频集合，而非栏目列表
    await expect(page.locator('.program-list .program-item')).toHaveCount(0)
    await expect(page.locator('.single-entry-count')).toHaveText('1')

    // 切到单个视频集合
    await page.locator('.single-entry').click()
    await page.waitForTimeout(300)
    const videoItem = page.locator('.video-item').first()
    await expect(videoItem).toContainText('浪浪山')

    // 点击视频行，预览面板显示
    await videoItem.click()
    await page.waitForTimeout(500)

    // 标题
    await expect(page.locator('.preview-title')).toContainText('浪浪山')

    // 封面 src 是 https URL
    const coverImg = page.locator('.preview-cover')
    await expect(coverImg).toBeVisible()
    const src = await coverImg.getAttribute('src')
    expect(src).toMatch(/^https:\/\//)

    // 简介存在
    await expect(page.locator('.preview-brief')).toBeVisible()
    const brief = await page.locator('.preview-brief').textContent()
    expect(brief?.length).toBeGreaterThan(10)

    // 单个视频徽标
    await expect(page.locator('.preview-single-badge')).toBeVisible()
  })
})
