import { test, expect } from 'bun:test'
import { loadLessonEntryDetails, resolveEntryPeriods } from '../../src/services/LessonEntryDetails.js'

const block = { journalId: 8, date: '2026-09-16', name: 'Timetable subject', timeStart: '09:10', timeEnd: '10:40', groups: [{ code: 'TEST' }] }
const rows = [
  { lessonNr: 2, startTime: '09:10', endTime: '09:55' },
  { lessonNr: 3, startTime: '09:55', endTime: '10:40' }
].map(r => ({ ...r, validFrom: '2026-09-01', validThru: null, dayWed: true, isDefault: true, buildings: [] }))

test('uses current weekday/date-specific school periods and journal subject, not static numbers', async() => {
  const result = await loadLessonEntryDetails(async(path, params) => {
    if (path === '/journals/8') return { nameEt: 'Tarkvaraprojekt II' }
    expect(path).toBe('/lessontimes')
    expect(params).toEqual({ from: block.date, thru: block.date, size: 100, page: 0 })
    return { content: rows, totalPages: 1 }
  }, { ...block, startLessonNr: null, lessons: null })
  expect(result.periods).toEqual({ startLessonNr: 2, lessons: 2 })
  expect(result.name).toBe('Tarkvaraprojekt II')
  expect(result.content).toBe('Tunniplaani andmed:\nAine: Tarkvaraprojekt II\nKuupäev: 16.09.2026\nKellaaeg: 09:10–10:40\nÕpperühm: TEST')
})

test('rejects ambiguous buildings, overlapping periods, missing periods and approximate times', () => {
  expect(resolveEntryPeriods([...rows, ...rows.map(r => ({ ...r, lessonNr: r.lessonNr + 1, buildings: [{ id: 2 }], isDefault: false }))], block)).toBeNull()
  expect(resolveEntryPeriods([rows[0]], block)).toBeNull()
  expect(resolveEntryPeriods(rows.map(r => ({ ...r, dayWed: false })), block)).toBeNull()
  expect(resolveEntryPeriods(rows.map(r => ({ ...r, validThru: '2026-09-15' })), block)).toBeNull()
  expect(resolveEntryPeriods(rows.map(r => ({ ...r, validFrom: '2026-09-17' })), block)).toBeNull()
  expect(resolveEntryPeriods([rows[0], { ...rows[1], startTime: '09:50' }], block)).toBeNull()
  expect(resolveEntryPeriods([rows[0], { ...rows[1], lessonNr: 4 }], block)).toBeNull()
  expect(resolveEntryPeriods(rows, { ...block, timeStart: '09:11' })).toBeNull()
})

test('does not combine periods from different buildings', () => {
  expect(resolveEntryPeriods([rows[0], { ...rows[1], buildings: [{ id: 2 }] }], block)).toBeNull()
})

test('handles all pages, but rejects truncated/unavailable search results', async() => {
  let pages = 0
  const result = await loadLessonEntryDetails(async(path, params) => {
    if (path === '/journals/8') throw new Error('Forbidden')
    pages++
    return { content: [rows[params.page]], totalPages: 2 }
  }, block)
  expect(pages).toBe(2)
  expect(result.periods).toEqual({ startLessonNr: 2, lessons: 2 })
  expect(result.name).toBe(block.name)
  const partial = await loadLessonEntryDetails(async() => ({ content: rows, totalPages: 11 }), block)
  expect(partial.periods).toBeNull()
  const denied = await loadLessonEntryDetails(async() => { throw new Error('Forbidden') }, block)
  expect(denied.periods).toBeNull()
  expect(denied.content).toContain('Aine: Timetable subject')
})

test('does not invent a subject or a lesson topic when metadata is missing', async() => {
  const result = await loadLessonEntryDetails(async() => null, { ...block, name: 'Tund' })
  expect(result.name).toBe('')
  expect(result.content).not.toContain('Aine:')
  expect(result.content).not.toContain('ülesanne')
})
