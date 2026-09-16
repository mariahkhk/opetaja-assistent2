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
  button.disabled = true
  try {
    const timing = await readLessonTiming()
    reference.value = timing.reference
    direction.value = timing.direction
    minutes.value = timing.minutes
  } catch {
    status.textContent = 'Seade laadimine ebaõnnestus. Ava hüpikaken uuesti.'
    return
  }
  button.disabled = false
  form.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    try {
      const timing = validateLessonTiming({ reference: reference.value, direction: direction.value, minutes: minutes.value.trim() === '' ? NaN : Number(minutes.value) })
      const result = await chrome.runtime.sendMessage({ action: 'saveLessonNotificationTiming', timing })
      if (!result?.ok) throw new Error(result?.error || 'Salvestamine ebaõnnestus.')
      status.textContent = 'Salvestatud. Ootel märguanded on ümber ajastatud.'
    } catch (error) {
      status.textContent = error.message
    } finally { button.disabled = false }
  })
}
