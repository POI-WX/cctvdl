import { describe, it, expect, vi } from 'vitest'
import { isNewerVersion, checkForUpdate } from '../../src/shared/update-check'

describe('shared/update-check · isNewerVersion', () => {
  it('remote major 更大时返回 true', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
  })
  it('remote minor 更大时返回 true', () => {
    expect(isNewerVersion('0.2.3', '0.3.0')).toBe(true)
  })
  it('remote patch 更大时返回 true', () => {
    expect(isNewerVersion('0.2.3', '0.2.4')).toBe(true)
  })
  it('相同版本返回 false', () => {
    expect(isNewerVersion('0.2.3', '0.2.3')).toBe(false)
  })
  it('local 更新时返回 false', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
  })
  it('remote 带 v 前缀时正确处理', () => {
    expect(isNewerVersion('0.2.3', 'v0.2.4')).toBe(true)
  })
})

describe('shared/update-check · checkForUpdate', () => {
  it('remote 更新时返回 available: true 及版本号', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v9.9.9' })
    }) as unknown as typeof fetch
    const result = await checkForUpdate('0.2.3', mockFetch)
    expect(result.available).toBe(true)
    expect(result.version).toBe('9.9.9')
  })

  it('remote 同版本时返回 available: false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v0.2.3' })
    }) as unknown as typeof fetch
    const result = await checkForUpdate('0.2.3', mockFetch)
    expect(result.available).toBe(false)
  })

  it('HTTP 非 200 时静默返回 available: false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({})
    }) as unknown as typeof fetch
    const result = await checkForUpdate('0.2.3', mockFetch)
    expect(result.available).toBe(false)
  })

  it('fetch 抛错时静默返回 available: false', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network Error')) as unknown as typeof fetch
    const result = await checkForUpdate('0.2.3', mockFetch)
    expect(result.available).toBe(false)
  })

  it('tag_name 缺失时静默返回 available: false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    }) as unknown as typeof fetch
    const result = await checkForUpdate('0.2.3', mockFetch)
    expect(result.available).toBe(false)
  })
})
