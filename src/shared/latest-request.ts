/** Keeps only the newest asynchronous request eligible to update a view. */
export function createLatestRequestGuard() {
  let latest = 0
  return {
    begin: () => ++latest,
    isCurrent: (requestId: number) => requestId === latest
  }
}
