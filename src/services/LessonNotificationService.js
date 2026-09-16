import Logger from './Logger.js'
import { resolveLessonLink } from './LessonNotificationLink.js'
import { isLessonRecorded, lessonEmailSettings, sendLessonEmail } from './LessonEmailReminder.js'
import { LESSON_TIMING_KEY, readLessonTiming, validateLessonTiming, lessonNotificationAt, lessonNotificationDates } from './LessonNotificationTiming.js'
import { cryptoService } from './CryptoService.js'
import { buildLessonBlocks, tallinnDate, lessonTimestamp } from './LessonSchedule.js'

const KEY = 'OA_lessonNotifications'
const REFRESH = 'oa2-lesson-refresh'
const MIDNIGHT = 'oa2-lesson-midnight'
const PREFIX = 'oa2-lesson:'
const EMAIL_PREFIX = 'oa2-lesson-email:'
const ORIGINS = ['https://tahvel.edu.ee', 'https://test.tahvel.eenet.ee']
let queue = Promise.resolve()

/** Serialize background state changes across alarms, page loads, and notification clicks. */
function serialize(operation) {
  const task = queue.then(operation)
  queue = task.catch(() => {})
  return task
}

/** Read only the scheduler's encrypted state, treating invalid data as a cache miss. */
async function readState() {
  const stored = (await chrome.storage.local.get(KEY))[KEY]
  try { return stored ? JSON.parse(await cryptoService.decrypt(stored)) : {} } catch { return {} }
}

/** Persist timetable data encrypted using the extension's existing cache key. */
async function saveState(state) {
  await chrome.storage.local.set({ [KEY]: await cryptoService.encrypt(JSON.stringify(state)) })
}

/** Make a read-only authenticated request to an explicitly supported Tahvel origin. */
export async function lessonGet(origin, path, params = {}) {
  if (!ORIGINS.includes(origin)) throw new Error('Tundmatu Tahvli aadress')
  const url = new URL(`${origin}/hois_back${path}`)
  Object.entries(params).forEach(([key, value]) => { if (value != null) url.searchParams.set(key, String(value)) })
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('Tahvli sessioon pole kättesaadav')
  return response.json()
}

/** Reconcile alarms with the latest successful timetable without replaying earlier lessons. */
async function reconcile(state, timingChanged = false) {
  const timing = await readLessonTiming()
  const now = Date.now()
  const alarms = await chrome.alarms.getAll()
  const existing = new Set(alarms.map(a => a.name))
  const planned = new Map((state.blocks || []).filter(b =>
    (lessonNotificationAt(b, timing) > now || (!timingChanged && existing.has(PREFIX + b.key))) && !state.sent?.[b.key])
    .map(b => [PREFIX + b.key, b]))
  for (const alarm of alarms) {
    if (alarm.name.startsWith(PREFIX) && !planned.has(alarm.name)) await chrome.alarms.clear(alarm.name)
  }
  for (const [name, block] of planned) {
    const alarm = await chrome.alarms.get(name)
    const when = lessonNotificationAt(block, timing)
    if (!alarm || alarm.scheduledTime !== when) await chrome.alarms.create(name, { when })
  }
  const emailEnabled = await lessonEmailSettings()
  const emailBlocks = new Map((state.blocks || []).filter(b => emailEnabled && !state.emailDone?.[b.key] &&
    b.end + 86400000 > now).map(b => [EMAIL_PREFIX + b.key, b]))
  for (const alarm of alarms) {
    if (alarm.name.startsWith(EMAIL_PREFIX) && !emailBlocks.has(alarm.name)) await chrome.alarms.clear(alarm.name)
  }
  for (const [name, block] of emailBlocks) {
    const alarm = await chrome.alarms.get(name)
    const due = block.end + 600000
    if (!alarm || (due > now && alarm.scheduledTime !== due)) await chrome.alarms.create(name, { when: Math.max(now + 1000, due) })
  }
  const tomorrow = new Date(`${tallinnDate(now)}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  await chrome.alarms.create(MIDNIGHT, { when: lessonTimestamp(tomorrow.toISOString().slice(0, 10), '00:00') })
}

/** Refresh timetable dates needed for today's notifications, retaining recent pending reminders. */
async function refresh(origin) {
  const state = await readState()
  // Discard schedules persisted by the earlier clock-shift prototype.
  if (state.testClock) {
    state.blocks = []
    state.sent = {}
    delete state.testClock
    await saveState(state)
    await reconcile(state)
  }
  origin ||= state.origin
  if (!ORIGINS.includes(origin)) return
  const date = tallinnDate()
  const sourceDate = date
  try {
    const user = await lessonGet(origin, '/user')
    const teacherId = user.teacherId ?? user.teacher
    const schoolId = user.school?.id
    if (!Number.isInteger(teacherId) || !schoolId) {
      await reconcile({ blocks: [] })
      await saveState({ origin, blocks: [], error: 'Logi Tahvlisse sisse õpetajana.' })
      return
    }
    const owner = `${origin}:${schoolId}:${teacherId}`
    if (state.owner !== owner) { state.blocks = []; state.sent = {}; state.emailDone = {}; state.testClock = null }
    // Record the identity before fetching the timetable, so a failed fetch after an
    // account switch cannot reuse another teacher's schedule.
    Object.assign(state, { origin, owner, schoolId, teacherId })
    const timing = await readLessonTiming()
    const dates = lessonNotificationDates(timing)
    const timesResponse = await fetch(chrome.runtime.getURL('src/features/singleJournal/lessonDiscrepancies/LessonTimes.json'))
    const times = (await timesResponse.json())[schoolId] || []
    const blocks = []
    for (const scheduledDate of dates) {
      const nextDate = new Date(`${scheduledDate}T12:00:00Z`)
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      const data = await lessonGet(origin, `/timetableevents/timetableByTeacher/${schoolId}`, {
        teachers: teacherId,
        from: new Date(lessonTimestamp(scheduledDate, '00:00')).toISOString(),
        thru: new Date(lessonTimestamp(nextDate.toISOString().slice(0, 10), '00:00') - 1).toISOString(),
        lang: 'ET'
      })
      if (!Array.isArray(data?.timetableEvents)) throw new Error('Tunniplaani vastus on vigane')
      blocks.push(...buildLessonBlocks(data.timetableEvents, times, scheduledDate).map(block => ({ ...block, lessonTimes: times })))
    }
    const retained = (state.blocks || []).filter(b => !dates.includes(b.date) && b.end + 86400000 > Date.now())
    state.blocks = [...retained, ...blocks]
    const retainedKeys = new Set(state.blocks.map(b => b.key))
    state.emailDone = Object.fromEntries(Object.entries(state.emailDone || {}).filter(([key]) => retainedKeys.has(key)))
    state.sourceDate = sourceDate
    state.sent = Object.fromEntries(Object.entries(state.sent || {}).filter(([, sent]) => (sent.notifiedAt ?? sent.end) + 7 * 86400000 > Date.now()))
    state.updatedAt = Date.now()
    state.error = null
  } catch (error) {
    state.error = error.message
    state.blocks = (state.blocks || []).filter(b => b.end + 86400000 > Date.now())
  }
  await saveState(state)
  await reconcile(state)
}

/** Display each scheduled block once, keeping enough state for a later click. */
async function notify(name) {
  const state = await readState()
  const block = state.blocks?.find(b => PREFIX + b.key === name)
  const timing = await readLessonTiming()
  if (!block || state.sent?.[block.key] || lessonNotificationAt(block, timing) > Date.now() ||
      lessonNotificationAt(block, timing) + 86400000 < Date.now()) return
  if (await chrome.notifications.getPermissionLevel() !== 'granted') return
  await chrome.notifications.create(name, {
    type: 'basic',
iconUrl: chrome.runtime.getURL('icon128.png'),
    title: `${Date.now() >= block.end ? 'Tund lõppes' : 'Tunni sissekanne'}: ${block.name} · ${block.groups.map(g => g.code).join(', ')}`,
    message: `${block.timeStart}–${block.timeEnd}. Klõpsa päeviku sissekande lisamiseks.`,
requireInteraction: true
  })
  state.sent ||= {}
  state.sent[block.key] = { ...block, notifiedAt: Date.now() }
  await saveState(state)
}

/** Check fresh entries and current identity immediately before requesting a Kriit email. */
async function emailReminder(name) {
  const state = await readState()
  const block = state.blocks?.find(b => EMAIL_PREFIX + b.key === name)
  if (!block || state.emailDone?.[block.key] || Date.now() < block.end + 600000 || Date.now() > block.end + 86400000) return
  const settings = await lessonEmailSettings()
  if (!settings) return
  const user = await lessonGet(state.origin, '/user')
  if (`${state.origin}:${user.school?.id}:${user.teacherId ?? user.teacher}` !== state.owner) return
  // Timetable changes can cancel or move a block between periodic refreshes.
  const current = await resolveLessonLink(state.origin, block.key, lessonGet)
  if (current.schoolId !== state.schoolId || current.end !== block.end || current.lessons !== block.lessons) return
  const entries = await lessonGet(state.origin, `/journals/${block.journalId}/journalEntriesByDate`)
  if (!isLessonRecorded(entries, current)) await sendLessonEmail(settings, state.origin, state.schoolId, current)
  state.emailDone ||= {}
  state.emailDone[block.key] = true
  await saveState(state)
}

/** Install persistent alarm handlers; the 15-minute timer is not reset on worker wakes. */
export function registerLessonNotifications() {
  const run = task => task.catch(error => Logger.warning('Tunni märguanne:', error.message))
  run(chrome.alarms.clear('oa2-lesson-notification-prototype'))
  chrome.tabs?.onRemoved?.addListener(tabId => run(serialize(() => chrome.storage.session.remove(`OA_pendingLesson_${tabId}`))))
  chrome.alarms.get(REFRESH, alarm => { if (!alarm) chrome.alarms.create(REFRESH, { periodInMinutes: 15 }) })
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === REFRESH || alarm.name === MIDNIGHT) run(serialize(() => refresh()))
    else if (alarm.name.startsWith(PREFIX)) run(serialize(() => notify(alarm.name)))
    else if (alarm.name.startsWith(EMAIL_PREFIX)) run(serialize(() => emailReminder(alarm.name)))
  })
  chrome.runtime.onStartup.addListener(() => run(serialize(() => refresh())))
  chrome.runtime.onInstalled.addListener(() => run(serialize(() => refresh())))
  chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith(PREFIX)) return
    run(serialize(async() => {
      const state = await readState()
      const block = state.sent?.[id.slice(PREFIX.length)]
      if (!block) return
      // Use a query parameter before the hash: Tahvel tests its route's suffix
      // to decide whether the journal is editable.
      await chrome.tabs.create({ url: `${state.origin}/?oa2Lesson=${encodeURIComponent(block.key)}#/journal/${block.journalId}/edit`, active: true })
      await chrome.notifications.clear(id)
    }))
  })
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    let origin
    try { origin = new URL(sender.url).origin } catch { /* Extension messages may have no page URL. */ }
    const popupSender = sender.id === chrome.runtime.id && (!sender.tab || sender.url === chrome.runtime.getURL('popup.html'))
    if (message.action === 'saveLessonNotificationTiming' && popupSender) {
      serialize(async() => {
        const timing = validateLessonTiming(message.timing)
        await chrome.storage.local.set({ [LESSON_TIMING_KEY]: timing })
        await reconcile(await readState(), true)
        await refresh()
        return { ok: true }
      }).then(respond, error => respond({ error: error.message }))
      return true
    }
    if (message.action === 'lessonNotificationStatus' && popupSender) {
      serialize(async() => {
        const state = await readState()
        const timing = await readLessonTiming()
        const future = (state.blocks || []).map(b => ({ ...b, notificationAt: lessonNotificationAt(b, timing) }))
          .filter(b => b.notificationAt > Date.now() && !state.sent?.[b.key]).sort((a, b) => a.notificationAt - b.notificationAt)
        return { updatedAt: state.updatedAt, error: state.error, sourceDate: state.sourceDate, planned: future.length, nextAt: future[0]?.notificationAt }
      }).then(respond, () => respond({ error: 'Tunniplaani olekut ei saanud lugeda' }))
      return true
    }
    if (message.action === 'refreshLessonNotifications' && ORIGINS.includes(origin)) {
      run(serialize(() => refresh(origin)))
      return false
    }
    if (['rememberLessonLink', 'pendingLessonLink', 'clearLessonLink'].includes(message.action) && ORIGINS.includes(origin) && sender.tab?.id != null) {
      serialize(async() => {
        const storageKey = `OA_pendingLesson_${sender.tab.id}`
        if (message.action === 'clearLessonLink') {
          await chrome.storage.session.remove(storageKey)
          return {}
        }
        if (message.action === 'rememberLessonLink') {
          if (typeof message.key !== 'string' || !/^\d+-\d{4}-\d{2}-\d{2}-(\d+|\d{2}:\d{2})$/.test(message.key)) return {}
          await chrome.storage.session.set({ [storageKey]: { key: message.key, origin } })
          return {}
        }
        const pending = (await chrome.storage.session.get(storageKey))[storageKey]
        if (pending?.origin !== origin) return {}
        const user = await lessonGet(origin, '/user')
        if (!Number.isInteger(user.teacherId ?? user.teacher)) return {}
        return { key: pending.key }
      }).then(respond, () => respond({}))
      return true
    }
    if (message.action === 'getLessonNotification' && ORIGINS.includes(origin)) {
      serialize(async() => {
        const state = await readState()
        const block = state.sent?.[message.key]
        if (!block || state.origin !== origin || block.date !== tallinnDate()) return resolveLessonLink(origin, message.key, lessonGet)
        const user = await lessonGet(origin, '/user')
        if (`${origin}:${user.school?.id}:${user.teacherId ?? user.teacher}` !== state.owner) throw new Error('Logi Tahvlisse sisse teavituse saanud õpetaja kontoga.')
        return { ...block, schoolId: state.schoolId }
      }).then(block => respond({ block }), error => respond({ block: null, error: error.message }))
      return true
    }
    return false
  })
}
