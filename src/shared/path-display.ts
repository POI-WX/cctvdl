/**
 * Replaces the home-directory prefix in an absolute path with `~` for display.
 * The actual stored path is never modified — this is display-only.
 *
 * Examples:
 *   C:\Users\alice\Videos  →  ~\Videos
 *   /home/alice/Videos     →  ~/Videos
 *   /Users/alice/Movies    →  ~/Movies
 */
export function displayPath(p: string): string {
  if (!p) return p
  // Windows: C:\Users\<name>\...
  // macOS:   /Users/<name>/...
  // Linux:   /home/<name>/...
  return p.replace(/^([A-Za-z]:[/\\]Users[/\\][^/\\]+|\/(?:home|Users)\/[^/]+)/, '~')
}
