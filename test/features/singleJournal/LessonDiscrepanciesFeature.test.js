import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { restoreChromeMock, restoreGlobalDOM } from '../../setup.js'
import LessonDiscrepanciesFeature from '../../../src/features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js'
import Logger from '../../../src/services/Logger.js'

describe('LessonDiscrepanciesFeature — public methods', () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    restoreChromeMock()
    global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
    feature = new LessonDiscrepanciesFeature()
  })

  describe('formatDate', () => {
    test('returns YYYY-MM-DD string for ISO input', () => {
      expect(feature.formatDate('2024-09-15T10:30:00Z')).toBe('2024-09-15')
    })

    test('returns YYYY-MM-DD for Date object', () => {
      expect(feature.formatDate(new Date('2024-01-05T00:00:00Z'))).toBe('2024-01-05')
    })

    test('returns null for null/undefined/empty', () => {
      expect(feature.formatDate(null)).toBeNull()
      expect(feature.formatDate(undefined)).toBeNull()
      expect(feature.formatDate('')).toBeNull()
    })

    test('returns null for invalid date strings', () => {
      expect(feature.formatDate('not-a-date')).toBeNull()
    })
  })

  describe('formatDisplayDate', () => {
    test('returns DD.MM.YYYY for ISO date', () => {
      expect(feature.formatDisplayDate('2024-09-15')).toBe('15.09.2024')
    })

    test('pads single-digit month and day', () => {
      expect(feature.formatDisplayDate('2024-01-05')).toBe('05.01.2024')
    })

    test('returns DD.MM.YYYY input unchanged', () => {
      expect(feature.formatDisplayDate('15.09.2024')).toBe('15.09.2024')
    })

    test('parses single-digit DD.MM.YYYY input', () => {
      expect(feature.formatDisplayDate('5.1.2024')).toBe('05.01.2024')
    })

    test('returns "Invalid Date" for null/undefined/empty', () => {
      expect(feature.formatDisplayDate(null)).toBe('Invalid Date')
      expect(feature.formatDisplayDate(undefined)).toBe('Invalid Date')
      expect(feature.formatDisplayDate('')).toBe('Invalid Date')
    })

    test('returns "Invalid Date" for unparseable input', () => {
      expect(feature.formatDisplayDate('not-a-date')).toBe('Invalid Date')
    })
  })

  describe('extractJournalId', () => {
    test('parses journal id from /journal/<id>/edit URL', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
      expect(feature.extractJournalId()).toBe(12345)
    })

    test('parses journal id from /journal/<id>', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/9876' } }
      expect(feature.extractJournalId()).toBe(9876)
    })

    test('parses journal id from journalId= query param', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/something?journalId=42' } }
      expect(feature.extractJournalId()).toBe(42)
    })

    test('returns null when URL has no journal id', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/home' } }
      expect(feature.extractJournalId()).toBeNull()
    })
  })

  describe('getCurrentStudyYearDates', () => {
    test('returns ISO strings for September 1 to August 31 of next year', () => {
      const { from, thru } = feature.getCurrentStudyYearDates()
      const fromDate = new Date(from)
      const thruDate = new Date(thru)
      expect(fromDate.getUTCMonth()).toBe(8)
      expect(fromDate.getUTCDate()).toBe(1)
      expect(thruDate.getUTCMonth()).toBe(7)
      expect(thruDate.getUTCDate()).toBe(31)
      expect(thruDate.getUTCFullYear() - fromDate.getUTCFullYear()).toBe(1)
    })

    test('returns valid ISO 8601 strings', () => {
      const { from, thru } = feature.getCurrentStudyYearDates()
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/)
      expect(thru).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/)
    })
  })

  describe('aggregateJournalEntries', () => {
    test('counts SISSEKANNE_T lessons per date', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', lessons: 2, startLessonNr: 1 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', lessons: 1, startLessonNr: 3 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-16', lessons: 1, startLessonNr: 1 }
      ]
      const result = feature.aggregateJournalEntries(entries)
      expect(result['2024-09-15'].count).toBe(3)
      expect(result['2024-09-15'].entries.length).toBe(2)
      expect(result['2024-09-16'].count).toBe(1)
    })

    test('also counts SISSEKANNE_P and SISSEKANNE_E (contact types)', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', lessons: 1 },
        { entryType: 'SISSEKANNE_P', entryDate: '2024-09-15', lessons: 2 },
        { entryType: 'SISSEKANNE_E', entryDate: '2024-09-15', lessons: 3 }
      ]
      const result = feature.aggregateJournalEntries(entries)
      expect(result['2024-09-15'].count).toBe(6)
      expect(result['2024-09-15'].entries.length).toBe(3)
    })

    test('ignores non-contact entries (SISSEKANNE_I, SISSEKANNE_L, SISSEKANNE_O)', () => {
      const entries = [
        { entryType: 'SISSEKANNE_I', entryDate: '2024-09-15', lessons: 5 },
        { entryType: 'SISSEKANNE_L', entryDate: '2024-09-15' },
        { entryType: 'SISSEKANNE_O', entryDate: '2024-09-15' }
      ]
      const result = feature.aggregateJournalEntries(entries)
      expect(Object.keys(result).length).toBe(0)
    })

    test('tracks minimum start lesson number per date', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', startLessonNr: 5 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', startLessonNr: 1 },
        { entryType: 'SISSEKANNE_T', entryDate: '2024-09-15', startLessonNr: 3 }
      ]
      const result = feature.aggregateJournalEntries(entries)
      expect(result['2024-09-15'].start).toBe(1)
    })

    test('defaults to 1 lesson when lessons field is missing', () => {
      const entries = [{ entryType: 'SISSEKANNE_T', entryDate: '2024-09-15' }]
      const result = feature.aggregateJournalEntries(entries)
      expect(result['2024-09-15'].count).toBe(1)
    })

    test('returns empty object for empty input', () => {
      expect(feature.aggregateJournalEntries([])).toEqual({})
    })
  })

  describe('calculateLessonNumber', () => {
    test('returns exact-match lesson number when timeStart matches', async () => {
      global.chrome.runtime.sendMessage = (_msg, cb) => {
        cb({
          data: {
            9: [
              { number: 1, timeStart: '08:00' },
              { number: 2, timeStart: '09:45' },
              { number: 3, timeStart: '11:30' }
            ]
          }
        })
      }
      expect(await feature.calculateLessonNumber('09:45', 9)).toBe(2)
    })

    test('returns closest lesson number when timeStart has no exact match', async () => {
      global.chrome.runtime.sendMessage = (_msg, cb) => {
        cb({
          data: {
            9: [
              { number: 1, timeStart: '08:00' },
              { number: 2, timeStart: '09:45' },
              { number: 3, timeStart: '11:30' }
            ]
          }
        })
      }
      expect(await feature.calculateLessonNumber('09:50', 9)).toBe(2)
      expect(await feature.calculateLessonNumber('11:00', 9)).toBe(3)
    })

    test('returns 1 when no lesson times available', async () => {
      global.chrome.runtime.sendMessage = (_msg, cb) => cb({ data: { 9: [] } })
      expect(await feature.calculateLessonNumber('10:00', 9)).toBe(1)
    })

    test('returns 1 when timeStart is empty', async () => {
      global.chrome.runtime.sendMessage = (_msg, cb) => cb({
        data: { 9: [{ number: 1, timeStart: '08:00' }] }
      })
      expect(await feature.calculateLessonNumber('', 9)).toBe(1)
    })

    test('returns 1 when schoolId is missing', async () => {
      expect(await feature.calculateLessonNumber('10:00', null)).toBe(1)
    })
  })

  describe('aggregateTimetableEvents', () => {
    beforeEach(() => {
      global.chrome.runtime.sendMessage = (_msg, cb) => {
        cb({
          data: {
            9: [
              { number: 1, timeStart: '08:00' },
              { number: 2, timeStart: '09:45' },
              { number: 3, timeStart: '11:30' }
            ]
          }
        })
      }
    })

    test('counts events per date', async () => {
      const events = [
        { date: '2024-09-15', timeStart: '08:00' },
        { date: '2024-09-15', timeStart: '09:45' },
        { date: '2024-09-16', timeStart: '11:30' }
      ]
      const result = await feature.aggregateTimetableEvents(events, 9)
      expect(result['2024-09-15'].count).toBe(2)
      expect(result['2024-09-16'].count).toBe(1)
    })

    test('tracks minimum lesson number per date', async () => {
      const events = [
        { date: '2024-09-15', timeStart: '11:30' },
        { date: '2024-09-15', timeStart: '08:00' }
      ]
      const result = await feature.aggregateTimetableEvents(events, 9)
      expect(result['2024-09-15'].start).toBe(1)
    })

    test('returns empty object for empty input', async () => {
      const result = await feature.aggregateTimetableEvents([], 9)
      expect(result).toEqual({})
    })
  })

  describe('findDuplicateMatches', () => {
    test('returns default when no journal data set', () => {
      feature.lastJournalData = null
      const result = feature.findDuplicateMatches('123', '2024-09-15')
      expect(result.exactMatches).toEqual([])
      expect(result.targetIndex).toBe(0)
    })

    test('returns default when target entry not found', () => {
      feature.lastJournalData = {
        entries: [{ id: 1, entryType: 'SISSEKANNE_T', entryDate: '2024-09-15' }]
      }
      const result = feature.findDuplicateMatches('999', '2024-09-15')
      expect(result.exactMatches).toEqual([])
      expect(result.targetIndex).toBe(0)
    })
  })

  describe('getCapacityTypeProblems empty-entries guard (real class)', () => {
    let originalLoggerError
    let loggerErrorCalls

    beforeEach(() => {
      originalLoggerError = Logger.error
      loggerErrorCalls = []
      Logger.error = (...args) => { loggerErrorCalls.push(args) }
    })

    afterEach(() => {
      Logger.error = originalLoggerError
    })

    test('returns [] without logging an error when entries is empty', async () => {
      const journalData = { entries: [], info: { lessonHours: { capacityHours: [] } } }
      const result = await feature.getCapacityTypeProblems(journalData)
      expect(result).toEqual([])
      expect(loggerErrorCalls).toEqual([])
    })

    test('returns [] without logging an error when entries contain only non-target types', async () => {
      const journalData = {
        entries: [{ entryType: 'SISSEKANNE_L', id: 1 }],
        info: { lessonHours: { capacityHours: [] } }
      }
      const result = await feature.getCapacityTypeProblems(journalData)
      expect(result).toEqual([])
      expect(loggerErrorCalls).toEqual([])
    })
  })
})
