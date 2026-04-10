import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { parseDsn, buildExceptionEvent, buildMessageEvent, parseStackTrace, serializeEnvelope } from '../../src/services/SentryService.js'

describe('SentryService', () => {
  describe('parseDsn', () => {
    test('should parse a valid Sentry DSN', () => {
      const result = parseDsn('https://abc123def456@o123456.ingest.sentry.io/789')
      expect(result).toEqual({
        publicKey: 'abc123def456',
        host: 'o123456.ingest.sentry.io',
        projectId: '789',
        envelopeUrl: 'https://o123456.ingest.sentry.io/api/789/envelope/'
      })
    })

    test('should parse DSN with different host formats', () => {
      const result = parseDsn('https://aabbcc@sentry.example.com/42')
      expect(result).toEqual({
        publicKey: 'aabbcc',
        host: 'sentry.example.com',
        projectId: '42',
        envelopeUrl: 'https://sentry.example.com/api/42/envelope/'
      })
    })

    test('should return null for invalid DSN — missing https', () => {
      expect(parseDsn('http://abc123@sentry.io/1')).toBeNull()
    })

    test('should return null for invalid DSN — missing key', () => {
      expect(parseDsn('https://@sentry.io/1')).toBeNull()
    })

    test('should return null for invalid DSN — non-hex key', () => {
      expect(parseDsn('https://GHIJKL@sentry.io/1')).toBeNull()
    })

    test('should return null for invalid DSN — missing project id', () => {
      expect(parseDsn('https://abc123@sentry.io/')).toBeNull()
    })

    test('should return null for empty string', () => {
      expect(parseDsn('')).toBeNull()
    })

    test('should return null for non-string input', () => {
      expect(parseDsn(null)).toBeNull()
      expect(parseDsn(undefined)).toBeNull()
    })
  })

  describe('parseStackTrace', () => {
    test('should parse Chrome-style stack trace', () => {
      const stack = `Error: test error
    at functionName (http://example.com/file.js:10:5)
    at anotherFunction (http://example.com/other.js:20:15)`

      const frames = parseStackTrace(stack)

      // Sentry expects bottom-up order (most recent last)
      expect(frames).toHaveLength(2)
      expect(frames[0].function).toBe('anotherFunction')
      expect(frames[0].filename).toBe('http://example.com/other.js')
      expect(frames[0].lineno).toBe(20)
      expect(frames[0].colno).toBe(15)
      expect(frames[1].function).toBe('functionName')
      expect(frames[1].filename).toBe('http://example.com/file.js')
      expect(frames[1].lineno).toBe(10)
      expect(frames[1].colno).toBe(5)
    })

    test('should handle anonymous functions in stack trace', () => {
      const stack = `Error: test
    at http://example.com/file.js:5:3`

      const frames = parseStackTrace(stack)
      expect(frames).toHaveLength(1)
      expect(frames[0].function).toBe('?')
      expect(frames[0].lineno).toBe(5)
    })

    test('should return empty array for null/undefined stack', () => {
      expect(parseStackTrace(null)).toEqual([])
      expect(parseStackTrace(undefined)).toEqual([])
      expect(parseStackTrace('')).toEqual([])
    })
  })

  describe('buildExceptionEvent', () => {
    test('should build event with error details', () => {
      const error = new Error('test error')
      error.name = 'TypeError'
      const event = buildExceptionEvent(error)

      expect(event.event_id).toBeDefined()
      expect(event.event_id).toHaveLength(32)
      expect(event.platform).toBe('javascript')
      expect(event.level).toBe('error')
      expect(event.exception.values).toHaveLength(1)
      expect(event.exception.values[0].type).toBe('TypeError')
      expect(event.exception.values[0].value).toBe('test error')
    })

    test('should include context tags', () => {
      const error = new Error('test')
      const event = buildExceptionEvent(error, { tags: { handler: 'window.onerror' } })

      expect(event.tags.handler).toBe('window.onerror')
    })

    test('should include extra context without tags', () => {
      const error = new Error('test')
      const event = buildExceptionEvent(error, { tags: { foo: 'bar' }, source: 'file.js' })

      expect(event.extra.source).toBe('file.js')
      expect(event.extra.tags).toBeUndefined()
    })

    test('should include browser and extension contexts', () => {
      const error = new Error('test')
      const event = buildExceptionEvent(error)

      expect(event.contexts.browser).toBeDefined()
      expect(event.contexts.extension).toBeDefined()
    })
  })

  describe('buildMessageEvent', () => {
    test('should build message event', () => {
      const event = buildMessageEvent('Something went wrong', 'error')

      expect(event.event_id).toBeDefined()
      expect(event.level).toBe('error')
      expect(event.message.formatted).toBe('Something went wrong')
    })

    test('should support different levels', () => {
      const event = buildMessageEvent('A warning', 'warning')
      expect(event.level).toBe('warning')
    })
  })

  describe('serializeEnvelope', () => {
    test('should produce valid envelope format', () => {
      const event = {
        event_id: 'abc123',
        timestamp: '2025-01-01T00:00:00.000Z',
        platform: 'javascript',
        level: 'error',
        message: { formatted: 'test' }
      }

      const dsn = {
        publicKey: 'key123',
        host: 'sentry.example.com',
        projectId: '42'
      }

      const envelope = serializeEnvelope(event, dsn)
      const lines = envelope.split('\n')

      expect(lines).toHaveLength(3)

      // Header line
      const header = JSON.parse(lines[0])
      expect(header.event_id).toBe('abc123')
      expect(header.dsn).toBe('https://key123@sentry.example.com/42')

      // Item header
      const itemHeader = JSON.parse(lines[1])
      expect(itemHeader.type).toBe('event')
      expect(itemHeader.length).toBeGreaterThan(0)

      // Item body
      const itemBody = JSON.parse(lines[2])
      expect(itemBody.event_id).toBe('abc123')
      expect(itemBody.message.formatted).toBe('test')
    })

    test('should set correct byte length for item body', () => {
      const event = { event_id: 'x', message: { formatted: 'hello' } }
      const dsn = { publicKey: 'k', host: 'h', projectId: '1' }

      const envelope = serializeEnvelope(event, dsn)
      const lines = envelope.split('\n')

      const itemHeader = JSON.parse(lines[1])
      const itemBody = lines[2]
      const actualLength = new TextEncoder().encode(itemBody).length

      expect(itemHeader.length).toBe(actualLength)
    })
  })
})
