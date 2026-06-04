/**
 * Extract outcome numbers from a journal entry name suffix like "Foo (ÕV1, ÕV3)".
 * Returns an empty array unless the name ends with a parenthesized, comma-separated list
 * consisting only of ÕV tokens.
 *
 * @param {string} nameEt
 * @returns {string[]}
 */
export function extractOutcomeNumbersFromEntryName(nameEt) {
  if (typeof nameEt !== 'string') return []

  const suffixMatch = nameEt.match(/\(([^()]+)\)\s*$/)
  if (!suffixMatch) return []

  const tokens = suffixMatch[1]
    .split(',')
    .map(token => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) return []

  const ovNums = tokens.map(token => {
    const match = token.match(/^ÕV\s*(\d+)$/i)
    return match ? match[1] : null
  })

  if (ovNums.some(ovNum => ovNum === null)) return []

  return [...new Set(ovNums)]
}

/**
 * Extract the outcome number prefix from a SISSEKANNE_O entry name like
 * "1) Outcome" or "04. Outcome". Leading zeroes are normalized away.
 *
 * @param {string} nameEt
 * @returns {string}
 */
export function extractOutcomeNumberFromOutcomeEntryName(nameEt) {
  if (typeof nameEt !== 'string') return ''

  const match = nameEt.match(/^(\d+)[).]/)
  if (!match) return ''

  return match[1].replace(/^0+/, '') || '0'
}
