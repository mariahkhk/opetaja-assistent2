import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'

test.describe('crypto key rotation across tabs', () => {
  let context, extensionId

  test.beforeEach(async() => {
    ({ context, extensionId } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('clear-cache from popup leaves other Tahvel tab functional (no crash)', async() => {
    // Open two Tahvel tabs
    const tabA = await context.newPage()
    await mockTahvel(tabA, '/#/journals')
    await tabA.goto('https://tahvel.edu.ee/#/journals', { waitUntil: 'domcontentloaded' })

    const tabB = await context.newPage()
    await mockTahvel(tabB, '/#/journal/404498/edit')
    await tabB.goto('https://tahvel.edu.ee/#/journal/404498/edit', { waitUntil: 'domcontentloaded' })

    // Both tabs activated
    await expect(tabA.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })
    await expect(tabB.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 10000 })

    // Open popup, click clear cache. Popup messages the active tab (tabB
    // most recently focused) → tab B clears cache + broadcasts cryptoKeyRotated.
    // Background fans it out to ALL Tahvel tabs (tab A receives as broadcast
    // recipient). Trigger-tab reloads (content.js:42); recipient just resets
    // its in-memory key (content.js:48-55) without reload.
    await tabB.bringToFront()
    const popup = await context.newPage()
    const popupErrors = []
    popup.on('pageerror', e => popupErrors.push(e.message))
    popup.once('dialog', d => d.accept()) // accepts the "Vahemälu tühjendatud" alert
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.waitForLoadState('domcontentloaded')
    await popup.locator('#clear-cache').click()

    // Allow broadcast + reload propagation
    await popup.waitForTimeout(2000)

    // Tab A: must still be functional after receiving cryptoKeyRotated broadcast
    // (does NOT reload; only trigger tab reloads — content.js:50-55)
    await expect(tabA.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 5000 })
    expect(popupErrors).toEqual([])
  })
})
