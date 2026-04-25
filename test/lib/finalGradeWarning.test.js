import { describe, test, expect, beforeEach, mock } from 'bun:test'
import '../mocks/chrome.js'
import { getWarningLevel, getStudyYearRange, getFinalLessonDate } from '../../src/lib/finalGradeWarning.js'

describe('finalGradeWarning shared utility', () => {
  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {},
      trace: () => {}
    }
  })

  describe('getWarningLevel', () => {
    test('should return null when more than 7 days away', () => {
      const now = new Date('2025-01-01')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBeNull()
    })

    test('should return yellow when exactly 7 days away', () => {
      const now = new Date('2025-01-08')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBe('yellow')
    })

    test('should return yellow when 5 days away (within 7-2 window)', () => {
      const now = new Date('2025-01-10')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBe('yellow')
    })

    test('should return yellow when exactly 2 days away (boundary)', () => {
      const now = new Date('2025-01-13')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBe('yellow')
    })

    test('should return red when 1 day away', () => {
      const now = new Date('2025-01-14')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBe('red')
    })

    test('should return red on final lesson date', () => {
      const now = new Date('2025-01-15')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBe('red')
    })

    test('should return red when past the final lesson date', () => {
      const now = new Date('2025-01-20')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBe('red')
    })

    test('should return null when exactly 8 days away', () => {
      const now = new Date('2025-01-07')
      const finalDate = new Date('2025-01-15')
      expect(getWarningLevel(now, finalDate)).toBeNull()
    })
  })

  describe('getStudyYearRange', () => {
    test('should return from and thru as ISO strings', () => {
      const result = getStudyYearRange()
      expect(typeof result.from).toBe('string')
      expect(typeof result.thru).toBe('string')
      expect(result.from).toContain('T')
      expect(result.thru).toContain('T')
    })

    test('should return September 1 as start date', () => {
      const result = getStudyYearRange()
      expect(result.from).toContain('-09-01')
    })

    test('should return August 31 as end date', () => {
      const result = getStudyYearRange()
      expect(result.thru).toContain('-08-31')
    })

    test('should use info.studyYearStartDate and studyYearEndDate when provided', () => {
      const info = {
        studyYearStartDate: '2024-09-01T00:00:00.000Z',
        studyYearEndDate: '2025-08-31T23:59:59.999Z'
      }
      const result = getStudyYearRange(info)
      expect(result.from).toBe('2024-09-01T00:00:00.000Z')
      expect(result.thru).toBe('2025-08-31T23:59:59.999Z')
    })

    test('should fall back to computed end date when studyYearEndDate is missing', () => {
      const info = {
        studyYearStartDate: '2024-09-01T00:00:00.000Z'
      }
      const result = getStudyYearRange(info)
      expect(result.from).toBe('2024-09-01T00:00:00.000Z')
      expect(result.thru).toContain('-08-31')
    })

    test('should compute from current date when info has no studyYearStartDate', () => {
      const info = { studyYearEndDate: '2025-08-31T23:59:59.999Z' }
      const result = getStudyYearRange(info)
      // Without studyYearStartDate, should fall back to computed range
      expect(result.from).toContain('-09-01')
    })
  })

  describe('getFinalLessonDate', () => {
    test('should return latest timetable date for journal', async () => {
      const mockApi = {
        tahvel: {
          get: mock((url) => {
            if (url === '/journals/123') {
              return Promise.resolve({
                school: { id: 9 },
                curriculumVersions: [{ curriculumId: 456 }],
                journalTeachers: [{ id: 789 }]
              })
            }
            if (url.includes('/timetableevents/timetableByTeacher')) {
              return Promise.resolve({
                timetableEvents: [
                  { journalId: 123, date: '2025-10-15' },
                  { journalId: 123, date: '2025-12-20' },
                  { journalId: 999, date: '2025-11-10' }
                ]
              })
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await getFinalLessonDate(123, mockApi)
      expect(result).toBe('2025-12-20')
    })

    test('should fallback to journal entries if timetable fails', async () => {
      const mockApi = {
        tahvel: {
          get: mock((url) => {
            if (url === '/journals/123') {
              return Promise.resolve({
                curriculumVersions: [{ curriculumId: 456 }],
                journalTeachers: [{ id: 789 }]
              })
            }
            if (url.includes('/timetableevents')) {
              return Promise.reject(new Error('API error'))
            }
            if (url.includes('/journalEntriesByDate')) {
              return Promise.resolve([
                { entryDate: '2025-11-10' },
                { entryDate: '2025-12-15' },
                { entryDate: '2025-10-20' }
              ])
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await getFinalLessonDate(123, mockApi)
      expect(result).toBe('2025-12-15')
    })

    test('should return null if no timetable or entries', async () => {
      const mockApi = {
        tahvel: {
          get: mock((url) => {
            if (url === '/journals/123') {
              return Promise.resolve({
                curriculumVersions: [{ curriculumId: 456 }],
                journalTeachers: [{ id: 789 }]
              })
            }
            if (url.includes('/timetableevents')) {
              return Promise.resolve({ timetableEvents: [] })
            }
            if (url.includes('/journalEntriesByDate')) {
              return Promise.resolve([])
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await getFinalLessonDate(123, mockApi)
      expect(result).toBeNull()
    })

    test('should use pre-fetched info when provided', async () => {
      const mockApi = {
        tahvel: {
          get: mock((url) => {
            if (url.includes('/timetableevents')) {
              return Promise.resolve({
                timetableEvents: [{ journalId: 123, date: '2025-11-20' }]
              })
            }
            return Promise.resolve([])
          })
        }
      }

      const info = {
        school: { id: 9 },
        curriculumVersions: [{ curriculumId: 456 }],
        journalTeachers: [{ id: 789 }]
      }

      const result = await getFinalLessonDate(123, mockApi, info)
      expect(result).toBe('2025-11-20')
      // Should NOT have called /journals/123 since info was pre-provided
      const journalCalls = mockApi.tahvel.get.mock.calls.filter(c => c[0] === '/journals/123')
      expect(journalCalls.length).toBe(0)
    })

    test('should handle missing schoolId or teacherId', async () => {
      const mockApi = {
        tahvel: {
          get: mock((url) => {
            if (url === '/journals/123') {
              return Promise.resolve({
                curriculumVersions: [],
                journalTeachers: []
              })
            }
            if (url.includes('/journalEntriesByDate')) {
              return Promise.resolve([{ entryDate: '2025-11-15' }])
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await getFinalLessonDate(123, mockApi)
      expect(result).toBe('2025-11-15')
    })

    test('should return null for expected 412 journal info response', async () => {
      const mockApi = {
        tahvel: {
          get: mock((url, params, options) => {
            if (url === '/journals/123') {
              expect(options.suppressErrorStatuses).toContain(412)
              const error = new Error('API Error: 412')
              error.status = 412
              return Promise.reject(error)
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await getFinalLessonDate(123, mockApi)

      expect(result).toBeNull()
    })
  })
})
