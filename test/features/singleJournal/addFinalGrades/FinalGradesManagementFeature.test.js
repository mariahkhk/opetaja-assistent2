import { describe, test, it, expect, beforeEach, mock } from 'bun:test'
import { restoreGlobalDOM } from '../../../setup.js'
import FinalGradesByOvFeature from '../../../../src/features/singleJournal/addFinalGrades/FinalGradesManagementFeature.js'
import { extractOutcomeNumberFromOutcomeEntryName, extractOutcomeNumbersFromEntryName } from '../../../../src/lib/extractOutcomeNumbersFromEntryName.js'

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

describe("FinalGradesByOvFeature - public surface", () => {
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

describe('extractOutcomeNumberFromOutcomeEntryName', () => {
  test('extracts parenthesized and dotted SISSEKANNE_O prefixes', () => {
    expect(extractOutcomeNumberFromOutcomeEntryName('1) Outcome')).toBe('1')
    expect(extractOutcomeNumberFromOutcomeEntryName('04. loob lihtsamaid rakendusi')).toBe('4')
    expect(extractOutcomeNumberFromOutcomeEntryName('005. järgib praktikaid')).toBe('5')
  })

  test('returns empty string when no outcome prefix exists', () => {
    expect(extractOutcomeNumberFromOutcomeEntryName('Outcome 1')).toBe('')
    expect(extractOutcomeNumberFromOutcomeEntryName('000000000000000000000000000000000000000000x')).toBe('')
  })
})


function buildFeature(apiOverrides = {}) {
  const f = new FinalGradesByOvFeature()
  f.api = {
    tahvel: {
      get: mock(async () => ({})),
      post: mock(async () => ({}))
    },
    ...apiOverrides
  }
  return f
}

describe("FinalGradesManagementFeature - integration", () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    feature = buildFeature()
  })

  describe('shouldActivate', () => {
    it('matches /journal/<id> URLs', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/edit')).toBe(true)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123')).toBe(true)
    })

    it('does not match URLs without /journal/<id>', () => {
      expect(feature.shouldActivate('about:blank')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/students')).toBe(false)
    })
  })

  describe('extractJournalId', () => {
    it('returns id when window.location.href has /journal/X', () => {
      window.location.hash = '#/journal/12345/edit'
      expect(feature.extractJournalId()).toBe('12345')
    })

    it('returns null when URL has no journal id', () => {
      window.location.hash = '#/students'
      expect(feature.extractJournalId()).toBeNull()
    })
  })

  describe('mapGradeToSchema', () => {
    it('maps numeric grades 1-5 to KUTSEHINDAMINE codes', () => {
      expect(feature.mapGradeToSchema('5')).toEqual({
        code: 'KUTSEHINDAMINE_5', value: '5', nameEt: 'Väga hea', nameEn: 'Very good'
      })
      expect(feature.mapGradeToSchema('1')).toMatchObject({ code: 'KUTSEHINDAMINE_1' })
    })

    it('maps MA and A', () => {
      expect(feature.mapGradeToSchema('MA').code).toBe('KUTSEHINDAMINE_MA')
      expect(feature.mapGradeToSchema('A').code).toBe('KUTSEHINDAMINE_A')
    })

    it('returns null for unknown grades', () => {
      expect(feature.mapGradeToSchema('X')).toBeNull()
      expect(feature.mapGradeToSchema('6')).toBeNull()
      expect(feature.mapGradeToSchema('')).toBeNull()
    })
  })

  describe('extractGradeFromText', () => {
    it('returns numeric grades 1-5', () => {
      expect(feature.extractGradeFromText('3')).toBe('3')
    })

    it('uppercases lowercase a/ma', () => {
      expect(feature.extractGradeFromText('a')).toBe('A')
      expect(feature.extractGradeFromText('ma')).toBe('MA')
    })

    it('trims whitespace', () => {
      expect(feature.extractGradeFromText('  5\n')).toBe('5')
    })

    it('returns empty for invalid input', () => {
      expect(feature.extractGradeFromText('')).toBe('')
      expect(feature.extractGradeFromText(null)).toBe('')
      expect(feature.extractGradeFromText('foo')).toBe('')
    })
  })

  describe('detectLGrades', () => {
    it('returns true when any entry is SISSEKANNE_L', () => {
      expect(feature.detectLGrades([
        { entryType: 'SISSEKANNE_T' },
        { entryType: 'SISSEKANNE_L' }
      ])).toBe(true)
    })

    it('returns false when no entries are SISSEKANNE_L', () => {
      expect(feature.detectLGrades([
        { entryType: 'SISSEKANNE_T' }
      ])).toBe(false)
    })
  })

  describe('hasAnyLGrades', () => {
    it('returns false for empty array', () => {
      expect(feature.hasAnyLGrades([])).toBe(false)
    })

    it('returns false for non-array input', () => {
      expect(feature.hasAnyLGrades(null)).toBe(false)
      expect(feature.hasAnyLGrades(undefined)).toBe(false)
      expect(feature.hasAnyLGrades('not an array')).toBe(false)
    })

    it('returns true when an L entry has graded students', () => {
      const entries = [
        { entryType: 'SISSEKANNE_L', journalEntryStudents: [{ grade: { code: 'KUTSEHINDAMINE_5' } }] }
      ]
      expect(feature.hasAnyLGrades(entries)).toBe(true)
    })

    it('returns false when L entry has no graded students', () => {
      const entries = [
        { entryType: 'SISSEKANNE_L', journalEntryStudents: [] },
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [{ grade: { code: 'KUTSEHINDAMINE_5' } }] }
      ]
      expect(feature.hasAnyLGrades(entries)).toBe(false)
    })

    it('returns false when L entry students have no grade.code', () => {
      const entries = [
        { entryType: 'SISSEKANNE_L', journalEntryStudents: [{ grade: null }] }
      ]
      expect(feature.hasAnyLGrades(entries)).toBe(false)
    })
  })

  describe('hasAnyOvGrades', () => {
    it('returns false for empty array or non-array', () => {
      expect(feature.hasAnyOvGrades([])).toBe(false)
      expect(feature.hasAnyOvGrades(null)).toBe(false)
    })

    it('returns true when an O entry has studentOutcomeResults', () => {
      expect(feature.hasAnyOvGrades([
        { entryType: 'SISSEKANNE_O', studentOutcomeResults: { '1': [] } }
      ])).toBe(true)
    })

    it('returns true when an O entry has outcomeStudents', () => {
      expect(feature.hasAnyOvGrades([
        { entryType: 'SISSEKANNE_O', outcomeStudents: [{ grade: 5 }] }
      ])).toBe(true)
    })

    it('returns false when O entry has empty studentOutcomeResults and outcomeStudents', () => {
      expect(feature.hasAnyOvGrades([
        { entryType: 'SISSEKANNE_O', studentOutcomeResults: {}, outcomeStudents: [] }
      ])).toBe(false)
    })

    it('returns false when no O entries present', () => {
      expect(feature.hasAnyOvGrades([
        { entryType: 'SISSEKANNE_T' }
      ])).toBe(false)
    })
  })

  describe('findJournalTable', () => {
    it('returns null when no candidate selectors match', () => {
      expect(feature.findJournalTable()).toBeNull()
    })

    it('returns the first candidate that matches', () => {
      const tbl = document.createElement('table')
      tbl.className = 'journalTable'
      document.body.appendChild(tbl)
      expect(feature.findJournalTable()).toBe(tbl)
    })

    it('prefers #studentTable when present', () => {
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const inner = document.createElement('table')
      inner.className = 'tahvel-table'
      wrapper.appendChild(inner)
      document.body.appendChild(wrapper)
      expect(feature.findJournalTable()).toBe(inner)
    })
  })

  describe('findColumnIndices', () => {
    function buildTable(headers) {
      const tbl = document.createElement('table')
      const thead = document.createElement('thead')
      const tr = document.createElement('tr')
      for (const h of headers) {
        const th = document.createElement('th')
        if (typeof h === 'string') th.textContent = h
        else {
          th.textContent = h.text
          if (h.colspan) th.setAttribute('colspan', h.colspan)
        }
        tr.appendChild(th)
      }
      thead.appendChild(tr)
      tbl.appendChild(thead)
      return tbl
    }

    it('detects ÕV columns by text', () => {
      const tbl = buildTable(['ÕV1', 'ÕV2', 'Other'])
      const result = feature.findColumnIndices(tbl)
      expect(result.ovCols).toEqual([0, 1])
    })

    it('detects Lõpptulemus column', () => {
      const tbl = buildTable(['Name', 'Lõpptulemus'])
      const result = feature.findColumnIndices(tbl)
      expect(result.finalGradeCols).toEqual([1])
    })

    it('handles colspan when computing column indices', () => {
      const tbl = buildTable([{ text: 'Lõpptulemus', colspan: '2' }])
      const result = feature.findColumnIndices(tbl)
      expect(result.finalGradeCols).toEqual([0, 1])
    })

    it('matches outcome columns by name', () => {
      const tbl = buildTable(['Riskianalüüs ja tegevuse'])
      const result = feature.findColumnIndices(tbl, ['riskianalüüs ja tegevuse plaan'])
      expect(result.ovCols).toEqual([0])
    })

    it('detects õpiväljund text', () => {
      const tbl = buildTable(['Õpiväljund 1'])
      const result = feature.findColumnIndices(tbl)
      expect(result.ovCols).toEqual([0])
    })

    it('returns empty arrays when no matching headers', () => {
      const tbl = buildTable(['Foo', 'Bar'])
      const result = feature.findColumnIndices(tbl)
      expect(result.ovCols).toEqual([])
      expect(result.finalGradeCols).toEqual([])
    })

    it('deduplicates column indices', () => {
      const tbl = buildTable(['ÕV1'])
      // Add second header row that also matches
      const thead = tbl.querySelector('thead')
      const tr2 = document.createElement('tr')
      const th2 = document.createElement('th')
      th2.textContent = 'õpiväljund'
      tr2.appendChild(th2)
      thead.appendChild(tr2)
      const result = feature.findColumnIndices(tbl)
      expect(result.ovCols.length).toBe(new Set(result.ovCols).size)
    })
  })

  describe('extractFinalGrades', () => {
    it('returns empty output for no entries and no students', () => {
      const r = feature.extractFinalGrades([], [])
      expect(r.output).toEqual([])
    })

    it('uses MA when any string grade is MA', () => {
      const students = [{ id: 1, fullname: 'Alice', idcode: 'A1', studentId: 100 }]
      const entries = [{
        entryType: 'SISSEKANNE_T',
        journalStudentResults: {
          '1': [{ grade: { code: 'KUTSEHINDAMINE_MA' } }]
        }
      }]
      const r = feature.extractFinalGrades(entries, students)
      expect(r.output[0].finalGrade).toBe('MA')
    })

    it('returns A when all string grades are A', () => {
      const students = [{ id: 1, fullname: 'Alice', idcode: 'A1', studentId: 100 }]
      const entries = [{
        entryType: 'SISSEKANNE_T',
        journalStudentResults: {
          '1': [{ grade: { code: 'KUTSEHINDAMINE_A' } }]
        }
      }]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('A')
    })

    it('averages numeric grades', () => {
      const students = [{ id: 1, fullname: 'Alice', idcode: 'A1', studentId: 100 }]
      const entries = [{
        entryType: 'SISSEKANNE_T',
        journalStudentResults: {
          '1': [
            { grade: { code: 'KUTSEHINDAMINE_5' } },
            { grade: { code: 'KUTSEHINDAMINE_3' } }
          ]
        }
      }]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('4')
    })

    it('returns null when no T or I grades', () => {
      const students = [{ id: 1, fullname: 'Alice', idcode: 'A1', studentId: 100 }]
      const r = feature.extractFinalGrades([], students)
      expect(r.output[0].finalGrade).toBeNull()
    })

    it('handles journalEntryStudents format', () => {
      const students = [{ id: 1, fullname: 'Alice', idcode: 'A1' }]
      const entries = [{
        entryType: 'SISSEKANNE_I',
        journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_4' } }]
      }]
      expect(feature.extractFinalGrades(entries, students).output[0].finalGrade).toBe('4')
    })

    it('builds fullname from firstname + lastname when fullname missing', () => {
      const students = [{ id: 1, firstname: 'Bob', lastname: 'Builder', idcode: 'B1', studentId: 200 }]
      const r = feature.extractFinalGrades([], students)
      expect(r.output[0].name).toBe('Bob Builder')
    })

    it('uses nested student object when present', () => {
      const students = [{ id: 1, student: { id: 100, fullname: 'Carol', idcode: 'C1' } }]
      const r = feature.extractFinalGrades([], students)
      expect(r.output[0].name).toBe('Carol')
    })

    it('uses N/A when idcode missing on flat student', () => {
      const students = [{ id: 1, firstname: 'Foo', lastname: 'Bar', studentId: 1 }]
      const r = feature.extractFinalGrades([], students)
      expect(r.output[0].idcode).toBe('N/A')
    })
  })

  describe('applyGradingModeToResults', () => {
    function makeResults(students) {
      return { output: students }
    }

    it('does nothing when results are missing', () => {
      expect(() => feature.applyGradingModeToResults(null, 'mitte')).not.toThrow()
      expect(() => feature.applyGradingModeToResults({}, 'mitte')).not.toThrow()
    })

    it('skips students with null finalGrade', () => {
      const results = makeResults([
        { finalGrade: null, ovGrades: { '1': '5' } }
      ])
      feature.applyGradingModeToResults(results, 'mitte')
      expect(results.output[0].finalGrade).toBeNull()
    })

    describe('mitte mode', () => {
      it('keeps MA in mitte mode', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': 'MA' } }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].finalGrade).toBe('MA')
        expect(results.output[0].ovGrades['1']).toBe('MA')
      })

      it('converts numeric >=3 to A and <3 to MA', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '5', '2': '3', '3': '2' } }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].ovGrades['1']).toBe('A')
        expect(results.output[0].ovGrades['2']).toBe('A')
        expect(results.output[0].ovGrades['3']).toBe('MA')
      })

      it('rolls up to MA when any OV is 2 or MA', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '5', '2': '2' } }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].finalGrade).toBe('MA')
      })

      it('rolls up to A when all OVs are A', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '5', '2': 'A' } }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].finalGrade).toBe('A')
      })

      it('falls back to mapping precomputed finalGrade when no OV grades', () => {
        const results = makeResults([
          { finalGrade: '4', ovGrades: {} }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].finalGrade).toBe('A')
      })

      it('handles _hasLow tag as MA', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '4_hasLow' } }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].ovGrades['1']).toBe('MA')
      })

      it('keeps unknown tokens', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': 'X' } }
        ])
        feature.applyGradingModeToResults(results, 'mitte')
        expect(results.output[0].ovGrades['1']).toBe('X')
      })
    })

    describe('eristav mode', () => {
      it('converts A → 5 and MA → 2', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': 'A', '2': 'MA' } }
        ])
        feature.applyGradingModeToResults(results, 'eristav')
        expect(results.output[0].ovGrades['1']).toBe('5')
        expect(results.output[0].ovGrades['2']).toBe('2')
      })

      it('rounds numeric averages', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '4', '2': '5' } }
        ])
        feature.applyGradingModeToResults(results, 'eristav')
        const avg = results.output[0].finalGrade
        expect(['4', '5']).toContain(avg)
      })

      it('handles _hasLow flag in eristav', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '3.5_hasLow' } }
        ])
        feature.applyGradingModeToResults(results, 'eristav')
        expect(results.output[0].ovGrades['1']).toBe('4')
      })

      it('treats unknown tokens as 2', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': 'X' } }
        ])
        feature.applyGradingModeToResults(results, 'eristav')
        expect(results.output[0].ovGrades['1']).toBe('2')
      })

      it('treats empty value as 2', () => {
        const results = makeResults([
          { finalGrade: '5', ovGrades: { '1': '' } }
        ])
        feature.applyGradingModeToResults(results, 'eristav')
        expect(results.output[0].ovGrades['1']).toBe('2')
      })

      it('falls back to mapping precomputed finalGrade when no OV grades', () => {
        const results = makeResults([
          { finalGrade: 'A', ovGrades: {} }
        ])
        feature.applyGradingModeToResults(results, 'eristav')
        expect(results.output[0].finalGrade).toBe('5')

        const results2 = makeResults([
          { finalGrade: 'MA', ovGrades: {} }
        ])
        feature.applyGradingModeToResults(results2, 'eristav')
        expect(results2.output[0].finalGrade).toBe('2')
      })
    })
  })

  describe('fetchDetailedOutcomeStudents', () => {
    it('returns empty object when API returns no outcomeStudents', async () => {
      feature.api.tahvel.get = mock(async () => ({}))
      const r = await feature.fetchDetailedOutcomeStudents(123, 5, [], { output: 'studentOutcomeResults' })
      expect(r).toEqual({})
    })

    it('maps outcome students to studentOutcomeResults', async () => {
      feature.api.tahvel.get = mock(async () => ({
        outcomeStudents: [
          { studentId: 100, grade: { code: 'KUTSEHINDAMINE_5' } }
        ]
      }))
      const students = [{ id: 99, student: { id: 100 } }]
      const r = await feature.fetchDetailedOutcomeStudents(123, 5, students, { output: 'studentOutcomeResults' })
      expect(r).toEqual({ '99': [{ grade: { code: 'KUTSEHINDAMINE_5' } }] })
    })

    it('skips students without grade in output mapping', async () => {
      feature.api.tahvel.get = mock(async () => ({
        outcomeStudents: [
          { studentId: 100, grade: null }
        ]
      }))
      const students = [{ id: 99, student: { id: 100 } }]
      const r = await feature.fetchDetailedOutcomeStudents(123, 5, students, { output: 'studentOutcomeResults' })
      expect(r).toEqual({})
    })

    it('returns existingGradesMap when output is set accordingly', async () => {
      feature.api.tahvel.get = mock(async () => ({
        outcomeStudents: [
          { studentId: 200, grade: { code: 'KUTSEHINDAMINE_4' } }
        ]
      }))
      const r = await feature.fetchDetailedOutcomeStudents(123, 5, [], {
        output: 'existingGradesMap',
        ovNum: 1
      })
      expect(r['200|1']).toEqual({ studentId: 200, grade: { code: 'KUTSEHINDAMINE_4' } })
    })

    it('returns {} when API throws', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      const r = await feature.fetchDetailedOutcomeStudents(123, 5, [], { output: 'studentOutcomeResults' })
      expect(r).toEqual({})
    })
  })

  describe('syncOvGrades', () => {
    it('returns false when sync is already running', async () => {
      feature._oaSyncRunning = true
      const result = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput: [],
        container: null
      })
      expect(result).toBe(false)
    })

    it('flags allSuccess=false when ovNumToOutcomeId is missing', async () => {
      feature._oaSyncRunning = false
      feature.api.tahvel.get = mock(async () => ({}))
      const container = document.createElement('div')
      const result = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: null,
        filteredOutput: [],
        container
      })
      expect(result).toBe(false)
      expect(container.innerHTML).toContain('outcomeId vastendust')
    })

    it('returns true when there are no OV numbers to sync', async () => {
      feature._oaSyncRunning = false
      const result = await feature.syncOvGrades({
        results: { allOvNums: [] },
        ovNumToOutcomeId: {},
        filteredOutput: [],
        container: null
      })
      expect(result).toBe(true)
    })

    it('marks success false when latestOutcomeEntry fetch throws', async () => {
      feature._oaSyncRunning = false
      feature.api.tahvel.get = mock(async () => { throw new Error('network') })
      const container = document.createElement('div')
      const result = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput: [],
        container
      })
      expect(result).toBe(false)
      expect(container.innerHTML).toContain('outcome andmeid')
    })
  })

  describe('calculateFinalGrades', () => {
    it('returns an object with output for empty inputs', async () => {
      const result = await feature.calculateFinalGrades([], [])
      expect(result).toBeDefined()
      expect(result.output).toBeDefined()
    })

    it('handles SISSEKANNE_O entries with outcomes map', async () => {
      const entries = [
        {
          entryType: 'SISSEKANNE_O',
          curriculumModuleOutcomes: 100,
          nameEt: 'Test (ÕV1)',
          studentOutcomeResults: {
            '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }]
          }
        }
      ]
      const students = [{ id: 1, student: { id: 100, fullname: 'Test' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      expect(result).toBeDefined()
    })
  })

  describe('ensureLGradeDropdowns', () => {
    it('does nothing when no journal table exists', () => {
      expect(() => feature.ensureLGradeDropdowns()).not.toThrow()
    })

    it('does nothing when no Lõpptulemus header found', () => {
      const tbl = document.createElement('table')
      tbl.id = 'studentTable'
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = 'Other'
      tr.appendChild(th)
      thead.appendChild(tr)
      tbl.appendChild(thead)
      document.body.appendChild(tbl)
      expect(() => feature.ensureLGradeDropdowns()).not.toThrow()
    })

    it('processes Lõpptulemus column rows when present', () => {
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const tbl = document.createElement('table')
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = 'Lõpptulemus'
      headRow.appendChild(th)
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const bodyRow = document.createElement('tr')
      bodyRow.dataset.studentId = '1'
      const td = document.createElement('td')
      bodyRow.appendChild(td)
      tbody.appendChild(bodyRow)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      wrapper.appendChild(tbl)
      document.body.appendChild(wrapper)
      feature.ensureLGradeDropdowns()
      expect(td.querySelector('select.oa-lgrade-select')).toBeTruthy()
    })
  })

  describe('createLGradeDropdown', () => {
    it('skips when row has no student id', () => {
      const cell = document.createElement('td')
      const row = document.createElement('tr')
      feature.createLGradeDropdown(cell, row)
      expect(cell.querySelector('select')).toBeNull()
    })

    it('creates a select with grade options', () => {
      const cell = document.createElement('td')
      const row = document.createElement('tr')
      row.dataset.studentId = '99'
      feature.createLGradeDropdown(cell, row)
      const select = cell.querySelector('select')
      expect(select).toBeTruthy()
      expect(select.options.length).toBe(8)
    })

    it('preselects current grade text', () => {
      const cell = document.createElement('td')
      cell.textContent = '4'
      const row = document.createElement('tr')
      row.dataset.studentId = '99'
      feature.createLGradeDropdown(cell, row)
      const select = cell.querySelector('select')
      expect(select.value).toBe('4')
    })

    it('preselects A grade', () => {
      const cell = document.createElement('td')
      cell.textContent = 'A'
      const row = document.createElement('tr')
      row.dataset.studentId = '99'
      feature.createLGradeDropdown(cell, row)
      expect(cell.querySelector('select').value).toBe('A')
    })
  })

  describe('ensureGradingModeSelect', () => {
    it('does nothing harmful when button is null', () => {
      expect(() => feature.ensureGradingModeSelect(null, 'mitte')).not.toThrow()
    })

    it('creates select element next to button', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      feature.ensureGradingModeSelect(button, 'mitte')
      expect(document.getElementById('oa-grading-mode-select')).toBeTruthy()
    })

    it('reuses existing select if already in DOM', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      const first = feature.ensureGradingModeSelect(button, 'mitte')
      const second = feature.ensureGradingModeSelect(button, 'eristav')
      expect(first).toBe(second)
    })

    it('renders both grading mode options', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      feature.ensureGradingModeSelect(button, 'mitte')
      const select = document.getElementById('oa-grading-mode-select')
      const values = Array.from(select.options).map(o => o.value)
      expect(values).toContain('mitte')
      expect(values).toContain('eristav')
    })

    it('reflects the resolved mode in the select value', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      const sel = feature.ensureGradingModeSelect(button, 'eristav')
      expect(sel.value).toBe('eristav')
      feature.ensureGradingModeSelect(button, 'mitte')
      expect(sel.value).toBe('mitte')
    })

    it('attaches exactly one change handler even across many renders (no listener leak)', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      let handlerCalls = 0
      const original = feature.handleGradingModeChange.bind(feature)
      feature.handleGradingModeChange = () => {
        handlerCalls += 1
        return original()
      }
      const sel = feature.ensureGradingModeSelect(button, 'mitte')
      // Re-render the dropdown several times; this must not stack listeners.
      feature.ensureGradingModeSelect(button, 'mitte')
      feature.ensureGradingModeSelect(button, 'eristav')
      sel.dispatchEvent(new Event('change'))
      expect(handlerCalls).toBe(1)
    })
  })

  describe('handleLGradeChange', () => {
    it('clears background when newGrade is empty', async () => {
      const cell = document.createElement('td')
      cell.style.backgroundColor = 'red'
      await feature.handleLGradeChange('1', '', cell)
      expect(cell.style.backgroundColor).toBe('')
    })

    it('sets in-progress background and runs without throwing', async () => {
      const cell = document.createElement('td')
      await expect(feature.handleLGradeChange('1', '5', cell)).resolves.toBeUndefined()
    })
  })

  describe('attachDomObserver', () => {
    it('returns null when #studentTable is missing', () => {
      const button = document.createElement('button')
      const result = feature.attachDomObserver(button, [])
      expect(result).toBeNull()
    })

    it('attaches a MutationObserver when #studentTable is present', () => {
      const div = document.createElement('div')
      div.id = 'studentTable'
      document.body.appendChild(div)
      const button = document.createElement('button')
      const observer = feature.attachDomObserver(button, [])
      expect(observer).toBeTruthy()
      expect(typeof observer.disconnect).toBe('function')
      observer.disconnect()
    })
  })

  // ==================
  //  syncOvGrades full integration
  // ==================
  describe('syncOvGrades', () => {
    beforeEach(() => {
      window.location.hash = '#/journal/12345/edit'
    })

    it('successfully syncs grades and disables button on full success', async () => {
      // First call returns the latestOutcomeEntry; later calls for /students/X return status
      let postCalled = 0
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') {
          return { outcomeStudents: [] }
        }
        if (endpoint === '/students/55') return { status: 'OPPURSTAATUS_O' }
        return {}
      })
      feature.api.tahvel.post = mock(async () => { postCalled++; return {} })

      const button = document.createElement('button')
      button.textContent = 'Lisa õpiväljundite hinded'
      document.body.appendChild(button)
      const statusDiv = document.createElement('div')
      const filteredOutput = [
        { studentId: 55, ovGrades: { '1': '4' } }
      ]
      const success = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null,
        statusDiv,
        button
      })
      expect(success).toBe(true)
      expect(postCalled).toBe(1)
      expect(button.disabled).toBe(true)
      expect(button._oaFinalGradesDisabled).toBe(true)
      expect(statusDiv.textContent).toContain('OK')
    })

    it('skips OPPURSTAATUS_A students with disallowed grades', async () => {
      let postPayload = null
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        if (endpoint === '/students/55') return { status: 'OPPURSTAATUS_A' }
        return {}
      })
      feature.api.tahvel.post = mock(async (_url, payload) => { postPayload = payload; return {} })

      const filteredOutput = [
        { studentId: 55, ovGrades: { '1': 'MA' } }
      ]
      const success = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      expect(success).toBe(true)
      // Skipped student means no payload posted
      expect(postPayload).toBeNull()
    })

    it('treats numeric grades by rounding before mapping', async () => {
      let postPayload = null
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        if (endpoint === '/students/55') return { status: null }
        return {}
      })
      feature.api.tahvel.post = mock(async (_url, payload) => { postPayload = payload; return {} })

      const filteredOutput = [{ studentId: 55, ovGrades: { '1': '3.6' } }]
      const success = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      expect(success).toBe(true)
      // 3.6 rounds to 4
      expect(postPayload.outcomeStudents[0].grade.code).toBe('KUTSEHINDAMINE_4')
    })

    it('skips no-op updates when existing grade matches mapped grade', async () => {
      let postCalls = 0
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') {
          // Existing grade matches what we'd send
          return {
            outcomeStudents: [
              { studentId: 55, version: 1, id: 999, grade: { code: 'KUTSEHINDAMINE_4', value: '4' } }
            ]
          }
        }
        if (endpoint === '/students/55') return { status: null }
        return {}
      })
      feature.api.tahvel.post = mock(async () => { postCalls++; return {} })

      const filteredOutput = [{ studentId: 55, ovGrades: { '1': '4' } }]
      const success = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      expect(success).toBe(true)
      // Should be skipped, no post
      expect(postCalls).toBe(0)
    })

    it('updates existing grades preserving version and id when grade differs', async () => {
      let postPayload = null
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') {
          return {
            outcomeStudents: [
              { studentId: 55, version: 7, id: 1234, grade: { code: 'KUTSEHINDAMINE_3', value: '3' }, gradeInserted: 'old', gradeInsertedBy: 'oldBy' }
            ]
          }
        }
        if (endpoint === '/students/55') return { status: null }
        return {}
      })
      feature.api.tahvel.post = mock(async (_url, payload) => { postPayload = payload; return {} })

      const filteredOutput = [{ studentId: 55, ovGrades: { '1': '5' } }]
      await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      expect(postPayload.outcomeStudents[0].version).toBe(7)
      expect(postPayload.outcomeStudents[0].id).toBe(1234)
      expect(postPayload.outcomeStudents[0].grade.code).toBe('KUTSEHINDAMINE_5')
      expect(postPayload.outcomeStudents[0].gradeInserted).toBe('old')
    })

    it('marks success false when post throws and updates status', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        if (endpoint === '/students/55') return { status: null }
        return {}
      })
      feature.api.tahvel.post = mock(async () => { throw new Error('post failed') })

      const filteredOutput = [{ studentId: 55, ovGrades: { '1': '4' } }]
      const statusDiv = document.createElement('div')
      const success = await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null,
        statusDiv
      })
      expect(success).toBe(false)
      expect(statusDiv.textContent).toContain('VIGA')
    })

    it('handles student status fetch failures by including them anyway', async () => {
      let postCalls = 0
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        if (endpoint === '/students/55') throw new Error('500')
        return {}
      })
      feature.api.tahvel.post = mock(async () => { postCalls++; return {} })

      const filteredOutput = [{ studentId: 55, ovGrades: { '1': '4' } }]
      await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      // Failed status fetch is treated as null; student still included
      expect(postCalls).toBe(1)
    })

    it('updates Lõpptulemus button text on full success', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        if (endpoint === '/students/55') return { status: null }
        return {}
      })
      feature.api.tahvel.post = mock(async () => ({}))

      const button = document.createElement('button')
      button.textContent = 'Lisa lõpptulemuse hinded'
      const filteredOutput = [{ studentId: 55, ovGrades: { '1': '4' } }]
      await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null,
        button
      })
      expect(button.textContent).toContain('saadetud')
    })

    it('skips students with no grade for given ovNum', async () => {
      let postCalls = 0
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        return {}
      })
      feature.api.tahvel.post = mock(async () => { postCalls++; return {} })

      const filteredOutput = [{ studentId: 55, ovGrades: {} }]
      await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      // No grade => no post body
      expect(postCalls).toBe(0)
    })

    it('skips students with grades that fail mapGradeToSchema', async () => {
      let postCalls = 0
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345/journalOutcome/100') return { outcomeStudents: [] }
        if (endpoint === '/students/55') return { status: null }
        return {}
      })
      feature.api.tahvel.post = mock(async () => { postCalls++; return {} })

      const filteredOutput = [{ studentId: 55, ovGrades: { '1': 'X' } }] // Invalid grade
      await feature.syncOvGrades({
        results: { allOvNums: ['1'] },
        ovNumToOutcomeId: { '1': 100 },
        filteredOutput,
        container: null
      })
      expect(postCalls).toBe(0)
    })
  })

  describe('fetchDetailedOutcomeStudents — extra paths', () => {
    it('handles existing grade map when no ovNum provided', async () => {
      feature.api.tahvel.get = mock(async () => ({
        outcomeStudents: [
          { studentId: 200, grade: { code: 'KUTSEHINDAMINE_5' } }
        ]
      }))
      const r = await feature.fetchDetailedOutcomeStudents(123, 5, [], { output: 'existingGradesMap' })
      // Without ovNum it falls through to default else, returns {}
      expect(r).toEqual({})
    })

    it('returns existingGradesMap with multiple students, only those with grades', async () => {
      feature.api.tahvel.get = mock(async () => ({
        outcomeStudents: [
          { studentId: 1, grade: { code: 'KUTSEHINDAMINE_5' } },
          { studentId: 2, grade: null },
          { studentId: 3, grade: { code: 'KUTSEHINDAMINE_4' } }
        ]
      }))
      const r = await feature.fetchDetailedOutcomeStudents(1, 5, [], { output: 'existingGradesMap', ovNum: '2' })
      expect(Object.keys(r).length).toBe(2)
      expect(r['1|2']).toBeDefined()
      expect(r['3|2']).toBeDefined()
    })

    it('returns {} when output mode is missing', async () => {
      feature.api.tahvel.get = mock(async () => ({
        outcomeStudents: [{ studentId: 1, grade: { code: 'KUTSEHINDAMINE_5' } }]
      }))
      const r = await feature.fetchDetailedOutcomeStudents(1, 5, [], {})
      expect(r).toEqual({})
    })
  })

  describe('showResults — non-autoSync core flow', () => {
    function buildJournalTable() {
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const tbl = document.createElement('table')
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      const studentHead = document.createElement('th')
      studentHead.textContent = 'Õppija'
      const ovHead = document.createElement('th')
      ovHead.textContent = 'ÕV1'
      const finalHead = document.createElement('th')
      finalHead.textContent = 'Lõpptulemus'
      headRow.appendChild(studentHead)
      headRow.appendChild(ovHead)
      headRow.appendChild(finalHead)
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const row1 = document.createElement('tr')
      const studentCell = document.createElement('td')
      studentCell.textContent = 'Test Student'
      const ovCell = document.createElement('td')
      ovCell.textContent = '4'
      const finalCell = document.createElement('td')
      finalCell.textContent = '4'
      row1.appendChild(studentCell)
      row1.appendChild(ovCell)
      row1.appendChild(finalCell)
      tbody.appendChild(row1)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      wrapper.appendChild(tbl)
      document.body.appendChild(wrapper)
      return { wrapper, tbl, finalCell, ovCell }
    }

    it('disables the button when no changes detected (autoSync=false)', async () => {
      buildJournalTable()
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: 'KUTSEHINDAMISVIIS_E' }
        return {}
      })
      feature._lastEntries = []
      const button = document.createElement('button')
      button.textContent = 'Lisa õpiväljundite hinded'
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [
          { name: 'Test Student', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }
        ]
      }
      const filtered = await feature.showResults(results, button, { autoSync: false })
      expect(Array.isArray(filtered)).toBe(true)
    })

    it('renders error when ÕV columns exist but no tagged entries', async () => {
      window.location.hash = '#/journal/12345/edit'
      const button = document.createElement('button')
      document.body.appendChild(button)
      feature.api.tahvel.get = mock(async () => ({}))
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: false,
        output: []
      }
      await feature.showResults(results, button, { autoSync: false })
      const container = document.getElementById('oa-final-grades-results')
      expect(container).toBeTruthy()
      expect(container.innerHTML).toContain('õpiväljundit')
    })

    it('removes any old send button/status when no ÕV columns', async () => {
      // Pre-create elements that should be removed
      const oldBtn = document.createElement('button')
      oldBtn.id = 'oa-send-ov-grades-btn'
      const oldStatus = document.createElement('div')
      oldStatus.id = 'oa-send-ov-status'
      document.body.appendChild(oldBtn)
      document.body.appendChild(oldStatus)

      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: [],
        ovNumToOutcomeId: {},
        hasOvTaggedEntries: false,
        output: []
      }
      await feature.showResults(results, button, { autoSync: false })
      expect(document.getElementById('oa-send-ov-grades-btn')).toBeNull()
      expect(document.getElementById('oa-send-ov-status')).toBeNull()
    })
  })

  describe('calculateFinalGrades — comprehensive', () => {
    beforeEach(() => {
      window.location.hash = '#/journal/12345/edit'
    })

    it('handles SISSEKANNE_O entries with curriculumModuleOutcomes outcomeOrderNr', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 100, nameEt: 'Outcome 1', studentOutcomeResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_4' } }] } }
      ]
      const students = [{ id: 1, student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      expect(result.allOvNums).toContain('1')
      expect(result.ovNumToOutcomeId['1']).toBe(100)
    })

    it('detects SISSEKANNE_L final grades', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_L', journalEntryStudents: [{ journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_5' } }] }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      const studentOutput = result.output.find(o => o.journalStudentId === '1')
      expect(studentOutput.finalGrade).toBe('5')
    })

    it('handles ÕV with all expected assignments present, computes average', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 100, nameEt: 'Outcome 1' },
        { entryType: 'SISSEKANNE_H', nameEt: 'Töö (ÕV1)', journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_4' } }] } }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      const so = result.output.find(o => o.journalStudentId === '1')
      expect(so.ovGrades['1']).toBeDefined()
    })

    it('marks ÕV grade with _hasLow when individual grade is low', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 100, nameEt: 'Outcome 1' },
        { entryType: 'SISSEKANNE_H', nameEt: 'Töö (ÕV1)', journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_2' } }] } }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      const so = result.output.find(o => o.journalStudentId === '1')
      expect(String(so.ovGrades['1'])).toContain('hasLow')
    })

    it('forces 2.00_hasLow when not all expected assignments are present', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 100, nameEt: 'Outcome 1' },
        // Two tagged assignments but student only graded for one
        { entryType: 'SISSEKANNE_H', nameEt: 'Töö1 (ÕV1)', journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_5' } }] } },
        { entryType: 'SISSEKANNE_H', nameEt: 'Töö2 (ÕV1)', journalStudentResults: {} }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      const so = result.output.find(o => o.journalStudentId === '1')
      // expected count = 2, presentCount = 1 -> 2.00_hasLow
      expect(String(so.ovGrades['1'])).toBe('2.00_hasLow')
    })

    it('extracts SISSEKANNE_O grades when studentOutcomeResults present', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 100, nameEt: 'Outcome 1', studentOutcomeResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_4' } }] } }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      expect(result.output.length).toBe(1)
    })

    it('falls back to fetchDetailedOutcomeStudents when SISSEKANNE_O has no studentOutcomeResults', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint.includes('/journalOutcome/')) {
          return { outcomeStudents: [{ studentId: 100, grade: { code: 'KUTSEHINDAMINE_5' } }] }
        }
        return {}
      })
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, curriculumModuleOutcomes: 100, nameEt: 'Outcome 1' }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      expect(result.output.length).toBe(1)
    })

    it('handles non-array results in journalStudentResults', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', journalStudentResults: { '1': 'not-an-array' } }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      expect(result.output.length).toBe(1)
    })

    it('handles MA grade in unfiltered text', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', nameEt: 'Töö (ÕV1)', journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_MA' } }] }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      // MA token should appear somewhere
      expect(result.output.length).toBe(1)
    })

    it('handles A grade in unfiltered text', async () => {
      const entries = [
        { entryType: 'SISSEKANNE_T', nameEt: 'Töö (ÕV1)', journalEntryStudents: [{ journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_A' } }] }
      ]
      const students = [{ id: '1', student: { id: 100, fullname: 'Test', idcode: '123' } }]
      const result = await feature.calculateFinalGrades(entries, students)
      expect(result.output.length).toBe(1)
    })
  })

  describe('showLGradeResults — non-autoSync paths', () => {
    beforeEach(() => {
      window.location.hash = '#/journal/12345/edit'
    })

    it('returns "Lõpptulemus puudub" when no SISSEKANNE_L entry exists', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: '' }
        return {}
      })
      const button = document.createElement('button')
      button.textContent = 'Lisa lõpptulemuse hinded'
      document.body.appendChild(button)
      const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '4' }] }
      const lastEntries = [] // No SISSEKANNE_L
      await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })
      const statusDiv = document.getElementById('oa-sync-lopp-status')
      expect(statusDiv?.textContent).toContain('Lõpptulemus puudub')
    })

    it('disables button when no L changes detected (autoSync=false)', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: '' }
        return {}
      })
      const button = document.createElement('button')
      button.textContent = 'Lisa lõpptulemuse hinded'
      document.body.appendChild(button)
      const lastEntries = [
        {
          id: 99,
          entryType: 'SISSEKANNE_L',
          journalEntryStudents: [
            { journalStudent: '5', grade: { code: 'KUTSEHINDAMINE_4' } }
          ]
        }
      ]
      const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '4' }] }
      const filtered = await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })
      expect(button.disabled).toBe(true)
      expect(button._oaFinalGradesDisabled).toBe(true)
      expect(Array.isArray(filtered)).toBe(true)
      expect(filtered.length).toBe(0)
    })

    it('enables button when L changes detected (autoSync=false)', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: '' }
        return {}
      })
      const button = document.createElement('button')
      button.textContent = 'Lisa lõpptulemuse hinded'
      button.disabled = true
      button._oaFinalGradesDisabled = true
      document.body.appendChild(button)
      const lastEntries = [
        {
          id: 99,
          entryType: 'SISSEKANNE_L',
          journalEntryStudents: [
            { journalStudent: '5', grade: { code: 'KUTSEHINDAMINE_3' } }
          ]
        }
      ]
      const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '5' }] }
      const filtered = await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })
      expect(button.disabled).toBe(false)
      expect(filtered.length).toBe(1)
    })

    it('treats unset L grade as a change when finalGrade is set', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: '' }
        return {}
      })
      const button = document.createElement('button')
      button.textContent = 'Lisa lõpptulemuse hinded'
      document.body.appendChild(button)
      const lastEntries = [
        {
          id: 99,
          entryType: 'SISSEKANNE_L',
          journalEntryStudents: [] // No grades yet
        }
      ]
      const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '4' }] }
      const filtered = await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })
      expect(filtered.length).toBe(1)
    })

    it('uses journalStudentResults fallback when L entry lacks journalEntryStudents', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: 'KUTSEHINDAMISVIIS_E' }
        return {}
      })
      const button = document.createElement('button')
      document.body.appendChild(button)
      const lastEntries = [
        { id: 99, entryType: 'SISSEKANNE_L', journalStudentResults: {} }
      ]
      const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '4' }] }

      const filtered = await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })

      expect(document.getElementById('oa-grading-mode-select')).toBeTruthy()
      expect(filtered.length).toBe(1)
    })

    it('skips students with finalGrade null', async () => {
      feature.api.tahvel.get = mock(async (endpoint) => {
        if (endpoint === '/journals/12345') return { assessment: '' }
        return {}
      })
      const button = document.createElement('button')
      document.body.appendChild(button)
      const lastEntries = [
        { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
      ]
      const results = {
        output: [
          { studentId: 55, journalStudentId: '5', finalGrade: null },
          { studentId: 56, journalStudentId: '6', finalGrade: '3' }
        ]
      }
      const filtered = await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })
      expect(filtered.length).toBe(1)
      expect(filtered[0].journalStudentId).toBe('6')
    })
  })

  describe('hasAnyOvGrades — additional', () => {
    it('returns true when O entry has outcomeStudents (no studentOutcomeResults)', () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', outcomeStudents: [{ studentId: 1, grade: 5 }] }
      ]
      expect(feature.hasAnyOvGrades(entries)).toBe(true)
    })

    it('returns false when O entry has empty studentOutcomeResults', () => {
      const entries = [
        { entryType: 'SISSEKANNE_O', studentOutcomeResults: {} }
      ]
      expect(feature.hasAnyOvGrades(entries)).toBe(false)
    })
  })

  describe('handleLGradeChange — extra paths', () => {
    it('schedules transitional background after a delay', async () => {
      const cell = document.createElement('td')
      // The function uses setTimeout internally but tests don't need to wait
      await feature.handleLGradeChange('1', '5', cell)
      // Right after returns, background is set to in-progress yellow
      expect(cell.style.backgroundColor).toBe('rgb(255, 243, 205)')
    })
  })

  describe('createLGradeDropdown — extra cases', () => {
    it('handles cells with non-grade text without preselecting any value', () => {
      const cell = document.createElement('td')
      cell.textContent = 'foo'
      const row = document.createElement('tr')
      row.dataset.studentId = '99'
      feature.createLGradeDropdown(cell, row)
      const select = cell.querySelector('select')
      // Default value remains empty string
      expect(select.value).toBe('')
    })

    it('preselects MA grade text', () => {
      const cell = document.createElement('td')
      cell.textContent = 'MA'
      const row = document.createElement('tr')
      row.dataset.studentId = '99'
      feature.createLGradeDropdown(cell, row)
      expect(cell.querySelector('select').value).toBe('MA')
    })

    it('reads student id from data-journal-student attribute', () => {
      const cell = document.createElement('td')
      const row = document.createElement('tr')
      row.setAttribute('data-journal-student', '88')
      feature.createLGradeDropdown(cell, row)
      const select = cell.querySelector('select')
      expect(select).toBeTruthy()
    })
  })

  describe('ensureGradingModeSelect — placement', () => {
    it('moves existing select next to the button (e.g. from the ÕV button to the L button)', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      const sel = document.createElement('select')
      sel.id = 'oa-grading-mode-select'
      // Place it elsewhere
      const elsewhere = document.createElement('div')
      elsewhere.appendChild(sel)
      document.body.appendChild(elsewhere)
      feature.ensureGradingModeSelect(button, 'mitte')
      // Should now be moved next to the button
      expect(document.getElementById('oa-grading-mode-select').parentElement).toBe(button.parentElement)
    })

    it('falls back to body when button has no parent', () => {
      const button = document.createElement('button')
      // No parent
      feature.ensureGradingModeSelect(button, 'mitte')
      expect(document.getElementById('oa-grading-mode-select')).toBeTruthy()
    })
  })

  describe('extractFinalGrades — string grades from journalEntryStudents (lines 952-1985)', () => {
    it('combines string and numeric grades from journalEntryStudents', () => {
      const students = [{ id: 1, fullname: 'A', idcode: '111' }]
      const entries = [
        { entryType: 'SISSEKANNE_T', journalEntryStudents: [
          { journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_4' } },
          { journalStudent: 1, grade: { code: 'KUTSEHINDAMINE_A' } }
        ] }
      ]
      const r = feature.extractFinalGrades(entries, students)
      // String grade A combined with numeric 4: any A means we look at allStringGrades
      expect(r.output[0].finalGrade).toBeDefined()
    })
  })

  describe('showResults', () => {
    function buildJournalTableWithStudent(opts = {}) {
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const tbl = document.createElement('table')
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      const cells = ['Õppija', 'ÕV1', 'Lõpptulemus']
      for (const text of cells) {
        const th = document.createElement('th')
        th.textContent = text
        headRow.appendChild(th)
      }
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const row = document.createElement('tr')
      const studentCell = document.createElement('td')
      studentCell.textContent = opts.studentName || 'Test Student'
      const ovCell = document.createElement('td')
      ovCell.textContent = opts.ovText || ''
      const finalCell = document.createElement('td')
      finalCell.textContent = opts.finalText || ''
      row.appendChild(studentCell)
      row.appendChild(ovCell)
      row.appendChild(finalCell)
      tbody.appendChild(row)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      wrapper.appendChild(tbl)
      document.body.appendChild(wrapper)
      return { wrapper, tbl, ovCell, finalCell, row }
    }

    it('marks mismatch on final cell with empty current vs calculated', async () => {
      const { finalCell } = buildJournalTableWithStudent({ studentName: 'John Doe', finalText: '' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'John Doe', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      expect(finalCell.title).toContain('Praegune hinne erineb')
    })

    it('clears mismatch when calculated equals current', async () => {
      const { finalCell } = buildJournalTableWithStudent({ studentName: 'John Doe', finalText: '4', ovText: '4' })
      // JSDOM's innerText behavior may differ; ensure innerText property is set explicitly
      Object.defineProperty(finalCell, 'innerText', { value: '4', configurable: true })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'John Doe', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      // 4 vs 4 should not have a tooltip
      expect(finalCell.title || '').toBe('')
    })

    it('skips students that match AP (academic leave) row', async () => {
      // Build row with AP marker
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const tbl = document.createElement('table')
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      for (const text of ['Õppija', 'ÕV1', 'Lõpptulemus']) {
        const th = document.createElement('th')
        th.textContent = text
        headRow.appendChild(th)
      }
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const row = document.createElement('tr')
      const c1 = document.createElement('td')
      c1.textContent = 'AP Student'
      const apSpan = document.createElement('span')
      apSpan.textContent = 'AP'
      c1.appendChild(apSpan)
      const c2 = document.createElement('td')
      const c3 = document.createElement('td')
      row.appendChild(c1); row.appendChild(c2); row.appendChild(c3)
      tbody.appendChild(row)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      wrapper.appendChild(tbl)
      document.body.appendChild(wrapper)

      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'AP Student', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      // Row should not have a tooltip set (AP rows are skipped)
      expect(c2.title || '').toBe('')
      expect(c3.title || '').toBe('')
    })

    it('uses MA token comparison when MA is in calculated', async () => {
      const { finalCell } = buildJournalTableWithStudent({ studentName: 'Jane', finalText: '', ovText: '4' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_M' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Jane', idcode: '123', studentId: 55, ovGrades: { '1': 'MA' }, finalGrade: 'MA', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      // MA was calculated but cell empty -> mismatch
      expect(finalCell.title || '').toContain('erineb')
    })

    it('reads existing grades map from SISSEKANNE_O studentOutcomeResults via _lastEntries', async () => {
      const { finalCell } = buildJournalTableWithStudent({ studentName: 'Mary' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = [
        {
          entryType: 'SISSEKANNE_O',
          nameEt: '1) Outcome',
          studentOutcomeResults: {
            '55': { grade: { code: 'KUTSEHINDAMINE_4' } }
          }
        }
      ]
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Mary', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      const r = await feature.showResults(results, button, { autoSync: false })
      expect(Array.isArray(r)).toBe(true)
    })

    it('creates grading mode select when none exists', async () => {
      buildJournalTableWithStudent({ studentName: 'Test' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      expect(document.getElementById('oa-grading-mode-select')).toBeTruthy()
    })

    it('reuses existing grading mode select on subsequent showResults call', async () => {
      buildJournalTableWithStudent({ studentName: 'Test' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      // Pre-create select
      const sel = document.createElement('select')
      sel.id = 'oa-grading-mode-select'
      const optM = document.createElement('option')
      optM.value = 'mitte'
      optM.textContent = 'M'
      sel.appendChild(optM)
      const optE = document.createElement('option')
      optE.value = 'eristav'
      optE.textContent = 'E'
      sel.appendChild(optE)
      document.body.appendChild(sel)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      // Same select should still be there
      expect(document.getElementById('oa-grading-mode-select')).toBe(sel)
    })

    it('selects mitteeristav from recorded A/MA outcome grades even when the journal is declared eristav', async () => {
      buildJournalTableWithStudent({ studentName: 'Test' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      // Recorded ÕV outcome grade is A (mitteeristav) — this is the cross-session memory.
      feature._lastEntries = [
        { entryType: 'SISSEKANNE_O', nameEt: '1) Outcome', studentOutcomeResults: { 55: { grade: { code: 'KUTSEHINDAMINE_A' } } } }
      ]
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        // Computed (exercise) grade is numeric, but it must NOT decide the scale.
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      const select = document.getElementById('oa-grading-mode-select')
      expect(select.value).toBe('mitte')
    })

    it('selects mitteeristav from dotted recorded A/MA outcome names', async () => {
      buildJournalTableWithStudent({ studentName: 'Test' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = [
        { entryType: 'SISSEKANNE_O', nameEt: '04. loob lihtsamaid rakendusi', studentOutcomeResults: { 55: { grade: { code: 'KUTSEHINDAMINE_A' } } } }
      ]
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['4'],
        ovNumToOutcomeId: { '4': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '4': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      const select = document.getElementById('oa-grading-mode-select')
      expect(select.value).toBe('mitte')
    })

    it('selects eristav from recorded numeric outcome grades', async () => {
      buildJournalTableWithStudent({ studentName: 'Test' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({})) // no assessment
      feature._lastEntries = [
        { entryType: 'SISSEKANNE_O', nameEt: '1) Outcome', studentOutcomeResults: { 55: { grade: { code: 'KUTSEHINDAMINE_4' } } } }
      ]
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      const select = document.getElementById('oa-grading-mode-select')
      expect(select.value).toBe('eristav')
    })

    it('falls back to the journal declared type when no end grades are recorded yet', async () => {
      buildJournalTableWithStudent({ studentName: 'Test' })
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = [] // nothing recorded
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      const select = document.getElementById('oa-grading-mode-select')
      expect(select.value).toBe('eristav')
    })
  })

  describe('_highlightIncorrectCurrentGrades — direct method call', () => {
    function buildJournalTableForHighlight(opts = {}) {
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const tbl = document.createElement('table')
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      for (const text of ['Õppija', 'Lõpptulemus']) {
        const th = document.createElement('th')
        th.textContent = text
        headRow.appendChild(th)
      }
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const row = document.createElement('tr')
      const studentCell = document.createElement('td')
      studentCell.textContent = opts.studentName || 'Test'
      const finalCell = document.createElement('td')
      finalCell.textContent = opts.finalText || ''
      row.appendChild(studentCell)
      row.appendChild(finalCell)
      tbody.appendChild(row)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      wrapper.appendChild(tbl)
      document.body.appendChild(wrapper)
      return { finalCell, row }
    }

    it('does nothing on empty results.output', () => {
      buildJournalTableForHighlight()
      expect(() => feature._highlightIncorrectCurrentGrades({ output: [] })).not.toThrow()
      expect(() => feature._highlightIncorrectCurrentGrades({})).not.toThrow()
      expect(() => feature._highlightIncorrectCurrentGrades(null)).not.toThrow()
    })

    it('marks mismatch when cell empty and calculated value present', () => {
      const { finalCell } = buildJournalTableForHighlight({ studentName: 'X Y', finalText: '' })
      feature._lastEntries = []
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'X Y', journalStudentId: 1, finalGrade: '5' }]
      })
      expect(finalCell.title).toContain('erineb')
    })

    it('clears tooltip when both cell and calc are empty', () => {
      const { finalCell } = buildJournalTableForHighlight({ studentName: 'X Y', finalText: '' })
      finalCell.title = 'old tooltip'
      feature._lastEntries = []
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'X Y', journalStudentId: 1, finalGrade: '' }]
      })
      expect(finalCell.title).toBe('')
    })

    it('skips students with finalGrade null', () => {
      const { finalCell } = buildJournalTableForHighlight({ studentName: 'Skipped', finalText: '' })
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'Skipped', journalStudentId: 1, finalGrade: null }]
      })
      // Cell should be untouched
      expect(finalCell.title || '').toBe('')
    })

    it('returns early when journal table not found', () => {
      // No table in DOM
      expect(() => feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'A', journalStudentId: 1, finalGrade: '5' }]
      })).not.toThrow()
    })

    it('matches student by idcode in row text', () => {
      const { finalCell } = buildJournalTableForHighlight({ studentName: '50001010001', finalText: '' })
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'Different Name', idcode: '50001010001', journalStudentId: 1, finalGrade: '5' }]
      })
      expect(finalCell.title).toContain('erineb')
    })

    it('matches student via row data-student-id attribute', () => {
      const { row, finalCell } = buildJournalTableForHighlight({ studentName: 'Other', finalText: '' })
      row.setAttribute('data-student-id', '99')
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'Anonymous', journalStudentId: 99, finalGrade: '5' }]
      })
      expect(finalCell.title).toContain('erineb')
    })

    it('compares MA cell text correctly', () => {
      const { finalCell } = buildJournalTableForHighlight({ studentName: 'Z', finalText: 'MA' })
      // Set innerText explicitly because JSDOM's behavior on td elements may differ
      Object.defineProperty(finalCell, 'innerText', { value: 'MA', configurable: true })
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'Z', journalStudentId: 1, finalGrade: 'MA' }]
      })
      // Both MA → no tooltip
      expect(finalCell.title || '').toBe('')
    })

    it('compares numeric cell vs MA calculation as mismatch', () => {
      const { finalCell } = buildJournalTableForHighlight({ studentName: 'Z', finalText: '4' })
      Object.defineProperty(finalCell, 'innerText', { value: '4', configurable: true })
      feature._highlightIncorrectCurrentGrades({
        output: [{ name: 'Z', journalStudentId: 1, finalGrade: 'MA' }]
      })
      expect(finalCell.title).toContain('erineb')
    })
  })

  describe('attachDomObserver — initialEntries snapshot', () => {
    it('initializes lastSnapshot from initialEntries', () => {
      const div = document.createElement('div')
      div.id = 'studentTable'
      document.body.appendChild(div)
      const button = document.createElement('button')
      const observer = feature.attachDomObserver(button, [{ id: 1, name: 'snapshot' }])
      expect(observer).toBeTruthy()
      observer.disconnect()
    })
  })

  describe('showLGradeResults — autoSync flow with PUT', () => {
    beforeEach(() => {
      window.location.hash = '#/journal/12345/edit'
    })

    it('PUTs new L grades when there are changes (autoSync=true)', async () => {
      let putPayload = null
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        feature.api.tahvel.get = mock(async (endpoint) => {
          // Numeric final grades belong to an eristav-declared journal; with nothing
          // recorded yet, the scale falls back to that declared type.
          if (endpoint === '/journals/12345') return { assessment: 'KUTSEHINDAMISVIIS_E' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async (_url, payload) => { putPayload = payload; return {} })
        const button = document.createElement('button')
        button.textContent = 'Lisa lõpptulemuse hinded'
        document.body.appendChild(button)
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
        ]
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '5' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        expect(putPayload).toBeTruthy()
        expect(putPayload.journalEntryStudents).toBeDefined()
        expect(putPayload.journalEntryStudents.length).toBe(1)
        expect(putPayload.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_5')
      } finally {
        global.window = realWindow
      }
    })

    it('skips OPPURSTAATUS_A students with disallowed grades on autoSync', async () => {
      // Replace the global window with a stub that has a no-op reload
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putPayload = null
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: '' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [] }
          }
          if (endpoint === '/students/55') return { status: 'OPPURSTAATUS_A' }
          return {}
        })
        feature.api.tahvel.put = mock(async (_url, payload) => { putPayload = payload; return {} })
        const button = document.createElement('button')
        button.textContent = 'Lisa lõpptulemuse hinded'
        document.body.appendChild(button)
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
        ]
        // Student is academic leave, grade MA disallowed
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: 'MA' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        // PUT should still occur but with empty journalEntryStudents
        expect(putPayload?.journalEntryStudents.length).toBe(0)
      } finally {
        global.window = realWindow
      }
    })

    it('handles MA grade in autoSync', async () => {
      // Replace the global window with a stub that has a no-op reload
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putPayload = null
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: '' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async (_url, payload) => { putPayload = payload; return {} })
        const button = document.createElement('button')
        document.body.appendChild(button)
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
        ]
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: 'MA' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        expect(putPayload.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_MA')
      } finally {
        global.window = realWindow
      }
    })

    it('handles A grade in autoSync', async () => {
      // Replace the global window with a stub that has a no-op reload
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putPayload = null
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: '' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async (_url, payload) => { putPayload = payload; return {} })
        const button = document.createElement('button')
        document.body.appendChild(button)
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
        ]
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: 'A' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        expect(putPayload.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_A')
      } finally {
        global.window = realWindow
      }
    })

    it('skips invalid finalGrade values', async () => {
      // Replace the global window with a stub that has a no-op reload
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putPayload = null
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: '' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async (_url, payload) => { putPayload = payload; return {} })
        const button = document.createElement('button')
        document.body.appendChild(button)
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
        ]
        // Invalid grade - 'X' doesn't match anything
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: 'X' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        expect(putPayload?.journalEntryStudents.length).toBe(0)
      } finally {
        global.window = realWindow
      }
    })

    it('updates existing journalEntryStudent when present (preserves id)', async () => {
      // Replace the global window with a stub that has a no-op reload
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putPayload = null
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: '' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [
              { id: 555, journalStudent: '5', grade: { code: 'KUTSEHINDAMINE_3' } }
            ] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async (_url, payload) => { putPayload = payload; return {} })
        const button = document.createElement('button')
        document.body.appendChild(button)
        // Use lastEntries WITHOUT journalEntryStudents to force fetch
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L' }
        ]
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '5' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        expect(putPayload.journalEntryStudents[0].id).toBe(555)
        expect(putPayload.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_5')
      } finally {
        global.window = realWindow
      }
    })

    it('does not flag recorded A grades as wrong in an eristav-declared journal', async () => {
      // Regression: journal declared eristav but the teacher recorded a pass/fail A grade.
      // The recorded A must drive mitteeristav so the computed grade matches and nothing
      // is flagged/overwritten on a later visit.
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putCalled = false
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: 'KUTSEHINDAMISVIIS_E' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [{ id: 7, journalStudent: '5', grade: { code: 'KUTSEHINDAMINE_A' } }] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async () => { putCalled = true; return {} })
        const button = document.createElement('button')
        document.body.appendChild(button)
        const lastEntries = [{ id: 99, entryType: 'SISSEKANNE_L' }]
        // Computed final from exercises is numeric 5, but recorded A drives mitteeristav.
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '5' }] }
        const filtered = await feature.showLGradeResults(results, button, lastEntries, { autoSync: false })
        // Recorded A === computed-converted A -> nothing to change, scale shows mitteeristav.
        expect(filtered).toEqual([])
        expect(document.getElementById('oa-grading-mode-select').value).toBe('mitte')
        expect(putCalled).toBe(false)
      } finally {
        global.window = realWindow
      }
    })

    it('fails closed (no sync, no scale guess) when the L entry cannot be read', async () => {
      // Regression: a null/malformed journalEntry response must not silently fall back to the
      // journal's declared scale and overwrite correct grades. journalEntryStudents === [] is a
      // different, readable case (handled normally); this covers a genuinely unreadable entry.
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        let putCalled = false
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: 'KUTSEHINDAMISVIIS_E' }
          if (endpoint === '/journals/12345/journalEntry/99') return null // unreadable response
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async () => { putCalled = true; return {} })
        const button = document.createElement('button')
        document.body.appendChild(button)
        // lastEntries lacks journalEntryStudents -> forces the fresh fetch, which returns null.
        const lastEntries = [{ id: 99, entryType: 'SISSEKANNE_L' }]
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '5' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        expect(putCalled).toBe(false)
        expect(button.disabled).toBe(true)
        const statusDiv = document.getElementById('oa-sync-lopp-status')
        expect(statusDiv.textContent).toContain('Ei õnnestunud')
      } finally {
        global.window = realWindow
      }
    })

    it('writes "Viga saatmisel." to status when PUT fails', async () => {
      // Replace the global window with a stub that has a no-op reload
      const realWindow = global.window
      global.window = { location: { hash: '#/journal/12345/edit', href: 'https://tahvel.edu.ee/#/journal/12345/edit', reload: () => {} } }
      try {
        feature.api.tahvel.get = mock(async (endpoint) => {
          if (endpoint === '/journals/12345') return { assessment: '' }
          if (endpoint === '/journals/12345/journalEntry/99') {
            return { id: 99, journalEntryStudents: [] }
          }
          if (endpoint === '/students/55') return { status: null }
          return {}
        })
        feature.api.tahvel.put = mock(async () => { throw new Error('PUT fail') })
        const button = document.createElement('button')
        document.body.appendChild(button)
        const lastEntries = [
          { id: 99, entryType: 'SISSEKANNE_L', journalEntryStudents: [] }
        ]
        const results = { output: [{ studentId: 55, journalStudentId: '5', finalGrade: '5' }] }
        await feature.showLGradeResults(results, button, lastEntries, { autoSync: true })
        const statusDiv = document.getElementById('oa-sync-lopp-status')
        expect(statusDiv.textContent).toContain('Viga saatmisel')
      } finally {
        global.window = realWindow
      }
    })
  })

  describe('showResults — grading mode change event flow', () => {
    function buildBasicJournalTable() {
      const wrapper = document.createElement('div')
      wrapper.id = 'studentTable'
      const tbl = document.createElement('table')
      tbl.className = 'tahvel-table'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      for (const text of ['Õppija', 'ÕV1', 'Lõpptulemus']) {
        const th = document.createElement('th')
        th.textContent = text
        headRow.appendChild(th)
      }
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      wrapper.appendChild(tbl)
      document.body.appendChild(wrapper)
    }

    it('records the in-session pick on change and does not snap back on re-render', async () => {
      buildBasicJournalTable()
      window.location.hash = '#/journal/12345/edit'
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const results = {
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      }
      await feature.showResults(results, button, { autoSync: false })
      const sel = document.getElementById('oa-grading-mode-select')
      expect(sel).toBeTruthy()
      // No recorded grades + journal eristav -> default eristav.
      expect(sel.value).toBe('eristav')
      // Teacher overrides to mitteeristav.
      sel.value = 'mitte'
      sel.dispatchEvent(new Event('change'))
      // Pick is recorded in memory, keyed by journalId (no DOM dataset flag, no storage).
      expect(feature.gradingModeUserPickByJournal['12345']).toBe('mitte')
      // A re-render must keep the teacher's pick — it must not snap back to the journal default.
      await feature.showResults(results, button, { autoSync: false })
      expect(document.getElementById('oa-grading-mode-select').value).toBe('mitte')
    })

    it('keeps the in-session pick isolated per journal', async () => {
      buildBasicJournalTable()
      feature.api.tahvel.get = mock(async () => ({ assessment: 'KUTSEHINDAMISVIIS_E' }))
      feature._lastEntries = []
      const button = document.createElement('button')
      document.body.appendChild(button)
      const makeResults = () => ({
        allOvNums: ['1'],
        ovNumToOutcomeId: { '1': 100 },
        hasOvTaggedEntries: true,
        output: [{ name: 'Test', idcode: '123', studentId: 55, ovGrades: { '1': '4' }, finalGrade: '4', journalStudentId: '5' }]
      })
      // Pick mitteeristav on journal A.
      window.location.hash = '#/journal/111/edit'
      await feature.showResults(makeResults(), button, { autoSync: false })
      const selA = document.getElementById('oa-grading-mode-select')
      selA.value = 'mitte'
      selA.dispatchEvent(new Event('change'))
      expect(feature.gradingModeUserPickByJournal['111']).toBe('mitte')
      // Journal B (different id) is unaffected — resolves from its own context (eristav).
      window.location.hash = '#/journal/222/edit'
      await feature.showResults(makeResults(), button, { autoSync: false })
      expect(document.getElementById('oa-grading-mode-select').value).toBe('eristav')
      expect(feature.gradingModeUserPickByJournal['222']).toBeUndefined()
    })
  })

  describe('aggregating SISSEKANNE_T/I gradesT_str and gradesI_str', () => {
    it('captures string grades A and MA in T-only entries', () => {
      const students = [{ id: 1, fullname: 'A', idcode: '111' }]
      // Two entries, one A, one MA -> string grades stored
      const entries = [
        { entryType: 'SISSEKANNE_T', journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_A' } }] } },
        { entryType: 'SISSEKANNE_I', journalStudentResults: { '1': [{ grade: { code: 'KUTSEHINDAMINE_MA' } }] } }
      ]
      const r = feature.extractFinalGrades(entries, students)
      expect(r.output[0].finalGrade).toBe('MA')
    })
  })
})
