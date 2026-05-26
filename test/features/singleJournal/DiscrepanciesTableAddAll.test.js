import { describe, test, expect, beforeEach } from 'bun:test'
import { JSDOM } from 'jsdom'
import { DiscrepanciesTable } from '../../../src/features/singleJournal/lessonDiscrepancies/DiscrepanciesTable.js'

describe('DiscrepanciesTable - Lisa koik (Add all) button', () => {
  let table

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>')
    global.window = dom.window
    global.document = dom.window.document
    global.HTMLElement = dom.window.HTMLElement

    table = new DiscrepanciesTable({
      api: {},
      extractJournalId: () => 123,
      calculateDuplicateIndex: () => 0,
      findDuplicateMatches: () => ({ exactMatches: [] }),
      addDiscrepancyButtonListeners: () => {},
      shouldContinue: () => true
    })
  })

  function makeMissingEntry(date, lessonNumber, lessonCount) {
    return {
      type: 'missingJournalEntry',
      date,
      lessonNumber,
      lessonCount,
      timeStart: '08:00',
      timeEnd: '09:30',
      rooms: []
    }
  }

  function makeSingleEntryFix(date) {
    return {
      type: 'singleEntryFix',
      date,
      entryId: 999,
      journalStart: 1,
      journalCount: 2,
      timetableStart: 3,
      timetableCount: 2
    }
  }

  function renderTable(discrepancies) {
    table.insertUnifiedTable(discrepancies, [], [], null)
    return document.querySelector('[data-discrepancies-table]')
  }

  function findAddAllButton(container) {
    return container.querySelector('[data-handler="addAllMissing"]')
  }

  test('shows "Lisa koik" button when there are 2+ missing entries', () => {
    const container = renderTable([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 7, 3)
    ])
    const addAllButton = findAddAllButton(container)
    expect(addAllButton).not.toBeNull()
    expect(addAllButton.textContent).toBe('Lisa kõik')
  })

  test('does not show "Lisa koik" button when there is exactly 1 missing entry', () => {
    const container = renderTable([
      makeMissingEntry('2025-09-02', 7, 2)
    ])
    expect(findAddAllButton(container)).toBeNull()
  })

  test('does not show "Lisa koik" button when there are 0 missing entries', () => {
    const container = renderTable([])
    expect(findAddAllButton(container)).toBeNull()
  })

  test('does not show "Lisa koik" button when all discrepancies are edit-type', () => {
    const container = renderTable([
      makeSingleEntryFix('2025-09-02'),
      makeSingleEntryFix('2025-09-03')
    ])
    expect(findAddAllButton(container)).toBeNull()
  })

  test('shows "Lisa koik" button only counting missing entries among mixed types', () => {
    const container = renderTable([
      makeMissingEntry('2025-09-02', 7, 2),
      makeSingleEntryFix('2025-09-03'),
      makeMissingEntry('2025-09-04', 7, 3)
    ])
    expect(findAddAllButton(container)).not.toBeNull()
  })

  test('does not show "Lisa koik" when only 1 missing entry among mixed types', () => {
    const container = renderTable([
      makeMissingEntry('2025-09-02', 7, 2),
      makeSingleEntryFix('2025-09-03'),
      makeSingleEntryFix('2025-09-04')
    ])
    expect(findAddAllButton(container)).toBeNull()
  })

  test('"Lisa koik" button is outside the table, aligned right under Tegevus column', () => {
    const container = renderTable([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 7, 3)
    ])
    const addAllButton = findAddAllButton(container)
    expect(addAllButton.closest('table')).toBeNull()
  })

  test('"Lisa koik" button uses green styling', () => {
    const container = renderTable([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 7, 3)
    ])
    const addAllButton = findAddAllButton(container)
    expect(addAllButton.style.background).toContain('40, 167, 69')
  })

  test('stores lastMissingEntries on table instance', () => {
    renderTable([
      makeMissingEntry('2025-09-02', 7, 2),
      makeSingleEntryFix('2025-09-03'),
      makeMissingEntry('2025-09-04', 7, 3)
    ])
    expect(table.lastMissingEntries.length).toBe(2)
    expect(table.lastMissingEntries[0].type).toBe('missingJournalEntry')
  })

  test('button data-* attributes serialize array values as JSON', () => {
    const rooms = [{ id: 1, nameEt: 'Room A' }, { id: 2, nameEt: 'Room B' }]
    const entry = makeMissingEntry('2025-09-02', 7, 2)
    entry.rooms = rooms

    const container = renderTable([entry])
    const lisaButton = container.querySelector('button[data-handler="addMissing"]')

    expect(lisaButton).not.toBeNull()
    expect(JSON.parse(lisaButton.dataset.rooms)).toEqual(rooms)
  })
})
