/**
 * Popup script for Õpetaja Assistent 2
 */

// Constants
const DEBUG_MODE_KEY = 'OA_debug_mode'
const CACHE_PREFIX = 'OA_cache_'
const KRIIT_ENABLED_KEY = 'OA_kriitEnabled'
const KRIIT_API_URL_KEY = 'OA_kriitApiBaseUrl'
const KRIIT_API_KEY_KEY = 'OA_kriitApiToken'
const DEFAULT_KRIIT_API_URL = 'https://kriit.vikk.ee/api'

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

// Helper to parse DD.MM.YYYY to Date
function parseEuDate(str) {
  if (!/^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$/.test(str)) return null
  const [day, month, year] = str.split('.').map(Number)
  const d = new Date(year, month - 1, day)
  // Check for invalid dates (e.g. 32.13.2025)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d
}

// Format date for display
function formatDisplayDate(date) {
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

/**
 * Initialize the popup
 */
function initPopup() {
  // Get DOM elements
  const debugModeCheckbox = document.getElementById('debug-mode')
  const clearCacheButton = document.getElementById('clear-cache')
  const versionElement = document.getElementById('version')
  const kriitEnabledCheckbox = document.getElementById('kriit-enabled')
  const kriitSettingsContainer = document.getElementById('kriit-settings-container')
  const kriitApiUrlInput = document.getElementById('kriit-api-url')
  const kriitApiKeyInput = document.getElementById('kriit-api-key')
  const saveKriitSettingsButton = document.getElementById('save-kriit-settings')
  const saveStatusElement = document.getElementById('save-status')
  const errorLogElement = document.getElementById('error-log')
  const viewCacheDetailsButton = document.getElementById('view-cache-details')
  const refreshCacheStatsButton = document.getElementById('refresh-cache-stats')
  const showFutureSubjectsButton = document.getElementById('show-future-subjects')
  const subjectsContainer = document.getElementById('subjects-container')
  const comparisonDateInput = document.getElementById('comparison-date')
  const findTeachersButton = document.getElementById('find-teachers')
  const teachersContainer = document.getElementById('teachers-container')

  // Check if all elements are found
  if (!debugModeCheckbox) throw new Error('Debug mode checkbox not found')
  if (!clearCacheButton) throw new Error('Clear cache button not found')
  if (!versionElement) throw new Error('Version element not found')
  if (!kriitEnabledCheckbox) throw new Error('Kriit enabled checkbox not found')
  if (!kriitSettingsContainer) throw new Error('Kriit settings container not found')
  if (!kriitApiUrlInput) throw new Error('Kriit API URL input not found')
  if (!kriitApiKeyInput) throw new Error('Kriit API key input not found')
  if (!saveKriitSettingsButton) throw new Error('Save Kriit settings button not found')
  if (!saveStatusElement) throw new Error('Save status element not found')
  if (!errorLogElement) throw new Error('Error log element not found')
  if (!showFutureSubjectsButton) throw new Error('Show future subjects button not found')
  if (!subjectsContainer) throw new Error('Subjects container not found')
  if (!comparisonDateInput) throw new Error('Comparison date input not found')
  if (!findTeachersButton) throw new Error('Find teachers button not found')
  if (!teachersContainer) throw new Error('Teachers container not found')

  // Set version from manifest
  try {
    chrome.runtime
      .getManifest()
      .then(manifest => {
        versionElement.textContent = manifest.version
      })
      .catch(error => {
        console.error('Error getting manifest:', error)
      })
  } catch (error) {
    console.error('Error accessing manifest:', error)
  }

  // Initialize debug mode checkbox
  chrome.storage.sync.get([DEBUG_MODE_KEY], function(result) {
    debugModeCheckbox.checked = result[DEBUG_MODE_KEY] === true
  })

  // Initialize Kriit API settings
  chrome.storage.sync.get([KRIIT_ENABLED_KEY, KRIIT_API_URL_KEY, KRIIT_API_KEY_KEY], function(result) {
    const kriitEnabled = result[KRIIT_ENABLED_KEY] === true
    kriitEnabledCheckbox.checked = kriitEnabled

    // Show/hide Kriit settings based on enabled state
    kriitSettingsContainer.style.display = kriitEnabled ? 'block' : 'none'

    // Set values
    kriitApiUrlInput.value = result[KRIIT_API_URL_KEY] || ''
    kriitApiKeyInput.value = result[KRIIT_API_KEY_KEY] || ''
  })

  // Initialize comparison date with today's date in DD.MM.YYYY
  const today = new Date()
  comparisonDateInput.value = formatDisplayDate(today)

  // On load, initialize comparison date from storage if present
  chrome.storage.local.get(['OA_comparisonDate'], function(result) {
    const dateStr = result['OA_comparisonDate']
    if (dateStr && parseEuDate(dateStr)) {
      comparisonDateInput.value = dateStr
    } else {
      const today = new Date()
      comparisonDateInput.value = formatDisplayDate(today)
      chrome.storage.local.set({ OA_comparisonDate: comparisonDateInput.value })
    }
  })

  // Add event listener for date change/blur to validate, save, and reset if empty
  comparisonDateInput.addEventListener('blur', function() {
    const val = comparisonDateInput.value.trim()
    if (!val) {
      // If empty, reset to today and save
      const today = new Date()
      const todayStr = formatDisplayDate(today)
      comparisonDateInput.value = todayStr
      chrome.storage.local.set({ OA_comparisonDate: todayStr })
      comparisonDateInput.style.borderColor = ''
      showError('')
      return
    }
    if (!parseEuDate(val)) {
      comparisonDateInput.style.borderColor = 'red'
      showError('Kuupäev peab olema kujul DD.MM.YYYY')
    } else {
      comparisonDateInput.style.borderColor = ''
      showError('')
      chrome.storage.local.set({ OA_comparisonDate: val })
    }
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
      saveKriitSettings(kriitApiUrlInput.value, kriitApiKeyInput.value, saveStatusElement)
    } catch (error) {
      console.error('Error saving Kriit settings:', error)
      showError('Failed to save Kriit settings: ' + error.message)
    }
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

  // Add event listeners for subjects
  showFutureSubjectsButton.addEventListener('click', function() {
    try {
      showFutureSubjects()
    } catch (error) {
      console.error('Error showing future subjects:', error)
      showError('Failed to show future subjects: ' + error.message)
    }
  })

  // Add event listeners for teachers
  findTeachersButton.addEventListener('click', function() {
    try {
      findTeachers()
    } catch (error) {
      console.error('Error finding teachers:', error)
      showError('Failed to find teachers: ' + error.message)
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
  chrome.storage.sync.set({ [DEBUG_MODE_KEY]: enabled }, function() {
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
 * Toggle Kriit integration
 * @param {boolean} enabled - Whether Kriit integration should be enabled
 * @param {HTMLElement} settingsContainer - Container for Kriit settings
 */
function toggleKriitEnabled(enabled, settingsContainer) {
  chrome.storage.sync.set({ [KRIIT_ENABLED_KEY]: enabled }, function() {
    console.log('Kriit integration set to:', enabled)

    // Show/hide settings container
    settingsContainer.style.display = enabled ? 'block' : 'none'

    // Notify content script about the change
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (
        tabs[0] &&
        (tabs[0].url.includes('tahvel.edu.ee') ||
          tabs[0].url.includes('tahvel.eenet.ee') ||
          tabs[0].url.includes('uustahvel.eenet.ee') ||
          tabs[0].url.includes('test.uustahvel.eenet.ee'))
      ) {
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
 * Save Kriit API settings
 * @param {string} apiUrl - The API URL
 * @param {string} apiKey - The API key
 * @param {HTMLElement} statusElement - Element to show status message
 */
function saveKriitSettings(apiUrl, apiKey, statusElement) {
  apiUrl = apiUrl.trim()
  apiKey = apiKey.trim()

  // Validate URL
  if (apiUrl && !apiUrl.startsWith('http')) {
    alert('API URL peab algama http:// või https://')
    return
  }

  // Save settings to chrome.storage.sync
  chrome.storage.sync.set(
    {
      [KRIIT_ENABLED_KEY]: true, // Enable Kriit integration when settings are saved
      [KRIIT_API_URL_KEY]: apiUrl || DEFAULT_KRIIT_API_URL,
      [KRIIT_API_KEY_KEY]: apiKey
    },
    function() {
      console.log('Kriit API settings saved')

      // Show success message
      statusElement.textContent = 'Salvestatud!'
      setTimeout(() => {
        statusElement.textContent = ''
      }, 2000)

      // Notify content script about the settings change
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (
          tabs[0] &&
          (tabs[0].url.includes('tahvel.edu.ee') ||
            tabs[0].url.includes('tahvel.eenet.ee') ||
            tabs[0].url.includes('uustahvel.eenet.ee') ||
            tabs[0].url.includes('test.uustahvel.eenet.ee'))
        ) {
          chrome.tabs
            .sendMessage(tabs[0].id, {
              action: 'kriitSettingsUpdated',
              enabled: true,
              apiUrl: apiUrl,
              apiKey: apiKey
            })
            .catch(error => {
              console.error('Error sending message:', error)
            })
        }
      })
    }
  )
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

  cacheStatsContainer.innerHTML = '<div>Laadimine...</div>'

  // Send message to background script to get cache statistics
  chrome.runtime.sendMessage({ action: 'getCacheStats' }, function(response) {
    if (!response || !response.stats) {
      cacheStatsContainer.innerHTML = '<div>Vahemälu statistika pole saadaval</div>'
      return
    }

    const stats = response.stats

    // Format the statistics
    const storageSize = formatSize(stats.storage.size)
    const totalSize = formatSize(stats.totalBytesInUse)

    // Update the container
    cacheStatsContainer.innerHTML = `
      <div><b>Vahemälu kirjeid:</b> ${stats.storage.count}</div>
      <div><b>Vahemälu suurus:</b> ${storageSize}</div>
      <div><b>Kogu kasutus:</b> ${totalSize}</div>
    `

    // Update details container
    updateCacheDetailsContent(stats)
  })
}

/**
 * Update cache details content
 * @param {Object} stats - Cache statistics
 */
function updateCacheDetailsContent(stats) {
  const cacheDetailsContainer = document.getElementById('cache-details')

  if (!cacheDetailsContainer) return

  // Generate HTML for the details
  let html = '<h3>Vahemälu sisu:</h3>'

  // Add table of largest items
  if (stats.storage.items.length > 0) {
    html += '<table style="width: 100%; border-collapse: collapse;">'
    html += '<tr><th style="text-align: left;">Kirje</th><th style="text-align: right;">Suurus</th><th style="text-align: right;">Vanus</th></tr>'

    // Show only top 10 items
    const topItems = stats.storage.items.slice(0, 10)

    topItems.forEach(item => {
      // Format key name to be shorter
      let displayKey = item.key
      if (displayKey.includes('/')) {
        const parts = displayKey.split('/')
        displayKey = parts[parts.length - 1]
        if (displayKey.includes('?')) {
          displayKey = displayKey.split('?')[0]
        }
      }

      // Format size and age
      const size = formatSize(item.size)
      const age = formatAge(item.ageInMinutes)

      html += `<tr>
        <td style="border-bottom: 1px solid #eee; padding: 4px 0;" title="${item.key}">${displayKey}</td>
        <td style="border-bottom: 1px solid #eee; padding: 4px 0; text-align: right;">${size}</td>
        <td style="border-bottom: 1px solid #eee; padding: 4px 0; text-align: right;">${age}</td>
      </tr>`
    })

    html += '</table>'

    if (stats.storage.items.length > 10) {
      html += `<div style="text-align: center; margin-top: 8px; font-style: italic;">+ ${stats.storage.items.length - 10} muud kirjet</div>`
    }
  } else {
    html += '<div>Vahemälu on tühi</div>'
  }

  cacheDetailsContainer.innerHTML = html
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
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Format age in minutes to a human-readable string
 * @param {number} minutes - Age in minutes
 * @returns {string} Formatted age
 */
function formatAge(minutes) {
  if (minutes < 1) return 'äsja'
  if (minutes < 60) return minutes + ' min'
  if (minutes < 24 * 60) return Math.round(minutes / 60) + ' h'
  return Math.round(minutes / (60 * 24)) + ' päeva'
}

/**
 * Show future subjects with upcoming lessons
 */
function showFutureSubjects() {
  const subjectsContainer = document.getElementById('subjects-container')
  const subjectsLoading = document.getElementById('subjects-loading')
  const subjectsContent = document.getElementById('subjects-content')
  const comparisonDateInput = document.getElementById('comparison-date')

  // Show the container and loading state
  subjectsContainer.style.display = 'block'
  subjectsLoading.style.display = 'block'
  subjectsContent.style.display = 'none'

  // Get the selected comparison date in DD.MM.YYYY and convert to ISO
  const comparisonDate = comparisonDateInput.value.trim()
  let isoDate = ''
  if (comparisonDate) {
    const d = parseEuDate(comparisonDate)
    if (!d) {
      subjectsLoading.style.display = 'none'
      subjectsContent.innerHTML = '<div style="color: red;">Vigane kuupäev. Kasuta DD.MM.YYYY</div>'
      subjectsContent.style.display = 'block'
      return
    }
    isoDate = d.toISOString().split('T')[0]
  } else {
    const d = new Date()
    isoDate = d.toISOString().split('T')[0]
  }

  // Send message to background script to fetch future subjects
  chrome.runtime.sendMessage(
    {
      action: 'getFutureSubjects',
      comparisonDate: isoDate
    },
    function(response) {
      subjectsLoading.style.display = 'none'

      if (!response || response.status !== 'success') {
        subjectsContent.innerHTML = '<div style="color: red;">Viga: ' + (response?.message || 'Tundmatu viga') + '</div>'
        subjectsContent.style.display = 'block'
        return
      }

      displaySubjects(response.data, isoDate)
      subjectsContent.style.display = 'block'
    }
  )
}

/**
 * Display subjects in the container
 * @param {Array} subjects - Array of subject objects
 * @param {string} comparisonDate - The comparison date in YYYY-MM-DD format
 */
function displaySubjects(subjects, comparisonDate) {
  const subjectsContent = document.getElementById('subjects-content')

  if (!subjects || subjects.length === 0) {
    subjectsContent.innerHTML = '<div style="color: #666;">Tulevasi tunde ei leitud.</div>'
    return
  }

  // Use the provided comparison date or today's date
  const compareDate = comparisonDate ? new Date(comparisonDate) : new Date()
  compareDate.setHours(0, 0, 0, 0)

  // Group subjects by name and count future lessons
  const subjectStats = {}

  subjects.forEach(lesson => {
    const lessonDate = new Date(lesson.date)
    lessonDate.setHours(0, 0, 0, 0)

    if (lessonDate >= compareDate) {
      const subjectName = lesson.nameEt || lesson.name || 'Nimetu aine'
      if (!subjectStats[subjectName]) {
        subjectStats[subjectName] = {
          count: 0,
          nextLesson: lessonDate,
          lessons: [],
          teachers: new Set()
        }
      }
      subjectStats[subjectName].count++
      subjectStats[subjectName].lessons.push(lesson)

      // Track teachers (if available in the lesson data)
      if (lesson.teacherName) {
        subjectStats[subjectName].teachers.add(lesson.teacherName)
      }

      // Keep track of the next lesson date
      if (lessonDate < subjectStats[subjectName].nextLesson) {
        subjectStats[subjectName].nextLesson = lessonDate
      }
    }
  })

  // Sort subjects by next lesson date
  const sortedSubjects = Object.entries(subjectStats).sort(([, a], [, b]) => a.nextLesson - b.nextLesson)

  // Create HTML
  const selectedDateStr = formatDisplayDate(compareDate)
  let html = `<div style="margin-bottom: 10px;"><strong>Kõigi õpetajate tulevaste tundide ained (alates ${selectedDateStr}):</strong></div>`

  if (sortedSubjects.length === 0) {
    html += `<div style="color: #666;">Tulevasi tunde ei leitud alates ${selectedDateStr}.</div>`
  } else {
    html += `<div style="margin-bottom: 10px; font-size: 12px; color: #666;">
      Kokku ${sortedSubjects.length} erinevat ainet
    </div>`

    html += '<div style="display: flex; flex-direction: column; gap: 8px;">'

    sortedSubjects.forEach(([subjectName, stats]) => {
      const nextLessonStr = formatDisplayDate(stats.nextLesson)
      const plural = stats.count === 1 ? 'tund' : 'tundi'
      const teacherCount = stats.teachers.size
      const teacherText = teacherCount > 0 ? ` • ${teacherCount} õpetajat` : ''

      html += `
        <div style="
          border: 1px solid #ddd; 
          border-radius: 4px; 
          padding: 8px; 
          background-color: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        ">
          <div style="font-weight: bold; margin-bottom: 4px;">${subjectName}</div>
          <div style="font-size: 11px; color: #666;">
            ${stats.count} ${plural} • Järgmine: ${nextLessonStr}${teacherText}
          </div>
        </div>
      `
    })

    html += '</div>'
  }

  subjectsContent.innerHTML = html
}

/**
 * Find and display all teachers with their IDs
 */
function findTeachers() {
  const teachersContainer = document.getElementById('teachers-container')
  const teachersLoading = document.getElementById('teachers-loading')
  const teachersContent = document.getElementById('teachers-content')

  if (!teachersContainer || !teachersLoading || !teachersContent) {
    console.error('Teachers container elements not found')
    return
  }

  // Show container and loading state
  teachersContainer.style.display = 'block'
  teachersLoading.style.display = 'block'
  teachersContent.style.display = 'none'

  // Send message to content script to get teachers
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) {
      showError('No active tab found')
      return
    }

    const isValidTahvelPage = tabs[0].url.includes('tahvel.edu.ee') || tabs[0].url.includes('tahvel.eenet.ee')

    if (!isValidTahvelPage) {
      showError('Palun mine Tahvli lehele, et kasutada seda funktsiooni')
      teachersContainer.style.display = 'none'
      return
    }

    chrome.tabs
      .sendMessage(tabs[0].id, {
        action: 'findTeachers'
      })
      .then(response => {
        if (response && response.success) {
          displayTeachers(response.teachers)
        } else {
          showError(response ? response.error : 'Failed to get teachers')
          teachersContainer.style.display = 'none'
        }
      })
      .catch(error => {
        console.error('Error sending message:', error)
        showError('Failed to communicate with content script: ' + error.message)
        teachersContainer.style.display = 'none'
      })
  })
}

/**
 * Display teachers in the teachers container
 * @param {Array} teachers - Array of teacher objects
 */
function displayTeachers(teachers) {
  const teachersLoading = document.getElementById('teachers-loading')
  const teachersContent = document.getElementById('teachers-content')

  if (!teachersLoading || !teachersContent) return

  teachersLoading.style.display = 'none'
  teachersContent.style.display = 'block'

  if (!teachers || teachers.length === 0) {
    teachersContent.innerHTML = '<div>Õpetajaid ei leitud</div>'
    return
  }

  // Sort teachers by name
  teachers.sort((a, b) => a.name.localeCompare(b.name))

  // Create HTML for teachers
  let html = '<div style="margin-bottom: 8px; font-weight: bold;">Leitud õpetajad:</div>'

  teachers.forEach(teacher => {
    html += `
      <div style="
        margin-bottom: 6px; 
        padding: 6px 8px; 
        border: 1px solid #ddd;
        border-radius: 4px; 
        background-color: white;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      ">
        <div style="font-weight: bold; margin-bottom: 2px;">${teacher.name}</div>
        <div style="font-size: 11px; color: #666;">
          ID: ${teacher.id}
        </div>
      </div>
    `
  })

  teachersContent.innerHTML = html
}

/**
 * Clear all cache items
 */
function clearCache() {
  chrome.storage.local.get(null, function(items) {
    const keysToRemove = Object.keys(items).filter(key => key.startsWith(CACHE_PREFIX))

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, function() {
        console.log(`Cleared ${keysToRemove.length} cache items`)

        // Notify the user
        alert(`Tühjendatud ${keysToRemove.length} vahemälu kirjet.`)

        // Refresh the cache statistics
        loadCacheStatistics()

        // Notify content script about the cache clear
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs[0]) {
            chrome.tabs
              .sendMessage(tabs[0].id, {
                action: 'cacheClearedFromPopup'
              })
              .catch(error => {
                console.error('Error sending message:', error)
              })
          }
        })
      })
    } else {
      alert('Vahemälu on juba tühi.')
    }
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
