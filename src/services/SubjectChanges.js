/** Compare timetable subject titles, not journal/group/room IDs or period numbers.
 * Missing/generic names cannot establish a subject change.
 * @param {string} name Timetable subject title.
 * @returns {string|null} Normalized subject identity.
 */
function subject(name) {
  if (typeof name !== 'string') return null
  const value = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('et')
  return value && value !== 'tund' ? value : null
}

/** Identify unambiguous subject transitions within each Tallinn calendar day.
 * Overlapping events form a single interval: conflicting subjects suppress transitions
 * into/out of that interval rather than guessing which lesson the teacher attends.
 * @param {Array} blocks Authenticated timetable blocks.
 * @returns {Array} One transition per next-subject start, independent of lesson numbering.
 */
export function subjectChanges(blocks) {
  const intervals = []
  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    const previous = intervals.at(-1)
    const identity = subject(block.name)
    if (previous && previous.date === block.date && block.start < previous.end) {
      previous.end = Math.max(previous.end, block.end)
      if (previous.subject !== identity) previous.subject = null
      previous.groups = [...new Map([...previous.groups, ...(block.groups || [])].map(g => [g.id ?? g.code, g])).values()]
    } else intervals.push({ ...block, subject: identity, groups: [...(block.groups || [])] })
  }
  return intervals.flatMap((next, i) => {
    const previous = intervals[i - 1]
    if (!previous || previous.date !== next.date || !previous.subject || !next.subject || previous.subject === next.subject) return []
    return [{ ...next, key: `${next.date}-${next.timeStart}`, previousName: previous.name }]
  })
}
