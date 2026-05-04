import { describe, test, expect, beforeEach } from 'bun:test'
import { cryptoService } from '../../src/services/CryptoService.js'
import { restoreChromeMock } from '../setup.js'

describe('CryptoService', () => {
  beforeEach(() => {
    restoreChromeMock()
    cryptoService._reset()
  })

  test('encrypts and decrypts a string round-trip', async () => {
    const plaintext = 'student name with idcode 30000000001 and grade 4'
    const blob = await cryptoService.encrypt(plaintext)
    expect(typeof blob.iv).toBe('string')
    expect(typeof blob.ct).toBe('string')
    const decrypted = await cryptoService.decrypt(blob)
    expect(decrypted).toBe(plaintext)
  })

  test('ciphertext does not contain plaintext PII', async () => {
    const blob = await cryptoService.encrypt('Test PersonA 30000000001')
    expect(blob.ct).not.toContain('Test')
    expect(blob.ct).not.toContain('PersonA')
    expect(blob.ct).not.toContain('30000000001')
  })

  test('produces a fresh IV per call (same plaintext → different ciphertext)', async () => {
    const a = await cryptoService.encrypt('repeated input')
    const b = await cryptoService.encrypt('repeated input')
    expect(a.ct).not.toBe(b.ct)
    expect(a.iv).not.toBe(b.iv)
  })

  test('decrypting tampered ciphertext throws', async () => {
    const blob = await cryptoService.encrypt('payload')
    const ctBytes = atob(blob.ct).split('').map(c => c.charCodeAt(0))
    ctBytes[0] = ctBytes[0] ^ 0xff
    const tampered = { iv: blob.iv, ct: btoa(String.fromCharCode(...ctBytes)) }
    await expect(cryptoService.decrypt(tampered)).rejects.toThrow()
  })

  test('decrypting with wrong IV throws', async () => {
    const blob = await cryptoService.encrypt('payload')
    const wrongIv = btoa(String.fromCharCode(...new Uint8Array(12)))
    await expect(cryptoService.decrypt({ iv: wrongIv, ct: blob.ct })).rejects.toThrow()
  })

  test('handles unicode and long payloads', async () => {
    const plaintext = JSON.stringify({
      students: Array.from({ length: 100 }, (_, i) => ({
        name: `Õpilane ${i} Tõnisson`,
        idcode: `4910101010${i % 10}`,
        grade: 'A'
      }))
    })
    const blob = await cryptoService.encrypt(plaintext)
    const decrypted = await cryptoService.decrypt(blob)
    expect(decrypted).toBe(plaintext)
    expect(blob.ct).not.toContain('Õpilane')
    expect(blob.ct).not.toContain('Tõnisson')
  })

  test('migrates legacy AES key from OA_cacheKey to OA_cryptoCacheKey', async () => {
    cryptoService._reset()
    const legacyKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const exported = await crypto.subtle.exportKey('raw', legacyKey)
    const legacyB64 = btoa(String.fromCharCode(...new Uint8Array(exported)))

    await new Promise(r => global.chrome.storage.local.set({ OA_cacheKey: legacyB64 }, r))

    const blob = await cryptoService.encrypt('test')
    expect(typeof blob.iv).toBe('string')

    const stored = await new Promise(r => global.chrome.storage.local.get(['OA_cryptoCacheKey', 'OA_cacheKey'], r))
    expect(stored.OA_cryptoCacheKey).toBeTruthy()
    expect(stored.OA_cacheKey).toBeUndefined()
  })

  test('regenerates AES key when stored value is unusable', async () => {
    cryptoService._reset()
    await new Promise(r => global.chrome.storage.local.set({ OA_cryptoCacheKey: 'not-valid-base64-aes-key!@#' }, r))

    const blob = await cryptoService.encrypt('payload')
    const decrypted = await cryptoService.decrypt(blob)
    expect(decrypted).toBe('payload')
  })

  test('hash() produces deterministic output for the same input', async () => {
    cryptoService._reset()
    const a = await cryptoService.hash('key-input')
    const b = await cryptoService.hash('key-input')
    expect(a).toBe(b)
  })

  test('hash() produces different output for different inputs', async () => {
    cryptoService._reset()
    const a = await cryptoService.hash('input-a')
    const b = await cryptoService.hash('input-b')
    expect(a).not.toBe(b)
  })

  test('migrates legacy HMAC salt from OA_cacheKeySalt to OA_cryptoCacheSalt', async () => {
    cryptoService._reset()
    const legacySaltBytes = crypto.getRandomValues(new Uint8Array(32))
    const legacyB64 = btoa(String.fromCharCode(...legacySaltBytes))

    await new Promise(r => global.chrome.storage.local.set({ OA_cacheKeySalt: legacyB64 }, r))

    await cryptoService.hash('hello')
    const stored = await new Promise(r => global.chrome.storage.local.get(['OA_cryptoCacheSalt', 'OA_cacheKeySalt'], r))
    expect(stored.OA_cryptoCacheSalt).toBeTruthy()
    expect(stored.OA_cacheKeySalt).toBeUndefined()
  })

  test('regenerates HMAC salt when stored value is unusable', async () => {
    cryptoService._reset()
    await new Promise(r => global.chrome.storage.local.set({ OA_cryptoCacheSalt: '!@#not-valid' }, r))

    const result = await cryptoService.hash('input')
    expect(typeof result).toBe('string')
  })

  test('rotate() generates fresh keys and clears existing', async () => {
    cryptoService._reset()
    await cryptoService.encrypt('seed')
    const before = await new Promise(r => global.chrome.storage.local.get(['OA_cryptoCacheKey'], r))

    await cryptoService.rotate()
    const after = await new Promise(r => global.chrome.storage.local.get(['OA_cryptoCacheKey'], r))

    expect(after.OA_cryptoCacheKey).not.toBe(before.OA_cryptoCacheKey)
  })
})
