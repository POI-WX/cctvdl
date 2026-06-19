import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(os.tmpdir())
  }
}))

// Mock electron-log
vi.mock('electron-log', () => {
  return {
    default: {
      transports: {
        file: { resolvePathFn: null, format: '', level: '' },
        console: { format: '', level: '' }
      },
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  }
})

import { getFailuresPath, appendFailures, setLogPath } from '../../src/main/logger'

describe('Logger', () => {
  describe('setLogPath', () => {
    it('does not throw for a valid directory', () => {
      expect(() => setLogPath(os.tmpdir())).not.toThrow()
    })

    it('silently ignores empty string', () => {
      expect(() => setLogPath('')).not.toThrow()
    })
  })

  describe('getFailuresPath', () => {
    it('returns path ending with cctvdl-failures.log', () => {
      const p = getFailuresPath()
      expect(p).toContain('cctvdl-failures.log')
    })

    it('honors the directory configured via setLogPath', () => {
      const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-logdir-'))
      try {
        setLogPath(customDir)
        expect(getFailuresPath()).toBe(path.join(customDir, 'cctvdl-failures.log'))
      } finally {
        // Restore module state so later tests write to a directory that exists.
        setLogPath(os.tmpdir())
        fs.rmSync(customDir, { recursive: true, force: true })
      }
    })
  })

  describe('appendFailures', () => {
    let logPath: string

    beforeEach(() => {
      logPath = getFailuresPath()
      // Clean up before each test
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath)
    })

    afterEach(() => {
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath)
    })

    it('writes failure entries to file', () => {
      appendFailures('2026-06-20 12:00:00', [
        { title: 'Video 1', sourceUrl: 'https://tv.cctv.com/1', errorMessage: 'decrypt fail' }
      ])

      expect(fs.existsSync(logPath)).toBe(true)
      const content = fs.readFileSync(logPath, 'utf-8')
      expect(content).toContain('Video 1')
      expect(content).toContain('decrypt fail')
      expect(content).toContain('https://tv.cctv.com/1')
      expect(content).toContain('FAILED')
    })

    it('appends to existing file', () => {
      appendFailures('2026-06-20 12:00:00', [
        { title: 'Video 1', sourceUrl: 'url1', errorMessage: 'err1' }
      ])
      appendFailures('2026-06-20 13:00:00', [
        { title: 'Video 2', sourceUrl: 'url2', errorMessage: 'err2' }
      ])

      const content = fs.readFileSync(logPath, 'utf-8')
      expect(content).toContain('Video 1')
      expect(content).toContain('Video 2')
      expect(content).toContain('12:00:00')
      expect(content).toContain('13:00:00')
    })

    it('writes TAB-separated format', () => {
      appendFailures('2026-06-20', [
        { title: 'Test', sourceUrl: 'url', errorMessage: 'err' }
      ])
      const content = fs.readFileSync(logPath, 'utf-8')
      expect(content).toContain('\tTest\turl\terr')
    })
  })
})
