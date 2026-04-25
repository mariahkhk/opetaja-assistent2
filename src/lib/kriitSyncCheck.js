import Logger from '../services/Logger.js'
import { cacheService } from '../services/CacheService.js'
import { fetchTeacherJournals } from './fetchTeacherJournals.js'
import { getSchoolId } from './schoolId.js'

// Cache expiration constants
const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS
const SAFETY_MAX_PAGES = 50

// Module-level caches shared across calls
const globalTeacherCache = {}
const pendingTeacherRequests = new Map()

// Concurrency guard: only one sync check runs at a time
let syncInProgress = null

/**
 * Run the full Kriit sync check pipeline.
 *
 * 1. Fetch teacher journals from Tahvel
 * 2. Collect journal data (info, entries, students, assignments)
 * 3. Fetch inactive students
 * 4. Call Kriit getDifferences
 * 5. Normalize + cache results
 *
 * Returns the result for the caller to decide what to do with it.
 * If already running, returns the existing in-flight promise.
 *
 * @param {Object} api - Shared API object (api.tahvel, api.kriit)
 * @returns {Promise<{differences: Array, newAssignments: Object}|null>}
 */
export function runKriitSyncCheck(api) {
  if (syncInProgress) return syncInProgress

  syncInProgress = _runKriitSyncCheckImpl(api).finally(() => {
    syncInProgress = null
  })

  return syncInProgress
}

async function _runKriitSyncCheckImpl(api) {
  const journalList = await fetchTeacherJournals(api)

  if (!journalList || journalList.length === 0) {
    Logger.debug('[kriitSyncCheck] No journals found')
    return null
  }

  const journalData = await collectJournalData(api, journalList)

  if (!journalData || journalData.length === 0) {
    Logger.debug('[kriitSyncCheck] No journal data collected')
    return null
  }

  // Fetch inactive students
  let inactiveStudentsArray = []
  try {
    const inactiveStudentsCache = await getInactiveStudentsCache(api)
    if (inactiveStudentsCache && inactiveStudentsCache.byPersonalCode) {
      for (const personalCode of Object.keys(inactiveStudentsCache.byPersonalCode)) {
        const student = inactiveStudentsCache.byPersonalCode[personalCode]
        inactiveStudentsArray.push({
          personalCode: student.personalCode,
          name: student.name,
          status: student.status
        })
      }
    }
  } catch (error) {
    Logger.debug('[kriitSyncCheck] Failed to fetch inactive students:', error.message)
    inactiveStudentsArray = []
  }

  // Build payload
  const payload = {
    journals: journalData,
    inactiveStudents: inactiveStudentsArray
  }

  // Call Kriit
  let response
  try {
    response = await api.kriit.post('/subjects/getDifferences', payload)
  } catch (error) {
    Logger.debug('[kriitSyncCheck] Kriit getDifferences failed:', error.message)
    return { differences: [], newAssignments: {} }
  }

  // Normalize response
  const differences = normalizeDifferences(response)
  const newAssignments = normalizeNewAssignments(response)

  // Cache results: full PII-bearing data lives in memory only; a sanitised
  // counts-only summary is persisted so the header sync button can render
  // its "pending syncs" state on page load without re-running the full
  // pipeline.
  try {
    await cacheService.set('journalList_lastDifferences', differences, 0, false)
    await cacheService.set('journalList_lastNewAssignments', newAssignments, 0, false)
    await cacheService.set('journalList_diffSummary', buildDiffSummary(differences, newAssignments), 0, true)
  } catch (err) {
    Logger.debug('[kriitSyncCheck] Failed to set cache:', err.message)
  }

  return { differences, newAssignments }
}

/**
 * Normalize differences from various Kriit response formats.
 * @param {any} response - Raw Kriit response
 * @returns {Array} Normalized differences array
 */
export function normalizeDifferences(response) {
  if (response && Array.isArray(response)) {
    return response
  }
  if (response && response.data && Array.isArray(response.data)) {
    return response.data
  }
  if (response && response.data && Array.isArray(response.data.differences)) {
    return response.data.differences
  }
  if (response && Array.isArray(response.differences)) {
    return response.differences
  }
  return []
}

/**
 * Normalize newAssignments from various Kriit response formats.
 * @param {any} response - Raw Kriit response
 * @returns {Object} Normalized newAssignments object
 */
export function normalizeNewAssignments(response) {
  return (response && response.data && response.data.newAssignments) ||
    (response && response.newAssignments) ||
    {}
}

/**
 * Build a sanitised summary of Kriit sync results for persistence.
 *
 * The full `differences` and `newAssignments` arrays carry student names
 * and personal codes — they stay memory-only. The summary only keeps
 * counts, which is enough for the header sync button to decide whether
 * to render its "pending syncs" indicator on page load. No PII.
 *
 * @param {Array} differences
 * @param {Object} newAssignments
 * @returns {Object} { totalDifferences, totalNewAssignments, hasDifferences, hasNewAssignments, lastSyncedAt }
 */
export function buildDiffSummary(differences, newAssignments) {
  const diffArray = Array.isArray(differences) ? differences : []
  const newAssignmentsKeys = newAssignments && typeof newAssignments === 'object' ? Object.keys(newAssignments) : []
  return {
    totalDifferences: diffArray.length,
    totalNewAssignments: newAssignmentsKeys.length,
    hasDifferences: diffArray.length > 0,
    hasNewAssignments: newAssignmentsKeys.length > 0,
    lastSyncedAt: Date.now()
  }
}

/**
 * Collect journal data from Tahvel for all journals in the list.
 *
 * For each journal: fetches info, entries, students; builds assignment
 * payloads with grades; resolves teacher personal codes; splits by student group.
 *
 * @param {Object} api - API service
 * @param {Array} journalList - Array of journal objects with at least { id, nameEt }
 * @returns {Promise<Array>} Array of journal data objects ready for Kriit payload
 */
export async function collectJournalData(api, journalList) {
  const journalPromises = journalList.map(async journal => {
    const id = journal.id
    if (!id) return null

    try {
      const [journalInfo, journalEntries, journalEntriesWithGrades, journalStudents] = await Promise.all([
        getJournalInfo(api, id),
        getJournalEntries(api, id),
        getJournalEntriesWithGrades(api, id),
        getJournalStudents(api, id)
      ])

      if (!journalInfo || !Array.isArray(journalEntries) || !Array.isArray(journalStudents)) {
        return null
      }

      const studentDetailsMap = await processStudentData(api, journalStudents)
      const studentMap = createStudentMap(journalStudents, studentDetailsMap)

      // Merge homeworkDuedate from journalEntries into journalEntriesWithGrades
      let mergedEntries
      if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0 && journalEntries.length > 0) {
        const entryById = {}
        journalEntries.forEach(e => { if (e && e.id) entryById[e.id] = e })
        mergedEntries = journalEntriesWithGrades.map(e => {
          if (e && e.id && entryById[e.id] && !e.homeworkDuedate && entryById[e.id].homeworkDuedate) {
            return { ...e, homeworkDuedate: entryById[e.id].homeworkDuedate }
          }
          return e
        })
      } else if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0) {
        mergedEntries = journalEntriesWithGrades
      } else {
        mergedEntries = journalEntries
      }

      const assignments = extractAssignmentsFromEntries(mergedEntries, studentMap, journalStudents, studentDetailsMap, journalEntriesWithGrades)

      // Get lesson dates
      let firstLessonDate = null
      let firstLessonDateIsApproximate = false
      let nextLessonDate = null
      let lastLessonDate = null
      let lastLessonDateIsApproximate = false
      try {
        const lessonDates = await getLessonDates(api, id, journalInfo)
        firstLessonDate = lessonDates.firstLessonDate
        firstLessonDateIsApproximate = lessonDates.firstLessonDateIsApproximate
        nextLessonDate = lessonDates.nextLessonDate
        lastLessonDate = lessonDates.lastLessonDate
        lastLessonDateIsApproximate = lessonDates.lastLessonDateIsApproximate
      } catch (error) {
        Logger.debug(`[kriitSyncCheck] Could not get lesson dates for journal ${id}:`, error.message)
      }

      // Extract capacity hours
      let capacityHours = []
      try {
        if (journalInfo.lessonHours && Array.isArray(journalInfo.lessonHours.capacityHours)) {
          const relevantCapacities = journalInfo.lessonHours.capacityHours.filter(
            c => c.capacity === 'MAHT_i' || c.capacity === 'MAHT_p'
          )
          capacityHours = relevantCapacities.map(c => ({
            capacity: c.capacity,
            plannedHours: c.plannedHours,
            usedHours: c.usedHours
          }))
        }
      } catch (error) {
        Logger.debug(`[kriitSyncCheck] Could not extract capacity hours for journal ${id}`)
      }

      let plannedHours = null
      const mahtICapacity = capacityHours.find(c => c.capacity === 'MAHT_i')
      if (mahtICapacity) {
        plannedHours = mahtICapacity.plannedHours
      }

      // Fetch journal theme
      let journalTheme = null
      try {
        let themeId = null
        if (journalInfo.curriculumVersions?.[0]?.themes?.[0]?.id) {
          themeId = journalInfo.curriculumVersions[0].themes[0].id
        } else if (journalInfo.themes?.[0]?.id) {
          themeId = journalInfo.themes[0].id
        } else if (journalInfo.journalThemes?.[0]?.id) {
          themeId = journalInfo.journalThemes[0].id
        }

        if (themeId) {
          const cacheKey = `theme_${id}_${themeId}`
          const themeContent = await cacheService.getOrFetch(
            cacheKey,
            async() => await api.tahvel.get(`/journals/${id}/theme/${themeId}`),
            14 * ONE_DAY_MS
          )
          journalTheme = { id: themeId, content: themeContent }
        }
      } catch (err) {
        Logger.debug(`[kriitSyncCheck] Could not fetch theme for journal ${id}`)
      }

      // Resolve teachers
      const teachers = []
      if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
        for (const teacher of journalInfo.journalTeachers) {
          const teacherName = teacher.nameEt || teacher.fullname || ''
          if (teacherName && teacher.id) {
            try {
              const teacherData = await getTeacherPersonalCodeCached(api, teacher)
              teachers.push({ name: teacherName, personalCode: teacherData.personalCode })
            } catch (error) {
              teachers.push({ name: teacherName, personalCode: '' })
            }
          } else if (teacherName) {
            teachers.push({ name: teacherName, personalCode: '' })
          }
        }
      }

      // Resolve student groups
      const studentGroups = []
      if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
        studentGroups.push(...journalInfo.studentGroups)
      } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
        studentGroups.push(journalStudents[0].studentGroup)
      }

      const baseEntry = {
        subjectName: journalInfo.nameEt || journal.nameEt || '',
        subjectExternalId: id,
        teachers,
        assignments,
        firstLessonDate,
        firstLessonDateIsApproximate,
        nextLessonDate,
        lastLessonDate,
        lastLessonDateIsApproximate,
        plannedHours,
        capacityHours,
        journalTheme
      }

      if (studentGroups.length === 0) {
        return { ...baseEntry, groupName: '' }
      }

      // For multigroup journals, create separate entries per group
      return studentGroups.map(groupName => {
        const filteredAssignments = assignments
          .map(assignment => {
            const filteredResults = assignment.results.filter(result => {
              const student = journalStudents.find(js => {
                const studentId = studentMap.journalStudentIdToId[js.id.toString()]
                const personalCode = studentMap.idToPersonalCode[studentId]
                return personalCode === result.studentPersonalCode
              })
              return student && student.studentGroup === groupName
            })
            return { ...assignment, results: filteredResults }
          })
          .filter(assignment => assignment.results.length > 0)

        return { ...baseEntry, groupName, assignments: filteredAssignments }
      })
    } catch (error) {
      Logger.debug(`[kriitSyncCheck] Failed to process journal ${id}:`, error.message)
      return null
    }
  })

  const results = await Promise.all(journalPromises)
  return results.filter(r => r !== null).flatMap(result => (Array.isArray(result) ? result : [result]))
}

// --- API wrapper functions ---

/**
 * @param {Object} api
 * @param {number} journalId
 * @returns {Promise<Object|null>}
 */
function getJournalInfo(api, journalId) {
  return api.tahvel.get(`/journals/${journalId}`, {}, { cacheExpiration: THIRTY_DAYS_MS })
}

/**
 * @param {Object} api
 * @param {number} journalId
 * @returns {Promise<Array>}
 */
async function getJournalEntries(api, journalId) {
  try {
    const response = await api.tahvel.get(
      `/journals/${journalId}/journalEntry`,
      { size: 2000 },
      { cache: true, cacheExpiration: ONE_DAY_MS }
    )
    if (response && response.content && Array.isArray(response.content)) {
      return response.content
    }
    if (Array.isArray(response)) return response
    return []
  } catch (error) {
    Logger.debug(`[kriitSyncCheck] Failed to fetch journal entries for ${journalId}:`, error.message)
    return []
  }
}

/**
 * @param {Object} api
 * @param {number} journalId
 * @returns {Promise<Array>}
 */
async function getJournalEntriesWithGrades(api, journalId) {
  try {
    const response = await api.tahvel.get(
      `/journals/${journalId}/journalEntriesByDate`,
      { allStudents: true },
      { cache: true, forceRefresh: false }
    )
    if (Array.isArray(response)) return response
    return []
  } catch (error) {
    Logger.debug(`[kriitSyncCheck] Failed to fetch entries with grades for ${journalId}:`, error.message)
    return []
  }
}

/**
 * @param {Object} api
 * @param {number} journalId
 * @returns {Promise<Array|null>}
 */
async function getJournalStudents(api, journalId) {
  try {
    const response = await api.tahvel.get(
      `/journals/${journalId}/journalStudents`,
      { allStudents: true },
      { cacheExpiration: ONE_HOUR_MS }
    )
    return response || null
  } catch (error) {
    Logger.debug(`[kriitSyncCheck] Failed to fetch journal students for ${journalId}:`, error.message)
    return null
  }
}

/**
 * @param {Object} api
 * @param {number} studentId
 * @returns {Promise<Object|null>}
 */
function getStudentDetails(api, studentId) {
  return api.tahvel.get(`/students/${studentId}`, {}, { cacheExpiration: ONE_DAY_MS })
}

// --- Student processing ---

/**
 * Process student data to get personal codes and status info.
 *
 * ApiService automatically caches GET requests and deduplicates in-flight
 * requests, so we simply call getStudentDetails for each student in parallel.
 *
 * @param {Object} api
 * @param {Array} journalStudents
 * @returns {Promise<Object>} Map of studentId -> { personalCode, name, isActive, isDeleted, isGraduated }
 */
async function processStudentData(api, journalStudents) {
  const studentDetailsMap = {}

  if (!journalStudents || !Array.isArray(journalStudents)) return studentDetailsMap

  const results = await Promise.all(journalStudents.map(async journalStudent => {
    if (!journalStudent || !journalStudent.studentId) return null

    try {
      const details = await getStudentDetails(api, journalStudent.studentId)
      if (details && details.person && details.person.idcode) {
        return {
          studentId: journalStudent.studentId,
          data: {
            personalCode: details.person.idcode,
            name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`,
            isActive: details.status === 'OPPURSTAATUS_O',
            isDeleted: details.status === 'OPPURSTAATUS_K',
            isGraduated: details.status === 'OPPURSTAATUS_L'
          }
        }
      }
      return null
    } catch (error) {
      Logger.debug(`[kriitSyncCheck] Failed to fetch student ${journalStudent.studentId}:`, error.message)
      return null
    }
  }))

  for (const result of results) {
    if (result && result.data) {
      studentDetailsMap[result.studentId] = result.data
    }
  }

  return studentDetailsMap
}

/**
 * Create a mapping of student IDs to personal codes and names.
 * @param {Array} journalStudents
 * @param {Object} studentDetailsMap
 * @returns {Object} { idToPersonalCode, personalCodeToName, journalStudentIdToId }
 */
export function createStudentMap(journalStudents, studentDetailsMap = {}) {
  const studentMap = {
    idToPersonalCode: {},
    personalCodeToName: {},
    journalStudentIdToId: {}
  }

  if (!journalStudents || !Array.isArray(journalStudents)) return studentMap

  journalStudents.forEach(journalStudent => {
    if (!journalStudent?.id || !journalStudent?.studentId) return

    studentMap.journalStudentIdToId[journalStudent.id] = journalStudent.studentId

    if (studentDetailsMap[journalStudent.studentId]) {
      const details = studentDetailsMap[journalStudent.studentId]
      studentMap.idToPersonalCode[journalStudent.studentId] = details.personalCode
      studentMap.personalCodeToName[details.personalCode] = details.name
    } else if (journalStudent.student && journalStudent.student.idcode) {
      studentMap.idToPersonalCode[journalStudent.studentId] = journalStudent.student.idcode
      const studentName = journalStudent.student.fullname || journalStudent.studentName || 'Unknown'
      studentMap.personalCodeToName[journalStudent.student.idcode] = studentName
    }
  })

  return studentMap
}

// --- Assignment extraction ---

/**
 * Extract assignments and their results from journal entries.
 * @param {Array} journalEntries
 * @param {Object} studentMap
 * @param {Array} journalStudents
 * @param {Object} studentDetailsMap
 * @param {Array} journalEntriesWithGrades
 * @returns {Array} Assignments ready for Kriit payload
 */
export function extractAssignmentsFromEntries(journalEntries, studentMap, journalStudents = [], studentDetailsMap = {}, journalEntriesWithGrades = []) {
  const assignments = []
  if (!journalEntries || !Array.isArray(journalEntries)) return assignments

  const gradedEntries = journalEntries.filter(
    entry =>
      entry.entryType === 'SISSEKANNE_H' ||
      entry.entryType === 'SISSEKANNE_I' ||
      entry.entryType === 'SISSEKANNE_P'
  )

  // Map entries with grades by ID for quick lookup
  const entriesWithGradesMap = {}
  if (journalEntriesWithGrades && Array.isArray(journalEntriesWithGrades)) {
    journalEntriesWithGrades.forEach(entry => {
      if (entry.id && (entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P')) {
        entriesWithGradesMap[entry.id] = entry
      }
      if (entry.curriculumModuleOutcomes && entry.entryType === 'SISSEKANNE_O') {
        entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`] = entry
      }
    })
  }

  gradedEntries.forEach(entry => {
    const results = []
    const entryWithGrades = entriesWithGradesMap[entry.id]

    const studentResultsMap = {}
    if (entryWithGrades && entryWithGrades.journalStudentResults) {
      Object.entries(entryWithGrades.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
        studentResultsMap[journalStudentId] = studentResults
      })
    } else if (entry.journalStudentResults) {
      Object.entries(entry.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
        studentResultsMap[journalStudentId] = studentResults
      })
    }

    if (journalStudents && Array.isArray(journalStudents)) {
      journalStudents.forEach(journalStudent => {
        if (!journalStudent || !journalStudent.id) return

        const journalStudentId = journalStudent.id.toString()
        const studentResults = studentResultsMap[journalStudentId]
        let grade = ''

        if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
          grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
        }

        const studentId = studentMap.journalStudentIdToId[journalStudentId]
        if (!studentId) return

        const personalCode = studentMap.idToPersonalCode[studentId]
        if (!personalCode) return

        const studentName = studentMap.personalCodeToName[personalCode] || journalStudent.studentName || 'Unknown Student'
        let studentIsActive = true
        let studentIsDeleted = false
        let studentIsGraduated = false

        if (studentId && studentDetailsMap[studentId]) {
          studentIsActive = studentDetailsMap[studentId].isActive
          studentIsDeleted = studentDetailsMap[studentId].isDeleted || false
          studentIsGraduated = studentDetailsMap[studentId].isGraduated || false
        }

        results.push({
          grade,
          studentPersonalCode: personalCode,
          studentName,
          studentIsActive,
          studentIsDeleted,
          studentIsGraduated
        })
      })
    }

    const assignmentName = entry.nameEt || getAssignmentNameFromEntry(entry)
    const assignmentId = entry.id

    if (assignmentId && assignmentName) {
      assignments.push({
        assignmentExternalId: assignmentId,
        assignmentName,
        assignmentInstructions: entry.content || '',
        assignmentDueAt: entry.homeworkDuedate ? entry.homeworkDuedate.split('T')[0] : entry.entryDate ? entry.entryDate.split('T')[0] : null,
        assignmentEntryDate: entry.entryDate ? entry.entryDate.split('T')[0] : null,
        lessons: typeof entry.lessons !== 'undefined' && entry.lessons !== null ? Number(entry.lessons) : null,
        entryType: entry.entryType || null,
        results
      })
    }
  })

  return assignments
}

/**
 * Get a readable assignment name from a journal entry.
 * @param {Object} entry
 * @returns {string}
 */
export function getAssignmentNameFromEntry(entry) {
  if (entry.nameEt) return entry.nameEt

  if (entry.content) {
    const firstSentence = entry.content.split(/[.!\n]/)[0].trim().slice(0, 100)
    if (firstSentence) {
      return firstSentence.length === 100 ? `${firstSentence}...` : firstSentence
    }
  }

  return entry.entryType === 'SISSEKANNE_H'
    ? 'Hindeline töö'
    : entry.entryType === 'SISSEKANNE_I'
      ? 'Iseseisev töö'
      : entry.entryType === 'SISSEKANNE_P'
        ? 'Praktiline töö'
        : 'Päeviku sissekanne'
}

// --- Lesson dates ---

/**
 * Get comprehensive lesson dates (first, next, last) from timetable and lesson plan.
 * @param {Object} api
 * @param {number} journalId
 * @param {Object} journalInfo
 * @returns {Promise<Object>}
 */
async function getLessonDates(api, journalId, journalInfo) {
  const result = {
    firstLessonDate: null,
    firstLessonDateIsApproximate: false,
    nextLessonDate: null,
    lastLessonDate: null,
    lastLessonDateIsApproximate: false
  }

  if (!journalInfo) return result

  const schoolId = await getSchoolId(api, journalInfo)
  const teacherId = journalInfo.journalTeachers?.[0]?.id
  if (!teacherId || !schoolId) return result

  const now = new Date()
  const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
  const from = journalInfo.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
  const thru = journalInfo.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

  const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`

  const timetableData = await api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: ONE_DAY_MS })

  if (!timetableData?.timetableEvents) return result

  const journalTimetable = timetableData.timetableEvents
    .filter(event => event.journalId === journalId)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  if (journalTimetable.length === 0) {
    const firstFromPlan = await getLessonFromPlan(api, journalId, teacherId, { position: 'first' })
    if (firstFromPlan) {
      result.firstLessonDate = firstFromPlan
      result.firstLessonDateIsApproximate = true
    }
    const lastFromPlan = await getLessonFromPlan(api, journalId, teacherId, { position: 'last' })
    if (lastFromPlan) {
      result.lastLessonDate = lastFromPlan
      result.lastLessonDateIsApproximate = true
    }
    return result
  }

  result.firstLessonDate = journalTimetable[0]?.date || null
  result.firstLessonDateIsApproximate = false

  // Next lesson: first future date after today
  const nowDate = new Date()
  nowDate.setHours(0, 0, 0, 0)
  const tomorrowDate = new Date(nowDate)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const futureLessons = journalTimetable.filter(event => new Date(event.date) >= tomorrowDate)

  if (futureLessons.length > 0) {
    const firstLessonDateOnly = result.firstLessonDate ? result.firstLessonDate.split('T')[0] : null
    const nextDifferentDayLesson = futureLessons.find(event => {
      const eventDateOnly = event.date.split('T')[0]
      return eventDateOnly !== firstLessonDateOnly
    })
    result.nextLessonDate = nextDifferentDayLesson?.date || futureLessons[0]?.date || null
  }

  // Last lesson date
  const mahtACapacity = journalInfo.lessonHours?.capacityHours?.find(c => c.capacity === 'MAHT_a')
  const plannedMahtALessons = mahtACapacity?.plannedHours || 0
  const timetableLessons = journalTimetable.length

  if (plannedMahtALessons === timetableLessons) {
    result.lastLessonDate = journalTimetable[journalTimetable.length - 1]?.date || null
    result.lastLessonDateIsApproximate = false
  } else if (timetableLessons < plannedMahtALessons) {
    const lastFromPlan = await getLessonFromPlan(api, journalId, teacherId, { position: 'last' })
    if (lastFromPlan) {
      result.lastLessonDate = lastFromPlan
      result.lastLessonDateIsApproximate = true
    }
  }

  return result
}

/**
 * Get a lesson date (first or last) from the lesson plan.
 * @param {Object} api
 * @param {number} journalId
 * @param {number} teacherId
 * @param {Object} options
 * @param {'first'|'last'} options.position - Which lesson to find
 * @returns {Promise<string|null>}
 */
async function getLessonFromPlan(api, journalId, teacherId, { position }) {
  try {
    const now = new Date()
    const studyYearStart = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const studyYearId = studyYearStart - 1299

    const planData = await api.tahvel.get(
      `/lessonplans/byteacher/${teacherId}/${studyYearId}`,
      {},
      { cache: true, cacheExpiration: ONE_DAY_MS }
    )

    if (!planData?.journals || !planData?.studyPeriods) return null

    const journalPlan = planData.journals.find(j => j.id === journalId)
    if (!journalPlan?.hours?.MAHT_a) return null

    const mahtAWeeks = journalPlan.hours.MAHT_a

    let weekIndex
    if (position === 'first') {
      weekIndex = mahtAWeeks.findIndex(hours => hours !== null)
    } else {
      weekIndex = -1
      for (let i = mahtAWeeks.length - 1; i >= 0; i--) {
        if (mahtAWeeks[i] !== null) {
          weekIndex = i
          break
        }
      }
    }
    if (weekIndex === -1) return null

    const weekNr = planData.weekNrs[weekIndex]
    if (!weekNr) return null

    for (const period of planData.studyPeriods) {
      const weekPosition = period.weekNrs.indexOf(weekNr)
      if (weekPosition !== -1 && period.weekBeginningDates?.[weekPosition]) {
        return period.weekBeginningDates[weekPosition]
      }
    }
    return null
  } catch (error) {
    Logger.debug(`[kriitSyncCheck] Failed to get ${position} lesson from plan for journal ${journalId}:`, error.message)
    return null
  }
}

// --- Teacher personal code resolution ---

/**
 * Get teacher personal code with caching and deduplication.
 * @param {Object} api
 * @param {Object} teacher - { id, nameEt, fullname }
 * @returns {Promise<Object>} { personalCode, name, id }
 */
async function getTeacherPersonalCodeCached(api, teacher) {
  const teacherId = teacher.id
  const teacherName = teacher.nameEt || teacher.fullname || ''

  if (!teacherId || !teacherName) {
    return { personalCode: '', name: teacherName, id: teacherId }
  }

  const encodedName = encodeURIComponent(teacherName)
  const endpoint = `/teachers?isActive=true&lang=ET&name=${encodedName}&page=0&size=50`
  const cacheKey = `teacher_${teacherId}`

  if (globalTeacherCache[cacheKey]) {
    return globalTeacherCache[cacheKey]
  }

  if (pendingTeacherRequests.has(cacheKey)) {
    return await pendingTeacherRequests.get(cacheKey)
  }

  const fetchPromise = (async() => {
    try {
      const cacheServiceKey = `${encodeURIComponent(endpoint.replace(/^\//, ''))}`
      // Memory-only — /teachers?name=… returns idcodes; must not persist.
      const teacherSearchResult = await cacheService.getOrFetch(
        cacheServiceKey,
        async() => {
          try {
            return await api.tahvel.get(endpoint)
          } catch (error) {
            Logger.debug(`[kriitSyncCheck] Failed to search teachers:`, error.message)
            return null
          }
        },
        ONE_WEEK_MS,
        true,
        false
      )

      if (teacherSearchResult?.content && Array.isArray(teacherSearchResult.content) && teacherSearchResult.content.length > 0) {
        let foundTeacher = teacherSearchResult.content.find(t => t.id === teacherId)
        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content.find(t => t.name === teacherName || t.name === teacher.fullname)
        }

        if (foundTeacher) {
          const teacherData = {
            personalCode: foundTeacher.idcode || '',
            name: foundTeacher.name || teacherName,
            id: foundTeacher.id
          }
          globalTeacherCache[cacheKey] = teacherData
          return teacherData
        }
      }

      const fallbackData = { personalCode: '', name: teacherName, id: teacherId }
      globalTeacherCache[cacheKey] = fallbackData
      return fallbackData
    } catch (error) {
      Logger.debug(`[kriitSyncCheck] Failed to resolve teacher ${teacherId}:`, error.message)
      const errorData = { personalCode: '', name: teacherName, id: teacherId }
      globalTeacherCache[cacheKey] = errorData
      return errorData
    } finally {
      pendingTeacherRequests.delete(cacheKey)
    }
  })()

  pendingTeacherRequests.set(cacheKey, fetchPromise)
  return await fetchPromise
}

// --- Inactive students ---

/**
 * Fetch students with inactive statuses from Tahvel.
 * @param {Object} api
 * @returns {Promise<Object>} { byPersonalCode, byStudentId }
 */
async function fetchInactiveStudents(api) {
  const inactiveStudentsMap = { byPersonalCode: {}, byStudentId: {} }

  let page = 0
  let hasMorePages = true

  while (hasMorePages && page < SAFETY_MAX_PAGES) {
    const response = await api.tahvel.get(
      '/students',
      {
        lang: 'ET',
        page,
        showMyStudentGroups: false,
        size: 2000,
        sort: 'person.lastname,person.firstname,asc',
        status: ['OPPURSTAATUS_K', 'OPPURSTAATUS_L', 'OPPURSTAATUS_A']
      },
      { cacheExpiration: ONE_DAY_MS }
    )

    if (!response || !response.content || !Array.isArray(response.content)) break

    if (response.content.length === 0) {
      hasMorePages = false
      break
    }

    for (const student of response.content) {
      if (student.idcode) {
        const studentData = {
          personalCode: student.idcode,
          name: student.fullname || `${student.firstname} ${student.lastname}`,
          isActive: student.status === 'OPPURSTAATUS_O',
          isDeleted: student.status === 'OPPURSTAATUS_K',
          isGraduated: student.status === 'OPPURSTAATUS_L',
          studentId: student.id,
          status: student.status
        }
        inactiveStudentsMap.byPersonalCode[student.idcode] = studentData
        if (student.id) {
          inactiveStudentsMap.byStudentId[student.id] = studentData
        }
      }
    }

    if (response.content.length < 2000) {
      hasMorePages = false
    } else {
      page++
    }
  }

  return inactiveStudentsMap
}

/**
 * Get or fetch the inactive students cache.
 * @param {Object} api
 * @returns {Promise<Object>} { byPersonalCode, byStudentId }
 */
async function getInactiveStudentsCache(api) {
  const cacheKey = 'inactive_students_all'

  // Memory-only: this map is keyed by student personal codes and contains
  // names, so it must not persist to the on-disk Cache API. Re-fetched on
  // each new page load.
  const result = await cacheService.getOrFetch(
    cacheKey,
    () => fetchInactiveStudents(api),
    ONE_DAY_MS,
    true,
    false
  )

  if (!result || typeof result !== 'object') {
    return { byPersonalCode: {}, byStudentId: {} }
  }
  if (!result.byPersonalCode && !result.byStudentId) {
    return { byPersonalCode: {}, byStudentId: {} }
  }
  return result
}

/**
 * Clear module-level caches. Intended for test cleanup.
 */
export function clearKriitSyncCaches() {
  for (const key of Object.keys(globalTeacherCache)) {
    delete globalTeacherCache[key]
  }
  pendingTeacherRequests.clear()
  syncInProgress = null
}
