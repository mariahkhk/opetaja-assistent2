/**
 * Popup script for Õpetaja Assistent 2
 */

// Constants
const DEBUG_MODE_KEY = 'OA_debug_mode'
const KRIIT_ENABLED_KEY = 'OA_kriitEnabled'
const KRIIT_API_URL_KEY = 'OA_kriitApiBaseUrl'
const KRIIT_API_KEY_KEY = 'OA_kriitApiToken'
const HIGHLIGHT_MISSING_GRADES_KEY = 'OA_highlightMissingGrades'
const DEFAULT_KRIIT_API_URL = 'https://kriit.vikk.ee/api'
const TAHVEL_DOMAINS = ['tahvel.edu.ee', 'test.tahvel.eenet.ee']
const API_KEY_SHOW_LABEL = 'Näita'
const API_KEY_HIDE_LABEL = 'Peida'
const STATUS_CLEAR_DELAY_MS = 2000

/**
 * Check if a URL belongs to a Tahvel instance
 * @param {string} url - The URL to check
 * @returns {boolean}
 */
export function isTahvelUrl(url) {
  return url && TAHVEL_DOMAINS.some(domain => url.includes(domain))
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup DOM loaded')

  try {
    initPopup()
  } catch (error) {
    console.error('Error initializing popup:', error)
    showError('Failed to initialize popup: ' + error.message)
  }
})

/**
 * Initialize the popup
 */
function initPopup() {
  // Get DOM elements
  const debugModeCheckbox = document.getElementById('debug-mode')
  const clearCacheButton = document.getElementById('clear-cache')
  const versionElement = document.getElementById('version')
  const highlightMissingGradesCheckbox = document.getElementById('highlight-missing-grades')
  const kriitEnabledCheckbox = document.getElementById('kriit-enabled')
  const kriitSettingsContainer = document.getElementById('kriit-settings-container')
  const kriitApiUrlInput = document.getElementById('kriit-api-url')
  const kriitApiKeyInput = document.getElementById('kriit-api-key')
  const toggleApiKeyVisibilityButton = document.getElementById('toggle-api-key-visibility')
  const deleteApiKeyButton = document.getElementById('delete-api-key')
  const saveKriitSettingsButton = document.getElementById('save-kriit-settings')
  const saveStatusElement = document.getElementById('save-status')
  const errorLogElement = document.getElementById('error-log')
  const viewCacheDetailsButton = document.getElementById('view-cache-details')
  const refreshCacheStatsButton = document.getElementById('refresh-cache-stats')
  const debugToolsContainer = document.getElementById('debug-tools')
  const downloadApiRequestsButton = document.getElementById('download-api-requests')

  // Check if all elements are found
  if (!debugModeCheckbox) throw new Error('Debug mode checkbox not found')
  if (!clearCacheButton) throw new Error('Clear cache button not found')
  if (!versionElement) throw new Error('Version element not found')
  if (!highlightMissingGradesCheckbox) throw new Error('Highlight missing grades checkbox not found')
  if (!kriitEnabledCheckbox) throw new Error('Kriit enabled checkbox not found')
  if (!kriitSettingsContainer) throw new Error('Kriit settings container not found')
  if (!kriitApiUrlInput) throw new Error('Kriit API URL input not found')
  if (!kriitApiKeyInput) throw new Error('Kriit API key input not found')
  if (!toggleApiKeyVisibilityButton) throw new Error('Toggle API key visibility button not found')
  if (!deleteApiKeyButton) throw new Error('Delete API key button not found')
  if (!saveKriitSettingsButton) throw new Error('Save Kriit settings button not found')
  if (!saveStatusElement) throw new Error('Save status element not found')
  if (!errorLogElement) throw new Error('Error log element not found')
  if (!debugToolsContainer) throw new Error('Debug tools container not found')
  if (!downloadApiRequestsButton) throw new Error('Download API requests button not found')

  // Set version from manifest
  try {
    const manifest = chrome.runtime.getManifest()
    versionElement.textContent = manifest.version
  } catch (error) {
    console.error('Error accessing manifest:', error)
  }

  // Initialize debug mode checkbox
  chrome.storage.local.get([DEBUG_MODE_KEY], function(result) {
    const isDebug = result[DEBUG_MODE_KEY] === true
    debugModeCheckbox.checked = isDebug
    debugToolsContainer.style.display = isDebug ? 'block' : 'none'
  })

  // Initialize highlight missing grades checkbox (default: enabled)
  chrome.storage.local.get([HIGHLIGHT_MISSING_GRADES_KEY], function(result) {
    highlightMissingGradesCheckbox.checked = result[HIGHLIGHT_MISSING_GRADES_KEY] !== false
  })

  // Initialize Kriit API settings
  chrome.storage.local.get([KRIIT_ENABLED_KEY, KRIIT_API_URL_KEY, KRIIT_API_KEY_KEY], function(result) {
    const kriitEnabled = result[KRIIT_ENABLED_KEY] === true
    kriitEnabledCheckbox.checked = kriitEnabled

    // Show/hide Kriit settings based on enabled state
    kriitSettingsContainer.style.display = kriitEnabled ? 'block' : 'none'

    // Set values
    kriitApiUrlInput.value = result[KRIIT_API_URL_KEY] || ''

    // On initial load, never pre-fill the input with the stored key — show a
    // status hint instead. (The user-typed value is still rendered; the Näita
    // toggle below can flip the input to type=text on demand.)
    kriitApiKeyInput.value = ''
    setApiKeySavedIndicator(Boolean(result[KRIIT_API_KEY_KEY]))
  })

  // Add event listeners
  debugModeCheckbox.addEventListener('change', function() {
    try {
      toggleDebugMode(debugModeCheckbox.checked)
    } catch (error) {
      console.error('Error toggling debug mode:', error)
      showError('Failed to toggle debug mode: ' + error.message)
    }
  })

  highlightMissingGradesCheckbox.addEventListener('change', function() {
    try {
      toggleHighlightMissingGrades(highlightMissingGradesCheckbox.checked)
    } catch (error) {
      console.error('Error toggling highlight missing grades:', error)
      showError('Failed to toggle highlight missing grades: ' + error.message)
    }
  })

  kriitEnabledCheckbox.addEventListener('change', function() {
    try {
      toggleKriitEnabled(kriitEnabledCheckbox.checked, kriitSettingsContainer)
    } catch (error) {
      console.error('Error toggling Kriit support:', error)
      showError('Failed to toggle Kriit support: ' + error.message)
    }
  })

  clearCacheButton.addEventListener('click', function() {
    try {
      clearCache()
    } catch (error) {
      console.error('Error clearing cache:', error)
      showError('Failed to clear cache: ' + error.message)
    }
  })

  saveKriitSettingsButton.addEventListener('click', function() {
    try {
      saveKriitSettings({
        apiUrl: kriitApiUrlInput.value,
        apiKey: kriitApiKeyInput.value,
        statusElement: saveStatusElement,
        apiKeyInput: kriitApiKeyInput,
        toggleBtn: toggleApiKeyVisibilityButton,
        saveBtn: saveKriitSettingsButton
      })
    } catch (error) {
      console.error('Error saving Kriit settings:', error)
      showError('Failed to save Kriit settings: ' + error.message)
    }
  })

  deleteApiKeyButton.addEventListener('click', function() {
    try {
      deleteApiKey(kriitApiKeyInput, toggleApiKeyVisibilityButton, saveStatusElement, deleteApiKeyButton)
    } catch (error) {
      console.error('Error deleting Kriit API key:', error)
      showError('Failed to delete Kriit API key: ' + error.message)
    }
  })

  toggleApiKeyVisibilityButton.addEventListener('click', function() {
    const showing = kriitApiKeyInput.type === 'text'
    kriitApiKeyInput.type = showing ? 'password' : 'text'
    toggleApiKeyVisibilityButton.textContent = showing ? API_KEY_SHOW_LABEL : API_KEY_HIDE_LABEL
  })

  // Add event listeners for cache statistics
  viewCacheDetailsButton.addEventListener('click', function() {
    try {
      toggleCacheDetails()
    } catch (error) {
      console.error('Error showing cache details:', error)
      showError('Failed to show cache details: ' + error.message)
    }
  })

  refreshCacheStatsButton.addEventListener('click', function() {
    try {
      loadCacheStatistics()
    } catch (error) {
      console.error('Error refreshing cache statistics:', error)
      showError('Failed to refresh cache statistics: ' + error.message)
    }
  })

  // Add event listener for API request download
  downloadApiRequestsButton.addEventListener('click', function() {
    try {
      downloadCapturedRequests()
    } catch (error) {
      console.error('Error downloading API requests:', error)
      showError('Failed to download API requests: ' + error.message)
    }
  })

  // Load cache statistics
  loadCacheStatistics()

  console.log('Popup initialized successfully')
}

/**
 * Toggle debug mode
 * @param {boolean} enabled - Whether debug mode should be enabled
 */
function toggleDebugMode(enabled) {
  const debugToolsContainer = document.getElementById('debug-tools')
  if (debugToolsContainer) debugToolsContainer.style.display = enabled ? 'block' : 'none'

  chrome.storage.local.set({ [DEBUG_MODE_KEY]: enabled }, function() {
    console.log('Debug mode set to:', enabled)

    // Notify content script about the change
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: 'toggleDebugMode',
            enabled: enabled
          })
          .catch(error => {
            console.error('Error sending message:', error)
          })
      }
    })
  })
}

/**
 * Toggle highlight missing grades feature
 * @param {boolean} enabled - Whether highlighting should be enabled
 */
function toggleHighlightMissingGrades(enabled) {
  chrome.storage.local.set({ [HIGHLIGHT_MISSING_GRADES_KEY]: enabled }, function() {
    console.log('Highlight missing grades set to:', enabled)

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: 'highlightMissingGradesChanged',
            enabled: enabled
          })
          .catch(error => {
            console.error('Error sending message:', error)
          })
      }
    })
  })
}

/**
 * Toggle Kriit integration
 * @param {boolean} enabled - Whether Kriit integration should be enabled
 * @param {HTMLElement} settingsContainer - Container for Kriit settings
 */
function toggleKriitEnabled(enabled, settingsContainer) {
  chrome.storage.local.set({ [KRIIT_ENABLED_KEY]: enabled }, function() {
    console.log('Kriit integration set to:', enabled)

    // Show/hide settings container
    settingsContainer.style.display = enabled ? 'block' : 'none'

    // Notify content script about the change
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0] && isTahvelUrl(tabs[0].url)) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: 'kriitEnabledChanged',
            enabled: enabled
          })
          .catch(error => {
            console.error('Error sending message:', error)
          })
      }
    })
  })
}

/**
 * Save Kriit API settings.
 *
 * The save flow is get→set: if the user leaves the key field empty we preserve
 * the already-stored key. Because that's two async storage calls, we disable the
 * save button while it's in flight to prevent double-submit races, and check
 * chrome.runtime.lastError on both callbacks so storage failures surface.
 *
 * @param {Object} opts
 * @param {string} opts.apiUrl - The API URL
 * @param {string} opts.apiKey - The API key typed into the input (may be empty)
 * @param {HTMLElement} opts.statusElement - Element to show status message
 * @param {HTMLInputElement} opts.apiKeyInput - The API key input element
 * @param {HTMLButtonElement} opts.toggleBtn - The Näita/Peida toggle button
 * @param {HTMLButtonElement} opts.saveBtn - The Salvesta button (disabled during save)
 */
function saveKriitSettings({ apiUrl, apiKey, statusElement, apiKeyInput, toggleBtn, saveBtn }) {
  apiUrl = apiUrl.trim()
  apiKey = apiKey.trim()

  // Validate URL — require HTTPS so student PII is not transmitted over plaintext.
  // http://localhost and http://127.0.0.1 are allowed for local development.
  if (apiUrl) {
    const isHttps = apiUrl.startsWith('https://')
    const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(apiUrl) // eslint-disable-line security/detect-unsafe-regex -- bounded URL validation
    if (!isHttps && !isLocalDev) {
      alert(
        'API URL peab algama https:// (http:// on lubatud ainult localhost-i jaoks). ' +
        'Õpilaste andmed liiguvad selle aadressi kaudu — krüpteeritud ühendus on kohustuslik.'
      )
      return
    }
  }

  saveBtn.disabled = true
  const finish = () => {
    saveBtn.disabled = false
  }

  // When the key field is left empty, preserve the already-stored key instead of wiping it.
  chrome.storage.local.get([KRIIT_API_KEY_KEY], function(existing) {
    if (chrome.runtime.lastError) {
      showError('Seadete lugemine ebaõnnestus: ' + chrome.runtime.lastError.message)
      finish()
      return
    }

    const existingKey = existing[KRIIT_API_KEY_KEY] || ''
    const effectiveKey = apiKey || existingKey

    if (!effectiveKey) {
      showError('API võti puudub — sisesta uus võti.')
      finish()
      return
    }

    const effectiveUrl = apiUrl || DEFAULT_KRIIT_API_URL
    const toStore = {
      [KRIIT_ENABLED_KEY]: true,
      [KRIIT_API_URL_KEY]: effectiveUrl
    }
    if (apiKey) {
      toStore[KRIIT_API_KEY_KEY] = apiKey
    }

    chrome.storage.local.set(toStore, function() {
      if (chrome.runtime.lastError) {
        showError('Seadete salvestamine ebaõnnestus: ' + chrome.runtime.lastError.message)
        finish()
        return
      }

      console.log('Kriit API settings saved')

      // Show success message
      statusElement.textContent = 'Salvestatud!'
      setTimeout(() => {
        statusElement.textContent = ''
      }, STATUS_CLEAR_DELAY_MS)

      // Clear the input, re-mask it, and show the saved-key indicator. effectiveKey is
      // guaranteed truthy here by the early return above.
      resetApiKeyInput(apiKeyInput, toggleBtn)
      setApiKeySavedIndicator(true)

      // Notify content script about the settings change. Include apiKey only when the user
      // typed one, mirroring the storage write above — a URL-only save must not mutate the
      // content script's in-memory token. Use the same effectiveUrl that was written to
      // storage so the message and storage stay in sync.
      const payload = { enabled: true, apiUrl: effectiveUrl }
      if (apiKey) payload.apiKey = apiKey
      notifyKriitSettingsUpdated(payload)

      finish()
    })
  })
}

/**
 * Delete the stored Kriit API key.
 * @param {HTMLInputElement} apiKeyInput - The API key input element
 * @param {HTMLButtonElement} toggleBtn - The Näita/Peida toggle button
 * @param {HTMLElement} statusElement - Element to show status message
 * @param {HTMLButtonElement} deleteBtn - The Kustuta button (disabled during remove)
 */
function deleteApiKey(apiKeyInput, toggleBtn, statusElement, deleteBtn) {
  if (!confirm('Kas oled kindel, et soovid Kriit API võtme kustutada?')) return

  deleteBtn.disabled = true
  chrome.storage.local.remove(KRIIT_API_KEY_KEY, function() {
    if (chrome.runtime.lastError) {
      showError('Võtme kustutamine ebaõnnestus: ' + chrome.runtime.lastError.message)
      deleteBtn.disabled = false
      return
    }

    resetApiKeyInput(apiKeyInput, toggleBtn)
    setApiKeySavedIndicator(false)

    statusElement.textContent = 'Võti kustutatud'
    setTimeout(() => {
      statusElement.textContent = ''
    }, STATUS_CLEAR_DELAY_MS)

    notifyKriitSettingsUpdated({ apiKey: '' })
    deleteBtn.disabled = false
  })
}

/**
 * Load and display cache statistics
 */
function loadCacheStatistics() {
  const cacheStatsContainer = document.getElementById('cache-stats-container')

  if (!cacheStatsContainer) {
    console.error('Cache stats container not found')
    return
  }

  cacheStatsContainer.textContent = ''
  const loadingDiv = document.createElement('div')
  loadingDiv.textContent = 'Laadimine...'
  cacheStatsContainer.appendChild(loadingDiv)

  // Send message to content script (Cache API lives in page origin, not extension origin)
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) {
      cacheStatsContainer.textContent = 'Vahemälu statistika pole saadaval'
      return
    }
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getCacheStats' }, function(response) {
      if (chrome.runtime.lastError || !response || !response.stats) {
        cacheStatsContainer.textContent = 'Vahemälu statistika pole saadaval'
        return
      }

      const stats = response.stats
      const storageSize = formatSize(stats.storage.size)
      const totalSize = formatSize(stats.totalBytesInUse)

      // Build stats display using safe DOM methods
      cacheStatsContainer.textContent = ''
      const entries = [
        ['Vahemälu kirjeid:', String(stats.storage.count)],
        ['Vahemälu suurus:', storageSize],
        ['Kogu kasutus:', totalSize]
      ]
      for (const [label, value] of entries) {
        const div = document.createElement('div')
        const b = document.createElement('b')
        b.textContent = label
        div.appendChild(b)
        div.appendChild(document.createTextNode(' ' + value))
        cacheStatsContainer.appendChild(div)
      }

      updateCacheDetailsContent(stats)
    })
  })
}

/**
 * Update cache details content
 * @param {Object} stats - Cache statistics
 */
function updateCacheDetailsContent(stats) {
  const cacheDetailsContainer = document.getElementById('cache-details')

  if (!cacheDetailsContainer) return

  cacheDetailsContainer.textContent = ''
  const heading = document.createElement('h3')
  heading.textContent = 'Vahemälu sisu:'
  cacheDetailsContainer.appendChild(heading)

  // Disk-cache aggregate only — disk URLs are HMAC-hashed for privacy, so
  // per-item names aren't recoverable without the salt. Show count + size.
  if (stats.storage.count > 0) {
    const summary = document.createElement('div')
    summary.style.margin = '4px 0'
    summary.textContent = `Kettal: ${stats.storage.count} kirjet, ${formatSize(stats.storage.size)} kokku`
    cacheDetailsContainer.appendChild(summary)
    const note = document.createElement('div')
    note.style.cssText = 'font-size: 11px; color: #888; margin-bottom: 8px;'
    note.textContent = '(privaatsuse huvides on kettakirjete nimed räsitud — kirjete nimekirja ei kuvata)'
    cacheDetailsContainer.appendChild(note)
  } else {
    const empty = document.createElement('div')
    empty.textContent = 'Vahemälu on tühi'
    cacheDetailsContainer.appendChild(empty)
  }
}

/**
 * Toggle cache details visibility
 */
function toggleCacheDetails() {
  const cacheDetailsContainer = document.getElementById('cache-details')
  const viewCacheDetailsButton = document.getElementById('view-cache-details')

  if (!cacheDetailsContainer || !viewCacheDetailsButton) return

  const isVisible = cacheDetailsContainer.style.display !== 'none'

  if (isVisible) {
    cacheDetailsContainer.style.display = 'none'
    viewCacheDetailsButton.textContent = 'Vaata detaile'
  } else {
    cacheDetailsContainer.style.display = 'block'
    viewCacheDetailsButton.textContent = 'Peida detailid'
  }
}

/**
 * Format a byte size to a human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Clear all cache items
 */
function clearCache() {
  // Sweep any leftover legacy `OA_cache_*` chrome.storage.local entries
  // unconditionally — popup has extension-context access, no Tahvel tab
  // required. wipeOnVersionChange handles this on update, but a sideloaded
  // dev install or a partial migration can leave entries that the user
  // wants gone via the popup.
  chrome.storage.local.get(null, items => {
    const oldKeys = Object.keys(items).filter(k => k.startsWith('OA_cache_'))
    if (oldKeys.length === 0) return
    chrome.storage.local.remove(oldKeys, () => {
      if (chrome.runtime.lastError) {
        console.warn('Legacy cache sweep failed:', chrome.runtime.lastError.message)
      }
    })
  })

  // Notify content script to clear Cache API (cache lives in page origin).
  // Without an open Tahvel tab, the encrypted entries on disk can't be reached
  // — surface the error instead of falsely confirming success.
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0] || !isTahvelUrl(tabs[0].url)) {
      showError('Ava Tahvli leht ja proovi uuesti.')
      return
    }
    chrome.tabs
      .sendMessage(tabs[0].id, { action: 'cacheClearedFromPopup' })
      .then(response => {
        if (response && response.success === false) {
          showError('Vahemälu tühjendamine ebaõnnestus: ' + (response.error || 'tundmatu viga'))
          return
        }
        alert('Vahemälu tühjendatud.')
        loadCacheStatistics()
      })
      .catch(error => {
        console.error('Error sending message:', error)
        showError('Vahemälu tühjendamine ebaõnnestus: ' + error.message)
      })
  })
}

/**
 * Download captured API requests from the content script
 */
function downloadCapturedRequests() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) {
      showError('Aktiivset vahekaarti ei leitud')
      return
    }

    if (!isTahvelUrl(tabs[0].url)) {
      showError('Ava Tahvli leht ja proovi uuesti.')
      return
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: 'getCapturedRequests' }, function(response) {
      if (chrome.runtime.lastError) {
        showError('Ava Tahvli leht ja värskenda lehte, seejärel proovi uuesti.')
        return
      }
      if (!response || response.status !== 'success') {
        showError('API päringute allalaadimine ebaõnnestus: ' + (response?.message || 'Tundmatu viga'))
        return
      }

      const exportData = response.data
      if (!exportData.requests || exportData.requests.length === 0) {
        showError('Salvestatud API päringuid ei leitud. Ava Tahvli leht ja proovi uuesti.')
        return
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const journalId = exportData.metadata.journalId || 'all'
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `oa2_debug_journal_${journalId}_${timestamp}.json`

      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 5000)
    })
  })
}

/**
 * Toggle the "API key saved" indicator below the API key input.
 * @param {boolean} hasKey - True when a key is stored.
 */
export function setApiKeySavedIndicator(hasKey) {
  const apiKeyStatus = document.getElementById('kriit-api-key-status')
  if (!apiKeyStatus) return
  apiKeyStatus.style.display = hasKey ? 'flex' : 'none'
}

/**
 * Clear the API key input and return the visibility toggle to its masked/show state.
 * @param {HTMLInputElement} apiKeyInput
 * @param {HTMLButtonElement} toggleBtn
 */
function resetApiKeyInput(apiKeyInput, toggleBtn) {
  apiKeyInput.value = ''
  apiKeyInput.type = 'password'
  toggleBtn.textContent = API_KEY_SHOW_LABEL
}

/**
 * Post a kriitSettingsUpdated message to the active Tahvel tab, if any.
 * Missing/non-Tahvel tabs are silently skipped; delivery errors are logged.
 * @param {Object} payload - Message fields (action is set automatically).
 */
function notifyKriitSettingsUpdated(payload) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0] || !isTahvelUrl(tabs[0].url)) return
    chrome.tabs
      .sendMessage(tabs[0].id, { action: 'kriitSettingsUpdated', ...payload })
      .catch(error => {
        console.error('Error sending message:', error)
      })
  })
}

/**
 * Show error message in the error log element
 * @param {string} message - Error message to display
 */
function showError(message) {
  const errorLogElement = document.getElementById('error-log')
  if (errorLogElement) {
    if (message) {
      errorLogElement.textContent = message
      errorLogElement.style.display = 'block'
    } else {
      errorLogElement.textContent = ''
      errorLogElement.style.display = 'none'
    }
  }
}
