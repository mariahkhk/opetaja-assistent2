import Logger from '../services/Logger.js'

/**
 * Fetch paginated list of teacher's journals from Tahvel REST API.
 *
 * Both header features and JournalListSync need to fetch the teacher's journal
 * list. This shared helper encapsulates the pagination logic so callers don't
 * have to duplicate it.
 *
 * @param {Object} api - Shared api object (with api.tahvel)
 * @param {Object} [options]
 * @param {number} [options.size=50] - Page size
 * @param {number|null} [options.studyYearId=null] - Optional study year filter
 * @param {number} [options.cacheExpiration=300000] - Cache TTL in ms (default 5 min)
 * @returns {Promise<Array>} Array of journal list items from the API
 */
export async function fetchTeacherJournals(api, options = {}) {
  const { size = 50, studyYearId = null, cacheExpiration = 5 * 60 * 1000 } = options
  const params = { onlyMyJournals: true, size }
  if (studyYearId) params.studyYear = studyYearId

  const allItems = []
  let page = 0
  let totalPages = null
  const SAFETY_MAX_PAGES = 50

  while (page <= SAFETY_MAX_PAGES && (totalPages === null || page < totalPages)) {
    const pageParams = Object.assign({}, params, { page })
    const response = await api.tahvel.get('/journals', pageParams, { cache: true, cacheExpiration })

    if (!response) break

    let items = []
    if (Array.isArray(response.content)) {
      items = response.content
    } else if (Array.isArray(response)) {
      items = response
    } else {
      break
    }

    if (items.length > 0) {
      allItems.push(...items)
    }

    if (totalPages === null) {
      if (typeof response.totalPages === 'number') {
        totalPages = response.totalPages
      } else if (typeof response.totalElements === 'number' && size > 0) {
        totalPages = Math.ceil(response.totalElements / size)
      }
    }

    // If server didn't provide totalPages, stop when we received fewer items than requested
    if (totalPages === null && items.length < size) break

    page++
  }

  if (Logger.isDebugMode()) Logger.debug(`[fetchTeacherJournals] Fetched ${allItems.length} journals across ${page + 1} page(s)`)
  return allItems
}
