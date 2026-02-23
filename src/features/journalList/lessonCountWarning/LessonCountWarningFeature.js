/**
 * Lesson Count Warning Feature - Shows pink calendar icons for journals with lesson count discrepancies
 *
 * Requirements:
 * - Shows pink pill with calendar icon when the journal has discrepancies between lesson count and timetable
 * - Reads lesson count from cache (MAHT_a capacity hours - actual lessons, excludes MAHT_i independent work)
 * - Fetches from API with caching if not in cache (works with or without Kriit integration)
 * - Respects the selected study year from dropdown
 * - Auto-updates when study year changes
 * - Only counts past timetable lessons
 */

import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'

export default class LessonCountWarningFeature extends BaseFeature {
  constructor() {
    super('lessonCountWarning', /#\/journals/)
    this.name = 'LessonCountWarningFeature'
    this.processedJournals = new Set()
    this.studyYearObserver = null
    this.mainContentObserver = null
    this.currentStudyYear = null
    this.currentSchoolId = null
    this.currentTeacherId = null
    this._activateTimeout = null
    this._contentChangeTimeout = null
    this._studyYearChangeTimeout = null
    this._isProcessing = false
  }

  /**
   * Activate the feature on journal list pages
   */
  async onActivate() {
    if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Activating lesson count warning feature`)

    // Get current user info for teacher ID and school ID
    await this.getCurrentUserInfo()

    // Get current study year
    this.getCurrentStudyYear()

    // Set up study year observer
    this.setupStudyYearObserver()

    // Set up main content observer for DOM changes
    this.setupMainContentObserver()

    // Wait for the page to be ready, then process journals
    this._activateTimeout = setTimeout(() => {
      this._activateTimeout = null
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in delayed processJournalList:`, error)
      })
    }, 1000)
  }

  /**
   * Deactivate the feature
   */
  onDeactivate() {
    super.onDeactivate()

    if (this._activateTimeout) {
      clearTimeout(this._activateTimeout)
      this._activateTimeout = null
    }
    if (this._contentChangeTimeout) {
      clearTimeout(this._contentChangeTimeout)
      this._contentChangeTimeout = null
    }
    if (this._studyYearChangeTimeout) {
      clearTimeout(this._studyYearChangeTimeout)
      this._studyYearChangeTimeout = null
    }

    // Clean up study year observer
    if (this.studyYearObserver) {
      this.studyYearObserver.disconnect()
      this.studyYearObserver = null
    }

    // Clean up the main content observer
    if (this.mainContentObserver) {
      this.mainContentObserver.disconnect()
      this.mainContentObserver = null
    }

    // Remove all warning indicators
    this.removeAllWarningIndicators()

    // Reset state
    this.processedJournals.clear()
    this.currentStudyYear = null
    this.currentSchoolId = null
    this.currentTeacherId = null
    this._isProcessing = false
  }

  /**
   * Get current user info from the API
   */
  async getCurrentUserInfo() {
    try {
      const userInfo = await this.api.tahvel.get('/user', {}, { cache: true })
      this.currentSchoolId = userInfo.school?.id || 9
      this.currentTeacherId = userInfo.person?.id // Keep this as fallback
    } catch (error) {
      Logger.error(`[${this.name}] Error getting user info:`, error)
      this.currentSchoolId = 9 // Default school ID
    }
  }

  /**
   * Get all teachers in the school (same functionality as popup)
   */
  async getAllTeachers() {
    try {
      if (!this.currentSchoolId) {
        throw new Error('School ID pole saadaval')
      }

      // Get all active teachers in the school
      const teachersData = await this.api.tahvel.get(
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

      // Filter teachers by school and map to a simple object
      return teachersData.content
        .filter(teacher => teacher.school && teacher.school.id === this.currentSchoolId)
        .map(teacher => ({
          id: teacher.id,
          name: teacher.name
        }))
    } catch (error) {
      Logger.error(`[${this.name}] Error getting all teachers:`, error)
      return []
    }
  }

  /**
   * Get current study year from dropdown
   */
  getCurrentStudyYear() {
    try {
      const studyYearElement = document.querySelector('[ng-model="criteria.studyYear"] div.md-text span')
      if (studyYearElement) {
        this.currentStudyYear = studyYearElement.textContent.trim()
      } else {
        Logger.warning(`[${this.name}] Study year dropdown not found, using current year`)
        this.currentStudyYear = this.getDefaultStudyYear()
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error getting study year:`, error)
      this.currentStudyYear = this.getDefaultStudyYear()
    }

    return this.currentStudyYear
  }

  /**
   * Get default study year based on current date
   */
  getDefaultStudyYear() {
    const now = new Date()
    const currentYear = now.getFullYear()
    const isBeforeSeptember = now.getMonth() < 8 // September is month 8

    if (isBeforeSeptember) {
      return `${currentYear - 1}/${currentYear}`
    } else {
      return `${currentYear}/${currentYear + 1}`
    }
  }

  /**
   * Parse study year string to get date range
   */
  parseStudyYear(studyYearStr) {
    try {
      // Parse "2024/2025" format
      const match = studyYearStr.match(/(\d{4})\/(\d{4})/)
      if (match) {
        const startYear = parseInt(match[1])
        const endYear = parseInt(match[2])

        return {
          from: new Date(Date.UTC(startYear, 8, 1)).toISOString(), // September 1st
          thru: new Date(Date.UTC(endYear, 7, 31, 23, 59, 59, 999)).toISOString() // August 31st
        }
      } else {
        Logger.warning(`[${this.name}] Could not parse study year format: ${studyYearStr}`)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error parsing study year:`, error)
    }

    // Fallback to current study year
    const now = new Date()
    const currentYear = now.getFullYear()
    const studyYear = now.getMonth() < 8 ? currentYear - 1 : currentYear

    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(),
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    }
  }

  /**
   * Set up observer for study year changes
   */
  setupStudyYearObserver() {
    const studyYearElement = document.querySelector('[ng-model="criteria.studyYear"]')
    if (!studyYearElement) {
      Logger.warning(`[${this.name}] Study year dropdown not found for observer`)
      return
    }

    this.studyYearObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          const newStudyYear = this.getCurrentStudyYear()
          if (newStudyYear !== this.currentStudyYear) {
            if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Study year changed from ${this.currentStudyYear} to ${newStudyYear}`)
            this.currentStudyYear = newStudyYear
            this.onStudyYearChange()
          }
        }
      }
    })

    this.studyYearObserver.observe(studyYearElement, {
      childList: true,
      subtree: true,
      characterData: true
    })
  }

  /**
   * Set up observer for main content changes (journal list updates)
   */
  setupMainContentObserver() {
    const mainContentElement = document.querySelector('#tahvelTable')
    if (!mainContentElement) {
      Logger.warning(`[${this.name}] Main content element not found for observer`)
      return
    }

    let debounceTimer = null

    this.mainContentObserver = new MutationObserver(mutations => {
      // Check if any mutations affect the journal table
      const hasRelevantChanges = mutations.some(mutation => {
        // Check if table-related elements were added/removed
        if (mutation.type === 'childList') {
          const relevantNodes = [...mutation.addedNodes, ...mutation.removedNodes]
          return relevantNodes.some(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false
            // Check if it's table-related or contains table elements
            return (
              node.matches &&
              (node.matches('table, tbody, tr, .tahvel-table, .tahvel-table-wrapper') || (node.querySelector && node.querySelector('table, tbody, tr, .tahvel-table, .tahvel-table-wrapper')))
            )
          })
        }
        return false
      })

      if (hasRelevantChanges) {
        // Debounce to avoid too frequent processing
        if (debounceTimer) {
          clearTimeout(debounceTimer)
        }

        debounceTimer = setTimeout(() => {
          this.onMainContentChange()
        }, 300) // 300ms debounce
      }
    })

    this.mainContentObserver.observe(mainContentElement, {
      childList: true,
      subtree: true
    })
  }

  /**
   * Handle the main content change (journal list updated)
   */
  onMainContentChange() {
    if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Processing main content change`)
    this.processedJournals.clear()

    // Remove existing warning indicators
    this.removeAllWarningIndicators()

    // Update current study year in case it changed
    this.getCurrentStudyYear()

    // Reprocess all journals
    this._contentChangeTimeout = setTimeout(() => {
      this._contentChangeTimeout = null
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in onMainContentChange processJournalList:`, error)
      })
    }, 100)
  }

  /**
   * Handle study year change
   */
  onStudyYearChange() {
    if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Processing study year change`)
    this.processedJournals.clear()

    // Remove existing warning indicators
    this.removeAllWarningIndicators()

    // Reprocess all journals with new study year
    this._studyYearChangeTimeout = setTimeout(() => {
      this._studyYearChangeTimeout = null
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in onStudyYearChange processJournalList:`, error)
      })
    }, 500)
  }

  /**
   * Process all journals on the current page in parallel batches
   */
  async processJournalList() {
    if (this._isProcessing) return
    this._isProcessing = true
    try {
      const journalRows = this.findJournalRows()
      if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Found ${journalRows.length} journal rows`)

      if (journalRows.length === 0) return

      const BATCH_SIZE = 5
      for (let i = 0; i < journalRows.length; i += BATCH_SIZE) {
        const batch = journalRows.slice(i, i + BATCH_SIZE)
        await Promise.allSettled(batch.map(row => this.processJournalRow(row)))
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error processing journal list:`, error)
    } finally {
      this._isProcessing = false
    }
  }

  /**
   * Find all journal rows in the table
   */
  findJournalRows() {
    const rows = document.querySelectorAll('#tahvelTable table.tahvel-table tbody tr')

    if (rows.length === 0) {
      Logger.warning(`[${this.name}] No journal rows found`)
      return []
    }

    return Array.from(rows)
  }

  /**
   * Process a single journal row
   */
  async processJournalRow(row) {
    try {
      // Extract journal info from row
      const journalInfo = this.extractJournalInfoFromRow(row)
      if (!journalInfo) {
        return
      }

      // Skip if already processed
      if (this.processedJournals.has(journalInfo.id)) {
        return
      }

      // Get lesson count (from cache or API)
      const actualLessonCount = await this.getLessonCountFromCache(journalInfo.id)
      if (actualLessonCount === null) {
        // Failed to get data, skip this journal
        Logger.debug(`[${this.name}] Could not get lesson count for journal ${journalInfo.id}, skipping`)
        this.processedJournals.add(journalInfo.id)
        return
      }

      // If no teacher IDs found from table, try to map teacher names to IDs
      let teacherIds = journalInfo.teacherIds
      const teacherNames = journalInfo.teacherNames

      if (!teacherIds || teacherIds.length === 0) {
        if (teacherNames && teacherNames.length > 0) {
          teacherIds = await this.mapTeacherNamesToIds(teacherNames)
        }

        // If still no teacher IDs, use current teacher ID as fallback
        if (!teacherIds || teacherIds.length === 0) {
          if (this.currentTeacherId) {
            teacherIds = [this.currentTeacherId]
          } else {
            return
          }
        }
      }

      // Get timetable data for this journal
      const timetableLessons = await this.getTimetableLessons(journalInfo.id, teacherIds)

      // Count past timetable lessons
      const pastTimetableLessons = this.countPastLessons(timetableLessons)

      // Compare with actual lesson count from cache
      const hasDiscrepancy = pastTimetableLessons !== actualLessonCount

      // Add warning indicator if there's a discrepancy
      if (hasDiscrepancy) {
        this.addWarningIndicator(journalInfo.linkElement, {
          journalId: journalInfo.id,
          domCount: actualLessonCount,
          timetableCount: pastTimetableLessons
        })
      }

      // Mark as processed
      this.processedJournals.add(journalInfo.id)
    } catch (error) {
      Logger.error(`[${this.name}] Error processing journal row:`, error)
    }
  }

  /**
   * Get lesson count (only MAHT_a capacity hours - actual lessons)
   * Reads from cache if available, otherwise fetches from API
   */
  async getLessonCountFromCache(journalId) {
    try {
      // Construct base URL - detect which Tahvel environment we're on
      const currentHost = window.location.hostname
      let baseUrl = 'https://tahvel.edu.ee/hois_back'

      if (currentHost.includes('test.tahvel')) {
        baseUrl = 'https://test.tahvel.eenet.ee/hois_back'
      } else if (currentHost.includes('uustahvel')) {
        baseUrl = 'https://uustahvel.eenet.ee/hois_back'
      }

      // Construct full URL for journal details endpoint
      const endpoint = `/journals/${journalId}`
      const fullUrl = `${baseUrl}${endpoint}`

      // Cache key format matches ApiService: GET_<fullUrl>
      const cacheKey = `GET_${fullUrl}`

      // Try to read from cache first
      let cachedJournal = await cacheService.get(cacheKey)

      // If not in cache, fetch from API with caching enabled
      if (!cachedJournal) {
        Logger.debug(`[${this.name}] Journal ${journalId}: Not in cache, fetching from API`)
        cachedJournal = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: cacheService.EXPIRATION.MEDIUM })
      }

      if (!cachedJournal || !cachedJournal.lessonHours || !cachedJournal.lessonHours.capacityHours) {
        return null
      }

      // Get only MAHT_a (auditorium/class lessons), exclude MAHT_i (independent work)
      const mahtA = cachedJournal.lessonHours.capacityHours.find(h => h.capacity === 'MAHT_a')

      if (!mahtA) {
        // If no MAHT_a found, use totalUsedHours as fallback
        Logger.debug(`[${this.name}] Journal ${journalId}: No MAHT_a found, using totalUsedHours`)
        return cachedJournal.lessonHours.totalUsedHours || 0
      }

      const lessonCount = mahtA.usedHours || 0

      Logger.debug(`[${this.name}] Journal ${journalId}: ${lessonCount} lessons (MAHT_a)`)

      return lessonCount
    } catch (error) {
      Logger.error(`[${this.name}] Error getting lesson count:`, error)
      return null
    }
  }

  /**
   * Map teacher names to IDs using the API
   */
  async mapTeacherNamesToIds(teacherNames) {
    if (!teacherNames || teacherNames.length === 0) {
      return []
    }

    try {
      // Get all teachers from the API
      const teachers = await this.getAllTeachers()
      if (!teachers || teachers.length === 0) {
        Logger.warning(`[${this.name}] No teachers found in API`)
        return []
      }

      const mappedIds = []

      // For each teacher name, find matching teacher ID
      for (const name of teacherNames) {
        const normalizedName = name.toLowerCase().trim()

        // Look for exact match first
        let matchedTeacher = teachers.find(teacher => teacher.name && teacher.name.toLowerCase().trim() === normalizedName)

        if (!matchedTeacher) {
          // If no exact match, try partial matches
          matchedTeacher = teachers.find(
            teacher => teacher.name && (teacher.name.toLowerCase().includes(normalizedName) || normalizedName.includes(teacher.name.toLowerCase()))
          )
        }

        if (matchedTeacher) {
          mappedIds.push(matchedTeacher.id)
        }
      }

      return mappedIds
    } catch (error) {
      Logger.error(`[${this.name}] Error mapping teacher names to IDs:`, error)
      return []
    }
  }

  /**
   * Extract journal information from table row
   */
  extractJournalInfoFromRow(row) {
    try {
      // Get journal link (2nd column)
      const linkElement = row.querySelector('td:nth-child(2) a.linked-name')
      if (!linkElement) {
        return null
      }

      // Extract journal ID from link
      const href = linkElement.getAttribute('href') || linkElement.getAttribute('ng-href') || ''
      const match = href.match(/\/journal\/(\d+)/)
      if (!match) {
        return null
      }

      const journalId = parseInt(match[1])

      // Try to find teacher info in different columns
      const teacherIds = []
      const teacherNames = []

      // Check all table cells for teacher links first
      const allCells = row.querySelectorAll('td')

      for (let i = 0; i < allCells.length; i++) {
        const cell = allCells[i]

        // Look for teacher links in this cell
        const teacherSelectors = ['a[href*="/teacher/"]', 'a[ng-href*="/teacher/"]', 'a[href*="#/teacher/"]', 'a[ng-href*="#/teacher/"]']

        for (const selector of teacherSelectors) {
          const teacherLinks = cell.querySelectorAll(selector)
          if (teacherLinks.length > 0) {
            teacherLinks.forEach(link => {
              const teacherHref = link.getAttribute('href') || link.getAttribute('ng-href') || ''
              const teacherMatch = teacherHref.match(/\/teacher\/(\d+)/)
              if (teacherMatch) {
                const teacherId = parseInt(teacherMatch[1])
                const teacherName = link.textContent.trim()

                // Avoid duplicates
                if (!teacherIds.includes(teacherId)) {
                  teacherIds.push(teacherId)
                  teacherNames.push(teacherName)
                }
              }
            })
            break // Found the links in this cell, no need to try other selectors
          }
        }
      }

      // If no teacher links found, try to extract teacher names from the 3rd column text
      if (teacherIds.length === 0) {
        const teacherCell = row.querySelector('td:nth-child(3)')
        if (teacherCell) {
          const teacherText = teacherCell.textContent.trim()

          if (teacherText) {
            // Split by common separators (comma, semicolon, "ja", "and")
            const namesSeparated = teacherText
              .split(/[,;]|\s+ja\s+|\s+and\s+/i)
              .map(name => name.trim())
              .filter(name => name.length > 0)

            // Store the names for later ID lookup
            teacherNames.push(...namesSeparated)
          }
        }
      }

      return {
        id: journalId,
        linkElement: linkElement,
        teacherIds: teacherIds,
        teacherNames: teacherNames
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error extracting journal info from row:`, error)
      return null
    }
  }

  /**
   * Get timetable lessons for a journal
   */
  async getTimetableLessons(journalId, teacherIds) {
    try {
      if (!this.currentSchoolId) {
        Logger.warning(`[${this.name}] Missing school ID`)
        return []
      }

      if (!teacherIds || teacherIds.length === 0) {
        Logger.warning(`[${this.name}] No teacher IDs provided for journal ${journalId}`)
        return []
      }

      // Get study year date range
      const { from, thru } = this.parseStudyYear(this.currentStudyYear)

      // Build teacher IDs parameter
      const teacherIdsParam = teacherIds.join(',')

      // Build timetable API endpoint
      const endpoint = `/timetableevents/timetableByTeacher/${this.currentSchoolId}?from=${from}&lang=ET&teachers=${teacherIdsParam}&thru=${thru}`

      // Fetch timetable data
      const data = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: cacheService.EXPIRATION.VERY_LONG })

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
   * Add warning indicator to journal link
   */
  addWarningIndicator(linkElement, discrepancy) {
    try {
      // Check if indicator already exists
      const existingIndicator = linkElement.parentElement.querySelector('.oa-warning-indicator')
      if (existingIndicator) {
        return
      }

      // Create warning indicator - pink pill with calendar icon
      const indicator = document.createElement('span')
      indicator.className = 'oa-warning-indicator'
      indicator.style.cssText = `
        display: inline;
        background-color: #ff69b4;
        color: white;
        border-radius: 15px;
        padding: 2px 6px;
        margin-left: 6px;
        font-size: 12px;
        font-weight: normal;
        cursor: help;
        vertical-align: middle;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        white-space: nowrap;
      `
      indicator.textContent = '📅'

      // Calculate the difference for tooltip
      const difference = discrepancy.domCount - discrepancy.timetableCount
      if (difference > 0) {
        if (difference === 1) {
          indicator.title = `Päevikus on ${difference} liigne tund`
        } else {
          indicator.title = `Päevikus on ${difference} liigset tundi`
        }
      } else {
        const absDifference = Math.abs(difference)
        if (absDifference === 1) {
          indicator.title = `Päevikus puudub ${absDifference} tund`
        } else {
          indicator.title = `Päevikus puudub ${absDifference} tundi`
        }
      }

      // Create wrapper to keep link and indicator on same line
      const wrapper = document.createElement('span')
      wrapper.style.cssText = `
        display: inline;
        white-space: nowrap;
      `

      // Move link into wrapper
      const parentCell = linkElement.parentElement
      parentCell.insertBefore(wrapper, linkElement)
      wrapper.appendChild(linkElement)

      // Add indicator to wrapper
      wrapper.appendChild(indicator)

      if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Successfully added warning indicator for journal ${discrepancy.journalId}`)
    } catch (error) {
      Logger.error(`[${this.name}] Error adding warning indicator:`, error)
    }
  }

  /**
   * Remove all warning indicators
   */
  removeAllWarningIndicators() {
    try {
      const indicators = document.querySelectorAll('.oa-warning-indicator')
      indicators.forEach(indicator => {
        // Remove the whole wrapper if it exists
        const wrapper = indicator.parentElement
        if (wrapper && wrapper.children.length === 2) {
          // If the wrapper has exactly 2 children (link + indicator), move the link back to the parent
          const link = wrapper.querySelector('a')
          if (link) {
            const parentCell = wrapper.parentElement
            parentCell.insertBefore(link, wrapper)
          }
          wrapper.remove()
        } else {
          // "Just" might sound dismissive or oversimplify what readers consider a complex task
          // Remove the indicator
          indicator.remove()
        }
      })
    } catch (error) {
      Logger.error(`[${this.name}] Error removing warning indicators:`, error)
    }
  }
}
