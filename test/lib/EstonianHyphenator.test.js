import { describe, expect, test } from 'bun:test'
import EstonianHyphenator from '../../src/lib/EstonianHyphenator.js'

function stripSoftHyphens(text) {
  return text.replace(/\u00AD/g, '')
}

describe('EstonianHyphenator', () => {
  test('inserts soft hyphen markers into long Estonian words', () => {
    const text = EstonianHyphenator.hyphenate('Varasemalt esitamata praktiliste tööde esitamine')

    expect(text.includes('\u00AD')).toBe(true)
  })

  test('preserves explicit hyphenated compounds like IT-vidina', () => {
    const text = EstonianHyphenator.hyphenate('IT-vidina tuvastamine ja esitlus')

    expect(stripSoftHyphens(text).startsWith('IT-vidina')).toBe(true)
  })
})
