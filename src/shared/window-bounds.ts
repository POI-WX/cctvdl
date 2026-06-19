// Pure helpers for persisting/restoring the main window bounds safely.

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export interface Rect { x: number; y: number; width: number; height: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Validate saved window bounds against the current screen work area so the window
 * always opens on-screen at a sane size. Returns null when there is nothing
 * usable saved (caller should fall back to defaults).
 */
export function sanitizeBounds(
  saved: Partial<WindowBounds> | undefined | null,
  area: Rect,
  minWidth = 720,
  minHeight = 520
): WindowBounds | null {
  if (!saved) return null
  const w = Number(saved.width)
  const h = Number(saved.height)
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null

  const width = clamp(Math.floor(w), minWidth, area.width)
  const height = clamp(Math.floor(h), minHeight, area.height)

  const result: WindowBounds = { width, height, maximized: !!saved.maximized }

  // Keep the position only if both coords are present AND the window's top-left
  // lands inside the work area; otherwise let the OS center it (x/y undefined).
  const x = Number(saved.x)
  const y = Number(saved.y)
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const maxX = area.x + area.width - width
    const maxY = area.y + area.height - height
    if (x >= area.x && y >= area.y && x <= maxX && y <= maxY) {
      result.x = Math.floor(x)
      result.y = Math.floor(y)
    }
  }
  return result
}
