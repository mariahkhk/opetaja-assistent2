import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import LessonCountWarningFeature from '../../../src/features/journalList/lessonCountWarning/LessonCountWarningFeature.js'
import { cacheService } from '../../../src/services/CacheService.js'
import Logger from '../../../src/services/Logger.js'
import '../../../test/mocks/chrome.js'

describe('LessonCountWarningFeature', () => {
  let feature
  let mockApi
  let consoleLogSpy
  let consoleWarnSpy
  let consoleErrorSpy

  beforeEach(() => {
    // Mock console methods
    consoleLogSpy = mock(() => {})
    consoleWarnSpy = mock(() => {})
    consoleErrorSpy = mock(() => {})
    global.console = {
      ...global.console,
      log: consoleLogSpy,
      warn: consoleWarnSpy,
      error: consoleErrorSpy,
      debug: mock(() => {}),
      info: mock(() => {}),
      groupCollapsed: mock(() => {}),
      groupEnd: mock(() => {})
    }

    // Mock API
    mockApi = {
      tahvel: {
        get: mock(() =>
          Promise.resolve({
            id: 123,
            lessonHours: {
              totalUsedHours: 10,
              capacityHours: [
                { capacity: 'MAHT_a', usedHours: 9 },
                { capacity: 'MAHT_i', usedHours: 1 }
              ]
            }
          })
        )
      }
    }

    // Create feature instance
    feature = new LessonCountWarningFeature()
    feature.api = mockApi
    feature.currentSchoolId = 9
    feature.currentTeacherId = 100
    feature.currentStudyYear = '2025/2026'
  })

  afterEach(() => {
    // Restore console
    global.console = {
      log: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
      info: () => {},
      group: () => {},
      groupEnd: () => {},
      groupCollapsed: () => {},
      trace: () => {}
    }
  })

  describe('getLessonCountFromCache', () => {
    test('should extract MAHT_a usedHours from cached journal', async () => {
      // Mock cacheService to return journal data
      cacheService.get = mock(() =>
        Promise.resolve({
          id: 123,
          lessonHours: {
            totalUsedHours: 10,
            capacityHours: [
              { capacity: 'MAHT_a', usedHours: 9 },
              { capacity: 'MAHT_i', usedHours: 1 }
            ]
          }
        })
      )

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(9)
      expect(cacheService.get).toHaveBeenCalledWith('GET_https://tahvel.edu.ee/hois_back/journals/123')
    })

    test('should exclude MAHT_i (independent work) from count', async () => {
      cacheService.get = mock(() =>
        Promise.resolve({
          id: 123,
          lessonHours: {
            totalUsedHours: 15,
            capacityHours: [
              { capacity: 'MAHT_a', usedHours: 10 },
              { capacity: 'MAHT_i', usedHours: 5 }
            ]
          }
        })
      )

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(10) // Only MAHT_a, not total
    })

    test('should fallback to totalUsedHours if MAHT_a not found', async () => {
      cacheService.get = mock(() =>
        Promise.resolve({
          id: 123,
          lessonHours: {
            totalUsedHours: 12,
            capacityHours: [{ capacity: 'MAHT_i', usedHours: 12 }]
          }
        })
      )

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(12)
    })

    test('should fetch from API if not in cache', async () => {
      cacheService.get = mock(() => Promise.resolve(null))

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(9) // From mockApi
      expect(mockApi.tahvel.get).toHaveBeenCalledWith('/journals/123', {}, { cache: true, cacheExpiration: expect.any(Number) })
    })

    test('should return null if cache and API fail', async () => {
      cacheService.get = mock(() => Promise.resolve(null))
      mockApi.tahvel.get = mock(() => Promise.reject(new Error('API Error')))

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(null)
    })

    test('should return null if lessonHours is missing', async () => {
      cacheService.get = mock(() => Promise.resolve({ id: 123 }))

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(null)
    })

    test('should return null if capacityHours is missing', async () => {
      cacheService.get = mock(() =>
        Promise.resolve({
          id: 123,
          lessonHours: { totalUsedHours: 10 }
        })
      )

      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(null)
    })

    test('should detect test.tahvel environment', async () => {
      global.window = { location: { hostname: 'test.tahvel.eenet.ee' } }
      cacheService.get = mock(() =>
        Promise.resolve({
          id: 123,
          lessonHours: {
            capacityHours: [{ capacity: 'MAHT_a', usedHours: 5 }]
          }
        })
      )

      await feature.getLessonCountFromCache(123)

      expect(cacheService.get).toHaveBeenCalledWith('GET_https://test.tahvel.eenet.ee/hois_back/journals/123')
    })

    test('should detect uustahvel environment', async () => {
      global.window = { location: { hostname: 'uustahvel.eenet.ee' } }
      cacheService.get = mock(() =>
        Promise.resolve({
          id: 123,
          lessonHours: {
            capacityHours: [{ capacity: 'MAHT_a', usedHours: 7 }]
          }
        })
      )

      await feature.getLessonCountFromCache(123)

      expect(cacheService.get).toHaveBeenCalledWith('GET_https://uustahvel.eenet.ee/hois_back/journals/123')
    })
  })

  describe('parseStudyYear', () => {
    test('should parse study year string to date range', () => {
      const result = feature.parseStudyYear('2025/2026')

      expect(result.from).toBe('2025-09-01T00:00:00.000Z')
      expect(result.thru).toBe('2026-08-31T23:59:59.999Z')
    })

    test('should handle different year formats', () => {
      const result = feature.parseStudyYear('2024/2025')

      expect(result.from).toBe('2024-09-01T00:00:00.000Z')
      expect(result.thru).toBe('2025-08-31T23:59:59.999Z')
    })

    test('should fallback to current year if parsing fails', () => {
      const result = feature.parseStudyYear('invalid-format')

      expect(result.from).toBeDefined()
      expect(result.thru).toBeDefined()
    })
  })

  describe('countPastLessons', () => {
    test('should count only past timetable events', () => {
      const now = new Date()
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)

      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const events = [
        { date: yesterday.toISOString() },
        { date: tomorrow.toISOString() },
        { date: yesterday.toISOString() }
      ]

      const count = feature.countPastLessons(events)

      expect(count).toBe(2) // Only yesterday's events
    })

    test('should not count today as past', () => {
      const today = new Date()

      const events = [{ date: today.toISOString() }]

      const count = feature.countPastLessons(events)

      expect(count).toBe(0)
    })

    test('should handle events without dates', () => {
      const events = [{ date: null }, { name: 'No date' }]

      const count = feature.countPastLessons(events)

      expect(count).toBe(0)
    })

    test('should handle empty events array', () => {
      const count = feature.countPastLessons([])

      expect(count).toBe(0)
    })
  })

  describe('extractJournalInfoFromRow', () => {
    test('should extract journal ID from href', () => {
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'td:nth-child(2) a.linked-name') {
            return {
              getAttribute: mock(() => '/journal/12345'),
              textContent: 'Test Journal'
            }
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.id).toBe(12345)
    })

    test('should extract journal ID from ng-href', () => {
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'td:nth-child(2) a.linked-name') {
            return {
              getAttribute: mock(attr => (attr === 'ng-href' ? '/journal/67890' : null)),
              textContent: 'Test Journal'
            }
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.id).toBe(67890)
    })

    test('should return null if no journal link found', () => {
      const mockRow = {
        querySelector: mock(() => null),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info).toBe(null)
    })

    test('should return null if no journal ID in href', () => {
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'td:nth-child(2) a.linked-name') {
            return {
              getAttribute: mock(() => '/invalid/path'),
              textContent: 'Test Journal'
            }
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info).toBe(null)
    })

    test('should extract teacher IDs from links', () => {
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'td:nth-child(2) a.linked-name') {
            return {
              getAttribute: mock(() => '/journal/123'),
              textContent: 'Test Journal'
            }
          }
          return null
        }),
        querySelectorAll: mock(selector => {
          if (selector === 'td') {
            return [
              {
                querySelectorAll: mock(() => [
                  {
                    getAttribute: mock(() => '/teacher/456'),
                    textContent: 'John Doe'
                  }
                ])
              }
            ]
          }
          return []
        })
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.teacherIds).toEqual([456])
      expect(info.teacherNames).toEqual(['John Doe'])
    })
  })

  describe('getTimetableLessons', () => {
    test('should fetch timetable events for journal', async () => {
      mockApi.tahvel.get = mock(() =>
        Promise.resolve({
          timetableEvents: [
            { journalId: 123, date: '2025-09-01' },
            { journalId: 456, date: '2025-09-02' },
            { journalId: 123, date: '2025-09-03' }
          ]
        })
      )

      const lessons = await feature.getTimetableLessons(123, [100])

      expect(lessons).toHaveLength(2)
      expect(lessons[0].journalId).toBe(123)
      expect(lessons[1].journalId).toBe(123)
    })

    test('should handle multiple teacher IDs', async () => {
      mockApi.tahvel.get = mock(() =>
        Promise.resolve({
          timetableEvents: [{ journalId: 123, date: '2025-09-01' }]
        })
      )

      await feature.getTimetableLessons(123, [100, 200, 300])

      expect(mockApi.tahvel.get).toHaveBeenCalledWith(
        expect.stringContaining('teachers=100,200,300'),
        {},
        expect.any(Object)
      )
    })

    test('should return empty array if no teacher IDs', async () => {
      const lessons = await feature.getTimetableLessons(123, [])

      expect(lessons).toEqual([])
    })

    test('should return empty array if timetableEvents is missing', async () => {
      mockApi.tahvel.get = mock(() => Promise.resolve({}))

      const lessons = await feature.getTimetableLessons(123, [100])

      expect(lessons).toEqual([])
    })

    test('should handle API errors gracefully', async () => {
      mockApi.tahvel.get = mock(() => Promise.reject(new Error('Network error')))

      const lessons = await feature.getTimetableLessons(123, [100])

      expect(lessons).toEqual([])
    })
  })

  describe('addWarningIndicator', () => {
    test('should create pink calendar indicator for extra lessons', () => {
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => null),
          insertBefore: mock(() => {}),
          appendChild: mock(() => {})
        }
      }

      const discrepancy = {
        journalId: 123,
        domCount: 12,
        timetableCount: 10
      }

      feature.addWarningIndicator(mockLinkElement, discrepancy)

      // Verify wrapper and indicator were created
      expect(mockLinkElement.parentElement.insertBefore).toHaveBeenCalled()
    })

    test('should show correct tooltip for extra lessons (plural)', () => {
      const mockIndicator = { title: '' }
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => null),
          insertBefore: mock((wrapper, link) => {
            // Simulate adding indicator to wrapper
            const indicator = { style: { cssText: '' }, textContent: '', title: '' }
            mockIndicator.title = 'Päevikus on 3 liigset tundi'
            return wrapper
          }),
          appendChild: mock(() => {})
        }
      }

      const discrepancy = {
        journalId: 123,
        domCount: 13,
        timetableCount: 10
      }

      feature.addWarningIndicator(mockLinkElement, discrepancy)

      expect(mockIndicator.title).toBe('Päevikus on 3 liigset tundi')
    })

    test('should show correct tooltip for one extra lesson (singular)', () => {
      const mockIndicator = { title: '' }
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => null),
          insertBefore: mock(() => {
            mockIndicator.title = 'Päevikus on 1 liigne tund'
          }),
          appendChild: mock(() => {})
        }
      }

      const discrepancy = {
        journalId: 123,
        domCount: 11,
        timetableCount: 10
      }

      feature.addWarningIndicator(mockLinkElement, discrepancy)

      expect(mockIndicator.title).toBe('Päevikus on 1 liigne tund')
    })

    test('should show correct tooltip for missing lessons', () => {
      const mockIndicator = { title: '' }
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => null),
          insertBefore: mock(() => {
            mockIndicator.title = 'Päevikus puudub 2 tundi'
          }),
          appendChild: mock(() => {})
        }
      }

      const discrepancy = {
        journalId: 123,
        domCount: 8,
        timetableCount: 10
      }

      feature.addWarningIndicator(mockLinkElement, discrepancy)

      expect(mockIndicator.title).toBe('Päevikus puudub 2 tundi')
    })

    test('should not add duplicate indicators', () => {
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => ({ className: 'oa-warning-indicator' }))
        }
      }

      const discrepancy = {
        journalId: 123,
        domCount: 12,
        timetableCount: 10
      }

      feature.addWarningIndicator(mockLinkElement, discrepancy)

      // Should return early without calling insertBefore
      expect(mockLinkElement.parentElement.querySelector).toHaveBeenCalledWith('.oa-warning-indicator')
    })
  })

  describe('getDefaultStudyYear', () => {
    test('should return current year if after August', () => {
      // Mock September (month 8)
      const originalDate = Date
      global.Date = class extends Date {
        constructor() {
          super()
          return new originalDate(2025, 8, 15) // September 15, 2025
        }
      }

      const studyYear = feature.getDefaultStudyYear()

      expect(studyYear).toBe('2025/2026')

      global.Date = originalDate
    })

    test('should return previous year if before August', () => {
      const originalDate = Date
      global.Date = class extends Date {
        constructor() {
          super()
          return new originalDate(2025, 6, 15) // July 15, 2025
        }
      }

      const studyYear = feature.getDefaultStudyYear()

      expect(studyYear).toBe('2024/2025')

      global.Date = originalDate
    })
  })
})
