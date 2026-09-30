import { describe, expect, it } from 'vitest'
import path from 'path'
import { completionFolders } from '../../../src/main/download/completion-folders'

describe('completion folders', () => {
  it('opens the actual folder when all successful files share it', () => {
    expect(completionFolders([
      { outputPath: '/videos/节目/a.mp4', saveRoot: '/videos' },
      { outputPath: '/videos/节目/b.mp4', saveRoot: '/videos' }
    ])).toEqual([path.resolve('/videos/节目')])
  })

  it('opens the recorded root once for several programme folders', () => {
    expect(completionFolders([
      { outputPath: '/videos/测试栏目 1/a.mp4', saveRoot: '/videos' },
      { outputPath: '/videos/测试栏目 2/b.mp4', saveRoot: '/videos' },
      { outputPath: '/videos/c.mp4', saveRoot: '/videos' }
    ])).toEqual([path.resolve('/videos')])
  })

  it('opens each distinct root once when the save location changed during a batch', () => {
    expect(completionFolders([
      { outputPath: '/old/节目/a.mp4', saveRoot: '/old' },
      { outputPath: '/new/节目/b.mp4', saveRoot: '/new' },
      { outputPath: '/new/节目/c.mp4', saveRoot: '/new' }
    ])).toEqual([path.resolve('/old'), path.resolve('/new')])
  })

  it('uses actual output folders for legacy jobs and rejects unrelated recorded roots', () => {
    expect(completionFolders([
      { outputPath: '/old/a.mp4' },
      { outputPath: '/saved/b.mp4', saveRoot: '/unrelated' }
    ])).toEqual([path.resolve('/old'), path.resolve('/saved')])
  })

  it('does not open a folder without successful output', () => {
    expect(completionFolders([])).toEqual([])
  })
})
