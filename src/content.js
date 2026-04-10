/**
 * Õpetaja Assistent 2 - Main content script
 */
import TahvelExtension from './core/Extension.js'
import Logger from './services/Logger.js'
import { cacheService } from './services/CacheService.js'
import { ApiService } from './services/ApiService.js'
import { sentryService } from './services/SentryService.js'

const VERSION = '6'

// Initialize Sentry error tracking before anything else
sentryService.init()

// Print version and build time info using our new Logger
Logger.info(`Content script loaded - version ${VERSION}`)

// Initialize immediately or when DOM is ready
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', TahvelExtension.init) : TahvelExtension.init()

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleDebugMode') {
    if (message.enabled) {
      Logger.enableDebugMode()
      if (Logger.isDebugMode()) Logger.debug('Debug mode enabled from popup')
    } else {
      Logger.disableDebugMode()
      Logger.info('Debug mode disabled from popup')
    }
    sendResponse({ success: true })
  } else if (message.action === 'cacheClearedFromPopup') {
    Logger.info('Cache cleared from popup')
    cacheService.clearCache().then(() => {
      window.location.reload()
    }).catch(() => {
      window.location.reload()
    })
    sendResponse({ success: true })
  } else if (message.action === 'getCacheStats') {
    cacheService.getStats().then(stats => {
      sendResponse({ status: 'success', stats })
    }).catch(error => {
      sendResponse({ status: 'error', message: error.message })
    })
    return true
  } else if (message.action === 'kriitSettingsUpdated') {
    Logger.info('Kriit API settings updated from popup')
    // Refresh the page to apply new settings
    window.location.reload()
    sendResponse({ success: true })
  } else if (message.action === 'getFutureSubjects') {
    if (Logger.isDebugMode()) Logger.debug('Received getFutureSubjects request')
    handleGetFutureSubjects(message.comparisonDate)
      .then(subjects => {
        if (Logger.isDebugMode()) Logger.debug('Future subjects found:', subjects)
        sendResponse({ status: 'success', data: subjects })
      })
      .catch(error => {
        Logger.error('Error getting future subjects:', error)
        sendResponse({ status: 'error', message: error.message })
      })
    return true // Keep the message channel open for async responses
  } else if (message.action === 'getCapturedRequests') {
    const allRequests = ApiService.getCapturedRequests()
    const journalMatch = window.location.href.match(/\/journal\/(\d+)/)
    const journalId = journalMatch ? journalMatch[1] : null

    let filtered = []
    if (journalId) {
      filtered = allRequests.filter(r => {
        if (!r.url) return false
        const urlPath = r.url.split('?')[0]
        return urlPath.includes(`/journals/${journalId}/`) || urlPath.endsWith(`/journals/${journalId}`)
      })
    }

    const requests = filtered.length > 0 ? filtered : allRequests

    sendResponse({
      status: 'success',
      data: {
        metadata: {
          exportedAt: new Date().toISOString(),
          journalId: journalId ? parseInt(journalId) : null,
          pageUrl: window.location.href,
          totalCaptured: allRequests.length,
          filteredForJournal: filtered.length,
          filterApplied: filtered.length > 0,
          warning: 'This file may contain sensitive data. Share only with trusted parties.'
        },
        requests
      }
    })
    return true
  } else if (message.action === 'findTeachers') {
    Logger.debug('Received findTeachers request')
    handleFindTeachers()
      .then(teachers => {
        Logger.debug('Teachers found:', teachers)
        sendResponse({ success: true, teachers: teachers })
      })
      .catch(error => {
        Logger.error('Error finding teachers:', error)
        sendResponse({ success: false, error: error.message })
      })
    return true // Keep the message channel open for async responses
  }
  return true // Keep the message channel open for async responses
})

/**
 * Handle getting future subjects from timetable
 * @param {string} comparisonDate - The comparison date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of future lesson subjects
 */
async function handleGetFutureSubjects(comparisonDate) {
  try {
    // Import the API service
    const { api } = await import('./core/BaseFeature.js')
    const apiService = api.tahvel

    if (!apiService) {
      throw new Error('API teenus pole saadaval')
    }

    // Get user info to get school ID
    const userInfo = await apiService.get(
      '/user',
      {},
      {
        cache: true,
        cacheExpiration: 60 * 1000 // 1 minute
      }
    )

    if (!userInfo || !userInfo.school) {
      throw new Error('Kasutaja pole sisse logitud või kool pole saadaval')
    }

    const schoolId = userInfo.school.id

    if (!schoolId) {
      throw new Error('Kooli ID pole saadaval')
    }

    // Get current study year dates
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

    // First, get all active teachers in the school
    const teachersData = await apiService.get(
      `/teachers?isActive=true&lang=ET&page=0&size=1000`,
      {},
      {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
      }
    )

    if (!teachersData || !teachersData.content) {
      throw new Error('Õpetajate andmed pole saadaval')
    }

    // Filter teachers by school
    const schoolTeachers = teachersData.content.filter(teacher => teacher.school && teacher.school.id === schoolId)

    if (Logger.isDebugMode()) Logger.debug(`Found ${schoolTeachers.length} teachers in school ${schoolId}`)

    // Get all teacher IDs
    const teacherIds = schoolTeachers.map(teacher => teacher.id)

    if (teacherIds.length === 0) {
      throw new Error('Aktiivseid õpetajaid pole leitud')
    }

    // Fetch timetable for all teachers at once
    const teacherIdsParam = teacherIds.join(',')
    const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherIdsParam}&thru=${thru}`

    if (Logger.isDebugMode()) Logger.debug(`Fetching timetable for ${teacherIds.length} teachers`)

    const timetableData = await apiService.get(
      endpoint,
      {},
      {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
      }
    )

    if (!timetableData || !timetableData.timetableEvents) {
      throw new Error('Tunniplaani andmed pole saadaval')
    }

    // Filter for future lessons only based on the comparison date
    const compareDate = comparisonDate ? new Date(comparisonDate) : new Date()
    compareDate.setHours(0, 0, 0, 0)

    const futureEvents = timetableData.timetableEvents.filter(event => {
      const eventDate = new Date(event.date)
      eventDate.setHours(0, 0, 0, 0)
      // Exclude lessons with null journalId and only show future lessons
      return eventDate >= compareDate && event.journalId !== null && event.journalId !== undefined
    })

    if (Logger.isDebugMode()) {
      Logger.debug(
        `Found ${futureEvents.length} future timetable events from all teachers (from ${comparisonDate || 'today'}, excluding lessons without journalId)`
      )
    }
    return futureEvents
  } catch (error) {
    Logger.error('Error in handleGetFutureSubjects:', error)
    throw error
  }
}

/**
 * Handle finding all teachers with their IDs
 * @returns {Promise<Array>} Array of teacher objects with name and id
 */
async function handleFindTeachers() {
  try {
    // Import the API service
    const { api } = await import('./core/BaseFeature.js')
    const apiService = api.tahvel

    if (!apiService) {
      throw new Error('API teenus pole saadaval')
    }

    // Get user info to get school ID
    const userInfo = await apiService.get(
      '/user',
      {},
      {
        cache: true,
        cacheExpiration: 60 * 1000 // 1 minute
      }
    )

    if (!userInfo || !userInfo.school) {
      throw new Error('Kasutaja pole sisse logitud või kool pole saadaval')
    }

    const schoolId = userInfo.school.id

    if (!schoolId) {
      throw new Error('Kooli ID pole saadaval')
    }

    // Get all active teachers in the school
    const teachersData = await apiService.get(
      `/teachers?isActive=true&lang=ET&page=0&size=1000`,
      {},
      {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
      }
    )

    if (!teachersData || !teachersData.content) {
      throw new Error('Õpetajate andmed pole saadaval')
    }

    // Filter teachers by school and map to simple object
    const schoolTeachers = teachersData.content
      .filter(teacher => teacher.school && teacher.school.id === schoolId)
      .map(teacher => ({
        id: teacher.id,
        name: teacher.name
      }))

    Logger.debug(`Found ${schoolTeachers.length} teachers in school ${schoolId}`)

    return schoolTeachers
  } catch (error) {
    Logger.error('Error in handleFindTeachers:', error)
    throw error
  }
}
