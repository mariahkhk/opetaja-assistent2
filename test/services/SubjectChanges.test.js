import { test, expect } from 'bun:test'
import { subjectChanges } from '../../src/services/SubjectChanges.js'
import { buildLessonBlocks } from '../../src/services/LessonSchedule.js'

const event = (id, start, end, name = 'Matemaatika', extra = {}) => ({
  id, journalId: id, date: '2026-09-14', timeStart: start, timeEnd: end, nameEt: name,
  studentGroups: [{ id: 1, code: 'TEST' }], ...extra
})
const changes = events => subjectChanges(buildLessonBlocks(events, [], '2026-09-14'))

test('same subject across journals, groups, rooms and breaks does not trigger a change', () => {
  expect(changes([
    event(1, '08:15', '09:00'),
    event(2, '09:10', '09:55', '  MATEMAATIKA ', { studentGroups: [{ id: 2, code: 'OTHER' }], rooms: [{ id: 99 }] }),
    event(3, '12:00', '12:45')
  ])).toEqual([])
})

test('a different subject creates one alert at its start, not one per period or duplicate', () => {
  const next = event(2, '09:10', '09:55', 'Eesti keel')
  const result = changes([event(1, '08:15', '09:00'), next, next, event(3, '10:00', '10:45', 'Eesti keel')])
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ key: '2026-09-14-09:10', name: 'Eesti keel', previousName: 'Matemaatika', timeStart: '09:10' })
})

test('day boundaries, unknown subjects and conflicting overlapping lessons are not guessed', () => {
  expect(changes([event(1, '08:15', '09:00')])).toEqual([])
  expect(changes([event(1, '08:15', '09:00', 'Tund'), event(2, '09:10', '09:55', 'Eesti keel')])).toEqual([])
  expect(changes([
    event(1, '08:15', '09:30'), event(2, '09:10', '09:55', 'Eesti keel'), event(3, '10:00', '10:45', 'Füüsika')
  ])).toEqual([])
  const first = buildLessonBlocks([event(1, '08:15', '09:00')], [], '2026-09-14')
  const second = buildLessonBlocks([event(2, '08:15', '09:00', 'Eesti keel', { date: '2026-09-15' })], [], '2026-09-15')
  expect(subjectChanges([...first, ...second])).toEqual([])
})
