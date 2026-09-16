import { test, expect } from 'bun:test'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const template = readFileSync(new URL('../../src/assets/templates/popup.html', import.meta.url), 'utf8')
import { initializeLessonNotificationSettings } from '../../src/popup/LessonNotificationSettings.js'

test('popup loads saved timing, rejects invalid input and reports save failures without success', async() => {
  const dom = new JSDOM(template)
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
    const status = document.getElementById('lesson-notification-settings-status')
    const preview = document.getElementById('lesson-timing-preview')
    const submit = async() => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(preview.textContent).toBe('Teavitus saabub 5 minutit enne tunni algust.')
    expect(form.querySelector('fieldset').disabled).toBe(false)
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
    expect(status.dataset.state).toBe('success')
    for (const reference of ['start', 'end']) {
      form.elements.namedItem('reference').value = reference
      for (const direction of ['before', 'after']) {
        form.elements.namedItem('direction').value = direction
        for (const count of [0, 1, 5]) {
          minutes.value = String(count)
          minutes.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
          const point = reference === 'start' ? 'algust' : 'lõppu'
          expect(preview.textContent).toBe(count === 0
            ? `Teavitus saabub täpselt tunni ${reference === 'start' ? 'alguses' : 'lõpus'}.`
            : `Teavitus saabub ${count} ${count === 1 ? 'minut' : 'minutit'} ${direction === 'before' ? 'enne' : 'pärast'} tunni ${point}.`)
          expect(status.textContent).toBe('')
          expect(status.dataset.state).toBeUndefined()
        }
      }
    }
    minutes.value = '-1'
    minutes.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(minutes.getAttribute('aria-invalid')).toBe('true')
    expect(preview.textContent).toContain('täisarv')
    minutes.value = '5'
    error = true
    await submit()
    expect(status.textContent).toContain('ebaõnnestus')
    expect(status.dataset.state).toBe('error')
    expect(minutes.hasAttribute('aria-invalid')).toBe(false)
    expect(form.querySelector('button').disabled).toBe(false)
    expect(form.querySelector('button').textContent).toBe('Salvesta')
  } finally { Object.assign(global, original); dom.window.close() }
})

test('popup keeps controls disabled when loading fails', async() => {
  const dom = new JSDOM(template)
  const original = { document: global.document, chrome: global.chrome }
  global.document = dom.window.document
  global.chrome = { storage: { local: { get: async() => { throw new Error('Storage unavailable') } } } }
  try {
    await initializeLessonNotificationSettings()
    expect(document.querySelector('#lesson-notification-settings button').disabled).toBe(true)
    expect(document.querySelector('#lesson-notification-settings fieldset').disabled).toBe(true)
    expect(document.getElementById('lesson-notification-settings-status').dataset.state).toBe('error')
  } finally { Object.assign(global, original); dom.window.close() }
})

test('popup locks controls during saving and prevents duplicate requests', async() => {
  const dom = new JSDOM(template)
  const original = { document: global.document, chrome: global.chrome }
  let finish
  let calls = 0
  global.document = dom.window.document
  global.chrome = {
    storage: { local: { get: async() => ({}) } },
    runtime: { sendMessage: () => { calls++; return new Promise(resolve => { finish = resolve }) } }
  }
  try {
    await initializeLessonNotificationSettings()
    const form = document.querySelector('form')
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    expect(calls).toBe(1)
    expect(form.querySelector('button').textContent).toBe('Salvestan…')
    expect(form.querySelector('fieldset').disabled).toBe(true)
    finish({ ok: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(form.querySelector('fieldset').disabled).toBe(false)
    expect(form.querySelector('button').disabled).toBe(false)
  } finally { Object.assign(global, original); dom.window.close() }
})
