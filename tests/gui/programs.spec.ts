import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * 离线 GUI 测试：栏目收藏 / 删除 / 清空 / Delete 键焦点保护。
 *
 * 不联网——启动前直接把 electron-store 的 config.json 预置到隔离的 userDataDir，
 * 让应用带着已知栏目启动。
 */

test.describe('栏目管理（收藏/删除/清空）', () => {
  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-prog-'))
    // Seed electron-store: 栏目甲 already favorited; the rest plain.
    const seed = {
      programs: [
        { name: '测试栏目甲', columnId: 'TEST_COL_001', itemId: '', favoritedAt: 1000 },
        { name: '测试栏目乙', columnId: 'TEST_COL_002', itemId: '' },
        { name: '测试栏目丙', columnId: 'TEST_COL_003', itemId: '' },
        { name: '测试栏目丁', columnId: 'TEST_COL_004', itemId: '' }
      ]
    }
    fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(seed), 'utf-8')

    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env },
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

  test('预置栏目渲染，已收藏项落入「收藏」分组', async () => {
    await expect(page.locator('.program-item')).toHaveCount(4)
    const headers = page.locator('.program-group-header')
    await expect(headers).toHaveCount(2)
    await expect(headers.nth(0)).toContainText('收藏')
    await expect(headers.nth(1)).toContainText('全部')
    // 已收藏的测试栏目甲应是第一项（收藏组顶部）
    await expect(page.locator('.program-item').first()).toContainText('测试栏目甲')
  })

  test('在搜索框按 Delete 不会误删选中栏目（焦点保护）', async () => {
    await page.locator('.program-item', { hasText: '测试栏目乙' }).click()
    const search = page.locator('input[placeholder*="搜索栏目"]')
    await search.fill('')
    const before = await page.locator('.program-item').count()
    await search.fill('测试')
    await search.press('Delete')
    await page.waitForTimeout(200)
    await search.fill('')
    expect(await page.locator('.program-item').count()).toBe(before)
  })

  test('点击星标收藏后置顶到收藏组顶部', async () => {
    const target = page.locator('.program-item', { hasText: '测试栏目丁' })
    await target.hover()
    await target.locator('.prog-action-btn.star').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.program-item').first()).toContainText('测试栏目丁')
  })

  test('悬停删除按钮可删除栏目', async () => {
    const before = await page.locator('.program-item').count()
    const target = page.locator('.program-item', { hasText: '测试栏目丙' })
    await target.hover()
    await target.locator('.prog-action-btn.del').click()
    await page.locator('.el-message-box__btns .el-button--primary').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.program-item')).toHaveCount(before - 1)
    await expect(page.locator('.program-item', { hasText: '测试栏目丙' })).toHaveCount(0)
  })

  test('清空全部栏目', async () => {
    await page.locator('.icon-btn[title="清空全部栏目"]').click()
    await page.locator('.el-message-box__btns .el-button--primary').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.program-item')).toHaveCount(0)
    // 退化为空状态引导
    await expect(page.locator('.program-empty-state')).toBeVisible()
  })
})
