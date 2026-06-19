// Pure progress aggregation helpers (unit-tested). Used by main for the OS
// taskbar/dock progress bar and reusable by the renderer.

/**
 * Overall batch completion as a fraction in [0,1], or -1 when there is nothing
 * to show (Electron's setProgressBar treats <0 as "no progress bar").
 *
 * @param finished number of jobs in a terminal state (completed/failed/cancelled)
 * @param total    total jobs in the batch
 * @param currentPercent percent (0-100) of the job currently in progress
 */
export function taskbarFraction(finished: number, total: number, currentPercent: number): number {
  if (!total || total <= 0) return -1
  const cur = Math.min(100, Math.max(0, currentPercent || 0)) / 100
  const done = Math.min(finished, total)
  const frac = (done + (done < total ? cur : 0)) / total
  return Math.min(1, Math.max(0, frac))
}

/**
 * Estimate seconds remaining from real throughput, returning 0 when it can't be
 * computed yet.
 *
 * The average bytes/segment is taken over THIS run's samples (`sampleCount`),
 * not over all completed segments — so a resume (whose earlier segments wrote
 * their bytes in a previous run) doesn't dilute the average and skew the ETA.
 * The remaining work, however, is every not-yet-completed segment.
 *
 * @param totalBytes     bytes written so far in this run
 * @param sampleCount    segments that produced those bytes in this run
 * @param completedCount segments done overall (this run + resumed)
 * @param totalCount     total segments in the job
 * @param speed          throughput in bytes/second
 */
export function estimateEta(
  totalBytes: number,
  sampleCount: number,
  completedCount: number,
  totalCount: number,
  speed: number
): number {
  if (speed <= 0 || sampleCount <= 0 || totalCount <= completedCount) return 0
  const avgBytesPerSegment = totalBytes / sampleCount
  const remainingBytes = avgBytesPerSegment * (totalCount - completedCount)
  return remainingBytes / speed
}
