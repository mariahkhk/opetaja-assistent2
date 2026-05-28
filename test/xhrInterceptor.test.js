import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { JSDOM } from 'jsdom'

// Imports the REAL xhrInterceptor (its IIFE patches window.fetch + XMLHttpRequest
// at import time), then verifies that a failure in the cache-invalidation
// signalling path (notify -> postMessage) can never reject Tahvel's own request.

const JOURNAL_POST_URL = 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry'

describe('xhrInterceptor resilience', () => {
  let dom
  let savedWindow
  let savedXHR
  let savedFetch
  let nativeFetchCalls

  beforeAll(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://tahvel.edu.ee/' })

    savedWindow = global.window
    savedXHR = global.XMLHttpRequest
    savedFetch = global.fetch

    global.window = dom.window
    global.XMLHttpRequest = dom.window.XMLHttpRequest

    // The native fetch the interceptor will capture and delegate to.
    nativeFetchCalls = []
    dom.window.fetch = async (input, init) => {
      nativeFetchCalls.push({ input, init })
      return { ok: true, status: 200, statusText: 'OK', text: async () => '{}' }
    }

    // First import anywhere — runs the IIFE against the globals set above.
    await import('../src/xhrInterceptor.js')
  })

  afterAll(() => {
    global.window = savedWindow
    global.XMLHttpRequest = savedXHR
    global.fetch = savedFetch
  })

  beforeEach(() => {
    nativeFetchCalls.length = 0
  })

  test('non-GET fetch still resolves when postMessage throws', async () => {
    dom.window.postMessage = () => { throw new Error('postMessage boom') }

    const response = await dom.window.fetch(JOURNAL_POST_URL, { method: 'POST' })

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(nativeFetchCalls.length).toBe(1)
  })

  test('non-GET fetch notifies with the journal mutation message when postMessage works', async () => {
    const posted = []
    dom.window.postMessage = (message, origin) => { posted.push({ message, origin }) }

    const response = await dom.window.fetch(JOURNAL_POST_URL, { method: 'POST' })

    expect(response.ok).toBe(true)
    expect(posted.length).toBe(1)
    expect(posted[0].message).toEqual({ type: 'oa2:journalMutation', journalId: 123, method: 'POST' })
    expect(posted[0].origin).toBe('https://tahvel.edu.ee')
  })

  test('GET fetch passes through without notifying', async () => {
    const posted = []
    dom.window.postMessage = (message) => { posted.push(message) }

    const response = await dom.window.fetch(JOURNAL_POST_URL, { method: 'GET' })

    expect(response.ok).toBe(true)
    expect(posted.length).toBe(0)
  })
})
