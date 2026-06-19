import { describe, it, expect, vi } from 'vitest'
import { createResilientFetch } from '../../../src/main/api/http'

function resp(status: number): Response {
  return new Response(status === 204 ? null : 'body', { status })
}

describe('createResilientFetch', () => {
  it('returns immediately on a successful first response', async () => {
    const base = vi.fn().mockResolvedValue(resp(200))
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    const r = await f('http://x')
    expect(r.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('retries on a network error then succeeds', async () => {
    const base = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(resp(200))
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    const r = await f('http://x')
    expect(r.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('retries on a 5xx then succeeds', async () => {
    const base = vi.fn()
      .mockResolvedValueOnce(resp(503))
      .mockResolvedValueOnce(resp(200))
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    const r = await f('http://x')
    expect(r.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('retries on 429 (rate limit)', async () => {
    const base = vi.fn()
      .mockResolvedValueOnce(resp(429))
      .mockResolvedValueOnce(resp(200))
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    const r = await f('http://x')
    expect(r.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a non-retriable status (404)', async () => {
    const base = vi.fn().mockResolvedValue(resp(404))
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    const r = await f('http://x')
    expect(r.status).toBe(404)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting retries on persistent network errors', async () => {
    const base = vi.fn().mockRejectedValue(new Error('down'))
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    await expect(f('http://x')).rejects.toThrow(/after 3 attempts/)
    expect(base).toHaveBeenCalledTimes(3)
  })

  it('returns the last response when retriable status persists', async () => {
    const base = vi.fn().mockResolvedValue(resp(500))
    const f = createResilientFetch(base, { retries: 1, backoffMs: 1 })
    const r = await f('http://x')
    expect(r.status).toBe(500)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('aborts an attempt that exceeds the timeout', async () => {
    // base resolves only after the per-attempt timeout fires the abort signal
    const base = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(() => resolve(resp(200)), 1000)
      })
    )
    const f = createResilientFetch(base, { retries: 0, timeoutMs: 10, backoffMs: 1 })
    await expect(f('http://x')).rejects.toThrow(/after 1 attempts/)
  })

  it('passes through caller headers/init', async () => {
    const base = vi.fn().mockResolvedValue(resp(200))
    const f = createResilientFetch(base, { retries: 0, backoffMs: 1 })
    await f('http://x', { headers: { 'User-Agent': 'UA' } })
    const init = base.mock.calls[0][1]
    expect(init.headers).toEqual({ 'User-Agent': 'UA' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('forwards caller abort signal to internal controller (cancels fetch immediately)', async () => {
    const controller = new AbortController()
    const base = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(() => reject(new Error('should not resolve')), 5000)
      })
    )
    const f = createResilientFetch(base, { retries: 0, timeoutMs: 10_000, backoffMs: 1 })
    const fetchPromise = f('http://x', { signal: controller.signal })
    // Abort after fetch has started
    setTimeout(() => controller.abort(), 10)
    await expect(fetchPromise).rejects.toThrow(/after 1 attempts/)
  })

  it('throws immediately when caller signal is already aborted before fetch starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const base = vi.fn()
    const f = createResilientFetch(base, { retries: 2, backoffMs: 1 })
    await expect(f('http://x', { signal: controller.signal })).rejects.toThrow(/after 0 attempts/)
    expect(base).not.toHaveBeenCalled()
  })
})
