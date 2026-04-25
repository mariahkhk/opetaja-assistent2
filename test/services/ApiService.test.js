import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { ApiService } from '../../src/services/ApiService.js'
import { cacheService } from '../../src/services/CacheService.js'
import Logger, { EXPECTED_ERROR_PATTERN } from '../../src/services/Logger.js'
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
