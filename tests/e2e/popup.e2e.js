import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import fs from 'fs'

const manifestVersion = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8')).version

test.describe('popup', () => {
  let context, extensionId, popup, consoleErrors

  async function openPopup() {
    consoleErrors = []
    popup = await context.newPage()
    popup.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    popup.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`))
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.waitForLoadState('domcontentloaded')
  }

  test.beforeEach(async() => {
    ({ context, extensionId } = await launchWithExtension())
    await openPopup()
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('loads without console errors and renders all controls', async() => {
    await expect(popup.locator('#kriit-enabled')).toBeAttached()
    await expect(popup.locator('#debug-mode')).toBeAttached()
    await expect(popup.locator('#highlight-missing-grades')).toBeAttached()
    await expect(popup.locator('#clear-cache')).toBeVisible()
    await expect(popup.locator('h1')).toHaveText('Õpetaja Assistent 2')
    expect(consoleErrors).toEqual([])
  })

  test('version shown matches manifest', async() => {
    await expect(popup.locator('#version')).toHaveText(manifestVersion)
  })

  test('Highlight missing grades is on by default and persists when turned off', async() => {
    await expect(popup.locator('#highlight-missing-grades')).toBeChecked()

    await popup.locator('label[for="highlight-missing-grades"]').click()
    await expect(popup.locator('#highlight-missing-grades')).not.toBeChecked()

    await popup.close()
    await openPopup()

    await expect(popup.locator('#highlight-missing-grades')).not.toBeChecked()
  })

  test('Debug mode toggle reveals debug tools container and persists', async() => {
    await expect(popup.locator('#debug-tools')).toBeHidden()

    await popup.locator('label[for="debug-mode"]').click()
    await expect(popup.locator('#debug-mode')).toBeChecked()
    await expect(popup.locator('#debug-tools')).toBeVisible()
    await expect(popup.locator('#download-api-requests')).toBeVisible()

    await popup.close()
    await openPopup()

    await expect(popup.locator('#debug-mode')).toBeChecked()
    await expect(popup.locator('#debug-tools')).toBeVisible()
  })

  test('Kriit toggle reveals settings container; off hides it', async() => {
    await expect(popup.locator('#kriit-settings-container')).toBeHidden()

    await popup.locator('label[for="kriit-enabled"]').click()
    await expect(popup.locator('#kriit-settings-container')).toBeVisible()

    await popup.locator('label[for="kriit-enabled"]').click()
    await expect(popup.locator('#kriit-settings-container')).toBeHidden()
  })

  test('Kriit toggle persists across re-open', async() => {
    await popup.locator('label[for="kriit-enabled"]').click()
    await expect(popup.locator('#kriit-enabled')).toBeChecked()

    await popup.close()
    await openPopup()

    await expect(popup.locator('#kriit-enabled')).toBeChecked()
    await expect(popup.locator('#kriit-settings-container')).toBeVisible()
  })

  test('API key Näita/Peida button toggles input type', async() => {
    await popup.locator('label[for="kriit-enabled"]').click()
    const input = popup.locator('#kriit-api-key')
    const toggle = popup.locator('#toggle-api-key-visibility')

    await expect(input).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveText('Näita')

    await input.fill('some-token-value')
    await toggle.click()
    await expect(input).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveText('Peida')

    await toggle.click()
    await expect(input).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveText('Näita')
  })

  test('Saving Kriit settings persists URL and shows saved indicator; delete clears it', async() => {
    await popup.locator('label[for="kriit-enabled"]').click()
    await popup.locator('#kriit-api-url').fill('https://example.test/api')
    await popup.locator('#kriit-api-key').fill('test-key-12345')
    await popup.locator('#save-kriit-settings').click()

    await expect(popup.locator('#save-status')).toHaveText('Salvestatud!')
    await expect(popup.locator('#kriit-api-key-status')).toBeVisible()

    await popup.close()
    await openPopup()

    await expect(popup.locator('#kriit-api-url')).toHaveValue('https://example.test/api')
    await expect(popup.locator('#kriit-api-key-status')).toBeVisible()

    popup.once('dialog', dialog => dialog.accept())
    await popup.locator('#delete-api-key').click()
    await expect(popup.locator('#kriit-api-key-status')).toBeHidden()
  })

  test('Saving non-HTTPS URL is rejected with alert and nothing persisted', async() => {
    await popup.locator('label[for="kriit-enabled"]').click()
    let alertMessage = ''
    popup.on('dialog', async dialog => {
      alertMessage = dialog.message()
      await dialog.dismiss()
    })

    await popup.locator('#kriit-api-url').fill('http://insecure.example.com/api')
    await popup.locator('#kriit-api-key').fill('test-key-12345')
    await popup.locator('#save-kriit-settings').click()

    await expect.poll(() => alertMessage).toContain('https://')
    await expect(popup.locator('#save-status')).toHaveText('')

    await popup.close()
    await openPopup()
    await expect(popup.locator('#kriit-api-url')).toHaveValue('')
  })

  test('Cache details panel toggles on click', async() => {
    await expect(popup.locator('#cache-details')).toBeHidden()
    await popup.locator('#view-cache-details').click()
    await expect(popup.locator('#cache-details')).toBeVisible()
    await popup.locator('#view-cache-details').click()
    await expect(popup.locator('#cache-details')).toBeHidden()
  })

  test('cache stats container resolves past Laadimine on init', async() => {
    // No Tahvel tab open → stats container should resolve to "pole saadaval"
    await expect.poll(
      async() => (await popup.locator('#cache-stats-container').textContent()) || '',
      { timeout: 10000 }
    ).not.toBe('Laadimine...')
  })

  test('Refresh cache stats button updates the container', async() => {
    await expect.poll(
      async() => (await popup.locator('#cache-stats-container').textContent()) || '',
      { timeout: 10000 }
    ).not.toBe('Laadimine...')
    await popup.locator('#cache-stats-container').evaluate(el => (el.textContent = 'sentinel'))
    await popup.locator('#refresh-cache-stats').click()
    await expect.poll(
      async() => (await popup.locator('#cache-stats-container').textContent()) || '',
      { timeout: 10000 }
    ).not.toBe('sentinel')
  })

  test('Clear cache without Tahvel tab surfaces "pole saadaval" / error', async() => {
    popup.once('dialog', dialog => dialog.accept())
    await popup.locator('#clear-cache').click()
    await expect.poll(
      async() => (await popup.locator('#cache-stats-container').textContent()) || '',
      { timeout: 10000 }
    ).toMatch(/pole saadaval|tühjendatud|laadimine/i)
  })

  test('Download API requests button hidden when debug off, visible when on', async() => {
    await expect(popup.locator('#download-api-requests')).toBeHidden()
    await popup.locator('label[for="debug-mode"]').click()
    await expect(popup.locator('#download-api-requests')).toBeVisible()
  })

  test('Save status auto-clears after STATUS_CLEAR_DELAY_MS', async() => {
    await popup.locator('label[for="kriit-enabled"]').click()
    await popup.locator('#kriit-api-url').fill('https://example.test/api')
    await popup.locator('#kriit-api-key').fill('test-key-12345')
    await popup.locator('#save-kriit-settings').click()
    await expect(popup.locator('#save-status')).toHaveText('Salvestatud!')
    // STATUS_CLEAR_DELAY_MS = 2000ms in popup.js — wait past it
    await expect(popup.locator('#save-status')).toHaveText('', { timeout: 4000 })
  })
})
