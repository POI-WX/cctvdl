import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { checkSaveDir } from '../../src/main/preflight'

describe('checkSaveDir', () => {
  const created: string[] = []
  afterEach(() => {
    for (const d of created) fs.rmSync(d, { recursive: true, force: true })
    created.length = 0
  })

  it('rejects an empty path', () => {
    expect(checkSaveDir('').ok).toBe(false)
    expect(checkSaveDir('   ').reason).toContain('未设置保存位置')
  })

  it('accepts and creates a writable directory (real fs)', () => {
    const dir = path.join(os.tmpdir(), `cctvdl-pf-${Date.now()}`)
    created.push(dir)
    const r = checkSaveDir(dir)
    expect(r.ok).toBe(true)
    expect(fs.existsSync(dir)).toBe(true)
  })

  it('reports a create failure via injected fs', () => {
    const fakeFs = {
      mkdirSync: () => { throw new Error('EACCES') },
      writeFileSync: () => {},
      rmSync: () => {}
    }
    const r = checkSaveDir('/nope', fakeFs)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('无法创建保存目录')
  })

  it('reports an unwritable directory via injected fs', () => {
    const fakeFs = {
      mkdirSync: () => {},
      writeFileSync: () => { throw new Error('EROFS') },
      rmSync: () => {}
    }
    const r = checkSaveDir('/readonly', fakeFs)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不可写')
  })
})
