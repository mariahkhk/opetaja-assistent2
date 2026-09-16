// TEST BUILD ONLY. Never imported by a production entry point.
// Replace external Tahvel and OS notification boundaries, not the production scheduler.
const actualFetch = globalThis.fetch.bind(globalThis)
const actualNow = Date.now.bind(Date)
const nativeAlarm = chrome.alarms.create.bind(chrome.alarms)
const nativeTab = chrome.tabs.create.bind(chrome.tabs)
const alarmListeners = []
const clickListeners = []
const addAlarmListener = chrome.alarms.onAlarm.addListener.bind(chrome.alarms.onAlarm)
const addClickListener = chrome.notifications.onClicked.addListener.bind(chrome.notifications.onClicked)
const alarms = new Map()
const state = {
  now: Date.parse('2026-09-14T05:50:00Z'), authenticated: true, recorded: false, cancelled: false,
  notifications: [], requests: [], emailUrl: null
}
Date.now = () => state.now
// Chromium may navigate extension-created tabs before Playwright can attach its routes.
// Capture the requested URL and open a real blank tab; the driver performs the routed navigation.
chrome.tabs.create = options => { state.openedUrl = options.url; return nativeTab({ ...options, url: 'about:blank' }) }
chrome.alarms.create = async(name, options) => { alarms.set(name, { name, scheduledTime: options.when, ...options }) }
chrome.alarms.get = (name, callback) => callback ? callback(alarms.get(name)) : Promise.resolve(alarms.get(name))
chrome.alarms.getAll = async() => [...alarms.values()]
chrome.alarms.clear = async name => alarms.delete(name)
chrome.alarms.onAlarm.addListener = listener => { alarmListeners.push(listener); addAlarmListener(listener) }
chrome.notifications.onClicked.addListener = listener => { clickListeners.push(listener); addClickListener(listener) }
chrome.notifications.getPermissionLevel = async() => 'granted'
chrome.notifications.create = async(id, options) => { state.notifications.push({ id, ...options }); return id }
chrome.notifications.clear = async() => true
const events = [
  { id: 2, journalId: 8, date: '2026-09-14', timeStart: '09:10', timeEnd: '09:55', nameEt: 'Synthetic subject', studentGroups: [{ id: 1, code: 'TEST' }] },
  { id: 3, journalId: 8, date: '2026-09-14', timeStart: '09:55', timeEnd: '10:40', nameEt: 'Synthetic subject', studentGroups: [{ id: 1, code: 'TEST' }] }
]
globalThis.fetch = async(input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input))
  if (url.protocol === 'chrome-extension:') return actualFetch(input, options)
  state.requests.push({ url: url.href, method: options.method || 'GET', body: options.body })
  if (state.emailUrl && url.href === state.emailUrl) return actualFetch(input, options)
  if (url.origin !== 'https://tahvel.edu.ee') throw new Error('Test blocked external network')
  if (!state.authenticated) return new Response('', { status: 401 })
  if (url.pathname === '/hois_back/user') return Response.json({ teacher: 10, school: { id: 9 } })
  if (url.pathname.includes('/timetableByTeacher/')) return Response.json({ timetableEvents: state.cancelled ? [] : events })
  if (url.pathname === '/hois_back/journals/8/journalEntriesByDate') return Response.json(state.recorded ? [
    { entryDate: '2026-09-14', entryType: 'SISSEKANNE_T', startLessonNr: 2, lessons: 2 }
  ] : [])
  throw new Error(`Unexpected worker request: ${url.pathname}`)
}
globalThis.lessonHarness = {
  state,
  fire(name) { alarms.delete(name); for (const listener of alarmListeners) listener({ name }) },
  click(id) { for (const listener of clickListeners) listener(id) },
  nativeAlarm(name) { return nativeAlarm(name, { when: actualNow() + 500 }) },
  alarms() { return [...alarms.values()] }
}
