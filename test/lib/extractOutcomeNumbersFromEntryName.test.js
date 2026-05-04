import { describe, it, expect } from 'bun:test'
import { extractOutcomeNumbersFromEntryName } from '../../src/lib/extractOutcomeNumbersFromEntryName.js'

describe('extractOutcomeNumbersFromEntryName', () => {
  it('returns empty array for non-string input', () => {
    expect(extractOutcomeNumbersFromEntryName(null)).toEqual([])
    expect(extractOutcomeNumbersFromEntryName(undefined)).toEqual([])
    expect(extractOutcomeNumbersFromEntryName(42)).toEqual([])
    expect(extractOutcomeNumbersFromEntryName({})).toEqual([])
    expect(extractOutcomeNumbersFromEntryName([])).toEqual([])
  })

  it('returns empty array when name has no parenthesized suffix', () => {
    expect(extractOutcomeNumbersFromEntryName('Just a name')).toEqual([])
    expect(extractOutcomeNumbersFromEntryName('Foo (bar) baz')).toEqual([])
  })

  it('extracts a single ÕV number', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV1)')).toEqual(['1'])
  })

  it('extracts multiple ÕV numbers', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV1, ÕV3)')).toEqual(['1', '3'])
  })

  it('handles whitespace inside the parentheses', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV1 ,  ÕV3)')).toEqual(['1', '3'])
  })

  it('allows whitespace between ÕV and digit', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV 1, ÕV  2)')).toEqual(['1', '2'])
  })

  it('matches case-insensitively', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (õv1, ÕV2)')).toEqual(['1', '2'])
  })

  it('deduplicates outcome numbers', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV1, ÕV1, ÕV2)')).toEqual(['1', '2'])
  })

  it('returns empty array if any token is not a valid ÕV', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV1, foo)')).toEqual([])
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV1, BAR2)')).toEqual([])
  })

  it('returns empty array for empty parens', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö ()')).toEqual([])
  })

  it('returns empty array when only commas inside parens', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (,,)')).toEqual([])
  })

  it('matches only the trailing parenthesized group', () => {
    expect(extractOutcomeNumbersFromEntryName('Foo (notÕV) bar (ÕV5)')).toEqual(['5'])
  })

  it('tolerates trailing whitespace after parens', () => {
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV2)   ')).toEqual(['2'])
  })

  it('rejects nested parens', () => {
    // The regex is [^()]+ inside parens, so nested parens fail to match.
    expect(extractOutcomeNumbersFromEntryName('Töö (ÕV(1))')).toEqual([])
  })
})
