import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { cacheService, _wipeOnVersionChangeForTests } from '../../src/services/CacheService.js'
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


const ESTONIAN_IDCODE_PATTERN = /\b[3-6]\d{10}\b/

const STUDENT_FIXTURE = {
  students: [
    { studentId: 1, name: 'Test PersonA', personalCode: '30000000001', grade: 'A' },
    { studentId: 2, name: 'Test PersonB', personalCode: '40000000002', grade: 'C' }
  ],
  teacher: { name: 'Test PersonC', personalCode: '50000000003' }
}

describe('CacheService — encryption at rest', () => {
  beforeEach(async () => {
    restoreChromeMock()
    if (global.caches._clear) global.caches._clear()
    cryptoService._reset()
    await cacheService.clearCache()
  })

  test('cached PII is not readable in raw Cache API storage', async () => {
    await cacheService.set('journals/123/students', STUDENT_FIXTURE)

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(1)

    const response = await cache.match(requests[0])
    const rawBody = await response.text()
    expect(rawBody).not.toContain('PersonA')
    expect(rawBody).not.toContain('PersonB')
    expect(rawBody).not.toContain('PersonC')
    expect(rawBody).not.toContain('30000000001')
    expect(rawBody).not.toContain('40000000002')
    expect(rawBody).not.toContain('50000000003')
    expect(rawBody).not.toMatch(ESTONIAN_IDCODE_PATTERN)

    // Cache URL itself must not leak the original endpoint
    expect(requests[0].url).not.toContain('journals')
    expect(requests[0].url).not.toContain('students')
    expect(requests[0].url).not.toContain('OA_cache_')
  })

  test('round-trip via public API returns the original data', async () => {
    await cacheService.set('journals/123/students', STUDENT_FIXTURE)
    const got = await cacheService.get('journals/123/students')
    expect(got).toEqual(STUDENT_FIXTURE)
  })

  test('every persisted entry has an X-Cache-IV header', async () => {
    await cacheService.set('a', 'first')
    await cacheService.set('b', 'second')
    await cacheService.set('c', { nested: { value: 42 } })

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBeGreaterThanOrEqual(3)
    for (const request of requests) {
      const response = await cache.match(request)
      expect(response.headers.get('X-Cache-IV')).toBeTruthy()
    }
  })

  test('corrupted ciphertext is treated as a cache miss (no error to caller)', async () => {
    // Seed at the *hashed* URL so cacheService.get() actually finds the entry
    // and reaches decrypt() — only then does the catch-as-miss path fire.
    // (Seeding at the legacy `https://cache/OA_cache_<key>` URL would just
    // miss the lookup and exercise the entry-not-found path instead.)
    const hashed = await cryptoService.hash('OA_cache_corruptKey')
    const { iv } = await cryptoService.encrypt('placeholder')
    const cache = await caches.open('oa2-api-cache')
    await cache.put(
      new Request(`https://cache/${hashed}`),
      new Response('AAAA', {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Cache-IV': iv,
          'X-Cache-Timestamp': String(Date.now())
        }
      })
    )

    const result = await cacheService.get('corruptKey')
    expect(result).toBeNull()
  })

  test('clearCache removes all encrypted entries', async () => {
    await cacheService.set('a', STUDENT_FIXTURE)
    await cacheService.set('b', STUDENT_FIXTURE)

    await cacheService.clearCache()

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(0)
  })

  test('clearJournalCache wipes only journal-related entries', async () => {
    await cacheService.set('journals/123/journalEntriesByDate', STUDENT_FIXTURE)
    await cacheService.set('timetableEvents/foo', { keep: true })

    await cacheService.clearJournalCache()

    expect(await cacheService.get('journals/123/journalEntriesByDate')).toBeNull()
    expect(await cacheService.get('timetableEvents/foo')).toEqual({ keep: true })
  })

  test('legacy plaintext entries (no X-Cache-IV) are treated as cache miss', async () => {
    const cache = await caches.open('oa2-api-cache')
    await cache.put(
      new Request('https://cache/OA_cache_legacyPlaintext'),
      new Response(JSON.stringify({ stale: true }), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Timestamp': String(Date.now())
        }
      })
    )

    const result = await cacheService.get('legacyPlaintext')
    expect(result).toBeNull()
  })
})

describe('CacheService — key hashing', () => {
  beforeEach(async () => {
    restoreChromeMock()
    if (global.caches._clear) global.caches._clear()
    cryptoService._reset()
    await cacheService.clearCache()
  })

  test('cache.keys() returns only opaque hex (no journal IDs or endpoint URLs)', async () => {
    await cacheService.set('GET_https://tahvel.edu.ee/journals/12345/journalEntriesByDate', { foo: 1 })
    await cacheService.set('GET_https://tahvel.edu.ee/timetableEvents/9', { bar: 2 })

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(2)

    for (const req of requests) {
      const key = req.url.replace('https://cache/', '')
      // SHA-256 hex = 64 lowercase hex chars
      expect(key).toMatch(/^[0-9a-f]{64}$/)
      expect(req.url).not.toContain('journals')
      expect(req.url).not.toContain('timetableEvents')
      expect(req.url).not.toContain('OA_cache_')
      expect(req.url).not.toContain('12345')
      expect(req.url).not.toContain('tahvel')
    }
  })

  test('hashed keys are deterministic — same raw key always maps to same URL', async () => {
    await cacheService.set('stable-key', { v: 1 })
    const cache = await caches.open('oa2-api-cache')
    const firstKeys = (await cache.keys()).map(r => r.url)

    await cacheService.set('stable-key', { v: 2 })
    const secondKeys = (await cache.keys()).map(r => r.url)

    expect(secondKeys).toEqual(firstKeys)
    expect(await cacheService.get('stable-key')).toEqual({ v: 2 })
  })

  test('different raw keys hash to different URLs', async () => {
    await cacheService.set('key-a', { a: 1 })
    await cacheService.set('key-b', { b: 1 })
    const cache = await caches.open('oa2-api-cache')
    const urls = (await cache.keys()).map(r => r.url)
    expect(urls.length).toBe(2)
    expect(urls[0]).not.toBe(urls[1])
  })

  test('legacy OA_cache_ URL format is wiped on cacheRead access', async () => {
    // Plant a legacy-format entry directly (would have come from a previous build)
    const cache = await caches.open('oa2-api-cache')
    const { iv, ct } = await cryptoService.encrypt(JSON.stringify({ stale: true }))
    await cache.put(
      new Request('https://cache/OA_cache_someoldKey'),
      new Response(ct, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Cache-IV': iv,
          'X-Cache-Timestamp': String(Date.now())
        }
      })
    )
    // The new code can't find it via the hashed lookup → cache miss
    expect(await cacheService.get('someoldKey')).toBeNull()
  })
})

describe('CacheService — clearJournalCache via HMAC tag', () => {
  beforeEach(async () => {
    restoreChromeMock()
    if (global.caches._clear) global.caches._clear()
    cryptoService._reset()
    await cacheService.clearCache()
  })

  test('clearJournalCache(123) wipes only entries tagged with journal 123', async () => {
    await cacheService.set('GET_/journals/123/journalEntriesByDate', { id: 1 })
    await cacheService.set('GET_/journals/456/journalEntriesByDate', { id: 2 })
    await cacheService.set('GET_/timetableEvents/foo', { id: 3 })

    await cacheService.clearJournalCache(123)

    expect(await cacheService.get('GET_/journals/123/journalEntriesByDate')).toBeNull()
    expect(await cacheService.get('GET_/journals/456/journalEntriesByDate')).toEqual({ id: 2 })
    expect(await cacheService.get('GET_/timetableEvents/foo')).toEqual({ id: 3 })
  })

  test('clearJournalCache(123) also clears keys without a trailing slash like GET_/journals/123', async () => {
    await cacheService.set('GET_/journals/123', { info: 'cached' })
    expect(await cacheService.get('GET_/journals/123')).toEqual({ info: 'cached' })

    await cacheService.clearJournalCache(123)

    expect(await cacheService.get('GET_/journals/123')).toBeNull()
  })

  test('clearJournalCache() with no id wipes every journal-tagged entry', async () => {
    await cacheService.set('GET_/journals/100/journalEntriesByDate', { id: 1 })
    await cacheService.set('GET_/journals/200/journalEntriesByDate', { id: 2 })
    await cacheService.set('GET_/timetableEvents/foo', { id: 3 })

    await cacheService.clearJournalCache()

    expect(await cacheService.get('GET_/journals/100/journalEntriesByDate')).toBeNull()
    expect(await cacheService.get('GET_/journals/200/journalEntriesByDate')).toBeNull()
    expect(await cacheService.get('GET_/timetableEvents/foo')).toEqual({ id: 3 })
  })

  test('journal tag hashes are unguessable without the salt', async () => {
    await cacheService.set('GET_/journals/9999/journalEntriesByDate', { x: 1 })

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    const response = await cache.match(requests[0])
    const tag = response.headers.get('X-Cache-Journal-Hash')

    expect(tag).toMatch(/^[0-9a-f]{64}$/)
    // The journal ID is not directly visible in the tag
    expect(tag).not.toContain('9999')
  })
})

describe('CacheService — persist=false (memory-only tier)', () => {
  beforeEach(async () => {
    restoreChromeMock()
    if (global.caches._clear) global.caches._clear()
    cryptoService._reset()
    await cacheService.clearCache()
  })

  test('set with persist=false does not write to Cache API', async () => {
    await cacheService.set('memOnlyKey', { sensitive: 'data' }, 0, false)

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(0)
  })

  test('set with persist=false is still readable in the same session', async () => {
    await cacheService.set('memOnlyKey', { sensitive: 'data' }, 0, false)
    expect(await cacheService.get('memOnlyKey')).toEqual({ sensitive: 'data' })
  })

  test('getOrFetch with persist=false fetches once but never stores to disk', async () => {
    let fetchCount = 0
    const fetchFn = async () => {
      fetchCount++
      return { rosterFor: 'journal-1', students: ['PersonA'] }
    }

    const a = await cacheService.getOrFetch('high-pii-key', fetchFn, 60000, true, false)
    const b = await cacheService.getOrFetch('high-pii-key', fetchFn, 60000, true, false)

    expect(a).toEqual({ rosterFor: 'journal-1', students: ['PersonA'] })
    expect(b).toEqual(a)
    expect(fetchCount).toBe(1)

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(0)
  })

  test('memory-only entries never expose their data anywhere on disk', async () => {
    const fixture = {
      students: [{ name: 'Test PersonA', idcode: '30000000001' }]
    }
    await cacheService.set('roster', fixture, 0, false)

    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    let found = false
    for (const req of requests) {
      const body = await (await cache.match(req)).text()
      if (body.includes('PersonA') || body.includes('30000000001')) {
        found = true
      }
    }
    expect(found).toBe(false)
  })
})

describe('ApiService — high-PII routing', () => {
  test('_isHighPiiEndpoint matches endpoints that return names/idcodes', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/journals/123/journalStudents')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/journals/456/students')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/students/789')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/students?status=active')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/teachers/22816')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/teachers?isActive=true&name=PersonE')).toBe(true)
  })

  test('_isHighPiiEndpoint also matches bare endpoint paths used by JournalListSync.fetchCachedData', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    expect(ApiService._isHighPiiEndpoint('/journals/123/journalStudents')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/journals/123/journalStudents?allStudents=true')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/journals/456/students')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/students/789')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/students?status=active')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/teachers/22816')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/teachers?isActive=true&lang=ET&name=PersonD')).toBe(true)
  })

  test('_isHighPiiEndpoint does not over-match sub-paths', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    // Sub-paths under /students/<id> and /teachers/<id> don't auto-route to
    // memory-only — patterns end with (?:\?|$). If a future endpoint like
    // /students/789/extras returns names/idcodes, enumerate it explicitly.
    expect(ApiService._isHighPiiEndpoint('/students/789/somesubresource')).toBe(false)
    expect(ApiService._isHighPiiEndpoint('/teachers/22816/subjects')).toBe(false)
    // A shape with /students NOT at a path-segment start should not match.
    expect(ApiService._isHighPiiEndpoint('/foostudents/789')).toBe(false)
  })

  test('_sanitiseForCache strips audit fields from timetable events', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    const url = 'https://tahvel.edu.ee/hois_back/timetableevents/timetableByTeacher/9?from=...'
    const data = {
      timetableEvents: [
        { id: 1, journalId: 123, nameEt: 'Lesson', insertedBy: 'Test PersonD (30000000001)', changedBy: 'Test PersonE (40000000002)' },
        { id: 2, journalId: 124, nameEt: 'Lesson 2', insertedBy: 'Test PersonF (50000000003)', changedBy: 'Test PersonF (50000000003)' }
      ],
      school: { id: 9 },
      teacherId: 22816
    }
    const sanitised = ApiService._sanitiseForCache(url, data)
    const json = JSON.stringify(sanitised)
    expect(json).not.toContain('insertedBy')
    expect(json).not.toContain('changedBy')
    expect(json).not.toMatch(/\b[3-6]\d{10}\b/)
    expect(sanitised.timetableEvents[0].nameEt).toBe('Lesson')
    expect(sanitised.timetableEvents[0].journalId).toBe(123)
    expect(sanitised.school).toEqual({ id: 9 })
  })

  test('_sanitiseForCache passes through non-timetable, non-user URLs unchanged', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    const data = { id: 1, somethingElse: 'value' }
    expect(ApiService._sanitiseForCache('https://tahvel.edu.ee/hois_back/journals/123', data)).toEqual(data)
    expect(ApiService._sanitiseForCache('', data)).toEqual(data)
    expect(ApiService._sanitiseForCache(null, data)).toEqual(data)
  })

  test('_sanitiseForCache strips name (idcode) from /user response (allowlist)', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    const data = {
      name: '30000000001',     // user's own idcode used as username
      user: 331113,
      person: { id: 227928 },
      teacher: 22816,
      school: { id: 9 },
      roleCode: 'ROLL_O'
    }
    const sanitised = ApiService._sanitiseForCache('https://tahvel.edu.ee/hois_back/user', data)
    expect(sanitised.name).toBeUndefined()
    expect(sanitised.school).toEqual({ id: 9 })
    expect(sanitised.person).toEqual({ id: 227928 })
    expect(sanitised.roleCode).toBe('ROLL_O')
    expect(JSON.stringify(sanitised)).not.toContain('30000000001')
  })

  test('_sanitiseForCache /user allowlist drops unknown PII fields', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    const data = {
      name: '30000000001',
      person: { id: 227928, idcode: '40000000002', email: 'x@example.test' },
      school: { id: 9 },
      roleCode: 'ROLL_O',
      // Hypothetical future Tahvel additions — must not land on disk:
      email: 'x@example.test',
      firstName: 'Test',
      lastName: 'PersonG'
    }
    const sanitised = ApiService._sanitiseForCache('https://tahvel.edu.ee/hois_back/user', data)
    const json = JSON.stringify(sanitised)
    expect(json).not.toContain('40000000002')
    expect(json).not.toContain('email')
    expect(json).not.toContain('firstName')
    expect(json).not.toContain('PersonG')
    // Allowlisted person.id only — no other person fields survive.
    expect(sanitised.person).toEqual({ id: 227928 })
  })

  test('_sanitiseForCache canonicalises flat-number person to { id }', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    // tests/fixtures/tahvel/api/user.json captured this shape from real Tahvel:
    // person is a flat number, not an object. Sanitiser must turn it into
    // { id: <number> } so consumers' `userInfo.person?.id` reads work.
    const data = { user: 331113, person: 227928, teacher: 22816, school: { id: 9 }, roleCode: 'ROLL_O' }
    const sanitised = ApiService._sanitiseForCache('https://tahvel.edu.ee/hois_back/user', data)
    expect(sanitised.person).toEqual({ id: 227928 })
  })

  test('_sanitiseForCache /user allowlist matches trailing-slash form too', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    const data = { name: '30000000001', school: { id: 9 } }
    const sanitised = ApiService._sanitiseForCache('https://tahvel.edu.ee/hois_back/user/', data)
    expect(sanitised.name).toBeUndefined()
    expect(sanitised.school).toEqual({ id: 9 })
  })

  test('_isHighPiiEndpoint allows grade entries to persist (no names/idcodes in payload)', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/journals/123/journalEntriesByDate?from=2024-01-01')).toBe(false)
  })

  test('_isHighPiiEndpoint does not match journal info or timetable', async () => {
    const { ApiService } = await import('../../src/services/ApiService.js')
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/journals/123')).toBe(false)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/journals?onlyMyJournals=true')).toBe(false)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/timetableEvents/foo')).toBe(false)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/user')).toBe(false)
  })
})

const VERSION_FLAG = 'OA_lastSeenExtensionVersion'

function setManifestVersion(version) {
  global.chrome.runtime.getManifest = mock(() => ({ version }))
}

describe('wipeOnVersionChange', () => {
  beforeEach(async () => {
    restoreChromeMock()
    if (global.caches._clear) global.caches._clear()
    cryptoService._reset()
    await cacheService.clearCache()
  })

  test('first install (no stored version): writes current version, no log', async () => {
    setManifestVersion('1.6.2')
    await _wipeOnVersionChangeForTests()
    const stored = global.chrome.storage.local._store[VERSION_FLAG]
    expect(stored).toBe('1.6.2')
  })

  test('first-install path with legacy OA_cache_* entries falls through to wipe', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store['OA_cache_legacy_a'] = 'old'
    global.chrome.storage.local._store['OA_cache_legacy_b'] = 'old'
    // VERSION_FLAG not set — simulates upgrading from a build before this feature shipped.

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store['OA_cache_legacy_a']).toBeUndefined()
    expect(global.chrome.storage.local._store['OA_cache_legacy_b']).toBeUndefined()
    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.7.0')
  })

  test('stored version matches current: no-op, version flag unchanged', async () => {
    setManifestVersion('1.6.2')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    await cacheService.set('keep-me', { v: 1 })
    expect(await cacheService.get('keep-me')).toEqual({ v: 1 })

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.6.2')
    expect(await cacheService.get('keep-me')).toEqual({ v: 1 })
  })

  test('stored version differs: wipes Cache API and persists new version', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    await cacheService.set('stale', { v: 1 })
    expect(await cacheService.get('stale')).toEqual({ v: 1 })

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.7.0')
    // Stored entry's still in memory cache (memory is per-context, not wiped
    // by the version-change wipe). The Cache API entry is gone — verify by
    // clearing memory and re-getting.
    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(0)
  })

  test('stored version differs: sweeps legacy OA_cache_* chrome.storage entries', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    global.chrome.storage.local._store['OA_cache_legacy_a'] = 'old-data'
    global.chrome.storage.local._store['OA_cache_legacy_b'] = 'old-data'
    global.chrome.storage.local._store['OA_kriitApiToken'] = 'should-survive'

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store['OA_cache_legacy_a']).toBeUndefined()
    expect(global.chrome.storage.local._store['OA_cache_legacy_b']).toBeUndefined()
    expect(global.chrome.storage.local._store['OA_kriitApiToken']).toBe('should-survive')
  })

  test('caches.delete failure: version flag NOT written so wipe is retried next load', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    const originalDelete = global.caches.delete
    global.caches.delete = mock(async () => { throw new Error('quota error') })

    try {
      await _wipeOnVersionChangeForTests()
    } finally {
      global.caches.delete = originalDelete
    }

    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.6.2')
  })

  test('no manifest available: no-op (test/dev environments)', async () => {
    global.chrome.runtime.getManifest = mock(() => ({}))
    await _wipeOnVersionChangeForTests()
    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBeUndefined()
  })
})
