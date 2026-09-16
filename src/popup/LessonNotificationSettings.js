import { readLessonTiming, validateLessonTiming } from '../services/LessonNotificationTiming.js'

/** Initialize the lesson timing form, reporting validation and persistence failures inline. */
export async function initializeLessonNotificationSettings() {
  const form = document.getElementById('lesson-notification-settings')
  if (!form) return
  const reference = form.elements.namedItem('reference')
  const direction = form.elements.namedItem('direction')
  const minutes = form.elements.namedItem('minutes')
  const status = document.getElementById('lesson-notification-settings-status')
  const button = form.querySelector('button')
  const fields = form.querySelector('fieldset')
  const preview = document.getElementById('lesson-timing-preview')
  /** Read and validate the current controls without treating an empty number as zero. */
  const currentTiming = () => validateLessonTiming({ reference: reference.value, direction: direction.value, minutes: minutes.value.trim() === '' ? NaN : Number(minutes.value) })
  /** Explain the unsaved selection in a natural sentence, including exact start/end times. */
  const updatePreview = () => {
    try {
      const timing = currentTiming()
      const point = timing.reference === 'start' ? 'algust' : 'lõppu'
      preview.textContent = timing.minutes === 0
        ? `Teavitus saabub täpselt tunni ${timing.reference === 'start' ? 'alguses' : 'lõpus'}.`
        : `Teavitus saabub ${timing.minutes} ${timing.minutes === 1 ? 'minut' : 'minutit'} ${timing.direction === 'before' ? 'enne' : 'pärast'} tunni ${point}.`
      minutes.removeAttribute('aria-invalid')
    } catch {
      preview.textContent = 'Sisesta minutite arv: 0 või suurem täisarv.'
      minutes.setAttribute('aria-invalid', 'true')
    }
  }
  button.disabled = true
  fields.disabled = true
  try {
    const timing = await readLessonTiming()
    reference.value = timing.reference
    direction.value = timing.direction
    minutes.value = timing.minutes
  } catch {
    status.dataset.state = 'error'
    status.textContent = 'Seade laadimine ebaõnnestus. Ava hüpikaken uuesti.'
    return
  }
  updatePreview()
  button.disabled = false
  fields.disabled = false
  /** Remove stale save feedback whenever the user changes a setting. */
  const onEdit = () => {
    status.textContent = ''
    delete status.dataset.state
    updatePreview()
  }
  form.addEventListener('input', onEdit)
  form.addEventListener('change', onEdit)
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (button.disabled) return
    button.disabled = true
    fields.disabled = true
    button.textContent = 'Salvestan…'
    status.textContent = ''
    delete status.dataset.state
    try {
      const timing = currentTiming()
      const result = await chrome.runtime.sendMessage({ action: 'saveLessonNotificationTiming', timing })
      if (!result?.ok) throw new Error(result?.error || 'Salvestamine ebaõnnestus.')
      status.dataset.state = 'success'
      status.textContent = 'Salvestatud. Teavitused saabuvad valitud ajal.'
    } catch (error) {
      status.dataset.state = 'error'
      status.textContent = error.message
    } finally {
      button.disabled = false
      fields.disabled = false
      button.textContent = 'Salvesta'
      updatePreview()
    }
  })
}
