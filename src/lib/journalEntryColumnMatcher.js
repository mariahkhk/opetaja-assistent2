// Map Tahvel column-header background colours to SISSEKANNE entry types so a
// dateless or duplicate-date header can still be steered to the right entry.
// Keep keys in canonical `rgb(r,g,b)` (lowercase, no whitespace) so they line
// up with the output of `getElementBackgroundColor`.
const BACKGROUND_TO_ENTRY_TYPE = {
  'rgb(252,231,243)': 'SISSEKANNE_H',
  '#fce7f3': 'SISSEKANNE_H',
  'rgb(236,252,203)': 'SISSEKANNE_I',
  '#ecfccb': 'SISSEKANNE_I',
  'rgb(204,251,241)': 'SISSEKANNE_P',
  '#ccfbf1': 'SISSEKANNE_P'
}

export function getElementBackgroundColor(element) {
  const inline = element?.style?.backgroundColor
  const computed = typeof window !== 'undefined' && window.getComputedStyle
    ? window.getComputedStyle(element).backgroundColor
    : ''
  return (inline || computed || '').replace(/\s+/g, '').toLowerCase()
}

export function getHeaderDayMonth(headerCell) {
  const match = (headerCell?.textContent || '').match(/(\d{1,2})[./](\d{1,2})/)
  if (!match) return null
  return `${String(match[1]).padStart(2, '0')}.${String(match[2]).padStart(2, '0')}`
}

export function getEntryDayMonth(entry) {
  if (!entry?.entryDate) return null
  const date = new Date(entry.entryDate)
  if (Number.isNaN(date.getTime())) return null
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function getHeaderEntryType(headerCell) {
  return BACKGROUND_TO_ENTRY_TYPE[getElementBackgroundColor(headerCell)] || null
}

/**
 * Pair a journal-table column header with one of the journal's entries.
 * Two flows share one loop:
 *   - Dated header → match entries with the same day/month
 *   - Dateless header → match entries that also have no entryDate (covers
 *     entries saved without a date, which Tahvel still renders as columns)
 * Within either flow we prefer an unmatched entry whose entryType matches
 * the column's background-colour hint; otherwise fall back to the first
 * eligible entry by ordinal position.
 */
export function findEntryIndexForHeader(headerCell, entries, usedEntryIndexes) {
  if (!entries?.length) return null
  const headerDate = getHeaderDayMonth(headerCell)
  const headerEntryType = getHeaderEntryType(headerCell)
  const isEligible = headerDate
    ? entry => getEntryDayMonth(entry) === headerDate
    : entry => !getEntryDayMonth(entry)

  let fallbackIndex = null
  for (let index = 0; index < entries.length; index++) {
    if (usedEntryIndexes.has(index)) continue
    const entry = entries[index]
    if (!isEligible(entry)) continue
    if (headerEntryType && entry.entryType === headerEntryType) return index
    if (fallbackIndex === null) fallbackIndex = index
  }
  return fallbackIndex
}
