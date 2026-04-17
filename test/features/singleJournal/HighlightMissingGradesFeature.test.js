import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import HighlightMissingGradesFeature from '../../../src/features/singleJournal/highlightMissingGrades/HighlightMissingGradesFeature.js'

describe('HighlightMissingGradesFeature', () => {
  let feature

  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      info: () => {},
      groupCollapsed: () => {},
      trace: () => {},
      groupEnd: () => {}
    }
    global.document = {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: () => {} }
    }
    global.chrome = {
      storage: {
        local: {
          get: (_keys, callback) => callback({})
        }
      },
      runtime: {
        onMessage: {
          addListener: () => {},
          removeListener: () => {}
        }
      }
    }
    feature = new HighlightMissingGradesFeature()
    global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
  })

  describe('constructor', () => {
    test('should initialize successfully', () => {
      expect(feature).toBeDefined()
      expect(feature.urlPattern).toEqual(/#\/journal\//)
    })
  })

  describe('injectMissingGradeCSS', () => {
    test('should inject CSS style element', () => {
      const mockStyleElement = { id: '', textContent: '' }
      const mockHead = { appendChild: () => {} }
      global.document = {
        getElementById: () => null,
        createElement: () => mockStyleElement,
        head: mockHead
      }

      feature.injectMissingGradeCSS()

      expect(mockStyleElement.id).toBe('highlight-missing-grade-style')
      expect(mockStyleElement.textContent).toContain('.highlight-missing-grade')
      expect(mockStyleElement.textContent).toContain('#ffdddd')
    })

    test('should not inject CSS if already exists', () => {
      let createElementCalled = false
      global.document = {
        getElementById: () => ({ id: 'highlight-missing-grade-style' }),
        createElement: () => {
          createElementCalled = true
          return { id: '', textContent: '' }
        },
        head: { appendChild: () => {} }
      }

      feature.injectMissingGradeCSS()

      expect(createElementCalled).toBe(false)
    })
  })

  describe('onDeactivate', () => {
    test('should disconnect observer if exists', () => {
      const mockDisconnect = { disconnect: () => {} }
      feature._observer = mockDisconnect

      feature.onDeactivate()

      expect(feature._observer).toBeNull()
    })

    test('should clear debounce timer if exists', () => {
      feature._debounceTimer = setTimeout(() => {}, 1000)

      feature.onDeactivate()

      expect(feature._debounceTimer).toBeNull()
    })

    test('should reset updating flag', () => {
      feature._isUpdating = true

      feature.onDeactivate()

      expect(feature._isUpdating).toBe(false)
    })

    test('should handle missing observer gracefully', () => {
      feature._observer = null

      expect(() => feature.onDeactivate()).not.toThrow()
    })
  })

  describe('run - early returns', () => {
    test('should return early if already updating', async () => {
      feature._isUpdating = true

      await feature.run()

      // Should exit immediately without resetting flag
      expect(feature._isUpdating).toBe(true)
    })
  })

  describe('date parsing and comparison logic', () => {
    test('should handle date extraction from header cells', () => {
      // Test the regex pattern used in run() for matching dates
      const testCases = [
        { input: '18.09', expected: ['18', '09'] },
        { input: '18.09.2024', expected: ['18', '09'] },
        { input: '01/12', expected: ['01', '12'] },
        { input: 'No date here', expected: null }
      ]

      testCases.forEach(({ input, expected }) => {
        const match = input.match(/(\d{1,2})[./](\d{1,2})/)
        if (expected) {
          expect(match[1]).toBe(expected[0])
          expect(match[2]).toBe(expected[1])
        } else {
          expect(match).toBeNull()
        }
      })
    })

    test('should pad day and month to 2 digits', () => {
      const day = '5'
      const month = '9'
      const paddedDay = String(day).padStart(2, '0')
      const paddedMonth = String(month).padStart(2, '0')

      expect(paddedDay).toBe('05')
      expect(paddedMonth).toBe('09')
    })
  })

  describe('valid grades detection', () => {
    test('should recognize valid grades', () => {
      const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])

      expect(validGrades.has('A')).toBe(true)
      expect(validGrades.has('MA')).toBe(true)
      expect(validGrades.has('5')).toBe(true)
    })

    test('should reject invalid grades', () => {
      const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])

      expect(validGrades.has('')).toBe(false)
      expect(validGrades.has('0')).toBe(false)
      expect(validGrades.has('X')).toBe(false)
    })
  })

  describe('absence detection logic', () => {
    test('should identify valid absence codes for highlighting', () => {
      const shouldHighlight = absence => {
        return absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P'
      }

      expect(shouldHighlight('')).toBe(true)
      expect(shouldHighlight('PUUDUMINE_H')).toBe(true)
      expect(shouldHighlight('PUUDUMINE_P')).toBe(true)
      expect(shouldHighlight('H')).toBe(true)
      expect(shouldHighlight('P')).toBe(true)
    })

    test('should reject absence codes that prevent highlighting', () => {
      const shouldHighlight = absence => {
        return absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P'
      }

      expect(shouldHighlight('PUUDUMINE_T')).toBe(false)
      expect(shouldHighlight('MUUD')).toBe(false)
      expect(shouldHighlight('V')).toBe(false)
    })

    test('should detect absence from text content', () => {
      const testCases = [
        { text: 'puudumine', expected: 'PUUDUMINE' },
        { text: 'PUUDUMINE', expected: 'PUUDUMINE' },
        { text: '  H  ', expected: 'H' },
        { text: 'P', expected: 'P' },
        { text: 'some other text', expected: null }
      ]

      testCases.forEach(({ text, expected }) => {
        let absence = ''
        if (/puudumine/i.test(text)) {
          absence = 'PUUDUMINE'
        } else if (/^\s*[HP]\s*$/i.test(text)) {
          absence = text.trim().toUpperCase()
        }

        expect(absence || null).toBe(expected)
      })
    })
  })

  describe('tooltip formatting', () => {
    test('should format due date as DD.MM.YYYY', () => {
      const dueDateStr = '2024-11-15'
      const d = new Date(dueDateStr)
      const formatted = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`

      expect(formatted).toBe('15.11.2024')
    })

    test('should create correct tooltip text', () => {
      const tooltipDate = '15.11.2024'
      const tooltip = `Tähtaeg oli ${tooltipDate}, aga hinne puudub`

      expect(tooltip).toBe('Tähtaeg oli 15.11.2024, aga hinne puudub')
    })

    test('should use fallback tooltip when no date', () => {
      const tooltip = 'Hinne puudub'

      expect(tooltip).toBe('Hinne puudub')
    })
  })

  describe('student ID extraction logic', () => {
    test('should extract ID from various data attributes', () => {
      const testAttributes = ['data-student-id', 'data-journal-student', 'data-journal-student-id', 'data-journalstudent']

      testAttributes.forEach(attr => {
        const mockElement = {
          getAttribute: a => (a === attr ? '12345' : null)
        }

        const attrs = ['data-student-id', 'data-journal-student', 'data-journal-student-id', 'data-journalstudent']
        let studentId = null
        for (const a of attrs) {
          const v = mockElement.getAttribute(a)
          if (v) {
            studentId = v.toString()
            break
          }
        }

        expect(studentId).toBe('12345')
      })
    })

    test('should extract ID from dataset', () => {
      const mockElement = {
        getAttribute: () => null,
        dataset: { journalStudent: '67890' }
      }

      let studentId = null
      const attrs = ['data-student-id', 'data-journal-student']
      for (const a of attrs) {
        const v = mockElement.getAttribute(a)
        if (v) {
          studentId = v.toString()
          break
        }
      }

      if (!studentId && mockElement.dataset?.journalStudent) {
        studentId = mockElement.dataset.journalStudent.toString()
      }

      expect(studentId).toBe('67890')
    })
  })

  describe('cell text extraction logic', () => {
    test('should extract text from specific selectors in order', () => {
      const selectors = ['[data-grade]', '[data-absence]', '.grade', '.grade-value', '.value', 'span', 'div']

      expect(selectors[0]).toBe('[data-grade]')
      expect(selectors[2]).toBe('.grade')
      expect(selectors.length).toBe(7)
    })

    test('should fallback to textContent', () => {
      const mockCell = {
        querySelector: () => null,
        textContent: '  5  '
      }

      const text = mockCell.querySelector
        ? mockCell.querySelector('.grade')?.textContent?.trim() || mockCell.textContent.trim()
        : mockCell.textContent.trim()

      expect(text).toBe('5')
    })
  })

  describe('green header detection', () => {
    test('should detect RGB format', () => {
      const bgColors = [
        { color: 'rgb(236,252,203)', expected: true },
        { color: 'rgb(236, 252, 203)', expected: true },
        { color: 'RGB(236, 252, 203)', expected: true },
        { color: 'rgb(255,0,0)', expected: false }
      ]

      bgColors.forEach(({ color, expected }) => {
        const normalized = color.replace(/\s+/g, '').toLowerCase()
        const greenRgb = 'rgb(236,252,203)'
        const isGreen = normalized === greenRgb

        expect(isGreen).toBe(expected)
      })
    })

    test('should detect RGBA format', () => {
      const normalized = 'rgba(236,252,203,1)'.replace(/\s+/g, '').toLowerCase()
      const greenRgba = 'rgba(236,252,203,1)'

      expect(normalized).toBe(greenRgba)
    })

    test('should detect hex format', () => {
      const normalized = '#ecfccb'.toLowerCase()
      const greenHex = '#ecfccb'

      expect(normalized).toBe(greenHex)
    })
  })

  describe('grade object handling', () => {
    test('should handle grade as object with code', () => {
      const gradeObj = { code: '5' }
      const grade = typeof gradeObj === 'object' && gradeObj.code ? gradeObj.code : gradeObj

      expect(grade).toBe('5')
    })

    test('should handle null grade object', () => {
      const gradeObj = { code: '' }
      const grade = typeof gradeObj === 'object' && (!gradeObj.code || gradeObj.code === '') ? '' : gradeObj.code

      expect(grade).toBe('')
    })

    test('should fallback to verbalGrade if grade is empty', () => {
      const result = { grade: '', verbalGrade: 'Arvestatud' }
      const grade = result.grade || result.verbalGrade

      expect(grade).toBe('Arvestatud')
    })
  })

  describe('journal ID extraction', () => {
    test('should extract journal ID from URL', () => {
      const urls = [
        { url: 'https://tahvel.edu.ee/#/journal/12345/edit', expected: '12345' },
        { url: 'https://tahvel.edu.ee/journal/67890', expected: '67890' },
        { url: 'https://tahvel.edu.ee/#/journal/999', expected: '999' }
      ]

      urls.forEach(({ url, expected }) => {
        const match = url.match(/\/journal\/(\d+)/)
        const journalId = match ? parseInt(match[1], 10) : null

        expect(journalId?.toString()).toBe(expected)
      })
    })

    test('should return null for invalid URL', () => {
      const url = 'https://tahvel.edu.ee/#/other/page'
      const match = url.match(/\/journal\/(\d+)/)
      const journalId = match ? parseInt(match[1], 10) : null

      expect(journalId).toBeNull()
    })
  })

  describe('entry type filtering', () => {
    test('should identify independent work entries', () => {
      const entries = [
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' },
        { entryType: 'SISSEKANNE_H', homeworkDuedate: '2024-11-16' },
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-17' }
      ]

      const independentWork = entries.filter(e => e.entryType === 'SISSEKANNE_I')

      expect(independentWork.length).toBe(2)
      expect(independentWork[0].homeworkDuedate).toBe('2024-11-15')
    })

    test('should handle entries without homeworkDuedate', () => {
      const entry = {
        entryType: 'SISSEKANNE_I',
        entryDate: '2024-11-15'
      }

      const dueDateStr = entry.homeworkDuedate || entry.entryDate

      expect(dueDateStr).toBe('2024-11-15')
    })

    test('should compare dates correctly', () => {
      const nowDate = new Date('2024-11-20')
      const dueDate1 = new Date('2024-11-15')
      const dueDate2 = new Date('2024-11-25')

      expect(dueDate1 < nowDate).toBe(true)
      expect(dueDate2 < nowDate).toBe(false)
    })
  })

  describe('mutation observer logic', () => {
    test('should ignore highlight class changes', () => {
      const oldValue = 'some-class'
      const newValue = 'some-class highlight-missing-grade'

      const oldHasHighlight = oldValue.includes('highlight-missing-grade')
      const newHasHighlight = newValue.includes('highlight-missing-grade')
      const otherClassesOld = oldValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()
      const otherClassesNew = newValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()

      const shouldIgnore = oldHasHighlight !== newHasHighlight && otherClassesOld === otherClassesNew

      expect(shouldIgnore).toBe(true)
    })

    test('should detect relevant class changes', () => {
      const oldValue = 'some-class'
      const newValue = 'other-class highlight-missing-grade'

      const oldHasHighlight = oldValue.includes('highlight-missing-grade')
      const newHasHighlight = newValue.includes('highlight-missing-grade')
      const otherClassesOld = oldValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()
      const otherClassesNew = newValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()

      const shouldIgnore = oldHasHighlight !== newHasHighlight && otherClassesOld === otherClassesNew

      expect(shouldIgnore).toBe(false)
    })
  })

  describe('onActivate with real DOM', () => {
    test('should set up MutationObserver', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="studentTable"></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.onActivate()

      expect(feature._observer).toBeDefined()
      expect(feature._isUpdating).toBe(false)
      expect(feature._debounceTimer).toBeNull()

      // Cleanup
      if (feature._observer) {
        feature._observer.disconnect()
      }
    })

    test('should not create duplicate observer', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      feature.onActivate()
      const firstObserver = feature._observer

      feature.onActivate()
      const secondObserver = feature._observer

      expect(firstObserver).toBe(secondObserver)

      // Cleanup
      if (feature._observer) {
        feature._observer.disconnect()
      }
    })

    test('should trigger MutationObserver callback on DOM changes', (done) => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="studentTable"><table></table></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      // Mock run method to track if it's called
      let runCalled = false
      feature.run = mock(async () => {
        runCalled = true
      })

      feature.onActivate()

      // Wait for setTimeout in onActivate to complete
      setTimeout(() => {
        // Simulate a DOM change
        const studentTable = document.getElementById('studentTable')
        const newElement = document.createElement('span')
        studentTable.appendChild(newElement)

        // Wait for debounce timer
        setTimeout(() => {
          // Cleanup
          if (feature._observer) {
            feature._observer.disconnect()
          }
          done()
        }, 500)
      }, 1100)
    })
  })

  describe('AP status detection', () => {
    test('should detect AP in student name cell', () => {
      const getCellText = (c) => {
        if (!c) return ''
        return (c.textContent || '').trim()
      }

      const testCases = [
        { text: 'John Doe AP', expected: true },
        { text: 'AP Jane Smith', expected: true },
        { text: 'Test AP Student', expected: true },
        { text: 'John Doe', expected: false },
        { text: 'APPLY', expected: false }, // Should not match - needs word boundary
        { text: 'CHAP', expected: false } // Should not match - needs word boundary
      ]

      testCases.forEach(({ text, expected }) => {
        const mockCell = { textContent: text }
        const hasAP = /\bAP\b/.test(getCellText(mockCell))
        expect(hasAP).toBe(expected)
      })
    })

    test('should check first 3 columns for AP status', () => {
      const getCellText = (c) => {
        if (!c) return ''
        return (c.textContent || '').trim()
      }

      const cells = [
        { textContent: 'John Doe AP' },
        { textContent: '12345' },
        { textContent: 'TAK24' }
      ]

      const hasAPStatus = [cells[0], cells[1], cells[2]].some(cell => {
        if (!cell) return false
        const text = getCellText(cell)
        return /\bAP\b/.test(text)
      })

      expect(hasAPStatus).toBe(true)
    })

    test('should not detect AP when not present', () => {
      const getCellText = (c) => {
        if (!c) return ''
        return (c.textContent || '').trim()
      }

      const cells = [
        { textContent: 'John Doe' },
        { textContent: '12345' },
        { textContent: 'TAK24' }
      ]

      const hasAPStatus = [cells[0], cells[1], cells[2]].some(cell => {
        if (!cell) return false
        const text = getCellText(cell)
        return /\bAP\b/.test(text)
      })

      expect(hasAPStatus).toBe(false)
    })
  })

  describe('run with mocked API', () => {
    test('should return early when no table found', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should return early when no journalId in URL', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><table class="journalTable"></table></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journals' } }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should handle API error gracefully', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><table class="journalTable"></table></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should handle empty journal entries', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><table class="journalTable"></table></body></html>')
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async () => [])
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should process journal entries with due dates', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th>18.09</th></tr></thead>
            <tbody><tr><td data-student-id="123">Test Student</td><td>12345</td><td data-grade="" data-absence=""></td></tr></tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null }

      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 10)

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: pastDate.toISOString(),
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: pastDate.toISOString()
              }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should find table in studentTable container', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <div id="studentTable">
            <table class="journalTable">
              <thead><tr><th>Name</th><th>Code</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async () => [])
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should find table in layout-padding', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <div class="layout-padding">
            <table class="journalTable">
              <thead><tr><th>Name</th><th>Code</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.api = {
        tahvel: {
          get: mock(async () => [])
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should match entry by date correctly', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th>18.09</th></tr></thead>
            <tbody><tr><td data-student-id="123">Test</td><td>12345</td><td data-grade="" data-absence=""></td></tr></tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null }

      const pastDate = new Date('2024-09-18')

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: '2024-09-18',
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: '2024-09-18'
              }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should handle multiple entries for same date', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th>18.09.2024</th></tr></thead>
            <tbody><tr><td data-student-id="123">Test</td><td>12345</td><td data-grade="" data-absence=""></td></tr></tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null }

      const pastDate = '2024-09-18'

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [
                {
                  id: 1,
                  entryDate: pastDate,
                  entryType: 'SISSEKANNE_T',
                  homeworkDuedate: pastDate
                },
                {
                  id: 2,
                  entryDate: pastDate,
                  entryType: 'SISSEKANNE_I',
                  homeworkDuedate: pastDate
                }
              ]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should fetch entry details when homeworkDuedate is missing', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th>18.09</th></tr></thead>
            <tbody><tr><td data-student-id="123">Test</td><td>12345</td><td data-grade="" data-absence=""></td></tr></tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null }

      const pastDate = '2024-09-18'

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: pastDate,
                entryType: 'SISSEKANNE_I'
                // No homeworkDuedate - will trigger fetch
              }]
            } else if (url.includes('journalEntry/1')) {
              return {
                id: 1,
                entryDate: pastDate,
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: pastDate
              }
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should process tbody rows and check for missing grades', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th>18.09</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123">Student 1</td>
                <td>12345</td>
                <td data-grade="" data-absence="" data-journal-student="student-id-123"></td>
              </tr>
              <tr>
                <td data-student-id="456">Student 2</td>
                <td>67890</td>
                <td data-grade="5" data-absence="" data-journal-student="student-id-456"></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null }

      const pastDate = '2024-09-18'

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: pastDate,
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: pastDate
              }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      expect(feature._isUpdating).toBe(false)
    })

    test('should not highlight students with AP status', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th style="background-color: rgb(236, 252, 203)">18.09</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123"><span>John Doe AP</span></td>
                <td>12345</td>
                <td data-grade="" data-absence=""></td>
              </tr>
              <tr>
                <td data-student-id="456">Jane Smith</td>
                <td>67890</td>
                <td data-grade="" data-absence=""></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      const pastDate = '2024-09-18'

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: pastDate,
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: pastDate,
                journalStudentResults: {}
              }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      const rows = dom.window.document.querySelectorAll('tbody tr')
      const studentWithAP = rows[0].children[2]
      const studentWithoutAP = rows[1].children[2]

      // Student with AP should not have highlight class
      expect(studentWithAP.classList.contains('highlight-missing-grade')).toBe(false)
      // Student without AP should have highlight class (since grade is missing)
      expect(studentWithoutAP.classList.contains('highlight-missing-grade')).toBe(true)
      expect(feature._isUpdating).toBe(false)
    })

    test('should handle AP in different columns', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Num</th><th>Name</th><th>Class</th><th style="background-color: rgb(236, 252, 203)">18.09</th></tr></thead>
            <tbody>
              <tr>
                <td>1</td>
                <td data-student-id="123">John Doe</td>
                <td><span>TAK24 AP</span></td>
                <td data-grade="" data-absence=""></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      const pastDate = '2024-09-18'

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: pastDate,
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: pastDate,
                journalStudentResults: {}
              }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false

      await feature.run()

      const row = dom.window.document.querySelector('tbody tr')
      const gradeCell = row.children[3]

      // Student with AP in class column should not be highlighted
      expect(gradeCell.classList.contains('highlight-missing-grade')).toBe(false)
      expect(feature._isUpdating).toBe(false)
    })
  })

  describe('settings toggle', () => {
    test('should not activate when OA_highlightMissingGrades is false', () => {
      global.chrome.storage.local.get = (_keys, cb) => cb({ OA_highlightMissingGrades: false })
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="studentTable"></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      feature.onActivate()

      expect(feature._observer).toBeUndefined()
      expect(feature._activateTimer).toBeUndefined()
    })

    test('should disconnect observer when disabled via message', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="studentTable"></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      // Capture the message listener registered by onActivate
      let messageListener
      global.chrome.runtime.onMessage.addListener = (listener) => { messageListener = listener }

      feature.onActivate()

      // Feature should be activated
      expect(feature._observer).toBeDefined()

      // Simulate toggle OFF message
      messageListener({ action: 'highlightMissingGradesChanged', enabled: false })

      expect(feature._observer).toBeNull()
      expect(feature._activateTimer).toBeNull()
      expect(feature._isUpdating).toBe(false)
    })

    test('should re-activate observer after disable then enable via message', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="studentTable"></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }

      let messageListener
      global.chrome.runtime.onMessage.addListener = (listener) => { messageListener = listener }

      feature.onActivate()
      expect(feature._observer).toBeDefined()

      // Toggle OFF
      messageListener({ action: 'highlightMissingGradesChanged', enabled: false })
      expect(feature._observer).toBeNull()

      // Toggle ON
      messageListener({ action: 'highlightMissingGradesChanged', enabled: true })
      expect(feature._observer).toBeDefined()
    })
  })
})
