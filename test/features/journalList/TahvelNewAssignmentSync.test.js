import { describe, test, expect, beforeEach, mock } from 'bun:test'
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

      // Verify capacity types is empty array for SISSEKANNE_P
      expect(payload.journalEntryCapacityTypes).toEqual([])
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
      expect(payload.journalEntryCapacityTypes).toEqual([])
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
      expect(payload.journalEntryCapacityTypes).toEqual([])
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
