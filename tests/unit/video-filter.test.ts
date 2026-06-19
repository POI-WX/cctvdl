import { describe, it, expect } from 'vitest'
import { filterVideos } from '../../src/shared/video-filter'

const sample = [
  { title: '新闻联播 20260101', brief: '今日要闻', time: '2026-01-01' },
  { title: '焦点访谈 20260102', brief: '调查报道', time: '2026-01-02' },
  { title: '世界战史 突袭雷达站', brief: '二战纪录', time: '2026-06-19' },
]

describe('filterVideos', () => {
  it('returns all when query is empty/whitespace', () => {
    expect(filterVideos(sample, '')).toHaveLength(3)
    expect(filterVideos(sample, '   ')).toHaveLength(3)
  })

  it('matches by title (case-insensitive)', () => {
    expect(filterVideos(sample, '焦点')).toEqual([sample[1]])
    expect(filterVideos(sample, '战史')).toEqual([sample[2]])
  })

  it('matches by brief keyword', () => {
    expect(filterVideos(sample, '纪录')).toEqual([sample[2]])
  })

  it('matches by date', () => {
    expect(filterVideos(sample, '2026-01-02')).toEqual([sample[1]])
  })

  it('returns empty when nothing matches', () => {
    expect(filterVideos(sample, '不存在的关键词')).toEqual([])
  })

  it('handles missing brief/time fields', () => {
    const minimal = [{ title: 'Only Title' }]
    expect(filterVideos(minimal, 'title')).toHaveLength(1)
    expect(filterVideos(minimal, 'xyz')).toHaveLength(0)
  })
})
