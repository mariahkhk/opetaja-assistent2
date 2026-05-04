/**
 * Configure Kriit via the extension popup: toggle on, set API URL + key,
 * click Salvesta. Persists across the BrowserContext via chrome.storage.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @param {object} [opts]
 * @param {string} [opts.apiUrl='https://example.test/api']
 * @param {string} [opts.apiKey='test-token-12345']
 */
export async function enableKriitFully(context, extensionId, opts = {}) {
  const { apiUrl = 'https://example.test/api', apiKey = 'test-token-12345' } = opts
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.waitForLoadState('domcontentloaded')

  await popup.locator('label[for="kriit-enabled"]').click()
  await popup.locator('#kriit-api-url').fill(apiUrl)
  await popup.locator('#kriit-api-key').fill(apiKey)
  await popup.locator('#save-kriit-settings').click()

  // Wait for save status to confirm storage write completed
  await popup.locator('#save-status').waitFor({ state: 'visible', timeout: 5000 })
  await popup.close()
}
