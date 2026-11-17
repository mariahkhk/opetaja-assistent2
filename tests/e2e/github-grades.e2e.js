import { expect } from '@playwright/test'
import { test, launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'

const JOURNAL_ID = 404498
const JOURNAL_ROUTE = `/#/journal/${JOURNAL_ID}/edit`
const JOURNAL_URL = `https://tahvel.edu.ee${JOURNAL_ROUTE}`
const ENTRY_ID = 3627437 // lesson without grades in the fixture
const CSV = 'Ülesanne,Õpilane,Punktid,Max\nlab-01,Anonüümne9,9,10\nlab-01,Anonüümne13,4,10\n'

/**
 * GitHub requests go through the extension's service worker, which page.route() cannot see.
 * Replace fetch there for GitHub hosts only; everything else still reaches the real fetch.
 */
async function mockGitHub(serviceWorker, files) {
  await serviceWorker.evaluate(files => {
    globalThis.__oaRealFetch ??= globalThis.fetch
    globalThis.fetch = (url, init) => {
      const u = String(url)
      if (!/^https:\/\/(raw\.githubusercontent\.com|api\.github\.com)\//.test(u)) return globalThis.__oaRealFetch(url, init)
      const hit = Object.keys(files).find(part => u.includes(part))
      return Promise.resolve(hit ? new Response(files[hit], { status: 200 }) : new Response('Not Found', { status: 404 }))
    }
  }, files)
}

async function restoreFetch(serviceWorker) {
  await serviceWorker.evaluate(() => {
    if (globalThis.__oaRealFetch) globalThis.fetch = globalThis.__oaRealFetch
  })
}

async function setStorage(serviceWorker, items) {
  await serviceWorker.evaluate(items => new Promise(resolve => chrome.storage.local.set(items, resolve)), items)
}

async function chooseGradeSource(context, extensionId, source) {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  // The popup shows "github" before anything is saved; pick another value first so "change" fires
  await popup.locator('#grade-source').selectOption(source === 'kriit' ? 'github' : 'kriit')
  await popup.locator('#grade-source').selectOption(source)
  await expect(popup.locator('#github-save-status')).toHaveText('Värskenda Tahvli lehte.')
  await popup.close()
}

test.describe('GitHub / Classroom 50 grades on the journal page', () => {
  let context, extensionId, serviceWorker

  test.beforeEach(async() => {
    ({ context, extensionId, serviceWorker } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await restoreFetch(serviceWorker)
    await context.close()
  })

  test('Kriit users see no GitHub button', async() => {
    await chooseGradeSource(context, extensionId, 'kriit')
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    // Wait until the other single-journal features are in, so the button would have had time to appear
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /^(GitHub|Classroom 50)$/ })).toHaveCount(0)
  })

  test('choosing Classroom 50 in the popup puts a "Classroom 50" button on the journal page', async() => {
    await chooseGradeSource(context, extensionId, 'classroom50')
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Classroom 50', exact: true })).toBeVisible({ timeout: 15000 })
  })

  test('the GitHub button loads the grades file and previews new grades, then writes the ticked ones', async() => {
    await chooseGradeSource(context, extensionId, 'github')
    await setStorage(serviceWorker, {
      [`OA_ghJournal_${JOURNAL_ID}`]: { repo: 'minu-org/hinded', file: 'is24/hinded.csv', assignmentMap: { 'lab-01': ENTRY_ID } }
    })
    await mockGitHub(serviceWorker, { 'minu-org/hinded/HEAD/is24/hinded.csv': CSV })

    const page = await context.newPage()
    const pageerrors = []
    page.on('pageerror', err => pageerrors.push(err.message))
    await mockTahvel(page, JOURNAL_ROUTE)

    // Writing: read the entry, then PUT it back with the new grades
    const puts = []
    await page.route(`**/hois_back/journals/${JOURNAL_ID}/journalEntry/${ENTRY_ID}*`, async route => {
      if (route.request().method() === 'PUT') {
        puts.push(route.request().postDataJSON())
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: ENTRY_ID, entryType: 'SISSEKANNE_T', nameEt: 'Andmebaasiserverite haldus', journalEntryStudents: [], journalEntryTeachers: [] })
      })
    })

    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'GitHub', exact: true }).click({ timeout: 15000 })

    await expect(page.getByText('GitHub: minu-org/hinded → is24/hinded.csv')).toBeVisible({ timeout: 15000 })
    const rows = page.locator('table tr').filter({ has: page.locator('input[type="checkbox"]') })
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'Anonüümne9' })).toContainText('9/10 (90%)')
    await expect(rows.filter({ hasText: 'Anonüümne9' }).locator('td').last()).toHaveText('5')
    await expect(rows.filter({ hasText: 'Anonüümne13' }).locator('td').last()).toHaveText('2')

    // Write only Anonüümne9
    await rows.filter({ hasText: 'Anonüümne13' }).locator('input').uncheck()
    await page.getByRole('button', { name: 'Kirjuta valitud hinded Tahvlisse' }).click()
    await expect(page.getByText('Valmis: 1 hinnet kirjutatud')).toBeVisible({ timeout: 10000 })

    expect(puts).toHaveLength(1)
    expect(puts[0].journalEntryStudents).toHaveLength(1)
    expect(puts[0].journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_5')
    expect(pageerrors).toEqual([])
  })

  test('a missing grades file opens the settings with an error instead of a dead end', async() => {
    await chooseGradeSource(context, extensionId, 'github')
    await setStorage(serviceWorker, { [`OA_ghJournal_${JOURNAL_ID}`]: { repo: 'minu-org/hinded', file: 'puudub.csv' } })
    await mockGitHub(serviceWorker, {})

    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'GitHub', exact: true }).click({ timeout: 15000 })

    await expect(page.getByText('Faili ei leitud')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Hinnete fail repos')).toBeVisible()
  })
})
