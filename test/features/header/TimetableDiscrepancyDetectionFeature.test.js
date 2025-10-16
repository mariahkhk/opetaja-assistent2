import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import TimetableDiscrepancyDetectionFeature from '../../../src/features/header/TimetableDiscrepancyDetectionFeature.js'

describe('TimetableDiscrepancyDetectionFeature', () => {
  let feature
  let dom
  let mockChrome

  beforeEach(() => {
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
      storage: {
        local: {
          get: mock((keys, callback) => {
            // Mock empty cache initially
            callback({})
          })
        },
        sync: {
          get: mock((keys, callback) => {
            callback({
              OA_kriitApiBaseUrl: 'https://kriit.example.com',
              OA_kriitApiToken: 'test-token',
              OA_kriitEnabled: true
            })
          })
        }
      }
    }
    global.chrome = mockChrome

    // Clear window.timetableDiscrepancies
    delete global.window.timetableDiscrepancies

    // Create feature instance
    feature = new TimetableDiscrepancyDetectionFeature()

    // Mock API
    feature.api = {
      tahvel: {
        get: mock(async (endpoint) => {
          if (endpoint === '/user') {
            return {
              school: { id: 9 },
              person: { id: 123 }
            }
          }
          return {}
        })
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

      expect(feature.api.tahvel.get).toHaveBeenCalledWith('/user', {}, { cache: true })
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

  describe('cache scanning', () => {
    it('should scan chrome.storage.local for cached journals', async () => {
      const mockJournal1 = {
        id: 101,
        lessonHours: {
          capacityHours: [
            { capacity: 'MAHT_a', usedHours: 5 }
          ]
        },
        journalTeachers: [{ id: 123 }]
      }

      mockChrome.storage.local.get = mock((keys, callback) => {
        callback({
          'OA_cache_GET_https://tahvel.edu.ee/hois_back/journals/101': {
            data: mockJournal1,
            timestamp: Date.now()
          }
        })
      })

      await feature.onActivate()

      // Check that chrome.storage.local.get was called
      expect(mockChrome.storage.local.get).toHaveBeenCalled()
    })
  })

  describe('discrepancy detection logic', () => {
    it('should set hasDiscrepancies to false when no journals in cache', async () => {
      mockChrome.storage.local.get = mock((keys, callback) => {
        callback({}) // Empty cache
      })

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

    it('should fallback to school ID 9 on error', async () => {
      feature.api.tahvel.get = mock(async () => {
        throw new Error('API error')
      })

      await feature.onActivate()

      expect(feature.currentSchoolId).toBe(9)
    })
  })
})
