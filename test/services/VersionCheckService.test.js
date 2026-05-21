import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreChromeMock, restoreGlobalDOM } from '../setup.js'
import { DISMISS_KEY } from '../../src/services/VersionCheckService.js'

const MANIFEST_VERSION = '1.7.2'

describe('VersionCheckService', () => {
  let mockChrome
  let dom
  let versionCheckService

  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
    global.document = dom.window.document
    global.window = dom.window

    // Hybrid storage.local mock: callback-style (Logger.js's top-level
    // chrome.storage.local.get) + promise-style (VersionCheckService).
    mockChrome = {
      runtime: {
        getManifest: mock(() => ({ version: MANIFEST_VERSION }))
      },
      storage: {
        local: {
          get: mock((keys, callback) => {
            if (typeof callback === 'function') { callback({}); return }
            return Promise.resolve({})
          }),
          set: mock((items, callback) => {
            if (typeof callback === 'function') callback()
            return Promise.resolve()
          })
        }
      }
    }
    global.chrome = mockChrome

    const module = await import('../../src/services/VersionCheckService.js')
    versionCheckService = new module.default.constructor()
  })

  afterEach(() => {
    document.getElementById('oa2-update-modal')?.remove()
    restoreChromeMock()
    restoreGlobalDOM()
  })

  describe('checkForUpdate', () => {
    test('shows modal when no dismiss key is set', async () => {
      await versionCheckService.checkForUpdate()

      const modal = document.getElementById('oa2-update-modal')
      expect(modal).not.toBeNull()
      expect(modal.textContent).toContain(`Versioon ${MANIFEST_VERSION}`)
    })

    test('shows modal when dismissed version differs from manifest version', async () => {
      mockChrome.storage.local.get = mock(() =>
        Promise.resolve({ [DISMISS_KEY]: '1.7.1' })
      )

      await versionCheckService.checkForUpdate()

      expect(document.getElementById('oa2-update-modal')).not.toBeNull()
    })

    test('does NOT show modal when dismissed version matches manifest version', async () => {
      mockChrome.storage.local.get = mock(() =>
        Promise.resolve({ [DISMISS_KEY]: MANIFEST_VERSION })
      )

      await versionCheckService.checkForUpdate()

      expect(document.getElementById('oa2-update-modal')).toBeNull()
    })

    test('shows modal if storage.local read throws (graceful fallback)', async () => {
      mockChrome.storage.local.get = mock(() =>
        Promise.reject(new Error('storage not available'))
      )

      await versionCheckService.checkForUpdate()

      expect(document.getElementById('oa2-update-modal')).not.toBeNull()
    })

    test('is idempotent — second call does not stack a second modal', async () => {
      await versionCheckService.checkForUpdate()
      await versionCheckService.checkForUpdate()

      expect(document.querySelectorAll('#oa2-update-modal').length).toBe(1)
    })
  })

  describe('dismiss persistence', () => {
    test('clicking dismiss writes manifest version to storage.local', async () => {
      await versionCheckService.checkForUpdate()
      const modal = document.getElementById('oa2-update-modal')
      modal.querySelector('button').onclick()

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        [DISMISS_KEY]: MANIFEST_VERSION
      })
    })

    test('backdrop click also dismisses', async () => {
      await versionCheckService.checkForUpdate()
      const overlay = document.getElementById('oa2-update-modal')

      overlay.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

      expect(document.getElementById('oa2-update-modal')).toBeNull()
      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        [DISMISS_KEY]: MANIFEST_VERSION
      })
    })
  })
})
