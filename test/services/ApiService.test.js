import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { ApiService } from '../../src/services/ApiService.js'
import { cacheService } from '../../src/services/CacheService.js'
import Logger, { EXPECTED_ERROR_PATTERN, EXPECTED_NATIVE_FETCH_ERROR_PATTERN, error as loggerErrorFn } from '../../src/services/Logger.js'
import { sentryService } from '../../src/services/SentryService.js'
import { parseJsonResponse } from '../../src/lib/parseJsonResponse.js'

describe('ApiService', () => {
  let apiService
  let fetchMock

  beforeEach(async () => {
    // Setup DOM (needed by Tahvel PUT requests that read document.cookie)
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://tahvel.edu.ee/' })
    global.window = dom.window
    global.document = dom.window.document

    ApiService.pendingRequests = {}
    ApiService.activeRequests = 0
    ApiService.requestQueue = []
    ApiService.concurrencyLimit = 10
    ApiService.delayBetweenRequestsMs = 0
    ApiService.capturedRequests = []

    await cacheService.clearCache()

    apiService = new ApiService({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      defaultHeaders: { 'X-Custom': 'test' },
      authToken: 'test-token-123'
    })

    fetchMock = mock(async (url, options) => {
      const body = { data: 'success', url, method: options.method }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body)
      }
    })

    global.fetch = fetchMock

    // Mock chrome.storage for CacheService (callback-based)
    global.chrome = {
      storage: {
        local: {
          get: mock((keys, callback) => {
            // Return empty cache (no cached items)
            callback({})
          }),
          set: mock((items, callback) => {
            if (callback) callback()
          })
        }
      },
      runtime: {
        sendMessage: mock((message, callback) => {
          callback({ status: 'success', data: {} })
        })
      }
    }
  })

  afterEach(() => {
    global.fetch = undefined
    global.chrome = undefined
    global.document = undefined
    global.window = undefined
  })

  describe('Constructor', () => {
    test('should initialize with default config', () => {
      const api = new ApiService()
      expect(api.name).toBe('api')
      expect(api.baseUrl).toBe('')
      expect(api.defaultHeaders).toEqual({})
      expect(api.authToken).toBe('')
    })

    test('should initialize with custom config', () => {
      expect(apiService.name).toBe('test-api')
      expect(apiService.baseUrl).toBe('https://api.example.com')
      expect(apiService.defaultHeaders).toEqual({ 'X-Custom': 'test' })
      expect(apiService.authToken).toBe('test-token-123')
    })
  })

  describe('Configuration methods', () => {
    test('should set base URL', () => {
      apiService.setBaseUrl('https://newapi.com')
      expect(apiService.baseUrl).toBe('https://newapi.com')
    })

    test('should set auth token', () => {
      apiService.setAuthToken('new-token')
      expect(apiService.authToken).toBe('new-token')
    })

    test('should get auth headers when token is set', () => {
      const headers = apiService.getAuthHeaders()
      expect(headers).toEqual({ Authorization: 'Bearer test-token-123' })
    })

    test('should return empty object when no token', () => {
      apiService.authToken = ''
      const headers = apiService.getAuthHeaders()
      expect(headers).toEqual({})
    })

    test('should set concurrency limit', () => {
      ApiService.setConcurrencyLimit(5, 100)
      expect(ApiService.concurrencyLimit).toBe(5)
      expect(ApiService.delayBetweenRequestsMs).toBe(100)
    })

    test('should enforce minimum concurrency limit of 1', () => {
      ApiService.setConcurrencyLimit(0)
      expect(ApiService.concurrencyLimit).toBe(1)
    })
  })

  describe('GET requests', () => {
    test('should make successful GET request', async () => {
      const result = await apiService.get('/users')

      expect(fetchMock).toHaveBeenCalled()
      expect(result).toEqual({ data: 'success', url: 'https://api.example.com/users', method: 'GET' })
    })

    test('should include query parameters', async () => {
      await apiService.get('/users', { page: 1, limit: 10 })

      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[0]).toContain('page=1')
      expect(callArgs[0]).toContain('limit=10')
    })

    test('should include auth headers', async () => {
      await apiService.get('/protected')

      const callArgs = fetchMock.mock.calls[0]
      const headers = callArgs[1].headers
      expect(headers.Authorization).toBe('Bearer test-token-123')
    })

    test('should include custom headers', async () => {
      await apiService.get('/users', {}, { cache: false })

      const callArgs = fetchMock.mock.calls[0]
      const headers = callArgs[1].headers
      expect(headers['X-Custom']).toBe('test')
    })

    test('should handle absolute URLs', async () => {
      await apiService.get('https://other-api.com/data')

      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[0]).toBe('https://other-api.com/data')
    })

    test('should deduplicate identical in-flight GET requests', async () => {
      const promise1 = apiService.get('/users', {}, { cache: false })
      const promise2 = apiService.get('/users', {}, { cache: false })

      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result1).toEqual(result2)
    })

    test('should not double-consume body when deduping in-flight GET requests', async () => {
      let textCalls = 0
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => {
          textCalls++
          if (textCalls > 1) throw new TypeError("Failed to execute 'text' on 'Response': body stream already read")
          return JSON.stringify({ id: 1 })
        }
      }))

      const [r1, r2] = await Promise.all([
        apiService.get('/users', {}, { cache: false }),
        apiService.get('/users', {}, { cache: false })
      ])

      expect(textCalls).toBe(1)
      expect(r1).toEqual(r2)
      expect(r1).toEqual({ id: 1 })
      expect(r2).toEqual({ id: 1 })
    })

    test('should propagate the same API error to both joiners on non-OK responses', async () => {
      let textCalls = 0
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => {
          textCalls++
          if (textCalls > 1) throw new TypeError("Failed to execute 'text' on 'Response': body stream already read")
          return ''
        }
      }))

      const results = await Promise.allSettled([
        apiService.get('/users', {}, { cache: false }),
        apiService.get('/users', {}, { cache: false })
      ])

      expect(textCalls).toBe(1)
      expect(results[0].status).toBe('rejected')
      expect(results[1].status).toBe('rejected')
      expect(results[0].reason).toMatchObject({ status: 500 })
      expect(results[1].reason).toMatchObject({ status: 500 })
    })

    test('should not deduplicate different GET requests', async () => {
      const promise1 = apiService.get('/users', {}, { cache: false })
      const promise2 = apiService.get('/posts', {}, { cache: false })

      await Promise.all([promise1, promise2])

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('should cache 404 and re-throw as error', async () => {
      let fetchCount = 0
      global.fetch = mock(async () => {
        fetchCount++
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Resource not found'
        }
      })

      // First call: throws
      await expect(apiService.get('/missing')).rejects.toThrow('API Error: 404')

      // Second call: should throw from cache without fetching again
      await expect(apiService.get('/missing')).rejects.toThrow('API Error: 404')
      expect(fetchCount).toBe(1) // Only one network request
    })

    test('should throw for non-404/412 error responses', async () => {
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      }))

      try {
        await apiService.get('/error', {}, { cache: false })
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error.status || error.message).toBeTruthy()
      }
    })

    test('should suppress logging for configured GET error statuses', async () => {
      const originalError = Logger.error
      const loggerError = mock(() => {})
      Logger.error = loggerError
      global.fetch = mock(async () => ({
        ok: false,
        status: 412,
        statusText: 'Precondition Failed',
        text: async () => ''
      }))

      try {
        await apiService.get('/precondition', {}, { cache: false, suppressErrorStatuses: [412] })
        expect(true).toBe(false)
      } catch (error) {
        expect(error.status).toBe(412)
        expect(loggerError).not.toHaveBeenCalled()
      } finally {
        Logger.error = originalError
      }
    })

    test('should handle JSON error responses for POST', async () => {
      global.fetch = mock(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ error: 'Invalid request' })
      }))

      await expect(apiService.post('/invalid', {})).rejects.toThrow('API Error: 400')
    })

    test('should handle Tahvel-specific error format for POST', async () => {
      global.fetch = mock(async () => ({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () =>
          JSON.stringify({
            _errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid data' }]
          })
      }))

      await expect(apiService.post('/validate', {})).rejects.toThrow('VALIDATION_ERROR')
    })
  })

  describe('POST requests', () => {
    test('should make successful POST request', async () => {
      const data = { name: 'John', email: 'john@example.com' }
      const result = await apiService.post('/users', data)

      expect(fetchMock).toHaveBeenCalled()
      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[1].method).toBe('POST')
      expect(callArgs[1].body).toBe(JSON.stringify(data))
    })

    test('should include content-type header', async () => {
      await apiService.post('/users', { name: 'John' })

      const callArgs = fetchMock.mock.calls[0]
      const headers = callArgs[1].headers
      expect(headers['Content-Type']).toBe('application/json;charset=UTF-8')
    })

    test('should not cache POST requests', async () => {
      await apiService.post('/users', { name: 'John' })
      await apiService.post('/users', { name: 'John' })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('should return success sentinel forwarding HTTP status for POST with empty body', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 202,
        statusText: 'Accepted',
        text: async () => ''
      }))

      const result = await apiService.post('/ack', { id: 1 })
      expect(result).toEqual({ success: true, status: 202 })
    })

    test('should treat whitespace-only POST body as empty and return sentinel', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '\r\n'
      }))

      const result = await apiService.post('/ack-ws', {})
      expect(result).toEqual({ success: true, status: 200 })
    })

    // Audit: Grep of `this.api.\(tahvel\|kriit\)\.\(post\|put\)` across src/ confirms every
    // live caller either discards the returned value or reads it as an object (.success / .id /
    // destructure). None treat the response as a plaintext string. Locking in the throw
    // contract here prevents accidental reintroduction of the silent-HTML-fallback bug.
    test('should throw for POST that returns non-empty non-JSON body', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<html>session-expired</html>'
      }))

      await expect(apiService.post('/some-endpoint', {})).rejects.toThrow('API Error: invalid JSON response')
    })
  })

  describe('PUT requests', () => {
    test('should make successful PUT request', async () => {
      const data = { name: 'Updated Name' }
      const result = await apiService.put('/users/1', data)

      expect(fetchMock).toHaveBeenCalled()
      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[1].method).toBe('PUT')
      expect(callArgs[1].body).toBe(JSON.stringify(data))
    })

    test('should handle empty PUT response', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => ''
      }))

      const result = await apiService.put('/users/1', { name: 'Test' })
      expect(result).toEqual({ success: true, status: 204 })
    })

    test('should handle Tahvel PUT request with XSRF token', async () => {
      const tahvelApi = new ApiService({
        name: 'tahvel',
        baseUrl: 'https://tahvel.edu.ee'
      })

      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'XSRF-TOKEN=test-csrf-token'
      })

      await tahvelApi.put('/journals/123/journalEntry/456', { grade: 5 })

      const callArgs = fetchMock.mock.calls[0]
      const headers = callArgs[1].headers
      expect(headers['X-XSRF-TOKEN']).toBe('test-csrf-token')
      expect(headers['X-Requested-With']).toBe('XMLHttpRequest')
    })

    test('should handle PUT error', async () => {
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      }))

      await expect(apiService.put('/users/1', {})).rejects.toThrow('API Error: 500')
    })
  })

  describe('Request throttling', () => {
    test('should respect concurrency limit', async () => {
      ApiService.setConcurrencyLimit(2)

      let activeCount = 0
      let maxActiveCount = 0

      global.fetch = mock(async () => {
        activeCount++
        maxActiveCount = Math.max(maxActiveCount, activeCount)

        await new Promise(resolve => setTimeout(resolve, 10))

        activeCount--
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => JSON.stringify({ success: true })
        }
      })

      const requests = []
      for (let i = 0; i < 5; i++) {
        requests.push(apiService.get(`/endpoint${i}`))
      }

      await Promise.all(requests)

      expect(maxActiveCount).toBeLessThanOrEqual(2)
    })

    test('should queue requests when limit exceeded', async () => {
      ApiService.setConcurrencyLimit(1)

      const order = []
      global.fetch = mock(async url => {
        order.push(url)
        await new Promise(resolve => setTimeout(resolve, 5))
        return {
          ok: true,
          status: 200,
          json: async () => ({ url }),
          text: async () => JSON.stringify({ url })
        }
      })

      const req1 = apiService.get('/first')
      const req2 = apiService.get('/second')
      const req3 = apiService.get('/third')

      await Promise.all([req1, req2, req3])

      expect(order).toHaveLength(3)
      expect(order[0]).toContain('first')
    })
  })

  describe('Tahvel-specific features', () => {
    let tahvelApi

    beforeEach(() => {
      tahvelApi = new ApiService({
        name: 'tahvel',
        baseUrl: 'https://tahvel.edu.ee/api'
      })
    })

    test('should include credentials for Tahvel requests', async () => {
      await tahvelApi.get('/journals')

      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[1].credentials).toBe('include')
    })

    test('should add Origin and Referer for Tahvel PUT requests', async () => {
      await tahvelApi.put('/journals/123/journalEntry/456', { grade: 5 })

      const callArgs = fetchMock.mock.calls[0]
      const headers = callArgs[1].headers
      expect(headers.Origin).toBe(window.location.origin)
      expect(headers.Referer).toBe(window.location.origin + '/')
    })
  })

  describe('Kriit-specific features', () => {
    let kriitApi

    beforeEach(() => {
      kriitApi = new ApiService({
        name: 'kriit',
        baseUrl: 'https://kriit.eu/api'
      })
    })

    test('should use background script for localhost requests', async () => {
      const sendMessageMock = mock((message, callback) => {
        // Simulate successful background script response
        callback({ status: 'success', data: { result: 'ok' } })
      })

      global.chrome.runtime.sendMessage = sendMessageMock

      const result = await kriitApi.get('http://localhost:3000/data')

      expect(sendMessageMock).toHaveBeenCalled()
      expect(result).toEqual({ result: 'ok' })
    })

    test('should handle background script errors', async () => {
      global.chrome.runtime.sendMessage = mock((message, callback) => {
        callback({ status: 'error', message: 'Connection failed' })
      })

      await expect(kriitApi.get('http://localhost:3000/data')).rejects.toThrow('Connection failed')
    })
  })

  describe('Cache handling', () => {
    test('should cache GET requests by default', async () => {
      await apiService.get('/cached-endpoint')
      await apiService.get('/cached-endpoint')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('should not cache when cache option is false', async () => {
      await apiService.get('/uncached', {}, { cache: false })
      await apiService.get('/uncached', {}, { cache: false })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('should force refresh when forceRefresh is true', async () => {
      await apiService.get('/endpoint')
      await apiService.get('/endpoint', {}, { forceRefresh: true })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    test('should use longer cache for journalEntriesByDate', async () => {
      await apiService.get('/journals/123/journalEntriesByDate?allStudents=true')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('should throw for cached GET with empty body and not poison cache', async () => {
      const emptyFetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => ''
      }))
      global.fetch = emptyFetch

      await expect(apiService.get('/empty-cached')).rejects.toThrow('API Error: empty response')
      await expect(apiService.get('/empty-cached')).rejects.toThrow('API Error: empty response')
      expect(emptyFetch).toHaveBeenCalledTimes(2)
    })

    test('should throw for cached GET with non-JSON body and not poison cache', async () => {
      const htmlFetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '<html>Login page</html>'
      }))
      global.fetch = htmlFetch

      await expect(apiService.get('/html-cached')).rejects.toThrow('API Error: invalid JSON response')
      await expect(apiService.get('/html-cached')).rejects.toThrow('API Error: invalid JSON response')
      expect(htmlFetch).toHaveBeenCalledTimes(2)
    })

    test('should reject both concurrent callers when body is empty and fetch only once', async () => {
      const concurrentFetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => ''
      }))
      global.fetch = concurrentFetch

      const results = await Promise.allSettled([
        apiService.get('/concurrent-empty'),
        apiService.get('/concurrent-empty')
      ])

      expect(results.every(r => r.status === 'rejected')).toBe(true)
      expect(results[0].reason.message).toMatch(/API Error: empty response/)
      expect(results[1].reason.message).toMatch(/API Error: empty response/)
      expect(concurrentFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error handling', () => {
    test('should handle network errors', async () => {
      global.fetch = mock(async () => {
        throw new Error('Network error')
      })

      await expect(apiService.get('/endpoint', {}, { cache: false })).rejects.toThrow('Network error')
    })

    test('should throw for uncached GET with non-JSON body', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        text: async () => 'Plain text response'
      }))

      await expect(apiService.get('/text-endpoint', {}, { cache: false })).rejects.toThrow('API Error: invalid JSON response')
    })

    test('should throw for uncached GET with empty body', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        text: async () => ''
      }))

      await expect(apiService.get('/empty', {}, { cache: false })).rejects.toThrow('API Error: empty response')
    })

    test('should throw for uncached GET with whitespace-only body', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        text: async () => ' '
      }))

      await expect(apiService.get('/ws', {}, { cache: false })).rejects.toThrow('API Error: empty response')
    })

    test('uncached /user GET applies allowlist sanitiser', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      const userResponse = {
        name: '30000000001',
        person: { id: 227928, idcode: '40000000002' },
        school: { id: 9 },
        roleCode: 'ROLL_O',
        email: 'should-not-leak@example.test'
      }
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(userResponse)
      }))

      const result = await apiService.get('/user', {}, { cache: false })
      expect(result.name).toBeUndefined()
      expect(result.email).toBeUndefined()
      expect(result.school).toEqual({ id: 9 })
      expect(result.person).toEqual({ id: 227928 })
      expect(result.roleCode).toBe('ROLL_O')
      expect(JSON.stringify(result)).not.toContain('30000000001')
      expect(JSON.stringify(result)).not.toContain('40000000002')
    })

    test('thrown apiError.message redacts PII for high-PII endpoints (POST path)', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      const errorBody = { _errors: [{ message: 'Test PersonD 30000000001 not found' }] }
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => JSON.stringify(errorBody)
      }))

      let thrown = null
      try {
        await apiService.post('/students/789', { x: 1 })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeTruthy()
      expect(thrown.message).toContain('[REDACTED-PII]')
      expect(thrown.message).not.toContain('PersonD')
      expect(thrown.message).not.toContain('30000000001')
    })

    test('thrown apiError.message keeps details for non-PII endpoints (POST path)', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      const errorBody = { _errors: [{ message: 'Server problem' }] }
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => JSON.stringify(errorBody)
      }))

      let thrown = null
      try {
        await apiService.post('/journals?onlyMyJournals=true', { x: 1 })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeTruthy()
      expect(thrown.message).toContain('Server problem')
      expect(thrown.message).not.toContain('[REDACTED-PII]')
    })

    test('Sentry-bound safeError carries method/path/status/type for non-PII GET errors', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      global.fetch = mock(async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'gateway down'
      }))

      const originalError = Logger.error
      const loggerError = mock(() => {})
      Logger.error = loggerError
      try {
        await expect(apiService.get('/journals/onlyMyJournals', {}, { cache: false })).rejects.toThrow()
        expect(loggerError).toHaveBeenCalled()
        const safeError = loggerError.mock.calls[0][1]
        expect(safeError).toBeInstanceOf(Error)
        expect(safeError.message).toContain('GET')
        expect(safeError.message).toContain('/hois_back/journals/onlyMyJournals')
        expect(safeError.message).toContain('status=503')
        expect(safeError.message).toContain('type=Error')
        expect(safeError.message).toContain('message=API Error: 503')
        expect(safeError.message).not.toContain('[REDACTED-PII]')
      } finally {
        Logger.error = originalError
      }
    })

    test('Sentry-bound safeError preserves original stack frame for non-PII errors', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      global.fetch = mock(async () => {
        const err = new TypeError('Failed to fetch')
        err.stack = 'TypeError: Failed to fetch\n    at fetch (mock:1:1)'
        throw err
      })

      const originalError = Logger.error
      const loggerError = mock(() => {})
      Logger.error = loggerError
      try {
        await expect(apiService.get('/journals/onlyMyJournals', {}, { cache: false })).rejects.toThrow()
        const safeError = loggerError.mock.calls[0][1]
        expect(safeError.stack).toBe('TypeError: Failed to fetch\n    at fetch (mock:1:1)')
        expect(safeError.message).toContain('type=TypeError')
        expect(safeError.message).toContain('message=Failed to fetch')
      } finally {
        Logger.error = originalError
      }
    })

    test('Sentry-bound safeError preserves original error as cause for EXPECTED_ERROR_PATTERN matching', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      global.fetch = mock(async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Forbidden'
      }))

      const originalError = Logger.error
      const loggerError = mock(() => {})
      Logger.error = loggerError
      try {
        await expect(apiService.get('/journals/onlyMyJournals', {}, { cache: false })).rejects.toThrow()
        const safeError = loggerError.mock.calls[0][1]
        // The wrapper's own message no longer starts with "API Error:" (it's
        // the enriched diagnostic form), but the original error must be
        // attached as `cause` so Logger.error's expected-error suppression
        // can re-test it.
        expect(safeError.cause).toBeInstanceOf(Error)
        expect(safeError.cause.message).toMatch(/^API Error: 403\b/)
      } finally {
        Logger.error = originalError
      }
    })

    test('Sentry-bound safeError redacts PII endpoints with diagnostic metadata only', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      global.fetch = mock(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => JSON.stringify({ _errors: [{ message: 'PersonD 30000000001 leak' }] })
      }))

      const originalError = Logger.error
      const loggerError = mock(() => {})
      Logger.error = loggerError
      try {
        await expect(apiService.post('/students/789', { x: 1 })).rejects.toThrow()
        const safeError = loggerError.mock.calls.at(-1)[1]
        expect(safeError.message).toContain('[REDACTED-PII Error on POST /hois_back/students/<id>]')
        expect(safeError.message).toContain('status=500')
        expect(safeError.message).not.toContain('30000000001')
        expect(safeError.message).not.toContain('PersonD')
        // Regression guard: an apiError carrying response-body PII must NEVER
        // surface its message verbatim, only the generic redaction.
        expect(safeError.message).not.toContain('message=')
      } finally {
        Logger.error = originalError
      }
    })

    test('Sentry-bound safeError on PII endpoint surfaces native fetch failure messages', async () => {
      apiService.setBaseUrl('https://tahvel.edu.ee/hois_back')
      global.fetch = mock(async () => {
        const err = new TypeError('Failed to fetch')
        err.stack = 'TypeError: Failed to fetch\n    at fetch (mock:1:1)'
        throw err
      })

      const originalError = Logger.error
      const loggerError = mock(() => {})
      Logger.error = loggerError
      try {
        await expect(apiService.get('/journals/123/journalStudents', {}, { cache: false })).rejects.toThrow()
        const safeError = loggerError.mock.calls.at(-1)[1]
        expect(safeError.message).toContain('[REDACTED-PII Error on GET /hois_back/journals/<id>/journalStudents]')
        expect(safeError.message).toContain('type=TypeError')
        expect(safeError.message).toContain('message=Failed to fetch')
        expect(safeError.stack).toBe('TypeError: Failed to fetch\n    at fetch (mock:1:1)')
        expect(safeError.cause).toBeInstanceOf(TypeError)
      } finally {
        Logger.error = originalError
      }
    })
  })

  describe('Logger.error native-fetch suppression', () => {
    let captureException
    let captureMessage
    let originalCaptureException
    let originalCaptureMessage

    beforeEach(() => {
      originalCaptureException = sentryService.captureException
      originalCaptureMessage = sentryService.captureMessage
      captureException = mock(() => {})
      captureMessage = mock(() => {})
      sentryService.captureException = captureException
      sentryService.captureMessage = captureMessage
    })

    afterEach(() => {
      sentryService.captureException = originalCaptureException
      sentryService.captureMessage = originalCaptureMessage
    })

    test('does NOT forward native fetch TypeError directly to Sentry', () => {
      loggerErrorFn('[tahvel] GET Error:', new TypeError('Failed to fetch'))
      expect(captureException).not.toHaveBeenCalled()
      expect(captureMessage).not.toHaveBeenCalled()
    })

    test('does NOT forward when native fetch failure is wrapped via .cause', () => {
      const cause = new TypeError('Failed to fetch')
      const wrapper = new Error('[REDACTED-PII Error on GET /hois_back/journals/<id>/journalStudents] type=TypeError message=Failed to fetch')
      wrapper.cause = cause
      loggerErrorFn('[tahvel] GET Error:', wrapper)
      expect(captureException).not.toHaveBeenCalled()
      expect(captureMessage).not.toHaveBeenCalled()
    })

    test('still forwards a non-allowlisted TypeError to Sentry', () => {
      loggerErrorFn('boom', new TypeError('Cannot read properties of undefined (reading \'foo\')'))
      expect(captureException).toHaveBeenCalledTimes(1)
    })

    test('does NOT forward each cross-browser native fetch string when matched directly', () => {
      // Sanity: the suppression must NOT be tied to one specific string.
      for (const msg of [
        'Failed to fetch',
        'Load failed',
        'NetworkError when attempting to fetch resource',
        'Network request failed'
      ]) {
        captureException.mockClear()
        loggerErrorFn('x', new TypeError(msg))
        expect(captureException).not.toHaveBeenCalled()
      }
    })
  })

  describe('parseJsonResponse', () => {
    test('throws empty-response error for empty string', () => {
      expect(() => parseJsonResponse('', 'https://x.example/path')).toThrow('API Error: empty response from https://x.example/path')
    })

    test('throws empty-response error for whitespace-only text', () => {
      expect(() => parseJsonResponse('\r\n \t', 'https://x.example/path')).toThrow('API Error: empty response')
    })

    test('returns parsed value for valid JSON', () => {
      expect(parseJsonResponse('{"a":1}', 'https://x.example/path')).toEqual({ a: 1 })
      expect(parseJsonResponse('null', 'https://x.example/path')).toBe(null)
      expect(parseJsonResponse('true', 'https://x.example/path')).toBe(true)
    })

    test('throws invalid-JSON error with cause for unparseable text', () => {
      let thrown
      try { parseJsonResponse('<html>not json</html>', 'https://x.example/path?token=secret') }
      catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown.message).toMatch(/^API Error: invalid JSON response from https:\/\/x\.example\/path:/)
      expect(thrown.message).not.toContain('token=secret')
      expect(thrown.cause).toBeInstanceOf(SyntaxError)
    })

    test('throws with typed message when urlString is not a string', () => {
      expect(() => parseJsonResponse('{}', null)).toThrow('non-string url (object)')
      expect(() => parseJsonResponse('{}', undefined)).toThrow('non-string url (undefined)')
      expect(() => parseJsonResponse('{}', 42)).toThrow('non-string url (number)')
    })

    test('throws with typed message when text is not a string', () => {
      expect(() => parseJsonResponse(null, '/foo')).toThrow('non-string text (object)')
      expect(() => parseJsonResponse(undefined, '/foo')).toThrow('non-string text (undefined)')
      expect(() => parseJsonResponse(42, '/foo')).toThrow('non-string text (number)')
    })

    test('strips #fragment from url in error messages', () => {
      let thrown
      try { parseJsonResponse('', 'https://x.example/path#secret') }
      catch (e) { thrown = e }
      expect(thrown.message).toBe('API Error: empty response from https://x.example/path')
    })
  })

  describe('DELETE requests via request()', () => {
    test('should return success sentinel for DELETE with empty 200 body', async () => {
      global.fetch = mock(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => ''
      }))

      const result = await apiService.request({
        baseUrl: 'https://api.example.com',
        endpoint: '/resource/1',
        method: 'DELETE'
      })
      expect(result).toEqual({ success: true, status: 200 })
    })
  })

  describe('Integration scenarios', () => {
    test('should handle multiple concurrent requests with different endpoints', async () => {
      const requests = [
        apiService.get('/users', {}, { cache: false }),
        apiService.get('/posts', {}, { cache: false }),
        apiService.get('/comments', {}, { cache: false }),
        apiService.post('/users', { name: 'Test' }),
        apiService.put('/users/1', { name: 'Updated' })
      ]

      const results = await Promise.all(requests)

      expect(results).toHaveLength(5)
      expect(fetchMock).toHaveBeenCalledTimes(5)
    })

    test('should handle mixed success and error responses', async () => {
      let callCount = 0
      global.fetch = mock(async () => {
        callCount++
        if (callCount === 2) {
          return {
            ok: false,
            status: 500,
            text: async () => 'Error'
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => JSON.stringify({ success: true })
        }
      })

      const results = await Promise.allSettled([
        apiService.get('/endpoint1', {}, { cache: false }),
        apiService.get('/endpoint2', {}, { cache: false }),
        apiService.get('/endpoint3', {}, { cache: false })
      ])

      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('rejected')
      expect(results[2].status).toBe('fulfilled')
    })
  })
})

describe('Logger EXPECTED_ERROR_PATTERN', () => {
  test('matches HTTP status errors and Tahvel-host hois_back parse errors', () => {
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 401 Unauthorized')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 403 Forbidden')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 404 Not Found')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 412 Precondition Failed')).toBe(true)
    // CacheService re-throw format: just "API Error: <status>" with no trailing text
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 404')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 412')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: empty response from https://tahvel.edu.ee/hois_back/user')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: empty response from https://test.tahvel.eenet.ee/hois_back/user')).toBe(true)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: invalid JSON response from https://test.tahvel.eenet.ee/hois_back/journals/123: Unexpected token < in JSON at position 0')).toBe(true)
  })

  test('does NOT match unrelated errors, non-Tahvel hosts, or non-hois_back Tahvel paths', () => {
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 500 Internal Server Error')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: 502 Bad Gateway')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('Network error')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('Wrapper: API Error: 401 Unauthorized')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('Something invalid JSON response from nowhere')).toBe(false)
    // Kriit and other non-Tahvel parse failures must reach Sentry
    expect(EXPECTED_ERROR_PATTERN.test('API Error: empty response from https://kriit.example/api/sync')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: invalid JSON response from http://localhost:3000/api/sync')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: empty response from /foo')).toBe(false)
    // Only /hois_back/ paths on Tahvel hosts are suppressed; non-hois_back paths reach Sentry
    expect(EXPECTED_ERROR_PATTERN.test('API Error: empty response from https://tahvel.edu.ee/spa/assets/main.js')).toBe(false)
    expect(EXPECTED_ERROR_PATTERN.test('API Error: invalid JSON response from https://test.tahvel.eenet.ee/some/other/path')).toBe(false)
  })
})

describe('Logger EXPECTED_NATIVE_FETCH_ERROR_PATTERN', () => {
  test('matches each cross-browser native fetch failure string verbatim', () => {
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('Failed to fetch')).toBe(true)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('Load failed')).toBe(true)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('NetworkError when attempting to fetch resource')).toBe(true)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('Network request failed')).toBe(true)
  })

  test('does NOT match prefixed, suffixed, or wrapped variants', () => {
    // Anchors must hold so wrapper strings (which contain the cause's message) do not match
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('TypeError: Failed to fetch')).toBe(false)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('Failed to fetch extra')).toBe(false)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('wrapper: Failed to fetch')).toBe(false)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('[REDACTED-PII Error on GET /hois_back/journals/<id>/journalStudents] type=TypeError message=Failed to fetch')).toBe(false)
    // Unrelated browser errors stay routed to Sentry
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('Cannot read properties of undefined')).toBe(false)
    expect(EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test('')).toBe(false)
  })
})

describe('_recordCapture PII redaction', () => {
    const PII_BODY = { name: 'Test PersonA', personalCode: '30000000001' }

    beforeEach(() => {
      global.chrome = {
        storage: { local: { set: mock(() => {}), get: mock((_, cb) => cb({})) } },
        runtime: { sendMessage: mock(() => {}) }
      }
      Logger.enableDebugMode()
      ApiService.capturedRequests = []
    })

    afterEach(() => {
      Logger.disableDebugMode()
      ApiService.capturedRequests = []
      global.chrome = undefined
    })

    const piiUrls = [
      'https://kriit.example.com/api/subjects/getDifferences',
      'https://tahvel.edu.ee/hois_back/journals/123/journalStudents',
      'https://tahvel.edu.ee/hois_back/students/789',
      'https://tahvel.edu.ee/hois_back/students?status=active',
      'https://tahvel.edu.ee/hois_back/teachers/22816',
      'https://tahvel.edu.ee/hois_back/timetableevents/timetableByTeacher/9?from=...',
      'https://tahvel.edu.ee/hois_back/user'
    ]

    for (const url of piiUrls) {
      test(`redacts requestBody and responseData for ${url}`, () => {
        ApiService._recordCapture({
          method: 'GET',
          url,
          requestHeaders: {},
          requestBody: PII_BODY,
          responseStatus: 200,
          responseData: PII_BODY,
          source: 'network'
        })
        const captured = ApiService.capturedRequests.at(-1)
        expect(captured.requestBody).toBe('[REDACTED-PII]')
        expect(captured.responseData).toBe('[REDACTED-PII]')
        expect(JSON.stringify(captured)).not.toContain('PersonA')
        expect(JSON.stringify(captured)).not.toContain('30000000001')
      })
    }

    test('strips query string from captured URL on PII endpoints', () => {
      ApiService._recordCapture({
        method: 'GET',
        url: 'https://tahvel.edu.ee/hois_back/teachers?isActive=true&lang=ET&name=Test+PersonD&page=0',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseData: PII_BODY,
        source: 'network'
      })
      const captured = ApiService.capturedRequests.at(-1)
      expect(captured.url).toBe('https://tahvel.edu.ee/hois_back/teachers')
      expect(captured.url).not.toContain('name=')
      expect(captured.url).not.toContain('PersonD')
    })

    test('masks numeric Tahvel IDs in captured URL on PII endpoints', () => {
      ApiService._recordCapture({
        method: 'GET',
        url: 'https://tahvel.edu.ee/hois_back/students/789',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseData: PII_BODY,
        source: 'network'
      })
      const captured = ApiService.capturedRequests.at(-1)
      expect(captured.url).toBe('https://tahvel.edu.ee/hois_back/students/<id>')
      expect(captured.url).not.toContain('789')
    })

    test('masks IDs in nested PII path (journals/<id>/journalStudents)', () => {
      ApiService._recordCapture({
        method: 'GET',
        url: 'https://tahvel.edu.ee/hois_back/journals/123/journalStudents?allStudents=true',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseData: PII_BODY,
        source: 'network'
      })
      const captured = ApiService.capturedRequests.at(-1)
      expect(captured.url).toBe('https://tahvel.edu.ee/hois_back/journals/<id>/journalStudents')
      expect(captured.url).not.toContain('123')
    })

    test('redacts error field on PII endpoints', () => {
      ApiService._recordCapture({
        method: 'GET',
        url: 'https://tahvel.edu.ee/hois_back/students/789',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 404,
        source: 'network',
        error: 'API Error: 404 (student Test PersonD 30000000001 not found)'
      })
      const captured = ApiService.capturedRequests.at(-1)
      expect(captured.error).toBe('[REDACTED-PII]')
      expect(JSON.stringify(captured)).not.toContain('PersonD')
      expect(JSON.stringify(captured)).not.toContain('30000000001')
    })

    test('preserves error field on non-PII endpoints', () => {
      ApiService._recordCapture({
        method: 'GET',
        url: 'https://tahvel.edu.ee/hois_back/journals?onlyMyJournals=true',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 500,
        source: 'network',
        error: 'API Error: 500 server problem'
      })
      const captured = ApiService.capturedRequests.at(-1)
      expect(captured.error).toBe('API Error: 500 server problem')
    })

    test('does not redact non-PII endpoint bodies', () => {
      ApiService._recordCapture({
        method: 'GET',
        url: 'https://tahvel.edu.ee/hois_back/journals?onlyMyJournals=true',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseData: { content: [{ id: 1 }] },
        source: 'network'
      })
      const captured = ApiService.capturedRequests.at(-1)
      expect(captured.responseData).toEqual({ content: [{ id: 1 }] })
    })

})

describe('_sanitizeHeaders', () => {
  test('redacts Authorization header', () => {
    const result = ApiService._sanitizeHeaders({ Authorization: 'Bearer secret123' })
    expect(result.Authorization).toBe('[REDACTED]')
  })

  test('redacts x-xsrf-token header (case-insensitive)', () => {
    const result = ApiService._sanitizeHeaders({ 'X-XSRF-TOKEN': 'token-value' })
    expect(result['X-XSRF-TOKEN']).toBe('[REDACTED]')
  })

  test('redacts cookie header', () => {
    const result = ApiService._sanitizeHeaders({ Cookie: 'session=abc123' })
    expect(result.Cookie).toBe('[REDACTED]')
  })

  test('preserves non-sensitive headers', () => {
    const result = ApiService._sanitizeHeaders({ 'Content-Type': 'application/json', 'X-Custom': 'safe' })
    expect(result['Content-Type']).toBe('application/json')
    expect(result['X-Custom']).toBe('safe')
  })

  test('returns null for null/undefined input', () => {
    expect(ApiService._sanitizeHeaders(null)).toBeNull()
    expect(ApiService._sanitizeHeaders(undefined)).toBeNull()
  })
})

describe('_isHighPiiEndpoint', () => {
  test('marks journalStudents as high-PII', () => {
    expect(ApiService._isHighPiiEndpoint('/journals/123/journalStudents')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('https://tahvel.edu.ee/hois_back/journals/456/journalStudents')).toBe(true)
  })

  test('marks students endpoint as high-PII', () => {
    expect(ApiService._isHighPiiEndpoint('/students')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/students/789')).toBe(true)
  })

  test('marks teachers endpoint as high-PII', () => {
    expect(ApiService._isHighPiiEndpoint('/teachers')).toBe(true)
    expect(ApiService._isHighPiiEndpoint('/teachers/123')).toBe(true)
  })

  test('does not mark journal list as high-PII', () => {
    expect(ApiService._isHighPiiEndpoint('/journals')).toBe(false)
    expect(ApiService._isHighPiiEndpoint('/journals/123')).toBe(false)
  })

  test('does not mark entries as high-PII', () => {
    expect(ApiService._isHighPiiEndpoint('/journals/123/journalEntriesByDate')).toBe(false)
  })

  test('returns false for null/undefined', () => {
    expect(ApiService._isHighPiiEndpoint(null)).toBe(false)
    expect(ApiService._isHighPiiEndpoint(undefined)).toBe(false)
  })
})

describe('_sanitiseForCache', () => {
  test('strips insertedBy and changedBy from timetable events', () => {
    const raw = {
      timetableEvents: [
        { id: 1, name: 'Lesson', insertedBy: 'Mari Maasikas (39901010001)', changedBy: 'Juhan Jansen (49902020002)' },
        { id: 2, name: 'Lab', insertedBy: 'Kati Kask (39903030003)' }
      ]
    }
    const result = ApiService._sanitiseForCache('/timetableevents/timetableByTeacher/9', raw)
    for (const ev of result.timetableEvents) {
      expect(ev.insertedBy).toBeUndefined()
      expect(ev.changedBy).toBeUndefined()
    }
    expect(result.timetableEvents[0].id).toBe(1)
    expect(result.timetableEvents[0].name).toBe('Lesson')
  })

  test('allowlists /user response to school, person, roleCode only', () => {
    const raw = {
      school: { id: 9 },
      person: { id: 227928, idcode: '40000000002' },
      roleCode: 'ROLL_O',
      name: '30000000001',
      email: 'teacher@school.ee'
    }
    const result = ApiService._sanitiseForCache('/user', raw)
    expect(result.school).toEqual({ id: 9 })
    expect(result.person).toEqual({ id: 227928 })
    expect(result.roleCode).toBe('ROLL_O')
    expect(result.name).toBeUndefined()
    expect(result.email).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('40000000002')
  })

  test('passes through non-PII endpoints unchanged', () => {
    const raw = { content: [{ id: 1, name: 'Test Journal' }] }
    const result = ApiService._sanitiseForCache('/journals', raw)
    expect(result).toEqual(raw)
  })

  test('returns data unchanged for null url', () => {
    const raw = { x: 1 }
    expect(ApiService._sanitiseForCache(null, raw)).toEqual(raw)
  })
})

describe('_bodyContainsPII', () => {
  test('flags Kriit PII endpoints', () => {
    expect(ApiService._bodyContainsPII('/api/subjects/getDifferences')).toBe(true)
    expect(ApiService._bodyContainsPII('/api/grades/markSynchronized')).toBe(true)
    expect(ApiService._bodyContainsPII('/api/outcomes/sync')).toBe(true)
  })

  test('does not flag non-PII endpoints', () => {
    expect(ApiService._bodyContainsPII('/api/assignments')).toBe(false)
    expect(ApiService._bodyContainsPII('/journals/123')).toBe(false)
  })

  test('returns false for null/undefined', () => {
    expect(ApiService._bodyContainsPII(null)).toBe(false)
    expect(ApiService._bodyContainsPII(undefined)).toBe(false)
  })
})

describe('_isPiiUrl', () => {
  test('returns true for all PII classes', () => {
    expect(ApiService._isPiiUrl('/students/123')).toBe(true)
    expect(ApiService._isPiiUrl('/api/subjects/getDifferences')).toBe(true)
    expect(ApiService._isPiiUrl('/user')).toBe(true)
    expect(ApiService._isPiiUrl('/timetableevents/timetableByTeacher/9')).toBe(true)
  })

  test('returns false for non-PII endpoints', () => {
    expect(ApiService._isPiiUrl('/journals/123')).toBe(false)
    expect(ApiService._isPiiUrl('/journals/123/journalEntriesByDate')).toBe(false)
  })
})
