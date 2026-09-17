import { test, expect } from 'bun:test'
import { openNotificationTab } from '../../src/services/NotificationWindow.js'

for (const state of ['normal', 'minimized', 'maximized', 'fullscreen']) {
  test(`notification activates its target tab and focuses the correct ${state} window`, async() => {
    const original = global.chrome
    const calls = []
    global.chrome = {
      tabs: { create: async options => { calls.push(['tab', options]); return { id: 42, windowId: 7 } } },
      windows: {
        get: async id => { calls.push(['get', id]); return { state } },
        update: async(id, options) => { calls.push(['focus', id, options]) }
      }
    }
    try {
      const url = 'https://tahvel.edu.ee/?oa2Lesson=8-2026-09-14-2#/journal/8/edit'
      expect(await openNotificationTab(url)).toEqual({ id: 42, windowId: 7 })
      expect(calls).toEqual([
        ['tab', { url, active: true }], ['get', 7],
        ['focus', 7, { focused: true, ...(state === 'minimized' ? { state: 'normal' } : {}) }]
      ])
    } finally { global.chrome = original }
  })
}

test('a focus failure does not discard an opened lesson link', async() => {
  const original = global.chrome
  global.chrome = {
    tabs: { create: async() => ({ id: 42, windowId: 7 }) },
    windows: { get: async() => ({ state: 'normal' }), update: async() => { throw new Error('Window closed') } }
  }
  try {
    expect(await openNotificationTab('https://tahvel.edu.ee/')).toEqual({ id: 42, windowId: 7 })
  } finally { global.chrome = original }
})

test('a tab creation failure propagates so the notification can be retried', async() => {
  const original = global.chrome
  global.chrome = { tabs: { create: async() => { throw new Error('Cannot open tab') } } }
  try {
    await expect(openNotificationTab('https://tahvel.edu.ee/')).rejects.toThrow('Cannot open tab')
  } finally { global.chrome = original }
})
