/**
 * API Service - Generic service for API communication
 */

import Logger, { EXPECTED_NATIVE_FETCH_ERROR_PATTERN } from './Logger.js'
import { cacheService } from './CacheService.js'
import { parseJsonResponse } from '../lib/parseJsonResponse.js'

// Endpoints whose responses are sanitised before caching. Shared between the
// `_isCachedSanitisedEndpoint` predicate (used by `_recordCapture`) and the
// `_sanitiseForCache` switch — keeping the regexes in one place avoids drift.
const TIMETABLE_EVENTS_RE = /(?:^|\/)timetableevents\//i
const USER_ENDPOINT_RE = /(?:^|\/)user\/?(?:\?|$)/i

/**
 * ApiService class for making API requests
 */
class ApiService {
  /**
   * Create a new ApiService instance
   * @param {Object} config - Configuration object
   * @param {string} config.name - Name of the API service (for logging)
   * @param {string} config.baseUrl - Base URL for API requests
   * @param {Object} config.defaultHeaders - Default headers to include in all requests
   * @param {string} config.authToken - Authentication token for API requests
   */
  constructor(config = {}) {
    this.name = config.name || 'api'
    this.baseUrl = config.baseUrl || ''
    this.defaultHeaders = config.defaultHeaders || {}
    this.authToken = config.authToken || ''
  }

  // Track pending in-flight GET requests to avoid duplicate identical network calls
  static pendingRequests = {}
  // Global throttling controls to avoid too many simultaneous fetches which may
  // cause the server or browser to drop/ignore some requests when syncing many pages.
  // Defaults are conservative but can be changed at runtime via setConcurrencyLimit.
  static concurrencyLimit = 10
  static activeRequests = 0
  static requestQueue = []
  static delayBetweenRequestsMs = 0

  // Debug capture buffer for network requests (only populated when debug mode is on)
  static capturedRequests = []
  static MAX_CAPTURE_SIZE = 200

  /**
   * Set global concurrency limit for underlying fetch calls.
   * @param {number} limit - Max parallel fetches
   * @param {number} delayMs - Optional delay (ms) between dequeued requests
   */
  static setConcurrencyLimit(limit, delayMs = 0) {
    ApiService.concurrencyLimit = Math.max(1, parseInt(limit, 10) || 1)
    ApiService.delayBetweenRequestsMs = Math.max(0, parseInt(delayMs, 10) || 0)
  }

  static _sanitizeHeaders(headers) {
    if (!headers) return null
    const sanitized = { ...headers }
    const sensitive = ['authorization', 'x-xsrf-token', 'cookie']
    for (const key of Object.keys(sanitized)) {
      if (sensitive.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]'
      }
    }
    return sanitized
  }

  /**
   * Endpoints whose request/response bodies contain student/teacher PII
   * (personal codes, names, grades). When debug mode is on, the bodies must
   * be scrubbed so PII does not land in the in-memory capture buffer or in
   * the file produced by the popup's "download captured requests" button.
   */
  static _bodyContainsPII(url) {
    if (!url) return false
    return [
      '/subjects/getDifferences',
      '/grades/markSynchronized',
      '/assignments/setAssignmentExternalId',
      '/outcomes/sync'
    ].some(suffix => url.includes(suffix))
  }

  /**
   * Endpoints that return student names and personal codes. These responses
   * are cached in memory for the current page session but MUST NOT persist
   * to the on-disk Cache API — names + idcodes together are the data we
   * most need to keep off disk.
   *
   * Grade endpoints (e.g. /journalEntriesByDate) are NOT in this list:
   * they index grades by Tahvel-internal numeric studentId, with no names
   * or idcodes in the payload, so they can persist encrypted with the rest.
   */
  static _isHighPiiEndpoint(url) {
    if (!url) return false
    // Patterns match both full URLs (https://tahvel.edu.ee/hois_back/students/789)
    // and bare endpoint paths (/students/789) used by the secondary cache layer
    // in JournalListSync.fetchCachedData. Bare-resource patterns end with
    // `(?:\?|$)` so sub-paths like /students/789/somesubresource don't auto-
    // route to memory-only — only enumerate explicit sub-paths that need it.
    return [
      /(?:^|\/)journals\/\d+\/journalStudents\/?(?:\?|$)/i,
      /(?:^|\/)journals\/\d+\/students\/?(?:\?|$)/i,
      /(?:^|\/)students\/\d+\/?(?:\?|$)/i,
      /(?:^|\/)students\/?(?:\?|$)/i,
      /(?:^|\/)teachers\/\d+\/?(?:\?|$)/i,
      /(?:^|\/)teachers\/?(?:\?|$)/i
    ].some(pattern => pattern.test(url))
  }

  /**
   * Endpoints whose responses are cached only after `_sanitiseForCache`
   * strips embedded name/idcode strings. Shared by `_recordCapture` so the
   * debug capture buffer applies the same redaction (otherwise a `/user`
   * or `/timetableevents/...` response with idcodes would land plaintext in
   * the downloaded capture file even though the cache itself stores the
   * sanitised version).
   */
  static _isCachedSanitisedEndpoint(url) {
    if (!url) return false
    // Use the same `(?:^|/)` boundary form as `_isHighPiiEndpoint` so the
    // predicate matches both full URLs and bare endpoint paths. `/user/`
    // (trailing slash) also matches, in case any caller normalises that way.
    return TIMETABLE_EVENTS_RE.test(url) || USER_ENDPOINT_RE.test(url)
  }

  /**
   * Union of every PII-classification predicate. Used by capture-buffer
   * redaction and Logger error redaction so all three classes (Kriit body
   * PII, Tahvel high-PII, Tahvel sanitised endpoints) get the same
   * treatment without three copies of the boolean union drifting apart.
   */
  static _isPiiUrl(url) {
    return ApiService._bodyContainsPII(url) ||
      ApiService._isHighPiiEndpoint(url) ||
      ApiService._isCachedSanitisedEndpoint(url)
  }

  /**
   * Strip per-endpoint PII fields from an API response before it lands in
   * the cache. Keeps the rest of the response intact so features still get
   * the data they need, while idcode-bearing audit fields ("Name (idcode)")
   * don't reach disk.
   *
   * Currently scrubs:
   *   - /timetableevents/* — strips `insertedBy` and `changedBy` from every
   *     event. Tahvel embeds other teachers' "Name (idcode)" strings there.
   *   - /user — strips `name` (which contains the user's own idcode in
   *     Tahvel's identity model). The actually-used fields (`school.id`,
   *     `person.id`, `roleCode`) are preserved.
   */
  static _sanitiseForCache(url, data) {
    if (!url || !data) return data
    if (TIMETABLE_EVENTS_RE.test(url)) {
      if (Array.isArray(data?.timetableEvents)) {
        return {
          ...data,
          timetableEvents: data.timetableEvents.map(ev => {
            const sanitised = { ...ev }
            delete sanitised.insertedBy
            delete sanitised.changedBy
            return sanitised
          })
        }
      }
      // Shape mismatch — log so a future Tahvel response shape change doesn't
      // silently persist insertedBy/changedBy strings (which embed
      // "Name (idcode)" of other teachers) to disk encrypted.
      Logger.warning('[ApiService] /timetableevents response shape unexpected; persisting unsanitised')
    }
    if (USER_ENDPOINT_RE.test(url) && typeof data === 'object' && data !== null) {
      // Allowlist: only the fields consumers actually read from /user.
      // Denylist (strip `name`) was fragile — any future Tahvel API addition
      // (email, firstName, person.idcode, etc.) would silently land on disk.
      // Allowlist fails closed; consumers verified via grep for `userInfo.*`
      // reads at content.js, schoolId.js, Extension.js, LessonCountWarning,
      // TimetableDiscrepancyDetection.
      // Tahvel returns `person` as a flat number id for some accounts and as
      // `{ id, ... }` for others. Canonicalize to `{ id }` so consumers'
      // `userInfo.person?.id` reads work for both shapes (the captured
      // tests/fixtures/tahvel/api/user.json shows the flat-number form).
      return {
        school: data.school,
        person: data.person != null
          ? { id: typeof data.person === 'object' ? data.person.id : data.person }
          : undefined,
        roleCode: data.roleCode
      }
    }
    return data
  }

  static _recordCapture({ method, url, requestHeaders, requestBody, responseStatus, responseData, source, error }) {
    if (!Logger.isDebugMode()) return
    if (ApiService.capturedRequests.length >= ApiService.MAX_CAPTURE_SIZE) {
      ApiService.capturedRequests.shift()
    }
    const piiEndpoint = ApiService._isPiiUrl(url)
    // Strip the query string for PII endpoints — Tahvel teacher search builds
    // URLs like `/teachers?...&name=<TeacherName>&...` whose query carries the
    // exact PII the body redaction is meant to keep out of the capture buffer.
    // Also mask numeric Tahvel-internal IDs in path segments — combined with
    // a Tahvel UI screenshot a /students/789 URL can re-identify a student.
    // Also redact the error field (Tahvel error messages echo failing
    // resource names/idcodes) on the same predicate.
    let safeUrl = url
    if (piiEndpoint && url) {
      safeUrl = url.split('?')[0].replace(/\/(students|teachers|journals)\/\d+/g, '/$1/<id>')
    }
    ApiService.capturedRequests.push({
      timestamp: new Date().toISOString(),
      method,
      url: safeUrl,
      requestHeaders: ApiService._sanitizeHeaders(requestHeaders),
      requestBody: piiEndpoint ? '[REDACTED-PII]' : requestBody,
      responseStatus: responseStatus ?? null,
      responseData: piiEndpoint ? '[REDACTED-PII]' : responseData,
      source: source || 'network',
      error: piiEndpoint && error ? '[REDACTED-PII]' : (error || null)
    })
  }

  static getCapturedRequests() {
    return [...ApiService.capturedRequests]
  }

  static clearCapturedRequests() {
    ApiService.capturedRequests = []
  }

  /**
   * Internal helper which throttles fetch calls using a simple FIFO queue.
   * Returns a Promise that resolves to the fetch Response.
   */
  static _throttledFetch(url, options) {
    return new Promise((resolve, reject) => {
      const run = async() => {
        try {
          if (Logger.isDebugMode())
            Logger.debug(`✨ [ApiService] Starting fetch (${ApiService.activeRequests + 1}/${ApiService.concurrencyLimit}): ${url}`)
          const res = await fetch(url, options)
          resolve(res)
        } catch (err) {
          reject(err)
        } finally {
          ApiService.activeRequests = Math.max(0, ApiService.activeRequests - 1)

          // Dequeue next task (if any) and run it after optional delay
          const next = ApiService.requestQueue.shift()
          if (next) {
            if (ApiService.delayBetweenRequestsMs > 0) {
              setTimeout(() => {
                ApiService.activeRequests++
                next()
              }, ApiService.delayBetweenRequestsMs)
            } else {
              ApiService.activeRequests++
              next()
            }
          }
        }
      }

      // If we have capacity, run immediately
      if (ApiService.activeRequests < ApiService.concurrencyLimit) {
        ApiService.activeRequests++
        run()
      } else {
        if (Logger.isDebugMode()) Logger.debug(`✨ [ApiService] Queueing fetch: ${url}`)
        ApiService.requestQueue.push(run)
      }
    })
  }

  /**
   * Set the base URL for API requests
   * @param {string} url - The base URL for the API
   */
  setBaseUrl(url) {
    this.baseUrl = url
  }

  /**
   * Set the authentication token
   * @param {string} token - The authentication token
   */
  setAuthToken(token) {
    this.authToken = token
  }

  /**
   * Get the authentication headers
   * @returns {Object} Authentication headers
   */
  getAuthHeaders() {
    if (!this.authToken) return {}
    return { Authorization: `Bearer ${this.authToken}` }
  }

  /**
   * Make a request to any API with custom configuration
   * @param {Object} config - Request configuration
   * @param {string} config.baseUrl - Base URL for the API
   * @param {string} config.endpoint - API endpoint
   * @param {string} config.method - HTTP method (GET, POST, etc.)
   * @param {Object} config.data - Request body data
   * @param {Object} config.headers - Request headers
   * @param {Object} config.params - Query parameters
   * @param {boolean} config.cache - Whether to cache the request
   * @param {number} config.cacheExpiration - Cache expiration time in milliseconds
   * @returns {Promise<any>} Response data
   */
  async request(config) {
    const {
      baseUrl = this.baseUrl,
      endpoint,
      method = 'GET',
      data = null,
      headers = {},
      params = {},
      cache = false,
      cacheExpiration = cacheService.EXPIRATION.MEDIUM,
      suppressErrorStatuses = []
    } = config

    let urlString = endpoint
    let captured = false
    const suppressedErrorStatuses = new Set(suppressErrorStatuses.map(status => Number(status)))
    const getErrorStatus = error => error?.status || Number(error?.message?.match(/API Error:\s*(\d+)/)?.[1])

    try {
      // Resolve the full URL
      let fullUrl
      if (endpoint.startsWith('http')) {
        fullUrl = endpoint
      } else {
        fullUrl = `${baseUrl}${endpoint}`
      }

      // Add query parameters if this is a GET request
      const url = new URL(fullUrl)
      if (Object.keys(params).length > 0) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, String(value))
        })
      }

      urlString = url.toString()

      // Set up request options
      const requestOptions = {
        method,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          ...this.defaultHeaders,
          ...this.getAuthHeaders(),
          ...headers
        }
      }

      // For Tahvel API, include credentials and add additional headers
      if (this.name === 'tahvel') {
        // Include cookies for authentication (only for Tahvel)
        requestOptions.credentials = 'include'

        // For PUT/POST requests, add additional headers
        if (method === 'PUT' || method === 'POST') {
          // Add Origin and Referer headers based on current domain
          const currentOrigin = window.location.origin
          requestOptions.headers['Origin'] = currentOrigin
          requestOptions.headers['Referer'] = currentOrigin + '/'

          // Add additional headers that Angular includes
          requestOptions.headers['X-Requested-With'] = 'XMLHttpRequest'

          // Try to get client IP for X-Forwarded-For
          // This is the best we can do—we can’t reliably get the client’s IP
          // But we can include the header to match Angular's request
          requestOptions.headers['X-Forwarded-For'] = '127.0.0.1'

          // Add X-XSRF-TOKEN header for POST/PUT requests
          const cookies = document.cookie.split(';')
          let xsrfToken = ''
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=')
            if (name === 'XSRF-TOKEN') {
              xsrfToken = value
              break
            }
          }
          if (xsrfToken) {
            requestOptions.headers['X-XSRF-TOKEN'] = xsrfToken
          }
        }
      }

      // Add body for non-GET requests
      if (method !== 'GET' && data !== null) {
        requestOptions.body = JSON.stringify(data)
      }

      // Log credentials mode for debugging CORS issues
      if (this.name === 'kriit') {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Request credentials mode: ${requestOptions.credentials || 'not set'}`)
      }

      // For Kriit API requests to localhost, use background script to bypass mixed content restrictions
      if (this.name === 'kriit' && urlString.includes('localhost')) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Using background script for localhost request: ${method} ${urlString}`)

        return new Promise((resolve, reject) => {
          // noinspection JSCheckFunctionSignatures
          chrome.runtime.sendMessage(
            {
              action: 'kriitApiRequest',
              method,
              url: urlString,
              headers: requestOptions.headers,
              body: data
            },
            response => {
              if (chrome.runtime.lastError) {
                Logger.error(`[${this.name}] Background script error:`, chrome.runtime.lastError)
                ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, source: 'background', error: chrome.runtime.lastError.message })
                reject(new Error(`Background script error: ${chrome.runtime.lastError.message}`))
                return
              }

              if (response.status === 'success') {
                ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseData: response.data, source: 'background' })
                resolve(response.data)
              } else {
                ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, source: 'background', error: response.message })
                reject(new Error(response.message))
              }
            }
          )
        })
      }

      // Handle caching for GET requests
      if (method === 'GET' && cache) {
        const cacheKey = `${method}_${urlString}`
        // High-PII endpoints (student rosters, grade entries) stay in memory
        // only — never persisted to the on-disk Cache API.
        const persist = !ApiService._isHighPiiEndpoint(urlString)

        const cachedResult = await cacheService.getOrFetch(
          cacheKey,
          async() => {
            const response = await ApiService._throttledFetch(urlString, requestOptions)

            // Cache 404 and 412 as negative results instead of throwing
            if (response.status === 404 || response.status === 412) {
              return { _errorStatus: response.status }
            }

            if (!response.ok) {
              throw new Error(`API Error: ${response.status} ${response.statusText}`)
            }

            const text = await response.text()
            const parsed = parseJsonResponse(text, urlString)
            return ApiService._sanitiseForCache(urlString, parsed)
          },
          cacheExpiration,
          true,
          persist
        )
        // Pass cachedResult through; _recordCapture's predicate (the union
        // of _bodyContainsPII / _isHighPiiEndpoint / _isCachedSanitisedEndpoint)
        // applies the same redaction as the network path, so a non-PII cache
        // hit still has a body in the captured-requests file (useful for
        // debugging stale-cache issues).
        ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseData: cachedResult, source: 'cache' })
        captured = true
        return cachedResult
      }

      // For GET requests, try to dedupe identical in-flight requests so multiple
      // callers don't trigger duplicate network traffic. We key by method+url.
      // The shared promise resolves to a body-cached object (not the raw
      // Response): a Response body stream can only be consumed once, so two
      // callers awaiting the same Response would race on .text().
      let response
      if (method === 'GET') {
        const reqKey = `${method}_${urlString}`
        if (ApiService.pendingRequests[reqKey]) {
          if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Joining pending request: ${reqKey}`)
          response = await ApiService.pendingRequests[reqKey]
        } else {
          const fetchPromise = (async() => {
            const r = await ApiService._throttledFetch(urlString, requestOptions)
            const bodyText = await r.text()
            return {
              ok: r.ok,
              status: r.status,
              statusText: r.statusText,
              text: () => Promise.resolve(bodyText)
            }
          })()
          ApiService.pendingRequests[reqKey] = fetchPromise
          try {
            response = await fetchPromise
          } finally {
            delete ApiService.pendingRequests[reqKey]
          }
        }
      } else {
        response = await ApiService._throttledFetch(urlString, requestOptions)
      }

      if (!response.ok) {
        // Try to get error text if available
        const errorText = await response.text().catch(() => 'No response text')

        // Try to parse error text as JSON
        let errorDetails = ''
        // Tahvel error responses can echo the failing resource (student/
        // teacher names, idcodes). Redact errorDetails before it reaches
        // Logger (Sentry), the capture buffer, OR the thrown apiError —
        // outer catch logs error.message via Logger.error which forwards to
        // Sentry, so the apiError must carry the redacted form too.
        const piiEndpoint = ApiService._isPiiUrl(urlString)
        let isTahvelErrorsFormat = false
        try {
          const errorJson = JSON.parse(errorText)

          // Check for Tahvel-specific error format
          // noinspection JSUnresolvedVariable
          if (errorJson?._errors && Array.isArray(errorJson._errors)) {
            errorDetails = errorJson._errors.map(err => err.code || err.message || JSON.stringify(err)).join(', ')
            isTahvelErrorsFormat = true
          } else if (errorJson.error || errorJson.message) {
            errorDetails = errorJson.error || errorJson.message
          }
        } catch (e) {
          // Not JSON, use as is
          if (errorText && errorText !== 'No response text') {
            errorDetails = errorText
          }
        }

        const safeErrorDetails = piiEndpoint && errorDetails ? '[REDACTED-PII]' : errorDetails
        // Diagnostic breadcrumb only — keep it debug-level. The catch at the
        // bottom of request() is the single Sentry reporter (PII-redacted, and
        // it suppresses expected 401/403/404/412 via the preserved cause chain).
        // Reporting here with Logger.error both double-reports genuine failures
        // and leaks expected statuses, because "[name] Parsed error details:"
        // never matches the ^API Error: anchored EXPECTED_ERROR_PATTERN and falls
        // through to sentryService.captureMessage.
        if (isTahvelErrorsFormat && !suppressedErrorStatuses.has(response.status)) {
          Logger.debug(`[${this.name}] Parsed error details:`, safeErrorDetails)
        }

        // Tahvel reverse proxies could in principle echo a request parameter
        // into response.statusText (rare but legal in HTTP) — apply the same
        // redaction to the statusText fallback for PII endpoints.
        const safeStatusText = piiEndpoint ? '[REDACTED-PII]' : response.statusText
        ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseStatus: response.status, source: 'network', error: `API Error: ${response.status} ${safeErrorDetails || safeStatusText}` })
        captured = true
        // noinspection ExceptionCaughtLocallyJS
        const apiError = new Error(`API Error: ${response.status} ${safeErrorDetails ? `(${safeErrorDetails})` : safeStatusText}`)
        apiError.status = response.status
        throw apiError
      }

      // First, get the response as text
      const responseText = await response.text()
      let result

      // For non-GET methods, an empty response is a valid "accepted, no content" signal
      if (method !== 'GET' && responseText.trim() === '') {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] ${method} request returned empty response - treating as success`)
        result = { success: true, status: response.status }
      } else {
        result = parseJsonResponse(responseText, urlString)
        // Apply the sanitiser on every GET — not just the cached path —
        // so cache:false callers receive the same allowlisted shape as
        // cache:true. Without this, /user returns raw with `name` (idcode)
        // for direct callers and a different shape for cached ones.
        if (method === 'GET') {
          result = ApiService._sanitiseForCache(urlString, result)
        }
      }

      ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseStatus: response.status, responseData: result, source: 'network' })
      captured = true

      // Auto-invalidate journal cache after successful mutations so
      // subsequent cached GETs return fresh data (issue #95).
      if (this.name === 'tahvel' && method !== 'GET') {
        const journalIdMatch = urlString.match(/\/journals\/(\d+)/)
        if (journalIdMatch) {
          await cacheService.clearJournalCache(journalIdMatch[1]).catch(e =>
            Logger.debug('[ApiService] Auto-invalidation failed:', e.message)
          )
        }
      }

      return result
    } catch (error) {
      if (!captured) {
        ApiService._recordCapture({ method, url: urlString, requestBody: data, source: 'network', error: error.message })
      }
      if (!suppressedErrorStatuses.has(getErrorStatus(error))) {
        // parseJsonResponse and other thrown messages can carry the URL with
        // numeric Tahvel IDs in the path, or response-body fragments echoed by
        // JSON.parse. Logger.error forwards to Sentry — redact when the URL
        // is a PII endpoint, but keep status code, sanitised path, and error
        // class name: those are diagnostic and not PII. For non-PII endpoints,
        // include the original error message and full path so Sentry receives
        // an actionable title instead of a bare "GET Error:".
        const piiEndpoint = ApiService._isPiiUrl(urlString)
        const status = getErrorStatus(error)
        const errorType = error?.constructor?.name
        let safeError
        if (piiEndpoint) {
          const safePath = urlString
            ? urlString.split('?')[0].split('#')[0]
                .replace(/^https?:\/\/[^/]+/, '')
                .replace(/\/(students|teachers|journals)\/\d+/g, '/$1/<id>')
            : ''
          const parts = [`[REDACTED-PII Error on ${method}${safePath ? ' ' + safePath : ''}]`]
          if (status) parts.push(`status=${status}`)
          if (errorType) parts.push(`type=${errorType}`)
          // Surface the cause's message only when it matches the
          // EXPECTED_NATIVE_FETCH_ERROR_PATTERN allowlist (defined in
          // Logger.js — same list the Sentry-suppression check uses).
          // Those strings are hard-coded browser constants for transport
          // failures, so they carry no PII and are safe even on redacted
          // endpoints. Anything else (notably our own apiError from line
          // 559, which can echo response-body PII) stays redacted.
          if (error?.message && EXPECTED_NATIVE_FETCH_ERROR_PATTERN.test(error.message)) {
            parts.push(`message=${error.message}`)
          }
          safeError = new Error(parts.join(' '))
        } else {
          const fullPath = urlString
            ? urlString.split('?')[0].split('#')[0].replace(/^https?:\/\/[^/]+/, '')
            : ''
          const parts = [`${method}${fullPath ? ' ' + fullPath : ''}`]
          if (status) parts.push(`status=${status}`)
          if (errorType) parts.push(`type=${errorType}`)
          if (error?.message) parts.push(`message=${error.message}`)
          safeError = new Error(parts.join(' '))
        }
        if (error?.stack) safeError.stack = error.stack
        // Preserve the original Error as `cause` so Logger.error's
        // EXPECTED_ERROR_PATTERN suppression can match the unwrapped message
        // ("API Error: 403 Forbidden", "API Error: empty response from
        // .../hois_back/user"). Without this, the wrapper string ("GET
        // /hois_back/journals status=403 ...") no longer matches the `^API
        // Error:` anchor and expected operational signals leak into Sentry.
        if (error instanceof Error) safeError.cause = error
        Logger.error(`[${this.name}] ${method} Error:`, safeError)
      }
      throw error
    }
  }

  /**
   * Make a GET request to the specified endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @param {Object} options - Additional options
   * @param {boolean} options.cache - Whether to cache the request (default: true)
   * @param {number} options.cacheExpiration - Cache expiration time in milliseconds
   * @returns {Promise<any>} Response data
   */
  async get(endpoint, params = {}, options = {}) {
    // Default options
    const { cache = undefined, cacheExpiration = undefined, forceRefresh = false, suppressErrorStatuses = [] } = options

    // Smart defaults for specific endpoints. Do not override explicit caller choices.
    let finalCache = typeof cache === 'undefined' ? true : cache
    let finalCacheExpiration = typeof cacheExpiration === 'undefined' ? cacheService.EXPIRATION.MEDIUM : cacheExpiration

    // For the heavy journalEntriesByDate endpoint, prefer a longer default cache so page reloads
    // don't hammer the Tahvel API. Callers that explicitly set cache:false or provide
    // cacheExpiration will still have their preferences respected.
    if (endpoint.includes('journalEntriesByDate')) {
      if (typeof cache === 'undefined') finalCache = true
      if (typeof cacheExpiration === 'undefined') finalCacheExpiration = cacheService.EXPIRATION.MEDIUM
    }

    return this.request({
      baseUrl: this.baseUrl,
      endpoint,
      method: 'GET',
      params,
      data: null,
      headers: {},
      cache: finalCache && !forceRefresh,
      cacheExpiration: finalCacheExpiration,
      suppressErrorStatuses
    })
  }

  /**
   * Make a POST request to the specified endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body data
   * @returns {Promise<any>} Response data
   */
  async post(endpoint, data = {}) {
    return this.request({
      baseUrl: this.baseUrl,
      endpoint,
      method: 'POST',
      data,
      headers: {}, // Add missing required parameters
      params: {}, // Add missing required parameters
      cache: false, // POST requests typically shouldn't be cached
      cacheExpiration: cacheService.EXPIRATION.MEDIUM
    })
  }

  /**
   * Make a PUT request to the specified endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body data
   * @param {Object} options - Additional options
   * @returns {Promise<any>} Response data
   */
  async put(endpoint, data = {}, options = {}) {
    // For Tahvel API, we need to include CSRF token
    const headers = {}

    if (this.name === 'tahvel' && endpoint.includes('journalEntry')) {
      // Get XSRF token from cookies
      const cookies = document.cookie.split(';')
      let xsrfToken = ''

      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=')
        if (name === 'XSRF-TOKEN') {
          xsrfToken = value
          break
        }
      }

      if (xsrfToken) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Using XSRF token: ${xsrfToken}`)
        headers['X-XSRF-TOKEN'] = xsrfToken
      } else {
        Logger.warning(`[${this.name}] No XSRF token found in cookies for PUT request`)
      }

      // Add other headers that might be needed
      headers['X-Requested-With'] = 'XMLHttpRequest'
    }

    Logger.debug(`[${this.name}] PUT request to ${endpoint} starting`)

    try {
      const result = await this.request({
        baseUrl: this.baseUrl,
        endpoint,
        method: 'PUT',
        data,
        headers,
        params: {}, // required parameter
        cache: false, // PUT requests shouldn't be cached
        cacheExpiration: cacheService.EXPIRATION.MEDIUM,
        ...options
      })

      Logger.debug(`[${this.name}] PUT request to ${endpoint} completed successfully`)
      return result
    } catch (error) {
      // request() is the single choke point that reports unexpected errors to
      // Sentry (with PII redaction) AND suppresses expected statuses (401/403/
      // 404/412) via the preserved cause chain. Re-reporting here with
      // Logger.error would both double-report genuine failures and leak
      // expected statuses: the interpolated string ("[tahvel] PUT request to
      // ... failed: API Error: 412") never matches the ^API Error: anchored
      // EXPECTED_ERROR_PATTERN, so it falls through to sentryService. Keep only
      // a debug breadcrumb (never forwarded to Sentry) and re-throw.
      Logger.debug(`[${this.name}] PUT request to ${endpoint} failed: ${error.message}`)
      throw error
    }
  }
}

// Export only the class, no default instance
export { ApiService }
