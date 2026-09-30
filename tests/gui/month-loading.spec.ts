import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('切换月份或栏目时不暴露旧列表操作，失败后可重试', async () => {
  test.setTimeout(90_000)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-month-loading-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(userDataDir, 'videos') },
    programs: [
      { name: '测试栏目 1', columnId: 'TOPC-test-a', itemId: '', kind: 'column' },
      { name: '测试栏目 2', columnId: 'TOPC-test-b', itemId: '', kind: 'column' }
    ],
    singleVideos: [
      { guid: 'single', title: '独立视频', brief: '', coverUrl: '', time: '2026-08-01' }
    ]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        monthLoadTest?: {
          augustRequests: number
          otherRequests: number
          pending: Record<string, { resolve: (videos: unknown[]) => void; reject: (error: Error) => void }>
        }
      }
      const testState = state.monthLoadTest = { augustRequests: 0, otherRequests: 0, pending: {} }
      const video = (guid: string, title: string) => ({
        guid, title, brief: '', coverUrl: '', time: '2026-08-01'
      })
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', (_event, program: { columnId: string }, month: string) => {
        if (program.columnId === 'TOPC-test-a' && month === '202609') {
          return [video('september', '测试视频（9月）')]
        }
        if (program.columnId === 'TOPC-test-a' && month === '202608') {
          testState.augustRequests++
          if (testState.augustRequests !== 2) {
            const key = `a-${testState.augustRequests}`
            return new Promise((resolve, reject) => { testState.pending[key] = { resolve, reject } })
          }
          return [video('august', '测试视频（8月）')]
        }
        if (program.columnId === 'TOPC-test-b') {
          testState.otherRequests++
          if (testState.otherRequests === 2) {
            return new Promise((resolve, reject) => { testState.pending['b-2'] = { resolve, reject } })
          }
          return [video('other', '乙栏目视频')]
        }
        return []
      })
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202608', latest: '202609' }))
    })

    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    const month = page.locator('.month-row input')
    await month.fill('2026-09')
    await month.press('Enter')
    await page.locator('.program-item', { hasText: '测试栏目 1' }).click()
    await expect(page.locator('.video-item', { hasText: '测试视频（9月）' })).toBeVisible()
    await page.locator('.video-item').first().locator('.el-checkbox__inner').click()

    await month.fill('2026-08')
    await month.press('Enter')
    await expect(page.locator('.video-skeleton')).toBeVisible()
    await expect(page.locator('.video-item')).toHaveCount(0)
    await expect(page.locator('.select-current-list .el-checkbox__input')).toHaveClass(/is-disabled/)
    await expect(page.locator('button', { hasText: '下载本月' })).toHaveCount(0)
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')
    await page.locator('.video-skeleton').click()
    await page.keyboard.press('ControlOrMeta+A')
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & {
      monthLoadTest?: { pending: Record<string, unknown> }
    }).monthLoadTest?.pending['a-1']))).toBe(true)
    await app.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        monthLoadTest?: { pending: Record<string, { reject: (error: Error) => void }> }
      }).monthLoadTest
      state?.pending['a-1'].reject(new Error('network unavailable'))
      if (state) delete state.pending['a-1']
    })
    await expect(page.locator('.video-load-error')).toContainText('视频列表加载失败')
    await expect(page.locator('.video-hint')).not.toContainText('该月份暂无视频')
    await page.locator('.video-load-error button', { hasText: '重试' }).click()
    await expect(page.locator('.video-item', { hasText: '测试视频（8月）' })).toBeVisible()
    await expect(page.locator('.video-item', { hasText: '测试视频（9月）' })).toHaveCount(0)

    await page.locator('.program-item', { hasText: '测试栏目 1' }).click()
    await expect(page.locator('.video-skeleton')).toBeVisible()
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & {
      monthLoadTest?: { pending: Record<string, unknown> }
    }).monthLoadTest?.pending['a-3']))).toBe(true)
    await page.locator('.program-item', { hasText: '测试栏目 2' }).click()
    await expect(page.locator('.video-item', { hasText: '乙栏目视频' })).toBeVisible()
    await app.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        monthLoadTest?: { pending: Record<string, { resolve: (videos: unknown[]) => void }> }
      }).monthLoadTest
      state?.pending['a-3'].resolve([{ guid: 'late', title: '测试栏目 1 视频（延迟返回）', brief: '', coverUrl: '', time: '2026-08-01' }])
      if (state) delete state.pending['a-3']
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.video-item', { hasText: '迟到的甲栏目视频' })).toHaveCount(0)

    await page.locator('.program-item', { hasText: '测试栏目 2' }).click()
    await expect(page.locator('.video-skeleton')).toBeVisible()
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & {
      monthLoadTest?: { pending: Record<string, unknown> }
    }).monthLoadTest?.pending['b-2']))).toBe(true)
    await page.locator('.single-entry').click()
    await expect(page.locator('.video-item', { hasText: '独立视频' })).toBeVisible()
    await app.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        monthLoadTest?: { pending: Record<string, { resolve: (videos: unknown[]) => void }> }
      }).monthLoadTest
      state?.pending['b-2'].resolve([{ guid: 'late-other', title: '测试栏目 2 视频（延迟返回）', brief: '', coverUrl: '', time: '2026-08-01' }])
      if (state) delete state.pending['b-2']
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.video-item', { hasText: '迟到的乙栏目视频' })).toHaveCount(0)
    await expect(page.locator('.video-item', { hasText: '独立视频' })).toBeVisible()
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-month-loading-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})

test('列表加载期间离开首页，返回后自动恢复当前栏目', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-return-loading-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(userDataDir, 'videos') },
    programs: [{ name: '测试栏目', columnId: 'TOPC-return', itemId: '', kind: 'column' }]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        returnLoadingTest?: { calls: number; resolvePending?: (videos: unknown[]) => void }
      }
      const testState = state.returnLoadingTest = { calls: 0 }
      const list = [{ guid: 'episode', title: '应有的视频', brief: '', coverUrl: '', time: '2026-09-01' }]
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => {
        testState.calls++
        if (testState.calls === 2) {
          return new Promise(resolve => { testState.resolvePending = resolve })
        }
        return list
      })
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202609', latest: '202609' }))
    })

    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: '测试栏目' }).click()
    await expect(page.locator('.video-item', { hasText: '应有的视频' })).toBeVisible()
    await page.keyboard.press('F5')
    await expect(page.locator('.video-skeleton')).toBeVisible()
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & {
      returnLoadingTest?: { resolvePending?: unknown }
    }).returnLoadingTest?.resolvePending))).toBe(true)

    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & {
      returnLoadingTest?: { calls: number }
    }).returnLoadingTest?.calls)).toBe(3)
    await expect(page.locator('.video-item', { hasText: '应有的视频' })).toBeVisible()
    await expect(page.locator('.video-hint', { hasText: '该月份暂无视频' })).toHaveCount(0)

    await app.evaluate(() => (globalThis as typeof globalThis & {
      returnLoadingTest?: { resolvePending?: (videos: unknown[]) => void }
    }).returnLoadingTest?.resolvePending?.([{ guid: 'stale', title: '迟到的旧列表', brief: '', coverUrl: '', time: '2026-09-01' }]))
    await page.waitForTimeout(100)
    await expect(page.locator('.video-item', { hasText: '迟到的旧列表' })).toHaveCount(0)
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-return-loading-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})
