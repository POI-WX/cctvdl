import { clipboard } from 'electron'

/** True for a CCTV program / column / video page URL we can import. */
export function isCctvLink(text: string): boolean {
  return /^https?:\/\/tv\.cctv\.com\/\S+/i.test(text.trim())
}

/**
 * Polls the clipboard for newly-copied CCTV links and reports them. Privacy: the
 * clipboard is only read while the user's opt-in setting is enabled — when off,
 * `check()` returns before touching the clipboard at all.
 */
export class ClipboardWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastText = ''

  constructor(
    private readonly isEnabled: () => boolean,
    private readonly onLink: (url: string) => void,
    private readonly readText: () => string = () => clipboard.readText(),
    private readonly intervalMs = 1500
  ) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.check(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  /** One poll cycle. Exposed for testing. */
  check(): void {
    if (!this.isEnabled()) return
    const text = this.readText()
    if (text === this.lastText) return
    this.lastText = text
    const trimmed = text.trim()
    if (isCctvLink(trimmed)) this.onLink(trimmed)
  }
}
