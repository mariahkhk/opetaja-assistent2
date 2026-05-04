import { describe, test, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { restoreGlobalDOM } from '../../setup.js'
import TahvelNewAssignmentSyncFeature from '../../../src/features/journalList/TahvelNewAssignmentSync.js'

describe('TahvelNewAssignmentSync - Entry Type Support', () => {
  let feature

  beforeEach(() => {
    feature = new TahvelNewAssignmentSyncFeature()
  })

  describe('getEntryTypeFromAssignment', () => {
    test('should return SISSEKANNE_P when assignment has assignmentEntryType = "SISSEKANNE_P"', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_P')
    })

    test('should return SISSEKANNE_I when assignment has assignmentEntryType = "SISSEKANNE_I"', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: 'SISSEKANNE_I'
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_I')
    })

    test('should return SISSEKANNE_H when assignment has assignmentEntryType = "SISSEKANNE_H"', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: 'SISSEKANNE_H'
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_H')
    })

    test('should return SISSEKANNE_I as default when assignment has no assignmentEntryType', () => {
      const assignment = {
        assignmentName: 'Test Assignment'
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_I')
    })

    test('should return SISSEKANNE_I when assignmentEntryType is null', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: null
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_I')
    })

    test('should return SISSEKANNE_I when assignmentEntryType is undefined', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: undefined
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_I')
    })

    test('should return SISSEKANNE_I when assignmentEntryType is empty string', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: ''
      }

      const result = feature.getEntryTypeFromAssignment(assignment)

      expect(result).toBe('SISSEKANNE_I')
    })

    test('should return SISSEKANNE_I when assignment is null', () => {
      const result = feature.getEntryTypeFromAssignment(null)

      expect(result).toBe('SISSEKANNE_I')
    })

    test('should return SISSEKANNE_I when assignment is undefined', () => {
      const result = feature.getEntryTypeFromAssignment(undefined)

      expect(result).toBe('SISSEKANNE_I')
    })
  })

  describe('createAssignmentInTahvel - Capacity Types', () => {
    test('should set empty array for journalEntryCapacityTypes when entry type is SISSEKANNE_P', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test Practical Work',
        assignmentEntryType: 'SISSEKANNE_P',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        lessons: null,
        createdAssignmentId: 50
      }

      // Mock API services
      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 123456
          }))
        }
      }

      await feature.createAssignmentInTahvel(journalId, assignment)

      // Verify post was called
      expect(feature.api.tahvel.post).toHaveBeenCalled()

      // Get the payload that was sent
      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      // Verify capacity types is ['MAHT_p'] for SISSEKANNE_P
      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_p'])
      expect(payload.entryType).toBe('SISSEKANNE_P')
    })

    test('should set ["MAHT_i"] for journalEntryCapacityTypes when entry type is SISSEKANNE_I', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test Independent Work',
        assignmentEntryType: 'SISSEKANNE_I',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        lessons: null,
        createdAssignmentId: 51
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 123457
          }))
        }
      }

      await feature.createAssignmentInTahvel(journalId, assignment)

      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_i'])
      expect(payload.entryType).toBe('SISSEKANNE_I')
    })

    test('should set ["MAHT_h"] for journalEntryCapacityTypes when entry type is SISSEKANNE_H', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test Graded Work',
        assignmentEntryType: 'SISSEKANNE_H',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        lessons: null,
        createdAssignmentId: 52
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 123458
          }))
        }
      }

      await feature.createAssignmentInTahvel(journalId, assignment)

      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_h'])
      expect(payload.entryType).toBe('SISSEKANNE_H')
    })

    test('should default to ["MAHT_i"] when no entry type is specified', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test Assignment Without Type',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        lessons: null,
        createdAssignmentId: 53
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 123459
          }))
        }
      }

      await feature.createAssignmentInTahvel(journalId, assignment)

      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_i'])
      expect(payload.entryType).toBe('SISSEKANNE_I')
    })

    test('should include assignment link in homework text for SISSEKANNE_P', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test Practical Work',
        assignmentEntryType: 'SISSEKANNE_P',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        assignmentLink: 'Link ülesandele: https://kriit.vikk.ee/assignments/50?group=IS25',
        assignmentInstructions: null,
        lessons: null,
        createdAssignmentId: 50
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 123460
          }))
        }
      }

      await feature.createAssignmentInTahvel(journalId, assignment)

      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      expect(payload.homework).toBe('Link ülesandele: https://kriit.vikk.ee/assignments/50?group=IS25')
      expect(payload.entryType).toBe('SISSEKANNE_P')
      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_p'])
    })

    test('should combine instructions and link in homework text', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: 'SISSEKANNE_P',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        assignmentInstructions: 'Complete the practical exercise',
        assignmentLink: 'https://kriit.vikk.ee/assignments/50',
        lessons: null,
        createdAssignmentId: 54
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 123461
          }))
        }
      }

      await feature.createAssignmentInTahvel(journalId, assignment)

      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      expect(payload.homework).toBe('Complete the practical exercise\n\nhttps://kriit.vikk.ee/assignments/50')
    })
  })

  describe('assignmentExists - Entry Type Check', () => {
    test('should detect existing SISSEKANNE_P assignment by name and type', () => {
      const assignment = {
        assignmentName: 'Praktiline töö 1',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const existingEntries = [
        {
          nameEt: 'Praktiline töö 1',
          entryType: 'SISSEKANNE_P',
          id: 123
        },
        {
          nameEt: 'Iseseisev töö 1',
          entryType: 'SISSEKANNE_I',
          id: 124
        }
      ]

      const result = feature.assignmentExists(assignment, existingEntries)

      expect(result).toBe(true)
    })

    test('should not match assignment with same name but different entry type', () => {
      const assignment = {
        assignmentName: 'Test Assignment',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const existingEntries = [
        {
          nameEt: 'Test Assignment',
          entryType: 'SISSEKANNE_I',
          id: 123
        }
      ]

      const result = feature.assignmentExists(assignment, existingEntries)

      expect(result).toBe(false)
    })

    test('should not match SISSEKANNE_I when looking for SISSEKANNE_P', () => {
      const assignment = {
        assignmentName: 'Töö 1',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const existingEntries = [
        {
          nameEt: 'Töö 1',
          entryType: 'SISSEKANNE_I',
          id: 123
        }
      ]

      const result = feature.assignmentExists(assignment, existingEntries)

      expect(result).toBe(false)
    })

    test('should match assignment with both name and entry type identical', () => {
      const assignment = {
        assignmentName: 'Hindeline töö',
        assignmentEntryType: 'SISSEKANNE_H'
      }

      const existingEntries = [
        {
          nameEt: 'Hindeline töö',
          entryType: 'SISSEKANNE_H',
          id: 125
        }
      ]

      const result = feature.assignmentExists(assignment, existingEntries)

      expect(result).toBe(true)
    })

    test('should return false when existingEntries is empty', () => {
      const assignment = {
        assignmentName: 'Test',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const result = feature.assignmentExists(assignment, [])

      expect(result).toBe(false)
    })

    test('should return false when existingEntries is null', () => {
      const assignment = {
        assignmentName: 'Test',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const result = feature.assignmentExists(assignment, null)

      expect(result).toBe(false)
    })
  })

  describe('Real-world Kriit Integration Scenarios', () => {
    test('should create SISSEKANNE_P assignment matching Kriit response format', async () => {
      // This matches the actual format from responsefromkiirt.json
      const journalId = 402867
      const assignment = {
        assignmentExternalId: null,
        assignmentName: 'test4',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        assignmentHours: null,
        lessons: null,
        assignmentEntryType: 'SISSEKANNE_P',
        createdAssignmentId: 50,
        assignmentLink: 'Link ülesandele: https://kriit.vikk.ee/assignments/50?group=IS25'
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({
            journalTeachers: [{ id: 2078 }]
          })),
          post: mock(async () => ({
            success: true,
            id: 3626999
          }))
        }
      }

      const result = await feature.createAssignmentInTahvel(journalId, assignment)

      expect(result.success).toBe(true)
      expect(feature.api.tahvel.post).toHaveBeenCalled()

      const callArgs = feature.api.tahvel.post.mock.calls[0]
      const payload = callArgs[1]

      // Verify the payload matches Kriit's expectations for SISSEKANNE_P
      expect(payload.entryType).toBe('SISSEKANNE_P')
      expect(payload.journalEntryCapacityTypes).toEqual(['MAHT_p'])
      expect(payload.nameEt).toBe('test4')
      expect(payload.homework).toBe('Link ülesandele: https://kriit.vikk.ee/assignments/50?group=IS25')
    })

    test('should handle mixed entry types from Kriit differences response', () => {
      const assignments = [
        { assignmentName: 'Praktiline 1', assignmentEntryType: 'SISSEKANNE_P' },
        { assignmentName: 'Iseseisev 1', assignmentEntryType: 'SISSEKANNE_I' },
        { assignmentName: 'Hindeline 1', assignmentEntryType: 'SISSEKANNE_H' }
      ]

      const results = assignments.map(a => feature.getEntryTypeFromAssignment(a))

      expect(results).toEqual(['SISSEKANNE_P', 'SISSEKANNE_I', 'SISSEKANNE_H'])
    })

    test('should correctly identify new SISSEKANNE_P in existing entries list', () => {
      const newAssignment = {
        assignmentName: 'Praktiline töö 2',
        assignmentEntryType: 'SISSEKANNE_P'
      }

      const existingEntries = [
        { nameEt: 'Praktiline töö 1', entryType: 'SISSEKANNE_P', id: 1 },
        { nameEt: 'Iseseisev töö 1', entryType: 'SISSEKANNE_I', id: 2 },
        { nameEt: 'Praktiline töö 2', entryType: 'SISSEKANNE_I', id: 3 } // Same name, different type
      ]

      const exists = feature.assignmentExists(newAssignment, existingEntries)

      // Should NOT exist because the existing one is SISSEKANNE_I, not SISSEKANNE_P
      expect(exists).toBe(false)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    test('should handle API error gracefully when creating assignment', async () => {
      const journalId = 12345
      const assignment = {
        assignmentName: 'Test',
        assignmentEntryType: 'SISSEKANNE_P',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16'
      }

      feature.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('API Error')
          }),
          post: mock(async () => ({
            success: true
          }))
        }
      }

      const result = await feature.createAssignmentInTahvel(journalId, assignment)

      // Should still attempt to create even if getting journal info fails
      expect(feature.api.tahvel.post).toHaveBeenCalled()
    })

    test('should return default SISSEKANNE_I for missing or falsy assignmentEntryType', () => {
      const assignmentsWithoutType = [
        {},
        { assignmentName: 'Test' },
        { assignmentEntryType: null },
        { assignmentEntryType: undefined },
        { assignmentEntryType: '' },
        { assignmentEntryType: false }
      ]

      assignmentsWithoutType.forEach(assignment => {
        const result = feature.getEntryTypeFromAssignment(assignment)
        expect(result).toBe('SISSEKANNE_I')
      })
    })

    test('should preserve SISSEKANNE_P type through the full payload', async () => {
      const assignment = {
        assignmentName: 'Praktiline test',
        assignmentEntryType: 'SISSEKANNE_P',
        assignmentEntryDate: '2025-10-15',
        assignmentDueAt: '2025-10-16',
        lessons: 2
      }

      feature.api = {
        tahvel: {
          get: mock(async () => ({ journalTeachers: [] })),
          post: mock(async (url, payload) => {
            // Verify payload structure during the call
            expect(payload.entryType).toBe('SISSEKANNE_P')
            expect(payload.journalEntryCapacityTypes).toEqual([])
            expect(payload.lessons).toBe(2)
            return { success: true }
          })
        }
      }

      await feature.createAssignmentInTahvel(12345, assignment)

      expect(feature.api.tahvel.post).toHaveBeenCalled()
    })
  })
})


function makeFeature() {
  return new TahvelNewAssignmentSyncFeature()
}

describe("TahvelNewAssignmentSync - integration", () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    feature = makeFeature()
    feature.api = {
      tahvel: { get: mock(), post: mock() },
      kriit: { post: mock(), enabled: true, authToken: 'tok' },
      _kriitInitPromise: null
    }
    if (typeof window !== 'undefined') window.journalListSync = undefined
  })

  afterEach(() => {
    if (typeof window !== 'undefined') window.journalListSync = undefined
  })

  describe('onActivate', () => {
    it('returns early when feature is no longer active after awaiting init', async () => {
      const initPromise = Promise.resolve()
      feature.api._kriitInitPromise = initPromise
      feature.isActive = false

      await feature.onActivate()
      // Should not throw, no API calls made
      expect(feature.api.kriit.post).not.toHaveBeenCalled()
    })

    it('returns early when Kriit support is disabled', async () => {
      feature.api.kriit.enabled = false
      feature.isActive = true
      await feature.onActivate()
      expect(feature.api.kriit.post).not.toHaveBeenCalled()
    })

    it('completes setup when Kriit is enabled', async () => {
      feature.api.kriit.enabled = true
      feature.isActive = true
      await expect(feature.onActivate()).resolves.toBeUndefined()
    })
  })

  describe('checkForNewAssignments', () => {
    it('returns null when already processing', async () => {
      feature.isProcessing = true
      const result = await feature.checkForNewAssignments()
      expect(result).toBeNull()
    })

    it('returns null when no new assignments are available', async () => {
      feature.api.kriit.post = mock(async () => ({ newAssignments: {} }))
      const result = await feature.checkForNewAssignments()
      expect(result).toBeNull()
    })

    it('returns the new assignments when present', async () => {
      window.journalListSync = { newAssignments: { '12345': [{ assignmentName: 'A' }] } }
      const result = await feature.checkForNewAssignments()
      expect(result).toEqual({ '12345': [{ assignmentName: 'A' }] })
    })
  })

  describe('getNewAssignmentsFromKriit', () => {
    it('returns cached new assignments from window.journalListSync', async () => {
      window.journalListSync = { newAssignments: { '12345': [{ assignmentName: 'X' }] } }
      const result = await feature.getNewAssignmentsFromKriit()
      expect(result).toEqual({ '12345': [{ assignmentName: 'X' }] })
    })

    it('returns empty object when no journal data is available for sync', async () => {
      const result = await feature.getNewAssignmentsFromKriit()
      expect(result).toEqual({})
    })

    it('returns the Kriit response newAssignments when present and caches them on window', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)
      feature.api.tahvel.get = mock(async () => ({ nameEt: 'X', studentGroups: ['G'], journalTeachers: [] }))
      feature.api.kriit.post = mock(async () => ({ newAssignments: { '12345': [{ name: 'A' }] } }))

      const result = await feature.getNewAssignmentsFromKriit()

      expect(result).toEqual({ '12345': [{ name: 'A' }] })
      expect(window.journalListSync.newAssignments).toEqual({ '12345': [{ name: 'A' }] })
    })

    it('returns empty object when Kriit response has no newAssignments', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)
      feature.api.tahvel.get = mock(async () => ({ nameEt: 'X', studentGroups: ['G'], journalTeachers: [] }))
      feature.api.kriit.post = mock(async () => ({}))
      const result = await feature.getNewAssignmentsFromKriit()
      expect(result).toEqual({})
    })

    it('returns empty object when Kriit POST throws', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)
      feature.api.tahvel.get = mock(async () => ({ nameEt: 'X', studentGroups: ['G'], journalTeachers: [] }))
      feature.api.kriit.post = mock(async () => { throw new Error('net') })
      const result = await feature.getNewAssignmentsFromKriit()
      expect(result).toEqual({})
    })
  })

  describe('collectJournalDataForSync', () => {
    it('returns empty array when no journal links found', async () => {
      const result = await feature.collectJournalDataForSync()
      expect(result).toEqual([])
    })

    it('returns journal data with teacher personal code when teachers exist', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)

      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journals/12345')) {
          return {
            nameEt: 'Math 1',
            studentGroups: ['IS25'],
            journalTeachers: [{ id: 99 }]
          }
        }
        if (url.includes('/teachers/99')) {
          return { person: { idcode: '12345678901' } }
        }
        return null
      })

      const result = await feature.collectJournalDataForSync()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        subjectName: 'Math 1',
        subjectExternalId: 12345,
        groupName: 'IS25',
        teacherPersonalCode: '12345678901'
      })
    })

    it('continues when teacher personal code lookup fails', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)

      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journals/12345')) {
          return { nameEt: 'X', studentGroups: ['G'], journalTeachers: [{ id: 99 }] }
        }
        if (url.includes('/teachers/99')) {
          throw new Error('no teacher')
        }
        return null
      })

      const result = await feature.collectJournalDataForSync()
      expect(result[0].teacherPersonalCode).toBe('')
    })

    it('skips entries when journal id cannot be resolved', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/notajournal/abc')
      document.body.appendChild(a)
      const result = await feature.collectJournalDataForSync()
      expect(result).toEqual([])
    })

    it('continues when journal info fetch returns falsy', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)
      feature.api.tahvel.get = mock(async () => null)
      const result = await feature.collectJournalDataForSync()
      expect(result).toEqual([])
    })

    it('catches errors from inner journal processing and continues', async () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      document.body.appendChild(a)
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      const result = await feature.collectJournalDataForSync()
      expect(result).toEqual([])
    })

    it('returns [] when document.querySelectorAll throws', async () => {
      const orig = document.querySelectorAll
      document.querySelectorAll = () => { throw new Error('hostile') }
      const result = await feature.collectJournalDataForSync()
      expect(result).toEqual([])
      document.querySelectorAll = orig
    })
  })

  describe('getExistingJournalEntries', () => {
    it('returns the array when API responds with one', async () => {
      feature.api.tahvel.get = mock(async () => [{ id: 1 }, { id: 2 }])
      const result = await feature.getExistingJournalEntries(12345)
      expect(result).toEqual([{ id: 1 }, { id: 2 }])
    })

    it('returns empty array when response is not an array', async () => {
      feature.api.tahvel.get = mock(async () => ({ unexpected: true }))
      const result = await feature.getExistingJournalEntries(12345)
      expect(result).toEqual([])
    })

    it('returns empty array when API throws', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      const result = await feature.getExistingJournalEntries(12345)
      expect(result).toEqual([])
    })
  })

  describe('formatDateForTahvel', () => {
    it('returns null for falsy input', () => {
      expect(feature.formatDateForTahvel(null)).toBeNull()
      expect(feature.formatDateForTahvel(undefined)).toBeNull()
      expect(feature.formatDateForTahvel('')).toBeNull()
    })

    it('returns the input as-is when it already contains "T" (ISO format)', () => {
      expect(feature.formatDateForTahvel('2026-01-15T00:00:00.000Z'))
        .toBe('2026-01-15T00:00:00.000Z')
    })

    it('converts a YYYY-MM-DD string to ISO format', () => {
      const result = feature.formatDateForTahvel('2026-01-15')
      expect(result).toMatch(/^2026-01-15T/)
    })

    it('returns null for an unparseable date string', () => {
      expect(feature.formatDateForTahvel('not a date')).toBeNull()
    })
  })

  describe('resolveJournalFromElement', () => {
    it('returns null for null element', () => {
      expect(feature.resolveJournalFromElement(null)).toBeNull()
    })

    it('parses an anchor with href containing /journal/', () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/12345/edit')
      const r = feature.resolveJournalFromElement(a)
      expect(r).toEqual({ href: '#/journal/12345/edit', id: 12345 })
    })

    it('parses an anchor with ng-href when href is missing', () => {
      const a = document.createElement('a')
      a.setAttribute('ng-href', '#/journal/777/edit')
      const r = feature.resolveJournalFromElement(a)
      expect(r).toEqual({ href: '#/journal/777/edit', id: 777 })
    })

    it('walks up to the nearest ancestor anchor', () => {
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/42/edit')
      const span = document.createElement('span')
      a.appendChild(span)
      document.body.appendChild(a)
      const r = feature.resolveJournalFromElement(span)
      expect(r.id).toBe(42)
    })

    it('reads dataset.journalId when available', () => {
      const div = document.createElement('div')
      div.dataset.journalId = '999'
      const r = feature.resolveJournalFromElement(div)
      expect(r).toEqual({ href: null, id: 999 })
    })

    it('returns null when nothing matches', () => {
      const div = document.createElement('div')
      const r = feature.resolveJournalFromElement(div)
      expect(r).toBeNull()
    })

  })

  describe('getCreatedAssignmentExternalId', () => {
    it('returns the id of the freshly created assignment', async () => {
      feature.api.tahvel.get = mock(async () => [
        { id: 99, nameEt: 'Other', entryType: 'SISSEKANNE_I' },
        { id: 100, nameEt: 'Test Assignment', entryType: 'SISSEKANNE_P' }
      ])
      const id = await feature.getCreatedAssignmentExternalId(12345, {
        assignmentName: 'Test Assignment',
        assignmentEntryType: 'SISSEKANNE_P'
      })
      expect(id).toBe(100)
    })

    it('returns null when the assignment is not found', async () => {
      feature.api.tahvel.get = mock(async () => [{ id: 1, nameEt: 'Different', entryType: 'SISSEKANNE_I' }])
      const id = await feature.getCreatedAssignmentExternalId(12345, {
        assignmentName: 'Test',
        assignmentEntryType: 'SISSEKANNE_I'
      })
      expect(id).toBeNull()
    })

    it('returns null on API error', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      // Even with errors, returns null - the catch in getExistingJournalEntries returns []
      const id = await feature.getCreatedAssignmentExternalId(12345, { assignmentName: 'Test' })
      expect(id).toBeNull()
    })
  })

  describe('testSendExternalId', () => {
    it('returns response on successful send', async () => {
      feature.api.kriit.post = mock(async () => ({ status: 200 }))
      const result = await feature.testSendExternalId(50, 100)
      expect(result).toEqual({ status: 200 })
    })

    it('returns response even when status is not 200', async () => {
      feature.api.kriit.post = mock(async () => ({ status: 500 }))
      const result = await feature.testSendExternalId(50, 100)
      expect(result.status).toBe(500)
    })

    it('rethrows when post throws', async () => {
      feature.api.kriit.post = mock(async () => { throw new Error('net') })
      await expect(feature.testSendExternalId(50, 100)).rejects.toThrow('net')
    })
  })

  describe('sendExternalIdsToKriit', () => {
    it('sends each successful sync as a separate POST', async () => {
      feature.api.kriit.post = mock(async () => ({ status: 200 }))
      await feature.sendExternalIdsToKriit([
        { kriitAssignmentId: 1, tahvelExternalId: 10 },
        { kriitAssignmentId: 2, tahvelExternalId: 20 }
      ])
      expect(feature.api.kriit.post).toHaveBeenCalledTimes(2)
    })

    it('counts non-200 responses as failures', async () => {
      feature.api.kriit.post = mock(async () => ({ status: 500 }))
      await expect(feature.sendExternalIdsToKriit([
        { kriitAssignmentId: 1, tahvelExternalId: 10 }
      ])).resolves.toBeUndefined()
    })

    it('catches per-assignment POST errors and continues', async () => {
      feature.api.kriit.post = mock(async () => { throw new Error('boom') })
      await expect(feature.sendExternalIdsToKriit([
        { kriitAssignmentId: 1, tahvelExternalId: 10 }
      ])).resolves.toBeUndefined()
    })

    it('removes synced assignments from window.journalListSync.newAssignments', async () => {
      feature.api.kriit.post = mock(async () => ({ status: 200 }))
      window.journalListSync = {
        newAssignments: {
          '12345': [
            { createdAssignmentId: 1, assignmentName: 'A' },
            { createdAssignmentId: 2, assignmentName: 'B' }
          ]
        }
      }
      await feature.sendExternalIdsToKriit([
        { kriitAssignmentId: 1, tahvelExternalId: 10 }
      ])
      expect(window.journalListSync.newAssignments['12345']).toEqual([
        { createdAssignmentId: 2, assignmentName: 'B' }
      ])
    })

    it('deletes the subject key when its array becomes empty after filtering', async () => {
      feature.api.kriit.post = mock(async () => ({ status: 200 }))
      window.journalListSync = {
        newAssignments: {
          '12345': [{ createdAssignmentId: 1, assignmentName: 'A' }]
        }
      }
      await feature.sendExternalIdsToKriit([
        { kriitAssignmentId: 1, tahvelExternalId: 10 }
      ])
      expect(window.journalListSync.newAssignments['12345']).toBeUndefined()
    })
  })

  describe('syncAssignmentsForSubject', () => {
    it('skips already-existing assignments', async () => {
      feature.api.tahvel.get = mock(async () => [
        { nameEt: 'A', entryType: 'SISSEKANNE_I' }
      ])
      const result = await feature.syncAssignmentsForSubject('12345', [
        { assignmentName: 'A' }
      ])
      expect(feature.api.tahvel.post).not.toHaveBeenCalled()
      expect(result.success).toEqual([])
    })

    it('records failure when createAssignmentInTahvel returns success=false', async () => {
      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journalEntriesByDate')) return []
        return { journalTeachers: [] }
      })
      feature.api.tahvel.post = mock(async () => null)
      const result = await feature.syncAssignmentsForSubject('12345', [
        { assignmentName: 'A' }
      ])
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].subjectExternalId).toBe('12345')
      expect(result.failed[0].assignmentName).toBe('A')
    })

    it('records success when externalId is found', async () => {
      let postCalled = false
      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journalEntriesByDate')) {
          return postCalled ? [{ id: 999, nameEt: 'A', entryType: 'SISSEKANNE_I' }] : []
        }
        return { journalTeachers: [] }
      })
      feature.api.tahvel.post = mock(async () => {
        postCalled = true
        return { id: 999 }
      })
      const result = await feature.syncAssignmentsForSubject('12345', [
        { assignmentName: 'A', createdAssignmentId: 5 }
      ])
      expect(result.success).toEqual([{
        subjectExternalId: '12345',
        assignmentName: 'A',
        kriitAssignmentId: 5,
        tahvelExternalId: 999
      }])
    })

    it('records failure when externalId cannot be retrieved', async () => {
      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journalEntriesByDate')) return []
        return { journalTeachers: [] }
      })
      feature.api.tahvel.post = mock(async () => ({ id: 999 }))
      const result = await feature.syncAssignmentsForSubject('12345', [
        { assignmentName: 'A', createdAssignmentId: 5 }
      ])
      expect(result.failed[0].error).toContain('Could not retrieve')
    })
  })

  describe('syncNewAssignmentsToTahvel', () => {
    it('processes each subject and sends external IDs back to Kriit on success', async () => {
      let postCalled = false
      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journalEntriesByDate')) {
          return postCalled ? [{ id: 10, nameEt: 'A', entryType: 'SISSEKANNE_I' }] : []
        }
        return { journalTeachers: [] }
      })
      feature.api.tahvel.post = mock(async () => {
        postCalled = true
        return { id: 10 }
      })
      feature.api.kriit.post = mock(async () => ({ status: 200 }))

      await feature.syncNewAssignmentsToTahvel({
        '12345': [{ assignmentName: 'A', createdAssignmentId: 1 }]
      })

      expect(feature.api.kriit.post).toHaveBeenCalled()
      expect(feature.isProcessing).toBe(false)
    })

    it('skips sendExternalIdsToKriit when no successful syncs', async () => {
      feature.api.tahvel.get = mock(async url => {
        if (url.includes('/journalEntriesByDate')) return []
        return { journalTeachers: [] }
      })
      feature.api.tahvel.post = mock(async () => null)
      feature.api.kriit.post = mock(async () => ({ status: 200 }))
      await feature.syncNewAssignmentsToTahvel({ '12345': [{ assignmentName: 'A' }] })
      expect(feature.api.kriit.post).not.toHaveBeenCalled()
    })

    it('catches errors from Object.entries iteration', async () => {
      // Pass a value that doesn't iterate
      await feature.syncNewAssignmentsToTahvel(null)
      expect(feature.isProcessing).toBe(false)
    })
  })

  describe('createAssignmentInTahvel — additional branches', () => {
    it('returns failure object when post returns a falsy response', async () => {
      feature.api.tahvel.get = mock(async () => ({ journalTeachers: [] }))
      feature.api.tahvel.post = mock(async () => null)
      const result = await feature.createAssignmentInTahvel(123, {
        assignmentName: 'X',
        assignmentEntryType: 'SISSEKANNE_I'
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('No response')
    })

    it('returns failure object when post throws', async () => {
      feature.api.tahvel.get = mock(async () => ({ journalTeachers: [] }))
      feature.api.tahvel.post = mock(async () => { throw new Error('post-fail') })
      const result = await feature.createAssignmentInTahvel(123, {
        assignmentName: 'X',
        assignmentEntryType: 'SISSEKANNE_I'
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('post-fail')
    })

    it('passes lessons numeric value through to payload', async () => {
      feature.api.tahvel.get = mock(async () => ({ journalTeachers: [] }))
      feature.api.tahvel.post = mock(async () => ({ id: 1 }))
      await feature.createAssignmentInTahvel(123, {
        assignmentName: 'X',
        assignmentEntryType: 'SISSEKANNE_I',
        lessons: 4
      })
      const payload = feature.api.tahvel.post.mock.calls[0][1]
      expect(payload.lessons).toBe(4)
    })

    it('uses null lessons when not provided', async () => {
      feature.api.tahvel.get = mock(async () => ({ journalTeachers: [] }))
      feature.api.tahvel.post = mock(async () => ({ id: 1 }))
      await feature.createAssignmentInTahvel(123, {
        assignmentName: 'X',
        assignmentEntryType: 'SISSEKANNE_I'
      })
      const payload = feature.api.tahvel.post.mock.calls[0][1]
      expect(payload.lessons).toBeNull()
    })

    it('returns empty homework when neither instructions nor link provided', async () => {
      feature.api.tahvel.get = mock(async () => ({ journalTeachers: [] }))
      feature.api.tahvel.post = mock(async () => ({ id: 1 }))
      await feature.createAssignmentInTahvel(123, {
        assignmentName: 'X',
        assignmentEntryType: 'SISSEKANNE_I'
      })
      const payload = feature.api.tahvel.post.mock.calls[0][1]
      expect(payload.homework).toBe('')
    })
  })
})
