import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import HeaderSyncButtonFeature from '../../../src/features/header/HeaderSyncButtonFeature.js'
import { cacheService } from '../../../src/services/CacheService.js'

describe('HeaderSyncButtonFeature', () => {
  let feature
  let dom
  let mockChrome

  beforeEach(async () => {
    // Setup DOM
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="lang-buttons">
            <button>Est</button>
            <button>Eng</button>
          </div>
        </body>
      </html>
    `, { url: 'https://tahvel.edu.ee' })
    global.window = dom.window
    global.document = dom.window.document

    // Mock chrome.storage
    mockChrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get: mock((keys, callback) => {
            callback({
              OA_kriitApiBaseUrl: 'https://kriit.example.com',
              OA_kriitApiToken: 'test-token',
              OA_kriitEnabled: true
            })
          }),
          set: mock((items, callback) => {
            if (callback) callback()
          }),
          remove: mock((keys, callback) => {
            if (callback) callback()
          })
        }
      }
    }
    global.chrome = mockChrome

    // Clear cacheService memory cache to prevent leaks between tests
    await cacheService.clearCache()

    // Clear window.journalListSync
    delete global.window.journalListSync

    // Create feature instance
    feature = new HeaderSyncButtonFeature()

    // Mock API to prevent real network calls from #fetchSyncData.
    // /user returns a valid person so isTahvelAuthenticated() resolves true;
    // any other endpoint returns {} unless an individual test overrides.
    feature.api = {
      ...feature.api,
      _kriitInitPromise: Promise.resolve(),
      kriit: { enabled: false },
      tahvel: {
        get: mock(async (endpoint) => {
          if (endpoint === '/user') return { person: { id: 123 }, school: { id: 9 } }
          return {}
        }),
        baseUrl: 'https://tahvel.edu.ee/hois_back'
      }
    }
  })

  afterEach(() => {
    // Clean up intervals
    if (feature.checkInterval) {
      clearInterval(feature.checkInterval)
    }
    // Clean up click handler
    if (feature.clickHandler) {
      document.body.removeEventListener('click', feature.clickHandler)
    }
  })

  describe('constructor', () => {
    it('should create feature with correct name', () => {
      expect(feature.name).toBe('HeaderSyncButtonFeature')
    })

    it('should activate on all pages', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(true)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123')).toBe(true)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/')).toBe(true)
    })

    it('should require #lang-buttons selector', () => {
      expect(feature.requiredSelectors).toContain('#lang-buttons')
    })
  })

  describe('onActivate', () => {
    it('should create button in lang-buttons container', () => {
      feature.onActivate()

      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button).toBeTruthy()
      expect(button.textContent).toBe('Sünkroonimine vajalik')
    })

    it('should insert button before first language button', () => {
      feature.onActivate()

      const langButtons = document.getElementById('lang-buttons')
      const buttons = langButtons.querySelectorAll('button')
      expect(buttons[0].id).toBe('oa2-kriit-sync-header-button')
      expect(buttons[1].textContent).toBe('Est')
    })

    it('should set up click handler on document.body', () => {
      feature.onActivate()

      expect(feature.clickHandler).toBeTruthy()
    })

    it('should start sync checking interval', () => {
      feature.onActivate()

      expect(feature.checkInterval).toBeTruthy()
    })

    it('should hide button by default (no pending syncs)', () => {
      feature.onActivate()

      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.display).toBe('none')
    })
  })

  describe('button visibility', () => {
    beforeEach(() => {
      feature.onActivate()
    })

    it('should show button when differences exist', (done) => {
      // Set up pending syncs
      global.window.journalListSync = {
        differences: [{ id: 1, type: 'grade' }],
        newAssignments: {}
      }

      // Wait for interval to trigger visibility check (2 second interval)
      setTimeout(() => {
        const button = document.getElementById('oa2-kriit-sync-header-button')
        expect(button.style.display).toBe('inline-block')
        done()
      }, 2100)
    })

    it('should show button when new assignments exist', (done) => {
      global.window.journalListSync = {
        differences: [],
        newAssignments: { assignment1: {} }
      }

      setTimeout(() => {
        const button = document.getElementById('oa2-kriit-sync-header-button')
        expect(button.style.display).toBe('inline-block')
        done()
      }, 2100)
    })

    it('should hide button when no pending syncs', (done) => {
      global.window.journalListSync = {
        differences: [],
        newAssignments: {}
      }

      setTimeout(() => {
        const button = document.getElementById('oa2-kriit-sync-header-button')
        expect(button.style.display).toBe('none')
        done()
      }, 2100)
    })

    it('should hide button when journalListSync is undefined', (done) => {
      delete global.window.journalListSync

      setTimeout(() => {
        const button = document.getElementById('oa2-kriit-sync-header-button')
        expect(button.style.display).toBe('none')
        done()
      }, 2100)
    })
  })

  describe('fetchSyncData', () => {
    it('should load persisted sync results from cache when Kriit is enabled', async () => {
      feature.api.kriit.enabled = true
      feature.api._kriitInitPromise = null

      const cachedDifferences = [{ id: 1, type: 'grade' }]
      const cachedNewAssignments = { assignment1: {} }

      await cacheService.set('journalList_lastDifferences', cachedDifferences, 0, false)
      await cacheService.set('journalList_lastNewAssignments', cachedNewAssignments, 0, false)

      feature.isActive = true
      feature.onActivate()

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(global.window.journalListSync).toBeTruthy()
      expect(global.window.journalListSync.differences).toEqual(cachedDifferences)
      expect(global.window.journalListSync.newAssignments).toEqual(cachedNewAssignments)
    })

    it('should skip fetch when window.journalListSync already has data', async () => {
      feature.api.kriit.enabled = true

      // Pre-set window.journalListSync with data
      global.window.journalListSync = {
        differences: [{ id: 1 }],
        newAssignments: {}
      }

      feature.isActive = true
      feature.onActivate()

      await new Promise(resolve => setTimeout(resolve, 200))

      // The existing window data should remain unchanged
      expect(global.window.journalListSync.differences).toEqual([{ id: 1 }])
    })

    it('should not fetch when Kriit is disabled', async () => {
      feature.api.kriit.enabled = false

      feature.isActive = true
      feature.onActivate()

      await new Promise(resolve => setTimeout(resolve, 200))

      // window.journalListSync should not be set
      expect(global.window.journalListSync).toBeUndefined()
    })

    it('should run full sync check when cache is empty', async () => {
      feature.api.kriit.enabled = true
      feature.api.kriit.post = mock(async () => [{ subjectName: 'Math' }])
      feature.api._kriitInitPromise = null

      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/user') {
          return { person: { id: 123 }, school: { id: 9 } }
        }
        if (endpoint === '/journals') {
          return { content: [{ id: 101, nameEt: 'Journal' }], totalPages: 1 }
        }
        if (endpoint === '/journals/101') {
          return { nameEt: 'Journal', journalTeachers: [], studentGroups: [] }
        }
        if (endpoint === '/journals/101/journalEntry') {
          return { content: [] }
        }
        if (endpoint === '/journals/101/journalEntriesByDate') {
          return []
        }
        if (endpoint === '/journals/101/journalStudents') {
          return []
        }
        if (endpoint === '/students') {
          return { content: [] }
        }
        return {}
      })

      feature.isActive = true
      feature.onActivate()

      await new Promise(resolve => setTimeout(resolve, 500))

      // Should have called Kriit API via runKriitSyncCheck
      expect(feature.api.kriit.post).toHaveBeenCalledTimes(1)
      expect(global.window.journalListSync).toBeTruthy()
      expect(global.window.journalListSync.differences).toEqual([{ subjectName: 'Math' }])
    })

    it('should not call runKriitSyncCheck when cached results exist', async () => {
      feature.api.kriit.enabled = true
      feature.api.kriit.post = mock(async () => [])
      feature.api._kriitInitPromise = null

      const cachedDifferences = [{ id: 1, type: 'grade' }]
      await cacheService.set('journalList_lastDifferences', cachedDifferences, 0, false)

      feature.isActive = true
      feature.onActivate()

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(feature.api.kriit.post).not.toHaveBeenCalled()
      expect(global.window.journalListSync.differences).toEqual(cachedDifferences)
    })

    it('should skip /journals fetch when /user returns 403 (no Tahvel session)', async () => {
      feature.api.kriit.enabled = true
      feature.api.kriit.post = mock(async () => [])
      feature.api._kriitInitPromise = null

      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/user') {
          const err = new Error('API Error: 403 Forbidden')
          err.status = 403
          throw err
        }
        return {}
      })

      feature.isActive = true
      feature.onActivate()

      await new Promise(resolve => setTimeout(resolve, 200))

      // No /journals probe should have happened — that's the whole point
      const journalsCalls = feature.api.tahvel.get.mock.calls.filter(c => c[0] === '/journals')
      expect(journalsCalls.length).toBe(0)
      // And no Kriit sync, since we never even hit Kriit init
      expect(feature.api.kriit.post).not.toHaveBeenCalled()
      expect(global.window.journalListSync).toBeUndefined()
    })

    it('should not write to window.journalListSync if deactivated during sync', async () => {
      feature.api.kriit.enabled = true
      feature.api._kriitInitPromise = null

      feature.api.kriit.post = mock(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return [{ subjectName: 'Math' }]
      })

      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/user') return { person: { id: 123 }, school: { id: 9 } }
        if (endpoint === '/journals') return { content: [{ id: 101 }], totalPages: 1 }
        if (endpoint === '/journals/101') return { nameEt: 'Journal', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/101/journalEntry') return { content: [] }
        if (endpoint === '/journals/101/journalEntriesByDate') return []
        if (endpoint === '/journals/101/journalStudents') return []
        if (endpoint === '/students') return { content: [] }
        return {}
      })

      feature.isActive = true
      feature.onActivate()

      // Deactivate quickly before sync finishes
      await new Promise(resolve => setTimeout(resolve, 50))
      feature.isActive = false

      // Wait for the sync to complete
      await new Promise(resolve => setTimeout(resolve, 500))

      // window.journalListSync should NOT have been set since feature was deactivated
      expect(global.window.journalListSync).toBeUndefined()
    })
  })

  describe('button click', () => {
    it('should update location hash when clicked', () => {
      feature.onActivate()

      const button = document.getElementById('oa2-kriit-sync-header-button')

      // Track if hash was set (JSDOM's location.hash setter works)
      const originalHash = global.window.location.hash

      // Trigger click
      button.click()

      // Hash should have been updated
      expect(global.window.location.hash).not.toBe(originalHash)
      expect(global.window.location.hash).toContain('journals')
    })
  })

  describe('button styling', () => {
    beforeEach(() => {
      feature.onActivate()
    })

    it('should have orange background color', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.backgroundColor).toBe('rgb(255, 152, 0)')
    })

    it('should have white text color', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.color).toBe('white')
    })

    it('should have pointer cursor', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.cursor).toBe('pointer')
    })

    it('should have correct aria-label', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.getAttribute('aria-label')).toBe('Sünkroonimine vajalik')
    })

    it('should have width auto to prevent small box appearance', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.width).toBe('auto')
    })

    it('should have min-width fit-content for proper sizing', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.minWidth).toBe('fit-content')
    })

    it('should have height auto to prevent small box appearance', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.height).toBe('auto')
    })

    it('should have white-space nowrap to prevent text wrapping', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.whiteSpace).toBe('nowrap')
    })

    it('should have flex-shrink 0 to prevent flexbox shrinking', () => {
      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button.style.flexShrink).toBe('0')
    })
  })

  describe('onDeactivate', () => {
    beforeEach(() => {
      feature.onActivate()
    })

    it('should clear check interval', () => {
      const intervalId = feature.checkInterval
      feature.onDeactivate()

      expect(feature.checkInterval).toBeNull()
    })

    it('should remove click handler', () => {
      feature.onDeactivate()

      expect(feature.clickHandler).toBeNull()
    })

    it('should remove button from DOM', () => {
      feature.onDeactivate()

      const button = document.getElementById('oa2-kriit-sync-header-button')
      expect(button).toBeNull()
    })
  })

  describe('event delegation', () => {
    it('should handle clicks via event delegation', () => {
      feature.onActivate()

      const button = document.getElementById('oa2-kriit-sync-header-button')

      // Simulate click through event delegation
      const event = new dom.window.Event('click', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'target', { value: button })
      document.body.dispatchEvent(event)

      expect(global.window.location.hash).toContain('journals')
    })
  })

  describe('Angular re-render handling', () => {
    it('should query button from DOM each time', () => {
      feature.onActivate()

      const button1 = document.getElementById('oa2-kriit-sync-header-button')
      expect(button1).toBeTruthy()

      // Simulate Angular re-render by removing and re-adding
      button1.remove()

      // Manually re-create (simulating what Angular might do)
      const langButtons = document.getElementById('lang-buttons')
      const newButton = document.createElement('button')
      newButton.id = 'oa2-kriit-sync-header-button'
      newButton.textContent = 'Sünkroonimine vajalik'
      newButton.style.display = 'none'
      langButtons.insertBefore(newButton, langButtons.firstChild)

      // The feature should still be able to find and update it
      const button2 = document.getElementById('oa2-kriit-sync-header-button')
      expect(button2).toBeTruthy()
      expect(button2).not.toBe(button1)
    })

    it('should only have one sync button at a time', () => {
      feature.onActivate()

      // Should only be one button
      const buttons = document.querySelectorAll('#oa2-kriit-sync-header-button')
      expect(buttons.length).toBe(1)
    })
  })
})
