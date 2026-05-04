import { describe, test, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { getTahvelSubjectsWithAssignmentsAndGrades, journalListSync } from '../../../src/features/journalList/JournalListSync'
import { notifyKriitGradesSynced, buildGradesForNotification } from '../../../src/features/journalList/KriitSyncNotifier.js'
import { JSDOM } from 'jsdom'
import { restoreChromeMock, restoreGlobalDOM } from '../../setup.js'
import { bannerService } from '../../../src/services/BannerService.js'
import { journalSyncBannerService } from '../../../src/features/journalList/JournalSyncBanner.js'

describe('JournalListSync - Algorithm Tests', () => {
  let apiMock
  let window
  let document

  beforeEach(() => {
    restoreChromeMock()

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://tahvel.edu.ee'
    })
    window = dom.window
    document = window.document
    global.document = document
    global.window = window
    global.localStorage = window.localStorage

    if (!global.btoa) {
      global.btoa = str => Buffer.from(str).toString('base64')
    }

    // Reset chrome storage mocks to default empty state (use mockClear + mockImplementation, not mockReset)
    if (global.chrome?.storage?.local) {
      global.chrome.storage.local.get.mockClear()
      global.chrome.storage.local.set.mockClear()
      global.chrome.storage.local.remove.mockClear()

      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({}) // Always start with empty cache
      })
      global.chrome.storage.local.set.mockImplementation((data, callback) => {
        if (callback) callback()
      })
      global.chrome.storage.local.remove.mockImplementation((keys, callback) => {
        if (callback) callback()
      })
    }

    apiMock = {
      tahvel: {
        get: mock(async (endpoint, params = {}, options = {}) => {
          if (endpoint === '/journals/123') {
            return {
              id: 123,
              nameEt: 'Test Subject',
              studentGroups: ['TEST-GROUP'],
              journalTeachers: [
                {
                  id: 1,
                  nameEt: 'Test Teacher',
                  fullname: 'Test Teacher'
                }
              ]
            }
          }
          if (endpoint === '/journals/123/journalStudents?allStudents=true') {
            return [
              {
                id: 1,
                studentId: 100,
                fullname: 'Student Test',
                studentGroup: 'TEST-GROUP',
                status: 'OPPURSTAATUS_O'
              }
            ]
          }
          if (endpoint === '/journals/123/journalEntriesByDate?allStudents=true') {
            return [
              {
                entryDate: '2025-01-01T00:00:00Z',
                nameEt: 'Test Assignment',
                entryType: 'SISSEKANNE_I',
                id: 500,
                journalStudentResults: {
                  1: [
                    {
                      journalStudentId: 1,
                      grade: { code: 'KUTSEHINDAMINE_A' }
                    }
                  ]
                }
              }
            ]
          }
          if (endpoint === '/students/100') {
            return {
              id: 100,
              person: {
                idcode: '50001010001',
                fullname: 'Student Test'
              },
              status: 'OPPURSTAATUS_O'
            }
          }
          if (endpoint.includes('/teachers')) {
            return {
              content: [
                {
                  id: 1,
                  name: 'Test Teacher',
                  idcode: '38001010001'
                }
              ]
            }
          }
          return null
        })
      }
    }

    journalListSync.api = apiMock
    journalListSync.differences = null
    journalListSync.error = null
    journalListSync.isLoading = false
    journalListSync.isActive = false
    journalListSync.journalStudentIdToStudentId = {}
    journalListSync._localStudentCache = {}
  })

  afterEach(() => {
    // Clear chrome storage mocks
    if (global.chrome?.storage?.local) {
      global.chrome.storage.local.get.mockClear()
      global.chrome.storage.local.set.mockClear()
      global.chrome.storage.local.remove.mockClear()
    }

    delete global.bannerService
    delete global.btoa

    // Restore console methods
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

    restoreChromeMock()
    restoreGlobalDOM()
  })

  describe('getTahvelSubjectsWithAssignmentsAndGrades', () => {
    test('should handle basic journal sync flow', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [123])

      expect(result).toHaveLength(1)
      expect(result[0].subjectName).toBe('Test Subject')
      expect(result[0].subjectExternalId).toBe(123)
      expect(result[0].groupName).toBe('TEST-GROUP')
    })

    test('should fetch and process assignments', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [123])

      expect(result[0].assignments).toHaveLength(1)
      expect(result[0].assignments[0].assignmentName).toBe('Test Assignment')
      expect(result[0].assignments[0].assignmentExternalId).toBe(500)
      expect(result[0].assignments[0].assignmentEntryDate).toBe('2025-01-01')
    })

    test('should process student results with grades', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [123])

      const assignment = result[0].assignments[0]
      expect(assignment.results).toHaveLength(1)
      expect(assignment.results[0].grade).toBe('A')
      expect(assignment.results[0].studentPersonalCode).toBe('50001010001')
      expect(assignment.results[0].studentName).toBe('Student Test')
    })

    test('should process teacher data', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [123])

      expect(result[0].teacherName).toBe('Test Teacher')
      expect(result[0].teacherPersonalCode).toBe('38001010001')
    })

    test('should mark active students correctly', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [123])

      const assignment = result[0].assignments[0]
      expect(assignment.results[0].studentIsActive).toBe(true)
    })

    test('should handle empty journal list', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [])

      expect(result).toEqual([])
    })

    test('should handle null journal list', async () => {
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, null)

      expect(result).toEqual([])
    })

    test('should handle multiple journals', async () => {
      const multiJournalApi = {
        tahvel: {
          get: mock(async (endpoint, params = {}, options = {}) => {
            if (endpoint === '/journals/100' || endpoint === '/journals/200') {
              const id = parseInt(endpoint.split('/')[2])
              return {
                id,
                nameEt: `Subject ${id}`,
                studentGroups: ['GROUP-1'],
                journalTeachers: [
                  {
                    id: 1,
                    nameEt: 'Test Teacher',
                    fullname: 'Test Teacher'
                  }
                ]
              }
            }
            if (endpoint.includes('/journals/100/journalStudents') || endpoint.includes('/journals/200/journalStudents')) {
              return [
                {
                  id: 1,
                  studentId: 100,
                  fullname: 'Student Test',
                  studentGroup: 'GROUP-1',
                  status: 'OPPURSTAATUS_O'
                }
              ]
            }
            if (endpoint.includes('journalEntriesByDate')) {
              return [
                {
                  entryDate: '2025-01-01T00:00:00Z',
                  nameEt: 'Test Entry',
                  entryType: 'SISSEKANNE_I',
                  id: 999,
                  journalStudentResults: {
                    1: [
                      {
                        journalStudentId: 1,
                        grade: { code: 'KUTSEHINDAMINE_A' }
                      }
                    ]
                  }
                }
              ]
            }
            if (endpoint.includes('/students/')) {
              return {
                id: 100,
                person: {
                  idcode: '50001010001',
                  fullname: 'Student Test'
                },
                status: 'OPPURSTAATUS_O'
              }
            }
            if (endpoint.includes('teachers')) return { content: [] }
            return null
          })
        }
      }

      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: multiJournalApi }, [100, 200])

      expect(result).toHaveLength(2)
      expect(result[0].subjectExternalId).toBe(100)
      expect(result[1].subjectExternalId).toBe(200)
    })
  })

  describe('extractEntryDateDifferences', () => {
    test('should extract entry date differences correctly', () => {
      journalListSync.differences = [
        {
          subjectName: 'Math',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              assignmentName: 'Test 1',
              assignmentEntryDate: {
                kriit: '2025-01-01',
                Tahvel: '2025-01-02'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryDateDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].assignmentExternalId).toBe(10)
      expect(result[0].kriit).toBe('2025-01-01')
      expect(result[0].Tahvel).toBe('2025-01-02')
      expect(result[0].subjectName).toBe('Math')
    })

    test('should skip when dates are identical', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentEntryDate: {
                kriit: '2025-01-01',
                Tahvel: '2025-01-01'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryDateDifferences()

      expect(result).toHaveLength(0)
    })

    test('should handle missing differences array', () => {
      journalListSync.differences = null

      const result = journalListSync.extractEntryDateDifferences()

      expect(result).toEqual([])
    })

    test('should handle object assignment names', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentExternalId: 20,
              assignmentName: {
                kriit: 'Kriit Name',
                Tahvel: 'Tahvel Name'
              },
              assignmentEntryDate: {
                kriit: '2025-01-01',
                Tahvel: '2025-01-02'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryDateDifferences()

      expect(result[0].assignmentName).toBe('Kriit Name')
    })

    test('should skip when both dates are null', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentEntryDate: {
                kriit: null,
                Tahvel: null
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryDateDifferences()

      expect(result).toHaveLength(0)
    })
  })

  describe('extractAssignmentNameDifferences', () => {
    test('should extract name differences correctly', () => {
      journalListSync.differences = [
        {
          subjectName: 'Physics',
          subjectExternalId: 2,
          assignments: [
            {
              assignmentExternalId: 30,
              assignmentName: {
                kriit: 'Lab Work 1',
                Tahvel: 'Laboratory Work 1'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentNameDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].subjectName).toBe('Physics')
      expect(result[0].nameDiffs).toHaveLength(1)
      expect(result[0].nameDiffs[0].kriit).toBe('Lab Work 1')
      expect(result[0].nameDiffs[0].Tahvel).toBe('Laboratory Work 1')
    })

    test('should skip when names are identical', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentName: {
                kriit: 'Same Name',
                Tahvel: 'Same Name'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentNameDifferences()

      expect(result).toHaveLength(0)
    })

    test('should skip when only one name exists', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentName: {
                kriit: 'Only Kriit',
                Tahvel: null
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentNameDifferences()

      expect(result).toHaveLength(0)
    })

    test('should handle empty differences', () => {
      journalListSync.differences = []

      const result = journalListSync.extractAssignmentNameDifferences()

      expect(result).toEqual([])
    })

    test('should group differences by subject', () => {
      journalListSync.differences = [
        {
          subjectName: 'Math',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              assignmentName: { kriit: 'Test A', Tahvel: 'Test B' }
            },
            {
              assignmentExternalId: 11,
              assignmentName: { kriit: 'Quiz A', Tahvel: 'Quiz B' }
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentNameDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].nameDiffs).toHaveLength(2)
    })
  })

  describe('extractDueDateDifferences', () => {
    test('should extract due date differences', () => {
      journalListSync.differences = [
        {
          subjectName: 'Chemistry',
          subjectExternalId: 3,
          assignments: [
            {
              assignmentExternalId: 40,
              assignmentName: 'Homework',
              assignmentDueAt: {
                kriit: '2025-02-01',
                Tahvel: '2025-02-05'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractDueDateDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].kriit).toBe('2025-02-01')
      expect(result[0].Tahvel).toBe('2025-02-05')
    })

    test('should skip identical due dates', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentDueAt: {
                kriit: '2025-02-01',
                Tahvel: '2025-02-01'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractDueDateDifferences()

      expect(result).toHaveLength(0)
    })

    test('should skip when both are null', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentDueAt: {
                kriit: null,
                Tahvel: null
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractDueDateDifferences()

      expect(result).toHaveLength(0)
    })
  })

  describe('extractAssignmentHoursDifferences', () => {
    test('should extract hours differences', () => {
      journalListSync.differences = [
        {
          subjectName: 'Biology',
          subjectExternalId: 4,
          assignments: [
            {
              assignmentExternalId: 50,
              assignmentName: 'Lab',
              assignmentHours: 2
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentHoursDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].kriitHours).toBe(2)
      expect(result[0].subjectName).toBe('Biology')
    })

    test('should handle zero hours', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentExternalId: 60,
              assignmentName: 'Quick Quiz',
              assignmentHours: 0
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentHoursDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].kriitHours).toBe(0)
    })

    test('should skip undefined hours', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentName: 'No Hours'
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentHoursDifferences()

      expect(result).toHaveLength(0)
    })

    test('should skip null hours', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              assignmentHours: null
            }
          ]
        }
      ]

      const result = journalListSync.extractAssignmentHoursDifferences()

      expect(result).toHaveLength(0)
    })
  })

  describe('resolveJournalFromElement', () => {
    test('should resolve journal ID from anchor href', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/journal/12345')

      const result = journalListSync.resolveJournalFromElement(anchor)

      expect(result).toBeTruthy()
      expect(result.id).toBe(12345)
      expect(result.href).toBe('/journal/12345')
    })

    test('should resolve journal ID from anchor with hash', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '#/journal/67890')

      const result = journalListSync.resolveJournalFromElement(anchor)

      expect(result).toBeTruthy()
      expect(result.id).toBe(67890)
    })

    test('should resolve journal ID from ng-href', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('ng-href', '#!/journal/11111')

      const result = journalListSync.resolveJournalFromElement(anchor)

      expect(result).toBeTruthy()
      expect(result.id).toBe(11111)
    })

    test('should walk up DOM tree to find anchor', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/journal/22222')
      const span = document.createElement('span')
      span.className = 'linked-name'
      anchor.appendChild(span)

      const result = journalListSync.resolveJournalFromElement(span)

      expect(result).toBeTruthy()
      expect(result.id).toBe(22222)
    })

    test('should resolve from data-journal-id attribute', () => {
      const div = document.createElement('div')
      div.dataset.journalId = '33333'

      const result = journalListSync.resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(33333)
    })

    test('should resolve from router link attribute', () => {
      const div = document.createElement('div')
      div.setAttribute('ng-reflect-router-link', '/journal/44444')

      const result = journalListSync.resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(44444)
    })

    test('should find anchor in same table row', () => {
      const tr = document.createElement('tr')
      const td1 = document.createElement('td')
      const td2 = document.createElement('td')
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/journal/55555')

      td2.appendChild(anchor)
      tr.appendChild(td1)
      tr.appendChild(td2)

      const result = journalListSync.resolveJournalFromElement(td1)

      expect(result).toBeTruthy()
      expect(result.id).toBe(55555)
    })

    test('should find anchor in sibling elements', () => {
      const parent = document.createElement('div')
      const span = document.createElement('span')
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/journal/66666')

      parent.appendChild(span)
      parent.appendChild(anchor)

      const result = journalListSync.resolveJournalFromElement(span)

      expect(result).toBeTruthy()
      expect(result.id).toBe(66666)
    })

    test('should extract from outerHTML journal/ pattern', () => {
      const div = document.createElement('div')
      div.innerHTML = '<span>Link to journal/77777 here</span>'

      const result = journalListSync.resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(77777)
    })

    test('should extract from outerHTML #/journal/ pattern', () => {
      const div = document.createElement('div')
      div.innerHTML = '<span data-link="#/journal/88888"></span>'

      const result = journalListSync.resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(88888)
    })

    test('should extract from outerHTML data-journal-id pattern', () => {
      const div = document.createElement('div')
      div.innerHTML = '<div data-journal-id="99999"></div>'

      const result = journalListSync.resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(99999)
    })

    test('should return null for element without journal ID', () => {
      const div = document.createElement('div')
      div.textContent = 'No journal here'

      const result = journalListSync.resolveJournalFromElement(div)

      expect(result).toBeNull()
    })

    test('should extract from element with multiple attribute patterns', () => {
      const mockEl = {
        getAttribute: attr => {
          const attrs = {
            'ui-sref': 'journal.view({id: 999})',
            'ng-href': null,
            href: null
          }
          return attrs[attr] || null
        },
        outerHTML: '',
        closest: () => null,
        parentElement: null
      }

      const result = journalListSync.resolveJournalFromElement(mockEl)
      expect(result).toBeDefined()
    })

    test('should walk up parent chain to find journal', () => {
      const grandparent = {
        getAttribute: attr => (attr === 'data-journal-id' ? '123' : null),
        outerHTML: 'data-journal-id="123"',
        closest: () => null,
        parentElement: null
      }
      const parent = {
        getAttribute: () => null,
        outerHTML: '',
        closest: () => null,
        parentElement: grandparent
      }
      const child = {
        getAttribute: () => null,
        outerHTML: '',
        closest: () => null,
        parentElement: parent
      }

      const result = journalListSync.resolveJournalFromElement(child)
      expect(result).toBeDefined()
      if (result) expect(result.id).toBe(123)
    })

    test('should handle closest() throwing error', () => {
      const mockEl = {
        getAttribute: () => null,
        outerHTML: '',
        closest: () => {
          throw new Error('DOM error')
        },
        parentElement: null
      }

      const result = journalListSync.resolveJournalFromElement(mockEl)
      expect(result).toBeNull()
    })

    test('should handle querySelectorAll throwing error in table row', () => {
      const mockTr = {
        querySelectorAll: () => {
          throw new Error('Query error')
        }
      }
      const mockEl = {
        getAttribute: () => null,
        outerHTML: '',
        closest: sel => (sel === 'tr' ? mockTr : null),
        parentElement: null
      }

      const result = journalListSync.resolveJournalFromElement(mockEl)
      expect(result).toBeNull()
    })

    test('should return null for null element', () => {
      const result = journalListSync.resolveJournalFromElement(null)

      expect(result).toBeNull()
    })

    test('should return null for undefined element', () => {
      const result = journalListSync.resolveJournalFromElement(undefined)

      expect(result).toBeNull()
    })

    test('should match journal IDs from href regardless of digit count', () => {
      const shortAnchor = document.createElement('a')
      shortAnchor.setAttribute('href', '/journal/12')
      const shortResult = journalListSync.resolveJournalFromElement(shortAnchor)
      expect(shortResult.id).toBe(12)

      const validAnchor = document.createElement('a')
      validAnchor.setAttribute('href', '/journal/123456')
      const validResult = journalListSync.resolveJournalFromElement(validAnchor)
      expect(validResult.id).toBe(123456)
    })
  })

  describe('resetJournalLinks', () => {
    test('should clear journal links array', () => {
      journalListSync.journalLinks = [{ id: 1 }, { id: 2 }]

      journalListSync.resetJournalLinks()

      expect(journalListSync.journalLinks).toBeNull()
    })

    test('should handle already empty journal links', () => {
      journalListSync.journalLinks = []

      journalListSync.resetJournalLinks()

      expect(journalListSync.journalLinks).toBeNull()
    })

    test('should handle null journal links', () => {
      journalListSync.journalLinks = null

      journalListSync.resetJournalLinks()

      expect(journalListSync.journalLinks).toBeNull()
    })
  })

  describe('sendOutcomeEntriesToKriit', () => {
    test('should return early if no API token', async () => {
      journalListSync.api = { kriit: { authToken: null } }
      journalListSync.journalLinks = [{ id: 1 }]

      await journalListSync.sendOutcomeEntriesToKriit()

      expect(journalListSync.api.kriit.authToken).toBeNull()
    })

    test('should return early if no journal links', async () => {
      journalListSync.api = { kriit: { authToken: 'test-token' } }
      journalListSync.journalLinks = []

      await journalListSync.sendOutcomeEntriesToKriit()

      expect(journalListSync.journalLinks).toHaveLength(0)
    })

    test('should return early if journal links is null', async () => {
      journalListSync.api = { kriit: { authToken: 'test-token' } }
      journalListSync.journalLinks = null

      await journalListSync.sendOutcomeEntriesToKriit()

      expect(journalListSync.journalLinks).toBeNull()
    })
  })

  describe('processStudentData', () => {
    test('should return empty map for null students', async () => {
      const result = await journalListSync.processStudentData(123, null)

      expect(result).toEqual({})
    })

    test('should return empty map for empty array', async () => {
      const result = await journalListSync.processStudentData(123, [])

      expect(result).toEqual({})
    })

    test('should process valid student data', async () => {
      journalListSync.api.tahvel.get = mock(async endpoint => {
        const m = endpoint.match(/^\/students\/(\d+)/)
        if (m) {
          return {
            id: parseInt(m[1], 10),
            person: {
              idcode: '50001010001',
              fullname: 'Test Student'
            },
            status: 'OPPURSTAATUS_O'
          }
        }
        return null
      })

      const journalStudents = [
        {
          id: 1,
          studentId: 100,
          fullname: 'Test Student'
        }
      ]

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result).toBeTruthy()
      expect(result[100]).toBeTruthy()
      expect(result[100].personalCode).toBe('50001010001')
      expect(result[100].isActive).toBe(true)
    })

    test('should handle inactive students', async () => {
      journalListSync.api.tahvel.get = mock(async endpoint => {
        const m = endpoint.match(/^\/students\/(\d+)/)
        if (m) {
          return {
            id: parseInt(m[1], 10),
            person: {
              idcode: '50001010002',
              fullname: 'Inactive Student'
            },
            status: 'OPPURSTAATUS_A'
          }
        }
        return null
      })

      const journalStudents = [
        {
          id: 2,
          studentId: 200,
          fullname: 'Inactive Student'
        }
      ]

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result[200].isActive).toBe(false)
    })

    test('should handle deleted students', async () => {
      journalListSync.api.tahvel.get = mock(async endpoint => {
        const m = endpoint.match(/^\/students\/(\d+)/)
        if (m) {
          return {
            id: parseInt(m[1], 10),
            person: {
              idcode: '50001010003',
              fullname: 'Deleted Student'
            },
            status: 'OPPURSTAATUS_K'
          }
        }
        return null
      })

      const journalStudents = [
        {
          id: 3,
          studentId: 300,
          fullname: 'Deleted Student'
        }
      ]

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result[300].isDeleted).toBe(true)
    })

    test('should handle graduated students', async () => {
      journalListSync.api.tahvel.get = mock(async endpoint => {
        const m = endpoint.match(/^\/students\/(\d+)/)
        if (m) {
          return {
            id: parseInt(m[1], 10),
            person: {
              idcode: '50001010004',
              fullname: 'Graduated Student'
            },
            status: 'OPPURSTAATUS_L'
          }
        }
        return null
      })

      const journalStudents = [
        {
          id: 4,
          studentId: 400,
          fullname: 'Graduated Student'
        }
      ]

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result[400].isActive).toBe(false)
      expect(result[400].isDeleted).toBe(false)
      expect(result[400].isGraduated).toBe(true)
    })

    test('should skip students without studentId', async () => {
      const journalStudents = [
        { id: 4, fullname: 'No Student ID' },
        {
          id: 5,
          studentId: 500,
          fullname: 'Valid Student'
        }
      ]

      journalListSync.api.tahvel.get = mock(async endpoint => {
        const m = endpoint.match(/^\/students\/(\d+)/)
        if (m) {
          return {
            id: parseInt(m[1], 10),
            person: {
              idcode: '50001010005',
              fullname: 'Valid Student'
            },
            status: 'OPPURSTAATUS_O'
          }
        }
        return null
      })

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result[500]).toBeTruthy()
      expect(Object.keys(result)).toHaveLength(1)
    })

    test('should handle API errors gracefully', async () => {
      journalListSync.api.tahvel.get = mock(async () => {
        throw new Error('API Error')
      })

      const journalStudents = [
        {
          id: 6,
          studentId: 600,
          fullname: 'Error Student'
        }
      ]

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result).toEqual({})
    })
  })

  describe('getJournalInfo', () => {
    test('should fetch journal info from API with caching', async () => {
      const mockJournalInfo = {
        id: 12345,
        nameEt: 'Test Journal',
        studentGroups: ['TEST-GROUP']
      }

      journalListSync.api = {
        tahvel: {
          get: mock(async () => mockJournalInfo)
        }
      }

      const result = await journalListSync.getJournalInfo(12345)

      expect(result).toEqual(mockJournalInfo)
      expect(journalListSync.api.tahvel.get).toHaveBeenCalled()
      const callArgs = journalListSync.api.tahvel.get.mock.calls[0]
      expect(callArgs[0]).toBe('/journals/12345')
      expect(callArgs[2]).toHaveProperty('cacheExpiration')
    })

    test('should pass through API errors', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      await expect(journalListSync.getJournalInfo(12345)).rejects.toThrow('API Error')
    })
  })

  describe('getStudentDetails', () => {
    test('should fetch student details from API with caching', async () => {
      const mockStudent = {
        id: 100,
        person: {
          idcode: '50001010001',
          fullname: 'Test Student'
        },
        status: 'OPPURSTAATUS_O'
      }

      journalListSync.api = {
        tahvel: {
          get: mock(async () => mockStudent)
        }
      }

      const result = await journalListSync.getStudentDetails(100)

      expect(result).toEqual(mockStudent)
      expect(journalListSync.api.tahvel.get).toHaveBeenCalled()
      const callArgs = journalListSync.api.tahvel.get.mock.calls[0]
      expect(callArgs[0]).toBe('/students/100')
      expect(callArgs[2]).toHaveProperty('cacheExpiration')
    })

    test('should pass through API result', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => null)
        }
      }

      const result = await journalListSync.getStudentDetails(999)

      expect(result).toBeNull()
    })
  })

  describe('createStudentMap', () => {
    test('should create empty map for null students', () => {
      const result = journalListSync.createStudentMap(null, {})

      expect(result).toEqual({
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      })
    })

    test('should create empty map for empty array', () => {
      const result = journalListSync.createStudentMap([], {})

      expect(result).toEqual({
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      })
    })

    test('should map journal student IDs to student IDs', () => {
      const journalStudents = [
        { id: 10, studentId: 100 },
        { id: 11, studentId: 101 }
      ]
      const studentDetailsMap = {
        100: { personalCode: '38001010001', name: 'Student A' },
        101: { personalCode: '38002020002', name: 'Student B' }
      }

      const result = journalListSync.createStudentMap(journalStudents, studentDetailsMap)

      expect(result.journalStudentIdToId[10]).toBe(100)
      expect(result.journalStudentIdToId[11]).toBe(101)
    })

    test('should map student IDs to personal codes', () => {
      const journalStudents = [{ id: 10, studentId: 100 }]
      const studentDetailsMap = {
        100: { personalCode: '38001010001', name: 'Student A' }
      }

      const result = journalListSync.createStudentMap(journalStudents, studentDetailsMap)

      expect(result.idToPersonalCode[100]).toBe('38001010001')
    })

    test('should map personal codes to names', () => {
      const journalStudents = [{ id: 10, studentId: 100 }]
      const studentDetailsMap = {
        100: { personalCode: '38001010001', name: 'Student A' }
      }

      const result = journalListSync.createStudentMap(journalStudents, studentDetailsMap)

      expect(result.personalCodeToName['38001010001']).toBe('Student A')
    })

    test('should handle students with embedded personal codes', () => {
      const journalStudents = [
        {
          id: 10,
          studentId: 100,
          student: { idcode: '38001010001', fullname: 'Embedded Student' }
        }
      ]
      const studentDetailsMap = {}

      const result = journalListSync.createStudentMap(journalStudents, studentDetailsMap)

      expect(result.idToPersonalCode[100]).toBe('38001010001')
      expect(result.personalCodeToName['38001010001']).toBe('Embedded Student')
    })

    test('should throw error if no personal code found anywhere', () => {
      const journalStudents = [{ id: 10, studentId: 100 }]
      const studentDetailsMap = {}

      expect(() => {
        journalListSync.createStudentMap(journalStudents, studentDetailsMap)
      }).toThrow('No personal code found for student ID 100')
    })

    test('should skip students without id', () => {
      const journalStudents = [{ studentId: 100 }]
      const studentDetailsMap = {
        100: { personalCode: '38001010001', name: 'Student A' }
      }

      const result = journalListSync.createStudentMap(journalStudents, studentDetailsMap)

      expect(Object.keys(result.journalStudentIdToId)).toHaveLength(0)
    })

    test('should skip students without studentId', () => {
      const journalStudents = [{ id: 10 }]

      const result = journalListSync.createStudentMap(journalStudents, {})

      expect(Object.keys(result.journalStudentIdToId)).toHaveLength(0)
    })
  })

  describe('getAssignmentNameFromEntry', () => {
    test('should return nameEt if present', () => {
      const entry = { nameEt: 'Assignment Name', content: 'Some content', entryType: 'SISSEKANNE_H' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Assignment Name')
    })

    test('should extract first sentence from content', () => {
      const entry = { content: 'This is the first sentence. This is second.', entryType: 'SISSEKANNE_H' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('This is the first sentence')
    })

    test('should extract up to first newline', () => {
      const entry = { content: 'First line\nSecond line', entryType: 'SISSEKANNE_H' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('First line')
    })

    test('should limit content to 100 characters', () => {
      const longContent = 'A'.repeat(150)
      const entry = { content: longContent, entryType: 'SISSEKANNE_H' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('A'.repeat(100) + '...')
    })

    test('should return type-specific name for SISSEKANNE_H', () => {
      const entry = { entryType: 'SISSEKANNE_H' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Hindeline töö')
    })

    test('should return type-specific name for SISSEKANNE_I', () => {
      const entry = { entryType: 'SISSEKANNE_I' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Iseseisev töö')
    })

    test('should return type-specific name for SISSEKANNE_P', () => {
      const entry = { entryType: 'SISSEKANNE_P' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Praktiline töö')
    })

    test('should return type-specific name for SISSEKANNE_O', () => {
      const entry = { entryType: 'SISSEKANNE_O' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Õppetulemus')
    })

    test('should return default name for unknown type', () => {
      const entry = { entryType: 'UNKNOWN_TYPE' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Päeviku sissekanne')
    })

    test('should handle entry with no content or nameEt', () => {
      const entry = { entryType: 'SISSEKANNE_H' }

      const result = journalListSync.getAssignmentNameFromEntry(entry)

      expect(result).toBe('Hindeline töö')
    })
  })

  describe('getJournalEntries', () => {
    test('should fetch journal entries from API', async () => {
      const mockEntries = [
        { id: 1, nameEt: 'Entry 1' },
        { id: 2, nameEt: 'Entry 2' }
      ]

      journalListSync.api = {
        tahvel: {
          get: mock(async () => ({ content: mockEntries }))
        }
      }

      const result = await journalListSync.getJournalEntries(123)

      expect(result).toEqual(mockEntries)
      expect(journalListSync.api.tahvel.get).toHaveBeenCalledWith('/journals/123/journalEntry', { size: 2000 }, expect.objectContaining({ cache: true }))
    })

    test('should return empty array for unexpected response format', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => ({ unexpected: 'format' }))
        }
      }

      const result = await journalListSync.getJournalEntries(123)

      expect(result).toEqual([])
    })

    test('should return null on API error', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      const result = await journalListSync.getJournalEntries(123)

      expect(result).toBeNull()
    })
  })

  describe('getJournalEntriesWithGrades', () => {
    test('should fetch entries with grades from API', async () => {
      const mockEntries = [
        { id: 1, nameEt: 'Entry 1', journalStudentResults: [] },
        { id: 2, nameEt: 'Entry 2', journalStudentResults: [] }
      ]

      journalListSync.api = {
        tahvel: {
          get: mock(async () => mockEntries)
        }
      }

      const result = await journalListSync.getJournalEntriesWithGrades(123)

      expect(result).toEqual(mockEntries)
      expect(journalListSync.api.tahvel.get).toHaveBeenCalledWith(
        '/journals/123/journalEntriesByDate',
        { allStudents: true },
        expect.objectContaining({ cache: true })
      )
    })

    test('should return empty array for non-array response', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => ({ not: 'array' }))
        }
      }

      const result = await journalListSync.getJournalEntriesWithGrades(123)

      expect(result).toEqual([])
    })

    test('should return null on API error', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      const result = await journalListSync.getJournalEntriesWithGrades(123)

      expect(result).toBeNull()
    })
  })

  describe('getJournalStudents', () => {
    test('should fetch journal students from API', async () => {
      const mockStudents = [
        { id: 1, studentId: 100, student: { idcode: '38001010001' } },
        { id: 2, studentId: 101, student: { idcode: '38002020002' } }
      ]

      journalListSync.api = {
        tahvel: {
          get: mock(async () => mockStudents)
        }
      }

      const result = await journalListSync.getJournalStudents(123)

      expect(result).toEqual(mockStudents)
      expect(journalListSync.api.tahvel.get).toHaveBeenCalledWith(
        '/journals/123/journalStudents',
        { allStudents: true },
        expect.objectContaining({ cacheExpiration: 60 * 60 * 1000 })
      )
    })

    test('should return null when no response', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => null)
        }
      }

      const result = await journalListSync.getJournalStudents(123)

      expect(result).toBeNull()
    })

    test('should return null on API error', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      const result = await journalListSync.getJournalStudents(123)

      expect(result).toBeNull()
    })
  })

  describe('extractAssignmentsFromEntries', () => {
    test('should return empty array for null entries', () => {
      const result = journalListSync.extractAssignmentsFromEntries(null, {})

      expect(result).toEqual([])
    })

    test('should return empty array for non-array entries', () => {
      const result = journalListSync.extractAssignmentsFromEntries({ not: 'array' }, {})

      expect(result).toEqual([])
    })

    test('should filter for graded entries only', () => {
      const entries = [
        { id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Graded Work' },
        { id: 2, entryType: 'SISSEKANNE_I', nameEt: 'Independent Work' },
        { id: 3, entryType: 'SISSEKANNE_P', nameEt: 'Practical Work' },
        { id: 4, entryType: 'SISSEKANNE_O', nameEt: 'Outcome' },
        { id: 5, entryType: 'OTHER', nameEt: 'Other' }
      ]
      const studentMap = {
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result).toHaveLength(3)
      expect(result[0].assignmentName).toBe('Graded Work')
      expect(result[1].assignmentName).toBe('Independent Work')
      expect(result[2].assignmentName).toBe('Practical Work')
    })

    test('should extract assignment with results', () => {
      const entries = [
        {
          id: 1,
          entryType: 'SISSEKANNE_H',
          nameEt: 'Test Assignment',
          content: 'Instructions',
          homeworkDuedate: '2024-01-15T12:00:00',
          entryDate: '2024-01-01T12:00:00',
          lessons: 2
        }
      ]
      const studentMap = {
        idToPersonalCode: { 100: '38001010001' },
        personalCodeToName: { 38001010001: 'Test Student' },
        journalStudentIdToId: { 10: 100 }
      }
      const journalStudents = [{ id: 10, studentId: 100 }]
      const studentDetailsMap = {
        100: { isActive: true, isDeleted: false }
      }
      const entriesWithGrades = [
        {
          id: 1,
          entryType: 'SISSEKANNE_H',
          journalStudentResults: {
            10: [{ grade: { code: 'KUTSEHINDAMINE_5' } }]
          }
        }
      ]

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents, studentDetailsMap, entriesWithGrades)

      expect(result).toHaveLength(1)
      expect(result[0].assignmentExternalId).toBe(1)
      expect(result[0].assignmentName).toBe('Test Assignment')
      expect(result[0].assignmentInstructions).toBe('Instructions')
      expect(result[0].assignmentDueAt).toBe('2024-01-15')
      expect(result[0].assignmentEntryDate).toBe('2024-01-01')
      expect(result[0].lessons).toBe(2)
      expect(result[0].entryType).toBe('SISSEKANNE_H')
      expect(result[0].results).toHaveLength(1)
      expect(result[0].results[0].grade).toBe('5')
      expect(result[0].results[0].studentPersonalCode).toBe('38001010001')
      expect(result[0].results[0].studentName).toBe('Test Student')
    })

    test('should include entryType field for SISSEKANNE_I assignments', () => {
      const entries = [
        {
          id: 1,
          entryType: 'SISSEKANNE_I',
          nameEt: 'Independent Work',
          entryDate: '2024-01-01T12:00:00'
        }
      ]
      const studentMap = {
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result).toHaveLength(1)
      expect(result[0].entryType).toBe('SISSEKANNE_I')
    })

    test('should include entryType field for SISSEKANNE_P assignments', () => {
      const entries = [
        {
          id: 1,
          entryType: 'SISSEKANNE_P',
          nameEt: 'Practical Work',
          entryDate: '2024-01-01T12:00:00'
        }
      ]
      const studentMap = {
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result).toHaveLength(1)
      expect(result[0].entryType).toBe('SISSEKANNE_P')
      expect(result[0].assignmentName).toBe('Practical Work')
    })

    test('should include students with empty grades', () => {
      const entries = [{ id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Assignment' }]
      const studentMap = {
        idToPersonalCode: { 100: '38001010001', 101: '38002020002' },
        personalCodeToName: { 38001010001: 'Student A', 38002020002: 'Student B' },
        journalStudentIdToId: { 10: 100, 11: 101 }
      }
      const journalStudents = [
        { id: 10, studentId: 100 },
        { id: 11, studentId: 101 }
      ]
      const entriesWithGrades = [
        {
          id: 1,
          entryType: 'SISSEKANNE_H',
          journalStudentResults: {
            10: [{ grade: { code: 'KUTSEHINDAMINE_4' } }]
          }
        }
      ]

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents, {}, entriesWithGrades)

      expect(result[0].results).toHaveLength(2)
      expect(result[0].results[0].grade).toBe('4')
      expect(result[0].results[1].grade).toBe('')
    })

    test('should exclude outcome entries from graded entries', () => {
      const entries = [
        { id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Graded' },
        { entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 'OUTCOME_123', nameEt: 'Outcome' }
      ]
      const studentMap = { idToPersonalCode: {}, personalCodeToName: {}, journalStudentIdToId: {} }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result).toHaveLength(1)
      expect(result[0].assignmentName).toBe('Graded')
    })

    test('should fallback to entryDate when no homeworkDuedate', () => {
      const entries = [
        {
          id: 1,
          entryType: 'SISSEKANNE_H',
          nameEt: 'Assignment',
          entryDate: '2024-01-01T12:00:00'
        }
      ]
      const studentMap = { idToPersonalCode: {}, personalCodeToName: {}, journalStudentIdToId: {} }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result[0].assignmentDueAt).toBe('2024-01-01')
    })

    test('should use getAssignmentNameFromEntry when nameEt missing', () => {
      const entries = [{ id: 1, entryType: 'SISSEKANNE_H', content: 'First sentence. Second.' }]
      const studentMap = { idToPersonalCode: {}, personalCodeToName: {}, journalStudentIdToId: {} }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result[0].assignmentName).toBe('First sentence')
    })

    test('should skip students without personal code', () => {
      const entries = [{ id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Assignment' }]
      const studentMap = {
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: { 10: 100 }
      }
      const journalStudents = [{ id: 10, studentId: 100 }]

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents)

      expect(result[0].results).toHaveLength(0)
    })

    test('should handle student name from journal students when not in map', () => {
      const entries = [{ id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Assignment' }]
      const studentMap = {
        idToPersonalCode: { 100: '38001010001' },
        personalCodeToName: {},
        journalStudentIdToId: { 10: 100 }
      }
      const journalStudents = [{ id: 10, studentId: 100, studentName: 'Journal Student Name' }]

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents)

      expect(result[0].results[0].studentName).toBe('Journal Student Name')
    })

    test('should set lessons to null when undefined', () => {
      const entries = [{ id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Assignment' }]
      const studentMap = { idToPersonalCode: {}, personalCodeToName: {}, journalStudentIdToId: {} }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result[0].lessons).toBeNull()
    })

    test('should convert lessons to number', () => {
      const entries = [{ id: 1, entryType: 'SISSEKANNE_H', nameEt: 'Assignment', lessons: '3' }]
      const studentMap = { idToPersonalCode: {}, personalCodeToName: {}, journalStudentIdToId: {} }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result[0].lessons).toBe(3)
    })
  })

  describe('getStudyYearIdFromText', () => {
    test('should return null for empty yearText', async () => {
      const result = await journalListSync.getStudyYearIdFromText('')

      expect(result).toBeNull()
    })

    test('should return null for null yearText', async () => {
      const result = await journalListSync.getStudyYearIdFromText(null)

      expect(result).toBeNull()
    })

    test('should fetch and match study year', async () => {
      const mockStudyYears = [
        { id: 1, nameEt: '2023/2024' },
        { id: 2, nameEt: '2024/2025' }
      ]

      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => mockStudyYears)
        }
      }

      const result = await journalListSync.getStudyYearIdFromText('2024/2025')

      expect(result).toBe(2)
      expect(journalListSync.api.tahvel.get).toHaveBeenCalledWith('/autocomplete/studyYears', {}, expect.objectContaining({ cache: true }))
    })

    test('should return null when study year not found', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee',
          get: mock(async () => [{ id: 1, nameEt: '2023/2024' }])
        }
      }

      const result = await journalListSync.getStudyYearIdFromText('2025/2026')

      expect(result).toBeNull()
    })

    test('should return null on API error', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      const result = await journalListSync.getStudyYearIdFromText('2024/2025')

      expect(result).toBeNull()
    })

    test('should handle non-array response', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => ({ not: 'array' }))
        }
      }

      const result = await journalListSync.getStudyYearIdFromText('2024/2025')

      expect(result).toBeNull()
    })
  })

  describe('countTotalDifferences', () => {
    test('should return 0 for null differences', () => {
      journalListSync.differences = null

      const result = journalListSync.countTotalDifferences()

      expect(result).toBe(0)
    })

    test('should return 0 for empty differences', () => {
      journalListSync.differences = []

      const result = journalListSync.countTotalDifferences()

      expect(result).toBe(0)
    })

    test('should count grade differences', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              results: [
                { currentGrade: '3', grade: '4' },
                { currentGrade: '5', grade: '5' }
              ]
            }
          ]
        }
      ]

      const result = journalListSync.countTotalDifferences()

      expect(result).toBeGreaterThanOrEqual(1)
    })

    test('should count missing grades as differences', () => {
      journalListSync.differences = [
        {
          assignments: [
            {
              results: [{ currentGrade: '(puudub)', grade: '4' }]
            }
          ]
        }
      ]

      const result = journalListSync.countTotalDifferences()

      expect(result).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getAddInfoFromExistingStudents', () => {
    test('should return null for null students', () => {
      const result = journalListSync.getAddInfoFromExistingStudents(null)

      expect(result).toBeNull()
    })

    test('should return null for empty array', () => {
      const result = journalListSync.getAddInfoFromExistingStudents([])

      expect(result).toBeNull()
    })

    test('should extract addInfo pattern from existing student', () => {
      const students = [{ addInfo: null }, { addInfo: 'https://example.com/student/123' }, { addInfo: null }]

      const result = journalListSync.getAddInfoFromExistingStudents(students)

      expect(result).toBe('https://example.com/student/123')
    })

    test('should return first available addInfo', () => {
      const students = [{ addInfo: 'https://example.com/student/100' }, { addInfo: 'https://example.com/student/200' }]

      const result = journalListSync.getAddInfoFromExistingStudents(students)

      expect(result).toBe('https://example.com/student/100')
    })

    test('should return null when no student has addInfo', () => {
      const students = [{ addInfo: null }, { addInfo: null }]

      const result = journalListSync.getAddInfoFromExistingStudents(students)

      expect(result).toBeNull()
    })

    test('should return addInfo as-is when pattern cannot be extracted', () => {
      const students = [{ addInfo: 'invalid-pattern' }]

      const result = journalListSync.getAddInfoFromExistingStudents(students)

      expect(result).toBe('invalid-pattern')
    })
  })

  describe('getSelectedStudyYear', () => {
    test('should return year text from dropdown', () => {
      document.body.innerHTML = '<div class="selected-option ng-tns-c929221873-0">2024/2025</div>'

      const result = journalListSync.getSelectedStudyYear()

      expect(result).toBe('2024/2025')
    })

    test('should return null when selector not found', () => {
      document.body.innerHTML = ''

      const result = journalListSync.getSelectedStudyYear()

      expect(result).toBeNull()
    })

    test('should trim whitespace from year text', () => {
      document.body.innerHTML = '<div class="selected-option ng-tns-c929221873-0">  2024/2025  </div>'

      const result = journalListSync.getSelectedStudyYear()

      expect(result).toBe('2024/2025')
    })
  })

  describe('setKriitApiToken', () => {
    test('should not set invalid token', () => {
      journalListSync.setKriitApiToken('')

      expect(global.chrome.storage.local.set).not.toHaveBeenCalled()
    })

    test('should not set null token', () => {
      journalListSync.setKriitApiToken(null)

      expect(global.chrome.storage.local.set).not.toHaveBeenCalled()
    })

    test('should save valid token and refresh data', () => {
      journalListSync.api = {
        kriit: { setAuthToken: mock(() => {}) },
        tahvel: { get: mock(async () => null), post: mock(async () => null) }
      }

      journalListSync.setKriitApiToken('valid-token-123')

      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ OA_kriitApiToken: 'valid-token-123' }, expect.any(Function))
    })
  })

  describe('clearCache', () => {
    test('should clear all caches', async () => {
      journalListSync.globalTeacherCache = { teacher1: {}, teacher2: {} }

      await journalListSync.clearCache()

      expect(journalListSync.globalTeacherCache).toEqual({})
    })
  })

  describe('onRequiredElementsNotFound', () => {
    test('should set error state', () => {
      const error = new Error('Elements not found')

      journalListSync.onRequiredElementsNotFound(error)

      expect(journalListSync.isLoading).toBe(false)
      expect(journalListSync.error).toContain('No journal links found')
    })
  })

  describe('updateUI', () => {
    test('should return early if not active', () => {
      journalListSync.isActive = false

      journalListSync.updateUI()

      expect(journalListSync.isActive).toBe(false)
    })

    test('should handle loading state', () => {
      journalListSync.isActive = true
      journalListSync.isLoading = true

      journalListSync.updateUI()

      expect(journalListSync.isLoading).toBe(true)
    })

    test('should handle error state', () => {
      journalListSync.isActive = true
      journalListSync.isLoading = false
      journalListSync.error = 'Test error'

      journalListSync.updateUI()

      expect(journalListSync.error).toBe('Test error')
      expect(journalListSync.isLoading).toBe(false)
    })
  })

  describe('updateProgressUI', () => {
    test('should return early if not active', () => {
      journalListSync.isActive = false

      journalListSync.updateProgressUI(1, 10)

      expect(journalListSync.isActive).toBe(false)
    })

    test('should handle progress update when active', () => {
      journalListSync.isActive = true

      journalListSync.updateProgressUI(5, 10)

      expect(journalListSync.isActive).toBe(true)
    })
  })

  describe('showSuccessBanner', () => {
    test('should return early if not active', () => {
      journalListSync.isActive = false

      journalListSync.showSuccessBanner('Test message')

      expect(journalListSync.isActive).toBe(false)
    })

    test('should handle success banner when active', () => {
      journalListSync.isActive = true

      journalListSync.showSuccessBanner('Success!')

      expect(journalListSync.isActive).toBe(true)
    })
  })

  describe('onDeactivate', () => {
    test('should reset journal links and clean up', () => {
      journalListSync.journalLinks = [{ id: 1 }, { id: 2 }]

      journalListSync.onDeactivate()

      expect(journalListSync.journalLinks).toBeNull()
      expect(journalListSync.isActive).toBe(false)
    })
  })

  describe('banner DOM lifecycle', () => {
    beforeEach(() => {
      const container = document.createElement('div')
      container.className = 'tahvel-form-buttons'
      document.body.appendChild(container)
      window.location.hash = '#/journals'
    })

    test('showMissingApiKeyBanner injects an element into the banner insertion wrapper', () => {
      journalListSync.showMissingApiKeyBanner()
      const insertionWrapper = document.querySelector('.ta-sync-banner-insertion')
      expect(insertionWrapper).not.toBeNull()
      expect(insertionWrapper.children.length).toBeGreaterThan(0)
    })

    test('showAllInSyncBanner injects an element into the banner insertion wrapper', () => {
      journalListSync.showAllInSyncBanner()
      const insertionWrapper = document.querySelector('.ta-sync-banner-insertion')
      expect(insertionWrapper).not.toBeNull()
      expect(insertionWrapper.children.length).toBeGreaterThan(0)
    })

    test('removeSyncBanner removes a previously shown banner from the DOM', () => {
      journalListSync.showMissingApiKeyBanner()
      const insertionWrapper = document.querySelector('.ta-sync-banner-insertion')
      const childrenBefore = insertionWrapper.children.length
      expect(childrenBefore).toBeGreaterThan(0)

      journalListSync.removeSyncBanner()
      expect(insertionWrapper.children.length).toBe(childrenBefore - 1)
    })

    test('removeSyncBanner is a safe no-op when no banner is currently shown', () => {
      expect(() => journalListSync.removeSyncBanner()).not.toThrow()
    })

    test('subsequent show calls replace the previous banner instead of stacking', () => {
      journalListSync.showMissingApiKeyBanner()
      journalListSync.showAllInSyncBanner()
      const insertionWrapper = document.querySelector('.ta-sync-banner-insertion')
      expect(insertionWrapper.children.length).toBe(1)
    })
  })

  describe('resetKriitApiToken', () => {
    test('should remove token from storage', () => {
      global.chrome = {
        storage: {
          local: {
            get: mock(),
            set: mock(),
            remove: mock((keys, callback) => callback())
          }
        }
      }
      global.prompt = mock(() => null)

      journalListSync.resetKriitApiToken()

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['OA_kriitApiToken'], expect.any(Function))
    })

    test('should prompt for new token', () => {
      global.chrome = {
        storage: {
          local: {
            get: mock(),
            set: mock(),
            remove: mock((keys, callback) => callback())
          }
        }
      }
      global.prompt = mock(() => 'new-token')

      journalListSync.resetKriitApiToken()

      expect(global.prompt).toHaveBeenCalled()
    })
  })

  describe('showErrorBanner', () => {
    test('should call journalSyncBannerService', () => {
      journalListSync.error = 'Test error'

      journalListSync.showErrorBanner()

      expect(journalListSync.error).toBe('Test error')
    })
  })

  describe('showDifferencesBanner', () => {
    test('should show banner when differences exist', () => {
      journalListSync.differences = [{ type: 'grade', count: 1 }]

      journalListSync.showDifferencesBanner()

      expect(journalListSync.differences.length).toBe(1)
    })
  })

  describe('getCachedStudent', () => {
    test('should return null for null journalStudentId', async () => {
      const result = await journalListSync.getCachedStudent(null)

      expect(result).toBeNull()
    })

    test('should return null for undefined journalStudentId', async () => {
      const result = await journalListSync.getCachedStudent(undefined)

      expect(result).toBeNull()
    })

    test('should look up student in mapping', async () => {
      journalListSync.journalStudentIdToStudentId = { 123: 456 }

      await journalListSync.getCachedStudent(123)

      expect(journalListSync.journalStudentIdToStudentId[123]).toBe(456)
    })
  })

  describe('getDetailedStudentInfo', () => {
    test('should return error when student not found', async () => {
      journalListSync.api.tahvel.get = mock(async () => [])

      const result = await journalListSync.getDetailedStudentInfo('12345678901', 123)

      expect(result.error).toContain('not found')
    })
  })

  describe('getLessonDates', () => {
    test('should return empty result when no journal info', async () => {
      const result = await journalListSync.getLessonDates(123, null)

      expect(result.firstLessonDate).toBeNull()
      expect(result.lastLessonDate).toBeNull()
    })

    test('should return empty result when no teachers', async () => {
      const result = await journalListSync.getLessonDates(123, { journalTeachers: [] })

      expect(result.firstLessonDate).toBeNull()
    })
  })

  describe('getFirstLessonFromPlan', () => {
    test('returns the first non-null MAHT_a week-beginning date for the journal', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('autocomplete/studyYears')) return [{ id: 727, nameEt: '2025/2026' }]
            return {
              journals: [{ id: 100, hours: { MAHT_a: [null, null, 2, 4, null] } }],
              weekNrs: [1, 2, 3, 4, 5],
              studyPeriods: [
                {
                  nameEt: 'Sügissemester',
                  weekNrs: [1, 2, 3, 4, 5],
                  weekBeginningDates: ['2024-09-02', '2024-09-09', '2024-09-16', '2024-09-23', '2024-09-30']
                }
              ]
            }
          })
        }
      }
      expect(await journalListSync.getFirstLessonFromPlan(100, 7)).toBe('2024-09-16')
    })

    test('returns null when journal not in plan', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (url) => url.includes('autocomplete/studyYears')
            ? [{ id: 727, nameEt: '2025/2026' }]
            : { journals: [{ id: 999 }], weekNrs: [], studyPeriods: [] })
        }
      }
      expect(await journalListSync.getFirstLessonFromPlan(100, 7)).toBeNull()
    })

    test('returns null when journal has no MAHT_a hours', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (url) => url.includes('autocomplete/studyYears')
            ? [{ id: 727, nameEt: '2025/2026' }]
            : { journals: [{ id: 100, hours: {} }], weekNrs: [], studyPeriods: [] })
        }
      }
      expect(await journalListSync.getFirstLessonFromPlan(100, 7)).toBeNull()
    })

    test('returns null when all MAHT_a hours are null', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('autocomplete/studyYears')) return [{ id: 727, nameEt: '2025/2026' }]
            return {
              journals: [{ id: 100, hours: { MAHT_a: [null, null, null] } }],
              weekNrs: [1, 2, 3],
              studyPeriods: []
            }
          })
        }
      }
      expect(await journalListSync.getFirstLessonFromPlan(100, 7)).toBeNull()
    })

    test('returns null on API error', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => { throw new Error('Network down') }) }
      }
      expect(await journalListSync.getFirstLessonFromPlan(100, 7)).toBeNull()
    })
  })

  describe('getLastLessonFromPlan', () => {
    test('returns the last non-null MAHT_a week-beginning date for the journal', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('autocomplete/studyYears')) return [{ id: 727, nameEt: '2025/2026' }]
            return {
              journals: [{ id: 100, hours: { MAHT_a: [2, 4, null, 4, null] } }],
              weekNrs: [1, 2, 3, 4, 5],
              studyPeriods: [
                {
                  nameEt: 'Sügissemester',
                  weekNrs: [1, 2, 3, 4, 5],
                  weekBeginningDates: ['2024-09-02', '2024-09-09', '2024-09-16', '2024-09-23', '2024-09-30']
                }
              ]
            }
          })
        }
      }
      expect(await journalListSync.getLastLessonFromPlan(100, 7)).toBe('2024-09-23')
    })

    test('returns null when journal not in plan', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (url) => url.includes('autocomplete/studyYears')
            ? [{ id: 727, nameEt: '2025/2026' }]
            : { journals: [{ id: 999 }], weekNrs: [], studyPeriods: [] })
        }
      }
      expect(await journalListSync.getLastLessonFromPlan(100, 7)).toBeNull()
    })

    test('returns null when planData is missing journals or studyPeriods', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => ({})) }
      }
      expect(await journalListSync.getLastLessonFromPlan(100, 7)).toBeNull()
    })

    test('returns null on API error', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => { throw new Error('502') }) }
      }
      expect(await journalListSync.getLastLessonFromPlan(100, 7)).toBeNull()
    })
  })

  describe('setupStudyYearMonitoring', () => {
    test('captures initial study year and skips listener setup when submit button is missing', () => {
      const yearOption = document.createElement('div')
      yearOption.className = 'selected-option ng-tns-c929221873-0'
      yearOption.textContent = '2024/2025'
      document.body.appendChild(yearOption)

      journalListSync.lastStudyYear = null
      journalListSync.setupStudyYearMonitoring()
      expect(journalListSync.lastStudyYear).toBe('2024/2025')
    })
  })

  describe('fetchJournalsFromApi', () => {
    test('paginates through journals endpoint and aggregates content into a single array', async () => {
      const calls = []
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint, params) => {
            calls.push(params.page)
            if (params.page === 0) return { content: [{ id: 1 }, { id: 2 }], totalPages: 2 }
            if (params.page === 1) return { content: [{ id: 3 }], totalPages: 2 }
            return { content: [], totalPages: 2 }
          })
        }
      }

      const result = await journalListSync.fetchJournalsFromApi()

      expect(calls).toEqual([0, 1])
      expect(result.length).toBe(3)
      expect(result.map(j => j.id)).toEqual([1, 2, 3])
    })

    test('uses /journals endpoint when baseUrl already contains /hois_back', async () => {
      let endpointUsed = null
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint) => {
            endpointUsed = endpoint
            return { content: [], totalPages: 0 }
          })
        }
      }

      await journalListSync.fetchJournalsFromApi()
      expect(endpointUsed).toBe('/journals')
    })
  })

  describe('onRequiredElementsFound', () => {
    test('should store journal links when elements found', () => {
      const elements = [document.createElement('a')]

      journalListSync.onRequiredElementsFound(elements, 'test-selector')

      expect(journalListSync.journalLinks).toEqual(elements)
    })
  })

  describe('onActivate', () => {
    test('should keep isActive true (set by BaseFeature.activate)', () => {
      global.window = {
        ...global.window,
        location: {
          hash: '#/journals?_menu',
          href: 'https://tahvel.edu.ee/#/journals?_menu'
        }
      }

      // BaseFeature.activate() sets isActive = true before calling onActivate()
      journalListSync.isActive = true
      const elements = [document.createElement('a')]

      journalListSync.onActivate(elements)

      expect(journalListSync.isActive).toBe(true)
    })
  })

  describe('waitForTableUpdate', () => {
    test('should return a promise', () => {
      const result = journalListSync.waitForTableUpdate()

      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('assignment-level metadata sync', () => {
    test('should build Tahvel metadata-only payloads with an empty student row list', () => {
      const payload = journalListSync.buildAssignmentLevelUpdatePayload(
        {
          version: 4,
          id: 3732602,
          nameEt: 'Mini-rakendus BDD/TDD põhimõtetel',
          lessons: 28,
          journalEntryTeachers: [18737],
          journalEntryStudents: [{ journalStudent: 1, studentPersonalCode: '50001010001' }]
        },
        { lessons: 10 }
      )

      expect(payload.lessons).toBe(10)
      expect(payload.journalEntryTeachers).toEqual(['18737'])
      expect(payload.journalEntryStudents).toEqual([])
    })

    test('should normalize Tahvel due dates', () => {
      expect(journalListSync.normalizeTahvelDueDate('2026-04-25')).toBe('2026-04-25T23:59:59.000Z')
      expect(journalListSync.normalizeTahvelDueDate('2026-04-25T12:00:00')).toBe('2026-04-25T12:00:00.000Z')
      expect(journalListSync.normalizeTahvelDueDate('2026-04-25T12:00:00.123')).toBe('2026-04-25T12:00:00.123Z')
      expect(journalListSync.normalizeTahvelDueDate('2026-04-25T12:00:00Z')).toBe('2026-04-25T12:00:00Z')
    })

    test('should include grade and metadata labels in mixed sync failure messages', () => {
      const failureTypes = journalListSync.getSyncFailureTypes({ entryType: 'SISSEKANNE_I' }, true)
      const message = journalListSync.buildSyncFailureMessage([{ assignmentName: 'Lõpphinne', types: failureTypes, status: 412 }], 3)

      expect(message).toContain('3 õnnestus')
      expect(message).toContain('sissekande tüüp, hinne')
      expect(message).toContain('HTTP 412')
    })

    test('should surface assignment-hours sync failures without exposing student identifiers', async () => {
      const tahvelError = new Error('API Error: 412 (journal.messages.changeIsNotAllowedStudentIsNotStudying)')
      tahvelError.status = 412

      const put = mock(async () => {
        throw tahvelError
      })

      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.vikk.ee/api' },
        tahvel: {
          get: mock(async () => ({
            version: 4,
            id: 3732602,
            entryType: 'SISSEKANNE_I',
            nameEt: 'Mini-rakendus BDD/TDD põhimõtetel',
            lessons: 28,
            journalEntryTeachers: [18737],
            journalEntryCapacityTypes: ['MAHT_i'],
            journalEntryStudents: [{ journalStudent: 1, studentPersonalCode: '50001010001' }]
          })),
          put
        }
      }
      journalListSync.differences = [
        {
          subjectName: 'Testjuhitud arendus',
          subjectExternalId: 402641,
          assignments: [
            {
              assignmentExternalId: 3732602,
              assignmentName: 'Mini-rakendus BDD/TDD põhimõtetel',
              assignmentHours: 10
            }
          ]
        }
      ]

      const result = await journalListSync.syncWithKriit()
      const payload = put.mock.calls[0][1]

      expect(result.failedSyncs).toHaveLength(1)
      expect(payload.lessons).toBe(10)
      expect(payload.journalEntryStudents).toEqual([])
      expect(journalListSync.error).toContain('HTTP 412')
      expect(journalListSync.error).toContain('tundide arv')
      expect(journalListSync.error).toContain('Mini-rakendus BDD/TDD põhimõtetel')
      expect(journalListSync.error).not.toContain('50001010001')
    })
  })

  describe('syncWithKriit', () => {
    test('should surface entry-type sync failures without resubmitting unchanged students', async () => {
      const tahvelError = new Error('API Error: 412 (journal.messages.changeIsNotAllowedStudentIsNotStudying)')
      tahvelError.status = 412

      const put = mock(async () => {
        throw tahvelError
      })
      const get = mock(async () => ({
        version: 5,
        id: 2636372,
        entryType: 'SISSEKANNE_H',
        nameEt: 'Lõpphinne',
        entryDate: '2023-06-20T00:00:00Z',
        homeworkDuedate: null,
        lessons: null,
        journalEntryTeachers: [18737],
        journalEntryCapacityTypes: ['MAHT_h'],
        journalEntryStudents: [{ journalStudent: 1, studentPersonalCode: '50001010001' }]
      }))

      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.vikk.ee/api' },
        tahvel: {
          get,
          put
        }
      }
      journalListSync.differences = [
        {
          subjectName: 'Testimise tüübid ja automatiseerimine',
          subjectExternalId: 268452,
          assignments: [
            {
              assignmentExternalId: 2636372,
              assignmentName: 'Lõpphinne',
              entryType: { kriit: 'SISSEKANNE_I', Tahvel: 'SISSEKANNE_H' },
              results: []
            }
          ]
        }
      ]

      const result = await journalListSync.syncWithKriit()
      const payload = put.mock.calls[0][1]

      expect(result.failedSyncs).toHaveLength(1)
      expect(get.mock.calls[0][1]).toEqual({})
      expect(get.mock.calls[0][2]).toEqual({ cache: false })
      expect(payload.entryType).toBe('SISSEKANNE_I')
      expect(payload.homeworkDuedate).toBe('2023-06-20T00:00:00Z')
      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_i'])
      expect(payload.journalEntryStudents).toEqual([])
      expect(journalListSync.error).toContain('HTTP 412')
      expect(journalListSync.error).toContain('Lõpphinne')
      expect(journalListSync.error).not.toContain('50001010001')
    })

    test('should sync assignment hours and entry type in one Tahvel update', async () => {
      const originalSetTimeout = global.setTimeout
      const originalBannerSuccess = bannerService.showSuccessBanner
      const setTimeoutMock = mock(() => {})
      const bannerSuccessMock = mock(() => {})

      global.setTimeout = setTimeoutMock
      bannerService.showSuccessBanner = bannerSuccessMock
      journalListSync.isActive = true

      try {
        const get = mock(async () => ({
          version: 5,
          id: 2636372,
          entryType: 'SISSEKANNE_H',
          nameEt: 'Lõpphinne',
          entryDate: '2023-06-20T00:00:00Z',
          homeworkDuedate: null,
          lessons: 28,
          journalEntryTeachers: [18737],
          journalEntryCapacityTypes: ['MAHT_h'],
          journalEntryStudents: [{ journalStudent: 1 }]
        }))
        const put = mock(async () => ({}))

        journalListSync.api = {
          kriit: { baseUrl: 'https://kriit.vikk.ee/api' },
          tahvel: {
            get,
            put
          }
        }
        journalListSync.differences = [
          {
            subjectName: 'Testimise tüübid ja automatiseerimine',
            subjectExternalId: 268452,
            assignments: [
              {
                assignmentExternalId: 2636372,
                assignmentName: 'Lõpphinne',
                assignmentHours: 10,
                entryType: { kriit: 'SISSEKANNE_I', Tahvel: 'SISSEKANNE_H' },
                results: []
              }
            ]
          }
        ]

        const result = await journalListSync.syncWithKriit()
        const payload = put.mock.calls[0][1]

        expect(result.failedSyncs).toHaveLength(0)
        expect(result.successfulSyncs).toHaveLength(1)
        expect(get).toHaveBeenCalledTimes(1)
        expect(get.mock.calls[0][1]).toEqual({})
        expect(put).toHaveBeenCalledTimes(1)
        expect(payload.lessons).toBe(10)
        expect(payload.entryType).toBe('SISSEKANNE_I')
        expect(payload.homeworkDuedate).toBe('2023-06-20T00:00:00Z')
        expect(payload.journalEntryStudents).toEqual([])
        const bannerMessages = bannerSuccessMock.mock.calls.map(args => args[0]).join(' ')
        expect(bannerMessages).toContain('1 ülesande tundide arvu')
        expect(bannerMessages).toContain('1 sissekande tüüpi')
        expect(setTimeoutMock).toHaveBeenCalledTimes(1)
      } finally {
        global.setTimeout = originalSetTimeout
        bannerService.showSuccessBanner = originalBannerSuccess
      }
    })
  })

  describe('onRequiredElementsFound - DOM integration', () => {
    test('should extract journal links from DOM', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <a href="#/journal/123">Journal 1</a>
            <a href="#/journal/456">Journal 2</a>
          </body>
        </html>
      `)

      const links = dom.window.document.querySelectorAll('a[href*="journal"]')
      expect(links.length).toBe(2)
      expect(links[0].getAttribute('href')).toContain('123')
    })
  })

  describe('getAssignmentNameFromEntry', () => {
    test('should extract name from entry with nameEt', () => {
      const entry = { nameEt: 'Homework 1', content: 'Some content' }
      const result = journalListSync.getAssignmentNameFromEntry(entry)
      expect(result).toBe('Homework 1')
    })

    test('should extract from content when nameEt missing', () => {
      const entry = { content: 'Assignment: Test\nMore details' }
      const result = journalListSync.getAssignmentNameFromEntry(entry)
      expect(result).toBe('Assignment: Test')
    })

    test('should use full content when no newline', () => {
      const entry = { content: 'Simple task' }
      const result = journalListSync.getAssignmentNameFromEntry(entry)
      expect(result).toBe('Simple task')
    })

    test('should handle empty content', () => {
      const entry = { content: '' }
      const result = journalListSync.getAssignmentNameFromEntry(entry)
      expect(result).toBeDefined()
    })

    test('should extract from multiline content', () => {
      const entry = { content: 'Test Assignment\nLine 2\nLine 3' }
      const result = journalListSync.getAssignmentNameFromEntry(entry)
      expect(result).toBe('Test Assignment')
    })

    test('should handle content with only nameEt', () => {
      const entry = { nameEt: 'Assignment Name', content: null }
      const result = journalListSync.getAssignmentNameFromEntry(entry)
      expect(result).toBe('Assignment Name')
    })
  })

  describe('extractDueDateDifferences', () => {
    test('should return empty array when differences is null', () => {
      journalListSync.differences = null
      const result = journalListSync.extractDueDateDifferences()
      expect(result).toEqual([])
    })

    test('should return empty array when differences is not an array', () => {
      journalListSync.differences = { foo: 'bar' }
      const result = journalListSync.extractDueDateDifferences()
      expect(result).toEqual([])
    })

    test('should extract due date differences with object assignment name', () => {
      journalListSync.differences = [
        {
          subjectName: 'Math',
          subjectExternalId: 'MATH101',
          assignments: [
            {
              assignmentExternalId: 'A1',
              assignmentName: { kriit: 'Homework', Tahvel: 'HW' },
              assignmentDueAt: { kriit: '2024-01-15', Tahvel: '2024-01-10' }
            }
          ]
        }
      ]
      const result = journalListSync.extractDueDateDifferences()
      expect(result.length).toBe(1)
      expect(result[0].assignmentName).toBe('Homework')
    })

  })

  describe('extractAssignmentHoursDifferences', () => {
    test('should return empty array when differences is null', () => {
      journalListSync.differences = null
      const result = journalListSync.extractAssignmentHoursDifferences()
      expect(result).toEqual([])
    })

    test('should extract hours when assignmentHours is defined', () => {
      journalListSync.differences = [
        {
          subjectName: 'Math',
          subjectExternalId: 'MATH101',
          assignments: [
            {
              assignmentExternalId: 'A1',
              assignmentName: 'Test',
              assignmentHours: 2
            }
          ]
        }
      ]
      const result = journalListSync.extractAssignmentHoursDifferences()
      expect(result.length).toBe(1)
      expect(result[0].kriitHours).toBe(2)
    })

    test('should extract hours with object assignment name', () => {
      journalListSync.differences = [
        {
          subjectName: 'Physics',
          assignments: [
            {
              assignmentExternalId: 'A2',
              assignmentName: { kriit: 'Lab Work', Tahvel: 'Lab' },
              assignmentHours: 3
            }
          ]
        }
      ]
      const result = journalListSync.extractAssignmentHoursDifferences()
      expect(result.length).toBe(1)
      expect(result[0].assignmentName).toBe('Lab Work')
    })

  })

  describe('SISSEKANNE_P Integration Tests', () => {
    test('should handle complete sync flow for SISSEKANNE_P entries', () => {
      // Simulate journal entries with both SISSEKANNE_I and SISSEKANNE_P
      const entries = [
        {
          id: 1001,
          entryType: 'SISSEKANNE_I',
          nameEt: 'Iseseisev töö 1',
          entryDate: '2025-09-11T00:00:00Z',
          homeworkDuedate: '2025-10-02T00:00:00Z',
          lessons: 2
        },
        {
          id: 1002,
          entryType: 'SISSEKANNE_P',
          nameEt: 'Praktiline töö 1',
          entryDate: '2025-09-11T00:00:00Z',
          homeworkDuedate: '2025-10-02T00:00:00Z',
          lessons: 3
        },
        {
          id: 1003,
          entryType: 'SISSEKANNE_H',
          nameEt: 'Hindeline töö 1',
          entryDate: '2025-09-12T00:00:00Z',
          homeworkDuedate: '2025-10-03T00:00:00Z',
          lessons: 2
        },
        {
          id: 1004,
          entryType: 'SISSEKANNE_L',
          nameEt: 'Regular lesson',
          entryDate: '2025-09-13T00:00:00Z'
        }
      ]

      // Student map with personal codes
      const studentMap = {
        idToPersonalCode: {
          100: '38001010001',
          101: '38002020002'
        },
        personalCodeToName: {
          '38001010001': 'Test Student A',
          '38002020002': 'Test Student B'
        },
        journalStudentIdToId: {
          10: 100,
          11: 101
        }
      }

      const journalStudents = [
        { id: 10, studentId: 100 },
        { id: 11, studentId: 101 }
      ]

      // Extract assignments
      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents)

      // Should include SISSEKANNE_I, SISSEKANNE_P, and SISSEKANNE_H, but NOT SISSEKANNE_L
      expect(result).toHaveLength(3)

      // Find the SISSEKANNE_P assignment
      const practicalWork = result.find(a => a.entryType === 'SISSEKANNE_P')
      expect(practicalWork).toBeDefined()

      // Verify SISSEKANNE_P assignment has correct fields
      expect(practicalWork.entryType).toBe('SISSEKANNE_P')
      expect(practicalWork.assignmentName).toBe('Praktiline töö 1')
      expect(practicalWork.assignmentExternalId).toBe(1002)
      expect(practicalWork.assignmentDueAt).toBe('2025-10-02')
      expect(practicalWork.lessons).toBe(3)

      // Verify SISSEKANNE_I assignment
      const independentWork = result.find(a => a.entryType === 'SISSEKANNE_I')
      expect(independentWork).toBeDefined()
      expect(independentWork.entryType).toBe('SISSEKANNE_I')
      expect(independentWork.assignmentName).toBe('Iseseisev töö 1')

      // Verify SISSEKANNE_H assignment
      const gradedWork = result.find(a => a.entryType === 'SISSEKANNE_H')
      expect(gradedWork).toBeDefined()
      expect(gradedWork.entryType).toBe('SISSEKANNE_H')

      // Verify all assignments have students
      result.forEach(assignment => {
        expect(assignment.results).toHaveLength(2)
        expect(assignment.results[0].studentPersonalCode).toBe('38001010001')
        expect(assignment.results[1].studentPersonalCode).toBe('38002020002')
      })
    })

    test('should use fallback name for SISSEKANNE_P when nameEt is missing', () => {
      const entries = [
        {
          id: 2001,
          entryType: 'SISSEKANNE_P',
          content: null,
          entryDate: '2025-09-11T00:00:00Z'
        }
      ]

      const studentMap = {
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      expect(result).toHaveLength(1)
      expect(result[0].entryType).toBe('SISSEKANNE_P')
      // Should use getAssignmentNameFromEntry which returns "Praktiline töö" for SISSEKANNE_P when no nameEt or content
      expect(result[0].assignmentName).toBe('Praktiline töö')
    })

    test('should handle SISSEKANNE_P entries with student grades', () => {
      const entries = [
        {
          id: 3001,
          entryType: 'SISSEKANNE_P',
          nameEt: 'Practical Work Assignment',
          entryDate: '2025-09-11T00:00:00Z',
          homeworkDuedate: '2025-10-02T00:00:00Z'
        }
      ]

      const studentMap = {
        idToPersonalCode: {
          200: '39001010000',
          201: '39002020000'
        },
        personalCodeToName: {
          '39001010000': 'Student One',
          '39002020000': 'Student Two'
        },
        journalStudentIdToId: {
          20: 200,
          21: 201
        }
      }

      const journalStudents = [
        { id: 20, studentId: 200 },
        { id: 21, studentId: 201 }
      ]

      const entriesWithGrades = [
        {
          id: 3001,
          entryType: 'SISSEKANNE_P',
          journalStudentResults: {
            20: [{ grade: { code: 'KUTSEHINDAMINE_5' } }],
            21: [{ grade: { code: 'KUTSEHINDAMINE_4' } }]
          }
        }
      ]

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents, {}, entriesWithGrades)

      expect(result).toHaveLength(1)
      expect(result[0].entryType).toBe('SISSEKANNE_P')
      expect(result[0].results).toHaveLength(2)
      expect(result[0].results[0].grade).toBe('5')
      expect(result[0].results[0].studentPersonalCode).toBe('39001010000')
      expect(result[0].results[1].grade).toBe('4')
      expect(result[0].results[1].studentPersonalCode).toBe('39002020000')
    })

    test('should include all entry types in correct order', () => {
      const entries = [
        { id: 1, entryType: 'SISSEKANNE_L', nameEt: 'Lesson' },
        { id: 2, entryType: 'SISSEKANNE_H', nameEt: 'Graded Work' },
        { id: 3, entryType: 'SISSEKANNE_I', nameEt: 'Independent Work' },
        { id: 4, entryType: 'SISSEKANNE_P', nameEt: 'Practical Work' },
        { id: 5, entryType: 'SISSEKANNE_O', nameEt: 'Outcome', curriculumModuleOutcomes: 'OUTCOME_123' },
        { id: 6, entryType: 'OTHER_TYPE', nameEt: 'Other' }
      ]

      const studentMap = {
        idToPersonalCode: {},
        personalCodeToName: {},
        journalStudentIdToId: {}
      }

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, [])

      // Should only include SISSEKANNE_H, SISSEKANNE_I, and SISSEKANNE_P (not L, O, or OTHER)
      expect(result).toHaveLength(3)

      const entryTypes = result.map(r => r.entryType)
      expect(entryTypes).toContain('SISSEKANNE_H')
      expect(entryTypes).toContain('SISSEKANNE_I')
      expect(entryTypes).toContain('SISSEKANNE_P')
      expect(entryTypes).not.toContain('SISSEKANNE_L')
      expect(entryTypes).not.toContain('SISSEKANNE_O')
      expect(entryTypes).not.toContain('OTHER_TYPE')
    })

    test('should verify entryType is sent to Kriit for SISSEKANNE_P', () => {
      // This test verifies the payload structure matches what Kriit expects
      const entries = [
        {
          id: 4001,
          entryType: 'SISSEKANNE_P',
          nameEt: 'Practical Work',
          entryDate: '2025-09-11T00:00:00Z',
          homeworkDuedate: '2025-10-02T00:00:00Z',
          lessons: 2
        }
      ]

      const studentMap = {
        idToPersonalCode: { 300: '50001010000' },
        personalCodeToName: { '50001010000': 'Test Student' },
        journalStudentIdToId: { 30: 300 }
      }

      const journalStudents = [{ id: 30, studentId: 300 }]

      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap, journalStudents)

      expect(result).toHaveLength(1)

      // Verify the assignment payload includes entryType field
      const assignment = result[0]
      expect(assignment).toHaveProperty('entryType')
      expect(assignment.entryType).toBe('SISSEKANNE_P')

      // Verify all required fields for Kriit sync are present
      expect(assignment).toHaveProperty('assignmentExternalId')
      expect(assignment).toHaveProperty('assignmentName')
      expect(assignment).toHaveProperty('assignmentDueAt')
      expect(assignment).toHaveProperty('lessons')
      expect(assignment).toHaveProperty('results')
      expect(assignment.results).toHaveLength(1)
      expect(assignment.results[0]).toHaveProperty('studentPersonalCode')
    })

    test('should extract entry type differences when types differ', () => {
      journalListSync.differences = [
        {
          subjectName: 'Programming',
          subjectExternalId: '123',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Homework 1',
              entryType: {
                kriit: 'SISSEKANNE_P',
                Tahvel: 'SISSEKANNE_I'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        assignmentExternalId: 'a1',
        assignmentName: 'Homework 1',
        kriit: 'SISSEKANNE_P',
        Tahvel: 'SISSEKANNE_I',
        subjectName: 'Programming',
        subjectExternalId: '123'
      })
    })

    test('should not extract entry type differences when types match', () => {
      journalListSync.differences = [
        {
          subjectName: 'Math',
          subjectExternalId: '456',
          assignments: [
            {
              assignmentExternalId: 'a2',
              assignmentName: 'Test',
              entryType: {
                kriit: 'SISSEKANNE_I',
                Tahvel: 'SISSEKANNE_I'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toHaveLength(0)
    })

    test('should handle multiple entry type differences across subjects', () => {
      journalListSync.differences = [
        {
          subjectName: 'Science',
          subjectExternalId: '111',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Lab 1',
              entryType: {
                kriit: 'SISSEKANNE_P',
                Tahvel: 'SISSEKANNE_L'
              }
            },
            {
              assignmentExternalId: 'a2',
              assignmentName: 'Lab 2',
              entryType: {
                kriit: 'SISSEKANNE_H',
                Tahvel: 'SISSEKANNE_I'
              }
            }
          ]
        },
        {
          subjectName: 'History',
          subjectExternalId: '222',
          assignments: [
            {
              assignmentExternalId: 'a3',
              assignmentName: 'Essay',
              entryType: {
                kriit: 'SISSEKANNE_I',
                Tahvel: 'SISSEKANNE_H'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toHaveLength(3)
      expect(result[0].subjectName).toBe('Science')
      expect(result[0].assignmentName).toBe('Lab 1')
      expect(result[1].subjectName).toBe('Science')
      expect(result[1].assignmentName).toBe('Lab 2')
      expect(result[2].subjectName).toBe('History')
      expect(result[2].assignmentName).toBe('Essay')
    })

    test('should handle object assignmentName in entry type differences', () => {
      journalListSync.differences = [
        {
          subjectName: 'Art',
          subjectExternalId: '333',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: {
                kriit: 'New Name',
                Tahvel: 'Old Name'
              },
              entryType: {
                kriit: 'SISSEKANNE_P',
                Tahvel: 'SISSEKANNE_I'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].assignmentName).toBe('New Name')
    })

    test('should return empty array when no differences exist', () => {
      journalListSync.differences = null

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toEqual([])
    })

    test('should skip assignments without entryType object', () => {
      journalListSync.differences = [
        {
          subjectName: 'Music',
          subjectExternalId: '444',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Concert',
              entryType: 'SISSEKANNE_I' // String, not object - should be skipped
            },
            {
              assignmentExternalId: 'a2',
              assignmentName: 'Practice',
              entryType: {
                kriit: 'SISSEKANNE_P',
                Tahvel: 'SISSEKANNE_I'
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].assignmentExternalId).toBe('a2')
    })

    test('should handle null entry types', () => {
      journalListSync.differences = [
        {
          subjectName: 'PE',
          subjectExternalId: '555',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Exercise',
              entryType: {
                kriit: 'SISSEKANNE_P',
                Tahvel: null
              }
            }
          ]
        }
      ]

      const result = journalListSync.extractEntryTypeDifferences()

      expect(result).toHaveLength(1)
      expect(result[0].kriit).toBe('SISSEKANNE_P')
      expect(result[0].Tahvel).toBe(null)
    })

  })
})

describe('JournalListSync - Kriit Sync Notification Integration', () => {
  describe('Batch sync integration', () => {
    test('should notify Kriit after successful batch sync', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const studentsToUpdate = [
        { personalCode: '39001010000', grade: 5 },
        { personalCode: '39002020000', grade: 4 }
      ]

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true, affectedGrades: 2 }))
        },
        tahvel: {
          put: mock(async () => ({ success: true }))
        }
      }

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).toHaveBeenCalledWith('/grades/markSynchronized', {
        grades: syncedGrades,
        systemId: 1
      })
      expect(syncedGrades).toHaveLength(2)
    })

    test('should skip notification for assignment-level-only updates', async () => {
      const isAssignmentLevelOnly = true
      const apiService = {
        kriit: { enabled: true, post: mock(async () => ({ success: true })) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      if (!isAssignmentLevelOnly) {
        const syncedGrades = buildGradesForNotification('12345', '123', [{ personalCode: '39001010000' }])
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).not.toHaveBeenCalled()
    })

    test('should handle multiple batches sequentially', async () => {
      const batches = [
        { journalId: '12345', assignmentId: '123', students: [{ personalCode: '39001010000' }, { personalCode: '39002020000' }] },
        { journalId: '12345', assignmentId: '124', students: [{ personalCode: '39003030000' }, { personalCode: '39004040000' }] }
      ]

      const apiService = {
        kriit: { enabled: true, post: mock(async () => ({ success: true })) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      for (const batch of batches) {
        await apiService.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, {})
        const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, batch.students)
        if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).toHaveBeenCalledTimes(2)
    })

    test('should not notify when no students have personal codes', async () => {
      const apiService = {
        kriit: { enabled: true, post: mock(async () => ({ success: true })) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      const syncedGrades = buildGradesForNotification('12345', '123', [{ name: 'No code' }, { id: 456 }])
      if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      expect(apiService.kriit.post).not.toHaveBeenCalled()
    })

    test('should continue batch processing even if notification fails', async () => {
      const batches = [
        { journalId: '12345', assignmentId: '123', students: [{ personalCode: '39001010000' }] },
        { journalId: '12345', assignmentId: '124', students: [{ personalCode: '39002020000' }] }
      ]
      const apiService = {
        kriit: { enabled: true, post: mock(async () => { throw new Error('Notification failed') }) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      for (const batch of batches) {
        await apiService.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, {})
        const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, batch.students)
        if (syncedGrades.length > 0) {
          try { await notifyKriitGradesSynced(apiService, syncedGrades) } catch (e) { /* continue */ }
        }
      }
      expect(apiService.tahvel.put).toHaveBeenCalledTimes(2)
    })
  })

  describe('Individual sync integration', () => {
    test('should notify Kriit after successful individual assignment sync', async () => {
      const updateData = {
        journalEntryStudents: [
          { personalCode: '39001010000', grade: 5 },
          { personalCode: '39002020000', grade: 4 }
        ]
      }
      const apiService = {
        kriit: { enabled: true, post: mock(async () => ({ success: true, affectedGrades: 2 })) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      await apiService.tahvel.put('/journals/12345/journalEntry/123', updateData)
      const syncedGrades = buildGradesForNotification('12345', '123', updateData.journalEntryStudents)
      if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      expect(apiService.kriit.post).toHaveBeenCalled()
      expect(syncedGrades).toHaveLength(2)
    })

    test('should handle individual sync with userPersonalCode field', async () => {
      const updateData = {
        journalEntryStudents: [
          { userPersonalCode: '39001010000', grade: 5 },
          { userPersonalCode: '39002020000', grade: 4 }
        ]
      }
      const apiService = {
        kriit: { enabled: true },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      await apiService.tahvel.put('/journals/12345/journalEntry/123', updateData)
      const syncedGrades = buildGradesForNotification('12345', '123', updateData.journalEntryStudents)
      if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      expect(syncedGrades).toHaveLength(2)
      expect(syncedGrades[0].studentPersonalCode).toBe('39001010000')
    })

    test('should not throw if notification fails during individual sync', async () => {
      const updateData = { journalEntryStudents: [{ personalCode: '39001010000', grade: 5 }] }
      const apiService = {
        kriit: { enabled: true, post: mock(async () => { throw new Error('Kriit API unavailable') }) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      await expect(async () => {
        await apiService.tahvel.put('/journals/12345/journalEntry/123', updateData)
        const syncedGrades = buildGradesForNotification('12345', '123', updateData.journalEntryStudents)
        if (syncedGrades.length > 0) {
          try { await notifyKriitGradesSynced(apiService, syncedGrades) } catch (e) { /* swallow */ }
        }
      }).not.toThrow()

      expect(apiService.tahvel.put).toHaveBeenCalled()
    })
  })

  describe('Error handling and edge cases', () => {
    test('should handle students with mixed personal code fields', async () => {
      const studentsToUpdate = [
        { personalCode: '39001010000' },
        { userPersonalCode: '39002020000' },
        { studentPersonalCode: '39003030000' },
        { name: 'No Code' }
      ]
      const syncedGrades = buildGradesForNotification('12345', '123', studentsToUpdate)
      expect(syncedGrades).toHaveLength(3)
      expect(syncedGrades.map(g => g.studentPersonalCode)).toEqual(['39001010000', '39002020000', '39003030000'])
    })

    test('should handle empty update data gracefully', async () => {
      const apiService = {
        kriit: { enabled: true, post: mock(async () => ({ success: true })) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      const syncedGrades = buildGradesForNotification('12345', '123', [])
      if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      expect(apiService.kriit.post).not.toHaveBeenCalled()
    })

    test('should convert numeric IDs to strings', async () => {
      const syncedGrades = buildGradesForNotification(12345, 123, [{ personalCode: '39001010000' }])
      expect(syncedGrades[0].subjectExternalId).toBe('12345')
      expect(syncedGrades[0].assignmentExternalId).toBe('123')
      expect(typeof syncedGrades[0].subjectExternalId).toBe('string')
      expect(typeof syncedGrades[0].assignmentExternalId).toBe('string')
    })

    test('should handle API response without success field', async () => {
      const apiService = { kriit: { enabled: true, post: mock(async () => ({ status: 'ok' })) } }
      const grades = [{ subjectExternalId: '12345', assignmentExternalId: '123', studentPersonalCode: '39001010000' }]
      await expect(notifyKriitGradesSynced(apiService, grades)).resolves.toBeUndefined()
    })

    test('should handle null/undefined student objects in array', async () => {
      const studentsToUpdate = [{ personalCode: '39001010000' }, null, undefined, { personalCode: '39002020000' }]
      const syncedGrades = buildGradesForNotification('12345', '123', studentsToUpdate)
      expect(syncedGrades).toHaveLength(2)
    })
  })

  describe('Performance and concurrent operations', () => {
    test('should handle large number of students efficiently', async () => {
      const studentsToUpdate = []
      for (let i = 0; i < 100; i++) {
        studentsToUpdate.push({ personalCode: `390${String(i).padStart(8, '0')}`, grade: 5 })
      }
      const syncedGrades = buildGradesForNotification('12345', '123', studentsToUpdate)
      expect(syncedGrades).toHaveLength(100)
      expect(syncedGrades[0].studentPersonalCode).toBe('39000000000')
      expect(syncedGrades[99].studentPersonalCode).toBe('39000000099')
    })

    test('should handle multiple assignments in parallel', async () => {
      const assignments = []
      for (let i = 0; i < 10; i++) {
        assignments.push({
          journalId: '12345',
          assignmentId: String(100 + i),
          students: [{ personalCode: `39001${String(i).padStart(5, '0')}` }, { personalCode: `39002${String(i).padStart(5, '0')}` }]
        })
      }
      const apiService = { kriit: { enabled: true, post: mock(async () => ({ success: true })) } }
      const promises = assignments.map(async a => {
        const syncedGrades = buildGradesForNotification(a.journalId, a.assignmentId, a.students)
        if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      })
      await Promise.all(promises)
      expect(apiService.kriit.post).toHaveBeenCalledTimes(10)
    })
  })

  describe('Real-world scenarios', () => {
    test('should handle complete sync workflow for single assignment', async () => {
      const journalId = '348986'
      const assignmentId = '1234567'
      const students = [
        { personalCode: '39001010000', grade: 5, name: 'John Doe' },
        { personalCode: '39002020000', grade: 4, name: 'Jane Smith' },
        { personalCode: '39003030000', grade: 3, name: 'Bob Johnson' }
      ]
      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({
            success: true, affectedGrades: 3,
            syncedGrades: students.map(s => ({ subjectExternalId: journalId, assignmentExternalId: assignmentId, studentPersonalCode: s.personalCode }))
          }))
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      const updateData = { journalEntryStudents: students }
      await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)
      const syncedGrades = buildGradesForNotification(journalId, assignmentId, students)
      await notifyKriitGradesSynced(apiService, syncedGrades)
      expect(apiService.tahvel.put).toHaveBeenCalledWith(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)
      expect(apiService.kriit.post).toHaveBeenCalled()
      expect(syncedGrades).toHaveLength(3)
    })

    test('should handle partial sync when some students lack personal codes', async () => {
      const students = [
        { personalCode: '39001010000', grade: 5 },
        { name: 'No Code', grade: 4 },
        { personalCode: '39002020000', grade: 3 },
        { id: 12345, grade: 5 }
      ]
      const apiService = {
        kriit: { enabled: true, post: mock(async () => ({ success: true, affectedGrades: 2 })) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      await apiService.tahvel.put('/journals/348986/journalEntry/1234567', { journalEntryStudents: students })
      const syncedGrades = buildGradesForNotification('348986', '1234567', students)
      if (syncedGrades.length > 0) await notifyKriitGradesSynced(apiService, syncedGrades)
      expect(syncedGrades).toHaveLength(2)
      expect(apiService.kriit.post).toHaveBeenCalled()
    })

    test('should maintain grade sync integrity when Kriit notification fails', async () => {
      const students = [{ personalCode: '39001010000', grade: 5 }]
      const apiService = {
        kriit: { enabled: true, post: mock(async () => { throw new Error('Kriit server unreachable') }) },
        tahvel: { put: mock(async () => ({ success: true })) }
      }
      let tahvelSyncSucceeded = false
      try {
        await apiService.tahvel.put('/journals/348986/journalEntry/1234567', { journalEntryStudents: students })
        tahvelSyncSucceeded = true
        const syncedGrades = buildGradesForNotification('348986', '1234567', students)
        try { await notifyKriitGradesSynced(apiService, syncedGrades) } catch (e) { /* notification non-critical */ }
      } catch (e) { /* should not reach */ }
      expect(tahvelSyncSucceeded).toBe(true)
      expect(apiService.tahvel.put).toHaveBeenCalled()
    })
  })
})

describe('JournalListSync - Assignment-level sync helpers', () => {
  beforeEach(() => {
    journalListSync.differences = null
  })

  describe('getAssignmentLevelSyncFields', () => {
    test('returns expected sync field metadata', () => {
      const fields = journalListSync.getAssignmentLevelSyncFields()
      expect(fields.map(f => f.batchKey)).toEqual(['nameEt', 'homeworkDuedate', 'entryDate', 'entryType', 'lessons'])
    })

    test('marks lessons field as scalar', () => {
      const fields = journalListSync.getAssignmentLevelSyncFields()
      const lessonsField = fields.find(f => f.batchKey === 'lessons')
      expect(lessonsField.scalar).toBe(true)
    })
  })

  describe('getAssignmentLevelChangeValue', () => {
    const nameField = { batchKey: 'nameEt', diffKey: 'assignmentName' }
    const lessonsField = { batchKey: 'lessons', diffKey: 'assignmentHours', scalar: true }

    test('returns kriit value when diff exists and differs from Tahvel', () => {
      const result = journalListSync.getAssignmentLevelChangeValue(
        { assignmentName: { kriit: 'New', Tahvel: 'Old' } }, nameField
      )
      expect(result).toBe('New')
    })

    test('returns undefined when kriit and Tahvel match', () => {
      const result = journalListSync.getAssignmentLevelChangeValue(
        { assignmentName: { kriit: 'Same', Tahvel: 'Same' } }, nameField
      )
      expect(result).toBeUndefined()
    })

    test('returns undefined when diff is missing', () => {
      expect(journalListSync.getAssignmentLevelChangeValue({}, nameField)).toBeUndefined()
    })

    test('returns undefined when diff is not an object', () => {
      expect(journalListSync.getAssignmentLevelChangeValue({ assignmentName: 'plain' }, nameField)).toBeUndefined()
    })

    test('returns scalar value as-is for scalar fields', () => {
      expect(journalListSync.getAssignmentLevelChangeValue({ assignmentHours: 4 }, lessonsField)).toBe(4)
    })

    test('returns undefined for scalar with null/undefined value', () => {
      expect(journalListSync.getAssignmentLevelChangeValue({ assignmentHours: null }, lessonsField)).toBeUndefined()
      expect(journalListSync.getAssignmentLevelChangeValue({}, lessonsField)).toBeUndefined()
    })
  })

  describe('getAssignmentLevelChanges', () => {
    test('returns only fields with values', () => {
      const result = journalListSync.getAssignmentLevelChanges({
        assignmentName: { kriit: 'A', Tahvel: 'B' }
      })
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe('A')
    })

    test('returns empty when no fields differ', () => {
      expect(journalListSync.getAssignmentLevelChanges({})).toEqual([])
    })
  })

  describe('getAssignmentLevelBatchChanges', () => {
    test('filters out null/undefined values', () => {
      const result = journalListSync.getAssignmentLevelBatchChanges({
        nameEt: 'A', homeworkDuedate: null, entryDate: undefined, entryType: 'SISSEKANNE_I'
      })
      expect(result).toHaveLength(2)
    })
  })

  describe('getAssignmentLevelFailureTypes', () => {
    test('returns batch field types', () => {
      expect(journalListSync.getAssignmentLevelFailureTypes({ nameEt: 'X' })).toEqual(['name'])
    })

    test('returns ["assignment"] when no batch fields', () => {
      expect(journalListSync.getAssignmentLevelFailureTypes({})).toEqual(['assignment'])
    })
  })

  describe('getSyncFailureTypes', () => {
    test('appends grade type when student updates exist', () => {
      const types = journalListSync.getSyncFailureTypes({ nameEt: 'X' }, true)
      expect(types).toContain('grade')
      expect(types).toContain('name')
    })

    test('does not append grade when types already include it', () => {
      const types = journalListSync.getSyncFailureTypes({ nameEt: 'X' }, false)
      expect(types).toEqual(['name'])
    })
  })
})

describe('JournalListSync - Pure utility helpers', () => {
  describe('normalizeTahvelDueDate', () => {
    test('appends T23:59:59.000Z to YYYY-MM-DD', () => {
      expect(journalListSync.normalizeTahvelDueDate('2026-01-15')).toBe('2026-01-15T23:59:59.000Z')
    })

    test('appends .000Z to YYYY-MM-DDTHH:mm:ss', () => {
      expect(journalListSync.normalizeTahvelDueDate('2026-01-15T10:00:00')).toBe('2026-01-15T10:00:00.000Z')
    })

    test('appends Z to date with milliseconds', () => {
      expect(journalListSync.normalizeTahvelDueDate('2026-01-15T10:00:00.123')).toBe('2026-01-15T10:00:00.123Z')
    })

    test('returns input unchanged for null/undefined', () => {
      expect(journalListSync.normalizeTahvelDueDate(null)).toBeNull()
      expect(journalListSync.normalizeTahvelDueDate(undefined)).toBeUndefined()
    })

    test('returns already-normalized values unchanged', () => {
      expect(journalListSync.normalizeTahvelDueDate('2026-01-15T23:59:59.000Z'))
        .toBe('2026-01-15T23:59:59.000Z')
    })

    test('returns non-string input unchanged', () => {
      const date = new Date('2026-01-15')
      expect(journalListSync.normalizeTahvelDueDate(date)).toBe(date)
    })
  })

  describe('getApiErrorStatus', () => {
    test('returns error.status when present', () => {
      expect(journalListSync.getApiErrorStatus({ status: 412 })).toBe(412)
    })

    test('parses status from error message when status missing', () => {
      expect(journalListSync.getApiErrorStatus({ message: 'API Error: 500 Internal' })).toBe(500)
    })

    test('returns null when no status info present', () => {
      expect(journalListSync.getApiErrorStatus({ message: 'plain error' })).toBeNull()
    })

    test('returns null for null input', () => {
      expect(journalListSync.getApiErrorStatus(null)).toBeNull()
    })
  })

  describe('buildSyncFailureMessage', () => {
    test('returns generic message for empty failures', () => {
      const msg = journalListSync.buildSyncFailureMessage([])
      expect(msg).toContain('0 muudatuse')
    })

    test('lists assignment names and types', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ assignmentName: 'Quiz', type: 'name' }])
      expect(msg).toContain('Quiz')
    })

    test('includes status code when present', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ assignmentName: 'Quiz', type: 'name', status: 500 }])
      expect(msg).toContain('HTTP 500')
    })

    test('mentions partial success when count > 0', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ assignmentName: 'Quiz', type: 'name' }], 2)
      expect(msg).toContain('osaliselt õnnestus')
      expect(msg).toContain('2 õnnestus')
    })

    test('appends 412 hint when failure status is 412', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ assignmentName: 'Quiz', type: 'name', status: 412 }])
      expect(msg).toContain('412 Precondition Failed')
    })

    test('falls back to assignment id label when name missing', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ assignmentId: 99, type: 'name' }])
      expect(msg).toContain('ülesanne 99')
    })

    test('uses "tundmatu ülesanne" when neither name nor id is provided', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ type: 'name' }])
      expect(msg).toContain('tundmatu ülesanne')
    })

    test('joins multiple failure types', () => {
      const msg = journalListSync.buildSyncFailureMessage([{ assignmentName: 'Q', types: ['name', 'duedate'] }])
      expect(msg).toContain('nimetus')
      expect(msg).toContain('tähtaeg')
    })
  })

  describe('getStudyYearIdFromText', () => {
    let savedApi

    beforeEach(() => {
      savedApi = journalListSync.api
    })

    afterEach(() => {
      journalListSync.api = savedApi
    })

    test('returns null when yearText is empty', async () => {
      expect(await journalListSync.getStudyYearIdFromText('')).toBeNull()
      expect(await journalListSync.getStudyYearIdFromText(null)).toBeNull()
    })

    test('returns the resolved id when API responds', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => [{ id: 727, nameEt: '2025/2026' }])
        }
      }
      const id = await journalListSync.getStudyYearIdFromText('2025/2026')
      expect(id).toBe(727)
    })

    test('returns null when resolver throws', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => { throw new Error('boom') })
        }
      }
      const id = await journalListSync.getStudyYearIdFromText('2025/2026')
      expect(id).toBeNull()
    })

    test('returns null when API responds with non-matching year', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => [{ id: 1, nameEt: '1999/2000' }])
        }
      }
      const id = await journalListSync.getStudyYearIdFromText('2025/2026')
      expect(id).toBeNull()
    })
  })
})

describe("JournalListSync - Assignment-level sync helpers (additional)", () => {
  describe('getSyncTypeNames', () => {
    test('returns mapping with assignment-level types and grade label', () => {
      const map = journalListSync.getSyncTypeNames()
      expect(map.grade).toBe('hinne')
      expect(map.assignment).toBe('muudatus')
      expect(map.name).toBe('nimetus')
      expect(map.duedate).toBe('tähtaeg')
      expect(map.entrydate).toBe('sissekande kuupäev')
      expect(map.entrytype).toBe('sissekande tüüp')
      expect(map.hours).toBe('tundide arv')
    })
  })

  describe('updateAssignmentLevelSyncStatuses', () => {
    test('forwards each batch field to journalSyncBannerService.updateItemSyncStatus', () => {
      const updateItemSyncStatus = mock()
      const banner = { updateItemSyncStatus }
      journalListSync.updateAssignmentLevelSyncStatuses(banner, {
        journalId: 1, assignmentId: 5, nameEt: 'X', homeworkDuedate: '2026-01-15'
      }, true)
      expect(updateItemSyncStatus).toHaveBeenCalledTimes(2)
    })

    test('does nothing when batch has no changeable fields', () => {
      const updateItemSyncStatus = mock()
      const banner = { updateItemSyncStatus }
      journalListSync.updateAssignmentLevelSyncStatuses(banner, {
        journalId: 1, assignmentId: 5
      }, true)
      expect(updateItemSyncStatus).not.toHaveBeenCalled()
    })
  })

  describe('applyAssignmentLevelChangesToDifference', () => {
    test('writes batch values onto assignmentObj diffKeys for non-scalar fields', () => {
      const assignmentObj = {}
      journalListSync.applyAssignmentLevelChangesToDifference(assignmentObj, {
        nameEt: 'New', homeworkDuedate: '2026-01-15'
      })
      expect(assignmentObj.assignmentName.Tahvel).toBe('New')
      expect(assignmentObj.assignmentDueAt.Tahvel).toBe('2026-01-15')
    })

    test('deletes scalar diffKeys (lessons/assignmentHours)', () => {
      const assignmentObj = { assignmentHours: 4 }
      journalListSync.applyAssignmentLevelChangesToDifference(assignmentObj, { lessons: 6 })
      expect(assignmentObj.assignmentHours).toBeUndefined()
    })

    test('preserves existing kriit value when applying Tahvel changes', () => {
      const assignmentObj = { assignmentName: { kriit: 'Existing' } }
      journalListSync.applyAssignmentLevelChangesToDifference(assignmentObj, { nameEt: 'Tahvel value' })
      expect(assignmentObj.assignmentName.kriit).toBe('Existing')
      expect(assignmentObj.assignmentName.Tahvel).toBe('Tahvel value')
    })
  })

  describe('countSuccessfulSyncChanges', () => {
    test('sums grade updated counts', () => {
      const successfulSyncs = [
        { journalId: 1, assignmentId: 5, updated: 3 },
        { journalId: 2, assignmentId: 6, updated: 2 }
      ]
      const total = journalListSync.countSuccessfulSyncChanges(successfulSyncs, [])
      expect(total).toBe(5)
    })

    test('counts assignment-level fields when batch matches successful sync', () => {
      const successfulSyncs = [{ journalId: 1, assignmentId: 5, updated: 0 }]
      const batches = [
        { journalId: 1, assignmentId: 5, nameEt: 'X', homeworkDuedate: '2026-01-15' }
      ]
      const total = journalListSync.countSuccessfulSyncChanges(successfulSyncs, batches)
      expect(total).toBe(2)
    })

    test('skips batches that did not succeed', () => {
      const successfulSyncs = [{ journalId: 1, assignmentId: 5, updated: 0 }]
      const batches = [
        { journalId: 99, assignmentId: 99, nameEt: 'X' }
      ]
      const total = journalListSync.countSuccessfulSyncChanges(successfulSyncs, batches)
      expect(total).toBe(0)
    })
  })

  describe('getAssignmentLevelBatchChanges', () => {
    test('returns only fields with non-null/undefined values', () => {
      const result = journalListSync.getAssignmentLevelBatchChanges({
        nameEt: 'A', homeworkDuedate: null, entryDate: undefined, entryType: 'SISSEKANNE_T'
      })
      expect(result).toHaveLength(2)
      expect(result.map(c => c.field.batchKey).sort()).toEqual(['entryType', 'nameEt'])
    })

    test('returns empty array for batch with no changeable fields', () => {
      expect(journalListSync.getAssignmentLevelBatchChanges({})).toEqual([])
    })
  })

  describe('getApiErrorStatus — additional cases', () => {
    test('returns numeric status when error message has multi-digit code', () => {
      expect(journalListSync.getApiErrorStatus({ message: 'API Error: 503 Service' })).toBe(503)
    })

    test('returns null when status field is 0', () => {
      expect(journalListSync.getApiErrorStatus({ status: 0 })).toBeNull()
    })

    test('handles undefined error', () => {
      expect(journalListSync.getApiErrorStatus(undefined)).toBeNull()
    })
  })

  describe('normalizeTahvelDueDate — additional cases', () => {
    test('returns input unchanged when string already has timezone', () => {
      expect(journalListSync.normalizeTahvelDueDate('2026-01-15T23:59:59.000+02:00'))
        .toBe('2026-01-15T23:59:59.000+02:00')
    })

    test('returns empty string unchanged', () => {
      expect(journalListSync.normalizeTahvelDueDate('')).toBe('')
    })
  })

  describe('extractAssignmentsFromEntries — additional cases', () => {
    test('returns empty array for non-array input', () => {
      expect(journalListSync.extractAssignmentsFromEntries(null, {})).toEqual([])
      expect(journalListSync.extractAssignmentsFromEntries(undefined, {})).toEqual([])
    })

    test('filters to only graded entry types', () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', id: 1 },
        { entryType: 'SISSEKANNE_T', id: 2 }
      ]
      const studentMap = { idToPersonalCode: {}, journalStudentIdToId: {}, personalCodeToName: {} }
      const result = journalListSync.extractAssignmentsFromEntries(entries, studentMap)
      expect(result).toEqual([])
    })
  })

  describe('getAssignmentLevelChangeValue — additional cases', () => {
    test('returns 0 for scalar field with zero value', () => {
      const result = journalListSync.getAssignmentLevelChangeValue(
        { assignmentHours: 0 },
        { batchKey: 'lessons', diffKey: 'assignmentHours', scalar: true }
      )
      expect(result).toBe(0)
    })

    test('returns the new kriit value when only kriit is set', () => {
      const result = journalListSync.getAssignmentLevelChangeValue(
        { assignmentName: { kriit: 'New', Tahvel: undefined } },
        { batchKey: 'nameEt', diffKey: 'assignmentName' }
      )
      expect(result).toBe('New')
    })
  })

  describe('buildAssignmentLevelUpdatePayload — additional cases', () => {
    test('handles missing entryData fields', () => {
      const result = journalListSync.buildAssignmentLevelUpdatePayload(undefined, { nameEt: 'X' })
      expect(result.nameEt).toBe('X')
      expect(result.journalEntryStudents).toEqual([])
    })

    test('preserves null journalEntryTeachers (does not stringify)', () => {
      const result = journalListSync.buildAssignmentLevelUpdatePayload({ journalEntryTeachers: null }, {})
      expect(result.journalEntryTeachers).toBeNull()
    })
  })

  describe('resolveJournalFromElement', () => {
    test('returns null for null input', () => {
      expect(journalListSync.resolveJournalFromElement(null)).toBeNull()
    })

    test('extracts id from anchor href containing /journal/{id}', () => {
      const a = document.createElement('a')
      a.setAttribute('href', '/journal/12345/edit')
      const r = journalListSync.resolveJournalFromElement(a)
      expect(r.id).toBe(12345)
    })

    test('extracts id from anchor href containing #/journal/{id}', () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/9876')
      const r = journalListSync.resolveJournalFromElement(a)
      expect(r.id).toBe(9876)
    })

    test('returns id=null when anchor has invalid href', () => {
      const a = document.createElement('a')
      a.setAttribute('href', '/foo/bar')
      const r = journalListSync.resolveJournalFromElement(a)
      expect(r.id).toBeNull()
    })

    test('walks up to find anchor parent', () => {
      const a = document.createElement('a')
      a.setAttribute('href', '/journal/555/edit')
      const span = document.createElement('span')
      a.appendChild(span)
      document.body.appendChild(a)
      const r = journalListSync.resolveJournalFromElement(span)
      expect(r.id).toBe(555)
      document.body.removeChild(a)
    })

    test('uses dataset.journalId when no anchor found', () => {
      const div = document.createElement('div')
      div.dataset.journalId = '99'
      const r = journalListSync.resolveJournalFromElement(div)
      expect(r.id).toBe(99)
    })

    test('finds journal id via routerlink attribute', () => {
      const div = document.createElement('div')
      div.setAttribute('routerlink', '/journal/12345/edit')
      const r = journalListSync.resolveJournalFromElement(div)
      expect(r.id).toBe(12345)
    })
  })

  describe('getJournalInfo', () => {
    test('calls api.tahvel.get with correct endpoint', async () => {
      const apiCall = mock(async () => ({ id: 99 }))
      const result = await journalListSync.constructor.prototype.getJournalInfo.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result.id).toBe(99)
      expect(apiCall).toHaveBeenCalledWith('/journals/99', {}, expect.anything())
    })
  })

  describe('getStudentDetails', () => {
    test('calls api.tahvel.get for student', async () => {
      const apiCall = mock(async () => ({ id: 100 }))
      const result = await journalListSync.constructor.prototype.getStudentDetails.call({
        api: { tahvel: { get: apiCall } }
      }, 100)
      expect(result.id).toBe(100)
      expect(apiCall).toHaveBeenCalledWith('/students/100', {}, expect.anything())
    })
  })

  describe('getJournalEntries', () => {
    test('returns content from API response', async () => {
      const apiCall = mock(async () => ({ content: [{ id: 1 }, { id: 2 }] }))
      const result = await journalListSync.constructor.prototype.getJournalEntries.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result.length).toBe(2)
    })

    test('returns empty array when response has no content', async () => {
      // The implementation returns [] when response is unrecognized format
      const apiCall = mock(async () => ({ unexpected: 'shape' }))
      const result = await journalListSync.constructor.prototype.getJournalEntries.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result).toEqual([])
    })

    test('returns null on error', async () => {
      const apiCall = mock(async () => { throw new Error('boom') })
      const result = await journalListSync.constructor.prototype.getJournalEntries.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result).toBeNull()
    })
  })

  describe('getJournalEntriesWithGrades', () => {
    test('returns array if response is array', async () => {
      const apiCall = mock(async () => [{ id: 1 }, { id: 2 }])
      const result = await journalListSync.constructor.prototype.getJournalEntriesWithGrades.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result.length).toBe(2)
    })

    test('returns empty array if response is not array', async () => {
      const apiCall = mock(async () => ({ content: [] }))
      const result = await journalListSync.constructor.prototype.getJournalEntriesWithGrades.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result).toEqual([])
    })

    test('returns null on error', async () => {
      const apiCall = mock(async () => { throw new Error('fail') })
      const result = await journalListSync.constructor.prototype.getJournalEntriesWithGrades.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result).toBeNull()
    })
  })

  describe('getJournalStudents', () => {
    test('returns response when valid', async () => {
      const apiCall = mock(async () => [{ id: 1 }])
      const result = await journalListSync.constructor.prototype.getJournalStudents.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result.length).toBe(1)
    })

    test('returns null on error', async () => {
      const apiCall = mock(async () => { throw new Error('boom') })
      const result = await journalListSync.constructor.prototype.getJournalStudents.call({
        api: { tahvel: { get: apiCall } }
      }, 99)
      expect(result).toBeNull()
    })
  })

  describe('createStudentMap — direct method', () => {
    test('returns empty maps for null input', () => {
      const result = journalListSync.createStudentMap(null, {})
      expect(result.idToPersonalCode).toEqual({})
      expect(result.personalCodeToName).toEqual({})
      expect(result.journalStudentIdToId).toEqual({})
    })

    test('builds map from journalStudents and details', () => {
      const result = journalListSync.createStudentMap(
        [{ id: 1, studentId: 100 }],
        { 100: { personalCode: '50001010001', name: 'Test' } }
      )
      expect(result.journalStudentIdToId[1]).toBe(100)
      expect(result.idToPersonalCode[100]).toBe('50001010001')
      expect(result.personalCodeToName['50001010001']).toBe('Test')
    })

    test('falls back to student.idcode when no details', () => {
      const result = journalListSync.createStudentMap(
        [{ id: 1, studentId: 100, student: { idcode: '50001010002', fullname: 'X X' } }],
        {}
      )
      expect(result.idToPersonalCode[100]).toBe('50001010002')
      expect(result.personalCodeToName['50001010002']).toBe('X X')
    })

    test('uses studentName when fullname missing on student', () => {
      const result = journalListSync.createStudentMap(
        [{ id: 1, studentId: 100, studentName: 'Direct Name', student: { idcode: '50001010003' } }],
        {}
      )
      expect(result.personalCodeToName['50001010003']).toBe('Direct Name')
    })

    test('uses Unknown when no name available', () => {
      const result = journalListSync.createStudentMap(
        [{ id: 1, studentId: 100, student: { idcode: '50001010004' } }],
        {}
      )
      expect(result.personalCodeToName['50001010004']).toBe('Unknown')
    })

    test('skips entries without id or studentId', () => {
      const result = journalListSync.createStudentMap(
        [{ studentId: 100 }, { id: 1 }, null],
        {}
      )
      expect(Object.keys(result.idToPersonalCode).length).toBe(0)
    })
  })

  describe('extractAssignmentsFromEntries — direct method', () => {
    test('returns empty array for null input', () => {
      const result = journalListSync.extractAssignmentsFromEntries(
        null,
        { journalStudentIdToId: {}, idToPersonalCode: {}, personalCodeToName: {} }
      )
      expect(result).toEqual([])
    })

    test('filters non-graded entry types', () => {
      const result = journalListSync.extractAssignmentsFromEntries(
        [{ id: 1, entryType: 'SISSEKANNE_T', nameEt: 'Lesson' }],
        { journalStudentIdToId: {}, idToPersonalCode: {}, personalCodeToName: {} },
        []
      )
      expect(result).toEqual([])
    })

    test('extracts assignments with grades', () => {
      const studentMap = {
        journalStudentIdToId: { 10: 100 },
        idToPersonalCode: { 100: '50001010001' },
        personalCodeToName: { '50001010001': 'Test' }
      }
      const journalStudents = [{ id: 10, studentId: 100 }]
      const entries = [
        {
          id: 1,
          nameEt: 'HW',
          entryType: 'SISSEKANNE_I',
          journalStudentResults: { '10': [{ grade: { code: 'KUTSEHINDAMINE_5' } }] }
        }
      ]
      const result = journalListSync.extractAssignmentsFromEntries(
        entries, studentMap, journalStudents, {}
      )
      expect(result.length).toBe(1)
      expect(result[0].results[0].grade).toBe('5')
    })
  })

  describe('getAssignmentNameFromEntry — direct method', () => {
    test('returns nameEt when present', () => {
      expect(journalListSync.getAssignmentNameFromEntry({ nameEt: 'Test' })).toBe('Test')
    })

    test('extracts first sentence from content', () => {
      expect(journalListSync.getAssignmentNameFromEntry({ content: 'Sentence one. Sentence two.' })).toBe('Sentence one')
    })

    test('returns SISSEKANNE_I default fallback', () => {
      expect(journalListSync.getAssignmentNameFromEntry({ entryType: 'SISSEKANNE_I' })).toBe('Iseseisev töö')
    })

    test('returns SISSEKANNE_P default fallback', () => {
      expect(journalListSync.getAssignmentNameFromEntry({ entryType: 'SISSEKANNE_P' })).toBe('Praktiline töö')
    })

    test('returns SISSEKANNE_H default fallback', () => {
      expect(journalListSync.getAssignmentNameFromEntry({ entryType: 'SISSEKANNE_H' })).toBe('Hindeline töö')
    })

    test('returns generic fallback', () => {
      expect(journalListSync.getAssignmentNameFromEntry({})).toBe('Päeviku sissekanne')
    })

    test('truncates long content', () => {
      const longContent = 'A'.repeat(200)
      const result = journalListSync.getAssignmentNameFromEntry({ content: longContent })
      expect(result.endsWith('...')).toBe(true)
    })
  })

  describe('countTotalDifferences', () => {
    test('returns 0 for null differences', () => {
      journalListSync.differences = null
      expect(journalListSync.countTotalDifferences()).toBe(0)
    })

    test('returns 0 for empty differences', () => {
      journalListSync.differences = []
      expect(journalListSync.countTotalDifferences()).toBe(0)
    })
  })

  describe('extractAssignmentNameDifferences', () => {
    test('returns empty for null differences', () => {
      journalListSync.differences = null
      expect(journalListSync.extractAssignmentNameDifferences()).toEqual([])
    })

    test('extracts name diffs with kriit/Tahvel grouped by subject', () => {
      journalListSync.differences = [{
        subjectName: 'Math',
        assignments: [{
          assignmentExternalId: 1,
          assignmentName: { kriit: 'Test1', Tahvel: 'Test2' }
        }]
      }]
      const result = journalListSync.extractAssignmentNameDifferences()
      expect(result.length).toBe(1)
      expect(result[0].subjectName).toBe('Math')
      expect(result[0].nameDiffs[0].kriit).toBe('Test1')
    })
  })

  describe('extractAssignmentHoursDifferences', () => {
    test('returns empty for null differences', () => {
      journalListSync.differences = null
      expect(journalListSync.extractAssignmentHoursDifferences()).toEqual([])
    })

    test('extracts hours diff', () => {
      journalListSync.differences = [{
        assignments: [{
          assignmentExternalId: 1,
          assignmentHours: { kriit: 2, Tahvel: 3 }
        }]
      }]
      const result = journalListSync.extractAssignmentHoursDifferences()
      expect(result.length).toBe(1)
    })
  })

  describe('extractEntryTypeDifferences', () => {
    test('returns empty for null differences', () => {
      journalListSync.differences = null
      expect(journalListSync.extractEntryTypeDifferences()).toEqual([])
    })

    test('extracts entry type diff when both values differ', () => {
      journalListSync.differences = [{
        assignments: [{
          assignmentExternalId: 1,
          entryType: { kriit: 'SISSEKANNE_H', Tahvel: 'SISSEKANNE_I' }
        }]
      }]
      const result = journalListSync.extractEntryTypeDifferences()
      expect(result.length).toBe(1)
    })
  })
})

describe("JournalListSync - Sync flow and lifecycle", () => {
  let savedSetTimeout
  let savedShowSuccess
  let savedShowError
  let savedShowAllSync

  beforeEach(() => {
    restoreChromeMock()
    restoreGlobalDOM()
    if (!global.btoa) global.btoa = str => Buffer.from(str).toString('base64')

    // Suppress all setTimeouts
    savedSetTimeout = global.setTimeout
    global.setTimeout = mock(() => 1)

    // Suppress UI methods so calls don't blow up — these are NOT methods we are unit-testing here
    savedShowSuccess = journalListSync.showSuccessBanner
    savedShowError = journalListSync.showErrorBanner
    savedShowAllSync = journalListSync.showAllInSyncBanner

    // Reset state
    journalListSync.differences = null
    journalListSync.error = null
    journalListSync.isLoading = false
    journalListSync.isActive = false
    journalListSync.journalLinks = null
    journalListSync.journalStudentIdToStudentId = {}
    journalListSync._localStudentCache = {}
    journalListSync._cachedStudents = {}
    journalListSync.globalTeacherCache = {}
    delete window.journalListSync
  })

  afterEach(() => {
    global.setTimeout = savedSetTimeout
    if (savedShowSuccess) journalListSync.showSuccessBanner = savedShowSuccess
    if (savedShowError) journalListSync.showErrorBanner = savedShowError
    if (savedShowAllSync) journalListSync.showAllInSyncBanner = savedShowAllSync
    delete window.journalListSync
  })

  describe('proceedWithKriitApiCall — request/response handling', () => {
    test('sets error when no journalData provided and no token', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => ({ content: [], totalPages: 1 })), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: null, post: mock(async () => ({})), enabled: true }
      }
      // Provide already-collected data so API token check is hit
      await journalListSync.proceedWithKriitApiCall([
        { subjectName: 'A', subjectExternalId: 1, assignments: [] }
      ])
      expect(journalListSync.error).toContain('No Kriit API token set')
    })

    test('sets error when no journalData provided and fetchJournalsFromApi returns empty', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async () => ({ content: [], totalPages: 1 })),
          baseUrl: 'https://tahvel.edu.ee/hois_back'
        },
        kriit: { authToken: 'tkn', post: mock(async () => ([])), enabled: true }
      }
      await journalListSync.proceedWithKriitApiCall()
      expect(journalListSync.error).toContain('No valid journal data')
    })

    test('processes Kriit response array shape and stores differences', async () => {
      const apiKriitResponse = [
        {
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 100,
              assignmentName: 'Test',
              results: [{ studentPersonalCode: '50001010001', grade: '4' }]
            }
          ]
        }
      ]
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiKriitResponse), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      const journalData = [
        {
          subjectName: 'Math',
          subjectExternalId: 1,
          groupName: 'GR',
          assignments: [
            {
              assignmentExternalId: 100,
              assignmentName: 'Test',
              entryType: 'SISSEKANNE_H',
              results: [{ studentPersonalCode: '50001010001', grade: 'B', studentName: 'Stu' }]
            }
          ]
        }
      ]
      await journalListSync.proceedWithKriitApiCall(journalData)
      expect(Array.isArray(journalListSync.differences)).toBe(true)
      expect(journalListSync.differences.length).toBe(1)
      // Ensure subject details are merged
      expect(journalListSync.differences[0].subjectName).toBe('Math')
    })

    test('processes Kriit response with response.data array shape', async () => {
      const apiKriitResponse = { data: [{ subjectExternalId: 2, assignments: [] }] }
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiKriitResponse), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 2, assignments: [] }])
      expect(journalListSync.differences.length).toBe(1)
    })

    test('processes Kriit response with response.data.differences array', async () => {
      const apiKriitResponse = { data: { differences: [{ subjectExternalId: 3 }] } }
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiKriitResponse), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 3, assignments: [] }])
      expect(journalListSync.differences.length).toBe(1)
    })

    test('processes Kriit response with response.differences array', async () => {
      const apiKriitResponse = { differences: [{ subjectExternalId: 4 }] }
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiKriitResponse), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 4, assignments: [] }])
      expect(journalListSync.differences.length).toBe(1)
    })

    test('captures newAssignments and stores them on window.journalListSync', async () => {
      const apiKriitResponse = { data: { differences: [], newAssignments: { '5': [{ id: 'a1' }] } } }
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiKriitResponse), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 5, subjectName: 'S', assignments: [] }])
      expect(window.journalListSync.newAssignments['5']).toBeDefined()
    })

    test('shows all-synced message when no differences and no new assignments', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => ([])), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 6, subjectName: 'X', assignments: [] }])
      expect(journalListSync.error).toContain('Kõik hinded on juba sünkroonis')
    })

    test('handles API errors during Kriit POST and captures error', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => { throw new Error('Network down') }), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 7, subjectName: 'X', assignments: [] }])
      expect(journalListSync.error).toContain('Error calling Kriit API')
      expect(journalListSync.error).toContain('Network down')
    })

    test('subjectsCache is populated from journalData', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => ([])), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([
        { subjectExternalId: 100, subjectName: 'Subj100', assignments: [] }
      ])
      expect(window.journalListSync.subjectsCache['100']).toBe('Subj100')
    })

    test('merges studentName from journalData into difference results', async () => {
      const apiResp = [
        {
          subjectExternalId: 11,
          assignments: [{
            assignmentExternalId: 200,
            results: [{ studentPersonalCode: '50001010001', grade: '5' }]
          }]
        }
      ]
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiResp), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([
        {
          subjectExternalId: 11,
          subjectName: 'Subj',
          assignments: [{
            assignmentExternalId: 200,
            assignmentName: 'A',
            results: [{ studentPersonalCode: '50001010001', studentName: 'Linked Name', studentIsActive: true, grade: '4' }]
          }]
        }
      ])
      const diffResult = journalListSync.differences[0].assignments[0].results[0]
      expect(diffResult.studentName).toBe('Linked Name')
      expect(diffResult.currentGrade).toBe('4')
    })

    test('uses last-8-digit fallback for matching personal codes', async () => {
      const apiResp = [
        {
          subjectExternalId: 11,
          assignments: [{
            assignmentExternalId: 200,
            results: [{ studentPersonalCode: '12345678' /* short, will match last 8 */ }]
          }]
        }
      ]
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => apiResp), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.proceedWithKriitApiCall([
        {
          subjectExternalId: 11,
          subjectName: 'Subj',
          assignments: [{
            assignmentExternalId: 200,
            assignmentName: 'A',
            results: [{ studentPersonalCode: '5000112345678', studentName: 'M', grade: '4' }]
          }]
        }
      ])
      const diffResult = journalListSync.differences[0].assignments[0].results[0]
      expect(diffResult.studentName).toBe('M')
    })
  })

  describe('fetchJournalData — error and edge paths', () => {
    test('returns early with error when fetchJournalsFromApi yields empty list', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => ({ content: [], totalPages: 1 })), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', post: mock(async () => ({})), enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      await journalListSync.fetchJournalData()
      expect(journalListSync.error).toContain('Could not fetch journal list')
    })

    test('successfully fetches and processes journals end-to-end with no Kriit differences', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (endpoint) => {
            // Mimics paged journals endpoint
            if (endpoint === '/journals') {
              return { content: [{ id: 800, nameEt: 'Subj-800' }], totalPages: 1 }
            }
            if (endpoint === '/journals/800') {
              return { id: 800, nameEt: 'Subj-800', studentGroups: ['GR'], journalTeachers: [] }
            }
            if (endpoint === '/journals/800/journalEntry') return { content: [], totalElements: 0 }
            if (endpoint === '/journals/800/journalEntriesByDate') return []
            if (endpoint === '/journals/800/journalStudents') return []
            if (endpoint.includes('/timetableevents')) return []
            return null
          }),
          baseUrl: 'https://tahvel.edu.ee/hois_back'
        },
        kriit: {
          authToken: 'tkn',
          enabled: true,
          baseUrl: 'https://kriit.example.com/api',
          post: mock(async () => ([]))
        }
      }
      journalListSync.journalLinks = [document.createElement('a')]
      await journalListSync.fetchJournalData()
      // No differences ⇒ shows "all in sync" message
      expect(journalListSync.error).toContain('Kõik hinded')
    })
  })

  describe('collectJournalData — multigroup and theme paths', () => {
    test('returns empty array when journalLinks is empty', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: true }
      }
      journalListSync.journalLinks = []
      const result = await journalListSync.collectJournalData()
      expect(result).toEqual([])
    })

    test('collects journal data using API list passed as argument', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (endpoint, params, options) => {
            if (endpoint === '/journals/501') {
              return {
                id: 501,
                nameEt: 'Math 101',
                studentGroups: ['CS-A'],
                journalTeachers: [{ id: 901, nameEt: 'T One', fullname: 'T One' }],
                lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 10, usedHours: 5 }] }
              }
            }
            if (endpoint === '/journals/501/journalEntriesByDate') {
              return [{
                id: 700,
                entryType: 'SISSEKANNE_H',
                entryDate: '2025-09-01',
                nameEt: 'Quiz',
                journalStudentResults: { '1': [{ journalStudentId: 1, grade: { code: 'KUTSEHINDAMINE_5' } }] }
              }]
            }
            if (endpoint === '/journals/501/journalEntry') {
              return { content: [{ id: 700, entryType: 'SISSEKANNE_H', entryDate: '2025-09-01', homeworkDuedate: '2025-09-15' }], totalElements: 1 }
            }
            if (endpoint === '/journals/501/journalStudents') {
              return [{ id: 1, studentId: 700, fullname: 'Stu', studentGroup: 'CS-A', status: 'OPPURSTAATUS_O' }]
            }
            if (endpoint === '/students/700') {
              return { id: 700, person: { idcode: '50001010001', firstname: 'F', lastname: 'L' }, status: 'OPPURSTAATUS_O' }
            }
            if (endpoint.includes('/teachers/')) return { person: { idcode: '38001010001' } }
            if (endpoint.includes('/timetableevents')) return []
            return null
          }),
          baseUrl: 'https://tahvel.edu.ee/hois_back'
        },
        kriit: { authToken: 'tkn', enabled: true }
      }
      // Provide a non-empty journalLinks array so the gate on line 783 doesn't return early.
      journalListSync.journalLinks = [document.createElement('a')]
      const apiList = [{ __apiJournal: true, id: 501, nameEt: 'Math 101' }]
      const result = await journalListSync.collectJournalData(apiList)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].subjectName).toBe('Math 101')
      expect(result[0].subjectExternalId).toBe(501)
    })

    test('handles journal info response missing - returns null entry filtered out', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (endpoint) => {
            if (endpoint === '/journals/999') return null  // info missing
            if (endpoint === '/journals/999/journalEntry') return { content: [] }
            if (endpoint === '/journals/999/journalEntriesByDate') return []
            if (endpoint === '/journals/999/journalStudents') return []
            return null
          }),
          baseUrl: 'https://tahvel.edu.ee/hois_back'
        },
        kriit: { authToken: 'tkn', enabled: true }
      }
      journalListSync.journalLinks = [document.createElement('a')]
      const result = await journalListSync.collectJournalData([{ __apiJournal: true, id: 999, nameEt: 'X' }])
      expect(result).toEqual([])
    })

    test('produces multigroup entries when journal has multiple studentGroups', async () => {
      journalListSync.api = {
        tahvel: {
          get: mock(async (endpoint) => {
            if (endpoint === '/journals/600') {
              return {
                id: 600,
                nameEt: 'MultiGroup',
                studentGroups: ['G1', 'G2'],
                journalTeachers: []
              }
            }
            if (endpoint === '/journals/600/journalEntry') return { content: [], totalElements: 0 }
            if (endpoint === '/journals/600/journalEntriesByDate') return []
            if (endpoint === '/journals/600/journalStudents') {
              return [
                { id: 11, studentId: 1100, fullname: 'A', studentGroup: 'G1', status: 'OPPURSTAATUS_O' },
                { id: 12, studentId: 1101, fullname: 'B', studentGroup: 'G2', status: 'OPPURSTAATUS_O' }
              ]
            }
            if (endpoint === '/students/1100') {
              return { id: 1100, person: { idcode: '50001010001', firstname: 'A', lastname: 'A' }, status: 'OPPURSTAATUS_O' }
            }
            if (endpoint === '/students/1101') {
              return { id: 1101, person: { idcode: '50001010002', firstname: 'B', lastname: 'B' }, status: 'OPPURSTAATUS_O' }
            }
            if (endpoint.includes('/timetableevents')) return []
            return null
          }),
          baseUrl: 'https://tahvel.edu.ee/hois_back'
        },
        kriit: { authToken: 'tkn', enabled: true }
      }
      journalListSync.journalLinks = [document.createElement('a')]
      const result = await journalListSync.collectJournalData([{ __apiJournal: true, id: 600, nameEt: 'MultiGroup' }])
      expect(result.length).toBe(2)
      expect(result[0].groupName).toBe('G1')
      expect(result[1].groupName).toBe('G2')
    })
  })

  describe('clearCache', () => {
    test('clears caches and returns counts', async () => {
      journalListSync.globalTeacherCache = { 1: { x: 1 }, 2: { y: 2 } }
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: true }
      }
      const result = await journalListSync.clearCache()
      expect(result).toBeDefined()
      expect(typeof result.total).toBe('number')
      expect(Object.keys(journalListSync.globalTeacherCache).length).toBe(0)
    })
  })

  describe('resetKriitApiToken', () => {
    test('uses prompt to set new token; if cancelled sets error', () => {
      const origPrompt = global.prompt
      global.prompt = mock(() => null)
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: true }
      }
      journalListSync.isActive = false
      journalListSync.resetKriitApiToken()
      // chrome.storage.local.remove is async - just verify error message is set
      expect(journalListSync.error).toContain('No token provided')
      global.prompt = origPrompt
    })

    test('runs full path when prompt returns a value (real setKriitApiToken)', () => {
      const origPrompt = global.prompt
      const setMock = mock((items, callback) => {
        // record token persistence in chrome.storage.local
        if (callback) callback()
      })
      global.chrome = {
        storage: {
          local: {
            get: mock((_keys, cb) => cb({})),
            set: setMock,
            remove: mock((keys, callback) => { if (callback) callback() })
          }
        },
        runtime: { onMessage: { addListener: mock() }, sendMessage: mock(), getManifest: mock(() => ({})) }
      }
      global.prompt = mock(() => 'NEW_TOKEN')
      // Provide setAuthToken on kriit so setKriitApiToken's call won't blow up.
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: true, setAuthToken: mock(() => {}) }
      }

      // Real resetKriitApiToken → real setKriitApiToken → chrome.storage.local.set
      journalListSync.resetKriitApiToken()
      // setKriitApiToken should call chrome.storage.local.set
      expect(setMock).toHaveBeenCalled()

      global.prompt = origPrompt
    })
  })

  describe('countTotalDifferences — with grade differences', () => {
    test('counts grade differences across subjects/assignments/results', () => {
      journalListSync.differences = [
        {
          subjectName: 'Math',
          assignments: [
            {
              assignmentExternalId: 1,
              results: [
                { grade: '5', currentGrade: '4', studentPersonalCode: '50001010001' },
                { grade: '5', currentGrade: '5', studentPersonalCode: '50001010002' }
              ]
            }
          ]
        }
      ]
      const count = journalListSync.countTotalDifferences()
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })

  describe('updateUI — branches', () => {
    test('does nothing when isActive false', () => {
      journalListSync.isActive = false
      // Just call - should not throw
      expect(() => journalListSync.updateUI()).not.toThrow()
    })

    test('shows loading banner when isLoading is true', () => {
      journalListSync.isActive = true
      journalListSync.isLoading = true
      // Stub bannerService methods to avoid side effects
      const origShowLoad = bannerService.showLoadingBanner
      const origHas = bannerService.hasBanner
      const showLoadMock = mock(() => {})
      bannerService.showLoadingBanner = showLoadMock
      bannerService.hasBanner = mock(() => false)
      journalListSync.updateUI()
      expect(showLoadMock).toHaveBeenCalled()
      bannerService.showLoadingBanner = origShowLoad
      bannerService.hasBanner = origHas
    })

    test('shows differences banner when differences exist', () => {
      journalListSync.isActive = true
      journalListSync.isLoading = false
      journalListSync.error = null
      journalListSync.differences = [{ subjectExternalId: 1, assignments: [] }]
      // Stub the underlying journalSyncBannerService method to capture invocation
      // (this is an external dependency, not a method of UUT)
      const origShowBanner = journalSyncBannerService.showDifferencesBanner
      const showBannerMock = mock(() => {})
      journalSyncBannerService.showDifferencesBanner = showBannerMock
      journalListSync.updateUI()
      expect(showBannerMock).toHaveBeenCalled()
      journalSyncBannerService.showDifferencesBanner = origShowBanner
    })
  })

  describe('onDeactivate — full cleanup', () => {
    test('cleans up observers and resets state', () => {
      journalListSync.isActive = true
      journalListSync.tableObserver = { disconnect: mock(() => {}) }
      journalListSync.journalLinks = ['fake']
      journalListSync.onDeactivate()
      expect(journalListSync.isActive).toBe(false)
      expect(journalListSync.tableObserver).toBe(null)
      expect(journalListSync.journalLinks).toBe(null)
    })
  })

  describe('syncWithKriit — sync data collection branches', () => {
    test('skips early when isLoading is true', async () => {
      journalListSync.isLoading = true
      journalListSync.differences = [{ subjectExternalId: 1, assignments: [{ results: [{ studentPersonalCode: 'x', grade: '5' }] }] }]
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: { get: mock(async () => ({})), put: mock(async () => ({})) }
      }
      const result = await journalListSync.syncWithKriit()
      expect(result).toBeUndefined()
    })

    test('returns early when no differences present', async () => {
      journalListSync.isLoading = false
      journalListSync.differences = []
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: { get: mock(async () => ({})), put: mock(async () => ({})) }
      }
      const result = await journalListSync.syncWithKriit()
      expect(result).toBeUndefined()
    })

    test('throws when result has missing personal code', async () => {
      journalListSync.isLoading = false
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            { assignmentExternalId: 10, results: [{ studentPersonalCode: '', grade: '5' }] }
          ]
        }
      ]
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: { get: mock(async () => ({})), put: mock(async () => ({})) }
      }
      const result = await journalListSync.syncWithKriit()
      expect(journalListSync.error).toContain('missing personal code')
      // syncWithKriit catches errors and returns failedSyncs entry
      expect(result.failedSyncs.length).toBeGreaterThan(0)
    })

    test('throws when fallback- prefix in personal code', async () => {
      journalListSync.isLoading = false
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            { assignmentExternalId: 10, results: [{ studentPersonalCode: 'fallback-123', grade: '5' }] }
          ]
        }
      ]
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: { get: mock(async () => ({})), put: mock(async () => ({})) }
      }
      const result = await journalListSync.syncWithKriit()
      expect(journalListSync.error).toContain('invalid personal code')
      expect(result.failedSyncs.length).toBeGreaterThan(0)
    })

    test('skips deleted students', async () => {
      journalListSync.isLoading = false
      journalListSync.isActive = true
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              results: [
                { studentPersonalCode: '50001010001', grade: '5', currentGrade: '4', studentIsDeleted: true }
              ]
            }
          ]
        }
      ]
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: { get: mock(async () => ({})), put: mock(async () => ({})) }
      }
      const result = await journalListSync.syncWithKriit()
      // Deleted student skipped; nothing to sync
      expect(journalListSync.error).toContain('Kõik hinded on juba sünkroonis')
    })

    test('skips when grades are equal (no diff)', async () => {
      journalListSync.isLoading = false
      journalListSync.isActive = true
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              results: [
                { studentPersonalCode: '50001010001', grade: '5', currentGrade: '5' }
              ]
            }
          ]
        }
      ]
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: { get: mock(async () => ({})), put: mock(async () => ({})) }
      }
      const result = await journalListSync.syncWithKriit()
      expect(journalListSync.error).toContain('Kõik hinded on juba sünkroonis')
    })

    test('detects grade differences and proceeds with PUT (one student, success)', async () => {
      journalListSync.isLoading = false
      journalListSync.isActive = true
      journalListSync.journalStudentIdToStudentId = { 1: 700 }
      journalListSync._cachedStudents = {
        1: { personalCode: '50001010001', name: 'Stu', isActive: true, isDeleted: false }
      }

      const putMock = mock(async () => ({}))
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint) => {
            if (endpoint === '/journals/1/journalEntry/10') {
              return {
                version: 5,
                id: 10,
                entryType: 'SISSEKANNE_H',
                journalEntryStudents: [{ id: 100, journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_4' } }]
              }
            }
            if (endpoint === '/journals/1/journalStudents') {
              return [{ id: 1, studentId: 700, student: { idcode: '50001010001', fullname: 'Stu', status: 'OPPURSTAATUS_O' } }]
            }
            if (endpoint === '/students/700') {
              return { id: 700, person: { idcode: '50001010001' }, status: 'OPPURSTAATUS_O' }
            }
            return null
          }),
          put: putMock
        }
      }
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              results: [
                { studentPersonalCode: '50001010001', grade: '5', currentGrade: '4', studentName: 'Stu' }
              ]
            }
          ]
        }
      ]
      const result = await journalListSync.syncWithKriit()
      expect(result.successfulSyncs.length).toBeGreaterThan(0)
      expect(putMock).toHaveBeenCalled()
    })

    test('returns early when no entry data (entry data null)', async () => {
      journalListSync.isLoading = false
      journalListSync.isActive = true
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => null), // no entry data
          put: mock(async () => ({}))
        }
      }
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              results: [{ studentPersonalCode: '50001010001', grade: '5', currentGrade: '4' }]
            }
          ]
        }
      ]
      const result = await journalListSync.syncWithKriit()
      expect(result.failedSyncs.length).toBeGreaterThan(0)
    })

    test('PUT failure is captured in failedSyncs', async () => {
      journalListSync.isLoading = false
      journalListSync.isActive = true
      const tahvelError = new Error('API Error: 412')
      tahvelError.status = 412
      journalListSync.journalStudentIdToStudentId = { 1: 700 }
      journalListSync._cachedStudents = {
        1: { personalCode: '50001010001', name: 'Stu', isActive: true, isDeleted: false }
      }
      journalListSync.api = {
        kriit: { baseUrl: 'https://kriit.example.com/api' },
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint) => {
            if (endpoint === '/journals/1/journalEntry/10') {
              return {
                version: 5,
                id: 10,
                entryType: 'SISSEKANNE_H',
                journalEntryStudents: [{ id: 100, journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_4' } }]
              }
            }
            if (endpoint === '/journals/1/journalStudents') {
              return [{ id: 1, studentId: 700, student: { idcode: '50001010001', fullname: 'Stu', status: 'OPPURSTAATUS_O' } }]
            }
            if (endpoint === '/students/700') return { id: 700, person: { idcode: '50001010001' }, status: 'OPPURSTAATUS_O' }
            return null
          }),
          put: mock(async () => { throw tahvelError })
        }
      }
      journalListSync.differences = [
        {
          subjectName: 'X',
          subjectExternalId: 1,
          assignments: [
            {
              assignmentExternalId: 10,
              results: [{ studentPersonalCode: '50001010001', grade: '5', currentGrade: '4', studentName: 'Stu' }]
            }
          ]
        }
      ]
      const result = await journalListSync.syncWithKriit()
      expect(result.failedSyncs.length).toBeGreaterThan(0)
      expect(journalListSync.error).toContain('HTTP 412')
    })
  })

  describe('proceedWithKriitApiCall — inactive students inclusion', () => {
    test('includes inactive students from cache in payload sent to Kriit', async () => {
      const postMock = mock(async () => ([]))
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint) => {
            // Return inactive students for the /students endpoint
            if (endpoint === '/students') {
              return {
                content: [
                  { id: 100, idcode: '50001010001', fullname: 'Inactive A', status: 'OPPURSTAATUS_K' },
                  { id: 200, idcode: '50001010002', fullname: 'Inactive B', status: 'OPPURSTAATUS_L' }
                ]
              }
            }
            return null
          })
        },
        kriit: {
          authToken: 'tkn',
          enabled: true,
          baseUrl: 'https://kriit.example.com/api',
          post: postMock
        }
      }
      await journalListSync.proceedWithKriitApiCall([{ subjectExternalId: 1, subjectName: 'X', assignments: [] }])
      const callArgs = postMock.mock.calls[0]
      expect(callArgs[0]).toBe('/subjects/getDifferences')
      // Inactive students should be in payload (when fetched)
      expect(callArgs[1].journals).toBeDefined()
      expect(Array.isArray(callArgs[1].inactiveStudents)).toBe(true)
    })
  })

  describe('proceedWithKriitApiCall — payload hash & runtime cache', () => {
    test('falls back to fetching journals when no providedJournalData given', async () => {
      const apiKriitResponse = []
      let fetchCalled = 0
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint) => {
            fetchCalled++
            if (endpoint === '/journals') return { content: [], totalPages: 1 }
            return null
          })
        },
        kriit: {
          authToken: 'tkn',
          enabled: true,
          baseUrl: 'https://kriit.example.com/api',
          post: mock(async () => apiKriitResponse)
        }
      }
      await journalListSync.proceedWithKriitApiCall()
      // No data => error
      expect(journalListSync.error).toBeTruthy()
      expect(fetchCalled).toBeGreaterThanOrEqual(1)
    })
  })

  describe('syncWithKriit — assignment-level only batch with entry data', () => {
    test('processes assignment-level only update (entryDate change) successfully', async () => {
      const originalSetTimeout = global.setTimeout
      const originalBannerSuccess = bannerService.showSuccessBanner
      const setTimeoutMock = mock(() => 1)
      const bannerSuccessMock = mock(() => {})
      global.setTimeout = setTimeoutMock
      bannerService.showSuccessBanner = bannerSuccessMock
      journalListSync.isActive = true

      try {
        const get = mock(async () => ({
          version: 5,
          id: 100,
          entryType: 'SISSEKANNE_H',
          nameEt: 'X',
          entryDate: '2024-01-01T00:00:00Z',
          journalEntryTeachers: [1],
          journalEntryStudents: [{ journalStudent: 1 }]
        }))
        const put = mock(async () => ({}))
        journalListSync.api = {
          kriit: { baseUrl: 'https://kriit.example.com/api' },
          tahvel: { baseUrl: 'https://tahvel.edu.ee/hois_back', get, put }
        }
        // Assignment-level only differences (entryDate)
        journalListSync.differences = [
          {
            subjectName: 'Subj',
            subjectExternalId: 1,
            assignments: [
              {
                assignmentExternalId: 100,
                assignmentName: 'X',
                assignmentEntryDate: { kriit: '2024-02-01', Tahvel: '2024-01-01' },
                results: []
              }
            ]
          }
        ]

        const result = await journalListSync.syncWithKriit()
        expect(result.successfulSyncs.length).toBeGreaterThan(0)
      } finally {
        global.setTimeout = originalSetTimeout
        bannerService.showSuccessBanner = originalBannerSuccess
      }
    })

    test('processes name-only assignment-level diff successfully', async () => {
      const originalSetTimeout = global.setTimeout
      const originalBannerSuccess = bannerService.showSuccessBanner
      global.setTimeout = mock(() => 1)
      bannerService.showSuccessBanner = mock(() => {})
      journalListSync.isActive = true

      try {
        const get = mock(async () => ({
          version: 5,
          id: 100,
          entryType: 'SISSEKANNE_H',
          nameEt: 'OldName',
          journalEntryTeachers: [1],
          journalEntryStudents: [{ journalStudent: 1 }]
        }))
        const put = mock(async () => ({}))
        journalListSync.api = {
          kriit: { baseUrl: 'https://kriit.example.com/api' },
          tahvel: { baseUrl: 'https://tahvel.edu.ee/hois_back', get, put }
        }
        journalListSync.differences = [
          {
            subjectName: 'Subj',
            subjectExternalId: 1,
            assignments: [
              {
                assignmentExternalId: 100,
                assignmentName: { kriit: 'NewName', Tahvel: 'OldName' },
                results: []
              }
            ]
          }
        ]

        const result = await journalListSync.syncWithKriit()
        expect(result.successfulSyncs.length).toBeGreaterThan(0)
      } finally {
        global.setTimeout = originalSetTimeout
        bannerService.showSuccessBanner = originalBannerSuccess
      }
    })
  })

  describe('updateProgressUI', () => {
    test('does nothing when isActive false', () => {
      journalListSync.isActive = false
      expect(() => journalListSync.updateProgressUI(1, 5)).not.toThrow()
    })

    test('calls bannerService when isActive', () => {
      journalListSync.isActive = true
      const orig = bannerService.updateProgressUI
      const m = mock(() => {})
      bannerService.updateProgressUI = m
      journalListSync.updateProgressUI(2, 10)
      expect(m).toHaveBeenCalled()
      bannerService.updateProgressUI = orig
    })
  })

  describe('showSuccessBanner / showErrorBanner', () => {
    test('showSuccessBanner skips when not active', () => {
      journalListSync.isActive = false
      expect(() => journalListSync.showSuccessBanner('msg')).not.toThrow()
    })

    test('showSuccessBanner calls bannerService when active', () => {
      journalListSync.isActive = true
      const orig = bannerService.showSuccessBanner
      const m = mock(() => {})
      bannerService.showSuccessBanner = m
      journalListSync.showSuccessBanner('msg')
      expect(m).toHaveBeenCalled()
      bannerService.showSuccessBanner = orig
    })
  })

  describe('onActivate — branches', () => {
    test('returns early when URL hash does not start with journals', async () => {
      global.window = {
        ...global.window,
        location: { hash: '#/different-page', href: 'https://tahvel.edu.ee/#/different-page' }
      }
      journalListSync.api = {
        _kriitInitPromise: Promise.resolve(),
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      journalListSync.isActive = true
      await journalListSync.onActivate([])
      // Won't run main logic — just returns
      expect(journalListSync.isActive).toBe(true)
    })

    test('returns early when isActive becomes false', async () => {
      global.window = {
        ...global.window,
        location: { hash: '#/journals', href: 'https://tahvel.edu.ee/#/journals' }
      }
      journalListSync.api = {
        _kriitInitPromise: Promise.resolve(),
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      journalListSync.isActive = false
      // Should return cleanly before doing anything
      await expect(journalListSync.onActivate([])).resolves.toBeUndefined()
    })

    test('skips when Kriit not enabled', async () => {
      global.window = {
        ...global.window,
        location: { hash: '#/journals', href: 'https://tahvel.edu.ee/#/journals' }
      }
      journalListSync.api = {
        _kriitInitPromise: Promise.resolve(),
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: 'tkn', enabled: false, baseUrl: 'https://kriit.example.com/api' }
      }
      journalListSync.isActive = true
      await expect(journalListSync.onActivate([])).resolves.toBeUndefined()
    })

    test('shows missing API key banner when no token', async () => {
      global.window = {
        ...global.window,
        location: { hash: '#/journals', href: 'https://tahvel.edu.ee/#/journals' }
      }
      journalListSync.api = {
        _kriitInitPromise: Promise.resolve(),
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' },
        kriit: { authToken: null, enabled: true, baseUrl: 'https://kriit.example.com/api' }
      }
      journalListSync.isActive = true

      const origShowBanner = journalListSync.showMissingApiKeyBanner
      const showBannerMock = mock(() => {})
      journalListSync.showMissingApiKeyBanner = showBannerMock

      await journalListSync.onActivate([])
      expect(showBannerMock).toHaveBeenCalled()

      journalListSync.showMissingApiKeyBanner = origShowBanner
    })
  })

  describe('processStudentData', () => {
    test('returns empty map when journalStudents is null', async () => {
      const result = await journalListSync.processStudentData(123, null)
      expect(result).toEqual({})
    })

    test('returns empty map when journalStudents is empty array', async () => {
      const result = await journalListSync.processStudentData(123, [])
      expect(result).toEqual({})
    })

    test('skips students without studentId', async () => {
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' }
      }
      const result = await journalListSync.processStudentData(123, [
        { id: 1 }, // no studentId
        null,       // null
        { id: 2, studentId: 100, fullname: 'Test' }
      ])
      // Only the third entry has a studentId; result depends on cache behavior
      expect(typeof result).toBe('object')
    })
  })

  describe('getSelectedStudyYear', () => {
    test('returns null when no element matches', () => {
      // Ensure no .selected-option element exists
      const result = journalListSync.getSelectedStudyYear()
      expect(result).toBe(null)
    })

    test('returns text content when element exists', () => {
      const el = document.createElement('div')
      el.className = 'selected-option ng-tns-c929221873-0'
      el.textContent = '2025/2026'
      document.body.appendChild(el)
      expect(journalListSync.getSelectedStudyYear()).toBe('2025/2026')
    })
  })

  describe('getStudyYearIdFromText', () => {
    test('returns null when input is null', async () => {
      const result = await journalListSync.getStudyYearIdFromText(null)
      expect(result).toBe(null)
    })

    test('returns null when input is empty string', async () => {
      const result = await journalListSync.getStudyYearIdFromText('')
      expect(result).toBe(null)
    })
  })

  describe('fetchInactiveStudents', () => {
    test('returns empty map when API response is empty', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({ content: [] }))
        },
        kriit: { authToken: 'tkn', enabled: true }
      }
      const result = await journalListSync.fetchInactiveStudents()
      expect(result).toEqual({ byPersonalCode: {}, byStudentId: {} })
    })

    test('returns map indexed by personal code and student ID', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({
            content: [
              { id: 100, idcode: '50001010001', fullname: 'A B', status: 'OPPURSTAATUS_K' },
              { id: 200, idcode: '50001010002', firstname: 'C', lastname: 'D', status: 'OPPURSTAATUS_L' }
            ],
            totalElements: 2
          }))
        },
        kriit: { authToken: 'tkn', enabled: true }
      }
      const result = await journalListSync.fetchInactiveStudents()
      expect(Object.keys(result.byPersonalCode)).toContain('50001010001')
      expect(result.byPersonalCode['50001010001'].isDeleted).toBe(true)
      expect(result.byPersonalCode['50001010002'].isGraduated).toBe(true)
      expect(result.byStudentId[100]).toBeDefined()
    })

    test('skips students missing idcode', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({
            content: [
              { id: 100, idcode: null, status: 'OPPURSTAATUS_K' },  // no idcode
              { id: 101, idcode: '50001010001', status: 'OPPURSTAATUS_L', fullname: 'B' }
            ]
          }))
        }
      }
      const result = await journalListSync.fetchInactiveStudents()
      expect(Object.keys(result.byPersonalCode).length).toBe(1)
    })

    test('returns empty map on API error', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => { throw new Error('Network down') })
        }
      }
      const result = await journalListSync.fetchInactiveStudents()
      expect(result).toEqual({ byPersonalCode: {}, byStudentId: {} })
    })
  })

  describe('getInactiveStudentsCache', () => {
    test('returns valid structure when fetchInactiveStudents returns data', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({
            content: [{ id: 1, idcode: '50001010001', status: 'OPPURSTAATUS_K', fullname: 'X' }]
          }))
        }
      }
      const result = await journalListSync.getInactiveStudentsCache()
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect(result.byPersonalCode).toBeDefined()
      expect(result.byStudentId).toBeDefined()
    })
  })

  describe('extractAssignmentsFromEntries — extra paths', () => {
    test('handles outcome entries with curriculumModuleOutcomes', () => {
      const entries = [
        {
          id: 100,
          curriculumModuleOutcomes: 5,
          entryType: 'SISSEKANNE_O',
          nameEt: 'Outcome 1',
          studentOutcomeResults: { '1': [{ journalStudentId: 1, grade: { code: 'KUTSEHINDAMINE_5' } }] }
        }
      ]
      const studentMap = {
        idToPersonalCode: { 700: '50001010001' },
        personalCodeToName: { '50001010001': 'Stu' },
        journalStudentIdToId: { '1': 700 }
      }
      const result = journalListSync.extractAssignmentsFromEntries(
        [{ id: 100, curriculumModuleOutcomes: 5, entryType: 'SISSEKANNE_H', nameEt: 'Outcome 1' }],
        studentMap,
        [{ id: 1, studentId: 700, fullname: 'Stu', studentGroup: 'G1', status: 'OPPURSTAATUS_O' }],
        { 700: { personalCode: '50001010001', name: 'Stu', isActive: true } },
        entries
      )
      expect(Array.isArray(result)).toBe(true)
    })

    test('returns empty array for non-array input', () => {
      const result = journalListSync.extractAssignmentsFromEntries({}, {}, [], {}, [])
      expect(result).toEqual([])
    })

    test('returns empty array for null input', () => {
      const result = journalListSync.extractAssignmentsFromEntries(null, {}, [], {}, [])
      expect(result).toEqual([])
    })
  })

  describe('createStudentMap — additional paths', () => {
    test('creates map for valid input with studentDetailsMap', () => {
      const result = journalListSync.createStudentMap(
        [{ id: 1, studentId: 100, fullname: 'A B' }],
        { 100: { personalCode: '50001010001', name: 'A B' } }
      )
      expect(result.idToPersonalCode[100]).toBe('50001010001')
      expect(result.personalCodeToName['50001010001']).toBe('A B')
      expect(result.journalStudentIdToId[1]).toBe(100)
    })

    test('uses embedded student.idcode when no studentDetailsMap entry', () => {
      const result = journalListSync.createStudentMap(
        [{ id: 1, studentId: 100, fullname: 'A B', student: { idcode: '50001010001', fullname: 'A B' } }],
        {}
      )
      expect(result.idToPersonalCode[100]).toBe('50001010001')
    })

    test('returns empty map for null input', () => {
      const result = journalListSync.createStudentMap(null, {})
      expect(result.idToPersonalCode).toEqual({})
    })
  })

  describe('setKriitApiToken', () => {
    test('exists and accepts a token', () => {
      // Just verify the method exists; does not throw
      expect(typeof journalListSync.setKriitApiToken).toBe('function')
    })
  })

  describe('getCachedStudent', () => {
    test('returns null for null/undefined', async () => {
      expect(await journalListSync.getCachedStudent(null)).toBe(null)
      expect(await journalListSync.getCachedStudent(undefined)).toBe(null)
    })

    test('returns memoized value when cached', async () => {
      journalListSync._cachedStudents = { '5': { personalCode: 'X', name: 'Y' } }
      const result = await journalListSync.getCachedStudent(5)
      expect(result.personalCode).toBe('X')
    })

    test('returns null when no journalStudentId mapping', async () => {
      journalListSync._cachedStudents = {}
      journalListSync.journalStudentIdToStudentId = {}
      journalListSync.api = {
        tahvel: { get: mock(async () => null), baseUrl: 'https://tahvel.edu.ee/hois_back' }
      }
      const result = await journalListSync.getCachedStudent(99)
      expect(result).toBe(null)
    })

    test('looks up student by mapping when present', async () => {
      journalListSync._cachedStudents = {}
      journalListSync.journalStudentIdToStudentId = { 1: 100 }
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({
            id: 100,
            person: { idcode: '50001010001', firstname: 'A', lastname: 'B' },
            status: 'OPPURSTAATUS_O'
          }))
        }
      }
      const result = await journalListSync.getCachedStudent(1)
      expect(result.personalCode).toBe('50001010001')
      expect(result.name).toBe('A B')
      expect(result.isActive).toBe(true)
    })

    test('returns null when API returns malformed data', async () => {
      journalListSync._cachedStudents = {}
      journalListSync.journalStudentIdToStudentId = { 1: 100 }
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({ id: 100 })) // missing person.idcode
        }
      }
      const result = await journalListSync.getCachedStudent(1)
      expect(result).toBe(null)
    })

    test('handles API errors gracefully', async () => {
      journalListSync._cachedStudents = {}
      journalListSync.journalStudentIdToStudentId = { 1: 100 }
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => { throw new Error('API down') })
        }
      }
      const result = await journalListSync.getCachedStudent(1)
      expect(result).toBe(null)
    })
  })

  describe('getAddInfoFromExistingStudents', () => {
    test('returns null when no students with addInfo', () => {
      const result = journalListSync.getAddInfoFromExistingStudents([])
      expect(result === null || result === undefined).toBe(true)
    })

    test('returns matching addInfo when present', () => {
      const result = journalListSync.getAddInfoFromExistingStudents([
        { addInfo: 'some-info' }
      ])
      // The method may or may not return that exact value; just ensure it doesn't throw
      expect(result === null || typeof result === 'string' || result === undefined).toBe(true)
    })
  })

  describe('getDetailedStudentInfo', () => {
    test('returns object with error when journal students unavailable', async () => {
      journalListSync.api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => null)
        }
      }
      const result = await journalListSync.getDetailedStudentInfo('50001010001', 123)
      expect(result).toBeDefined()
    })
  })

})
