import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'

// Journal 402872 has two SISSEKANNE_O entries in fixtures (outcomeOrderNr 0+1
// → ÕV1 and ÕV2), so the picker has real outcomes to render.
const JOURNAL_ID = 402872
const JOURNAL_ROUTE = `/#/journal/${JOURNAL_ID}/edit`
const JOURNAL_URL = `https://tahvel.edu.ee${JOURNAL_ROUTE}`

// Build the Tahvel "Sissekanne (uus)" modal shell the extension hooks into —
// the same DOM path the feature locates via
// `add-entry .form-flexible-fields > tahvel-input`. Tahvel's static fixture
// doesn't include the modal (it only appears after "LISA UUS SISSEKANNE"
// is clicked, which would need live Angular), so the test mounts a faithful
// minimal copy that the feature treats the same way.
async function mountModal(page, initialName = '') {
  await page.evaluate(name => {
    document.querySelectorAll('add-entry').forEach(n => n.remove())
    const el = (tag, opts = {}, children = []) => {
      const e = document.createElement(tag)
      if (opts.cls) e.className = opts.cls
      if (opts.text != null) e.appendChild(document.createTextNode(opts.text))
      if (opts.value != null) e.value = opts.value
      if (opts.type) e.type = opts.type
      for (const c of children) e.appendChild(c)
      return e
    }
    const fields = el('div', { cls: 'form-flexible-fields' }, [
      el('tahvel-select', { cls: 'ng-untouched ng-pristine ng-invalid' }, [
        el('span', { text: 'Sissekande liik *' })
      ]),
      el('tahvel-input', { cls: 'ng-untouched ng-pristine ng-valid' }, [
        el('span', { text: 'Sissekande nimetus' }),
        el('input', { type: 'text', value: name })
      ])
    ])
    const tree = el('dg-journal-edit-component', {}, [
      el('div', {}, [
        el('add-entry', {}, [
          el('modal', {}, [
            el('div', {}, [
              el('div', {}, [
                el('form', {}, [
                  el('div', { cls: 'not-final-grade-view ng-star-inserted' }, [fields])
                ])
              ])
            ])
          ])
        ])
      ])
    ])
    document.body.appendChild(tree)
  }, initialName)
}

async function setNameInput(page, value) {
  await page.evaluate(v => {
    const input = document.querySelector('add-entry tahvel-input input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function waitForFeatureReady(page) {
  await expect(page.locator('#oa2-attach-ov-style')).toBeAttached({ timeout: 15000 })
  // Strip Tahvel's version-update modal if it pops up — it overlays the page
  // on a fresh-install context (`OA_updateBannerDismissed` is wiped between
  // tests) and intercepts clicks on the modal we're driving.
  await page.evaluate(() => document.getElementById('oa2-update-modal')?.remove())
}

test.describe('AttachOvToSissekanneIFeature — picker injected into Sissekanne modal', () => {
  let context

  test.beforeEach(async() => {
    ({ context } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('style is injected on activation', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)
  })

  test('picker appears under the name input with one row per ÕV and the new title', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)

    await mountModal(page)

    const section = page.locator('.oa2-attach-ov-section')
    await expect(section).toBeAttached({ timeout: 5000 })
    await expect(section.locator('.oa2-attach-ov-title strong')).toHaveText('Seotud õpiväljundid')
    // Fixture has ÕV1 + ÕV2, sorted by outcomeOrderNr+1.
    const tags = await section.locator('.oa2-attach-ov-tag').allTextContents()
    expect(tags).toEqual(['ÕV1', 'ÕV2'])
  })

  test('ticking a checkbox appends the (ÕVn) suffix to the name input', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)

    await mountModal(page, 'Iseseisev töö')
    await expect(page.locator('.oa2-attach-ov-section')).toBeAttached({ timeout: 5000 })

    await page.locator('input[data-ov-num="2"]').check()
    await expect.poll(() => page.locator('add-entry tahvel-input input').inputValue()).toBe('Iseseisev töö (ÕV2)')
  })

  test('existing (ÕVn) suffix pre-ticks the matching checkbox', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)

    await mountModal(page, 'Iseseisev töö (ÕV1)')
    await expect(page.locator('.oa2-attach-ov-section')).toBeAttached({ timeout: 5000 })

    await expect(page.locator('input[data-ov-num="1"]')).toBeChecked()
    await expect(page.locator('input[data-ov-num="2"]')).not.toBeChecked()
  })

  test('restores the ÕV suffix when the name is overwritten while a checkbox is ticked', async() => {
    // Repro: teacher ticks ÕV1 → name becomes "(ÕV1)". Then picking the
    // "Sissekande liik" dropdown overwrites the name with the entry-type
    // label, wiping the suffix. The picker must put it back.
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)

    await mountModal(page)
    await expect(page.locator('.oa2-attach-ov-section')).toBeAttached({ timeout: 5000 })

    await page.locator('input[data-ov-num="1"]').check()
    await expect.poll(() => page.locator('add-entry tahvel-input input').inputValue()).toBe('(ÕV1)')

    await setNameInput(page, 'Iseseisev töö')

    await expect.poll(() => page.locator('add-entry tahvel-input input').inputValue()).toBe('Iseseisev töö (ÕV1)')
    await expect(page.locator('input[data-ov-num="1"]')).toBeChecked()
  })

  test('blocks ticking when the resulting name would exceed 100 chars', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)

    // 95-char base + ' (ÕV1)' is fine; adding ÕV2 → " (ÕV1, ÕV2)" → 107 chars, trips the limit.
    const longBase = 'a'.repeat(95)
    await mountModal(page, `${longBase} (ÕV1)`)
    await expect(page.locator('.oa2-attach-ov-section')).toBeAttached({ timeout: 5000 })

    // Use click() rather than check(): the feature reverts the tick on
    // overflow, so check() would assert the box ends up checked and fail.
    await page.locator('input[data-ov-num="2"]').click()

    await expect(page.locator('input[data-ov-num="2"]')).not.toBeChecked()
    await expect(page.locator('.oa2-attach-ov-error.visible')).toBeAttached()
    expect(await page.locator('add-entry tahvel-input input').inputValue()).toBe(`${longBase} (ÕV1)`)
  })

  test('typing extra text after the suffix re-pins (ÕVn) to the end without phantom spaces', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)

    await mountModal(page, 'abc')
    await expect(page.locator('.oa2-attach-ov-section')).toBeAttached({ timeout: 5000 })

    await page.locator('input[data-ov-num="1"]').check()
    await expect.poll(() => page.locator('add-entry tahvel-input input').inputValue()).toBe('abc (ÕV1)')

    await setNameInput(page, 'abc (ÕV1)def')
    await expect.poll(() => page.locator('add-entry tahvel-input input').inputValue()).toBe('abcdef (ÕV1)')
    await expect(page.locator('input[data-ov-num="1"]')).toBeChecked()
  })
})
