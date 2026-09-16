/** Return a calendar date in the school's time zone, independent of the PC zone. */
export function tallinnDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
}

/** Convert a Tallinn wall-clock time to an epoch timestamp (including DST). */
export function lessonTimestamp(date, time) {
  const target = Date.parse(`${date.slice(0, 10)}T${time.slice(0, 5)}:00Z`)
  let result = target
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Tallinn',
year: 'numeric',
month: '2-digit',
day: '2-digit',
      hour: '2-digit',
minute: '2-digit',
second: '2-digit',
hourCycle: 'h23'
    }).formatToParts(new Date(result)).map(p => [p.type, p.value]))
    const wall = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
    result += target - wall
  }
  return result
}

/** Normalize timetable events into consecutive lesson blocks without joining different groups. */
export function buildLessonBlocks(events, lessonTimes, date) {
  const slots = events.filter(e => e.journalId && e.date?.slice(0, 10) === date && e.timeStart && e.timeEnd)
    .map(e => {
      const first = lessonTimes.find(t => t.timeStart === e.timeStart.slice(0, 5))
      const last = lessonTimes.find(t => t.timeEnd === e.timeEnd.slice(0, 5))
      return {
        journalId: Number(e.journalId),
date,
start: lessonTimestamp(date, e.timeStart),
end: lessonTimestamp(date, e.timeEnd),
        timeStart: e.timeStart.slice(0, 5),
timeEnd: e.timeEnd.slice(0, 5),
        startLessonNr: first?.number ?? null,
        lessons: first && last && last.number >= first.number ? last.number - first.number + 1 : null,
        name: e.nameEt || e.name || 'Tund',
capacityType: e.capacityType || 'MAHT_a',
        groups: (e.studentGroups || []).map(g => ({ id: g.id, code: g.code })),
        subgroupKey: (e.subgroups || []).map(g => g.id ?? g.code).sort().join(','),
        eventIds: [e.id].filter(id => id != null)
      }
    }).filter(e => e.end > e.start).sort((a, b) => a.start - b.start)
  const blocks = []
  for (const slot of slots) {
    const previous = blocks.at(-1)
    const sameGroup = previous && JSON.stringify(previous.groups.map(g => g.id).sort()) === JSON.stringify(slot.groups.map(g => g.id).sort())
    if (previous && previous.journalId === slot.journalId && sameGroup && previous.subgroupKey === slot.subgroupKey &&
        previous.capacityType === slot.capacityType && previous.lessons && slot.lessons &&
        previous.startLessonNr + previous.lessons === slot.startLessonNr && slot.start >= previous.end && slot.start - previous.end <= 30 * 60000) {
      previous.end = slot.end
      previous.timeEnd = slot.timeEnd
      previous.lessons += slot.lessons
      previous.eventIds.push(...slot.eventIds)
    } else if (!blocks.some(b => b.journalId === slot.journalId && b.start === slot.start && b.end === slot.end &&
      JSON.stringify(b.groups) === JSON.stringify(slot.groups))) {
      blocks.push(slot)
    }
  }
  return blocks.map(b => ({ ...b, key: `${b.journalId}-${date}-${b.startLessonNr ?? b.timeStart}` }))
}
