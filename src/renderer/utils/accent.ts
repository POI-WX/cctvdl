/**
 * Apply a custom accent color by overriding Element Plus primary CSS variables.
 * Silently returns without modifying any variables if the color is not a valid
 * 6-digit hex string (e.g. '#2563EB').  This guards against malformed values
 * that could be written to localStorage by older app versions.
 */
export function applyAccentColor(color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
  const root = document.documentElement
  root.style.setProperty('--el-color-primary', color)
  const hex2rgb = (h: string): [number, number, number] => {
    const v = parseInt(h.slice(1), 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  const blend = (c: [number, number, number], a: number): [number, number, number] =>
    c.map(n => Math.round(n + (255 - n) * a)) as [number, number, number]
  const toHex = (c: [number, number, number]): string =>
    '#' + c.map(n => n.toString(16).padStart(2, '0')).join('')
  const rgb = hex2rgb(color)
  root.style.setProperty('--el-color-primary-light-3', toHex(blend(rgb, 0.3)))
  root.style.setProperty('--el-color-primary-light-5', toHex(blend(rgb, 0.5)))
  root.style.setProperty('--el-color-primary-light-7', toHex(blend(rgb, 0.7)))
  root.style.setProperty('--el-color-primary-light-8', toHex(blend(rgb, 0.8)))
  root.style.setProperty('--el-color-primary-light-9', toHex(blend(rgb, 0.9)))
}
