import { buildLessonBlocks, lessonTimestamp } from './LessonSchedule.js'

/** Resolve an email link from fresh authenticated timetable data, not caller-supplied form values. */
export async function resolveLessonLink(origin, key, get, now = Date.now()) {
  const match = typeof key === 'string' && key.match(/^(\d+)-(\d{4}-\d{2}-\d{2})-(\d+|\d{2}:\d{2})$/)
  if (!match) throw new Error('Vigane tunni link.')
  const date = match[2]
  const start = lessonTimestamp(date, '00:00')
  if (!Number.isFinite(start) || Math.abs(now - start) > 366 * 86400000) throw new Error('Tunni link on aegunud.')
  const user = await get(origin, '/user')
  const teacherId = user.teacherId ?? user.teacher
  const schoolId = user.school?.id
  if (!Number.isInteger(teacherId) || !schoolId) throw new Error('Logi Tahvlisse sisse õpetajana.')
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const data = await get(origin, `/timetableevents/timetableByTeacher/${schoolId}`, {
    teachers: teacherId,
from: new Date(start).toISOString(),
    thru: new Date(lessonTimestamp(next.toISOString().slice(0, 10), '00:00') - 1).toISOString(),
lang: 'ET'
  })
  if (!Array.isArray(data?.timetableEvents)) throw new Error('Tunniplaan pole kättesaadav.')
  const response = await fetch(chrome.runtime.getURL('src/features/singleJournal/lessonDiscrepancies/LessonTimes.json'))
  const lessonTimes = (await response.json())[schoolId] || []
  const block = buildLessonBlocks(data.timetableEvents, lessonTimes, date).find(b => b.key === key)
  if (!block) throw new Error('Tundi ei leitud sinu tunniplaanist. Ava sissekanne käsitsi.')
  return { ...block, schoolId, lessonTimes }
}
