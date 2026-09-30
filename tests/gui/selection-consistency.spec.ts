import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('跨视图已选清单只移除删除来源和实际入队的视频', async () => {
  test.setTimeout(90_000)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-selection-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(userDataDir, 'videos') },
    programs: [
      { name: '测试栏目甲', columnId: 'TOPC-test-a', itemId: '', kind: 'column' },
      { name: '测试栏目乙', columnId: 'TOPC-test-b', itemId: '', kind: 'column' }
    ],
    singleVideos: [{ guid: 'single', title: '独立视频', brief: '', coverUrl: '', time: '2026-09-03' }]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        selectionTest?: { calls: Array<{ guids: string[] }> }
      }
      const testState = state.selectionTest = { calls: [] }
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', (_event, program: { columnId: string }) => [{
        guid: program.columnId === 'TOPC-test-a' ? 'column-a' : 'column-b',
        title: program.columnId === 'TOPC-test-a' ? '栏目甲视频' : '栏目乙视频',
        brief: '', coverUrl: '', time: '2026-09-01'
      }])
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202609', latest: '202609' }))
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: unknown[]) => ({
        estimatedBytes: videos.length * 10 * 1024 * 1024,
        estimatedCount: videos.length, totalCount: videos.length, diskFreeBytes: 1024 ** 3
      }))
      ipcMain.removeHandler('start-download')
      ipcMain.handle('start-download', (_event, jobs: Array<{ guid: string }>) => {
        testState.calls.push({ guids: jobs.map(job => job.guid) })
        if (testState.calls.length === 1) throw new Error('queue unavailable')
        if (testState.calls.length === 2) return { added: 0, skipped: jobs.length, addedGuids: [] }
        if (testState.calls.length === 3) return { added: 1, skipped: jobs.length - 1, addedGuids: ['column-b'] }
        return { added: 1, skipped: jobs.length - 1, addedGuids: ['single'] }
      })
    })

    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    for (const [program, title] of [['测试栏目甲', '栏目甲视频'], ['测试栏目乙', '栏目乙视频']]) {
      await page.locator('.program-item', { hasText: program }).click()
      const row = page.locator('.video-item', { hasText: title })
      await expect(row).toBeVisible()
      await row.locator('.el-checkbox__inner').click()
    }
    await page.locator('.single-entry').click()
    const single = page.locator('.video-item', { hasText: '独立视频' })
    await expect(single).toBeVisible()
    await single.locator('.el-checkbox__inner').click()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('3')

    const firstProgram = page.locator('.program-item', { hasText: '测试栏目甲' })
    await firstProgram.hover()
    await firstProgram.locator('.prog-action-btn.del').click()
    await page.locator('.el-message-box').getByRole('button', { name: '删除' }).click()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('2')

    const submit = async () => {
      await page.locator('button', { hasText: '下载选中' }).click()
      await page.locator('.el-message-box').getByRole('button', { name: '加入队列' }).click()
    }
    await page.locator('button', { hasText: '下载选中' }).click()
    await page.locator('.el-message-box').getByRole('button', { name: '返回检查' }).click()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('2')
    await submit()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('2')
    await submit()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('2')
    await submit()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')

    await page.locator('button[title="清空全部节目"]').click()
    await page.locator('.el-message-box').getByRole('button', { name: '清空' }).click()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')
    await expect(page.locator('.video-item', { hasText: '独立视频' })).toBeVisible()
    await submit()
    await expect(page.locator('button', { hasText: '下载选中' })).toHaveCount(0)

    await single.locator('.el-checkbox__inner').click()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')
    await single.hover()
    await single.locator('.video-del-btn').click()
    await expect(page.locator('.video-item', { hasText: '独立视频' })).toHaveCount(0)
    await expect(page.locator('button', { hasText: '下载选中' })).toHaveCount(0)

    const calls = await app.evaluate(() => (globalThis as typeof globalThis & {
      selectionTest?: { calls: Array<{ guids: string[] }> }
    }).selectionTest?.calls)
    expect(calls).toEqual([
      { guids: ['column-b', 'single'] },
      { guids: ['column-b', 'single'] },
      { guids: ['column-b', 'single'] },
      { guids: ['single'] }
    ])
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-selection-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})

test('导入多条单视频后保留此前栏目的已选项', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-e2e-multi-single-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: path.join(userDataDir, 'videos') },
    programs: [{ name: '测试栏目', columnId: 'TOPC-test', itemId: '', kind: 'column' }]
  }), 'utf-8')
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', () => [{
        guid: 'column-video', title: '栏目视频', brief: '', coverUrl: '', time: '2026-09-01'
      }])
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202609', latest: '202609' }))
      ipcMain.removeHandler('browse-program')
      ipcMain.handle('browse-program', () => { throw new Error('not a program') })
      ipcMain.removeHandler('resolve-video-batch')
      ipcMain.handle('resolve-video-batch', () => [
        { guid: 'single-1', title: '文章视频一', brief: '', coverUrl: '', time: '2026-09-02' },
        { guid: 'single-2', title: '文章视频二', brief: '', coverUrl: '', time: '2026-09-02' }
      ])
    })

    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: '测试栏目' }).click()
    const programVideo = page.locator('.video-item', { hasText: '栏目视频' })
    await expect(programVideo).toBeVisible()
    await programVideo.locator('.el-checkbox__inner').click()

    const input = page.locator('.import-row input')
    await input.fill('https://tv.cctv.com/2026/09/02/VIDEtest.shtml')
    await input.press('Enter')
    await expect(page.locator('.single-entry-count')).toHaveText('2')
    await expect(page.locator('.video-item', { hasText: '文章视频一' })).toBeVisible()
    await expect(page.locator('.video-item', { hasText: '文章视频二' })).toBeVisible()
    await expect(page.locator('button', { hasText: '下载选中' })).toContainText('1')
  } finally {
    await app.close()
    if (path.dirname(userDataDir) === os.tmpdir() && path.basename(userDataDir).startsWith('cctvdl-e2e-multi-single-')) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  }
})
