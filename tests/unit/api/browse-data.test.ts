import { describe, expect, it } from 'vitest'
import { cleanBrief, extractTitle } from '../../../src/main/api/browse-data'

describe('cleanBrief', () => {
  it.each([
    ['empty input', '', ''],
    ['CRLF normalization', 'Hello World\r\nTest', 'Hello World\nTest'],
    ['CR normalization', 'Hello\rWorld', 'Hello\nWorld'],
    ['full prefix', '本期节目主要内容：actual content', 'actual content'],
    ['ASCII prefix punctuation', '本期节目主要内容:actual content', 'actual content'],
    ['short prefix', '主要内容：actual content', 'actual content'],
    ['internal spaces', '本期节目主要内容：内容 A 内容 B', '内容 A 内容 B'],
    ['blank-line collapse', 'A\n\n\n\nB', 'A\n\nB'],
    ['outer whitespace', '  content  ', 'content'],
    ['Unicode line separators', 'A\u2028B\u2029C', 'A\u2028B\u2029C']
  ])('%s', (_case, input, expected) => {
    expect(cleanBrief(input)).toBe(expected)
  })

  it.each([
    [
      '正文内容。（《世界战史》\n20260619\n突袭雷达站）',
      '正文内容。'
    ],
    [
      '3D打印房屋结构牢固，已经开始落地试用。 （《创新进行时》 20260619 建房新妙招（一））',
      '3D打印房屋结构牢固，已经开始落地试用。'
    ],
    [
      '本期节目主要内容：1942年2月27日，英军伞兵执行任务。（《世界战史》\r\n20260619\r\n突袭雷达站）',
      '1942年2月27日，英军伞兵执行任务。'
    ]
  ])('removes a complete trailing CCTV attribution', (input, expected) => {
    expect(cleanBrief(input)).toBe(expected)
  })
})

describe('extractTitle', () => {
  it.each([
    ['commentTitle book name', '<script>var commentTitle = "《新闻联播》 20260612";</script>', '新闻联播'],
    ['title suffixes', '<title>世界战史_CCTV节目官网-CCTV-1</title>', '世界战史'],
    ['og:title suffixes', '<meta content="世界战史_CCTV节目官网" property="og:title"><title>错误标题</title>', '世界战史'],
    ['whitespace official suffix', '<meta property="og:title" content="世界战史 央视节目官网">', '世界战史'],
    ['missing metadata', '<html>nothing</html>', ''],
    ['dated commentTitle', '<script>var commentTitle = "新闻联播 20260612 今日精选";</script>', '新闻联播'],
    ['节目视频 suffix', '<title>经济半小时节目视频_CCTV节目官网-CCTV-2</title>', '经济半小时'],
    ['视频 suffix', '<title>经济半小时视频_CCTV节目官网-CCTV-2</title>', '经济半小时'],
    ['节目 suffix', '<title>焦点访谈节目_CCTV节目官网</title>', '焦点访谈'],
    [
      'commentTitle priority',
      '<title>错误标题_CCTV节目官网</title><script>var commentTitle = "《世界战史》 20260601";</script>',
      '世界战史'
    ]
  ])('%s', (_case, html, expected) => {
    expect(extractTitle(html)).toBe(expected)
  })
})
