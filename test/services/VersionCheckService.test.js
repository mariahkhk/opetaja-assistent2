import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'

describe('VersionCheckService', () => {
  let mockChrome
  let messageListeners
  let dom
  let versionCheckService

  beforeEach(async () => {
    // Setup DOM
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
    global.document = dom.window.document
    global.window = dom.window

    // Track message listeners registered by the service
    messageListeners = []

    // Mock chrome API
    mockChrome = {
      runtime: {
        onMessage: {
          addListener: mock(fn => messageListeners.push(fn))
        }
      },
      storage: {
        session: {
          get: mock(() => Promise.resolve({})),
          set: mock(() => Promise.resolve())
        }
      }
    }
    global.chrome = mockChrome

    // Import fresh instance
    const module = await import('../../src/services/VersionCheckService.js')
    versionCheckService = new module.default.constructor()
  })

  afterEach(() => {
    // Clean up DOM
    const banner = document.getElementById('oa2-update-banner')
    if (banner) banner.remove()

    // Clean up globals
    delete global.chrome
    delete global.document
    delete global.window
  })

  describe('listenForUpdates', () => {
    test('should register a chrome.runtime.onMessage listener', () => {
      versionCheckService.listenForUpdates()

      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
      expect(messageListeners.length).toBe(1)
    })

    test('should show banner when receiving updateAvailable message', async () => {
      versionCheckService.listenForUpdates()

      // Simulate message from background script
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      // Wait for async dismiss check
      await new Promise(resolve => setTimeout(resolve, 10))

      const banner = document.getElementById('oa2-update-banner')
      expect(banner).not.toBeNull()
      expect(banner.textContent).toContain('v0.2.0')
    })

    test('should ignore unrelated messages', async () => {
      versionCheckService.listenForUpdates()

      messageListeners[0]({ action: 'someOtherAction' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-banner')).toBeNull()
    })

    test('should show banner without version when version is null', async () => {
      versionCheckService.listenForUpdates()

      messageListeners[0]({ action: 'updateAvailable' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const banner = document.getElementById('oa2-update-banner')
      expect(banner).not.toBeNull()
      expect(banner.textContent).not.toContain('(v')
      expect(banner.textContent).toContain('uuendus on saadaval')
    })
  })

  describe('banner display', () => {
    test('should show Estonian update message', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const banner = document.getElementById('oa2-update-banner')
      expect(banner.textContent).toContain('uuendus on saadaval')
      expect(banner.textContent).toContain('Chrome uuendab')
    })

    test('should insert banner before first child of body (not fixed position)', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const banner = document.getElementById('oa2-update-banner')
      expect(banner).not.toBeNull()
      expect(banner.style.position).not.toBe('fixed')
      expect(document.body.firstChild).toBe(banner)
    })

    test('should have close button that removes banner and persists dismiss', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const banner = document.getElementById('oa2-update-banner')
      const closeButton = banner.querySelector('button')
      expect(closeButton).not.toBeNull()

      closeButton.onclick()

      expect(document.getElementById('oa2-update-banner')).toBeNull()
      expect(mockChrome.storage.session.set).toHaveBeenCalledWith({
        oa2_update_banner_dismissed: true
      })
    })

    test('should not show banner twice', async () => {
      versionCheckService.listenForUpdates()

      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      const banners = document.querySelectorAll('#oa2-update-banner')
      expect(banners.length).toBe(1)
    })
  })

  describe('dismiss persistence', () => {
    test('should not show banner if previously dismissed in this session', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.resolve({ oa2_update_banner_dismissed: true })
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-banner')).toBeNull()
    })

    test('should show banner if dismiss key is not set', async () => {
      mockChrome.storage.session.get = mock(() => Promise.resolve({}))

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-banner')).not.toBeNull()
    })

    test('should show banner if storage.session throws (graceful fallback)', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.reject(new Error('storage.session not available'))
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-banner')).not.toBeNull()
    })
  })
})
