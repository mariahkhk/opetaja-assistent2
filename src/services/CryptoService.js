/**
 * Crypto Service - AES-GCM wrapper for cache encryption at rest.
 *
 * Generates a per-install 256-bit key on first run, stores raw bytes in
 * chrome.storage.local under OA_cryptoCacheKey (extension-scoped, page
 * origin cannot reach it). The imported key is cached in memory after first
 * load.
 * Encrypt produces a fresh 12-byte IV per call; AES-GCM auth tag protects
 * integrity for free, so tampering produces a decrypt failure rather than
 * silent corruption.
 *
 * Threat model: protects cached PII (names, idcodes, grades) from
 *   - other extensions running content scripts on tahvel.edu.ee
 *   - page-level XSS reading the Cache API directly.
 * Does NOT protect against:
 *   - disk forensics (the AES key sits in chrome.storage.local in plaintext
 *     base64 next to the encrypted Cache API entries; an attacker with disk
 *     read access recovers the key trivially)
 *   - a compromised extension build (which has the key by definition).
 */

import Logger from './Logger.js'

// Storage keys live OUTSIDE the `OA_cache_` namespace deliberately so that
// the version-change wipe (which sweeps `OA_cache_*` from chrome.storage)
// can never accidentally destroy the encryption keys. Renaming these to
// share the cache prefix would brick all encrypted entries on next page load.
const KEY_STORAGE_KEY = 'OA_cryptoCacheKey'
// HMAC_KEY_STORAGE_KEY is the storage slot for the HMAC-SHA256 key used to
// hash cache URLs. The storage name keeps "Salt" for backward-compatibility
// with installs that already wrote the value, but the value itself is a
// secret 256-bit HMAC key — NOT a public salt — and must be treated with
// the same confidentiality as the AES key. Don't expose, log, or copy it.
const HMAC_KEY_STORAGE_KEY = 'OA_cryptoCacheSalt'
const LEGACY_KEY_STORAGE_KEY = 'OA_cacheKey'
const LEGACY_HMAC_KEY_STORAGE_KEY = 'OA_cacheKeySalt'
const KEY_LENGTH_BITS = 256
const IV_LENGTH_BYTES = 12
const SALT_LENGTH_BYTES = 32

let keyPromise = null
let hmacKeyPromise = null

function bytesToBase64(bytes) {
  // Chunk the conversion — per-byte String.fromCharCode is O(n²) due to
  // string concatenation, while String.fromCharCode.apply over 32KB chunks
  // is ~10× faster on the >1MB cache entries CACHE_SIZE_LARGE warns about.
  // CHUNK MUST stay <= 65535 (lowest documented JS-engine .apply args limit;
  // V8's effective limit is higher but other engines bound at this floor).
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Note: the persist-then-re-read pattern below narrows but does not close
// the cross-tab first-run race. If two tabs both observe "no stored key"
// and both generate, their set→get sequences can interleave such that the
// loser's in-memory key isn't the one persisted. The loser's writes become
// unreadable next session, but cacheRead treats decrypt failure as a miss
// and refetches (CacheService.js:107-112), so user-visible impact is
// bounded. chrome.storage has no atomic compare-and-set primitive to fix
// this without IPC-mediated leader election.
async function loadOrGenerateKey() {
  let stored = await new Promise(resolve => {
    chrome.storage.local.get([KEY_STORAGE_KEY], result => {
      resolve(result?.[KEY_STORAGE_KEY])
    })
  })

  if (!stored) {
    // Migrate from the legacy storage key name (pre-rename) so existing
    // installs don't lose access to their cache on update.
    const legacy = await new Promise(resolve => {
      chrome.storage.local.get([LEGACY_KEY_STORAGE_KEY], result => {
        resolve(result?.[LEGACY_KEY_STORAGE_KEY])
      })
    })
    if (legacy && typeof legacy === 'string') {
      stored = legacy
      await new Promise(resolve => {
        chrome.storage.local.set({ [KEY_STORAGE_KEY]: legacy }, resolve)
      })
      await new Promise(resolve => {
        chrome.storage.local.remove([LEGACY_KEY_STORAGE_KEY], resolve)
      })
    }
  }

  if (stored && typeof stored === 'string') {
    try {
      return await crypto.subtle.importKey(
        'raw',
        base64ToBytes(stored),
        { name: 'AES-GCM', length: KEY_LENGTH_BITS },
        false,
        ['encrypt', 'decrypt']
      )
    } catch (error) {
      Logger.warning(`[CryptoService] Stored key is unusable, regenerating: ${error.message}`)
    }
  }

  const newKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    true,
    ['encrypt', 'decrypt']
  )
  const exported = await crypto.subtle.exportKey('raw', newKey)
  const exportedBase64 = bytesToBase64(new Uint8Array(exported))

  // Persist before returning, then re-read to detect a concurrent first-run
  // race where another context generated and stored a different key while we
  // were generating. If the persisted key isn't ours, import the persisted
  // bytes instead so all contexts converge on the same key.
  await new Promise(resolve => {
    chrome.storage.local.set({ [KEY_STORAGE_KEY]: exportedBase64 }, resolve)
  })
  const settled = await new Promise(resolve => {
    chrome.storage.local.get([KEY_STORAGE_KEY], result => resolve(result?.[KEY_STORAGE_KEY]))
  })
  const winningBytes = settled === exportedBase64 ? exported : base64ToBytes(settled)

  // Re-import non-extractable so the handle returned can't be exported by
  // callers via subtle.exportKey.
  return await crypto.subtle.importKey(
    'raw',
    winningBytes,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

function getKey() {
  if (!keyPromise) {
    keyPromise = loadOrGenerateKey().catch(error => {
      keyPromise = null
      throw error
    })
  }
  return keyPromise
}

// Same cross-tab race caveat as loadOrGenerateKey above. A salt mismatch
// is mostly equivalent to a key mismatch — entries hash to different URLs,
// so cache.match returns nothing → cache miss → refetch.
async function loadOrGenerateHmacKey() {
  let stored = await new Promise(resolve => {
    chrome.storage.local.get([HMAC_KEY_STORAGE_KEY], result => {
      resolve(result?.[HMAC_KEY_STORAGE_KEY])
    })
  })

  if (!stored) {
    const legacy = await new Promise(resolve => {
      chrome.storage.local.get([LEGACY_HMAC_KEY_STORAGE_KEY], result => {
        resolve(result?.[LEGACY_HMAC_KEY_STORAGE_KEY])
      })
    })
    if (legacy && typeof legacy === 'string') {
      stored = legacy
      await new Promise(resolve => {
        chrome.storage.local.set({ [HMAC_KEY_STORAGE_KEY]: legacy }, resolve)
      })
      await new Promise(resolve => {
        chrome.storage.local.remove([LEGACY_HMAC_KEY_STORAGE_KEY], resolve)
      })
    }
  }

  if (stored && typeof stored === 'string') {
    try {
      return await crypto.subtle.importKey(
        'raw',
        base64ToBytes(stored),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
    } catch (error) {
      Logger.warning(`[CryptoService] Stored salt is unusable, regenerating: ${error.message}`)
    }
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES))
  const saltBase64 = bytesToBase64(saltBytes)

  // Persist before returning; re-read so concurrent first-runs converge on the
  // same salt (otherwise each tab hashes URLs under its own salt and entries
  // written by the loser become unreadable next session).
  await new Promise(resolve => {
    chrome.storage.local.set({ [HMAC_KEY_STORAGE_KEY]: saltBase64 }, resolve)
  })
  const settled = await new Promise(resolve => {
    chrome.storage.local.get([HMAC_KEY_STORAGE_KEY], result => resolve(result?.[HMAC_KEY_STORAGE_KEY]))
  })
  const winningBytes = settled === saltBase64 ? saltBytes : base64ToBytes(settled)

  return await crypto.subtle.importKey(
    'raw',
    winningBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

function getHmacKey() {
  if (!hmacKeyPromise) {
    hmacKeyPromise = loadOrGenerateHmacKey().catch(error => {
      hmacKeyPromise = null
      throw error
    })
  }
  return hmacKeyPromise
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

const cryptoService = {
  /**
   * Encrypt a string using AES-GCM with a fresh random IV.
   * @param {string} plaintext
   * @returns {Promise<{iv: string, ct: string}>} base64-encoded IV and ciphertext
   */
  async encrypt(plaintext) {
    const key = await getKey()
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES))
    const data = new TextEncoder().encode(plaintext)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
    return {
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ct))
    }
  },

  /**
   * Decrypt a base64-encoded AES-GCM payload.
   * Throws if ciphertext, IV, or key is invalid (caller should treat as miss).
   * @param {{iv: string, ct: string}} input
   * @returns {Promise<string>} plaintext
   */
  async decrypt({ iv, ct }) {
    const key = await getKey()
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) },
      key,
      base64ToBytes(ct)
    )
    return new TextDecoder().decode(plaintext)
  },

  /**
   * HMAC-SHA256 of the input under a per-install salt. Deterministic for a
   * given install (same input → same output) but unguessable to anyone
   * without the salt. Used to hash cache keys and journal-scoped tags so
   * other extensions enumerating the Cache API see only opaque hex.
   * @param {string} input
   * @returns {Promise<string>} hex-encoded 256-bit MAC
   */
  async hash(input) {
    const key = await getHmacKey()
    const data = new TextEncoder().encode(input)
    const mac = await crypto.subtle.sign('HMAC', key, data)
    return bytesToHex(new Uint8Array(mac))
  },

  /**
   * Reset cached key/HMAC promises so the next call re-loads from storage.
   * Used by tests AND by `cacheService.clearCache()` after rotation to flush
   * in-memory keys.
   */
  _reset() {
    keyPromise = null
    hmacKeyPromise = null
  },

  /**
   * Rotate the persisted encryption + HMAC keys. Removes the stored values
   * and resets in-memory promises so the next encrypt/hash call regenerates
   * fresh keys. Used by `cacheService.clearCache()` so a previously-
   * compromised key can't decrypt entries written after the user-initiated
   * clear.
   */
  async rotate() {
    // Both halves of this method are part of the contract:
    //   1. Storage removal (the .remove call) forces re-load on the NEXT
    //      call from any context.
    //   2. The in-memory promise reset (keyPromise/hmacKeyPromise = null)
    //      forces re-load on THIS context immediately, without waiting for
    //      a reload.
    // `cacheService.clearCache()` relies on (2) so the calling tab converges
    // synchronously; if a future maintainer splits these halves, the calling
    // tab will keep encrypting under the now-removed key until reload.
    //
    // Remove the legacy storage keys too — otherwise `loadOrGenerateKey`'s
    // legacy migration silently re-imports the same bytes under the new name
    // on the next call, turning rotation into a no-op for legacy installs.
    await new Promise(resolve => {
      chrome.storage.local.remove(
        [KEY_STORAGE_KEY, HMAC_KEY_STORAGE_KEY, LEGACY_KEY_STORAGE_KEY, LEGACY_HMAC_KEY_STORAGE_KEY],
        resolve
      )
    })
    keyPromise = null
    hmacKeyPromise = null
  }
}

export { cryptoService }
