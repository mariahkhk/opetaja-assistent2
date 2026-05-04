import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'

const JOURNAL_ROUTE = '/#/journal/404498/edit'
const JOURNAL_URL = `https://tahvel.edu.ee${JOURNAL_ROUTE}`

test.describe('content script on single-journal edit page', () => {
  let context

  test.beforeEach(async() => {
    ({ context } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('TimetableDiscrepancy header button injects on this page too', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
  })

  test('no console pageerrors during content-script activation', async() => {
    const page = await context.newPage()
    const pageerrors = []
    page.on('pageerror', err => pageerrors.push(err.message))
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    // Wait for activation to complete deterministically, then flush microtasks
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await page.waitForLoadState('networkidle')
    expect(pageerrors).toEqual([])
  })
})

test.describe('multiple captured journal IDs all work', () => {
  let context

  test.beforeEach(async() => {
    ({ context } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  for (const journalId of [404498, 404490, 402872]) {
    test(`journal ${journalId} edit page injects header button + HighlightMissingGrades style`, async() => {
      const page = await context.newPage()
      await mockTahvel(page, `/#/journal/${journalId}/edit`)
      await page.goto(`https://tahvel.edu.ee/#/journal/${journalId}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
      await expect(page.locator('#highlight-missing-grade-style')).toBeAttached({ timeout: 10000 })
    })
  }
})

test.describe('feature-specific assertions on single-journal edit', () => {
  let context

  test.beforeEach(async() => {
    ({ context } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('HighlightGradeCellsFeature colors positive (5,4) and negative (MA,1) grade cells', async() => {
    // Fixture has real Tahvel-rendered table with grade-cell divs in
    // first 2 rows containing values: row0='5','MA'; row1='4','1'.
    // Expect feature to apply oa2-grade-cell-positive (for 5,4) and
    // oa2-grade-cell-negative (for MA,1) classes to the parent <td>.
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('td.oa2-grade-cell-positive').first()).toBeAttached({ timeout: 15000 })
    await expect(page.locator('td.oa2-grade-cell-negative').first()).toBeAttached({ timeout: 15000 })
    expect(await page.locator('td.oa2-grade-cell-positive').count()).toBeGreaterThanOrEqual(2)
    expect(await page.locator('td.oa2-grade-cell-negative').count()).toBeGreaterThanOrEqual(2)
  })

  test('LessonDiscrepanciesFeature injects discrepancies table on journal-edit page', async() => {
    // Use HTTPS — feature awaits cacheService.clearJournalCache which needs
    // crypto.subtle (secure-context only). HTTP page broke wipeReady chain.
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('[data-discrepancies-table]')).toBeAttached({ timeout: 30000 })
    expect(errors).toEqual([])
  })

  test('LastLessonNotificationFeature injects #last-lesson-inline-notification banner', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    // Fixture journal_entries dates are in past → feature determines "past
    // last lesson" → injects banner (gray variant). Hard-asserts the banner
    // element appears, proving the feature's banner-creation path runs.
    await expect(page.locator('#last-lesson-inline-notification')).toBeAttached({ timeout: 15000 })
  })

  test('HighlightMissingGradesFeature injects #highlight-missing-grade-style (unconditional)', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    // Hard: feature unconditionally injects its style tag at init
    // (HighlightMissingGradesFeature.js:14-16). If feature breaks before
    // injecting style, this fails — proves init reached the injection step.
    await expect(page.locator('#highlight-missing-grade-style')).toBeAttached({ timeout: 15000 })
  })

  test('HighlightFinalGradesFeature highlights empty final-grade cells (red, past final lesson)', async() => {
    const page = await context.newPage()
    // Cross-world: window.__oa2ComparisonDate set in main world is readable
    // by content script (window object is shared even across isolated worlds).
    // Setting comparisonDate after fixture's lesson dates → past final lesson
    // → red warning per getWarningLevel.
    await page.addInitScript(() => { window.__oa2ComparisonDate = '2026-04-30' })
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('.highlight-final-grade-red').first()).toBeAttached({ timeout: 15000 })
    expect(await page.locator('.highlight-final-grade-red').count()).toBeGreaterThan(0)
  })

  test('FinalGradesManagementFeature injects button + grading-mode select', async() => {
    // Fixture has SISSEKANNE_L entry → detectLGrades returns true → feature
    // activates and injects .oa-final-grades-btn after #studentTable AND
    // #oa-grading-mode-select dropdown.
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('.oa-final-grades-btn').first()).toBeAttached({ timeout: 15000 })
    await expect(page.locator('#oa-grading-mode-select')).toBeAttached({ timeout: 15000 })
  })

  test('extension survives /journals/:id API returning 500', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.route(/hois_back\/journals\/404498(\?|$)/, async route => {
      await route.fulfill({ status: 500, body: '{"error":"server"}' })
    })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    // Header features don't depend on /journals/:id detail; locator's own
    // timeout polls for it — no separate hard wait needed.
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
    expect(errors).toEqual([])
  })

  test('TimetableDiscrepancy header button click navigates to /#/journals', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    const btn = page.locator('#oa2-timetable-discrepancy-header-button')
    await expect(btn).toBeAttached({ timeout: 15000 })
    // Force-show via DOM mutation: click handler is event-delegated on
    // document.body so works even when display:none, but Playwright still
    // requires visibility for click() — force:true bypasses some checks but
    // not all in Chromium isolated context. Show the button explicitly.
    await page.evaluate(() => {
      const el = document.getElementById('oa2-timetable-discrepancy-header-button')
      if (el) el.style.display = 'inline-block'
    })
    await btn.click()
    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('#/journals')
  })

  test('LessonDiscrepancies table thead has Kuupäev + Tegevus headers', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('[data-discrepancies-table]')).toBeAttached({ timeout: 30000 })
    const headers = await page.locator('[data-discrepancies-table] thead th').allTextContents()
    expect(headers).toContain('Kuupäev')
    expect(headers).toContain('Tegevus')
  })

  test('LessonDiscrepancies table renders >=1 tbody row when discrepancies exist', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('[data-discrepancies-table]')).toBeAttached({ timeout: 30000 })
    expect(await page.locator('[data-discrepancies-table] tbody tr').count()).toBeGreaterThan(0)
  })

  test('LessonDiscrepancies renders fix-action buttons with .oa2-btn class', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('[data-discrepancies-table]')).toBeAttached({ timeout: 30000 })
    expect(await page.locator('[data-discrepancies-table] button.oa2-btn').count()).toBeGreaterThan(0)
  })

  test('LastLessonNotification banner has one of the documented background colors', async() => {
    // Banner color tier (yellow/red/gray) depends on isPast/isLastLessonToday
    // computed against real today (Tallinn TZ) and lesson dates parsed from
    // banner text. Without controlling time and forcing a specific lesson
    // date in fixtures, we can only assert that the banner ended up in ONE
    // of the documented states from LastLessonNotificationFeature.js:234-241.
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    const banner = page.locator('#last-lesson-inline-notification')
    await expect(banner).toBeAttached({ timeout: 15000 })
    const bg = await banner.evaluate(el => getComputedStyle(el).backgroundColor)
    // yellow #fff3cd / red #ffcccc / gray #e9ecef
    expect(['rgb(255, 243, 205)', 'rgb(255, 204, 204)', 'rgb(233, 236, 239)']).toContain(bg)
  })

  test('LastLessonNotification banner contains user-readable Estonian message', async() => {
    // Two valid messages per LastLessonNotificationFeature.js:228-232:
    //  - "Viimane tund toimus/toimub DD.MM.YYYY" (when timetable date resolved)
    //  - "NB! Õppetöö kirjed on olemas, kuid tunniplaani andmeid ei leitud"
    //    (fallback when timetable data couldn't resolve date)
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    const banner = page.locator('#last-lesson-inline-notification')
    await expect(banner).toBeAttached({ timeout: 15000 })
    await expect(banner).toHaveText(/Viimane tund|tunniplaani andmeid ei leitud/, { timeout: 5000 })
  })

  test('HighlightGradeCells positive cells have green bg, negative cells have red bg', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.locator('td.oa2-grade-cell-positive').first()).toBeAttached({ timeout: 15000 })
    // Positive #b6e1cd = rgb(182, 225, 205) per HighlightGradeCellsFeature.js:86.
    await expect(page.locator('td.oa2-grade-cell-positive').first()).toHaveCSS('background-color', 'rgb(182, 225, 205)')
    await expect(page.locator('td.oa2-grade-cell-negative').first()).toBeAttached({ timeout: 15000 })
    // Negative #f4c7c3 = rgb(244, 199, 195) per HighlightGradeCellsFeature.js:96.
    await expect(page.locator('td.oa2-grade-cell-negative').first()).toHaveCSS('background-color', 'rgb(244, 199, 195)')
  })

  test('FinalGradesManagement click .oa-final-grades-btn opens #oa-final-grades-results container', async() => {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    const btn = page.locator('.oa-final-grades-btn').first()
    await expect(btn).toBeAttached({ timeout: 15000 })
    await btn.click({ force: true })
    await expect(page.locator('#oa-final-grades-results')).toBeAttached({ timeout: 10000 })
    expect(errors).toEqual([])
  })

  test('FinalGradesManagement #oa-grading-mode-select has Mitteeristav + Eristav options', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#oa-grading-mode-select')).toBeAttached({ timeout: 15000 })
    const optionTexts = await page.locator('#oa-grading-mode-select option').allTextContents()
    expect(optionTexts.some(t => t.includes('Mitteeristav hindamine'))).toBe(true)
    expect(optionTexts.some(t => t.includes('Eristav'))).toBe(true)
  })

  test('FinalGradesManagement button text matches expected Estonian copy', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    const btn = page.locator('.oa-final-grades-btn').first()
    await expect(btn).toBeAttached({ timeout: 15000 })
    // One of the variants per FinalGradesManagementFeature.js:446-754.
    await expect(btn).toHaveText(/Lisa lõpptulemuse hinded|Lisa õpiväljundite hinded|Uuenda õpiväljundite hinded|Kõik hinded on õiged/, { timeout: 10000 })
  })
})
