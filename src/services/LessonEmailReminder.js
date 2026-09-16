/** Return true only when entries cover every period of the notified block.
 * Unknown period information or malformed responses must never trigger an email.
 */
export function isLessonRecorded(entries, block) {
  if (!Array.isArray(entries) || !Number.isInteger(block.startLessonNr) || block.startLessonNr < 1 ||
      !Number.isInteger(block.lessons) || block.lessons < 1) throw new Error('Tunni sissekande olekut ei saa usaldusväärselt kontrollida.')
  const type = block.capacityType === 'MAHT_p' ? 'SISSEKANNE_P' : block.capacityType === 'MAHT_i' ? 'SISSEKANNE_I' : 'SISSEKANNE_T'
  const matching = entries.filter(entry => entry?.entryDate?.slice(0, 10) === block.date && entry.entryType === type)
  if (matching.some(entry => !Number.isInteger(Number(entry.startLessonNr)) || Number(entry.startLessonNr) < 1 ||
      !Number.isInteger(Number(entry.lessons)) || Number(entry.lessons) < 1)) throw new Error('Sissekannete tunninumbrid pole kättesaadavad.')
  return Array.from({ length: block.lessons }, (_, i) => block.startLessonNr + i).every(period => matching.some(entry =>
    Number(entry.startLessonNr) <= period && Number(entry.startLessonNr) + Number(entry.lessons) > period))
}

/** Read settings in the worker without exposing the API token to Tahvel or reminder links. */
export async function lessonEmailSettings() {
  const settings = await chrome.storage.local.get(['OA_kriitEnabled', 'OA_kriitApiBaseUrl', 'OA_kriitApiToken'])
  if (!settings.OA_kriitEnabled || !settings.OA_kriitApiBaseUrl || !settings.OA_kriitApiToken) return null
  const url = new URL(settings.OA_kriitApiBaseUrl)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Kriidi meiliteavitus nõuab turvalist API aadressi.')
  }
  return { url: `${url.href.replace(/\/$/, '')}/lessonreminders/send`, token: settings.OA_kriitApiToken }
}

/** Request an idempotent email to the authenticated Kriit teacher (no student data). */
export async function sendLessonEmail(settings, origin, schoolId, block) {
  const { journalId, date, timeStart, timeEnd, startLessonNr, name } = block
  const response = await fetch(settings.url, {
    method: 'POST',
credentials: 'omit',
redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
    body: JSON.stringify({ origin, schoolId, journalId, date, timeStart, timeEnd, startLessonNr, name }),
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error('Kriidi meiliteavituse saatmine ebaõnnestus.')
  // Kriit's stop() helper wraps endpoint data in { status, data }.
  const result = await response.json()
  if (result.status !== 200 || result.data?.ok !== true) throw new Error('Kriidi meiliteavituse saatmine ebaõnnestus.')
}
