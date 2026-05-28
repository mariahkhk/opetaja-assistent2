/**
 * Data-integrity risk tests for the LIVE new-assignment sync path
 * (TahvelNewAssignmentSync.syncAssignmentsForSubject).
 *
 * When Kriit reports an assignment that is missing in Tahvel, the extension creates
 * it as a journal entry. The duplicate-entry guard here is a name + entry-type match
 * against the existing entries, not an externalId match. These tests cover: skipping
 * creation when the assignment already exists, creating when genuinely new, treating
 * a same-name-different-type assignment as distinct, and the external-id linkback
 * to Kriit.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { restoreGlobalDOM } from '../../setup.js'
import TahvelNewAssignmentSyncFeature from '../../../src/features/journalList/TahvelNewAssignmentSync.js'

const JOURNAL_ID = 348986

/**
 * Build an API mock for the new-assignment flow. Only the network boundary is mocked;
 * the real syncAssignmentsForSubject logic runs.
 *
 * `existing` are the entries already in Tahvel. Entries created via POST during the
 * test are appended and become visible to the post-create lookup, mirroring Tahvel.
 */
function makeApi({ existing = [], journalTeachers = [{ id: 2078 }] } = {}) {
  const created = []
  const journalEntryPosts = []
  const externalIdPosts = []
  let nextId = 90000

  const api = {
    tahvel: {
      get: mock(async endpoint => {
        if (endpoint.includes('journalEntriesByDate')) return [...existing, ...created]
        if (/^\/journals\/\d+$/.test(endpoint)) return { journalTeachers }
        return null
      }),
      post: mock(async (endpoint, payload) => {
        if (endpoint.includes('/journalEntry')) {
          journalEntryPosts.push(payload)
          const id = nextId++
          created.push({ id, nameEt: payload.nameEt, entryType: payload.entryType })
          return { id }
        }
        return null
      })
    },
    kriit: {
      baseUrl: 'https://kriit.example.com/api',
      post: mock(async (endpoint, payload) => {
        if (endpoint.includes('setAssignmentExternalId')) externalIdPosts.push(payload)
        return { status: 200 }
      })
    }
  }

  return { api, journalEntryPosts, externalIdPosts }
}

describe('TahvelNewAssignmentSync — new-assignment data-integrity risks', () => {
  let feature
  let originalSetTimeout

  beforeEach(() => {
    feature = new TahvelNewAssignmentSyncFeature()
    // getCreatedAssignmentExternalId waits 1s for Tahvel to persist; run it instantly.
    originalSetTimeout = global.setTimeout
    global.setTimeout = fn => {
      if (typeof fn === 'function') fn()
      return 0
    }
  })

  afterEach(() => {
    global.setTimeout = originalSetTimeout
    restoreGlobalDOM()
  })

  test('syncAssignmentsForSubject_skipsCreation_whenNameAndTypeAlreadyExist', async () => {
    // Arrange: Tahvel already has an entry with the same name and entry type.
    const { api, journalEntryPosts } = makeApi({
      existing: [{ id: 111, nameEt: 'Kodutöö 1', entryType: 'SISSEKANNE_I' }]
    })
    feature.api = api

    // Act
    const results = await feature.syncAssignmentsForSubject(JOURNAL_ID, [
      { assignmentName: 'Kodutöö 1', assignmentEntryType: 'SISSEKANNE_I', createdAssignmentId: 7 }
    ])

    // Assert: no create POST, so no duplicate entry.
    expect(journalEntryPosts.length).toBe(0)
    expect(results.success.length).toBe(0)
    expect(results.failed.length).toBe(0)
  })

  test('syncAssignmentsForSubject_createsEntry_whenAssignmentIsNew', async () => {
    // Arrange: no matching entry exists yet.
    const { api, journalEntryPosts } = makeApi({ existing: [] })
    feature.api = api

    // Act
    const results = await feature.syncAssignmentsForSubject(JOURNAL_ID, [
      {
        assignmentName: 'Uus ülesanne',
        assignmentEntryType: 'SISSEKANNE_H',
        assignmentEntryDate: '2025-03-01',
        assignmentDueAt: '2025-03-08',
        createdAssignmentId: 42
      }
    ])

    // Assert: exactly one create with the right name/type, and the new external id is
    // resolved and reported back for linking to Kriit.
    expect(journalEntryPosts.length).toBe(1)
    expect(journalEntryPosts[0].nameEt).toBe('Uus ülesanne')
    expect(journalEntryPosts[0].entryType).toBe('SISSEKANNE_H')
    expect(results.success.length).toBe(1)
    expect(results.success[0].kriitAssignmentId).toBe(42)
    expect(results.success[0].tahvelExternalId).toBe(90000)
  })

  test('syncAssignmentsForSubject_createsEntry_whenSameNameButDifferentEntryType', async () => {
    // Arrange: same name exists, but as a different entry type — a distinct assignment.
    const { api, journalEntryPosts } = makeApi({
      existing: [{ id: 111, nameEt: 'Töö', entryType: 'SISSEKANNE_I' }]
    })
    feature.api = api

    // Act
    await feature.syncAssignmentsForSubject(JOURNAL_ID, [
      { assignmentName: 'Töö', assignmentEntryType: 'SISSEKANNE_H', createdAssignmentId: 9 }
    ])

    // Assert: treated as new (name+type differs), so it is created.
    expect(journalEntryPosts.length).toBe(1)
    expect(journalEntryPosts[0].entryType).toBe('SISSEKANNE_H')
  })

  test('sendExternalIdsToKriit_linksEachCreatedAssignmentBackToKriit', async () => {
    // Arrange: two successfully created assignments awaiting their external id linkback.
    const { api, externalIdPosts } = makeApi()
    feature.api = api

    // Act
    await feature.sendExternalIdsToKriit([
      { kriitAssignmentId: 42, tahvelExternalId: 90000 },
      { kriitAssignmentId: 43, tahvelExternalId: 90001 }
    ])

    // Assert: one linkback per assignment, carrying the Kriit id and Tahvel external id.
    expect(externalIdPosts.length).toBe(2)
    expect(externalIdPosts[0]).toEqual({ assignmentId: 42, assignmentExternalId: 90000, systemId: 1 })
    expect(externalIdPosts[1]).toEqual({ assignmentId: 43, assignmentExternalId: 90001, systemId: 1 })
  })
})
