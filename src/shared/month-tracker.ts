/** Tracks which months returned empty video lists (lazy detection). */
export function recordMonthResult(emptyMonths: Set<string>, month: string, isEmpty: boolean): Set<string> {
  if (isEmpty) {
    return new Set([...emptyMonths, month])
  }
  const next = new Set(emptyMonths)
  next.delete(month)
  return next
}
