import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { isTahvelAuthenticated } from '../../src/lib/isTahvelAuthenticated.js'
import Logger from '../../src/services/Logger.js'

describe('isTahvelAuthenticated', () => {
  let mockApi

  beforeEach(() => {
    mockApi = {
      tahvel: {
        get: mock(async () => ({ person: { id: 123 }, school: { id: 9 } }))
      }
    }
  })

  it('returns true when /user resolves with a person id', async () => {
    expect(await isTahvelAuthenticated(mockApi)).toBe(true)
  })

  it('passes suppressErrorStatuses [401, 403] so unauthenticated 403s do not reach Sentry', async () => {
    await isTahvelAuthenticated(mockApi)
    const call = mockApi.tahvel.get.mock.calls[0]
    expect(call[0]).toBe('/user')
    expect(call[2].suppressErrorStatuses).toEqual([401, 403])
    expect(call[2].cache).toBe(true)
  })

  it('returns false on 403 (login screen / expired session)', async () => {
    mockApi.tahvel.get = mock(async () => {
      const err = new Error('API Error: 403 Forbidden')
      err.status = 403
      throw err
    })
    expect(await isTahvelAuthenticated(mockApi)).toBe(false)
  })

  it('returns false on 401', async () => {
    mockApi.tahvel.get = mock(async () => {
      const err = new Error('API Error: 401 Unauthorized')
      err.status = 401
      throw err
    })
    expect(await isTahvelAuthenticated(mockApi)).toBe(false)
  })

  it('returns false on other errors (network failure, 500) without throwing', async () => {
    mockApi.tahvel.get = mock(async () => {
      const err = new Error('API Error: 500 Internal Server Error')
      err.status = 500
      throw err
    })
    expect(await isTahvelAuthenticated(mockApi)).toBe(false)
  })

  it('returns false when /user response lacks person.id', async () => {
    mockApi.tahvel.get = mock(async () => ({}))
    expect(await isTahvelAuthenticated(mockApi)).toBe(false)
  })

  it('returns false when /user response is null', async () => {
    mockApi.tahvel.get = mock(async () => null)
    expect(await isTahvelAuthenticated(mockApi)).toBe(false)
  })

  describe('cache-path errors (no .status property)', () => {
    let originalWarning
    let warningSpy

    beforeEach(() => {
      originalWarning = Logger.warning
      warningSpy = mock(() => {})
      Logger.warning = warningSpy
    })

    afterEach(() => {
      Logger.warning = originalWarning
    })

    it('treats "API Error: 403 ..." without .status as not-authenticated, no warning', async () => {
      // ApiService cache path throws new Error('API Error: 403 ...') without
      // setting .status — the helper must still recognize this as 403.
      mockApi.tahvel.get = mock(async () => {
        throw new Error('API Error: 403 Forbidden')
      })
      expect(await isTahvelAuthenticated(mockApi)).toBe(false)
      expect(warningSpy).not.toHaveBeenCalled()
    })

    it('treats "API Error: 401 ..." without .status as not-authenticated, no warning', async () => {
      mockApi.tahvel.get = mock(async () => {
        throw new Error('API Error: 401 Unauthorized')
      })
      expect(await isTahvelAuthenticated(mockApi)).toBe(false)
      expect(warningSpy).not.toHaveBeenCalled()
    })

    it('still warns for unexpected status codes parsed from the message (e.g. 500)', async () => {
      mockApi.tahvel.get = mock(async () => {
        throw new Error('API Error: 500 Internal Server Error')
      })
      expect(await isTahvelAuthenticated(mockApi)).toBe(false)
      expect(warningSpy).toHaveBeenCalledTimes(1)
    })
  })
})
