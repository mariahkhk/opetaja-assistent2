/**
 * Base Feature - Template for all features to extend
 */

import Logger from '../services/Logger.js'
import { domService } from '../services/DomService.js'
import { ApiService } from '../services/ApiService.js'

/**
 * Get the current Tahvel base URL based on the current domain
 */
export function getTahvelBaseUrl() {
  const hostname = window.location.hostname
  if (hostname.includes('test.tahvel.eenet.ee')) {
    return 'https://test.tahvel.eenet.ee/hois_back'
  }
  // Default to production tahvel
  return 'https://tahvel.edu.ee/hois_back'
}

/**
 * Centralized API configuration
 */
export const api = {
  // Tahvel API instance - baseUrl is dynamic based on current domain
  tahvel: new ApiService({
    name: 'tahvel',
    baseUrl: getTahvelBaseUrl()
  }),

  // Kriit API instance - baseUrl will be set from user settings
  kriit: new ApiService({
    name: 'kriit',
    baseUrl: '', // Empty by default, will be set from chrome.storage.local
    defaultHeaders: {
      Accept: 'application/json'
    }
  }),

  // Promise that resolves when Kriit API settings have been loaded from chrome.storage.
  // Features should await this before checking kriit.enabled or kriit.authToken.
  _kriitInitPromise: null
}

const _journalChangeFeatures = new Set()

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('oa2:journalDataChanged', event => {
    const journalId = event.detail?.journalId ?? null
    for (const feature of _journalChangeFeatures) {
      if (feature.isActive) {
        feature.onJournalDataChanged(journalId)
      }
    }
  })
}

export class BaseFeature {
  constructor(name, urlPattern, requiredSelectors = null) {
    this.name = name
    this.urlPattern = urlPattern
    this.requiredSelectors = requiredSelectors
    this.isActive = false
    this.elementsObserver = null

    // Make API instances available to all features
    this.api = api

    _journalChangeFeatures.add(this)

    // Initialize Kriit API base URL from storage
    this.initializeKriitApi()

    Logger.debug(`Feature "${name}" created`)
  }

  /**
   * Check if this feature should be activated for the current URL
   * @param {string} url - Current URL
   * @returns {boolean} True if should activate
   */
  shouldActivate(url) {
    if (typeof this.urlPattern === 'string') {
      return url.includes(this.urlPattern)
    } else if (this.urlPattern instanceof RegExp) {
      return this.urlPattern.test(url)
    } else if (typeof this.urlPattern === 'function') {
      return this.urlPattern(url)
    }
    return false
  }

  /**
   * Activate the feature
   */
  activate() {
    // Skip if already active
    if (this.isActive) return

    // Mark as active
    this.isActive = true
    Logger.debug(`[${this.name}] Base activation complete - initializing feature`)

    // If we have required selectors, wait for them before calling onActivate
    if (this.requiredSelectors) {
      Logger.debug(`Feature ${this.name} waiting for required elements: ${this.requiredSelectors}`)

      // Set up observer for required elements
      this.elementsObserver = domService.observeForElements(this.requiredSelectors, (elements, selector, error) => {
        // Clean up the observer
        this.elementsObserver = null

        if (error) {
          Logger.error(`Feature ${this.name} could not find required elements`, error)
          this.onRequiredElementsNotFound(error)
          return
        }

        if (elements && elements.length > 0) {
          Logger.debug(`Feature ${this.name} found required elements with selector: ${selector}`)
          this.onRequiredElementsFound(elements, selector)
          this.onActivate(elements)
        }
      })
    } else {
      // No required elements, activate immediately
      this.onActivate()
    }
  }

  /**
   * Deactivate the feature
   */
  deactivate() {
    if (this.isActive) {
      this.isActive = false
      Logger.debug(`[${this.name}] Deactivated`)
      this.onDeactivate()
    }
  }

  /**
   * Called when the feature is activated
   * Should be overridden by child classes
   *
   * NOTE: Do not log 'Activated' in this method - BaseFeature.activate() already does that.
   * This method is for initialization logic only.
   */
  onActivate() {
    // Default implementation - override in subclasses
    Logger.debug(`Feature "${this.name}" activated, but no onActivate handler implemented`)
  }

  /**
   * Called when the feature is deactivated
   * Should be overridden by child classes
   */
  onDeactivate() {
    // Default implementation - override in subclasses

    // Clean up any observers
    if (this.elementsObserver) {
      this.elementsObserver.disconnect()
      this.elementsObserver = null
    }
  }

  /**
   * Called when journal data changes due to a Tahvel UI mutation.
   * Override in subclasses that need to refresh after external edits.
   * @param {number|null} journalId - The affected journal ID
   */
  onJournalDataChanged(_journalId) {
    // Default: no-op. Features opt in by overriding.
  }

  /**
   * Called when required elements are found
   * Can be overridden by child classes
   * @param {NodeList} elements - The found elements
   * @param {string} selector - The selector that matched
   */
  onRequiredElementsFound(elements, selector) {
    // Default implementation - override in subclasses if needed
    Logger.debug(`Feature "${this.name}" found ${elements.length} required elements with selector: ${selector}`)
  }

  /**
   * Called when required elements are not found within timeout
   * Can be overridden by child classes
   * @param {Error} _error - The error that occurred
   */
  onRequiredElementsNotFound(_error) {
    // Override in subclasses to handle UI cleanup (Sentry reporting is handled by activate())
  }

  /**
   * Initialize Kriit API with settings from chrome.storage.local
   */
  initializeKriitApi() {
    // Check if API is properly initialized
    if (!this.api || !this.api.kriit) {
      Logger.error('API not properly initialized', { api: this.api })
      return
    }

    // If already initializing/initialized, reuse the existing promise
    if (this.api._kriitInitPromise) return

    // Set Kriit API base URL if not already set
    if (!this.api.kriit.baseUrl) {
      // Try to load from storage - store promise so features can await it
      this.api._kriitInitPromise = new Promise(resolve => {
        chrome.storage.local.get(['OA_kriitApiBaseUrl', 'OA_kriitApiToken', 'OA_kriitEnabled'], result => {
          if (chrome.runtime?.lastError) {
            Logger.error('Failed to load Kriit settings from storage:', chrome.runtime.lastError.message)
            resolve()
            return
          }

          const savedBaseUrl = result['OA_kriitApiBaseUrl']
          const savedToken = result['OA_kriitApiToken']
          const kriitEnabled = result['OA_kriitEnabled'] === true

          // Store Kriit enabled status
          this.api.kriit.enabled = kriitEnabled

          if (!kriitEnabled) {
            // Skip Kriit API initialization if disabled
            resolve()
            return
          }

          // Set base URL from storage - no default fallback
          if (savedBaseUrl) {
            this.api.kriit.setBaseUrl(savedBaseUrl)
          } else {
            Logger.debug('No Kriit API base URL found in settings')
          }

          // Set auth token if available
          if (savedToken) {
            this.api.kriit.setAuthToken(savedToken)
          } else {
            Logger.debug('No Kriit API token found, Kriit features will be disabled')
          }

          resolve()
        })
      })
    } else {
      this.api._kriitInitPromise = Promise.resolve()
    }
  }

  /**
   * No-op for features that do not use final grade banners
   */
  removeFinalGradeBanner() {
    // No-op: override in features that use banners
  }
}
