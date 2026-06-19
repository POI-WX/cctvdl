// Shared, framework-free formatting helpers used by the renderer and covered by unit tests.

/** Format a byte count into a human-readable size (B / KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** Format a real download speed given in bytes/second. */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) return '—'
  return `${formatBytes(bytesPerSec)}/s`
}

/** Format a duration in seconds as a compact zh-CN string. */
export function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '计算中...'
  const total = Math.floor(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) return `${hrs}时${mins}分`
  if (mins > 0) return `${mins}分${secs}秒`
  return `${secs}秒`
}
