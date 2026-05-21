import { beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import {
  findEntryIndexForHeader,
  getElementBackgroundColor,
  getEntryDayMonth,
  getHeaderDayMonth,
  getHeaderEntryType
} from '../../src/lib/journalEntryColumnMatcher.js'

let dom
beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  global.window = dom.window
  global.document = dom.window.document
})

function makeHeader({ text = '', bg = '' } = {}) {
  const th = document.createElement('th')
  th.textContent = text
  if (bg) th.style.backgroundColor = bg
  return th
}

describe('getHeaderDayMonth', () => {
  test('extracts DD.MM from "01.05"-style text', () => {
    expect(getHeaderDayMonth(makeHeader({ text: '01.05' }))).toBe('01.05')
  })

  test('zero-pads single-digit day/month', () => {
    expect(getHeaderDayMonth(makeHeader({ text: '5.9' }))).toBe('05.09')
  })

  test('returns null when no date is present', () => {
    expect(getHeaderDayMonth(makeHeader({ text: 'Lõpptulemus' }))).toBeNull()
    expect(getHeaderDayMonth(makeHeader({ text: '' }))).toBeNull()
  })
})

describe('getEntryDayMonth', () => {
  test('parses ISO date to DD.MM', () => {
    expect(getEntryDayMonth({ entryDate: '2026-05-01T00:00:00Z' })).toBe('01.05')
  })

  test('returns null for missing/invalid dates', () => {
    expect(getEntryDayMonth({ entryDate: null })).toBeNull()
    expect(getEntryDayMonth({ entryDate: 'not a date' })).toBeNull()
    expect(getEntryDayMonth({})).toBeNull()
    expect(getEntryDayMonth(null)).toBeNull()
  })
})

describe('getElementBackgroundColor / getHeaderEntryType', () => {
  test('maps each canonical background colour to its SISSEKANNE_ code', () => {
    expect(getHeaderEntryType(makeHeader({ bg: 'rgb(252, 231, 243)' }))).toBe('SISSEKANNE_H')
    expect(getHeaderEntryType(makeHeader({ bg: 'rgb(236, 252, 203)' }))).toBe('SISSEKANNE_I')
    expect(getHeaderEntryType(makeHeader({ bg: 'rgb(204, 251, 241)' }))).toBe('SISSEKANNE_P')
  })

  test('returns null when the background colour is unmapped', () => {
    expect(getHeaderEntryType(makeHeader({ bg: 'rgb(255, 255, 255)' }))).toBeNull()
    expect(getHeaderEntryType(makeHeader({ bg: '' }))).toBeNull()
  })

  test('getElementBackgroundColor strips whitespace and lowercases', () => {
    const th = makeHeader({ bg: 'rgb(236, 252, 203)' })
    expect(getElementBackgroundColor(th)).toBe('rgb(236,252,203)')
  })
})

describe('findEntryIndexForHeader', () => {
  test('dated header matches the entry with the same day/month', () => {
    const header = makeHeader({ text: '01.05' })
    const entries = [
      { entryDate: '2026-04-30T00:00:00Z', entryType: 'SISSEKANNE_T' },
      { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_I' }
    ]
    expect(findEntryIndexForHeader(header, entries, new Set())).toBe(1)
  })

  test('prefers an entry whose entryType matches the column background colour', () => {
    const header = makeHeader({ text: '01.05', bg: 'rgb(236, 252, 203)' })
    const entries = [
      { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_T' },
      { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_I' }
    ]
    expect(findEntryIndexForHeader(header, entries, new Set())).toBe(1)
  })

  test('skips entries already in usedEntryIndexes', () => {
    const header = makeHeader({ text: '01.05' })
    const entries = [
      { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_T' },
      { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_I' }
    ]
    expect(findEntryIndexForHeader(header, entries, new Set([0]))).toBe(1)
  })

  describe('dateless header', () => {
    test('matches the first unmatched dateless entry by ordinal position', () => {
      const header = makeHeader()
      const entries = [
        { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_T' },
        { entryDate: null, entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö (ÕV3)' }
      ]
      expect(findEntryIndexForHeader(header, entries, new Set())).toBe(1)
    })

    test('prefers entryType-matching dateless entry when the background colour hints at one', () => {
      const header = makeHeader({ bg: 'rgb(236, 252, 203)' })
      const entries = [
        { entryDate: null, entryType: 'SISSEKANNE_P' },
        { entryDate: null, entryType: 'SISSEKANNE_I' }
      ]
      expect(findEntryIndexForHeader(header, entries, new Set())).toBe(1)
    })

    test('falls back to first dateless entry when the colour hint matches nothing', () => {
      const header = makeHeader({ bg: 'rgb(204, 251, 241)' })
      const entries = [
        { entryDate: null, entryType: 'SISSEKANNE_I' },
        { entryDate: null, entryType: 'SISSEKANNE_H' }
      ]
      expect(findEntryIndexForHeader(header, entries, new Set())).toBe(0)
    })

    test('ignores entries that have a date', () => {
      const header = makeHeader()
      const entries = [
        { entryDate: '2026-05-01T00:00:00Z', entryType: 'SISSEKANNE_T' },
        { entryDate: '2026-05-08T00:00:00Z', entryType: 'SISSEKANNE_I' }
      ]
      expect(findEntryIndexForHeader(header, entries, new Set())).toBeNull()
    })

    test('does not double-match across used indexes', () => {
      const header = makeHeader()
      const entries = [
        { entryDate: null, entryType: 'SISSEKANNE_I' },
        { entryDate: null, entryType: 'SISSEKANNE_I' }
      ]
      expect(findEntryIndexForHeader(header, entries, new Set([0]))).toBe(1)
    })
  })

  test('returns null for empty entry list', () => {
    expect(findEntryIndexForHeader(makeHeader({ text: '01.05' }), [], new Set())).toBeNull()
  })
})
