import { lessonTimestamp } from './LessonSchedule.js'

/** Find the previous scheduled contact lesson for each group across accessible journals.
 * Reads fresh data only; attendance is never persisted or posted by this helper.
 * @param {Function} get - Authenticated GET helper bound to Tahvel.
 * @param {object} block - Notification's lesson block.
 * @returns {Promise<{names: string[], warning: string|null}>}
 */
export async function previousLessonAttendance(get, block) {
  if (!block.groups?.length) return { names: [], students: [], warning: 'Õpperühm puudub; kontrolli puudujad käsitsi.' }
  const absent = new Map()
  const failures = []
  for (const group of block.groups) {
    try {
      if (!group.id) throw new Error('Rühma tunnus puudub')
      const from = new Date(`${block.date}T12:00:00Z`)
      from.setUTCDate(from.getUTCDate() - 14)
      const events = []
      for (let page = 0; page < 50; page++) {
        const data = await get('/timetableevents', { studentGroups: group.id, from: from.toISOString().slice(0, 10), thru: block.date, size: 100, page })
        if (!Array.isArray(data.content)) throw new Error('Rühma tunniplaan pole kättesaadav')
        events.push(...data.content)
        if (page + 1 >= data.totalPages || data.content.length < 100) break
        if (page === 49) throw new Error('Rühma tunniplaan on poolik')
      }
      const candidates = events.filter(e => e.studentGroups?.some(g => g.id === group.id) && e.journalId && e.date && e.timeEnd && e.timeStart)
        .map(e => ({ ...e, end: lessonTimestamp(e.date, e.timeEnd) }))
        .filter(e => e.end <= block.start).sort((a, b) => b.end - a.end)
      const previous = candidates[0]
      if (!previous || (candidates[1]?.end === previous.end && candidates[1].journalId !== previous.journalId)) throw new Error('Eelmine tund pole üheselt tuvastatav')
      const period = block.lessonTimes?.find(t => t.timeEnd === previous.timeEnd.slice(0, 5))?.number
      if (!period) throw new Error('Eelmise tunni number puudub')
      const entries = await get(`/journals/${previous.journalId}/journalEntriesByDate`, { allStudents: true })
      const matches = entries.filter(e => ['SISSEKANNE_T', 'SISSEKANNE_P'].includes(e.entryType) &&
        e.entryDate?.slice(0, 10) === previous.date.slice(0, 10) && Number(e.startLessonNr) <= period &&
        Number(e.startLessonNr) + Number(e.lessons) > period)
      if (matches.length !== 1) throw new Error('Eelmine tund on sisse kandmata või mitmetähenduslik')
      const detail = await get(`/journals/${previous.journalId}/journalEntry/${matches[0].id}`)
      const students = await get(`/journals/${previous.journalId}/journalStudents`, { allStudents: true })
      if (!Array.isArray(detail.journalEntryStudents) || !Array.isArray(students)) throw new Error('Puudujate info puudub')
      for (const entry of detail.journalEntryStudents) {
        const code = typeof entry.absence === 'string' ? entry.absence : entry.absence?.code
        const periodAbsence = Object.values(entry.lessonAbsences || {}).find(a => Number(a.lessonNr) === period)
        const codes = entry.isLessonAbsence ? [typeof periodAbsence?.absence === 'string' ? periodAbsence.absence : periodAbsence?.absence?.code] : [code]
        if (!codes.some(c => ['PUUDUMINE_P', 'PUUDUMINE_V', 'PUUDUMINE_PR'].includes(c))) continue
        const student = students.find(s => s.id === entry.journalStudent)
        if (student?.studentGroup === group.code && student.fullname) absent.set(`${group.code}:${student.fullname}`, { name: student.fullname, group: group.code })
      }
    } catch { failures.push(group.code || 'rühm') }
  }
  return {
    names: [...absent.values()].map(s => s.name),
    students: [...absent.values()],
    warning: failures.length ? `Eelmise tunni puudujate info pole kättesaadav (${failures.join(', ')}). Kontrolli kohalolekut.`
      : null
  }
}
