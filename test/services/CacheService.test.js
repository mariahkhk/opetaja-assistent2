import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { cacheService } from '../../src/services/CacheService.js'
import { cryptoService } from '../../src/services/CryptoService.js'
import { restoreChromeMock } from '../setup.js'

/**
 * Test helper: put an entry into the raw Cache API in the same encrypted
 * format CacheService uses internally. Tests use this when they need to
 * seed an entry with a specific timestamp / TTL that the public API does
 * not let them set.
 *
 * The `url` param is the legacy `https://cache/<rawKey>` form for ergonomic
 * test reading; this helper hashes the rawKey portion via cryptoService.hash
 * so the seed lands at the same URL CacheService would write to.
 */
async function putEncrypted(cache, url, data, headers) {
  const rawKey = url.replace('https://cache/', '')
  const hashed = await cryptoService.hash(rawKey)
  const realUrl = `https://cache/${hashed}`
  const { iv, ct } = await cryptoService.encrypt(JSON.stringify(data))
  await cache.put(
    new Request(realUrl),
    new Response(ct, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Cache-IV': iv,
        ...headers
      }
    })
  )
}

describe('CacheService', () => {
  beforeEach(async () => {
    restoreChromeMock()
    cryptoService._reset()
    if (global.caches._clear) global.caches._clear()
    await cacheService.clearCache()
  })

  afterEach(async () => {
    await cacheService.clearCache()
  })

  // --- set() ---

  describe('set', () => {
    test('stores a value and returns true', async () => {
      const result = await cacheService.set('k1', { x: 1 })
      expect(result).toBe(true)
    })

    test('stored value is retrievable via get', async () => {
      await cacheService.set('k1', { x: 1 })
      const val = await cacheService.get('k1')
      expect(val).toEqual({ x: 1 })
    })

    test('stores strings, numbers, arrays, and nested objects', async () => {
      await cacheService.set('str', 'hello')
      await cacheService.set('num', 42)
      await cacheService.set('arr', [1, 2, 3])
      await cacheService.set('nested', { a: { b: { c: 1 } } })

      expect(await cacheService.get('str')).toBe('hello')
      expect(await cacheService.get('num')).toBe(42)
      expect(await cacheService.get('arr')).toEqual([1, 2, 3])
      expect(await cacheService.get('nested')).toEqual({ a: { b: { c: 1 } } })
    })

    test('overwrites previous value for the same key', async () => {
      await cacheService.set('k1', 'first')
      await cacheService.set('k1', 'second')
      expect(await cacheService.get('k1')).toBe('second')
    })

    test('stores null and empty object', async () => {
      await cacheService.set('nullVal', null)
      await cacheService.set('emptyObj', {})
      expect(await cacheService.get('nullVal')).toBeNull()
      expect(await cacheService.get('emptyObj')).toEqual({})
    })
  })

  // --- get() ---

  describe('get', () => {
    test('returns null for non-existent key', async () => {
      expect(await cacheService.get('missing')).toBeNull()
    })

    test('returns data when within maxAge', async () => {
      await cacheService.set('k', 'val')
      expect(await cacheService.get('k', 60000)).toBe('val')
    })

    test('returns null when maxAge exceeded', async () => {
      await cacheService.set('k', 'val')
      await new Promise(r => setTimeout(r, 15))
      expect(await cacheService.get('k', 1)).toBeNull()
    })

    test('returns data with default maxAge (Infinity)', async () => {
      await cacheService.set('k', 'val')
      expect(await cacheService.get('k')).toBe('val')
    })

    test('populates memory cache from Cache API on read', async () => {
      // Store directly via Cache API (bypassing memory)
      const cache = await caches.open('oa2-api-cache')
      const ts = Date.now()
      await putEncrypted(cache, 'https://cache/OA_cache_directKey', 'direct-value', {
        'X-Cache-Timestamp': String(ts)
      })

      // First get should read from Cache API and populate memory
      const val = await cacheService.get('directKey')
      expect(val).toBe('direct-value')

      // Second get (from memory) should also work
      const val2 = await cacheService.get('directKey')
      expect(val2).toBe('direct-value')
    })

    test('removes expired entry from memory cache', async () => {
      await cacheService.set('k', 'val')
      await new Promise(r => setTimeout(r, 15))

      // First call with short maxAge should return null and clean memory
      expect(await cacheService.get('k', 1)).toBeNull()
    })
  })

  // --- getOrFetch() ---

  describe('getOrFetch', () => {
    test('calls fetchFn when cache is empty', async () => {
      let called = 0
      const fetchFn = async () => { called++; return { id: 1 } }

      const result = await cacheService.getOrFetch('k', fetchFn, 60000)
      expect(result).toEqual({ id: 1 })
      expect(called).toBe(1)
    })

    test('returns cached data without calling fetchFn', async () => {
      let called = 0
      const fetchFn1 = async () => { called++; return 'first' }
      const fetchFn2 = async () => { called++; return 'second' }

      await cacheService.getOrFetch('k', fetchFn1, 60000)
      const result = await cacheService.getOrFetch('k', fetchFn2, 60000)

      expect(result).toBe('first')
      expect(called).toBe(1)
    })

    test('calls fetchFn again after expiration', async () => {
      let callCount = 0
      const fetchFn = async () => ++callCount

      await cacheService.getOrFetch('k', fetchFn, 1) // 1ms expiration
      await new Promise(r => setTimeout(r, 15))
      const result = await cacheService.getOrFetch('k', fetchFn, 1)

      expect(result).toBe(2)
      expect(callCount).toBe(2)
    })

    test('deduplicates concurrent identical requests', async () => {
      let callCount = 0
      const fetchFn = async () => {
        callCount++
        await new Promise(r => setTimeout(r, 30))
        return { data: callCount }
      }

      const [r1, r2, r3] = await Promise.all([
        cacheService.getOrFetch('dedup', fetchFn, 60000),
        cacheService.getOrFetch('dedup', fetchFn, 60000),
        cacheService.getOrFetch('dedup', fetchFn, 60000)
      ])

      expect(r1).toEqual({ data: 1 })
      expect(r2).toEqual({ data: 1 })
      expect(r3).toEqual({ data: 1 })
      expect(callCount).toBe(1)
    })

    test('different keys fetch independently', async () => {
      const fn1 = async () => 'a'
      const fn2 = async () => 'b'

      const [r1, r2] = await Promise.all([
        cacheService.getOrFetch('key1', fn1, 60000),
        cacheService.getOrFetch('key2', fn2, 60000)
      ])

      expect(r1).toBe('a')
      expect(r2).toBe('b')
    })

    test('propagates fetchFn errors', async () => {
      const fetchFn = async () => { throw new Error('network failure') }

      try {
        await cacheService.getOrFetch('failKey', fetchFn, 60000)
        expect(true).toBe(false)
      } catch (e) {
        expect(e.message).toBe('network failure')
      }
    })

    test('cleans up pendingFetches after error', async () => {
      const failFn = async () => { throw new Error('fail') }
      const successFn = async () => 'recovered'

      try { await cacheService.getOrFetch('recoverKey', failFn, 60000) } catch {}

      // Should be able to fetch again (not stuck on pending)
      const result = await cacheService.getOrFetch('recoverKey', successFn, 60000)
      expect(result).toBe('recovered')
    })

    test('persists data to Cache API (survives memory cache clear)', async () => {
      await cacheService.getOrFetch('persist', async () => 'persisted', 60000)

      // Verify persistence by reading directly from the encrypted Cache API entry.
      // The URL is HMAC(salt, 'OA_cache_persist'); reproduce it the same way.
      const hashed = await cryptoService.hash('OA_cache_persist')
      const cache = await caches.open('oa2-api-cache')
      const response = await cache.match(new Request(`https://cache/${hashed}`))
      expect(response).toBeTruthy()
      const iv = response.headers.get('X-Cache-IV')
      expect(iv).toBeTruthy()
      const ct = await response.text()
      const plaintext = await cryptoService.decrypt({ iv, ct })
      expect(JSON.parse(plaintext)).toBe('persisted')
    })

    test('uses Cache API when memory cache is expired', async () => {
      // First fetch with long expiration stores to both memory and Cache API
      await cacheService.getOrFetch('memExpire', async () => 'original', 60000)

      // Manually expire only the memory cache entry by manipulating timestamp
      // We do this by clearing cache and re-storing with old timestamp in Cache API only
      await cacheService.clearCache()

      // Store directly in Cache API with recent timestamp
      const cache = await caches.open('oa2-api-cache')
      await putEncrypted(cache, 'https://cache/OA_cache_memExpire', 'from-storage', {
        'X-Cache-Timestamp': String(Date.now())
      })

      let fetchCalled = false
      const result = await cacheService.getOrFetch('memExpire', async () => { fetchCalled = true; return 'fresh' }, 60000)

      expect(result).toBe('from-storage')
      expect(fetchCalled).toBe(false)
    })

    test('respects useMemoryCache=false', async () => {
      let callCount = 0
      const fetchFn = async () => ++callCount

      // First call with useMemoryCache=false
      await cacheService.getOrFetch('noMem', fetchFn, 60000, false)

      // Should still use Cache API storage for second call
      const result = await cacheService.getOrFetch('noMem', fetchFn, 60000, false)

      // Cache API should be hit, fetchFn should not be called again
      expect(result).toBe(1)
      expect(callCount).toBe(1)
    })

    test('re-throws negative results (_errorStatus) on fetch', async () => {
      // getOrFetch should throw when fetchFn returns a negative result
      try {
        await cacheService.getOrFetch('neg', async () => ({ _errorStatus: 404 }), 60000)
        expect(true).toBe(false) // Should not reach here
      } catch (e) {
        expect(e.message).toBe('API Error: 404')
      }
    })

    test('re-throws negative results from cache (avoids repeated network requests)', async () => {
      // First call caches the negative result and throws
      try {
        await cacheService.getOrFetch('neg2', async () => ({ _errorStatus: 412 }), 60000)
      } catch {}

      // Second call should throw from cache without calling fetchFn
      let fetchCalled = false
      try {
        await cacheService.getOrFetch('neg2', async () => { fetchCalled = true; return 'fresh' }, 60000)
        expect(true).toBe(false)
      } catch (e) {
        expect(e.message).toBe('API Error: 412')
        expect(fetchCalled).toBe(false)
      }
    })

    test('caps TTL for negative results — refetches after 5 min', async () => {
      // First call caches the negative result
      try {
        await cacheService.getOrFetch('negTtl', async () => ({ _errorStatus: 404 }), 24 * 60 * 60 * 1000)
      } catch {}

      // Clear memory cache to force Cache API read
      await cacheService.clearCache()

      // Re-store with old timestamp (6 minutes ago, beyond 5-min negative TTL cap)
      const cache = await caches.open('oa2-api-cache')
      const oldTimestamp = Date.now() - 6 * 60 * 1000
      await putEncrypted(cache, 'https://cache/OA_cache_negTtl', { _errorStatus: 404 }, {
        'X-Cache-Timestamp': String(oldTimestamp),
        'X-Cache-Expiration': String(5 * 60 * 1000)
      })

      let fetchCalled = false
      const result = await cacheService.getOrFetch('negTtl', async () => { fetchCalled = true; return 'fresh' }, 24 * 60 * 60 * 1000)

      // Should have refetched because negative TTL is capped at 5 min
      expect(fetchCalled).toBe(true)
      expect(result).toBe('fresh')
    })

    test('does not cap TTL for normal results', async () => {
      await cacheService.clearCache()

      // Store a normal result in Cache API with timestamp 6 min ago
      const cache = await caches.open('oa2-api-cache')
      const oldTimestamp = Date.now() - 6 * 60 * 1000
      await putEncrypted(cache, 'https://cache/OA_cache_normal', { id: 1 }, {
        'X-Cache-Timestamp': String(oldTimestamp),
        'X-Cache-Expiration': String(24 * 60 * 60 * 1000)
      })

      let fetchCalled = false
      const result = await cacheService.getOrFetch('normal', async () => { fetchCalled = true; return 'new' }, 24 * 60 * 60 * 1000)

      // Should NOT refetch — 6 min < 24h expiration
      expect(fetchCalled).toBe(false)
      expect(result).toEqual({ id: 1 })
    })
  })

  // --- clearCache() ---

  describe('clearCache', () => {
    test('removes all cached entries', async () => {
      await cacheService.set('a', 1)
      await cacheService.set('b', 2)
      await cacheService.set('c', 3)

      await cacheService.clearCache()

      expect(await cacheService.get('a')).toBeNull()
      expect(await cacheService.get('b')).toBeNull()
      expect(await cacheService.get('c')).toBeNull()
    })

    test('returns total count of entries cleared (memory + storage)', async () => {
      await cacheService.set('a', 1)
      await cacheService.set('b', 2)
      const count = await cacheService.clearCache()
      expect(count).toBe(4) // 2 memory + 2 storage
    })

    test('clears both memory and Cache API', async () => {
      await cacheService.set('k', 'val')
      await cacheService.clearCache()

      // Verify Cache API is empty
      const cache = await caches.open('oa2-api-cache')
      const keys = await cache.keys()
      expect(keys.length).toBe(0)
    })

    test('is safe to call on empty cache', async () => {
      const count = await cacheService.clearCache()
      expect(count).toBe(0)
    })
  })

  // --- clearJournalCache() ---

  describe('clearJournalCache', () => {
    test('clears journal entries but keeps timetable and other data', async () => {
      await cacheService.set('GET_/journals/123/journalEntriesByDate', 'entries')
      await cacheService.set('GET_/journals/456/journalStudents', 'students')
      await cacheService.set('GET_timetableEvents/school/9', 'timetable')
      await cacheService.set('GET_/schools/9/info', 'school')
      await cacheService.set('someOtherKey', 'other')

      await cacheService.clearJournalCache()

      expect(await cacheService.get('GET_/journals/123/journalEntriesByDate')).toBeNull()
      expect(await cacheService.get('GET_/journals/456/journalStudents')).toBeNull()
      expect(await cacheService.get('GET_timetableEvents/school/9')).toBe('timetable')
      expect(await cacheService.get('GET_/schools/9/info')).toBe('school')
      expect(await cacheService.get('someOtherKey')).toBe('other')
    })

    test('filters by specific journal ID', async () => {
      await cacheService.set('GET_/journals/123/journalEntriesByDate', 'j123')
      await cacheService.set('GET_/journals/456/journalEntriesByDate', 'j456')

      await cacheService.clearJournalCache(123)

      expect(await cacheService.get('GET_/journals/123/journalEntriesByDate')).toBeNull()
      expect(await cacheService.get('GET_/journals/456/journalEntriesByDate')).toBe('j456')
    })

    test('returns count of removed entries', async () => {
      await cacheService.set('GET_/journals/1/journalEntry', 'a')
      await cacheService.set('GET_/journals/2/journalStudents', 'b')
      await cacheService.set('timetableData', 'keep')

      const count = await cacheService.clearJournalCache()
      // 2 journal entries removed (memory + storage each = 4 total)
      expect(count).toBeGreaterThanOrEqual(2)
    })

    test('does not clear timetable even if key contains journal ID', async () => {
      await cacheService.set('GET_timetableEvents/journals/123', 'tt')
      await cacheService.clearJournalCache(123)
      expect(await cacheService.get('GET_timetableEvents/journals/123')).toBe('tt')
    })
  })

  // --- isJournalRelatedCache() ---

  describe('isJournalRelatedCache', () => {
    test('identifies journalEntriesByDate as journal-related', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/123/journalEntriesByDate')).toBe(true)
    })

    test('identifies journalEntry as journal-related', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/123/journalEntry')).toBe(true)
    })

    test('identifies journalStudents as journal-related', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/123/journalStudents')).toBe(true)
    })

    test('identifies /journals/ path as journal-related', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_GET_/journals/99')).toBe(true)
    })

    test('excludes timetableEvents', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_timetableEvents')).toBe(false)
    })

    test('excludes timetable', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/schools/9/timetable')).toBe(false)
    })

    test('excludes /schools/ paths', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/schools/9/info')).toBe(false)
    })

    test('excludes /teachers/ paths', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/teachers/456')).toBe(false)
    })

    test('excludes unrelated keys', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_someRandomKey')).toBe(false)
    })

    test('filters by journalId when provided', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/123/journalEntriesByDate', 123)).toBe(true)
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/456/journalEntriesByDate', 123)).toBe(false)
    })

    test('timetable exclusion takes precedence over journal ID filter', () => {
      // A key with both timetable pattern and journal pattern — timetable wins
      expect(cacheService.isJournalRelatedCache('OA_cache_timetableEvents/journals/123/journalEntry')).toBe(false)
    })
  })

  // --- evictExpired() ---

  describe('evictExpired', () => {
    test('removes entries older than 24 hours', async () => {
      // Insert old entry directly into Cache API
      const cache = await caches.open('oa2-api-cache')
      const oldTs = Date.now() - 25 * 60 * 60 * 1000 // 25 hours ago
      await putEncrypted(cache, 'https://cache/OA_cache_oldEntry', 'old', {
        'X-Cache-Timestamp': String(oldTs)
      })

      // Insert fresh entry
      await cacheService.set('freshEntry', 'fresh')

      await cacheService.evictExpired()

      // Old entry gone, fresh entry remains
      const oldResult = await cacheService.get('oldEntry')
      const freshResult = await cacheService.get('freshEntry')
      expect(oldResult).toBeNull()
      expect(freshResult).toBe('fresh')
    })

    test('keeps entries younger than 24 hours', async () => {
      await cacheService.set('recent', 'value')
      await cacheService.evictExpired()
      expect(await cacheService.get('recent')).toBe('value')
    })

    test('handles empty cache', async () => {
      // Should not throw
      await cacheService.evictExpired()
    })

    test('evicts multiple expired entries in one call', async () => {
      const cache = await caches.open('oa2-api-cache')
      const oldTs = Date.now() - 25 * 60 * 60 * 1000

      for (let i = 0; i < 5; i++) {
        await putEncrypted(cache, `https://cache/OA_cache_old${i}`, `old${i}`, {
          'X-Cache-Timestamp': String(oldTs)
        })
      }
      await cacheService.set('keepMe', 'fresh')

      await cacheService.evictExpired()

      for (let i = 0; i < 5; i++) {
        expect(await cacheService.get(`old${i}`)).toBeNull()
      }
      expect(await cacheService.get('keepMe')).toBe('fresh')
    })
  })

  // --- getStats() ---

  describe('getStats', () => {
    test('returns correct structure', async () => {
      const stats = await cacheService.getStats()
      expect(stats).toHaveProperty('memory')
      expect(stats).toHaveProperty('storage')
      expect(stats).toHaveProperty('totalBytesInUse')
      expect(stats.memory).toHaveProperty('count')
      expect(stats.memory).toHaveProperty('size')
      expect(stats.memory).toHaveProperty('items')
      expect(stats.storage).toHaveProperty('count')
      expect(stats.storage).toHaveProperty('size')
      expect(stats.storage).toHaveProperty('items')
    })

    test('counts entries correctly', async () => {
      await cacheService.set('s1', { a: 1 })
      await cacheService.set('s2', { b: 2 })

      const stats = await cacheService.getStats()

      expect(stats.memory.count).toBe(2)
      expect(stats.storage.count).toBe(2)
    })

    test('calculates size for storage items', async () => {
      await cacheService.set('sized', { big: 'data'.repeat(100) })

      const stats = await cacheService.getStats()
      expect(stats.storage.size).toBeGreaterThan(0)
      expect(stats.totalBytesInUse).toBe(stats.storage.size)
    })

    test('items include key, size, timestamp, and ageInMinutes', async () => {
      await cacheService.set('detailed', 'value')

      const stats = await cacheService.getStats()
      const item = stats.storage.items[0]

      expect(item).toHaveProperty('key')
      expect(item).toHaveProperty('size')
      expect(item).toHaveProperty('timestamp')
      expect(item).toHaveProperty('ageInMinutes')
      expect(item.size).toBeGreaterThan(0)
      expect(item.timestamp).toBeGreaterThan(0)
    })

    test('sorts storage items by size descending', async () => {
      await cacheService.set('small', 'x')
      await cacheService.set('big', 'x'.repeat(1000))

      const stats = await cacheService.getStats()
      if (stats.storage.items.length >= 2) {
        expect(stats.storage.items[0].size).toBeGreaterThanOrEqual(stats.storage.items[1].size)
      }
    })

    test('returns zeros for empty cache', async () => {
      const stats = await cacheService.getStats()
      expect(stats.memory.count).toBe(0)
      expect(stats.storage.count).toBe(0)
      expect(stats.totalBytesInUse).toBe(0)
    })
  })

  // --- EXPIRATION constants ---

  describe('EXPIRATION', () => {
    test('has all expected constants', () => {
      expect(cacheService.EXPIRATION.VERY_SHORT).toBe(1000)
      expect(cacheService.EXPIRATION.SHORT).toBe(60000)
      expect(cacheService.EXPIRATION.MEDIUM).toBe(300000)
      expect(cacheService.EXPIRATION.LONG).toBe(1800000)
      expect(cacheService.EXPIRATION.VERY_LONG).toBe(86400000)
      expect(cacheService.EXPIRATION.TWO_WEEKS).toBe(1209600000)
    })
  })
})
