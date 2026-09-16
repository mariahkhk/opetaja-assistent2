import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Build production lesson modules with explicit test-only boundary seams in a disposable extension. */
export async function launchLessonHarness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oa2-lesson-verification-'))
  const extension = path.join(directory, 'extension')
  await fs.mkdir(extension)
  const build = await Bun.build({
    entrypoints: ['tests/fixtures/lesson-notifications/background.js', 'tests/fixtures/lesson-notifications/content.js', 'src/popup.js'],
    outdir: extension, naming: '[name].js', target: 'browser'
  })
  if (!build.success) throw new Error(build.logs.join('\n'))
  await fs.copyFile('src/assets/templates/popup.html', path.join(extension, 'popup.html'))
  await fs.copyFile('src/assets/templates/icon.svg', path.join(extension, 'icon.svg'))
  const timesPath = 'src/features/singleJournal/lessonDiscrepancies/LessonTimes.json'
  await fs.mkdir(path.dirname(path.join(extension, timesPath)), { recursive: true })
  await fs.copyFile(timesPath, path.join(extension, timesPath))
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Lesson verification (synthetic data)', version: '1.0.0',
    permissions: ['storage', 'alarms', 'notifications', 'tabs'],
    host_permissions: ['https://tahvel.edu.ee/*', 'http://127.0.0.1/*'],
    background: { service_worker: 'background.js', type: 'module' },
    content_scripts: [{ matches: ['https://tahvel.edu.ee/*'], js: ['content.js'] }],
    action: { default_popup: 'popup.html' }
  }))
  const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP tahvel.edu.ee ~NOTFOUND']
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  const extensionId = worker.url().split('/')[2]
  const journal = await fs.readFile('tests/fixtures/lesson-notifications/journal.html', 'utf8')
  await context.route('https://tahvel.edu.ee/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/hois_back/')) return route.fulfill({ contentType: 'text/html', body: journal })
    let data
    if (url.pathname === '/hois_back/timetableevents') data = { totalPages: 1, content: [
      { journalId: 7, date: '2026-09-14', timeStart: '08:15', timeEnd: '09:00', studentGroups: [{ id: 1 }] }
    ] }
    else if (url.pathname.endsWith('/journalEntriesByDate')) data = [{ id: 1, entryType: 'SISSEKANNE_T', entryDate: '2026-09-14', startLessonNr: 1, lessons: 1 }]
    else if (url.pathname.endsWith('/journalEntry/1')) data = { journalEntryStudents: [{ journalStudent: 1, absence: 'PUUDUMINE_P' }] }
    else if (url.pathname.endsWith('/journalStudents')) data = [{ id: 1, fullname: 'Synthetic Student', studentGroup: 'TEST' }]
    else return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } })
    return route.fulfill({ json: data })
  })
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  /** Barrier: status requests use the same production serialization queue as alarms. */
  const idle = () => popup.evaluate(() => chrome.runtime.sendMessage({ action: 'lessonNotificationStatus' }))
  return {
    context, worker, popup, idle,
    async open(url = 'https://tahvel.edu.ee/#/journals') {
      const page = await context.newPage()
      await page.goto(url)
      return page
    },
    async fire(name, now) {
      await worker.evaluate(({ name, now }) => { if (now != null) lessonHarness.state.now = now; lessonHarness.fire(name) }, { name, now })
      await idle()
    },
    async close() {
      await context.close()
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}
