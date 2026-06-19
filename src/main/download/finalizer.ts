import { spawn as cpSpawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { segmentFileName } from './decryptor'
import { ffmpegPath } from './ffmpeg'

export type SpawnFn = (bin: string, args: string[]) => Promise<{ exitCode: number; stderr: string }>

function defaultSpawn(bin: string, args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = cpSpawn(bin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: false
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.once('close', (code) => resolve({ exitCode: code ?? 1, stderr }))
    child.once('error', reject)
  })
}

export class Finalizer {
  constructor(
    private readonly spawn: SpawnFn = defaultSpawn,
    private readonly ffmpeg: string = ffmpegPath()
  ) {}

  writeConcatList(workDir: string, segmentCount: number): string {
    const listPath = path.join(workDir, 'concat.txt')
    const lines: string[] = []
    for (let i = 0; i < segmentCount; i++) {
      const segPath = path.join(workDir, segmentFileName(i))
      lines.push(`file '${segPath.replace(/\\/g, '/')}'`)
    }
    fs.writeFileSync(listPath, lines.join('\n'), 'utf-8')
    return listPath
  }

  /**
   * Merge decrypted segments into the final file.
   * Default is a lossless stream-copy concat (fast, no quality loss). The segments
   * are already standard H.264/AAC mp4 produced by decrypt.js, so re-multiplexing
   * with regenerated timestamps avoids the playback stutter that originally motivated
   * full re-encoding — without paying the (large, lossy) cost of libx264.
   * Pass `reencode: true` to fall back to libx264 for the rare clip that still
   * misbehaves on copy.
   */
  async merge(listPath: string, outputPath: string, reencode = false): Promise<string> {
    return reencode
      ? this.mergeReencode(listPath, outputPath)
      : this.mergeCopy(listPath, outputPath)
  }

  async mergeCopy(listPath: string, outputPath: string): Promise<string> {
    const finalPath = this.uniquePath(outputPath)
    const result = await this.spawn(this.ffmpeg, [
      '-y',
      '-fflags', '+genpts',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-avoid_negative_ts', 'make_zero',
      '-map', '0:v:0', '-map', '0:a?',
      '-c', 'copy',
      '-movflags', '+faststart',
      finalPath
    ])
    if (result.exitCode !== 0) {
      throw new Error(`ffmpeg copy exit ${result.exitCode}: ${result.stderr.slice(-500)}`)
    }
    return finalPath
  }

  async mergeReencode(listPath: string, outputPath: string): Promise<string> {
    const finalPath = this.uniquePath(outputPath)
    const result = await this.spawn(this.ffmpeg, [
      '-y',
      '-fflags', '+genpts',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-avoid_negative_ts', 'make_zero',
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-vsync', '0',
      finalPath
    ])
    if (result.exitCode !== 0) {
      throw new Error(`ffmpeg exit ${result.exitCode}: ${result.stderr.slice(-500)}`)
    }
    return finalPath
  }

  uniquePath(p: string): string {
    if (!fs.existsSync(p)) return p
    const dir = path.dirname(p)
    const ext = path.extname(p)
    const base = path.basename(p, ext)
    for (let i = 1; i < 1000; i++) {
      const candidate = path.join(dir, `${base} (${i})${ext}`)
      if (!fs.existsSync(candidate)) return candidate
    }
    return p
  }
}
