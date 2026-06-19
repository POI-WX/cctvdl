import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Finalizer } from '../../../src/main/download/finalizer'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('Finalizer', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctvdl-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('writeConcatList', () => {
    it('generates concat list with correct format', () => {
      const finalizer = new Finalizer()
      const listPath = finalizer.writeConcatList(tempDir, 3)

      const content = fs.readFileSync(listPath, 'utf-8')
      const lines = content.split('\n')

      expect(lines).toHaveLength(3)
      expect(lines[0]).toContain('segment_00000000.mp4')
      expect(lines[1]).toContain('segment_00000001.mp4')
      expect(lines[2]).toContain('segment_00000002.mp4')
      expect(lines[0]).toMatch(/^file '/)
    })

    it('uses forward slashes in paths', () => {
      const finalizer = new Finalizer()
      const listPath = finalizer.writeConcatList(tempDir, 2)

      const content = fs.readFileSync(listPath, 'utf-8')
      expect(content).not.toContain('\\')
    })
  })

  describe('merge (default = lossless copy)', () => {
    it('uses stream copy by default, not re-encoding', async () => {
      const mockSpawn = vi.fn().mockResolvedValue({ exitCode: 0, stderr: '' })
      const finalizer = new Finalizer(mockSpawn, '/mock/ffmpeg')

      const listPath = path.join(tempDir, 'concat.txt')
      fs.writeFileSync(listPath, "file 'test.mp4'\n")
      const outputPath = path.join(tempDir, 'output.mp4')

      await finalizer.merge(listPath, outputPath)

      const args = mockSpawn.mock.calls[0][1]
      // -c copy and NO libx264
      const cIndex = args.indexOf('-c')
      expect(cIndex).toBeGreaterThanOrEqual(0)
      expect(args[cIndex + 1]).toBe('copy')
      expect(args).not.toContain('libx264')
      expect(args).toContain('+faststart')
    })

    it('re-encodes with libx264 when reencode=true', async () => {
      const mockSpawn = vi.fn().mockResolvedValue({ exitCode: 0, stderr: '' })
      const finalizer = new Finalizer(mockSpawn, '/mock/ffmpeg')

      const listPath = path.join(tempDir, 'concat.txt')
      fs.writeFileSync(listPath, "file 'test.mp4'\n")
      const outputPath = path.join(tempDir, 'output.mp4')

      await finalizer.merge(listPath, outputPath, true)

      const args = mockSpawn.mock.calls[0][1]
      expect(args).toContain('-c:v')
      expect(args).toContain('libx264')
      expect(args).toContain('-crf')
      expect(args).toContain('23')
      const cvIndex = args.indexOf('-c:v')
      expect(args[cvIndex + 1]).toBe('libx264')
    })

    it('throws error on ffmpeg failure (copy)', async () => {
      const mockSpawn = vi.fn().mockResolvedValue({ exitCode: 1, stderr: 'Error message' })
      const finalizer = new Finalizer(mockSpawn, '/mock/ffmpeg')

      const listPath = path.join(tempDir, 'concat.txt')
      fs.writeFileSync(listPath, "file 'test.mp4'\n")
      const outputPath = path.join(tempDir, 'output.mp4')

      await expect(finalizer.merge(listPath, outputPath)).rejects.toThrow('ffmpeg copy exit 1')
    })

    it('throws error on ffmpeg failure (reencode)', async () => {
      const mockSpawn = vi.fn().mockResolvedValue({ exitCode: 1, stderr: 'Error message' })
      const finalizer = new Finalizer(mockSpawn, '/mock/ffmpeg')

      const listPath = path.join(tempDir, 'concat.txt')
      fs.writeFileSync(listPath, "file 'test.mp4'\n")
      const outputPath = path.join(tempDir, 'output.mp4')

      await expect(finalizer.merge(listPath, outputPath, true)).rejects.toThrow('ffmpeg exit 1')
    })
  })


  describe('uniquePath', () => {
    it('returns original path if file does not exist', () => {
      const finalizer = new Finalizer()
      const p = path.join(tempDir, 'new.mp4')
      expect(finalizer.uniquePath(p)).toBe(p)
    })

    it('appends (1) if file exists', () => {
      const finalizer = new Finalizer()
      const p = path.join(tempDir, 'test.mp4')
      fs.writeFileSync(p, 'content')

      const result = finalizer.uniquePath(p)
      expect(result).toBe(path.join(tempDir, 'test (1).mp4'))
    })

    it('increments number for multiple conflicts', () => {
      const finalizer = new Finalizer()
      const base = path.join(tempDir, 'test.mp4')
      fs.writeFileSync(base, 'content')
      fs.writeFileSync(path.join(tempDir, 'test (1).mp4'), 'content')
      fs.writeFileSync(path.join(tempDir, 'test (2).mp4'), 'content')

      const result = finalizer.uniquePath(base)
      expect(result).toBe(path.join(tempDir, 'test (3).mp4'))
    })
  })
})
