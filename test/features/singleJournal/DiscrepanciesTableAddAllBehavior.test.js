import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'

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
    },
    sync: {
      get: mock((keys, callback) => { callback({}) }),
      set: mock()
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
  '../../../src/features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js'
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

describe('LessonDiscrepanciesFeature - Bulk Add Behavior', () => {
  let feature
  let postMock
  let reloadMock
  let currentDom
  beforeEach(() => {
    // Reset DOM
    currentDom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>')
    global.document = currentDom.window.document
    global.HTMLElement = currentDom.window.HTMLElement

    // Use a plain window-like object so we can mock location.reload
    reloadMock = mock()
    global.window = {
      location: {
        href: 'https://tahvel.edu.ee/#/journal/12345/edit',
        hostname: 'tahvel.edu.ee',
        protocol: 'https:',
        reload: reloadMock
      },
      Event: currentDom.window.Event,
      setTimeout: currentDom.window.setTimeout,
      clearTimeout: currentDom.window.clearTimeout
    }
    // Create feature and set it as active
    feature = new LessonDiscrepanciesFeature()
    feature.isActive = true

    // Mock the API
    postMock = mock(async () => ({ id: 1, success: true }))
    feature.api = {
      tahvel: {
        get: mock(async () => ({})),
        post: postMock
      }
    }
    // Also update the table's api reference
    feature.table.api = feature.api
  })

  afterEach(() => {
    // Clean up DOM by removing all child nodes
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild)
    }
  })

  function renderTableAndRegisterListeners(discrepancies) {
    feature.table.insertUnifiedTable(discrepancies, [], [], null)
    // Register click listeners (same as feature's #addDiscrepancyButtonListeners)
    feature.table.addDiscrepancyButtonListeners()
  }

  function clickAddAllButton() {
    const button = document.querySelector('[data-handler="addAllMissing"], [data-handler="addallmissing"]')
    if (!button) throw new Error('Add all button not found in DOM')
    button.click()
    return button
  }

  function getAddMissingButtons() {
    return document.querySelectorAll('[data-discrepancies-table] button[data-handler="addMissing"], [data-discrepancies-table] button[data-handler="addmissing"]')
  }

  test('calls API for each missing entry when "Lisa koik" is clicked', async () => {
    renderTableAndRegisterListeners([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 3, 1),
      makeMissingEntry('2025-09-04', 1, 3)
    ])

    clickAddAllButton()

    // Wait for all sequential API calls to complete
    const deadline = Date.now() + 2000
    while (postMock.mock.calls.length < 3 && Date.now() < deadline) {
      await flushMicrotasks()
    }

    expect(postMock.mock.calls.length).toBe(3)
    // All calls should be to the journal entry endpoint
    for (const call of postMock.mock.calls) {
      expect(call[0]).toBe('/journals/12345/journalEntry')
    }
  })

  test('disables all individual Lisa buttons during bulk operation', async () => {
    renderTableAndRegisterListeners([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 3, 1)
    ])

    const lisaButtons = getAddMissingButtons()
    expect(lisaButtons.length).toBe(2)

    clickAddAllButton()
    await flushMicrotasks()

    // Individual buttons should be disabled
    lisaButtons.forEach(btn => {
      expect(btn.disabled).toBe(true)
    })
  })

  test('re-enables buttons when all API calls fail', async () => {
    postMock = mock(async () => { throw new Error('API error') })
    feature.api.tahvel.post = postMock

    renderTableAndRegisterListeners([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 3, 1)
    ])

    const addAllButton = clickAddAllButton()
    const lisaButtons = getAddMissingButtons()

    // Wait for API calls to fail and state to be restored
    const deadline = Date.now() + 2000
    while (postMock.mock.calls.length < 2 && Date.now() < deadline) {
      await flushMicrotasks()
    }
    // Wait for the failure path to execute (re-enable buttons)
    await flushMicrotasks()
    await flushMicrotasks()

    // All API calls should have been attempted
    expect(postMock.mock.calls.length).toBe(2)

    // Buttons should be re-enabled after total failure
    expect(addAllButton.disabled).toBe(false)
    expect(addAllButton.textContent).toBe('Lisa kõik')
    lisaButtons.forEach(btn => {
      expect(btn.disabled).toBe(false)
    })
  })

  test('aborts bulk operation when feature is deactivated', async () => {
    let callCount = 0
    postMock = mock(async () => {
      callCount++
      if (callCount === 1) {
        // After first successful call, deactivate the feature
        feature.isActive = false
      }
      return { id: callCount }
    })
    feature.api.tahvel.post = postMock

    renderTableAndRegisterListeners([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 3, 1),
      makeMissingEntry('2025-09-04', 1, 3)
    ])

    clickAddAllButton()

    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      await flushMicrotasks()
      // Once feature is deactivated after first call, loop should stop
      if (!feature.isActive && postMock.mock.calls.length >= 1) break
    }
    await flushMicrotasks()
    await flushMicrotasks()

    // Should have stopped after 1 or 2 calls (not all 3)
    expect(postMock.mock.calls.length).toBeLessThan(3)
  })

  test('calls window.location.reload after successful bulk add', async () => {
    renderTableAndRegisterListeners([
      makeMissingEntry('2025-09-02', 7, 2),
      makeMissingEntry('2025-09-03', 3, 1)
    ])

    clickAddAllButton()

    // Wait for all API calls + delay(400) + reload
    const deadline = Date.now() + 3000
    while (!reloadMock.mock.calls.length && Date.now() < deadline) {
      await flushMicrotasks()
    }

    expect(reloadMock).toHaveBeenCalled()
  })
})
