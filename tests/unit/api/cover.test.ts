import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

const fsMock = {
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
}
vi.mock('fs', () => ({ default: fsMock }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocks are set up
const { downloadCoverToDir } = await import('../../../src/main/api/cover')

function makeResp(contentType: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(4),
  }
}

describe('downloadCoverToDir', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.existsSync.mockReturnValue(false)
  })

  it('infers .jpg for image/jpeg', async () => {
    mockFetch.mockResolvedValue(makeResp('image/jpeg'))
    const { savedPath } = await downloadCoverToDir('https://x.com/img', '/save', 'cover')
    expect(savedPath).toBe(path.join('/save', 'cover.jpg'))
  })

  it('infers .png for image/png', async () => {
    mockFetch.mockResolvedValue(makeResp('image/png'))
    const { savedPath } = await downloadCoverToDir('https://x.com/img', '/save', 'cover')
    expect(savedPath).toBe(path.join('/save', 'cover.png'))
  })

  it('infers .webp for image/webp', async () => {
    mockFetch.mockResolvedValue(makeResp('image/webp'))
    const { savedPath } = await downloadCoverToDir('https://x.com/img', '/save', 'cover')
    expect(savedPath).toBe(path.join('/save', 'cover.webp'))
  })

  it('falls back to .jpg for unknown content-type', async () => {
    mockFetch.mockResolvedValue(makeResp('application/octet-stream'))
    const { savedPath } = await downloadCoverToDir('https://x.com/img', '/save', 'cover')
    expect(savedPath).toBe(path.join('/save', 'cover.jpg'))
  })

  it('appends _2 when target already exists', async () => {
    mockFetch.mockResolvedValue(makeResp('image/jpeg'))
    fsMock.existsSync.mockImplementation((p: string) => !p.includes('_2'))
    const { savedPath } = await downloadCoverToDir('https://x.com/img', '/save', 'cover')
    expect(savedPath).toBe(path.join('/save', 'cover_2.jpg'))
  })

  it('throws when HTTP status is not ok', async () => {
    mockFetch.mockResolvedValue(makeResp('image/jpeg', 404))
    await expect(downloadCoverToDir('https://x.com/img', '/save', 'cover')).rejects.toThrow('服务器返回 404')
  })

  it('propagates fetch network errors', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    await expect(downloadCoverToDir('https://x.com/img', '/save', 'cover')).rejects.toThrow('network error')
  })
})
