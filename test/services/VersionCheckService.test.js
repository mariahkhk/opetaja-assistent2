import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'

// Note: Due to limitations in mocking ES6 imports, we'll test the service behavior
// with the actual VERSION from version.js. The VERSION import is tested implicitly
// through the service methods.

describe('VersionCheckService', () => {
  let mockChrome
  let mockLogger
  let dom
  let VersionCheckService
  let versionCheckService

  beforeEach(async () => {
    // Setup DOM
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    global.document = dom.window.document
    global.window = dom.window

    // Mock Logger
    mockLogger = {
      debug: mock(() => {}),
      error: mock(() => {}),
      warning: mock(() => {}),
      info: mock(() => {})
    }

    // Mock chrome API
    mockChrome = {
      storage: {
        sync: {
          get: mock(() => Promise.resolve({
            OA_kriitEnabled: true,
            OA_kriitApiBaseUrl: 'https://kriit.vikk.ee'
          }))
        }
      },
      runtime: {
        sendMessage: mock(() =>
          Promise.resolve({
            status: 'success',
            data: {
              data: {
                commitId: '495bd153759d078b03eecf9dc01dd1a67eaf6868',
                shortCommitId: '495bd15',
                updatedAt: '2025-10-17 07:00:00',
                updatedBy: 'github-actions'
              }
            }
          })
        )
      }
    }
    global.chrome = mockChrome

    // Import VersionCheckService after mocks are set up
    // We need to reimport to get a fresh instance
    const module = await import('../../src/services/VersionCheckService.js')
    VersionCheckService = module.default.constructor
    versionCheckService = new VersionCheckService()
  })

  describe('getLocalVersion', () => {
    test('should return VERSION and cache it', async () => {
      const version1 = await versionCheckService.getLocalVersion()
      const version2 = await versionCheckService.getLocalVersion()

      expect(version1).toBeDefined()
      expect(version1.commitId).toBeDefined()
      expect(version1.shortCommitId).toBeDefined()
      expect(version1).toBe(version2) // Should return cached version
    })

    test('should have valid commit ID format', async () => {
      const version = await versionCheckService.getLocalVersion()

      expect(version.commitId).toMatch(/^[a-f0-9]{40}$/)
      expect(version.shortCommitId).toMatch(/^[a-f0-9]{7}$/)
    })
  })

  describe('getLatestVersion', () => {
    test('should return null when no API URL provided', async () => {
      const result = await versionCheckService.getLatestVersion('')

      expect(result).toBeNull()
    })

    test('should fetch version from Kriit API via background script', async () => {
      const version = await versionCheckService.getLatestVersion('https://kriit.vikk.ee')

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'kriitApiRequest',
        method: 'GET',
        url: 'https://kriit.vikk.ee/extensionversion',
        headers: { Accept: 'application/json' }
      })
      expect(version).toBeDefined()
      expect(version.commitId).toBe('495bd153759d078b03eecf9dc01dd1a67eaf6868')
    })

    test('should handle API error response', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'error',
          message: 'Network error'
        })
      )

      const version = await versionCheckService.getLatestVersion('https://kriit.vikk.ee')

      expect(version).toBeNull()
    })

    test('should handle exception during fetch', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.reject(new Error('Network failure'))
      )

      const version = await versionCheckService.getLatestVersion('https://kriit.vikk.ee')

      expect(version).toBeNull()
    })

    test('should extract data from Kriit response format', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: 'abc123def456',
              shortCommitId: 'abc123d'
            }
          }
        })
      )

      const version = await versionCheckService.getLatestVersion('https://kriit.vikk.ee')

      expect(version.commitId).toBe('abc123def456')
      expect(version.shortCommitId).toBe('abc123d')
    })

    test('should cache latest version', async () => {
      await versionCheckService.getLatestVersion('https://kriit.vikk.ee')

      expect(versionCheckService.latestVersion).toBeDefined()
      expect(versionCheckService.latestVersion.commitId).toBe('495bd153759d078b03eecf9dc01dd1a67eaf6868')
    })
  })

  describe('checkVersion - bypass conditions', () => {
    test('should skip check when Kriit integration is disabled', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.resolve({
          OA_kriitEnabled: false,
          OA_kriitApiBaseUrl: 'https://kriit.vikk.ee'
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
    })

    test('should skip check when no Kriit URL is configured', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.resolve({
          OA_kriitEnabled: true,
          OA_kriitApiBaseUrl: ''
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
    })

    test('should skip check for localhost URL', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.resolve({
          OA_kriitEnabled: true,
          OA_kriitApiBaseUrl: 'http://localhost:8000'
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
    })

    test('should skip check for 127.0.0.1 URL', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.resolve({
          OA_kriitEnabled: true,
          OA_kriitApiBaseUrl: 'http://127.0.0.1:8000'
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
    })

    test('should proceed with check for production URL', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.resolve({
          OA_kriitEnabled: true,
          OA_kriitApiBaseUrl: 'https://kriit.vikk.ee'
        })
      )

      // Mock to return same version (up to date)
      const localVersion = await versionCheckService.getLocalVersion()
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: localVersion.commitId,
              shortCommitId: localVersion.shortCommitId
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalled()
      expect(isOutdated).toBe(false)
    })
  })

  describe('checkVersion - version comparison', () => {
    test('should detect matching versions (up to date)', async () => {
      const localVersion = await versionCheckService.getLocalVersion()

      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: localVersion.commitId,
              shortCommitId: localVersion.shortCommitId
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
      expect(versionCheckService.isOutdated).toBe(false)
    })

    test('should detect outdated version', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              shortCommitId: 'aaaaaaa'
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(true)
      expect(versionCheckService.isOutdated).toBe(true)
    })

    test('should assume up to date if latest version cannot be fetched', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'error',
          message: 'API unavailable'
        })
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
    })

    test('should handle storage error gracefully', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.reject(new Error('Storage error'))
      )

      const isOutdated = await versionCheckService.checkVersion()

      expect(isOutdated).toBe(false)
    })
  })

  describe('showOutdatedModal', () => {
    test('should create modal overlay with correct styles', () => {
      versionCheckService.showOutdatedModal()

      const overlay = document.getElementById('oa2-outdated-modal-overlay')
      expect(overlay).not.toBeNull()
      expect(overlay.style.position).toBe('fixed')
      expect(overlay.style.zIndex).toBe('999999')
      expect(overlay.style.background).toBe('rgba(0, 0, 0, 0.8)')
    })

    test('should create modal content with Estonian text', () => {
      versionCheckService.showOutdatedModal()

      const title = document.querySelector('#oa2-outdated-modal h2')
      const message = document.querySelector('#oa2-outdated-modal p')
      const button = document.querySelector('#oa2-outdated-modal button')

      expect(title.textContent).toBe('Laiendus on aegunud')
      expect(message.innerHTML).toContain('Teie Õpetaja Assistent 2 laiendus on aegunud')
      expect(message.innerHTML).toContain('Palun värskendage laiendust')
      expect(button.textContent).toBe('Laadi leht uuesti')
    })

    test('should not show modal twice', () => {
      versionCheckService.showOutdatedModal()

      versionCheckService.showOutdatedModal()
      const allOverlays = document.querySelectorAll('#oa2-outdated-modal-overlay')

      expect(allOverlays.length).toBe(1)
      expect(versionCheckService.modalShown).toBe(true)
    })

    test('should have reload handler on button', () => {
      versionCheckService.showOutdatedModal()
      const button = document.querySelector('#oa2-outdated-modal button')

      // Verify button has onclick handler
      expect(button.onclick).toBeDefined()
      expect(typeof button.onclick).toBe('function')
    })

    test('should have blue button with hover effect', () => {
      versionCheckService.showOutdatedModal()
      const button = document.querySelector('#oa2-outdated-modal button')

      // Initial state
      expect(button.style.background).toBe('rgb(25, 118, 210)') // #1976d2 as RGB

      // Trigger hover
      button.onmouseover()
      expect(button.style.background).toBe('rgb(21, 101, 192)') // #1565c0 as RGB

      // Mouse out
      button.onmouseout()
      expect(button.style.background).toBe('rgb(25, 118, 210)')
    })

    test('should have red title', () => {
      versionCheckService.showOutdatedModal()
      const title = document.querySelector('#oa2-outdated-modal h2')

      expect(title.style.color).toBe('rgb(211, 47, 47)') // #d32f2f as RGB
    })
  })

  describe('checkAndNotify', () => {
    test('should show modal when version is outdated', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              shortCommitId: 'aaaaaaa'
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkAndNotify()

      expect(isOutdated).toBe(true)
      expect(document.getElementById('oa2-outdated-modal-overlay')).not.toBeNull()
    })

    test('should not show modal when version is up to date', async () => {
      const localVersion = await versionCheckService.getLocalVersion()
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: localVersion.commitId,
              shortCommitId: localVersion.shortCommitId
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkAndNotify()

      expect(isOutdated).toBe(false)
      expect(document.getElementById('oa2-outdated-modal-overlay')).toBeNull()
    })

    test('should not show modal when Kriit is disabled', async () => {
      mockChrome.storage.sync.get = mock(() =>
        Promise.resolve({
          OA_kriitEnabled: false,
          OA_kriitApiBaseUrl: 'https://kriit.vikk.ee'
        })
      )

      const isOutdated = await versionCheckService.checkAndNotify()

      expect(isOutdated).toBe(false)
      expect(document.getElementById('oa2-outdated-modal-overlay')).toBeNull()
    })
  })

  describe('isExtensionOutdated', () => {
    test('should return current outdated status', async () => {
      // Initially not outdated
      expect(versionCheckService.isExtensionOutdated()).toBe(false)

      // Make it outdated
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              shortCommitId: 'aaaaaaa'
            }
          }
        })
      )
      await versionCheckService.checkVersion()

      expect(versionCheckService.isExtensionOutdated()).toBe(true)
    })
  })

  describe('integration scenarios', () => {
    test('complete flow: outdated extension shows modal and blocks usage', async () => {
      // Simulate outdated extension
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: 'newercommitidaaaaaaaaaaaaaaaaaaaaaaaaaa',
              shortCommitId: 'newercm'
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkAndNotify()

      // Verify extension is marked as outdated
      expect(isOutdated).toBe(true)
      expect(versionCheckService.isExtensionOutdated()).toBe(true)

      // Verify modal is shown
      const modal = document.getElementById('oa2-outdated-modal-overlay')
      expect(modal).not.toBeNull()

      // Verify button has reload handler
      const button = document.querySelector('#oa2-outdated-modal button')
      expect(button.onclick).toBeDefined()
      expect(typeof button.onclick).toBe('function')
    })

    test('complete flow: up-to-date extension continues normally', async () => {
      const localVersion = await versionCheckService.getLocalVersion()
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.resolve({
          status: 'success',
          data: {
            data: {
              commitId: localVersion.commitId,
              shortCommitId: localVersion.shortCommitId
            }
          }
        })
      )

      const isOutdated = await versionCheckService.checkAndNotify()

      expect(isOutdated).toBe(false)
      expect(versionCheckService.isExtensionOutdated()).toBe(false)
      expect(document.getElementById('oa2-outdated-modal-overlay')).toBeNull()
    })

    test('complete flow: API failure allows extension to continue', async () => {
      mockChrome.runtime.sendMessage = mock(() =>
        Promise.reject(new Error('Network error'))
      )

      const isOutdated = await versionCheckService.checkAndNotify()

      // Fail-safe: assume up to date if cannot check
      expect(isOutdated).toBe(false)
      expect(document.getElementById('oa2-outdated-modal-overlay')).toBeNull()
    })
  })
})
