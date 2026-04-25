/**
 * API Service - Generic service for API communication
 */

import Logger from './Logger.js'
import { cacheService } from './CacheService.js'
import { parseJsonResponse } from '../lib/parseJsonResponse.js'

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

  static _recordCapture({ method, url, requestHeaders, requestBody, responseStatus, responseData, source, error }) {
    if (!Logger.isDebugMode()) return
    if (ApiService.capturedRequests.length >= ApiService.MAX_CAPTURE_SIZE) {
      ApiService.capturedRequests.shift()
    }
    ApiService.capturedRequests.push({
      timestamp: new Date().toISOString(),
      method,
      url,
      requestHeaders: ApiService._sanitizeHeaders(requestHeaders),
      requestBody,
      responseStatus: responseStatus ?? null,
      responseData,
      source: source || 'network',
      error: error || null
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
            return parseJsonResponse(text, urlString)
          },
          cacheExpiration
        )
        ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseData: cachedResult, source: 'cache' })
        captured = true
        return cachedResult
      }

      // For GET requests, try to dedupe identical in-flight requests so multiple
      // callers don't trigger duplicate network traffic. We key by method+url.
      let response
      if (method === 'GET') {
        const reqKey = `${method}_${urlString}`
        if (ApiService.pendingRequests[reqKey]) {
          if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Joining pending request: ${reqKey}`)
          response = await ApiService.pendingRequests[reqKey]
        } else {
          // Create a fetch promise and store it
          const fetchPromise = (async() => {
            try {
              const r = await ApiService._throttledFetch(urlString, requestOptions)
              if (!r.ok) throw r
              return r
            } catch (err) {
              throw err
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
        try {
          const errorJson = JSON.parse(errorText)

          // Check for Tahvel-specific error format
          // noinspection JSUnresolvedVariable
          if (errorJson?._errors && Array.isArray(errorJson._errors)) {
            errorDetails = errorJson._errors.map(err => err.code || err.message || JSON.stringify(err)).join(', ')
            if (!suppressedErrorStatuses.has(response.status)) Logger.error(`[${this.name}] Parsed error details:`, errorDetails)
          } else if (errorJson.error || errorJson.message) {
            errorDetails = errorJson.error || errorJson.message
          }
        } catch (e) {
          // Not JSON, use as is
          if (errorText && errorText !== 'No response text') {
            errorDetails = errorText
          }
        }

        ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseStatus: response.status, source: 'network', error: `API Error: ${response.status} ${errorDetails || response.statusText}` })
        captured = true
        // noinspection ExceptionCaughtLocallyJS
        const apiError = new Error(`API Error: ${response.status} ${errorDetails ? `(${errorDetails})` : response.statusText}`)
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
      }

      ApiService._recordCapture({ method, url: urlString, requestHeaders: requestOptions.headers, requestBody: data, responseStatus: response.status, responseData: result, source: 'network' })
      captured = true
      return result
    } catch (error) {
      if (!captured) {
        ApiService._recordCapture({ method, url: urlString, requestBody: data, source: 'network', error: error.message })
      }
      if (!suppressedErrorStatuses.has(getErrorStatus(error))) Logger.error(`[${this.name}] ${method} Error:`, error)
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

    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] PUT request to ${endpoint} starting`)

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

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] PUT request to ${endpoint} completed successfully`)
      return result
    } catch (error) {
      Logger.error(`[${this.name}] PUT request to ${endpoint} failed: ${error.message}`)
      throw error
    }
  }
}

// Export only the class, no default instance
export { ApiService }
