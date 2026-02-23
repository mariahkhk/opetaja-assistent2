import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import '../../../../test/mocks/chrome.js'
import FinalGradeWarningFeature from '../../../../src/features/journalList/finalGradeWarning/FinalGradeWarningFeature.js'

describe('FinalGradeWarningFeature', () => {
  let feature
  let mockApi

  beforeEach(() => {
    global.console = {
      ...global.console,
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      debug: mock(() => {}),
      info: mock(() => {}),
      groupCollapsed: mock(() => {}),
      groupEnd: mock(() => {}),
      trace: mock(() => {})
    }

    mockApi = {
      tahvel: {
        get: mock(() => Promise.resolve([]))
      }
    }

    feature = new FinalGradeWarningFeature()
    feature.api = mockApi
  })

  afterEach(() => {
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

  describe('constructor', () => {
    test('should initialize with correct name', () => {
      expect(feature.name).toBe('FinalGradeWarningFeature')
    })

    test('should initialize with journal list URL pattern', () => {
      expect(feature.urlPattern).toEqual(/#\/journals/)
    })

    test('should initialize processedJournals as empty Set', () => {
      expect(feature.processedJournals).toBeInstanceOf(Set)
      expect(feature.processedJournals.size).toBe(0)
    })
  })

  describe('shouldActivate', () => {
    test('should activate on journal list URL', () => {
      const url = 'https://tahvel.edu.ee/#/journals?_menu'
      expect(feature.shouldActivate(url)).toBe(true)
    })

    test('should not activate on single journal URL', () => {
      const url = 'https://tahvel.edu.ee/#/journal/123/edit'
      expect(feature.shouldActivate(url)).toBe(false)
    })

    test('should not activate on other pages', () => {
      const url = 'https://tahvel.edu.ee/#/students'
      expect(feature.shouldActivate(url)).toBe(false)
    })
  })

  describe('hasMissingFinalGrades', () => {
    /**
     * Helper to set up mockApi for hasMissingFinalGrades tests.
     * The method makes two parallel API calls:
     *   1. /journals/{id}/journalEntriesByDate?allStudents=true
     *   2. /journals/{id}/journalStudents
     */
    function setupMockApi(entries, students, detailedOutcome = null) {
      mockApi.tahvel.get = mock((url) => {
        if (url.includes('/journalEntriesByDate')) {
          return Promise.resolve(entries)
        }
        if (url.includes('/journalStudents')) {
          return Promise.resolve(students)
        }
        if (url.includes('/journalOutcome/')) {
          return detailedOutcome
            ? Promise.resolve(detailedOutcome)
            : Promise.reject(new Error('Not found'))
        }
        return Promise.resolve([])
      })
      feature.api = mockApi
    }

    const threeStudents = [{ id: 1 }, { id: 2 }, { id: 3 }]

    test('should return false when no outcome entries exist', async () => {
      setupMockApi(
        [
          { entryType: 'SISSEKANNE_L', entryDate: '2025-01-15' },
          { entryType: 'SISSEKANNE_P', entryDate: '2025-01-16' }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })

    test('should return false when all students have grades in studentOutcomeResults', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }],
              '2': [{ grade: { code: 'KUTSEHINDAMINE_4' } }],
              '3': [{ grade: { code: 'KUTSEHINDAMINE_3' } }]
            }
          }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })

    test('should return true when fewer students have grades than total students', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }]
              // Students 2 and 3 are absent — they have no grades
            }
          }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should return true when a student has null grade', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }],
              '2': [{ grade: null }],
              '3': [{ grade: { code: 'KUTSEHINDAMINE_3' } }]
            }
          }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should return true when a student has empty grades array', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }],
              '2': [],
              '3': [{ grade: { code: 'KUTSEHINDAMINE_3' } }]
            }
          }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should return true when studentOutcomeResults is missing and no detailed outcome', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            // No studentOutcomeResults, no curriculumModuleOutcomes
          }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should fetch detailed outcome when studentOutcomeResults is missing', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            curriculumModuleOutcomes: 456
            // No studentOutcomeResults
          }
        ],
        threeStudents,
        {
          outcomeStudents: [
            { studentId: 1, grade: { code: 'KUTSEHINDAMINE_5' } },
            { studentId: 2, grade: { code: 'KUTSEHINDAMINE_4' } }
            // Student 3 missing
          ]
        }
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should return false via detailed outcome when all students graded', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            curriculumModuleOutcomes: 456
          }
        ],
        threeStudents,
        {
          outcomeStudents: [
            { studentId: 1, grade: { code: 'KUTSEHINDAMINE_5' } },
            { studentId: 2, grade: { code: 'KUTSEHINDAMINE_4' } },
            { studentId: 3, grade: { code: 'KUTSEHINDAMINE_3' } }
          ]
        }
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })

    test('should return false when entries is not an array', async () => {
      setupMockApi(null, threeStudents)

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })

    test('should return false when no students in journal', async () => {
      setupMockApi(
        [{ entryType: 'SISSEKANNE_O', studentOutcomeResults: {} }],
        [] // No students
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })

    test('should return false on API error', async () => {
      mockApi.tahvel.get = mock(() => Promise.reject(new Error('Network error')))

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })
  })

  describe('addWarningIndicator', () => {
    test('should create indicator for warning level', () => {
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => null),
          insertBefore: mock(() => {})
        }
      }

      const origDocument = global.document
      global.document = {
        ...global.document,
        createElement: mock(() => ({
          className: '',
          title: '',
          textContent: '',
          style: { cssText: '' },
          appendChild: mock(() => {}),
          querySelector: mock(() => null)
        }))
      }

      try {
        feature.addWarningIndicator(mockLinkElement, 'yellow')
        expect(mockLinkElement.parentElement.insertBefore).toHaveBeenCalled()
      } finally {
        global.document = origDocument
      }
    })

    test('should not add duplicate indicators', () => {
      const mockLinkElement = {
        parentElement: {
          querySelector: mock(() => ({ className: 'oa-final-grade-warning' })),
          insertBefore: mock(() => {})
        }
      }

      feature.addWarningIndicator(mockLinkElement, 'red')

      expect(mockLinkElement.parentElement.insertBefore).not.toHaveBeenCalled()
    })

    test('should handle missing parentElement', () => {
      const mockLinkElement = {
        parentElement: null
      }

      expect(() => feature.addWarningIndicator(mockLinkElement, 'red')).not.toThrow()
    })
  })

  describe('onDeactivate', () => {
    test('should clear processedJournals', () => {
      feature.processedJournals.add(1)
      feature.processedJournals.add(2)

      feature.onDeactivate()

      expect(feature.processedJournals.size).toBe(0)
    })

    test('should disconnect mainContentObserver', () => {
      const mockObserver = { disconnect: mock(() => {}) }
      feature.mainContentObserver = mockObserver

      feature.onDeactivate()

      expect(mockObserver.disconnect).toHaveBeenCalled()
      expect(feature.mainContentObserver).toBeNull()
    })

    test('should handle null observer gracefully', () => {
      feature.mainContentObserver = null

      expect(() => feature.onDeactivate()).not.toThrow()
    })
  })
})
