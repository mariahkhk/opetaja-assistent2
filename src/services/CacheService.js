/**
 * Cache Service - Handles caching of API requests to prevent duplicate calls
 *
 * Uses Cache API for persistent storage (no size limit) and in-memory cache
 * for fast same-page access. chrome.storage.local is only used for extension
 * settings, not for API response caching.
 */

import Logger from './Logger.js'
import { cryptoService } from './CryptoService.js'

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

// Cache keys MUST NOT end with `::p` or `::m` — those suffixes are appended
// by getOrFetch to mark the persist-tier in pendingFetches, and
// isJournalRelatedCache strips them before substring matching. A user-
// supplied key ending in `::p`/`::m` would silently collide with a different
// persist-tier entry's dedup slot.
function assertCacheKeyShape(key) {
  if (typeof key === 'string' && /::[pm]$/.test(key)) {
    throw new Error(`[Cache] Key '${key}' must not end with ::p or ::m (reserved for persist-tier dedup)`)
  }
}

/**
 * Extract the journal ID from a raw cache key. Returns null if the key isn't
 * journal-scoped. /teachers/ URLs are routed memory-only by ApiService's
 * _isHighPiiEndpoint and never reach cacheStore, so they're not in the
 * exclusion list. /timetable and /schools/ paths can carry a journal ID
 * substring without being journal-scoped — exclude them explicitly.
 */
function extractJournalIdFromKey(rawKey) {
  if (/(?:^|[/_])timetable|\/schools\//i.test(rawKey)) return null
  // Accept both `…/journals/123…` (production URLs) and `OA_cache_journals/123…`
  // (the cache-prefix joins the namespace marker with `_`, not `/`).
  const match = rawKey.match(/(?:^|[/_])journals\/(\d+)/)
  return match ? match[1] : null
}

async function buildCacheUrl(rawKey) {
  const hashed = await cryptoService.hash(rawKey)
  return `${CACHE_URL_PREFIX}${hashed}`
}

/**
 * Store data in Cache API with timestamp and TTL metadata.
 *
 * - Payload is AES-GCM encrypted (key in chrome.storage.local).
 * - Cache URL is HMAC-SHA256(salt, rawKey) so other extensions enumerating
 *   `cache.keys()` see only opaque hex — no journal IDs, no endpoint URLs.
 * - If the rawKey looks journal-scoped, X-Cache-Journal-Hash carries
 *   HMAC(salt, "journal:<id>") so clearJournalCache(id) can find matching
 *   entries without leaking which journal they belong to.
 */
async function cacheStore(rawKey, data, timestamp, expiration = 0) {
  // JSON.stringify(undefined) returns the literal string "undefined" — that
  // would land on disk and throw on read (JSON.parse fails). Skip with a
  // warning rather than persisting inconsistent state across memory/disk.
  if (data === undefined) {
    Logger.warning('[Cache] cacheStore called with undefined data — skipping persist')
    return false
  }
  try {
    const { iv, ct } = await cryptoService.encrypt(JSON.stringify(data))
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Cache-Timestamp': String(timestamp),
      'X-Cache-Expiration': String(expiration),
      'X-Cache-IV': iv
    }
    const journalId = extractJournalIdFromKey(rawKey)
    if (journalId) {
      headers['X-Cache-Journal-Hash'] = await cryptoService.hash(`journal:${journalId}`)
    }
    const response = new Response(ct, { headers })
    const cache = await getCache()
    await cache.put(new Request(await buildCacheUrl(rawKey)), response)
    return true
  } catch (error) {
    // Don't log rawKey: it contains the endpoint URL with journal/student IDs
    // which we don't want shipped to console (or, if logs ever go to Sentry,
    // off-device).
    Logger.warning(`[Cache] Error storing entry: ${error.message}`)
    return false
  }
}

async function cacheRead(rawKey) {
  try {
    const cache = await getCache()
    const response = await cache.match(new Request(await buildCacheUrl(rawKey)))
    if (!response) return null
    const timestamp = Number(response.headers.get('X-Cache-Timestamp'))
    const expiration = Number(response.headers.get('X-Cache-Expiration') || '0')
    const iv = response.headers.get('X-Cache-IV')
    if (!iv) {
      // Plaintext entry from a previous build; treat as miss so it gets
      // refetched and re-stored encrypted.
      return null
    }
    const ct = await response.text()
    const plaintext = await cryptoService.decrypt({ iv, ct })
    return { data: JSON.parse(plaintext), timestamp, expiration }
  } catch (error) {
    // Decrypt failure (corrupt entry, mismatched key after rotation/version
    // wipe, tampering) → cache miss. Never throw to caller; getOrFetch will
    // refetch. Distinguish AES-GCM decrypt rejections (debug-only — common
    // post-rotation) from infrastructure errors (warning — uncommon, real
    // problem worth surfacing).
    if (error?.name === 'OperationError' || error?.name === 'InvalidAccessError') {
      Logger.debug(`[Cache] Decrypt miss: ${error.message}`)
    } else {
      Logger.warning(`[Cache] Unexpected read error: ${error.message}`)
    }
    return null
  }
}

/**
 * Iterate every entry in the Cache API, exposing only the hashed URL plus
 * its headers. Used by evictExpired and journal-scoped clear — they only
 * need headers, so we skip cloning the response body.
 */
async function cacheIterateHeaders() {
  try {
    const cache = await getCache()
    const requests = await cache.keys()
    const out = []
    for (const request of requests) {
      const response = await cache.match(request)
      if (!response) continue
      const headers = {}
      response.headers.forEach((v, k) => { headers[k] = v })
      out.push({ request, headers })
    }
    return out
  } catch (error) {
    Logger.warning(`[Cache] Error iterating cache: ${error.message}`)
    return []
  }
}

/**
 * Iterate every entry in the Cache API, exposing the cloned Response body
 * alongside headers. Used by getStats which needs to read body sizes. The
 * clone is necessary because Response bodies can only be consumed once in
 * real browsers; without it, a future second-reader (or a future stats
 * caller) would fail in production while passing against the test mock.
 */
async function cacheIterateWithBodies() {
  try {
    const cache = await getCache()
    const requests = await cache.keys()
    const out = []
    for (const request of requests) {
      const response = await cache.match(request)
      if (!response) continue
      const headers = {}
      response.headers.forEach((v, k) => { headers[k] = v })
      out.push({
        request,
        response: typeof response.clone === 'function' ? response.clone() : response,
        headers
      })
    }
    return out
  } catch (error) {
    Logger.warning(`[Cache] Error iterating cache: ${error.message}`)
    return []
  }
}

async function cacheClearAll() {
  try {
    await caches.delete(CACHE_NAME)
    return true
  } catch (error) {
    Logger.warning(`[Cache] Error clearing all: ${error.message}`)
    return false
  }
}

// --- Cache wipe on extension version change ---
//
// Every extension update wipes the Cache API and any leftover
// chrome.storage.local cache entries. This means cache-format bumps,
// sanitiser tightening, and encryption-format changes all flush
// transparently — no per-change migration flag, no stale entries surviving
// past the schema they were written under. Cost is one full refetch on the
// first Tahvel page load after each release.

const VERSION_FLAG = 'OA_lastSeenExtensionVersion'
const WIPE_LOCK_KEY = 'OA_wipeInProgress'
const WIPE_LOCK_STALE_MS = 30_000

async function wipeOnVersionChange() {
  try {
    const currentVersion = chrome.runtime?.getManifest?.()?.version
    if (!currentVersion) return

    const stored = await new Promise(resolve => {
      chrome.storage.local.get([VERSION_FLAG], result => resolve(result?.[VERSION_FLAG]))
    })
    if (stored === currentVersion) return

    // First install OR upgrade-from-pre-feature-version: `stored` undefined
    // either way. Distinguish by probing for legacy `OA_cache_*` entries — if
    // present, this is an upgrade and the legacy sweep below should run; if
    // absent, it's a fresh install and we just stamp the flag.
    if (stored === undefined) {
      const hasLegacy = await new Promise(resolve => {
        chrome.storage.local.get(null, items =>
          resolve(Object.keys(items).some(k => k.startsWith(CACHE_PREFIX)))
        )
      })
      if (!hasLegacy) {
        await new Promise(resolve => {
          chrome.storage.local.set({ [VERSION_FLAG]: currentVersion }, resolve)
        })
        return
      }
      // else fall through — the wipe + legacy sweep below applies.
    }

    // Cross-tab wipe lock: if another tab is mid-wipe, defer AND wait. The
    // calling wipeReady gates public methods, so blocking here is exactly
    // what the lock is for — without the wait, deferred tabs proceed past
    // wipeReady while the lock-holder is still mid-caches.delete, defeating
    // the lock. Stale entries (>30s) are taken over so a hung peer doesn't
    // deadlock.
    const now = Date.now()
    const lockHolder = await new Promise(resolve => {
      chrome.storage.local.get([WIPE_LOCK_KEY], result => resolve(result?.[WIPE_LOCK_KEY] || 0))
    })
    if (now - lockHolder < WIPE_LOCK_STALE_MS) {
      const deadline = Date.now() + WIPE_LOCK_STALE_MS
      let peerSucceeded = false
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250))
        const state = await new Promise(resolve => {
          chrome.storage.local.get([VERSION_FLAG, WIPE_LOCK_KEY], r =>
            resolve({ flag: r?.[VERSION_FLAG], lock: r?.[WIPE_LOCK_KEY] || 0 })
          )
        })
        if (state.flag === currentVersion) {
          peerSucceeded = true
          break
        }
        // Lock cleared without flag write = peer crashed/errored. Fall
        // through to acquire the lock ourselves and retry.
        if (!state.lock || (Date.now() - state.lock) >= WIPE_LOCK_STALE_MS) break
      }
      if (peerSucceeded) return
      // Either the peer crashed or we timed out. Fall through and try to
      // acquire the lock ourselves below — this guarantees a stale wipe
      // gets retried rather than silently abandoned.
    }
    await new Promise(resolve => {
      chrome.storage.local.set({ [WIPE_LOCK_KEY]: now }, resolve)
    })
    // Release the lock on every exit path (success, early return, throw).
    const releaseLock = () => new Promise(resolve => {
      chrome.storage.local.remove(WIPE_LOCK_KEY, resolve)
    })

    // Wipe Cache API. Track success so we don't poison the version flag with
    // a "we wiped" signal when caches.delete actually rejected — otherwise the
    // next module load would skip wipe forever, leaving stale ciphertext on
    // disk under a now-rotated key.
    let cacheDeleted = true
    try {
      await caches.delete(CACHE_NAME)
    } catch (error) {
      cacheDeleted = false
      Logger.warning(`[Cache] caches.delete failed during version-change wipe: ${error.message}`)
    }

    // Sweep any legacy chrome.storage.local cache entries created before the
    // Cache API tier existed.
    await new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const oldKeys = Object.keys(items).filter(k => k.startsWith(CACHE_PREFIX))
        if (oldKeys.length === 0) return resolve()
        chrome.storage.local.remove(oldKeys, resolve)
      })
    })

    if (!cacheDeleted) {
      await releaseLock()
      return
    }

    // Rotate crypto keys on version change too — every release flushes data
    // AND key state, so a previously-leaked key from an older version can't
    // decrypt anything written by the new version. Lazy regen on next call.
    // Broadcast to peer Tahvel tabs so they drop their resolved key handles
    // (same reason clearCache does it — otherwise their next encrypt uses a
    // key that's no longer the persisted one).
    let rotated = true
    try {
      await cryptoService.rotate()
      try {
        chrome.runtime.sendMessage({ action: 'cryptoKeyRotated' }).catch(() => {})
      } catch {
        // Background may be unavailable at module load; not fatal.
      }
    } catch (error) {
      rotated = false
      Logger.warning(`[Cache] Key rotation during version-change wipe failed: ${error.message}`)
    }
    // Don't poison the version flag if rotation failed — leaving it unset
    // means the next module load retries the wipe + rotate; otherwise the
    // "every release flushes key state" guarantee silently fails.
    if (!rotated) {
      await releaseLock()
      return
    }

    await new Promise(resolve => {
      chrome.storage.local.set({ [VERSION_FLAG]: currentVersion }, resolve)
    })
    await releaseLock()

    if (stored) {
      Logger.info(`[Cache] Wiped on extension update ${stored} → ${currentVersion}`)
    }
  } catch (error) {
    // Best-effort lock release on uncaught error — chrome.storage may itself
    // be the failure source, but stale-time covers that case.
    try {
      await new Promise(r => chrome.storage.local.remove(WIPE_LOCK_KEY, r))
    } catch {
      // Lock release failure is non-fatal; the 30s stale-time covers it.
    }
    Logger.warning(`[Cache] Version-change wipe failed: ${error.message}`)
  }
}

// Hold the wipe promise so public methods can await it before touching the
// Cache API. Without this gate, cache writes that race the caches.delete are
// silently destroyed; callers see a write-then-miss with no error.
const wipeReady = wipeOnVersionChange()

// Exported for tests. Production code uses the wipeReady promise above; this
// export lets tests invoke the wipe manually after configuring mock state.
export { wipeOnVersionChange as _wipeOnVersionChangeForTests }

// --- Cache Service ---

const cacheService = {
  /**
   * Set a cache value.
   * @param {string} key
   * @param {any} data
   * @param {number} [expiration=0] TTL in ms. 0 means "no per-entry
   *   expiration"; on-disk eviction falls back to VERY_LONG (24h) in
   *   evictExpired. Note: `cacheService.get(key, maxAge)` honours `maxAge`
   *   regardless of stored TTL, but `cacheService.getOrFetch(key, fn, exp)`
   *   uses the passed expiration relative to the stored timestamp — passing
   *   0 there would always cache-miss. Pass an explicit expiration if any
   *   reader uses getOrFetch.
   * @param {boolean} [persist=true] When false, write only to in-memory cache
   *   (the entry dies on page reload). Use for high-PII data — student
   *   rosters, grades, anything that should not sit on disk.
   */
  async set(key, data, expiration = 0, persist = true) {
    assertCacheKeyShape(key)
    const cacheKey = `${CACHE_PREFIX}${key}`
    try {
      // For persisted writes, await wipeReady BEFORE the memory write too —
      // otherwise memory and disk can diverge across a peer rotation that
      // happens between the memory write and the disk encrypt.
      if (persist) await wipeReady
      const timestamp = Date.now()
      memoryCache[cacheKey] = { data, timestamp }
      if (persist) {
        const persisted = await cacheStore(cacheKey, data, timestamp, expiration)
        return persisted
      }
      return true
    } catch (error) {
      Logger.warning(`Error setting cache: ${error.message}`)
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
      await wipeReady
      const item = await cacheRead(cacheKey)
      if (!item) return null
      const age = Date.now() - (item.timestamp || 0)
      if (age <= maxAge) {
        memoryCache[cacheKey] = { data: item.data, timestamp: item.timestamp }
        return item.data
      }
      return null
    } catch (error) {
      Logger.warning(`Error reading cache: ${error.message}`)
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
   * @param {boolean} persist - When false, never read from or write to the
   *   Cache API. Memory-only entries die on page reload. Use for high-PII
   *   data — student rosters, grades, anything that should not sit on disk.
   * @returns {Promise<any>} The data
   */
  async getOrFetch(key, fetchFn, expiration = CACHE_EXPIRATION.MEDIUM, useMemoryCache = true, persist = true) {
    assertCacheKeyShape(key)
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

    // If another caller is already past the memory check, join their work to
    // avoid a duplicate fetch. Setting pendingFetches synchronously after the
    // memory miss closes the race that previously existed between cacheRead
    // and pending-fetch registration. Include `persist` in the dedup key so a
    // memory-only call can never be silently steered to disk by joining an
    // in-flight persistent twin (and vice-versa).
    //
    // Invariant: cache keys MUST NOT end with `::p` or `::m`. The suffix is
    // used as a persist-tier marker for the dedup map and `isJournalRelatedCache`
    // strips it when comparing. A key ending in `::p`/`::m` would round-trip
    // through that strip and lose its real persist tier.
    const dedupKey = `${cacheKey}::${persist ? 'p' : 'm'}`
    if (pendingFetches[dedupKey]) {
      if (Logger.isDebugMode()) Logger.debug(`Joining pending fetch for ${key}`)
      return await pendingFetches[dedupKey]
    }

    const work = (async() => {
      // Try Cache API (skip entirely for memory-only entries)
      try {
        if (persist) await wipeReady
        const storageData = persist ? await cacheRead(cacheKey) : null
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

            if (isNegativeResult) {
              throw new Error(`API Error: ${storageData.data._errorStatus}`)
            }

            const ageInDays = (now - timestamp) / (24 * 60 * 60 * 1000)
            const ageText = ageInDays < 0.001 ? 'just now' : ageInDays < 0.04 ? `${Math.round(ageInDays * 24 * 60)} minutes` : `${ageInDays.toFixed(1)} days`

            const itemDescription = key.includes('journalEntriesByDate')
              ? `journal entries for journal ${key.match(/journals\/(\d+)\/journalEntriesByDate/)?.[1] || 'unknown'}`
              : key.includes('journalStudents')
                ? `journal students for journal ${key.match(/journals\/(\d+)\/journalStudents/)?.[1] || 'unknown'}`
                : 'data'

            if (Logger.isDebugMode()) Logger.debug(`[Cache] HIT: ${itemDescription} (age: ${ageText})`)
            return storageData.data
          }
        }
      } catch (error) {
        // Re-throw cached negative results (API Error from above)
        if (error.message?.startsWith('API Error:')) throw error
        Logger.warning(`Error reading cache: ${error.message}`)
      }

      // Cache miss or expired - fetch fresh data
      if (Logger.isDebugMode()) Logger.debug(`Fetching fresh data for ${key}`)

      const data = await fetchFn()
      const timestamp = Date.now()
      const cacheItem = { data, timestamp }

      if (useMemoryCache) {
        memoryCache[cacheKey] = cacheItem
      }

      const serializedData = JSON.stringify(cacheItem)
      const dataSize = serializedData.length
      if (dataSize > CACHE_SIZE_LARGE) {
        Logger.warning(`Cache item for ${key} is very large (${Math.round(dataSize / 1024)}KB).`)
      } else if (dataSize > CACHE_SIZE_WARNING) {
        Logger.debug(`Cache item for ${key} is large (${Math.round(dataSize / 1024)}KB).`)
      }

      const isNegativeResult = data && data._errorStatus
      const effectiveExpiration = isNegativeResult ? Math.min(expiration, MAX_NEGATIVE_TTL) : expiration
      if (persist) {
        await cacheStore(cacheKey, data, timestamp, effectiveExpiration)
      }

      if (isNegativeResult) {
        throw new Error(`API Error: ${data._errorStatus}`)
      }
      return data
    })().finally(() => {
      delete pendingFetches[dedupKey]
    })

    pendingFetches[dedupKey] = work
    return await work
  },

  /**
   * Clear all API request caches
   * @returns {Promise<number>} Number of cache entries cleared
   */
  async clearCache() {
    await wipeReady
    const memoryKeysCount = Object.keys(memoryCache).length
    Object.keys(memoryCache).forEach(key => {
      delete memoryCache[key]
    })
    Object.keys(pendingFetches).forEach(key => {
      delete pendingFetches[key]
    })

    const storageKeysCount = (await cacheIterateHeaders()).length
    const wipeSucceeded = await cacheClearAll()

    // Rotate keys ONLY when the wipe succeeded — otherwise on-disk entries
    // remain encrypted under a key we just removed, leaving undecryptable
    // orphans (and `clearJournalCache` couldn't match them either, since the
    // HMAC salt would also be fresh).
    if (wipeSucceeded) {
      try {
        await cryptoService.rotate()
        // Tell other Tahvel tabs (which still have the old key resolved in
        // their CryptoService module-level promises) to drop their key handles
        // — otherwise their writes encrypt under the now-removed key and
        // become unreadable on next reload. The .catch suppresses a Promise
        // rejection if the extension context was just invalidated (the
        // try/catch only catches synchronous throws from the API).
        try {
          chrome.runtime.sendMessage({ action: 'cryptoKeyRotated' }).catch(() => {})
        } catch {
          // Background may be unavailable; not fatal — calling tab still rotated.
        }
      } catch (error) {
        Logger.warning(`[Cache] Error rotating crypto keys on clear: ${error.message}`)
      }
    }

    // Only count disk entries as "cleared" if the wipe actually succeeded —
    // otherwise the log/return value misleads callers into thinking N entries
    // were removed while they're still on disk.
    const reportedStorageCount = wipeSucceeded ? storageKeysCount : 0
    const total = memoryKeysCount + reportedStorageCount
    if (Logger.isDebugMode()) Logger.debug(`Cleared cache (${memoryKeysCount} memory + ${reportedStorageCount} storage entries)`)
    return total
  },

  /**
   * Clear journal-related API request caches only.
   *
   * Memory cache uses raw keys → keep the substring-based isJournalRelatedCache
   * check. Cache API uses HMAC'd URLs → match via the X-Cache-Journal-Hash
   * header instead (we tagged that header at write time).
   *
   * Disk side is **tagged-entries-only**: only entries whose rawKey contained
   * `journals/<digits>` got an X-Cache-Journal-Hash at write time. The journal
   * listing (`/journals?onlyMyJournals=true`) and synthetic keys like
   * `journalList_diffSummary` are NOT tagged and survive this call. They are
   * cleared instead by `wipeOnVersionChange()` on extension update and by the
   * 24h TTL eviction.
   *
   * @param {number} journalId - Optional journal ID to clear cache for specific journal
   * @returns {Promise<number>} Number of cache entries cleared
   */
  async clearJournalCache(journalId = null) {
    await wipeReady
    // Clear memory cache (raw keys still available)
    const memoryKeysToRemove = []
    for (const key in memoryCache) {
      if (this.isJournalRelatedCache(key, journalId)) {
        memoryKeysToRemove.push(key)
        delete memoryCache[key]
      }
    }

    // Clear pending-fetch dedup map for matching keys. A fetch already in
    // flight will still complete and write to memory + disk after this
    // returns — no AbortController plumbing here. A subsequent getOrFetch
    // call with the same key starts a new fetch instead of joining the
    // stale in-flight one.
    Object.keys(pendingFetches).forEach(key => {
      if (this.isJournalRelatedCache(key, journalId)) {
        delete pendingFetches[key]
      }
    })

    // Clear Cache API entries by header tag
    // Use explicit null/undefined check so a stray `0` or `''` doesn't fall
    // through to "clear everything tagged" mode and wipe unrelated journals.
    const targetHash = (journalId !== null && journalId !== undefined)
      ? await cryptoService.hash(`journal:${journalId}`)
      : null
    const cache = await getCache()
    const entries = await cacheIterateHeaders()
    let storageRemoved = 0
    for (const { request, headers } of entries) {
      const tag = headers['x-cache-journal-hash']
      if (!tag) continue
      if (targetHash === null || tag === targetHash) {
        await cache.delete(request)
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
    // Strip the cache prefix AND the optional ::p/::m persist-tier suffix that
    // pendingFetches uses for its dedup keys. Memory cache keys don't carry
    // the suffix; pendingFetches keys do — both should normalize to the same
    // shape before the substring/regex checks below.
    const cleanKey = key.replace(CACHE_PREFIX, '').replace(/::[pm]$/, '')

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

    if (isJournalRelated && journalId !== null && journalId !== undefined) {
      // Accept `/journals/<id>` followed by `/`, `?`, or end-of-string so this
      // matches the same keys extractJournalIdFromKey() tags at write time.
      // Without this, e.g. memory entry `GET_/journals/123` (no trailing slash)
      // is missed while its disk twin gets cleared via the HMAC tag.
      // Explicit nullish check (not truthiness) so `journalId=0` doesn't fall
      // through to "clear all journal-related" mode.
      // Escape regex metacharacters in journalId so a future caller passing
      // a non-numeric value (e.g. `'1|2'`) can't widen the match.
      const safeId = String(journalId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`/journals/${safeId}(?:/|\\?|$)`).test(cleanKey)
    }

    return isJournalRelated
  },

  /**
   * Evict expired entries from Cache API storage.
   * Uses the stored TTL per entry, falling back to VERY_LONG (24h).
   * Works directly off headers — no need to decrypt or know the raw key.
   */
  async evictExpired() {
    await wipeReady
    const cache = await getCache()
    const entries = await cacheIterateHeaders()
    let evicted = 0
    for (const { request, headers } of entries) {
      const timestamp = Number(headers['x-cache-timestamp'] || 0)
      const expiration = Number(headers['x-cache-expiration'] || 0)
      const ttl = expiration || CACHE_EXPIRATION.VERY_LONG
      // Treat missing/zero timestamps as immediately expired — an entry with
      // no readable timestamp is corrupted and can never be evicted by the
      // age check below otherwise.
      if (!timestamp || Date.now() - timestamp > ttl) {
        await cache.delete(request)
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
    await wipeReady
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

    // After key-hashing the raw URL is opaque — we can still report sizes,
    // ages, and hashed keys (e.g. for spotting fast-growing entries) but not
    // the original endpoint string.
    const entries = await cacheIterateWithBodies()
    for (const { request, response, headers } of entries) {
      const ct = await response.text()
      storageStats.size += ct.length
      storageStats.count++
      const timestamp = Number(headers['x-cache-timestamp'] || 0)
      const ageInMinutes = timestamp ? Math.round((Date.now() - timestamp) / (60 * 1000)) : 0
      storageStats.items.push({
        key: request.url.replace(CACHE_URL_PREFIX, ''),
        size: ct.length,
        ageInMinutes,
        timestamp
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
