import { describe, test, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { restoreChromeMock, restoreGlobalDOM } from '../setup.js'
import {
  sentryService,
  parseDsn,
  buildExceptionEvent,
  buildMessageEvent,
  parseStackTrace,
  serializeEnvelope,
  shouldSend,
  sendToAllDsns,
  flushPendingEvents,
  resetState,
  getState
} from '../../src/services/SentryService.js'

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

const TEST_DSN = parseDsn('https://abc123@sentry.example.com/42')

function withFakeFetch() {
  const calls = []
  const original = global.fetch
  global.fetch = mock(async (url, init) => {
    calls.push({ url, init })
    return new Response('', { headers: { 'content-type': 'text/plain' } })
  })
  return {
    calls,
    restore: () => { global.fetch = original }
  }
}

describe('SentryService — stateful API', () => {
  let fetchHook

  beforeEach(() => {
    restoreGlobalDOM()
    restoreChromeMock()
    resetState()
    fetchHook = withFakeFetch()
    global.chrome.runtime.id = 'extension-id'
    global.chrome.runtime.sendMessage = mock(async () => undefined)
    global.chrome.runtime.getManifest = mock(() => ({ version: '9.9.9', update_url: 'https://chrome.example' }))
  })

  afterEach(() => {
    fetchHook.restore()
    resetState()
  })

  describe('isActive', () => {
    it('returns false before init', () => {
      expect(sentryService.isActive()).toBe(false)
    })

    it('returns false after init when no DSNs were parsed', () => {
      resetState({ initialized: true, parsedDsns: [] })
      expect(sentryService.isActive()).toBe(false)
    })

    it('returns true after init with at least one DSN', () => {
      resetState({ initialized: true, parsedDsns: [TEST_DSN] })
      expect(sentryService.isActive()).toBe(true)
    })
  })

  describe('init', () => {
    it('parses DSNs and registers window error handlers', () => {
      const addEventListener = mock()
      window.addEventListener = addEventListener

      sentryService.init()

      const state = getState()
      expect(state.initialized).toBe(true)
      expect(state.parsedDsns.length).toBeGreaterThan(0)
      expect(addEventListener).toHaveBeenCalledWith('error', expect.any(Function))
      expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function))
    })

    it('detects production environment from manifest update_url', () => {
      window.addEventListener = mock()
      sentryService.init()
      expect(getState().environment).toBe('production')
      expect(getState().release).toBe('opetaja-assistent2@9.9.9')
    })

    it('detects development environment when manifest has no update_url', () => {
      window.addEventListener = mock()
      global.chrome.runtime.getManifest = mock(() => ({ version: '1.2.3' }))
      sentryService.init()
      expect(getState().environment).toBe('development')
    })

    it('exits early when called twice', () => {
      window.addEventListener = mock()
      sentryService.init()
      const calls = window.addEventListener.mock.calls.length
      sentryService.init()
      expect(window.addEventListener.mock.calls.length).toBe(calls)
    })

    it('marks initialized when SENTRY_DSNS produces an empty parse list', () => {
      const originalChrome = global.chrome
      global.chrome = undefined
      window.addEventListener = mock()

      resetState({ initialized: false, parsedDsns: [] })
      sentryService.init()
      expect(getState().initialized).toBe(true)
      global.chrome = originalChrome
    })

    it('window.onerror handler captures the event.error', () => {
      let onError = null
      window.addEventListener = mock((type, handler) => {
        if (type === 'error') onError = handler
      })
      sentryService.init()
      expect(onError).toBeTruthy()

      onError({ error: new Error('fail'), filename: 'a.js', lineno: 1, colno: 2, message: 'fail' })

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    it('window.onerror handler synthesises an Error when event.error is missing', () => {
      let onError = null
      window.addEventListener = mock((type, handler) => {
        if (type === 'error') onError = handler
      })
      sentryService.init()

      onError({ error: undefined, message: 'synthetic', filename: 'b.js', lineno: 5, colno: 3 })

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    it('unhandledrejection handler wraps non-Error reasons', () => {
      let onReject = null
      window.addEventListener = mock((type, handler) => {
        if (type === 'unhandledrejection') onReject = handler
      })
      sentryService.init()

      onReject({ reason: 'plain string reason' })
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    it('unhandledrejection handler passes through Error reasons', () => {
      let onReject = null
      window.addEventListener = mock((type, handler) => {
        if (type === 'unhandledrejection') onReject = handler
      })
      sentryService.init()

      onReject({ reason: new TypeError('typed') })
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    it('warns and swallows when initialization throws', () => {
      const originalAdd = window.addEventListener
      window.addEventListener = () => { throw new Error('cannot register') }
      const warn = console.warn
      let warned = false
      console.warn = (...args) => {
        if (args[0]?.includes?.('[SentryService]')) warned = true
      }

      expect(() => sentryService.init()).not.toThrow()
      expect(warned).toBe(true)

      window.addEventListener = originalAdd
      console.warn = warn
    })
  })

  describe('initBackground', () => {
    it('initializes without registering window listeners', () => {
      sentryService.initBackground()
      const state = getState()
      expect(state.initialized).toBe(true)
      expect(state.release).toBe('opetaja-assistent2@9.9.9')
    })

    it('exits early when already initialized', () => {
      resetState({ initialized: true })
      sentryService.initBackground()
      const manifestCalls = global.chrome.runtime.getManifest.mock.calls.length
      expect(manifestCalls).toBe(0)
    })

    it('warns and swallows when initialization throws', () => {
      global.chrome.runtime.getManifest = () => { throw new Error('manifest error') }
      const warn = console.warn
      let warned = false
      console.warn = (...args) => {
        if (args[0]?.includes?.('background')) warned = true
      }

      expect(() => sentryService.initBackground()).not.toThrow()
      expect(warned).toBe(true)

      console.warn = warn
    })
  })

  describe('captureException', () => {
    beforeEach(() => {
      resetState({ initialized: true, parsedDsns: [TEST_DSN] })
    })

    it('sends an error event for an Error', () => {
      sentryService.captureException(new Error('fail'))
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('treats non-Error values as messages', () => {
      sentryService.captureException('not an error')
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('buffers events when not yet initialized', () => {
      resetState({ initialized: false })
      sentryService.captureException(new Error('early'))
      expect(getState().pendingEvents).toHaveLength(1)
      expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    })

    it('drops buffered events past MAX_PENDING_EVENTS', () => {
      resetState({ initialized: false })
      for (let i = 0; i < 25; i++) sentryService.captureException(new Error(`e${i}`))
      expect(getState().pendingEvents).toHaveLength(20)
    })

    it('dedupes identical errors within the dedup window', () => {
      sentryService.captureException(new Error('same'))
      sentryService.captureException(new Error('same'))
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('warns and swallows when sending throws synchronously', () => {
      global.chrome.runtime.sendMessage = () => { throw new Error('boom') }
      const warn = console.warn
      let warned = false
      console.warn = (...args) => {
        if (args[0]?.includes?.('Failed to capture exception')) warned = true
      }

      expect(() => sentryService.captureException(new Error('x'))).not.toThrow()
      expect(warned).toBe(true)

      console.warn = warn
    })
  })

  describe('captureMessage', () => {
    beforeEach(() => {
      resetState({ initialized: true, parsedDsns: [TEST_DSN] })
    })

    it('sends a message event with default level "error"', () => {
      sentryService.captureMessage('something happened')
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('respects custom level', () => {
      sentryService.captureMessage('warn', 'warning')
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('buffers when not yet initialized', () => {
      resetState({ initialized: false })
      sentryService.captureMessage('early')
      expect(getState().pendingEvents).toHaveLength(1)
    })

    it('caps buffered events at MAX_PENDING_EVENTS', () => {
      resetState({ initialized: false })
      for (let i = 0; i < 25; i++) sentryService.captureMessage(`m${i}`)
      expect(getState().pendingEvents).toHaveLength(20)
    })

    it('warns and swallows when sending throws', () => {
      global.chrome.runtime.sendMessage = () => { throw new Error('boom') }
      const warn = console.warn
      let warned = false
      console.warn = (...args) => {
        if (args[0]?.includes?.('Failed to capture message')) warned = true
      }
      expect(() => sentryService.captureMessage('x')).not.toThrow()
      expect(warned).toBe(true)
      console.warn = warn
    })
  })

  describe('shouldSend', () => {
    beforeEach(() => resetState())

    it('returns true on first event', () => {
      expect(shouldSend('fp1')).toBe(true)
    })

    it('returns false for duplicate within the dedup window', () => {
      shouldSend('dup')
      expect(shouldSend('dup')).toBe(false)
    })

    it('returns false past the rate limit', () => {
      for (let i = 0; i < 10; i++) shouldSend(`fp-${i}`)
      expect(shouldSend('fp-11')).toBe(false)
    })

    it('resets the per-minute counter when the timer fires', () => {
      const originalSetTimeout = globalThis.setTimeout
      let scheduledCallback = null
      globalThis.setTimeout = (cb) => {
        scheduledCallback = cb
        return 1
      }

      shouldSend('first')
      expect(getState().eventsThisMinute).toBe(1)
      expect(scheduledCallback).toBeTruthy()

      scheduledCallback()
      expect(getState().eventsThisMinute).toBe(0)

      globalThis.setTimeout = originalSetTimeout
    })
  })

  describe('sendToAllDsns', () => {
    it('returns silently when chrome.runtime.id is missing', () => {
      resetState({ parsedDsns: [TEST_DSN] })
      global.chrome.runtime.id = undefined
      sendToAllDsns({ event_id: 'x' })
      expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled()
      expect(fetchHook.calls).toHaveLength(0)
    })

    it('uses fetch in service-worker context (no window)', () => {
      resetState({ parsedDsns: [TEST_DSN] })
      const originalWindow = global.window
      global.window = undefined

      sendToAllDsns({ event_id: 'x' })

      expect(fetchHook.calls).toHaveLength(1)
      expect(fetchHook.calls[0].url).toBe(TEST_DSN.envelopeUrl)
      expect(fetchHook.calls[0].init.method).toBe('POST')
      expect(fetchHook.calls[0].init.headers['Content-Type']).toBe('application/x-sentry-envelope')

      global.window = originalWindow
    })

    it('delegates to chrome.runtime.sendMessage in content-script context', () => {
      resetState({ parsedDsns: [TEST_DSN] })

      sendToAllDsns({ event_id: 'x' })

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
      const arg = global.chrome.runtime.sendMessage.mock.calls[0][0]
      expect(arg.action).toBe('sentryEvent')
      expect(arg.url).toBe(TEST_DSN.envelopeUrl)
      expect(arg.publicKey).toBe(TEST_DSN.publicKey)
      expect(typeof arg.envelope).toBe('string')
    })

    it('logs a warning when fetch in service-worker context rejects', async () => {
      resetState({ parsedDsns: [TEST_DSN] })
      const originalWindow = global.window
      global.window = undefined
      global.fetch = mock(() => Promise.reject(new Error('net down')))

      const warn = console.warn
      let warned = false
      console.warn = (...args) => {
        if (args[0]?.includes?.('Failed to send to')) warned = true
      }

      sendToAllDsns({ event_id: 'x' })
      await new Promise(r => setTimeout(r, 5))

      expect(warned).toBe(true)
      console.warn = warn
      global.window = originalWindow
    })

    it('logs a warning when content-script sendMessage rejects', async () => {
      resetState({ parsedDsns: [TEST_DSN] })
      global.chrome.runtime.sendMessage = mock(() => Promise.reject(new Error('runtime down')))
      const warn = console.warn
      let warned = false
      console.warn = (...args) => {
        if (args[0]?.includes?.('Failed to send to')) warned = true
      }

      sendToAllDsns({ event_id: 'x' })
      await new Promise(r => setTimeout(r, 5))

      expect(warned).toBe(true)
      console.warn = warn
    })
  })

  describe('flushPendingEvents', () => {
    it('clears pending events and exits when no DSNs are parsed', () => {
      resetState({ parsedDsns: [] })
      const state = getState()
      state.pendingEvents.push({ type: 'message', message: 'x', level: 'error', context: {} })
      flushPendingEvents()
      expect(getState().pendingEvents).toHaveLength(0)
    })

    it('replays buffered exception events', () => {
      resetState({ initialized: true, parsedDsns: [TEST_DSN] })
      const state = getState()
      state.pendingEvents.push({ type: 'exception', error: new Error('e'), context: {} })
      flushPendingEvents()
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
      expect(getState().pendingEvents).toHaveLength(0)
    })

    it('replays buffered message events', () => {
      resetState({ initialized: true, parsedDsns: [TEST_DSN] })
      const state = getState()
      state.pendingEvents.push({ type: 'message', message: 'pending', level: 'warning', context: {} })
      flushPendingEvents()
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    })
  })
})
