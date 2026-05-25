import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreChromeMock } from './setup.js'
import { BaseFeature, api } from '../src/core/BaseFeature.js'
import { ApiService } from '../src/services/ApiService.js'
import { cacheService } from '../src/services/CacheService.js'

// BaseFeature's module-level event listener registers on whatever `document`
// existed at import time (the one from test/setup.js). Tests that replace
// global.document must dispatch events on this reference.
const moduleDocument = document
const ModuleCustomEvent = moduleDocument.defaultView.CustomEvent

describe('Cache Invalidation', () => {
  beforeEach(async () => {
    restoreChromeMock()

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://tahvel.edu.ee/'
    })
    global.window = dom.window
    global.document = dom.window.document

    ApiService.pendingRequests = {}
    ApiService.activeRequests = 0
    ApiService.requestQueue = []
    ApiService.concurrencyLimit = 10
    ApiService.delayBetweenRequestsMs = 0
    ApiService.capturedRequests = []

    await cacheService.clearCache()
    api._kriitInitPromise = null
  })

  afterEach(() => {
    global.fetch = undefined
  })

  describe('Journal ID extraction from mutation URLs', () => {
    const JOURNAL_ID_RE = /\/journals\/(\d+)/

    function extractJournalId(url) {
      if (!url || !url.includes('/hois_back/')) return null
      const m = url.match(JOURNAL_ID_RE)
      return m ? Number(m[1]) : null
    }

    test('extracts journal ID from journalEntry PUT URL', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/journals/426365/journalEntry/12345'))
        .toBe(426365)
    })

    test('extracts journal ID from journalEntry POST URL', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/journals/123/journalEntry'))
        .toBe(123)
    })

    test('extracts journal ID from journal root URL', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/journals/999'))
        .toBe(999)
    })

    test('extracts journal ID from journalStudents URL', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/journals/42/journalStudents'))
        .toBe(42)
    })

    test('extracts journal ID from journalOutcome URL', () => {
      expect(extractJournalId('https://test.tahvel.eenet.ee/hois_back/journals/500/journalOutcome/789'))
        .toBe(500)
    })

    test('returns null for non-journal URL', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/students/123')).toBeNull()
    })

    test('returns null for journalEntry URL without journal prefix', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/journalEntry/12345')).toBeNull()
    })

    test('returns null for URL without hois_back', () => {
      expect(extractJournalId('https://example.com/journals/123')).toBeNull()
    })

    test('returns null for journal list URL without specific ID', () => {
      expect(extractJournalId('https://tahvel.edu.ee/hois_back/journals?onlyMyJournals=true')).toBeNull()
    })

    test('returns null for null/undefined URL', () => {
      expect(extractJournalId(null)).toBeNull()
      expect(extractJournalId(undefined)).toBeNull()
    })
  })

  describe('ApiService auto-invalidation after non-GET mutations', () => {
    let apiService
    let fetchMock
    let clearJournalCacheSpy
    let originalClearJournalCache

    beforeEach(() => {
      apiService = new ApiService({
        name: 'tahvel',
        baseUrl: 'https://tahvel.edu.ee/hois_back'
      })

      fetchMock = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ success: true })
      }))
      global.fetch = fetchMock

      originalClearJournalCache = cacheService.clearJournalCache
      clearJournalCacheSpy = mock(() => Promise.resolve(0))
      cacheService.clearJournalCache = clearJournalCacheSpy
    })

    afterEach(() => {
      cacheService.clearJournalCache = originalClearJournalCache
    })

    test('invalidates journal cache after successful POST to journal endpoint', async () => {
      await apiService.post('/journals/123/journalEntry', { topic: 'test' })
      expect(clearJournalCacheSpy).toHaveBeenCalledWith('123')
    })

    test('invalidates journal cache after successful PUT to journal endpoint', async () => {
      await apiService.put('/journals/456/journalEntry/789', { grade: 5 })
      expect(clearJournalCacheSpy).toHaveBeenCalledWith('456')
    })

    test('does not invalidate on GET requests', async () => {
      await apiService.get('/journals/123/journalEntriesByDate', {}, { cache: false })
      expect(clearJournalCacheSpy).not.toHaveBeenCalled()
    })

    test('does not invalidate for non-journal POST endpoints', async () => {
      await apiService.post('/students/123', { name: 'test' })
      expect(clearJournalCacheSpy).not.toHaveBeenCalled()
    })

    test('does not invalidate when mutation request fails', async () => {
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      }))

      try {
        await apiService.post('/journals/123/journalEntry', {})
      } catch {
        // Expected to throw
      }
      expect(clearJournalCacheSpy).not.toHaveBeenCalled()
    })
  })

  describe('BaseFeature onJournalDataChanged event', () => {
    test('calls onJournalDataChanged when feature is active and event fires', () => {
      const feature = new BaseFeature('testFeature', '/test')
      feature.isActive = true

      let receivedJournalId = null
      feature.onJournalDataChanged = journalId => { receivedJournalId = journalId }

      moduleDocument.dispatchEvent(new ModuleCustomEvent('oa2:journalDataChanged', { detail: { journalId: 42 } }))

      expect(receivedJournalId).toBe(42)
    })

    test('does not call onJournalDataChanged when feature is inactive', () => {
      const feature = new BaseFeature('testFeature', '/test')
      feature.isActive = false

      let called = false
      feature.onJournalDataChanged = () => { called = true }

      moduleDocument.dispatchEvent(new ModuleCustomEvent('oa2:journalDataChanged', { detail: { journalId: 42 } }))

      expect(called).toBe(false)
    })

    test('default onJournalDataChanged is a no-op', () => {
      const feature = new BaseFeature('testFeature', '/test')
      expect(() => feature.onJournalDataChanged(123)).not.toThrow()
    })
  })

  describe('Page URL journal ID fallback', () => {
    test('extracts journal ID from /#/journal/{id}/edit URL', () => {
      const match = '/#/journal/426365/edit'.match(/\/journal\/(\d+)/)
      expect(match).not.toBeNull()
      expect(Number(match[1])).toBe(426365)
    })

    test('extracts journal ID from /#/journal/{id} URL', () => {
      const match = '/#/journal/123'.match(/\/journal\/(\d+)/)
      expect(match).not.toBeNull()
      expect(Number(match[1])).toBe(123)
    })

    test('returns null when not on a journal page', () => {
      const match = '/#/students'.match(/\/journal\/(\d+)/)
      expect(match).toBeNull()
    })
  })

  describe('XHR interceptor message format', () => {
    test('valid mutation message has correct shape', () => {
      const message = { type: 'oa2:journalMutation', journalId: 123, method: 'PUT' }
      expect(message.type).toBe('oa2:journalMutation')
      expect(message.journalId).toBe(123)
      expect(typeof message.method).toBe('string')
    })

    test('content.js rejects invalid journalId values', () => {
      // Mirrors the guard in content.js: if (!journalId || !/^\d+$/.test(String(journalId)))
      function isValidJournalId(id) {
        return !!id && /^\d+$/.test(String(id))
      }

      expect(isValidJournalId(1)).toBe(true)
      expect(isValidJournalId(42)).toBe(true)
      expect(isValidJournalId(426365)).toBe(true)

      expect(isValidJournalId(0)).toBe(false)
      expect(isValidJournalId(-1)).toBe(false)
      expect(isValidJournalId('abc')).toBe(false)
      expect(isValidJournalId(null)).toBe(false)
      expect(isValidJournalId(undefined)).toBe(false)
      expect(isValidJournalId(NaN)).toBe(false)
    })
  })
})
