/**
 * Resolve the ffmpeg binary the app should use.
 *
 * We bundle ffmpeg via `ffmpeg-static` so users never have to install it
 * themselves. Two details matter:
 *
 *  1. In a packaged build, `ffmpeg-static` is unpacked from the asar archive
 *     (see `asarUnpack` in electron-builder.yml). The path it returns still
 *     points inside `app.asar`, which cannot be spawned as an executable, so we
 *     rewrite it to the real `app.asar.unpacked` location.
 *  2. If `ffmpeg-static` can't be resolved for some reason, fall back to a bare
 *     `ffmpeg` on PATH so a developer with a system ffmpeg still works.
 */
export function ffmpegPath(): string {
  try {
    const p = require('ffmpeg-static') as string | null
    if (p) return p.replace('app.asar', 'app.asar.unpacked')
  } catch {
    /* fall through to PATH lookup */
  }
  return 'ffmpeg'
}
