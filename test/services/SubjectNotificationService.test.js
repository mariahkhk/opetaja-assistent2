import { test, expect } from 'bun:test'
import { registerLessonNotifications } from '../../src/services/LessonNotificationService.js'
import { cryptoService } from '../../src/services/CryptoService.js'

for (const scenario of ['normal', 'cancelled', 'same-subject', 'expired', 'account-switch', 'late']) {
  test(`subject alerts revalidate the schedule and identity: ${scenario}`, async() => {
    const original = { chrome: global.chrome, fetch: global.fetch, now: Date.now, encrypt: cryptoService.encrypt, decrypt: cryptoService.decrypt }
    let now = Date.parse('2026-09-14T05:00:00Z')
    let expired = false
    let teacher = 10
    let stored = {}
    let events = [
      { id: 1, journalId: 8, date: '2026-09-14', timeStart: '08:15', timeEnd: '09:00', nameEt: 'Matemaatika', studentGroups: [] },
      { id: 2, journalId: 9, date: '2026-09-14', timeStart: '09:10', timeEnd: '09:55', nameEt: 'Eesti keel', studentGroups: [] }
    ]
    const handlers = {}
    const alarms = new Map()
    const notifications = []
    const opened = []
    Date.now = () => now
    cryptoService.encrypt = async text => ({ ct: text })
    cryptoService.decrypt = async value => value.ct
    global.fetch = async url => {
      if (String(url).includes('LessonTimes')) return Response.json({})
      if (expired) return new Response('', { status: 401 })
      return Response.json(String(url).includes('/user') ? { teacher, school: { id: 9 } } : { timetableEvents: events })
    }
    global.chrome = {
      runtime: { id: 'test', getURL: p => p, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener: fn => { handlers.message = fn } } },
      storage: { local: { get: async() => stored, set: async value => { stored = { ...stored, ...value } } } },
      tabs: { create: async options => { opened.push(options); return { id: 1, windowId: 2 } } },
      windows: { get: async() => ({ state: 'normal' }), update: async() => {} },
      alarms: {
        get: (name, cb) => cb ? cb(alarms.get(name)) : Promise.resolve(alarms.get(name)),
        getAll: async() => [...alarms.values()], clear: async name => alarms.delete(name),
        create: async(name, options) => alarms.set(name, { name, scheduledTime: options.when, ...options }),
        onAlarm: { addListener: fn => { handlers.alarm = fn } }
      },
      notifications: { getPermissionLevel: async() => 'granted', clear: async() => true,
        create: async(name, options) => notifications.push({ name, ...options }),
        onClicked: { addListener: fn => { handlers.click = fn } } }
    }
    const idle = () => new Promise(resolve => handlers.message({ action: 'lessonNotificationStatus' }, { id: 'test' }, resolve))
    const refresh = async() => {
      handlers.message({ action: 'refreshLessonNotifications' }, { url: 'https://tahvel.edu.ee/' }, () => {})
      await idle()
    }
    const name = 'oa2-subject:2026-09-14-09:10'
    const fire = async() => { alarms.delete(name); handlers.alarm({ name }); await idle() }
    try {
      registerLessonNotifications()
      await refresh()
      expect(alarms.get(name)?.scheduledTime).toBe(Date.parse('2026-09-14T06:10:00Z'))
      expect([...alarms.keys()].filter(key => key.startsWith('oa2-lesson:'))).toHaveLength(2)
      await fire()
      expect(notifications).toHaveLength(0)
      now = Date.parse('2026-09-14T06:10:00Z')
      if (scenario === 'cancelled') events = events.slice(0, 1)
      if (scenario === 'same-subject') events[1].nameEt = 'Matemaatika'
      if (scenario === 'expired') expired = true
      if (scenario === 'account-switch') teacher = 20
      if (scenario === 'late') now += 6 * 60000
      await fire()
      expect(notifications).toHaveLength(scenario === 'normal' ? 1 : 0)
      if (scenario === 'normal') {
        expect(notifications[0].title).toBe('Algab uus aine: Eesti keel')
        await fire()
        await refresh()
        expect(notifications).toHaveLength(1)
        expect(alarms.has(name)).toBe(false)
        handlers.click(name)
        await idle()
        expect(opened).toEqual([{ url: 'https://tahvel.edu.ee/#/journal/9/edit', active: true }])
      }
    } finally {
      global.chrome = original.chrome; global.fetch = original.fetch; Date.now = original.now
      cryptoService.encrypt = original.encrypt; cryptoService.decrypt = original.decrypt
    }
  })
}
