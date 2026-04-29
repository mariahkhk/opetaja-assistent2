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
})
