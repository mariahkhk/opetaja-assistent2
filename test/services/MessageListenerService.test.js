import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { restoreChromeMock } from '../setup.js'
import {
  setupKriitMessageListener,
  setupCustomMessageListener
} from '../../src/services/MessageListenerService.js'

const OWN_EXTENSION_ID = 'test-extension-id'

function captureListener() {
  let captured = null
  const addListener = mock(handler => { captured = handler })
  global.chrome = {
    runtime: { id: OWN_EXTENSION_ID, onMessage: { addListener } }
  }
  const ownSender = { id: OWN_EXTENSION_ID }
  return {
    addListener,
    getHandler: () => (msg) => captured(msg, ownSender),
    getRawHandler: () => captured
  }
}

function makeContext(overrides = {}) {
  return {
    api: {
      kriit: {
        authToken: '',
        enabled: false,
        setBaseUrl: mock(),
        setAuthToken: mock(),
        ...(overrides.kriit || {})
      }
    },
    isEnabled: false,
    removeSyncBanner: mock(),
    fetchJournalData: mock(),
    showMissingApiKeyBanner: mock(),
    ...overrides
  }
}

describe('MessageListenerService', () => {
  beforeEach(() => {
    restoreChromeMock()
  })

  describe('setupKriitMessageListener guards', () => {
    it('returns silently when chrome is undefined', () => {
      const original = global.chrome
      global.chrome = undefined
      expect(() => setupKriitMessageListener(makeContext())).not.toThrow()
      global.chrome = original
    })

    it('returns silently when chrome.runtime is missing', () => {
      global.chrome = {}
      expect(() => setupKriitMessageListener(makeContext())).not.toThrow()
    })

    it('returns silently when chrome.runtime.onMessage is missing', () => {
      global.chrome = { runtime: {} }
      expect(() => setupKriitMessageListener(makeContext())).not.toThrow()
    })

    it('registers a listener when chrome.runtime.onMessage is available', () => {
      const { addListener } = captureListener()
      setupKriitMessageListener(makeContext())
      expect(addListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('kriitEnabledChanged handling', () => {
    it('activates feature when enabled and authToken present', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: 'abc' } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitEnabledChanged', enabled: true })

      expect(ctx.api.kriit.enabled).toBe(true)
      expect(ctx.isEnabled).toBe(true)
      expect(ctx.removeSyncBanner).toHaveBeenCalledTimes(1)
      expect(ctx.fetchJournalData).toHaveBeenCalledTimes(1)
      expect(ctx.showMissingApiKeyBanner).not.toHaveBeenCalled()
    })

    it('shows missing-key banner when enabled but no authToken', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: '' } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitEnabledChanged', enabled: true })

      expect(ctx.api.kriit.enabled).toBe(true)
      expect(ctx.isEnabled).toBe(false)
      expect(ctx.showMissingApiKeyBanner).toHaveBeenCalledTimes(1)
      expect(ctx.fetchJournalData).not.toHaveBeenCalled()
    })

    it('deactivates feature when disabled', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: 'abc', enabled: true } })
      ctx.isEnabled = true
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitEnabledChanged', enabled: false })

      expect(ctx.api.kriit.enabled).toBe(false)
      expect(ctx.isEnabled).toBe(false)
      expect(ctx.removeSyncBanner).toHaveBeenCalledTimes(1)
      expect(ctx.fetchJournalData).not.toHaveBeenCalled()
    })
  })

  describe('kriitSettingsUpdated handling', () => {
    it('updates base URL when apiUrl is provided', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext()
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', apiUrl: 'https://kriit.example.com' })

      expect(ctx.api.kriit.setBaseUrl).toHaveBeenCalledWith('https://kriit.example.com')
    })

    it('does not update base URL when apiUrl is missing', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext()
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated' })

      expect(ctx.api.kriit.setBaseUrl).not.toHaveBeenCalled()
    })

    it('updates auth token when apiKey is a string (including empty string)', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext()
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', apiKey: 'token-123' })
      getHandler()({ action: 'kriitSettingsUpdated', apiKey: '' })

      expect(ctx.api.kriit.setAuthToken).toHaveBeenCalledWith('token-123')
      expect(ctx.api.kriit.setAuthToken).toHaveBeenCalledWith('')
    })

    it('skips auth token update when apiKey field is absent (URL-only update)', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext()
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', apiUrl: 'https://x' })

      expect(ctx.api.kriit.setAuthToken).not.toHaveBeenCalled()
    })

    it('updates enabled flag when present in message', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext()
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', enabled: true })
      expect(ctx.api.kriit.enabled).toBe(true)

      getHandler()({ action: 'kriitSettingsUpdated', enabled: false })
      expect(ctx.api.kriit.enabled).toBe(false)
    })

    it('leaves enabled flag untouched when not present', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { enabled: true } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', apiUrl: 'https://x' })

      expect(ctx.api.kriit.enabled).toBe(true)
    })

    it('activates feature when token present and enabled', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: 'abc', enabled: false } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', enabled: true })

      expect(ctx.isEnabled).toBe(true)
      expect(ctx.removeSyncBanner).toHaveBeenCalledTimes(1)
      expect(ctx.fetchJournalData).toHaveBeenCalledTimes(1)
    })

    it('shows missing-key banner when token cleared but Kriit still enabled', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: '', enabled: true } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated', apiKey: '' })

      expect(ctx.isEnabled).toBe(false)
      expect(ctx.removeSyncBanner).toHaveBeenCalledTimes(1)
      expect(ctx.showMissingApiKeyBanner).toHaveBeenCalledTimes(1)
      expect(ctx.fetchJournalData).not.toHaveBeenCalled()
    })

    it('does nothing extra when token absent and Kriit disabled', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: '', enabled: false } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'kriitSettingsUpdated' })

      expect(ctx.isEnabled).toBe(false)
      expect(ctx.removeSyncBanner).not.toHaveBeenCalled()
      expect(ctx.fetchJournalData).not.toHaveBeenCalled()
      expect(ctx.showMissingApiKeyBanner).not.toHaveBeenCalled()
    })
  })

  describe('unknown action', () => {
    it('ignores messages with unknown action', () => {
      const { getHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: 'abc' } })
      setupKriitMessageListener(ctx)

      getHandler()({ action: 'somethingElse' })

      expect(ctx.api.kriit.setBaseUrl).not.toHaveBeenCalled()
      expect(ctx.api.kriit.setAuthToken).not.toHaveBeenCalled()
      expect(ctx.removeSyncBanner).not.toHaveBeenCalled()
      expect(ctx.fetchJournalData).not.toHaveBeenCalled()
    })
  })

  describe('sender validation', () => {
    it('ignores messages from other extensions', () => {
      const { getRawHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: 'abc', enabled: true } })
      setupKriitMessageListener(ctx)

      getRawHandler()({ action: 'kriitEnabledChanged', enabled: true }, { id: 'malicious-extension' })

      expect(ctx.fetchJournalData).not.toHaveBeenCalled()
      expect(ctx.removeSyncBanner).not.toHaveBeenCalled()
    })

    it('processes messages from own extension', () => {
      const { getRawHandler } = captureListener()
      const ctx = makeContext({ kriit: { authToken: 'abc' } })
      setupKriitMessageListener(ctx)

      getRawHandler()({ action: 'kriitEnabledChanged', enabled: true }, { id: OWN_EXTENSION_ID })

      expect(ctx.fetchJournalData).toHaveBeenCalledTimes(1)
    })

    it('blocks custom listener messages from other extensions', () => {
      let captured = null
      global.chrome = {
        runtime: {
          id: OWN_EXTENSION_ID,
          onMessage: { addListener: mock(h => { captured = h }) }
        }
      }
      const handler = mock()
      setupCustomMessageListener(handler)

      captured({ action: 'test' }, { id: 'malicious-extension' })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('setupCustomMessageListener', () => {
    it('registers a wrapper handler with chrome.runtime.onMessage', () => {
      const { addListener } = captureListener()
      const handler = mock()
      setupCustomMessageListener(handler)
      expect(addListener).toHaveBeenCalledTimes(1)
    })
  })
})
