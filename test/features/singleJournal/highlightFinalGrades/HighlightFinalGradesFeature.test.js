import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import HighlightFinalGradesFeature from '../../../../src/features/singleJournal/highlightFinalGrades/HighlightFinalGradesFeature.js'
import { getStudyYearRange } from '../../../../src/lib/finalGradeWarning.js'
import { restoreGlobalDOM } from '../../../setup.js'

describe('HighlightFinalGradesFeature', () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    global.window.location.href = 'https://tahvel.edu.ee/#/journal/12345/edit'
    feature = new HighlightFinalGradesFeature()
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
                school: { id: 9 },
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
                school: { id: 9 },
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

    test('should cache unavailable final lesson lookups during repeated table updates', async () => {
      let journalCallCount = 0
      feature.api = {
        tahvel: {
          get: mock(url => {
            if (url === '/journals/123') {
              journalCallCount++
              return Promise.resolve({ curriculumVersions: [], journalTeachers: [] })
            }
            if (url.includes('/journalEntriesByDate')) {
              return Promise.resolve([])
            }
            return Promise.resolve([])
          })
        }
      }

      const firstResult = await feature._getFinalLessonDateForRun(123)
      const secondResult = await feature._getFinalLessonDateForRun(123)

      expect(firstResult).toBeNull()
      expect(secondResult).toBeNull()
      expect(journalCallCount).toBe(1)
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
      feature._observer = new MutationObserver(() => {})
      feature._docObserver = new MutationObserver(() => {})

      feature.onDeactivate()

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

  describe('run() integration via real JSDOM', () => {
    function buildJournalTable({ headers, rows = [], wrapId = 'studentTable' }) {
      const wrap = document.createElement('div')
      wrap.id = wrapId
      const table = document.createElement('table')
      table.className = 'tahvel-table'

      const thead = document.createElement('thead')
      const trHead = document.createElement('tr')
      for (const h of headers) {
        const th = document.createElement('th')
        th.textContent = h
        trHead.appendChild(th)
      }
      thead.appendChild(trHead)
      table.appendChild(thead)

      const tbody = document.createElement('tbody')
      for (const cells of rows) {
        const tr = document.createElement('tr')
        for (const cell of cells) {
          const td = document.createElement('td')
          if (typeof cell === 'string') td.textContent = cell
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      }
      table.appendChild(tbody)
      wrap.appendChild(table)
      document.body.appendChild(wrap)
      return table
    }

    test('run() injects yellow highlight when within warning window with empty final cell', async () => {
      const today = new Date()
      const finalDate = new Date(today)
      finalDate.setDate(finalDate.getDate() + 3)
      const finalIso = finalDate.toISOString().slice(0, 10)

      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: finalIso }] }
            if (url.includes('journalEntriesByDate')) return []
            return null
          })
        }
      }

      await feature.run()

      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-yellow')).toBe(true)
    })

    test('run() injects red highlight when past the final date with empty cell', async () => {
      const past = '2020-01-15'
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: past }] }
            if (url.includes('journalEntriesByDate')) return []
            return null
          })
        }
      }

      await feature.run()

      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(true)
    })

    test('run() does not highlight when final cell already has a grade', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '5']]
      })

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            if (url.includes('journalEntriesByDate')) return []
            return null
          })
        }
      }

      await feature.run()

      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(false)
      expect(cells[1].classList.contains('highlight-final-grade-yellow')).toBe(false)
    })

    test('run() skips highlighting for academic-leave (AP) students', async () => {
      const wrap = document.createElement('div')
      wrap.id = 'studentTable'
      const table = document.createElement('table')
      table.className = 'tahvel-table'

      const thead = document.createElement('thead')
      const trh = document.createElement('tr')
      for (const text of ['Õppija', 'Lõpptulemus']) {
        const th = document.createElement('th')
        th.textContent = text
        trh.appendChild(th)
      }
      thead.appendChild(trh)
      table.appendChild(thead)

      const tbody = document.createElement('tbody')
      const tr = document.createElement('tr')
      const tdName = document.createElement('td')
      const apSpan = document.createElement('span')
      apSpan.textContent = 'AP'
      tdName.appendChild(apSpan)
      tr.appendChild(tdName)
      const tdGrade = document.createElement('td')
      tr.appendChild(tdGrade)
      tbody.appendChild(tr)
      table.appendChild(tbody)
      wrap.appendChild(table)
      document.body.appendChild(wrap)

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            if (url.includes('journalEntriesByDate')) return []
            return null
          })
        }
      }

      await feature.run()

      expect(tdGrade.classList.contains('highlight-final-grade-red')).toBe(false)
      expect(tdGrade.classList.contains('highlight-final-grade-yellow')).toBe(false)
    })

    test('run() returns early when no journal table exists in DOM', async () => {
      feature.isActive = true
      await feature.run()
      expect(feature._tableRetryCount).toBeGreaterThan(0)
    })

    test('run() detects ÕV columns and highlights empty cells', async () => {
      const past = '2020-01-15'
      buildJournalTable({
        headers: ['Õppija', 'ÕV1', 'ÕV2', 'Lõpptulemus'],
        rows: [['Mari', '', '4', '']]
      })

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: past }] }
            if (url.includes('journalEntriesByDate')) return []
            return null
          })
        }
      }

      await feature.run()

      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-ov-red')).toBe(true)
      expect(cells[2].classList.contains('highlight-ov-red')).toBe(false)
      expect(cells[3].classList.contains('highlight-final-grade-red')).toBe(true)
    })

    test('run() reads comparison date from last-lesson banner', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })

      const banner = document.createElement('div')
      banner.id = 'last-lesson-inline-notification'
      banner.textContent = 'Last lesson 15.01.2020 (võrdlus kuupäevaga 16.01.2020)'
      document.body.appendChild(banner)

      feature.api = {
        tahvel: {
          get: mock(async () => null)
        }
      }

      await feature.run()

      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(true)
    })

    test('onActivate triggers run via setTimeout and sets up observer', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })

      feature.api = {
        tahvel: {
          get: mock(async () => null)
        }
      }
      feature.isActive = true
      feature.onActivate()
      await new Promise(r => setTimeout(r, 1100))

      expect(feature._docObserverTable).not.toBeNull()
    }, 3000)

    test('injectFinalGradeCSS adds style element only once', () => {
      feature.injectFinalGradeCSS()
      const first = document.getElementById('highlight-final-grade-style')
      expect(first).not.toBeNull()
      feature.injectFinalGradeCSS()
      const all = document.querySelectorAll('#highlight-final-grade-style')
      expect(all.length).toBe(1)
    })

    test('_findJournalTable returns null when no table found', () => {
      expect(feature._findJournalTable()).toBeNull()
    })

    test('_findJournalTable falls back to layout-padding lookup', () => {
      const wrap = document.createElement('div')
      wrap.className = 'layout-padding'
      const table = document.createElement('table')
      table.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = 'Õppija'
      tr.appendChild(th)
      thead.appendChild(tr)
      table.appendChild(thead)
      wrap.appendChild(table)
      document.body.appendChild(wrap)

      const found = feature._findJournalTable()
      expect(found).toBe(table)
    })

    test('observer fires after table mutation and triggers run() debounce', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      feature.api = { tahvel: { get: mock(async () => null) } }

      await feature.run()
      const tbody = document.querySelector('tbody')
      const newRow = document.createElement('tr')
      const td1 = document.createElement('td')
      td1.textContent = 'Jüri'
      const td2 = document.createElement('td')
      newRow.appendChild(td1)
      newRow.appendChild(td2)
      tbody.appendChild(newRow)

      await new Promise(r => setTimeout(r, 100))
      expect(feature._docObserver).not.toBeNull()
    })

    test('preserves existing Angular-applied highlight on ng-star-inserted cell during cleanup', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted', 'highlight-final-grade-yellow')

      feature.api = { tahvel: { get: mock(async () => null) } }
      await feature.run()

      expect(cell.classList.contains('highlight-final-grade-yellow')).toBe(true)
    })

    test('skips ng-star-inserted cell that lacks both grade-cell child and Angular form-state classes', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted')

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-final-grade-red')).toBe(false)
    })

    test('skips ng-star-inserted ÕV cell that lacks both grade-cell child and Angular form-state classes', async () => {
      buildJournalTable({
        headers: ['Õppija', 'ÕV1'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted')

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-ov-red')).toBe(false)
    })

    test('highlights ng-star-inserted cell with grade-cell child even without form-state classes', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted')
      const gradeDiv = document.createElement('div')
      gradeDiv.classList.add('grade-cell', 'ng-star-inserted')
      cell.appendChild(gradeDiv)

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-final-grade-red')).toBe(true)
    })

    test('highlights ng-star-inserted ÕV cell with grade-cell child even without form-state classes', async () => {
      buildJournalTable({
        headers: ['Õppija', 'ÕV1'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted')
      const gradeDiv = document.createElement('div')
      gradeDiv.classList.add('grade-cell', 'ng-star-inserted')
      cell.appendChild(gradeDiv)

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-ov-red')).toBe(true)
    })

    test('honors ng-star-inserted cell that has Angular form-state classes (proceeds to highlight)', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted', 'ng-untouched', 'ng-pristine', 'ng-valid')

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-final-grade-red')).toBe(true)
    })

    test('uses window.__oa2ComparisonDate as fallback comparison date', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      window.__oa2ComparisonDate = '2025-01-01'
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2024-12-15' }] }
            return null
          })
        }
      }
      await feature.run()
      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(true)
      delete window.__oa2ComparisonDate
    })

    test('returns early when run() finds no final-grade or ÕV columns', async () => {
      const wrap = document.createElement('div')
      wrap.id = 'studentTable'
      const table = document.createElement('table')
      table.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const trh = document.createElement('tr')
      const th1 = document.createElement('th')
      th1.textContent = 'Õppija'
      trh.appendChild(th1)
      const th2 = document.createElement('th')
      th2.textContent = 'Märkused'
      trh.appendChild(th2)
      thead.appendChild(trh)
      table.appendChild(thead)
      const tbody = document.createElement('tbody')
      const tr = document.createElement('tr')
      const td1 = document.createElement('td')
      td1.textContent = 'Mari'
      tr.appendChild(td1)
      const td2 = document.createElement('td')
      td2.textContent = 'Tubli'
      tr.appendChild(td2)
      tbody.appendChild(tr)
      table.appendChild(tbody)
      wrap.appendChild(table)
      document.body.appendChild(wrap)

      feature.api = { tahvel: { get: mock(async () => null) } }

      await feature.run()
      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(false)
    })

    test('observes for last-lesson banner insertion when banner is missing', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      feature.api = { tahvel: { get: mock(async () => null) } }
      await feature.run()
      expect(feature._bannerObserver).not.toBeNull()

      const banner = document.createElement('div')
      banner.id = 'last-lesson-inline-notification'
      banner.textContent = '15.01.2020 (võrdlus kuupäevaga 16.01.2020)'
      document.body.appendChild(banner)
      await new Promise(r => setTimeout(r, 100))

      expect(feature._bannerObserver).toBeNull()
    })

    test('handles getFinalLessonDate API rejection gracefully', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      feature.api = {
        tahvel: {
          get: mock(async () => { throw new Error('api-fail') })
        }
      }

      await feature.run()
      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(false)
    })

    test('run() honors feature.isActive=false and stops retrying', async () => {
      feature.isActive = false
      feature._tableRetryCount = 0
      await feature.run()
      expect(feature._tableRetryTimeout).toBeNull()
    })

    test('run() stops retrying after 40 attempts', async () => {
      feature.isActive = true
      feature._tableRetryCount = 40
      await feature.run()
      expect(feature._tableRetryTimeout).toBeNull()
    })

    test('_setupTableObserver disconnects existing observer when called again', () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })

      feature._setupTableObserver()
      const first = feature._docObserver
      expect(first).not.toBeNull()

      feature._setupTableObserver()
      const second = feature._docObserver
      expect(second).not.toBe(first)
    })

    test('_setupTableObserver clears retry timeout when table is found', () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })

      feature._tableRetryTimeout = setTimeout(() => {}, 60000)
      feature._setupTableObserver()
      expect(feature._tableRetryTimeout).toBeNull()
    })

    test('observer skips mutations outside the journal table', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      feature.api = { tahvel: { get: mock(async () => null) } }
      await feature.run()

      const unrelated = document.createElement('div')
      document.body.appendChild(unrelated)
      unrelated.appendChild(document.createElement('span'))
      await new Promise(r => setTimeout(r, 100))
      expect(feature._docObserver).not.toBeNull()
    })

    test('removes existing highlight when warning window has passed and cell is filled', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '5']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('highlight-final-grade-red')

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-final-grade-red')).toBe(false)
    })

    test('removes existing ÕV highlight when ÕV cell is filled', async () => {
      buildJournalTable({
        headers: ['Õppija', 'ÕV1'],
        rows: [['Mari', '4']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('highlight-ov-red')

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-ov-red')).toBe(false)
    })

    test('skips highlighting ÕV cell for academic-leave (AP) student', async () => {
      const wrap = document.createElement('div')
      wrap.id = 'studentTable'
      const table = document.createElement('table')
      table.className = 'tahvel-table'

      const thead = document.createElement('thead')
      const trh = document.createElement('tr')
      for (const text of ['Õppija', 'ÕV1']) {
        const th = document.createElement('th')
        th.textContent = text
        trh.appendChild(th)
      }
      thead.appendChild(trh)
      table.appendChild(thead)

      const tbody = document.createElement('tbody')
      const tr = document.createElement('tr')
      const tdName = document.createElement('td')
      const apSpan = document.createElement('span')
      apSpan.textContent = 'AP'
      tdName.appendChild(apSpan)
      tr.appendChild(tdName)
      const tdOv = document.createElement('td')
      tdOv.classList.add('highlight-ov-yellow')
      tr.appendChild(tdOv)
      tbody.appendChild(tr)
      table.appendChild(tbody)
      wrap.appendChild(table)
      document.body.appendChild(wrap)

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }

      await feature.run()

      expect(tdOv.classList.contains('highlight-ov-yellow')).toBe(false)
    })

    test('preserves Angular-applied ÕV highlight on ng-star-inserted cell during cleanup', async () => {
      buildJournalTable({
        headers: ['Õppija', 'ÕV1'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('ng-star-inserted', 'highlight-ov-yellow')

      feature.api = { tahvel: { get: mock(async () => null) } }
      await feature.run()

      expect(cell.classList.contains('highlight-ov-yellow')).toBe(true)
    })

    test('ÕV cell within yellow warning window gets yellow highlight', async () => {
      const today = new Date()
      const finalDate = new Date(today)
      finalDate.setDate(finalDate.getDate() + 3)
      const finalIso = finalDate.toISOString().slice(0, 10)

      buildJournalTable({
        headers: ['Õppija', 'ÕV1'],
        rows: [['Mari', '']]
      })

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: finalIso }] }
            return null
          })
        }
      }

      await feature.run()
      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-ov-yellow')).toBe(true)
    })

    test('removes ÕV highlight outside any warning window', async () => {
      const today = new Date()
      const longFuture = new Date(today)
      longFuture.setDate(longFuture.getDate() + 365)
      const futureIso = longFuture.toISOString().slice(0, 10)

      buildJournalTable({
        headers: ['Õppija', 'ÕV1'],
        rows: [['Mari', '']]
      })
      const cell = document.querySelectorAll('tbody tr td')[1]
      cell.classList.add('highlight-ov-yellow')

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: futureIso }] }
            return null
          })
        }
      }
      await feature.run()

      expect(cell.classList.contains('highlight-ov-yellow')).toBe(false)
    })

    test('onDeactivate disconnects banner observer when present', () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      feature._bannerObserver = new MutationObserver(() => {})
      feature.onDeactivate()
      expect(feature._bannerObserver).toBeNull()
    })

    test('AP detection swallows errors when row.querySelectorAll throws', async () => {
      buildJournalTable({
        headers: ['Õppija', 'Lõpptulemus'],
        rows: [['Mari', '']]
      })
      const row = document.querySelector('tbody tr')
      const originalQS = row.querySelectorAll.bind(row)
      row.querySelectorAll = () => { throw new Error('querySelectorAll-broken') }

      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url === '/journals/12345') return { school: { id: 9 }, journalTeachers: [{ id: 5 }] }
            if (url.includes('timetableevents')) return { timetableEvents: [{ journalId: 12345, date: '2020-01-15' }] }
            return null
          })
        }
      }
      await feature.run()

      const cells = document.querySelectorAll('tbody tr td')
      expect(cells[1].classList.contains('highlight-final-grade-red')).toBe(true)
      row.querySelectorAll = originalQS
    })

  })
})
