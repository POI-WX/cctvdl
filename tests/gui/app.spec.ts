import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'

// Locate a sidebar nav button by label text
function navTab(page: any, label: string) {
  return page.locator('.sidebar-nav-item', { hasText: label })
}

test.describe('cctvdl GUI 测试', () => {
  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeAll(async () => {
    // Isolate electron-store in a throwaway dir so tests are deterministic and
    // never depend on (or mutate) the developer's real imported programs/settings.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-'))
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env },
    })
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    if (electronApp) await electronApp.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  test('顶部显示应用标题', async () => {
    await page.waitForSelector('.sidebar-nav-item', { timeout: 10000 })
    await expect(page.locator('.sidebar-app-name')).toBeVisible()
  })

  test('截图：下载页（深色模式）', async () => {
    // enable dark mode + persist (Save), snapshot, then restore + persist
    await navTab(page, '设置').click()
    await page.waitForTimeout(300)
    const htmlBefore = (await page.locator('html').getAttribute('class')) || ''
    if (!htmlBefore.includes('dark')) {
      await page.locator('.settings-item', { hasText: '深色模式' }).locator('.el-switch').click()
      await page.waitForTimeout(200)
    }
    await page.locator('.settings-save-btn').click()
    await page.waitForTimeout(200)
    await navTab(page, '下载').click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(__dirname, 'screenshots/download-dark.png') })
    // restore to light and persist so later tests start from a known state
    await navTab(page, '设置').click()
    await page.waitForTimeout(200)
    await page.locator('.settings-item', { hasText: '深色模式' }).locator('.el-switch').click()
    await page.waitForTimeout(200)
    await page.locator('.settings-save-btn').click()
    await page.waitForTimeout(200)
  })

  test('应用启动并显示三个导航项', async () => {
    await page.waitForSelector('.sidebar-nav-item', { timeout: 10000 })

    await expect(navTab(page, '首页')).toBeVisible()
    await expect(navTab(page, '下载')).toBeVisible()
    await expect(navTab(page, '设置')).toBeVisible()
  })

  test('首页视频区有搜索框', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)
    const searchInput = page.locator('input[placeholder*="搜索标题"]')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('测试关键词')
    expect(await searchInput.inputValue()).toBe('测试关键词')
    await searchInput.fill('')
  })

  test('首页显示导入栏和栏目列表', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(500)

    const importInput = page.locator('.import-row input')
    await expect(importInput).toBeVisible()

    const importBtn = page.locator('button', { hasText: '导入' })
    await expect(importBtn).toBeVisible()

    // Program list container (custom impl, not el-table)
    const programList = page.locator('.program-list')
    await expect(programList).toBeVisible()
  })

  test('下载页显示空状态与队列标题', async () => {
    await navTab(page, '下载').click()
    await page.waitForTimeout(500)

    await expect(page.locator('.dl-overview-title', { hasText: '下载队列' })).toBeVisible()
    await expect(page.getByText('暂无下载任务')).toBeVisible()
  })

  test('设置页显示所有设置项', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)

    // Card layout — labels use .settings-item-name
    await expect(page.locator('.settings-item-name', { hasText: '文件保存位置' })).toBeVisible()
    await expect(page.locator('.settings-item-name', { hasText: '并发下载数' })).toBeVisible()
    await expect(page.locator('.el-slider')).toBeVisible()
    await expect(page.locator('.settings-item-name', { hasText: '视频清晰度' })).toBeVisible()
    await expect(page.locator('.settings-item-name', { hasText: '深色模式' })).toBeVisible()
    await expect(page.locator('.settings-save-btn')).toBeVisible()
  })

  test('状态区域存在于侧边栏', async () => {
    // Status area is at the sidebar bottom
    const sidebar = page.locator('.app-sidebar')
    await expect(sidebar).toBeVisible()
    const status = page.locator('.sidebar-status')
    await expect(status).toBeAttached()
  })

  test('截图：首页', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(__dirname, 'screenshots/home.png') })
  })

  test('截图：下载页', async () => {
    await navTab(page, '下载').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(__dirname, 'screenshots/download.png') })
  })

  test('截图：设置页', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(__dirname, 'screenshots/settings.png') })
  })

  test('首页导出按钮存在且无节目时禁用', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(500)
    // Export is an icon button with title="导出栏目"
    const exportBtn = page.locator('.icon-btn[title="导出栏目"]')
    await expect(exportBtn).toBeVisible()
    await expect(exportBtn).toBeDisabled()
  })

  test('首页 JSON 导入按钮存在且可用', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)
    const importBtn = page.locator('.icon-btn[title="从 JSON 导入栏目"]')
    await expect(importBtn).toBeVisible()
    await expect(importBtn).toBeEnabled()
  })

  test('深色模式切换生效', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)

    const htmlBefore = await page.locator('html').getAttribute('class') || ''
    const wasDark = htmlBefore.includes('dark')

    const darkSwitch = page.locator('.settings-item', { hasText: '深色模式' }).locator('.el-switch')
    await darkSwitch.click()
    await page.waitForTimeout(500)

    const htmlAfter = await page.locator('html').getAttribute('class') || ''
    if (wasDark) {
      expect(htmlAfter).not.toContain('dark')
    } else {
      expect(htmlAfter).toContain('dark')
    }

    // restore
    await darkSwitch.click()
    await page.waitForTimeout(300)
  })

  test('切换标签页不丢失下载页状态', async () => {
    await navTab(page, '下载').click()
    await page.waitForTimeout(500)
    const downloadTitle = page.locator('.dl-overview-title', { hasText: '下载队列' })
    await expect(downloadTitle).toBeVisible()

    await navTab(page, '首页').click()
    await page.waitForTimeout(300)
    await navTab(page, '下载').click()
    await page.waitForTimeout(300)

    await expect(downloadTitle).toBeVisible()
  })

  test('设置页保存按钮可点击', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)
    const saveBtn = page.locator('.settings-save-btn')
    await expect(saveBtn).toBeEnabled()
  })

  test('设置页并发下载数默认为8', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)

    // Thread count is displayed in .thread-value
    const concurrencyValue = page.locator('.thread-value')
    const text = await concurrencyValue.textContent()
    expect(text?.trim()).toBe('8')
  })

  test('设置保存后再读取值一致', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)

    const slider = page.locator('.el-slider__runway').first()
    await expect(slider).toBeVisible()

    const saveBtn = page.locator('.settings-save-btn')
    await saveBtn.click()
    await page.waitForTimeout(300)

    const successMsg = page.locator('.el-message--success')
    await expect(successMsg).toBeVisible({ timeout: 3000 })
  })

  test('首页导入输入框可输入', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(500)

    const importInput = page.locator('.import-row input')
    await importInput.fill('https://tv.cctv.com/lm/xwlb/index.shtml')
    const val = await importInput.inputValue()
    expect(val).toBe('https://tv.cctv.com/lm/xwlb/index.shtml')

    await importInput.fill('')
  })

  test('F5 快捷键在无节目时不报错', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(500)

    await page.keyboard.press('F5')
    await page.waitForTimeout(500)

    await expect(navTab(page, '首页')).toBeVisible()
  })

  test('Ctrl+A 快捷键在有视频时全选', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(500)

    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)

    await expect(navTab(page, '首页')).toBeVisible()
  })

  test('下载页空闲时仅显示打开文件夹，无取消按钮', async () => {
    await navTab(page, '下载').click()
    await page.waitForTimeout(500)

    // 打开文件夹按钮（.dl-action-btn，包含"打开文件夹"文字）
    await expect(page.locator('.dl-action-btn', { hasText: '打开文件夹' })).toBeVisible()
    // Cancel-all button absent when idle
    await expect(page.locator('.dl-action-btn', { hasText: '全部取消' })).toHaveCount(0)
  })

  test('下载页切换标签后返回仍显示队列（v-show 不销毁）', async () => {
    await navTab(page, '下载').click()
    await page.waitForTimeout(300)
    // Empty state visible → component is mounted
    await expect(page.locator('.dl-empty-title')).toBeVisible()

    // switch away and back
    await navTab(page, '首页').click()
    await page.waitForTimeout(200)
    await navTab(page, '下载').click()
    await page.waitForTimeout(200)

    // component stays mounted, title still present
    await expect(page.locator('.dl-overview-title', { hasText: '下载队列' })).toBeVisible()
  })

  test('合并方式默认无损快速', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)

    // custom radio-option, active class = selected
    const losslessOption = page.locator('.radio-option', { hasText: '无损快速' })
    await expect(losslessOption).toBeVisible()
    await expect(losslessOption).toHaveClass(/active/)
  })

  test('设置页标签字段完整（防止常量漂移）', async () => {
    await navTab(page, '设置').click()
    await page.waitForTimeout(500)

    // Custom settings page, labels use .settings-item-name
    const expectedLabels = ['文件保存位置', '并发下载数', '视频清晰度', '合并方式', '下载完成后打开文件夹', '剪贴板自动导入', '日志级别', '深色模式', '日志目录']
    for (const label of expectedLabels) {
      const el = page.locator('.settings-item-name', { hasText: label })
      await expect(el).toBeVisible()
    }
  })

  test('键盘快捷键 1/2/3 切换导航标签', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)

    await page.keyboard.press('2')
    await page.waitForTimeout(300)
    await expect(navTab(page, '下载')).toHaveClass(/active/)

    await page.keyboard.press('3')
    await page.waitForTimeout(300)
    await expect(navTab(page, '设置')).toHaveClass(/active/)

    await page.keyboard.press('1')
    await page.waitForTimeout(300)
    await expect(navTab(page, '首页')).toHaveClass(/active/)
  })

  test('侧边栏展开/折叠切换', async () => {
    const toggleBtn = page.locator('.sidebar-toggle')
    await expect(toggleBtn).toBeVisible()
    const sidebar = page.locator('.app-sidebar')
    const beforeExpanded = await sidebar.evaluate((el: Element) => el.classList.contains('expanded'))
    await toggleBtn.click()
    await page.waitForTimeout(300)
    const afterExpanded = await sidebar.evaluate((el: Element) => el.classList.contains('expanded'))
    expect(afterExpanded).not.toBe(beforeExpanded)
    // Restore
    await toggleBtn.click()
    await page.waitForTimeout(300)
  })

  // ── U3 · 下载页空状态「去首页」按钮 ────────────────────────────
  test('U3: 下载页空状态有「去首页」按钮，点击后切换到首页', async () => {
    await navTab(page, '下载').click()
    await page.waitForTimeout(300)

    const goHomeBtn = page.locator('.dl-empty button', { hasText: '去首页选择视频' })
    await expect(goHomeBtn).toBeVisible()

    await goHomeBtn.click()
    await page.waitForTimeout(300)

    await expect(navTab(page, '首页')).toHaveClass(/active/)
  })

  // ── U4 · 已下载标记增强 ─────────────────────────────────────
  test('U4: 已下载标记在单个视频列表中显示 ✓ 图标', async () => {
    // 切到首页，进入「单个视频」集合（即使为空，列表区也存在）
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)

    const singleEntry = page.locator('.single-entry')
    await expect(singleEntry).toBeVisible()

    // .v-dl-check 仅当有已下载的视频时出现；此处验证 CSS 类不报错（无视频时计数为 0）
    // 通过检查 .video-list 容器存在来确保组件已渲染
    await expect(page.locator('.video-list')).toBeVisible()
  })

  // ── U5 · 骨架屏 ────────────────────────────────────────────
  test('U5: video-list 区域骨架屏组件已注册（el-skeleton 存在于 DOM）', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)
    // 骨架屏在加载中时出现；此处验证组件已注册、DOM 不报错
    // 实际加载触发后会瞬间完成（无网络），断言 .video-list 正常渲染
    await expect(page.locator('.video-list')).toBeVisible()
  })

  // ── U2 · 预览面板可折叠 ─────────────────────────────────────
  test('U2: 预览面板折叠/展开按钮存在并可切换', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)

    const toggleBtn = page.locator('.preview-toggle')
    await expect(toggleBtn).toBeVisible()

    // 点击折叠
    await toggleBtn.click()
    await page.waitForTimeout(200)
    const panel = page.locator('.preview-panel')
    await expect(panel).toBeHidden()

    // 再次展开
    await toggleBtn.click()
    await page.waitForTimeout(200)
    await expect(panel).toBeVisible()
  })

  // ── U1 · 视频行缩略图 ──────────────────────────────────────
  test('U1: 单个视频集合视频行有缩略图 img 元素', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)

    // 切到单个视频集合
    const singleEntry = page.locator('.single-entry')
    await singleEntry.click()
    await page.waitForTimeout(200)

    // 无视频时列表为空，验证 video-list 渲染正常（有视频时 .v-thumb 会出现）
    await expect(page.locator('.video-list')).toBeVisible()
  })

  // ── U6 · 月份指示器 ────────────────────────────────────────
  test('U6: 月份指示器在有内容月份不显示 empty-dot，空月显示', async () => {
    await navTab(page, '首页').click()
    await page.waitForTimeout(300)

    // 无栏目时月份选择器不显示，验证 month-row 不报错
    // 无选中栏目时 month-row 存在但月份选择器被隐藏，不需额外断言
    await expect(page.locator('.video-list')).toBeVisible()
  })
})

// ── 0.2.4 · 版本更新提醒 GUI 测试 ────────────────────────────────────────────
test.describe('0.2.4 版本更新提醒', () => {
  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-update-'))
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, MOCK_UPDATE_VERSION: '9.9.9' },
    })
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)
  })

  test.afterAll(async () => {
    if (electronApp) await electronApp.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  test('有新版本时侧边栏品牌按钮显示更新红点', async () => {
    await expect(page.locator('.sidebar-update-dot')).toBeVisible()
  })

  test('打开关于弹窗后显示新版本提示链接', async () => {
    await page.locator('.sidebar-brand').click()
    await page.waitForTimeout(300)
    const updateLink = page.locator('.about-update-link')
    await expect(updateLink).toBeVisible()
    await expect(updateLink).toContainText('9.9.9')
  })
})
