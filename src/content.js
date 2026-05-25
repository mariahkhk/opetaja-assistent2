/**
 * Õpetaja Assistent 2 - Main content script
 */
import TahvelExtension from './core/Extension.js'
import Logger from './services/Logger.js'
import { cacheService } from './services/CacheService.js'
import { cryptoService } from './services/CryptoService.js'
import { ApiService } from './services/ApiService.js'
import { sentryService } from './services/SentryService.js'

const VERSION = '6'

// Initialize Sentry error tracking before anything else
sentryService.init()

// The XHR/fetch interceptor (xhrInterceptor.js) is injected into the page's
// main world via manifest.json content_scripts with "world": "MAIN". It
// patches XMLHttpRequest and fetch to detect Tahvel's non-GET requests and
// posts oa2:journalMutation messages back to this isolated-world script.

// Listen for journal-mutation signals from the main-world interceptor.
// Debounce per journal ID (300 ms) so rapid successive saves (e.g. Tahvel
// firing PUT + GET in quick succession) coalesce into a single invalidation.
const _invalidationTimers = {}
function _extractJournalIdFromPageUrl() {
  const match = window.location.href.match(/\/journal\/(\d+)/)
  return match ? Number(match[1]) : null
}

window.addEventListener('message', event => {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return
  if (event.data?.type !== 'oa2:journalMutation') return

  // Prefer journal ID from the API URL; fall back to the current page URL
  // (covers endpoints like /journalEntry/{id} that don't embed a journal ID).
  const journalId = event.data.journalId ?? _extractJournalIdFromPageUrl()
  if (!journalId) return

  clearTimeout(_invalidationTimers[journalId])
  _invalidationTimers[journalId] = setTimeout(() => {
    delete _invalidationTimers[journalId]
    if (Logger.isDebugMode()) Logger.debug(`[CacheInvalidation] Tahvel UI mutation detected for journal #${journalId}`)
    cacheService.clearJournalCache(journalId).then(() => {
      document.dispatchEvent(new CustomEvent('oa2:journalDataChanged', { detail: { journalId } }))
    }).catch(e => Logger.debug('[CacheInvalidation] clearJournalCache failed:', e.message))
  }, 300)
})

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
    // Task-defer (NOT microtask) the reload — Chrome IPC needs a task
    // boundary to flush sendResponse to the popup before the script context
    // tears down. Promise.resolve().then(...) drains in the same task as
    // sendResponse and the popup's .catch() then surfaces a "channel closed"
    // error even though the cache was cleared.
    cacheService.clearCache().then(() => {
      sendResponse({ success: true })
      setTimeout(() => window.location.reload(), 50)
    }).catch(error => {
      sendResponse({ success: false, error: error.message })
      setTimeout(() => window.location.reload(), 50)
    })
    return true
  } else if (message.action === 'cryptoKeyRotated') {
    // Another tab cleared the cache + rotated keys. Drop our resolved key
    // handles so subsequent encrypts/hashes regenerate against the fresh
    // keys. Don't reload — that would trash unsaved form state in tabs the
    // user isn't actively interacting with. Pre-rotation entries on disk
    // become undecryptable but cacheRead treats decrypt failure as a miss.
    cryptoService._reset()
    sendResponse({ success: true })
  } else if (message.action === 'cacheMaintenanceTick') {
    // Cache persists across browser restarts and active logouts; only TTL
    // expiry, version bumps, and the popup's "Tühjenda vahemälu" button
    // clear it. Each tick evicts entries past their per-key TTL.
    cacheService.evictExpired().catch(error => Logger.warning('Cache eviction failed:', error.message))
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
  }
  return true // Keep the message channel open for async responses
})

