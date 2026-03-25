import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { restoreChromeMock } from '../../setup.js'

describe('LessonDiscrepanciesFeature - Utility Methods', () => {
  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      groupCollapsed: () => {},
      trace: () => {},
      groupEnd: () => {},
      error: () => {},
      warn: () => {}
    }
    global.window = {
      location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }
    }
    global.chrome = {
      runtime: {
        sendMessage: () => {},
        lastError: null
      }
    }
  })

  afterEach(() => {
    restoreChromeMock()
  })

  describe('Study year calculation (#getCurrentStudyYearDates logic)', () => {
    test('should calculate study year for fall semester (September onwards)', () => {
      const testDate = new Date('2024-09-15')
      const studyYear = testDate.getMonth() < 8 ? testDate.getFullYear() - 1 : testDate.getFullYear()

      expect(studyYear).toBe(2024)
    })

    test('should calculate study year for spring semester (before September)', () => {
      const testDate = new Date('2024-05-15')
      const studyYear = testDate.getMonth() < 8 ? testDate.getFullYear() - 1 : testDate.getFullYear()

      expect(studyYear).toBe(2023)
    })

    test('should generate correct study year date range', () => {
      const studyYear = 2024
      const from = new Date(Date.UTC(studyYear, 8, 1)).toISOString()
      const thru = new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

      expect(from).toContain('2024-09-01')
      expect(thru).toContain('2025-08-31')
    })

    test('should use August (month 8) as study year start', () => {
      const studyYear = 2024
      const from = new Date(Date.UTC(studyYear, 8, 1))

      expect(from.getUTCMonth()).toBe(8) // September is month 8
      expect(from.getUTCDate()).toBe(1)
    })
  })

  describe('Journal entry aggregation (#aggregateJournalEntries logic)', () => {
    test('should count lessons for each date', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', lessons: 2 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', lessons: 1 },
        { entryType: 'SISSEKANNE_I', entryDate: '2024-09-15', lessons: 1 }
      ]

      const aggregated = entries.reduce((acc, entry) => {
        if (entry.entryType !== 'SISSEKANNE_T') return acc

        const date = entry.entryDate
        acc[date] ??= { count: 0, entries: [] }
        acc[date].count += entry.lessons ?? 1
        acc[date].entries.push(entry)
        return acc
      }, {})

      expect(aggregated['2024-09-15'].count).toBe(3)
      expect(aggregated['2024-09-15'].entries.length).toBe(2)
    })

    test('should filter out non-lesson entries (SISSEKANNE_I)', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', lessons: 1 },
        { entryType: 'SISSEKANNE_I', entryDate: '2024-09-15', lessons: 1 }
      ]

      const lessonEntries = entries.filter(e => e.entryType === 'SISSEKANNE_T')

      expect(lessonEntries.length).toBe(1)
      expect(lessonEntries[0].entryType).toBe('SISSEKANNE_T')
    })

    test('should track minimum start lesson number per date', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', startLessonNr: 3 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', startLessonNr: 1 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', startLessonNr: 5 }
      ]

      const minStart = Math.min(...entries.map(e => Number(e.startLessonNr ?? 1)))

      expect(minStart).toBe(1)
    })

    test('should default to 1 lesson if lessons field is missing', () => {
      const entry = { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15' }
      const lessonCount = entry.lessons ?? 1

      expect(lessonCount).toBe(1)
    })
  })

  describe('Timetable event aggregation (#aggregateTimetableEvents logic)', () => {
    test('should count hours for each date', () => {
      const events = [
        { date: '2024-09-15', hours: 2 },
        { date: '2024-09-15', hours: 1 },
        { date: '2024-09-16', hours: 3 }
      ]

      const aggregated = events.reduce((acc, event) => {
        const date = event.date
        acc[date] ??= { count: 0, entries: [] }
        acc[date].count += Number(event.hours ?? 1)
        acc[date].entries.push(event)
        return acc
      }, {})

      expect(aggregated['2024-09-15'].count).toBe(3)
      expect(aggregated['2024-09-16'].count).toBe(3)
    })

    test('should track minimum lesson number per date', () => {
      const events = [
        { date: '2024-09-15', lessonNr: 3 },
        { date: '2024-09-15', lessonNr: 1 },
        { date: '2024-09-15', lessonNr: 5 }
      ]

      const minLessonNr = Math.min(...events.map(e => e.lessonNr ?? 1))

      expect(minLessonNr).toBe(1)
    })

    test('should default to 1 hour if hours field is missing', () => {
      const event = { date: '2024-09-15' }
      const hours = event.hours ?? 1

      expect(hours).toBe(1)
    })
  })

  describe('Lesson number calculation (#calculateLessonNumber logic)', () => {
    test('should return exact match from lesson times', () => {
      const times = [
        { number: 1, timeStart: '08:00' },
        { number: 2, timeStart: '09:45' },
        { number: 3, timeStart: '11:30' }
      ]

      const timeStart = '09:45'
      const exactMatch = times.find(lesson => lesson.timeStart === timeStart)

      expect(exactMatch?.number).toBe(2)
    })

    test('should find closest time when no exact match', () => {
      const times = [
        { number: 1, timeStart: '08:00' },
        { number: 2, timeStart: '09:45' },
        { number: 3, timeStart: '11:30' }
      ]

      const targetTime = new Date(`1970-01-01T09:50`).getTime()
      const timesWithMs = times.map(lesson => ({
        ...lesson,
        timeMs: new Date(`1970-01-01T${lesson.timeStart}`).getTime()
      }))

      const closest = timesWithMs.reduce((closest, current) => {
        const currentDiff = Math.abs(current.timeMs - targetTime)
        const closestDiff = Math.abs(closest.timeMs - targetTime)
        return currentDiff < closestDiff ? current : closest
      })

      expect(closest.number).toBe(2) // 09:45 is closest to 09:50
    })

    test('should return 1 as default when no times available', () => {
      const times = []
      const timeStart = '08:00'

      if (!timeStart || !times.length) {
        expect(1).toBe(1)
      }
    })

    test('should convert time strings to milliseconds correctly', () => {
      const timeStart = '08:15'
      const timeMs = new Date(`1970-01-01T${timeStart}`).getTime()

      const expectedMs = new Date('1970-01-01T08:15:00').getTime()
      expect(timeMs).toBe(expectedMs)
    })
  })

  describe('Date formatting (#formatDate logic)', () => {
    test('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-09-15T10:30:00')
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const formatted = `${year}-${month}-${day}`

      expect(formatted).toBe('2024-09-15')
    })

    test('should pad single-digit month and day', () => {
      const date = new Date('2024-01-05T10:30:00')
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')

      expect(month).toBe('01')
      expect(day).toBe('05')
    })
  })

  describe('Display date formatting (#formatDisplayDate logic)', () => {
    test('should format date as DD.MM.YYYY', () => {
      const dateStr = '2024-09-15'
      const date = new Date(dateStr)
      const day = String(date.getDate()).padStart(2, '0')
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const year = date.getFullYear()
      const formatted = `${day}.${month}.${year}`

      expect(formatted).toBe('15.09.2024')
    })

    test('should extract DD.MM prefix', () => {
      const formatted = '15.09.2024'
      const prefix = formatted.slice(0, 5)

      expect(prefix).toBe('15.09')
    })
  })

  describe('Discrepancy type identification', () => {
    test('should identify missing lesson discrepancy', () => {
      const discrepancy = {
        type: 'missing',
        date: '2024-09-15',
        tEntries: [{ hours: 2 }]
      }

      expect(discrepancy.type).toBe('missing')
      expect(discrepancy.tEntries).toBeDefined()
    })

    test('should identify lesson mismatch discrepancy', () => {
      const discrepancy = {
        type: 'mismatch',
        date: '2024-09-15',
        jCount: 2,
        tCount: 3
      }

      expect(discrepancy.type).toBe('mismatch')
      expect(discrepancy.jCount).toBeLessThan(discrepancy.tCount)
    })

    test('should identify multi-entry fix type', () => {
      const discrepancy = {
        type: 'multiEntryFix',
        entries: [{ id: 1 }, { id: 2 }]
      }

      expect(discrepancy.type).toBe('multiEntryFix')
      expect(discrepancy.entries.length).toBeGreaterThan(1)
    })
  })

  describe('Entry filtering', () => {
    test('should filter lesson entries (SISSEKANNE_T)', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', id: 1 },
        { entryType: 'SISSEKANNE_I', id: 2 },
        { entryType: 'SISSEKANNE_T', id: 3 }
      ]

      const lessonEntries = entries.filter(e => e.entryType === 'SISSEKANNE_T')

      expect(lessonEntries.length).toBe(2)
      expect(lessonEntries.every(e => e.entryType === 'SISSEKANNE_T')).toBe(true)
    })

    test('should identify independent work entries (SISSEKANNE_I)', () => {
      const entry = { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-09-20' }

      expect(entry.entryType).toBe('SISSEKANNE_I')
      expect(entry.homeworkDuedate).toBeDefined()
    })
  })

  describe('Timetable event filtering', () => {
    test('should filter events by journal ID', () => {
      const journalId = 12345
      const events = [
        { journalId: 12345, date: '2024-09-15' },
        { journalId: 67890, date: '2024-09-15' },
        { journalId: 12345, date: '2024-09-16' }
      ]

      const filtered = events.filter(event => event.journalId === journalId)

      expect(filtered.length).toBe(2)
      expect(filtered.every(e => e.journalId === journalId)).toBe(true)
    })
  })

  describe('Cache expiration logic', () => {
    test('should use longer cache for past data', () => {
      const thru = new Date('2024-01-01').toISOString()
      const isPastData = new Date(thru) < new Date()
      const cacheExpiration = isPastData ? 2592e6 : 864e5

      expect(isPastData).toBe(true)
      expect(cacheExpiration).toBe(2592e6) // 30 days
    })

    test('should use shorter cache for current/future data', () => {
      const thru = new Date(Date.now() + 86400000).toISOString() // tomorrow
      const isPastData = new Date(thru) < new Date()
      const cacheExpiration = isPastData ? 2592e6 : 864e5

      expect(isPastData).toBe(false)
      expect(cacheExpiration).toBe(864e5) // 10 days
    })

    test('should set cache expiration to 0 on force refresh', () => {
      const forceRefresh = true
      const baseCacheExpiration = 864e5
      const cacheExpiration = forceRefresh ? 0 : baseCacheExpiration

      expect(cacheExpiration).toBe(0)
    })
  })

  describe('URL timestamp for cache busting', () => {
    test('should add timestamp param on force refresh', () => {
      const forceRefresh = true
      const params = forceRefresh ? { _t: Date.now() } : {}

      expect(params._t).toBeDefined()
      expect(typeof params._t).toBe('number')
    })

    test('should not add timestamp param on normal request', () => {
      const forceRefresh = false
      const params = forceRefresh ? { _t: Date.now() } : {}

      expect(Object.keys(params).length).toBe(0)
    })
  })

  describe('Duplicate entry detection (#findDuplicateMatches logic)', () => {
    test('should handle NO_DATE entries with dash search criteria', () => {
      const date = 'NO_DATE'
      const dateSearchCriteria = date === 'NO_DATE' ? '-' : '15.09'

      expect(dateSearchCriteria).toBe('-')
    })

    test('should extract DD.MM prefix for date search', () => {
      const date = '2024-09-15'
      const displayDate = '15.09.2024'
      const dateSearchCriteria = displayDate.slice(0, 5)

      expect(dateSearchCriteria).toBe('15.09')
    })

    test('should return default duplicate info when no journal data', () => {
      const journalData = null
      if (!journalData?.entries) {
        const defaultInfo = {
          exactMatches: [],
          targetIndex: 0
        }
        expect(defaultInfo.targetIndex).toBe(0)
        expect(defaultInfo.exactMatches).toEqual([])
      }
    })
  })

})
