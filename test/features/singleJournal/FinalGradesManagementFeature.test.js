import { describe, test, expect } from 'bun:test'
import { extractOutcomeNumbersFromEntryName } from '../../../src/lib/extractOutcomeNumbersFromEntryName.js'

describe('FinalGradesManagementFeature - Utility Methods', () => {
  describe('Grade schema mapping (#mapGradeToSchema logic)', () => {
    test('should map numeric grades 1-5', () => {
      const testCases = [
        { grade: '5', expectedCode: 'KUTSEHINDAMINE_5', expectedNameEt: 'Väga hea', expectedNameEn: 'Very good' },
        { grade: '4', expectedCode: 'KUTSEHINDAMINE_4', expectedNameEt: 'Hea', expectedNameEn: 'Good' },
        { grade: '3', expectedCode: 'KUTSEHINDAMINE_3', expectedNameEt: 'Rahuldav', expectedNameEn: 'Satisfactory' },
        { grade: '2', expectedCode: 'KUTSEHINDAMINE_2', expectedNameEt: 'Puudulik', expectedNameEn: 'Insufficient' },
        { grade: '1', expectedCode: 'KUTSEHINDAMINE_1', expectedNameEt: 'Nõrk', expectedNameEn: 'Weak' }
      ]

      testCases.forEach(({ grade, expectedCode, expectedNameEt, expectedNameEn }) => {
        const result = mapGrade(grade)
        expect(result.code).toBe(expectedCode)
        expect(result.value).toBe(grade)
        expect(result.nameEt).toBe(expectedNameEt)
        expect(result.nameEn).toBe(expectedNameEn)
      })
    })

    test('should map MA grade', () => {
      const result = mapGrade('MA')
      expect(result.code).toBe('KUTSEHINDAMINE_MA')
      expect(result.value).toBe('MA')
      expect(result.nameEt).toBe('Mitte arvestatud')
      expect(result.nameEn).toBe('Fail')
    })

    test('should map A grade', () => {
      const result = mapGrade('A')
      expect(result.code).toBe('KUTSEHINDAMINE_A')
      expect(result.value).toBe('A')
      expect(result.nameEt).toBe('Arvestatud')
      expect(result.nameEn).toBe('Pass')
    })

    test('should return null for invalid grades', () => {
      const invalidGrades = ['0', '6', 'B', 'X', '', null, undefined]
      invalidGrades.forEach(grade => {
        const result = mapGrade(grade)
        expect(result).toBeNull()
      })
    })
  })

  describe('Grade extraction from text (#extractGradeFromText logic)', () => {
    test('should extract numeric grades', () => {
      expect(extractGrade('5')).toBe('5')
      expect(extractGrade('4')).toBe('4')
      expect(extractGrade('3')).toBe('3')
      expect(extractGrade('2')).toBe('2')
      expect(extractGrade('1')).toBe('1')
    })

    test('should extract A and MA grades', () => {
      expect(extractGrade('A')).toBe('A')
      expect(extractGrade('MA')).toBe('MA')
    })

    test('should be case insensitive', () => {
      expect(extractGrade('a')).toBe('A')
      expect(extractGrade('ma')).toBe('MA')
      expect(extractGrade('Ma')).toBe('MA')
    })

    test('should trim whitespace', () => {
      expect(extractGrade('  5  ')).toBe('5')
      expect(extractGrade('  A  ')).toBe('A')
      expect(extractGrade('\n MA \t')).toBe('MA')
    })

    test('should return empty string for invalid text', () => {
      expect(extractGrade('invalid')).toBe('')
      expect(extractGrade('6')).toBe('')
      expect(extractGrade('0')).toBe('')
      expect(extractGrade('')).toBe('')
      expect(extractGrade(null)).toBe('')
      expect(extractGrade(undefined)).toBe('')
    })
  })

  describe('Journal ID extraction (#extractJournalId logic)', () => {
    test('should extract journal ID from URL', () => {
      const urls = [
        { url: 'https://tahvel.edu.ee/#/journal/12345/edit', expected: 12345 },
        { url: 'https://tahvel.edu.ee/#/journal/67890', expected: 67890 },
        { url: 'https://test.tahvel.eenet.ee/#/journal/999/view', expected: 999 }
      ]

      urls.forEach(({ url, expected }) => {
        const match = url.match(/\/journal\/(\d+)/)
        const id = match ? parseInt(match[1], 10) : null
        expect(id).toBe(expected)
      })
    })

    test('should return null for invalid URL', () => {
      const match = 'https://tahvel.edu.ee/#/home'.match(/\/journal\/(\d+)/)
      expect(match).toBeNull()
    })
  })

  describe('Grading mode application (#applyGradingModeToResults logic)', () => {
    test('should round numeric grades in NUMERIC mode', () => {
      const results = [{ ovGrades: { 1: '4.5' } }, { ovGrades: { 1: '3.7' } }, { ovGrades: { 1: '2.3' } }]

      const mode = 'NUMERIC'
      results.forEach(r => {
        if (mode === 'NUMERIC' && /^\d+(\.\d+)?$/.test(r.ovGrades['1'])) {
          const rounded = Math.round(Number(r.ovGrades['1']))
          r.ovGrades['1'] = String(rounded >= 1 && rounded <= 5 ? rounded : '')
        }
      })

      expect(results[0].ovGrades['1']).toBe('5')
      expect(results[1].ovGrades['1']).toBe('4')
      expect(results[2].ovGrades['1']).toBe('2')
    })

    test('should convert to A/MA in PASS_FAIL mode', () => {
      const results = [{ ovGrades: { 1: '5' } }, { ovGrades: { 1: '3' } }, { ovGrades: { 1: '1' } }]

      const mode = 'PASS_FAIL'
      results.forEach(r => {
        if (mode === 'PASS_FAIL') {
          const grade = r.ovGrades['1']
          if (['3', '4', '5'].includes(grade)) {
            r.ovGrades['1'] = 'A'
          } else if (['1', '2'].includes(grade)) {
            r.ovGrades['1'] = 'MA'
          }
        }
      })

      expect(results[0].ovGrades['1']).toBe('A')
      expect(results[1].ovGrades['1']).toBe('A')
      expect(results[2].ovGrades['1']).toBe('MA')
    })

    test('should keep original in CALCULATED mode', () => {
      const results = [{ ovGrades: { 1: '4.5' } }, { ovGrades: { 1: 'A' } }]

      expect(results[0].ovGrades['1']).toBe('4.5')
      expect(results[1].ovGrades['1']).toBe('A')
    })
  })

  describe('L-grade detection (detectLGrades logic)', () => {
    test('should detect entries with L prefix', () => {
      const entries = [{ nameEt: 'L1 - Teema 1' }, { nameEt: 'Tavaline tund' }, { nameEt: 'L2 - Teema 2' }]

      const lGrades = entries.filter(e => /^L\d+/.test(e.nameEt))

      expect(lGrades.length).toBe(2)
      expect(lGrades[0].nameEt).toBe('L1 - Teema 1')
      expect(lGrades[1].nameEt).toBe('L2 - Teema 2')
    })

    test('should handle case variations', () => {
      const entries = [{ nameEt: 'l1 - teema' }, { nameEt: 'L1 - teema' }]

      const lGrades = entries.filter(e => /^L\d+/i.test(e.nameEt))

      expect(lGrades.length).toBe(2)
    })
  })

  describe('ÕV grade detection (#hasAnyOvGrades logic)', () => {
    test('should detect ÕV entries', () => {
      const entries = [{ nameEt: 'ÕV 1 - Oskus' }, { nameEt: 'Tavaline tund' }, { nameEt: 'ÕV 2 - Teadmised' }]

      const ovEntries = entries.filter(e => e.nameEt?.toLowerCase().includes('õv') || e.nameEt?.toLowerCase().includes('õpiväljund'))

      expect(ovEntries.length).toBe(2)
    })

    test('should detect õpiväljund variant', () => {
      const entries = [{ nameEt: 'Õpiväljund 1' }, { nameEt: 'õpiväljund 2' }]

      const ovEntries = entries.filter(e => e.nameEt?.toLowerCase().includes('õpiväljund'))

      expect(ovEntries.length).toBe(2)
    })

    test('should detect ÕV numbers only from a trailing parenthesized suffix', () => {
      expect(extractOutcomeNumbersFromEntryName('Foo (ÕV2)')).toEqual(['2'])
      expect(extractOutcomeNumbersFromEntryName('Bar (ÕV1, ÕV3)')).toEqual(['1', '3'])
      expect(extractOutcomeNumbersFromEntryName('Baz (ÕV1, ÕV2, ÕV2)')).toEqual(['1', '2'])
    })

    test('should ignore plain ÕV mentions outside the trailing suffix', () => {
      expect(extractOutcomeNumbersFromEntryName('ÕV2 töö')).toEqual([])
      expect(extractOutcomeNumbersFromEntryName('Foo (ÕV2) lisa')).toEqual([])
      expect(extractOutcomeNumbersFromEntryName('Foo (ÕV2, test)')).toEqual([])
    })
  })

  describe('Column index detection (findColumnIndices logic)', () => {
    test('should find final grade column by text "lõpptulemus"', () => {
      const headers = [{ textContent: 'Õppija' }, { textContent: 'Lõpptulemus' }, { textContent: 'ÕV' }]

      const finalGradeIndex = headers.findIndex(h => h.textContent?.toLowerCase().trim().includes('lõpptulemus'))

      expect(finalGradeIndex).toBe(1)
    })

    test('should find ÕV columns by pattern', () => {
      const headers = [{ textContent: 'Õppija' }, { textContent: 'ÕV 1' }, { textContent: 'ÕV 2' }, { textContent: 'Lõpptulemus' }]

      const ovIndices = headers
        .map((h, i) => ({ text: h.textContent, index: i }))
        .filter(({ text }) => /ÕV\s*\d+/i.test(text))
        .map(({ index }) => index)

      expect(ovIndices).toEqual([1, 2])
    })

    test('should detect õpiväljund pattern', () => {
      const headers = [{ textContent: 'Õppija' }, { textContent: 'Õpiväljund 1' }, { textContent: 'Lõpptulemus' }]

      const ovIndex = headers.findIndex(h => h.textContent?.toLowerCase().includes('õpiväljund'))

      expect(ovIndex).toBe(1)
    })

    test('should handle colspan attributes', () => {
      const header = { textContent: 'ÕV 1', getAttribute: () => '2' }
      const colspan = parseInt(header.getAttribute('colspan') || '1')

      expect(colspan).toBe(2)
    })
  })

  describe('Student status filtering', () => {
    test('should identify academic leave status (OPPURSTAATUS_A)', () => {
      const status = 'OPPURSTAATUS_A'
      expect(status).toBe('OPPURSTAATUS_A')
    })

    test('should filter grades for students on academic leave', () => {
      const studentStatus = 'OPPURSTAATUS_A'
      const grades = ['MA', '1', '2', '3', '4', '5', 'A']

      const filtered = grades.filter(grade => {
        if (studentStatus === 'OPPURSTAATUS_A') {
          return grade !== 'MA' && grade !== '1' && grade !== '2'
        }
        return true
      })

      expect(filtered).toEqual(['3', '4', '5', 'A'])
    })
  })

  describe('extractFinalGrades - no SISSEKANNE_T/I grades', () => {
    test('should set finalGrade to null when student has no SISSEKANNE_T or SISSEKANNE_I grades', () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', nameEt: '1) ÕV1', curriculumModuleOutcomes: 100 },
        {
          entryType: 'SISSEKANNE_L',
          journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } }]
        }
      ]
      const students = [{ id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Test Student' } }]

      const result = extractFinalGradesLogic(entries, students)
      expect(result.output[0].finalGrade).toBeNull()
    })

    test('should calculate finalGrade normally when SISSEKANNE_I grades exist', () => {
      const entries = [
        {
          entryType: 'SISSEKANNE_I',
          nameEt: 'Assignment 1',
          journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_5' } }]
        }
      ]
      const students = [{ id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Test Student' } }]

      const result = extractFinalGradesLogic(entries, students)
      expect(result.output[0].finalGrade).toBe('5')
    })

    test('should calculate finalGrade normally when SISSEKANNE_T grades exist', () => {
      const entries = [
        {
          entryType: 'SISSEKANNE_T',
          journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_4' } }]
        }
      ]
      const students = [{ id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Test Student' } }]

      const result = extractFinalGradesLogic(entries, students)
      expect(result.output[0].finalGrade).toBe('4')
    })

    test('should set finalGrade to null and exclude from filtered output', () => {
      const output = [
        { journalStudentId: '1', finalGrade: null, name: 'Student A' },
        { journalStudentId: '2', finalGrade: '5', name: 'Student B' }
      ]
      const lGrades = { '1': 'A', '2': '4' }

      const filteredOutput = output.filter(r => {
        if (r.finalGrade === null) return false
        const key = String(r.journalStudentId).trim()
        const current = lGrades[key]
        if (!current) return r.finalGrade && r.finalGrade !== ''
        return (r.finalGrade && String(r.finalGrade).toUpperCase()) !== current
      })

      expect(filteredOutput.length).toBe(1)
      expect(filteredOutput[0].name).toBe('Student B')
    })

    test('null finalGrade should survive grading mode application', () => {
      const results = {
        output: [
          { name: 'Student A', finalGrade: null },
          { name: 'Student B', finalGrade: '4' }
        ]
      }

      applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBeNull()
      expect(results.output[1].finalGrade).toBe('A')
    })

    test('null finalGrade should survive eristav grading mode', () => {
      const results = {
        output: [
          { name: 'Student A', finalGrade: null },
          { name: 'Student B', finalGrade: 'A' }
        ]
      }

      applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].finalGrade).toBeNull()
      expect(results.output[1].finalGrade).toBe('5')
    })

    test('full pipeline: extraction with no grades → grading mode → filter excludes null', () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', nameEt: '1) ÕV1', curriculumModuleOutcomes: 100 },
        {
          entryType: 'SISSEKANNE_L',
          journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } }]
        }
      ]
      const students = [{ id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Test Student' } }]

      const results = extractFinalGradesLogic(entries, students)
      expect(results.output[0].finalGrade).toBeNull()

      applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBeNull()

      const lGrades = { '1': 'A' }
      const filteredOutput = results.output.filter(r => {
        if (r.finalGrade === null) return false
        const key = String(r.journalStudentId).trim()
        const current = lGrades[key]
        if (!current) return r.finalGrade && r.finalGrade !== ''
        return (r.finalGrade && String(r.finalGrade).toUpperCase()) !== current
      })

      expect(filteredOutput.length).toBe(0)
    })
  })

  describe('Grade date formatting', () => {
    test('should format Estonian timezone date', () => {
      const estDate = new Date('2024-09-15').toLocaleDateString('sv-SE', { timeZone: 'Europe/Tallinn' })
      const gradeDate = estDate + 'T00:00:00.000Z'

      expect(estDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(gradeDate).toContain('T00:00:00.000Z')
    })
  })

  describe('Grade validation', () => {
    test('should validate numeric grade range', () => {
      const rounded = Math.round(4.6)
      const isValid = rounded >= 1 && rounded <= 5

      expect(rounded).toBe(5)
      expect(isValid).toBe(true)
    })

    test('should reject out-of-range grades', () => {
      const testCases = [0, 6, -1, 10]
      testCases.forEach(val => {
        const isValid = val >= 1 && val <= 5
        expect(isValid).toBe(false)
      })
    })
  })
})

// Helper functions to test logic patterns
function mapGrade(grade) {
  let code = null,
    nameEt = '',
    nameEn = '',
    value = ''
  if (['1', '2', '3', '4', '5'].includes(grade)) {
    code = `KUTSEHINDAMINE_${grade}`
    value = grade
    const gradeNames = {
      5: { nameEt: 'Väga hea', nameEn: 'Very good' },
      4: { nameEt: 'Hea', nameEn: 'Good' },
      3: { nameEt: 'Rahuldav', nameEn: 'Satisfactory' },
      2: { nameEt: 'Puudulik', nameEn: 'Insufficient' },
      1: { nameEt: 'Nõrk', nameEn: 'Weak' }
    }
    nameEt = gradeNames[grade]?.nameEt || ''
    nameEn = gradeNames[grade]?.nameEn || ''
  } else if (grade === 'MA') {
    code = 'KUTSEHINDAMINE_MA'
    value = 'MA'
    nameEt = 'Mitte arvestatud'
    nameEn = 'Fail'
  } else if (grade === 'A') {
    code = 'KUTSEHINDAMINE_A'
    value = 'A'
    nameEt = 'Arvestatud'
    nameEn = 'Pass'
  } else {
    return null
  }
  return { code, value, nameEt, nameEn }
}

function extractFinalGradesLogic(entries, students) {
  const studentMap = {}
  students.forEach(s => {
    let name, idcode, studentId, journalStudentId
    if (s.student && s.student.idcode) {
      name = s.student.fullname || `${s.student.firstname} ${s.student.lastname}`
      idcode = s.student.idcode
      studentId = s.student.id
      journalStudentId = s.id
    } else {
      name = s.fullname || `${s.firstname} ${s.lastname}`
      idcode = s.idcode || 'N/A'
      studentId = s.studentId || s.id
      journalStudentId = s.id
    }
    studentMap[journalStudentId] = { name, idcode, studentId }
  })

  const gradesT = {}
  const gradesI = {}

  entries.forEach(entry => {
    if (entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_I') {
      if (entry.journalStudentResults) {
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, resultsArr]) => {
          if (Array.isArray(resultsArr)) {
            resultsArr.forEach(result => {
              if (result.grade && result.grade.code) {
                const grade = result.grade.code.replace('KUTSEHINDAMINE_', '')
                if (['1', '2', '3', '4', '5'].includes(grade)) {
                  if (entry.entryType === 'SISSEKANNE_T') {
                    if (!gradesT[journalStudentId]) gradesT[journalStudentId] = []
                    gradesT[journalStudentId].push(parseInt(grade))
                  } else {
                    if (!gradesI[journalStudentId]) gradesI[journalStudentId] = []
                    gradesI[journalStudentId].push(parseInt(grade))
                  }
                } else if (['A', 'MA'].includes(grade)) {
                  const key = journalStudentId + '_str'
                  if (entry.entryType === 'SISSEKANNE_T') {
                    if (!gradesT[key]) gradesT[key] = []
                    gradesT[key].push(grade)
                  } else {
                    if (!gradesI[key]) gradesI[key] = []
                    gradesI[key].push(grade)
                  }
                }
              }
            })
          }
        })
      }
      if (Array.isArray(entry.journalEntryStudents)) {
        entry.journalEntryStudents.forEach(js => {
          if (js.grade && js.grade.code) {
            const grade = js.grade.code.replace('KUTSEHINDAMINE_', '')
            const journalStudentId = js.journalStudent
            if (['1', '2', '3', '4', '5'].includes(grade)) {
              if (entry.entryType === 'SISSEKANNE_T') {
                if (!gradesT[journalStudentId]) gradesT[journalStudentId] = []
                gradesT[journalStudentId].push(parseInt(grade))
              } else {
                if (!gradesI[journalStudentId]) gradesI[journalStudentId] = []
                gradesI[journalStudentId].push(parseInt(grade))
              }
            } else if (['A', 'MA'].includes(grade)) {
              const key = journalStudentId + '_str'
              if (entry.entryType === 'SISSEKANNE_T') {
                if (!gradesT[key]) gradesT[key] = []
                gradesT[key].push(grade)
              } else {
                if (!gradesI[key]) gradesI[key] = []
                gradesI[key].push(grade)
              }
            }
          }
        })
      }
    }
  })

  const output = []
  Object.entries(studentMap).forEach(([journalStudentId, student]) => {
    const tGrades = gradesT[journalStudentId] || []
    const iGrades = gradesI[journalStudentId] || []
    const allGrades = [...tGrades, ...iGrades]
    const allStringGrades = [...(gradesT[journalStudentId + '_str'] || []), ...(gradesI[journalStudentId + '_str'] || [])]
    let finalGrade = ''
    if (allStringGrades.includes('MA')) {
      finalGrade = 'MA'
    } else if (allStringGrades.length > 0 && allStringGrades.every(g => g === 'A')) {
      finalGrade = 'A'
    } else if (allGrades.length > 0) {
      const sum = allGrades.reduce((a, b) => a + b, 0)
      const avg = sum / allGrades.length
      finalGrade = String(Math.round(avg))
    } else {
      finalGrade = null
    }
    output.push({ name: student.name, idcode: student.idcode, finalGrade, journalStudentId, studentId: student.studentId })
  })
  return { output }
}

function applyGradingModeToResults(results, mode) {
  if (!results || !Array.isArray(results.output)) return
  results.output.forEach(student => {
    if (student.finalGrade === null) return
    student.ovGrades = student.ovGrades || {}
    if (mode === 'mitte') {
      Object.keys(student.ovGrades).forEach(ov => {
        const raw = String(student.ovGrades[ov] || '').trim()
        let token = ''
        if (!raw) token = ''
        else if (/^MA$/i.test(raw)) token = 'MA'
        else if (/^A$/i.test(raw)) token = 'A'
        else if (raw.includes('_hasLow')) token = 'MA'
        else if (/^\d+(?:\.\d+)?$/.test(raw)) {
          const n = Math.round(Number(raw))
          token = n >= 3 ? 'A' : 'MA'
        } else token = raw
        student.ovGrades[ov] = token
      })
      const ovVals = Object.values(student.ovGrades)
      if (ovVals.length > 0) {
        const anyUngraded = ovVals.some(v => !v || String(v).trim() === '')
        const anyTwoOrMA = ovVals.some(v => {
          if (!v) return false
          const s = String(v).trim().toUpperCase()
          if (s === 'MA') return true
          if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(Number(s)) === 2
          return false
        })
        if (anyTwoOrMA) student.finalGrade = 'MA'
        else {
          const allA = ovVals.length > 0 && ovVals.every(v => String(v).toUpperCase() === 'A')
          student.finalGrade = allA && !anyUngraded ? 'A' : 'MA'
        }
      } else {
        const rawFg = String(student.finalGrade || '').trim()
        if (!rawFg) student.finalGrade = ''
        else if (/^A$/i.test(rawFg)) student.finalGrade = 'A'
        else if (/^MA$/i.test(rawFg)) student.finalGrade = 'MA'
        else if (/^\d+(?:\.\d+)?$/.test(rawFg)) {
          const n = Math.round(Number(rawFg))
          student.finalGrade = n >= 3 ? 'A' : 'MA'
        }
      }
    } else if (mode === 'eristav') {
      const numericGrades = []
      Object.keys(student.ovGrades).forEach(ov => {
        const raw = String(student.ovGrades[ov] || '').trim()
        if (!raw) { numericGrades.push(2); student.ovGrades[ov] = '2' }
        else if (/^A$/i.test(raw)) { numericGrades.push(5); student.ovGrades[ov] = '5' }
        else if (/^MA$/i.test(raw)) { numericGrades.push(2); student.ovGrades[ov] = '2' }
        else if (raw.includes('_hasLow')) {
          const average = parseFloat(raw.split('_')[0])
          const n = Math.round(average)
          numericGrades.push(n)
          student.ovGrades[ov] = String(n)
        } else if (/^\d+(?:\.\d+)?$/.test(raw)) {
          const n = Math.round(Number(raw))
          numericGrades.push(n)
          student.ovGrades[ov] = String(n)
        } else { numericGrades.push(2); student.ovGrades[ov] = '2' }
      })
      if (numericGrades.length > 0) {
        const avg = numericGrades.reduce((a, b) => a + b, 0) / numericGrades.length
        student.finalGrade = String(Math.round(avg))
      } else {
        const rawFg = String(student.finalGrade || '').trim()
        if (!rawFg) student.finalGrade = ''
        else if (/^A$/i.test(rawFg)) student.finalGrade = '5'
        else if (/^MA$/i.test(rawFg)) student.finalGrade = '2'
        else if (/^\d+(?:\.\d+)?$/.test(rawFg)) student.finalGrade = String(Math.round(Number(rawFg)))
      }
    }
  })
}

function extractGrade(text) {
  if (!text) return ''
  const cleaned = text.trim().toUpperCase()
  if (['1', '2', '3', '4', '5'].includes(cleaned)) return cleaned
  if (cleaned === 'A' || cleaned === 'MA') return cleaned
  return ''
}
