import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

// Safe fallback: os.tmpdir() is always writable, unlike process.cwd() which can be
// C:\Windows\system32 on Windows or / on macOS when launched from a launcher.
function safeUserData(): string {
  return app?.getPath?.('userData') || os.tmpdir()
}

// Directory for log files. Defaults to userData; overridden by setLogPath so the
// failures log lands alongside the main log in the user's configured directory.
let logDir = ''

// Resolve lazily to avoid calling app.getPath before app is ready
log.transports.file.resolvePathFn = () =>
  path.join(safeUserData(), 'cctvdl.log')
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

export function setLogLevel(level: 'info' | 'debug'): void {
  log.transports.file.level = level
  log.transports.console.level = level
}

/** Apply a user-configured log directory (from settings.logPath). */
export function setLogPath(dir: string): void {
  if (!dir) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    log.transports.file.resolvePathFn = () => path.join(dir, 'cctvdl.log')
    // Keep the failures log in the same directory as the main log.
    logDir = dir
  } catch {
    // If the user-configured path is unwritable, keep the default
  }
}

export function getFailuresPath(): string {
  return path.join(logDir || safeUserData(), 'cctvdl-failures.log')
}

export function appendFailures(
  batchTime: string,
  failures: Array<{ title: string; sourceUrl: string; errorMessage: string }>
): void {
  const lines = [`=== 批次 ${batchTime} ===`]
  for (const f of failures) {
    lines.push(`FAILED\t${f.title}\t${f.sourceUrl}\t${f.errorMessage}`)
  }
  lines.push('')
  fs.appendFileSync(getFailuresPath(), lines.join('\n'), 'utf-8')
}

export { log as logger }
