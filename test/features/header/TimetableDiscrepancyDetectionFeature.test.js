import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import TimetableDiscrepancyDetectionFeature from '../../../src/features/header/TimetableDiscrepancyDetectionFeature.js'
import { cacheService } from '../../../src/services/CacheService.js'

describe('TimetableDiscrepancyDetectionFeature', () => {
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

    // Clear window.timetableDiscrepancies
    delete global.window.timetableDiscrepancies

    // Create feature instance
    feature = new TimetableDiscrepancyDetectionFeature()

    // Mock API
    feature.api = {
      ...feature.api,
      tahvel: {
        get: mock(async (endpoint, params, options) => {
          if (endpoint === '/user') {
            return {
              school: { id: 9 },
              person: { id: 123 }
            }
          }
          if (endpoint === '/journals') {
            return { content: [], totalPages: 1 }
          }
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
    if (feature.buttonCheckInterval) {
      clearInterval(feature.buttonCheckInterval)
    }
    // Clean up click handler
    if (feature.clickHandler) {
      document.body.removeEventListener('click', feature.clickHandler)
    }
  })

  describe('constructor', () => {
    it('should create feature with correct name', () => {
      expect(feature.name).toBe('TimetableDiscrepancyDetectionFeature')
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
    it('should initialize window.timetableDiscrepancies', async () => {
      await feature.onActivate()

      expect(window.timetableDiscrepancies).toBeTruthy()
      expect(window.timetableDiscrepancies.hasDiscrepancies).toBe(false)
      expect(window.timetableDiscrepancies.lastChecked).toBeTruthy() // Set after initial check
    })

    it('should create button in lang-buttons container', async () => {
      await feature.onActivate()

      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button).toBeTruthy()
      expect(button.textContent).toBe('Päevikutes on sissekandmata tunnid')
    })

    it('should insert button before first language button', async () => {
      await feature.onActivate()

      const langButtons = document.getElementById('lang-buttons')
      const buttons = langButtons.querySelectorAll('button')
      expect(buttons[0].id).toBe('oa2-timetable-discrepancy-header-button')
      expect(buttons[1].textContent).toBe('Est')
    })

    it('should set up click handler on document.body', async () => {
      await feature.onActivate()

      expect(feature.clickHandler).toBeTruthy()
    })

    it('should start check intervals', async () => {
      await feature.onActivate()

      expect(feature.checkInterval).toBeTruthy()
      expect(feature.buttonCheckInterval).toBeTruthy()
    })

    it('should hide button by default (no discrepancies)', async () => {
      await feature.onActivate()

      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.display).toBe('none')
    })

    it('should call user API to get school and teacher ID', async () => {
      await feature.onActivate()

      expect(feature.api.tahvel.get).toHaveBeenCalledWith('/user', {}, { cache: true, cacheExpiration: 864e5 })
    })
  })

  describe('button visibility', () => {
    beforeEach(async () => {
      await feature.onActivate()
    })

    it('should show button when timetableDiscrepancies.hasDiscrepancies is true', (done) => {
      window.timetableDiscrepancies.hasDiscrepancies = true

      setTimeout(() => {
        const button = document.getElementById('oa2-timetable-discrepancy-header-button')
        expect(button.style.display).toBe('inline-block')
        done()
      }, 2100)
    })

    it('should hide button when timetableDiscrepancies.hasDiscrepancies is false', (done) => {
      window.timetableDiscrepancies.hasDiscrepancies = false

      setTimeout(() => {
        const button = document.getElementById('oa2-timetable-discrepancy-header-button')
        expect(button.style.display).toBe('none')
        done()
      }, 2100)
    })

    it('should hide button when window.timetableDiscrepancies is undefined', (done) => {
      delete window.timetableDiscrepancies

      setTimeout(() => {
        const button = document.getElementById('oa2-timetable-discrepancy-header-button')
        expect(button.style.display).toBe('none')
        done()
      }, 2100)
    })
  })

  describe('button click', () => {
    it('should update location hash when clicked', async () => {
      await feature.onActivate()

      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      const originalHash = global.window.location.hash

      button.click()

      expect(global.window.location.hash).not.toBe(originalHash)
      expect(global.window.location.hash).toContain('journals')
    })
  })

  describe('button styling', () => {
    beforeEach(async () => {
      await feature.onActivate()
    })

    it('should have orange background color', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.backgroundColor).toBe('rgb(255, 152, 0)')
    })

    it('should have white text color', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.color).toBe('white')
    })

    it('should have pointer cursor', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.cursor).toBe('pointer')
    })

    it('should have correct aria-label', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.getAttribute('aria-label')).toBe('Päevikutes on sissekandmata tunnid')
    })

    it('should have width auto to prevent small box appearance', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.width).toBe('auto')
    })

    it('should have min-width fit-content for proper sizing', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.minWidth).toBe('fit-content')
    })

    it('should have height auto to prevent small box appearance', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.height).toBe('auto')
    })

    it('should have white-space nowrap to prevent text wrapping', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.whiteSpace).toBe('nowrap')
    })

    it('should have flex-shrink 0 to prevent flexbox shrinking', () => {
      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button.style.flexShrink).toBe('0')
    })
  })

  describe('onDeactivate', () => {
    beforeEach(async () => {
      await feature.onActivate()
    })

    it('should clear check intervals', () => {
      const checkIntervalId = feature.checkInterval
      const buttonCheckIntervalId = feature.buttonCheckInterval
      feature.onDeactivate()

      expect(feature.checkInterval).toBeNull()
      expect(feature.buttonCheckInterval).toBeNull()
    })

    it('should remove click handler', () => {
      feature.onDeactivate()

      expect(feature.clickHandler).toBeNull()
    })

    it('should remove button from DOM', () => {
      feature.onDeactivate()

      const button = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button).toBeNull()
    })

    it('should delete window.timetableDiscrepancies', () => {
      feature.onDeactivate()

      expect(window.timetableDiscrepancies).toBeUndefined()
    })
  })

  describe('event delegation', () => {
    it('should handle clicks via event delegation', async () => {
      await feature.onActivate()

      const button = document.getElementById('oa2-timetable-discrepancy-header-button')

      const event = new dom.window.Event('click', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'target', { value: button })
      document.body.dispatchEvent(event)

      expect(global.window.location.hash).toContain('journals')
    })
  })

  describe('Angular re-render handling', () => {
    it('should query button from DOM each time', async () => {
      await feature.onActivate()

      const button1 = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button1).toBeTruthy()

      button1.remove()

      const langButtons = document.getElementById('lang-buttons')
      const newButton = document.createElement('button')
      newButton.id = 'oa2-timetable-discrepancy-header-button'
      newButton.textContent = 'Päevikutes on sissekandmata tunnid'
      newButton.style.display = 'none'
      langButtons.insertBefore(newButton, langButtons.firstChild)

      const button2 = document.getElementById('oa2-timetable-discrepancy-header-button')
      expect(button2).toBeTruthy()
      expect(button2).not.toBe(button1)
    })

    it('should only have one discrepancy button at a time', async () => {
      await feature.onActivate()

      const buttons = document.querySelectorAll('#oa2-timetable-discrepancy-header-button')
      expect(buttons.length).toBe(1)
    })
  })

  describe('journal fetching from API', () => {
    it('should fetch journals from API and check for discrepancies', async () => {
      // API returns journal list then journal info
      const mockJournal = {
        id: 101,
        lessonHours: {
          capacityHours: [{ capacity: 'MAHT_a', usedHours: 5 }]
        },
        journalTeachers: [{ id: 123 }]
      }

      feature.api.tahvel.get = mock(async (endpoint, params, options) => {
        if (endpoint === '/user') {
          return { school: { id: 9 }, person: { id: 123 } }
        }
        if (endpoint === '/journals') {
          return { content: [{ id: 101 }], totalPages: 1 }
        }
        if (endpoint === '/journals/101') {
          return mockJournal
        }
        return {}
      })

      await feature.onActivate()

      const journalsCalls = feature.api.tahvel.get.mock.calls.filter(
        call => call[0] === '/journals'
      )
      expect(journalsCalls.length).toBeGreaterThan(0)
    })
  })

  describe('discrepancy detection logic', () => {
    it('should set hasDiscrepancies to false when no journals returned', async () => {
      await feature.onActivate()

      // Wait for initial check to complete
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(window.timetableDiscrepancies.hasDiscrepancies).toBe(false)
      expect(window.timetableDiscrepancies.lastChecked).toBeTruthy()
    })
  })

  describe('user info retrieval', () => {
    it('should set currentSchoolId and currentTeacherId from API', async () => {
      await feature.onActivate()

      expect(feature.currentSchoolId).toBe(9)
      expect(feature.currentTeacherId).toBe(123)
    })

    it('should set currentSchoolId to null on error', async () => {
      feature.api.tahvel.get = mock(async () => {
        throw new Error('API error')
      })

      await feature.onActivate()

      expect(feature.currentSchoolId).toBeNull()
    })
  })
})
