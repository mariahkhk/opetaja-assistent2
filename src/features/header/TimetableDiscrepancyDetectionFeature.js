import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { cacheService } from '../../services/CacheService.js'

/**
 * TimetableDiscrepancyDetectionFeature
 *
 * Detects if there are any timetable discrepancies across all journals and displays
 * an orange button in the header when discrepancies are found.
 * Reuses the same logic as LessonCountWarningFeature.
 *
 * @extends BaseFeature
 */
export default class TimetableDiscrepancyDetectionFeature extends BaseFeature {
  constructor() {
    super(
      'timetableDiscrepancyDetection',
      () => true, // Activate on all pages
      ['#lang-buttons'] // Wait for language buttons to be present
    )
    this.name = 'TimetableDiscrepancyDetectionFeature'
    this.checkInterval = null
    this.currentSchoolId = null
    this.currentTeacherId = null
    this.clickHandler = null
  }

  /**
   * Activates the feature and starts checking for discrepancies
   */
  async onActivate() {
    // Initialize global state
    window.timetableDiscrepancies = {
      hasDiscrepancies: false,
      lastChecked: null
    }

    // Get the language buttons container
    const langButtons = document.querySelector('#lang-buttons')
    if (!langButtons) {
      Logger.error('[TimetableDiscrepancyDetectionFeature] Language buttons container not found')
      return
    }

    // Set up event delegation for button clicks
    this.#setupClickHandler()

    // Create and inject the button
    this.#createButton(langButtons)

    // Get current user info
    await this.#getCurrentUserInfo()

    // Check immediately
    await this.#checkForDiscrepancies()

    // Then check every 30 seconds for discrepancies and update button visibility every 2 seconds
    this.checkInterval = setInterval(() => {
      this.#checkForDiscrepancies()
      this.#updateButtonVisibility()
    }, 30000)

    // Update button visibility more frequently
    this.buttonCheckInterval = setInterval(() => {
      this.#updateButtonVisibility()
    }, 2000)
  }

  /**
   * Cleans up the feature
   */
  onDeactivate() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    if (this.buttonCheckInterval) {
      clearInterval(this.buttonCheckInterval)
      this.buttonCheckInterval = null
    }

    // Remove click handler
    if (this.clickHandler) {
      document.body.removeEventListener('click', this.clickHandler)
      this.clickHandler = null
    }

    // Remove button from DOM
    const button = document.getElementById('oa2-timetable-discrepancy-header-button')
    if (button) {
      button.remove()
    }

    delete window.timetableDiscrepancies

    super.onDeactivate()
  }

  /**
   * Get current user info from the API
   * @private
   */
  async #getCurrentUserInfo() {
    try {
      const userInfo = await this.api.tahvel.get('/user', {}, { cache: true })
      this.currentSchoolId = userInfo.school?.id || 9
      this.currentTeacherId = userInfo.person?.id
    } catch (error) {
      Logger.error(`[${this.name}] Error getting user info:`, error)
      this.currentSchoolId = 9
    }
  }

  /**
   * Check for timetable discrepancies across all journals
   * @private
   */
  async #checkForDiscrepancies() {
    try {
      // Get all journals from cache
      const journals = await this.#getAllJournalsFromCache()

      if (!journals || journals.length === 0) {
        window.timetableDiscrepancies.hasDiscrepancies = false
        window.timetableDiscrepancies.lastChecked = new Date().toISOString()
        return
      }

      // Check each journal for discrepancies
      let hasAnyDiscrepancy = false

      for (const journal of journals) {
        const hasDiscrepancy = await this.#checkJournalDiscrepancy(journal)
        if (hasDiscrepancy) {
          hasAnyDiscrepancy = true
          break // Found at least one discrepancy, no need to check more
        }
      }

      window.timetableDiscrepancies.hasDiscrepancies = hasAnyDiscrepancy
      window.timetableDiscrepancies.lastChecked = new Date().toISOString()
    } catch (error) {
      Logger.error(`[${this.name}] Error checking for discrepancies:`, error)
    }
  }

  /**
   * Get all journals from cache by scanning cache keys
   * @private
   */
  async #getAllJournalsFromCache() {
    try {
      // Get all items from chrome.storage.local
      const allItems = await new Promise(resolve => {
        chrome.storage.local.get(null, items => {
          resolve(items)
        })
      })

      const journals = []

      // Look for journal API responses in cache
      // Cache keys are prefixed with 'OA_cache_' and contain the API endpoint
      const journalKeyPattern = /OA_cache_GET_https?:\/\/[^/]+\/hois_back\/journals\/(\d+)$/

      for (const key of Object.keys(allItems)) {
        const match = key.match(journalKeyPattern)
        if (match) {
          const cachedItem = allItems[key]
          if (cachedItem && cachedItem.data && cachedItem.data.id) {
            journals.push(cachedItem.data)
          }
        }
      }

      return journals
    } catch (error) {
      Logger.error(`[${this.name}] Error getting journals from cache:`, error)
      return []
    }
  }

  /**
   * Check if a single journal has timetable discrepancies
   * @private
   */
  async #checkJournalDiscrepancy(journal) {
    try {
      // Get actual lesson count from journal (MAHT_a only)
      const actualLessonCount = this.#getLessonCountFromJournal(journal)
      if (actualLessonCount === null) {
        return false
      }

      // Get teacher IDs from journal
      const teacherIds = journal.journalTeachers?.map(t => t.id) || []
      if (teacherIds.length === 0 && this.currentTeacherId) {
        teacherIds.push(this.currentTeacherId)
      }

      if (teacherIds.length === 0) {
        return false
      }

      // Get timetable lessons
      const timetableLessons = await this.#getTimetableLessons(journal.id, teacherIds)

      // Count past lessons
      const pastTimetableLessons = this.#countPastLessons(timetableLessons)

      // Compare
      return pastTimetableLessons !== actualLessonCount
    } catch (error) {
      Logger.error(`[${this.name}] Error checking journal ${journal.id}:`, error)
      return false
    }
  }

  /**
   * Get lesson count from journal object (MAHT_a only)
   * @private
   */
  #getLessonCountFromJournal(journal) {
    if (!journal || !journal.lessonHours || !journal.lessonHours.capacityHours) {
      return null
    }

    // Get only MAHT_a (auditorium lessons), exclude MAHT_i (independent work)
    const mahtA = journal.lessonHours.capacityHours.find(h => h.capacity === 'MAHT_a')

    if (!mahtA) {
      // Fallback to totalUsedHours
      return journal.lessonHours.totalUsedHours || 0
    }

    return mahtA.usedHours || 0
  }

  /**
   * Get timetable lessons for a journal
   * @private
   */
  async #getTimetableLessons(journalId, teacherIds) {
    try {
      if (!this.currentSchoolId || teacherIds.length === 0) {
        return []
      }

      // Get current study year date range
      const { from, thru } = this.#getCurrentStudyYearRange()

      // Build teacher IDs parameter
      const teacherIdsParam = teacherIds.join(',')

      // Build timetable API endpoint
      const endpoint = `/timetableevents/timetableByTeacher/${this.currentSchoolId}?from=${from}&lang=ET&teachers=${teacherIdsParam}&thru=${thru}`

      // Fetch timetable data
      const data = await this.api.tahvel.get(
        endpoint,
        {},
        { cache: true, cacheExpiration: cacheService.EXPIRATION.VERY_LONG }
      )

      if (!data || !data.timetableEvents || !Array.isArray(data.timetableEvents)) {
        return []
      }

      // Filter events for this journal
      return data.timetableEvents.filter(event => event.journalId === journalId)
    } catch (error) {
      Logger.error(`[${this.name}] Error fetching timetable lessons:`, error)
      return []
    }
  }

  /**
   * Get current study year date range
   * @private
   */
  #getCurrentStudyYearRange() {
    const now = new Date()
    const currentYear = now.getFullYear()
    const studyYear = now.getMonth() < 7 ? currentYear - 1 : currentYear

    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(), // September 1st
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString() // August 31st
    }
  }

  /**
   * Count past lessons from timetable events
   * @private
   */
  #countPastLessons(timetableEvents) {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const pastEvents = timetableEvents.filter(event => {
      if (!event.date) return false

      const eventDate = new Date(event.date)
      const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())

      return eventDay < today
    })

    return pastEvents.length
  }

  /**
   * Sets up event delegation for button clicks
   * @private
   */
  #setupClickHandler() {
    if (this.clickHandler) {
      document.body.removeEventListener('click', this.clickHandler)
    }

    this.clickHandler = (event) => {
      const target = event.target

      if (target.id === 'oa2-timetable-discrepancy-header-button' ||
          target.closest('#oa2-timetable-discrepancy-header-button')) {
        event.preventDefault()
        event.stopPropagation()

        window.location.hash = '#/journals'

        setTimeout(() => {
          if (!window.location.hash.includes('/journals')) {
            window.location.href = '#/journals'
          }
        }, 100)
      }
    }

    document.body.addEventListener('click', this.clickHandler, true)
  }

  /**
   * Creates the orange timetable discrepancy button
   * @private
   */
  #createButton(langButtons) {
    const existingButton = document.getElementById('oa2-timetable-discrepancy-header-button')
    if (existingButton) {
      existingButton.remove()
    }

    const button = document.createElement('button')
    button.id = 'oa2-timetable-discrepancy-header-button'
    button.className = 'md-button md-ink-ripple'
    button.type = 'button'
    button.setAttribute('aria-label', 'Päevikutes on sissekandmata tunnid')
    button.style.cssText = `
      background-color: #ff9800;
      color: white;
      margin-right: 12px;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
      display: none;
      transition: background-color 0.3s ease;
      cursor: pointer;
    `

    button.textContent = 'Päevikutes on sissekandmata tunnid'

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#f57c00'
    })
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#ff9800'
    })

    const firstLangButton = langButtons.querySelector('button')
    if (firstLangButton) {
      langButtons.insertBefore(button, firstLangButton)
    } else {
      langButtons.parentNode.insertBefore(button, langButtons)
    }
  }

  /**
   * Updates button visibility based on discrepancy status
   * @private
   */
  #updateButtonVisibility() {
    const button = document.getElementById('oa2-timetable-discrepancy-header-button')
    if (!button) return

    if (window.timetableDiscrepancies && window.timetableDiscrepancies.hasDiscrepancies) {
      button.style.display = 'inline-block'
    } else {
      button.style.display = 'none'
    }
  }
}
