import { describe, expect, mock, test } from 'bun:test'
import {
  hasEnoughIndependentOrPracticalCapacity,
  recalculateFinalGradesForJournal,
  recalculateFinalGradesForTouchedJournals
} from '../../../src/features/journalList/FinalGradeRecalculation.js'

describe('FinalGradeRecalculation', () => {
  test('requires at least 95% of planned I/P capacity and ignores zero-planned types', () => {
    expect(hasEnoughIndependentOrPracticalCapacity({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 20, usedHours: 19 }] }
    })).toBe(true)

    expect(hasEnoughIndependentOrPracticalCapacity({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 20, usedHours: 18 }] }
    })).toBe(false)

    expect(hasEnoughIndependentOrPracticalCapacity({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 0, usedHours: 0 }] }
    })).toBe(false)

    expect(hasEnoughIndependentOrPracticalCapacity({
      lessonHours: {
        capacityHours: [
          { capacity: 'MAHT_i', plannedHours: 20, usedHours: 20 },
          { capacity: 'MAHT_p', plannedHours: 0, usedHours: 0 }
        ]
      }
    })).toBe(true)
  })

  test('deduplicates touched journals and recalculates outcome grades', async () => {
    const postCalls = []
    const api = {
      tahvel: {
        get: mock(async endpoint => {
          if (endpoint === '/journals/123') {
            return {
              id: 123,
              nameEt: 'Test journal',
              assessment: 'KUTSEHINDAMISVIIS_E',
              lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 20, usedHours: 20 }] }
            }
          }
          if (endpoint === '/journals/123/journalEntriesByDate') {
            return [
              { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 500, studentOutcomeResults: { 10: { studentId: 10, grade: { code: 'KUTSEHINDAMINE_A' } } } },
              { entryType: 'SISSEKANNE_I', nameEt: 'Task (ÕV1)', journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_2' } }] }
            ]
          }
          if (endpoint === '/journals/123/journalStudents') {
            return [{ id: 1, student: { id: 10, fullname: 'Test Student', idcode: '1' } }]
          }
          if (endpoint === '/journals/123/journalOutcome/500') {
            return { outcomeStudents: [{ studentId: 10, grade: { code: 'KUTSEHINDAMINE_A' } }] }
          }
          if (endpoint === '/students/10') return { status: 'OPPURSTAATUS_O' }
          return null
        }),
        post: mock(async (endpoint, payload) => {
          postCalls.push({ endpoint, payload })
          return { ok: true }
        })
      }
    }

    const updates = await recalculateFinalGradesForTouchedJournals(api, ['123', '123'])

    expect(api.tahvel.get).toHaveBeenCalledWith('/journals/123', {}, { cache: false })
    expect(postCalls.length).toBe(1)
    expect(postCalls[0].endpoint).toBe('/journals/123/journalOutcome/500')
    expect(updates).toEqual([
      { journalId: '123', journalName: 'Test journal', studentName: 'Test Student', oldGrade: 'A', newGrade: 'MA' }
    ])
  })

  test('does not report outcome updates when the write fails', async () => {
    const api = {
      tahvel: {
        get: mock(async endpoint => {
          if (endpoint === '/journals/123') return { id: 123, assessment: 'KUTSEHINDAMISVIIS_E', lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 20, usedHours: 20 }] } }
          if (endpoint === '/journals/123/journalEntriesByDate') {
            return [
              { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 500, studentOutcomeResults: { 10: { studentId: 10, grade: { code: 'KUTSEHINDAMINE_A' } } } },
              { entryType: 'SISSEKANNE_I', nameEt: 'Task (ÕV1)', journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_2' } }] }
            ]
          }
          if (endpoint === '/journals/123/journalStudents') return [{ id: 1, student: { id: 10, fullname: 'Test Student', idcode: '1' } }]
          if (endpoint === '/journals/123/journalOutcome/500') return { outcomeStudents: [{ studentId: 10, grade: { code: 'KUTSEHINDAMINE_A' } }] }
          if (endpoint === '/students/10') return { status: 'OPPURSTAATUS_O' }
          return null
        }),
        post: mock(async () => { throw new Error('write failed') })
      }
    }

    const updates = await recalculateFinalGradesForTouchedJournals(api, ['123'])

    expect(updates).toEqual([])
  })

  test('reads embedded outcome result arrays when resolving existing grades', async () => {
    const api = {
      tahvel: {
        get: mock(async endpoint => {
          if (endpoint === '/journals/123') return { id: 123, assessment: 'KUTSEHINDAMISVIIS_E', lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 20, usedHours: 20 }] } }
          if (endpoint === '/journals/123/journalEntriesByDate') {
            return [
              { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 500, studentOutcomeResults: { 1: [{ grade: { code: 'KUTSEHINDAMINE_MA' } }] } },
              { entryType: 'SISSEKANNE_I', nameEt: 'Task (ÕV1)', journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_2' } }] }
            ]
          }
          if (endpoint === '/journals/123/journalStudents') return [{ id: 1, student: { id: 10, fullname: 'Test Student', idcode: '1' } }]
          if (endpoint === '/students/10') return { status: 'OPPURSTAATUS_O' }
          return null
        }),
        post: mock(async () => ({ ok: true }))
      }
    }

    const updates = await recalculateFinalGradesForTouchedJournals(api, ['123'])

    expect(api.tahvel.post).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  test('normalizes L journalStudentResults before updating existing rows', async () => {
    let putPayload = null
    const api = {
      tahvel: {
        get: mock(async endpoint => {
          if (endpoint === '/journals/123') return { id: 123, nameEt: 'Test journal', assessment: 'KUTSEHINDAMISVIIS_E', lessonHours: { capacityHours: [{ capacity: 'MAHT_i', plannedHours: 20, usedHours: 20 }] } }
          if (endpoint === '/journals/123/journalEntriesByDate') {
            return [
              { id: 99, entryType: 'SISSEKANNE_L' },
              { entryType: 'SISSEKANNE_I', journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_5' } }] }
            ]
          }
          if (endpoint === '/journals/123/journalStudents') return [{ id: 1, student: { id: 10, fullname: 'Test Student', idcode: '1' } }]
          if (endpoint === '/journals/123/journalEntry/99') {
            return { id: 99, entryType: 'SISSEKANNE_L', journalStudentResults: { 1: [{ id: 77, journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_3' } }] } }
          }
          return null
        }),
        put: mock(async (_endpoint, payload) => {
          putPayload = payload
          return { ok: true }
        })
      }
    }

    const updates = await recalculateFinalGradesForJournal(api, '123')

    expect(putPayload.journalEntryStudents[0].id).toBe(77)
    expect(putPayload.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_5')
    expect(updates).toEqual([
      { journalId: '123', journalName: 'Test journal', studentName: 'Test Student', oldGrade: '3', newGrade: '5' }
    ])
  })
})
