import { describe, test, expect } from 'bun:test'
import {
  normalizeGradeCode,
  classifyScaleFromTokens,
  getRecordedOutcomeGradeTokens,
  getRecordedFinalGradeTokens,
  resolveGradingMode,
  applyGradingMode,
  JOURNAL_ASSESSMENT_MITTE,
  JOURNAL_ASSESSMENT_ERISTAV
} from '../../../../src/features/singleJournal/addFinalGrades/GradingMode.js'

describe('gradingMode', () => {
  describe('normalizeGradeCode', () => {
    test('strips KUTSEHINDAMINE_ prefix for A and MA', () => {
      expect(normalizeGradeCode('KUTSEHINDAMINE_A')).toBe('A')
      expect(normalizeGradeCode('KUTSEHINDAMINE_MA')).toBe('MA')
    })

    test('strips prefix for numeric 1-5', () => {
      expect(normalizeGradeCode('KUTSEHINDAMINE_3')).toBe('3')
      expect(normalizeGradeCode('KUTSEHINDAMINE_5')).toBe('5')
    })

    test('accepts bare tokens case-insensitively', () => {
      expect(normalizeGradeCode('a')).toBe('A')
      expect(normalizeGradeCode('ma')).toBe('MA')
    })

    test('returns empty string for unrecognized or missing codes', () => {
      expect(normalizeGradeCode('')).toBe('')
      expect(normalizeGradeCode(null)).toBe('')
      expect(normalizeGradeCode('KUTSEHINDAMINE_X')).toBe('')
      expect(normalizeGradeCode('KUTSEHINDAMINE_6')).toBe('')
    })
  })

  describe('classifyScaleFromTokens', () => {
    test('any A token classifies as mitteeristav', () => {
      expect(classifyScaleFromTokens(['A', 'A'])).toBe('mitte')
    })

    test('any MA token classifies as mitteeristav', () => {
      expect(classifyScaleFromTokens(['MA'])).toBe('mitte')
    })

    test('a single A among numerics still forces mitteeristav', () => {
      expect(classifyScaleFromTokens(['5', '4', 'A', '3'])).toBe('mitte')
    })

    test('only numeric tokens classify as eristav', () => {
      expect(classifyScaleFromTokens(['3', '4', '5'])).toBe('eristav')
    })

    test('a lone 1 classifies as eristav (numeric, not mitte)', () => {
      expect(classifyScaleFromTokens(['1'])).toBe('eristav')
    })

    test('returns empty string for no tokens or non-arrays', () => {
      expect(classifyScaleFromTokens([])).toBe('')
      expect(classifyScaleFromTokens(['', null])).toBe('')
      expect(classifyScaleFromTokens(undefined)).toBe('')
    })
  })

  describe('getRecordedOutcomeGradeTokens', () => {
    test('extracts normalized tokens from existingGradesMap values', () => {
      const map = {
        '100|1': { grade: { code: 'KUTSEHINDAMINE_A' } },
        '101|1': { grade: { code: 'KUTSEHINDAMINE_MA' } },
        '102|1': { grade: { code: 'KUTSEHINDAMINE_4' } }
      }
      expect(getRecordedOutcomeGradeTokens(map).sort()).toEqual(['4', 'A', 'MA'])
    })

    test('skips entries without a usable grade code', () => {
      const map = {
        a: { grade: { code: 'KUTSEHINDAMINE_A' } },
        b: { grade: null },
        c: {}
      }
      expect(getRecordedOutcomeGradeTokens(map)).toEqual(['A'])
    })

    test('returns empty array for missing map', () => {
      expect(getRecordedOutcomeGradeTokens(null)).toEqual([])
    })
  })

  describe('getRecordedFinalGradeTokens', () => {
    test('extracts normalized tokens from journalEntryStudents', () => {
      const students = [
        { journalStudent: '1', grade: { code: 'KUTSEHINDAMINE_A' } },
        { journalStudent: '2', grade: { code: 'KUTSEHINDAMINE_3' } },
        { journalStudent: '3', grade: null }
      ]
      expect(getRecordedFinalGradeTokens(students).sort()).toEqual(['3', 'A'])
    })

    test('returns empty array for non-array input', () => {
      expect(getRecordedFinalGradeTokens(undefined)).toEqual([])
    })
  })

  describe('resolveGradingMode', () => {
    test('1. in-session pick wins over everything', () => {
      const mode = resolveGradingMode({
        userPick: 'eristav',
        recordedTokens: ['A', 'MA'],
        journalAssessment: JOURNAL_ASSESSMENT_MITTE
      })
      expect(mode).toBe('eristav')
    })

    test('2. recorded A/MA grades beat a journal declared as eristav', () => {
      const mode = resolveGradingMode({
        recordedTokens: ['A', 'MA'],
        journalAssessment: JOURNAL_ASSESSMENT_ERISTAV
      })
      expect(mode).toBe('mitte')
    })

    test('2. recorded numeric grades beat a journal declared as mitteeristav', () => {
      const mode = resolveGradingMode({
        recordedTokens: ['3', '4'],
        journalAssessment: JOURNAL_ASSESSMENT_MITTE
      })
      expect(mode).toBe('eristav')
    })

    test('3. journal declared type decides when no recorded grades exist', () => {
      expect(resolveGradingMode({ recordedTokens: [], journalAssessment: JOURNAL_ASSESSMENT_ERISTAV })).toBe('eristav')
      expect(resolveGradingMode({ recordedTokens: [], journalAssessment: JOURNAL_ASSESSMENT_MITTE })).toBe('mitte')
    })

    test('4. falls back to mitteeristav when nothing is known', () => {
      expect(resolveGradingMode({})).toBe('mitte')
      expect(resolveGradingMode({ recordedTokens: [], journalAssessment: '' })).toBe('mitte')
    })

    test('an invalid userPick is ignored and detection proceeds', () => {
      const mode = resolveGradingMode({ userPick: 'bogus', recordedTokens: ['5'] })
      expect(mode).toBe('eristav')
    })
  })

  describe('applyGradingMode — does not mutate the source (idempotent)', () => {
    test('mitte: numeric >=3 -> A, <3 -> MA; final A only when all A', () => {
      const raw = [{ finalGrade: '5', ovGrades: { '1': '5', '2': '3', '3': '2' } }]
      const out = applyGradingMode(raw, 'mitte')
      expect(out[0].ovGrades).toEqual({ '1': 'A', '2': 'A', '3': 'MA' })
      expect(out[0].finalGrade).toBe('MA')
      // source untouched
      expect(raw[0].ovGrades).toEqual({ '1': '5', '2': '3', '3': '2' })
    })

    test('eristav: A -> 5, MA -> 2, final is rounded average', () => {
      const raw = [{ finalGrade: 'A', ovGrades: { '1': 'A', '2': 'MA' } }]
      const out = applyGradingMode(raw, 'eristav')
      expect(out[0].ovGrades).toEqual({ '1': '5', '2': '2' })
      expect(out[0].finalGrade).toBe('4') // round((5+2)/2) = round(3.5) = 4
      expect(raw[0].ovGrades).toEqual({ '1': 'A', '2': 'MA' })
    })

    test('preserves null finalGrade students unchanged', () => {
      const raw = [{ finalGrade: null, ovGrades: { '1': '5' } }]
      const out = applyGradingMode(raw, 'mitte')
      expect(out[0].finalGrade).toBeNull()
    })

    test('L-shaped entry with no ovGrades maps the precomputed finalGrade', () => {
      const raw = [{ finalGrade: '4', journalStudentId: '7' }]
      const mitte = applyGradingMode(raw, 'mitte')
      expect(mitte[0].finalGrade).toBe('A')
      const eristav = applyGradingMode([{ finalGrade: 'MA', journalStudentId: '7' }], 'eristav')
      expect(eristav[0].finalGrade).toBe('2')
    })

    test('non-lossy round-trip: 3.45_hasLow stays MA in mitte even after an eristav pass', () => {
      const raw = [{ finalGrade: '3', ovGrades: { '1': '3.45_hasLow' } }]
      const eristav = applyGradingMode(raw, 'eristav')
      expect(eristav[0].ovGrades['1']).toBe('3') // round(3.45)
      // mitte from the SAME pristine source must see _hasLow -> MA (not A)
      const mitte = applyGradingMode(raw, 'mitte')
      expect(mitte[0].ovGrades['1']).toBe('MA')
      expect(mitte[0].finalGrade).toBe('MA')
    })

    test('triple toggle from one source equals a single fresh apply', () => {
      const raw = [{ finalGrade: '5', ovGrades: { '1': 'A', '2': '4', '3': 'MA' } }]
      applyGradingMode(raw, 'eristav')
      applyGradingMode(raw, 'mitte')
      const finalToggle = applyGradingMode(raw, 'eristav')
      const fresh = applyGradingMode(raw, 'eristav')
      expect(finalToggle).toEqual(fresh)
    })

    test('returns empty array for non-array input', () => {
      expect(applyGradingMode(null, 'mitte')).toEqual([])
    })
  })
})
