import { describe, it, expect, vi } from 'vitest'

// The module imports `clipboard` from electron at top level; stub it (tests inject
// their own readText, so the real clipboard is never used).
vi.mock('electron', () => ({ clipboard: { readText: () => '' } }))

import { isCctvLink, ClipboardWatcher } from '../../src/main/clipboard-watch'

describe('isCctvLink', () => {
  it('matches tv.cctv.com page URLs (trims whitespace)', () => {
    expect(isCctvLink('https://tv.cctv.com/lm/xwlb/')).toBe(true)
    expect(isCctvLink('http://tv.cctv.com/2026/06/12/VIDExxx.shtml')).toBe(true)
    expect(isCctvLink('  https://tv.cctv.com/x  ')).toBe(true)
  })

  it('rejects non-CCTV / non-URL text', () => {
    for (const t of ['', 'hello world', 'https://example.com/x', 'tv.cctv.com/x', 'https://news.cctv.com/x']) {
      expect(isCctvLink(t)).toBe(false)
    }
  })
})

describe('ClipboardWatcher.check', () => {
  it('does not read the clipboard or fire when disabled (privacy)', () => {
    const readText = vi.fn(() => 'https://tv.cctv.com/lm/xwlb/')
    const onLink = vi.fn()
    new ClipboardWatcher(() => false, onLink, readText).check()
    expect(readText).not.toHaveBeenCalled()
    expect(onLink).not.toHaveBeenCalled()
  })

  it('fires once for a newly-copied CCTV link and dedupes repeats', () => {
    const onLink = vi.fn()
    const w = new ClipboardWatcher(() => true, onLink, () => 'https://tv.cctv.com/lm/xwlb/')
    w.check()
    w.check()
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onLink).toHaveBeenCalledWith('https://tv.cctv.com/lm/xwlb/')
  })

  it('does not fire for non-CCTV clipboard text', () => {
    const onLink = vi.fn()
    new ClipboardWatcher(() => true, onLink, () => 'just some copied text').check()
    expect(onLink).not.toHaveBeenCalled()
  })

  it('fires again when the copied link changes', () => {
    let text = 'https://tv.cctv.com/lm/a/'
    const onLink = vi.fn()
    const w = new ClipboardWatcher(() => true, onLink, () => text)
    w.check()
    text = 'https://tv.cctv.com/lm/b/'
    w.check()
    expect(onLink).toHaveBeenCalledTimes(2)
  })
})
