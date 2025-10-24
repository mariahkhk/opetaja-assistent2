import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

/**
 * HeaderSyncButtonFeature
 *
 * Displays an orange button in the Tahvel header bar when there are pending Kriit syncs.
 * The button appears before the language selection buttons and navigates to the journal
 * list page when clicked.
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
    this.#setupClickHandler()

    // Create and inject the sync button
    this.#createSyncButton(langButtons)

    // Start checking for pending syncs
    this.#startSyncCheck()
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
   * Sets up event delegation for button clicks
   * Uses document.body to survive Angular re-renders
   * @private
   */
  #setupClickHandler() {
    // Remove existing handler if it exists
    if (this.clickHandler) {
      document.body.removeEventListener('click', this.clickHandler)
    }

    // Create new handler using event delegation
    this.clickHandler = (event) => {
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
  #createSyncButton(langButtons) {
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
  #startSyncCheck() {
    // Check immediately
    this.#updateButtonVisibility()

    // Then check every 2 seconds
    this.checkInterval = setInterval(() => {
      this.#updateButtonVisibility()
    }, 2000)
  }

  /**
   * Updates the button visibility based on pending sync status
   * Always queries the button from DOM to handle Angular re-renders
   *
   * @private
   */
  #updateButtonVisibility() {
    // Always query from DOM in case Angular re-rendered
    const button = document.getElementById('oa2-kriit-sync-header-button')
    if (!button) return

    const hasPendingSyncs = this.#hasPendingSyncs()

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
  #hasPendingSyncs() {
    const syncState = window.journalListSync

    if (!syncState) {
      return false
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
