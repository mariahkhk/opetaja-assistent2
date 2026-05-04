import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { cacheService } from '../../services/CacheService.js'
import { runKriitSyncCheck } from '../../lib/kriitSyncCheck.js'

/**
 * HeaderSyncButtonFeature
 *
 * Displays an orange button in the Tahvel header bar when there are pending Kriit syncs.
 * The button appears before the language selection buttons and navigates to the journal
 * list page when clicked.
 *
 * On activation the feature:
 * 1. Loads persisted Kriit sync results from cache (fast path, survives page reloads)
 * 2. If no cached results exist, runs the full Kriit sync check pipeline via runKriitSyncCheck
 * 3. Populates window.journalListSync so the button shows when there are pending syncs
 *
 * @extends BaseFeature
 */
export default class HeaderSyncButtonFeature extends BaseFeature {
  constructor() {
    super(
      'headerSyncButton',
      () => true, // Activate on all pages
      ['#lang-buttons'] // Wait for language buttons to be present
    )
    this.name = 'HeaderSyncButtonFeature'
    this.checkInterval = null
    this.clickHandler = null
  }

  /**
   * Activates the feature by injecting the sync button into the header
   * and starting periodic checks for pending syncs
   */
  onActivate() {
    // Get the language buttons container
    const langButtons = document.querySelector('#lang-buttons')
    if (!langButtons) {
      Logger.error('[HeaderSyncButtonFeature] Language buttons container not found')
      return
    }

    // Set up event delegation on document body (survives Angular re-renders)
    this.setupClickHandler()

    // Create and inject the sync button
    this.createSyncButton(langButtons)

    // Start checking for pending syncs
    this.startSyncCheck()

    // Actively load sync data in the background (don't block activation)
    this.fetchSyncData()
  }

  /**
   * Cleans up the feature by removing the button and stopping the check interval
   */
  onDeactivate() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    // Remove click handler
    if (this.clickHandler) {
      document.body.removeEventListener('click', this.clickHandler)
      this.clickHandler = null
    }

    // Remove button from DOM
    const button = document.getElementById('oa2-kriit-sync-header-button')
    if (button) {
      button.remove()
    }

    super.onDeactivate()
  }

  /**
   * Load persisted Kriit sync results from cache. If no cached results exist,
   * run the full Kriit sync check pipeline so the header button can show
   * pending syncs without the user visiting /journals first.
   *
   * Runs in the background — failures are silent (button just stays hidden).
   * @private
   */
  async fetchSyncData() {
    try {
      // If window.journalListSync already has data (e.g. user just came from /journals), skip
      if (window.journalListSync && (
        (window.journalListSync.differences && window.journalListSync.differences.length > 0) ||
        (window.journalListSync.newAssignments && Object.keys(window.journalListSync.newAssignments).length > 0)
      )) {
        return
      }

      // Wait for Kriit settings to be loaded
      if (this.api._kriitInitPromise) await this.api._kriitInitPromise
      if (!this.isActive) return

      // Only proceed if Kriit integration is enabled
      if (!this.api.kriit || !this.api.kriit.enabled) return

      // Fast path: try cached results first.
      // Memory-cache hit (same session): use the full PII-bearing data.
      // Persistent cache hit (next page load): only the sanitised summary
      // survived — populate enough of window.journalListSync for the
      // visibility check to fire so the badge appears immediately.
      const ONE_DAY = 24 * 60 * 60 * 1000
      const [cachedDifferences, cachedNewAssignments, cachedSummary] = await Promise.all([
        cacheService.get('journalList_lastDifferences', ONE_DAY),
        cacheService.get('journalList_lastNewAssignments', ONE_DAY),
        cacheService.get('journalList_diffSummary', ONE_DAY)
      ])

      if (cachedDifferences || cachedNewAssignments) {
        if (!window.journalListSync) window.journalListSync = {}
        if (cachedDifferences) window.journalListSync.differences = cachedDifferences
        if (cachedNewAssignments) window.journalListSync.newAssignments = cachedNewAssignments
        Logger.debug('[HeaderSyncButtonFeature] Loaded persisted sync results from cache')
        return
      }

      if (cachedSummary && (cachedSummary.hasDifferences || cachedSummary.hasNewAssignments)) {
        // Set a hint flag rather than fake placeholder arrays — JournalSyncBanner
        // and TahvelNewAssignmentSync iterate `differences` / `newAssignments`
        // by content, and seeded `{}` placeholders rendered as 'Päevik undefined'
        // rows during the placeholder window. The header's own visibility check
        // (#hasPendingSyncs) ORs this flag in so the badge still fires.
        if (!window.journalListSync) window.journalListSync = {}
        window.journalListSync._summaryHasPending = true
        Logger.debug('[HeaderSyncButtonFeature] Hydrated badge from persisted summary; full sync will run')
        // Fall through to run full sync — we want the real data populated soon.
      }

      // No cached results — run full sync check
      if (!this.isActive) return
      const result = await runKriitSyncCheck(this.api)
      if (!this.isActive) return
      if (result) {
        if (!window.journalListSync) window.journalListSync = {}
        window.journalListSync.differences = result.differences
        window.journalListSync.newAssignments = result.newAssignments
        // Real data has arrived — drop the placeholder hint so the
        // visibility check uses the actual data going forward.
        delete window.journalListSync._summaryHasPending
      }
    } catch (error) {
      Logger.debug('[HeaderSyncButtonFeature] Background sync failed:', error.message)
    }
  }

  /**
   * Sets up event delegation for button clicks
   * Uses document.body to survive Angular re-renders
   * @private
   */
  setupClickHandler() {
    // Remove existing handler if it exists
    if (this.clickHandler) {
      document.body.removeEventListener('click', this.clickHandler)
    }

    // Create new handler using event delegation
    this.clickHandler = event => {
      const target = event.target

      // Check if clicked element is our button or inside it
      if (target.id === 'oa2-kriit-sync-header-button' ||
          target.closest('#oa2-kriit-sync-header-button')) {

        event.preventDefault()
        event.stopPropagation()

        // Navigate to journals page
        window.location.hash = '#/journals'

        // Fallback check
        setTimeout(() => {
          if (!window.location.hash.includes('/journals')) {
            window.location.href = '#/journals'
          }
        }, 100)
      }
    }

    // Attach to body so it survives Angular re-renders
    document.body.addEventListener('click', this.clickHandler, true)
  }

  /**
   * Creates the orange sync button and injects it before the EST language button
   *
   * @param {HTMLElement} langButtons - The language buttons container element
   * @private
   */
  createSyncButton(langButtons) {
    // Remove existing button if it exists
    const existingButton = document.getElementById('oa2-kriit-sync-header-button')
    if (existingButton) {
      existingButton.remove()
    }

    // Create button element
    const button = document.createElement('button')
    button.id = 'oa2-kriit-sync-header-button'
    button.className = 'md-button md-ink-ripple'
    button.type = 'button'
    button.setAttribute('aria-label', 'Sünkroonimine vajalik')
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

    // Button text
    button.textContent = 'Sünkroonimine vajalik'

    // Hover effect (inline styles survive Angular re-renders better)
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#f57c00'
    })
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#ff9800'
    })

    // Insert before the first button inside lang-buttons (the EST button)
    const firstLangButton = langButtons.querySelector('button')
    if (firstLangButton) {
      langButtons.insertBefore(button, firstLangButton)
    } else {
      // Fallback: insert before lang-buttons container
      langButtons.parentNode.insertBefore(button, langButtons)
    }
  }

  /**
   * Starts periodic checking for pending syncs and updates button visibility
   *
   * @private
   */
  startSyncCheck() {
    // Check immediately
    this.updateButtonVisibility()

    // Then check every 2 seconds
    this.checkInterval = setInterval(() => {
      this.updateButtonVisibility()
    }, 2000)
  }

  /**
   * Updates the button visibility based on pending sync status
   * Always queries the button from DOM to handle Angular re-renders
   *
   * @private
   */
  updateButtonVisibility() {
    // Always query from DOM in case Angular re-rendered
    const button = document.getElementById('oa2-kriit-sync-header-button')
    if (!button) return

    const hasPendingSyncs = this.hasPendingSyncs()

    if (hasPendingSyncs) {
      button.style.display = 'inline-block'
    } else {
      button.style.display = 'none'
    }
  }

  /**
   * Checks if there are pending syncs by examining window.journalListSync state
   *
   * @returns {boolean} True if there are pending syncs, false otherwise
   * @private
   */
  hasPendingSyncs() {
    const syncState = window.journalListSync

    if (!syncState) {
      return false
    }

    // Hydrated-from-summary fast path: the persisted summary indicated work
    // exists, but the full data is still being rebuilt. Show the badge.
    if (syncState._summaryHasPending) {
      return true
    }

    // Check for differences
    const hasDifferences = syncState.differences && syncState.differences.length > 0

    // Check for new assignments
    const hasNewAssignments =
      syncState.newAssignments &&
      Object.keys(syncState.newAssignments).length > 0

    return hasDifferences || hasNewAssignments
  }
}
