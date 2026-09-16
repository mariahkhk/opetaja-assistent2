import { expect } from '@playwright/test'
import { test, launchWithExtension } from './helpers/loadExtension.js'

test('lesson notification timing validates and persists all four combinations through the real worker', async() => {
  const { context, extensionId } = await launchWithExtension()
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    const save = page.getByRole('button', { name: 'Salvesta märguande aeg' })
    const status = page.locator('#lesson-notification-settings-status')
    await expect(save).toBeEnabled()
    await expect(page.locator('#lesson-reference')).toHaveValue('end')
    await expect(page.locator('#lesson-direction')).toHaveValue('after')
    await expect(page.locator('#lesson-minutes')).toHaveValue('0')
    for (const invalid of ['', '-1', '1.5']) {
      await page.locator('#lesson-minutes').fill(invalid)
      await save.click()
      await expect(status).toContainText('täisarv')
      expect(await page.evaluate(async() => (await chrome.storage.local.get('OA_lessonNotificationTiming')).OA_lessonNotificationTiming)).toBeUndefined()
    }
    for (const reference of ['start', 'end']) {
      for (const direction of ['before', 'after']) {
        await page.locator('#lesson-reference').selectOption(reference)
        await page.locator('#lesson-direction').selectOption(direction)
        await page.locator('#lesson-minutes').fill('10')
        await save.click()
        await expect(status).toContainText('Salvestatud')
        await page.reload()
        await expect(save).toBeEnabled()
        await expect(page.locator('#lesson-reference')).toHaveValue(reference)
        await expect(page.locator('#lesson-direction')).toHaveValue(direction)
        await expect(page.locator('#lesson-minutes')).toHaveValue('10')
      }
    }
  } finally { await context.close() }
})
