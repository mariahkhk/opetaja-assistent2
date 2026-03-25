import Logger from '../services/Logger.js'

/**
 * Get school ID from journal info, falling back to /user endpoint.
 * @param {object} api - API service object with `api.tahvel.get()`
 * @param {object} [info] - Journal info object (may have `school.id`)
 * @returns {Promise<number|null>} School ID or null if unavailable
 */
export async function getSchoolId(api, info) {
  if (info?.school?.id != null) return info.school.id
  try {
    const userInfo = await api.tahvel.get('/user', {}, { cache: true, cacheExpiration: 864e5 })
    return userInfo?.school?.id ?? null
  } catch (error) {
    Logger.warning('[schoolId] /user fallback failed:', error)
    return null
  }
}
