export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

/**
 * Build a fetch init that sends the default User-Agent (CCTV blocks the bare
 * Node/undici UA) and, optionally, forwards an abort signal so in-flight requests
 * can be cancelled. Centralised so callers don't repeat the header object.
 */
export function uaInit(signal?: AbortSignal): RequestInit {
  const init: RequestInit = { headers: { 'User-Agent': DEFAULT_UA } }
  if (signal) init.signal = signal
  return init
}

export interface ResilientOptions {
  retries?: number       // extra attempts after the first (default 2 => up to 3 tries)
  timeoutMs?: number     // per-attempt timeout (default 15000)
  backoffMs?: number     // base backoff, exponential (default 500)
}

/** Status codes worth retrying (transient server / rate-limit conditions). */
function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Wrap a base fetcher with per-attempt timeout + bounded retry/backoff.
 * Retries on network errors, timeouts, and transient HTTP statuses (408/429/5xx).
 * Non-retriable HTTP responses (e.g. 404) are returned as-is on the first try so
 * callers keep their existing status handling.
 */
export function createResilientFetch(
  baseFetch: Fetcher = globalThis.fetch,
  opts: ResilientOptions = {}
): Fetcher {
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? 15_000
  const backoffMs = opts.backoffMs ?? 500

  return async (url: string, init?: RequestInit): Promise<Response> => {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Forward caller cancellation (e.g. coordinator shutdown) immediately
      // rather than waiting for the per-attempt timeout; bail if already aborted.
      if (init?.signal?.aborted) {
        throw new Error(`fetch failed after ${attempt} attempts: aborted`)
      }
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      init?.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const resp = await baseFetch(url, { ...init, signal: controller.signal })
        if (isRetriableStatus(resp.status) && attempt < retries) {
          await sleep(backoffMs * 2 ** attempt)
          continue
        }
        return resp
      } catch (err) {
        lastError = err
        if (attempt < retries) {
          await sleep(backoffMs * 2 ** attempt)
          continue
        }
      } finally {
        clearTimeout(timer)
        init?.signal?.removeEventListener('abort', onAbort)
      }
    }
    throw new Error(`fetch failed after ${retries + 1} attempts: ${String(lastError)}`)
  }
}
