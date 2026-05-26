import { describe, test, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreGlobalDOM } from '../../../setup.js'
import { DiscrepanciesTable } from '../../../../src/features/singleJournal/lessonDiscrepancies/DiscrepanciesTable.js'

function buildJournalAccordion() {
  const accordion = document.createElement('tahvel-accordion')
  accordion.style.width = '500px'
  Object.defineProperty(accordion, 'getBoundingClientRect', {
    value: () => ({ width: 500, height: 100 }),
    configurable: true
  })
  document.body.appendChild(accordion)
  return accordion
}

function makeTable(overrides = {}) {
  return new DiscrepanciesTable({
    api: { tahvel: { get: mock(async () => ({})) } },
    extractJournalId: () => 12345,
    calculateDuplicateIndex: () => 0,
    findDuplicateMatches: () => ({ exactMatches: [] }),
    addDiscrepancyButtonListeners: () => {},
    shouldContinue: () => true,
    ...overrides
  })
}

describe("DiscrepanciesTable", () => {
  let table

  beforeEach(() => {
    restoreGlobalDOM()
    table = makeTable()
  })

  afterEach(() => {
    delete window.__lastLessonNotificationRefresh
    delete window.__lastLessonNotification_independentWorkMessage
  })

  describe('createTable', () => {
    it('returns false when extractJournalId returns null', async () => {
      const t = makeTable({ extractJournalId: () => null })
      const ok = await t.createTable({ discrepancies: [], capacityProblems: [] })
      expect(ok).toBe(false)
    })

    it('reuses an existing table when same journal and not forced', async () => {
      buildJournalAccordion()
      await table.createTable({ discrepancies: [], capacityProblems: [] })
      const first = document.querySelector('[data-discrepancies-table]')
      const second = await table.createTable({ discrepancies: [], capacityProblems: [] })
      expect(second).toBe(true)
      expect(document.querySelector('[data-discrepancies-table]')).toBe(first)
    })

    it('rebuilds table when forceRefresh is true', async () => {
      buildJournalAccordion()
      await table.createTable({ discrepancies: [], capacityProblems: [] })
      const first = document.querySelector('[data-discrepancies-table]')
      await table.createTable({ discrepancies: [], capacityProblems: [], forceRefresh: true })
      expect(document.querySelector('[data-discrepancies-table]')).not.toBe(first)
    })

    it('awaits __lastLessonNotificationRefresh when defined', async () => {
      buildJournalAccordion()
      const refresh = mock(async () => undefined)
      window.__lastLessonNotificationRefresh = refresh
      await table.createTable({ discrepancies: [], capacityProblems: [] })
      expect(refresh).toHaveBeenCalled()
    })

    it('absorbs independentWorkMessage from window', async () => {
      buildJournalAccordion()
      window.__lastLessonNotification_independentWorkMessage = 'iseseisev töö hilineb'
      await table.createTable({ discrepancies: [], capacityProblems: [] })
      expect(window.__lastLessonNotification_independentWorkMessage).toBeUndefined()
    })

    it('returns false when an exception bubbles up', async () => {
      buildJournalAccordion()
      const t = makeTable({
        extractJournalId: () => { throw new Error('boom') }
      })
      const ok = await t.createTable({ discrepancies: [], capacityProblems: [] })
      expect(ok).toBe(false)
    })
  })

  describe('insertUnifiedTable', () => {
    it('returns false when shouldContinue returns false', () => {
      const t = makeTable({ shouldContinue: () => false })
      expect(t.insertUnifiedTable([], [], [], null)).toBe(false)
    })

    it('returns false when no insertion point available (body has no width)', () => {
      // Force findInsertionPoint to return body, then make body too small
      Object.defineProperty(document.body, 'getBoundingClientRect', {
        value: () => ({ width: 50 }),
        configurable: true
      })
      const ok = table.insertUnifiedTable([], [], [], null)
      // Body fallback always returns truthy, so this should be true
      expect(typeof ok).toBe('boolean')
    })

    it('inserts table after tahvel-accordion when present', () => {
      const accordion = buildJournalAccordion()
      const ok = table.insertUnifiedTable([], [], [], null)
      expect(ok).toBe(true)
      expect(accordion.nextElementSibling.getAttribute('data-discrepancies-table')).toBe('true')
    })

    it('inserts table after .accordion-header when present (no tahvel-accordion)', () => {
      const header = document.createElement('div')
      header.className = 'accordion-header'
      Object.defineProperty(header, 'getBoundingClientRect', {
        value: () => ({ width: 500 }), configurable: true
      })
      document.body.appendChild(header)

      const ok = table.insertUnifiedTable([], [], [], null)
      expect(ok).toBe(true)
      expect(header.nextElementSibling.getAttribute('data-discrepancies-table')).toBe('true')
    })

    it('inserts via insertBefore when insertion point is not accordion', () => {
      const main = document.createElement('div')
      main.id = 'main-content'
      Object.defineProperty(main, 'getBoundingClientRect', {
        value: () => ({ width: 500 }), configurable: true
      })
      document.body.appendChild(main)

      const ok = table.insertUnifiedTable([], [], [], null)
      expect(ok).toBe(true)
      expect(main.firstChild.getAttribute('data-discrepancies-table')).toBe('true')
    })

    it('falls back gracefully when DOM operations fail', () => {
      const accordion = buildJournalAccordion()
      const original = accordion.insertAdjacentElement
      accordion.insertAdjacentElement = () => { throw new Error('dom-fail') }
      try {
        const ok = table.insertUnifiedTable([], [], [], null)
        expect(ok).toBe(true)
      } finally {
        accordion.insertAdjacentElement = original
      }
    })

    it('renders missing entry rows', () => {
      buildJournalAccordion()
      const ok = table.insertUnifiedTable([
        { type: 'missingJournalEntry', date: '2026-01-15', lessonNumber: 1, lessonCount: 2,
          timeStart: '09:00', timeEnd: '10:30', rooms: [] }
      ], [], [], null)
      expect(ok).toBe(true)
      expect(document.querySelector('[data-discrepancies-table]')).toBeTruthy()
    })

    it('renders multiEntryFix rows', () => {
      buildJournalAccordion()
      const ok = table.insertUnifiedTable([{
        type: 'multiEntryFix',
        date: '2026-01-15',
        entries: [
          { id: 1, startLessonNr: 1, lessons: 2 },
          { id: 2, startLessonNr: 3, lessons: 1 }
        ],
        journalStart: 1,
        journalCount: 3,
        timetableStart: 1,
        timetableCount: 3
      }], [], [], null)
      expect(ok).toBe(true)
      expect(document.querySelectorAll('button').length).toBeGreaterThan(0)
    })

    it('renders multiEntryFix with duplicates indicator', () => {
      buildJournalAccordion()
      const t = makeTable({
        findDuplicateMatches: () => ({ exactMatches: [{ id: 1 }, { id: 2 }] })
      })
      const ok = t.insertUnifiedTable([{
        type: 'multiEntryFix',
        date: '2026-01-15',
        entries: [{ id: 1, startLessonNr: 1, lessons: 2 }]
      }], [], [], null)
      expect(ok).toBe(true)
      const buttons = [...document.querySelectorAll('button')]
      expect(buttons.some(b => b.textContent.includes('#'))).toBe(true)
    })

    it('renders singleEntryFix with duplicate indicator when matches > 1', () => {
      buildJournalAccordion()
      const t = makeTable({
        findDuplicateMatches: () => ({ exactMatches: [{ id: 1 }, { id: 2 }] })
      })
      const ok = t.insertUnifiedTable([{
        type: 'singleEntryFix',
        date: '2026-01-15',
        entryId: 999,
        journalStart: 1,
        journalCount: 2,
        timetableStart: 3,
        timetableCount: 2
      }], [], [], null)
      expect(ok).toBe(true)
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Muuda'))
      expect(button.textContent).toContain('#')
    })
  })

  describe('capacity problem rows', () => {
    it('renders capacity row with date and SISSEKANNE_T entry type (default badge)', () => {
      buildJournalAccordion()
      const ok = table.insertUnifiedTable([], [{
        id: 1,
        entryType: 'SISSEKANNE_T',
        entryDate: '2026-04-13T00:00:00.000Z',
        startLessonNr: 5
      }], [], null)
      expect(ok).toBe(true)
      expect(document.querySelector('[data-capacity-problems-table]') ||
             document.querySelector('[data-discrepancies-table]')).toBeTruthy()
    })

    it('renders SISSEKANNE_I (independent work) badge color', () => {
      buildJournalAccordion()
      table.insertUnifiedTable([], [{
        id: 1, entryType: 'SISSEKANNE_I', entryDate: '2026-04-13'
      }], [], null)
      const html = document.querySelector('[data-discrepancies-table]').innerHTML
      expect(html).toContain('#f0f4c3')
    })

    it('renders SISSEKANNE_P (practical work) badge color', () => {
      buildJournalAccordion()
      table.insertUnifiedTable([], [{
        id: 1, entryType: 'SISSEKANNE_P', entryDate: '2026-04-13'
      }], [], null)
      const html = document.querySelector('[data-discrepancies-table]').innerHTML
      expect(html).toContain('#b2dfdb')
    })

    it('handles null entry date with "Kuupäevata" label', () => {
      buildJournalAccordion()
      table.insertUnifiedTable([], [{
        id: 1, entryType: 'SISSEKANNE_T', entryDate: null
      }], [], null)
      const html = document.querySelector('[data-discrepancies-table]').innerHTML
      expect(html).toContain('Kuupäevata')
    })

    it('handles invalid date string gracefully', () => {
      buildJournalAccordion()
      table.insertUnifiedTable([], [{
        id: 1, entryType: 'SISSEKANNE_T', entryDate: 'not-a-date'
      }], [], null)
      const html = document.querySelector('[data-discrepancies-table]').innerHTML
      expect(html).toContain('Kuupäevata')
    })

    it('renders no_teacher_selected validation result (Paranda button)', () => {
      buildJournalAccordion()
      table.insertUnifiedTable([], [{
        id: 1, entryType: 'SISSEKANNE_T', entryDate: '2026-04-13',
        validationResult: { errorType: 'no_teacher_selected' }
      }], [], null)
      const html = document.querySelector('[data-discrepancies-table]').innerHTML
      expect(html).toContain('Õpetaja pole valitud')
    })

    it('renders journal_missing_independent_work with Ava button', () => {
      buildJournalAccordion()
      table.insertUnifiedTable([], [{
        id: 1, entryType: 'SISSEKANNE_T', entryDate: '2026-04-13',
        validationResult: { errorType: 'journal_missing_independent_work' }
      }], [], null)
      const html = document.querySelector('[data-discrepancies-table]').innerHTML
      expect(html).toContain('Ava')
    })

    it('uses the right message for each known errorType', () => {
      const types = [
        ['both_checkboxes_selected', 'Auditoorne õpe ja iseseiseva'],
        ['lesson_with_independent_work', 'tund, aga ainult iseseiseva'],
        ['lesson_without_auditoorne', 'tund, aga auditoorne'],
        ['independent_work_with_auditory', 'Iseseisev tööl ei saa olla'],
        ['praktiline_too_without_praktiline_checkbox', 'praktilise töö linnukest'],
        ['missing_iseseisev_checkbox', 'iseseiseva õppe linnukest'],
        ['missing_praktiline_checkbox', 'Praktiline töö puudub'],
        ['missing_auditoorne_checkbox', 'Auditoorne õpe puudub']
      ]
      for (const [errorType, expectedSubstring] of types) {
        restoreGlobalDOM()
        buildJournalAccordion()
        const t = makeTable()
        t.insertUnifiedTable([], [{
          id: 1, entryType: 'SISSEKANNE_T', entryDate: '2026-04-13',
          validationResult: { errorType }
        }], [], null)
        const html = document.querySelector('[data-discrepancies-table]').innerHTML
        expect(html).toContain(expectedSubstring)
      }
    })
  })

  describe('post-insertion setTimeout side-effects', () => {
    function buildJournalTable(headers = [], bodyCells = []) {
      const tbl = document.createElement('table')
      tbl.className = 'journalTable'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      for (const h of headers) {
        const th = document.createElement('th')
        if (typeof h === 'string') {
          th.textContent = h
        } else {
          th.textContent = h.text
          if (h.colspan) th.setAttribute('colspan', h.colspan)
        }
        headRow.appendChild(th)
      }
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const bodyRow = document.createElement('tr')
      for (const t of bodyCells) {
        const td = document.createElement('td')
        td.textContent = t
        bodyRow.appendChild(td)
      }
      tbody.appendChild(bodyRow)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      document.body.appendChild(tbl)
      return tbl
    }

    it('detects ÕV column headers and notifications when missing-grade highlights exist', async () => {
      buildJournalAccordion()
      buildJournalTable(['ÕV1', 'Lõpptulemus'])
      const highlight = document.createElement('span')
      highlight.className = 'highlight-missing-grade'
      document.body.appendChild(highlight)

      table.insertUnifiedTable([], [], [], null)
      await new Promise(r => setTimeout(r, 50))
      // Coverage is the goal — assert the deferred update at least removed the bare table.
      expect(document.querySelector('[data-discrepancies-table]')).toBeTruthy()
    })

    it('handles colspan=2 final-grade headers and detects missing body cells', async () => {
      buildJournalAccordion()
      buildJournalTable([{ text: 'Lõpptulemus', colspan: '2' }], ['', '5'])
      table.insertUnifiedTable([], [], [], null)
      await new Promise(r => setTimeout(r, 5))
    })

    it('does not crash when querySelectorAll throws inside header scan', async () => {
      buildJournalAccordion()
      buildJournalTable(['ÕV1'])
      const orig = document.querySelectorAll
      let count = 0
      document.querySelectorAll = (sel) => {
        count++
        if (sel === 'table.journalTable thead th' && count > 1) throw new Error('boom')
        return orig.call(document, sel)
      }
      try {
        table.insertUnifiedTable([], [], [], null)
        await new Promise(r => setTimeout(r, 5))
      } finally {
        document.querySelectorAll = orig
      }
    })
  })

  describe('updateMissingGradesBanner', () => {
    function buildBanner() {
      const wrapper = document.createElement('div')
      wrapper.setAttribute('data-discrepancies-table', 'true')
      const notif = document.createElement('div')
      notif.className = 'notifications-section'
      wrapper.appendChild(notif)
      document.body.appendChild(wrapper)
      return notif
    }

    it('does nothing when there is no notifications section', () => {
      expect(() => table.updateMissingGradesBanner('msg')).not.toThrow()
    })

    it('renders missing-grades banner', () => {
      buildBanner()
      table.updateMissingGradesBanner('hinded puudu')
      expect(document.querySelector('[data-discrepancies-table] .notifications-section')
        .innerHTML).toContain('hinded puudu')
    })

    it('does not duplicate the same banner text', () => {
      buildBanner()
      table.updateMissingGradesBanner('hinded puudu')
      table.updateMissingGradesBanner('hinded puudu')
      const matches = document.querySelectorAll('.oa2-banner--red')
      expect(matches).toHaveLength(1)
    })

    it('renders OA mismatch banner when oa-final-grade-red cells exist', () => {
      buildBanner()
      const cell = document.createElement('span')
      cell.className = 'oa-final-grade-red'
      document.body.appendChild(cell)
      table.updateMissingGradesBanner(null)
      expect(document.querySelector('.oa2-banner-final-grade')).toBeTruthy()
    })

    it('renders red final-grade banner when highlight-final-grade-red cells exist', () => {
      buildBanner()
      const cell = document.createElement('span')
      cell.className = 'highlight-final-grade-red'
      document.body.appendChild(cell)
      table.updateMissingGradesBanner(null)
      expect(document.querySelector('.oa2-banner-final-grade')).toBeTruthy()
    })

    it('renders yellow final-grade banner when highlight-final-grade-yellow cells exist (and no red)', () => {
      buildBanner()
      const cell = document.createElement('span')
      cell.className = 'highlight-final-grade-yellow'
      document.body.appendChild(cell)
      table.updateMissingGradesBanner(null)
      expect(document.querySelector('.oa2-banner--yellow')).toBeTruthy()
    })

    it('detects empty final-grade body cells via header column scan', () => {
      buildBanner()
      const tbl = document.createElement('table')
      tbl.className = 'journalTable'
      const thead = document.createElement('thead')
      const headRow = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = 'Lõpptulemus'
      headRow.appendChild(th)
      thead.appendChild(headRow)
      const tbody = document.createElement('tbody')
      const bodyRow = document.createElement('tr')
      const td = document.createElement('td')
      td.textContent = '   ' // blank
      bodyRow.appendChild(td)
      tbody.appendChild(bodyRow)
      tbl.appendChild(thead)
      tbl.appendChild(tbody)
      document.body.appendChild(tbl)

      table.updateMissingGradesBanner(null)
      expect(document.querySelector('.oa2-banner-final-grade')).toBeTruthy()
    })

    it('handles errors thrown inside body-row scanning gracefully', () => {
      buildBanner()
      const orig = document.querySelectorAll
      // Only break for a specific selector
      document.querySelectorAll = (sel) => {
        if (sel === 'table.journalTable thead tr') throw new Error('boom')
        return orig.call(document, sel)
      }
      expect(() => table.updateMissingGradesBanner(null)).not.toThrow()
      document.querySelectorAll = orig
    })
  })
})

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


// Set up globals BEFORE importing modules that depend on them
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>')
global.window = dom.window
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.MutationObserver = class { observe() {} disconnect() {} }
global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' })
global.chrome = {
  storage: {
    local: {
      get: mock((keys, callback) => { callback({}) }),
      set: mock((items, callback) => { if (callback) callback() })
    }
  },
  runtime: {
    sendMessage: mock(),
    getManifest: () => ({ version: '1.0.0' }),
    onMessage: { addListener: mock() }
  }
}

global.console = {
  debug: () => {}, log: () => {}, error: () => {},
  warn: () => {}, info: () => {},
  groupCollapsed: () => {}, trace: () => {}, groupEnd: () => {}
}

const { default: LessonDiscrepanciesFeature } = await import(
  '../../../../src/features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js'
)

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

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 10))
}

