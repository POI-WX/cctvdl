// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { applyAccentColor } from '../../../src/renderer/utils/accent'

const root = () => document.documentElement
const prop = (name: string) => root().style.getPropertyValue(name)

const LIGHT_VARS = [
  '--el-color-primary-light-3',
  '--el-color-primary-light-5',
  '--el-color-primary-light-7',
  '--el-color-primary-light-8',
  '--el-color-primary-light-9'
]

describe('applyAccentColor', () => {
  beforeEach(() => root().removeAttribute('style'))

  it('sets the primary variable and five derived light shades for a valid hex', () => {
    applyAccentColor('#2563EB')
    expect(prop('--el-color-primary')).toBe('#2563EB')
    for (const v of LIGHT_VARS) {
      expect(prop(v)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('blends toward white as the light level increases (deterministic math)', () => {
    applyAccentColor('#000000')
    // black blended 30% toward white => 0x4d; 90% => 0xe6
    expect(prop('--el-color-primary-light-3')).toBe('#4d4d4d')
    expect(prop('--el-color-primary-light-9')).toBe('#e6e6e6')
  })

  it('ignores invalid colors and sets nothing', () => {
    applyAccentColor('red')
    applyAccentColor('#fff')
    applyAccentColor('#ZZZZZZ')
    applyAccentColor('')
    expect(prop('--el-color-primary')).toBe('')
    for (const v of LIGHT_VARS) expect(prop(v)).toBe('')
  })
})
