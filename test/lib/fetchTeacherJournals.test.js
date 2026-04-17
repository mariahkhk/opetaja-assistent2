import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { fetchTeacherJournals } from '../../src/lib/fetchTeacherJournals.js'
import { cacheService } from '../../src/services/CacheService.js'

describe('fetchTeacherJournals', () => {
  let mockApi

  beforeEach(async () => {
    // Reset window and chrome globals for Logger
    global.window = { location: { hostname: 'tahvel.edu.ee', protocol: 'https:' } }
    global.chrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get: mock((keys, cb) => cb({})),
          remove: mock((keys, cb) => { if (cb) cb() }),
          set: mock((items, cb) => { if (cb) cb() })
        }
      }
    }

    // Clear cacheService memory cache
    await cacheService.clearCache()

    mockApi = {
      tahvel: {
        get: mock(async () => ({ content: [], totalPages: 1 })),
        baseUrl: 'https://tahvel.edu.ee/hois_back'
      }
    }
  })

  it('should fetch single page of journals', async () => {
    const journals = [{ id: 1, nameEt: 'Journal 1' }, { id: 2, nameEt: 'Journal 2' }]
    mockApi.tahvel.get = mock(async () => ({
      content: journals,
      totalPages: 1
    }))

    const result = await fetchTeacherJournals(mockApi)

    expect(result).toEqual(journals)
    expect(mockApi.tahvel.get).toHaveBeenCalledTimes(1)
  })

  it('should paginate through multiple pages', async () => {
    const page0 = [{ id: 1 }, { id: 2 }]
    const page1 = [{ id: 3 }]

    let callCount = 0
    mockApi.tahvel.get = mock(async () => {
      callCount++
      if (callCount === 1) return { content: page0, totalPages: 2 }
      return { content: page1, totalPages: 2 }
    })

    const result = await fetchTeacherJournals(mockApi, { size: 2 })

    expect(result).toEqual([...page0, ...page1])
    expect(mockApi.tahvel.get).toHaveBeenCalledTimes(2)
  })

  it('should stop when fewer items than page size returned', async () => {
    mockApi.tahvel.get = mock(async () => ({
      content: [{ id: 1 }]
      // No totalPages - server didn't provide it
    }))

    const result = await fetchTeacherJournals(mockApi, { size: 50 })

    expect(result).toEqual([{ id: 1 }])
    expect(mockApi.tahvel.get).toHaveBeenCalledTimes(1)
  })

  it('should pass studyYearId when provided', async () => {
    mockApi.tahvel.get = mock(async () => ({ content: [], totalPages: 1 }))

    await fetchTeacherJournals(mockApi, { studyYearId: 42 })

    const call = mockApi.tahvel.get.mock.calls[0]
    expect(call[1].studyYear).toBe(42)
    expect(call[1].onlyMyJournals).toBe(true)
  })

  it('should use custom cacheExpiration', async () => {
    mockApi.tahvel.get = mock(async () => ({ content: [], totalPages: 1 }))

    await fetchTeacherJournals(mockApi, { cacheExpiration: 60000 })

    const call = mockApi.tahvel.get.mock.calls[0]
    expect(call[2].cacheExpiration).toBe(60000)
  })

  it('should handle null response gracefully', async () => {
    mockApi.tahvel.get = mock(async () => null)

    const result = await fetchTeacherJournals(mockApi)

    expect(result).toEqual([])
  })

  it('should handle array response (non-paged)', async () => {
    const journals = [{ id: 1 }, { id: 2 }]
    mockApi.tahvel.get = mock(async () => journals)

    const result = await fetchTeacherJournals(mockApi)

    expect(result).toEqual(journals)
  })

  it('should calculate totalPages from totalElements', async () => {
    let callCount = 0
    mockApi.tahvel.get = mock(async () => {
      callCount++
      if (callCount === 1) return { content: [{ id: 1 }, { id: 2 }], totalElements: 3 }
      return { content: [{ id: 3 }], totalElements: 3 }
    })

    const result = await fetchTeacherJournals(mockApi, { size: 2 })

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(mockApi.tahvel.get).toHaveBeenCalledTimes(2)
  })
})
