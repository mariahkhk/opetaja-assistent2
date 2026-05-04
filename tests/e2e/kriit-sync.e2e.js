import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'
import { startKriitServer } from './helpers/kriitServer.js'
import { enableKriitFully } from './helpers/enableKriit.js'

const SYNC_BTN = '#oa2-kriit-sync-header-button'

test.describe('Kriit sync E2E', () => {
  let context, extensionId, kriit

  test.beforeAll(async() => {
    kriit = await startKriitServer()
  })

  test.afterAll(async() => {
    kriit.stop()
  })

  test.beforeEach(async() => {
    ({ context, extensionId } = await launchWithExtension())
    await enableKriitFully(context, extensionId, { apiUrl: `${kriit.origin}/api` })
  })

  test.afterEach(async() => {
    await context.close()
  })

  async function loadJournals(scenario) {
    kriit.setResponse(scenario)
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    // HTTP (not HTTPS) so background SW can fetch HTTP Kriit without
    // mixed-content blocking (manifest matches both http and https).
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    return page
  }

  test('HeaderSyncButton stays hidden when Kriit returns no diffs and no newAssignments', async() => {
    const page = await loadJournals('empty')
    await expect(page.locator(SYNC_BTN)).toBeAttached({ timeout: 10000 })
    await page.waitForTimeout(3000) // 2s sync-check interval + grace
    await expect(page.locator(SYNC_BTN)).toBeHidden()
  })

  test('HeaderSyncButton becomes visible when Kriit returns differences', async() => {
    const page = await loadJournals('diffs')
    await expect(page.locator(SYNC_BTN)).toBeVisible({ timeout: 20000 })
  })

  test('HeaderSyncButton becomes visible when Kriit returns newAssignments only', async() => {
    const page = await loadJournals('newAssignments')
    await expect(page.locator(SYNC_BTN)).toBeVisible({ timeout: 20000 })
  })

  test('extension survives Kriit returning 500 (button hidden, no pageerror)', async() => {
    const errors = []
    const page = await loadJournals(500)
    page.on('pageerror', e => errors.push(e.message))
    await expect(page.locator(SYNC_BTN)).toBeAttached({ timeout: 10000 })
    await page.waitForTimeout(4000)
    await expect(page.locator(SYNC_BTN)).toBeHidden()
    expect(errors).toEqual([])
  })

  test('extension survives Kriit returning invalid JSON (button hidden, no pageerror)', async() => {
    const errors = []
    const page = await loadJournals('invalid-json')
    page.on('pageerror', e => errors.push(e.message))
    await expect(page.locator(SYNC_BTN)).toBeAttached({ timeout: 10000 })
    await page.waitForTimeout(4000)
    await expect(page.locator(SYNC_BTN)).toBeHidden()
    expect(errors).toEqual([])
  })

  test('HeaderSyncButton text == "Sünkroonimine vajalik" + matching aria-label', async() => {
    const page = await loadJournals('diffs')
    const btn = page.locator(SYNC_BTN)
    await expect(btn).toBeVisible({ timeout: 20000 })
    await expect(btn).toHaveText('Sünkroonimine vajalik')
    await expect(btn).toHaveAttribute('aria-label', 'Sünkroonimine vajalik')
  })

  test('HeaderSyncButton appears on a journal-edit page (not just /#/journals) when diffs present', async() => {
    kriit.setResponse('diffs')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journal/404498/edit')
    await page.goto('https://tahvel.edu.ee/#/journal/404498/edit', { waitUntil: 'domcontentloaded' })
    await expect(page.locator(SYNC_BTN)).toBeVisible({ timeout: 20000 })
  })

  test('HeaderSyncButton click navigates to /#/journals from a journal-edit page', async() => {
    kriit.setResponse('diffs')
    const page = await context.newPage()
    await mockTahvel(page, '/#/journal/404498/edit')
    await page.goto('https://tahvel.edu.ee/#/journal/404498/edit', { waitUntil: 'domcontentloaded' })
    await expect(page.locator(SYNC_BTN)).toBeVisible({ timeout: 20000 })
    await page.locator(SYNC_BTN).click()
    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('#/journals')
  })
})
