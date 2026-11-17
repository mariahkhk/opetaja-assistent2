import { describe, test, expect } from 'bun:test'
import { resolveNearestPeriods } from '../../src/services/LessonEntryDetails.js'

const times = [['08:15', '09:00'], ['09:10', '09:55'], ['09:55', '10:40'], ['10:50', '11:35'], ['11:40', '12:25'],
  ['12:30', '13:15'], ['13:20', '14:05'], ['14:10', '14:55'], ['15:00', '15:45'], ['15:55', '16:35']]
const rows = times.map(([startTime, endTime], i) => ({
  lessonNr: i + 1, startTime, endTime, validFrom: '2026-09-01', validThru: null, isDefault: true, buildings: [], dayThu: true
}))

describe('nearest school period for a timetable block', () => {
  test('08:30–11:45 is lessons 1–4', () => {
    expect(resolveNearestPeriods(rows, { date: '2026-11-19', timeStart: '08:30', timeEnd: '11:45' })).toEqual({ startLessonNr: 1, lessons: 4 })
  })
  test('12:30–15:45 is lessons 6–9', () => {
    expect(resolveNearestPeriods(rows, { date: '2026-10-22', timeStart: '12:30', timeEnd: '15:45' })).toEqual({ startLessonNr: 6, lessons: 4 })
  })
  test('no plan on that weekday gives null', () => {
    expect(resolveNearestPeriods(rows, { date: '2026-11-18', timeStart: '08:30', timeEnd: '11:45' })).toBeNull()
  })
})
