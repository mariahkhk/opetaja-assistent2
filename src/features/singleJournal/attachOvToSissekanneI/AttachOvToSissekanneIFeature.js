import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import { domService } from '../../../services/DomService.js'

const STYLE_ID = 'oa2-attach-ov-style'
const SECTION_CLASS = 'oa2-attach-ov-section'
const SECTION_ATTR = 'data-oa2-attach-ov'
const FORM_FIELDS_SELECTOR = 'add-entry .form-flexible-fields'
const MAX_NAME_LENGTH = 100
const MUTATION_DEBOUNCE_MS = 80
// Match any `(ÕVn[, ÕVm…])` group anywhere in the string. The leading `\s*`
// swallows the single space we inject before our trailing suffix so successive
// normalisations don't accumulate spaces between user-typed characters; trailing
// whitespace is intentionally NOT consumed so `"abc (ÕV3) def"` survives as
// `"abc def (ÕV3)"`.
const OV_GROUP_RE = /\s*\(\s*ÕV\s*\d+(?:\s*,\s*ÕV\s*\d+)*\s*\)/gi
const OV_NUM_RE = /ÕV\s*(\d+)/gi

const STYLES = `
  .${SECTION_CLASS} {
    grid-column: 1 / -1;
    border: 1px solid #d9d9d6;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 4px 0;
    background: #fafbfc;
    font-family: Arial, sans-serif;
    color: #212529;
  }
  .${SECTION_CLASS} .oa2-attach-ov-title {
    font-size: 13px;
    color: #6c757d;
    line-height: 1.25;
    margin-bottom: 8px;
  }
  .${SECTION_CLASS} .oa2-attach-ov-title strong {
    display: block;
    color: #212529;
    font-size: 14px;
    font-weight: 600;
  }
  .${SECTION_CLASS} .oa2-attach-ov-hint {
    color: #6c757d;
    font-size: 12px;
    line-height: 1.35;
    margin-top: 2px;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 2px;
    border-top: 1px solid #f1f3f5;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row:first-of-type {
    border-top: none;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row label {
    flex: 1;
    cursor: pointer;
    line-height: 1.35;
    font-size: 13px;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row input[type="checkbox"] {
    margin-top: 3px;
    cursor: pointer;
  }
  .${SECTION_CLASS} .oa2-attach-ov-tag {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: #1565c0;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
  }
  .${SECTION_CLASS} .oa2-attach-ov-error {
    display: none;
    margin-top: 8px;
    padding: 6px 8px;
    border: 1px solid #f5c2c7;
    background: #f8d7da;
    color: #842029;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.35;
  }
  .${SECTION_CLASS} .oa2-attach-ov-error.visible {
    display: block;
  }
`

function formatOvSuffix(ovNums) {
  const sorted = [...new Set((ovNums || []).map(String))].sort((a, b) => Number(a) - Number(b))
  if (sorted.length === 0) return ''
  return `(${sorted.map(n => `ÕV${n}`).join(', ')})`
}

export default class AttachOvToSissekanneIFeature extends BaseFeature {
  constructor() {
    super('attachOvToSissekanneI', /#\/journal\/\d+\/edit/)
    this._bodyObserver = null
    this._mutationDebounce = null
    this._cachedOvs = null
    this._cachedJournalId = null
    this._cachedOvsLoadedAt = 0
    this._inflightOvLoad = null
    this._activeNameInput = null
    this._activeNameInputListener = null
    this._lastSyncedValue = null
    this._suppressInputSync = false
  }

  onActivate() {
    styleService.injectCSS(STYLES, STYLE_ID)
    this._installBodyObserver()
    this._checkAndInject().catch(err => Logger.debug(`[${this.name}] Initial inject failed`, err))
  }

  onDeactivate() {
    if (this._bodyObserver) {
      this._bodyObserver.disconnect()
      this._bodyObserver = null
    }
    if (this._mutationDebounce) {
      clearTimeout(this._mutationDebounce)
      this._mutationDebounce = null
    }
    this._teardownActiveSection()
    document.querySelectorAll(`.${SECTION_CLASS}`).forEach(el => el.remove())
    styleService.removeCSS(STYLE_ID)
    super.onDeactivate()
  }

  extractJournalId() {
    const match = (typeof window !== 'undefined' ? window.location.href : '').match(/#\/journal\/(\d+)/)
    return match ? match[1] : null
  }

  async loadAvailableOvs(journalId, { force = false } = {}) {
    if (!force && this._cachedOvs && this._cachedJournalId === journalId && Date.now() - this._cachedOvsLoadedAt < 60_000) {
      return this._cachedOvs
    }
    if (this._inflightOvLoad && this._inflightOvLoad.journalId === journalId) {
      return this._inflightOvLoad.promise
    }
    const promise = this.api.tahvel
      .get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false })
      .then(entries => {
        const list = Array.isArray(entries) ? entries : []
        const ovs = list
          .filter(e => e && e.entryType === 'SISSEKANNE_O' && typeof e.outcomeOrderNr === 'number')
          .map(e => ({ ovNum: String(e.outcomeOrderNr + 1), nameEt: e.nameEt || '' }))
          .sort((a, b) => Number(a.ovNum) - Number(b.ovNum))
        this._cachedOvs = ovs
        this._cachedJournalId = journalId
        this._cachedOvsLoadedAt = Date.now()
        return ovs
      })
      .finally(() => {
        this._inflightOvLoad = null
      })
    this._inflightOvLoad = { journalId, promise }
    return promise
  }

  normalizeOvsToEnd(value) {
    if (!value) return { baseText: '', ovNums: [], newValue: '' }
    const collected = []
    for (const match of value.matchAll(OV_GROUP_RE)) {
      for (const num of match[0].matchAll(OV_NUM_RE)) collected.push(num[1])
    }
    if (collected.length === 0) return { baseText: value, ovNums: [], newValue: value }
    const baseText = value.replace(OV_GROUP_RE, '').trim()
    const sorted = [...new Set(collected)].sort((a, b) => Number(a) - Number(b))
    const suffix = formatOvSuffix(sorted)
    const newValue = baseText ? `${baseText} ${suffix}` : suffix
    return { baseText, ovNums: sorted, newValue }
  }

  buildNewNameEt(currentNameEt, selectedOvNums) {
    const { baseText } = this.normalizeOvsToEnd(currentNameEt || '')
    const suffix = formatOvSuffix(selectedOvNums)
    if (!suffix) return baseText
    return baseText ? `${baseText} ${suffix}` : suffix
  }

  _writeNameInput(input, newValue) {
    this._suppressInputSync = true
    try {
      domService.setReactiveInputValue(input, newValue)
    } finally {
      this._suppressInputSync = false
    }
    this._lastSyncedValue = newValue
  }

  _installBodyObserver() {
    if (this._bodyObserver) return
    this._bodyObserver = new MutationObserver(() => {
      if (this._mutationDebounce) clearTimeout(this._mutationDebounce)
      this._mutationDebounce = setTimeout(() => {
        this._mutationDebounce = null
        this._checkAndInject().catch(err => Logger.debug(`[${this.name}] Inject after mutation failed`, err))
      }, MUTATION_DEBOUNCE_MS)
    })
    this._bodyObserver.observe(document.body, { childList: true, subtree: true })
  }

  _findNameInput(formFieldsRoot) {
    for (const ti of formFieldsRoot.querySelectorAll('tahvel-input')) {
      const text = (ti.textContent || '').replace(/\s+/g, ' ').trim()
      if (text.includes('Sissekande nimetus')) return ti.querySelector('input')
    }
    return null
  }

  async _checkAndInject() {
    const formFieldsRoot = document.querySelector(FORM_FIELDS_SELECTOR)
    if (!formFieldsRoot) {
      if (this._activeNameInput && !document.body.contains(this._activeNameInput)) {
        this._teardownActiveSection()
      }
      return
    }
    const existingSection = formFieldsRoot.querySelector(`.${SECTION_CLASS}`)
    if (existingSection) {
      // Tahvel hydrates the name field asynchronously when editing an existing
      // entry, so re-sync each tick; the value-change guard inside makes the
      // hot path a single string comparison when nothing has changed.
      if (this._activeNameInput && document.body.contains(this._activeNameInput)) {
        this._syncCheckboxesFromName(existingSection, this._activeNameInput)
      }
      return
    }

    const nameInput = this._findNameInput(formFieldsRoot)
    if (!nameInput) return

    const journalId = this.extractJournalId()
    if (!journalId) return

    const availableOvs = await this.loadAvailableOvs(journalId)
    if (!availableOvs.length) return
    if (!document.body.contains(formFieldsRoot)) return
    if (formFieldsRoot.querySelector(`.${SECTION_CLASS}`)) return

    this._injectSection(formFieldsRoot, nameInput, availableOvs)
  }

  _injectSection(formFieldsRoot, nameInput, availableOvs) {
    // Drop any listener bound to a previously mounted (now-detached) input
    // before claiming the new one as active.
    this._teardownActiveSection()

    const section = document.createElement('div')
    section.className = SECTION_CLASS
    section.setAttribute(SECTION_ATTR, '1')

    const title = document.createElement('div')
    title.className = 'oa2-attach-ov-title'
    const titleStrong = document.createElement('strong')
    titleStrong.textContent = 'Seotud õpiväljundid'
    title.appendChild(titleStrong)
    const hint = document.createElement('div')
    hint.className = 'oa2-attach-ov-hint'
    hint.textContent = 'Märgi õpiväljundid, mida see sissekanne hindab — assistent võimaldab hiljem panna õpiväljundite hinded automaatselt.'
    title.appendChild(hint)
    section.appendChild(title)

    const initialOvs = new Set(this.normalizeOvsToEnd(nameInput.value || '').ovNums)
    for (const ov of availableOvs) {
      const row = document.createElement('div')
      row.className = 'oa2-attach-ov-row'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.id = `oa2-attach-ov-cb-${ov.ovNum}`
      checkbox.checked = initialOvs.has(ov.ovNum)
      checkbox.dataset.ovNum = ov.ovNum
      checkbox.addEventListener('change', () => this._onCheckboxChange(section, nameInput, checkbox))

      const label = document.createElement('label')
      label.htmlFor = checkbox.id
      const tag = document.createElement('span')
      tag.className = 'oa2-attach-ov-tag'
      tag.textContent = `ÕV${ov.ovNum}`
      label.appendChild(tag)
      label.appendChild(document.createTextNode(ov.nameEt))
      row.appendChild(checkbox)
      row.appendChild(label)
      section.appendChild(row)
    }

    // Append at the end of form-flexible-fields so the original grid layout —
    // entry-type select, name input, and the "Teavita õppijat" checkbox in the
    // top-right corner — stays intact. Inserting between the name input and
    // the checkbox would push the checkbox onto its own row.
    formFieldsRoot.appendChild(section)

    this._activeNameInput = nameInput
    this._lastSyncedValue = nameInput.value || ''
    this._activeNameInputListener = () => {
      if (this._suppressInputSync) return
      this._syncCheckboxesFromName(section, nameInput)
    }
    nameInput.addEventListener('input', this._activeNameInputListener)
  }

  _onCheckboxChange(section, nameInput, changedCheckbox) {
    const selected = Array.from(section.querySelectorAll('input[type="checkbox"]'))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.ovNum)
    const newName = this.buildNewNameEt(nameInput.value || '', selected)
    if (newName.length > MAX_NAME_LENGTH) {
      if (changedCheckbox) changedCheckbox.checked = !changedCheckbox.checked
      this._showError(
        section,
        `Sissekande nimetus ületaks ${MAX_NAME_LENGTH} märki (${newName.length} märki). Lühenda kõigepealt nimetust.`
      )
      return
    }
    this._clearError(section)
    if (newName !== nameInput.value) {
      this._writeNameInput(nameInput, newName)
    }
  }

  _syncCheckboxesFromName(section, nameInput) {
    const current = nameInput.value || ''
    if (current === this._lastSyncedValue) return

    const { ovNums, newValue } = this.normalizeOvsToEnd(current)

    // Tahvel overwrites the name field with the entry-type label when the
    // teacher picks "Sissekande liik" — wiping any (ÕVn) suffix. If the input
    // lost all ÕV tags but the checkbox state still claims some are attached,
    // re-append the suffix so the teacher's previous selection survives.
    const checkboxes = Array.from(section.querySelectorAll('input[type="checkbox"]'))
    const checkedNums = checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.ovNum)
    if (ovNums.length === 0 && checkedNums.length > 0) {
      const restored = this.buildNewNameEt(current, checkedNums)
      if (restored.length <= MAX_NAME_LENGTH) {
        this._writeNameInput(nameInput, restored)
        this._clearError(section)
        return
      }
    }

    const set = new Set(ovNums)
    checkboxes.forEach(cb => {
      cb.checked = set.has(cb.dataset.ovNum)
    })

    if (newValue !== current && newValue.length <= MAX_NAME_LENGTH) {
      this._writeNameInput(nameInput, newValue)
    } else {
      this._lastSyncedValue = current
    }

    if ((this._lastSyncedValue || current).length <= MAX_NAME_LENGTH) {
      this._clearError(section)
    }
  }

  _showError(section, text) {
    if (!section) return
    let err = section.querySelector('.oa2-attach-ov-error')
    if (!err) {
      err = document.createElement('div')
      err.className = 'oa2-attach-ov-error'
      section.appendChild(err)
    }
    err.textContent = text
    err.classList.add('visible')
  }

  _clearError(section) {
    if (!section) return
    const err = section.querySelector('.oa2-attach-ov-error')
    if (err) {
      err.textContent = ''
      err.classList.remove('visible')
    }
  }

  _teardownActiveSection() {
    if (this._activeNameInput && this._activeNameInputListener) {
      this._activeNameInput.removeEventListener('input', this._activeNameInputListener)
    }
    this._activeNameInput = null
    this._activeNameInputListener = null
    this._lastSyncedValue = null
  }
}
