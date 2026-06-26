import { describe, it, expect } from 'vitest'
import { sortPrograms, isProgramDeleteKey } from '../../src/shared/programs'
import type { SortableProgram } from '../../src/shared/programs'

const p = (columnId: string, favoritedAt?: number): SortableProgram => ({ columnId, favoritedAt })

describe('sortPrograms', () => {
  it('keeps import order when nothing is favorited', () => {
    const list = [p('a'), p('b'), p('c')]
    expect(sortPrograms(list).map(x => x.columnId)).toEqual(['a', 'b', 'c'])
  })

  it('puts favorites first, most-recently-favorited on top', () => {
    const list = [p('a'), p('b', 100), p('c'), p('d', 200)]
    // d favorited later than b → d before b; non-favorites a,c keep order after
    expect(sortPrograms(list).map(x => x.columnId)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('keeps non-favorites in their original import order', () => {
    const list = [p('a', 50), p('b'), p('c'), p('d')]
    expect(sortPrograms(list).map(x => x.columnId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('handles all-favorited by favoritedAt desc', () => {
    const list = [p('a', 1), p('b', 3), p('c', 2)]
    expect(sortPrograms(list).map(x => x.columnId)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const list = [p('a'), p('b', 100)]
    const copy = [...list]
    sortPrograms(list)
    expect(list).toEqual(copy)
  })

  it('returns empty for empty input', () => {
    expect(sortPrograms([])).toEqual([])
  })
})

describe('isProgramDeleteKey', () => {
  it('accepts Delete on all platforms', () => {
    expect(isProgramDeleteKey('Delete', false)).toBe(true)
    expect(isProgramDeleteKey('Delete', true)).toBe(true)
  })

  it('accepts Backspace only on macOS', () => {
    expect(isProgramDeleteKey('Backspace', true)).toBe(true)
    expect(isProgramDeleteKey('Backspace', false)).toBe(false)
  })

  it('rejects unrelated keys', () => {
    for (const k of ['a', 'Enter', 'Escape', 'ArrowDown']) {
      expect(isProgramDeleteKey(k, true)).toBe(false)
      expect(isProgramDeleteKey(k, false)).toBe(false)
    }
  })
})
