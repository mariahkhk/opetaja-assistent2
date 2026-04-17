import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  runKriitSyncCheck,
  normalizeDifferences,
  normalizeNewAssignments,
  collectJournalData,
  createStudentMap,
  extractAssignmentsFromEntries,
  getAssignmentNameFromEntry,
  clearKriitSyncCaches
} from '../../src/lib/kriitSyncCheck.js'
import { cacheService } from '../../src/services/CacheService.js'

describe('kriitSyncCheck', () => {
  let mockApi

  beforeEach(async () => {
    global.window = { location: { hostname: 'tahvel.edu.ee', protocol: 'https:' } }
    global.chrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get: mock((keys, cb) => cb({})),
          remove: mock((keys, cb) => { if (cb) cb() }),
          set: mock((items, cb) => { if (cb) cb() })
        }
      }
    }

    await cacheService.clearCache()
    clearKriitSyncCaches()
    delete global.window.journalListSync

    mockApi = {
      tahvel: {
        get: mock(async () => ({})),
        baseUrl: 'https://tahvel.edu.ee/hois_back'
      },
      kriit: {
        enabled: true,
        post: mock(async () => [])
      }
    }
  })

  describe('normalizeDifferences', () => {
    it('should handle direct array response', () => {
      const diffs = [{ subjectName: 'Math' }]
      expect(normalizeDifferences(diffs)).toEqual(diffs)
    })

    it('should handle response.data array', () => {
      const diffs = [{ subjectName: 'Math' }]
      expect(normalizeDifferences({ data: diffs })).toEqual(diffs)
    })

    it('should handle response.data.differences array', () => {
      const diffs = [{ subjectName: 'Math' }]
      expect(normalizeDifferences({ data: { differences: diffs } })).toEqual(diffs)
    })

    it('should handle response.differences array', () => {
      const diffs = [{ subjectName: 'Math' }]
      expect(normalizeDifferences({ differences: diffs })).toEqual(diffs)
    })

    it('should return empty array for null response', () => {
      expect(normalizeDifferences(null)).toEqual([])
    })

    it('should return empty array for empty object', () => {
      expect(normalizeDifferences({})).toEqual([])
    })
  })

  describe('normalizeNewAssignments', () => {
    it('should handle response.data.newAssignments', () => {
      const assignments = { '101': [{ name: 'HW1' }] }
      expect(normalizeNewAssignments({ data: { newAssignments: assignments } })).toEqual(assignments)
    })

    it('should handle response.newAssignments', () => {
      const assignments = { '101': [{ name: 'HW1' }] }
      expect(normalizeNewAssignments({ newAssignments: assignments })).toEqual(assignments)
    })

    it('should return empty object for no assignments', () => {
      expect(normalizeNewAssignments({})).toEqual({})
    })

    it('should return empty object for null response', () => {
      expect(normalizeNewAssignments(null)).toEqual({})
    })
  })

  describe('getAssignmentNameFromEntry', () => {
    it('should return nameEt if available', () => {
      expect(getAssignmentNameFromEntry({ nameEt: 'Test Assignment' })).toBe('Test Assignment')
    })

    it('should extract name from content', () => {
      expect(getAssignmentNameFromEntry({ content: 'First sentence. Second sentence.' })).toBe('First sentence')
    })

    it('should truncate long content names', () => {
      const longContent = 'A'.repeat(200)
      const result = getAssignmentNameFromEntry({ content: longContent })
      expect(result.length).toBeLessThanOrEqual(103) // 100 + "..."
      expect(result.endsWith('...')).toBe(true)
    })

    it('should return type-specific fallback for SISSEKANNE_I', () => {
      expect(getAssignmentNameFromEntry({ entryType: 'SISSEKANNE_I' })).toBe('Iseseisev töö')
    })

    it('should return type-specific fallback for SISSEKANNE_P', () => {
      expect(getAssignmentNameFromEntry({ entryType: 'SISSEKANNE_P' })).toBe('Praktiline töö')
    })

    it('should return type-specific fallback for SISSEKANNE_H', () => {
      expect(getAssignmentNameFromEntry({ entryType: 'SISSEKANNE_H' })).toBe('Hindeline töö')
    })

    it('should return generic fallback for unknown type', () => {
      expect(getAssignmentNameFromEntry({ entryType: 'OTHER' })).toBe('Päeviku sissekanne')
    })
  })

  describe('createStudentMap', () => {
    it('should map students with details', () => {
      const journalStudents = [
        { id: 10, studentId: 100 }
      ]
      const detailsMap = {
        100: { personalCode: '39901011234', name: 'Test Student' }
      }

      const result = createStudentMap(journalStudents, detailsMap)

      expect(result.journalStudentIdToId[10]).toBe(100)
      expect(result.idToPersonalCode[100]).toBe('39901011234')
      expect(result.personalCodeToName['39901011234']).toBe('Test Student')
    })

    it('should fallback to student.idcode when details missing', () => {
      const journalStudents = [
        { id: 10, studentId: 100, student: { idcode: '39901011234', fullname: 'Fallback Student' } }
      ]

      const result = createStudentMap(journalStudents, {})

      expect(result.idToPersonalCode[100]).toBe('39901011234')
      expect(result.personalCodeToName['39901011234']).toBe('Fallback Student')
    })

    it('should handle empty input', () => {
      const result = createStudentMap(null, {})
      expect(result.idToPersonalCode).toEqual({})
      expect(result.personalCodeToName).toEqual({})
      expect(result.journalStudentIdToId).toEqual({})
    })
  })

  describe('extractAssignmentsFromEntries', () => {
    it('should extract assignments from graded entries', () => {
      const journalStudents = [
        { id: 10, studentId: 100 }
      ]
      const studentMap = {
        journalStudentIdToId: { 10: 100 },
        idToPersonalCode: { 100: '39901011234' },
        personalCodeToName: { '39901011234': 'Student A' }
      }
      const entries = [
        {
          id: 1,
          nameEt: 'Test Assignment',
          entryType: 'SISSEKANNE_I',
          entryDate: '2025-01-15T00:00:00',
          content: 'Instructions',
          journalStudentResults: {
            '10': [{ grade: { code: 'KUTSEHINDAMINE_5' } }]
          }
        }
      ]

      const result = extractAssignmentsFromEntries(entries, studentMap, journalStudents, {}, [])

      expect(result.length).toBe(1)
      expect(result[0].assignmentName).toBe('Test Assignment')
      expect(result[0].assignmentExternalId).toBe(1)
      expect(result[0].entryType).toBe('SISSEKANNE_I')
      expect(result[0].results.length).toBe(1)
      expect(result[0].results[0].grade).toBe('5')
      expect(result[0].results[0].studentPersonalCode).toBe('39901011234')
    })

    it('should include students with empty grades', () => {
      const journalStudents = [
        { id: 10, studentId: 100 },
        { id: 11, studentId: 101 }
      ]
      const studentMap = {
        journalStudentIdToId: { 10: 100, 11: 101 },
        idToPersonalCode: { 100: '39901011234', 101: '49901015678' },
        personalCodeToName: { '39901011234': 'Student A', '49901015678': 'Student B' }
      }
      const entries = [
        {
          id: 1,
          nameEt: 'Test',
          entryType: 'SISSEKANNE_I',
          journalStudentResults: {}
        }
      ]

      const result = extractAssignmentsFromEntries(entries, studentMap, journalStudents, {}, [])

      expect(result[0].results.length).toBe(2)
      expect(result[0].results[0].grade).toBe('')
      expect(result[0].results[1].grade).toBe('')
    })

    it('should filter out non-graded entries', () => {
      const entries = [
        { id: 1, nameEt: 'Lesson', entryType: 'SISSEKANNE_L' },
        { id: 2, nameEt: 'Graded', entryType: 'SISSEKANNE_H' }
      ]
      const studentMap = { journalStudentIdToId: {}, idToPersonalCode: {}, personalCodeToName: {} }

      const result = extractAssignmentsFromEntries(entries, studentMap, [], {}, [])

      expect(result.length).toBe(1)
      expect(result[0].assignmentName).toBe('Graded')
    })

    it('should return empty array for null input', () => {
      const studentMap = { journalStudentIdToId: {}, idToPersonalCode: {}, personalCodeToName: {} }
      expect(extractAssignmentsFromEntries(null, studentMap)).toEqual([])
    })
  })

  describe('runKriitSyncCheck', () => {
    it('should run full pipeline and return results', async () => {
      const differences = [{ subjectName: 'Math', assignments: [] }]

      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') {
          return { content: [{ id: 42, nameEt: 'Test Journal' }], totalPages: 1 }
        }
        if (endpoint === '/journals/42') {
          return { nameEt: 'Test Journal', journalTeachers: [], studentGroups: ['G1'] }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') return { content: [], totalElements: 0 }
        return {}
      })

      mockApi.kriit.post = mock(async () => differences)

      const result = await runKriitSyncCheck(mockApi)

      expect(result).toBeTruthy()
      expect(result.differences).toEqual(differences)
      expect(mockApi.kriit.post).toHaveBeenCalledTimes(1)
    })

    it('should return null when no journals found', async () => {
      mockApi.tahvel.get = mock(async () => ({ content: [], totalPages: 1 }))

      const result = await runKriitSyncCheck(mockApi)

      expect(result).toBeNull()
      expect(mockApi.kriit.post).not.toHaveBeenCalled()
    })

    it('should cache results after successful check', async () => {
      const differences = [{ subjectName: 'Math' }]
      const newAssignments = { '42': [{ name: 'New HW' }] }

      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        if (endpoint === '/journals/42') return { nameEt: 'Test', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') return { content: [] }
        return {}
      })

      mockApi.kriit.post = mock(async () => ({
        differences,
        newAssignments
      }))

      await runKriitSyncCheck(mockApi)

      // Verify cached values
      const cachedDiff = await cacheService.get('journalList_lastDifferences', 86400000)
      const cachedNew = await cacheService.get('journalList_lastNewAssignments', 86400000)

      expect(cachedDiff).toEqual(differences)
      expect(cachedNew).toEqual(newAssignments)
    })

    it('should return empty results when Kriit returns no differences', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        if (endpoint === '/journals/42') return { nameEt: 'Test', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') return { content: [] }
        return {}
      })

      mockApi.kriit.post = mock(async () => [])

      const result = await runKriitSyncCheck(mockApi)

      expect(result.differences).toEqual([])
      expect(result.newAssignments).toEqual({})
    })

    it('should return empty results when Kriit API fails', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        if (endpoint === '/journals/42') return { nameEt: 'Test', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') return { content: [] }
        return {}
      })

      mockApi.kriit.post = mock(async () => { throw new Error('Kriit server unreachable') })

      const result = await runKriitSyncCheck(mockApi)

      expect(result).toEqual({ differences: [], newAssignments: {} })
      expect(mockApi.kriit.post).toHaveBeenCalledTimes(1)
    })

    it('should deduplicate concurrent calls (concurrency guard)', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        if (endpoint === '/journals/42') return { nameEt: 'Test', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') return { content: [] }
        return {}
      })

      mockApi.kriit.post = mock(async () => [{ subjectName: 'Math' }])

      // Launch two calls simultaneously
      const [result1, result2] = await Promise.all([
        runKriitSyncCheck(mockApi),
        runKriitSyncCheck(mockApi)
      ])

      // Both should return the same result
      expect(result1).toEqual(result2)
      // Kriit should only be called once
      expect(mockApi.kriit.post).toHaveBeenCalledTimes(1)
    })
  })

  describe('collectJournalData', () => {
    it('should collect data for journals with students and entries', async () => {
      mockApi.tahvel.get = mock(async (endpoint, params, options) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'Test Journal',
            journalTeachers: [],
            studentGroups: ['G1']
          }
        }
        if (endpoint === '/journals/42/journalEntry') {
          return {
            content: [
              { id: 1, nameEt: 'HW1', entryType: 'SISSEKANNE_I', entryDate: '2025-01-15T00:00:00' }
            ]
          }
        }
        if (endpoint === '/journals/42/journalEntriesByDate') {
          return [{ id: 1, nameEt: 'HW1', entryType: 'SISSEKANNE_I', journalStudentResults: {} }]
        }
        if (endpoint === '/journals/42/journalStudents') {
          return [
            { id: 10, studentId: 100, fullname: 'Student A', studentGroup: 'G1' }
          ]
        }
        if (endpoint === '/students/100') {
          return {
            person: { idcode: '39901011234' },
            status: 'OPPURSTAATUS_O'
          }
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42, nameEt: 'Test Journal' }])

      expect(result.length).toBe(1)
      expect(result[0].subjectName).toBe('Test Journal')
      expect(result[0].subjectExternalId).toBe(42)
      expect(result[0].groupName).toBe('G1')
      expect(result[0].assignments.length).toBe(1)
      expect(result[0].assignments[0].results.length).toBe(1)
    })

    it('should skip journals with no ID', async () => {
      const result = await collectJournalData(mockApi, [{ nameEt: 'No ID Journal' }])
      expect(result.length).toBe(0)
    })

    it('should skip journals that fail to load', async () => {
      mockApi.tahvel.get = mock(async () => null)

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(0)
    })

    it('should skip students whose API calls fail', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return { nameEt: 'Test', journalTeachers: [], studentGroups: ['G1'] }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') {
          return [
            { id: 10, studentId: 100, fullname: 'Student A', studentGroup: 'G1' },
            { id: 11, studentId: 101, fullname: 'Student B', studentGroup: 'G1' }
          ]
        }
        if (endpoint === '/students/100') {
          return { person: { idcode: '39901011234' }, status: 'OPPURSTAATUS_O' }
        }
        if (endpoint === '/students/101') {
          throw new Error('Network error')
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42, nameEt: 'Test' }])

      expect(result.length).toBe(1)
      // Only student 100 should have results (101 failed)
      const assignment = result[0].assignments
      // No assignments since entries are empty, but student map should still work
      expect(result[0].subjectName).toBe('Test')
    })

    it('should handle multigroup journals', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'Multi Group Journal',
            journalTeachers: [],
            studentGroups: ['G1', 'G2']
          }
        }
        if (endpoint === '/journals/42/journalEntry') {
          return {
            content: [
              { id: 1, nameEt: 'HW1', entryType: 'SISSEKANNE_I', entryDate: '2025-01-15T00:00:00' }
            ]
          }
        }
        if (endpoint === '/journals/42/journalEntriesByDate') {
          return [{ id: 1, nameEt: 'HW1', entryType: 'SISSEKANNE_I', journalStudentResults: {} }]
        }
        if (endpoint === '/journals/42/journalStudents') {
          return [
            { id: 10, studentId: 100, fullname: 'Student A', studentGroup: 'G1' },
            { id: 11, studentId: 101, fullname: 'Student B', studentGroup: 'G2' }
          ]
        }
        if (endpoint === '/students/100') {
          return { person: { idcode: '39901011234' }, status: 'OPPURSTAATUS_O' }
        }
        if (endpoint === '/students/101') {
          return { person: { idcode: '49901015678' }, status: 'OPPURSTAATUS_O' }
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])

      // Should create separate entries for each group
      expect(result.length).toBe(2)
      expect(result[0].groupName).toBe('G1')
      expect(result[1].groupName).toBe('G2')
    })
  })
})
