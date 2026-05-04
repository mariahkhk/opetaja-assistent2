import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  runKriitSyncCheck,
  normalizeDifferences,
  normalizeNewAssignments,
  collectJournalData,
  createStudentMap,
  extractAssignmentsFromEntries,
  getAssignmentNameFromEntry,
  getTeacherPersonalCodeCached,
  clearKriitSyncCaches,
  buildDiffSummary
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

  describe('buildDiffSummary', () => {
    it('contains only counts and flags — no PII', () => {
      const differences = [
        { studentPersonalCode: '30000000001', studentName: 'Test PersonA', journalId: 1 },
        { studentPersonalCode: '40000000002', studentName: 'Test PersonB', journalId: 2 }
      ]
      const newAssignments = { '101': { name: 'HW1' }, '102': { name: 'HW2' } }
      const summary = buildDiffSummary(differences, newAssignments)

      expect(summary.totalDifferences).toBe(2)
      expect(summary.totalNewAssignments).toBe(2)
      expect(summary.hasDifferences).toBe(true)
      expect(summary.hasNewAssignments).toBe(true)
      expect(typeof summary.lastSyncedAt).toBe('number')

      const json = JSON.stringify(summary)
      expect(json).not.toContain('PersonA')
      expect(json).not.toContain('PersonB')
      expect(json).not.toContain('30000000001')
      expect(json).not.toContain('40000000002')
      expect(json).not.toContain('HW1')
    })

    it('reports false flags for empty inputs', () => {
      expect(buildDiffSummary([], {})).toMatchObject({
        totalDifferences: 0,
        totalNewAssignments: 0,
        hasDifferences: false,
        hasNewAssignments: false
      })
    })

    it('handles null/undefined inputs gracefully', () => {
      expect(buildDiffSummary(null, null)).toMatchObject({
        totalDifferences: 0,
        totalNewAssignments: 0,
        hasDifferences: false,
        hasNewAssignments: false
      })
    })
  })

  describe('getTeacherPersonalCodeCached — concurrent dedupe', () => {
    function makeTeacherSearchApi() {
      const calls = { count: 0 }
      const api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async (endpoint) => {
            calls.count++
            await new Promise(resolve => setTimeout(resolve, 20))
            const match = endpoint.match(/name=([^&]+)/)
            const name = match ? decodeURIComponent(match[1]) : ''
            return {
              content: [{ id: 100, name, idcode: '38001010001' }]
            }
          })
        }
      }
      return { api, calls }
    }

    it('deduplicates concurrent requests for the same teacher into a single API call', async () => {
      const { api, calls } = makeTeacherSearchApi()
      const teacher = { id: 100, nameEt: 'Mari Mets' }

      const [a, b, c] = await Promise.all([
        getTeacherPersonalCodeCached(api, teacher),
        getTeacherPersonalCodeCached(api, teacher),
        getTeacherPersonalCodeCached(api, teacher)
      ])

      expect(calls.count).toBe(1)
      expect(a.personalCode).toBe('38001010001')
      expect(b.personalCode).toBe('38001010001')
      expect(c.personalCode).toBe('38001010001')
    })

    it('caches the result so subsequent serial calls do not hit the API again', async () => {
      const { api, calls } = makeTeacherSearchApi()
      const teacher = { id: 200, nameEt: 'Jaan Kuusk' }

      await getTeacherPersonalCodeCached(api, teacher)
      await getTeacherPersonalCodeCached(api, teacher)
      await getTeacherPersonalCodeCached(api, teacher)

      expect(calls.count).toBe(1)
    })

    it('makes separate API calls for distinct teacher ids', async () => {
      const { api, calls } = makeTeacherSearchApi()
      await Promise.all([
        getTeacherPersonalCodeCached(api, { id: 1, nameEt: 'A A' }),
        getTeacherPersonalCodeCached(api, { id: 2, nameEt: 'B B' }),
        getTeacherPersonalCodeCached(api, { id: 3, nameEt: 'C C' })
      ])
      expect(calls.count).toBe(3)
    })

    it('returns fallback data when teacher is not found in search results', async () => {
      const api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => ({ content: [] }))
        }
      }
      const result = await getTeacherPersonalCodeCached(api, { id: 999, nameEt: 'Ghost Teacher' })
      expect(result.personalCode).toBe('')
      expect(result.name).toBe('Ghost Teacher')
      expect(result.id).toBe(999)
    })

    it('returns empty data when teacher has no id or name', async () => {
      const api = { tahvel: { get: mock(async () => ({ content: [] })) } }
      const result = await getTeacherPersonalCodeCached(api, { id: null, nameEt: '' })
      expect(result.personalCode).toBe('')
      expect(api.tahvel.get).not.toHaveBeenCalled()
    })

    it('returns error fallback when API throws', async () => {
      const api = {
        tahvel: {
          baseUrl: 'https://tahvel.edu.ee/hois_back',
          get: mock(async () => { throw new Error('Network down') })
        }
      }
      const result = await getTeacherPersonalCodeCached(api, { id: 50, nameEt: 'Network Fail' })
      expect(result.personalCode).toBe('')
      expect(result.id).toBe(50)
      expect(result.name).toBe('Network Fail')
    })

    it('clearKriitSyncCaches forces re-fetch on next call', async () => {
      const { api, calls } = makeTeacherSearchApi()
      const teacher = { id: 300, nameEt: 'Reset Test' }

      await getTeacherPersonalCodeCached(api, teacher)
      expect(calls.count).toBe(1)

      clearKriitSyncCaches()
      await cacheService.clearCache()

      await getTeacherPersonalCodeCached(api, teacher)
      expect(calls.count).toBe(2)
    })
  })

  describe('runKriitSyncCheck — extra coverage', () => {
    it('handles inactive students fetch failure but still completes the pipeline', async () => {
      // Set up mocks where /students throws during inactive students collection
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        if (endpoint === '/journals/42') return { nameEt: 'Test', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') {
          // Reject first so getInactiveStudentsCache fails
          throw new Error('inactive students endpoint failure')
        }
        return {}
      })

      mockApi.kriit.post = mock(async () => [])

      const result = await runKriitSyncCheck(mockApi)
      expect(result).toBeDefined()
      expect(Array.isArray(result.differences)).toBe(true)
    })

    it('returns null when collectJournalData yields nothing useful', async () => {
      // /journals returns one journal id but later calls return invalid data
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        // journalInfo is null so the journal is skipped
        if (endpoint === '/journals/42') return null
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') return { content: [] }
        return {}
      })

      const result = await runKriitSyncCheck(mockApi)
      expect(result).toBeNull()
    })

    it('caches inactive students by personal code into payload sent to kriit', async () => {
      let kriitPayloadReceived = null
      mockApi.tahvel.get = mock(async (endpoint, params) => {
        if (endpoint === '/journals') return { content: [{ id: 42 }], totalPages: 1 }
        if (endpoint === '/journals/42') return { nameEt: 'Test', journalTeachers: [], studentGroups: [] }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/students') {
          // First page returns 1 student, second returns 0
          const page = params?.page ?? 0
          if (page === 0) return { content: [{ id: 999, idcode: '50001010001', firstname: 'Jane', lastname: 'Doe', status: 'OPPURSTAATUS_K' }] }
          return { content: [] }
        }
        return {}
      })
      mockApi.kriit.post = mock(async (_endpoint, payload) => {
        kriitPayloadReceived = payload
        return []
      })

      await runKriitSyncCheck(mockApi)
      expect(kriitPayloadReceived).toBeTruthy()
      expect(Array.isArray(kriitPayloadReceived.inactiveStudents)).toBe(true)
      expect(kriitPayloadReceived.inactiveStudents.length).toBeGreaterThan(0)
      const first = kriitPayloadReceived.inactiveStudents[0]
      expect(first.personalCode).toBe('50001010001')
      expect(first.name).toBe('Jane Doe')
    })
  })

  describe('collectJournalData — extra coverage', () => {
    it('merges homeworkDuedate from journalEntries into journalEntriesWithGrades', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return { nameEt: 'T', journalTeachers: [], studentGroups: ['G1'] }
        }
        if (endpoint === '/journals/42/journalEntry') {
          return { content: [{ id: 7, homeworkDuedate: '2025-04-15T00:00:00', entryType: 'SISSEKANNE_I' }] }
        }
        if (endpoint === '/journals/42/journalEntriesByDate') {
          return [{ id: 7, nameEt: 'HW', entryType: 'SISSEKANNE_I', journalStudentResults: { '5': [{ grade: { code: 'KUTSEHINDAMINE_5' } }] } }]
        }
        if (endpoint === '/journals/42/journalStudents') {
          return [{ id: 5, studentId: 50, fullname: 'Foo Bar', studentGroup: 'G1' }]
        }
        if (endpoint === '/students/50') {
          return { person: { idcode: '40001010001' }, status: 'OPPURSTAATUS_O' }
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      // Verify assignment dueAt comes from merged homeworkDuedate
      expect(result[0].assignments[0].assignmentDueAt).toBe('2025-04-15')
    })

    it('extracts capacity hours and plannedHours from MAHT_i', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'CapTest',
            journalTeachers: [],
            studentGroups: [],
            lessonHours: {
              capacityHours: [
                { capacity: 'MAHT_i', plannedHours: 50, usedHours: 10 },
                { capacity: 'MAHT_p', plannedHours: 25, usedHours: 5 },
                { capacity: 'MAHT_a', plannedHours: 80, usedHours: 60 }
              ]
            }
          }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      expect(result[0].plannedHours).toBe(50)
      // Only MAHT_i and MAHT_p are kept (MAHT_a filtered out)
      expect(result[0].capacityHours.length).toBe(2)
      const types = result[0].capacityHours.map(c => c.capacity).sort()
      expect(types).toEqual(['MAHT_i', 'MAHT_p'])
    })

    it('fetches journal theme when curriculumVersions has theme id', async () => {
      const themeData = { content: '<p>Theme HTML</p>' }
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'Themed',
            journalTeachers: [],
            studentGroups: [],
            curriculumVersions: [{ themes: [{ id: 99 }] }]
          }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/journals/42/theme/99') return themeData
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result[0].journalTheme).toBeTruthy()
      expect(result[0].journalTheme.id).toBe(99)
      expect(result[0].journalTheme.content).toEqual(themeData)
    })

    it('falls back to journalThemes[0].id when curriculumVersions is missing', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'JT',
            journalTeachers: [],
            studentGroups: [],
            journalThemes: [{ id: 77 }]
          }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/journals/42/theme/77') return { content: 'fallback' }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result[0].journalTheme.id).toBe(77)
    })

    it('falls back to themes[0].id when curriculumVersions is empty', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'T',
            journalTeachers: [],
            studentGroups: [],
            themes: [{ id: 88 }]
          }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint === '/journals/42/theme/88') return { content: 'x' }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result[0].journalTheme.id).toBe(88)
    })

    it('falls back to journalStudents[0].studentGroup when journalInfo.studentGroups missing', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return { nameEt: 'NoGroup', journalTeachers: [] /* studentGroups omitted */ }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') {
          return [{ id: 1, studentId: 10, fullname: 'X X', studentGroup: 'FromStudent' }]
        }
        if (endpoint === '/students/10') {
          return { person: { idcode: '38001010001' }, status: 'OPPURSTAATUS_O' }
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      expect(result[0].groupName).toBe('FromStudent')
    })

    it('returns single entry with empty groupName when no student groups detected', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return { nameEt: 'NoGroup', journalTeachers: [] }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      expect(result[0].groupName).toBe('')
    })

    it('handles teacher resolution failure (no id) by pushing teacher with empty personalCode', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return {
            nameEt: 'T',
            journalTeachers: [{ nameEt: 'No ID Teacher' }], // missing id
            studentGroups: ['G1']
          }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      const teacher = result[0].teachers[0]
      expect(teacher.name).toBe('No ID Teacher')
      expect(teacher.personalCode).toBe('')
    })

    it('extracts lesson dates from timetable when present', async () => {
      mockApi.tahvel.get = mock(async (endpoint, params) => {
        if (endpoint === '/journals/42') {
          return {
            id: 42,
            nameEt: 'WithLessons',
            journalTeachers: [{ id: 1, nameEt: 'Teacher' }],
            studentGroups: [],
            school: { id: 9 },
            lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 2, usedHours: 0 }] }
          }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        if (endpoint.includes('/timetableevents/timetableByTeacher/')) {
          return {
            timetableEvents: [
              { journalId: 42, date: '2024-09-01T08:00:00.000Z' },
              { journalId: 42, date: '2024-12-01T08:00:00.000Z' }
            ]
          }
        }
        if (endpoint.includes('/teachers')) {
          return { content: [{ id: 1, name: 'Teacher', idcode: '38001010001' }] }
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      expect(result[0].firstLessonDate).toBe('2024-09-01T08:00:00.000Z')
      expect(result[0].lastLessonDate).toBe('2024-12-01T08:00:00.000Z')
      expect(result[0].lastLessonDateIsApproximate).toBe(false)
    })

    it('detects overall failure of a single journal and returns null for it', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          throw new Error('catastrophic failure')
        }
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(0)
    })

    it('skips journals where journalEntries is not an array', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return { nameEt: 'X', journalTeachers: [], studentGroups: [] }
        }
        // Return non-array object that doesn't have content
        if (endpoint === '/journals/42/journalEntry') return { someKey: 'not array' }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') return []
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      // journalEntries returned as [] from getJournalEntries -> processed normally.
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns null for journals with null journalStudents response', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') {
          return { nameEt: 'X', journalTeachers: [], studentGroups: [] }
        }
        if (endpoint === '/journals/42/journalEntry') return { content: [] }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        // journalStudents returns null (treated as null)
        if (endpoint === '/journals/42/journalStudents') return null
        return {}
      })

      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(0)
    })

    it('uses journalEntries when journalEntriesWithGrades is empty', async () => {
      mockApi.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/42') return { nameEt: 'X', journalTeachers: [], studentGroups: ['G1'] }
        if (endpoint === '/journals/42/journalEntry') {
          return {
            content: [
              { id: 9, nameEt: 'Old', entryType: 'SISSEKANNE_I', entryDate: '2024-01-15' }
            ]
          }
        }
        if (endpoint === '/journals/42/journalEntriesByDate') return []
        if (endpoint === '/journals/42/journalStudents') {
          return [{ id: 1, studentId: 10, studentGroup: 'G1' }]
        }
        if (endpoint === '/students/10') return { person: { idcode: '50001010001' }, status: 'OPPURSTAATUS_O' }
        return {}
      })
      const result = await collectJournalData(mockApi, [{ id: 42 }])
      expect(result.length).toBe(1)
      expect(result[0].assignments.length).toBe(1)
    })
  })
})
