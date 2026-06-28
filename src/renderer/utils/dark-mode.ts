export function applyDarkMode(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark)
}
