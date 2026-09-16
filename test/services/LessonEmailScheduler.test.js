import { test, expect } from 'bun:test'
import { registerLessonNotifications } from '../../src/services/LessonNotificationService.js'
import { cryptoService } from '../../src/services/CryptoService.js'

test('email waits ten minutes, fails closed on expired session, skips recorded blocks and deduplicates retries', async() => {
  const original = { chrome: global.chrome, fetch: global.fetch, encrypt: cryptoService.encrypt, decrypt: cryptoService.decrypt, now: Date.now }
  let now = Date.parse('2026-09-14T08:00:00Z')
  Date.now = () => now
  const handlers = {}
  const alarms = new Map()
  let stored = { OA_kriitEnabled: true, OA_kriitApiBaseUrl: 'https://kriit.example/api', OA_kriitApiToken: 'test' }
  let entries = []
  let expired = false
  let emails = 0
  cryptoService.encrypt = async text => ({ ct: text })
  cryptoService.decrypt = async blob => blob.ct
  global.fetch = async(url) => {
    url = String(url)
    if (url.includes('LessonTimes')) return Response.json({ 9: [{ number: 1, timeStart: '10:00', timeEnd: '11:00' }] })
    if (url.includes('kriit.example')) { emails++; return Response.json({ status: 200, data: { ok: true } }) }
    if (expired) return new Response('', { status: 401 })
    if (url.includes('/user')) return Response.json({ teacher: 10, school: { id: 9 } })
    if (url.includes('journalEntriesByDate')) return Response.json(entries)
    return Response.json({ timetableEvents: [{ id: 1, journalId: 8, date: '2026-09-14', timeStart: '10:00', timeEnd: '11:00', studentGroups: [] }] })
  }
  global.chrome = {
    runtime: { id: 'test', getURL: p => p, onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: fn => { handlers.message = fn } } },
    storage: { local: { get: async() => stored, set: async value => { stored = { ...stored, ...value } } } },
    alarms: {
      get: (name, cb) => cb ? cb(alarms.get(name)) : Promise.resolve(alarms.get(name)),
      getAll: async() => [...alarms.values()], clear: async name => alarms.delete(name),
      create: async(name, options) => alarms.set(name, { name, scheduledTime: options.when, ...options }),
      onAlarm: { addListener: fn => { handlers.alarm = fn } }
    },
    notifications: { onClicked: { addListener: () => {} } }
  }
  const idle = () => new Promise(resolve => handlers.message({ action: 'lessonNotificationStatus' }, { id: 'test' }, resolve))
  const refresh = async() => {
    handlers.message({ action: 'refreshLessonNotifications' }, { url: 'https://tahvel.edu.ee/' }, () => {})
    await idle()
  }
  const fire = async name => { alarms.delete(name); handlers.alarm({ name }); await idle() }
  try {
    registerLessonNotifications()
    await refresh()
    const alarm = [...alarms.values()].find(a => a.name.startsWith('oa2-lesson-email:'))
    expect(alarm.scheduledTime).toBe(now + 600000)
    const snapshot = stored.OA_lessonNotifications
    now += 599999
    await fire(alarm.name)
    expect(emails).toBe(0)
    now++
    expired = true
    await fire(alarm.name)
    expect(emails).toBe(0)
    expired = false
    await refresh()
    expect(alarms.has(alarm.name)).toBe(true)
    entries = [{ entryDate: '2026-09-14', entryType: 'SISSEKANNE_T', startLessonNr: 1, lessons: 1 }]
    await fire(alarm.name)
    expect(emails).toBe(0)
    expect(Object.values(JSON.parse(stored.OA_lessonNotifications.ct).emailDone)).toEqual([true])
    stored.OA_lessonNotifications = snapshot
    entries = []
    await fire(alarm.name)
    await fire(alarm.name)
    expect(emails).toBe(1)
    await refresh()
    expect(alarms.has(alarm.name)).toBe(false)
  } finally {
    Date.now = original.now
    global.chrome = original.chrome
    global.fetch = original.fetch
    cryptoService.encrypt = original.encrypt
    cryptoService.decrypt = original.decrypt
  }
})
