import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'
import { startKriitServer } from './helpers/kriitServer.js'
import { enableKriitFully } from './helpers/enableKriit.js'

test.describe('Kriit sync write-back flows', () => {
  let context, extensionId, kriit

  test.beforeAll(async() => {
    kriit = await startKriitServer()
  })

  test.afterAll(async() => {
    kriit.stop()
  })

  test.beforeEach(async() => {
    kriit.requestLog.length = 0
    ;({ context, extensionId } = await launchWithExtension())
    await enableKriitFully(context, extensionId, { apiUrl: `${kriit.origin}/api` })
  })

  test.afterEach(async() => {
    await context.close()
  })

  async function loadJournalsWithDiffs() {
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'diffs')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    return page
  }

  test('getDifferences POST goes to Kriit with proper payload shape', async() => {
    await loadJournalsWithDiffs()
    await expect.poll(
      () => kriit.requestLog.some(r => r.path === '/api/subjects/getDifferences' && r.method === 'POST'),
      { timeout: 20000 }
    ).toBe(true)
    const calls = kriit.requestLog.filter(r => r.path === '/api/subjects/getDifferences' && r.method === 'POST')
    const parsed = JSON.parse(calls[0].body || '{}')
    expect(parsed).toHaveProperty('journals')
    expect(Array.isArray(parsed.journals)).toBe(true)
  })

  test('JournalSyncBanner injects .ta-sync-banner-container when differences present', async() => {
    const page = await loadJournalsWithDiffs()
    await expect(page.locator('.ta-sync-banner-container').first()).toBeAttached({ timeout: 20000 })
  })

  test('newAssignments scenario: assignmentLink in fixture, no extra Tahvel POST yet (sync triggered manually only)', async() => {
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'newAssignments')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    // Wait long enough for sync activation
    await expect.poll(
      () => kriit.requestLog.some(r => r.path === '/api/subjects/getDifferences'),
      { timeout: 20000 }
    ).toBe(true)
    // syncNewAssignmentsToTahvel is called only when triggered (TahvelNewAssignmentSync.js:42).
    // Without explicit trigger, setAssignmentExternalId should NOT be POSTed.
    const setExtCalls = kriit.requestLog.filter(r => r.path === '/api/assignments/setAssignmentExternalId')
    expect(setExtCalls.length).toBe(0)
  })

  test('TahvelNewAssignmentSync: Sünkroniseeri click drives full chain → setAssignmentExternalId POST to Kriit', async() => {
    // Hard test of the full chain: Kriit returns newAssignments → user clicks
    // "Sünkroniseeri kõik" → extension POSTs /journals/{id}/journalEntry to
    // Tahvel → re-GETs journalEntriesByDate to retrieve the new entry's id
    // → POSTs /api/assignments/setAssignmentExternalId back to Kriit.
    //
    // This requires a stateful Tahvel mock: the POST creates a new entry,
    // and the subsequent GET must return it (otherwise the externalId
    // lookup fails and setAssignmentExternalId is never sent).
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'diffsAndNew')
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))

    // Playwright route stack consults LATEST-registered routes first.
    // mockTahvel uses a broad regex that always fulfills, so it must be
    // registered FIRST and our specific overrides on top of it.
    await mockTahvel(page, '/#/journals')

    const SYNTHETIC_ENTRY_ID = 99001
    const NEW_ASSIGNMENT_NAME = 'Uus ülesanne Kriidist'
    let createdEntry = null

    await page.route(/\/hois_back\/journals\/404498\/journalEntry$/, async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        createdEntry = {
          id: SYNTHETIC_ENTRY_ID,
          nameEt: body?.nameEt,
          entryType: body?.entryType,
          entryDate: body?.entryDate
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: SYNTHETIC_ENTRY_ID })
        })
      }
      return route.continue()
    })

    await page.route(/\/hois_back\/journals\/404498\/journalEntriesByDate/, async route => {
      // After the POST has run, return the synthetic entry so the extension's
      // getCreatedAssignmentExternalId() finds it by name+entryType.
      const entries = createdEntry ? [createdEntry] : []
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(entries)
      })
    })
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    const syncBtn = page.getByRole('button', { name: 'Sünkroniseeri kõik' })
    await expect(syncBtn).toBeAttached({ timeout: 20000 })
    await syncBtn.click()

    // Wait for the round-trip POST back to Kriit. The chain has a built-in
    // 1s sleep before re-GET (TahvelNewAssignmentSync.js:488), so allow >2s.
    await expect.poll(
      () => kriit.requestLog.some(
        r => r.method === 'POST' && r.path === '/api/assignments/setAssignmentExternalId'
      ),
      { timeout: 20000 }
    ).toBe(true)

    const calls = kriit.requestLog.filter(
      r => r.method === 'POST' && r.path === '/api/assignments/setAssignmentExternalId'
    )
    const payload = JSON.parse(calls[0].body)
    // Fixture's createdAssignmentId is 99 → assignmentId in the payload.
    expect(payload.assignmentId).toBe(99)
    expect(payload.assignmentExternalId).toBe(SYNTHETIC_ENTRY_ID)
    expect(createdEntry?.nameEt).toBe(NEW_ASSIGNMENT_NAME)
    expect(errors).toEqual([])
  })

  test('differences scenario renders >=1 .change-item with non-empty .badge-assignment text', async() => {
    const page = await loadJournalsWithDiffs()
    // Fixture has 1 assignment with 1 grade-result; renderer may emit a row
    // per change-type (grade/dueDate/etc) so count is >=1, not exactly 1.
    await expect(page.locator('.ta-sync-banner-container .change-item').first()).toBeAttached({ timeout: 20000 })
    expect(await page.locator('.ta-sync-banner-container .change-item').count()).toBeGreaterThanOrEqual(1)
    const badgeText = await page.locator('.ta-sync-banner-container .badge-assignment').first().textContent()
    expect(badgeText && badgeText.trim().length).toBeGreaterThan(0)
  })

  test('banner h1 == "Sünkroniseerimata muudatused" + Sünkroniseeri kõik button visible when diffs > 0', async() => {
    const page = await loadJournalsWithDiffs()
    await expect(page.locator('.ta-sync-banner-container h1').first()).toHaveText('Sünkroniseerimata muudatused', { timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Sünkroniseeri kõik' })).toBeVisible()
  })

  test('empty scenario renders 0 .change-item rows (silent when nothing to sync)', async() => {
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'empty')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    // Wait for the sync-check to fire so we know the feature actually executed.
    await expect.poll(
      () => kriit.requestLog.some(r => r.path === '/api/subjects/getDifferences'),
      { timeout: 20000 }
    ).toBe(true)
    // Give the renderer a moment after the check resolves.
    await page.waitForTimeout(500)
    expect(await page.locator('.ta-sync-banner-container .change-item').count()).toBe(0)
  })

  test('Sünkroniseeri kõik click shows .sync-spinner inside the button (UI state during sync)', async() => {
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'diffsAndNew')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    const syncBtn = page.getByRole('button', { name: 'Sünkroniseeri kõik' })
    await expect(syncBtn).toBeVisible({ timeout: 20000 })
    // Spinner is rendered hidden inside the button; click should reveal it.
    await syncBtn.click()
    await expect(page.locator('.ta-sync-banner-container .sync-spinner').first()).toBeVisible({ timeout: 3000 })
  })

  test('newAssignments scenario renders .new-assignment-dates with Sissekanne + Tähtaeg dates', async() => {
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'newAssignments')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.ta-sync-banner-container .new-assignment-dates').first()).toBeAttached({ timeout: 20000 })
    await expect(page.locator('.ta-sync-banner-container .date-entry').first()).toContainText('Sissekanne:')
    await expect(page.locator('.ta-sync-banner-container .date-due').first()).toContainText('Tähtaeg:')
  })
})
