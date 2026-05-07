import { describe, test, expect, beforeEach } from 'bun:test'
import { cacheService } from '../../src/services/CacheService.js'
import { cryptoService } from '../../src/services/CryptoService.js'
import { restoreChromeMock } from '../setup.js'

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
