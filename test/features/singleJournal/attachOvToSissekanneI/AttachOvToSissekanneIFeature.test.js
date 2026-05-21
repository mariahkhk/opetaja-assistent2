import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import AttachOvToSissekanneIFeature from '../../../../src/features/singleJournal/attachOvToSissekanneI/AttachOvToSissekanneIFeature.js'

function setupDom(url = 'https://test.tahvel.eenet.ee/#/journal/426365/edit') {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url })
  global.window = dom.window
  global.document = dom.window.document
  global.MutationObserver = dom.window.MutationObserver
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  return dom
}

function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag)
  if (opts.className) e.className = opts.className
  if (opts.text) e.appendChild(document.createTextNode(opts.text))
  if (opts.value != null) e.value = opts.value
  if (opts.type) e.type = opts.type
  for (const c of children) e.appendChild(c)
  return e
}

function mountModal({ entryName = '' } = {}) {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  const formFields = el('div', { className: 'form-flexible-fields' }, [
    el('tahvel-select', { className: 'ng-untouched ng-pristine ng-invalid' }, [
      el('span', { text: 'Sissekande liik *' })
    ]),
    el('tahvel-input', { className: 'ng-untouched ng-pristine ng-valid' }, [
      el('span', { text: 'Sissekande nimetus' }),
      el('input', { type: 'text', value: entryName })
    ]),
    el('checkbox', { className: 'centered ng-untouched ng-pristine ng-valid' }, [
      el('span', { text: 'Teavita õppijat - märgitakse sisu lahtri info' })
    ])
  ])
  const notFinalGradeView = el('div', { className: 'not-final-grade-view ng-star-inserted' }, [formFields])
  const tree = el('div', { id: 'main-content' }, [
    el('dg-journal-edit-component', {}, [
      el('div', {}, [
        el('add-entry', {}, [
          el('modal', {}, [
            el('div', {}, [
              el('div', {}, [
                el('form', {}, [notFinalGradeView])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
  document.body.appendChild(tree)
  return document.querySelector('add-entry tahvel-input input')
}

describe('AttachOvToSissekanneIFeature', () => {
  let feature

  beforeEach(() => {
    setupDom()
    feature = new AttachOvToSissekanneIFeature()
    feature.isActive = true
  })

  describe('shouldActivate', () => {
    test('matches journal edit URLs', () => {
      expect(feature.shouldActivate('https://test.tahvel.eenet.ee/#/journal/426365/edit')).toBe(true)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/1/edit')).toBe(true)
    })

    test('does not match journal list or other pages', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/1')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/dashboard')).toBe(false)
    })
  })

  describe('buildNewNameEt', () => {
    test('appends a single (ÕVn) suffix to a plain name', () => {
      expect(feature.buildNewNameEt('Iseseisev töö', ['3'])).toBe('Iseseisev töö (ÕV3)')
    })

    test('sorts multiple ÕVs ascending and dedupes', () => {
      expect(feature.buildNewNameEt('Iseseisev töö', ['3', '1', '3'])).toBe('Iseseisev töö (ÕV1, ÕV3)')
    })

    test('replaces an existing ÕV-only suffix instead of appending', () => {
      expect(feature.buildNewNameEt('Iseseisev töö (ÕV1)', ['2', '5'])).toBe('Iseseisev töö (ÕV2, ÕV5)')
    })

    test('strips the ÕV-only suffix when nothing is selected', () => {
      expect(feature.buildNewNameEt('Iseseisev töö (ÕV1, ÕV3)', [])).toBe('Iseseisev töö')
    })

    test('preserves non-ÕV trailing parentheses when nothing is selected', () => {
      expect(feature.buildNewNameEt('Praktiline töö (vabatahtlik)', [])).toBe('Praktiline töö (vabatahtlik)')
    })

    test('preserves non-ÕV trailing parens while appending ÕV suffix', () => {
      expect(feature.buildNewNameEt('Praktiline töö (vabatahtlik)', ['2'])).toBe('Praktiline töö (vabatahtlik) (ÕV2)')
    })

    test('moves a mid-string ÕV suffix back to the end when typing extra text', () => {
      expect(feature.buildNewNameEt('abc (ÕV3) more text', ['3'])).toBe('abc more text (ÕV3)')
    })
  })

  describe('normalizeOvsToEnd', () => {
    test('returns the value untouched when no ÕV groups are present', () => {
      expect(feature.normalizeOvsToEnd('hello world')).toEqual({
        baseText: 'hello world', ovNums: [], newValue: 'hello world'
      })
    })

    test('leaves a trailing ÕV group in place (idempotent)', () => {
      const result = feature.normalizeOvsToEnd('abc (ÕV3)')
      expect(result.newValue).toBe('abc (ÕV3)')
      expect(result.ovNums).toEqual(['3'])
    })

    test('moves a mid-string ÕV group to the end', () => {
      const result = feature.normalizeOvsToEnd('abc (ÕV3) def')
      expect(result.newValue).toBe('abc def (ÕV3)')
      expect(result.ovNums).toEqual(['3'])
    })

    test('merges multiple ÕV groups into one sorted suffix', () => {
      const result = feature.normalizeOvsToEnd('(ÕV3) middle (ÕV1, ÕV5) end')
      expect(result.newValue).toBe('middle end (ÕV1, ÕV3, ÕV5)')
      expect(result.ovNums).toEqual(['1', '3', '5'])
    })

    test('treats a non-ÕV trailing parenthesis as plain text', () => {
      const result = feature.normalizeOvsToEnd('Praktiline (vabatahtlik)')
      expect(result.newValue).toBe('Praktiline (vabatahtlik)')
      expect(result.ovNums).toEqual([])
    })

    test('handles glued ÕV group with surrounding text', () => {
      // No replacement character is injected, so user-typed glued text stays glued.
      const result = feature.normalizeOvsToEnd('abc(ÕV3)def')
      expect(result.newValue).toBe('abcdef (ÕV3)')
      expect(result.ovNums).toEqual(['3'])
    })

    test('does not accumulate phantom spaces when normalising repeatedly', () => {
      // Reproduces the bug where each keystroke after the suffix produced an
      // extra space between user characters ("y i k j ..." instead of "yikj...").
      const step1 = feature.normalizeOvsToEnd('Iseseisev töö (ÕV1)y').newValue
      expect(step1).toBe('Iseseisev tööy (ÕV1)')
      const step2 = feature.normalizeOvsToEnd(step1 + 'i').newValue
      expect(step2).toBe('Iseseisev tööyi (ÕV1)')
      const step3 = feature.normalizeOvsToEnd(step2 + 'k').newValue
      expect(step3).toBe('Iseseisev tööyik (ÕV1)')
    })

    test('preserves a single user-typed space between words around a mid-string ÕV group', () => {
      const result = feature.normalizeOvsToEnd('abc (ÕV3) def')
      expect(result.newValue).toBe('abc def (ÕV3)')
      expect(result.ovNums).toEqual(['3'])
    })
  })

  describe('loadAvailableOvs', () => {
    test('builds catalog from SISSEKANNE_O entries sorted by outcomeOrderNr+1', async () => {
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: 100, entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '5) test', outcomeOrderNr: 4 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 },
            { id: 200, entryType: 'SISSEKANNE_T', nameEt: 'Tund' }
          ])
        }
      }
      const ovs = await feature.loadAvailableOvs('426365')
      expect(ovs).toEqual([
        { ovNum: '3', nameEt: '3) loob andmebaasi' },
        { ovNum: '5', nameEt: '5) test' }
      ])
    })

    test('caches results within 60s for the same journal id', async () => {
      let calls = 0
      feature.api = {
        tahvel: {
          get: mock(async () => {
            calls += 1
            return [{ id: null, entryType: 'SISSEKANNE_O', nameEt: '1) x', outcomeOrderNr: 0 }]
          })
        }
      }
      await feature.loadAvailableOvs('1')
      await feature.loadAvailableOvs('1')
      expect(calls).toBe(1)
    })
  })

  describe('modal injection', () => {
    test('injects the ÕV section after the name input when the modal is open', async () => {
      const nameInput = mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }

      await feature._checkAndInject()

      const section = document.querySelector('.oa2-attach-ov-section')
      expect(section).not.toBeNull()
      const formFields = nameInput.closest('.form-flexible-fields')
      // Placed at the end so the original 3-cell grid (select, name input,
      // "Teavita õppijat" checkbox) keeps its top-right corner intact.
      expect(formFields.lastElementChild).toBe(section)
      expect(section.textContent).toContain('Seotud õpiväljundid')
      expect(section.textContent).toContain('3) loob andmebaasi')
      expect(section.textContent).toContain('ÕV3')
    })

    test('pre-ticks checkboxes from existing (ÕVn) suffix on the name input', async () => {
      mountModal({ entryName: 'Iseseisev töö (ÕV1, ÕV3)' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) eelis', outcomeOrderNr: 0 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '2) teine', outcomeOrderNr: 1 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      const checked = Array.from(document.querySelectorAll('.oa2-attach-ov-section input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.ovNum)
      expect(checked.sort()).toEqual(['1', '3'])
    })

    test('toggling a checkbox updates the name input value with the new suffix', async () => {
      const nameInput = mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      let inputEventCount = 0
      nameInput.addEventListener('input', () => { inputEventCount += 1 })

      cb.checked = true
      cb.dispatchEvent(new window.Event('change', { bubbles: true }))

      expect(nameInput.value).toBe('Iseseisev töö (ÕV3)')
      expect(inputEventCount).toBe(1)
    })

    test('unticking the last checkbox strips the ÕV suffix', async () => {
      const nameInput = mountModal({ entryName: 'Iseseisev töö (ÕV3)' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      expect(cb.checked).toBe(true)
      cb.checked = false
      cb.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(nameInput.value).toBe('Iseseisev töö')
    })

    test('skips injection when the section is already present', async () => {
      mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) x', outcomeOrderNr: 0 }
          ])
        }
      }
      await feature._checkAndInject()
      await feature._checkAndInject()
      expect(document.querySelectorAll('.oa2-attach-ov-section').length).toBe(1)
    })

    test('restores the ÕV suffix when Tahvel overwrites the name (e.g. picking Sissekande liik)', async () => {
      // Repro: teacher ticks ÕV1 → name becomes "(ÕV1)". Then they pick the
      // entry-type dropdown ("Iseseisev töö"), which Tahvel uses to overwrite
      // the name input — wiping the suffix. With the checkbox still ticked,
      // the picker must put the suffix back instead of letting it disappear.
      const nameInput = mountModal({ entryName: '' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) eelis', outcomeOrderNr: 0 }
          ])
        }
      }
      await feature._checkAndInject()

      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      cb.checked = true
      cb.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(nameInput.value).toBe('(ÕV1)')

      // Simulate Tahvel programmatically overwriting the name on dropdown pick.
      nameInput.value = 'Iseseisev töö'
      nameInput.dispatchEvent(new window.Event('input', { bubbles: true }))

      expect(nameInput.value).toBe('Iseseisev töö (ÕV1)')
      expect(cb.checked).toBe(true)
    })

    test('does not auto-restore when no ÕVs are ticked (no false positives on plain edits)', async () => {
      const nameInput = mountModal({ entryName: 'old text' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) x', outcomeOrderNr: 0 }
          ])
        }
      }
      await feature._checkAndInject()

      nameInput.value = 'Iseseisev töö'
      nameInput.dispatchEvent(new window.Event('input', { bubbles: true }))

      expect(nameInput.value).toBe('Iseseisev töö')
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      expect(cb.checked).toBe(false)
    })

    test('pre-ticks checkboxes once the name is populated asynchronously by Tahvel', async () => {
      // When the teacher opens an existing entry for editing, Tahvel mounts the
      // modal first with an empty input and then hydrates the name value via
      // Angular. Our injection ran against the empty value, so the second call
      // (driven by a subsequent body mutation) must re-sync the checkboxes.
      const nameInput = mountModal({ entryName: '' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) eelis', outcomeOrderNr: 0 }
          ])
        }
      }
      await feature._checkAndInject()
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      expect(cb.checked).toBe(false)

      // Simulate Tahvel populating the value asynchronously.
      nameInput.value = 'Iseseisev töö (ÕV1)'

      // Body MutationObserver fires next → _checkAndInject re-syncs from the
      // current input value because the section is already present.
      await feature._checkAndInject()

      expect(cb.checked).toBe(true)
    })

    test('skips injection entirely when the journal has no SISSEKANNE_O', async () => {
      mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: 1, entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' }
          ])
        }
      }
      await feature._checkAndInject()
      // No ÕVs to show → don't waste space on an empty picker.
      expect(document.querySelector('.oa2-attach-ov-section')).toBeNull()
    })

    test('auto-moves a mid-string ÕV suffix to the end when the user types after it', async () => {
      const nameInput = mountModal({ entryName: 'abc' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      // Tick the checkbox to attach ÕV3
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      cb.checked = true
      cb.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(nameInput.value).toBe('abc (ÕV3)')
      // Simulate the user typing extra text after the suffix (no space typed).
      // The suffix moves back to the end and the new text glues to the existing
      // text — no phantom space injected, no per-keystroke space accumulation.
      nameInput.value = 'abc (ÕV3)def'
      nameInput.dispatchEvent(new window.Event('input', { bubbles: true }))
      expect(nameInput.value).toBe('abcdef (ÕV3)')
      // Checkbox remains ticked
      expect(cb.checked).toBe(true)
    })

    test('blocks ticking another ÕV when the resulting name would exceed 100 chars', async () => {
      // 95 chars + " (ÕV2)" = 102 chars when ÕV2 is also added → exceeds limit.
      const longBase = 'a'.repeat(95)
      const nameInput = mountModal({ entryName: `${longBase} (ÕV1)` })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) eelis', outcomeOrderNr: 0 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '2) teine', outcomeOrderNr: 1 }
          ])
        }
      }
      await feature._checkAndInject()
      const section = document.querySelector('.oa2-attach-ov-section')
      const cbForOv2 = section.querySelector('input[data-ov-num="2"]')
      cbForOv2.checked = true
      cbForOv2.dispatchEvent(new window.Event('change', { bubbles: true }))

      // The checkbox should be reverted, the name unchanged, and an error visible.
      expect(cbForOv2.checked).toBe(false)
      expect(nameInput.value).toBe(`${longBase} (ÕV1)`)
      const err = section.querySelector('.oa2-attach-ov-error')
      expect(err).not.toBeNull()
      expect(err.classList.contains('visible')).toBe(true)
      expect(err.textContent).toContain('100 märki')
    })

    test('clears the error once a different change fits within the limit', async () => {
      // Set up an over-limit attempt first, then untick to bring it back.
      const longBase = 'a'.repeat(95)
      const nameInput = mountModal({ entryName: `${longBase} (ÕV1)` })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) eelis', outcomeOrderNr: 0 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '2) teine', outcomeOrderNr: 1 }
          ])
        }
      }
      await feature._checkAndInject()
      const section = document.querySelector('.oa2-attach-ov-section')

      const cbForOv2 = section.querySelector('input[data-ov-num="2"]')
      cbForOv2.checked = true
      cbForOv2.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(section.querySelector('.oa2-attach-ov-error').classList.contains('visible')).toBe(true)

      // Untick ÕV1 — name shrinks, so any subsequent attempt to add ÕV2 fits.
      const cbForOv1 = section.querySelector('input[data-ov-num="1"]')
      cbForOv1.checked = false
      cbForOv1.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(section.querySelector('.oa2-attach-ov-error').classList.contains('visible')).toBe(false)
      expect(nameInput.value).toBe(longBase)
    })
  })

  describe('extractJournalId', () => {
    test('parses the id from the current journal edit URL', () => {
      expect(feature.extractJournalId()).toBe('426365')
    })

    test('returns null when not on a journal page', () => {
      setupDom('https://tahvel.edu.ee/#/journals')
      const f = new AttachOvToSissekanneIFeature()
      expect(f.extractJournalId()).toBeNull()
    })
  })
})
