import { describe, expect, it } from 'vitest'
import { BrowseService } from '../../src/main/api/browse'
import { enumerateMonths, scanMonths } from '../../src/shared/month-range'

describe('栏目时间范围扫描 (e2e, 仅元数据)', () => {
  const browse = new BrowseService()

  it('逐月扫描真实 TOPC 栏目并合并去重', async () => {
    const program = await browse.resolveColumnInfo('https://tv.cctv.com/lm/xwlb/index.shtml')
    expect(program.kind ?? 'column').toBe('column')
    const bounds = await browse.getColumnMonthBounds(program.columnId)
    expect(bounds.latest).toMatch(/^\d{6}$/)
    const latest = bounds.latest!
    const previous = new Date(Number(latest.slice(0, 4)), Number(latest.slice(4, 6)) - 2, 1)
    const start = `${previous.getFullYear()}${String(previous.getMonth() + 1).padStart(2, '0')}`
    const months = enumerateMonths(start, latest)
    const result = await scanMonths(months, month => browse.getColumnVideoList(program.columnId, 1, month))
    expect(result.failedMonths).toEqual([])
    expect(result.completed).toBe(months.length)
    expect(result.videos.length).toBeGreaterThan(0)
    expect(new Set(result.videos.map(video => video.guid)).size).toBe(result.videos.length)
  }, 90_000)

  it('VIDA 列表来源的长期节目仍按月份扫描', async () => {
    const program = await browse.resolveColumnInfo('https://jishi.cctv.com/2015/03/03/VIDA1425372752043217.shtml')
    expect(program.kind).toBe('column')
    expect(program.listSource?.type).toBe('album')
    const result = await scanMonths(['201503'], month => browse.getAlbumVideoList(
      program.listSource!.id, month, program.listSource!.serviceId
    ))
    expect(result.failedMonths).toEqual([])
    expect(result.videos.length).toBeGreaterThan(0)
    expect(result.videos.every(video => video.time.startsWith('2015-03'))).toBe(true)
  }, 90_000)

  it('开启片段时扫描历史栏目仍包含该月片段', async () => {
    const program = await browse.resolveColumnInfo('https://tv.cctv.cn/2011/08/16/VIDE1336929662017714.shtml')
    const result = await scanMonths(['201108'], async month => {
      const [episodes, supplementary] = await Promise.all([
        browse.getColumnVideoList(program.columnId, 1, month),
        browse.getSupplementaryVideos(program, month, true)
      ])
      return [...episodes, ...supplementary]
    })
    expect(result.failedMonths).toEqual([])
    expect(result.videos.find(video => video.guid === '002E74F78B6A49eaB6B1CD41FBDFC41B')?.contentType)
      .toBe('fragment')
  }, 90_000)
})
