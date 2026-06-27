import type { Settings, Quality } from './types'

export const QUALITIES: Quality[] = ['auto', 'bluray', 'chaoqing', 'gaoqing', 'biaoqing', 'liuchang']
export const LOG_LEVELS: Settings['logLevel'][] = ['info', 'debug']

export const MIN_THREADS = 1
export const MAX_THREADS = 16
export const MIN_CONCURRENT_VIDEOS = 1
export const MAX_CONCURRENT_VIDEOS = 3

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

function pickEnum<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Coerce arbitrary persisted/incoming data into a valid Settings object.
 * Guards against corrupt electron-store data and configs saved before newer
 * fields existed: clamps threadCount, validates enums, coerces types, and fills
 * any missing field from `fallback` (the app defaults).
 */
export function normalizeSettings(raw: unknown, fallback: Settings): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  return {
    savePath: asString(r.savePath, fallback.savePath),
    threadCount: clampInt(r.threadCount, MIN_THREADS, MAX_THREADS, fallback.threadCount),
    quality: pickEnum(r.quality, QUALITIES, fallback.quality),
    reencode: asBool(r.reencode, fallback.reencode),
    logLevel: pickEnum(r.logLevel, LOG_LEVELS, fallback.logLevel),
    darkMode: asBool(r.darkMode, fallback.darkMode ?? false),
    logPath: asString(r.logPath, fallback.logPath ?? ''),
    autoOpenFolder: asBool(r.autoOpenFolder, fallback.autoOpenFolder ?? false),
    clipboardWatch: asBool(r.clipboardWatch, fallback.clipboardWatch ?? false),
    concurrentVideos: clampInt(r.concurrentVideos, MIN_CONCURRENT_VIDEOS, MAX_CONCURRENT_VIDEOS, fallback.concurrentVideos ?? 1),
    coverSavePath: asString(r.coverSavePath, fallback.coverSavePath ?? '')
  }
}
