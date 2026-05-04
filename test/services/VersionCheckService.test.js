import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreChromeMock, restoreGlobalDOM } from '../setup.js'

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

    // Track message listeners
    messageListeners = []

    // Mock chrome API — preserve setup.js's storage.local so Logger.js's
    // top-level get() call still works when this is the first test file to
    // import VersionCheckService.
    mockChrome = {
      runtime: {
        onMessage: {
          addListener: mock(fn => messageListeners.push(fn))
        }
      },
      storage: {
        local: global.chrome?.storage?.local,
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
    const modal = document.getElementById('oa2-update-modal')
    if (modal) modal.remove()

    restoreChromeMock()
    restoreGlobalDOM()
  })

  describe('listenForUpdates', () => {
    test('should register a chrome.runtime.onMessage listener', () => {
      versionCheckService.listenForUpdates()

      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
      expect(messageListeners.length).toBe(1)
    })

    test('should show update when receiving updateAvailable message', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).not.toBeNull()
    })

    test('should ignore unrelated messages', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'someOtherAction' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).toBeNull()
    })
  })

  describe('dismiss persistence', () => {
    test('should persist version on dismiss', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const modal = document.getElementById('oa2-update-modal')
      const closeBtn = modal.querySelector('button')
      closeBtn.onclick()

      expect(mockChrome.storage.session.set).toHaveBeenCalledWith({
        oa2_update_banner_dismissed: '0.2.0'
      })
    })

    test('should not show update if previously dismissed for same version', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.resolve({ oa2_update_banner_dismissed: '0.2.0' })
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).toBeNull()
    })

    test('should show update for new version even if previous was dismissed', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.resolve({ oa2_update_banner_dismissed: '0.1.0' })
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).not.toBeNull()
    })

    test('should show update if dismiss key is not set', async () => {
      mockChrome.storage.session.get = mock(() => Promise.resolve({}))

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).not.toBeNull()
    })

    test('should show update if storage.session throws (graceful fallback)', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.reject(new Error('storage.session not available'))
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).not.toBeNull()
    })

    test('should not show update twice', async () => {
      versionCheckService.listenForUpdates()

      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.querySelectorAll('#oa2-update-modal').length).toBe(1)
    })
  })
})
