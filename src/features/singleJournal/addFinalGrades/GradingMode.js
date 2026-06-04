/* eslint-disable security/detect-unsafe-regex -- all regexes here are anchored and operate on short grade strings ('A', 'MA', '1'-'5', 'N.N') */
// Pure grading-scale logic for FinalGradesByOvFeature.
//
// Two grading scales exist in Tahvel:
//   - 'mitte'   (Mitteeristav): pass/fail, grades A (arvestatud) / MA (mittearvestatud)
//   - 'eristav' (Eristav):      differentiated, grades 1-5
//
// The scale a journal uses is decided from the grades the teacher actually
// recorded in Tahvel — those recorded grades are the cross-session memory, so
// no client-side persistence is needed. See resolveGradingMode for precedence.

export const JOURNAL_ASSESSMENT_MITTE = 'KUTSEHINDAMISVIIS_M'
export const JOURNAL_ASSESSMENT_ERISTAV = 'KUTSEHINDAMISVIIS_E'

/**
 * Strip the `KUTSEHINDAMINE_` prefix from a Tahvel grade code and normalize to a
 * bare token. Returns one of 'A' | 'MA' | '1'..'5', or '' when unrecognized.
 * @param {string} code
 * @returns {string}
 */
export function normalizeGradeCode(code) {
  if (!code) return ''
  const token = String(code)
    .replace(/^KUTSEHINDAMINE_/i, '')
    .trim()
    .toUpperCase()
  if (token === 'A' || token === 'MA') return token
  if (/^[1-5]$/.test(token)) return token
  return ''
}

/**
 * Decide a grading scale from a set of grade tokens.
 * Any A/MA token wins -> 'mitteeristav'; otherwise any numeric token -> 'eristav';
 * otherwise '' (undecidable).
 * @param {Array<string>} tokens
 * @returns {'mitte'|'eristav'|''}
 */
export function classifyScaleFromTokens(tokens) {
  if (!Array.isArray(tokens)) return ''
  let hasNumeric = false
  for (const token of tokens) {
    const normalized = String(token == null ? '' : token)
      .trim()
      .toUpperCase()
    if (normalized === 'A' || normalized === 'MA') return 'mitte'
    if (/^\d+(?:\.\d+)?$/.test(normalized)) hasNumeric = true
  }
  return hasNumeric ? 'eristav' : ''
}

/**
 * Collect normalized grade tokens from the recorded ÕV-outcome map
 * (`{ 'studentId|ovNum': { grade: { code } } }`) used by the ÕV flow.
 * @param {Object} existingGradesMap
 * @returns {Array<string>}
 */
export function getRecordedOutcomeGradeTokens(existingGradesMap) {
  if (!existingGradesMap || typeof existingGradesMap !== 'object') return []
  const tokens = []
  for (const gradeRecord of Object.values(existingGradesMap)) {
    const code = gradeRecord && gradeRecord.grade && gradeRecord.grade.code
    const token = normalizeGradeCode(code)
    if (token) tokens.push(token)
  }
  return tokens
}

/**
 * Collect normalized grade tokens from a SISSEKANNE_L entry's recorded
 * journalEntryStudents (`[{ grade: { code } }]`) used by the final-grade flow.
 * @param {Array} journalEntryStudents
 * @returns {Array<string>}
 */
export function getRecordedFinalGradeTokens(journalEntryStudents) {
  if (!Array.isArray(journalEntryStudents)) return []
  const tokens = []
  for (const entryStudent of journalEntryStudents) {
    const code = entryStudent && entryStudent.grade && entryStudent.grade.code
    const token = normalizeGradeCode(code)
    if (token) tokens.push(token)
  }
  return tokens
}

/**
 * Resolve the grading scale to apply, by precedence (top wins):
 *   1. In-session manual dropdown pick (userPick)
 *   2. Recorded END grades (A/MA -> mitteeristav, 1-5 -> eristav)
 *   3. Journal's declared assessment type
 *   4. Last resort: mitteeristav
 * Exercise grades (SISSEKANNE_I/T/P) are intentionally NOT consulted here.
 * @param {{recordedTokens?: Array<string>, journalAssessment?: string, userPick?: string}} params
 * @returns {'mitte'|'eristav'}
 */
export function resolveGradingMode({ recordedTokens, journalAssessment, userPick } = {}) {
  if (userPick === 'mitte' || userPick === 'eristav') return userPick

  const fromGrades = classifyScaleFromTokens(recordedTokens)
  if (fromGrades) return fromGrades

  if (journalAssessment === JOURNAL_ASSESSMENT_MITTE) return 'mitte'
  if (journalAssessment === JOURNAL_ASSESSMENT_ERISTAV) return 'eristav'

  return 'mitte'
}

function convertOvGradesToMitte(student) {
  Object.keys(student.ovGrades).forEach(outcomeKey => {
    const rawGrade = String(student.ovGrades[outcomeKey] || '').trim()
    let token = ''
    if (!rawGrade) {
      token = ''
    } else if (/^MA$/i.test(rawGrade)) {
      token = 'MA'
    } else if (/^A$/i.test(rawGrade)) {
      token = 'A'
    } else if (rawGrade.includes('_hasLow')) {
      // This ÕV has individual grades <= 2, so force to MA in mitte mode
      token = 'MA'
    } else if (/^\d+(?:\.\d+)?$/.test(rawGrade)) {
      const rounded = Math.round(Number(rawGrade))
      token = rounded >= 3 ? 'A' : 'MA'
    } else {
      token = rawGrade
    }
    student.ovGrades[outcomeKey] = token
  })

  const outcomeValues = Object.values(student.ovGrades)
  if (outcomeValues.length > 0) {
    const anyUngraded = outcomeValues.some(value => !value || String(value).trim() === '')
    // Any token equal to 'MA' or any numeric that rounds to 2 forces final MA
    const anyTwoOrMA = outcomeValues.some(value => {
      if (!value) return false
      const normalizedValue = String(value).trim().toUpperCase()
      if (normalizedValue === 'MA') return true
      if (/^\d+(?:\.\d+)?$/.test(normalizedValue)) return Math.round(Number(normalizedValue)) === 2
      return false
    })
    if (anyTwoOrMA) {
      student.finalGrade = 'MA'
    } else {
      const allArvestatud = outcomeValues.every(value => String(value).toUpperCase() === 'A')
      student.finalGrade = allArvestatud && !anyUngraded ? 'A' : 'MA'
    }
  } else {
    // No per-ÕV grades: map the precomputed finalGrade instead
    const rawFinal = String(student.finalGrade || '').trim()
    if (!rawFinal) student.finalGrade = ''
    else if (/^A$/i.test(rawFinal)) student.finalGrade = 'A'
    else if (/^MA$/i.test(rawFinal)) student.finalGrade = 'MA'
    else if (/^\d+(?:\.\d+)?$/.test(rawFinal)) {
      student.finalGrade = Math.round(Number(rawFinal)) >= 3 ? 'A' : 'MA'
    }
  }
}

function convertOvGradesToEristav(student) {
  const numericGrades = []
  Object.keys(student.ovGrades).forEach(outcomeKey => {
    const rawGrade = String(student.ovGrades[outcomeKey] || '').trim()
    if (!rawGrade) {
      numericGrades.push(2)
      student.ovGrades[outcomeKey] = '2'
    } else if (/^A$/i.test(rawGrade)) {
      numericGrades.push(5)
      student.ovGrades[outcomeKey] = '5'
    } else if (/^MA$/i.test(rawGrade)) {
      numericGrades.push(2)
      student.ovGrades[outcomeKey] = '2'
    } else if (rawGrade.includes('_hasLow')) {
      // In eristav mode the low-grade flag is ignored; use the average part
      const rounded = Math.round(parseFloat(rawGrade.split('_')[0]))
      numericGrades.push(rounded)
      student.ovGrades[outcomeKey] = String(rounded)
    } else if (/^\d+(?:\.\d+)?$/.test(rawGrade)) {
      const rounded = Math.round(Number(rawGrade))
      numericGrades.push(rounded)
      student.ovGrades[outcomeKey] = String(rounded)
    } else {
      // Unknown token -> treat as MA-equivalent
      numericGrades.push(2)
      student.ovGrades[outcomeKey] = '2'
    }
  })

  if (numericGrades.length > 0) {
    const average = numericGrades.reduce((sum, grade) => sum + grade, 0) / numericGrades.length
    student.finalGrade = String(Math.round(average))
  } else {
    // No per-ÕV grades: map the precomputed finalGrade instead
    const rawFinal = String(student.finalGrade || '').trim()
    if (!rawFinal) student.finalGrade = ''
    else if (/^A$/i.test(rawFinal)) student.finalGrade = '5'
    else if (/^MA$/i.test(rawFinal)) student.finalGrade = '2'
    else if (/^\d+(?:\.\d+)?$/.test(rawFinal)) student.finalGrade = String(Math.round(Number(rawFinal)))
  }
}

/**
 * Convert a pristine output array into the given grading scale, returning a NEW
 * array of converted student entries. The input is never mutated, so repeated
 * calls from the same pristine source are non-destructive (idempotent across
 * mode switches: A/MA and `_hasLow` survive a mitte<->eristav round-trip).
 * @param {Array} rawOutput pristine student entries ({ finalGrade, ovGrades, ... })
 * @param {'mitte'|'eristav'} mode
 * @returns {Array}
 */
export function applyGradingMode(rawOutput, mode) {
  if (!Array.isArray(rawOutput)) return []
  return rawOutput.map(sourceStudent => {
    const student = structuredClone(sourceStudent)
    if (student.finalGrade === null) return student
    student.ovGrades = student.ovGrades || {}
    if (mode === 'mitte') convertOvGradesToMitte(student)
    else if (mode === 'eristav') convertOvGradesToEristav(student)
    return student
  })
}

export default {
  JOURNAL_ASSESSMENT_MITTE,
  JOURNAL_ASSESSMENT_ERISTAV,
  normalizeGradeCode,
  classifyScaleFromTokens,
  getRecordedOutcomeGradeTokens,
  getRecordedFinalGradeTokens,
  resolveGradingMode,
  applyGradingMode
}
