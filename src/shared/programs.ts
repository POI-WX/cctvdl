// Pure, framework-free helpers for the imported-program ("我的栏目") list.

export interface SortableProgram {
  columnId: string
  // Epoch ms when the program was favorited; undefined = not favorited.
  favoritedAt?: number
}

/**
 * Order programs for display: favorited ones first (most-recently-favorited on
 * top), then the rest in their original (import) order. Does not mutate input.
 */
export function sortPrograms<T extends SortableProgram>(programs: T[]): T[] {
  const favorites = programs.filter((p) => p.favoritedAt != null)
  const rest = programs.filter((p) => p.favoritedAt == null)
  favorites.sort((a, b) => (b.favoritedAt as number) - (a.favoritedAt as number))
  return [...favorites, ...rest]
}

/**
 * Whether a keydown should delete the selected program. The forward-delete key
 * reports 'Delete' on every platform; on macOS the primary delete key (where
 * Backspace sits on a PC keyboard) reports 'Backspace', so accept that too on
 * Mac. Callers must separately ensure focus isn't in a text field.
 */
export function isProgramDeleteKey(key: string, isMac: boolean): boolean {
  return key === 'Delete' || (isMac && key === 'Backspace')
}
