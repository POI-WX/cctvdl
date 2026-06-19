import { describe, it, expect } from 'vitest'
import { displayPath } from '../../src/shared/path-display'

describe('displayPath', () => {
  it('replaces Windows home prefix with ~', () => {
    expect(displayPath('C:\\Users\\alice\\Videos')).toBe('~\\Videos')
    expect(displayPath('D:\\Users\\bob\\Downloads')).toBe('~\\Downloads')
  })

  it('replaces macOS home prefix with ~', () => {
    expect(displayPath('/Users/alice/Movies')).toBe('~/Movies')
  })

  it('replaces Linux home prefix with ~', () => {
    expect(displayPath('/home/alice/Videos')).toBe('~/Videos')
  })

  it('returns path unchanged when not under home directory', () => {
    expect(displayPath('/var/log/app')).toBe('/var/log/app')
    expect(displayPath('D:\\Program Files\\app')).toBe('D:\\Program Files\\app')
  })

  it('returns empty string unchanged', () => {
    expect(displayPath('')).toBe('')
  })

  it('handles path that is exactly the home directory', () => {
    expect(displayPath('/home/alice')).toBe('~')
    expect(displayPath('C:\\Users\\alice')).toBe('~')
  })
})
