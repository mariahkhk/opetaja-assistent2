import Logger from '../services/Logger.js'

/**
 * Check whether the current Tahvel session is authenticated.
 *
 * Probes /user with 401/403 suppressed so an unauthenticated state
 * (login page, expired session) doesn't pollute Sentry. Reuses the
 * /user cache that getSchoolId / getCurrentUserInfo already populate,
 * so the call is free after the first authenticated load.
 *
 * Header features that activate on every page (`() => true`) MUST
 * gate any data fetching on this — otherwise GET /journals etc. fire
 * on the Tahvel login screen and 403s flood Sentry.
 *
 * @param {object} api - Shared API object (with api.tahvel)
 * @returns {Promise<boolean>}
 */
export async function isTahvelAuthenticated(api) {
  try {
    const userInfo = await api.tahvel.get(
      '/user',
      {},
      { cache: true, cacheExpiration: 864e5, suppressErrorStatuses: [401, 403] }
    )
    return Boolean(userInfo?.person?.id)
  } catch (error) {
    // ApiService's cache path throws `new Error('API Error: <status> ...')`
    // without setting `.status`, so fall back to parsing the message.
    const status = error?.status ?? Number(error?.message?.match(/^API Error:\s*(\d+)/)?.[1])
    if (status === 401 || status === 403) return false
    Logger.warning('[isTahvelAuthenticated] /user probe failed:', error)
    return false
  }
}
