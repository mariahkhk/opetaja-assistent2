import { test, expect } from 'bun:test'
import { registerLessonNotifications } from '../../src/services/LessonNotificationService.js'
import { cryptoService } from '../../src/services/CryptoService.js'
import { tallinnDate } from '../../src/services/LessonSchedule.js'

test('refresh reconciles cancellations, preserves schedule on session failure, and deduplicates notifications', async() => {
  const original = { chrome: global.chrome, fetch: global.fetch, encrypt: cryptoService.encrypt, decrypt: cryptoService.decrypt, now: Date.now }
  let now = Date.parse('2026-09-14T20:44:00Z')
  Date.now = () => now
  const handlers = {}
  const alarms = new Map()
  let stored = {}
  const pending = {}
  let events = [{ id: 1, journalId: 8, date: tallinnDate(), timeStart: '23:00', timeEnd: '23:45', studentGroups: [] }]
  let expired = false
  let notifications = 0
  cryptoService.encrypt = async text => ({ ct: text })
  cryptoService.decrypt = async blob => blob.ct
  global.fetch = async url => {
    if (String(url).includes('LessonTimes')) return Response.json({})
    if (expired) return new Response('', { status: 401 })
    return Response.json(String(url).includes('/user') ? { teacher: 10, school: { id: 9 } } : { timetableEvents: events })
  }
  global.chrome = {
    runtime: { id: 'test', getURL: p => p, onInstalled: { addListener: () => {} }, onStartup: { addListener: fn => { handlers.start = fn } }, onMessage: { addListener: fn => { handlers.message = fn } } },
    storage: {
      local: { get: async() => stored, set: async value => { stored = { ...stored, ...value } } },
      session: { get: async() => pending, set: async value => Object.assign(pending, value), remove: async key => { delete pending[key] } }
    },
    alarms: {
      get: (name, cb) => cb ? cb(alarms.get(name)) : Promise.resolve(alarms.get(name)),
      getAll: async() => [...alarms.values()], clear: async name => alarms.delete(name),
      create: async(name, options) => alarms.set(name, { name, scheduledTime: options.when, ...options }),
      onAlarm: { addListener: fn => { handlers.alarm = fn } }
    },
    notifications: { getPermissionLevel: async() => 'granted', create: async() => { notifications++ }, onClicked: { addListener: fn => { handlers.click = fn } } }
  }
  const message = (action, fields = {}) => new Promise(resolve => handlers.message({ action, ...fields }, { id: 'test' }, resolve))
  const refresh = async() => {
    handlers.message({ action: 'refreshLessonNotifications' }, { url: 'https://tahvel.edu.ee/' }, () => {})
    await message('lessonNotificationStatus')
  }
  try {
    registerLessonNotifications()
    const pageMessage = (action, fields = {}, origin = 'https://tahvel.edu.ee') => new Promise(resolve => handlers.message(
      { action, ...fields }, { id: 'test', url: `${origin}/`, tab: { id: 42 } }, resolve))
    await pageMessage('rememberLessonLink', { key: '8-2026-09-14-1' })
    expired = true
    expect(await pageMessage('pendingLessonLink')).toEqual({})
    expired = false
    expect(await pageMessage('pendingLessonLink')).toEqual({ key: '8-2026-09-14-1' })
    expect(await pageMessage('pendingLessonLink', {}, 'https://test.tahvel.eenet.ee')).toEqual({})
    await pageMessage('clearLessonLink')
    expect(await pageMessage('pendingLessonLink')).toEqual({})
    await refresh()
    let state = JSON.parse(stored.OA_lessonNotifications.ct)
    expect(state.blocks).toHaveLength(1)
    const alarmName = 'oa2-lesson:' + state.blocks[0].key
    expect(alarms.get(alarmName).scheduledTime).toBe(now + 60000)
    handlers.alarm({ name: alarmName })
    await message('lessonNotificationStatus')
    expect(notifications).toBe(0)
    expect(await message('saveLessonNotificationTiming', { timing: { reference: 'end', direction: 'after', minutes: -1 } })).toHaveProperty('error')
    expect(stored.OA_lessonNotificationTiming).toBeUndefined()
    expect(await message('saveLessonNotificationTiming', { timing: { reference: 'end', direction: 'after', minutes: 10 } })).toEqual({ ok: true })
    expect(alarms.get(alarmName).scheduledTime).toBe(now + 660000)
    await refresh()
    expect(alarms.get(alarmName).scheduledTime).toBe(now + 660000)
    expect((await message('lessonNotificationStatus')).nextAt).toBe(now + 660000)
    await message('saveLessonNotificationTiming', { timing: { reference: 'start', direction: 'before', minutes: 0 } })
    expect(alarms.has(alarmName)).toBe(false)
    await message('saveLessonNotificationTiming', { timing: { reference: 'end', direction: 'after', minutes: 0 } })
    expect(alarms.get(alarmName).scheduledTime).toBe(now + 60000)
    expired = true
    await refresh()
    expect(JSON.parse(stored.OA_lessonNotifications.ct).blocks).toHaveLength(1)
    expired = false
    events = []
    await refresh()
    expect([...alarms.keys()].filter(k => k.startsWith('oa2-lesson:'))).toEqual([])
    now += 60000
    stored.OA_lessonNotifications = { ct: JSON.stringify(state) }
    handlers.alarm({ name: 'oa2-lesson:' + state.blocks[0].key })
    await message('lessonNotificationStatus')
    handlers.alarm({ name: 'oa2-lesson:' + state.blocks[0].key })
    await message('lessonNotificationStatus')
    expect(notifications).toBe(1)
    await message('saveLessonNotificationTiming', { timing: { reference: 'end', direction: 'after', minutes: 10 } })
    expect(alarms.has(alarmName)).toBe(false)
  } finally {
    Date.now = original.now
    global.chrome = original.chrome
    global.fetch = original.fetch
    cryptoService.encrypt = original.encrypt
    cryptoService.decrypt = original.decrypt
  }
})
