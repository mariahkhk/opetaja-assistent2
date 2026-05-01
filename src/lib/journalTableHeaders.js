export const ASSIGNMENT_TITLE_ROW_CLASS = 'oa2-assignment-title-row'
export const ASSIGNMENT_OUTCOME_ROW_CLASS = 'oa2-assignment-outcome-row'

export function isCustomJournalHeaderRow(row) {
  return Boolean(
    row?.classList?.contains(ASSIGNMENT_TITLE_ROW_CLASS) ||
    row?.classList?.contains(ASSIGNMENT_OUTCOME_ROW_CLASS)
  )
}

export function getNativeJournalHeaderRows(tableOrThead) {
  if (!tableOrThead) return []
  const selector = tableOrThead.tagName === 'THEAD' ? 'tr' : 'thead tr'
  return Array.from(tableOrThead.querySelectorAll(selector)).filter(row => !isCustomJournalHeaderRow(row))
}

export function getNativeJournalHeaderCells(table) {
  return getNativeJournalHeaderRows(table).flatMap(row => Array.from(row.querySelectorAll('th')))
}
