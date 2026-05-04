import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'
import { startKriitServer } from './helpers/kriitServer.js'
import { enableKriitFully } from './helpers/enableKriit.js'

// Hard-test for OutComes feature (src/features/journalList/OutComes.js).
// JournalListSync.fetchJournalData() auto-fires sendOutcomeEntriesToKriit
// after the initial Kriit sync. Journal 402872's entries fixture contains
// two SISSEKANNE_O outcome entries; this test asserts the resulting POST
// to /api/outcomes/sync hits Kriit with the expected payload shape.
//
// 402872 is used because 404498/404490 fail collectJournalData's student-
// personal-code lookup (anonymized fixture limitation) and never reach
// accessibleJournalIds. 402872's fixtures pass and OutComes is invoked.
const TARGET_JOURNAL_ID = 402872

test.describe('OutComes sync to Kriit', () => {
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

  test('SISSEKANNE_O entries are POSTed to /api/outcomes/sync with correct payload', async() => {
    const page = await context.newPage()
    await mockTahvel(page, '/#/journals')
    await page.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })

    await expect.poll(
      () => kriit.requestLog.some(
        r => r.method === 'POST' && r.path === '/api/outcomes/sync'
      ),
      { timeout: 30000 }
    ).toBe(true)

    const calls = kriit.requestLog.filter(
      r => r.method === 'POST' && r.path === '/api/outcomes/sync'
    )
    const payload = JSON.parse(calls[0].body)
    expect(Array.isArray(payload)).toBe(true)

    const fromTarget = payload.filter(p => p.subjectId === TARGET_JOURNAL_ID)
    expect(fromTarget.length).toBe(2)

    const byOutcome = Object.fromEntries(
      fromTarget.map(p => [p.curriculumModuleOutcomes, p])
    )
    expect(byOutcome[555001]).toMatchObject({
      subjectId: TARGET_JOURNAL_ID,
      curriculumModuleOutcomes: 555001,
      outcomeName: 'Õpitulemus 1',
      learningOutcomeOrderNr: 0
    })
    expect(byOutcome[555002]).toMatchObject({
      subjectId: TARGET_JOURNAL_ID,
      curriculumModuleOutcomes: 555002,
      outcomeName: 'Õpitulemus 2',
      learningOutcomeOrderNr: 1
    })
  })
})
