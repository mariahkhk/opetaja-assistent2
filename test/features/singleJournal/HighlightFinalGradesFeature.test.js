import { describe, test, expect, beforeEach, mock } from 'bun:test'
import HighlightFinalGradesFeature from '../../../src/features/singleJournal/highlightFinalGrades/HighlightFinalGradesFeature.js'
import { getStudyYearRange } from '../../../src/lib/finalGradeWarning.js'

describe('HighlightFinalGradesFeature', () => {
  let feature

  beforeEach(() => {
    global.styleService = { injectCSS: () => {} }
    global.document = { getElementById: () => null }
    global.console = {
      debug: () => {},
      log: () => {},
      groupCollapsed: () => {},
      trace: () => {},
      groupEnd: () => {}
    }
    feature = new HighlightFinalGradesFeature()
    global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
  })

  describe('constructor', () => {
    test('should initialize successfully', () => {
      expect(feature).toBeDefined()
      expect(feature.urlPattern).toEqual(/#\/journal\//)
    })

    test('should initialize finalGradeStyleId', () => {
      expect(feature.finalGradeStyleId).toBe('highlight-final-grade-style')
    })

    test('should initialize observer properties to null', () => {
      expect(feature._observer).toBeNull()
      expect(feature._docObserver).toBeNull()
      expect(feature._debounceTimeout).toBeNull()
      expect(feature._docObserverTable).toBeNull()
      expect(feature._tableRetryTimeout).toBeNull()
    })
  })

  describe('_isJournalEntriesTable', () => {
    test('should return false for null table', () => {
      expect(feature._isJournalEntriesTable(null)).toBe(false)
    })

    test('should return false for table with no headers', () => {
      const table = {
        querySelectorAll: () => []
      }
      expect(feature._isJournalEntriesTable(table)).toBe(false)
    })

    test('should return true if header contains "õppija"', () => {
      const table = {
        querySelectorAll: () => [{ textContent: 'Õppija' }, { textContent: 'Hinne' }]
      }
      expect(feature._isJournalEntriesTable(table)).toBe(true)
    })

    test('should return true if header contains "lõpptulemus"', () => {
      const table = {
        querySelectorAll: () => [{ textContent: 'Nimi' }, { textContent: 'Lõpptulemus' }]
      }
      expect(feature._isJournalEntriesTable(table)).toBe(true)
    })

    test('should return true if header contains "õv"', () => {
      const table = {
        querySelectorAll: () => [{ textContent: 'ÕV1' }, { textContent: 'ÕV2' }]
      }
      expect(feature._isJournalEntriesTable(table)).toBe(true)
    })

    test('should be case insensitive', () => {
      const table = {
        querySelectorAll: () => [{ textContent: 'ÕPPIJA' }]
      }
      expect(feature._isJournalEntriesTable(table)).toBe(true)
    })
  })

  describe('getStudyYearRange (shared utility)', () => {
    test('should calculate study year from fallback dates', () => {
      const info = {}
      const result = getStudyYearRange(info)

      // Should return ISO date strings
      expect(result.from).toBeDefined()
      expect(result.thru).toBeDefined()
      expect(typeof result.from).toBe('string')
      expect(typeof result.thru).toBe('string')
    })

    test('should use provided studyYearStartDate if available', () => {
      const info = {
        studyYearStartDate: '2023-09-04T00:00:00Z'
      }
      const result = getStudyYearRange(info)
      expect(result.from).toBe('2023-09-04T00:00:00Z')
    })

    test('should use provided studyYearEndDate if available', () => {
      const info = {
        studyYearStartDate: '2023-09-01T00:00:00Z',
        studyYearEndDate: '2024-06-14T23:59:59Z'
      }
      const result = getStudyYearRange(info)
      expect(result.thru).toBe('2024-06-14T23:59:59Z')
    })
  })

  describe('_getComparisonDate', () => {
    test('should parse final lesson date correctly', () => {
      const finalLessonDate = '2024-12-20'
      const result = feature._getComparisonDate(finalLessonDate, null)

      expect(result.finalDate).toBeInstanceOf(Date)
      expect(result.now).toBeInstanceOf(Date)
      expect(result.finalDate.getHours()).toBe(0)
      expect(result.now.getHours()).toBe(0)
    })

    test('should set hours to 0 for both dates', () => {
      const finalLessonDate = '2024-12-20T15:30:00'
      const result = feature._getComparisonDate(finalLessonDate, null)

      expect(result.finalDate.getHours()).toBe(0)
      expect(result.finalDate.getMinutes()).toBe(0)
      expect(result.now.getHours()).toBe(0)
      expect(result.now.getMinutes()).toBe(0)
    })
  })

  describe('getFinalLessonDate', () => {
    test('should fetch journal info and timetable', async () => {
      feature.api = {
        tahvel: {
          get: mock(url => {
            if (url === '/journals/123') {
              return Promise.resolve({
                curriculumVersions: [{ curriculumId: 456 }],
                journalTeachers: [{ id: 789 }]
              })
            }
            if (url.includes('/timetableevents/timetableByTeacher')) {
              return Promise.resolve({
                timetableEvents: [
                  { journalId: 123, date: '2024-11-15' },
                  { journalId: 123, date: '2024-12-20' },
                  { journalId: 999, date: '2024-11-10' }
                ]
              })
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await feature.getFinalLessonDate(123)
      expect(result).toBe('2024-12-20')
    })

    test('should return latest timetable date for journal', async () => {
      feature.api = {
        tahvel: {
          get: mock((url, params, opts) => {
            if (url === '/journals/123') {
              return Promise.resolve({
                curriculumVersions: [{ curriculumId: 456 }],
                journalTeachers: [{ id: 789 }]
              })
            }
            if (url.includes('/timetableevents')) {
              return Promise.resolve({
                timetableEvents: [
                  { journalId: 123, date: '2024-10-15' },
                  { journalId: 123, date: '2024-11-20' },
                  { journalId: 123, date: '2024-09-05' }
                ]
              })
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await feature.getFinalLessonDate(123)
      expect(result).toBe('2024-11-20')
    })

    test('should fallback to journal entries if timetable fails', async () => {
      feature.api = {
        tahvel: {
          get: mock((url, params, opts) => {
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
              return Promise.resolve([{ entryDate: '2024-11-10' }, { entryDate: '2024-12-15' }, { entryDate: '2024-10-20' }])
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await feature.getFinalLessonDate(123)
      expect(result).toBe('2024-12-15')
    })

    test('should ignore null entry dates in fallback', async () => {
      feature.api = {
        tahvel: {
          get: mock((url, params, opts) => {
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
              return Promise.resolve([{ entryDate: '2024-11-10' }, { entryDate: null }, { entryDate: '2024-10-20' }])
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await feature.getFinalLessonDate(123)
      expect(result).toBe('2024-11-10')
    })

    test('should return null if no timetable or entries', async () => {
      feature.api = {
        tahvel: {
          get: mock(url => {
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

      const result = await feature.getFinalLessonDate(123)
      expect(result).toBeNull()
    })

    test('should handle missing schoolId or teacherId', async () => {
      feature.api = {
        tahvel: {
          get: mock(url => {
            if (url === '/journals/123') {
              return Promise.resolve({
                curriculumVersions: [],
                journalTeachers: []
              })
            }
            if (url.includes('/journalEntriesByDate')) {
              return Promise.resolve([{ entryDate: '2024-11-15' }])
            }
            return Promise.resolve([])
          })
        }
      }

      const result = await feature.getFinalLessonDate(123)
      expect(result).toBe('2024-11-15')
    })
  })

  describe('findColumnIndices', () => {
    test('should detect final grade column by text "lõpptulemus"', () => {
      const table = {
        querySelectorAll: () => [
          {
            children: [
              { innerText: 'Õppija', getAttribute: () => '1', dataset: {} },
              { innerText: 'Lõpptulemus', getAttribute: () => '1', dataset: {} }
            ]
          }
        ]
      }

      const result = feature.findColumnIndices(table)
      expect(result.finalGradeCols).toContain(1)
    })

    test('should detect ÕV columns by pattern', () => {
      const table = {
        querySelectorAll: () => [
          {
            children: [
              { innerText: 'Õppija', getAttribute: () => '1', dataset: {} },
              { innerText: 'ÕV1', getAttribute: () => '1', dataset: {} },
              { innerText: 'ÕV2', getAttribute: () => '1', dataset: {} }
            ]
          }
        ]
      }

      const result = feature.findColumnIndices(table)
      expect(result.ovCols).toContain(1)
      expect(result.ovCols).toContain(2)
    })

    test('should handle colspan attributes', () => {
      const table = {
        querySelectorAll: () => [
          {
            children: [
              { innerText: 'Õppija', getAttribute: attr => (attr === 'colspan' ? '2' : '2'), dataset: {} },
              { innerText: 'ÕV1', getAttribute: () => '1', dataset: {} }
            ]
          }
        ]
      }

      const result = feature.findColumnIndices(table)
      // First header spans 2 columns (0,1), ÕV1 is at index 2
      expect(result.ovCols).toContain(2)
    })

    test('should detect pink background as final grade column', () => {
      const table = {
        querySelectorAll: () => [
          {
            children: [
              {
                innerText: 'Column',
                getAttribute: attr => {
                  if (attr === 'colspan') return '1'
                  if (attr === 'style') return 'background: rgb(249, 168, 212);'
                  return null
                },
                dataset: {},
                className: ''
              }
            ]
          }
        ]
      }

      const result = feature.findColumnIndices(table)
      expect(result.finalGradeCols).toContain(0)
    })

    test('should use fallback final grade column after last ÕV', () => {
      const table = {
        querySelectorAll: selector => {
          if (selector === 'thead tr') {
            return [
              {
                children: [
                  { innerText: 'Õppija', getAttribute: () => '1', dataset: {}, className: '' },
                  { innerText: 'ÕV1', getAttribute: () => '1', dataset: {}, className: '' },
                  { innerText: 'ÕV2', getAttribute: () => '1', dataset: {}, className: '' },
                  { innerText: 'Column4', getAttribute: () => '1', dataset: {}, className: '' }
                ]
              }
            ]
          }
          if (selector === 'tbody tr') {
            return [{ children: [{ nodeType: 1 }, { nodeType: 1 }, { nodeType: 1 }, { nodeType: 1 }] }]
          }
          return []
        }
      }

      const result = feature.findColumnIndices(table)
      // ÕV2 is at index 2, fallback final grade should be at 3
      expect(result.finalGradeCols).toContain(3)
    })

    test('should normalize header text (whitespace and case)', () => {
      const table = {
        querySelectorAll: () => [
          {
            children: [{ innerText: '  LÕPP  TULEMUS  ', getAttribute: () => '1', dataset: {}, className: '' }]
          }
        ]
      }

      const result = feature.findColumnIndices(table)
      expect(result.finalGradeCols).toContain(0)
    })

    test('should detect õpiväljund as ÕV column', () => {
      const table = {
        querySelectorAll: () => [
          {
            children: [{ innerText: 'Õpiväljund 1', getAttribute: () => '1', dataset: {}, className: '' }]
          }
        ]
      }

      const result = feature.findColumnIndices(table)
      expect(result.ovCols).toContain(0)
    })
  })

  describe('onDeactivate', () => {
    test('should disconnect all observers', () => {
      const mockObserver = { disconnect: mock(() => {}) }
      const mockDocObserver = { disconnect: mock(() => {}) }
      feature._observer = mockObserver
      feature._docObserver = mockDocObserver

      feature.onDeactivate()

      expect(mockObserver.disconnect).toHaveBeenCalled()
      expect(mockDocObserver.disconnect).toHaveBeenCalled()
      expect(feature._observer).toBeNull()
      expect(feature._docObserver).toBeNull()
    })

    test('should clear all timeouts', () => {
      feature._debounceTimeout = setTimeout(() => {}, 1000)
      feature._tableRetryTimeout = setTimeout(() => {}, 1000)

      feature.onDeactivate()

      expect(feature._debounceTimeout).toBeNull()
      expect(feature._tableRetryTimeout).toBeNull()
    })

    test('should handle missing observers gracefully', () => {
      feature._observer = null
      feature._docObserver = null

      expect(() => feature.onDeactivate()).not.toThrow()
    })
  })
})
