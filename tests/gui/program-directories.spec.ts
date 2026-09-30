import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('按节目分文件夹覆盖混选与时间范围，并在确认时显示实际位置', async () => {
  test.setTimeout(60_000)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-gui-directories-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: 'C:\\Videos', coverSavePath: 'C:\\Pictures', logPath: 'C:\\Logs' },
    programs: [
      { name: '测试栏目 1', columnId: 'VIDA-dir-a', itemId: '', kind: 'column',
        listSource: { type: 'album', id: 'VIDA-dir-a', serviceId: 'tvcctv' } },
      { name: '测试专辑 2', columnId: 'VIDA-dir-b', itemId: '', kind: 'album' }
    ],
    singleVideos: [{ guid: 'dir-single', title: '测试独立视频', brief: '', coverUrl: '', time: '2026-01-01' }]
  }))
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { directoryJobs?: Array<Array<{ guid: string; savePath: string; saveRoot?: string; programName?: string }>> }
      state.directoryJobs = []
      ipcMain.removeHandler('list-videos')
      ipcMain.handle('list-videos', (_event, program: { columnId: string }) => [{
        guid: program.columnId, title: '测试视频 1', brief: '', coverUrl: '', time: '2026-01-01'
      }])
      ipcMain.removeHandler('get-program-month-bounds')
      ipcMain.handle('get-program-month-bounds', () => ({ earliest: '202601', latest: '202601' }))
      ipcMain.removeHandler('estimate-download')
      ipcMain.handle('estimate-download', (_event, videos: unknown[]) => ({
        estimatedBytes: videos.length * 100 * 1024 ** 2, estimatedCount: videos.length,
        totalCount: videos.length, diskFreeBytes: 10 * 1024 ** 3
      }))
      ipcMain.removeHandler('start-download')
      ipcMain.handle('start-download', (_event, jobs: Array<{ guid: string; savePath: string; saveRoot?: string; programName?: string }>) => {
        state.directoryJobs!.push(jobs)
        return { added: jobs.length, skipped: 0, addedGuids: jobs.map(job => job.guid) }
      })
    })
    const screenshots = path.join(__dirname, '../../test-results/program-directories')
    fs.mkdirSync(screenshots, { recursive: true })
    const capture = async (name: string) => {
      await page.locator('.el-message').evaluateAll(messages => messages.forEach(message => message.remove()))
      const viewport = page.viewportSize()!
      await page.mouse.move(viewport.width - 10, viewport.height - 10)
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(screenshots, name), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 720, height: 680 })
    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    const setting = page.locator('.settings-item', { hasText: '按节目分文件夹' })
    await expect(setting.locator('.el-switch')).not.toHaveClass(/is-checked/)
    await setting.locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await capture('720-settings.png')
    await page.setViewportSize({ width: 1280, height: 1000 })
    await capture('1280-settings.png')
    await page.setViewportSize({ width: 720, height: 680 })
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    for (const name of ['测试栏目 1', '测试专辑 2']) {
      await page.locator('.program-item', { hasText: name }).click()
      await expect(page.locator('.video-item')).toHaveCount(1)
      await page.locator('.video-item .el-checkbox__inner').click()
    }
    await page.locator('.single-entry').click()
    await page.locator('.video-item .el-checkbox__inner').click()
    await page.getByRole('button', { name: '下载选中' }).click()
    const confirm = page.locator('.download-confirm-dialog')
    await expect(confirm.locator('.download-confirm-destination')).toHaveCount(3)
    await expect(confirm).toContainText('1 个专辑')
    await expect(confirm.locator('.download-confirm-destinations')).toContainText('C:\\Videos\\测试栏目 1')
    await expect(confirm.locator('.download-confirm-destinations')).toContainText('C:\\Videos\\测试专辑 2')
    await capture('720-mixed-confirm.png')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await capture('1280-mixed-dark.png')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await confirm.getByRole('button', { name: '加入队列' }).click()
    const jobs = await app.evaluate(() => (globalThis as typeof globalThis & {
      directoryJobs?: Array<Array<{ guid: string; savePath: string; saveRoot?: string; programName?: string }>>
    }).directoryJobs![0])
    expect(jobs.map(job => job.savePath.replace(/\\/g, '/'))).toEqual([
      'C:/Videos/测试栏目 1/测试视频 1.mp4',
      'C:/Videos/测试专辑 2/测试视频 1.mp4',
      'C:/Videos/测试独立视频.mp4'
    ])
    expect(jobs.every(job => job.saveRoot === 'C:\\Videos')).toBe(true)

    await page.locator('.program-item', { hasText: '测试栏目 1' }).click()
    await page.locator('.footer-range-btn').click()
    const range = page.locator('.month-range-dialog')
    await range.getByRole('button', { name: '全部月份' }).click()
    await range.getByRole('button', { name: '查找视频' }).click()
    await expect(range.locator('.range-save-path')).toHaveText('C:\\Videos\\测试栏目 1')
    await capture('1280-range.png')
    await range.getByRole('button', { name: '加入队列' }).click()
    await expect(range).toBeHidden()

    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await setting.locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await page.locator('.sidebar-nav-item', { hasText: '首页' }).click()
    await page.locator('.program-item', { hasText: '测试栏目 1' }).click()
    await page.locator('.video-item .el-checkbox__inner').click()
    await page.getByRole('button', { name: '下载选中' }).click()
    await expect(confirm.locator('.download-confirm-row', { hasText: '保存到' })).toContainText('C:\\Videos')
    await expect(confirm.locator('.download-confirm-row', { hasText: '保存到' })).not.toContainText('测试栏目 1')
    await confirm.getByRole('button', { name: '返回检查' }).click()
    const album = page.locator('.program-item', { hasText: '测试专辑 2' })
    await album.hover()
    await album.getByTitle('删除专辑').click()
    await expect(page.locator('.el-message-box')).toContainText('确定删除专辑「测试专辑 2」吗？')
    await page.locator('.el-message-box').getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    await app.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('下载历史重新下载采用当前目录，兼容有节目来源和旧记录', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-gui-history-directories-'))
  fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    settings: { savePath: 'C:\\Videos', groupByProgram: true },
    downloadHistory: [
      { guid: 'history-programme', title: '测试历史视频 1', programName: '测试专辑 1',
        outputPath: 'C:\\OldVideos\\测试专辑 1\\旧视频.mp4', completedAt: 1, fileSize: 1024 },
      { guid: 'history-legacy', title: '测试历史视频 2',
        outputPath: 'C:\\OldVideos\\旧视频.mp4', completedAt: 1, fileSize: 1024 }
    ]
  }))
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`]
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        historyDirectoryJobs?: Array<{ guid: string; savePath: string; saveRoot?: string; programName?: string }>
      }
      state.historyDirectoryJobs = []
      ipcMain.removeHandler('select-directory')
      ipcMain.handle('select-directory', () => 'C:\\NewVideos')
      ipcMain.removeHandler('retry-job')
      ipcMain.handle('retry-job', (_event, job: { guid: string; savePath: string; saveRoot?: string; programName?: string }) => {
        state.historyDirectoryJobs!.push(job)
      })
    })
    const recordedJobs = () => app.evaluate(() => (globalThis as typeof globalThis & {
      historyDirectoryJobs?: Array<{ guid: string; savePath: string; saveRoot?: string; programName?: string }>
    }).historyDirectoryJobs!)
    await page.locator('.sidebar-nav-item', { hasText: '设置' }).click()
    await page.locator('.settings-item', { hasText: '视频保存目录' }).getByRole('button', { name: '浏览…' }).click()
    await page.locator('.settings-save-btn').click()

    const programme = page.locator('.history-item', { hasText: '测试历史视频 1' })
    await programme.getByTitle('重新下载').click()
    await expect.poll(async () => (await recordedJobs()).length).toBe(1)
    await page.locator('.history-item', { hasText: '测试历史视频 2' }).getByTitle('重新下载').click()
    await expect.poll(async () => (await recordedJobs()).length).toBe(2)

    await page.locator('.settings-item', { hasText: '按节目分文件夹' }).locator('.el-switch').click()
    await page.locator('.settings-save-btn').click()
    await programme.getByTitle('重新下载').click()
    await expect.poll(async () => (await recordedJobs()).length).toBe(3)
    const jobs = await recordedJobs()
    expect(jobs.map(job => job.savePath.replace(/\\/g, '/'))).toEqual([
      'C:/NewVideos/测试专辑 1/测试历史视频 1.mp4',
      'C:/NewVideos/测试历史视频 2.mp4',
      'C:/NewVideos/测试历史视频 1.mp4'
    ])
    expect(jobs.every(job => job.saveRoot === 'C:\\NewVideos')).toBe(true)
    expect(jobs.map(job => job.programName)).toEqual(['测试专辑 1', undefined, '测试专辑 1'])
  } finally {
    await app.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
