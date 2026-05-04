import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'
import { startKriitServer } from './helpers/kriitServer.js'
import { enableKriitFully } from './helpers/enableKriit.js'

test.describe('SentryService init + error handling', () => {
  let context, extensionId, serviceWorker, kriit

  test.beforeAll(async() => {
    kriit = await startKriitServer()
  })

  test.afterAll(async() => {
    kriit.stop()
  })

  test.beforeEach(async() => {
    ({ context, extensionId, serviceWorker } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('content script init does not raise pageerror or block extension', async() => {
    const errors = []
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })
    // Extension activation includes sentryService.init() (content.js:14).
    // Any crash inside SentryService init would surface as pageerror or as
    // missing extension-injected DOM markers.
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
    expect(errors).toEqual([])
  })

  test('Logger.error in extension code is forwarded to Sentry as envelope POST', async() => {
    // Hard-test of the full chain. With Kriit enabled, JournalListSync runs
    // collectJournalData over the captured journals. Anonymized fixtures for
    // 404498/404490 lack student-personal-code mappings, which throws and
    // hits Logger.error at JournalListSync.js:1082 → sentryService
    // .captureException → chrome.runtime.sendMessage → background.js:241
    // fetch to the Sentry ingest endpoint. We stub fetch in the SW (where
    // the envelope POST originates) since context.route() does not
    // intercept SW-originated requests.
    //
    // Page-world synthetic errors do NOT reach the content-script listener
    // (Chrome isolates window.onerror per world), so we rely on a real
    // Logger.error path for an authentic chain trigger.
    await serviceWorker.evaluate(() => {
      globalThis.__sentryCaptured = []
      // Idempotent stub: SW persists across tests in the worker, so capture
      // the real fetch only once. Subsequent tests re-zero the array.
      if (!globalThis.__sentryFetchOrig) {
        globalThis.__sentryFetchOrig = globalThis.fetch
        globalThis.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input?.url
          if (url && url.includes('.sentry.io')) {
            globalThis.__sentryCaptured.push({ url, body: init?.body })
            return Promise.resolve(new Response('{"id":"stub"}', { status: 200 }))
          }
          return globalThis.__sentryFetchOrig(input, init)
        }
      }
    })

    await enableKriitFully(context, extensionId, { apiUrl: `${kriit.origin}/api` })

    const errors = []
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })

    // Wait for the chain: Logger.error → SentryService.captureException
    // → chrome.runtime.sendMessage → background fetch (caught by stub).
    await expect.poll(
      async() => serviceWorker.evaluate(() => globalThis.__sentryCaptured.length),
      { timeout: 20000 }
    ).toBeGreaterThanOrEqual(1)

    const captured = await serviceWorker.evaluate(() => globalThis.__sentryCaptured)
    expect(captured[0].url).toMatch(/^https:\/\/[a-z0-9.]+\.sentry\.io\/api\/\d+\/envelope\/$/)
    // Envelope is newline-delimited JSON: `{header}\n{itemHeader}\n{itemBody}`
    // (SentryService.js:166). Verify all three lines and that the payload
    // carries an extension-originated error — not just any envelope shape.
    const lines = captured[0].body.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    const header = JSON.parse(lines[0])
    expect(header).toHaveProperty('event_id')
    expect(header.dsn).toMatch(/sentry\.io/)
    const itemHeader = JSON.parse(lines[1])
    expect(itemHeader.type).toBe('event')
    const event = JSON.parse(lines[2])
    expect(event.platform).toBe('javascript')
    expect(event.level).toBe('error')
    expect(event.release).toMatch(/^opetaja-assistent2@/)
    // The extension URL context proves the event originated in our content
    // script, not from some other Sentry-using code on the page.
    expect(event.contexts?.extension?.url).toContain('tahvel.edu.ee')
    // Either an exception event (exception.values[].value) or a message
    // event (message.formatted) — both come from Logger.error.
    const errorText = event.exception?.values?.[0]?.value || event.message?.formatted || ''
    expect(errorText.length).toBeGreaterThan(0)

    // Extension still alive after the round-trip.
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached()
    expect(errors).toEqual([])
  })
})
