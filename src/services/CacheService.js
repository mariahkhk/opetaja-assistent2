/**
 * Cache Service - Handles caching of API requests to prevent duplicate calls
 *
 * Uses Cache API for persistent storage (no size limit) and in-memory cache
 * for fast same-page access. chrome.storage.local is only used for extension
 * settings, not for API response caching.
 */

import Logger from './Logger.js'

const CACHE_NAME = 'oa2-api-cache'
const CACHE_URL_PREFIX = 'https://cache/'
const CACHE_PREFIX = 'OA_cache_'
const MAX_NEGATIVE_TTL = 5 * 60 * 1000 // 5 minutes

const CACHE_EXPIRATION = {
  VERY_SHORT: 1000, // 1 second
  SHORT: 60 * 1000, // 1 minute
  MEDIUM: 5 * 60 * 1000, // 5 minutes
  LONG: 30 * 60 * 1000, // 30 minutes
  VERY_LONG: 24 * 60 * 60 * 1000, // 24 hours
  TWO_WEEKS: 14 * 24 * 60 * 60 * 1000 // 2 weeks
}

// In-memory cache for the current page session
const memoryCache = {}

// Track pending in-flight fetch promises to dedupe concurrent identical requests
const pendingFetches = {}

// Size thresholds for logging cache statistics (not limits)
const CACHE_SIZE_WARNING = 1000000 // 1MB
const CACHE_SIZE_LARGE = 5000000 // 5MB

// --- Cache API storage helpers ---

async function getCache() {
  return await caches.open(CACHE_NAME)
}

/**
 * Store data in Cache API with timestamp and TTL metadata.
 * Keys use fake URLs: https://cache/{cacheKey}
 */
async function cacheStore(cacheKey, data, timestamp, expiration = 0) {
  try {
    const cache = await getCache()
    const body = JSON.stringify(data)
    const response = new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Cache-Timestamp': String(timestamp),
        'X-Cache-Expiration': String(expiration)
      }
    })
    await cache.put(new Request(`${CACHE_URL_PREFIX}${cacheKey}`), response)
  } catch (error) {
    Logger.warning(`[Cache] Error storing ${cacheKey}: ${error.message}`)
  }
}

async function cacheRead(cacheKey) {
  try {
    const cache = await getCache()
    const response = await cache.match(new Request(`${CACHE_URL_PREFIX}${cacheKey}`))
    if (!response) return null
    const timestamp = Number(response.headers.get('X-Cache-Timestamp'))
    const expiration = Number(response.headers.get('X-Cache-Expiration') || '0')
    const data = await response.json()
    return { data, timestamp, expiration }
  } catch (error) {
    Logger.warning(`[Cache] Error reading ${cacheKey}: ${error.message}`)
    return null
  }
}

async function cacheDeleteKey(cacheKey) {
  try {
    const cache = await getCache()
    await cache.delete(new Request(`${CACHE_URL_PREFIX}${cacheKey}`))
  } catch (error) {
    Logger.warning(`[Cache] Error deleting ${cacheKey}: ${error.message}`)
  }
}

async function cacheGetAllKeys() {
  try {
    const cache = await getCache()
    const requests = await cache.keys()
    return requests.map(r => r.url.replace(CACHE_URL_PREFIX, ''))
  } catch (error) {
    Logger.warning(`[Cache] Error listing keys: ${error.message}`)
    return []
  }
}

async function cacheClearAll() {
  try {
    await caches.delete(CACHE_NAME)
  } catch (error) {
    Logger.warning(`[Cache] Error clearing all: ${error.message}`)
  }
}

// --- One-time migration from chrome.storage.local ---

function migrateFromChromeStorage() {
  try {
    chrome.storage.local.get(null, items => {
      const oldKeys = Object.keys(items).filter(k => k.startsWith(CACHE_PREFIX))
      if (oldKeys.length > 0) {
        chrome.storage.local.remove(oldKeys)
        Logger.info(`[Cache] Migrated: removed ${oldKeys.length} old chrome.storage.local entries`)
      }
    })
  } catch {
    // chrome.storage may not be available in all contexts
  }
}

// Run migration on load
migrateFromChromeStorage()

// --- Cache Service ---

const cacheService = {
  /**
   * Set arbitrary cache value (persistent storage)
   * @param {string} key
   * @param {any} data
   */
  async set(key, data, expiration = 0) {
    const cacheKey = `${CACHE_PREFIX}${key}`
    const timestamp = Date.now()
    try {
      memoryCache[cacheKey] = { data, timestamp }
      await cacheStore(cacheKey, data, timestamp, expiration)
      return true
    } catch (error) {
      Logger.warning(`Error setting cache for ${key}: ${error.message}`)
      return false
    }
  },

  /**
   * Get cached value with optional maxAge (ms). If the cached item is older
   * than maxAge, returns null.
   * @param {string} key
   * @param {number} [maxAge] max age in ms (optional)
   * @returns {Promise<any>} cached data or null
   */
  async get(key, maxAge = Infinity) {
    const cacheKey = `${CACHE_PREFIX}${key}`
    // Check memory first
    if (memoryCache[cacheKey]) {
      const item = memoryCache[cacheKey]
      if (Date.now() - item.timestamp <= maxAge) return item.data
      // expired in memory
      delete memoryCache[cacheKey]
      return null
    }
    // Check Cache API
    try {
      const item = await cacheRead(cacheKey)
      if (!item) return null
      const age = Date.now() - (item.timestamp || 0)
      if (age <= maxAge) {
        memoryCache[cacheKey] = { data: item.data, timestamp: item.timestamp }
        return item.data
      }
      return null
    } catch (error) {
      Logger.warning(`Error reading cache for ${key}: ${error.message}`)
      return null
    }
  },

  /**
   * Get data from cache or fetch it if not available.
   *
   * Negative results ({ _errorStatus }) returned from fetchFn are cached to
   * avoid repeated requests, but re-thrown on retrieval so consumers' catch
   * blocks still work.
   *
   * **Throws from fetchFn are NOT cached.** When fetchFn rejects (e.g.
   * ApiService's parseJsonResponse throws on empty/invalid-JSON bodies), the
   * next call re-fetches. This is intentional to avoid persisting garbage
   * responses; the trade-off is that a persistently-failing endpoint will hit
   * the network on every call until the underlying cause resolves.
   *
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch data if not in cache
   * @param {number} expiration - Cache expiration time in milliseconds
   * @param {boolean} useMemoryCache - Whether to use memory cache (default: true)
   * @returns {Promise<any>} The data
   */
  async getOrFetch(key, fetchFn, expiration = CACHE_EXPIRATION.MEDIUM, useMemoryCache = true) {
    const cacheKey = `${CACHE_PREFIX}${key}`

    // Try memory cache first (for current page session)
    if (useMemoryCache && memoryCache[cacheKey]) {
      const cachedItem = memoryCache[cacheKey]
      const now = Date.now()

      // Cap expiration for negative (error) results
      const isNegativeResult = cachedItem.data && cachedItem.data._errorStatus
      const effectiveExpiration = isNegativeResult ? Math.min(expiration, MAX_NEGATIVE_TTL) : expiration

      if (now - cachedItem.timestamp < effectiveExpiration) {
        // Re-throw cached negative results so consumers' catch blocks work
        if (isNegativeResult) {
          throw new Error(`API Error: ${cachedItem.data._errorStatus}`)
        }
        return cachedItem.data
      }
      // Memory cache expired, remove it
      delete memoryCache[cacheKey]
    }

    // Try Cache API
    try {
      const storageData = await cacheRead(cacheKey)

      if (storageData) {
        const now = Date.now()
        const timestamp = storageData.timestamp || 0

        // Cap expiration for negative (error) results
        const isNegativeResult = storageData.data && storageData.data._errorStatus
        const effectiveExpiration = isNegativeResult ? Math.min(expiration, MAX_NEGATIVE_TTL) : expiration

        if (now - timestamp < effectiveExpiration) {
          if (useMemoryCache) {
            memoryCache[cacheKey] = {
              data: storageData.data,
              timestamp: timestamp
            }
          }

          // Re-throw cached negative results so consumers' catch blocks work
          if (isNegativeResult) {
            throw new Error(`API Error: ${storageData.data._errorStatus}`)
          }

          const ageInDays = (now - timestamp) / (24 * 60 * 60 * 1000)
          const ageText = ageInDays < 0.001 ? 'just now' : ageInDays < 0.04 ? `${Math.round(ageInDays * 24 * 60)} minutes` : `${ageInDays.toFixed(1)} days`

          const itemDescription = key.includes('journalEntriesByDate')
            ? `journal entries for journal ${key.match(/journals\/(\d+)\/journalEntriesByDate/)?.[1] || 'unknown'}`
            : key.includes('journalStudents')
              ? `journal students for journal ${key.match(/journals\/(\d+)\/journalStudents/)?.[1] || 'unknown'}`
              : `data for ${key}`

          if (Logger.isDebugMode()) Logger.debug(`[Cache] HIT: ${itemDescription} (age: ${ageText})`)

          return storageData.data
        }
      }
    } catch (error) {
      // Re-throw cached negative results (API Error from above)
      if (error.message?.startsWith('API Error:')) throw error
      Logger.warning(`Error reading cache for ${key}:`, error)
    }

    // Cache miss or expired - fetch fresh data
    if (Logger.isDebugMode()) Logger.debug(`Fetching fresh data for ${key}`)

    // If there's already a pending fetch for this key, return its promise to dedupe
    if (pendingFetches[cacheKey]) {
      if (Logger.isDebugMode()) Logger.debug(`Joining pending fetch for ${key}`)
      return await pendingFetches[cacheKey]
    }

    // Start a new fetch and store the promise in pendingFetches
    const fetchPromise = (async() => {
      try {
        const data = await fetchFn()

        const timestamp = Date.now()
        const cacheItem = { data, timestamp }

        if (useMemoryCache) {
          memoryCache[cacheKey] = cacheItem
        }

        // Log warnings for very large items
        const serializedData = JSON.stringify(cacheItem)
        const dataSize = serializedData.length

        if (dataSize > CACHE_SIZE_LARGE) {
          Logger.warning(`Cache item for ${key} is very large (${Math.round(dataSize / 1024)}KB).`)
        } else if (dataSize > CACHE_SIZE_WARNING) {
          Logger.debug(`Cache item for ${key} is large (${Math.round(dataSize / 1024)}KB).`)
        }

        // Store in Cache API with TTL metadata
        const isNegativeResult = data && data._errorStatus
        const effectiveExpiration = isNegativeResult ? Math.min(expiration, MAX_NEGATIVE_TTL) : expiration
        await cacheStore(cacheKey, data, timestamp, effectiveExpiration)

        // Re-throw negative results so consumers' catch blocks work
        if (isNegativeResult) {
          throw new Error(`API Error: ${data._errorStatus}`)
        }

        return data
      } finally {
        delete pendingFetches[cacheKey]
      }
    })()

    pendingFetches[cacheKey] = fetchPromise

    return await fetchPromise
  },

  /**
   * Clear all API request caches
   * @returns {Promise<number>} Number of cache entries cleared
   */
  async clearCache() {
    const memoryKeysCount = Object.keys(memoryCache).length
    Object.keys(memoryCache).forEach(key => {
      delete memoryCache[key]
    })
    Object.keys(pendingFetches).forEach(key => {
      delete pendingFetches[key]
    })

    const storageKeysCount = (await cacheGetAllKeys()).length
    await cacheClearAll()

    const total = memoryKeysCount + storageKeysCount
    if (Logger.isDebugMode()) Logger.debug(`Cleared cache (${memoryKeysCount} memory + ${storageKeysCount} storage entries)`)
    return total
  },

  /**
   * Clear journal-related API request caches only
   * @param {number} journalId - Optional journal ID to clear cache for specific journal
   * @returns {Promise<number>} Number of cache entries cleared
   */
  async clearJournalCache(journalId = null) {
    // Clear memory cache
    const memoryKeysToRemove = []
    for (const key in memoryCache) {
      if (this.isJournalRelatedCache(key, journalId)) {
        memoryKeysToRemove.push(key)
        delete memoryCache[key]
      }
    }

    // Drop in-flight promises for the same scope so a post-edit fetch doesn't
    // repopulate cache with pre-edit data (matches the clearCache contract).
    Object.keys(pendingFetches).forEach(key => {
      if (this.isJournalRelatedCache(key, journalId)) {
        delete pendingFetches[key]
      }
    })

    // Clear Cache API entries
    const allKeys = await cacheGetAllKeys()
    let storageRemoved = 0
    for (const key of allKeys) {
      if (this.isJournalRelatedCache(key, journalId)) {
        await cacheDeleteKey(key)
        storageRemoved++
      }
    }

    if (Logger.isDebugMode()) {
      Logger.debug(`Cleared ${storageRemoved} journal cache entries from Cache API`)
      Logger.debug(`Cleared ${memoryKeysToRemove.length} journal cache entries from memory`)
    }
    return storageRemoved + memoryKeysToRemove.length
  },

  /**
   * Check if a cache key is journal-related (but not timetable-related)
   * @param {string} key - Cache key to check
   * @param {number} journalId - Optional journal ID to filter by
   * @returns {boolean} True if the cache key is journal-related
   */
  isJournalRelatedCache(key, journalId = null) {
    const cleanKey = key.replace(CACHE_PREFIX, '')

    const journalPatterns = ['journalEntriesByDate', 'journalEntry', 'journalStudents', '/journals/']
    const timetablePatterns = ['timetableEvents', 'timetable', '/schools/', '/teachers/']

    for (const pattern of timetablePatterns) {
      if (cleanKey.includes(pattern)) {
        return false
      }
    }

    let isJournalRelated = false
    for (const pattern of journalPatterns) {
      if (cleanKey.includes(pattern)) {
        isJournalRelated = true
        break
      }
    }

    if (isJournalRelated && journalId) {
      const journalIdPattern = `/journals/${journalId}/`
      return cleanKey.includes(journalIdPattern)
    }

    return isJournalRelated
  },

  /**
   * Evict expired entries from Cache API storage.
   * Uses the stored TTL per entry, falling back to VERY_LONG (24h).
   */
  async evictExpired() {
    const keys = await cacheGetAllKeys()
    let evicted = 0
    for (const key of keys) {
      const item = await cacheRead(key)
      if (!item) continue
      const ttl = item.expiration || CACHE_EXPIRATION.VERY_LONG
      if (Date.now() - item.timestamp > ttl) {
        await cacheDeleteKey(key)
        evicted++
      }
    }
    if (evicted > 0 && Logger.isDebugMode()) {
      Logger.debug(`[Cache] Evicted ${evicted} expired entries`)
    }
  },

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  async getStats() {
    const memoryStats = {
      count: Object.keys(memoryCache).length,
      size: 0,
      items: []
    }

    for (const key in memoryCache) {
      const serialized = JSON.stringify(memoryCache[key].data)
      const size = serialized.length
      memoryStats.size += size

      const cacheKey = key.replace(CACHE_PREFIX, '')
      memoryStats.items.push({
        key: cacheKey,
        size,
        timestamp: memoryCache[key].timestamp
      })
    }

    const storageStats = {
      count: 0,
      size: 0,
      items: []
    }

    const allKeys = await cacheGetAllKeys()
    for (const key of allKeys) {
      const item = await cacheRead(key)
      if (!item) continue
      const serialized = JSON.stringify(item.data)
      const size = serialized.length
      storageStats.size += size
      storageStats.count++

      const cacheKey = key.replace(CACHE_PREFIX, '')
      const ageInMinutes = item.timestamp ? Math.round((Date.now() - item.timestamp) / (60 * 1000)) : 0

      storageStats.items.push({
        key: cacheKey,
        size,
        ageInMinutes,
        timestamp: item.timestamp
      })
    }

    storageStats.items.sort((a, b) => b.size - a.size)

    return {
      memory: memoryStats,
      storage: storageStats,
      totalBytesInUse: storageStats.size
    }
  },

  EXPIRATION: CACHE_EXPIRATION
}

export { cacheService, CACHE_NAME }
