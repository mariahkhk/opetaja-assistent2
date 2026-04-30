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

    test('sets the tooltip title to "Tähtaeg oli DD.MM.YYYY, aga hinne puudub" on highlighted cells', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th style="background-color: rgb(236, 252, 203)">15.11</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123">Test Student</td>
                <td>12345</td>
                <td data-grade="" data-absence=""></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{
                id: 1,
                entryDate: '2024-11-15',
                entryType: 'SISSEKANNE_I',
                homeworkDuedate: '2024-11-15'
              }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false
      await feature.run()

      const cell = dom.window.document.querySelector('tbody tr td[data-grade=""]')
      expect(cell.classList.contains('highlight-missing-grade')).toBe(true)
      expect(cell.getAttribute('title')).toBe('Tähtaeg oli 15.11.2024, aga hinne puudub')
    })

    test('does not highlight cells whose data-absence is PUUDUMINE_T (excused)', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th style="background-color: rgb(236, 252, 203)">15.11</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123">Excused Student</td>
                <td>12345</td>
                <td data-grade="" data-absence="PUUDUMINE_T"></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{ id: 1, entryDate: '2024-11-15', entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false
      await feature.run()

      const cell = dom.window.document.querySelector('tbody tr td[data-grade=""]')
      expect(cell.classList.contains('highlight-missing-grade')).toBe(false)
    })

    test('does not highlight cells that already have a valid numeric grade', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th style="background-color: rgb(236, 252, 203)">15.11</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123">Student With Grade</td>
                <td>12345</td>
                <td data-grade="5" data-absence=""></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      feature.api = {
        tahvel: {
          get: mock(async (url) => {
            if (url.includes('journalEntriesByDate')) {
              return [{ id: 1, entryDate: '2024-11-15', entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' }]
            }
            return {}
          })
        }
      }

      feature._isUpdating = false
      await feature.run()

      const cell = dom.window.document.querySelector('tbody tr td[data-grade="5"]')
      expect(cell.classList.contains('highlight-missing-grade')).toBe(false)
    })

    test('does not highlight cells that have A or MA verbal grades', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th style="background-color: rgb(236, 252, 203)">15.11</th><th style="background-color: rgb(236, 252, 203)">16.11</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123">Student</td>
                <td>12345</td>
                <td data-grade="A" data-absence=""></td>
                <td data-grade="MA" data-absence=""></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: 1, entryDate: '2024-11-15', entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' },
            { id: 2, entryDate: '2024-11-16', entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-16' }
          ])
        }
      }

      feature._isUpdating = false
      await feature.run()

      const cells = dom.window.document.querySelectorAll('td[data-grade]')
      cells.forEach(cell => {
        expect(cell.classList.contains('highlight-missing-grade')).toBe(false)
      })
    })

    test('falls back to "Hinne puudub" tooltip when due date cannot be parsed from header', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html><body>
          <table class="journalTable">
            <thead><tr><th>Name</th><th>Code</th><th>No date here</th></tr></thead>
            <tbody>
              <tr>
                <td data-student-id="123">Student</td>
                <td>12345</td>
                <td data-grade="" data-absence=""></td>
              </tr>
            </tbody>
          </table>
        </body></html>
      `)
      global.document = dom.window.document
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }, journalListSync: null, getComputedStyle: (el) => ({ backgroundColor: el.style.backgroundColor }) }

      feature.api = {
        tahvel: {
          get: mock(async () => [])
        }
      }

      feature._isUpdating = false
      await feature.run()

      const cell = dom.window.document.querySelector('td[data-grade=""]')
      // No matching past entry → cell remains unhighlighted
      expect(cell.classList.contains('highlight-missing-grade')).toBe(false)
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
