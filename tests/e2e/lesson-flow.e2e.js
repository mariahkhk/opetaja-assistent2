import { test, expect } from '@playwright/test'
import { launchLessonHarness } from './helpers/lessonHarness.js'

const KEY = '8-2026-09-14-2'
const ALARM = `oa2-lesson:${KEY}`
const EMAIL = `oa2-lesson-email:${KEY}`
const END = Date.parse('2026-09-14T07:40:00Z')
const DUE = END + 600000
const LINK = `https://tahvel.edu.ee/?oa2Lesson=${KEY}#/journal/8/edit`
let harness

test.beforeEach(async() => { harness = await launchLessonHarness() })
test.afterEach(async() => { await harness?.close() })

async function scheduled() {
  await expect.poll(() => harness.worker.evaluate(async() => (await lessonHarness.readState()).blocks?.length)).toBe(1)
  await expect.poll(() => harness.worker.evaluate(() => lessonHarness.alarms().filter(a => a.name.startsWith('oa2-lesson:')).length)).toBe(1)
}
async function assertPrefilled(page) {
  await expect(page.locator('.oa2-lesson-prefill-status')).toContainText('Lisa käsitletud teema ja ülesanded')
  await expect(page.locator('[formcontrolname="entryType"]')).toHaveAttribute('data-selected', 'Tund')
  await expect(page.locator('[formcontrolname="selected"] button')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Kuupäev')).toHaveValue('14.09.2026')
  await expect(page.getByLabel('Kuupäev')).toHaveAttribute('data-committed', '14.09.2026')
  await expect(page.locator('[formcontrolname="startLessonNr"]')).toHaveAttribute('data-selected', '2')
  await expect(page.getByLabel('Tundide arv')).toHaveValue('2')
  await expect(page.getByLabel('Puudub', { exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Nimetus')).toHaveValue('Synthetic subject')
  await expect(page.getByLabel('Sisu')).toHaveValue('Tunniplaani andmed:\nAine: Synthetic subject\nKuupäev: 14.09.2026\nKellaaeg: 09:10–10:40\nÕpperühm: TEST')
  expect(await page.evaluate(() => ({ saved: window.savedEntries, opened: window.openedEntries }))).toEqual({ saved: 0, opened: 1 })
}

test('native Chrome alarm survives closing the Tahvel tab; click opens one prefilled block without saving', async() => {
  const tahvel = await harness.open()
  await scheduled()
  expect(await harness.worker.evaluate(() => lessonHarness.alarms().find(a => a.name.startsWith('oa2-lesson:')).scheduledTime)).toBe(END)
  await harness.fire(ALARM, END - 1)
  expect(await harness.worker.evaluate(() => lessonHarness.state.notifications.length)).toBe(0)
  await tahvel.close()
  await harness.worker.evaluate(({ name, end }) => { lessonHarness.state.now = end; return lessonHarness.nativeAlarm(name) }, { name: ALARM, end: END })
  await expect.poll(() => harness.worker.evaluate(() => lessonHarness.state.notifications.length)).toBe(1)
  await harness.fire(ALARM, END)
  expect(await harness.worker.evaluate(() => lessonHarness.state.notifications.length)).toBe(1)
  const opened = harness.context.waitForEvent('page')
  await harness.worker.evaluate(id => lessonHarness.click(id), ALARM)
  const page = await opened
  const target = await harness.worker.evaluate(() => lessonHarness.state.openedUrl)
  expect(target).toBe(LINK)
  await page.goto(target)
  await assertPrefilled(page)
  await expect(page).toHaveURL('https://tahvel.edu.ee/#/journal/8/edit')
  expect(await harness.worker.evaluate(() => lessonHarness.state.requests.filter(r => r.method !== 'GET'))).toEqual([])
})

test('current school periods fill a block with no static period mapping', async() => {
  await harness.open()
  await scheduled()
  await harness.worker.evaluate(async() => {
    const state = await lessonHarness.readState()
    state.blocks[0].startLessonNr = null
    state.blocks[0].lessons = null
    // Keep the original notification key; the form must use live school periods.
    await lessonHarness.writeState(state)
  })
  const page = await harness.open(LINK)
  await assertPrefilled(page)
})

test('teacher edits made during metadata loading are not overwritten', async() => {
  let release
  const delayed = new Promise(resolve => { release = resolve })
  await harness.context.route('https://tahvel.edu.ee/hois_back/journals/8', async route => {
    await delayed
    await route.fulfill({ json: { nameEt: 'Synthetic subject' } })
  })
  const page = await harness.open(LINK)
  await page.getByLabel('Nimetus').fill('Õpetaja enda teema')
  await page.getByLabel('Sisu').fill('Õpetaja enda kirjeldus')
  release()
  await expect(page.locator('.oa2-lesson-prefill-status')).toContainText('Sinu sisestatud andmeid ei muudetud')
  await expect(page.getByLabel('Nimetus')).toHaveValue('Õpetaja enda teema')
  await expect(page.getByLabel('Sisu')).toHaveValue('Õpetaja enda kirjeldus')
  expect(await page.evaluate(() => window.savedEntries)).toBe(0)
})

test('expired-session link survives losing query parameters on login and resumes the intended form', async() => {
  await harness.worker.evaluate(() => { lessonHarness.state.authenticated = false })
  const page = await harness.open(LINK)
  await expect(page.locator('#oa2-lesson-open-error')).toBeVisible()
  await page.goto('https://tahvel.edu.ee/#/login')
  await harness.idle()
  await harness.worker.evaluate(() => { lessonHarness.state.authenticated = true })
  await page.goto('https://tahvel.edu.ee/#/journals')
  await assertPrefilled(page)
  await expect(page).toHaveURL('https://tahvel.edu.ee/#/journal/8/edit')
  expect(await harness.popup.evaluate(async() => Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('OA_pendingLesson_')))).toEqual([])
})

test('older email links reconstruct a block without saved notification state', async() => {
  await harness.worker.evaluate(() => { lessonHarness.state.now = Date.parse('2026-09-15T08:00:00Z') })
  const page = await harness.open(LINK)
  await assertPrefilled(page)
  expect(await harness.worker.evaluate(async() => (await lessonHarness.readState()).sent)).toBeUndefined()
})

test('all timing combinations reschedule the block and survive reopening the popup', async() => {
  await harness.open()
  await scheduled()
  for (const reference of ['start', 'end']) {
    for (const direction of ['before', 'after']) {
      await harness.popup.locator('#lesson-reference').selectOption(reference)
      await harness.popup.locator('#lesson-direction').selectOption(direction)
      await harness.popup.locator('#lesson-minutes').fill('10')
      await harness.popup.locator('#lesson-notification-settings').getByRole('button', { name: 'Salvesta', exact: true }).click()
      await expect(harness.popup.locator('#lesson-notification-settings-status')).toContainText('Salvestatud')
      const expected = (reference === 'end' ? END : Date.parse('2026-09-14T06:10:00Z')) + (direction === 'before' ? -600000 : 600000)
      expect(await harness.worker.evaluate(() => lessonHarness.alarms().filter(a => a.name.startsWith('oa2-lesson:')))).toEqual([
        { name: ALARM, scheduledTime: expected, when: expected }
      ])
      await harness.popup.reload()
      await expect(harness.popup.locator('#lesson-reference')).toHaveValue(reference)
      await expect(harness.popup.locator('#lesson-direction')).toHaveValue(direction)
      await expect(harness.popup.locator('#lesson-minutes')).toHaveValue('10')
    }
  }
})

test('missing lesson sends one real SMTP email through Kriit; retry is deduplicated and email link resumes after sign-in', async({ request }) => {
  test.skip(!process.env.LESSON_TEST_API || !process.env.LESSON_TEST_MAIL, 'Requires the disposable Kriit/MariaDB/MailHog stack')
  const api = process.env.LESSON_TEST_API
  const mailbox = process.env.LESSON_TEST_MAIL
  for (const address of [api, mailbox]) {
    expect(new URL(address).hostname).toBe('127.0.0.1')
    expect(new URL(address).protocol).toBe('http:')
  }
  expect(await (await request.get(`${new URL(api).origin}/health`)).text()).toBe('oa2-disposable-reminder-test')
  expect((await request.post(`${new URL(api).origin}/__test/reset`)).ok()).toBe(true)
  await request.delete(`${mailbox}/api/v1/messages`)
  const valid = { origin: 'https://tahvel.edu.ee', schoolId: 9, journalId: 8, date: '2026-09-14', timeStart: '09:10', timeEnd: '10:40', startLessonNr: 2, name: 'Synthetic subject' }
  const endpoint = `${api}/lessonreminders/send`
  const teacher = { Authorization: 'Bearer teacher-test-token' }
  expect((await request.post(endpoint, { data: valid })).status()).toBe(401)
  expect((await request.post(endpoint, { headers: { Authorization: 'Bearer invalid' }, data: valid })).status()).toBe(403)
  expect((await request.post(endpoint, { headers: { Authorization: 'Bearer student-test-token' }, data: valid })).status()).toBe(403)
  expect((await request.get(endpoint, { headers: teacher })).status()).toBe(405)
  expect((await request.post(endpoint, { headers: { ...teacher, 'X-Test-Now': String(DUE / 1000 - 1) }, data: valid })).status()).toBe(400)
  expect((await request.post(endpoint, { headers: teacher, data: { ...valid, origin: 'https://attacker.example' } })).status()).toBe(400)
  expect((await request.post(endpoint, { headers: teacher, data: { ...valid, name: 'Injected\r\nHeader' } })).status()).toBe(400)
  await harness.worker.evaluate(api => { lessonHarness.state.emailUrl = `${api}/lessonreminders/send` }, api)
  await harness.popup.evaluate(api => chrome.storage.local.set({ OA_kriitEnabled: true, OA_kriitApiBaseUrl: api, OA_kriitApiToken: 'teacher-test-token' }), api)
  await harness.open()
  await scheduled()
  await harness.fire(EMAIL, DUE - 1)
  expect(await harness.worker.evaluate(() => lessonHarness.state.requests.filter(r => r.method === 'POST').length)).toBe(0)
  await harness.worker.evaluate(() => { lessonHarness.state.authenticated = false })
  await harness.fire(EMAIL, DUE)
  expect(await harness.worker.evaluate(() => lessonHarness.state.requests.filter(r => r.method === 'POST').length)).toBe(0)
  await harness.worker.evaluate(() => { lessonHarness.state.authenticated = true; lessonHarness.state.cancelled = true })
  await harness.fire(EMAIL, DUE)
  expect(await harness.worker.evaluate(() => lessonHarness.state.requests.filter(r => r.method === 'POST').length)).toBe(0)
  await harness.worker.evaluate(() => { lessonHarness.state.cancelled = false; lessonHarness.state.recorded = true })
  await harness.fire(EMAIL, DUE)
  expect((await (await request.get(`${mailbox}/api/v2/messages`)).json()).total).toBe(0)
  // New local scheduler state, same lesson; the backend deduplication remains intact.
  await harness.popup.evaluate(() => chrome.storage.local.remove('OA_lessonNotifications'))
  await harness.worker.evaluate(() => { lessonHarness.state.recorded = false; lessonHarness.state.now = Date.parse('2026-09-14T05:50:00Z') })
  await harness.open()
  await scheduled()
  await harness.fire(EMAIL, DUE)
  await expect.poll(async() => (await (await request.get(`${mailbox}/api/v2/messages`)).json()).total).toBe(1)
  expect(await harness.worker.evaluate(async() => (await lessonHarness.readState()).emailDone?.['8-2026-09-14-2'])).toBe(true)
  await harness.fire(EMAIL, DUE)
  expect(await harness.worker.evaluate(() => lessonHarness.state.requests.filter(r => r.method === 'POST').length)).toBe(1)
  const payload = await harness.worker.evaluate(() => JSON.parse(lessonHarness.state.requests.find(r => r.method === 'POST').body))
  const retry = await request.post(`${api}/lessonreminders/send`, { headers: { Authorization: 'Bearer teacher-test-token' }, data: payload })
  expect((await retry.json()).data).toEqual({ ok: true, duplicate: true })
  const messages = (await (await request.get(`${mailbox}/api/v2/messages`)).json()).items
  expect(messages).toHaveLength(1)
  expect(messages[0].To.map(to => `${to.Mailbox}@${to.Domain}`)).toEqual(['teacher@example.test'])
  const html = messages[0].MIME.Parts.find(p => p.Headers['Content-Type'][0].includes('text/html')).Body
  // MailHog exposes the MIME body as quoted-printable; decode soft line breaks and =XX bytes.
  const decoded = html.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  expect(decoded).toContain('Synthetic subject')
  expect(decoded).toContain('2026-09-14')
  expect(decoded).toContain('09:10')
  const link = decoded.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&')
  expect(link).toBe(LINK)
  await harness.popup.evaluate(() => chrome.storage.local.remove('OA_lessonNotifications'))
  await harness.worker.evaluate(() => { lessonHarness.state.authenticated = false })
  const page = await harness.open(link)
  await expect(page.locator('#oa2-lesson-open-error')).toBeVisible()
  await page.goto('https://tahvel.edu.ee/#/login')
  await harness.worker.evaluate(() => { lessonHarness.state.authenticated = true })
  await page.goto('https://tahvel.edu.ee/#/journals')
  await assertPrefilled(page)
  // Exercise the database claim with concurrent HTTP requests handled by multiple PHP workers.
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => request.post(endpoint, {
    headers: teacher, data: { ...valid, journalId: 9, email: 'unintended@example.test', link: 'https://attacker.example' }
  })))
  expect(concurrent.every(response => [200, 409].includes(response.status()))).toBe(true)
  await expect.poll(async() => (await (await request.get(`${mailbox}/api/v2/messages`)).json()).total).toBe(2)
  const allMessages = (await (await request.get(`${mailbox}/api/v2/messages`)).json()).items
  expect(allMessages.every(message => message.To.length === 1 && message.To[0].Mailbox === 'teacher' && message.To[0].Domain === 'example.test')).toBe(true)
})
