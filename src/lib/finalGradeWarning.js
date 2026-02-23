/**
 * Shared utility for final grade warning window calculations.
 * Used by both HighlightFinalGradesFeature (single journal) and
 * FinalGradeWarningFeature (journal list).
 */

import Logger from '../services/Logger.js'

/**
 * Determine warning level based on proximity to final lesson date.
 * @param {Date} now - Current date (normalized to midnight)
 * @param {Date} finalLessonDate - Final lesson date (normalized to midnight)
 * @returns {'red'|'yellow'|null} Warning level
 */
export function getWarningLevel(now, finalLessonDate) {
  const warningStart = new Date(finalLessonDate)
  warningStart.setDate(finalLessonDate.getDate() - 7)

  if (now < warningStart) return null

  const warningEnd = new Date(finalLessonDate)
  warningEnd.setDate(finalLessonDate.getDate() - 2)

  if (now <= warningEnd) return 'yellow'
  return 'red'
}

/**
 * Get study year date range. When `info` with `studyYearStartDate` is provided,
 * uses those dates; otherwise computes range from the current date.
 * @param {object|null} [info] - Optional journal info with studyYearStartDate/studyYearEndDate
 * @returns {{ from: string, thru: string }} ISO date strings for study year boundaries
 */
export function getStudyYearRange(info = null) {
  if (info?.studyYearStartDate) {
    return {
      from: info.studyYearStartDate,
      thru: info.studyYearEndDate || new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    }
  }
  const now = new Date()
  const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
  const from = new Date(Date.UTC(studyYear, 8, 1)).toISOString()
  const thru = new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
  return { from, thru }
}

/**
 * Get the final (last) lesson date for a journal from timetable or journal entries.
 * @param {number} journalId - The journal ID
 * @param {object} api - API service object with `api.tahvel.get()`
 * @param {object} [info] - Optional pre-fetched journal info (to avoid duplicate API call)
 * @returns {Promise<string|null>} Date string or null
 */
export async function getFinalLessonDate(journalId, api, info = null) {
  if (!info) {
    info = await api.tahvel.get(`/journals/${journalId}`, {}, { cache: true, cacheExpiration: 864e5 })
  }

  let schoolId = null
  if (info.curriculumVersions && info.curriculumVersions.length > 0) {
    schoolId = info.curriculumVersions[0].curriculumId
  }
  const teacherId = info.journalTeachers?.[0]?.id
  const { from, thru } = getStudyYearRange(info)

  if (schoolId && teacherId) {
    try {
      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
      const timetableData = await api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })
      const timetable = timetableData?.timetableEvents?.filter(event => Number(event.journalId) === Number(journalId)) || []
      if (timetable.length > 0) {
        const sorted = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
        return sorted[sorted.length - 1].date
      }
    } catch (e) {
      if (Logger.isDebugMode()) Logger.info('✨ [finalGradeWarning] Timetable fetch failed, falling back to journal entries', e)
    }
  }

  const journalEntries = await api.tahvel.get(
    `/journals/${journalId}/journalEntriesByDate`,
    { allStudents: true },
    { cache: true, cacheExpiration: 6e4 }
  )
  if (Array.isArray(journalEntries) && journalEntries.length > 0) {
    const validEntries = journalEntries.filter(e => e.entryDate)
    if (validEntries.length > 0) {
      const sorted = validEntries.slice().sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
      return sorted[sorted.length - 1].entryDate
    }
  }

  return null
}
