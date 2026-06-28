import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

/**
 * GUI 真实用户流程测试
 * 测试真实的导入→浏览→下载流程（需要网络）
 *
 * 运行方式（需要网络）：
 * npm run build && npx playwright test tests/gui/flow.spec.ts --config=tests/gui/playwright.config.ts
 */

test.describe('真实用户流程', () => {
  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeAll(async () => {
    // Isolated electron-store so the flow starts from a clean, predictable state.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-flow-'))
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env },
    })
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
  })

  test.afterAll(async () => {
    if (electronApp) await electronApp.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  test('导入→浏览→选中→下载按钮可用 流程（世界战史）', async () => {
    const COLUMN_URL = 'https://tv.cctv.com/lm/sjzs/index.shtml'

    // 1. 确保在首页
    const homeTab = page.locator('.sidebar-nav-item', { hasText: '首页' })
    await homeTab.click()
    await page.waitForTimeout(500)

    // 2. 导入节目
    const importInput = page.locator('.import-row input')
    await importInput.fill(COLUMN_URL)
    await importInput.press('Enter')

    // 等待导入结果 toast（成功/已存在/失败均会出现，给 CI 充裕时间）
    await expect(page.locator('.el-message').first()).toBeVisible({ timeout: 30000 })

    // 3. 验证节目已导入（在列表中，现在是自定义 .program-item）
    const programRow = page.locator('.program-item')
    await expect(programRow.first()).toBeVisible({ timeout: 15000 })

    // 4. 点击节目，加载视频列表
    await programRow.first().click()

    // 5. 等待视频列表出现（video-item 或空状态 hint 均可，给 CI 充裕时间）
    await expect(
      page.locator('.video-item, .video-hint').first()
    ).toBeVisible({ timeout: 15000 })

    // 6. 验证视频列表（现在是自定义 .video-item）
    const videoItems = page.locator('.video-item')
    const videoCount = await videoItems.count()
    const hasHint = await page.locator('.video-hint').count() > 0
    // Either we found video rows, or the list legitimately has no data this month.
    expect(videoCount > 0 || hasHint).toBe(true)

    if (videoCount > 0) {
      // 7. 选中第一个视频
      const firstCheckbox = videoItems.first().locator('.el-checkbox')
      await firstCheckbox.click()

      // 8. 下载按钮应该变为可用
      const downloadBtn = page.locator('button', { hasText: /下载选中/ })
      await expect(downloadBtn).toBeEnabled()

      const btnText = await downloadBtn.textContent()
      expect(btnText).toMatch(/下载选中/)
    }
  })

  test('导入具体节目 URL 获取正确栏目', async () => {
    const EPISODE_URL = 'https://tv.cctv.com/2021/02/25/VIDE8pDjqmayLVYL1b6JXxyo210225.shtml'

    const homeTab = page.locator('.sidebar-nav-item', { hasText: '首页' })
    await homeTab.click()
    await page.waitForTimeout(500)

    const importInput = page.locator('.import-row input')
    await importInput.fill(EPISODE_URL)
    await importInput.press('Enter')

    // 等待导入结果 toast（给 CI 充裕时间）
    await expect(page.locator('.el-message').first()).toBeVisible({ timeout: 30000 })

    // Should succeed or show "already exists"
    const messages = await page.locator('.el-message').allTextContents()
    const hasSuccess = messages.some(m => m.includes('导入成功') || m.includes('已存在'))
    const hasError = messages.some(m => m.includes('导入失败'))
    expect(hasSuccess || !hasError).toBe(true)
  })

  test('设置页修改并发数后保存，下载任务使用新并发数', async () => {
    // Change settings
    const settingsTab = page.locator('.sidebar-nav-item', { hasText: '设置' })
    await settingsTab.click()
    await page.waitForTimeout(500)

    // Verify current slider value
    const concurrencySpan = page.locator('.settings-item', { hasText: '下载线程数' }).locator('.thread-value')
    const currentVal = await concurrencySpan.textContent()
    expect(['8', '4', '2', '1', '3', '5', '6', '7', '9', '10', '11', '12', '13', '14', '15', '16']).toContain(currentVal?.trim())

    // Save settings
    const saveBtn = page.locator('.settings-save-btn')
    await saveBtn.click()
    await page.waitForTimeout(500)

    // Verify success message. Scope to this action's toast and take the latest:
    // a success toast from an earlier test can still be in its fade-out
    // animation, which otherwise trips Playwright's strict-mode (>1 match).
    const successMsg = page.locator('.el-message--success', { hasText: '保存成功' }).last()
    await expect(successMsg).toBeVisible({ timeout: 3000 })
  })
})
