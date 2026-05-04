import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { cacheService } from '../src/services/CacheService.js'
import { cryptoService } from '../src/services/CryptoService.js'
import { ApiService } from '../src/services/ApiService.js'

// Importing content.js at the top runs its top-level code (sentryService.init,
// TahvelExtension.init, addEventListener registration). Because Bun caches
// modules, this happens once for the file. Capture the registered listener
// from the chrome mock provided by setup.js.
await import('../src/content.js')

let messageListener
const calls = global.chrome.runtime.onMessage.addListener.mock.calls
// content.js registers exactly one listener directly. VersionCheckService also
// registers one. The content.js listener accepts (message, sender, sendResponse)
// — pick the one with 3 parameters, or take the last registration which is
// content.js's based on import order.
messageListener = calls[calls.length - 1][0]

// Save originals so subsequent test files see unmodified singletons
const originalClearCache = cacheService.clearCache
const originalEvictExpired = cacheService.evictExpired
const originalGetStats = cacheService.getStats
const originalCryptoReset = cryptoService._reset
const originalGetCapturedRequests = ApiService.getCapturedRequests

describe('content.js', () => {
  beforeEach(() => {
    // Reset only the per-call mocks, not the chrome surface
    cacheService.clearCache = mock(async () => undefined)
    cacheService.evictExpired = mock(async () => undefined)
    cacheService.getStats = mock(async () => ({ size: 42 }))
    cryptoService._reset = mock()
    ApiService.getCapturedRequests = mock(() => [])
  })

  afterAll(() => {
    cacheService.clearCache = originalClearCache
    cacheService.evictExpired = originalEvictExpired
    cacheService.getStats = originalGetStats
    cryptoService._reset = originalCryptoReset
    ApiService.getCapturedRequests = originalGetCapturedRequests
  })

  describe('toggleDebugMode message', () => {
    it('replies with success when enabling debug mode', () => {
      const sendResponse = mock()
      messageListener({ action: 'toggleDebugMode', enabled: true }, {}, sendResponse)
      expect(sendResponse).toHaveBeenCalledWith({ success: true })
    })

    it('replies with success when disabling debug mode', () => {
      const sendResponse = mock()
      messageListener({ action: 'toggleDebugMode', enabled: false }, {}, sendResponse)
      expect(sendResponse).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('cacheClearedFromPopup message', () => {
    it('returns true to keep channel open and clears cache', async () => {
      const sendResponse = mock()
      const result = messageListener({ action: 'cacheClearedFromPopup' }, {}, sendResponse)
      expect(result).toBe(true)
      await new Promise(r => setTimeout(r, 60))
      expect(cacheService.clearCache).toHaveBeenCalled()
    })

    it('handles cache clear failure', async () => {
      cacheService.clearCache = mock(async () => { throw new Error('cache fail') })
      const sendResponse = mock()
      messageListener({ action: 'cacheClearedFromPopup' }, {}, sendResponse)
      await new Promise(r => setTimeout(r, 60))
      const calls = sendResponse.mock.calls
      expect(calls[0][0]).toMatchObject({ success: false })
    })
  })

  describe('cryptoKeyRotated message', () => {
    it('resets crypto service and replies with success', () => {
      const sendResponse = mock()
      messageListener({ action: 'cryptoKeyRotated' }, {}, sendResponse)
      expect(cryptoService._reset).toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('cacheMaintenanceTick message', () => {
    it('triggers evictExpired and replies with success', () => {
      const sendResponse = mock()
      messageListener({ action: 'cacheMaintenanceTick' }, {}, sendResponse)
      expect(cacheService.evictExpired).toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('getCacheStats message', () => {
    it('returns stats on success', async () => {
      const sendResponse = mock()
      const result = messageListener({ action: 'getCacheStats' }, {}, sendResponse)
      expect(result).toBe(true)
      await new Promise(r => setTimeout(r, 5))
      expect(sendResponse).toHaveBeenCalledWith({ status: 'success', stats: { size: 42 } })
    })

    it('returns error when getStats rejects', async () => {
      cacheService.getStats = mock(async () => { throw new Error('stats fail') })
      const sendResponse = mock()
      messageListener({ action: 'getCacheStats' }, {}, sendResponse)
      await new Promise(r => setTimeout(r, 5))
      expect(sendResponse).toHaveBeenCalledWith({ status: 'error', message: 'stats fail' })
    })
  })

  describe('getCapturedRequests message', () => {
    it('returns success metadata structure', () => {
      const sendResponse = mock()
      const result = messageListener({ action: 'getCapturedRequests' }, {}, sendResponse)
      expect(result).toBe(true)
      const callArg = sendResponse.mock.calls[0][0]
      expect(callArg.status).toBe('success')
      expect(callArg.data.metadata).toBeDefined()
      expect(callArg.data.requests).toEqual([])
    })

    it('filters requests for journal context when on journal page', () => {
      window.location.hash = '#/journal/12345/edit'
      ApiService.getCapturedRequests = mock(() => [
        { url: 'https://tahvel.edu.ee/api/journals/12345/students', method: 'GET' },
        { url: 'https://tahvel.edu.ee/api/journals/99999/students', method: 'GET' }
      ])
      const sendResponse = mock()
      messageListener({ action: 'getCapturedRequests' }, {}, sendResponse)
      const data = sendResponse.mock.calls[0][0].data
      expect(data.metadata.journalId).toBe(12345)
      expect(data.metadata.filteredForJournal).toBe(1)
    })

    it('returns all captured requests when no journal in URL', () => {
      window.location.hash = '#/students'
      ApiService.getCapturedRequests = mock(() => [
        { url: 'https://tahvel.edu.ee/api/x', method: 'GET' }
      ])
      const sendResponse = mock()
      messageListener({ action: 'getCapturedRequests' }, {}, sendResponse)
      const data = sendResponse.mock.calls[0][0].data
      expect(data.metadata.journalId).toBeNull()
      expect(data.metadata.filterApplied).toBe(false)
    })
  })

  describe('unknown message', () => {
    it('returns true to keep the channel open', () => {
      const sendResponse = mock()
      const result = messageListener({ action: 'unknownAction' }, {}, sendResponse)
      expect(result).toBe(true)
    })
  })
})
