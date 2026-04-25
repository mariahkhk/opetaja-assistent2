import { describe, test, expect, beforeEach } from 'bun:test'
import { cacheService } from '../../src/services/CacheService.js'
import { cryptoService } from '../../src/services/CryptoService.js'
import { restoreChromeMock } from '../setup.js'

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
