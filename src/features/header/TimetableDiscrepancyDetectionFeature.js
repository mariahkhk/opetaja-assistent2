import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { cacheService } from '../../services/CacheService.js'
import { fetchTeacherJournals } from '../../lib/fetchTeacherJournals.js'
import { getSchoolId } from '../../lib/schoolId.js'
import { isTahvelAuthenticated } from '../../lib/isTahvelAuthenticated.js'

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
    this.buttonCheckInterval = null
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

    // Bail out before any /journals fetch when there's no Tahvel session
    // (login screen, expired session). The button + click handler are still
    // wired up (cheap, idempotent) so they're ready post-login when the next
    // navigation re-activates the feature.
    if (!await isTahvelAuthenticated(this.api)) {
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] No Tahvel session, skipping discrepancy check`)
      return
    }

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
      this.currentSchoolId = await getSchoolId(this.api, null)
      const userInfo = await this.api.tahvel.get('/user', {}, { cache: true, cacheExpiration: 864e5 })
      this.currentTeacherId = userInfo.person?.id
    } catch (error) {
      Logger.error(`[${this.name}] Error getting user info:`, error)
    }
  }

  /**
   * Check for timetable discrepancies across all journals
   * @private
   */
  async #checkForDiscrepancies() {
    try {
      const journals = await this.#fetchJournalsFromApi()

      if (!journals || journals.length === 0) {
        window.timetableDiscrepancies.hasDiscrepancies = false
        window.timetableDiscrepancies.lastChecked = new Date().toISOString()
        return
      }

      // Check each journal for discrepancies
      let hasAnyDiscrepancy = false

      for (const journal of journals) {
        const hasDiscrepancy = await this.checkJournalDiscrepancy(journal)
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
   * Fetch the teacher's journal list and full journal info for each.
   * Goes through the API service so cached entries are served without
   * a network hit.
   * @private
   * @returns {Promise<Array>} Array of journal objects
   */
  async #fetchJournalsFromApi() {
    try {
      const journalList = await fetchTeacherJournals(this.api)
      if (!journalList || journalList.length === 0) return []

      const journalResults = await Promise.all(
        journalList
          .filter(item => item.id)
          .map(async item => {
            try {
              const journal = await this.api.tahvel.get(
                `/journals/${item.id}`,
                {},
                { cacheExpiration: 30 * 24 * 60 * 60 * 1000 }
              )
              return (journal && journal.id) ? journal : null
            } catch (err) {
              Logger.debug(`[${this.name}] Could not fetch journal ${item.id}:`, err.message)
              return null
            }
          })
      )
      return journalResults.filter(j => j !== null)
    } catch (error) {
      Logger.debug(`[${this.name}] Error fetching journals from API:`, error.message)
      return []
    }
  }

  /**
   * Check if a single journal has timetable discrepancies
   */
  async checkJournalDiscrepancy(journal) {
    try {
      // Get actual lesson count from journal (MAHT_a only)
      const actualLessonCount = this.getLessonCountFromJournal(journal)
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
      const pastTimetableLessons = this.countPastLessons(timetableLessons)

      // Flag discrepancy when journal and timetable lesson counts don't match
      return pastTimetableLessons !== actualLessonCount
    } catch (error) {
      Logger.error(`[${this.name}] Error checking journal ${journal.id}:`, error)
      return false
    }
  }

  static CONTACT_CAPACITY_TYPES = ['MAHT_a', 'MAHT_p', 'MAHT_e']

  /**
   * Get contact lesson count from journal object (MAHT_a + MAHT_p + MAHT_e)
   */
  getLessonCountFromJournal(journal) {
    if (!journal || !journal.lessonHours || !journal.lessonHours.capacityHours) {
      return null
    }

    const contactHours = journal.lessonHours.capacityHours
      .filter(h => TimetableDiscrepancyDetectionFeature.CONTACT_CAPACITY_TYPES.includes(h.capacity))

    if (contactHours.length === 0) {
      return journal.lessonHours.totalUsedHours || 0
    }

    return contactHours.reduce((sum, h) => sum + (h.usedHours || 0), 0)
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
      const { from, thru } = this.getCurrentStudyYearRange()

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
   */
  getCurrentStudyYearRange() {
    const now = new Date()
    const currentYear = now.getFullYear()
    const studyYear = now.getMonth() < 8 ? currentYear - 1 : currentYear

    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(), // September 1st
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString() // August 31st
    }
  }

  /**
   * Count past lessons from timetable events
   */
  countPastLessons(timetableEvents) {
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

    this.clickHandler = event => {
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
      width: auto;
      min-width: fit-content;
      height: auto;
      white-space: nowrap;
      flex-shrink: 0;
      border: none;
      outline: none;
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
