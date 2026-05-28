/**
 * Data-integrity risk tests for the LIVE Kriit -> Tahvel sync path (syncWithKriit).
 *
 * These tests target the failure modes a teacher would actually be harmed by when
 * synchronisation goes wrong: a grade written to the WRONG student (false data),
 * a grade written for a student who was removed (false data), a grade written
 * twice as a new row instead of updating the existing one (duplicate entry), or
 * the rest of the class being wiped because the client resent only a subset of
 * the roster.
 *
 * syncGradeToTahvel is intentionally NOT exercised here: it has no call sites in
 * src/ (dead code). The single live write path is syncWithKriit -> PUT
 * /journals/:journalId/journalEntry/:assignmentId.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { journalListSync } from '../../../src/features/journalList/JournalListSync'
import { restoreChromeMock, restoreGlobalDOM } from '../../setup.js'
import { JSDOM } from 'jsdom'

const JOURNAL_ID = 348986
const ASSIGNMENT_ID = 5001

/**
 * Build a Tahvel API mock from a single GET handler plus a PUT capture.
 * Only the network boundary is mocked; the real syncWithKriit logic runs.
 */
function makeTahvelApi(getHandler) {
  const putCalls = []
  return {
    api: {
      // enabled:false -> notifyKriitGradesSynced is a no-op, isolating the Tahvel PUT.
      kriit: { baseUrl: 'https://kriit.example.com/api', enabled: false },
      tahvel: {
        baseUrl: 'https://tahvel.edu.ee/hois_back',
        get: mock(getHandler),
        put: mock(async (url, body) => {
          putCalls.push({ url, body })
          return { ...body, version: (body.version || 1) + 1 }
        })
      }
    },
    putCalls
  }
}

/** Single grade difference for one student in one assignment. */
function gradeDifference({ studentPersonalCode, currentGrade, grade, studentName, studentIsDeleted }) {
  return [
    {
      subjectName: 'Test Subject',
      subjectExternalId: JOURNAL_ID,
      assignments: [
        {
          assignmentExternalId: ASSIGNMENT_ID,
          assignmentName: 'Test Assignment',
          results: [{ studentPersonalCode, currentGrade, grade, studentName, studentIsDeleted }]
        }
      ]
    }
  ]
}

describe('JournalListSync — sync data-integrity risks (false data / duplicate entries)', () => {
  beforeEach(() => {
    restoreChromeMock()
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://tahvel.edu.ee' })
    global.window = dom.window
    global.document = dom.window.document
    global.localStorage = dom.window.localStorage

    // Reset all singleton state that syncWithKriit reads or accumulates, so tests
    // are independent and order does not matter.
    journalListSync.differences = null
    journalListSync.error = null
    journalListSync.isLoading = false
    journalListSync.isActive = true
    journalListSync.journalStudentIdToStudentId = {}
    journalListSync._localStudentCache = {}
    journalListSync._cachedStudents = {}
    journalListSync._assignmentEntryCache = new Map()
  })

  afterEach(() => {
    restoreChromeMock()
    restoreGlobalDOM()
  })

  test('syncWithKriit_preservesExistingEntryId_soNoDuplicateRowIsCreated', async () => {
    // Arrange: student already has an entry (id 555) with an old grade.
    journalListSync.journalStudentIdToStudentId = { 10: 100 }
    journalListSync._cachedStudents = {
      10: { personalCode: '39001010001', name: 'Mari Maasikas', isActive: true, isDeleted: false }
    }
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 5,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          journalEntryTeachers: [22816],
          journalEntryStudents: [{ id: 555, journalStudent: 10, grade: { code: 'KUTSEHINDAMINE_4' } }]
        }
      }
      if (endpoint.includes('/students/100')) return { id: 100, person: { idcode: '39001010001' }, status: 'OPPURSTAATUS_O' }
      if (endpoint.includes('journalStudents')) {
        return [{ id: 10, studentId: 100, student: { idcode: '39001010001', fullname: 'Mari Maasikas', status: 'OPPURSTAATUS_O' } }]
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '39001010001',
      currentGrade: '4',
      grade: '5',
      studentName: 'Mari Maasikas'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: exactly one student row, reusing the SAME id (555) -> update in place,
    // never a second row. A null/absent id here would mean Tahvel creates a duplicate.
    expect(putCalls.length).toBe(1)
    const sent = putCalls[0].body.journalEntryStudents
    expect(sent.length).toBe(1)
    expect(sent[0].id).toBe(555)
    expect(sent[0].journalStudent).toBe(10)
    expect(sent[0].grade.code).toBe('KUTSEHINDAMINE_5')
  })

  test('syncWithKriit_writesGradeOnlyToExactPersonalCodeMatch_notSimilarlyNamedStudent', async () => {
    // Arrange: two students whose names collide on a substring ("Mari" is inside
    // "Marika"). Only Mari (39001010001) has a grade change.
    journalListSync.journalStudentIdToStudentId = { 10: 100, 20: 200 }
    journalListSync._cachedStudents = {
      10: { personalCode: '39001010001', name: 'Mari', isActive: true, isDeleted: false },
      20: { personalCode: '49002020002', name: 'Marika', isActive: true, isDeleted: false }
    }
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          journalEntryTeachers: [22816],
          journalEntryStudents: [
            { id: 555, journalStudent: 10, grade: { code: 'KUTSEHINDAMINE_2' } },
            { id: 666, journalStudent: 20, grade: { code: 'KUTSEHINDAMINE_3' } }
          ]
        }
      }
      if (endpoint.includes('/students/100')) return { id: 100, person: { idcode: '39001010001' }, status: 'OPPURSTAATUS_O' }
      if (endpoint.includes('/students/200')) return { id: 200, person: { idcode: '49002020002' }, status: 'OPPURSTAATUS_O' }
      if (endpoint.includes('journalStudents')) {
        return [
          { id: 10, studentId: 100, student: { idcode: '39001010001', fullname: 'Mari', status: 'OPPURSTAATUS_O' } },
          { id: 20, studentId: 200, student: { idcode: '49002020002', fullname: 'Marika', status: 'OPPURSTAATUS_O' } }
        ]
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '39001010001',
      currentGrade: '2',
      grade: '5',
      studentName: 'Mari'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: the grade lands on Mari (journalStudent 10) only. Marika (20) is never
    // written. Matching is by exact personal code, not by name substring.
    expect(putCalls.length).toBe(1)
    const sent = putCalls[0].body.journalEntryStudents
    expect(sent.length).toBe(1)
    expect(sent[0].journalStudent).toBe(10)
    expect(sent[0].grade.code).toBe('KUTSEHINDAMINE_5')
    expect(sent.some(s => s.journalStudent === 20)).toBe(false)
  })

  test('syncWithKriit_sendsOnlyChangedStudent_notEntireRoster', async () => {
    // Arrange: roster of three students, but only one (journalStudent 10) changed.
    // The client sends ONLY changed rows and relies on Tahvel merging by id rather
    // than replacing the whole roster. If this contract regressed to "resend full
    // roster" (or to clearing omitted rows), this test fails — that regression is
    // exactly how a sync could wipe the rest of the class's grades.
    journalListSync.journalStudentIdToStudentId = { 10: 100, 20: 200, 30: 300 }
    journalListSync._cachedStudents = {
      10: { personalCode: '39001010001', name: 'A', isActive: true, isDeleted: false }
    }
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          journalEntryTeachers: [22816],
          journalEntryStudents: [
            { id: 555, journalStudent: 10, grade: { code: 'KUTSEHINDAMINE_4' } },
            { id: 666, journalStudent: 20, grade: { code: 'KUTSEHINDAMINE_3' } },
            { id: 777, journalStudent: 30, grade: { code: 'KUTSEHINDAMINE_5' } }
          ]
        }
      }
      if (endpoint.includes('/students/100')) return { id: 100, person: { idcode: '39001010001' }, status: 'OPPURSTAATUS_O' }
      if (endpoint.includes('journalStudents')) {
        return [{ id: 10, studentId: 100, student: { idcode: '39001010001', fullname: 'A', status: 'OPPURSTAATUS_O' } }]
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '39001010001',
      currentGrade: '4',
      grade: '5',
      studentName: 'A'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: only the single changed student is in the payload; the two unchanged
    // classmates (20, 30) are not resent.
    expect(putCalls.length).toBe(1)
    const sent = putCalls[0].body.journalEntryStudents
    expect(sent.length).toBe(1)
    expect(sent[0].journalStudent).toBe(10)
    expect(sent.some(s => s.journalStudent === 20)).toBe(false)
    expect(sent.some(s => s.journalStudent === 30)).toBe(false)
  })

  test('syncWithKriit_excludesStudentFromPayload_whenTahvelStatusIsDeleted', async () => {
    // Arrange: target student matches by personal code, but their Tahvel status is
    // OPPURSTAATUS_K (removed from the journal). Writing a grade for them would be
    // false data.
    journalListSync.journalStudentIdToStudentId = { 10: 100 }
    journalListSync._cachedStudents = {
      10: { personalCode: '39001010001', name: 'Removed', isActive: false, isDeleted: true }
    }
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          journalEntryTeachers: [22816],
          journalEntryStudents: [{ id: 555, journalStudent: 10, grade: { code: 'KUTSEHINDAMINE_4' } }]
        }
      }
      if (endpoint.includes('/students/100')) return { id: 100, person: { idcode: '39001010001' }, status: 'OPPURSTAATUS_K' }
      if (endpoint.includes('journalStudents')) {
        return [{ id: 10, studentId: 100, student: { idcode: '39001010001', fullname: 'Removed', status: 'OPPURSTAATUS_K' } }]
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '39001010001',
      currentGrade: '4',
      grade: '5',
      studentName: 'Removed'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: the removed student's grade is never written. If a PUT was sent at
    // all, it must not contain a row for journalStudent 10.
    const wroteRemovedStudent = putCalls.some(call =>
      (call.body.journalEntryStudents || []).some(s => s.journalStudent === 10)
    )
    expect(wroteRemovedStudent).toBe(false)
  })

  test('syncWithKriit_doesNotCallPut_whenStudentPersonalCodeIsMissing', async () => {
    // Arrange: a grade difference with no personal code — the student cannot be
    // identified, so a write could land on the wrong person.
    const { api, putCalls } = makeTahvelApi(async () => null)
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '',
      currentGrade: '4',
      grade: '5',
      studentName: 'No Code'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: the sync aborts before any write rather than guessing the student.
    expect(putCalls.length).toBe(0)
    expect(journalListSync.error).toContain('missing personal code')
  })

  test('syncWithKriit_doesNotCallPut_whenGradeAlreadyInSyncAcrossKutsehindaminePrefix', async () => {
    // Arrange: Tahvel already holds KUTSEHINDAMINE_5 and Kriit says 5. After
    // normalisation these are equal, so there is nothing to write. This prevents
    // redundant writes that would churn the journal on every sync.
    journalListSync.journalStudentIdToStudentId = { 10: 100 }
    journalListSync._cachedStudents = {
      10: { personalCode: '39001010001', name: 'A', isActive: true, isDeleted: false }
    }
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          journalEntryStudents: [{ id: 555, journalStudent: 10, grade: { code: 'KUTSEHINDAMINE_5' } }]
        }
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '39001010001',
      currentGrade: 'KUTSEHINDAMINE_5',
      grade: '5',
      studentName: 'A'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: no write, and the user is told everything is already in sync.
    expect(putCalls.length).toBe(0)
    expect(journalListSync.error).toContain('juba sünkroonis')
  })

  test('syncWithKriit_doesNotCallPut_whenPersonalCodeHasFallbackPrefix', async () => {
    // Arrange: a synthetic 'fallback-' personal code means the student could not be
    // reliably identified upstream — writing a grade for it could hit the wrong row.
    const { api, putCalls } = makeTahvelApi(async () => null)
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: 'fallback-123',
      currentGrade: '4',
      grade: '5',
      studentName: 'Unreliable'
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: sync aborts before any write.
    expect(putCalls.length).toBe(0)
    expect(journalListSync.error).toContain('invalid personal code')
  })

  test('syncWithKriit_doesNotCallPut_whenStudentFlaggedDeletedInDifferences', async () => {
    // Arrange: the difference itself flags the student as deleted from the journal.
    const { api, putCalls } = makeTahvelApi(async () => null)
    journalListSync.api = api
    journalListSync.differences = gradeDifference({
      studentPersonalCode: '39001010001',
      currentGrade: '4',
      grade: '5',
      studentName: 'Removed',
      studentIsDeleted: true
    })

    // Act
    await journalListSync.syncWithKriit()

    // Assert: the deleted student's grade is skipped at collection; nothing is written.
    expect(putCalls.length).toBe(0)
    expect(journalListSync.error).toContain('juba sünkroonis')
  })

  // --- Existing-assignment content changes (name, due date, entry type) ---
  // These flow through the same syncWithKriit PUT, updating the existing entry in
  // place by assignment id. A field is written only when Kriit's value differs from
  // Tahvel's current value.

  test('syncWithKriit_updatesAssignmentNameInPlace_andPreservesOtherFields', async () => {
    // Arrange: only the name differs.
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 7,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          nameEt: 'Vana nimi',
          journalEntryTeachers: [22816],
          journalEntryStudents: [{ id: 555, journalStudent: 10 }]
        }
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = [
      {
        subjectName: 'S',
        subjectExternalId: JOURNAL_ID,
        groupName: 'GR',
        assignments: [
          {
            assignmentExternalId: ASSIGNMENT_ID,
            assignmentName: { kriit: 'Uus nimi', Tahvel: 'Vana nimi' },
            results: []
          }
        ]
      }
    ]

    // Act
    await journalListSync.syncWithKriit()

    // Assert: one PUT to the same assignment id; name updated; structural fields kept.
    expect(putCalls.length).toBe(1)
    expect(putCalls[0].url).toContain(String(ASSIGNMENT_ID))
    expect(putCalls[0].body.nameEt).toBe('Uus nimi')
    expect(putCalls[0].body.id).toBe(ASSIGNMENT_ID)
    expect(putCalls[0].body.entryType).toBe('SISSEKANNE_H')
  })

  test('syncWithKriit_normalizesDueDate_whenDueDateChanges', async () => {
    // Arrange: only the due date differs.
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          nameEt: 'X',
          journalEntryTeachers: [1],
          journalEntryStudents: [],
          homeworkDuedate: '2025-02-01T23:59:59.000Z'
        }
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = [
      {
        subjectExternalId: JOURNAL_ID,
        assignments: [
          {
            assignmentExternalId: ASSIGNMENT_ID,
            assignmentDueAt: { kriit: '2025-03-01', Tahvel: '2025-02-01' },
            results: []
          }
        ]
      }
    ]

    // Act
    await journalListSync.syncWithKriit()

    // Assert: due date written in Tahvel's expected end-of-day datetime shape.
    expect(putCalls.length).toBe(1)
    expect(putCalls[0].body.homeworkDuedate).toBe('2025-03-01T23:59:59.000Z')
  })

  test('syncWithKriit_updatesEntryTypeAndCapacity_whenEntryTypeChanges', async () => {
    // Arrange: entry type changes from classroom (H) to independent work (I).
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          nameEt: 'X',
          journalEntryTeachers: [1],
          journalEntryStudents: []
        }
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = [
      {
        subjectExternalId: JOURNAL_ID,
        assignments: [
          {
            assignmentExternalId: ASSIGNMENT_ID,
            entryType: { kriit: 'SISSEKANNE_I', Tahvel: 'SISSEKANNE_H' },
            results: []
          }
        ]
      }
    ]

    // Act
    await journalListSync.syncWithKriit()

    // Assert: entry type updated and capacity type re-derived to match.
    expect(putCalls.length).toBe(1)
    expect(putCalls[0].body.entryType).toBe('SISSEKANNE_I')
    expect(putCalls[0].body.journalEntryCapacityTypes).toEqual(['MAHT_i'])
  })

  test('syncWithKriit_doesNotWriteAssignment_whenKriitValueEqualsTahvel', async () => {
    // Arrange: Kriit and Tahvel hold the same name — there is no real difference.
    const { api, putCalls } = makeTahvelApi(async () => null)
    journalListSync.api = api
    journalListSync.differences = [
      {
        subjectExternalId: JOURNAL_ID,
        assignments: [
          {
            assignmentExternalId: ASSIGNMENT_ID,
            assignmentName: { kriit: 'Sama', Tahvel: 'Sama' },
            results: []
          }
        ]
      }
    ]

    // Act
    await journalListSync.syncWithKriit()

    // Assert: equal values produce no change and no write.
    expect(putCalls.length).toBe(0)
    expect(journalListSync.error).toContain('juba sünkroonis')
  })

  test('syncWithKriit_appliesGradeAndAssignmentChangeInSinglePut', async () => {
    // Arrange: the same assignment has both a name change and a grade change.
    journalListSync.journalStudentIdToStudentId = { 10: 100 }
    journalListSync._cachedStudents = {
      10: { personalCode: '39001010001', name: 'A', isActive: true, isDeleted: false }
    }
    const { api, putCalls } = makeTahvelApi(async endpoint => {
      if (endpoint.includes(`/journalEntry/${ASSIGNMENT_ID}`)) {
        return {
          version: 1,
          id: ASSIGNMENT_ID,
          entryType: 'SISSEKANNE_H',
          nameEt: 'Vana',
          journalEntryTeachers: [1],
          journalEntryStudents: [{ id: 555, journalStudent: 10, grade: { code: 'KUTSEHINDAMINE_3' } }]
        }
      }
      if (endpoint.includes('/students/100')) return { id: 100, person: { idcode: '39001010001' }, status: 'OPPURSTAATUS_O' }
      if (endpoint.includes('journalStudents')) {
        return [{ id: 10, studentId: 100, student: { idcode: '39001010001', fullname: 'A', status: 'OPPURSTAATUS_O' } }]
      }
      return null
    })
    journalListSync.api = api
    journalListSync.differences = [
      {
        subjectExternalId: JOURNAL_ID,
        groupName: 'GR',
        assignments: [
          {
            assignmentExternalId: ASSIGNMENT_ID,
            assignmentName: { kriit: 'Uus', Tahvel: 'Vana' },
            results: [{ studentPersonalCode: '39001010001', currentGrade: '3', grade: '5', studentName: 'A' }]
          }
        ]
      }
    ]

    // Act
    await journalListSync.syncWithKriit()

    // Assert: a single PUT carries both the assignment name change and the grade,
    // with the existing student row id preserved (no duplicate).
    expect(putCalls.length).toBe(1)
    expect(putCalls[0].body.nameEt).toBe('Uus')
    const sent = putCalls[0].body.journalEntryStudents
    expect(sent.length).toBe(1)
    expect(sent[0].id).toBe(555)
    expect(sent[0].grade.code).toBe('KUTSEHINDAMINE_5')
  })
})
