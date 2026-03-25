import { describe, test, expect, beforeEach, mock } from 'bun:test'
import '../mocks/chrome.js'
import { getSchoolId } from '../../src/lib/schoolId.js'

describe('getSchoolId', () => {
  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {},
      trace: () => {}
    }
  })

  test('should return school ID from journal info when present', async () => {
    const api = { tahvel: { get: mock() } }
    const info = { school: { id: 15 } }

    const result = await getSchoolId(api, info)

    expect(result).toBe(15)
    expect(api.tahvel.get).not.toHaveBeenCalled()
  })

  test('should fall back to /user endpoint when info has no school', async () => {
    const api = {
      tahvel: {
        get: mock(async () => ({ school: { id: 42 } }))
      }
    }
    const info = { school: null }

    const result = await getSchoolId(api, info)

    expect(result).toBe(42)
    expect(api.tahvel.get).toHaveBeenCalledWith('/user', {}, { cache: true, cacheExpiration: 864e5 })
  })

  test('should fall back to /user endpoint when info is null', async () => {
    const api = {
      tahvel: {
        get: mock(async () => ({ school: { id: 7 } }))
      }
    }

    const result = await getSchoolId(api, null)

    expect(result).toBe(7)
  })

  test('should fall back to /user endpoint when info is undefined', async () => {
    const api = {
      tahvel: {
        get: mock(async () => ({ school: { id: 7 } }))
      }
    }

    const result = await getSchoolId(api, undefined)

    expect(result).toBe(7)
  })

  test('should return null when /user endpoint also has no school', async () => {
    const api = {
      tahvel: {
        get: mock(async () => ({ person: { id: 1 } }))
      }
    }
    const info = {}

    const result = await getSchoolId(api, info)

    expect(result).toBeNull()
  })

  test('should return null and warn when /user endpoint throws', async () => {
    const api = {
      tahvel: {
        get: mock(async () => { throw new Error('Network error') })
      }
    }
    const info = {}

    const result = await getSchoolId(api, info)

    expect(result).toBeNull()
  })
})
