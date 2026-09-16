import { test, expect } from 'bun:test'
import { JSDOM } from 'jsdom'
import { initializeLessonNotificationSettings } from '../../src/popup/LessonNotificationSettings.js'

test('popup loads saved timing, rejects invalid input and reports save failures without success', async() => {
  const dom = new JSDOM(`<form id="lesson-notification-settings"><select name="reference"><option>start</option><option>end</option></select>
    <select name="direction"><option>before</option><option>after</option></select><input name="minutes"><button>Save</button></form>
    <p id="lesson-notification-settings-status"></p>`)
  const original = { document: global.document, chrome: global.chrome }
  const sent = []
  let error = false
  global.document = dom.window.document
  global.chrome = {
    storage: { local: { get: async() => ({ OA_lessonNotificationTiming: { reference: 'start', direction: 'before', minutes: 5 } }) } },
    runtime: { sendMessage: async message => { sent.push(message); return error ? { error: 'Salvestamine ebaõnnestus.' } : { ok: true } } }
  }
  try {
    await initializeLessonNotificationSettings()
    const form = document.querySelector('form')
    const minutes = form.elements.namedItem('minutes')
    const status = document.querySelector('p')
    const submit = async() => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(minutes.value).toBe('5')
    expect(form.elements.namedItem('reference').value).toBe('start')
    for (const invalid of ['', '-1', '1.5', 'abc']) {
      minutes.value = invalid
      await submit()
      expect(status.textContent).toContain('täisarv')
    }
    expect(sent).toHaveLength(0)
    minutes.value = '10'
    await submit()
    expect(sent[0].timing).toEqual({ reference: 'start', direction: 'before', minutes: 10 })
    expect(status.textContent).toContain('Salvestatud')
    error = true
    await submit()
    expect(status.textContent).toContain('ebaõnnestus')
    expect(form.querySelector('button').disabled).toBe(false)
  } finally { Object.assign(global, original); dom.window.close() }
})
