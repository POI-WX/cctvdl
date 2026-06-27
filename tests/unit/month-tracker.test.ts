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

  it('切换栏目后清空：重置后旧月份不再存在', () => {
    // Simulates what onProgramClick does: emptyMonths.value = new Set()
    let months = recordMonthResult(new Set(), '202601', true)
    months = recordMonthResult(months, '202602', true)
    expect(months.size).toBe(2)
    // Program switch clears the set
    months = new Set<string>()
    expect(months.size).toBe(0)
    // New program's months accumulate independently
    const fresh = recordMonthResult(months, '202603', true)
    expect(fresh.has('202601')).toBe(false)
    expect(fresh.has('202603')).toBe(true)
  })
})
