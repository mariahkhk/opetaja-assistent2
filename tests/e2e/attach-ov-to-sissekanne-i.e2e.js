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

  test('renders a malicious outcome name as inert text without executing it', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)

    // Override the outcomes endpoint with XSS payloads in nameEt. The feature
    // renders these via createTextNode (safe). A regression to innerHTML would
    // let the REAL browser fire onerror/onload and set window.__xss — which a
    // JSDOM unit test cannot detect, but this end-to-end test can.
    const imgXss = '<img src=x onerror="window.__xss=true">'
    const svgXss = '<svg onload="window.__xss=true"></svg>'
    await page.route(/journalEntriesByDate/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, entryType: 'SISSEKANNE_O', outcomeOrderNr: 0, nameEt: imgXss },
        { id: 2, entryType: 'SISSEKANNE_O', outcomeOrderNr: 1, nameEt: svgXss }
      ])
    }))

    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)
    await mountModal(page, 'Iseseisev töö')

    const section = page.locator('.oa2-attach-ov-section')
    await expect(section).toBeAttached({ timeout: 5000 })

    // The payloads are rendered as literal text, not parsed as HTML.
    await expect(section).toContainText('<img src=x onerror=')
    await expect(section).toContainText('<svg onload=')

    // No dangerous element was parsed into the DOM.
    expect(await section.locator('img, svg, script').count()).toBe(0)

    // Nothing executed in the real browser. img.onerror fires asynchronously
    // after the failed load, so give it a tick before asserting non-execution.
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })

  // Real-browser equivalent of the DomService 32-vector matrix: drive every
  // documented XSS vector through a live render path (outcome nameEt →
  // createTextNode) and assert none parses into a dangerous element and none
  // executes. A regression to innerHTML makes auto-firing vectors (img.onerror,
  // svg/body onload, autofocus onfocus, details ontoggle, etc.) set window.__xss.
  test('neutralizes all known XSS vectors rendered through outcome names', async() => {
    const vectors = [
      '<script>window.__xss=true</script>',
      '<script src="https://evil.test/x.js"></script>',
      '<img src=x onerror="window.__xss=true">',
      '<svg onload="window.__xss=true"></svg>',
      '<body onload="window.__xss=true">',
      '<video><source src=x onerror="window.__xss=true"></video>',
      '<audio src=x onerror="window.__xss=true">',
      '<input onfocus="window.__xss=true" autofocus>',
      '<select onfocus="window.__xss=true" autofocus></select>',
      '<textarea onfocus="window.__xss=true" autofocus></textarea>',
      '<details open ontoggle="window.__xss=true"></details>',
      '<marquee onstart="window.__xss=true"></marquee>',
      '<object data=x onerror="window.__xss=true"></object>',
      '<embed src=x onerror="window.__xss=true">',
      '<iframe onload="window.__xss=true"></iframe>',
      '<a href="javascript:window.__xss=true">x</a>',
      '<iframe src="javascript:window.__xss=true"></iframe>',
      '<form action="javascript:window.__xss=true"><input type=submit></form>',
      '<button formaction="javascript:window.__xss=true">x</button>',
      '<object data="javascript:window.__xss=true"></object>',
      '<iframe src="data:text/html,<script>window.__xss=true</script>"></iframe>',
      '<object data="data:text/html,<script>window.__xss=true</script>"></object>',
      '<svg><script>window.__xss=true</script></svg>',
      '<svg><animate onbegin="window.__xss=true" attributeName=x dur=1s></svg>',
      '<meta http-equiv="refresh" content="0;url=javascript:window.__xss=true">',
      '<base href="javascript://">',
      '<div style="background:url(javascript:window.__xss=true)">x</div>',
      '<ScRiPt>window.__xss=true</ScRiPt>',
      '<img src=x onerror=&#119;&#105;&#110;&#100;&#111;&#119;.__xss=true>',
      '<scr\x00ipt>window.__xss=true</script>',
      '<img\tsrc=x\nonerror="window.__xss=true">',
      '<div><script>window.__xss=true</script></div>'
    ]

    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.route(/journalEntriesByDate/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(vectors.map((nameEt, i) => ({
        id: i + 1, entryType: 'SISSEKANNE_O', outcomeOrderNr: i, nameEt
      })))
    }))

    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })
    await waitForFeatureReady(page)
    await mountModal(page, 'Iseseisev töö')

    const section = page.locator('.oa2-attach-ov-section')
    await expect(section).toBeAttached({ timeout: 5000 })
    // All 32 outcome rows rendered (one checkbox per vector).
    await expect.poll(() => section.locator('input[type="checkbox"]').count()).toBe(vectors.length)

    // Not one vector parsed into a dangerous element. (input/label are legit
    // parts of each row, so they're excluded; the autofocus-onfocus vectors are
    // caught by the window.__xss execution check instead.)
    expect(await section.locator(
      'script, img, svg, iframe, object, embed, audio, video, marquee, details, form, meta, base, a[href]'
    ).count()).toBe(0)

    // A representative payload is rendered as literal text.
    await expect(section).toContainText('<script>window.__xss=true</script>')

    // Nothing executed in the real browser across any vector.
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })
})
