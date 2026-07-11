import { describe, expect, it } from 'vitest'
import { createLatestRequestGuard } from '../../src/shared/latest-request'

describe('createLatestRequestGuard', () => {
  it('rejects an earlier request after a newer request begins', () => {
    const guard = createLatestRequestGuard()
    const first = guard.begin()
    const second = guard.begin()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })
})
