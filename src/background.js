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

// --- Cache maintenance alarm ---
// Every 6 h: ask each open Tahvel tab to evict cache entries past their
// per-key TTL. The content script does the actual work because it runs in
// the tahvel.edu.ee origin where the Cache API lives.
const CACHE_ALARM_NAME = 'cache-maintenance'

// Throttle to one broadcast per minute so the new tabs.onActivated/onUpdated
// listeners don't trigger an eviction sweep on every Tahvel navigation.
// Persisted to chrome.storage.session so the throttle survives MV3 SW
// restarts (the SW dies after ~30s idle and re-runs the module body on
// next event, which would reset a module-scoped variable to 0).
const BROADCAST_MIN_INTERVAL_MS = 60 * 1000
const BROADCAST_TS_KEY = 'OA_lastBroadcast'

async function broadcastCacheMaintenance() {
  const now = Date.now()
  let last = 0
  try {
    const stored = await chrome.storage.session.get(BROADCAST_TS_KEY)
    last = stored?.[BROADCAST_TS_KEY] || 0
  } catch {
    // chrome.storage.session may be unavailable; fall through with last=0.
  }
  if (now - last < BROADCAST_MIN_INTERVAL_MS) return
  try { await chrome.storage.session.set({ [BROADCAST_TS_KEY]: now }) } catch {}
  try {
    const tabs = await chrome.tabs.query({
      url: ['*://tahvel.edu.ee/*', '*://test.tahvel.eenet.ee/*']
    })
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'cacheMaintenanceTick' }).catch(() => {
        // Tab may not have content script loaded yet, ignore
      })
    }
  } catch (error) {
    Logger.debug('Cache maintenance broadcast failed:', error.message)
  }
}

// Gate creation on alarms.get — alarms.create cancels-and-replaces, and the
// MV3 service worker re-runs this module body on every wake, so an unguarded
// create() would reset the 6 h timer indefinitely under continuous use.
chrome.alarms.get(CACHE_ALARM_NAME, existing => {
  if (!existing) {
    chrome.alarms.create(CACHE_ALARM_NAME, { periodInMinutes: 360 })
  }
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CACHE_ALARM_NAME) {
    broadcastCacheMaintenance()
  }
})

chrome.runtime.onInstalled.addListener(broadcastCacheMaintenance)
chrome.runtime.onStartup.addListener(broadcastCacheMaintenance)

// Also fire when a Tahvel tab becomes active or finishes loading so eviction
// runs promptly when the user returns to Tahvel after extended idle. No new
// permissions required (uses `tabs`).
function isTahvelTabUrl(url) {
  if (!url) return false
  return url.includes('tahvel.edu.ee') || url.includes('test.tahvel.eenet.ee')
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (isTahvelTabUrl(tab?.url)) broadcastCacheMaintenance()
  } catch {
    // Tab may have closed between activation and lookup; ignore.
  }
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isTahvelTabUrl(tab?.url)) {
    broadcastCacheMaintenance()
  }
})

// Set up listener for inter-process communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  Logger.debug('Received message in background:', message)

  // Fan out crypto key rotation to all open Tahvel tabs so each content script
  // drops its in-memory key handle — otherwise tabs that didn't initiate the
  // rotation keep encrypting under the removed key.
  if (message.action === 'cryptoKeyRotated') {
    chrome.tabs.query({
      url: ['*://tahvel.edu.ee/*', '*://test.tahvel.eenet.ee/*']
    }).then(tabs => {
      for (const tab of tabs) {
        if (tab.id === sender.tab?.id) continue
        chrome.tabs.sendMessage(tab.id, { action: 'cryptoKeyRotated' }).catch(() => {})
      }
    }).catch(() => {})
    // No response expected; do not return true so the channel closes.
    return false
  }

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
