import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'

async function enableKriit(context, extensionId) {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.locator('label[for="kriit-enabled"]').click()
  await popup.close()
}

test.describe('content script on /#/journals (Kriit OFF)', () => {
  let context

  test.beforeEach(async() => {
    ({ context } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('TimetableDiscrepancy header button injects (does not require Kriit)', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
  })

  test('Kriit-gated HeaderSyncButton stays out when Kriit disabled', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    // Anchor on a feature that DOES inject (timetable button) so we know
    // extension activation completed; then assert Kriit button stays absent.
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('#oa2-kriit-sync-header-button')).toHaveCount(0)
  })
})

test.describe('content script on /#/journals (Kriit ON)', () => {
  let context, extensionId

  test.beforeEach(async() => {
    ({ context, extensionId } = await launchWithExtension())
    await enableKriit(context, extensionId)
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('HeaderSyncButton injects when Kriit enabled', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-kriit-sync-header-button')).toBeAttached({ timeout: 10000 })
  })

  test('both header buttons present when Kriit enabled', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-kriit-sync-header-button')).toBeAttached({ timeout: 10000 })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
  })
})

test.describe('feature-specific assertions on /#/journals', () => {
  let context

  test.beforeEach(async() => {
    ({ context } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('LessonCountWarningFeature shows indicator when journal lessons mismatch timetable', async() => {
    // Setup: journal 404498 has lessonHours.MAHT_a.usedHours=20, timetable
    // fixture has 0 past events → mismatch → indicator must appear.
    // /teachers fixture provides at least one teacher matching school.id=9.
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    // Hard assertion: at least one .oa-warning-indicator injected
    await expect(page.locator('.oa-warning-indicator').first()).toBeAttached({ timeout: 15000 })
    const count = await page.locator('.oa-warning-indicator').count()
    expect(count).toBeGreaterThan(0)
  })

  test('FinalGradeWarningFeature shows yellow indicator when final lesson 5 days away with missing outcome grades', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')

    // Craft fixture overrides for journal 404498:
    //   - SISSEKANNE_O outcome entry with finalLessonDate = today + 5 days
    //     (within 7-day warning window → yellow per getWarningLevel)
    //   - 1 active student, 0 grades → hasMissingFinalGrades = true
    const today = new Date()
    const futureDate = new Date(today.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const entries = [{
      id: 1,
      entryType: 'SISSEKANNE_O',
      entryDate: futureDate,
      studentOutcomeResults: null,
      curriculumModuleOutcomes: 999
    }]
    await page.route(/\/hois_back\/journals\/404498\/journalEntriesByDate/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalStudents/, async route => {
      await route.fulfill({ status: 200,
contentType: 'application/json',
body: JSON.stringify([
        { studentId: 1, id: 1, status: 'OPPURSTAATUS_O' }
      ]) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalOutcome\/999/, async route => {
      await route.fulfill({ status: 200,
contentType: 'application/json',
body: JSON.stringify({
        outcomeStudents: [] // 0 graded → all missing
      }) })
    })

    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('.oa-final-grade-warning').first()).toBeAttached({ timeout: 15000 })
  })

  test('extension survives /journals API returning 500 (graceful degradation)', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    // Override after mockTahvel: any /journals query → 500
    await page.route(/hois_back\/journals\?/, async route => {
      await route.fulfill({ status: 500, body: '{"error":"server"}' })
    })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    // Header feature does not depend on /journals; toBeAttached polls itself.
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
    expect(errors).toEqual([])
  })

  test('LessonCountWarning indicator title contains "Päevikus puudub|on N tundi" copy', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('.oa-warning-indicator').first()).toBeAttached({ timeout: 15000 })
    const title = await page.locator('.oa-warning-indicator').first().getAttribute('title')
    // Templates from LessonCountWarningFeature.js:723-732 — singular/plural matrix.
    expect(title).toMatch(/Päevikus (puudub \d+ (tund|tundi)|on \d+ (liigne tund|liigset tundi))/)
  })

  test('LessonCountWarning indicator has 📅 emoji + pink background', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    const indicator = page.locator('.oa-warning-indicator').first()
    await expect(indicator).toBeAttached({ timeout: 15000 })
    await expect(indicator).toContainText('📅')
    // Hot pink #ff69b4 from LessonCountWarningFeature inline style.
    await expect(indicator).toHaveCSS('background-color', 'rgb(255, 105, 180)')
  })

  test('FinalGradeWarning shows red indicator when finalLessonDate is in the past', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    // Override journal 404498 entries: SISSEKANNE_O entryDate = today - 1 day.
    const today = new Date()
    const pastDate = new Date(today.getTime() - 1 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const entries = [{
      id: 1,
entryType: 'SISSEKANNE_O',
entryDate: pastDate,
      studentOutcomeResults: null,
curriculumModuleOutcomes: 999
    }]
    await page.route(/\/hois_back\/journals\/404498\/journalEntriesByDate/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalStudents/, async route => {
      await route.fulfill({ status: 200,
contentType: 'application/json',
body: JSON.stringify([
        { studentId: 1, id: 1, status: 'OPPURSTAATUS_O' }
      ]) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalOutcome\/999/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcomeStudents: [] }) })
    })
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    const warn = page.locator('.oa-final-grade-warning').first()
    await expect(warn).toBeAttached({ timeout: 15000 })
    // Red tier rgb(255, 221, 221) (#ffdddd) per FinalGradeWarningFeature.js:300-303.
    await expect(warn).toHaveCSS('background-color', 'rgb(255, 221, 221)')
  })

  test('FinalGradeWarning indicator text == "!" + title == "Lõpphinded puuduvad"', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    const today = new Date()
    const futureDate = new Date(today.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const entries = [{
      id: 1,
entryType: 'SISSEKANNE_O',
entryDate: futureDate,
      studentOutcomeResults: null,
curriculumModuleOutcomes: 999
    }]
    await page.route(/\/hois_back\/journals\/404498\/journalEntriesByDate/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalStudents/, async route => {
      await route.fulfill({ status: 200,
contentType: 'application/json',
body: JSON.stringify([
        { studentId: 1, id: 1, status: 'OPPURSTAATUS_O' }
      ]) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalOutcome\/999/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcomeStudents: [] }) })
    })
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    const warn = page.locator('.oa-final-grade-warning').first()
    await expect(warn).toHaveText('!', { timeout: 15000 })
    await expect(warn).toHaveAttribute('title', 'Lõpphinded puuduvad')
  })

  test('FinalGradeWarning shows NO indicator when final lesson is 14 days away (>7d window)', async() => {
    // Negative test — guards against eager warnings.
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    const today = new Date()
    const farFuture = new Date(today.getTime() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const entries = [{
      id: 1,
entryType: 'SISSEKANNE_O',
entryDate: farFuture,
      studentOutcomeResults: null,
curriculumModuleOutcomes: 999
    }]
    await page.route(/\/hois_back\/journals\/404498\/journalEntriesByDate/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalStudents/, async route => {
      await route.fulfill({ status: 200,
contentType: 'application/json',
body: JSON.stringify([
        { studentId: 1, id: 1, status: 'OPPURSTAATUS_O' }
      ]) })
    })
    await page.route(/\/hois_back\/journals\/404498\/journalOutcome\/999/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcomeStudents: [] }) })
    })
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    // Allow indicator processing to finish, then assert ABSENCE.
    await page.waitForTimeout(2000)
    expect(await page.locator('.oa-final-grade-warning').count()).toBe(0)
  })
})
