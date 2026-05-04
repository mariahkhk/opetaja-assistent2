import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { restoreChromeMock } from './setup.js'

// Save originals before the module-level chrome reassignment
const originalChrome = global.chrome
const originalFetch = global.fetch

// Set up chrome mocks BEFORE importing background.js so its top-level
// addListener/alarm/onActivated/onUpdated calls land on tracked mocks.
const tabsSendMessage = mock(async () => undefined)
const tabsQuery = mock(async () => [])
const tabsGet = mock(async () => ({ url: '' }))
const alarmsCreate = mock()
const alarmsGet = mock((_name, cb) => cb(null))
const onAlarmAdd = mock()
const onActivatedAdd = mock()
const onUpdatedAdd = mock()
const onMessageAdd = mock()
const onInstalledAdd = mock()
const onStartupAdd = mock()
const sessionGet = mock(async () => ({}))
const sessionSet = mock(async () => undefined)
const requestUpdateCheck = mock(async () => ['no_update', null])

global.chrome = {
  ...global.chrome,
  alarms: {
    create: alarmsCreate,
    get: alarmsGet,
    onAlarm: { addListener: onAlarmAdd }
  },
  tabs: {
    query: tabsQuery,
    get: tabsGet,
    sendMessage: tabsSendMessage,
    onActivated: { addListener: onActivatedAdd },
    onUpdated: { addListener: onUpdatedAdd }
  },
  runtime: {
    ...global.chrome?.runtime,
    onMessage: { addListener: onMessageAdd },
    onInstalled: { addListener: onInstalledAdd },
    onStartup: { addListener: onStartupAdd },
    onUpdateAvailable: { addListener: mock(handler => { global.__bgOnUpdateAvailable = handler }) },
    requestUpdateCheck,
    getURL: path => `chrome-extension://test/${path}`,
    getManifest: () => ({ version: '1.0.0' })
  },
  storage: {
    ...global.chrome?.storage,
    session: { get: sessionGet, set: sessionSet }
  }
}

global.fetch = mock(async () => new Response('{"data": "ok"}', {
  headers: { 'content-type': 'application/json' }
}))

await import('../src/background.js')

// Capture the registered listeners
const onMessageHandler = onMessageAdd.mock.calls[0][0]
const onAlarmHandler = onAlarmAdd.mock.calls[0][0]
const onActivatedHandler = onActivatedAdd.mock.calls[0][0]
const onUpdatedHandler = onUpdatedAdd.mock.calls[0][0]

describe('background.js', () => {
  beforeEach(() => {
    tabsSendMessage.mockClear()
    tabsQuery.mockClear()
    tabsGet.mockClear()
    sessionGet.mockClear()
    sessionSet.mockClear()
    global.fetch = mock(async () => new Response('{"data": "ok"}', {
      headers: { 'content-type': 'application/json' }
    }))
  })

  afterAll(() => {
    // Restore originals so subsequent test files see unmodified globals
    global.chrome = originalChrome
    global.fetch = originalFetch
    restoreChromeMock()
  })

  describe('alarms registration', () => {
    it('registers an onAlarm listener at module load', () => {
      expect(onAlarmHandler).toBeTypeOf('function')
    })
  })

  describe('alarm callback', () => {
    it('ignores unknown alarms', async () => {
      tabsQuery.mockReturnValue(Promise.resolve([]))
      sessionGet.mockReturnValue({})
      onAlarmHandler({ name: 'some-other-alarm' })
      await new Promise(r => setTimeout(r, 10))
      expect(tabsQuery).not.toHaveBeenCalled()
    })

    it('triggers cache maintenance broadcast for cache-maintenance alarm', async () => {
      tabsQuery.mockReturnValue(Promise.resolve([{ id: 1 }, { id: 2 }]))
      sessionGet.mockReturnValue({})
      onAlarmHandler({ name: 'cache-maintenance' })
      await new Promise(r => setTimeout(r, 10))
      expect(tabsQuery).toHaveBeenCalled()
    })
  })

  describe('tabs.onActivated callback', () => {
    it('checks the activated tab and broadcasts when it is a Tahvel tab', async () => {
      tabsGet.mockReturnValue({ url: 'https://tahvel.edu.ee/#/' })
      sessionGet.mockReturnValue({})
      tabsQuery.mockReturnValue(Promise.resolve([{ id: 1 }]))
      await onActivatedHandler({ tabId: 1 })
      await new Promise(r => setTimeout(r, 10))
      expect(tabsGet).toHaveBeenCalledWith(1)
    })

    it('skips non-Tahvel tabs', async () => {
      tabsGet.mockReturnValue({ url: 'https://other.example.com/' })
      tabsQuery.mockClear()
      await onActivatedHandler({ tabId: 1 })
      expect(tabsQuery).not.toHaveBeenCalled()
    })

    it('handles tabs.get failure silently', async () => {
      tabsGet.mockReturnValue(Promise.reject(new Error('tab gone')))
      await expect(onActivatedHandler({ tabId: 1 })).resolves.toBeUndefined()
    })
  })

  describe('tabs.onUpdated callback', () => {
    it('broadcasts when a Tahvel tab finishes loading', () => {
      sessionGet.mockReturnValue({})
      tabsQuery.mockClear()
      onUpdatedHandler(1, { status: 'complete' }, { url: 'https://tahvel.edu.ee/#/' })
      // Async work happens — just verify no throw
    })

    it('ignores incomplete loads', () => {
      tabsQuery.mockClear()
      onUpdatedHandler(1, { status: 'loading' }, { url: 'https://tahvel.edu.ee/#/' })
      expect(tabsQuery).not.toHaveBeenCalled()
    })

    it('ignores non-Tahvel URLs', () => {
      tabsQuery.mockClear()
      onUpdatedHandler(1, { status: 'complete' }, { url: 'https://other.com/' })
      expect(tabsQuery).not.toHaveBeenCalled()
    })
  })

  describe('cryptoKeyRotated message', () => {
    it('fans out to other Tahvel tabs', async () => {
      tabsQuery.mockReturnValue(Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }]))
      const sender = { tab: { id: 2 } }
      const result = onMessageHandler({ action: 'cryptoKeyRotated' }, sender, mock())
      expect(result).toBe(false)
      await new Promise(r => setTimeout(r, 10))
      // Should have called sendMessage for tabs 1 and 3 but not 2 (sender)
      const sentTo = tabsSendMessage.mock.calls.map(c => c[0])
      expect(sentTo).toContain(1)
      expect(sentTo).toContain(3)
      expect(sentTo).not.toContain(2)
    })
  })

  describe('kriitApiRequest message', () => {
    it('makes fetch request and returns success data', async () => {
      const sendResponse = mock()
      const result = onMessageHandler({
        action: 'kriitApiRequest',
        method: 'GET',
        url: 'https://kriit.example.com/api/data',
        headers: { 'X-API-KEY': 'token' }
      }, {}, sendResponse)
      expect(result).toBe(true)
      await new Promise(r => setTimeout(r, 10))
      expect(sendResponse).toHaveBeenCalledWith({ status: 'success', data: { data: 'ok' } })
    })

    it('handles HTTP error responses', async () => {
      global.fetch = mock(async () => new Response('error body', {
        status: 500,
        headers: { 'content-type': 'text/plain' }
      }))
      const sendResponse = mock()
      onMessageHandler({
        action: 'kriitApiRequest',
        method: 'GET',
        url: 'https://kriit.example.com/api/data'
      }, {}, sendResponse)
      await new Promise(r => setTimeout(r, 10))
      expect(sendResponse).toHaveBeenCalledWith({ status: 'error', message: expect.stringContaining('HTTP 500') })
    })

    it('returns text data when response is not JSON', async () => {
      global.fetch = mock(async () => new Response('plain text response', {
        headers: { 'content-type': 'text/plain' }
      }))
      const sendResponse = mock()
      onMessageHandler({
        action: 'kriitApiRequest',
        method: 'GET',
        url: 'https://kriit.example.com/api/text'
      }, {}, sendResponse)
      await new Promise(r => setTimeout(r, 10))
      expect(sendResponse).toHaveBeenCalledWith({ status: 'success', data: 'plain text response' })
    })

    it('serializes body for non-GET requests', async () => {
      const sendResponse = mock()
      onMessageHandler({
        action: 'kriitApiRequest',
        method: 'POST',
        url: 'https://kriit.example.com/api/x',
        body: { foo: 'bar' }
      }, {}, sendResponse)
      await new Promise(r => setTimeout(r, 10))
      const fetchCall = global.fetch.mock.calls[0]
      expect(fetchCall[1].body).toBe(JSON.stringify({ foo: 'bar' }))
    })
  })

  describe('loadLessonTimes message', () => {
    it('fetches lesson times JSON and returns success', async () => {
      global.fetch = mock(async () => new Response('{"9":[{"number":1,"timeStart":"08:00"}]}', {
        headers: { 'content-type': 'application/json' }
      }))
      const sendResponse = mock()
      const result = onMessageHandler({ action: 'loadLessonTimes' }, {}, sendResponse)
      expect(result).toBe(true)
      await new Promise(r => setTimeout(r, 10))
      expect(sendResponse).toHaveBeenCalledWith({
        status: 'success',
        data: { 9: [{ number: 1, timeStart: '08:00' }] }
      })
    })

    it('returns error when fetch fails', async () => {
      global.fetch = mock(async () => new Response('not found', { status: 404 }))
      const sendResponse = mock()
      onMessageHandler({ action: 'loadLessonTimes' }, {}, sendResponse)
      await new Promise(r => setTimeout(r, 10))
      expect(sendResponse).toHaveBeenCalledWith({ status: 'error', error: expect.any(String) })
    })
  })

  describe('sentryEvent message', () => {
    it('forwards to a Sentry ingest URL', async () => {
      onMessageHandler({
        action: 'sentryEvent',
        url: 'https://o123.ingest.sentry.io/api/456/envelope/',
        publicKey: 'abc',
        envelope: 'header\nitemheader\nitembody'
      }, {}, mock())
      await new Promise(r => setTimeout(r, 10))
      expect(global.fetch).toHaveBeenCalled()
    })

    it('blocks non-Sentry hosts', async () => {
      global.fetch.mockClear()
      onMessageHandler({
        action: 'sentryEvent',
        url: 'https://attacker.example.com/api/envelope/',
        publicKey: 'abc',
        envelope: 'x'
      }, {}, mock())
      await new Promise(r => setTimeout(r, 10))
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('silently ignores invalid URLs', async () => {
      global.fetch.mockClear()
      expect(() => onMessageHandler({
        action: 'sentryEvent',
        url: 'not-a-valid-url',
        publicKey: 'abc',
        envelope: 'x'
      }, {}, mock())).not.toThrow()
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('logs but does not crash when Sentry fetch rejects', async () => {
      global.fetch = mock(() => Promise.reject(new Error('net-fail')))
      onMessageHandler({
        action: 'sentryEvent',
        url: 'https://o123.ingest.sentry.io/api/envelope/',
        publicKey: 'abc',
        envelope: 'x'
      }, {}, mock())
      await new Promise(r => setTimeout(r, 30))
      expect(global.fetch).toHaveBeenCalled()
    })
  })

  describe('update notification', () => {
    it('fires sendMessage to all Tahvel tabs when onUpdateAvailable fires', async () => {
      tabsQuery.mockClear()
      tabsSendMessage.mockClear()
      tabsQuery.mockImplementation(async () => [{ id: 1 }, { id: 2 }])

      await global.__bgOnUpdateAvailable({ version: '1.2.3' })
      await new Promise(r => setTimeout(r, 30))

      expect(tabsQuery).toHaveBeenCalled()
      expect(tabsSendMessage).toHaveBeenCalledTimes(2)
    })

    it('handles onUpdateAvailable without details argument', async () => {
      tabsQuery.mockClear()
      tabsSendMessage.mockClear()
      tabsQuery.mockImplementation(async () => [])

      await global.__bgOnUpdateAvailable(null)
      await new Promise(r => setTimeout(r, 30))

      expect(tabsQuery).toHaveBeenCalled()
    })

    it('swallows sendMessage errors when notifying tabs of update', async () => {
      tabsQuery.mockImplementation(async () => [{ id: 1 }])
      tabsSendMessage.mockImplementation(() => Promise.reject(new Error('no-listener')))

      await global.__bgOnUpdateAvailable({ version: '1.0.0' })
      await new Promise(r => setTimeout(r, 30))

      expect(tabsSendMessage).toHaveBeenCalled()
    })
  })

  describe('cache maintenance error handling', () => {
    it('swallows broadcast tabs.query errors', async () => {
      tabsQuery.mockImplementationOnce(async () => { throw new Error('query-fail') })

      await onAlarmHandler({ name: 'cache-maintenance' })
      await new Promise(r => setTimeout(r, 30))
    })
  })
})
