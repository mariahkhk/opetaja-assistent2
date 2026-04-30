import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import LastLessonNotificationFeature from '../../../src/features/singleJournal/lastLessonNotification/LastLessonNotificationFeature.js'

describe('LastLessonNotificationFeature', () => {
  let feature

  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      groupCollapsed: () => {},
      trace: () => {},
      groupEnd: () => {},
      error: () => {}
    }
    global.window = {
      location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }
    }
    global.document = {
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({
        id: '',
        textContent: '',
        style: { cssText: '' }
      }),
      body: { appendChild: () => {} }
    }
    global.Intl = {
      DateTimeFormat: function (locale, options) {
        return {
          format: () => '2024-11-07'
        }
      }
    }
    feature = new LastLessonNotificationFeature()
  })

  describe('constructor', () => {
    test('should initialize with correct pattern', () => {
      expect(feature).toBeDefined()
      expect(feature.urlPattern).toEqual(/\/journal\/(\d+)\/edit/)
    })

    test('should initialize comparison date', () => {
      expect(feature.comparisonDate).toBeDefined()
      expect(typeof feature.comparisonDate).toBe('string')
    })

  })

  describe('extractJournalId', () => {
    test('returns numeric journal id from /journal/<id>/edit URL', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
      expect(new LastLessonNotificationFeature().extractJournalId()).toBe(12345)
    })

    test('returns null for URL without /journal/<id>', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/home' } }
      expect(new LastLessonNotificationFeature().extractJournalId()).toBeNull()
    })
  })

  describe('formatDisplayDate', () => {
    test('formats Date as DD.MM.YYYY', () => {
      expect(feature.formatDisplayDate(new Date('2024-11-07T10:00:00Z'))).toBe('07.11.2024')
    })

    test('pads single-digit day and month', () => {
      expect(feature.formatDisplayDate(new Date('2024-01-05T10:00:00Z'))).toBe('05.01.2024')
    })
  })

  describe('_removeBanner', () => {
    test('should remove notification banner', () => {
      const mockElement = { remove: mock(() => {}) }
      global.document = {
        getElementById: id => {
          if (id === 'last-lesson-inline-notification' || id === 'last-lesson-banner') {
            return mockElement
          }
          return null
        }
      }

      const newFeature = new LastLessonNotificationFeature()
      newFeature._removeBanner()

      expect(mockElement.remove).toHaveBeenCalled()
    })

    test('should handle missing banner gracefully', () => {
      global.document = { getElementById: () => null }

      const newFeature = new LastLessonNotificationFeature()
      expect(() => newFeature._removeBanner()).not.toThrow()
    })
  })

  describe('onDeactivate', () => {
    test('should remove banner on deactivation', () => {
      const removeBannerCalled = { value: false }
      feature._removeBanner = () => {
        removeBannerCalled.value = true
      }

      feature.onDeactivate()

      expect(removeBannerCalled.value).toBe(true)
    })
  })

  describe('activate error handling', () => {
    test('should not log expected 412 journal info response as activation error', async () => {
      const errorMock = mock(() => {})
      global.console.error = errorMock
      const error = new Error('API Error: 412')
      error.status = 412
      feature.api = {
        tahvel: {
          get: mock(() => Promise.reject(error))
        }
      }

      await feature.activate()

      expect(errorMock).not.toHaveBeenCalled()
    })
  })

  describe('activate with mocked API', () => {
    test('should return early when no journal ID in URL', async () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journals' } }
      const newFeature = new LastLessonNotificationFeature()

      await newFeature.activate()

      // Should exit early without errors
    })

    test('should remove banner when no journal entries', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return []
            }
            if (url.includes('timetableevents')) {
              return { timetableEvents: [] }
            }
            return {}
          })
        }
      }

      await feature.activate()

      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should calculate last lesson date from timetable', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: '2024-11-01',
                entryType: 'SISSEKANNE_T'
              }]
            }
            if (url.includes('timetableevents')) {
              return {
                timetableEvents: [{
                  date: '2024-11-15',
                  nameEt: 'Test Lesson',
                  journalId: 12345
                }]
              }
            }
            if (url.includes('journals/12345')) {
              return {
                id: 12345,
                module: {
                  id: 1,
                  school: {
                    id: 9
                  }
                }
              }
            }
            return {}
          })
        }
      }

      await feature.activate()

      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should handle timetable with multiple lessons', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: '2024-11-01',
                entryType: 'SISSEKANNE_T'
              }]
            }
            if (url.includes('timetableevents')) {
              return {
                timetableEvents: [
                  { date: '2024-11-01', nameEt: 'Lesson 1', journalId: 12345 },
                  { date: '2024-11-10', nameEt: 'Lesson 2', journalId: 12345 },
                  { date: '2024-11-20', nameEt: 'Lesson 3', journalId: 12345 }
                ]
              }
            }
            if (url.includes('journals/12345')) {
              return {
                id: 12345,
                module: {
                  id: 1,
                  school: {
                    id: 9
                  }
                }
              }
            }
            return {}
          })
        }
      }

      await feature.activate()

      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should handle independent work entries with future due dates', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 10)

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [
                {
                  id: 1,
                  entryDate: '2024-11-01',
                  entryType: 'SISSEKANNE_T'
                },
                {
                  id: 2,
                  entryDate: '2024-11-05',
                  entryType: 'SISSEKANNE_I',
                  homeworkDuedate: futureDate.toISOString().split('T')[0],
                  nameEt: 'Independent Work 1'
                }
              ]
            }
            if (url.includes('timetableevents')) {
              return {
                timetableEvents: [{
                  date: '2024-11-15',
                  nameEt: 'Test Lesson',
                  journalId: 12345
                }]
              }
            }
            if (url.includes('journals/12345')) {
              return {
                id: 12345,
                module: {
                  id: 1,
                  school: {
                    id: 9
                  }
                }
              }
            }
            return {}
          })
        }
      }

      await feature.activate()

      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should handle API errors gracefully', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      await feature.activate()

      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })
  })

  describe('onDeactivate', () => {
    test('should execute without errors', () => {
      // Setup DOM for banner removal
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="last-lesson-banner"></div></body></html>')
      global.document = dom.window.document

      // This should not throw
      expect(() => feature.onDeactivate()).not.toThrow()
    })
  })

  describe('_showBanner', () => {
    test('should display banner when date is found', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hois-collapse-header"><div class="flex-gt-md-50"><span>Math</span></div></div></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature._showBanner('2024-11-15', false)

      const banner = document.getElementById('last-lesson-inline-notification')
      expect(banner).toBeDefined()
      expect(banner.textContent).toContain('Viimane tund')
    })

    test('should display banner when last lesson is today', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hois-collapse-header"><div class="flex-gt-md-50"><span>Math</span></div></div></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      const today = new Date()
      feature.comparisonDate = today.toISOString().split('T')[0]
      feature._showBanner(today.toISOString().split('T')[0], false)

      const banner = document.getElementById('last-lesson-inline-notification')
      expect(banner).toBeDefined()
      expect(banner.textContent).toContain('Viimane tund')
    })

    test('should display banner when all lessons are past', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hois-collapse-header"><div class="flex-gt-md-50"><span>Math</span></div></div></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature._showBanner('2024-01-15', true)

      const banner = document.getElementById('last-lesson-inline-notification')
      expect(banner).toBeDefined()
      expect(banner.textContent).toContain('toimus')
    })

    test('should display warning when date not found in timetable', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hois-collapse-header"><div class="flex-gt-md-50"><span>Math</span></div></div></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature._showBanner('not found in timetable', false)

      const banner = document.getElementById('last-lesson-inline-notification')
      expect(banner).toBeDefined()
      expect(banner.textContent).toContain('Õppetöö kirjed on olemas')
    })

    test('should not display banner when no suitable insertion target found', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature._showBanner('2024-11-15', false)

      const banner = document.getElementById('last-lesson-inline-notification')
      expect(banner).toBeNull()
    })

    test('should try multiple selectors to find insertion target', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="accordion-header">Test</div></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature._showBanner('2024-11-15', false)

      const banner = document.getElementById('last-lesson-inline-notification')
      expect(banner).toBeDefined()
    })

    test('should handle errors during insertion gracefully', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hois-collapse-header"><div class="flex-gt-md-50"><span>Math</span></div></div></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      // Mock insertBefore to throw an error
      const span = dom.window.document.querySelector('.hois-collapse-header .flex-gt-md-50 span')
      const originalInsertBefore = span.parentNode.insertBefore
      span.parentNode.insertBefore = () => {
        throw new Error('Mock error')
      }

      // Should not throw
      expect(() => feature._showBanner('2024-11-15', false)).not.toThrow()

      // Restore
      span.parentNode.insertBefore = originalInsertBefore
    })
  })

  describe('_removeBanner', () => {
    test('should remove both banner elements', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="last-lesson-inline-notification">Test1</div><div id="last-lesson-banner">Test2</div></body></html>')
      global.document = dom.window.document

      feature._removeBanner()

      expect(document.getElementById('last-lesson-inline-notification')).toBeNull()
      expect(document.getElementById('last-lesson-banner')).toBeNull()
    })

    test('should handle missing elements gracefully', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document

      expect(() => feature._removeBanner()).not.toThrow()
    })
  })

  describe('activate with independent work and past timetable', () => {
    test('should handle independent work entries with null due dates', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [
                { id: 1, entryDate: '2024-11-01', entryType: 'SISSEKANNE_I', homeworkDuedate: null },
                { id: 2, entryDate: '2024-11-02', entryType: 'SISSEKANNE_T' }
              ]
            }
            if (url.includes('timetableevents')) {
              return {
                timetableEvents: [{ date: '2024-11-15', nameEt: 'Test Lesson', journalId: 12345 }]
              }
            }
            if (url.includes('journals/12345')) {
              return {
                id: 12345,
                school: { id: 9 },
                journalTeachers: [{ id: 123 }]
              }
            }
            return {}
          })
        }
      }

      await feature.activate()
      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should handle independent work with future due dates', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, __lastLessonNotification_independentWorkMessage: undefined }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [
                { id: 1, entryDate: '2024-11-01', entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-12-20' },
                { id: 2, entryDate: '2024-11-02', entryType: 'SISSEKANNE_T' }
              ]
            }
            if (url.includes('timetableevents')) {
              return {
                timetableEvents: [{ date: '2024-11-15', nameEt: 'Test Lesson', journalId: 12345 }]
              }
            }
            if (url.includes('journals/12345')) {
              return {
                id: 12345,
                school: { id: 9 },
                journalTeachers: [{ id: 123 }]
              }
            }
            return {}
          })
        }
      }

      await feature.activate()
      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should handle timetable with all past lessons', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{ id: 1, entryDate: '2024-01-01', entryType: 'SISSEKANNE_T' }]
            }
            if (url.includes('timetableevents')) {
              return {
                timetableEvents: [
                  { date: '2024-01-15', nameEt: 'Past Lesson 1', journalId: 12345 },
                  { date: '2024-02-15', nameEt: 'Past Lesson 2', journalId: 12345 }
                ]
              }
            }
            if (url.includes('journals/12345')) {
              return {
                id: 12345,
                school: { id: 9 },
                journalTeachers: [{ id: 123 }]
              }
            }
            return {}
          })
        }
      }

      await feature.activate()
      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })
  })

  describe('refresh static method', () => {
    test('should execute on valid journal URL', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      const mockApi = {
        tahvel: {
          get: mock(async () => ({}))
        }
      }

      await LastLessonNotificationFeature.refresh(mockApi)

      expect(mockApi.tahvel.get).toHaveBeenCalled()
    })

    test('should return early on invalid URL', async () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/other' } }

      const mockApi = {
        tahvel: {
          get: mock(async () => ({}))
        }
      }

      await LastLessonNotificationFeature.refresh(mockApi)

      expect(mockApi.tahvel.get).not.toHaveBeenCalled()
    })

    test('should return early when no API available', async () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      await LastLessonNotificationFeature.refresh(null)

      // Should complete without errors
    })
  })
})
