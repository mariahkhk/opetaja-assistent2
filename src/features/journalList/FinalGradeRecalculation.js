import Logger from '../../services/Logger.js'
import FinalGradesByOvFeature from '../singleJournal/addFinalGrades/FinalGradesManagementFeature.js'
import {
  getRecordedFinalGradeTokens,
  getRecordedOutcomeGradeTokens,
  resolveGradingMode
} from '../singleJournal/addFinalGrades/GradingMode.js'
import { extractOutcomeNumberFromOutcomeEntryName } from '../../lib/extractOutcomeNumbersFromEntryName.js'

const FINAL_GRADE_ENTRY_TYPE = 'SISSEKANNE_L'
const OUTCOME_ENTRY_TYPE = 'SISSEKANNE_O'
const I_OR_P_CAPACITIES = new Set(['MAHT_i', 'MAHT_p'])

export function hasEnoughIndependentOrPracticalCapacity(journalInfo) {
  const capacities = journalInfo?.lessonHours?.capacityHours
  if (!Array.isArray(capacities)) return false

  const totals = capacities
    .filter(capacity => I_OR_P_CAPACITIES.has(capacity.capacity))
    .reduce(
      (acc, capacity) => {
        const planned = Number(capacity.plannedHours || 0)
        if (planned <= 0) return acc
        acc.planned += planned
        acc.used += Number(capacity.usedHours || 0)
        return acc
      },
      { planned: 0, used: 0 }
    )

  return totals.planned > 0 && totals.used / totals.planned >= 0.95
}

function createFeature(api, journalId) {
  const feature = new FinalGradesByOvFeature()
  feature.api = api
  feature.extractJournalId = () => String(journalId)
  return feature
}

function resolveOutcomeStudentId(studentKey, students) {
  const matchingStudent = (students || []).find(student =>
    String(student.student?.id || student.studentId || student.id) === String(studentKey) || String(student.id) === String(studentKey)
  )
  return matchingStudent?.student?.id || matchingStudent?.studentId || studentKey
}

function addOutcomeGrade(grades, studentId, ovNum, result) {
  if (!studentId || !result?.grade) return
  grades[`${studentId}|${ovNum}`] = result
}

async function existingOutcomeGradesByKey(feature, journalId, entries, students) {
  const grades = {}
  for (const entry of entries || []) {
    if (entry.entryType !== OUTCOME_ENTRY_TYPE) continue
    const ovNum = typeof entry.outcomeOrderNr === 'number'
      ? String(entry.outcomeOrderNr + 1)
      : extractOutcomeNumberFromOutcomeEntryName(entry.nameEt)
    if (!ovNum) continue

    if (!entry.studentOutcomeResults && entry.curriculumModuleOutcomes) {
      Object.assign(
        grades,
        await feature.fetchDetailedOutcomeStudents(journalId, entry.curriculumModuleOutcomes, students, { output: 'existingGradesMap', ovNum })
      )
      continue
    }

    for (const [studentKey, results] of Object.entries(entry.studentOutcomeResults || {})) {
      const studentId = resolveOutcomeStudentId(studentKey, students)
      if (Array.isArray(results)) {
        results.forEach(result => addOutcomeGrade(grades, studentId, ovNum, result))
      } else {
        addOutcomeGrade(grades, studentId, ovNum, results)
      }
    }
  }
  return grades
}

function normalizeJournalEntryStudents(entry) {
  if (!entry || Array.isArray(entry.journalEntryStudents)) return entry
  if (!entry.journalStudentResults || typeof entry.journalStudentResults !== 'object') return entry
  return {
    ...entry,
    journalEntryStudents: Object.entries(entry.journalStudentResults).flatMap(([journalStudent, results]) => {
      if (!Array.isArray(results)) return []
      return results.map(result => ({ ...result, journalStudent }))
    })
  }
}

function buildOutcomeDiffs(results, existingGrades) {
  return (results.output || []).filter(student =>
    (results.allOvNums || []).some(ovNum => {
      const calculated = String(student.ovGrades?.[ovNum] || '').trim().toUpperCase()
      const existing = String(existingGrades[`${student.studentId}|${ovNum}`]?.grade?.code || '')
        .replace(/^KUTSEHINDAMINE_/i, '')
        .trim()
        .toUpperCase()
      return calculated && calculated !== existing
    })
  )
}

function isAcademicLeaveDisallowedGrade(grade) {
  const normalizedGrade = String(grade || '').trim().toUpperCase()
  return normalizedGrade === 'MA' || normalizedGrade === '1' || normalizedGrade === '2'
}

async function filterOutcomeDiffsForWritableGrades(api, diffs, results, existingGrades) {
  const writableDiffs = []
  for (const student of diffs) {
    let status = null
    try {
      const details = await api.tahvel.get(`/students/${student.studentId}`)
      status = details?.status || null
    } catch (error) {
      Logger.error('FinalGradeRecalculation: failed to fetch student details, defaulting to include', { studentId: student.studentId, error })
    }

    const writableOvNums = (results.allOvNums || []).filter(ovNum => {
      const calculated = String(student.ovGrades?.[ovNum] || '').trim().toUpperCase()
      const existing = String(existingGrades[`${student.studentId}|${ovNum}`]?.grade?.code || '')
        .replace(/^KUTSEHINDAMINE_/i, '')
        .trim()
        .toUpperCase()
      if (!calculated || calculated === existing) return false
      return !(status === 'OPPURSTAATUS_A' && isAcademicLeaveDisallowedGrade(calculated))
    })

    if (writableOvNums.length > 0) writableDiffs.push({ ...student, writableOvNums })
  }
  return writableDiffs
}

function buildLGradeMap(entryStudents) {
  const grades = {}
  for (const entryStudent of entryStudents || []) {
    if (entryStudent?.journalStudent != null && entryStudent.grade?.code) {
      grades[String(entryStudent.journalStudent)] = entryStudent.grade.code.replace(/^KUTSEHINDAMINE_/i, '').toUpperCase()
    }
  }
  return grades
}

function buildUpdateSummary(journalInfo, diffs, oldGradeForStudent, newGradeForStudent) {
  return diffs
    .map(student => {
      const oldGrade = oldGradeForStudent(student)
      const newGrade = newGradeForStudent(student)
      if (!newGrade || oldGrade === newGrade) return null
      return {
        journalId: String(journalInfo.id),
        journalName: journalInfo.nameEt || `Päevik ${journalInfo.id}`,
        studentName: student.name,
        oldGrade: oldGrade || '(empty)',
        newGrade
      }
    })
    .filter(Boolean)
}

function mapFinalGradeToEntryStudent(feature, result, existingEntryStudent) {
  const mapped = feature.mapGradeToSchema(result.finalGrade)
  if (!mapped) return null
  const grade = {
    code: mapped.code,
    gradingSchemaRowId: null,
    value: mapped.value,
    value2: mapped.value,
    extraval1: null,
    extraval2: null,
    nameEt: mapped.nameEt,
    nameEn: mapped.nameEn,
    valid: true
  }
  return existingEntryStudent
    ? { ...existingEntryStudent, grade, removeStudentHistory: true }
    : { journalStudent: String(result.journalStudentId), grade, removeStudentHistory: true }
}

async function recalculateOutcomeGrades(api, journalId, journalInfo, entries, students, feature) {
  const results = await feature.calculateFinalGrades(entries, students)
  const existingGrades = await existingOutcomeGradesByKey(feature, journalId, entries, students)
  const gradingMode = resolveGradingMode({
    recordedTokens: getRecordedOutcomeGradeTokens(existingGrades),
    journalAssessment: journalInfo.assessment
  })
  feature.applyGradingModeToResults(results, gradingMode)
  const diffs = await filterOutcomeDiffsForWritableGrades(api, buildOutcomeDiffs(results, existingGrades), results, existingGrades)
  if (diffs.length === 0) return []

  const summary = buildUpdateSummary(
    journalInfo,
    diffs,
    student => student.writableOvNums.map(ovNum => existingGrades[`${student.studentId}|${ovNum}`]?.grade?.code?.replace(/^KUTSEHINDAMINE_/i, '')).filter(Boolean).join(', '),
    student => student.writableOvNums.map(ovNum => student.ovGrades?.[ovNum]).filter(Boolean).join(', ')
  )
  const syncOk = await feature.syncOvGrades({ results, ovNumToOutcomeId: results.ovNumToOutcomeId, filteredOutput: diffs })
  if (!syncOk) throw new Error(`Outcome grade recalculation failed for journal ${journalId}`)
  return summary
}

async function recalculateFinalEntryGrades(api, journalId, journalInfo, entries, students, feature) {
  let lEntry = entries.find(entry => entry.entryType === FINAL_GRADE_ENTRY_TYPE)
  const results = feature.extractFinalGrades(entries, students)
  feature.ensureRawOutputSnapshot(results)

  if (!lEntry && journalInfo.finalEntryAllowed === false) {
    Logger.error('FinalGradeRecalculation: final entry is missing and not allowed', { journalId })
    return []
  }

  if (!lEntry) {
    lEntry = {
      entryType: FINAL_GRADE_ENTRY_TYPE,
      nameEt: 'Lõpptulemus',
      journalEntryStudents: []
    }
  } else if (lEntry.id) {
    const freshEntry = await api.tahvel.get(`/journals/${journalId}/journalEntry/${lEntry.id}`, {}, { cache: false })
    if (freshEntry) lEntry = freshEntry
  }

  lEntry = normalizeJournalEntryStudents(lEntry)

  lEntry.journalEntryStudents = Array.isArray(lEntry.journalEntryStudents) ? lEntry.journalEntryStudents : []
  const currentGrades = buildLGradeMap(lEntry.journalEntryStudents)
  const gradingMode = resolveGradingMode({
    recordedTokens: getRecordedFinalGradeTokens(lEntry.journalEntryStudents),
    journalAssessment: journalInfo.assessment
  })
  feature.applyGradingModeToResults(results, gradingMode)

  const diffs = (results.output || []).filter(result => {
    if (result.finalGrade === null) return false
    const current = currentGrades[String(result.journalStudentId)]
    return result.finalGrade && String(result.finalGrade).toUpperCase() !== String(current || '').toUpperCase()
  })
  if (diffs.length === 0) return []

  const byJournalStudent = new Map(lEntry.journalEntryStudents.map(entryStudent => [String(entryStudent.journalStudent), entryStudent]))
  const journalEntryStudents = diffs
    .map(result => mapFinalGradeToEntryStudent(feature, result, byJournalStudent.get(String(result.journalStudentId))))
    .filter(Boolean)
  if (journalEntryStudents.length === 0) return []

  const payload = { ...lEntry, journalEntryStudents }
  if (lEntry.id) await api.tahvel.put(`/journals/${journalId}/journalEntry/${lEntry.id}`, payload)
  else await api.tahvel.post(`/journals/${journalId}/journalEntry`, payload, { cache: false })

  return buildUpdateSummary(journalInfo, diffs, result => currentGrades[String(result.journalStudentId)], result => String(result.finalGrade || '').toUpperCase())
}

export async function recalculateFinalGradesForJournal(api, journalId) {
  const [journalInfo, entries, students] = await Promise.all([
    api.tahvel.get(`/journals/${journalId}`, {}, { cache: false }),
    api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
    api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
  ])

  if (!journalInfo || !Array.isArray(entries) || !Array.isArray(students)) return []
  if (!hasEnoughIndependentOrPracticalCapacity(journalInfo)) return []

  const feature = createFeature(api, journalId)
  const hasOutcomeEntries = entries.some(entry => entry.entryType === OUTCOME_ENTRY_TYPE)
  if (hasOutcomeEntries) return recalculateOutcomeGrades(api, journalId, journalInfo, entries, students, feature)
  return recalculateFinalEntryGrades(api, journalId, journalInfo, entries, students, feature)
}

export async function recalculateFinalGradesForTouchedJournals(api, journalIds) {
  const ids = [...new Set(Array.from(journalIds || []).map(id => String(id)).filter(Boolean))]
  const updates = []
  for (const journalId of ids) {
    try {
      updates.push(...await recalculateFinalGradesForJournal(api, journalId))
    } catch (error) {
      Logger.error('FinalGradeRecalculation: failed to recalculate final grades', { journalId, error })
    }
  }

  return updates
}

export function formatFinalGradeUpdateSummary(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return ''
  const lines = updates.map(update => `${update.journalName}: ${update.studentName} ${update.oldGrade} -> ${update.newGrade}`)
  return `Uuendatud lõpphinded:\n${lines.join('\n')}`
}
