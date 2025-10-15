import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { differenceRenderer, JournalSyncBannerService } from '../../../src/features/journalList/JournalSyncBanner.js'

describe('DifferenceRenderer', () => {
  let dom
  let container

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    global.window = dom.window
    global.document = dom.window.document
    global.location = { hash: '#/journals' }
    container = document.createElement('div')
  })

  describe('countNewAssignmentsObj', () => {
    test('should return 0 for null input', () => {
      expect(differenceRenderer.countNewAssignmentsObj(null)).toBe(0)
    })

    test('should return 0 for undefined input', () => {
      expect(differenceRenderer.countNewAssignmentsObj(undefined)).toBe(0)
    })

    test('should count assignments from all subjects', () => {
      const newAssignments = {
        subject1: [{ name: 'a1' }, { name: 'a2' }],
        subject2: [{ name: 'a3' }]
      }
      expect(differenceRenderer.countNewAssignmentsObj(newAssignments)).toBe(3)
    })

    test('should handle empty arrays', () => {
      const newAssignments = {
        subject1: [],
        subject2: [{ name: 'a1' }]
      }
      expect(differenceRenderer.countNewAssignmentsObj(newAssignments)).toBe(1)
    })

    test('should ignore non-array values', () => {
      const newAssignments = {
        subject1: [{ name: 'a1' }],
        subject2: 'not-array',
        subject3: null
      }
      expect(differenceRenderer.countNewAssignmentsObj(newAssignments)).toBe(1)
    })

    test('should handle errors gracefully', () => {
      const badObj = {}
      Object.defineProperty(badObj, 'toString', {
        get() {
          throw new Error('Error')
        }
      })
      expect(differenceRenderer.countNewAssignmentsObj(badObj)).toBe(0)
    })
  })

  describe('createSubjectContainer', () => {
    test('should create div with h3 title', () => {
      const result = differenceRenderer.createSubjectContainer(container, 'Math')
      expect(result.tagName).toBe('DIV')
      expect(result.querySelector('h3').textContent).toBe('Math')
    })

    test('should append to parent container', () => {
      differenceRenderer.createSubjectContainer(container, 'Science')
      expect(container.children.length).toBe(1)
    })
  })

  describe('createRow', () => {
    test('should create div with change-item class', () => {
      const result = differenceRenderer.createRow(container)
      expect(result.tagName).toBe('DIV')
      expect(result.classList.contains('change-item')).toBe(true)
    })

    test('should add data attributes when rowIdentifier provided', () => {
      const rowIdentifier = {
        journalId: 'j123',
        assignmentId: 'a456',
        type: 'grade',
        studentPersonalCode: '12345678901'
      }
      const result = differenceRenderer.createRow(container, rowIdentifier)
      expect(result.dataset.journalId).toBe('j123')
      expect(result.dataset.assignmentId).toBe('a456')
      expect(result.dataset.diffType).toBe('grade')
      expect(result.dataset.studentPersonalCode).toBe('12345678901')
    })

    test('should add status indicator element', () => {
      const result = differenceRenderer.createRow(container)
      const indicator = result.querySelector('.sync-status-indicator')
      expect(indicator).toBeDefined()
      expect(indicator.tagName).toBe('SPAN')
      expect(indicator.style.display).toBe('none')
    })

    test('should handle partial rowIdentifier', () => {
      const rowIdentifier = {
        journalId: 'j123',
        type: 'name'
      }
      const result = differenceRenderer.createRow(container, rowIdentifier)
      expect(result.dataset.journalId).toBe('j123')
      expect(result.dataset.diffType).toBe('name')
      expect(result.dataset.assignmentId).toBeUndefined()
      expect(result.dataset.studentPersonalCode).toBeUndefined()
    })
  })

  describe('createBadge', () => {
    test('should create span with badge classes', () => {
      const row = document.createElement('div')
      const result = differenceRenderer.createBadge(row, 'Test', 'badge-new')
      expect(result.tagName).toBe('SPAN')
      expect(result.classList.contains('badge')).toBe(true)
      expect(result.classList.contains('badge-new')).toBe(true)
      expect(result.textContent).toBe('Test')
    })
  })

  describe('collectAndGroupDifferences', () => {
    test('should group name differences by subject', () => {
      const assignmentNameDiffs = [
        {
          subjectName: 'Math',
          subjectExternalId: 's1',
          nameDiffs: [{ assignmentExternalId: 'a1', Tahvel: 'Old Name', kriit: 'New Name' }]
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences(assignmentNameDiffs, [], [], [], [], [], {})
      expect(result.Math).toBeDefined()
      expect(result.Math.length).toBe(1)
      expect(result.Math[0].type).toBe('name')
      expect(result.Math[0].oldValue).toBe('Old Name')
      expect(result.Math[0].newValue).toBe('New Name')
      expect(result.Math[0].journalId).toBe('s1')
      expect(result.Math[0].assignmentId).toBe('a1')
    })

    test('should handle object assignmentName with kriit property', () => {
      const assignmentNameDiffs = [
        {
          subjectName: 'Math',
          nameDiffs: [{ assignmentExternalId: 'a1', Tahvel: { kriit: 'Kriit Name', Tahvel: 'Tahvel Name' }, kriit: 'New' }]
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences(assignmentNameDiffs, [], [], [], [], [], {})
      expect(result.Math[0].oldValue).toBe('Kriit Name')
    })

    test('should handle grade differences', () => {
      const gradeDiffs = [
        {
          subjectName: 'Physics',
          subjectExternalId: 's2',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Test',
              results: [{ studentName: 'John', studentPersonalCode: '39001010001', currentGrade: '4', grade: '5' }]
            }
          ]
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], gradeDiffs, [], [], [], [], {})
      expect(result.Physics).toBeDefined()
      expect(result.Physics[0].type).toBe('grade')
      expect(result.Physics[0].studentName).toBe('John')
      expect(result.Physics[0].oldValue).toBe('4')
      expect(result.Physics[0].newValue).toBe('5')
      expect(result.Physics[0].journalId).toBe('s2')
      expect(result.Physics[0].assignmentId).toBe('a1')
      expect(result.Physics[0].studentPersonalCode).toBe('39001010001')
    })

    test('should skip grades that match', () => {
      const gradeDiffs = [
        {
          subjectName: 'Math',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Test',
              results: [{ studentName: 'John', currentGrade: '5', grade: '5' }]
            }
          ]
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], gradeDiffs, [], [], [], [], {})
      expect(result.Math).toBeUndefined()
    })

    test('should format due date differences', () => {
      const dueDateDiffs = [{ subjectName: 'Math', assignmentName: 'HW1', Tahvel: '2024-01-15', kriit: '2024-01-20', assignmentExternalId: 'a1' }]
      const result = differenceRenderer.collectAndGroupDifferences([], [], dueDateDiffs, [], [], [], {})
      expect(result.Math[0].type).toBe('duedate')
      expect(result.Math[0].oldValue).toBe('15.01.2024')
      expect(result.Math[0].newValue).toBe('20.01.2024')
    })

    test('should format entry date differences', () => {
      const entryDateDiffs = [{ subjectName: 'Science', assignmentName: 'Lab', Tahvel: '2024-02-10', kriit: '2024-02-11', assignmentExternalId: 'a1' }]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], entryDateDiffs, [], [], {})
      expect(result.Science[0].type).toBe('entrydate')
      expect(result.Science[0].oldValue).toBe('10.02.2024')
      expect(result.Science[0].newValue).toBe('11.02.2024')
    })

    test('should handle assignment hours differences', () => {
      global.window.journalListSync = {
        tahvelData: [
          {
            subjectExternalId: 's1',
            assignments: [{ assignmentExternalId: 'a1', lessons: 2 }]
          }
        ]
      }
      const assignmentHoursDiffs = [{ subjectName: 'Math', assignmentName: 'HW', subjectExternalId: 's1', assignmentExternalId: 'a1', kriitHours: 3 }]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], assignmentHoursDiffs, [], {})
      expect(result.Math[0].type).toBe('hours')
      expect(result.Math[0].oldValue).toBe('2 tundi')
      expect(result.Math[0].newValue).toBe('3 tundi')
    })

    test('should handle entry type differences with code mapping', () => {
      const entryTypeDiffs = [
        {
          subjectName: 'Programming',
          assignmentName: 'Homework 1',
          Tahvel: 'SISSEKANNE_I',
          kriit: 'SISSEKANNE_P',
          assignmentExternalId: 'a1'
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], entryTypeDiffs, {})
      expect(result.Programming).toBeDefined()
      expect(result.Programming[0].type).toBe('entrytype')
      expect(result.Programming[0].typeName).toBe('Sissekande tüüp')
      expect(result.Programming[0].oldValue).toBe('Iseseisev töö')
      expect(result.Programming[0].newValue).toBe('Praktiline töö')
    })

    test('should handle entry type difference from independent work to graded work', () => {
      const entryTypeDiffs = [
        {
          subjectName: 'Math',
          assignmentName: 'Test 1',
          Tahvel: 'SISSEKANNE_I',
          kriit: 'SISSEKANNE_H',
          assignmentExternalId: 'a2'
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], entryTypeDiffs, {})
      expect(result.Math[0].oldValue).toBe('Iseseisev töö')
      expect(result.Math[0].newValue).toBe('Hindeline töö')
    })

    test('should handle entry type difference from lesson to practical work', () => {
      const entryTypeDiffs = [
        {
          subjectName: 'Science',
          assignmentName: 'Lab Work',
          Tahvel: 'SISSEKANNE_L',
          kriit: 'SISSEKANNE_P',
          assignmentExternalId: 'a3'
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], entryTypeDiffs, {})
      expect(result.Science[0].oldValue).toBe('Tund')
      expect(result.Science[0].newValue).toBe('Praktiline töö')
    })

    test('should handle null entry type as puudub', () => {
      const entryTypeDiffs = [
        {
          subjectName: 'History',
          assignmentName: 'Essay',
          Tahvel: null,
          kriit: 'SISSEKANNE_I',
          assignmentExternalId: 'a4'
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], entryTypeDiffs, {})
      expect(result.History[0].oldValue).toBe('puudub')
      expect(result.History[0].newValue).toBe('Iseseisev töö')
    })

    test('should handle unknown entry type codes by showing the code', () => {
      const entryTypeDiffs = [
        {
          subjectName: 'Art',
          assignmentName: 'Project',
          Tahvel: 'SISSEKANNE_UNKNOWN',
          kriit: 'SISSEKANNE_P',
          assignmentExternalId: 'a5'
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], entryTypeDiffs, {})
      expect(result.Art[0].oldValue).toBe('SISSEKANNE_UNKNOWN')
      expect(result.Art[0].newValue).toBe('Praktiline töö')
    })

    test('should use updated assignment name for entry type differences', () => {
      const assignmentNameDiffs = [
        {
          subjectName: 'Math',
          nameDiffs: [{ assignmentExternalId: 'a1', Tahvel: 'Old Name', kriit: 'New Name' }]
        }
      ]
      const entryTypeDiffs = [
        {
          subjectName: 'Math',
          assignmentName: 'Old Name',
          Tahvel: 'SISSEKANNE_I',
          kriit: 'SISSEKANNE_P',
          assignmentExternalId: 'a1'
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences(assignmentNameDiffs, [], [], [], [], entryTypeDiffs, {})
      // Should have both name and entry type differences
      expect(result.Math.length).toBe(2)
      // Entry type diff should use the new name
      const entryTypeDiff = result.Math.find(d => d.type === 'entrytype')
      expect(entryTypeDiff.assignmentName).toBe('New Name')
    })

    test('should handle new assignments', () => {
      const newAssignments = {
        sub1: [{ assignmentName: 'New Task', assignmentEntryDate: '2024-01-01', assignmentDueAt: '2024-01-15' }]
      }
      global.window.journalListSync = {
        differences: [{ subjectExternalId: 'sub1', subjectName: 'Math' }]
      }
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], [], newAssignments)
      expect(result.Math[0].type).toBe('new')
      expect(result.Math[0].assignmentName).toBe('New Task')
      expect(result.Math[0].entryDate).toBe('01.01.2024')
      expect(result.Math[0].dueDate).toBe('15.01.2024')
    })

    test('should use fallback subject name for new assignments', () => {
      const newAssignments = {
        unknown: [{ assignmentName: 'Task' }]
      }
      const result = differenceRenderer.collectAndGroupDifferences([], [], [], [], [], [], newAssignments)
      expect(result['Päevik unknown']).toBeDefined()
    })

    test('should handle null values with puudub', () => {
      const gradeDiffs = [
        {
          subjectName: 'Math',
          assignments: [
            {
              assignmentExternalId: 'a1',
              assignmentName: 'Test',
              results: [{ studentName: 'John', currentGrade: null, grade: '5' }]
            }
          ]
        }
      ]
      const result = differenceRenderer.collectAndGroupDifferences([], gradeDiffs, [], [], [], [], {})
      expect(result.Math[0].oldValue).toBe('puudub')
      expect(result.Math[0].newValue).toBe('5')
    })
  })

  describe('render', () => {
    test('should not render if not on journals page', () => {
      global.location.hash = '#/other'
      differenceRenderer.render(container, [], [], [], [], [], {})
      expect(container.children.length).toBe(0)
    })
  })
})

describe('JournalSyncBannerService', () => {
  let service

  beforeEach(() => {
    service = new JournalSyncBannerService()
  })

  describe('constructor', () => {
    test('should initialize with stylesLoaded as false', () => {
      const newService = new JournalSyncBannerService()
      expect(newService.stylesLoaded).toBe(false)
    })
  })

  describe('loadSyncStyles', () => {
    test('should load styles only once', () => {
      service.stylesLoaded = false
      service.loadSyncStyles()
      expect(service.stylesLoaded).toBe(true)
      service.loadSyncStyles()
      expect(service.stylesLoaded).toBe(true)
    })

    test('should not load if document is undefined', () => {
      const oldDoc = global.document
      global.document = undefined
      service.stylesLoaded = false
      service.loadSyncStyles()
      expect(service.stylesLoaded).toBe(false)
      global.document = oldDoc
    })

    test('should mark styles as loaded when called with document', () => {
      global.document = {}
      service.stylesLoaded = false
      service.loadSyncStyles()
      expect(service.stylesLoaded).toBe(true)
    })
  })

  describe('updateItemSyncStatus', () => {
    let dom
    let container

    beforeEach(() => {
      dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.window = dom.window
      global.document = dom.window.document

      // Create a banner container with some test rows
      container = document.createElement('div')
      container.classList.add('ta-sync-banner-container')
      document.body.appendChild(container)
    })

    test('should update status indicator for successful sync', () => {
      const row = document.createElement('div')
      row.classList.add('change-item')
      row.dataset.journalId = 'j123'
      row.dataset.assignmentId = 'a456'
      row.dataset.diffType = 'name'

      const indicator = document.createElement('span')
      indicator.classList.add('sync-status-indicator')
      indicator.style.display = 'none'
      row.appendChild(indicator)
      container.appendChild(row)

      service.updateItemSyncStatus('j123', 'a456', 'name', true)

      expect(indicator.textContent).toBe('✅')
      expect(indicator.style.display).toBe('inline-block')
      expect(indicator.title).toBe('Sünkroniseeritud')
    })

    test('should update status indicator for failed sync', () => {
      const row = document.createElement('div')
      row.classList.add('change-item')
      row.dataset.journalId = 'j123'
      row.dataset.assignmentId = 'a456'
      row.dataset.diffType = 'duedate'

      const indicator = document.createElement('span')
      indicator.classList.add('sync-status-indicator')
      indicator.style.display = 'none'
      row.appendChild(indicator)
      container.appendChild(row)

      service.updateItemSyncStatus('j123', 'a456', 'duedate', false)

      expect(indicator.textContent).toBe('❌')
      expect(indicator.style.display).toBe('inline-block')
      expect(indicator.title).toBe('Sünkroniseerimine ebaõnnestus')
    })

    test('should update grade status for specific student', () => {
      // Create row for student 1
      const row1 = document.createElement('div')
      row1.classList.add('change-item')
      row1.dataset.journalId = 'j123'
      row1.dataset.assignmentId = 'a456'
      row1.dataset.diffType = 'grade'
      row1.dataset.studentPersonalCode = '39001010001'
      const indicator1 = document.createElement('span')
      indicator1.classList.add('sync-status-indicator')
      row1.appendChild(indicator1)
      container.appendChild(row1)

      // Create row for student 2
      const row2 = document.createElement('div')
      row2.classList.add('change-item')
      row2.dataset.journalId = 'j123'
      row2.dataset.assignmentId = 'a456'
      row2.dataset.diffType = 'grade'
      row2.dataset.studentPersonalCode = '39002020002'
      const indicator2 = document.createElement('span')
      indicator2.classList.add('sync-status-indicator')
      row2.appendChild(indicator2)
      container.appendChild(row2)

      // Update only student 1
      service.updateItemSyncStatus('j123', 'a456', 'grade', true, '39001010001')

      expect(indicator1.textContent).toBe('✅')
      expect(indicator2.textContent).toBe('') // Should not be updated
    })

    test('should update multiple rows with same identifier', () => {
      // Create two rows with same identifiers
      const row1 = document.createElement('div')
      row1.classList.add('change-item')
      row1.dataset.journalId = 'j123'
      row1.dataset.assignmentId = 'a456'
      row1.dataset.diffType = 'entrydate'
      const indicator1 = document.createElement('span')
      indicator1.classList.add('sync-status-indicator')
      row1.appendChild(indicator1)
      container.appendChild(row1)

      const row2 = document.createElement('div')
      row2.classList.add('change-item')
      row2.dataset.journalId = 'j123'
      row2.dataset.assignmentId = 'a456'
      row2.dataset.diffType = 'entrydate'
      const indicator2 = document.createElement('span')
      indicator2.classList.add('sync-status-indicator')
      row2.appendChild(indicator2)
      container.appendChild(row2)

      service.updateItemSyncStatus('j123', 'a456', 'entrydate', true)

      expect(indicator1.textContent).toBe('✅')
      expect(indicator2.textContent).toBe('✅')
    })

    test('should handle missing status indicator gracefully', () => {
      const row = document.createElement('div')
      row.classList.add('change-item')
      row.dataset.journalId = 'j123'
      row.dataset.assignmentId = 'a456'
      row.dataset.diffType = 'hours'
      // No indicator added
      container.appendChild(row)

      // Should not throw
      expect(() => {
        service.updateItemSyncStatus('j123', 'a456', 'hours', true)
      }).not.toThrow()
    })

    test('should handle non-existent rows gracefully', () => {
      // Should not throw when no matching rows
      expect(() => {
        service.updateItemSyncStatus('nonexistent', 'fake', 'name', true)
      }).not.toThrow()
    })
  })

})
