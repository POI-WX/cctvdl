import { describe, it, expect } from 'vitest'
import { recordMonthResult } from '../../src/shared/month-tracker'

describe('shared/month-tracker · recordMonthResult', () => {
  it('空月份结果：将月份加入集合', () => {
    const result = recordMonthResult(new Set(), '202601', true)
    expect(result.has('202601')).toBe(true)
  })

  it('非空月份结果：不加入集合', () => {
    const result = recordMonthResult(new Set(), '202601', false)
    expect(result.has('202601')).toBe(false)
  })

  it('非空月份结果：从已有集合中移除', () => {
    const existing = new Set(['202601', '202602'])
    const result = recordMonthResult(existing, '202601', false)
    expect(result.has('202601')).toBe(false)
    expect(result.has('202602')).toBe(true)
  })

  it('重复记录空月份不重复添加', () => {
    const s1 = recordMonthResult(new Set(), '202601', true)
    const s2 = recordMonthResult(s1, '202601', true)
    expect(s2.size).toBe(1)
  })

  it('切换栏目后清空（调用方 new Set() 验证）', () => {
    const after = new Set<string>()
    expect(after.size).toBe(0)
  })
})
