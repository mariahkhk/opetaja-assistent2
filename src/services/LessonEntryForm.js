import { previousLessonAttendance } from './PreviousLessonAttendance.js'

/** Wait for a rendered field without retaining observers after timeout. */
async function waitFor(find, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = find()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Tahvli vorm ei ole valmis. Ava sissekanne käsitsi.')
}

/** Show a durable status inside the form, using text only. */
function status(form, text) {
  let element = form.querySelector('.oa2-lesson-prefill-status')
  if (!element) {
    element = document.createElement('p')
    element.className = 'oa2-lesson-prefill-status'
    element.setAttribute('role', 'status')
    element.style.cssText = 'padding:12px;background:#fff3cd;color:#332701'
    form.prepend(element)
  }
  element.textContent = text
}

/** Select a current Tahvel dropdown by its rendered label. */
async function select(form, name, label) {
  const field = await waitFor(() => form.querySelector(`tahvel-select[formcontrolname="${name}"]`))
  field.querySelector('.field').click()
  const option = await waitFor(() => [...field.querySelectorAll('button.dropdown-item')].find(b => b.textContent.trim() === label))
  option.click()
}

/** Fill an Angular control using the same input/change events as manual typing. */
function input(form, name, value) {
  const field = form.querySelector(`[formcontrolname="${name}"] input`)
  if (!field) throw new Error(`Väli ${name} puudub`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
  // Tahvel's date picker parses _term only after a keydown marks it modified.
  // Enter commits the date through the component's own parser/modelChange.
  if (field.closest('date-picker')) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  field.dispatchEvent(new Event('blur', { bubbles: true }))
}

/** Check a native Tahvel checkbox without toggling an already selected value. */
function check(control) {
  if (!control) return false
  const button = control.querySelector('button')
  if (!button || button.disabled) return false
  if (!control.querySelector('.checked') && !button.classList.contains('checked') && button.getAttribute('aria-checked') !== 'true') button.click()
  return true
}

/** Open and prefill a notified journal entry, never submitting it. */
export async function openLessonEntry(block, get, onOpened = () => {}) {
  const add = await waitFor(() => window.location.hash === `#/journal/${block.journalId}/edit` && [...document.querySelectorAll('button')].find(b =>
    ['lisa uus sissekanne', 'lisa sissekanne'].includes(b.textContent.trim().toLowerCase().replace(/\s+/g, ' ')) &&
    b.getClientRects().length && !b.disabled))
  add.click()
  const form = await waitFor(() => document.querySelector('form.tahvel-form [formcontrolname="entryType"]')?.closest('form'))
  onOpened()
  let userEdited = false
  const edited = event => { if (event.isTrusted) userEdited = true }
  form.addEventListener('input', edited)
  form.addEventListener('click', edited)
  status(form, 'ÕA2 täidab tunni andmeid…')
  try {
    await select(form, 'entryType', block.capacityType === 'MAHT_p' ? 'Praktiline töö' : block.capacityType === 'MAHT_i' ? 'Iseseisev töö' : 'Tund')
    const capacity = block.capacityType === 'MAHT_p' ? 'Praktiline õpe' : block.capacityType === 'MAHT_i' ? 'Iseseisev õpe' : 'Auditoorne õpe'
    check([...form.querySelectorAll('checkbox[formcontrolname="selected"]')].find(c => c.textContent.trim() === capacity))
    input(form, 'entryDate', block.date.split('-').reverse().join('.'))
    if (block.startLessonNr != null) await select(form, 'startLessonNr', String(block.startLessonNr))
    if (block.lessons != null) input(form, 'lessons', String(block.lessons))
    status(form, 'Tunni andmed on täidetud. Laadin eelmise tunni puudujaid…')
    const attendance = await previousLessonAttendance(get, block)
    if (!form.isConnected) return
    if (userEdited) {
      status(form, 'Vormi muudeti puudujate laadimise ajal. Puudujaid automaatselt ei muudetud; kontrolli need käsitsi.')
      return
    }
    for (const student of attendance.students) {
      const rows = [...form.querySelectorAll('tbody tr')].filter(row => {
        const spans = row.querySelectorAll('.student-cell > span > span')
        return spans[0]?.textContent.trim() === student.name && spans[1]?.textContent.replace(/^\s*,\s*/, '').trim() === student.group
      })
      if (rows.length === 1) {
        const control = rows[0].querySelector('checkbox[formcontrolname="absenceWithoutReason"]')
        // Never replace Tahvel's own excused/practice absences.
        if (!rows[0].querySelector('checkbox[formcontrolname="absenceExcused"],checkbox[formcontrolname="absencePractice"]')) check(control)
      }
    }
    status(form, `${attendance.warning || ''} Lisa tunni nimetus ja sisu ning kontrolli andmed enne salvestamist.${block.lessons == null ? ' Algustundi või tundide arvu ei saanud tunniaegade järgi tuvastada.' : ''}`)
  } catch (error) { status(form, `Eeltäitmine jäi pooleli: ${error.message} Kontrolli andmeid ja täida puuduvad väljad käsitsi.`) } finally {
    form.removeEventListener('input', edited)
    form.removeEventListener('click', edited)
  }
}

/** Start refreshes on page load/navigation and consume a notification link after authentication. */
export function initializeLessonEntry() {
  let lastRefresh = 0
  let opening = false
  const trigger = async() => {
    const url = new URL(window.location.href)
    let key = url.searchParams.get('oa2Lesson')
    if (key) {
      await chrome.runtime.sendMessage({ action: 'rememberLessonLink', key })
    } else {
      const pending = await chrome.runtime.sendMessage({ action: 'pendingLessonLink' })
      if (pending?.key) {
        key = pending.key
        url.searchParams.set('oa2Lesson', key)
        url.hash = `#/journal/${key.split('-')[0]}/edit`
        window.location.replace(url.href)
        return
      }
    }
    // Consume the saved notification before refresh can replace scheduler state.
    if (!key && Date.now() - lastRefresh > 30000) {
      lastRefresh = Date.now()
      chrome.runtime.sendMessage({ action: 'refreshLessonNotifications' }).catch(() => {})
    }
    if (!key || !/^#\/journal\/\d+\/edit$/.test(url.hash)) return
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getLessonNotification', key })
      const block = response?.block
      if (!block) throw new Error(response?.error || 'Teavituse tunni andmed pole kättesaadavad. Kontrolli Tahvli sisselogimist ja proovi lehte värskendada.')
      if (window.location.hash !== `#/journal/${block.journalId}/edit`) return
      await openLessonEntry(block, async(path, params = {}) => {
        const apiUrl = new URL(`/hois_back${path}`, window.location.origin)
        Object.entries(params).forEach(([k, v]) => apiUrl.searchParams.set(k, String(v)))
        const response = await fetch(apiUrl, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('Tahvli andmed pole kättesaadavad')
        return response.json()
      }, () => {
        const current = new URL(window.location.href)
        if (current.searchParams.get('oa2Lesson') === key) {
          current.searchParams.delete('oa2Lesson')
          window.history.replaceState(window.history.state, '', current)
        }
        chrome.runtime.sendMessage({ action: 'clearLessonLink' }).catch(() => {})
        document.getElementById('oa2-lesson-open-error')?.remove()
      })
    } finally { opening = false }
  }
  const run = () => {
    if (opening) return
    opening = true
    return trigger().catch(error => {
      console.warn('ÕA2 tunni vorm:', error.message)
      let notice = document.getElementById('oa2-lesson-open-error')
      if (!notice) {
        notice = document.createElement('div')
        notice.id = 'oa2-lesson-open-error'
        notice.setAttribute('role', 'alert')
        notice.style.cssText = 'position:fixed;top:12px;right:12px;max-width:460px;padding:16px;background:#fff3cd;color:#332701;z-index:99999'
        document.body.append(notice)
      }
      notice.textContent = `ÕA2 ei saanud sissekande vormi avada: ${error.message}`
    }).finally(() => { opening = false })
  }
  window.addEventListener('hashchange', () => { lastRefresh = 0; run() })
  window.addEventListener('focus', run)
  run()
}
