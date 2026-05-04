import { describe, it, expect } from 'bun:test'
import { parseJsonResponse } from '../../src/lib/parseJsonResponse.js'

describe('parseJsonResponse', () => {
  it('parses valid JSON object', () => {
    expect(parseJsonResponse('{"a":1}', 'https://example.com/api')).toEqual({ a: 1 })
  })

  it('parses valid JSON array', () => {
    expect(parseJsonResponse('[1,2,3]', 'https://example.com/api')).toEqual([1, 2, 3])
  })

  it('parses valid JSON primitives', () => {
    expect(parseJsonResponse('null', 'https://example.com/api')).toBeNull()
    expect(parseJsonResponse('true', 'https://example.com/api')).toBe(true)
    expect(parseJsonResponse('42', 'https://example.com/api')).toBe(42)
    expect(parseJsonResponse('"hello"', 'https://example.com/api')).toBe('hello')
  })

  it('throws when urlString is not a string', () => {
    expect(() => parseJsonResponse('{}', null)).toThrow(/non-string url \(object\)/)
    expect(() => parseJsonResponse('{}', 42)).toThrow(/non-string url \(number\)/)
    expect(() => parseJsonResponse('{}', undefined)).toThrow(/non-string url \(undefined\)/)
  })

  it('throws when text is not a string', () => {
    expect(() => parseJsonResponse(null, 'https://x')).toThrow(/non-string text \(object\)/)
    expect(() => parseJsonResponse(42, 'https://x')).toThrow(/non-string text \(number\)/)
    expect(() => parseJsonResponse(undefined, 'https://x')).toThrow(/non-string text \(undefined\)/)
  })

  it('throws on empty text', () => {
    expect(() => parseJsonResponse('', 'https://example.com/api'))
      .toThrow('API Error: empty response from https://example.com/api')
  })

  it('throws on whitespace-only text', () => {
    expect(() => parseJsonResponse('   \n\t  ', 'https://example.com/api'))
      .toThrow(/empty response from/)
  })

  it('throws on invalid JSON with original error attached as cause', () => {
    let thrown = null
    try {
      parseJsonResponse('not json', 'https://example.com/api')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeTruthy()
    expect(thrown.message).toContain('invalid JSON response from https://example.com/api')
    expect(thrown.cause).toBeInstanceOf(SyntaxError)
  })

  it('strips query string from URL in error messages', () => {
    expect(() => parseJsonResponse('', 'https://example.com/api?token=secret&id=1'))
      .toThrow('API Error: empty response from https://example.com/api')
  })

  it('strips fragment from URL in error messages', () => {
    expect(() => parseJsonResponse('', 'https://example.com/api#sensitive'))
      .toThrow('API Error: empty response from https://example.com/api')
  })

  it('strips both query and fragment from URL in error messages', () => {
    expect(() => parseJsonResponse('not json', 'https://example.com/api?x=1#frag'))
      .toThrow(/invalid JSON response from https:\/\/example\.com\/api:/)
  })

  it('attaches typed cause for non-string url', () => {
    let thrown = null
    try {
      parseJsonResponse('{}', 42)
    } catch (err) {
      thrown = err
    }
    expect(thrown.cause).toBeInstanceOf(TypeError)
  })

  it('attaches typed cause for non-string text', () => {
    let thrown = null
    try {
      parseJsonResponse(null, 'https://x')
    } catch (err) {
      thrown = err
    }
    expect(thrown.cause).toBeInstanceOf(TypeError)
  })
})
