/**
 * Background script
 */
import Logger from './services/Logger.js'
import { sentryService } from './services/SentryService.js'

// Initialize Sentry for background context (no window event listeners)
sentryService.initBackground()

// Use both the Logger and regular console.log for extra visibility
Logger.info('Background script loaded')
console.log('📔 Background script loaded - ' + new Date().toISOString())

/**
 * Send update notification to all open Tahvel tabs
 * @param {string|null} version - Available version string or null
 */
async function notifyTahvelTabsOfUpdate(version) {
  const tabs = await chrome.tabs.query({
    url: [
      '*://tahvel.edu.ee/*',
      '*://test.tahvel.eenet.ee/*'
    ]
  })

  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateAvailable',
      version
    }).catch(() => {
      // Tab may not have content script loaded yet, ignore
    })
  }
}

// Check for updates on service worker startup
chrome.runtime.requestUpdateCheck()
  .then(([status, details]) => {
    if (status === 'update_available') {
      Logger.info('Update available on startup:', details?.version)
      notifyTahvelTabsOfUpdate(details?.version || null)
    }
  })
  .catch(error => {
    // Expected for sideloaded/dev installs
    Logger.debug('Update check not available:', error.message)
  })

// Listen for Chrome-initiated update notifications (do NOT auto-reload)
chrome.runtime.onUpdateAvailable.addListener(details => {
  Logger.info('Update available via onUpdateAvailable:', details?.version)
  notifyTahvelTabsOfUpdate(details?.version || null)
})

// Set up listener for inter-process communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  Logger.debug('Received message in background:', message)

  // Handle Kriit API requests to bypass mixed content restrictions
  if (message.action === 'kriitApiRequest') {
    const { method, url, headers, body } = message

    Logger.debug(`Making ${method} request to ${url} from background script`)

    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }

    if (method !== 'GET' && body) {
      requestOptions.body = JSON.stringify(body)
    }

    fetch(url, requestOptions)
      .then(async response => {
        const responseText = await response.text()

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${responseText}`)
        }

        // Try to parse as JSON, fall back to text
        try {
          const data = JSON.parse(responseText)
          sendResponse({ status: 'success', data })
        } catch (error) {
          sendResponse({ status: 'success', data: responseText })
        }
      })
      .catch(error => {
        Logger.error('Kriit API request failed:', error)
        sendResponse({ status: 'error', message: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }

  // Handle lesson times loading request
  if (message.action === 'loadLessonTimes') {
    const jsonUrl = chrome.runtime.getURL('src/features/singleJournal/lessonDiscrepancies/LessonTimes.json')

    fetch(jsonUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return response.json()
      })
      .then(data => {
        Logger.debug('Lesson times loaded successfully:', data)
        sendResponse({ status: 'success', data })
      })
      .catch(error => {
        Logger.error('Error loading lesson times:', error)
        sendResponse({ status: 'error', error: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }

  // Handle Sentry event sending (content scripts can't fetch cross-origin due to page CSP)
  if (message.action === 'sentryEvent') {
    const { url, publicKey, envelope } = message

    // Validate URL is a Sentry ingest endpoint
    try {
      const parsed = new URL(url)
      if (!parsed.hostname.endsWith('.sentry.io')) {
        console.warn('[Background] Blocked Sentry event to non-Sentry host:', parsed.hostname)
        return
      }
    } catch {
      return
    }

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${publicKey}`
      },
      body: envelope
    }).catch(err => {
      console.warn('[Background] Failed to send Sentry event:', err.message)
    })

    // Fire-and-forget, no response needed
    return
  }

  // Handle future subjects request
  if (message.action === 'getFutureSubjects') {
    getFutureSubjects(message.comparisonDate)
      .then(subjects => {
        Logger.debug('Future subjects retrieved:', subjects)
        sendResponse({ status: 'success', data: subjects })
      })
      .catch(error => {
        Logger.error('Error getting future subjects:', error)
        sendResponse({ status: 'error', message: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }
})

/**
 * Fetch future subjects from the active Tahvel tab
 * @param {string} comparisonDate - The comparison date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of future lesson subjects
 */
async function getFutureSubjects(comparisonDate) {
  try {
    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const activeTab = tabs[0]

    if (!activeTab || !activeTab.url) {
      throw new Error('Aktiivne sakk ei ole saadaval')
    }

    // Check if the tab is on Tahvel (production or test instance)
    if (
      !activeTab.url.includes('tahvel.edu.ee') &&
      !activeTab.url.includes('test.tahvel.eenet.ee')
    ) {
      throw new Error('Palun avage Tahvel lehekülg')
    }

    // Send message to content script to fetch subjects
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      action: 'getFutureSubjects',
      comparisonDate: comparisonDate
    })

    if (response && response.status === 'success') {
      return response.data
    } else {
      throw new Error(response?.message || 'Viga andmete laadimisel')
    }
  } catch (error) {
    Logger.error('Error in getFutureSubjects:', error)
    throw error
  }
}
