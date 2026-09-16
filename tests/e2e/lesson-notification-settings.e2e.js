import { expect } from '@playwright/test'
import { test, launchWithExtension } from './helpers/loadExtension.js'

test('lesson notification timing validates and persists all four combinations through the real worker', async() => {
  const { context, extensionId } = await launchWithExtension()
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    const save = page.locator('#lesson-notification-settings').getByRole('button', { name: 'Salvesta', exact: true })
    const status = page.locator('#lesson-notification-settings-status')
    await expect(save).toBeEnabled()
    await expect(page.locator('#lesson-reference')).toHaveValue('end')
    await expect(page.locator('#lesson-direction')).toHaveValue('after')
    await expect(page.getByLabel('Minutite arv')).toHaveValue('0')
    await expect(page.locator('#lesson-timing-preview')).toHaveText('Teavitus saabub täpselt tunni lõpus.')
    const layout = await page.locator('.lesson-timing-row').evaluate(row => {
      const bounds = row.getBoundingClientRect()
      const controls = [...row.querySelectorAll('input, select')].map(control => control.getBoundingClientRect())
      return {
        fits: controls.every(rect => rect.left >= bounds.left && rect.right <= bounds.right),
        heights: controls.map(rect => rect.height),
        sameRow: controls.every(rect => rect.top === controls[0].top)
      }
    })
    expect(layout).toEqual({ fits: true, heights: [36, 36, 36], sameRow: true })
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
        await expect(status).toBeEmpty()
        await expect(page.locator('#lesson-timing-preview')).toHaveText(`Teavitus saabub 10 minutit ${direction === 'before' ? 'enne' : 'pärast'} tunni ${reference === 'start' ? 'algust' : 'lõppu'}.`)
        await save.click()
        await expect(status).toContainText('Salvestatud')
        await page.reload()
        await expect(save).toBeEnabled()
        await expect(page.locator('#lesson-reference')).toHaveValue(reference)
        await expect(page.locator('#lesson-direction')).toHaveValue(direction)
        await expect(page.locator('#lesson-minutes')).toHaveValue('10')
      }
    }
    await page.getByLabel('Minutite arv').fill('5')
    await page.locator('.lesson-settings').screenshot({ path: test.info().outputPath('lesson-settings.png') })
  } finally { await context.close() }
})
