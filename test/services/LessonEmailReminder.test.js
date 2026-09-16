import { test, expect } from 'bun:test'
import { isLessonRecorded, lessonEmailSettings, sendLessonEmail } from '../../src/services/LessonEmailReminder.js'

const block = { journalId: 8, date: '2026-09-14', timeStart: '10:00', timeEnd: '11:30', startLessonNr: 3, lessons: 2, capacityType: 'MAHT_a', name: 'Test' }
const entry = { entryDate: block.date, entryType: 'SISSEKANNE_T', startLessonNr: 3, lessons: 2 }
test('only complete matching-date and matching-type coverage counts as recorded', () => {
  expect(isLessonRecorded([], block)).toBe(false)
  expect(isLessonRecorded([entry], block)).toBe(true)
  expect(isLessonRecorded([{ ...entry, lessons: 1 }], block)).toBe(false)
  expect(isLessonRecorded([{ ...entry, lessons: 1 }, { ...entry, startLessonNr: 4, lessons: 1 }], block)).toBe(true)
  expect(isLessonRecorded([{ ...entry, entryDate: '2026-09-13' }], block)).toBe(false)
  expect(isLessonRecorded([{ ...entry, entryType: 'SISSEKANNE_L' }], block)).toBe(false)
  expect(() => isLessonRecorded({}, block)).toThrow()
  expect(() => isLessonRecorded([], { ...block, lessons: null })).toThrow()
})

test('email transport requires enabled secure Kriit and sends no attendance or arbitrary recipient', async() => {
  const original = { chrome: global.chrome, fetch: global.fetch }
  let settings = { OA_kriitEnabled: false }
  global.chrome = { storage: { local: { get: async() => settings } } }
  try {
    expect(await lessonEmailSettings()).toBeNull()
    settings = { OA_kriitEnabled: true, OA_kriitApiBaseUrl: 'http://example.com/api', OA_kriitApiToken: 'secret' }
    await expect(lessonEmailSettings()).rejects.toThrow()
    settings.OA_kriitApiBaseUrl = 'https://example.com/api/'
    const configured = await lessonEmailSettings()
    expect(configured.url).toBe('https://example.com/api/lessonreminders/send')
    global.fetch = async(url, options) => {
      expect(options.credentials).toBe('omit')
      expect(options.redirect).toBe('error')
      expect(options.headers.Authorization).toBe('Bearer secret')
      expect(JSON.parse(options.body)).toEqual({ origin: 'https://tahvel.edu.ee', schoolId: 9, journalId: 8, date: block.date, timeStart: block.timeStart, timeEnd: block.timeEnd, startLessonNr: 3, name: 'Test' })
      return Response.json({ status: 200, data: { ok: true } })
    }
    await sendLessonEmail(configured, 'https://tahvel.edu.ee', 9, { ...block, students: ['private'], email: 'other@example.com' })
    global.fetch = async() => Response.json({ status: 200, data: { ok: true, duplicate: true } })
    await sendLessonEmail(configured, 'https://tahvel.edu.ee', 9, block)
    global.fetch = async() => Response.json({ status: 200, data: { ok: false } })
    await expect(sendLessonEmail(configured, 'https://tahvel.edu.ee', 9, block)).rejects.toThrow()
    global.fetch = async() => new Response('', { status: 500 })
    await expect(sendLessonEmail(configured, 'https://tahvel.edu.ee', 9, block)).rejects.toThrow()
  } finally { Object.assign(global, original) }
})
