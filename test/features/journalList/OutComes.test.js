import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { sendOutcomeEntriesToKriit } from '../../../src/features/journalList/OutComes.js'
import Logger from '../../../src/services/Logger.js'
import '../../../test/mocks/chrome.js'

describe('OutComes - sendOutcomeEntriesToKriit', () => {
  let mockApi
  let mockJournalLinks

  beforeEach(() => {
    mockApi = {
      kriit: {
        authToken: 'test-token',
        post: mock(() => Promise.resolve({ success: true }))
      },
      tahvel: {
        get: mock(() => Promise.resolve({}))
      }
    }

    mockJournalLinks = [
      {
        getAttribute: mock(attr => (attr === 'href' ? '/journal/12345' : null)),
        textContent: 'Test Journal 1'
      }
    ]
  })

  describe('Input Validation', () => {
    test('should return early if api is null', async () => {
      await sendOutcomeEntriesToKriit(null, mockJournalLinks)
      expect(mockApi.tahvel.get).not.toHaveBeenCalled()
    })

    test('should return early if api.kriit is null', async () => {
      mockApi.kriit = null
      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.tahvel.get).not.toHaveBeenCalled()
    })

    test('should return early if api.kriit.authToken is null', async () => {
      mockApi.kriit.authToken = null
      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.tahvel.get).not.toHaveBeenCalled()
    })

    test('should return early if journalLinks is null', async () => {
      await sendOutcomeEntriesToKriit(mockApi, null)
      expect(mockApi.tahvel.get).not.toHaveBeenCalled()
    })

    test('should return early if journalLinks is empty array', async () => {
      await sendOutcomeEntriesToKriit(mockApi, [])
      expect(mockApi.tahvel.get).not.toHaveBeenCalled()
    })
  })

  describe('Journal ID Extraction', () => {
    test('should extract ID from href pattern /journal/123', async () => {
      mockApi.tahvel.get = mock((url, options) => {
        if (url.includes('/journals/12345')) {
          if (url.endsWith('/journalEntriesByDate')) {
            return Promise.resolve([])
          }
          if (url.endsWith('/journalStudents')) {
            return Promise.resolve([])
          }
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.tahvel.get).toHaveBeenCalled()
    })

    test('should extract ID from ng-href attribute', async () => {
      const links = [
        {
          getAttribute: mock(attr => (attr === 'ng-href' ? '/journal/67890' : null)),
          textContent: 'NG Href Journal'
        }
      ]

      mockApi.tahvel.get = mock((url, options) => {
        if (url.includes('/journals/67890')) {
          if (url.endsWith('/journalEntriesByDate')) {
            return Promise.resolve([])
          }
          if (url.endsWith('/journalStudents')) {
            return Promise.resolve([])
          }
          return Promise.resolve({ nameEt: 'Test', id: 67890 })
        }
        return Promise.resolve([])
      })

      await sendOutcomeEntriesToKriit(mockApi, links)
      expect(mockApi.tahvel.get).toHaveBeenCalled()
    })

    test('should extract ID from path segments if no match', async () => {
      const links = [
        {
          getAttribute: mock(() => '/some/path/99999/extra'),
          textContent: 'Path Segments Journal'
        }
      ]

      mockApi.tahvel.get = mock((url, options) => {
        if (url.includes('/journals/99999')) {
          if (url.endsWith('/journalEntriesByDate')) {
            return Promise.resolve([])
          }
          if (url.endsWith('/journalStudents')) {
            return Promise.resolve([])
          }
          return Promise.resolve({ nameEt: 'Test', id: 99999 })
        }
        return Promise.resolve([])
      })

      await sendOutcomeEntriesToKriit(mockApi, links)
      expect(mockApi.tahvel.get).toHaveBeenCalled()
    })

    test('should skip links with no valid ID', async () => {
      const links = [
        {
          getAttribute: mock(() => '/invalid/path'),
          textContent: 'Invalid Link'
        }
      ]

      await sendOutcomeEntriesToKriit(mockApi, links)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })
  })

  describe('API Data Fetching', () => {
    test('should fetch journal info, entries, and students', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test Journal', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)

      expect(mockApi.tahvel.get).toHaveBeenCalledWith('/journals/12345')
      expect(mockApi.tahvel.get).toHaveBeenCalledWith('/journals/12345/journalEntriesByDate', { allStudents: true })
      expect(mockApi.tahvel.get).toHaveBeenCalledWith('/journals/12345/journalStudents', { allStudents: true })
    })

    test('should handle API errors gracefully', async () => {
      mockApi.tahvel.get = mock(() => Promise.reject(new Error('API Error')))

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })

    test('should return null if journalInfo is null', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve(null)
        }
        return Promise.resolve([])
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })

    test('should return null if journalEntriesWithGrades is not an array', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve({ notArray: true })
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })

    test('should return null if journalStudents is not an array', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve('not-array')
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })
  })

  describe('Outcome Entry Filtering', () => {
    test('should filter for SISSEKANNE_O entries only', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test Journal', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([
            { entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'outcome1', nameEt: 'Outcome 1', outcomeOrderNr: 1 },
            { entryType: 'SISSEKANNE_H', curriculumModuleOutcomes: 'outcome2', nameEt: 'Grade 1' },
            { entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'outcome3', nameEt: 'Outcome 2', outcomeOrderNr: 2 }
          ])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', [
        {
          subjectId: 12345,
          curriculumModuleOutcomes: 'outcome1',
          outcomeName: 'Outcome 1',
          learningOutcomeOrderNr: 1
        },
        {
          subjectId: 12345,
          curriculumModuleOutcomes: 'outcome3',
          outcomeName: 'Outcome 2',
          learningOutcomeOrderNr: 2
        }
      ])
    })

    test('should return if no outcome entries found', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test Journal', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_H', curriculumModuleOutcomes: 'grade1', nameEt: 'Grade 1' }])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })

    test('should handle null outcomeOrderNr gracefully', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test Journal', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'outcome1', nameEt: 'Outcome 1' }])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', [
        {
          subjectId: 12345,
          curriculumModuleOutcomes: 'outcome1',
          outcomeName: 'Outcome 1',
          learningOutcomeOrderNr: null
        }
      ])
    })
  })

  describe('Payload Construction', () => {
    test('should build correct payload structure', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Math', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([
            {
              entryType: 'SISSEKANNE_O',
              curriculumModuleOutcomes: 'outcome-123',
              nameEt: 'Algebra Skills',
              outcomeOrderNr: 5
            }
          ])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', [
        {
          subjectId: 12345,
          curriculumModuleOutcomes: 'outcome-123',
          outcomeName: 'Algebra Skills',
          learningOutcomeOrderNr: 5
        }
      ])
    })

    test('should handle multiple journals', async () => {
      const multipleLinks = [
        {
          getAttribute: mock(attr => (attr === 'href' ? '/journal/111' : null)),
          textContent: 'Journal 1'
        },
        {
          getAttribute: mock(attr => (attr === 'href' ? '/journal/222' : null)),
          textContent: 'Journal 2'
        }
      ]

      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/111') {
          return Promise.resolve({ nameEt: 'Subject 1', id: 111 })
        }
        if (url === '/journals/111/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out1', nameEt: 'Outcome 1', outcomeOrderNr: 1 }])
        }
        if (url === '/journals/222') {
          return Promise.resolve({ nameEt: 'Subject 2', id: 222 })
        }
        if (url === '/journals/222/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out2', nameEt: 'Outcome 2', outcomeOrderNr: 2 }])
        }
        return Promise.resolve([])
      })

      await sendOutcomeEntriesToKriit(mockApi, multipleLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', [
        { subjectId: 111, curriculumModuleOutcomes: 'out1', outcomeName: 'Outcome 1', learningOutcomeOrderNr: 1 },
        { subjectId: 222, curriculumModuleOutcomes: 'out2', outcomeName: 'Outcome 2', learningOutcomeOrderNr: 2 }
      ])
    })

    test('should use link text as subject name if nameEt is missing', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out1', nameEt: 'Test', outcomeOrderNr: 1 }])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).toHaveBeenCalled()
    })
  })

  describe('API Submission', () => {
    test('should send payload to /outcomes/sync endpoint', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out1', nameEt: 'Test', outcomeOrderNr: 1 }])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', expect.any(Array))
    })

    test('should handle API submission errors gracefully', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out1', nameEt: 'Test', outcomeOrderNr: 1 }])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      mockApi.kriit.post = mock(() => Promise.reject(new Error('Network error')))

      await expect(sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)).resolves.toBeUndefined()
    })

    test('should not send if no valid outcome data collected', async () => {
      mockApi.tahvel.get = mock(() => Promise.resolve([]))

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty outcome entries array', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })

    test('should handle mixed valid and invalid journals', async () => {
      const mixedLinks = [
        {
          getAttribute: mock(attr => (attr === 'href' ? '/journal/111' : null)),
          textContent: 'Valid Journal'
        },
        {
          getAttribute: mock(() => '/invalid'),
          textContent: 'Invalid Journal'
        },
        {
          getAttribute: mock(attr => (attr === 'href' ? '/journal/222' : null)),
          textContent: 'Another Valid'
        }
      ]

      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/111') {
          return Promise.resolve({ nameEt: 'Subject 1', id: 111 })
        }
        if (url === '/journals/111/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out1', nameEt: 'Outcome 1', outcomeOrderNr: 1 }])
        }
        if (url === '/journals/222') {
          return Promise.resolve({ nameEt: 'Subject 2', id: 222 })
        }
        if (url === '/journals/222/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out2', nameEt: 'Outcome 2', outcomeOrderNr: 2 }])
        }
        return Promise.resolve([])
      })

      await sendOutcomeEntriesToKriit(mockApi, mixedLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', [
        { subjectId: 111, curriculumModuleOutcomes: 'out1', outcomeName: 'Outcome 1', learningOutcomeOrderNr: 1 },
        { subjectId: 222, curriculumModuleOutcomes: 'out2', outcomeName: 'Outcome 2', learningOutcomeOrderNr: 2 }
      ])
    })

    test('should handle assignment with 0 as learningOutcomeOrderNr', async () => {
      mockApi.tahvel.get = mock(url => {
        if (url === '/journals/12345') {
          return Promise.resolve({ nameEt: 'Test', id: 12345 })
        }
        if (url === '/journals/12345/journalEntriesByDate') {
          return Promise.resolve([{ entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'out1', nameEt: 'Outcome', outcomeOrderNr: 0 }])
        }
        if (url === '/journals/12345/journalStudents') {
          return Promise.resolve([])
        }
        return Promise.resolve({})
      })

      await sendOutcomeEntriesToKriit(mockApi, mockJournalLinks)

      expect(mockApi.kriit.post).toHaveBeenCalledWith('/outcomes/sync', [
        { subjectId: 12345, curriculumModuleOutcomes: 'out1', outcomeName: 'Outcome', learningOutcomeOrderNr: 0 }
      ])
    })
  })
})
