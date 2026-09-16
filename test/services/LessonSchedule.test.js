import { test, expect } from 'bun:test'
import { buildLessonBlocks, lessonTimestamp, tallinnDate } from '../../src/services/LessonSchedule.js'
import { previousLessonAttendance } from '../../src/services/PreviousLessonAttendance.js'

test('Tallinn timestamps respect winter/summer time and date rollover', () => {
  expect(new Date(lessonTimestamp('2026-01-10', '10:00')).toISOString()).toBe('2026-01-10T08:00:00.000Z')
  expect(new Date(lessonTimestamp('2026-09-14', '10:00')).toISOString()).toBe('2026-09-14T07:00:00.000Z')
  expect(tallinnDate(Date.parse('2026-09-14T22:00:00Z'))).toBe('2026-09-15')
})

test('adjacent periods merge, but different groups and gaps do not', () => {
  const times = [{ number: 1, timeStart: '08:15', timeEnd: '09:00' }, { number: 2, timeStart: '09:10', timeEnd: '09:55' }]
  const first = { id: 1, journalId: 5, date: '2026-09-14', timeStart: '08:15', timeEnd: '09:00', studentGroups: [{ id: 3, code: 'A' }] }
  const second = { ...first, id: 2, timeStart: '09:10', timeEnd: '09:55' }
  const blocks = buildLessonBlocks([second, first, first], times, '2026-09-14')
  expect(blocks).toHaveLength(1)
  expect(blocks[0].lessons).toBe(2)
  expect(blocks[0].timeEnd).toBe('09:55')
  expect(buildLessonBlocks([first, { ...second, studentGroups: [{ id: 4 }] }], times, first.date)).toHaveLength(2)
  expect(buildLessonBlocks([first], [], first.date)[0].startLessonNr).toBeNull()
  expect(buildLessonBlocks([first], times, '2026-09-15')).toEqual([])
})

test('attendance uses another journal, ignores future entries and lateness', async() => {
  const get = async path => {
    if (path === '/timetableevents') return { content: [{ journalId: 2, date: '2026-09-14', timeStart: '09:55', timeEnd: '10:40', studentGroups: [{ id: 1 }] }], totalPages: 1 }
    if (path.endsWith('journalEntriesByDate')) return [{ id: 9, entryDate: '2026-09-14', startLessonNr: 3, lessons: 1, entryType: 'SISSEKANNE_T' }, { id: 10, entryDate: '2026-09-15', startLessonNr: 1, entryType: 'SISSEKANNE_T' }]
    if (path === '/journals/2/journalEntry/9') return { journalEntryStudents: [{ journalStudent: 20, absence: 'PUUDUMINE_P' }, { journalStudent: 21, absence: 'PUUDUMINE_H' }] }
    if (path === '/journals/2/journalStudents') return [{ id: 20, studentGroup: 'A', fullname: 'Test Student' }, { id: 21, studentGroup: 'A', fullname: 'Late Student' }]
    throw new Error('Unexpected request')
  }
  const result = await previousLessonAttendance(get, { groups: [{ id: 1, code: 'A' }], date: '2026-09-14', startLessonNr: 5, start: lessonTimestamp('2026-09-14', '11:40'), lessonTimes: [{ number: 3, timeEnd: '10:40' }] })
  expect(result.names).toEqual(['Test Student'])
})

test('unavailable previous attendance leaves students present and warns', async() => {
  const result = await previousLessonAttendance(async() => { throw new Error('Forbidden') }, { groups: [{ id: 1, code: 'A' }] })
  expect(result.names).toEqual([])
  expect(result.warning).toContain('pole kättesaadav')
})

test('a missing entry for the preceding scheduled lesson does not copy older absences', async() => {
  const result = await previousLessonAttendance(async path => {
    if (path === '/timetableevents') return { content: [{ journalId: 2, date: '2026-09-14', timeStart: '09:55', timeEnd: '10:40', studentGroups: [{ id: 1 }] }], totalPages: 1 }
    if (path.endsWith('journalEntriesByDate')) return [{ id: 9, entryDate: '2026-09-13', startLessonNr: 3, lessons: 1, entryType: 'SISSEKANNE_T' }]
    throw new Error('Must not fetch older attendance')
  }, { groups: [{ id: 1, code: 'A' }], date: '2026-09-14', start: lessonTimestamp('2026-09-14', '11:40'), lessonTimes: [{ number: 3, timeEnd: '10:40' }] })
  expect(result.names).toEqual([])
  expect(result.warning).toContain('pole kättesaadav')
})
