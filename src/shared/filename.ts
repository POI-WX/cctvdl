// Cross-platform safe filename derivation (shared by renderer paths).

// Windows reserved device names that cannot be used as a base filename.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_LEN = 120

/**
 * Turn an arbitrary video title into a filesystem-safe base filename:
 * - strips characters illegal on Windows/macOS/Linux (<>:"/\|?* and control chars)
 * - trims trailing spaces/dots (illegal on Windows)
 * - avoids reserved device names (CON, NUL, COM1, ...)
 * - caps length to avoid path-length issues
 * Falls back to `fallback` when nothing usable remains.
 */
export function safeFilename(title: string, fallback = 'video'): string {
  let name = (title ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[\s.]+$/, '')
    .trim()
  if (!name) name = fallback
  if (name.length > MAX_LEN) name = name.slice(0, MAX_LEN).replace(/[\s.]+$/, '')
  if (RESERVED.test(name)) name = `_${name}`
  return name
}

/**
 * Ensure a path ends with the `.mp4` extension, without mangling names that
 * legitimately contain dots (e.g. "节目 2026.06.19"). Idempotent and
 * case-insensitive on the existing extension.
 */
export function ensureMp4Extension(p: string): string {
  return /\.mp4$/i.test(p) ? p : `${p}.mp4`
}

/**
 * Build the output file path for a video: `<saveDir>/<safe title>.mp4`.
 * Single source of truth shared by the renderer pages so the naming rule can't
 * drift between them. Trailing slashes on `saveDir` are normalised away.
 */
export function buildOutputPath(saveDir: string, title: string, fallback = 'video'): string {
  const base = saveDir.replace(/[\\/]+$/, '')
  return `${base}/${safeFilename(title, fallback)}.mp4`
}
