import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { restoreChromeMock, restoreGlobalDOM } from '../../setup.js'

function makeMockApi({ timetableEvents = [], planData = null } = {}) {
  return {
    tahvel: {
      get: async endpoint => {
        if (endpoint.includes('autocomplete/studyYears')) {
          return [{ id: 727, nameEt: '2025/2026' }]
        }
        if (endpoint.includes('timetableByTeacher')) {
          return { timetableEvents }
        }
        if (endpoint.includes('lessonplans/byteacher')) {
          return planData
        }
        return null
      }
    }
  }
}

describe('JournalListSync lesson dates', () => {
  let journalListSync

  beforeEach(async () => {
    // Mock console to avoid "console.log is not a function" errors
    if (!global.console.log) {
      global.console.log = () => {}
    }
    if (!global.console.groupEnd) {
      global.console.groupEnd = () => {}
    }
    if (!global.console.groupCollapsed) {
      global.console.groupCollapsed = () => {}
    }

    // Get fresh reference to journalListSync and reset its state
    const module = await import('../../../src/features/journalList/JournalListSync.js')
    journalListSync = module.journalListSync
    // Reset the api to ensure clean state
    journalListSync.api = null
  })

  afterEach(() => {
    restoreChromeMock()
    restoreGlobalDOM()
  })

  it('returns exact first lesson from timetable and marks it not approximate', async () => {
    const now = new Date()
    const d1 = new Date(now)
    d1.setDate(now.getDate() - 10)
    const d2 = new Date(now)
    d2.setDate(now.getDate() + 5)

    const timetableEvents = [
      { journalId: 123, date: d1.toISOString() },
      { journalId: 123, date: d2.toISOString() }
    ]

    journalListSync.api = makeMockApi({ timetableEvents })

    const journalInfo = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 2 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res = await journalListSync.getLessonDates(123, journalInfo)
    expect(res.firstLessonDate).toBe(d1.toISOString())
    expect(res.firstLessonDateIsApproximate).toBe(false)
    expect(res.nextLessonDate).toBe(d2.toISOString())
  })

  it('falls back to lessonplan for first lesson and marks approximate', async () => {
    const planData = {
      weekNrs: [1, 2, 3],
      studyPeriods: [{ weekNrs: [1, 2, 3], weekBeginningDates: ['2025-09-01T00:00:00Z', '2025-09-08T00:00:00Z', '2025-09-15T00:00:00Z'] }],
      journals: [{ id: 321, hours: { MAHT_a: [null, 2, null] } }]
    }

    journalListSync.api = makeMockApi({ timetableEvents: [], planData })

    const journalInfo = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 1 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res = await journalListSync.getLessonDates(321, journalInfo)
    expect(res.firstLessonDate).toBe('2025-09-08T00:00:00Z')
    expect(res.firstLessonDateIsApproximate).toBe(true)
    expect(res.nextLessonDate).toBe(null)
  })

  it('skips today when selecting next lesson', async () => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    const later = new Date(today)
    later.setDate(today.getDate() + 3)

    const timetableEvents = [
      { journalId: 555, date: today.toISOString() },
      { journalId: 555, date: tomorrow.toISOString() },
      { journalId: 555, date: later.toISOString() }
    ]

    journalListSync.api = makeMockApi({ timetableEvents })

    const journalInfo = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 3 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res = await journalListSync.getLessonDates(555, journalInfo)
    expect(res.nextLessonDate).toBe(tomorrow.toISOString())
  })

  it('only sends lastLessonDate when timetable length matches planned MAHT_a', async () => {
    const d1 = new Date('2025-10-01')
    const d2 = new Date('2025-10-09')

    const timetableEvents = [
      { journalId: 777, date: d1.toISOString() },
      { journalId: 777, date: d2.toISOString() }
    ]

    journalListSync.api = makeMockApi({ timetableEvents })

    const journalInfo1 = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 2 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res1 = await journalListSync.getLessonDates(777, journalInfo1)
    expect(res1.lastLessonDate).toBe(d2.toISOString())

    journalListSync.api = makeMockApi({ timetableEvents })

    const journalInfo2 = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 1 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res2 = await journalListSync.getLessonDates(777, journalInfo2)
    expect(res2.lastLessonDate).toBeNull()
  })
})
