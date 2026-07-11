import { describe, it, expect, vi } from 'vitest'

// The module imports `clipboard` from electron at top level; stub it (tests inject
// their own readText, so the real clipboard is never used).
vi.mock('electron', () => ({ clipboard: { readText: () => '' } }))

import { isCctvLink, ClipboardWatcher } from '../../src/main/clipboard-watch'
import { isCctvPageHostname } from '../../src/shared/cctv-link'

describe('isCctvLink', () => {
  it('matches tv.cctv.com page URLs (trims whitespace)', () => {
    expect(isCctvLink('https://tv.cctv.com/lm/xwlb/')).toBe(true)
    expect(isCctvLink('http://tv.cctv.com/2026/06/12/VIDExxx.shtml')).toBe(true)
    expect(isCctvLink('  https://tv.cctv.com/x  ')).toBe(true)
  })

  it('matches every supported CCTV host', () => {
    expect(isCctvLink('https://tv.cctv.cn/2026/01/01/VIDE.shtml')).toBe(true)
    expect(isCctvLink('https://news.cctv.com/2026/01/01/ARTI.shtml')).toBe(true)
    expect(isCctvLink('https://news.cctv.cn/2026/01/01/ARTI.shtml')).toBe(true)
    expect(isCctvLink('https://content-static.cctvnews.cctv.com/snow-book/video.html?item_id=1')).toBe(true)
  })

  it('matches legacy programme subdomains without a host allowlist', () => {
    expect(isCctvLink('https://jishi.cctv.com/2015/03/03/VIDA1425372752043217.shtml')).toBe(true)
    expect(isCctvLink('https://ent.cctv.com/2015/07/21/VIDA1437462909085973.shtml')).toBe(true)
    expect(isCctvLink('https://big5.cctv.com/gate/big5/wlchunwan.cntv.cn/2015/02/04/VIDE1423018814797644.shtml')).toBe(true)
    expect(isCctvLink('https://wlchunwan.cntv.cn/2015/02/04/VIDE1423018814797644.shtml')).toBe(true)
  })

  it('requires a real CCTV/CNTV domain boundary', () => {
    expect(isCctvPageHostname('sports.cctv.com')).toBe(true)
    expect(isCctvPageHostname('CCTV.COM.')).toBe(true)
    expect(isCctvPageHostname('cctv.com.evil.example')).toBe(false)
    expect(isCctvPageHostname('fakecctv.com')).toBe(false)
    expect(isCctvLink('https://cctv.com.evil.example/VIDE.shtml')).toBe(false)
  })

  it('rejects non-CCTV / non-URL text', () => {
    for (const t of ['', 'hello world', 'https://example.com/x', 'tv.cctv.com/x', 'ftp://tv.cctv.com/x']) {
      expect(isCctvLink(t)).toBe(false)
    }
  })
})

describe('ClipboardWatcher.check', () => {
  it('checks immediately when started instead of waiting for the first interval', () => {
    const onLink = vi.fn()
    const watcher = new ClipboardWatcher(
      () => true, onLink, () => 'https://tv.cctv.com/lm/xwlb/', 60_000
    )
    watcher.start()
    watcher.stop()
    expect(onLink).toHaveBeenCalledWith('https://tv.cctv.com/lm/xwlb/')
  })

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

  it('can force a recheck after the renderer subscribes or watching is enabled', () => {
    const onLink = vi.fn()
    const w = new ClipboardWatcher(() => true, onLink, () => 'https://tv.cctv.com/lm/xwlb/')
    w.check()
    w.check(true)
    expect(onLink).toHaveBeenCalledTimes(2)
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
