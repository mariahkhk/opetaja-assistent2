/**
 * Toggle debug-mode on via the extension popup so content scripts emit
 * `Logger.debug(...)` messages prefixed with "✨" to the page console.
 * Tests can capture those via page.on('console', ...) to assert that
 * specific features actually activated, even when their DOM marker is
 * data-conditional.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 */
export async function enableDebugMode(context, extensionId) {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.waitForLoadState('domcontentloaded')
  await popup.locator('label[for="debug-mode"]').click()
  await popup.close()
}
