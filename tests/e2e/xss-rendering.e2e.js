import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'
import { startKriitServer } from './helpers/kriitServer.js'
import { enableKriitFully } from './helpers/enableKriit.js'

// End-to-end XSS tests: inject malicious HTML into the API responses that
// feed real rendering paths, then assert in a REAL browser that the payload
// is rendered as inert text and never executes. Unlike the JSDOM unit tests
// (which can only prove the structural difference between textContent and
// innerHTML), these prove actual non-execution — a vulnerable innerHTML
// regression makes the browser fire onerror/onload and set window.__xss.

const JOURNAL_ID = 404498
const JOURNAL_ROUTE = `/#/journal/${JOURNAL_ID}/edit`
const JOURNAL_URL = `https://tahvel.edu.ee${JOURNAL_ROUTE}`

// img.onerror fires reliably in a real browser when src fails to load; svg
// onload fires on parse. Both set window.__xss if the markup is ever parsed
// as HTML instead of inserted as text.
const IMG_XSS = '<img src=x onerror="window.__xss=true">'
const SVG_XSS = '<svg onload="window.__xss=true"></svg>'

function stripSoftHyphens(text) {
  return (text || '').replace(/­/g, '')
}

// The per-worker context is reused across tests; clearExtensionStorage only
// wipes chrome.storage, not the persisted Cache API. Without this, one test's
// cached Tahvel/Kriit responses leak into the next and the feature renders
// stale data (e.g. the sync button/banner fails to appear).
async function clearExtensionCaches(serviceWorker) {
  await serviceWorker.evaluate(async() => {
    const keys = await caches.keys()
    await Promise.all(keys.map(k => caches.delete(k)))
  }).catch(() => { /* SW may be idle; next page reload re-registers it */ })
}

test.describe('XSS — feature rendering paths neutralize injected markup', () => {
  let context, serviceWorker

  test.beforeEach(async() => {
    ({ context, serviceWorker } = await launchWithExtension())
    await clearExtensionCaches(serviceWorker)
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('AssignmentTitleRow renders a malicious assignment name (nameEt) as inert text', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)

    // The single-journal page fixture already contains the real journal table
    // (date columns 10.09, 11.09, …). The feature fetches journalEntriesByDate
    // and renders each entry's nameEt into the title row aligned to its date
    // column. Take the real fixture and poison every nameEt with an XSS
    // payload — a malicious teacher-entered assignment name is the realistic
    // attacker vector. Keeping the real dates means the titles still render.
    const fixturePath = path.resolve(
      'tests/fixtures/tahvel/api/journals_404498_journalEntriesByDate_allStudents_false.json'
    )
    const realEntries = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    const poisoned = realEntries.map(e => ({ ...e, nameEt: IMG_XSS, content: IMG_XSS }))
    await page.route(/journalEntriesByDate/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(poisoned)
    }))

    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })

    const titleText = page.locator('.oa2-assignment-title-row__text')
    await expect(titleText.first()).toBeAttached({ timeout: 15000 })

    // The visible cell text is truncated for layout, but the literal opening
    // "<img src=x" proves it is rendered as text, not parsed markup. The full
    // payload lives intact in the cell's data-full-text (soft hyphens from the
    // hyphenator are cosmetic and stripped before comparison).
    const visible = stripSoftHyphens(await titleText.first().textContent())
    expect(visible).toContain('<img src=x')
    const fullText = stripSoftHyphens(
      await page.locator('thead tr.oa2-assignment-title-row th[data-full-text]').first().getAttribute('data-full-text')
    )
    expect(fullText).toBe(IMG_XSS)

    // No element was parsed into the DOM, and nothing executed.
    const titleRow = page.locator('thead tr.oa2-assignment-title-row')
    expect(await titleRow.locator('img, svg, script').count()).toBe(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })

  test('AssignmentTitleRow hover tooltip renders the malicious name as inert text', async() => {
    // Hover + tooltip on a reused per-worker context is heavier than the 30s
    // default; give it headroom rather than relying on retries.
    test.setTimeout(60_000)
    // When a title is too long for its column it is truncated and the full
    // value is shown in a hover tooltip via _showTooltip → textContent. The
    // payload (entry.nameEt) is long enough to truncate, so the tooltip path
    // is exercised.
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    const fixturePath = path.resolve(
      'tests/fixtures/tahvel/api/journals_404498_journalEntriesByDate_allStudents_false.json'
    )
    const realEntries = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    const poisoned = realEntries.map(e => ({ ...e, nameEt: IMG_XSS, content: IMG_XSS }))
    await page.route(/journalEntriesByDate/, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(poisoned)
    }))
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })

    const truncated = page.locator('.oa2-assignment-title-row__text--truncated').first()
    await expect(truncated).toBeAttached({ timeout: 20000 })
    const tooltip = page.locator('.oa2-assignment-title-row__tooltip')
    // Trigger the delegated mouseover listener deterministically rather than
    // relying on a physical hover (which is timing-flaky under load).
    await truncated.evaluate(el => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await expect(tooltip).toBeVisible({ timeout: 5000 })
    expect(stripSoftHyphens(await tooltip.textContent())).toContain(IMG_XSS)
    expect(await tooltip.locator('img, svg, script').count()).toBe(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })

  test('HighlightGradeCells tooltip renders a malicious grade comment as inert text', async() => {
    test.setTimeout(60_000)
    // The custom grade tooltip shows the cell's comment/title (authored in
    // Tahvel, attacker-controllable) via _showTooltip → textContent. Drive the
    // real highlighted cells, plant a malicious title, then hover.
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })

    const cell = page.locator('td.oa2-grade-cell-positive, td.oa2-grade-cell-negative').first()
    await expect(cell).toBeAttached({ timeout: 20000 })

    // Plant a malicious "grade comment" as the native title the feature reads,
    // then trigger the delegated mouseover listener deterministically.
    await cell.evaluate((el, payload) => {
      el.setAttribute('title', payload)
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    }, IMG_XSS)

    const tooltip = page.locator('.oa2-grade-tooltip')
    await expect(tooltip).toBeVisible({ timeout: 5000 })
    expect(await tooltip.textContent()).toContain(IMG_XSS)
    expect(await tooltip.locator('img, svg, script').count()).toBe(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })
})

test.describe('XSS — Kriit sync data is rendered as inert text', () => {
  let context, extensionId, kriit, serviceWorker

  test.beforeAll(async() => {
    kriit = await startKriitServer()
  })

  test.afterAll(async() => {
    kriit.stop()
  })

  test.beforeEach(async() => {
    kriit.requestLog.length = 0
    ;({ context, extensionId, serviceWorker } = await launchWithExtension())
    await clearExtensionCaches(serviceWorker)
    await enableKriitFully(context, extensionId, { apiUrl: `${kriit.origin}/api` })
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('JournalSyncBanner renders malicious Kriit assignment names as inert text', async() => {
    // newAssignments come straight from Kriit (no Tahvel-side comparison), so
    // their assignmentName flows directly into the sync banner. A compromised
    // or malicious Kriit response is the attacker vector here.
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'xss')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })

    const banner = page.locator('.ta-sync-banner-container').first()
    await expect(banner).toBeAttached({ timeout: 20000 })

    // Both payloads are rendered as literal text.
    await expect(banner).toContainText('<img src=x onerror=')
    await expect(banner).toContainText('<svg onload=')

    // No element was parsed into the DOM, and nothing executed in the browser.
    expect(await banner.locator('img, svg, script').count()).toBe(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })

  test('sync-failure error banner renders a malicious assignment id as inert text', async() => {
    // The full sync chain (page-wide sync-check → click → Tahvel writes →
    // The sync chain iterates journals + has internal sleeps; allow headroom.
    test.setTimeout(60_000)
    // When grade write-back fails, buildSyncFailureMessage interpolates the
    // Kriit assignment identifier into the error message, rendered via
    // JournalSyncBanner showSyncErrorBanner (message.textContent). A malicious
    // Kriit assignmentExternalId is the attacker vector. Force the Tahvel PUT
    // to fail so the failure path runs.
    kriit.setEndpointResponse('/api/subjects/getDifferences', 'gradeXss')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.route(/\/hois_back\/journals\/\d+\/journalEntry\/\d+/, route =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' })
        : route.fallback())
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })

    const syncBtn = page.getByRole('button', { name: 'Sünkroniseeri kõik' })
    await expect(syncBtn).toBeVisible({ timeout: 20000 })
    // The version-update modal (shown on a fresh-install context, which the
    // per-test storage wipe recreates) overlays the page and intercepts the
    // click — Playwright then hangs on actionability. Remove it before clicking.
    await page.evaluate(() => document.getElementById('oa2-update-modal')?.remove())
    await syncBtn.click()

    const errorBanner = page.locator('.ta-sync-error')
    await expect(errorBanner).toBeVisible({ timeout: 20000 })

    // The malicious assignment id is rendered as literal text in the message.
    await expect(errorBanner).toContainText('<img src=x onerror=')
    expect(await errorBanner.locator('img, svg, script').count()).toBe(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })
})
