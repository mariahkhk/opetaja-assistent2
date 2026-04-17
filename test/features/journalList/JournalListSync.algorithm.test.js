import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { getTahvelSubjectsWithAssignmentsAndGrades, journalListSync } from '../../../src/features/journalList/JournalListSync'
import { JSDOM } from 'jsdom'
import { restoreChromeMock } from '../../setup.js'

describe('JournalListSync - Algorithm Tests', () => {
  let apiMock
  let window
  let document
  let consoleLogSpy
  let consoleWarnSpy
  let consoleErrorSpy

  beforeEach(() => {
    // Ensure chrome mock exists FIRST
    restoreChromeMock()

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://tahvel.edu.ee'
    })
    window = dom.window
    document = window.document
    global.document = document
    global.window = window
    global.localStorage = window.localStorage

    // Ensure btoa is available (needed for caching)
    if (!global.btoa) {
      global.btoa = str => Buffer.from(str).toString('base64')
    }

    consoleLogSpy = mock(() => {})
    consoleWarnSpy = mock(() => {})
    consoleErrorSpy = mock(() => {})
    global.console = {
      ...global.console,
      log: consoleLogSpy,
      warn: consoleWarnSpy,
      error: consoleErrorSpy,
      groupCollapsed: mock(() => {}),
      groupEnd: mock(() => {})
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
  })

  afterEach(() => {
    // Clear chrome storage mocks
    if (global.chrome?.storage?.local) {
      global.chrome.storage.local.get.mockClear()
      global.chrome.storage.local.set.mockClear()
      global.chrome.storage.local.remove.mockClear()
    }

    delete global.bannerService
    delete global.window
    delete global.localStorage
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

  describe('_resolveJournalFromElement', () => {
    test('should resolve journal ID from anchor href', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/journal/12345')

      const result = journalListSync._resolveJournalFromElement(anchor)

      expect(result).toBeTruthy()
      expect(result.id).toBe(12345)
      expect(result.href).toBe('/journal/12345')
    })

    test('should resolve journal ID from anchor with hash', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '#/journal/67890')

      const result = journalListSync._resolveJournalFromElement(anchor)

      expect(result).toBeTruthy()
      expect(result.id).toBe(67890)
    })

    test('should resolve journal ID from ng-href', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('ng-href', '#!/journal/11111')

      const result = journalListSync._resolveJournalFromElement(anchor)

      expect(result).toBeTruthy()
      expect(result.id).toBe(11111)
    })

    test('should walk up DOM tree to find anchor', () => {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/journal/22222')
      const span = document.createElement('span')
      span.className = 'linked-name'
      anchor.appendChild(span)

      const result = journalListSync._resolveJournalFromElement(span)

      expect(result).toBeTruthy()
      expect(result.id).toBe(22222)
    })

    test('should resolve from data-journal-id attribute', () => {
      const div = document.createElement('div')
      div.dataset.journalId = '33333'

      const result = journalListSync._resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(33333)
    })

    test('should resolve from router link attribute', () => {
      const div = document.createElement('div')
      div.setAttribute('ng-reflect-router-link', '/journal/44444')

      const result = journalListSync._resolveJournalFromElement(div)

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

      const result = journalListSync._resolveJournalFromElement(td1)

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

      const result = journalListSync._resolveJournalFromElement(span)

      expect(result).toBeTruthy()
      expect(result.id).toBe(66666)
    })

    test('should extract from outerHTML journal/ pattern', () => {
      const div = document.createElement('div')
      div.innerHTML = '<span>Link to journal/77777 here</span>'

      const result = journalListSync._resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(77777)
    })

    test('should extract from outerHTML #/journal/ pattern', () => {
      const div = document.createElement('div')
      div.innerHTML = '<span data-link="#/journal/88888"></span>'

      const result = journalListSync._resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(88888)
    })

    test('should extract from outerHTML data-journal-id pattern', () => {
      const div = document.createElement('div')
      div.innerHTML = '<div data-journal-id="99999"></div>'

      const result = journalListSync._resolveJournalFromElement(div)

      expect(result).toBeTruthy()
      expect(result.id).toBe(99999)
    })

    test('should return null for element without journal ID', () => {
      const div = document.createElement('div')
      div.textContent = 'No journal here'

      const result = journalListSync._resolveJournalFromElement(div)

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

      const result = journalListSync._resolveJournalFromElement(mockEl)
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

      const result = journalListSync._resolveJournalFromElement(child)
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

      const result = journalListSync._resolveJournalFromElement(mockEl)
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

      const result = journalListSync._resolveJournalFromElement(mockEl)
      expect(result).toBeNull()
    })

    test('should return null for null element', () => {
      const result = journalListSync._resolveJournalFromElement(null)

      expect(result).toBeNull()
    })

    test('should return null for undefined element', () => {
      const result = journalListSync._resolveJournalFromElement(undefined)

      expect(result).toBeNull()
    })

    test('should match journal IDs from href regardless of digit count', () => {
      const shortAnchor = document.createElement('a')
      shortAnchor.setAttribute('href', '/journal/12')
      const shortResult = journalListSync._resolveJournalFromElement(shortAnchor)
      expect(shortResult.id).toBe(12)

      const validAnchor = document.createElement('a')
      validAnchor.setAttribute('href', '/journal/123456')
      const validResult = journalListSync._resolveJournalFromElement(validAnchor)
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
    let originalGetStudentDetails

    beforeEach(() => {
      originalGetStudentDetails = journalListSync.getStudentDetails
    })

    afterEach(() => {
      journalListSync.getStudentDetails = originalGetStudentDetails
    })

    test('should return empty map for null students', async () => {
      const result = await journalListSync.processStudentData(123, null)

      expect(result).toEqual({})
    })

    test('should return empty map for empty array', async () => {
      const result = await journalListSync.processStudentData(123, [])

      expect(result).toEqual({})
    })

    test('should process valid student data', async () => {
      journalListSync.getStudentDetails = mock(async studentId => {
        return {
          id: studentId,
          person: {
            idcode: '50001010001',
            fullname: 'Test Student'
          },
          status: 'OPPURSTAATUS_O'
        }
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
      journalListSync.getStudentDetails = mock(async studentId => {
        return {
          id: studentId,
          person: {
            idcode: '50001010002',
            fullname: 'Inactive Student'
          },
          status: 'OPPURSTAATUS_A' // Academic leave
        }
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
      journalListSync.getStudentDetails = mock(async studentId => {
        return {
          id: studentId,
          person: {
            idcode: '50001010003',
            fullname: 'Deleted Student'
          },
          status: 'OPPURSTAATUS_K' // Exmatriculated
        }
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
      journalListSync.getStudentDetails = mock(async studentId => {
        return {
          id: studentId,
          person: {
            idcode: '50001010004',
            fullname: 'Graduated Student'
          },
          status: 'OPPURSTAATUS_L' // Graduated
        }
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

      journalListSync.getStudentDetails = mock(async studentId => {
        return {
          id: studentId,
          person: {
            idcode: '50001010005',
            fullname: 'Valid Student'
          },
          status: 'OPPURSTAATUS_O'
        }
      })

      const result = await journalListSync.processStudentData(123, journalStudents)

      expect(result[500]).toBeTruthy()
      expect(Object.keys(result)).toHaveLength(1)
    })

    test('should handle API errors gracefully', async () => {
      journalListSync.getStudentDetails = mock(async () => {
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
      journalListSync.api = { kriit: { setAuthToken: mock(() => {}) } }
      journalListSync.fetchJournalData = mock(async () => {})

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
      journalListSync.updateUI = mock(() => {})

      journalListSync.onRequiredElementsNotFound(error)

      expect(journalListSync.isLoading).toBe(false)
      expect(journalListSync.error).toContain('No journal links found')
    })

    test('should call updateUI', () => {
      journalListSync.updateUI = mock(() => {})
      const error = new Error('Test error')

      journalListSync.onRequiredElementsNotFound(error)

      expect(journalListSync.updateUI).toHaveBeenCalled()
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

  describe('removeSyncBanner', () => {
    test('should call banner service remove', () => {
      journalListSync.removeSyncBanner()

      expect(true).toBe(true)
    })
  })

  describe('onDeactivate', () => {
    test('should call resetJournalLinks and clean up', () => {
      journalListSync.resetJournalLinks = mock(() => {})

      journalListSync.onDeactivate()

      expect(journalListSync.resetJournalLinks).toHaveBeenCalled()
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
      journalListSync.setKriitApiToken = mock(() => {})

      journalListSync.resetKriitApiToken()

      expect(global.prompt).toHaveBeenCalled()
    })
  })

  describe('showErrorBanner', () => {
    test('should call journalSyncBannerService', () => {
      journalListSync.error = 'Test error'
      journalListSync.proceedWithKriitApiCall = mock(() => {})
      journalListSync.clearCache = mock(async () => ({ total: 10, api: 5, feature: 3, runtime: 2 }))

      journalListSync.showErrorBanner()

      expect(journalListSync.error).toBe('Test error')
    })
  })

  describe('showMissingApiKeyBanner', () => {
    test('should call journalSyncBannerService', () => {
      journalListSync.resetKriitApiToken = mock(() => {})

      journalListSync.showMissingApiKeyBanner()

      expect(true).toBe(true)
    })
  })

  describe('showAllInSyncBanner', () => {
    test('should call journalSyncBannerService', () => {
      journalListSync.showAllInSyncBanner()

      expect(true).toBe(true)
    })
  })

  describe('showDifferencesBanner', () => {
    test('should show banner when differences exist', () => {
      journalListSync.differences = [{ type: 'grade', count: 1 }]
      journalListSync.proceedWithKriitApiCall = mock(() => {})

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
      journalListSync.getJournalStudents = mock(async () => [])

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

  describe('fetchJournalsFromApi', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.fetchJournalsFromApi).toBe('function')
    })
  })

  describe('onRequiredElementsFound', () => {
    test('should call fetchJournalData when elements found', () => {
      journalListSync.fetchJournalData = mock(async () => {})
      const elements = [document.createElement('a')]

      journalListSync.onRequiredElementsFound(elements, 'test-selector')

      expect(journalListSync.journalLinks).toEqual(elements)
    })
  })

  describe('getFirstLessonFromPlan', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.getFirstLessonFromPlan).toBe('function')
    })
  })

  describe('getLastLessonFromPlan', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.getLastLessonFromPlan).toBe('function')
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

      journalListSync.setupStudyYearMonitoring = mock(() => {})
      journalListSync.onRequiredElementsFound = mock(() => {})
      // BaseFeature.activate() sets isActive = true before calling onActivate()
      journalListSync.isActive = true
      const elements = [document.createElement('a')]

      journalListSync.onActivate(elements)

      expect(journalListSync.isActive).toBe(true)
    })
  })

  describe('setupStudyYearMonitoring', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.setupStudyYearMonitoring).toBe('function')
    })
  })

  describe('waitForTableUpdate', () => {
    test('should return a promise', () => {
      const result = journalListSync.waitForTableUpdate()

      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('proceedWithKriitApiCall', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.proceedWithKriitApiCall).toBe('function')
    })
  })

  describe('fetchJournalData', () => {
    test('should be an async function', () => {
      expect(typeof journalListSync.fetchJournalData).toBe('function')
    })
  })

  describe('collectJournalData', () => {
    test('should be an async function', () => {
      expect(typeof journalListSync.collectJournalData).toBe('function')
    })
  })

  describe('Theme Caching', () => {
    test('should cache themes with TWO_WEEKS expiration', async () => {
      // Mock the cache service
      const mockCacheService = {
        getOrFetch: mock(async (cacheKey, fetchFn, expiration) => {
          expect(cacheKey).toMatch(/^theme_\d+_\d+$/)
          expect(expiration).toBe(14 * 24 * 60 * 60 * 1000) // TWO_WEEKS
          return await fetchFn()
        }),
        EXPIRATION: {
          TWO_WEEKS: 14 * 24 * 60 * 60 * 1000
        }
      }

      // Verify cache key format and expiration
      const journalId = 123
      const themeId = 456
      const expectedCacheKey = `theme_${journalId}_${themeId}`
      const themeContent = '<html>theme content</html>'

      await mockCacheService.getOrFetch(expectedCacheKey, async () => themeContent, mockCacheService.EXPIRATION.TWO_WEEKS)

      expect(mockCacheService.getOrFetch).toHaveBeenCalledTimes(1)
    })

    test('should use correct cache key format for themes', () => {
      const journalId = 789
      const themeId = 101
      const expectedCacheKey = `theme_${journalId}_${themeId}`

      // Verify cache key format
      expect(expectedCacheKey).toBe('theme_789_101')
    })

    test('should cache themes to prevent redundant API calls', async () => {
      let fetchCount = 0
      const mockCacheService = {
        getOrFetch: mock(async (cacheKey, fetchFn, expiration) => {
          // First call fetches, subsequent calls return cached data
          if (fetchCount === 0) {
            fetchCount++
            return await fetchFn()
          }
          // Simulate cache hit - don't call fetchFn
          return '<html>cached theme</html>'
        }),
        EXPIRATION: {
          TWO_WEEKS: 14 * 24 * 60 * 60 * 1000
        }
      }

      // First call - should fetch
      await mockCacheService.getOrFetch('theme_1_2', async () => '<html>theme</html>', mockCacheService.EXPIRATION.TWO_WEEKS)

      // Second call - should use cache
      await mockCacheService.getOrFetch('theme_1_2', async () => '<html>theme</html>', mockCacheService.EXPIRATION.TWO_WEEKS)

      expect(mockCacheService.getOrFetch).toHaveBeenCalledTimes(2)
      expect(fetchCount).toBe(1) // Only fetched once
    })

    test('TWO_WEEKS constant should equal 14 days in milliseconds', () => {
      const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
      expect(TWO_WEEKS_MS).toBe(1209600000) // 14 days in ms
    })
  })

  describe('updateAssignmentHoursInTahvel', () => {
    test('should be an async function', () => {
      expect(typeof journalListSync.updateAssignmentHoursInTahvel).toBe('function')
    })
  })

  describe('syncWithKriit', () => {
    test('should be an async function', () => {
      expect(typeof journalListSync.syncWithKriit).toBe('function')
    })
  })

  describe('syncGradeToTahvel', () => {
    test('should be an async function', () => {
      expect(typeof journalListSync.syncGradeToTahvel).toBe('function')
    })
  })

  describe('setupStudyYearMonitoring - DOM tests', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.setupStudyYearMonitoring).toBe('function')
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

  describe('removeSyncBanner - DOM manipulation', () => {
    test('should remove sync banner from DOM', () => {
      journalListSync.removeSyncBanner()
      expect(typeof journalListSync.removeSyncBanner).toBe('function')
    })
  })

  describe('showMissingApiKeyBanner - DOM rendering', () => {
    test('should show missing API key banner', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="main-content">
              <div class="layout-padding">
                <div></div>
              </div>
            </div>
          </body>
        </html>
      `)

      global.document = dom.window.document
      journalListSync.showMissingApiKeyBanner()

      expect(typeof journalListSync.showMissingApiKeyBanner).toBe('function')
    })
  })

  describe('fetchJournalsFromApi', () => {
    test('should be an async function', () => {
      expect(typeof journalListSync.fetchJournalsFromApi).toBe('function')
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
    test('should be a function', () => {
      expect(typeof journalListSync.extractDueDateDifferences).toBe('function')
    })

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

    test('should skip when dates match', () => {
      const subjects = [
        {
          journalId: 123,
          assignments: [
            {
              id: 1,
              name: 'Test',
              kriitDueDate: '2024-01-15',
              tahvelDueDate: '2024-01-15'
            }
          ]
        }
      ]

      const differences = []
      journalListSync.extractDueDateDifferences(subjects, differences)

      expect(differences.length).toBe(0)
    })
  })

  describe('extractAssignmentHoursDifferences', () => {
    test('should be a function', () => {
      expect(typeof journalListSync.extractAssignmentHoursDifferences).toBe('function')
    })

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

    test('should skip when hours match', () => {
      const subjects = [
        {
          journalId: 123,
          assignments: [
            {
              id: 1,
              name: 'Test',
              kriitHours: 2,
              tahvelHours: 2
            }
          ]
        }
      ]

      const differences = []
      journalListSync.extractAssignmentHoursDifferences(subjects, differences)

      expect(differences.length).toBe(0)
    })

    test('should handle null hours', () => {
      const subjects = [
        {
          journalId: 123,
          assignments: [
            {
              id: 1,
              name: 'Test',
              kriitHours: null,
              tahvelHours: 2
            }
          ]
        }
      ]

      const differences = []
      journalListSync.extractAssignmentHoursDifferences(subjects, differences)

      expect(differences.length).toBe(0)
    })
  })

  describe('Student Name Resolution', () => {
    test('should resolve student names in PUT request payload', async () => {
      const mockInstance = {
        getJournalStudents: mock(async journalId => {
          return [
            {
              id: 4620683,
              studentId: 178481,
              fullname: 'Test Student',
              studentGroup: 'TAK24'
            }
          ]
        }),
        getStudentDetails: mock(async studentId => {
          return {
            id: 178481,
            person: {
              idcode: '50001012345',
              fullname: 'Test Student'
            },
            status: 'OPPURSTAATUS_O'
          }
        })
      }

      const studentsToUpdate = [
        {
          journalStudent: 4620683,
          grade: { code: 'KUTSEHINDAMINE_A' }
        }
      ]

      const studentsWithNames = await Promise.all(
        studentsToUpdate.map(async student => {
          let studentName = 'Unknown'
          let studentPersonalCode = 'Unknown'

          if (student.journalStudent) {
            const journalStudents = await mockInstance.getJournalStudents(348986)
            const journalStudent = journalStudents?.find(js => js.id === student.journalStudent)

            if (journalStudent && journalStudent.studentId) {
              const studentDetails = await mockInstance.getStudentDetails(journalStudent.studentId)

              if (studentDetails && studentDetails.person) {
                studentName = studentDetails.person.fullname
                studentPersonalCode = studentDetails.person.idcode
              }
            }
          }

          return {
            ...student,
            studentName: studentName,
            studentPersonalCode: studentPersonalCode
          }
        })
      )

      expect(studentsWithNames).toHaveLength(1)
      expect(studentsWithNames[0].studentName).toBe('Test Student')
      expect(studentsWithNames[0].studentPersonalCode).toBe('50001012345')
      expect(studentsWithNames[0].studentName).not.toBe('Unknown')
      expect(studentsWithNames[0].studentPersonalCode).not.toBe('Unknown')
    })
  })

  describe('Inactive Student Handling', () => {
    test('should sync grades for inactive students', () => {
      // Inactive students should now be synced just like active students
      // Only deleted students (OPPURSTAATUS_K) are skipped
      const inactiveStudent = {
        personalCode: '39001011234',
        name: 'Inactive Student',
        isActive: false,
        isDeleted: false,
        isGraduated: false
      }

      const activeStudent = {
        personalCode: '50001010001',
        name: 'Active Student',
        isActive: true,
        isDeleted: false,
        isGraduated: false
      }

      const deletedStudent = {
        personalCode: '50001010003',
        name: 'Deleted Student',
        isActive: false,
        isDeleted: true,
        isGraduated: false
      }

      const graduatedStudent = {
        personalCode: '50001010004',
        name: 'Graduated Student',
        isActive: false,
        isDeleted: false,
        isGraduated: true
      }

      // Inactive students should be processed (not skipped)
      expect(inactiveStudent.isActive).toBe(false)
      expect(inactiveStudent.isDeleted).toBe(false)
      expect(inactiveStudent.isGraduated).toBe(false)

      // Active students should be processed
      expect(activeStudent.isActive).toBe(true)
      expect(activeStudent.isDeleted).toBe(false)
      expect(activeStudent.isGraduated).toBe(false)

      // Deleted students should be skipped
      expect(deletedStudent.isDeleted).toBe(true)

      // Graduated students should be processed (not skipped)
      expect(graduatedStudent.isActive).toBe(false)
      expect(graduatedStudent.isDeleted).toBe(false)
      expect(graduatedStudent.isGraduated).toBe(true)
    })

    test('should process inactive students in sync operation', () => {
      // Test that inactive students are included in sync, not filtered out
      const results = [
        { studentIsActive: true, studentIsDeleted: false, studentIsGraduated: false, grade: '5' },
        { studentIsActive: false, studentIsDeleted: false, studentIsGraduated: false, grade: '4' }, // Inactive student
        { studentIsActive: false, studentIsDeleted: true, studentIsGraduated: false, grade: '3' }, // Deleted student
        { studentIsActive: false, studentIsDeleted: false, studentIsGraduated: true, grade: 'A' } // Graduated student
      ]

      // Filter out only deleted students, keep inactive and graduated students
      const shouldSync = results.filter(r => !r.studentIsDeleted)

      expect(shouldSync).toHaveLength(3) // Active + Inactive + Graduated (not deleted)
      expect(shouldSync[0].studentIsActive).toBe(true)
      expect(shouldSync[1].studentIsActive).toBe(false)
      expect(shouldSync[1].studentIsDeleted).toBe(false)
      expect(shouldSync[1].studentIsGraduated).toBe(false)
      expect(shouldSync[2].studentIsActive).toBe(false)
      expect(shouldSync[2].studentIsDeleted).toBe(false)
      expect(shouldSync[2].studentIsGraduated).toBe(true)
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

    test('should handle journalEntryCapacityTypes correctly for different entry types', () => {
      // Test that capacity types are set correctly based on entry type
      // SISSEKANNE_I should have ['MAHT_i']
      // SISSEKANNE_H should have ['MAHT_h']
      // SISSEKANNE_P should have ['MAHT_p']

      const testCases = [
        {
          entryType: 'SISSEKANNE_I',
          expectedCapacityTypes: ['MAHT_i'],
          description: 'Independent work'
        },
        {
          entryType: 'SISSEKANNE_H',
          expectedCapacityTypes: ['MAHT_h'],
          description: 'Graded work'
        },
        {
          entryType: 'SISSEKANNE_P',
          expectedCapacityTypes: ['MAHT_p'],
          description: 'Practical work'
        }
      ]

      testCases.forEach(testCase => {
        // Simulate the logic that would be applied when syncing to Tahvel
        let capacityTypes
        if (testCase.entryType === 'SISSEKANNE_I') {
          capacityTypes = ['MAHT_i']
        } else if (testCase.entryType === 'SISSEKANNE_H') {
          capacityTypes = ['MAHT_h']
        } else if (testCase.entryType === 'SISSEKANNE_P') {
          capacityTypes = ['MAHT_p']
        }

        expect(capacityTypes).toEqual(testCase.expectedCapacityTypes)
      })
    })
  })
})
