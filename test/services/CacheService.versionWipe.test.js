import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { _wipeOnVersionChangeForTests, cacheService } from '../../src/services/CacheService.js'
import { cryptoService } from '../../src/services/CryptoService.js'
import { restoreChromeMock } from '../setup.js'

const VERSION_FLAG = 'OA_lastSeenExtensionVersion'

function setManifestVersion(version) {
  global.chrome.runtime.getManifest = mock(() => ({ version }))
}

describe('wipeOnVersionChange', () => {
  beforeEach(async () => {
    restoreChromeMock()
    if (global.caches._clear) global.caches._clear()
    cryptoService._reset()
    await cacheService.clearCache()
  })

  test('first install (no stored version): writes current version, no log', async () => {
    setManifestVersion('1.6.2')
    await _wipeOnVersionChangeForTests()
    const stored = global.chrome.storage.local._store[VERSION_FLAG]
    expect(stored).toBe('1.6.2')
  })

  test('first-install path with legacy OA_cache_* entries falls through to wipe', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store['OA_cache_legacy_a'] = 'old'
    global.chrome.storage.local._store['OA_cache_legacy_b'] = 'old'
    // VERSION_FLAG not set — simulates upgrading from a build before this feature shipped.

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store['OA_cache_legacy_a']).toBeUndefined()
    expect(global.chrome.storage.local._store['OA_cache_legacy_b']).toBeUndefined()
    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.7.0')
  })

  test('stored version matches current: no-op, version flag unchanged', async () => {
    setManifestVersion('1.6.2')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    await cacheService.set('keep-me', { v: 1 })
    expect(await cacheService.get('keep-me')).toEqual({ v: 1 })

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.6.2')
    expect(await cacheService.get('keep-me')).toEqual({ v: 1 })
  })

  test('stored version differs: wipes Cache API and persists new version', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    await cacheService.set('stale', { v: 1 })
    expect(await cacheService.get('stale')).toEqual({ v: 1 })

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.7.0')
    // Stored entry's still in memory cache (memory is per-context, not wiped
    // by the version-change wipe). The Cache API entry is gone — verify by
    // clearing memory and re-getting.
    const cache = await caches.open('oa2-api-cache')
    const requests = await cache.keys()
    expect(requests.length).toBe(0)
  })

  test('stored version differs: sweeps legacy OA_cache_* chrome.storage entries', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    global.chrome.storage.local._store['OA_cache_legacy_a'] = 'old-data'
    global.chrome.storage.local._store['OA_cache_legacy_b'] = 'old-data'
    global.chrome.storage.local._store['OA_kriitApiToken'] = 'should-survive'

    await _wipeOnVersionChangeForTests()

    expect(global.chrome.storage.local._store['OA_cache_legacy_a']).toBeUndefined()
    expect(global.chrome.storage.local._store['OA_cache_legacy_b']).toBeUndefined()
    expect(global.chrome.storage.local._store['OA_kriitApiToken']).toBe('should-survive')
  })

  test('caches.delete failure: version flag NOT written so wipe is retried next load', async () => {
    setManifestVersion('1.7.0')
    global.chrome.storage.local._store[VERSION_FLAG] = '1.6.2'
    const originalDelete = global.caches.delete
    global.caches.delete = mock(async () => { throw new Error('quota error') })

    try {
      await _wipeOnVersionChangeForTests()
    } finally {
      global.caches.delete = originalDelete
    }

    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBe('1.6.2')
  })

  test('no manifest available: no-op (test/dev environments)', async () => {
    global.chrome.runtime.getManifest = mock(() => ({}))
    await _wipeOnVersionChangeForTests()
    expect(global.chrome.storage.local._store[VERSION_FLAG]).toBeUndefined()
  })
})
