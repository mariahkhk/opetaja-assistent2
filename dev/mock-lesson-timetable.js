/**
 * Development only; paste into the extension service worker's DevTools console.
 * Then refresh a signed-in Tahvel tab without an oa2Lesson query parameter.
 * This replaces only the timetable response, never authentication or journal APIs.
 * Reload the extension and refresh Tahvel to restore the real timetable/alarms.
 */
(() => {
  const originalFetch = globalThis.fetch
  const end = new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000)
  const start = new Date(end.getTime() - 45 * 60000)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' }).format(end)
  const time = value => new Intl.DateTimeFormat('et-EE', { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)
  const event = { id: 1, journalId: 433792, name: 'Tarkvara arendus', date, timeStart: time(start), timeEnd: time(end), capacityType: 'MAHT_a', studentGroups: [{ code: 'TAK25' }] }
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin === 'https://tahvel.edu.ee' && /^\/hois_back\/timetableevents\/timetableByTeacher\/\d+$/.test(url.pathname)) {
      return Promise.resolve(Response.json({ timetableEvents: [event] }))
    }
    return originalFetch(input, init)
  }
  console.info(`Mock timetable ready: ${date} ${event.timeStart}–${event.timeEnd}. Refresh Tahvel now. Reload the extension afterwards to remove the mock. Attendance/group IDs and school period numbers are not mocked.`)
})()
