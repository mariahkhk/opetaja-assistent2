import { describe, test, expect, beforeEach } from 'bun:test'
import { restoreGlobalDOM } from '../../setup.js'
import FinalGradesByOvFeature from '../../../src/features/singleJournal/addFinalGrades/FinalGradesManagementFeature.js'
import { extractOutcomeNumbersFromEntryName } from '../../../src/lib/extractOutcomeNumbersFromEntryName.js'

function buildHeaderTable(headerSpecs) {
  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const tr = document.createElement('tr')
  for (const spec of headerSpecs) {
    const th = document.createElement('th')
    th.textContent = spec.text
    if (spec.colspan) th.setAttribute('colspan', String(spec.colspan))
    tr.appendChild(th)
  }
  thead.appendChild(tr)
  table.appendChild(thead)
  table.appendChild(document.createElement('tbody'))
  return table
}

describe('FinalGradesByOvFeature — public surface', () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    feature = new FinalGradesByOvFeature()
  })

  describe('shouldActivate', () => {
    test('matches /journal/<id>/edit', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/12345/edit')).toBe(true)
    })

    test('matches /journal/<id> without /edit', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/12345')).toBe(true)
    })

    test('rejects URLs without /journal/<id>', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/home')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/timetable')).toBe(false)
    })
  })

  describe('extractJournalId', () => {
    test('returns journal id string from current window.location.href', () => {
      const orig = global.window
      try {
        global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/54321/edit' } }
        expect(feature.extractJournalId()).toBe('54321')
      } finally {
        global.window = orig
      }
    })

    test('returns null when URL has no /journal/<id>', () => {
      const orig = global.window
      try {
        global.window = { location: { href: 'https://tahvel.edu.ee/#/home' } }
        expect(feature.extractJournalId()).toBeNull()
      } finally {
        global.window = orig
      }
    })
  })

  describe('mapGradeToSchema', () => {
    test('maps numeric grades 1-5 to KUTSEHINDAMINE_<n> with Estonian + English names', () => {
      const cases = [
        { grade: '5', code: 'KUTSEHINDAMINE_5', nameEt: 'Väga hea', nameEn: 'Very good' },
        { grade: '4', code: 'KUTSEHINDAMINE_4', nameEt: 'Hea', nameEn: 'Good' },
        { grade: '3', code: 'KUTSEHINDAMINE_3', nameEt: 'Rahuldav', nameEn: 'Satisfactory' },
        { grade: '2', code: 'KUTSEHINDAMINE_2', nameEt: 'Puudulik', nameEn: 'Insufficient' },
        { grade: '1', code: 'KUTSEHINDAMINE_1', nameEt: 'Nõrk', nameEn: 'Weak' }
      ]
      for (const c of cases) {
        const result = feature.mapGradeToSchema(c.grade)
        expect(result.code).toBe(c.code)
        expect(result.value).toBe(c.grade)
        expect(result.nameEt).toBe(c.nameEt)
        expect(result.nameEn).toBe(c.nameEn)
      }
    })

    test('maps MA grade', () => {
      const result = feature.mapGradeToSchema('MA')
      expect(result.code).toBe('KUTSEHINDAMINE_MA')
      expect(result.value).toBe('MA')
      expect(result.nameEt).toBe('Mitte arvestatud')
      expect(result.nameEn).toBe('Fail')
    })

    test('maps A grade', () => {
      const result = feature.mapGradeToSchema('A')
      expect(result.code).toBe('KUTSEHINDAMINE_A')
      expect(result.value).toBe('A')
      expect(result.nameEt).toBe('Arvestatud')
      expect(result.nameEn).toBe('Pass')
    })

    test('returns null for invalid grades', () => {
      for (const grade of ['0', '6', 'B', 'X', '', null, undefined]) {
        expect(feature.mapGradeToSchema(grade)).toBeNull()
      }
    })
  })

  describe('extractGradeFromText', () => {
    test('returns numeric grades 1-5 unchanged', () => {
      for (const g of ['1', '2', '3', '4', '5']) {
        expect(feature.extractGradeFromText(g)).toBe(g)
      }
    })

    test('returns A and MA unchanged', () => {
      expect(feature.extractGradeFromText('A')).toBe('A')
      expect(feature.extractGradeFromText('MA')).toBe('MA')
    })

    test('uppercases lowercase variants', () => {
      expect(feature.extractGradeFromText('a')).toBe('A')
      expect(feature.extractGradeFromText('ma')).toBe('MA')
      expect(feature.extractGradeFromText('Ma')).toBe('MA')
    })

    test('trims surrounding whitespace and tabs/newlines', () => {
      expect(feature.extractGradeFromText('  5  ')).toBe('5')
      expect(feature.extractGradeFromText('  A  ')).toBe('A')
      expect(feature.extractGradeFromText('\n MA \t')).toBe('MA')
    })

    test('returns empty string for invalid input', () => {
      for (const t of ['invalid', '6', '0', '', null, undefined]) {
        expect(feature.extractGradeFromText(t)).toBe('')
      }
    })
  })

  describe('detectLGrades', () => {
    test('returns true when any entry has SISSEKANNE_L', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T' },
        { entryType: 'SISSEKANNE_L' },
        { entryType: 'SISSEKANNE_I' }
      ]
      expect(feature.detectLGrades(entries)).toBe(true)
    })

    test('returns false when no entries are SISSEKANNE_L', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T' },
        { entryType: 'SISSEKANNE_I' },
        { entryType: 'SISSEKANNE_O' }
      ]
      expect(feature.detectLGrades(entries)).toBe(false)
    })

    test('returns false for empty array', () => {
      expect(feature.detectLGrades([])).toBe(false)
    })
  })

  describe('extractFinalGrades — student map building', () => {
    test('uses nested student.fullname when available', () => {
      const students = [{ id: '1', student: { id: 100, idcode: '50001010001', fullname: 'Kati Kask' } }]
      const result = feature.extractFinalGrades([], students)
      expect(result.output[0].name).toBe('Kati Kask')
      expect(result.output[0].idcode).toBe('50001010001')
      expect(result.output[0].studentId).toBe(100)
      expect(result.output[0].journalStudentId).toBe('1')
    })

    test('builds fullname from firstname + lastname when fullname missing', () => {
      const students = [{ id: '2', student: { id: 200, idcode: '50001010002', firstname: 'Jaan', lastname: 'Mets' } }]
      const result = feature.extractFinalGrades([], students)
      expect(result.output[0].name).toBe('Jaan Mets')
    })

    test('falls back to flat student fields when no nested student object', () => {
      const students = [{ id: '3', studentId: 300, fullname: 'Mari Maasikas', idcode: '50001010003' }]
      const result = feature.extractFinalGrades([], students)
      expect(result.output[0].name).toBe('Mari Maasikas')
      expect(result.output[0].studentId).toBe(300)
    })

    test('uses N/A when idcode missing on flat student', () => {
      const students = [{ id: '4', fullname: 'No ID' }]
      const result = feature.extractFinalGrades([], students)
      expect(result.output[0].idcode).toBe('N/A')
    })
  })

  describe('extractFinalGrades — grade aggregation from journalEntryStudents', () => {
    const students = [{ id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Test' } }]

    test('returns null finalGrade when no SISSEKANNE_T or SISSEKANNE_I entries exist', () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', nameEt: '1) ÕV1', curriculumModuleOutcomes: 100 },
        { entryType: 'SISSEKANNE_L', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } }] }
      ]
      const result = feature.extractFinalGrades(entries, students)
      expect(result.output[0].finalGrade).toBeNull()
    })

    test('extracts numeric grade from SISSEKANNE_T entry', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_4' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('4')
    })

    test('extracts numeric grade from SISSEKANNE_I entry', () => {
      const entries = [
        { entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_5' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('5')
    })

    test('averages multiple numeric grades and rounds to nearest integer', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_4' } }] },
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_5' } }] },
        { entryType: 'SISSEKANNE_I', nameEt: 'Töö', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_3' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('4')
    })

    test('rounds 2.5 average up to 3', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_2' } }] },
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_3' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('3')
    })

    test('any MA among string grades forces final to MA', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } }] },
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_MA' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('MA')
    })

    test('all A grades produce A as final', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } }] },
        { entryType: 'SISSEKANNE_I', nameEt: 'Töö', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('A')
    })

    test('ignores non-T/I entry types when computing final grade', () => {
      const entries = [
        { entryType: 'SISSEKANNE_L', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_5' } }] },
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_3' } }] }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('3')
    })
  })

  describe('extractFinalGrades — grade aggregation from journalStudentResults', () => {
    const students = [{ id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Test' } }]

    test('extracts grades from journalStudentResults map', () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_4' } }] } }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('4')
    })

    test('combines journalStudentResults and journalEntryStudents in same entry', () => {
      const entries = [
        {
          entryType: 'SISSEKANNE_T',
          journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }] },
          journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_3' } }]
        }
      ]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('4')
    })
  })

  describe('extractFinalGrades — multiple students', () => {
    test('produces one output entry per student, isolated by journalStudentId', () => {
      const students = [
        { id: '1', student: { id: 10, idcode: '50001010001', fullname: 'Student A' } },
        { id: '2', student: { id: 20, idcode: '50001010002', fullname: 'Student B' } }
      ]
      const entries = [
        {
          entryType: 'SISSEKANNE_T',
          journalEntryStudents: [
            { journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_5' } },
            { journalStudent: '2', grade: { code: 'KUTSEHINDAMINE_2' } }
          ]
        }
      ]
      const result = feature.extractFinalGrades(entries, students)
      expect(result.output.length).toBe(2)
      expect(result.output.find(r => r.name === 'Student A').finalGrade).toBe('5')
      expect(result.output.find(r => r.name === 'Student B').finalGrade).toBe('2')
    })

    test('mixed scenarios: one student MA, one numeric, one no grades', () => {
      const students = [
        { id: '1', student: { id: 10, idcode: '50001010001', fullname: 'A' } },
        { id: '2', student: { id: 20, idcode: '50001010002', fullname: 'B' } },
        { id: '3', student: { id: 30, idcode: '50001010003', fullname: 'C' } }
      ]
      const entries = [
        {
          entryType: 'SISSEKANNE_T',
          journalEntryStudents: [
            { journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_MA' } },
            { journalStudent: '2', grade: { code: 'KUTSEHINDAMINE_4' } }
          ]
        }
      ]
      const result = feature.extractFinalGrades(entries, students)
      expect(result.output.find(r => r.name === 'A').finalGrade).toBe('MA')
      expect(result.output.find(r => r.name === 'B').finalGrade).toBe('4')
      expect(result.output.find(r => r.name === 'C').finalGrade).toBeNull()
    })
  })

  describe('applyGradingModeToResults — mitte mode', () => {
    test('preserves null finalGrade (student gets skipped)', () => {
      const results = {
        output: [
          { name: 'A', finalGrade: null },
          { name: 'B', finalGrade: '4' }
        ]
      }
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBeNull()
      expect(results.output[1].finalGrade).toBe('A')
    })

    test('numeric ovGrade ≥ 3 maps to A, ovGrades all A → final A', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '4', ovGrades: { '1': '4', '2': '5' } }]
      }
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].ovGrades['1']).toBe('A')
      expect(results.output[0].ovGrades['2']).toBe('A')
      expect(results.output[0].finalGrade).toBe('A')
    })

    test('any ovGrade rounding to 2 forces final MA', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '3', ovGrades: { '1': '4', '2': '2' } }]
      }
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBe('MA')
    })

    test('any ovGrade with _hasLow flag becomes MA, forces final MA', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '3', ovGrades: { '1': '3.0_hasLow', '2': '4' } }]
      }
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].ovGrades['1']).toBe('MA')
      expect(results.output[0].finalGrade).toBe('MA')
    })

    test('ungraded ovGrade plus all-A still results in MA (anyUngraded check)', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '4', ovGrades: { '1': 'A', '2': '' } }]
      }
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBe('MA')
    })

    test('falls back to mapping precomputed finalGrade when no ovGrades', () => {
      const results = {
        output: [
          { name: 'A', finalGrade: '4', ovGrades: {} },
          { name: 'B', finalGrade: '2', ovGrades: {} },
          { name: 'C', finalGrade: 'A', ovGrades: {} },
          { name: 'D', finalGrade: 'MA', ovGrades: {} }
        ]
      }
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBe('A')
      expect(results.output[1].finalGrade).toBe('MA')
      expect(results.output[2].finalGrade).toBe('A')
      expect(results.output[3].finalGrade).toBe('MA')
    })
  })

  describe('applyGradingModeToResults — eristav mode', () => {
    test('preserves null finalGrade', () => {
      const results = {
        output: [
          { name: 'A', finalGrade: null },
          { name: 'B', finalGrade: 'A' }
        ]
      }
      feature.applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].finalGrade).toBeNull()
      expect(results.output[1].finalGrade).toBe('5')
    })

    test('A → 5 and MA → 2 in ovGrades, final is rounded average', () => {
      const results = {
        output: [{ name: 'A', finalGrade: 'A', ovGrades: { '1': 'A', '2': 'MA' } }]
      }
      feature.applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].ovGrades['1']).toBe('5')
      expect(results.output[0].ovGrades['2']).toBe('2')
      expect(results.output[0].finalGrade).toBe('4')
    })

    test('numeric strings are rounded and used for averaging', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '4', ovGrades: { '1': '3.6', '2': '4.4' } }]
      }
      feature.applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].ovGrades['1']).toBe('4')
      expect(results.output[0].ovGrades['2']).toBe('4')
      expect(results.output[0].finalGrade).toBe('4')
    })

    test('_hasLow flag uses the average part for the numeric grade', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '3', ovGrades: { '1': '3.4_hasLow' } }]
      }
      feature.applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].ovGrades['1']).toBe('3')
      expect(results.output[0].finalGrade).toBe('3')
    })

    test('empty ovGrade is treated as 2', () => {
      const results = {
        output: [{ name: 'A', finalGrade: '3', ovGrades: { '1': '' } }]
      }
      feature.applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].ovGrades['1']).toBe('2')
      expect(results.output[0].finalGrade).toBe('2')
    })

    test('falls back to mapping precomputed finalGrade when no ovGrades', () => {
      const results = {
        output: [
          { name: 'A', finalGrade: 'A', ovGrades: {} },
          { name: 'B', finalGrade: 'MA', ovGrades: {} },
          { name: 'C', finalGrade: '4', ovGrades: {} }
        ]
      }
      feature.applyGradingModeToResults(results, 'eristav')
      expect(results.output[0].finalGrade).toBe('5')
      expect(results.output[1].finalGrade).toBe('2')
      expect(results.output[2].finalGrade).toBe('4')
    })
  })

  describe('findColumnIndices', () => {
    test('finds final grade column by "Lõpptulemus" header text', () => {
      const table = buildHeaderTable([{ text: 'Õppija' }, { text: 'Lõpptulemus' }])
      const { finalGradeCols } = feature.findColumnIndices(table, [])
      expect(finalGradeCols).toEqual([1])
    })

    test('finds ÕV columns by header text', () => {
      const table = buildHeaderTable([
        { text: 'Õppija' },
        { text: 'ÕV1' },
        { text: 'ÕV2' },
        { text: 'Lõpptulemus' }
      ])
      const { ovCols, finalGradeCols } = feature.findColumnIndices(table, [])
      expect(ovCols).toEqual([1, 2])
      expect(finalGradeCols).toEqual([3])
    })

    test('detects "õpiväljund" variant in header', () => {
      const table = buildHeaderTable([
        { text: 'Õppija' },
        { text: 'Õpiväljund 1' },
        { text: 'Lõpptulemus' }
      ])
      const { ovCols } = feature.findColumnIndices(table, [])
      expect(ovCols).toEqual([1])
    })

    test('honors colspan when expanding column indices', () => {
      const table = buildHeaderTable([
        { text: 'Õppija' },
        { text: 'ÕV1', colspan: 2 },
        { text: 'Lõpptulemus' }
      ])
      const { ovCols, finalGradeCols } = feature.findColumnIndices(table, [])
      expect(ovCols).toEqual([1, 2])
      expect(finalGradeCols).toEqual([3])
    })

    test('matches SISSEKANNE_O outcome columns by entry name', () => {
      const table = buildHeaderTable([
        { text: 'Õppija' },
        { text: '1) Mõistab tarkvaraarenduse põhimõtteid' },
        { text: 'Lõpptulemus' }
      ])
      const outcomeNames = ['1) mõistab tarkvaraarenduse põhimõtteid']
      const { ovCols } = feature.findColumnIndices(table, outcomeNames)
      expect(ovCols).toEqual([1])
    })

    test('returns empty arrays when no matching headers exist', () => {
      const table = buildHeaderTable([{ text: 'Foo' }, { text: 'Bar' }])
      const { ovCols, finalGradeCols } = feature.findColumnIndices(table, [])
      expect(ovCols).toEqual([])
      expect(finalGradeCols).toEqual([])
    })
  })
})

describe('extractOutcomeNumbersFromEntryName', () => {
  test('extracts ÕV numbers from trailing parenthesized suffix', () => {
    expect(extractOutcomeNumbersFromEntryName('Foo (ÕV2)')).toEqual(['2'])
    expect(extractOutcomeNumbersFromEntryName('Bar (ÕV1, ÕV3)')).toEqual(['1', '3'])
    expect(extractOutcomeNumbersFromEntryName('Baz (ÕV1, ÕV2, ÕV2)')).toEqual(['1', '2'])
  })

  test('ignores plain ÕV mentions outside the trailing suffix', () => {
    expect(extractOutcomeNumbersFromEntryName('ÕV2 töö')).toEqual([])
    expect(extractOutcomeNumbersFromEntryName('Foo (ÕV2) lisa')).toEqual([])
    expect(extractOutcomeNumbersFromEntryName('Foo (ÕV2, test)')).toEqual([])
  })
})
