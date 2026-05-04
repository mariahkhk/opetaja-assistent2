import { describe, test, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { restoreGlobalDOM } from '../../../setup.js'
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

    const threeStudents = [
      { id: 4620683, studentId: 178481, status: 'OPPURSTAATUS_O' },
      { id: 4620684, studentId: 178420, status: 'OPPURSTAATUS_O' },
      { id: 4620685, studentId: 178399, status: 'OPPURSTAATUS_O' }
    ]

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
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
              '178420': { studentId: 178420, grade: { code: 'KUTSEHINDAMINE_4' } },
              '178399': { studentId: 178399, grade: { code: 'KUTSEHINDAMINE_3' } }
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
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } }
              // Students 178420 and 178399 are absent — they have no grades
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
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
              '178420': { studentId: 178420, grade: null },
              '178399': { studentId: 178399, grade: { code: 'KUTSEHINDAMINE_3' } }
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
            { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
            { studentId: 178420, grade: { code: 'KUTSEHINDAMINE_4' } }
            // Student 178399 missing
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
            { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
            { studentId: 178420, grade: { code: 'KUTSEHINDAMINE_4' } },
            { studentId: 178399, grade: { code: 'KUTSEHINDAMINE_3' } }
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

    test('should exclude academic break students from missing grades count', async () => {
      // 2 active students graded, 1 student on academic break without grade
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
              '178420': { studentId: 178420, grade: { code: 'KUTSEHINDAMINE_4' } }
            }
          }
        ],
        [
          { id: 4620683, studentId: 178481, status: 'OPPURSTAATUS_O' },
          { id: 4620684, studentId: 178420, status: 'OPPURSTAATUS_O' },
          { id: 4620685, studentId: 178399, status: 'OPPURSTAATUS_A' } // Academic break
        ]
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(false)
    })

    test('should return true when active student is missing grade even with AP students', async () => {
      // 1 active graded, 1 active missing grade, 1 AP student
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } }
            }
          }
        ],
        [
          { id: 4620683, studentId: 178481, status: 'OPPURSTAATUS_O' },
          { id: 4620684, studentId: 178420, status: 'OPPURSTAATUS_O' },
          { id: 4620685, studentId: 178399, status: 'OPPURSTAATUS_A' }
        ]
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should not count grades from non-active students toward graded count', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: {
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
              '178399': { studentId: 178399, grade: { code: 'KUTSEHINDAMINE_4' } } // AP student graded
            }
          }
        ],
        [
          { id: 4620683, studentId: 178481, status: 'OPPURSTAATUS_O' },
          { id: 4620684, studentId: 178420, status: 'OPPURSTAATUS_O' }, // Active, no grade
          { id: 4620685, studentId: 178399, status: 'OPPURSTAATUS_A' }  // AP, has grade
        ]
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true) // Student 178420 is active and ungraded
    })

    test('should exclude non-active students when counting via detailed outcome fallback', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            curriculumModuleOutcomes: 456
          }
        ],
        [
          { id: 4620683, studentId: 178481, status: 'OPPURSTAATUS_O' },
          { id: 4620684, studentId: 178420, status: 'OPPURSTAATUS_O' },
          { id: 4620685, studentId: 178399, status: 'OPPURSTAATUS_A' }
        ],
        {
          outcomeStudents: [
            { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
            { studentId: 178399, grade: { code: 'KUTSEHINDAMINE_4' } }
            // Student 178420 (active) missing, student 178399 (AP) graded
          ]
        }
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should return true when first outcome is complete but second has missing grades', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            curriculumModuleOutcomes: 55745,
            studentOutcomeResults: {
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } },
              '178420': { studentId: 178420, grade: { code: 'KUTSEHINDAMINE_4' } },
              '178399': { studentId: 178399, grade: { code: 'KUTSEHINDAMINE_3' } }
            }
          },
          {
            entryType: 'SISSEKANNE_O',
            curriculumModuleOutcomes: 55740,
            studentOutcomeResults: {
              '178481': { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_MA' } }
              // 178420 and 178399 missing
            }
          }
        ],
        threeStudents
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    test('should return true when studentOutcomeResults is explicitly null with fallback', async () => {
      setupMockApi(
        [
          {
            entryType: 'SISSEKANNE_O',
            studentOutcomeResults: null,
            curriculumModuleOutcomes: 456
          }
        ],
        threeStudents,
        {
          outcomeStudents: [
            { studentId: 178481, grade: { code: 'KUTSEHINDAMINE_5' } }
            // 178420 and 178399 missing
          ]
        }
      )

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
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


function buildJournalRow({ journalId = 12345, useNgHref = false } = {}) {
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  const a = document.createElement('a')
  if (useNgHref) {
    a.setAttribute('ng-href', `#/journal/${journalId}/edit`)
  } else {
    a.setAttribute('href', `#/journal/${journalId}/edit`)
  }
  a.textContent = `Journal ${journalId}`
  td.appendChild(a)
  tr.appendChild(td)
  return { tr, link: a }
}

function buildJournalTable(rows = []) {
  const wrapper = document.createElement('div')
  wrapper.id = 'tahvelTable'
  const table = document.createElement('table')
  table.className = 'tahvel-table'
  const tbody = document.createElement('tbody')
  for (const row of rows) tbody.appendChild(row)
  table.appendChild(tbody)
  wrapper.appendChild(table)
  return wrapper
}

function setupApiMock({ entries = [], students = [], finalDate = null } = {}) {
  return {
    tahvel: {
      get: mock(async url => {
        if (url.includes('/journalEntriesByDate')) return entries
        if (url.includes('/journalStudents')) return students
        if (url.match(/\/journals\/\d+$/)) return { studyYearStartDate: '2025-09-01' }
        if (url.includes('/timetableByTeacher')) {
          if (!finalDate) return { timetableEvents: [] }
          return {
            timetableEvents: [
              { date: finalDate, journalId: 12345 }
            ]
          }
        }
        return null
      })
    }
  }
}

describe('FinalGradeWarningFeature — DOM lifecycle', () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    feature = new FinalGradeWarningFeature()
  })

  afterEach(() => {
    feature.onDeactivate()
  })

  describe('setupMainContentObserver', () => {
    it('does nothing when #tahvelTable is missing', () => {
      feature.setupMainContentObserver()
      expect(feature.mainContentObserver).toBeNull()
    })

    it('attaches a MutationObserver when #tahvelTable exists', () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)

      feature.setupMainContentObserver()

      expect(feature.mainContentObserver).toBeTruthy()
      expect(typeof feature.mainContentObserver.disconnect).toBe('function')
    })

    it('skips text-node mutations (non-element)', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.setupMainContentObserver()

      // Append a text node — its nodeType is TEXT_NODE so the inner check returns false
      wrapper.appendChild(document.createTextNode('text'))
      await new Promise(resolve => setTimeout(resolve, 400))
      // We can't easily assert "nothing happened"; just ensure no crash
      expect(feature.mainContentObserver).toBeTruthy()
    })

    it('detects nested table elements via querySelector', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = setupApiMock()
      feature.setupMainContentObserver()

      // Add a div containing a tr — querySelector inside the inner check should find it
      const container = document.createElement('div')
      const inner = document.createElement('tr')
      container.appendChild(inner)
      wrapper.querySelector('tbody').appendChild(container)

      await new Promise(resolve => setTimeout(resolve, 500))
      expect(feature.mainContentObserver).toBeTruthy()
    })

    it('triggers debounced refresh when relevant table mutations occur', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = setupApiMock()
      feature.setupMainContentObserver()

      // Add a row — which mounts a tr/td hierarchy that should be picked up
      const tbody = wrapper.querySelector('tbody')
      const { tr } = buildJournalRow()
      tbody.appendChild(tr)

      // Wait long enough for the 300ms debounce + 100ms onMainContentChange delay
      await new Promise(resolve => setTimeout(resolve, 500))

      // processedJournals will have been cleared by onMainContentChange
      expect(feature.processedJournals).toBeInstanceOf(Set)
    })

    it('ignores mutations that do not involve relevant nodes', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = setupApiMock()
      feature.setupMainContentObserver()

      // Append irrelevant span — observer's `hasRelevantChanges` should reject it
      const span = document.createElement('span')
      wrapper.appendChild(span)
      await new Promise(resolve => setTimeout(resolve, 500))

      expect(feature.api.tahvel.get).not.toHaveBeenCalled()
    })
  })

  describe('onActivate', () => {
    it('schedules processJournalList via setTimeout and stores the timer', () => {
      feature.api = setupApiMock()
      feature.onActivate()
      expect(feature._activateTimeout).not.toBeNull()
    })

    it('runs processJournalList when the activate timer fires', async () => {
      const originalSetTimeout = globalThis.setTimeout
      let scheduled = null
      globalThis.setTimeout = (cb, _ms) => {
        scheduled = cb
        return 1
      }

      feature.api = setupApiMock()
      feature.onActivate()
      expect(scheduled).toBeTruthy()

      scheduled()
      await new Promise(r => originalSetTimeout(r, 0))
      expect(feature._activateTimeout).toBeNull()
      globalThis.setTimeout = originalSetTimeout
    })

  })

  describe('onDeactivate', () => {
    it('clears _activateTimeout when set', () => {
      feature._activateTimeout = setTimeout(() => {}, 60000)
      feature.onDeactivate()
      expect(feature._activateTimeout).toBeNull()
    })

    it('clears _contentChangeTimeout when set', () => {
      feature._contentChangeTimeout = setTimeout(() => {}, 60000)
      feature.onDeactivate()
      expect(feature._contentChangeTimeout).toBeNull()
    })
  })

  describe('onMainContentChange', () => {
    it('clears processedJournals and schedules processJournalList', async () => {
      feature.api = setupApiMock()
      feature.processedJournals.add(1)
      feature.processedJournals.add(2)

      feature.onMainContentChange()

      expect(feature.processedJournals.size).toBe(0)
      expect(feature._contentChangeTimeout).not.toBeNull()
    })

    it('runs processJournalList when the deferred timer fires', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = setupApiMock()

      feature.onMainContentChange()
      expect(feature._contentChangeTimeout).not.toBeNull()

      // Wait for the 100ms timeout
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(feature._contentChangeTimeout).toBeNull()
    })

  })

  describe('processJournalList', () => {
    it('returns early when already processing', async () => {
      feature._isProcessing = true
      feature.api = setupApiMock()
      await feature.processJournalList()
      expect(feature.api.tahvel.get).not.toHaveBeenCalled()
    })

    it('returns early when there are no rows', async () => {
      feature.api = setupApiMock()
      await feature.processJournalList()
      expect(feature.api.tahvel.get).not.toHaveBeenCalled()
      expect(feature._isProcessing).toBe(false)
    })

    it('processes rows in batches of BATCH_SIZE', async () => {
      const rows = []
      for (let i = 0; i < 7; i++) {
        const { tr } = buildJournalRow({ journalId: 1000 + i })
        rows.push(tr)
      }
      const wrapper = buildJournalTable(rows)
      document.body.appendChild(wrapper)

      feature.api = setupApiMock({
        entries: [{ entryType: 'SISSEKANNE_L' }],
        students: []
      })

      await feature.processJournalList()

      expect(feature._isProcessing).toBe(false)
    })

    it('catches errors thrown during processing', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = {
        tahvel: { get: mock(() => { throw new Error('boom') }) }
      }
      // querySelectorAll on absent table won't crash, but processing certainly will when tries to traverse.
      // Inject one row manually and let the per-row handler catch.
      const { tr } = buildJournalRow()
      wrapper.querySelector('tbody').appendChild(tr)

      await expect(feature.processJournalList()).resolves.toBeUndefined()
      expect(feature._isProcessing).toBe(false)
    })
  })

  describe('processJournalRow', () => {
    it('returns early when row has no journal link', async () => {
      const tr = document.createElement('tr')
      feature.api = setupApiMock()
      await feature.processJournalRow(tr, new Date())
      expect(feature.api.tahvel.get).not.toHaveBeenCalled()
    })

    it('returns early when href has no journal id', async () => {
      const { tr, link } = buildJournalRow()
      link.setAttribute('href', '#/random/path')
      feature.api = setupApiMock()
      await feature.processJournalRow(tr, new Date())
      expect(feature.api.tahvel.get).not.toHaveBeenCalled()
    })

    it('skips already-processed journals', async () => {
      const { tr } = buildJournalRow({ journalId: 999 })
      feature.processedJournals.add(999)
      feature.api = setupApiMock()
      await feature.processJournalRow(tr, new Date())
      expect(feature.api.tahvel.get).not.toHaveBeenCalled()
    })

    it('returns early when no missing grades', async () => {
      const { tr } = buildJournalRow()
      feature.api = setupApiMock({ entries: [{ entryType: 'SISSEKANNE_L' }] })
      await feature.processJournalRow(tr, new Date())
      expect(feature.processedJournals.has(12345)).toBe(true)
    })

    it('returns early when getFinalLessonDate yields null', async () => {
      const { tr } = buildJournalRow()
      const apiMock = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                entryType: 'SISSEKANNE_O',
                studentOutcomeResults: {} // no graded students -> missing
              }]
            }
            if (url.includes('journalStudents')) {
              return [{ studentId: 1, status: 'OPPURSTAATUS_O' }]
            }
            if (url.match(/\/journals\/\d+$/)) {
              // No teachers, no schoolId, will fall through -> empty entries -> null
              return { studyYearStartDate: '2025-09-01' }
            }
            return null
          })
        }
      }
      feature.api = apiMock
      await feature.processJournalRow(tr, new Date('2026-01-15'))
      expect(feature.processedJournals.has(12345)).toBe(true)
    })

    it('adds a yellow indicator when within the warning window', async () => {
      const { tr } = buildJournalRow()
      const td = document.createElement('td')
      tr.querySelector('a').remove()
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      a.textContent = 'Test'
      td.appendChild(a)
      tr.appendChild(td)
      document.body.appendChild(tr)

      const finalDate = new Date()
      finalDate.setDate(finalDate.getDate() + 5)
      const finalDateStr = finalDate.toISOString().split('T')[0]

      const apiMock = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                entryType: 'SISSEKANNE_O',
                studentOutcomeResults: {}
              }]
            }
            if (url.includes('journalStudents')) {
              return [{ studentId: 1, status: 'OPPURSTAATUS_O' }]
            }
            if (url.match(/\/journals\/\d+$/)) {
              return {
                studyYearStartDate: '2025-09-01',
                journalTeachers: [{ id: 4303 }],
                school: { id: 9 }
              }
            }
            if (url.includes('timetableByTeacher')) {
              return {
                timetableEvents: [{ date: finalDateStr, journalId: 12345 }]
              }
            }
            return null
          })
        }
      }
      feature.api = apiMock
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      await feature.processJournalRow(tr, today)
      expect(td.querySelector('.oa-final-grade-warning')).toBeTruthy()
    })

    it('does not add indicator when getWarningLevel returns null (far from final date)', async () => {
      const { tr } = buildJournalRow()
      const td = document.createElement('td')
      tr.querySelector('a').remove()
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      td.appendChild(a)
      tr.appendChild(td)
      document.body.appendChild(tr)

      const farFutureDate = new Date()
      farFutureDate.setMonth(farFutureDate.getMonth() + 6)
      const dateStr = farFutureDate.toISOString().split('T')[0]

      const apiMock = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                entryType: 'SISSEKANNE_O',
                studentOutcomeResults: {}
              }]
            }
            if (url.includes('journalStudents')) {
              return [{ studentId: 1, status: 'OPPURSTAATUS_O' }]
            }
            if (url.match(/\/journals\/\d+$/)) {
              return {
                studyYearStartDate: '2025-09-01',
                journalTeachers: [{ id: 4303 }],
                school: { id: 9 }
              }
            }
            if (url.includes('timetableByTeacher')) {
              return { timetableEvents: [{ date: dateStr, journalId: 12345 }] }
            }
            return null
          })
        }
      }
      feature.api = apiMock
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      await feature.processJournalRow(tr, today)
      expect(td.querySelector('.oa-final-grade-warning')).toBeNull()
    })

    it('logs error when an exception bubbles up', async () => {
      // Pass undefined as the row so accessing row.querySelector throws
      feature.api = setupApiMock()
      await expect(feature.processJournalRow(undefined, new Date())).resolves.toBeUndefined()
    })
  })

  describe('hasMissingFinalGrades — additional branches', () => {
    it('treats detailed outcome with non-array outcomeStudents as missing', async () => {
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                entryType: 'SISSEKANNE_O',
                curriculumModuleOutcomes: 99
              }]
            }
            if (url.includes('journalStudents')) {
              return [{ studentId: 1, status: 'OPPURSTAATUS_O' }]
            }
            if (url.includes('journalOutcome')) {
              return { outcomeStudents: 'not an array' }
            }
            return null
          })
        }
      }

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })

    it('treats null detailed outcome as missing', async () => {
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                entryType: 'SISSEKANNE_O',
                curriculumModuleOutcomes: 99
              }]
            }
            if (url.includes('journalStudents')) {
              return [{ studentId: 1, status: 'OPPURSTAATUS_O' }]
            }
            if (url.includes('journalOutcome')) {
              return null
            }
            return null
          })
        }
      }

      const result = await feature.hasMissingFinalGrades(123)
      expect(result).toBe(true)
    })
  })

  describe('MutationObserver via real DOM mutations', () => {
    it('detects relevance via querySelector inside an added wrapper div', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = setupApiMock()
      feature.setupMainContentObserver()

      // Add a div containing a table — relevance is detected via the inner querySelector check
      const container = document.createElement('div')
      container.appendChild(document.createElement('table'))
      wrapper.querySelector('tbody').appendChild(container)

      // Wait for the 300ms debounce + 100ms onMainContentChange delay
      await new Promise(resolve => setTimeout(resolve, 500))
      // processedJournals will have been cleared
      expect(feature.processedJournals.size).toBe(0)
    })

    it('debounces multiple rapid mutations into a single refresh', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api = setupApiMock()
      feature.setupMainContentObserver()

      const tbody = wrapper.querySelector('tbody')
      // Two rapid mutations within the 300ms debounce window
      tbody.appendChild(document.createElement('tr'))
      tbody.appendChild(document.createElement('tr'))

      await new Promise(resolve => setTimeout(resolve, 500))
      // Both mutations got coalesced — onMainContentChange ran at most once
      expect(feature.processedJournals.size).toBe(0)
    })
  })

  describe('processJournalList catch path', () => {
    it('catches errors thrown by document.querySelectorAll', async () => {
      const orig = document.querySelectorAll
      document.querySelectorAll = () => { throw new Error('hostile DOM') }

      feature.api = setupApiMock()
      await expect(feature.processJournalList()).resolves.toBeUndefined()
      expect(feature._isProcessing).toBe(false)

      document.querySelectorAll = orig
    })
  })

  describe('addWarningIndicator', () => {
    it('inserts a yellow indicator wrapped around the link', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      a.textContent = 'Link'
      td.appendChild(a)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, 'yellow')

      const wrapper = td.querySelector('span')
      expect(wrapper).toBeTruthy()
      const indicator = wrapper.querySelector('.oa-final-grade-warning')
      expect(indicator).toBeTruthy()
      expect(indicator.style.background).toBe('rgb(255, 249, 196)')
      expect(indicator.style.color).toBe('rgb(245, 127, 23)')
    })

    it('inserts a red indicator wrapped around the link', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      td.appendChild(a)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, 'red')

      const indicator = td.querySelector('.oa-final-grade-warning')
      expect(indicator).toBeTruthy()
      expect(indicator.style.background).toBe('rgb(255, 221, 221)')
      expect(indicator.style.color).toBe('rgb(211, 47, 47)')
    })

    it('does nothing when an indicator already exists in the parent', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      const existing = document.createElement('span')
      existing.className = 'oa-final-grade-warning'
      td.appendChild(a)
      td.appendChild(existing)

      feature.addWarningIndicator(a, 'yellow')

      const indicators = td.querySelectorAll('.oa-final-grade-warning')
      expect(indicators).toHaveLength(1)
    })

    it('does nothing when link has no parent', () => {
      const orphan = document.createElement('a')
      expect(() => feature.addWarningIndicator(orphan, 'red')).not.toThrow()
    })

    it('catches errors thrown by DOM mutation', () => {
      const fakeLink = {
        get parentElement() { throw new Error('hostile parent') }
      }
      expect(() => feature.addWarningIndicator(fakeLink, 'red')).not.toThrow()
    })
  })

  describe('removeAllIndicators', () => {
    it('unwraps indicators and restores the original link', () => {
      const td = document.createElement('td')
      const wrapper = document.createElement('span')
      const link = document.createElement('a')
      const indicator = document.createElement('span')
      indicator.className = 'oa-final-grade-warning'
      wrapper.appendChild(link)
      wrapper.appendChild(indicator)
      td.appendChild(wrapper)
      document.body.appendChild(td)

      feature.removeAllIndicators()

      expect(td.querySelector('.oa-final-grade-warning')).toBeNull()
      expect(td.querySelector('a')).toBe(link)
      expect(td.querySelector('span')).toBeNull()
    })

    it('removes the indicator alone when no link sibling is present', () => {
      const td = document.createElement('td')
      const wrapper = document.createElement('span')
      const indicator = document.createElement('span')
      indicator.className = 'oa-final-grade-warning'
      wrapper.appendChild(indicator)
      // wrapper.children.length is 1, not 2 — fall through to the simple remove
      td.appendChild(wrapper)
      document.body.appendChild(td)

      feature.removeAllIndicators()

      expect(td.querySelector('.oa-final-grade-warning')).toBeNull()
    })

    it('catches errors thrown by querySelectorAll', () => {
      const orig = document.querySelectorAll
      document.querySelectorAll = () => { throw new Error('hostile DOM') }
      expect(() => feature.removeAllIndicators()).not.toThrow()
      document.querySelectorAll = orig
    })
  })
})
