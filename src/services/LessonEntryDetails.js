/** Normalize the HH:mm[:ss] values returned by Tahvel's lesson-time search. */
function clock(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value) ? value.slice(0, 5) : null
}

/** Resolve exact event boundaries against date/weekday/building-specific school periods.
 * Conflicting plans, missing periods and approximate matches are deliberately rejected.
 * @param {Array} rows Lesson-time search rows from Tahvel.
 * @param {object} block The authenticated timetable block.
 * @returns {object|null} Verified period numbers, or null if ambiguous/unavailable.
 */
export function resolveEntryPeriods(rows, block) {
  const day = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'][new Date(`${block.date}T12:00:00Z`).getUTCDay()]
  const plans = new Map()
  for (const row of rows) {
    if (!row.validFrom || row.validFrom.slice(0, 10) > block.date ||
        (row.validThru && row.validThru.slice(0, 10) < block.date) || row[day] !== true) continue
    const start = clock(row.startTime)
    const end = clock(row.endTime)
    const number = Number(row.lessonNr)
    if (!start || !end || start >= end || !Number.isInteger(number) || number < 1) continue
    const buildings = (row.buildings || []).map(b => b.id).sort((a, b) => a - b)
    const key = JSON.stringify([row.validFrom, row.validThru, row.isDefault, buildings])
    if (!plans.has(key)) plans.set(key, [])
    plans.get(key).push({ number, start, end })
  }
  const matches = new Map()
  for (const periods of plans.values()) {
    const inside = periods.filter(p => p.start >= block.timeStart && p.end <= block.timeEnd).sort((a, b) => a.number - b.number)
    if (!inside.length || inside[0].start !== block.timeStart || inside.at(-1).end !== block.timeEnd) continue
    if (inside.some((p, i) => i > 0 && (p.number !== inside[i - 1].number + 1 || p.start < inside[i - 1].end))) continue
    const result = { startLessonNr: inside[0].number, lessons: inside.length }
    matches.set(JSON.stringify(result), result)
  }
  return matches.size === 1 ? [...matches.values()][0] : null
}

/** Fetch a complete bounded search result; never infer periods from a partial page.
 * @param {Function} get Authenticated Tahvel GET transport.
 * @param {object} block Timetable block whose date determines valid lesson times.
 * @returns {Promise<object|null>} Exact period mapping, or null when unavailable.
 */
async function loadPeriods(get, block) {
  if (!block.timeStart || !block.timeEnd) return null
  const rows = []
  for (let page = 0; page < 10; page++) {
    const data = await get('/lessontimes', { from: block.date, thru: block.date, size: 100, page })
    if (!Array.isArray(data?.content)) return null
    rows.push(...data.content)
    if (data.last === true || (Number.isInteger(data.totalPages) && page + 1 >= data.totalPages)) return resolveEntryPeriods(rows, block)
    if (!data.content.length) return null
  }
  return null
}

/** Load subject metadata and current school periods independently of attendance.
 * Assignment dates alone do not prove a lesson association, so assignments are not guessed.
 * @param {Function} get Authenticated Tahvel GET transport.
 * @param {object} block Authenticated timetable block.
 * @returns {Promise<object>} Available subject name, factual draft and verified periods.
 */
export async function loadLessonEntryDetails(get, block) {
  const [journal, periods] = await Promise.all([
    get(`/journals/${block.journalId}`).catch(() => null),
    loadPeriods(get, block).catch(() => null)
  ])
  const name = [journal?.nameEt, journal?.name, block.name].find(value => typeof value === 'string' && value.trim() && value.trim() !== 'Tund')?.trim() || ''
  const groups = (block.groups || []).map(g => g.code).filter(Boolean).join(', ')
  const content = [
    'Tunniplaani andmed:',
    name && `Aine: ${name}`,
    `Kuupäev: ${block.date.split('-').reverse().join('.')}`,
    block.timeStart && block.timeEnd && `Kellaaeg: ${block.timeStart}–${block.timeEnd}`,
    groups && `Õpperühm: ${groups}`
  ].filter(Boolean).join('\n')
  return { name, content, periods }
}
