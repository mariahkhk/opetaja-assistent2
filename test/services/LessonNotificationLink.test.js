import { test, expect } from 'bun:test'
import { resolveLessonLink } from '../../src/services/LessonNotificationLink.js'

test('an older email link rebuilds the block from the signed-in teacher timetable without stored notification state', async() => {
  const original = { chrome: global.chrome, fetch: global.fetch }
  global.chrome = { runtime: { getURL: p => p } }
  global.fetch = async() => Response.json({ 9: [{ number: 3, timeStart: '10:00', timeEnd: '10:45' }] })
  const calls = []
  const get = async(origin, path, params) => {
    calls.push({ path, params })
    if (path === '/user') return { teacher: 10, school: { id: 9 } }
    return { timetableEvents: [{ journalId: 8, date: '2026-09-14', timeStart: '10:00', timeEnd: '10:45', nameEt: 'Actual name' }] }
  }
  try {
    const now = Date.parse('2026-09-15T10:00:00Z')
    const block = await resolveLessonLink('https://tahvel.edu.ee', '8-2026-09-14-3', get, now)
    expect(block.name).toBe('Actual name')
    expect(block.startLessonNr).toBe(3)
    expect(block.lessons).toBe(1)
    expect(calls[1].params.teachers).toBe(10)
    expect(calls[1].params.from).toBe('2026-09-13T21:00:00.000Z')
    await expect(resolveLessonLink('https://tahvel.edu.ee', '9-2026-09-14-3', get, now)).rejects.toThrow('Tundi ei leitud')
    await expect(resolveLessonLink('https://tahvel.edu.ee', 'invalid', get, now)).rejects.toThrow()
    await expect(resolveLessonLink('https://tahvel.edu.ee', '8-2026-09-14-3', async() => ({}), now)).rejects.toThrow('Logi')
  } finally { Object.assign(global, original) }
})
