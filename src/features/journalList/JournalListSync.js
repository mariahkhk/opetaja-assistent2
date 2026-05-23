/**
 * Journal List Sync Feature
 *
 * Syncs data between Tahvel and Kriit:
 * - Assignments and their grades (SISSEKANNE_H, SISSEKANNE_I)
 * - Curriculum outcomes and their grades (SISSEKANNE_O)
 * - Students and their personal codes
 * - Student statuses (active/inactive)
 *
 * Displays a banner on journal list page showing differences that need to be synced
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { styleService } from '../../services/StyleService.js'
import { cacheService } from '../../services/CacheService.js'
import { ApiService } from '../../services/ApiService.js'
import { buildDiffSummary } from '../../lib/kriitSyncCheck.js'
import { setupKriitMessageListener } from '../../services/MessageListenerService.js'
import { bannerService } from '../../services/BannerService.js'
import { differenceRenderer, journalSyncBannerService } from './JournalSyncBanner.js'

import { sendOutcomeEntriesToKriit } from './OutComes.js'
import { notifyKriitGradesSynced, buildGradesForNotification } from './KriitSyncNotifier.js'
import { getSchoolId } from '../../lib/schoolId.js'
import { resolveLessonPlanDate, resolveStudyYearIdFromText } from '../../lib/studyYear.js'

class JournalListSyncFeature extends BaseFeature {
  /**
   * Resolve a journal link element and extract journal ID from it.
   * Accepts anchor elements, elements inside anchors (like span.linked-name),
   * or elements with data attributes containing the ID.
   * @param {Element} el - Element matched by selector
   * @returns {Object|null} { href, id } or null if not resolvable
   */
  // Alias kept for legacy underscore-prefixed callers in test/main convention.
  _resolveJournalFromElement(el) { return this.resolveJournalFromElement(el) }

  resolveJournalFromElement(el) {
    if (!el) return null
    // If it's an anchor
    if (el.tagName && el.tagName.toLowerCase() === 'a') {
      const href = el.getAttribute('href') || el.getAttribute('ng-href') || ''
      const idMatch = String(href).match(/\/journal\/(\d+)/)
      if (idMatch && idMatch[1]) return { href, id: parseInt(idMatch[1], 10) }
      // fallback: href may contain query param like /#/journal/123
      const anchorMatch = String(href).match(/#\/?journal\/(\d+)/)
      if (anchorMatch && anchorMatch[1]) return { href, id: parseInt(anchorMatch[1], 10) }
      return { href, id: null }
    }

    // If it's inside an anchor (like span.linked-name), walk up to find anchor
    let parent = el
    while (parent && parent !== document.body) {
      if (parent.tagName && parent.tagName.toLowerCase() === 'a') {
        return this.resolveJournalFromElement(parent)
      }
      parent = parent.parentNode
    }

    // If element has data attributes with an id
    if (el.dataset && el.dataset.journalId) {
      return { href: null, id: parseInt(el.dataset.journalId, 10) }
    }

    // Additional heuristics: check for router/link attributes on the element itself
    const routerAttrs = ['ng-reflect-router-link', 'routerlink', 'ng-href', 'data-href', 'href', 'onclick']
    for (const attr of routerAttrs) {
      try {
        const val = el.getAttribute && el.getAttribute(attr)
        if (val) {
          // Try to extract journal id from the attribute value
          const m = String(val).match(/#?\/?(?:#\/)?(?:journal\/)?(\d{3,7})/)
          if (m && m[1]) {
            Logger.debug(`Resolved journal id from attribute '${attr}': ${m[1]}`)
            return { href: val, id: parseInt(m[1], 10) }
          }
        }
      } catch (err) {
        // ignore
      }
    }

    // If this element is inside a table row, try to find an anchor in the same row
    try {
      const tr = el.closest ? el.closest('tr') : null
      if (tr) {
        const anchors = tr.querySelectorAll && tr.querySelectorAll('a')
        if (anchors && anchors.length > 0) {
          for (const a of anchors) {
            const resolved = this.resolveJournalFromElement(a)
            if (resolved && resolved.id) return resolved
          }
        }
      }
    } catch (err) {
      // ignore
    }

    // As a last resort, inspect sibling anchors inside same parent
    try {
      const parentEl = el.parentNode
      if (parentEl && parentEl.querySelectorAll) {
        const anchors = parentEl.querySelectorAll('a')
        for (const a of anchors) {
          const resolved = this.resolveJournalFromElement(a)
          if (resolved && resolved.id) return resolved
        }
      }
    } catch (err) {
      // ignore
    }

    // Final fallback: scan element.outerHTML for journal id patterns
    try {
      const outer = el && el.outerHTML ? String(el.outerHTML) : ''
      if (outer) {
        const m1 = outer.match(/journal\/(\d{3,7})/)
        if (m1 && m1[1]) {
          Logger.debug(`Resolved journal id from outerHTML pattern journal/ID: ${m1[1]}`)
          return { href: null, id: parseInt(m1[1], 10) }
        }
        const m2 = outer.match(/#\/?journal\/(\d{3,7})/)
        if (m2 && m2[1]) {
          Logger.debug(`Resolved journal id from outerHTML pattern #/journal/ID: ${m2[1]}`)
          return { href: null, id: parseInt(m2[1], 10) }
        }
        const m3 =
          outer.match(/journalId\W*[:=]\W*"?(\d{3,7})"?/) ||
          outer.match(/data[-_]journal[-_]id\W*[:=]\W*"?(\d{3,7})"?/) ||
          outer.match(/data[-_]id\W*[:=]\W*"?(\d{3,7})"?/)
        if (m3 && m3[1]) {
          Logger.debug(`Resolved journal id from outerHTML generic id pattern: ${m3[1]}`)
          return { href: null, id: parseInt(m3[1], 10) }
        }
      }
    } catch (err) {
      // ignore
    }

    return null
  }
  /**
   * Extract assignment entry date differences from Kriit response
   */
  extractEntryDateDifferences() {
    Logger.debug('✨ [extractEntryDateDifferences] Called')
    const entryDateDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      return entryDateDiffs
    }

    this.differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (assignment.assignmentEntryDate && typeof assignment.assignmentEntryDate === 'object') {
          const kriitEntryDate = assignment.assignmentEntryDate.kriit
          const tahvelEntryDate = assignment.assignmentEntryDate.Tahvel
          if (kriitEntryDate !== tahvelEntryDate && !(kriitEntryDate == null && tahvelEntryDate == null)) {
            let assignmentName = assignment.assignmentName
            if (assignmentName && typeof assignmentName === 'object') {
              assignmentName = assignmentName.kriit || assignmentName.Tahvel || ''
            }
            entryDateDiffs.push({
              assignmentExternalId: assignment.assignmentExternalId,
              assignmentName,
              kriit: kriitEntryDate,
              Tahvel: tahvelEntryDate,
              subjectName: subjectDiff.subjectName || '',
              subjectExternalId: subjectDiff.subjectExternalId || ''
            })
          }
        }
      })
    })

    return entryDateDiffs
  }
  /**
   * Extract assignment name differences from Kriit response
   */
  extractAssignmentNameDifferences() {
    Logger.debug('✨ [extractAssignmentNameDifferences] Called')
    const groupedDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      Logger.debug('✨ [extractAssignmentNameDifferences] No differences array found.')
      return groupedDiffs
    }
    this.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        const nameDiffs = subject.assignments
          .filter(a => {
            if (a.assignmentName && typeof a.assignmentName === 'object') {
              // Only show difference if both are present and different
              return a.assignmentName.kriit && a.assignmentName.Tahvel && a.assignmentName.kriit !== a.assignmentName.Tahvel
            }
            return false
          })
          .map(a => ({
            kriit: a.assignmentName.kriit,
            Tahvel: a.assignmentName.Tahvel,
            assignmentExternalId: a.assignmentExternalId
          }))
        if (nameDiffs.length > 0) {
          groupedDiffs.push({
            subjectName: subject.subjectName,
            subjectExternalId: subject.subjectExternalId,
            nameDiffs
          })
        }
      }
    })
    Logger.debug(`✨ [extractAssignmentNameDifferences] Total subjects with differences: ${groupedDiffs.length}`)
    return groupedDiffs
  }

  extractDueDateDifferences() {
    const dueDateDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      return dueDateDiffs
    }
    this.differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (assignment.assignmentDueAt && typeof assignment.assignmentDueAt === 'object') {
          const kriitDue = assignment.assignmentDueAt.kriit
          const tahvelDue = assignment.assignmentDueAt.Tahvel
          if (kriitDue !== tahvelDue && !(kriitDue == null && tahvelDue == null)) {
            let assignmentName = assignment.assignmentName
            if (assignmentName && typeof assignmentName === 'object') {
              assignmentName = assignmentName.kriit || assignmentName.Tahvel || ''
            }
            dueDateDiffs.push({
              assignmentExternalId: assignment.assignmentExternalId,
              assignmentName,
              kriit: kriitDue,
              Tahvel: tahvelDue,
              subjectName: subjectDiff.subjectName || '',
              subjectExternalId: subjectDiff.subjectExternalId || ''
            })
          }
        }
      })
    })
    return dueDateDiffs
  }

  /**
   * Extract assignment hours differences from Kriit response
   */
  extractAssignmentHoursDifferences() {
    const hoursDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      return hoursDiffs
    }
    this.differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (typeof assignment.assignmentHours !== 'undefined' && assignment.assignmentHours !== null) {
          let assignmentName = assignment.assignmentName
          if (assignmentName && typeof assignmentName === 'object') {
            assignmentName = assignmentName.kriit || assignmentName.Tahvel || ''
          }
          hoursDiffs.push({
            assignmentExternalId: assignment.assignmentExternalId,
            assignmentName,
            kriitHours: assignment.assignmentHours,
            subjectName: subjectDiff.subjectName || '',
            subjectExternalId: subjectDiff.subjectExternalId || ''
          })
        }
      })
    })
    return hoursDiffs
  }

  /**
   * Extract entry type differences from Kriit response
   */
  extractEntryTypeDifferences() {
    Logger.debug('✨ [extractEntryTypeDifferences] Called')
    const entryTypeDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      Logger.debug('✨ [extractEntryTypeDifferences] No differences array found')
      return entryTypeDiffs
    }
    Logger.debug(`✨ [extractEntryTypeDifferences] Processing ${this.differences.length} subjects`)
    this.differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (assignment.entryType && typeof assignment.entryType === 'object') {
          const kriitType = assignment.entryType.kriit
          const tahvelType = assignment.entryType.Tahvel
          Logger.debug(
            `✨ [extractEntryTypeDifferences] Assignment ${assignment.assignmentExternalId}: kriit="${kriitType}", tahvel="${tahvelType}"`
          )
          if (kriitType !== tahvelType && !(kriitType == null && tahvelType == null)) {
            let assignmentName = assignment.assignmentName
            if (assignmentName && typeof assignmentName === 'object') {
              assignmentName = assignmentName.kriit || assignmentName.Tahvel || ''
            }
            const diff = {
              assignmentExternalId: assignment.assignmentExternalId,
              assignmentName,
              kriit: kriitType,
              Tahvel: tahvelType,
              subjectName: subjectDiff.subjectName || '',
              subjectExternalId: subjectDiff.subjectExternalId || ''
            }
            entryTypeDiffs.push(diff)
            Logger.debug(`✨ [extractEntryTypeDifferences] Added diff:`, JSON.stringify(diff))
          }
        } else if (Logger.isDebugMode()) {
          Logger.debug(
            `✨ [extractEntryTypeDifferences] Assignment ${assignment.assignmentExternalId}: entryType is not an object (${typeof assignment.entryType})`
          )
        }
      })
    })
    Logger.debug(`✨ [extractEntryTypeDifferences] Total entry type differences: ${entryTypeDiffs.length}`)
    return entryTypeDiffs
  }

  /**
   * Send only outcome entries (SISSEKANNE_O) to Kriit API
   */
  async sendOutcomeEntriesToKriit(accessibleJournalIds) {
    if (!this.api || !this.api.kriit || !this.api.kriit.authToken) {
      Logger.error('No Kriit API token set')
      return
    }
    if (!this.journalLinks || this.journalLinks.length === 0) {
      Logger.debug('No journal links available for outcome sync')
      return
    }
    Logger.debug('Triggering outcome sync (outcome entries only)')
    await sendOutcomeEntriesToKriit(this.api, this.journalLinks, accessibleJournalIds)
  }
  constructor() {
    // Define selectors for journal links - using the most reliable selector first
    const journalLinkSelectors = [
      // Primary selector that works reliably in older layout
      '#main-content md-table-container td:nth-child(2) > a',

      // Fallback selectors in case the primary one doesn't work
      '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a',
      '#main-content a[ng-href^="/#/journal/"][ng-if="row.canEdit"]',
      'a[href^="/#/journal/"]',

      // Newer layout variations: look for links with data-test or contain '/journal/' in href
      'a[data-test*="journal"]',
      'a[href*="/journal/"]',
      // New Tahvel markup: journal name may be inside a span.linked-name inside a clickable cell
      'span.linked-name',
      // Clickable row/element attributes used by Angular/JS frameworks
      '[ng-reflect-router-link*="/journal/"]',
      '[routerlink*="/journal/"]',
      '[data-href*="/journal/"]',
      '[onclick*="/journal/"]',
      '[data-journal-id]',
      '[role="link"]',
      '[tabindex][onclick]',
      '#main-content a',
      'md-table-container a'
    ]

    // Match the journal list page URL pattern and pass required selectors
    // Accept modern variants like '#/journals' and '#/journals?...'
    super('journalListSync', /#\/journals/, journalLinkSelectors)

    // Initialize state
    this.differences = null
    this.isLoading = false
    this.error = null
    this.journalLinks = null
    this.isActive = false

    // Global teacher cache to avoid redundant API calls across journals
    this.globalTeacherCache = {}

    // Mapping from journalStudentId to studentId for API cache lookups
    this.journalStudentIdToStudentId = {}

    // Study year selector state
    this.tableObserver = null
    this.lastStudyYear = null

    // Set up message listener for settings changes using global service
    setupKriitMessageListener(this)
  }

  /**
   * Called when the feature is activated
   * @param {NodeList} elements - The found elements (journal links)
   */
  async onActivate(elements) {
    // Only activate on journals page (accept variants like 'journals?…')
    const url = window.location.hash.replace(/^#\/?/, '').split('&')[0]
    if (!url.startsWith('journals')) {
      Logger.debug('JournalListSync not activated: URL does not match journals')
      return
    }

    // Log a specific message for this feature's activation
    Logger.debug(`[${this.name}] Journal List Sync feature initialized`)

    if (Logger.isDebugMode()) Logger.debug('[DEBUG] onActivate: elements', elements)

    // Wait for Kriit API settings to be loaded from chrome.storage before checking.
    // initializeKriitApi() runs in the constructor but uses an async callback,
    // so this.api.kriit.enabled may not be set yet when onActivate fires.
    try {
      await (this.api._kriitInitPromise || Promise.resolve())

      if (!this.isActive) return

      // First check if Kriit support is enabled
      if (!this.api.kriit.enabled) {
        Logger.debug('Kriit support is disabled - JournalListSync feature will not be activated')
        return
      }

      // Then check if we have a Kriit API token
      if (this.api.kriit.authToken) {
        Logger.debug('Using Kriit API token')

        // If we have journal links from the observer, store them
        if (elements && elements.length > 0) {
          this.journalLinks = elements
          if (Logger.isDebugMode()) Logger.debug('[DEBUG] onActivate: journalLinks set', this.journalLinks)

          // Wait for preferred banner container before showing any UI
          if (!document.querySelector('.tahvel-form-buttons')) {
            await bannerService.waitForBannerContainer(5000).catch(() => {
              Logger.debug('[JournalListSync] Banner container wait timeout, proceeding anyway')
            })
          }

          this.fetchJournalData()
        } else {
          // This case should not happen anymore with the fixed observer
          Logger.warning('No journal links found during activation, but observer reported success')
          this.isLoading = false
          this.error = 'No journal links found on the page. Please refresh and try again.'
          this.updateUI()
        }
      } else {
        // No token available - feature will be disabled
        Logger.debug('No Kriit API token found - JournalListSync feature will be disabled')
        this.showMissingApiKeyBanner()
      }

    } catch (err) {
      Logger.error('[JournalListSync] Initialization failed:', err)
    }

    // Set up study year selector monitoring (doesn't depend on Kriit)
    this.setupStudyYearMonitoring()
  }

  /**
   * Get currently selected study year from the dropdown
   * @returns {string|null} Selected study year text (e.g., "2025/2026") or null if not found
   */
  getSelectedStudyYear() {
    const studyYearSelector = document.querySelector('.selected-option.ng-tns-c929221873-0')
    if (studyYearSelector) {
      const yearText = studyYearSelector.textContent.trim()
      Logger.debug('Selected study year from dropdown:', yearText)
      return yearText
    }
    Logger.debug('Study year selector not found in DOM')
    return null
  }

  /**
   * Convert study year text (e.g., "2025/2026") to study year ID by querying the API
   * @param {string} yearText - Study year text from dropdown
   * @returns {Promise<number|null>} Study year ID or null if not found
   */
  async getStudyYearIdFromText(yearText) {
    if (!yearText) return null

    try {
      const yearId = await resolveStudyYearIdFromText(this.api, yearText)
      if (yearId) {
        Logger.debug(`Resolved study year "${yearText}" to ID: ${yearId}`)
        return yearId
      }
    } catch (err) {
      Logger.warning('Failed to resolve study year ID from text:', err.message)
    }

    return null
  }

  /**
   * Set up monitoring for study year selector changes and submit button clicks
   */
  setupStudyYearMonitoring() {
    // Store initial study year
    this.lastStudyYear = this.getSelectedStudyYear()
    Logger.debug('Initial study year:', this.lastStudyYear)

    // Find submit button
    const submitButton = document.querySelector('button[type="submit"]')
    if (!submitButton) {
      Logger.debug('Submit button not found for study year monitoring')
      return
    }

    // Add click listener to submit button
    submitButton.addEventListener('click', () => {
      Logger.debug('Submit button clicked - monitoring for table changes')
      this.waitForTableUpdate()
        .then(() => {
          Logger.debug('Table updated - refreshing journal sync data')
          this.fetchJournalData()
        })
        .catch(err => {
          Logger.warning('Error waiting for table update:', err)
          // Fallback: refresh after a delay
          setTimeout(() => this.fetchJournalData(), 2000)
        })
    })

    Logger.debug('Study year monitoring set up successfully')
  }

  /**
   * Wait for the journal table to update after study year change
   * @returns {Promise} Resolves when table has updated
   */
  waitForTableUpdate() {
    return new Promise((resolve, _reject) => {
      let timeout
      const timeoutDuration = 10000 // 10 seconds max wait

      // Try multiple selectors for the table container
      const findTableContainer = () => {
        const selectors = [
          'md-table-container',
          '#main-content md-table-container',
          'md-table-container table',
          '#main-content table',
          '[role="table"]',
          'table tbody'
        ]

        for (const selector of selectors) {
          const element = document.querySelector(selector)
          if (element) {
            Logger.debug(`Found table container with selector: ${selector}`)
            return element
          }
        }
        return null
      }

      // Initial attempt to find table container
      let tableContainer = findTableContainer()

      if (!tableContainer) {
        // Table might not be rendered yet - wait a bit and try again
        Logger.debug('Table container not found immediately, waiting 500ms...')
        setTimeout(() => {
          tableContainer = findTableContainer()

          if (!tableContainer) {
            Logger.warning('Table container not found after delay - using fallback timeout')
            // Don't reject - just use timeout fallback
            timeout = setTimeout(() => {
              Logger.debug('Fallback timeout - proceeding with refresh')
              resolve()
            }, 2000)
            return
          }

          setupObserver(tableContainer)
        }, 500)
        return
      }

      // Setup observer function
      const setupObserver = container => {
        // Disconnect any existing observer
        if (this.tableObserver) {
          this.tableObserver.disconnect()
        }

        // Create mutation observer to detect table changes
        this.tableObserver = new MutationObserver(mutations => {
          // Check if table content has changed (rows added/removed/modified)
          const hasTableChanges = mutations.some(
            mutation =>
              mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0 || mutation.type === 'characterData' || mutation.type === 'attributes'
          )

          if (hasTableChanges) {
            Logger.debug('Table content changed - mutations detected')
            clearTimeout(timeout)
            if (this.tableObserver) {
              this.tableObserver.disconnect()
            }
            // Add small delay to ensure table is fully rendered
            setTimeout(() => resolve(), 500)
          }
        })

        // Start observing table changes
        this.tableObserver.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true
        })

        // Set timeout as fallback
        timeout = setTimeout(() => {
          Logger.debug('Table update timeout - proceeding anyway')
          if (this.tableObserver) {
            this.tableObserver.disconnect()
          }
          resolve()
        }, timeoutDuration)
      }

      // If we found the container immediately, setup observer
      setupObserver(tableContainer)
    })
  }

  /**
   * Called when the feature is deactivated
   */
  onDeactivate() {
    this.isActive = false
    // Call parent method to clean up observers
    super.onDeactivate()

    // Clean up table observer
    if (this.tableObserver) {
      this.tableObserver.disconnect()
      this.tableObserver = null
    }

    // Clean up UI elements
    bannerService.removeBanner()
    styleService.removeCSS('journal-list-sync-styles')

    // Reset state
    this.resetJournalLinks()
  }

  /**
   * Reset journal links cache
   * This ensures we don't reuse links from a previous page
   */
  resetJournalLinks() {
    Logger.debug('Resetting journal links cache')
    this.journalLinks = null
  }

  /**
   * Called when required elements (journal links) are found
   * Note: DOM elements are only used to detect when we're on the journals page.
   * All journal data is fetched via the Tahvel API for reliability.
   * @param {NodeList} elements - The found elements
   * @param {string} selector - The selector that matched
   */
  onRequiredElementsFound(elements, selector) {
    Logger.debug(`Found ${elements.length} journal links with selector: ${selector}`)
    Logger.debug('Note: DOM elements are used for activation only, journal data will be fetched via API')
    this.journalLinks = elements

    // Log the first 3 links for debugging
    Array.from(elements)
      .slice(0, 3)
      .forEach((el, i) => {
        const href = el.getAttribute('href') || el.getAttribute('ng-href') || ''
        const text = el.textContent.trim()
        Logger.debug(`Link ${i + 1}: href=${href}, text=${text}`)
      })
  }

  /**
   * Called when required elements (journal links) are not found
   * @param {Error} error - The error that occurred
   */
  onRequiredElementsNotFound(error) {
    Logger.warning(`Could not find journal links: ${error.message}`)
    this.isLoading = false
    this.error = 'No journal links found on the page. Please make sure you are on the journal list page.'
    this.updateUI()
  }

  /**
   * Fetch journal data from Tahvel and check for differences with Kriit
   */
  async fetchJournalData() {
    try {
      if (Logger.isDebugMode()) Logger.debug('[DEBUG] fetchJournalData called')
      this.isLoading = true
      this.updateUI()

      // Always fetch the journal list from Tahvel REST API (most reliable method)
      const apiJournalList = await this.fetchJournalsFromApi()
      if (Logger.isDebugMode()) Logger.debug(`Fetched ${apiJournalList ? apiJournalList.length : 0} journals from Tahvel API`)

      if (!apiJournalList || apiJournalList.length === 0) {
        Logger.warning('No journals returned from API')
        this.isLoading = false
        this.differences = []
        this.error = 'Could not fetch journal list from Tahvel API'
        this.updateUI()
        return
      }

      Logger.debug('Using API-provided journal list for data collection')
      // Map API items into a minimal structure for collectJournalData
      const mapped = apiJournalList.map(item => ({
        __apiJournal: true,
        id: item.id,
        nameEt: item.nameEt || item.name || item.nameEt,
        studentCount: item.studentCount || 0,
        canEdit: item.canEdit
      }))

      // Collect data using API-provided journal ids
      const journalData = await this.collectJournalData(mapped)

      // Validate data before sending
      if (!journalData || !Array.isArray(journalData) || journalData.length === 0) {
        Logger.warning('No journal data to send to Kriit')
        this.isLoading = false
        this.differences = []
        this.updateUI()
        return
      }

      // Send data to Kriit immediately
      this.isLoading = true
      this.error = null
      this.differences = []
      await this.proceedWithKriitApiCall(journalData)

      // Automatically sync outcome entries (SISSEKANNE_O) to Kriit
      // Pass accessible journal IDs so OutComes only fetches journals we can access
      const accessibleJournalIds = new Set(journalData.map(j => j.subjectExternalId).filter(Boolean))
      await this.sendOutcomeEntriesToKriit(accessibleJournalIds)
    } catch (error) {
      Logger.error('Error fetching journal data:', error)
      this.isLoading = false

      // Provide more specific error messages based on the error
      if (!this.journalLinks || this.journalLinks.length === 0) {
        this.error = 'No journal links found on the page. Please make sure you are on the journal list page.'
      } else if (error.message && error.message.includes('404')) {
        this.error = 'API endpoint not found (404). Please check if you are on the correct page.'
      } else if (error.message && error.message.includes('403')) {
        this.error = 'Authentication error (403). Please check your Kriit API token.'
      } else if (error.message && error.message.includes('undefined')) {
        this.error = 'Data processing error: ' + error.message + '. This may be due to missing student group data.'
      } else {
        this.error = error.message || 'Failed to fetch data'
      }

      Logger.debug('Setting error message:', this.error)

      // Reset differences to empty array
      this.differences = []

      this.updateUI()
    }
  }

  /**
   * Collect journal data from Tahvel
   * @returns {Promise<Array>} Array of journal data objects
   */
  async collectJournalData() {
    try {
      Logger.debug('Collecting journal data from Tahvel')
      Logger.debug('Using Tahvel API base URL:', this.api.tahvel.baseUrl)

      if (!this.journalLinks || this.journalLinks.length === 0) {
        Logger.warning('No journal links available for data collection')
        return []
      }

      Logger.debug(`Using ${this.journalLinks.length} journal links for data collection`)
      // Support passing in an API-provided list of journals as argument
      const usingApiList = Array.isArray(arguments[0]) && arguments[0].length > 0
      const apiList = usingApiList ? arguments[0] : null

      const journalPromises = (apiList ? apiList : Array.from(this.journalLinks)).map(async link => {
        // If this is an API-provided item, it has minimal shape: { __apiJournal: true, id, nameEt }
        let resolved = null
        let id = null
        let href = ''
        let name = ''

        if (link && link.__apiJournal) {
          id = link.id
          name = link.nameEt || link.name || ''
          // leave href empty – we'll fetch full journal info below
        } else {
          // Resolve href/id from anchor or a child element (e.g. span.linked-name)
          resolved = this.resolveJournalFromElement(link)
          id = resolved && resolved.id ? resolved.id : null
          href = resolved && resolved.href ? resolved.href : link.getAttribute ? link.getAttribute('href') || link.getAttribute('ng-href') || '' : ''
          name = (link.textContent || link.innerText || '').trim()
        }

        if (!id) {
          // Try to parse from href fallback
          const idMatch = String(href).match(/\/journal\/([0-9]+)/)
          if (idMatch && idMatch[1]) {
            id = parseInt(idMatch[1], 10)
          } else {
            const parts = String(href).split('/')
            if (parts.length >= 4) {
              const maybe = parseInt(parts[3], 10)
              if (!isNaN(maybe)) id = maybe
            }
          }
        }

        if (!id) {
          const snippet = link && link.outerHTML ? link.outerHTML.replace(/\s+/g, ' ').slice(0, 300) : String(link)
          Logger.warning(`Could not extract journal ID from element or href: ${href} / element snippet: ${snippet}`)
          return null
        }

        try {
          const [journalInfo, journalEntries, journalEntriesWithGrades, journalStudents] = await Promise.all([
            this.getJournalInfo(id),
            this.getJournalEntries(id),
            this.getJournalEntriesWithGrades(id),
            this.getJournalStudents(id)
          ])

          if (!journalInfo) {
            Logger.warning(`Could not get info for journal ${id}`)
            return null
          }
          if (!Array.isArray(journalEntries)) {
            Logger.warning(`Could not get entries for journal ${id}`)
            return null
          }
          if (!Array.isArray(journalStudents)) {
            return null
          }

          if (journalInfo.studentGroups) {
            Logger.debug(`Journal ${id} student groups:`, JSON.stringify(journalInfo.studentGroups))
          }

          const studentDetailsMap = await this.processStudentData(id, journalStudents)
          const studentMap = this.createStudentMap(journalStudents, studentDetailsMap)

          // Merge homeworkDuedate and other missing fields from journalEntries into journalEntriesWithGrades
          let mergedEntries
          if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0 && journalEntries && journalEntries.length > 0) {
            // Create a map of /journalEntry entries by id
            const entryById = {}
            journalEntries.forEach(e => {
              if (e && e.id) entryById[e.id] = e
            })
            // For each entry in journalEntriesWithGrades, copy homeworkDuedate if present in /journalEntry
            mergedEntries = journalEntriesWithGrades.map(e => {
              if (e && e.id && entryById[e.id]) {
                // Only copy homeworkDuedate if not present or is undefined/null
                if (!e.homeworkDuedate && entryById[e.id].homeworkDuedate) {
                  return { ...e, homeworkDuedate: entryById[e.id].homeworkDuedate }
                }
              }
              return e
            })
          } else if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0) {
            mergedEntries = journalEntriesWithGrades
          } else {
            mergedEntries = journalEntries
          }
          const assignments = this.extractAssignmentsFromEntries(mergedEntries, studentMap, journalStudents, studentDetailsMap, journalEntriesWithGrades)

          // Get comprehensive lesson dates (first, next, last)
          let firstLessonDate = null
          let firstLessonDateIsApproximate = false
          let nextLessonDate = null
          let lastLessonDate = null
          let lastLessonDateIsApproximate = false
          try {
            const lessonDates = await this.getLessonDates(id, journalInfo)
            firstLessonDate = lessonDates.firstLessonDate
            firstLessonDateIsApproximate = lessonDates.firstLessonDateIsApproximate
            nextLessonDate = lessonDates.nextLessonDate
            lastLessonDate = lessonDates.lastLessonDate
            lastLessonDateIsApproximate = lessonDates.lastLessonDateIsApproximate
          } catch (error) {
            Logger.warning(`Could not get lesson dates for journal ${id}:`, error)
          }

          // Extract capacity hours for MAHT_i (independent work) and MAHT_p (practical work)
          let capacityHours = []
          try {
            if (journalInfo.lessonHours && Array.isArray(journalInfo.lessonHours.capacityHours)) {
              // Extract MAHT_i and MAHT_p capacities
              const relevantCapacities = journalInfo.lessonHours.capacityHours.filter(
                c => c.capacity === 'MAHT_i' || c.capacity === 'MAHT_p'
              )

              capacityHours = relevantCapacities.map(c => ({
                capacity: c.capacity,
                plannedHours: c.plannedHours,
                usedHours: c.usedHours
              }))
            }
          } catch (error) {
            Logger.warning(`Could not extract capacity hours for journal ${id}:`, error)
          }

          // Keep plannedHours for backward compatibility (MAHT_i only)
          let plannedHours = null
          const mahtICapacity = capacityHours.find(c => c.capacity === 'MAHT_i')
          if (mahtICapacity) {
            plannedHours = mahtICapacity.plannedHours
          }

          // Try to fetch journal theme content (if any) so it can be sent to Kriit
          let journalTheme = null
          try {
            // Prefer curriculumVersions -> top-level themes -> journalThemes.
            // Many Tahvel responses include the canonical theme under curriculumVersions[0].themes
            // while journalThemes may contain a different (derived) id. Prefer the curriculum one.
            let themeId = null
            try {
              if (
                journalInfo &&
                Array.isArray(journalInfo.curriculumVersions) &&
                journalInfo.curriculumVersions[0] &&
                Array.isArray(journalInfo.curriculumVersions[0].themes) &&
                journalInfo.curriculumVersions[0].themes[0] &&
                journalInfo.curriculumVersions[0].themes[0].id
              ) {
                themeId = journalInfo.curriculumVersions[0].themes[0].id
              } else if (journalInfo && Array.isArray(journalInfo.themes) && journalInfo.themes[0] && journalInfo.themes[0].id) {
                themeId = journalInfo.themes[0].id
              } else if (journalInfo && Array.isArray(journalInfo.journalThemes) && journalInfo.journalThemes[0] && journalInfo.journalThemes[0].id) {
                themeId = journalInfo.journalThemes[0].id
              }
            } catch (err) {
              themeId = null
            }

            if (themeId) {
              // Endpoint: /journals/{journalId}/theme/{themeId}
              try {
                const themeEndpoint = `/journals/${id}/theme/${themeId}`
                // Cache themes for 2 weeks since they rarely change
                const cacheKey = `theme_${id}_${themeId}`
                const themeContent = await cacheService.getOrFetch(
                  cacheKey,
                  async() => await this.api.tahvel.get(themeEndpoint),
                  cacheService.EXPIRATION.TWO_WEEKS
                )
                journalTheme = { id: themeId, content: themeContent }
              } catch (err) {
                Logger.debug(`Could not fetch theme ${themeId} for journal ${id}: ${err.message}`)
                journalTheme = { id: themeId, content: null }
              }
            }
          } catch (err) {
            Logger.debug(`Error while trying to resolve journal theme for ${id}: ${err.message}`)
            journalTheme = null
          }

          const teachers = []

          if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
            for (const teacher of journalInfo.journalTeachers) {
              const teacherName = teacher.nameEt || teacher.fullname || ''

              if (teacherName) {
                try {
                  const teacherId = teacher.id
                  if (!teacherId) {
                    Logger.warning(`No teacher ID available for teacher ${teacherName}`)
                    teachers.push({ name: teacherName, personalCode: '' })
                  } else {
                    const teacherData = await getTeacherPersonalCodeCached(this.api, teacher)
                    teachers.push({
                      name: teacherName,
                      personalCode: teacherData.personalCode
                    })

                    this.globalTeacherCache[teacherId] = teacherData
                  }
                } catch (error) {
                  Logger.warning(`Failed to get teacher personal code: ${error.message}`)
                  teachers.push({ name: teacherName, personalCode: '' })
                }
              }
            }
          }

          // Handle multigroup journals by creating separate entries for each group
          const studentGroups = []
          if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
            studentGroups.push(...journalInfo.studentGroups)
          } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
            studentGroups.push(journalStudents[0].studentGroup)
          }

          // If no groups found, create a single entry with empty group name
          if (studentGroups.length === 0) {
            return {
              subjectName: journalInfo.nameEt || name,
              subjectExternalId: id,
              groupName: '',
              teachers,
              assignments,
              firstLessonDate,
              firstLessonDateIsApproximate,
              nextLessonDate,
              lastLessonDate,
              plannedHours,
              capacityHours,
              journalTheme
            }
          }

          // For multigroup journals, create separate entries for each group
          const groupJournalEntries = []

          // Debug logging for multigroup journals
          if (studentGroups.length > 1) {
            if (assignments.length > 0) {
              Logger.debug(`First assignment "${assignments[0].assignmentName}" has ${assignments[0].results.length} students`)
            }
          }

          for (const groupName of studentGroups) {
            // Filter assignments to include only students from this group
            const filteredAssignments = assignments
              .map(assignment => {
                const filteredResults = assignment.results.filter(result => {
                  // Find the student in journalStudents to get their group
                  const student = journalStudents.find(js => {
                    const studentId = studentMap.journalStudentIdToId[js.id.toString()]
                    const personalCode = studentMap.idToPersonalCode[studentId]
                    // No-op block removed (was empty)
                    return personalCode === result.studentPersonalCode
                  })
                  // Include student if they belong to this group
                  // No-op block removed (was empty)
                  return student && student.studentGroup === groupName
                })
                return {
                  ...assignment,
                  results: filteredResults
                }
              })
              .filter(assignment => assignment.results.length > 0) // Only include assignments with students

            groupJournalEntries.push({
              subjectName: journalInfo.nameEt || name,
              subjectExternalId: id,
              groupName,
              teachers,
              assignments: filteredAssignments,
              firstLessonDate,
              firstLessonDateIsApproximate,
              nextLessonDate,
              lastLessonDate,
              lastLessonDateIsApproximate,
              plannedHours,
              capacityHours,
              journalTheme
            })
          }

          return groupJournalEntries
        } catch (error) {
          Logger.error(`Failed to process journal ${id}:`, error)
          return null
        }
      })
      const results = await Promise.all(journalPromises)
      // Pre-flight summary: how many journal IDs were resolved vs failed
      try {
        const resolvedCount = results.filter(r => r !== null).length
        const failed = results.filter(r => r === null)
        Logger.debug(`Pre-flight: Resolved ${resolvedCount}/${results.length} journal entries (failed: ${failed.length})`)
        if (failed.length > 0 && Logger.isDebugMode()) {
          const samples = Array.from(this.journalLinks)
            .map(el => (el.outerHTML ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 200) : String(el)))
            .slice(0, 5)
          Logger.debug('Sample observed elements (first 5):', samples)
        }
      } catch (err) {
        // ignore logging errors
      }
      // Flatten the results as some journals may return arrays of group entries
      const journalData = results.filter(r => r !== null).flatMap(result => (Array.isArray(result) ? result : [result]))

      Logger.debug(`Collected data for ${journalData.length} journals`)
      return journalData
    } catch (error) {
      Logger.error('Error collecting journal data:', error)
      throw error
    }
  }

  /**
   * Process student data with caching
   * @param {number} journalId - Journal ID
   * @param {Array} journalStudents - Journal students
   * @returns {Promise<Object>} Student details map
   */
  async processStudentData(journalId, journalStudents) {
    const studentDetailsMap = {}

    // Process each journal student to get their personal code
    if (journalStudents && Array.isArray(journalStudents)) {
      // Initialize pending requests tracker if not exists
      if (!this.pendingStudentRequests) {
        this.pendingStudentRequests = new Map()
      }

      // Create an array to hold all promises
      const studentPromises = journalStudents.map(async journalStudent => {
        if (!journalStudent || !journalStudent.studentId) return null

        // Check if we already have this student in the API cache
        try {
          const studentDetails = await this.getStudentDetails(journalStudent.studentId)
          if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
            const isActive = studentDetails.status === 'OPPURSTAATUS_O'
            const isDeleted = studentDetails.status === 'OPPURSTAATUS_K'
            const isGraduated = studentDetails.status === 'OPPURSTAATUS_L'

            const cachedStudent = {
              personalCode: studentDetails.person.idcode,
              name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`,
              isActive: isActive,
              isDeleted: isDeleted,
              isGraduated: isGraduated
            }

            // Store the mapping for later lookups
            this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId

            return {
              studentId: journalStudent.studentId,
              data: cachedStudent
            }
          }
        } catch (error) {
          // If not in cache or error, continue to fetch it below
          Logger.debug(`Student ${journalStudent.studentId} not in API cache, will fetch`)
        }

        // Check if there's already a pending request for this student
        if (this.pendingStudentRequests.has(journalStudent.studentId)) {
          Logger.debug(`Student ${journalStudent.studentId} request already in progress - waiting for result`)
          try {
            const data = await this.pendingStudentRequests.get(journalStudent.studentId)
            return { studentId: journalStudent.studentId, data }
          } catch (error) {
            Logger.error(`Error waiting for pending student request ${journalStudent.studentId}:`, error)
            return { studentId: journalStudent.studentId, data: null }
          }
        }

        // Two cache tiers for student details:
        //   - status (isActive/isDeleted/isGraduated): no PII, persisted on disk encrypted
        //   - pii (personalCode/name): memory-only
        // ApiService's pendingRequests dedupe means the inner /students/<id>
        // call still fires only once across both fetchFns.
        const statusKey = `student_${journalStudent.studentId}_status`
        const piiKey = `student_${journalStudent.studentId}_pii`
        const ONE_DAY = 24 * 60 * 60 * 1000

        const fetchStatus = async() => {
          const details = await this.getStudentDetails(journalStudent.studentId)
          if (!details || !details.status) return null
          return {
            isActive: details.status === 'OPPURSTAATUS_O',
            isDeleted: details.status === 'OPPURSTAATUS_K',
            isGraduated: details.status === 'OPPURSTAATUS_L'
          }
        }

        const fetchPii = async() => {
          const details = await this.getStudentDetails(journalStudent.studentId)
          if (!details || !details.person || !details.person.idcode) return null
          return {
            personalCode: details.person.idcode,
            name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`
          }
        }

        // Create the fetch promise and store it in pending requests
        const fetchPromise = (async() => {
          try {
            const [status, pii] = await Promise.all([
              cacheService.getOrFetch(statusKey, fetchStatus, ONE_DAY, true, true),
              cacheService.getOrFetch(piiKey, fetchPii, ONE_DAY, true, false)
            ])
            const studentData = (status && pii) ? { ...pii, ...status } : null

            if (studentData) {
              // Store the mapping from journalStudentId to studentId for API cache lookups
              this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId
              Logger.debug(
                `✓ Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${studentData.personalCode} - ${studentData.name})`
              )
            }

            return studentData
          } catch (error) {
            Logger.error(`Error getting cached data for student ${journalStudent.studentId}:`, error)
            return null
          } finally {
            // Clean up the pending request
            this.pendingStudentRequests.delete(journalStudent.studentId)
          }
        })()

        // Store the promise in pending requests
        this.pendingStudentRequests.set(journalStudent.studentId, fetchPromise)

        // Wait for the result
        try {
          const studentData = await fetchPromise
          return { studentId: journalStudent.studentId, data: studentData }
        } catch (error) {
          Logger.error(`Error processing student ${journalStudent.studentId}:`, error)
          return { studentId: journalStudent.studentId, data: null }
        }
      })

      // Process all students in parallel
      const results = await Promise.all(studentPromises)

      // Process results and add to studentDetailsMap
      for (const result of results) {
        if (result && result.data) {
          studentDetailsMap[result.studentId] = result.data
        }
      }
    }

    return studentDetailsMap
  }

  /**
   * Update the UI based on current state
   */
  updateUI() {
    if (!this.isActive) return
    // Don't remove banner if we're currently syncing (loading state)
    if (!this.isLoading) {
      bannerService.removeBanner()
    }

    if (this.isLoading) {
      // If banner doesn't exist yet, create it; otherwise just update the content
      if (!bannerService.hasBanner()) {
        bannerService.showLoadingBanner()
      }
      return
    }

    if (this.error) {
      this.showErrorBanner()
      return
    }

    // Decide whether to show the differences banner.
    // Show when we have differences OR when Kriit reported newAssignments in the global runtime cache.
    const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
    const hasNewAssignments = Object.keys(globalNewAssignments || {}).length > 0

    if ((this.differences && this.differences.length > 0) || hasNewAssignments) {
      this.showDifferencesBanner()
      return
    }

    // If there are no differences and no new assignments, show the all-in-sync banner
    this.showAllInSyncBanner()
  }

  /**
   * Update progress UI during sync
   * @param {number} current - Current progress
   * @param {number} total - Total items
   */
  updateProgressUI(current, total) {
    if (!this.isActive) return
    // Show progress banner during sync
    bannerService.updateProgressUI(current, total, 'Sünkroniseerin hindeid Kriidist Tahvlisse...')
  }

  /**
   * Show success banner
   * @param {string} message - Success message
   */
  showSuccessBanner(message) {
    if (!this.isActive) return
    // Show success banner with refresh and close actions
    bannerService.showSuccessBanner(message, {
      onRefresh: () => this.proceedWithKriitApiCall(),
      onClose: () => bannerService.removeBanner()
    })
  }

  /**
   * Show error banner
   */
  showErrorBanner() {
    const options = {
      onRetry: () => this.proceedWithKriitApiCall(),
      onClearCache: () => {
        this.clearCache().then(result => {
          alert(
            `Puhastatud ${result.total} vahemälu kirjet:\n` +
              `- API vahemälu: ${result.api} kirjet\n` +
              `- Funktsiooni vahemälu: ${result.feature} kirjet\n` +
              `- Mälu vahemälu: ${result.runtime} kirjet\n\n` +
              'Klõpsake "Proovi uuesti" värske andmete saamiseks.'
          )
        })
      },
      onSettings: () => this.resetKriitApiToken(),
      onRefresh: () => window.location.reload()
    }

    journalSyncBannerService.showSyncErrorBanner(this.error, options)
  }

  /**
   * Show a banner when the Kriit API key is missing
   */
  showMissingApiKeyBanner() {
    journalSyncBannerService.showMissingApiKeyBanner()
  }

  /**
   * Show green banner when all grades are in sync
   */
  showAllInSyncBanner() {
    journalSyncBannerService.showAllInSyncBanner(
      async() => {
        // When refresh button is clicked, trigger Tahvel search and wait for table update
        Logger.debug('Värskenda button clicked - triggering Tahvel search for current study year')
        try {
          const submitButton = document.querySelector('button[type="submit"]')
          if (submitButton) {
            submitButton.click()
            await this.waitForTableUpdate()
          } else {
            Logger.warning('Submit button not found, refreshing without triggering search')
          }
          await this.clearCache()
        } catch (err) {
          Logger.warning('Failed to trigger search or clear cache:', err.message)
        }
        await this.fetchJournalData()
      },
      () => bannerService.removeBanner()
    )
  }

  /**
   * Show differences banner
   */
  showDifferencesBanner() {
    const totalDifferences = this.countTotalDifferences()

    // Print each detected grade difference with details only in debug mode
    if (Logger.isDebugMode() && Array.isArray(this.differences)) {
      this.differences.forEach(subject => {
        if (subject && Array.isArray(subject.assignments)) {
          subject.assignments.forEach(assignment => {
            if (assignment && Array.isArray(assignment.results)) {
              assignment.results.forEach(result => {
                const tahvelGrade = result.currentGrade || '(puudub)'
                const kriitGrade = result.grade || '(puudub)'
                // Log when there is a difference (treat kriit null as a valid value)
                if (tahvelGrade !== kriitGrade) {
                  Logger.debug(
                    `[GRADE DIFF] Subject: ${subject.subjectName}, Assignment: ${assignment.assignmentName}, Student: ${result.studentName || '(nimi puudub)'}, Tahvel: ${tahvelGrade}, Kriit: ${kriitGrade}`
                  )
                }
              })
            }
          })
        }
      })
    }
    // Include newAssignments in the total shown in the banner
    const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
    const newAssignmentsCount = Object.values(globalNewAssignments || {}).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
    const totalForBanner = totalDifferences + newAssignmentsCount

    journalSyncBannerService.showDifferencesBanner(
      totalForBanner,
      async() => {
        // First, sync new assignments to Tahvel if any exist
        const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
        if (Object.keys(globalNewAssignments).length > 0) {
          Logger.debug('Syncing new assignments to Tahvel before grade sync')
          try {
            // Import and trigger the TahvelNewAssignmentSync feature
            const { tahvelNewAssignmentSync } = await import('./TahvelNewAssignmentSync.js')
            await tahvelNewAssignmentSync.syncNewAssignmentsToTahvel(globalNewAssignments)
          } catch (err) {
            Logger.error('Failed to sync new assignments to Tahvel:', err)
          }
        }

        // Run the batched sync, including assignment-level metadata changes.
        const syncResult = await this.syncWithKriit()
        const failedSyncs = syncResult?.failedSyncs || []
        const successfulCount = syncResult?.successfulChangeCount ?? syncResult?.successfulSyncs?.length ?? 0
        if (failedSyncs.length > 0) {
          this.isLoading = false
          this.error = this.buildSyncFailureMessage(failedSyncs, successfulCount)
          this.updateUI()
          return
        }
        if (this.error && !this.error.includes('Kõik hinded on juba sünkroonis')) return
      },
      async() => {
        // Trigger Tahvel search and wait for table update before refreshing
        Logger.debug('Refresh button clicked - triggering Tahvel search for current study year')
        try {
          const submitButton = document.querySelector('button[type="submit"]')
          if (submitButton) {
            submitButton.click()
            await this.waitForTableUpdate()
          } else {
            Logger.warning('Submit button not found, refreshing without triggering search')
          }
          await this.clearCache()
        } catch (err) {
          Logger.warning('Failed to trigger search or clear cache:', err.message)
        }
        await this.fetchJournalData()
      },
      container => {
        const assignmentNameDiffs = this.extractAssignmentNameDifferences()
        const gradeDiffs = Array.isArray(this.differences) ? this.differences : []
        const dueDateDiffs = this.extractDueDateDifferences()
        const entryDateDiffs = this.extractEntryDateDifferences()
        const assignmentHoursDiffs = this.extractAssignmentHoursDifferences()
        const entryTypeDiffs = this.extractEntryTypeDifferences()
        const newAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
        differenceRenderer.render(
          container,
          assignmentNameDiffs,
          gradeDiffs,
          dueDateDiffs,
          entryDateDiffs,
          assignmentHoursDiffs,
          entryTypeDiffs,
          newAssignments
        )
      }
    )
  }

  /**
   * Remove sync banner from the DOM (used by message listener through context)
   */
  // noinspection JSUnusedGlobalSymbols
  removeSyncBanner() {
    bannerService.removeBanner()
  }

  /**
   * Set Kriit API token and save to chrome.storage
   * @param {string} token - API token
   */
  setKriitApiToken(token) {
    if (!token) {
      Logger.error('Invalid token provided')
      return
    }

    // Save token to chrome.storage.local
    chrome.storage.local.set({ OA_kriitApiToken: token }, () => {
      // Update API service
      this.api.kriit.setAuthToken(token)

      Logger.debug('Kriit API token updated')

      // Refresh data
      this.fetchJournalData()
    })
  }

  /**
   * Reset Kriit API token and prompt for a new one
   */
  resetKriitApiToken() {
    // Remove current token
    chrome.storage.local.remove(['OA_kriitApiToken'], () => {
      // Prompt user for a new token
      const newToken = prompt('Please enter your Kriit API token:', '')

      if (newToken) {
        // Set the new token
        this.setKriitApiToken(newToken)
        Logger.debug('New Kriit API token set')
      } else {
        // User cancelled or provided empty token
        this.error = 'No token provided. Please set a valid Kriit API token.'
        this.updateUI()
      }
    })
  }

  /**
   * Clear all cache data
   * @returns {Promise<Object>} Number of cache entries cleared
   */
  async clearCache() {
    // Clear the teacher runtime cache
    const teacherRuntimeCacheSize = Object.keys(this.globalTeacherCache).length

    this.globalTeacherCache = {}

    // Clear the module-level teacher cache too
    const moduleTeacherCacheSize = Object.keys(globalModuleTeacherCache).length
    Object.keys(globalModuleTeacherCache).forEach(key => {
      delete globalModuleTeacherCache[key]
    })

    // Clear pending teacher requests
    pendingTeacherRequests.clear()

    // Clear all caches using the CacheService
    const cacheCount = await cacheService.clearCache()

    const totalCleared = teacherRuntimeCacheSize + moduleTeacherCacheSize + cacheCount

    Logger.debug(`Cleared ${totalCleared} total cache entries:`)
    Logger.debug(`- Cache service: ${cacheCount} entries`)
    Logger.debug(`- Teacher runtime cache: ${teacherRuntimeCacheSize} entries`)
    Logger.debug(`- Module teacher cache: ${moduleTeacherCacheSize} entries`)

    return {
      total: totalCleared,
      api: cacheCount,
      feature: 0, // No longer separately tracked as we use CacheService for everything
      runtime: teacherRuntimeCacheSize + moduleTeacherCacheSize,
      students: 0, // Students now handled by CacheService
      teachers: teacherRuntimeCacheSize + moduleTeacherCacheSize
    }
  }

  /**
   * Proceed with the actual Kriit API call
   * @param {Array} [providedJournalData] - Optional journal data to use instead of collecting fresh data
   */
  async proceedWithKriitApiCall(providedJournalData = null) {
    try {
      this.isLoading = true
      this.updateUI()

      // Use provided data or fetch fresh data from API
      let journalData = providedJournalData

      if (!journalData) {
        const apiJournalList = await this.fetchJournalsFromApi()
        if (apiJournalList && apiJournalList.length > 0) {
          const mapped = apiJournalList.map(item => ({
            __apiJournal: true,
            id: item.id,
            nameEt: item.nameEt || item.name || item.nameEt,
            studentCount: item.studentCount || 0,
            canEdit: item.canEdit
          }))
          journalData = await this.collectJournalData(mapped)
        }
      }

      // Check if we have valid data
      if (!journalData || !Array.isArray(journalData) || journalData.length === 0) {
        Logger.error('No valid journal data to send to Kriit')
        this.error = 'No valid journal data to send to Kriit'
        this.isLoading = false
        this.updateUI()
        return
      }

      // Check if we have a Kriit API token
      if (!this.api.kriit.authToken) {
        Logger.error('No Kriit API token set')
        this.error = 'No Kriit API token set. Please set a token in the extension settings.'
        this.isLoading = false
        this.updateUI()
        return
      }

      // Fetch inactive students to send to Kriit
      Logger.debug('🔍 Fetching inactive students for Kriit')
      let inactiveStudentsArray = []
      try {
        const inactiveStudentsCache = await this.getInactiveStudentsCache()

        Logger.debug(`📦 Cache structure: ${JSON.stringify({
          hasCache: !!inactiveStudentsCache,
          hasByPersonalCode: !!(inactiveStudentsCache && inactiveStudentsCache.byPersonalCode),
          personalCodeCount: inactiveStudentsCache && inactiveStudentsCache.byPersonalCode
            ? Object.keys(inactiveStudentsCache.byPersonalCode).length
            : 0
        })}`)

        // Convert the cache to an array format suitable for Kriit
        if (inactiveStudentsCache && inactiveStudentsCache.byPersonalCode) {
          for (const personalCode in inactiveStudentsCache.byPersonalCode) {
            const student = inactiveStudentsCache.byPersonalCode[personalCode]
            inactiveStudentsArray.push({
              personalCode: student.personalCode,
              name: student.name,
              status: student.status
            })
          }
        }

        Logger.debug(`✅ Including ${inactiveStudentsArray.length} inactive students in payload for Kriit`)
      } catch (error) {
        Logger.warning(`❌ Failed to fetch inactive students: ${error.message}`)
        Logger.error(error)
        inactiveStudentsArray = []
      }

      // Store Tahvel data for banner to access current lesson values
      if (!window.journalListSync) window.journalListSync = {}
      window.journalListSync.tahvelData = journalData

      try {
        // Prepare payload with both journals and inactive students
        const payload = {
          journals: journalData,
          inactiveStudents: inactiveStudentsArray
        }

        // Log the request data
        Logger.debug('Sending request to Kriit API:', JSON.stringify(payload))

        // Compute a stable hash of the payload and skip calling Kriit if unchanged since last successful call
        const payloadHash = await computePayloadHash(payload)
        try {
          const ONE_DAY = 24 * 60 * 60 * 1000
          const lastHash = await cacheService.get('journalList_lastPayloadHash', ONE_DAY)
          if (lastHash && lastHash === payloadHash) {
            // Payload unchanged - log but DO NOT skip the Kriit API call
            Logger.debug('Journal data payload unchanged since last check - will still call Kriit to get fresh differences')
          }
        } catch (err) {
          Logger.warning('Failed to compare payload hash:', err.message)
        }

        // Make the actual API call
        const response = await this.api.kriit.post('/subjects/getDifferences', payload)
        // Ensure runtime container exists
        if (!window.journalListSync) window.journalListSync = {}

        // Log the full response for debugging
        Logger.debug('Raw response from Kriit:', JSON.stringify(response))

        // Normalize possible response shapes from Kriit
        let respDifferences = null
        // 1) Response is an array of differences
        if (response && Array.isArray(response)) {
          respDifferences = response
          Logger.debug('Response is an array with', response.length, 'items')
        }

        // 2) Response has a top-level data array (legacy)
        else if (response && response.data && Array.isArray(response.data)) {
          respDifferences = response.data
          Logger.debug('Response has a data array with', response.data.length, 'items')
        }

        // 3) Response has data object with a differences array
        else if (response && response.data && Array.isArray(response.data.differences)) {
          respDifferences = response.data.differences
          Logger.debug('Response has data.differences with', response.data.differences.length, 'items')
        }

        // 4) Response contains differences directly under response.differences
        else if (response && Array.isArray(response.differences)) {
          respDifferences = response.differences
          Logger.debug('Response has differences property with', response.differences.length, 'items')
        }

        // Assign normalized differences (empty array when none)
        this.differences = Array.isArray(respDifferences) ? respDifferences : []

        // Ensure runtime cache object exists
        if (!window.journalListSync) window.journalListSync = {}

        // Populate subjectsCache from collected journalData so UI renderers can lookup subject names
        try {
          window.journalListSync.subjectsCache = window.journalListSync.subjectsCache || {}
          if (Array.isArray(journalData)) {
            journalData.forEach(j => {
              try {
                const id = j.subjectExternalId || j.subjectExternalId === 0 ? String(j.subjectExternalId) : null
                if (id) {
                  window.journalListSync.subjectsCache[id] = j.subjectName || window.journalListSync.subjectsCache[id] || `Päevik ${id}`
                }
              } catch (err) {
                // ignore per-item failures
              }
            })
          }
        } catch (err) {
          Logger.debug('Failed to populate subjectsCache:', err)
        }

        // Normalize newAssignments (can be under response.data.newAssignments or response.newAssignments)
        const respNewAssignments = (response && response.data && response.data.newAssignments) || (response && response.newAssignments) || {}
        if (respNewAssignments && Object.keys(respNewAssignments).length > 0) {
          window.journalListSync.newAssignments = respNewAssignments
          Logger.debug('Stored newAssignments in runtime cache for banner:', JSON.stringify(Object.keys(respNewAssignments)))
        } else if (window.journalListSync.newAssignments && Object.keys(window.journalListSync.newAssignments).length === 0) {
          // Leave existing cache alone if already populated; if completely empty, ensure it's an object
          window.journalListSync.newAssignments = window.journalListSync.newAssignments || {}
        }

        // Always update global differences after setting this.differences
        window.journalListSync.differences = this.differences

        // If there are no differences and there are new assignments, show banner for new assignments
        if (
          (!this.differences || this.differences.length === 0) &&
          window.journalListSync.newAssignments &&
          Object.keys(window.journalListSync.newAssignments).length > 0
        ) {
          this.error = null
          this.isLoading = false
          this.updateUI()
          return
        }

        // If no differences and no new assignments, show 'all synced' message
        if (
          (!this.differences || this.differences.length === 0) &&
          (!window.journalListSync.newAssignments || Object.keys(window.journalListSync.newAssignments).length === 0)
        ) {
          this.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
          this.isLoading = false
          this.updateUI()
          return
        }

        // The payload hash is just a checksum (no PII) — safe to persist so we
        // can detect "same payload" across reloads. The differences and new
        // assignments are aggregated student-level diffs (high PII) and stay
        // in memory only. A counts-only summary is persisted so the header
        // sync button can render its "pending syncs" state on page load.
        try {
          const newAssignmentsForCache = window.journalListSync.newAssignments || {}
          await cacheService.set('journalList_lastPayloadHash', payloadHash)
          await cacheService.set('journalList_lastDifferences', this.differences, 0, false)
          await cacheService.set('journalList_lastNewAssignments', newAssignmentsForCache, 0, false)
          await cacheService.set('journalList_diffSummary', buildDiffSummary(this.differences, newAssignmentsForCache), 0, true)
        } catch (err) {
          Logger.warning('Failed to update journal list cache:', err.message)
        }
      } catch (error) {
        Logger.error('Error calling Kriit API:', error)

        // Pass error.message through unchanged — JournalSyncBanner maps
        // HTTP status / network errors to friendly Estonian text and never
        // exposes "[REDACTED-PII]" or English boilerplate to the user.
        this.error = error.message || 'Kriidiga suhtlemisel tekkis viga.'
        this.isLoading = false
        this.updateUI()
        return
      }
      this.isLoading = false
      this.error = null

      // Map subject IDs to names from our collected data and enhance the differences with additional data
      if (Array.isArray(this.differences) && Array.isArray(journalData)) {
        this.differences.forEach(diff => {
          // Find matching subject in our data
          const matchingSubject = journalData.find(s => s.subjectExternalId === diff.subjectExternalId)
          if (matchingSubject) {
            // Add subject name from our data
            diff.subjectName = matchingSubject.subjectName
            diff.groupName = matchingSubject.groupName

            // Process each assignment
            if (diff.assignments && Array.isArray(diff.assignments)) {
              diff.assignments.forEach(diffAssignment => {
                // Find matching assignment in our data
                const matchingAssignment = matchingSubject.assignments.find(a => a.assignmentExternalId === diffAssignment.assignmentExternalId)

                if (matchingAssignment) {
                  const kriitAssignment = diffAssignment
                  const tahvelAssignment = matchingAssignment

                  const normalizeDate = val => {
                    if (!val) return null
                    if (typeof val === 'string' && val.length >= 10) return val.slice(0, 10)
                    return val
                  }

                  const compareAndCreateDiff = fieldName => {
                    let kriitValue = kriitAssignment[fieldName]
                    let tahvelValue = tahvelAssignment[fieldName]

                    // For date fields, normalize to YYYY-MM-DD
                    if (fieldName === 'assignmentEntryDate' || fieldName === 'assignmentDueAt') {
                      kriitValue = normalizeDate(kriitValue)
                      tahvelValue = normalizeDate(tahvelValue)
                    }

                    // Normalize undefined to null for comparison
                    const normKriit = kriitValue === undefined ? null : kriitValue
                    const normTahvel = tahvelValue === undefined ? null : tahvelValue

                    // Only show a difference if Kriit has a value and it's different from Tahvel's
                    if (normKriit !== null && normKriit !== normTahvel) {
                      diffAssignment[fieldName] = { kriit: kriitValue, Tahvel: tahvelValue }
                    } else {
                      // If they are the same or Kriit is null, just use Tahvel's value.
                      diffAssignment[fieldName] = tahvelValue
                    }
                  }

                  compareAndCreateDiff('assignmentName')
                  compareAndCreateDiff('assignmentDueAt')
                  compareAndCreateDiff('assignmentEntryDate')

                  // Handle entry type - Kriit might send it as assignmentEntryType
                  if (kriitAssignment.assignmentEntryType) {
                    const kriitType = kriitAssignment.assignmentEntryType
                    const tahvelType = tahvelAssignment.entryType
                    if (Logger.isDebugMode()) {
                      Logger.debug(
                        `[Entry Type] Assignment ${diffAssignment.assignmentExternalId}: Kriit="${kriitType}", Tahvel="${tahvelType}"`
                      )
                    }
                    if (kriitType && kriitType !== tahvelType) {
                      diffAssignment.entryType = { kriit: kriitType, Tahvel: tahvelType }
                      Logger.debug(`[Entry Type] DIFFERENCE DETECTED: Assignment ${diffAssignment.assignmentExternalId}`)
                    } else {
                      diffAssignment.entryType = tahvelType
                      if (Logger.isDebugMode()) {
                        Logger.debug(`[Entry Type] No difference: Assignment ${diffAssignment.assignmentExternalId}`)
                      }
                    }
                  } else if (Logger.isDebugMode()) {
                    Logger.debug(
                      `[Entry Type] No assignmentEntryType from Kriit for assignment ${diffAssignment.assignmentExternalId}`
                    )
                  }

                  // Process each result
                  if (diffAssignment.results && Array.isArray(diffAssignment.results)) {
                    diffAssignment.results.forEach(diffResult => {
                      // Find matching student in our data using robust comparisons
                      const targetCode = diffResult.studentPersonalCode ? String(diffResult.studentPersonalCode).trim() : ''

                      let matchingResult = null

                      if (targetCode) {
                        // Exact match after normalization
                        matchingResult = matchingAssignment.results.find(r => {
                          const rc = r.studentPersonalCode ? String(r.studentPersonalCode).trim() : ''
                          return rc === targetCode
                        })

                        // Fallback: match by last 8 digits (handles formatting differences)
                        if (!matchingResult) {
                          const targetLast8 = targetCode.slice(-8)
                          matchingResult = matchingAssignment.results.find(r => {
                            const rc = r.studentPersonalCode ? String(r.studentPersonalCode).trim() : ''
                            return rc.slice(-8) === targetLast8 && rc.length >= 8
                          })
                        }
                      }

                      // Fallback: try matching by student name (case-insensitive, substring)
                      if (!matchingResult && diffResult.studentName) {
                        const targetName = String(diffResult.studentName).toLowerCase()
                        matchingResult = matchingAssignment.results.find(r => {
                          const rn = r.studentName ? String(r.studentName).toLowerCase() : ''
                          return rn && (rn === targetName || rn.includes(targetName) || targetName.includes(rn))
                        })
                      }

                      if (matchingResult) {
                        // Add student name and active status from our data
                        diffResult.studentName = matchingResult.studentName
                        diffResult.studentIsActive = matchingResult.studentIsActive
                        diffResult.studentIsDeleted = matchingResult.studentIsDeleted
                        diffResult.studentIsGraduated = matchingResult.studentIsGraduated

                        // Add the Tahvel grade as currentGrade for UI display
                        diffResult.currentGrade = matchingResult.grade
                      } else {
                        if (Logger.isDebugMode()) {
                          Logger.debug(
                            `Could not find matching Tahvel result for personalCode="${diffResult.studentPersonalCode}" name="${diffResult.studentName || ''}" in assignment ${diffAssignment.assignmentExternalId}`
                          )
                        }
                      }
                    })
                  }
                }
              })
            }
          }
        })
      }

      //Logger.debug('Processed differences:', JSON.stringify(this.differences))
      this.updateUI()
    } catch (error) {
      Logger.error('Error calling Kriit API:', error)
      this.isLoading = false
      this.error = error.message || 'Failed to call Kriit API'
      this.updateUI()
    }
  }

  /**
   * Count total number of differences
   * @returns {number} Total number of differences
   */
  countTotalDifferences() {
    Logger.debug('✨ [countTotalDifferences] Called')
    let count = 0

    if (!this.differences || !Array.isArray(this.differences)) {
      Logger.debug('✨ [countTotalDifferences] No differences array, returning 0')
      return 0
    }

    // Count grade differences
    let gradeCount = 0
    this.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        subject.assignments.forEach(assignment => {
          if (assignment && Array.isArray(assignment.results)) {
            assignment.results.forEach(result => {
              const tahvelGrade = result.currentGrade || '(puudub)'
              const kriitGrade = result.grade || '(puudub)'
              // Count as difference if either grade is missing or different
              if (tahvelGrade !== kriitGrade) {
                gradeCount++
              }
            })
          }
        })
      }
    })
    Logger.debug(`✨ [countTotalDifferences] Grade differences: ${gradeCount}`)
    count += gradeCount

    // Count assignment name differences
    const assignmentNameDiffs = this.extractAssignmentNameDifferences()
    let nameCount = 0
    assignmentNameDiffs.forEach(subject => {
      if (subject.nameDiffs && subject.nameDiffs.length > 0) {
        nameCount += subject.nameDiffs.length
      }
    })
    Logger.debug(`✨ [countTotalDifferences] Name differences: ${nameCount}`)
    count += nameCount

    // Count due date differences
    const dueDateDiffs = this.extractDueDateDifferences()
    Logger.debug(`✨ [countTotalDifferences] Due date differences: ${dueDateDiffs.length}`)
    count += dueDateDiffs.length

    // Count entry date differences
    const entryDateDiffs = this.extractEntryDateDifferences()
    Logger.debug(`✨ [countTotalDifferences] Entry date differences: ${entryDateDiffs.length}`)
    count += entryDateDiffs.length

    // Count assignment hours differences
    const assignmentHoursDiffs = this.extractAssignmentHoursDifferences()
    Logger.debug(`✨ [countTotalDifferences] Hours differences: ${assignmentHoursDiffs.length}`)
    count += assignmentHoursDiffs.length

    // Count entry type differences
    const entryTypeDiffs = this.extractEntryTypeDifferences()
    Logger.debug(`✨ [countTotalDifferences] Entry type differences: ${entryTypeDiffs.length}`)
    count += entryTypeDiffs.length

    Logger.debug(`✨ [countTotalDifferences] TOTAL differences: ${count}`)
    return count
  }

  /**
   * Get comprehensive lesson dates (first, next, last) from timetable and õppetöögraafik
   * @param {number} journalId - Journal ID
   * @param {Object} journalInfo - Journal info object (already fetched)
   * @returns {Promise<Object>} Object with firstLessonDate, nextLessonDate, lastLessonDate (all ISO strings or null)
   */
  async getLessonDates(journalId, journalInfo) {
    try {
      const result = {
        firstLessonDate: null,
        firstLessonDateIsApproximate: false,
        nextLessonDate: null,
        lastLessonDate: null,
        lastLessonDateIsApproximate: false
      }

      if (!journalInfo) {
        return result
      }

      const schoolId = await getSchoolId(this.api, journalInfo)
      const teacherId = journalInfo.journalTeachers?.[0]?.id

      if (!teacherId || !schoolId) {
        Logger.debug(`No teacher ID or school ID available for journal ${journalId}`)
        return result
      }

      // Get study year dates
      const now = new Date()
      const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
      const from = journalInfo.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
      const thru = journalInfo.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`

      const timetableData = await this.api.tahvel.get(
        endpoint,
        {},
        {
          cache: true,
          cacheExpiration: 24 * 60 * 60 * 1000
        }
      )

      if (!timetableData?.timetableEvents) {
        return result
      }

      // Filter and sort timetable events for this journal
      const journalTimetable = timetableData.timetableEvents
        .filter(event => event.journalId == journalId)
        .sort((a, b) => new Date(a.date) - new Date(b.date))

      if (journalTimetable.length === 0) {
        // No timetable entries - try fallback to lesson plan (plankoormused) for both first and last dates
        const firstLessonFromPlan = await this.getFirstLessonFromPlan(journalId, teacherId)
        if (firstLessonFromPlan) {
          result.firstLessonDate = firstLessonFromPlan
          result.firstLessonDateIsApproximate = true
        }

        const lastLessonFromPlan = await this.getLastLessonFromPlan(journalId, teacherId)
        if (lastLessonFromPlan) {
          result.lastLessonDate = lastLessonFromPlan
          result.lastLessonDateIsApproximate = true
        }

        return result
      }

      // First lesson date (exact from timetable)
      result.firstLessonDate = journalTimetable[0]?.date || null
      result.firstLessonDateIsApproximate = false

      // Next lesson date (first future date after today, excluding today)
      // If first lesson is exact (not approximate), find next lesson on a different day than first lesson
      const nowDate = new Date()
      nowDate.setHours(0, 0, 0, 0)
      const tomorrowDate = new Date(nowDate)
      tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const futureLessons = journalTimetable.filter(event => new Date(event.date) >= tomorrowDate)

      if (futureLessons.length > 0) {
        // Find the next lesson that's on a different day than the first lesson
        const firstLessonDateOnly = result.firstLessonDate ? result.firstLessonDate.split('T')[0] : null
        const nextDifferentDayLesson = futureLessons.find(event => {
          const eventDateOnly = event.date.split('T')[0]
          return eventDateOnly !== firstLessonDateOnly
        })
        result.nextLessonDate = nextDifferentDayLesson?.date || futureLessons[0]?.date || null
      } else {
        result.nextLessonDate = null
      }

      // Last lesson date - only send if timetable matches MAHT_a (auditory/contact lessons) capacity
      const mahtACapacity = journalInfo.lessonHours?.capacityHours?.find(c => c.capacity === 'MAHT_a')
      const plannedMahtALessons = mahtACapacity?.plannedHours || 0
      const timetableLessons = journalTimetable.length

      Logger.debug(`[getLessonDates] Journal ${journalId}: plannedMahtALessons=${plannedMahtALessons}, timetableLessons=${timetableLessons}`)

      if (plannedMahtALessons === timetableLessons) {
        // Timetable matches MAHT_a planned lessons - use last timetable entry (exact)
        result.lastLessonDate = journalTimetable[journalTimetable.length - 1]?.date || null
        result.lastLessonDateIsApproximate = false
        Logger.debug(`[getLessonDates] Journal ${journalId}: Using exact last lesson from timetable: ${result.lastLessonDate}`)
      } else if (timetableLessons < plannedMahtALessons) {
        // Timetable doesn't have all entries - get last lesson date from lesson plan (approximate)
        Logger.debug(`[getLessonDates] Journal ${journalId}: Timetable incomplete, fetching from lesson plan`)
        const lastLessonFromPlan = await this.getLastLessonFromPlan(journalId, teacherId)
        if (lastLessonFromPlan) {
          result.lastLessonDate = lastLessonFromPlan
          result.lastLessonDateIsApproximate = true
          Logger.debug(`[getLessonDates] Journal ${journalId}: Using approximate last lesson from plan: ${result.lastLessonDate}`)
        } else {
          Logger.debug(`[getLessonDates] Journal ${journalId}: Could not get last lesson from plan`)
        }
      } else {
        Logger.debug(`[getLessonDates] Journal ${journalId}: Timetable has MORE lessons than planned (${timetableLessons} > ${plannedMahtALessons})`)
      }
      // Otherwise leave lastLessonDate as null (don't send it)

      return result
    } catch (error) {
      Logger.warning(`Error getting lesson dates for journal ${journalId}:`, error)
      return {
        firstLessonDate: null,
        firstLessonDateIsApproximate: false,
        nextLessonDate: null,
        lastLessonDate: null,
        lastLessonDateIsApproximate: false
      }
    }
  }

  /**
   * Get first lesson date from lesson plan (plankoormused) when timetable is empty
   * @param {number} journalId - Journal ID
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<string|null>} First lesson date in ISO format or null
   */
  async getFirstLessonFromPlan(journalId, teacherId) {
    try {
      return await resolveLessonPlanDate(this.api, journalId, teacherId, 'first')
    } catch (error) {
      Logger.debug(`Could not get first lesson from plan for journal ${journalId}:`, error.message)
      return null
    }
  }

  /**
   * Get last lesson date from lesson plan (plankoormused) when timetable doesn't have all entries
   * @param {number} journalId - Journal ID
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<string|null>} Last lesson date in ISO format or null
   */
  async getLastLessonFromPlan(journalId, teacherId) {
    try {
      return await resolveLessonPlanDate(this.api, journalId, teacherId, 'last')
    } catch (error) {
      Logger.debug(`Could not get last lesson from plan for journal ${journalId}:`, error.message)
      return null
    }
  }

  /**
   * Get journal info from API with caching
   * @param {number} journalId - Journal ID
   * @returns {Promise<Object>} Journal info
   */
  async getJournalInfo(journalId) {
    // Use the built-in API service caching with a long expiration
    return this.api.tahvel.get(
      `/journals/${journalId}`,
      {},
      {
        cacheExpiration: 30 * 24 * 60 * 60 * 1000 // 30 days
      }
    )
  }

  /**
   * Fetch journal list directly from Tahvel REST API (hois_back/journals)
   * Returns an array of journal items or null on failure
   */
  async fetchJournalsFromApi() {
    try {
      if (Logger.isDebugMode()) Logger.debug('Attempting to fetch journals via Tahvel REST API /hois_back/journals')
      // Determine correct endpoint to avoid duplicating '/hois_back'
      const base = this.api && this.api.tahvel && this.api.tahvel.baseUrl ? String(this.api.tahvel.baseUrl) : ''
      let endpoint = '/hois_back/journals'
      if (base.endsWith('/hois_back')) endpoint = '/journals'

      // Get studyYear from dropdown - no fallbacks
      const detectStudyYear = async() => {
        const selectedYearText = this.getSelectedStudyYear()
        if (!selectedYearText) {
          Logger.debug('No study year selected in dropdown')
          return null
        }

        const yearId = await this.getStudyYearIdFromText(selectedYearText)
        if (yearId) {
          Logger.debug(`Using study year from dropdown: ${selectedYearText} (ID: ${yearId})`)
          return yearId
        }

        Logger.warning(`Could not resolve study year ID for: ${selectedYearText}`)
        return null
      }

      const studyYear = await detectStudyYear()

      // Use query params matching example; request pages of size 50 by default
      const baseParams = { onlyMyJournals: true, sort: '2, 5, 3', size: 50 }
      if (studyYear) {
        baseParams.studyYear = studyYear
        if (Logger.isDebugMode()) Logger.debug('Detected studyYear for journals API:', studyYear)
      } else {
        if (Logger.isDebugMode()) Logger.debug('No studyYear detected; calling journals API without studyYear param')
      }

      // Fetch all pages from the paginated journals endpoint
      const allItems = []
      let page = 0
      let totalPages = null
      let safetyCounter = 0
      const SAFETY_MAX_PAGES = 50 // very large upper bound to prevent infinite loops

      // Loop while we haven't exceeded safety counter and either we don't know
      // totalPages yet or there are still pages left to fetch. Using an explicit
      // condition avoids an ESLint `no-constant-condition` error for `while(true)`.
      while (safetyCounter <= SAFETY_MAX_PAGES && (totalPages === null || page < totalPages)) {
        // Build per-request params to avoid accidental mutation issues
        const params = Object.assign({}, baseParams, { page })
        if (Logger.isDebugMode()) Logger.debug(`Fetching journals page ${page} (params: ${JSON.stringify(params)})`)

        // Use a short cache for each page to avoid hammering during quick reloads
        const response = await this.api.tahvel.get(endpoint, params, { cache: true, cacheExpiration: 5 * 60 * 1000 })

        if (!response) {
          if (Logger.isDebugMode()) Logger.debug('Unexpected /hois_back/journals response (null) on page', page)
          break
        }

        // Typical Spring-style paged response contains 'content' array and 'totalPages' or 'totalElements'
        let items = []
        if (Array.isArray(response.content)) {
          items = response.content
        } else if (Array.isArray(response)) {
          // Some endpoints may return an array directly (not paged) - treat as single page
          items = response
        } else {
          if (Logger.isDebugMode()) Logger.debug('Unexpected /hois_back/journals response format on page', page, response)
          break
        }

        if (items && items.length > 0) {
          allItems.push(...items)
        }

        // Try to determine totalPages from several possible response shapes
        if (totalPages === null) {
          if (typeof response.totalPages === 'number') {
            totalPages = response.totalPages
          } else if (response.pageable && typeof response.pageable.totalPages === 'number') {
            totalPages = response.pageable.totalPages
          } else if (typeof response.totalElements === 'number' && typeof params.size === 'number') {
            totalPages = Math.ceil(response.totalElements / params.size)
          }
        }

        // If server didn't provide totalPages, stop when we received fewer items than requested
        if (totalPages === null && items.length < params.size) break

        // If totalPages known, stop when we've fetched all pages
        if (totalPages !== null && page + 1 >= totalPages) break

        // Increment page and safety counter. Safety is enforced by the loop
        // condition above; keep incrementing so we make progress.
        page += 1
        safetyCounter += 1
      }

      if (allItems.length === 0) {
        if (Logger.isDebugMode()) Logger.debug('No journals found from API')
        return null
      }

      // Map response items to a minimal shape used by collectJournalData when using API path
      const mapped = allItems.map(item => ({
        id: item.id,
        nameEt: item.nameEt || item.name || '',
        studentCount: item.studentCount || 0,
        canEdit: item.canEdit
      }))
      return mapped
    } catch (error) {
      Logger.debug('Error fetching journals from API:', error && error.message ? error.message : error)
      return null
    }
  }

  /**
   * Get journal entries from API (cached for 24 hours)
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array|null>} Journal entries, empty array if unexpected format, null on error
   */
  async getJournalEntries(journalId) {
    try {
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntry`,
        { size: 2000 },
        {
          cache: true,
          cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
        }
      )

      if (response && response.content && Array.isArray(response.content)) {
        if (response.totalElements > 2000) {
          Logger.warning(`Journal ${journalId} has ${response.totalElements} entries, only first 2000 fetched`)
        }
        return response.content
      }
      Logger.warning(`Unexpected response format from journalEntry endpoint: ${JSON.stringify(response)}`)
      return []
    } catch (error) {
      return null
    }
  }

  /**
   * Get journal entries with grades from API - never cached
   * This uses the journalEntriesByDate endpoint which includes the journalStudentResults field
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array>} Journal entries with grades
   */
  async getJournalEntriesWithGrades(journalId) {
    try {
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        {
          // Use ApiService smart defaults for caching. Callers can pass { cache: false }
          // if a real-time refresh is required (for example during an explicit user action).
          cache: true,
          forceRefresh: false
        }
      )

      if (Array.isArray(response)) {
        return response
      }
      Logger.warning(`Unexpected response format from journalEntriesByDate endpoint: ${JSON.stringify(response)}`)
      return []
    } catch (error) {
      return null
    }
  }

  /**
   * Get journal students from API with caching
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array>} Journal students
   */
  async getJournalStudents(journalId) {
    try {
      if (Logger.isDebugMode()) {
        Logger.debug(`🔍 Fetching journal students for journal ${journalId}`)
      }

      // Use a shorter cache time (1 hour) to ensure data is relatively fresh
      // Use allStudents=true to get all students including their personal codes
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalStudents`,
        { allStudents: true },
        {
          cacheExpiration: 60 * 60 * 1000 // 1 hour
        }
      )

      if (response) {
        if (Logger.isDebugMode()) {
          Logger.debug(`✅ Retrieved ${response.length} journal students from API`)
        }

        // === ENHANCED DEBUG: LOG JOURNAL STUDENTS API RESPONSE ===
        if (response.length > 0) {
          const sampleStudent = response[0]
          if (Logger.isDebugMode()) {
            Logger.debug('=== JOURNAL STUDENTS API RESPONSE SAMPLE ===')
            Logger.debug(`Sample student structure: ${JSON.stringify(Object.keys(sampleStudent))}`)
            Logger.debug(`Sample student data: ${JSON.stringify(sampleStudent)}`)
          }

          // Check for personal codes structure - handle new API format
          const hasStudentObject = sampleStudent.student ? 'YES' : 'NO'
          const hasPersonalCodeInStudent = sampleStudent.student?.idcode ? 'YES' : 'NO'
          const hasDirectPersonalCode = sampleStudent.idcode ? 'YES' : 'NO'

          Logger.debug(
            `Has student object: ${hasStudentObject}, Has personal code in student: ${hasPersonalCodeInStudent}, Has direct personal code: ${hasDirectPersonalCode}`
          )
          Logger.debug('=== END JOURNAL STUDENTS API RESPONSE SAMPLE ===')
        }

        // Check if we have personal codes in the response (old format)
        const hasPersonalCodes = response.some(student => student.student?.idcode)
        if (Logger.isDebugMode()) {
          Logger.debug(`Personal codes available in response (old format): ${hasPersonalCodes}`)
        }

        if (hasPersonalCodes) {
          Logger.debug('Journal students response includes personal codes, updating mapping')

          // Update our mapping with the personal codes
          for (const journalStudent of response) {
            if (journalStudent.student && journalStudent.student.idcode && journalStudent.studentId) {
              // Store the mapping from journalStudentId to studentId
              this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId
              Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${journalStudent.student.idcode})`)
            }
          }
        } else {
          Logger.debug('Journal students response does not include personal codes in old format')
          if (Logger.isDebugMode()) {
            Logger.debug('🔧 Attempting to fetch personal codes for each student individually...')
          }

          // New approach: For each journal student, fetch their personal code from the student details API
          for (const journalStudent of response) {
            if (journalStudent.studentId) {
              try {
                if (Logger.isDebugMode()) {
                  Logger.debug(`📡 Fetching personal code for studentId ${journalStudent.studentId}`)
                }

                // Get student details to find personal code
                const studentDetails = await this.getStudentDetails(journalStudent.studentId)

                if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
                  // Store the mapping
                  this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId

                  if (Logger.isDebugMode()) {
                    Logger.debug(`✅ Found personal code for studentId ${journalStudent.studentId}: ${studentDetails.person.idcode}`)
                    Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${studentDetails.person.idcode})`)
                  }

                  // Create a compatible structure for the rest of the code
                  journalStudent.student = {
                    idcode: studentDetails.person.idcode,
                    fullname: studentDetails.person.firstname + ' ' + studentDetails.person.lastname,
                    status: studentDetails.status
                  }
                } else {
                  Logger.warning(`❌ Could not fetch personal code for studentId ${journalStudent.studentId}`)
                }
              } catch (error) {
                Logger.warning(`❌ Error fetching personal code for studentId ${journalStudent.studentId}: ${error.message}`)
              }
            }
          }

          // Check how many personal codes we successfully retrieved
          const studentsWithPersonalCodes = response.filter(student => student.student?.idcode).length
          if (Logger.isDebugMode()) {
            Logger.debug(`📊 Successfully retrieved personal codes for ${studentsWithPersonalCodes}/${response.length} students`)
          }
        }
      } else {
        Logger.error(`❌ No response received from journal students API for journal ${journalId}`)
      }

      return response
    } catch (error) {
      Logger.error(`❌ Error fetching journal students for journal ${journalId}: ${error.message}`)
      return null
    }
  }

  /**
   * Get detailed information about a student by personal code
   * @param {string} personalCode - Student personal code
   * @param {number} journalId - Journal ID
   * @returns {Promise<Object>} Detailed student information
   */
  async getDetailedStudentInfo(personalCode, journalId) {
    try {
      Logger.debug(`Getting detailed info for student with personal code ${personalCode} in journal ${journalId}`)

      // First, find the student ID by personal code in our cache
      let studentId = null
      let studentInfo = null
      let journalStudentId = null // This is the ID we need for the journalStudent field

      // Get journal students to find the student by personal code
      const journalStudentsForLookup = await this.getJournalStudents(journalId)

      // Search through journal students for matching personal code
      for (const journalStudent of journalStudentsForLookup || []) {
        if (journalStudent.student && journalStudent.student.idcode === personalCode) {
          studentId = journalStudent.studentId
          journalStudentId = journalStudent.id
          studentInfo = {
            personalCode: journalStudent.student.idcode,
            name: journalStudent.student.fullname || journalStudent.studentName,
            isActive: journalStudent.student.status === 'OPPURSTAATUS_O'
          }
          break
        }
      }

      if (!studentId) {
        return { error: `Student with personal code ${personalCode} not found in cache` }
      }

      // Reuse journal students from the lookup above
      const journalStudents = journalStudentsForLookup

      // Log the journal students response for debugging
      if (journalStudents && journalStudents.length > 0) {
        Logger.debug(`Journal students response structure: ${Object.keys(journalStudents[0]).join(', ')}`)
        Logger.debug(`First journal student: ${JSON.stringify(journalStudents[0])}`)
      }

      // Check if the student is enrolled in this journal and get their journalStudentId
      let matchingJournalStudent = null
      const isEnrolled =
        journalStudents &&
        journalStudents.some(js => {
          const matches = String(js.studentId) === String(studentId)
          if (matches) {
            matchingJournalStudent = js
            journalStudentId = js.id // This is the ID we need for the journalStudent field
          }
          return matches
        })

      if (matchingJournalStudent) {
        Logger.debug(
          `Found matching journal student: ID=${matchingJournalStudent.id}, studentId=${matchingJournalStudent.studentId}, name=${matchingJournalStudent.studentName}`
        )
      } else {
        // If we couldn't find the student in the journal students, try to find them by name
        Logger.debug(`Could not find student with ID ${studentId} in journal students. Trying to find by name...`)

        // Try to find the student by name
        const studentName = studentInfo?.name
        if (studentName) {
          const matchByName =
            journalStudents && journalStudents.find(js => js.studentName && js.studentName.toLowerCase().includes(studentName.toLowerCase()))

          if (matchByName) {
            matchingJournalStudent = matchByName
            journalStudentId = matchByName.id
            Logger.debug(`Found student by name: ID=${matchByName.id}, studentId=${matchByName.studentId}, name=${matchByName.studentName}`)
          }
        }

        // If we still couldn't find the student, log all journal students for debugging
        if (!matchingJournalStudent && journalStudents && journalStudents.length > 0) {
          Logger.debug(`All journal students (${journalStudents.length}):`)
          journalStudents.forEach(js => {
            Logger.debug(`- ID=${js.id}, studentId=${js.studentId}, name=${js.studentName || 'Unknown'}`)
          })
        }
      }

      // Get all assignments for this journal
      const journalEntries = await this.getJournalEntries(journalId)

      // Check which assignments the student is enrolled in
      const enrolledAssignments = []
      if (journalEntries && Array.isArray(journalEntries)) {
        Logger.debug(`Found ${journalEntries.length} entries in journal ${journalId}`)

        for (const entry of journalEntries) {
          // Only process entries that are homework, graded entries, practical work, or outcomes
          if (entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P' || entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_O') {
            // Handle outcome entries differently since they don't have regular entry IDs
            if (entry.entryType === 'SISSEKANNE_O') {
              // For outcome entries, we need to use the journalOutcome endpoint
              const outcomeDetails = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${entry.curriculumModuleOutcomes}`)

              if (outcomeDetails && outcomeDetails.outcomeStudents) {
                const isInOutcome = outcomeDetails.outcomeStudents.some(
                  student => student.journalStudent && String(student.journalStudent) === String(studentId)
                )

                if (isInOutcome) {
                  // Get the outcome name
                  const assignmentName = entry.nameEt || outcomeDetails.nameEt || 'Õppetulemus'
                  Logger.debug(`Student ${studentId} is enrolled in outcome: ${assignmentName}`)

                  enrolledAssignments.push({
                    id: entry.curriculumModuleOutcomes,
                    name: assignmentName,
                    entryType: entry.entryType
                  })
                }
              }
            } else {
              // Get the entry details with allStudents=true to get data for all students
              const entryDetails = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${entry.id}`, { allStudents: true })

              if (entryDetails && entryDetails.journalEntryStudents) {
                const isInAssignment = entryDetails.journalEntryStudents.some(
                  student => student.journalStudent && String(student.journalStudent) === String(studentId)
                )

                if (isInAssignment) {
                  // Get the assignment name
                  const assignmentName = entry.nameEt || entry.name

                  enrolledAssignments.push({
                    id: entry.id,
                    name: assignmentName,
                    entryType: entry.entryType
                  })
                }
              }
            }
          }
        }

        Logger.debug(`Student ${studentInfo?.name} is enrolled in ${enrolledAssignments.length} assignments in journal ${journalId}`)
      } else {
        Logger.warning(`No entries found in journal ${journalId} or unexpected response format`)
        Logger.debug(`Journal entries response: ${JSON.stringify(journalEntries)}`)
      }

      // Return detailed information
      return {
        personalCode,
        studentId,
        journalStudentId, // This is the ID we need for the journalStudent field
        name: studentInfo?.name,
        isActive: studentInfo?.isActive,
        isEnrolledInJournal: isEnrolled,
        enrolledAssignments,
        journalId,
        cacheInfo: studentInfo
      }
    } catch (error) {
      Logger.error(`Error getting detailed student info: ${error.message}`)
      return { error: error.message }
    }
  }
  /**
   * Get detailed student information including personal code
   * @param {number} studentId - Student ID
   * @returns {Promise<Object>} Student details
   */
  async getStudentDetails(studentId) {
    // Use the built-in API service caching with a very long expiration
    return this.api.tahvel.get(
      `/students/${studentId}`,
      {},
      {
        cacheExpiration: 24 * 60 * 60 * 1000
      }
    )
  }

  /**
   * Fetch students with inactive statuses (academic leave, graduated, exmatriculated)
   * This is useful for finding students who have been removed from journals
   * @returns {Promise<Object>} Map of personal codes to student data
   */
  async fetchInactiveStudents() {
    try {
      Logger.debug('📡 Fetching inactive students from Tahvel API')

      // Build maps indexed by both personal code and student ID for quick lookup
      const inactiveStudentsMap = {
        byPersonalCode: {},
        byStudentId: {}
      }

      // The API limits page size to 2000, so we need to paginate through all results
      let page = 0
      let hasMorePages = true

      // Fetch all pages until we reach the end
      while (hasMorePages) {
        Logger.debug(`📄 Fetching page ${page} of inactive students`)

        // Fetch students with OPPURSTAATUS_A (academic leave), OPPURSTAATUS_L (graduated), OPPURSTAATUS_K (exmatriculated)
        const response = await this.api.tahvel.get(
          '/students',
          {
            lang: 'ET',
            page: page,
            showMyStudentGroups: false,
            size: 2000, // Maximum page size allowed by API
            sort: 'person.lastname,person.firstname,asc',
            status: ['OPPURSTAATUS_K', 'OPPURSTAATUS_L', 'OPPURSTAATUS_A']
          },
          {
            cacheExpiration: 24 * 60 * 60 * 1000 // Cache for 24 hours
          }
        )

        if (!response || !response.content || !Array.isArray(response.content)) {
          Logger.warning('⚠️ Invalid response from inactive students API')
          Logger.debug(`Response structure: ${JSON.stringify(Object.keys(response || {}))}`)
          break
        }

        // Log total info on first page
        if (page === 0 && response.totalElements) {
          Logger.debug(`📊 Total inactive students reported by API: ${response.totalElements}`)
        }

        const studentsInPage = response.content.length
        Logger.debug(`📋 Processing ${studentsInPage} students from page ${page}`)

        // If we got no students, we've reached the end
        if (studentsInPage === 0) {
          hasMorePages = false
          break
        }

        // Process students from this page
        for (const student of response.content) {
          if (student.idcode) {
            const isActive = student.status === 'OPPURSTAATUS_O'
            const isDeleted = student.status === 'OPPURSTAATUS_K'
            const isGraduated = student.status === 'OPPURSTAATUS_L'

            const studentData = {
              personalCode: student.idcode,
              name: student.fullname || `${student.firstname} ${student.lastname}`,
              isActive: isActive,
              isDeleted: isDeleted,
              isGraduated: isGraduated,
              studentId: student.id,
              status: student.status
            }

            // Index by personal code
            inactiveStudentsMap.byPersonalCode[student.idcode] = studentData

            // Index by student ID
            if (student.id) {
              inactiveStudentsMap.byStudentId[student.id] = studentData
            }
          } else {
            Logger.debug(`⚠️ Skipping student without idcode: ${JSON.stringify(student)}`)
          }
        }

        // If this page had fewer students than requested, we've reached the end
        if (studentsInPage < 2000) {
          hasMorePages = false
        } else {
          page++
        }
      }

      const fetchedCount = Object.keys(inactiveStudentsMap.byPersonalCode).length
      Logger.debug(`✅ Fetched ${fetchedCount} inactive students from ${page + 1} page(s) (indexed by personal code and student ID)`)

      return inactiveStudentsMap
    } catch (error) {
      Logger.error(`❌ Error fetching inactive students: ${error.message}`)
      return { byPersonalCode: {}, byStudentId: {} }
    }
  }

  /**
   * Get or fetch the inactive students cache
   * Uses CacheService to cache the inactive students data for 24 hours
   * @returns {Promise<Object>} Object with byPersonalCode and byStudentId maps
   */
  async getInactiveStudentsCache() {
    const cacheKey = 'inactive_students_all'

    // Memory-only: keyed by personal code, contains names — must not persist.
    const result = await cacheService.getOrFetch(
      cacheKey,
      () => this.fetchInactiveStudents(),
      24 * 60 * 60 * 1000, // 24 hours (memory cache lifetime)
      true,
      false
    )

    // Ensure we always return a valid structure
    if (!result || typeof result !== 'object') {
      return { byPersonalCode: {}, byStudentId: {} }
    }

    // Handle old format (before this update) or error cases
    if (!result.byPersonalCode && !result.byStudentId) {
      return { byPersonalCode: {}, byStudentId: {} }
    }

    return result
  }

  /**
   * Create a mapping of student IDs to personal codes and names
   * @param {Array} journalStudents - Journal students
   * @param {Object} studentDetailsMap - Map of student IDs to their details including personal codes
   * @returns {Object} Student map
   */
  createStudentMap(journalStudents, studentDetailsMap = {}) {
    if (Logger.isDebugMode()) {
      Logger.debug('=== CREATING STUDENT MAP ===')
      Logger.debug(`Journal students count: ${journalStudents ? journalStudents.length : 0}`)
      Logger.debug(`Student details map count: ${Object.keys(studentDetailsMap).length}`)
    }

    const studentMap = {
      idToPersonalCode: {},
      personalCodeToName: {},
      journalStudentIdToId: {}
    }

    // First, map journal student IDs to student IDs
    if (journalStudents && Array.isArray(journalStudents)) {
      if (Logger.isDebugMode()) {
        Logger.debug(`Processing ${journalStudents.length} journal students...`)
      }

      journalStudents.forEach((journalStudent, index) => {
        if (Logger.isDebugMode()) {
          Logger.debug(`Processing journal student ${index + 1}/${journalStudents.length}`)
        }

        if (journalStudent?.id && journalStudent?.studentId) {
          studentMap.journalStudentIdToId[journalStudent.id] = journalStudent.studentId
          if (Logger.isDebugMode()) {
            Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId}`)
          }

          // If we have details for this student from our direct API calls
          if (studentDetailsMap[journalStudent.studentId]) {
            const details = studentDetailsMap[journalStudent.studentId]
            studentMap.idToPersonalCode[journalStudent.studentId] = details.personalCode
            studentMap.personalCodeToName[details.personalCode] = details.name
            if (Logger.isDebugMode()) {
              Logger.debug(`Added personal code mapping: studentId ${journalStudent.studentId} -> "${details.personalCode}" (${details.name})`)
            }
          }
          // If we don't have details, log the issue but don't necessarily throw an error
          else {
            Logger.warning(`❌ No personal code found for student ID ${journalStudent.studentId} in student details map`)
            Logger.debug(`Available student detail IDs: ${Object.keys(studentDetailsMap).join(', ')}`)
            Logger.debug(`Journal student data: ${JSON.stringify(journalStudent)}`)

            // Instead of throwing an error immediately, let's try to get the data from the journal student itself
            if (journalStudent.student && journalStudent.student.idcode) {
              if (Logger.isDebugMode()) {
                Logger.debug(`✅ Found personal code in journal student data: ${journalStudent.student.idcode}`)
              }
              studentMap.idToPersonalCode[journalStudent.studentId] = journalStudent.student.idcode
              const studentName = journalStudent.student.fullname || journalStudent.studentName || 'Unknown'
              studentMap.personalCodeToName[journalStudent.student.idcode] = studentName
              if (Logger.isDebugMode()) {
                Logger.debug(
                  `Added personal code mapping from journal data: studentId ${journalStudent.studentId} -> "${journalStudent.student.idcode}" (${studentName})`
                )
              }
            } else {
              Logger.error(`🚫 Cannot find personal code for student ID ${journalStudent.studentId} anywhere`)
              const errorMsg = `No personal code found for student ID ${journalStudent.studentId} in student details map - cannot proceed`
              Logger.error(errorMsg)
              throw new Error(errorMsg)
            }
          }
        } else {
          Logger.warning(`⚠️ Journal student ${index + 1} missing id or studentId: ${JSON.stringify(journalStudent)}`)
        }
      })
    } else {
      Logger.warning('⚠️ No valid journal students array provided')
    }

    // Log final mapping statistics
    if (Logger.isDebugMode()) {
      const personalCodeCount = Object.keys(studentMap.idToPersonalCode).length
      const nameCount = Object.keys(studentMap.personalCodeToName).length
      const journalMappingCount = Object.keys(studentMap.journalStudentIdToId).length

      Logger.debug(`Final mapping statistics:`)
      Logger.debug(`- Personal code mappings: ${personalCodeCount}`)
      Logger.debug(`- Name mappings: ${nameCount}`)
      Logger.debug(`- Journal student mappings: ${journalMappingCount}`)

      if (personalCodeCount > 0) {
        const samplePersonalCodes = Object.values(studentMap.idToPersonalCode).slice(0, 3)
        Logger.debug(`Sample personal codes: ${samplePersonalCodes.join(', ')}`)
      }

      Logger.debug('=== END CREATING STUDENT MAP ===')
    }

    return studentMap
  }

  /**
   * Extract assignments and their results from journal entries
   * @param {Array} journalEntries - Journal entries
   * @param {Object} studentMap - Student map
   * @param {Array} journalStudents - Journal students (optional)
   * @param {Object} studentDetailsMap - Map of student IDs to their details (optional)
   * @param {Array} journalEntriesWithGrades - Journal entries with grades from journalEntriesByDate endpoint (optional)
   * @returns {Array} Assignments
   */
  extractAssignmentsFromEntries(journalEntries, studentMap, journalStudents = [], studentDetailsMap = {}, journalEntriesWithGrades = []) {
    const assignments = []

    if (!journalEntries || !Array.isArray(journalEntries)) {
      return assignments
    }

    // Filter for graded entries only (exclude outcome entries)
    const gradedEntries = journalEntries.filter(
      entry =>
        entry.entryType === 'SISSEKANNE_H' || // Graded entry
        entry.entryType === 'SISSEKANNE_I' || // Independent work
        entry.entryType === 'SISSEKANNE_P' // Practical work
    )

    // Debug: Log count of different entry types
    const entryCounts = {
      SISSEKANNE_H: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_H').length,
      SISSEKANNE_I: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_I').length,
      SISSEKANNE_P: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_P').length,
      SISSEKANNE_O: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_O').length
    }

    // Debug: Log outcome entries specifically
    if (entryCounts['SISSEKANNE_O'] > 0) {
      const outcomeEntries = gradedEntries.filter(e => e.entryType === 'SISSEKANNE_O')
      outcomeEntries.forEach(() => {})
    }

    // Create a map of entry IDs to entries with grades from journalEntriesByDate
    const entriesWithGradesMap = {}
    if (journalEntriesWithGrades && Array.isArray(journalEntriesWithGrades)) {
      journalEntriesWithGrades.forEach(entry => {
        // Handle regular entries with IDs
        if (entry.id && (entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P')) {
          entriesWithGradesMap[entry.id] = entry
        }
        // Handle outcome entries with curriculumModuleOutcomes
        if (entry.curriculumModuleOutcomes && entry.entryType === 'SISSEKANNE_O') {
          entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`] = entry
        }
      })
    }

    gradedEntries.forEach(entry => {
      // Log when we process an outcome entry
      if (entry.entryType === 'SISSEKANNE_O') {
        // No-op block removed (was empty)
      }

      // Extract results for this assignment
      const results = []

      // Handle different entry types for finding grades
      let entryWithGrades
      if (entry.entryType === 'SISSEKANNE_O') {
        // For outcome entries, look up by curriculumModuleOutcomes
        entryWithGrades = entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`]
      } else {
        // For regular entries, look up by ID
        entryWithGrades = entriesWithGradesMap[entry.id]
      }

      // Create a map of students who have results for this assignment
      const studentResultsMap = {}
      if (entryWithGrades) {
        if (entry.entryType === 'SISSEKANNE_O' && entryWithGrades.studentOutcomeResults) {
          // Handle outcome entries with studentOutcomeResults
          Object.entries(entryWithGrades.studentOutcomeResults).forEach(([journalStudentId, studentResults]) => {
            studentResultsMap[journalStudentId] = studentResults
          })
        } else if (entryWithGrades.journalStudentResults) {
          // Handle regular entries with journalStudentResults
          Object.entries(entryWithGrades.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
            studentResultsMap[journalStudentId] = studentResults
          })
        }
      } else if (entry.journalStudentResults) {
        const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
        Logger.debug(`Using fallback entry for assignment ${entryIdForLog} (${entry.nameEt || 'Unnamed'})`)
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
          studentResultsMap[journalStudentId] = studentResults
        })
      } else {
        const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
        Logger.debug(`No grades found for assignment ${entryIdForLog} (${entry.nameEt || 'Unnamed'}), but including all students with empty grades`)
      }

      // Include ALL journal students for this assignment, not just those with results
      if (journalStudents && Array.isArray(journalStudents)) {
        journalStudents.forEach(journalStudent => {
          if (!journalStudent || !journalStudent.id) return

          const journalStudentId = journalStudent.id.toString()

          // Check if this student has results for this assignment
          const studentResults = studentResultsMap[journalStudentId]
          let grade = ''

          if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
            // Get grade if available
            grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
          }
          // If no results or no grade, grade remains empty string

          // Get student ID from journal student ID
          const studentId = studentMap.journalStudentIdToId[journalStudentId]
          if (!studentId) return

          // Get personal code from student ID
          const personalCode = studentMap.idToPersonalCode[studentId]

          // If we can't get the personal code, skip this student (don't throw error for missing students)
          if (!personalCode) {
            Logger.warning(`No personal code found for student ID ${studentId}, skipping`)
            return
          }

          // Get student name, active status, and deleted status from our maps
          let studentName = 'Unknown Student'
          let studentIsActive = true // Default to active if we can't determine status
          let studentIsDeleted = false

          // Get student details from our maps
          if (personalCode && studentMap.personalCodeToName[personalCode]) {
            studentName = studentMap.personalCodeToName[personalCode]
          } else {
            // Use the student name from the journal students array
            if (journalStudent.studentName) {
              studentName = journalStudent.studentName
              // Store this mapping for future use
              if (personalCode) {
                studentMap.personalCodeToName[personalCode] = journalStudent.studentName
                Logger.debug(`Added name mapping for ${personalCode}: ${journalStudent.studentName}`)
              }
            }
          }

          // Check if we have student details in our cache
          let studentIsGraduated = false
          if (studentId && studentDetailsMap[studentId]) {
            // Use the isActive, isDeleted, and isGraduated flags from the student details
            studentIsActive = studentDetailsMap[studentId].isActive
            studentIsDeleted = studentDetailsMap[studentId].isDeleted || false
            studentIsGraduated = studentDetailsMap[studentId].isGraduated || false
          }

          // Add result for this student (including those with empty grades)
          results.push({
            grade,
            studentPersonalCode: personalCode,
            studentName,
            studentIsActive: studentIsActive,
            studentIsDeleted: studentIsDeleted,
            studentIsGraduated: studentIsGraduated
          })
        })
      } else {
        const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
        Logger.warning(`No journal students provided for assignment ${entryIdForLog}, cannot include all students`)
      }

      // Get the assignment name
      const assignmentName = entry.nameEt || this.getAssignmentNameFromEntry(entry)

      // Always include assignments with valid ID and name, even if they don't have results yet
      // This ensures all assignments are sent to Kriit, not just those with grades
      // Handle both regular entries (with id) and outcome entries (with curriculumModuleOutcomes)
      const assignmentId = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id

      if (assignmentId && assignmentName) {
        assignments.push({
          assignmentExternalId: assignmentId,
          assignmentName: assignmentName,
          assignmentInstructions: entry.content || '',
          assignmentDueAt: entry.homeworkDuedate ? entry.homeworkDuedate.split('T')[0] : entry.entryDate ? entry.entryDate.split('T')[0] : null, // Use homeworkDuedate if available, fall back to entryDate
          assignmentEntryDate: entry.entryDate ? entry.entryDate.split('T')[0] : null,
          // If Tahvel entry contains lessons, include it for Kriit to consume; coerce to Number or null
          lessons: typeof entry.lessons !== 'undefined' && entry.lessons !== null ? Number(entry.lessons) : null,
          // Include entry type so Kriit knows whether it's independent work or practical work
          entryType: entry.entryType || null,
          results
        })

        // Log whether this assignment has results or not
      }
    })

    return assignments
  }

  /**
   * Get addInfo value from existing students
   * @param {Array} students - Journal entry students
   * @returns {string} addInfo value
   */
  getAddInfoFromExistingStudents(students) {
    if (!students || !Array.isArray(students) || students.length === 0) {
      return null
    }

    // Look for a student with a non-null addInfo
    for (const student of students) {
      if (student.addInfo) {
        Logger.debug(`Found existing addInfo pattern: ${student.addInfo}`)

        // Extract the base URL pattern (everything before the last slash and number)
        const match = student.addInfo.match(/(.*\/)[0-9]+$/)
        if (match && match[1]) {
          const baseUrl = match[1]
          Logger.debug(`Extracted base URL: ${baseUrl}`)

          // Return the base URL with a placeholder number
          // We'll use the same number as the existing pattern
          const lastPart = student.addInfo.split('/').pop()
          return `${baseUrl}${lastPart}`
        }

        // If we can't extract a pattern, just return the addInfo as is
        return student.addInfo
      }
    }

    // If no student has addInfo, return null
    return null
  }

  /**
   * Get a readable assignment name from a journal entry
   * @param {Object} entry - Journal entry
   * @returns {string} Assignment name
   */
  getAssignmentNameFromEntry(entry) {
    if (entry.nameEt) return entry.nameEt

    if (entry.content) {
      // Extract first line or first sentence from instructions
      const firstSentence = entry.content
        .split(/[.!\n]/)[0] // Split by period, exclamation mark or newline
        .trim()
        .slice(0, 100) // Limit length

      if (firstSentence) {
        return firstSentence.length === 100 ? `${firstSentence}...` : firstSentence
      }
    }

    // Use a type-specific name if nothing else is available
    return entry.entryType === 'SISSEKANNE_H'
      ? 'Hindeline töö'
      : entry.entryType === 'SISSEKANNE_I'
        ? 'Iseseisev töö'
        : entry.entryType === 'SISSEKANNE_P'
          ? 'Praktiline töö'
          : entry.entryType === 'SISSEKANNE_O'
            ? 'Õppetulemus'
            : 'Päeviku sissekanne'
  }

  /**
   * Sync data with Kriit
   */

  getAssignmentLevelSyncFields() {
    return [
      { batchKey: 'nameEt', diffKey: 'assignmentName', statusType: 'name', successLabel: 'ülesande nimetust', failureLabel: 'nimetus' },
      { batchKey: 'homeworkDuedate', diffKey: 'assignmentDueAt', statusType: 'duedate', successLabel: 'tähtaega', failureLabel: 'tähtaeg' },
      {
        batchKey: 'entryDate',
        diffKey: 'assignmentEntryDate',
        statusType: 'entrydate',
        successLabel: 'sissekande kuupäeva',
        failureLabel: 'sissekande kuupäev'
      },
      { batchKey: 'entryType', diffKey: 'entryType', statusType: 'entrytype', successLabel: 'sissekande tüüpi', failureLabel: 'sissekande tüüp' },
      {
        batchKey: 'lessons',
        diffKey: 'assignmentHours',
        statusType: 'hours',
        successLabel: 'ülesande tundide arvu',
        failureLabel: 'tundide arv',
        scalar: true
      }
    ]
  }

  getAssignmentLevelChangeValue(assignment, field) {
    if (field.scalar) {
      const value = assignment[field.diffKey]
      return value === undefined || value === null ? undefined : value
    }

    const diff = assignment[field.diffKey]
    if (!diff || typeof diff !== 'object' || !diff.kriit || diff.kriit === diff.Tahvel) return undefined
    return diff.kriit
  }

  getAssignmentLevelChanges(assignment, fields = this.getAssignmentLevelSyncFields()) {
    return fields
      .map(field => ({ field, value: this.getAssignmentLevelChangeValue(assignment, field) }))
      .filter(change => change.value !== undefined)
  }

  getAssignmentLevelBatchChanges(batch, fields = this.getAssignmentLevelSyncFields()) {
    return fields.map(field => ({ field, value: batch[field.batchKey] })).filter(change => change.value !== undefined && change.value !== null)
  }

  updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, isSynced) {
    for (const { field } of this.getAssignmentLevelBatchChanges(batch)) {
      journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, field.statusType, isSynced)
    }
  }

  applyAssignmentLevelChangesToDifference(assignmentObj, batch) {
    for (const { field, value } of this.getAssignmentLevelBatchChanges(batch)) {
      if (field.scalar) {
        delete assignmentObj[field.diffKey]
        continue
      }

      assignmentObj[field.diffKey] = assignmentObj[field.diffKey] || {}
      assignmentObj[field.diffKey].Tahvel = value
    }
  }

  getAssignmentLevelFailureTypes(batch) {
    const types = this.getAssignmentLevelBatchChanges(batch).map(({ field }) => field.statusType)
    return types.length > 0 ? types : ['assignment']
  }

  getSyncFailureTypes(batch, hasStudentUpdates) {
    const types = this.getAssignmentLevelFailureTypes(batch)
    if (hasStudentUpdates && !types.includes('grade')) types.push('grade')
    return types
  }

  getSyncTypeNames() {
    return {
      ...Object.fromEntries(this.getAssignmentLevelSyncFields().map(field => [field.statusType, field.failureLabel])),
      assignment: 'muudatus',
      grade: 'hinne'
    }
  }

  countSuccessfulSyncChanges(successfulSyncs, batches) {
    const successfulKeys = new Set(successfulSyncs.map(sync => `${sync.journalId}::${sync.assignmentId}`))
    const gradeCount = successfulSyncs.reduce((count, sync) => count + (sync.updated || 0), 0)
    const assignmentLevelCount = batches.reduce((count, batch) => successfulKeys.has(`${batch.journalId}::${batch.assignmentId}`) ? count + this.getAssignmentLevelBatchChanges(batch).length : count, 0)

    return gradeCount + assignmentLevelCount
  }

  /**
   * Build a Tahvel journal entry update payload for assignment-level changes only.
   * Tahvel requires journalEntryStudents to be present on PUT; omitting it returns
   * 500, while [] preserves existing rows and avoids resubmitting stale student rows.
   * @param {Object} entryData Current journal entry data from Tahvel
   * @param {Object} updates Assignment-level fields to overwrite
   * @returns {Object} Payload for PUT /journals/:journalId/journalEntry/:assignmentId
   */
  buildAssignmentLevelUpdatePayload(entryData, updates = {}) {
    const payload = {
      ...entryData,
      ...updates,
      journalEntryStudents: []
    }

    if (Array.isArray(payload.journalEntryTeachers)) {
      payload.journalEntryTeachers = payload.journalEntryTeachers.map(id => String(id))
    }

    return payload
  }

  /**
   * Normalize a Tahvel due date value to the datetime shape used by journal entry PUTs.
   * @param {string|null|undefined} dueDate Due date from Kriit or Tahvel entry data
   * @returns {string|null|undefined} Normalized due date
   */
  normalizeTahvelDueDate(dueDate) {
    const due = dueDate
    if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
      return `${due}T23:59:59.000Z`
    }
    if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(due)) {
      return `${due}.000Z`
    }
    if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+$/.test(due)) {
      return `${due}Z`
    }
    return due
  }

  /**
   * Extract HTTP status from ApiService errors.
   * @param {Error} error Error thrown by ApiService
   * @returns {number|null} HTTP status or null
   */
  getApiErrorStatus(error) {
    return error?.status || Number(error?.message?.match(/API Error:\s*(\d+)/)?.[1]) || null
  }

  /**
   * Build a user-facing sync failure message without student identifiers.
   * @param {Array<Object>} failedSyncs Failed sync items
   * @param {number} successfulCount Number of successful sync items
   * @returns {string} Error message
   */
  buildSyncFailureMessage(failedSyncs, successfulCount = 0) {
    const count = Array.isArray(failedSyncs) ? failedSyncs.length : 0
    const labels = (failedSyncs || [])
      .map(failure => {
        const assignmentName = failure.assignmentName || (failure.assignmentId ? `ülesanne ${failure.assignmentId}` : 'tundmatu ülesanne')
        const typeNames = this.getSyncTypeNames()
        const failureTypes = Array.isArray(failure.types) && failure.types.length > 0 ? failure.types : [failure.type]
        const typeName = failureTypes.map(type => typeNames[type] || 'muudatus').join(', ')
        const status = failure.status ? `, HTTP ${failure.status}` : ''
        return `${assignmentName} (${typeName}${status})`
      })
      .join('; ')

    let message = `Sünkroniseerimine ebaõnnestus ${count} muudatuse puhul${labels ? `: ${labels}` : ''}.`
    if (successfulCount > 0) message = `Sünkroniseerimine osaliselt õnnestus: ${successfulCount} õnnestus, ${count} ebaõnnestus${labels ? `. ${labels}.` : '.'}`
    if ((failedSyncs || []).some(failure => failure.status === 412 || String(failure.error || '').includes('412'))) {
      message += ' Tahvel lükkas vähemalt ühe päeviku sissekande uuenduse tagasi (412 Precondition Failed). Värskenda andmeid ja proovi uuesti.'
    }
    return message
  }

  async syncWithKriit() {
    // Debug: Log all journal students and their personal codes before syncing
    if (Array.isArray(this.differences)) {
      this.differences.forEach(subject => {
        if (Array.isArray(subject.assignments)) {
          subject.assignments.forEach(assignment => {
            if (Array.isArray(assignment.results)) {
              assignment.results.forEach(() => {})
            }
          })
        }
      })
    }
    // Debug: Log mapping from journalStudentId to studentId and idToPersonalCode
    Logger.debug('[SYNC] Mapping journalStudentIdToStudentId:', JSON.stringify(this.journalStudentIdToStudentId))
    if (this.journalStudentIdToStudentId) {
      Object.entries(this.journalStudentIdToStudentId).forEach(([journalStudentId, studentId]) => {
        Logger.debug(`[SYNC] journalStudentId ${journalStudentId} -> studentId ${studentId}`)
      })
    }
    if (this.globalTeacherCache) {
      Logger.debug('[SYNC] Teacher cache:', JSON.stringify(this.globalTeacherCache))
    }
    Logger.debug(`[${this.name}] Syncing with Kriit...`)

    // Prevent multiple sync operations from running simultaneously
    if (this.isLoading) {
      Logger.warning('Sync already in progress, ignoring new sync request')
      return
    }

    // Per-sync caches to avoid repeated heavy requests during a single sync run
    // assignmentEntryCache: cache /journals/:journalId/journalEntry/:assignmentId responses
    const assignmentEntryCache = new Map()

    // localStudentCache: cache student details fetched during this sync to avoid repeated API/cacheService calls
    if (!this._localStudentCache) this._localStudentCache = {}

    try {
      if (!this.differences || !Array.isArray(this.differences) || this.differences.length === 0) {
        Logger.debug('No differences to sync')
        return
      }

      // Prepare data for sync
      const syncData = []
      if (Logger.isDebugMode()) {
        Logger.debug('=== COLLECTING SYNC DATA ===')
        Logger.debug(`Processing ${this.differences ? this.differences.length : 0} subjects with differences`)
      }

      this.differences.forEach((subject, subjectIndex) => {
        if (Logger.isDebugMode()) {
          Logger.debug(`Subject ${subjectIndex + 1}: ${subject.subjectName} (ID: ${subject.subjectExternalId})`)
        }

        if (!subject.assignments || !Array.isArray(subject.assignments)) {
          Logger.warning(`⚠️ Subject ${subjectIndex + 1}: No assignments array`)
          return
        }

        if (Logger.isDebugMode()) {
          Logger.debug(`  - Has ${subject.assignments.length} assignments`)
        }
        subject.assignments.forEach((assignment, assignmentIndex) => {
          if (Logger.isDebugMode()) {
            Logger.debug(`  Assignment ${assignmentIndex + 1}: ${assignment.assignmentName} (ID: ${assignment.assignmentExternalId})`)
          }

          if (!assignment.results || !Array.isArray(assignment.results)) {
            Logger.debug(`⚠️ Assignment ${assignmentIndex + 1}: No results array`)
            return
          }

          if (Logger.isDebugMode()) {
            Logger.debug(`    - Has ${assignment.results.length} results`)
          }
          assignment.results.forEach((result, resultIndex) => {
            Logger.debug(
              `    Result ${resultIndex + 1}: ${result.studentName} | PersonalCode: "${result.studentPersonalCode}" | CurrentGrade: "${result.currentGrade}" | NewGrade: "${result.grade}"`
            )

            // Throw error if any results have missing personal codes
            if (!result.studentPersonalCode) {
              Logger.error(`❌ Result ${resultIndex + 1}: Missing personal code - cannot proceed with sync`)
              const errorMsg = 'Found missing personal code for a student - cannot proceed with sync'
              Logger.error(errorMsg)
              this.error = errorMsg
              throw new Error(errorMsg)
            }

            // Skip syncing grades for deleted students
            if (result.studentIsDeleted === true) {
              if (Logger.isDebugMode()) {
                Logger.debug(
                  `⏭️ Result ${resultIndex + 1}: Skipping grade sync for deleted student: ${result.studentName} (${result.studentPersonalCode})`
                )
              }
              return // Do not sync this student's grade
            }

            // Check if personal code is a string and contains 'fallback-'
            if (typeof result.studentPersonalCode === 'string' && result.studentPersonalCode.includes('fallback-')) {
              const errorMsg = `Found invalid personal code: ${result.studentPersonalCode} - cannot proceed with sync`
              Logger.error(errorMsg)
              this.error = errorMsg
              throw new Error(errorMsg)
            }

            // Only include results where the grade is different
            // Normalize grades for comparison - handle type mismatches and empty values
            const normalizeGrade = grade => {
              if (grade === null || grade === undefined || grade === '' || grade === '(puudub)') {
                return null
              }
              // Convert to string and trim whitespace
              const normalized = String(grade).trim()

              // Handle common Tahvel grade format
              if (normalized.startsWith('KUTSEHINDAMINE_')) {
                return normalized.replace('KUTSEHINDAMINE_', '')
              }

              return normalized
            }

            const tahvelGrade = normalizeGrade(result.currentGrade)
            const kriitGrade = normalizeGrade(result.grade)

            Logger.debug(`    Grade comparison: Tahvel="${tahvelGrade}" vs Kriit="${kriitGrade}"`)

            // Only sync if grades are actually different. Treat kriitGrade === null as a valid
            // value that indicates the grade should be cleared in Tahvel.
            if (tahvelGrade !== kriitGrade) {
              // Log the types we're getting for debugging
              if (Logger.isDebugMode()) {
                Logger.debug(`✅ Result ${resultIndex + 1}: Grade sync needed`)
              }
              Logger.debug(`Student personal code type: ${typeof result.studentPersonalCode}, value: "${result.studentPersonalCode}"`)
              Logger.debug(`Grade type: ${typeof result.grade}, value: "${result.grade}"`)
              Logger.debug(`Will sync: Tahvel="${tahvelGrade}" -> Kriit="${kriitGrade}"`)

              // Convert studentPersonalCode to string and preserve null grade as null
              const personalCode = result.studentPersonalCode ? String(result.studentPersonalCode) : null
              const gradeStr = result.grade === null ? null : result.grade === undefined ? undefined : String(result.grade)

              // Double-check that we have valid data before adding to sync list. personalCode is required;
              // gradeStr may be null which means the grade should be cleared in Tahvel.
              if (!personalCode || gradeStr === undefined) {
                Logger.warning(`⚠️ Result ${resultIndex + 1}: Skipping sync item due to missing data: personalCode="${personalCode}", grade="${gradeStr}"`)
                return
              }

              const syncItem = {
                journalId: subject.subjectExternalId,
                assignmentId: assignment.assignmentExternalId,
                studentPersonalCode: personalCode,
                // grade: null => clear grade in Tahvel; otherwise a string value
                grade: gradeStr
              }

              syncData.push(syncItem)
              if (Logger.isDebugMode()) {
                Logger.debug(`📤 Added to sync queue: ${result.studentName} (${personalCode}) -> Grade ${gradeStr}`)
              }
            } else {
              Logger.debug(`⏭️ Result ${resultIndex + 1}: Grades are the same, skipping: Tahvel="${tahvelGrade}", Kriit="${kriitGrade}"`)
            }
          })
        })
      })

      if (Logger.isDebugMode()) {
        Logger.debug(`=== SYNC DATA COLLECTION COMPLETE: ${syncData.length} items to sync ===`)
      }

      // Check for assignment-level differences even if no grade differences exist
      const assignmentLevelFields = this.getAssignmentLevelSyncFields()
      const assignmentLevelDifferences = []
      if (this.differences && Array.isArray(this.differences)) {
        this.differences.forEach(subject => {
          if (subject.assignments && Array.isArray(subject.assignments)) {
            subject.assignments.forEach(assignment => {
              const changes = this.getAssignmentLevelChanges(assignment, assignmentLevelFields)

              if (changes.length > 0) {
                assignmentLevelDifferences.push({
                  journalId: subject.subjectExternalId,
                  assignmentId: assignment.assignmentExternalId,
                  changes
                })
                Logger.debug(
                  `📋 Found assignment-level difference: ${assignment.assignmentName?.kriit || assignment.assignmentName?.Tahvel || assignment.assignmentExternalId} (${changes.map(change => change.field.statusType).join(', ')})`
                )
              }
            })
          }
        })
      }

      if (syncData.length === 0 && assignmentLevelDifferences.length === 0) {
        Logger.warning('No data to sync after processing')
        Logger.debug('=== SYNC STATUS CHECK ===')
        Logger.debug('syncData is empty and no assignment-level differences found')
        Logger.debug(`Original differences count: ${this.differences ? this.differences.length : 0}`)

        // Count total assignments and results for debugging
        let _totalAssignments = 0
        let _totalResults = 0
        let _skippedResults = 0

        if (this.differences && Array.isArray(this.differences)) {
          this.differences.forEach(subject => {
            if (subject.assignments && Array.isArray(subject.assignments)) {
              _totalAssignments += subject.assignments.length
              subject.assignments.forEach(assignment => {
                if (assignment.results && Array.isArray(assignment.results)) {
                  _totalResults += assignment.results.length
                  assignment.results.forEach(result => {
                    const tahvelGrade = result.currentGrade || '(empty)'
                    const kriitGrade = result.grade || '(empty)'
                    if (tahvelGrade === kriitGrade) {
                      _skippedResults++
                    }
                  })
                }
              })
            }
          })
        }

        // Show a more informative message to the user — but check for newAssignments global cache
        this.isLoading = false
        const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
        if (globalNewAssignments && Object.keys(globalNewAssignments).length > 0) {
          // Clear the error so banner can display the new assignments
          this.error = null
          this.updateUI()
          return
        }
        this.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
        this.updateUI()
        return
      }

      // Log what we're going to sync
      Logger.debug('=== SYNC DATA TO PROCESS ===')
      Logger.debug(`Found ${syncData.length} grade differences to sync`)
      Logger.debug(`Found ${assignmentLevelDifferences.length} assignment-level differences to sync`)
      if (syncData.length > 0) {
        Logger.debug(`Grade differences to sync: ${JSON.stringify(syncData, null, 2)}`)
      }
      if (assignmentLevelDifferences.length > 0) {
        Logger.debug(`Assignment-level differences to sync: ${JSON.stringify(assignmentLevelDifferences, null, 2)}`)
      }

      // Show loading state
      this.isLoading = true
      this.updateUI()

      // Process grade changes grouped by assignment to avoid overwriting assignment-level changes
      const successfulSyncs = []
      const failedSyncs = []

      try {
        // Build assignment-level batches from both grade differences and assignment-level differences
        const assignmentMap = new Map()

        // Add assignments with grade differences
        for (const item of syncData) {
          const key = `${item.journalId}::${item.assignmentId}`
          if (!assignmentMap.has(key)) {
            assignmentMap.set(key, {
              journalId: item.journalId,
              assignmentId: item.assignmentId,
              students: [],
              assignmentLevelOnly: false
            })
          }
          assignmentMap.get(key).students.push({ studentPersonalCode: item.studentPersonalCode, grade: item.grade })
        }

        // Add assignments with assignment-level differences, merging with grade batches when needed.
        for (const assignmentDiff of assignmentLevelDifferences) {
          const key = `${assignmentDiff.journalId}::${assignmentDiff.assignmentId}`
          if (!assignmentMap.has(key)) {
            assignmentMap.set(key, {
              journalId: assignmentDiff.journalId,
              assignmentId: assignmentDiff.assignmentId,
              students: [],
              assignmentLevelOnly: true // Mark as assignment-level only
            })
            Logger.debug(`📋 Added assignment-level only batch: ${assignmentDiff.journalId}/${assignmentDiff.assignmentId}`)
          }

          const batch = assignmentMap.get(key)
          for (const { field, value } of assignmentDiff.changes) {
            batch[field.batchKey] = value
          }
        }

        const batches = Array.from(assignmentMap.values())
        this.updateProgressUI(0, batches.length)

        for (let bi = 0; bi < batches.length; bi++) {
          const batch = batches[bi]
          if (Logger.isDebugMode()) Logger.debug(`Processing assignment batch ${bi + 1}/${batches.length}: ${batch.journalId} / ${batch.assignmentId}`)

          try {
            // Fetch assignment entry once (use per-sync cache)
            const entryCacheKey = `${batch.journalId}::${batch.assignmentId}`
            let entryData = assignmentEntryCache.get(entryCacheKey)
            if (!entryData) {
              const params = batch.students.length > 0 ? { allStudents: true } : {}
              entryData = await this.api.tahvel.get(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, params, { cache: false })
              assignmentEntryCache.set(entryCacheKey, entryData)
            }

            if (!entryData) {
              throw new Error(`No entry data for journal ${batch.journalId} assignment ${batch.assignmentId}`)
            }

            // Build list of student entries to update or add
            const studentsToUpdate = []
            for (const s of batch.students) {
              const personalCode = String(s.studentPersonalCode)
              const targetGrade = s.grade === null ? null : String(s.grade)

              // Try to find existing student entry in assignment data by cached personal codes
              let studentEntry = null
              for (const student of entryData.journalEntryStudents || []) {
                if (!student.journalStudent) continue
                const mappedId = this.journalStudentIdToStudentId[student.journalStudent]
                let cachedStudent = mappedId ? this._localStudentCache?.[mappedId] : null
                if (!cachedStudent) {
                  cachedStudent = await this.getCachedStudent(student.journalStudent)
                  if (mappedId) {
                    if (!this._localStudentCache) this._localStudentCache = {}
                    this._localStudentCache[mappedId] = cachedStudent
                  }
                }
                if (cachedStudent && String(cachedStudent.personalCode) === personalCode) {
                  studentEntry = student
                  break
                }
              }

              // If not found, try fallback by checking journal students mapping
              if (!studentEntry) {
                // Attempt to find journalStudentId by scanning journal students
                const journalStudents = await this.getJournalStudents(batch.journalId)
                if (journalStudents && journalStudents.length > 0) {
                  const match = journalStudents.find(js => js.student && String(js.student.idcode) === personalCode)
                  if (match) {
                    // Try to find an entry in entryData with this journalStudent id
                    const potential = (entryData.journalEntryStudents || []).find(e => String(e.journalStudent) === String(match.id))
                    if (potential) studentEntry = potential
                  }
                }
              }

              // Build updated entry for this student
              let finalStudentEntry = null
              if (studentEntry) {
                // Update existing student's grade
                finalStudentEntry = { ...studentEntry }
                if (targetGrade === null) {
                  // Clearing the grade in Tahvel: set grade to null
                  finalStudentEntry.grade = null
                } else {
                  finalStudentEntry.grade = {
                    code: `KUTSEHINDAMINE_${targetGrade}`,
                    gradingSchemaRowId: null,
                    value: String(targetGrade),
                    value2: String(targetGrade),
                    extraval1: null,
                    extraval2: null,
                    nameEt: `Hinne ${targetGrade}`,
                    nameEn: `Grade ${targetGrade}`,
                    valid: true
                  }
                }
                // ensure removeStudentHistory is present
                finalStudentEntry.removeStudentHistory = true
              } else {
                // Need to add a new student entry - try to get journalStudent id
                const info = await this.getDetailedStudentInfo(personalCode, batch.journalId)
                if (!info || !info.journalStudentId) {
                  throw new Error(`Could not find journalStudentId for personal code ${personalCode} in journal ${batch.journalId}`)
                }
                finalStudentEntry = {
                  id: null,
                  journalStudent: Number(info.journalStudentId),
                  absence: null,
                  // If targetGrade is null, request an empty grade (null) so Tahvel clears it.
                  grade:
                    targetGrade === null
                      ? null
                      : {
                          code: `KUTSEHINDAMINE_${targetGrade}`,
                          gradingSchemaRowId: null,
                          value: String(targetGrade),
                          value2: String(targetGrade),
                          extraval1: null,
                          extraval2: null,
                          nameEt: `Hinne ${targetGrade}`,
                          nameEn: `Grade ${targetGrade}`,
                          valid: true
                        },
                  verbalGrade: null,
                  removeStudentHistory: true,
                  addInfo: this.getAddInfoFromExistingStudents(entryData.journalEntryStudents),
                  isLessonAbsence: false,
                  hasOverlappingLessonAbsence: false,
                  isPraise: false,
                  isRemark: false,
                  lessonAbsences: {},
                  studentName: null,
                  studentGroup: null,
                  journalEntryStudentHistories: [],
                  hasWholeDayAcceptedAbsence: false,
                  wholeDayAbsenceCode: null,
                  gradeValue: null
                }
              }

              // Attach debug-friendly info
              let cachedForName = null
              if (studentEntry) {
                cachedForName = await this.getCachedStudent(studentEntry.journalStudent)
              } else {
                cachedForName = await this.getCachedStudent(finalStudentEntry.journalStudent)
              }
              const studentName = cachedForName ? cachedForName.name : studentEntry ? studentEntry.studentName : 'Unknown'
              const studentPersonal = cachedForName ? cachedForName.personalCode : personalCode

              studentsToUpdate.push({ ...finalStudentEntry, studentName, studentPersonalCode: studentPersonal })
            }

            // Check if this is an assignment-level only batch or has student updates
            const isAssignmentLevelOnly = batch.assignmentLevelOnly === true
            const hasStudentUpdates = studentsToUpdate.length > 0
            const hasAssignmentUpdates = this.getAssignmentLevelBatchChanges(batch).length > 0

            if (!hasStudentUpdates && !isAssignmentLevelOnly) {
              Logger.debug(`No student updates required for assignment ${batch.assignmentId}`)
              successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, skipped: true })
              // update progress
              this.updateProgressUI(bi + 1, batches.length)
              continue
            }

            if (isAssignmentLevelOnly && !hasAssignmentUpdates) {
              Logger.debug(`Assignment-level only batch ${batch.assignmentId} has no actual assignment changes`)
              successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, skipped: true })
              // update progress
              this.updateProgressUI(bi + 1, batches.length)
              continue
            }

            // Prepare update payload based on existing entryData
            const updateData = isAssignmentLevelOnly ? this.buildAssignmentLevelUpdatePayload(entryData) : { ...entryData }

            // For assignment-level-only batches, avoid sending student rows.
            // For batches with student updates, send only the students being updated.
            if (isAssignmentLevelOnly) {
              // Tahvel's metadata-only contract is journalEntryStudents: []. Omitting
              // the field returns 500, while resending old/inactive rows can return 412.
              Logger.debug(`📋 Assignment-level only update: not resubmitting ${entryData.journalEntryStudents?.length || 0} existing students`)
            } else {
              // Replace journalEntryStudents with only students being updated
              updateData.journalEntryStudents = studentsToUpdate.map(s => ({ ...s }))
            }

            // Assignment-level updates: normalize date formats expected by Tahvel
            for (const { field, value } of this.getAssignmentLevelBatchChanges(batch)) {
              if (field.batchKey === 'homeworkDuedate') {
                // homeworkDuedate may come as 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss' - Tahvel expects a full datetime
                const due = this.normalizeTahvelDueDate(value)
                updateData.homeworkDuedate = due
                batch.homeworkDuedate = due
              } else if (field.batchKey === 'entryDate') {
                // entryDate may be 'YYYY-MM-DD' - Tahvel expects full datetime (start of day)
                let entryDate = value
                if (typeof entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
                  entryDate = `${entryDate}T00:00:00Z`
                }
                updateData.entryDate = entryDate
                batch.entryDate = entryDate
              } else {
                updateData[field.batchKey] = value
              }
            }

            // Add Kriit assignment link to homework field
            if (batch.assignmentId) {
              // Use the Kriit API base URL from the API service, trimming any trailing slash and removing '/api' if present
              let kriitBaseUrl = (this.api.kriit.baseUrl || '').replace(/\/$/, '')
              kriitBaseUrl = kriitBaseUrl.replace(/\/api$/, '')

              // Try to get group name from the subject if available
              const subject =
                this.differences && Array.isArray(this.differences) ? this.differences.find(s => s.subjectExternalId === batch.journalId) : null
              const groupCode = subject ? subject.groupName || '' : ''

              const kriitAssignmentUrl = `${kriitBaseUrl}/assignments/${batch.assignmentId}${groupCode ? `?group=${encodeURIComponent(groupCode)}` : ''}`
              const homeworkText = kriitAssignmentUrl ? `Link ülesandele: ${kriitAssignmentUrl}` : 'Link ülesandele: puudub'

              updateData.homework = homeworkText
              Logger.debug(`📋 Added assignment link to homework field: ${homeworkText}`)
            }

            // Ensure teacher IDs and capacity types as in other flows
            if (Array.isArray(updateData.journalEntryTeachers)) {
              updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
            }
            // Set capacity types based on entry type (use the updated type if changed, otherwise use existing)
            const finalEntryType = updateData.entryType || entryData.entryType
            if (finalEntryType === 'SISSEKANNE_I') {
              updateData.journalEntryCapacityTypes = ['MAHT_i']
              if (!updateData.homeworkDuedate && updateData.entryDate) {
                updateData.homeworkDuedate = this.normalizeTahvelDueDate(updateData.entryDate)
              }
            } else if (finalEntryType === 'SISSEKANNE_H') {
              updateData.journalEntryCapacityTypes = ['MAHT_h']
            } else if (finalEntryType === 'SISSEKANNE_P') {
              updateData.journalEntryCapacityTypes = []
            }

            // Filter out students with OPPURSTAATUS_K using mapping similar to syncAssignmentNameDifferences
            if (Array.isArray(updateData.journalEntryStudents)) {
              const studentPromises = updateData.journalEntryStudents.map(async student => {
                const journalStudentId = student.journalStudent
                if (!journalStudentId) return student
                const studentId = this.journalStudentIdToStudentId[journalStudentId]
                if (!studentId) return student
                try {
                  const studentDetails = await this.getStudentDetails(studentId)
                  if (studentDetails && studentDetails.status === 'OPPURSTAATUS_K') return null
                } catch (err) {
                  Logger.warning(`Failed to get student details for ${studentId}: ${err.message}`)
                }
                return student
              })
              updateData.journalEntryStudents = (await Promise.all(studentPromises)).filter(Boolean)
            }

            // Send single PUT for the whole assignment
            try {
              if (Logger.isDebugMode())
                Logger.debug(`PUT /journals/${batch.journalId}/journalEntry/${batch.assignmentId} payload: ${JSON.stringify(updateData)}`)
              await this.api.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, updateData)

              // Notify Kriit about synced grades (for student-level updates only)
              if (!isAssignmentLevelOnly && studentsToUpdate.length > 0) {
                const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, studentsToUpdate)
                if (syncedGrades.length > 0) {
                  await notifyKriitGradesSynced(this.api, syncedGrades)
                }
              }

              // Mark successful - different tracking for assignment-level vs student updates
              if (isAssignmentLevelOnly) {
                successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, assignmentLevelUpdated: true, updated: 0 })
                Logger.debug(`✅ Assignment-level update successful: ${batch.journalId}/${batch.assignmentId}`)
              } else {
                successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, updated: studentsToUpdate.length })
                Logger.debug(`✅ Student grade updates successful: ${studentsToUpdate.length} students in ${batch.journalId}/${batch.assignmentId}`)
              }

              // Update UI status indicators in real-time
              try {
                const { journalSyncBannerService } = await import('./JournalSyncBanner.js')

                this.updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, true)

                // Update grade changes
                for (const s of studentsToUpdate) {
                  const studentCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
                  if (studentCode) {
                    journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, 'grade', true, studentCode)
                  }
                }
              } catch (err) {
                Logger.warning(`Failed to update UI status indicators: ${err.message}`)
              }

              // Update in-memory differences: clear assignment-level diffs and update per-student currentGrade
              try {
                if (Array.isArray(this.differences)) {
                  const subject = this.differences.find(s => s.subjectExternalId === batch.journalId)
                  if (subject && Array.isArray(subject.assignments)) {
                    const assignmentObj = subject.assignments.find(a => a.assignmentExternalId === batch.assignmentId)
                    if (assignmentObj) {
                      this.applyAssignmentLevelChangesToDifference(assignmentObj, batch)
                      // Update results: set currentGrade for synced students
                      if (Array.isArray(assignmentObj.results)) {
                        for (const s of studentsToUpdate) {
                          const targetCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
                          const match = assignmentObj.results.find(r => {
                            const rc = r.studentPersonalCode ? String(r.studentPersonalCode) : ''
                            // Exact match
                            const exactMatch = rc === targetCode
                            // Fallback: compare last 8 digits if both present
                            const targetLast8 = targetCode ? String(targetCode).slice(-8) : null
                            const rcLast8 = rc ? String(rc).slice(-8) : null
                            const last8Match = targetLast8 && rcLast8 && rcLast8 === targetLast8
                            // Fallback by name substring (case-insensitive)
                            let nameMatch = false
                            if (r.studentName && s.studentName) {
                              try {
                                nameMatch = r.studentName.toLowerCase().includes(s.studentName.toLowerCase())
                              } catch (e) {
                                nameMatch = false
                              }
                            }
                            return exactMatch || last8Match || nameMatch
                          })
                          if (match) {
                            match.currentGrade = s.grade?.value || s.grade || (s.gradeValue ? s.gradeValue : null)
                          }
                        }
                      }
                    }
                  }
                }
              } catch (err) {
                Logger.warning(`Failed to update in-memory differences after batch PUT ${batch.assignmentId}: ${err.message}`)
              }
            } catch (err) {
              Logger.error(`Failed to PUT assignment ${batch.assignmentId} in journal ${batch.journalId}: ${err.message}`)
              failedSyncs.push({
                journalId: batch.journalId,
                assignmentId: batch.assignmentId,
                assignmentName: entryData?.nameEt,
                types: this.getSyncFailureTypes(batch, studentsToUpdate.length > 0),
                status: this.getApiErrorStatus(err),
                error: err.message
              })

              // Update UI status indicators to show failure
              try {
                const { journalSyncBannerService } = await import('./JournalSyncBanner.js')

                this.updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, false)

                // Mark grade changes as failed
                for (const s of studentsToUpdate) {
                  const studentCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
                  if (studentCode) {
                    journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, 'grade', false, studentCode)
                  }
                }
              } catch (updateErr) {
                Logger.warning(`Failed to update failure UI status indicators: ${updateErr.message}`)
              }
            }

            // Update progress UI per assignment
            try {
              this.updateProgressUI(bi + 1, batches.length)
            } catch (err) {
              Logger.warning(`Progress UI update failed for batch ${bi}: ${err.message}`)
            }
          } catch (err) {
            Logger.error(`Error processing assignment batch ${batch.journalId}/${batch.assignmentId}: ${err.message}`)
            failedSyncs.push({
              journalId: batch.journalId,
              assignmentId: batch.assignmentId,
              assignmentName: batch.nameEt,
              types: this.getSyncFailureTypes(batch, batch.students.length > 0),
              status: this.getApiErrorStatus(err),
              error: err.message
            })
          }

          // Small delay between batches to reduce server load
          if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 500))
        }

        // After batch processing complete, set results and refresh UI similar to previous logic
        const actualUpdates = successfulSyncs.reduce((acc, s) => acc + (s.updated || 0), 0)
        const assignmentLevelUpdates = successfulSyncs.filter(s => s.assignmentLevelUpdated).length
        const skippedUpdates = successfulSyncs.filter(s => s.skipped).length

        // Count specific types of changes from batches
        const assignmentLevelCounts = new Map(
          this.getAssignmentLevelSyncFields().map(field => [field.statusType, { count: 0, label: field.successLabel }])
        )
        for (const batch of batches) {
          if (successfulSyncs.some(s => s.journalId === batch.journalId && s.assignmentId === batch.assignmentId)) {
            for (const { field } of this.getAssignmentLevelBatchChanges(batch)) {
              const item = assignmentLevelCounts.get(field.statusType)
              if (item) item.count++
            }
          }
        }

        // Show success or partial messages
        const successfulChangeCount = this.countSuccessfulSyncChanges(successfulSyncs, batches)
        this.isLoading = false
        if (failedSyncs.length === 0) {
          let successMessage = ''

          if (actualUpdates > 0 || assignmentLevelUpdates > 0) {
            const parts = []
            if (actualUpdates > 0) {
              parts.push(`${actualUpdates} hinnet`)
            }
            for (const { count, label } of assignmentLevelCounts.values()) {
              if (count > 0) parts.push(`${count} ${label}`)
            }

            if (parts.length > 0) {
              successMessage = `Edukalt sünkroniseeritud ${parts.join(', ')} Kriidist Tahvlisse.`
            } else {
              successMessage = `Edukalt sünkroniseeritud Kriidist Tahvlisse.`
            }

            if (skippedUpdates > 0) successMessage += ` ${skippedUpdates} kirjet olid juba õiged.`
            successMessage += ` Andmed värskendatakse automaatselt mõne sekundi pärast...`
          } else {
            successMessage = `Kõik ${successfulSyncs.length} kirjet olid juba õiged - pole midagi sünkroniseerida.`
          }
          this.showSuccessBanner(successMessage)

          // Refresh data after clearing cache
          setTimeout(() => {
            this.clearCache()
              .then(() => this.fetchJournalData())
              .catch(() => this.fetchJournalData())
          }, 3000)
        } else {
          this.error = this.buildSyncFailureMessage(failedSyncs, successfulChangeCount)
          this.updateUI()
          return { successfulSyncs, failedSyncs, successfulChangeCount }
        }
        return { successfulSyncs, failedSyncs, successfulChangeCount }
      } catch (error) {
        Logger.error('Unexpected error during batch sync process:', error)
        this.isLoading = false
        this.error = 'Sünkroniseerimine ebaõnnestus ootamatu vea tõttu.'
        this.updateUI()
        return { successfulSyncs, failedSyncs: [{ status: this.getApiErrorStatus(error), error: error.message }] }
      }
    } catch (error) {
      Logger.error('Error syncing with Kriit:', error)
      this.isLoading = false
      this.error = error.message || 'Failed to sync with Kriit'
      this.updateUI()
      return { successfulSyncs: [], failedSyncs: [{ status: this.getApiErrorStatus(error), error: error.message }] }
    }
  }

  /**
   * Sync a single grade from Kriit to Tahvel
   * @param {number} journalId - Journal ID
   * @param {number} assignmentId - Assignment ID
   * @param {string} studentPersonalCode - Student personal code
   * @param {string|number} grade - Grade to set (numeric 1-5, MA, or A)
   * @returns {Promise<Object>} Response data
   */
  async syncGradeToTahvel(journalId, assignmentId, studentPersonalCode, grade) {
    try {
      Logger.debug('=== STARTING GRADE SYNC ===')
      if (Logger.isDebugMode()) {
        Logger.debug(`Syncing grade for student ${studentPersonalCode} in assignment ${assignmentId}`)
      }
      Logger.debug(
        `Full sync parameters: journalId=${journalId}, assignmentId=${assignmentId}, studentPersonalCode=${studentPersonalCode}, grade=${grade}`
      )

      // Validate input parameters
      if (!journalId) {
        throw new Error('Journal ID is required for syncing grades')
      }

      if (!assignmentId) {
        throw new Error('Assignment ID is required for syncing grades')
      }

      if (!studentPersonalCode) {
        throw new Error('Student personal code is required for syncing grades')
      }

      // Ensure studentPersonalCode is a string - convert if necessary
      if (typeof studentPersonalCode !== 'string') {
        Logger.debug(`Converting studentPersonalCode from ${typeof studentPersonalCode} to string: ${studentPersonalCode}`)
        studentPersonalCode = String(studentPersonalCode)
      }

      // Proactive check: verify student is active before attempting sync
      Logger.debug(`Checking if student ${studentPersonalCode} is active before sync...`)

      // First, try to find the student by getting journal students
      let studentCacheEntry = null
      const journalStudentsForValidation = await this.getJournalStudents(journalId)

      if (journalStudentsForValidation) {
        for (const journalStudent of journalStudentsForValidation) {
          if (journalStudent.student && journalStudent.student.idcode === studentPersonalCode) {
            studentCacheEntry = {
              personalCode: journalStudent.student.idcode,
              name: journalStudent.student.fullname || journalStudent.studentName,
              isActive: journalStudent.student.status === 'OPPURSTAATUS_O',
              isDeleted: false // Assume false if student is in journal
            }
            break
          }
        }
      }

      // If we found the student in cache, check their status
      if (studentCacheEntry) {
        Logger.debug(
          `Found student ${studentCacheEntry.name} (${studentPersonalCode}) in cache. Active: ${studentCacheEntry.isActive}, Deleted: ${studentCacheEntry.isDeleted}`
        )

        if (!studentCacheEntry.isActive || studentCacheEntry.isDeleted) {
          const statusReason = studentCacheEntry.isDeleted ? 'deleted' : 'inactive'
          throw new Error(
            `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student's status is ${statusReason} in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`
          )
        }
      } else {
        Logger.warning(
          `Student ${studentPersonalCode} not found in cache during proactive check. Will proceed with sync attempt but may fail if student is inactive.`
        )
      }

      if (!grade) {
        throw new Error('Grade value is required for syncing grades')
      }

      // Validate that grade is either numeric (1-5) or valid Estonian vocational grade (MA, A)
      const gradeStr = String(grade).toUpperCase()
      const numericGrade = parseInt(gradeStr, 10)

      // Allow numeric grades 1-5 or Estonian vocational grades MA (Mittearvestatav) and A (Arvestatud)
      const isValidNumeric = !isNaN(numericGrade) && numericGrade >= 1 && numericGrade <= 5
      const isValidNonNumeric = gradeStr === 'MA' || gradeStr === 'A'

      if (!isValidNumeric && !isValidNonNumeric) {
        throw new Error(`Invalid grade value: ${grade}. Expected numeric grade 1-5, MA (Mittearvestatav), or A (Arvestatud).`)
      }

      // Use the grade directly (numeric or Estonian vocational grade)
      if (Logger.isDebugMode()) {
        Logger.debug(`Syncing grade ${grade} directly to Tahvel`)
      }

      // First, get the current entry data - prefer instance-level cache to avoid repeated requests
      let entryData
      try {
        if (!this._assignmentEntryCache) this._assignmentEntryCache = new Map()
        const entryCacheKey = `${journalId}::${assignmentId}`
        entryData = this._assignmentEntryCache.get(entryCacheKey)
        if (!entryData) {
          // Fetch fresh data and cache it for the lifetime of this feature instance
          entryData = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${assignmentId}`, { allStudents: true })
          this._assignmentEntryCache.set(entryCacheKey, entryData)
        }
      } catch (error) {
        throw new Error(`Failed to fetch assignment data: ${error.message}. Check if the assignment still exists in Tahvel.`)
      }

      if (!entryData) {
        throw new Error(`No data returned for assignment ${assignmentId}. The assignment may have been deleted.`)
      }

      if (!entryData.journalEntryStudents || !Array.isArray(entryData.journalEntryStudents)) {
        throw new Error(`Assignment ${assignmentId} has no student data. Structure: ${JSON.stringify(Object.keys(entryData))}`)
      }

      // Log the number of students in the entry for debugging
      if (Logger.isDebugMode()) {
        Logger.debug(`Assignment ${assignmentId} has ${entryData.journalEntryStudents.length} students`)
      }

      // === ENHANCED DEBUG: LOG ALL STUDENTS IN ASSIGNMENT ===
      if (Logger.isDebugMode()) {
        Logger.debug('=== ALL STUDENTS IN ASSIGNMENT ===')
        for (let i = 0; i < entryData.journalEntryStudents.length; i++) {
          const student = entryData.journalEntryStudents[i]
          const studentId = student.journalStudent

          if (studentId) {
            // Try to use local sync cache first
            const mappedId = this.journalStudentIdToStudentId[studentId]
            let cachedStudent = mappedId ? this._localStudentCache?.[mappedId] : null
            if (!cachedStudent) {
              cachedStudent = await this.getCachedStudent(studentId)
              if (mappedId) {
                if (!this._localStudentCache) this._localStudentCache = {}
                this._localStudentCache[mappedId] = cachedStudent
              }
            }
            const personalCode = cachedStudent ? cachedStudent.personalCode : 'UNKNOWN_PERSONAL_CODE'
            const name = cachedStudent ? cachedStudent.name : student.studentName || 'UNKNOWN_NAME'
            const isActive = cachedStudent ? cachedStudent.isActive : 'UNKNOWN_STATUS'
            const currentGrade = student.grade?.code || 'NO_GRADE'

            Logger.debug(
              `Assignment Student ${i + 1}: "${name}" | PersonalCode: "${personalCode}" | Active: ${isActive} | Grade: ${currentGrade} | JournalStudentId: ${studentId} | EntryId: ${student.id}`
            )
          } else {
            Logger.debug(`Assignment Student ${i + 1}: NO journalStudent ID | EntryId: ${student.id}`)
          }
        }
        Logger.debug('=== END ALL STUDENTS IN ASSIGNMENT ===')
      }

      // Check if target student is in assignment
      let targetStudentInAssignment = null
      for (const student of entryData.journalEntryStudents) {
        if (student.journalStudent) {
          const cachedStudent = await this.getCachedStudent(student.journalStudent)
          if (cachedStudent && String(cachedStudent.personalCode) === String(studentPersonalCode)) {
            targetStudentInAssignment = student
            if (Logger.isDebugMode()) {
              Logger.debug(`✅ Target student FOUND in assignment: ${cachedStudent.name} (${cachedStudent.personalCode})`)
            }
            break
          }
        }
      }

      if (!targetStudentInAssignment) {
        Logger.warning(`❌ Target student with personal code "${studentPersonalCode}" NOT FOUND in assignment ${assignmentId}`)
      }

      // Log the target personal code we're looking for
      if (Logger.isDebugMode()) {
        Logger.debug(`Looking for student with personal code: ${studentPersonalCode}`)
      }

      // === ENHANCED DEBUG: LOG ALL JOURNAL STUDENTS ===
      const journalStudentsForMatching = await this.getJournalStudents(journalId)

      if (Logger.isDebugMode()) {
        Logger.debug('=== FETCHING JOURNAL STUDENTS FOR DEBUGGING ===')

        if (journalStudentsForMatching && journalStudentsForMatching.length > 0) {
          Logger.debug(`Found ${journalStudentsForMatching.length} students in journal ${journalId}`)

          // Log all students with their personal codes for debugging
          Logger.debug('=== ALL STUDENTS IN JOURNAL ===')
          journalStudentsForMatching.forEach((js, index) => {
            const studentData = js.student || {}
            const personalCode = studentData.idcode || 'NO_PERSONAL_CODE'
            const fullName = studentData.fullname || js.studentName || 'NO_NAME'
            const status = studentData.status || 'NO_STATUS'
            const isActive = status === 'OPPURSTAATUS_O'

            Logger.debug(
              `Student ${index + 1}: "${fullName}" | PersonalCode: "${personalCode}" | Status: "${status}" | Active: ${isActive} | StudentId: ${js.studentId} | JournalStudentId: ${js.id}`
            )
          })
          Logger.debug('=== END ALL STUDENTS IN JOURNAL ===')

          // Check for exact matches
          const exactMatches = journalStudentsForMatching.filter(js => js.student && String(js.student.idcode) === String(studentPersonalCode))

          if (exactMatches.length > 0) {
            Logger.debug(`✅ Found ${exactMatches.length} exact match(es) for personal code ${studentPersonalCode}`)
            exactMatches.forEach((match, index) => {
              Logger.debug(
                `Exact match ${index + 1}: ${match.student.fullname} | Status: ${match.student.status} | Active: ${match.student.status === 'OPPURSTAATUS_O'}`
              )
            })
          } else {
            Logger.debug(`❌ NO exact matches found for personal code "${studentPersonalCode}"`)

            // Look for partial matches
            const partialMatches = journalStudentsForMatching.filter(js => {
              if (!js.student || !js.student.idcode) return false
              const studentCode = String(js.student.idcode)
              return studentCode.includes(String(studentPersonalCode)) || String(studentPersonalCode).includes(studentCode)
            })

            if (partialMatches.length > 0) {
              Logger.debug(`Found ${partialMatches.length} partial match(es):`)
              partialMatches.forEach((match, index) => {
                Logger.debug(`Partial match ${index + 1}: ${match.student.fullname} | PersonalCode: "${match.student.idcode}"`)
              })
            } else {
              Logger.debug(`🔍 NO partial matches found either. Target: "${studentPersonalCode}"`)

              // Show first few students for comparison
              const firstFewStudents = journalStudentsForMatching.slice(0, 3)
              Logger.debug('Sample students for comparison:')
              firstFewStudents.forEach((js, index) => {
                const personalCode = js.student?.idcode || 'NO_CODE'
                Logger.debug(`Sample ${index + 1}: PersonalCode="${personalCode}" | Type: ${typeof personalCode}`)
              })
            }
          }
        } else {
          Logger.debug(`❌ NO journal students found for journal ${journalId}`)
        }
        Logger.debug('=== END JOURNAL STUDENTS DEBUGGING ===')
      }

      // Ensure we have journal students data (this will use caching)
      await this.getJournalStudents(journalId)

      // First, try to find the student by personal code using journal students
      // This is more reliable than searching through the entry data
      let matchingStudentId = null

      // Convert target personal code to string for comparison
      const targetPersonalCode = String(studentPersonalCode)

      if (journalStudentsForMatching) {
        for (const journalStudent of journalStudentsForMatching) {
          if (journalStudent.student && journalStudent.student.idcode === targetPersonalCode) {
            matchingStudentId = journalStudent.studentId
            Logger.debug(
              `Found exact matching student in journal students: ${journalStudent.student.fullname || journalStudent.studentName} (${journalStudent.student.idcode})`
            )
            break
          }
        }
      }

      // If we found the student in our global cache, find that student in the entry data
      let studentEntry = null
      if (matchingStudentId) {
        studentEntry = entryData.journalEntryStudents.find(
          student => student.journalStudent && String(student.journalStudent) === String(matchingStudentId)
        )

        if (studentEntry) {
          Logger.debug(`Found matching student entry in assignment data: ${studentEntry.journalStudent}`)
        } else {
          // This is a special case: we found the student in journal students but they're not in this assignment API response
          const cachedStudent = await this.getCachedStudent(matchingStudentId)
          const studentName = cachedStudent ? cachedStudent.name : 'Unknown'

          Logger.warning(
            `Student ${studentName} (${targetPersonalCode}) with ID ${matchingStudentId} found in global cache but not in assignment API response`
          )
          Logger.warning(`This may indicate an API discrepancy - student exists in database but not returned by /journalEntry/${assignmentId}`)

          // Get detailed student info to find the correct journalStudentId
          const info = await this.getDetailedStudentInfo(targetPersonalCode, journalId)
          Logger.debug(`Detailed student info for ${targetPersonalCode}: ${JSON.stringify(info)}`)

          // Try to create a student entry with the journalStudentId
          // This handles cases where the API doesn't return all enrolled students but they exist in the database
          if (info.journalStudentId) {
            // Create a new student entry with the correct journalStudentId
            studentEntry = {
              journalStudent: info.journalStudentId,
              id: null, // This will be assigned by the server
              studentName: cachedStudent ? cachedStudent.name : 'Unknown',
              grade: null, // Will be set later
              addInfo: null,
              absence: null,
              absenceInserted: null,
              gradeInserted: null,
              gradeInsertedBy: null,
              inserted: null,
              isRemark: false,
              journalEntryStudentHistories: [],
              lessonAbsences: [],
              verbalGrade: null
            }

            if (Logger.isDebugMode()) {
              Logger.debug(`Created student entry with journalStudentId ${info.journalStudentId} to handle API discrepancy`)
              Logger.debug(`Database shows student is enrolled - proceeding with sync despite API inconsistency`)
            }
            Logger.debug(`Student entry created successfully, studentEntry.journalStudent = ${studentEntry.journalStudent}`)
          } else {
            // If we couldn't find a journalStudentId, check if the student is active
            if (cachedStudent && !cachedStudent.isActive) {
              Logger.warning(`Student ${studentName} (${targetPersonalCode}) is not active. Status: ${cachedStudent.isActive ? 'Active' : 'Inactive'}`)
              throw new Error(
                `Cannot add student ${studentName} (${targetPersonalCode}) to the assignment because they are not actively studying. The student may be on academic leave or their status is inactive.`
              )
            }

            // If we couldn't find a journalStudentId, throw an error
            throw new Error(
              `❌ Student ${studentName} (${targetPersonalCode}) exists in the journal but has no valid journal student ID. This may indicate a data integrity issue. Please contact support.`
            )
          }
        }
      }

      // If we still don't have a match, try the old method of searching through entry data
      Logger.debug(
        `Checking if studentEntry exists. studentEntry: ${studentEntry ? 'EXISTS' : 'NULL'}, journalStudent: ${studentEntry?.journalStudent || 'N/A'}`
      )
      if (!studentEntry) {
        Logger.debug(`Falling back to searching through entry data for student with personal code ${studentPersonalCode}`)

        // === ENHANCED DEBUG: DETAILED FALLBACK SEARCH ===
        if (Logger.isDebugMode()) {
          Logger.debug('=== STARTING FALLBACK SEARCH IN ASSIGNMENT DATA ===')
          Logger.debug(`Looking for student with personal code: "${studentPersonalCode}" (type: ${typeof studentPersonalCode})`)

          // First, log all students in the entry data for debugging
          Logger.debug('All students in entry data with cached info:')
          for (let i = 0; i < entryData.journalEntryStudents.length; i++) {
            const student = entryData.journalEntryStudents[i]
            const studentId = student.journalStudent

            if (studentId) {
              const cachedStudent = await this.getCachedStudent(studentId)
              const personalCode = cachedStudent ? cachedStudent.personalCode : 'Unknown'
              const name = cachedStudent ? cachedStudent.name : 'Unknown'
              Logger.debug(
                `- Student ${i + 1}: ID: ${student.id}, journalStudent: ${studentId}, personalCode: "${personalCode}" (type: ${typeof personalCode}), name: "${name}", addInfo: ${student.addInfo}`
              )
            } else {
              Logger.debug(`- Student ${i + 1}: ID: ${student.id}, NO journalStudent ID, addInfo: ${student.addInfo}`)
            }
          }
        }

        // Find student by iterating through entry data and checking cache
        for (const student of entryData.journalEntryStudents) {
          // We need to find the student by personal code, but the entry data doesn't have it directly
          if (!student.journalStudent) {
            continue
          }

          // Try to find the student in our cache
          const studentId = student.journalStudent

          // Check if we have this student in our cache
          const cachedStudent = await this.getCachedStudent(studentId)
          if (cachedStudent) {
            // Ensure the cached student has a personalCode property
            if (!cachedStudent.personalCode) {
              continue
            }

            // Convert both to strings for comparison to handle number vs string issues
            const cachedPersonalCode = String(cachedStudent.personalCode)

            // Now we can safely compare the personal codes
            const matches = cachedPersonalCode === targetPersonalCode

            if (matches) {
              if (Logger.isDebugMode()) {
                Logger.debug(`✅ Found exact matching student in entry data: ${cachedStudent.name} (${cachedPersonalCode})`)
              }
              Logger.debug(`Student entry details: ID=${student.id}, journalStudent=${student.journalStudent}, addInfo=${student.addInfo}`)
              studentEntry = student
              break
            }
          }
        }

        // If we couldn't find the student by personal code, try to find by similar personal code
        // but DO NOT substitute with a completely different student
        if (!studentEntry) {
          Logger.warning(`❌ Could not find student with exact personal code ${studentPersonalCode}, trying to find similar personal codes...`)

          // === ENHANCED DEBUG: SIMILARITY MATCHING ===
          if (Logger.isDebugMode()) {
            Logger.debug('=== TRYING SIMILARITY MATCHING ===')

            // Try to find a student with a similar personal code
            // This is useful if the personal code formats are different (e.g., with/without leading zeros)
            const targetPersonalCode = String(studentPersonalCode)
            Logger.debug(`Target personal code for similarity matching: "${targetPersonalCode}"`)
          }

          // First, try to find a student with a similar personal code
          for (const student of entryData.journalEntryStudents) {
            if (!student.journalStudent) continue

            const cachedStudent = await this.getCachedStudent(student.journalStudent)
            if (!cachedStudent || !cachedStudent.personalCode) continue

            const cachedPersonalCode = String(cachedStudent.personalCode)
            Logger.debug(`Comparing "${targetPersonalCode}" with "${cachedPersonalCode}"`)

            // Check if the personal codes are similar (one contains the other)
            if (cachedPersonalCode.includes(targetPersonalCode) || targetPersonalCode.includes(cachedPersonalCode)) {
              Logger.warning(`⚠️ Found student with similar personal code: ${cachedStudent.name} (${cachedPersonalCode}) - SUBSTRING MATCH`)
              studentEntry = student
              break
            }

            // Check if the last 8 digits match (sometimes personal codes have different formats)
            const cachedLastDigits = cachedPersonalCode.slice(-8)
            const targetLastDigits = targetPersonalCode.slice(-8)
            if (cachedLastDigits === targetLastDigits && cachedLastDigits.length === 8) {
              Logger.warning(`⚠️ Found student with matching last 8 digits: ${cachedStudent.name} (${cachedPersonalCode}) - LAST 8 DIGITS MATCH`)
              studentEntry = student
              break
            }
          }

          if (Logger.isDebugMode()) {
            Logger.debug('=== END SIMILARITY MATCHING ===')
          }

          // If we still don't have a match, DO NOT use a random student as fallback
          // Instead, throw an error to prevent updating the wrong student's grade
          if (!studentEntry) {
            Logger.error(
              `🚫 FINAL RESULT: Could not find student with personal code ${studentPersonalCode} or any similar personal code. Refusing to update a different student's grade for safety reasons.`
            )
            throw new Error(
              `Could not find student with personal code ${studentPersonalCode} or any similar personal code. Refusing to update a different student's grade for safety reasons.`
            )
          }
        }

        if (Logger.isDebugMode()) {
          Logger.debug('=== END FALLBACK SEARCH ===')
        }
      }

      // Final check: ensure we have a valid student entry
      if (!studentEntry) {
        // Build a helpful error message
        let errorMessage = `Student with personal code ${studentPersonalCode} not found in assignment ${assignmentId}.`

        // Add more specific diagnostic information
        errorMessage += `\n\nDiagnostic Info:`
        errorMessage += `\n- Assignment ID: ${assignmentId}`
        errorMessage += `\n- Journal ID: ${journalId}`
        errorMessage += `\n- Students in assignment: ${entryData.journalEntryStudents.length}`

        // Check if student exists in journal students
        const journalStudentsForCheck = await this.getJournalStudents(journalId)
        let studentInJournal = null

        if (journalStudentsForCheck) {
          for (const journalStudent of journalStudentsForCheck) {
            if (journalStudent.student && journalStudent.student.idcode === String(studentPersonalCode)) {
              studentInJournal = {
                name: journalStudent.student.fullname || journalStudent.studentName,
                personalCode: journalStudent.student.idcode,
                isActive: journalStudent.student.status === 'OPPURSTAATUS_O'
              }
              break
            }
          }
        }

        if (studentInJournal) {
          errorMessage += `\n- Student EXISTS in journal: ${studentInJournal.name} (${studentInJournal.personalCode})`
          errorMessage += `\n- Student status: ${studentInJournal.isActive ? 'Active' : 'Inactive'}`
          errorMessage += `\n- This means the student is NOT enrolled in this specific assignment`
          errorMessage += `\n\nSOLUTION: The student needs to be manually added to this assignment in Tahvel first, then you can sync the grade.`
        } else {
          errorMessage += `\n- Student NOT FOUND in journal`
          errorMessage += `\n- This means the student is not enrolled in this journal at all`
        }

        throw new Error(errorMessage)
      }

      // Check if we have a valid journalStudent ID
      if (!studentEntry.journalStudent) {
        // We need to wait for the journalStudentId from getDetailedStudentInfo
        Logger.warning(`No valid journalStudent ID found for student ${studentPersonalCode}. Cannot proceed with update.`)
        throw new Error(
          `No valid journalStudent ID found for student ${studentPersonalCode}. Cannot proceed with update. This might be because the student is not enrolled in this journal.`
        )
      }

      // Log the current grade for debugging
      const currentGradeCode = studentEntry.grade?.code || 'No grade'
      Logger.debug(`Current grade for student ${studentPersonalCode}: ${currentGradeCode}`)

      // If we're using a fallback student, log a warning
      const cachedStudentForFallback = await this.getCachedStudent(studentEntry.journalStudent)
      if (cachedStudentForFallback && String(cachedStudentForFallback.personalCode) !== String(studentPersonalCode)) {
        Logger.warning(
          `WARNING: Using fallback student ${cachedStudentForFallback.name} (${cachedStudentForFallback.personalCode}) instead of requested student with personal code ${studentPersonalCode}`
        )
      }

      Logger.debug(`About to prepare update data. studentEntry.journalStudent = ${studentEntry.journalStudent}`)

      // Prepare the update data - following the exact structure used by the Angular app
      // Create the updated student entry with the new grade
      const updatedStudentEntry = {
        id: studentEntry.id, // This might be null for new students
        journalStudent: Number(studentEntry.journalStudent), // Convert to number to match Angular's format
        absence: null,
        grade: {
          code: `KUTSEHINDAMINE_${grade}`,
          gradingSchemaRowId: null,
          value: String(grade),
          value2: String(grade),
          extraval1: null,
          extraval2: null,
          nameEt: `Hinne ${grade}`,
          nameEn: `Grade ${grade}`,
          valid: true
        },
        verbalGrade: null,
        removeStudentHistory: true, // Don't remove history for grade updates
        // For addInfo, we'll use the pattern from existing students or a default
        addInfo: this.getAddInfoFromExistingStudents(entryData.journalEntryStudents),
        isLessonAbsence: false,
        hasOverlappingLessonAbsence: false,
        isPraise: false,
        isRemark: false,
        lessonAbsences: {},
        studentName: null,
        studentGroup: null,
        journalEntryStudentHistories: [],
        hasWholeDayAcceptedAbsence: false,
        wholeDayAbsenceCode: null,
        gradeValue: null
      }

      // Create the update data with ONLY the student we're updating
      // This prevents 412 errors caused by inactive students in the assignment
      const existingStudentIndex = entryData.journalEntryStudents.findIndex(
        student => student.journalStudent && Number(student.journalStudent) === Number(updatedStudentEntry.journalStudent)
      )

      let finalStudentEntry
      if (existingStudentIndex !== -1) {
        // If the student is already in the entry, update their entry
        if (Logger.isDebugMode()) {
          Logger.debug(`Student ${studentPersonalCode} is already in the assignment. Updating existing entry.`)
        }

        // Get the original student entry
        const originalStudentEntry = entryData.journalEntryStudents[existingStudentIndex]
        Logger.debug(
          `Original student entry: ${JSON.stringify({
            id: originalStudentEntry.id,
            journalStudent: originalStudentEntry.journalStudent,
            addInfo: originalStudentEntry.addInfo,
            grade: originalStudentEntry.grade?.code || 'No grade'
          })}`
        )

        // Only update the grade, keeping all other fields intact
        finalStudentEntry = {
          ...originalStudentEntry,
          grade: updatedStudentEntry.grade,
          // Make sure to keep the original ID
          id: originalStudentEntry.id,
          // Don't remove student history when updating existing student
          removeStudentHistory: true
        }
      } else {
        // If the student is not in the entry, use the new entry
        if (Logger.isDebugMode()) {
          Logger.debug(`Student ${studentPersonalCode} is not in the assignment. Adding new entry.`)
        }
        finalStudentEntry = updatedStudentEntry
      }

      // Check if this specific student is active before sending the update
      const cachedStudentForStatus = await this.getCachedStudent(finalStudentEntry.journalStudent)
      if (cachedStudentForStatus && (!cachedStudentForStatus.isActive || cachedStudentForStatus.isDeleted)) {
        const statusReason = cachedStudentForStatus.isDeleted ? 'deleted' : 'inactive'
        throw new Error(
          `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student's status is ${statusReason} in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`
        )
      }

      // Create array with only the student we're updating to avoid 412 errors from inactive students
      const studentsToUpdate = [finalStudentEntry]

      // Add student names to the entry for debugging purposes
      const studentsWithNames = []
      for (const student of studentsToUpdate) {
        // Use the cache lookup helper method
        const cachedStudent = await this.getCachedStudent(student.journalStudent)
        const studentName = cachedStudent ? cachedStudent.name : 'Unknown'
        const studentPersonalCode = cachedStudent ? cachedStudent.personalCode : 'Unknown'
        const isActive = cachedStudent ? cachedStudent.isActive : 'Unknown'
        const isDeleted = cachedStudent ? cachedStudent.isDeleted : 'Unknown'
        const gradeCode = student.grade?.code || 'No grade'

        if (Logger.isDebugMode()) {
          Logger.debug(
            `Student: ${studentName} (${studentPersonalCode}) - Active: ${isActive}, Deleted: ${isDeleted}, Grade: ${gradeCode}, JournalStudentId: ${student.journalStudent}`
          )
        }

        studentsWithNames.push({
          ...student,
          // Add student name for debugging
          studentName: studentName,
          // Also add personal code for easier identification
          studentPersonalCode: studentPersonalCode
        })
      }

      // Create the update data with filtered students that include names
      const updateData = {
        ...entryData,
        journalEntryStudents: studentsWithNames
      }

      // Make sure we include all the fields that the Angular app includes
      if (!updateData.version && entryData.version) {
        updateData.version = entryData.version
      }

      // Ensure teacher information is in the correct format
      if (entryData.teacherSelection && Array.isArray(entryData.teacherSelection)) {
        updateData.teacherSelection = entryData.teacherSelection
      }

      // Convert journalEntryTeachers to strings if they're not already
      if (Array.isArray(updateData.journalEntryTeachers)) {
        updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
      }

      // Make sure we have the correct capacity types (only if not already set)
      // Note: Empty array is valid for SISSEKANNE_P, so don't treat it as missing
      if (!updateData.journalEntryCapacityTypes) {
        // Set default capacity types based on entry type
        if (entryData.entryType === 'SISSEKANNE_I') {
          updateData.journalEntryCapacityTypes = ['MAHT_i']
        } else if (entryData.entryType === 'SISSEKANNE_H') {
          updateData.journalEntryCapacityTypes = ['MAHT_h']
        } else if (entryData.entryType === 'SISSEKANNE_P') {
          updateData.journalEntryCapacityTypes = []
        }
      }

      // Convert teacher IDs from numbers to strings for the PUT request
      if (Array.isArray(updateData.journalEntryTeachers)) {
        updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => id.toString())
      }

      // Log the update data for debugging
      Logger.debug(`Sending update for assignment ${assignmentId}, student ${studentPersonalCode}, new grade: ${grade}`)

      // Log whether we're adding a new student or updating an existing one
      if (studentEntry.id) {
        if (Logger.isDebugMode()) {
          Logger.debug(`Updating grade for existing student ${studentPersonalCode} in assignment ${assignmentId}`)
        } else {
          Logger.debug(`Adding new student ${studentPersonalCode} to assignment ${assignmentId} with grade ${grade}`)
        }
      }

      // Log the student being sent in the update
      Logger.debug(`Sending update with student: ${studentEntry.studentName || 'Unknown'} (${studentEntry.journalStudent}) with grade ${grade}`)

      // Log the structure of the update data
      Logger.debug(`Update data structure: ${Object.keys(updateData).join(', ')}`)
      Logger.debug(`Student entry structure: ${Object.keys(updatedStudentEntry).join(', ')}`)

      // Log the number of students in the update (should be 1 now)
      if (Logger.isDebugMode()) {
        Logger.debug(
          `Sending update with ${updateData.journalEntryStudents.length} student (${existingStudentIndex !== -1 ? 'updating existing' : 'adding new'} student)`
        )
      }

      // Enhanced logging: Log the specific student being updated
      if (Logger.isDebugMode()) {
        Logger.debug('=== STUDENT BEING UPDATED ===')
        for (const [_index, student] of updateData.journalEntryStudents.entries()) {
          const cachedStudentInfo = await this.getCachedStudent(student.journalStudent)
          const studentName = cachedStudentInfo ? cachedStudentInfo.name : 'Unknown'
          const personalCode = cachedStudentInfo ? cachedStudentInfo.personalCode : 'Unknown'
          const isActive = cachedStudentInfo ? cachedStudentInfo.isActive : 'Unknown'
          const isDeleted = cachedStudentInfo ? cachedStudentInfo.isDeleted : 'Unknown'
          const gradeCode = student.grade?.code || 'No grade'

          Logger.debug(
            `Student: ${studentName} (${personalCode}) - Active: ${isActive}, Deleted: ${isDeleted}, Grade: ${gradeCode}, JournalStudentId: ${student.journalStudent}`
          )
        }
        Logger.debug('=== END STUDENT BEING UPDATED ===')
      }

      // Send the update request
      let response
      try {
        if (Logger.isDebugMode()) {
          Logger.debug(`Sending PUT request to /journals/${journalId}/journalEntry/${assignmentId}`)
        }
        Logger.debug(`PUT request data: ${JSON.stringify(updateData)}`)

        // Log the request URL for debugging
        const requestUrl = `${this.api.tahvel.baseUrl}/journals/${journalId}/journalEntry/${assignmentId}`
        Logger.debug(`Full request URL: ${requestUrl}`)

        // Add a timestamp to track how long the request takes
        const startTime = Date.now()
        Logger.debug(`Starting PUT request at ${new Date().toISOString()}`)

        response = await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

        // Log the time it took to complete the request
        const endTime = Date.now()
        Logger.debug(`PUT request completed in ${endTime - startTime}ms`)

        // Notify Kriit about synced grades
        const syncedGrades = buildGradesForNotification(journalId, assignmentId, updateData.journalEntryStudents)
        if (syncedGrades.length > 0) {
          await notifyKriitGradesSynced(this.api, syncedGrades)
          Logger.info(`Notified Kriit about ${syncedGrades.length} synced grade(s) for assignment ${assignmentId}`)
        }

        // Log detailed response information
        Logger.debug(`Response type: ${typeof response}`)
        Logger.debug(`Response value: ${response}`)
        Logger.debug(`Response JSON: ${JSON.stringify(response)}`)
        Logger.debug(`Response is null: ${response === null}`)
        Logger.debug(`Response is undefined: ${response === undefined}`)
        Logger.debug(`Response is empty string: ${response === ''}`)
        Logger.debug(`Response is falsy: ${!response}`)
      } catch (error) {
        // Provide detailed error information
        let errorMessage = `Failed to update grade in Tahvel: ${error.message}`

        // Check for common error cases
        if (error.message.includes('403')) {
          errorMessage = 'Permission denied. You may not have rights to modify this journal. This is expected if you are not the teacher of this journal.'

          // Log more details about the permission issue
          Logger.warning(
            `Permission denied when updating journal ${journalId}, assignment ${assignmentId}. This is expected if you are not the teacher of this journal.`
          )

          // Add more context to the error message
          const teacherInfo = entryData.teacherSelection ? entryData.teacherSelection.map(t => t.nameEt || t.fullname || t.id).join(', ') : 'Unknown'

          Logger.debug(`Journal teachers: ${teacherInfo}`)
          errorMessage += ` Journal teachers: ${teacherInfo}`

          // Check if XSRF token might be missing
          const cookies = document.cookie.split(';')
          let hasXsrfToken = false

          for (const cookie of cookies) {
            const [name] = cookie.trim().split('=')
            if (name === 'XSRF-TOKEN') {
              hasXsrfToken = true
              break
            }
          }

          if (!hasXsrfToken) {
            Logger.warning('XSRF-TOKEN cookie is missing. This might be causing the 403 error.')
            errorMessage += ' XSRF-TOKEN cookie is missing, which might be causing this error. Try refreshing the page.'
          }
        } else if (error.message.includes('404')) {
          errorMessage = 'Assignment not found. It may have been deleted or moved.'
        } else if (error.message.includes('400')) {
          errorMessage = `Bad request: ${error.message}. The data format may be incorrect.`
        } else if (error.message.includes('412')) {
          // Precondition Failed - often means the student is not actively studying
          Logger.warning(`Server returned 412 error when updating assignment ${assignmentId}`)

          // Check if the error message contains specific error codes
          if (
            error.message.includes('changeIsNotAllowedStudentIsNotStudying') ||
            error.message.includes('journal.messages.changeIsNotAllowedStudentIsNotStudying')
          ) {
            errorMessage = `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student may be on academic leave or their status is inactive in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`

            // Check the student's status in our cache
            const cachedStudent = await this.getCachedStudent(studentEntry.journalStudent)
            if (cachedStudent) {
              Logger.debug(`Student status in cache: ${cachedStudent.isActive ? 'Active' : 'Inactive'}`)
              if (!cachedStudent.isActive) {
                errorMessage += ' Student status in our cache is marked as inactive.'
              }
            }

            // Enhanced debugging: Log all students in the update request to identify the problematic one
            Logger.debug('=== 412 ERROR DEBUGGING ===')
            Logger.debug(`Assignment ID: ${assignmentId}, Journal ID: ${journalId}`)
            Logger.debug(`Total students in update request: ${updateData.journalEntryStudents.length}`)

            // Log the student names that are actually being sent in the request payload
            Logger.debug('=== STUDENTS IN REQUEST PAYLOAD ===')
            updateData.journalEntryStudents.forEach((student, index) => {
              Logger.debug(
                `Student ${index + 1} in payload: Name="${student.studentName || 'Not set'}", PersonalCode="${student.studentPersonalCode || 'Not set'}", JournalStudentId=${student.journalStudent}`
              )
            })
            Logger.debug('=== END STUDENTS IN REQUEST PAYLOAD ===')

            // Log each student's status from cache
            for (const [index, student] of updateData.journalEntryStudents.entries()) {
              const cachedStudentData = await this.getCachedStudent(student.journalStudent)
              if (cachedStudentData) {
                const status = cachedStudentData.isActive ? 'ACTIVE' : 'INACTIVE'
                const isDeleted = cachedStudentData.isDeleted ? 'DELETED' : 'NOT_DELETED'
                Logger.debug(`Student ${index + 1}: ${cachedStudentData.name} (${cachedStudentData.personalCode}) - Status: ${status}, ${isDeleted}`)
              } else {
                Logger.debug(`Student ${index + 1}: journalStudent=${student.journalStudent} - NO CACHE DATA`)
              }
            }

            // Check for inactive students (simplified check without iteration)
            Logger.debug('Checking for inactive students...')
            let hasInactiveStudents = false
            for (const student of updateData.journalEntryStudents) {
              const cachedStudentData = await this.getCachedStudent(student.journalStudent)
              if (cachedStudentData && (!cachedStudentData.isActive || cachedStudentData.isDeleted)) {
                hasInactiveStudents = true
                Logger.debug(`Found inactive student: ${cachedStudentData.name} (${cachedStudentData.personalCode})`)
              }
            }

            if (hasInactiveStudents) {
              Logger.debug(`Found inactive/deleted students in the update request`)
              errorMessage += ` Found inactive/deleted students that may be causing this error.`
            }

            Logger.debug('=== END 412 ERROR DEBUGGING ===')
          } else {
            errorMessage = `Precondition failed: ${error.message}. The server rejected the request.`
          }
        } else if (error.message.includes('500')) {
          // Server error - likely due to invalid data structure
          Logger.error(`Server returned 500 error when updating assignment ${assignmentId}`)

          // Log the data we sent for debugging
          Logger.debug(`Update data that caused 500 error: ${JSON.stringify(updateData)}`)

          // Check for common issues
          if (!studentEntry.id && !updateData.version) {
            errorMessage = 'Server error when adding new student. The server might require a version number for the update.'
            Logger.warning('Missing version number might be causing the 500 error')
          } else if (!studentEntry.id) {
            errorMessage = 'Server error when adding new student. The server might not allow adding students through this API.'
            Logger.warning('Adding new student might not be supported by the API')
          } else {
            errorMessage = 'Tahvel server error. Please try again later.'
          }

          // Suggest a workaround
          errorMessage += ' Try adding the student to the assignment manually in Tahvel first, then sync the grade.'
        }

        throw new Error(errorMessage)
      }

      // Handle successful responses, including empty responses
      // Some PUT operations return empty body with 200 status, which is valid
      if (response === null || response === undefined) {
        throw new Error('No response from Tahvel API after update')
      }

      // Log the response type and content for debugging
      Logger.debug(`Response type: ${typeof response}, Content: ${JSON.stringify(response)}`) // === DETAILED DEBUG INFORMATION (shown at end to avoid scrolling) ===
      Logger.debug('=== DETAILED DEBUG INFORMATION ===')
      Logger.debug(`Assignment ${assignmentId} has ${entryData.journalEntryStudents.length} students`)
      Logger.debug('Cache summary skipped - using API cache service')
      Logger.debug('=== END DETAILED DEBUG INFORMATION ===')

      // Return the response, even if it's an empty string (which indicates success)
      return response
    } catch (error) {
      // Add context to the error message
      const contextualError = new Error(`Error syncing grade for student ${studentPersonalCode} in assignment ${assignmentId}: ${error.message}`)

      // Log the error with full details
      Logger.error('Grade sync error:', contextualError)

      // Rethrow with the enhanced message
      throw contextualError
    }
  }

  /**
   * Get student from cache using multiple lookup strategies
   * @param {string|number} journalStudentId - Journal student ID to look up
   * @returns {Promise<Object|null>} Cached student data or null if not found
   */
  async getCachedStudent(journalStudentId) {
    if (!journalStudentId) {
      Logger.debug(`❌ getCachedStudent called with null/undefined journalStudentId`)
      return null
    }

    Logger.debug(`🔍 Looking for student in cache with journalStudentId: ${journalStudentId} (type: ${typeof journalStudentId})`)

    // === ENHANCED DEBUG: LOG MAPPING STATE ===
    if (Logger.isDebugMode()) {
      const mappingKeys = Object.keys(this.journalStudentIdToStudentId)
      Logger.debug(`Current mapping has ${mappingKeys.length} entries`)
      if (mappingKeys.length > 0) {
        Logger.debug(
          `Sample mapping entries: ${mappingKeys
            .slice(0, 3)
            .map(key => `${key}->${this.journalStudentIdToStudentId[key]}`)
            .join(', ')}`
        )
      }
    }

    // Simple memoization to avoid repeated API/cache calls for the same student during a session
    if (!this._cachedStudents) this._cachedStudents = {}
    const memoKey = String(journalStudentId)
    if (Object.prototype.hasOwnProperty.call(this._cachedStudents, memoKey)) {
      return this._cachedStudents[memoKey]
    }

    // Use the mapping to find the actual studentId
    const studentId = this.journalStudentIdToStudentId[journalStudentId]
    if (studentId) {
      Logger.debug(`✅ Found mapping: journalStudentId ${journalStudentId} -> studentId ${studentId}`)

      try {
        // Use the API cache to get student details
        Logger.debug(`📡 Fetching student details for studentId ${studentId}`)
        const studentDetails = await this.getStudentDetails(studentId)

        if (studentDetails) {
          Logger.debug(`📋 Student details structure: ${JSON.stringify(Object.keys(studentDetails))}`)

          if (studentDetails.person) {
            Logger.debug(
              `👤 Person data: ${JSON.stringify({
                firstname: studentDetails.person.firstname,
                lastname: studentDetails.person.lastname,
                idcode: studentDetails.person.idcode
              })}`
            )
          } else {
            Logger.warning(`⚠️ No person data in student details for studentId ${studentId}`)
          }

          if (studentDetails.person && studentDetails.person.idcode) {
            const isActive = studentDetails.status === 'OPPURSTAATUS_O'
            const isDeleted = studentDetails.status === 'OPPURSTAATUS_K'

            const cachedStudent = {
              personalCode: studentDetails.person.idcode,
              name: studentDetails.person.firstname + ' ' + studentDetails.person.lastname,
              isActive: isActive,
              isDeleted: isDeleted
            }

            Logger.debug(
              `✅ Successfully cached student: ${cachedStudent.personalCode} (${cachedStudent.name}) - Active: ${isActive}, Deleted: ${isDeleted}`
            )
            this._cachedStudents[memoKey] = cachedStudent
            return cachedStudent
          } else {
            Logger.warning(`⚠️ Missing person.idcode in student details for studentId ${studentId}`)
          }
        } else {
          Logger.warning(`⚠️ No student details returned for studentId ${studentId}`)
        }
      } catch (error) {
        Logger.error(`❌ Error getting student ${studentId} from API cache: ${error.message}`)
      }
    } else {
      Logger.warning(`❌ No studentId mapping found for journalStudentId: ${journalStudentId}`)

      // Show available mappings for debugging
      if (Logger.isDebugMode()) {
        const mappingKeys = Object.keys(this.journalStudentIdToStudentId)
        if (mappingKeys.length > 0) {
          Logger.debug(`Available journalStudentId mappings: ${mappingKeys.join(', ')}`)
        } else {
          Logger.debug(`No mappings available at all - this suggests journal students data wasn't loaded properly`)
        }
      }
    }

    Logger.debug(`🚫 Student not found in cache for journalStudentId: ${journalStudentId}`)
    this._cachedStudents[memoKey] = null
    return null
  }
}

// Cache expiration constants
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS
const TWO_WEEKS_MS = 2 * ONE_WEEK_MS

// Global teacher cache shared between collectJournalData and getTahvelSubjectsWithAssignmentsAndGrades
// to prevent duplicate API requests when processing multiple journals
const globalModuleTeacherCache = {}

// Map to track ongoing teacher requests to prevent race conditions
const pendingTeacherRequests = new Map()

/**
 * Fetches data from API with caching
 * @param {Object} api - API service instance
 * @param {string} endpoint - API endpoint to fetch from
 * @param {number} expiration - Cache expiration time in milliseconds
 * @returns {Promise<any>} The fetched data
 */
async function fetchCachedData(api, endpoint, expiration = ONE_DAY_MS) {
  // Create a cache key from the endpoint
  const cacheKey = `${encodeURIComponent(endpoint.replace(/^\//, ''))}`

  // This is a secondary cache layer keyed by the URL-encoded endpoint, so
  // the inner ApiService routing for high-PII endpoints can't see it. Apply
  // the same check ourselves to force memory-only.
  const persist = !ApiService._isHighPiiEndpoint(endpoint)

  try {
    return await cacheService.getOrFetch(
      cacheKey,
      async() => {
        try {
          return await api.tahvel.get(endpoint)
        } catch (error) {
          Logger.warning(`Error fetching ${endpoint}: ${error.message}`)
          return null
        }
      },
      expiration,
      true,
      persist
    )
  } catch (error) {
    Logger.warning(`Error using cacheService for ${endpoint}: ${error.message}`)
    return null
  }
}

/**
 * Get teacher personal code with global caching and race condition prevention
 * @param {Object} api - API service instance
 * @param {Object} teacher - Teacher object with id, nameEt, fullname
 * @returns {Promise<Object>} Teacher data with personalCode, name, id
 */
async function getTeacherPersonalCodeCached(api, teacher) {
  const teacherId = teacher.id
  const teacherName = teacher.nameEt || teacher.fullname || ''

  if (!teacherId || !teacherName) {
    return { personalCode: '', name: teacherName, id: teacherId }
  }

  // Create URL-based cache key to prevent conflicts between different API endpoints
  const encodedName = encodeURIComponent(teacherName)
  const endpoint = `/teachers?isActive=true&lang=ET&name=${encodedName}&page=0&size=50`
  const cacheKey = `teacher_${teacherId}_${btoa(endpoint).slice(0, 20)}` // Use base64 encoded endpoint as part of cache key

  // Check global cache first
  if (globalModuleTeacherCache[cacheKey]) {
    return globalModuleTeacherCache[cacheKey]
  }

  // Check if request is already pending to prevent duplicate requests
  if (pendingTeacherRequests.has(cacheKey)) {
    return await pendingTeacherRequests.get(cacheKey)
  }

  // Create the fetch promise
  const fetchPromise = (async() => {
    try {
      const teacherSearchResult = await fetchCachedData(api, endpoint, ONE_WEEK_MS)

      if (teacherSearchResult?.content && Array.isArray(teacherSearchResult.content) && teacherSearchResult.content.length > 0) {
        let foundTeacher = teacherSearchResult.content.find(t => t.id === teacherId)

        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content.find(t => t.name === teacherName || t.name === teacher.fullname)
        }

        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content[0]
          Logger.warning(
            `No exact match found for teacher ${teacherName} (ID: ${teacherId}). Using first result: ${foundTeacher.name} (ID: ${foundTeacher.id})`
          )
        }

        const teacherData = {
          personalCode: foundTeacher.idcode || '',
          name: foundTeacher.name || teacherName,
          id: foundTeacher.id
        }

        // Store in global cache using URL-based key
        globalModuleTeacherCache[cacheKey] = teacherData

        return teacherData
      }

      const fallbackData = {
        personalCode: '',
        name: teacherName,
        id: teacherId
      }

      // Cache the fallback data too to prevent repeated requests
      globalModuleTeacherCache[cacheKey] = fallbackData
      return fallbackData
    } catch (error) {
      Logger.warning(`Failed to get teacher personal code for ${teacherName}: ${error.message}`)
      const errorData = { personalCode: '', name: teacherName, id: teacherId }
      globalModuleTeacherCache[cacheKey] = errorData
      return errorData
    } finally {
      // Remove from pending requests using URL-based key
      pendingTeacherRequests.delete(cacheKey)
    }
  })()

  // Store the promise to prevent duplicate requests using URL-based key
  pendingTeacherRequests.set(cacheKey, fetchPromise)

  return await fetchPromise
}

/**
 * Get Tahvel subjects with assignments and grades
 * This function is extracted from the collectJournalData method for testing purposes
 * @param {Array<string|number>} journalIds - List of journal IDs to process
 * @returns {Promise<Array>} Array of subjects with assignments and grades
 */
export async function getTahvelSubjectsWithAssignmentsAndGrades(journalIds = []) {
  try {
    // Ensure we have journal IDs to process
    if (!journalIds || journalIds.length === 0) {
      Logger.warning('No journal IDs provided to getTahvelSubjectsWithAssignmentsAndGrades')
      return []
    }

    Logger.debug(`Processing ${journalIds.length} journals`)

    // Process each journal
    const results = []

    for (const journalId of journalIds) {
      try {
        Logger.debug(`Processing journal ID: ${journalId}`)

        // Get journal info
        const journalInfo = await fetchCachedData(this.api, `/journals/${journalId}`)
        if (!journalInfo) {
          Logger.warning(`Could not get info for journal ${journalId}`)
          continue
        }

        // Get journal students
        const journalStudents = await fetchCachedData(this.api, `/journals/${journalId}/journalStudents?allStudents=true`)
        if (!Array.isArray(journalStudents) || journalStudents.length === 0) {
          Logger.warning(`No students found for journal ${journalId}`)
          continue
        }

        // Get journal entries
        const journalEntries = await fetchCachedData(this.api, `/journals/${journalId}/journalEntriesByDate?allStudents=true`)
        if (!Array.isArray(journalEntries)) {
          Logger.warning(`No entries found for journal ${journalId}`)
          continue
        }

        // Process students to get their details (especially personal code)
        const studentDetailsMap = {}
        for (const student of journalStudents) {
          if (student && student.studentId) {
            const studentDetails = await fetchCachedData(this.api, `/students/${student.studentId}`)

            if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
              studentDetailsMap[student.id] = {
                personalCode: studentDetails.person.idcode,
                name: student.fullname || student.studentName,
                isActive: studentDetails.status === 'OPPURSTAATUS_O', // O means actively studying
                isGraduated: studentDetails.status === 'OPPURSTAATUS_L' // L means graduated
              }
            }
          }
        }

        // Process journal entries to extract assignments with grades
        const assignments = []
        for (const entry of journalEntries) {
          // We're mainly interested in assignments (independent work and practical work entries)
          if ((entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P') && entry.nameEt && entry.id) {
            const results = []

            // Create a map of students who have results for this assignment
            const studentResultsMap = {}
            if (entry.journalStudentResults) {
              Object.entries(entry.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
                studentResultsMap[journalStudentId] = studentResults
              })
            }

            // Include ALL journal students for this assignment, not just those with results
            Object.values(studentDetailsMap).forEach(studentDetails => {
              if (studentDetails) {
                // Find this student's journal student ID
                const journalStudentId = Object.keys(studentDetailsMap).find(id => studentDetailsMap[id] === studentDetails)

                // Check if this student has results for this assignment
                const studentResults = studentResultsMap[journalStudentId]
                let grade = ''

                if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
                  // Map Tahvel grade codes to Kriit format (remove prefix)
                  grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
                }
                // If no results or no grade, grade remains empty string

                results.push({
                  grade,
                  studentPersonalCode: studentDetails.personalCode,
                  studentName: studentDetails.name,
                  studentIsActive: studentDetails.isActive,
                  studentIsGraduated: studentDetails.isGraduated || false
                })
              }
            })

            // Extract date from entryDate
            let dueDate = null
            let entryDate = null
            if (entry.entryDate) {
              const date = new Date(entry.entryDate)
              entryDate = date.toISOString().split('T')[0]

              // Use date + 2 days as due date if not specified
              const dueDateObj = new Date(date)
              dueDateObj.setDate(dueDateObj.getDate() + 2)
              dueDate = dueDateObj.toISOString().split('T')[0]
            }

            // Include assignments even if no students have grades yet (but only if we have students)
            if (results.length > 0) {
              assignments.push({
                assignmentExternalId: entry.id,
                assignmentName: entry.nameEt,
                assignmentInstructions: entry.nameEt,
                assignmentDueAt: dueDate,
                assignmentEntryDate: entryDate,
                // Include entry type so Kriit knows whether it's independent work or practical work
                entryType: entry.entryType || null,
                results
              })
            }
          }
        }

        // Get teacher personal code using shared caching
        let teacherName = ''
        let teacherPersonalCode = ''

        if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
          const teacher = journalInfo.journalTeachers[0]
          teacherName = teacher.nameEt || teacher.fullname || ''

          if (teacherName && teacher.id) {
            const teacherData = await getTeacherPersonalCodeCached(this.api, teacher)
            teacherPersonalCode = teacherData.personalCode
          }
        }

        // Get group name
        let groupName = ''
        if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
          groupName = journalInfo.studentGroups[0]
        } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
          groupName = journalStudents[0].studentGroup
        }

        // Resolve and fetch journal theme (prefer curriculumVersions -> top-level themes -> journalThemes)
        let journalTheme = null
        try {
          let themeId = null
          if (
            journalInfo &&
            Array.isArray(journalInfo.curriculumVersions) &&
            journalInfo.curriculumVersions[0] &&
            Array.isArray(journalInfo.curriculumVersions[0].themes) &&
            journalInfo.curriculumVersions[0].themes[0] &&
            journalInfo.curriculumVersions[0].themes[0].id
          ) {
            themeId = journalInfo.curriculumVersions[0].themes[0].id
          } else if (journalInfo && Array.isArray(journalInfo.themes) && journalInfo.themes[0] && journalInfo.themes[0].id) {
            themeId = journalInfo.themes[0].id
          } else if (journalInfo && Array.isArray(journalInfo.journalThemes) && journalInfo.journalThemes[0] && journalInfo.journalThemes[0].id) {
            themeId = journalInfo.journalThemes[0].id
          }

          if (themeId) {
            const themeContent = await fetchCachedData(this.api, `/journals/${journalId}/theme/${themeId}`, TWO_WEEKS_MS)
            journalTheme = { id: themeId, content: themeContent }
          }
        } catch (err) {
          Logger.debug(`Could not fetch theme for journal ${journalId}: ${err.message}`)
          journalTheme = null
        }

        // Only add journals that have assignments with grades
        if (assignments.length > 0) {
          results.push({
            subjectName: journalInfo.nameEt,
            subjectExternalId: journalId,
            groupName,
            teacherPersonalCode,
            teacherName,
            assignments,
            journalTheme
          })
        }
      } catch (error) {
        Logger.error(`Error processing journal ${journalId}:`, error)
      }
    }

    return results
  } catch (error) {
    Logger.error('Error in getTahvelSubjectsWithAssignmentsAndGrades:', error)
    throw error
  }
}

/**
 * Compute a stable hash for a JSON payload. Uses SubtleCrypto SHA-1 when available.
 * Falls back to a simple checksum when crypto is not available.
 * @param {any} payload
 * @returns {Promise<string>} hex hash
 */
async function computePayloadHash(payload) {
  try {
    const text = JSON.stringify(payload)
    if (window && window.crypto && window.crypto.subtle && window.TextEncoder) {
      const encoder = new TextEncoder()
      const data = encoder.encode(text)
      const hashBuffer = await window.crypto.subtle.digest('SHA-1', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }
    // Fallback simple checksum
    let sum = 0
    for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i)) % 0xffffffff
    return `fallback-${sum}`
  } catch (error) {
    Logger.warning('computePayloadHash failed:', error.message)
    return 'hash-failed'
  }
}

// Expose the fetchCachedData function for testing purposes
getTahvelSubjectsWithAssignmentsAndGrades.__fetchCachedData = fetchCachedData

JournalListSyncFeature.requiresKriit = true

export const journalListSync = new JournalListSyncFeature()
