/**
 * Banner Service
 *
 * Handles generic UI banner management
 * Provides a centralized way to show different types of banners (loading, success, error, etc.)
 * For sync-specific banners, use JournalSyncBannerService
 */

import { domService } from './DomService.js'
import { styleService } from './StyleService.js'
import Logger from './Logger.js'

export class BannerService {
  constructor(containerSelector = '#main-content > div.layout-padding > div') {
    this.containerSelector = containerSelector
    this.currentBanner = null
    this.progressContainer = null
    this.progressBar = null
    this.progressText = null
    this.loadingText = null
    this.stylesLoaded = false
  }

  /**
   * Load CSS styles for the banner service (lazy loading)
   */
  loadStyles() {
    if (this.stylesLoaded || typeof document === 'undefined') {
      return
    }

    this.stylesLoaded = true
    const css = `
      .ta-banner {
        background-color: #e6f3ff;
        border: 1px solid #b3d9ff;
        border-radius: 4px;
        margin: 10px;
        padding: 15px 20px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        max-width: 800px;
        margin-left: auto;
        margin-right: auto;
        position: relative;
        border-left: 5px solid #007bff;
      }

      .ta-banner-loading {
        background-color: #f8f9fa;
        color: #6c757d;
        text-align: center;
        padding: 20px;
      }

      .ta-banner-error {
        background-color: #f8d7da;
        border-color: #f5c6cb;
        color: #721c24;
        border-left: 5px solid #dc3545;
      }

      .ta-banner-info {
        background-color: #e2f0fd;
        border-color: #b8daff;
        color: #004085;
        border-left: 5px solid #0d6efd;
      }

      .ta-banner-success {
        background-color: #d4edda;
        border-color: #c3e6cb;
        color: #155724;
        border-left: 5px solid #28a745;
      }

      .ta-banner-title {
        color: #0056b3;
        font-size: 1.5rem;
        margin-top: 0;
        margin-bottom: 10px;
      }

      .ta-banner-error-title {
        color: #721c24;
        font-size: 1.3rem;
        margin-top: 0;
        margin-bottom: 10px;
      }

      .ta-banner-error-message {
        background-color: rgba(0, 0, 0, 0.05);
        padding: 8px;
        border-radius: 3px;
        font-family: monospace;
        margin-bottom: 15px;
        word-break: break-all;
      }

      .ta-banner-message {
        margin-bottom: 15px;
      }

      .ta-banner-button {
        background-color: #007bff;
        border: none;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        font-size: 0.9rem;
        margin-top: 10px;
        padding: 6px 12px;
        transition: background-color 0.2s;
        font-weight: normal;
      }

      .ta-banner-button:hover {
        background-color: #0069d9;
      }

      .ta-banner-error-button {
        background-color: #dc3545;
      }

      .ta-banner-error-button:hover {
        background-color: #c82333;
      }

      .ta-banner-progress-container {
        margin-top: 10px;
      }

      .ta-banner-progress-bar {
        background-color: #007bff;
        height: 20px;
        transition: width 0.3s;
        border-radius: 10px;
      }

      .ta-banner-progress-text {
        text-align: center;
        margin-top: 5px;
        font-size: 0.9rem;
      }

      .ta-banner-loading-text {
        margin-bottom: 10px;
      }
    `

    styleService.injectCSS(css, 'banner-service-styles')
  }

  /**
   * Get the banner container element
   * @returns {Element} The banner container element or document.body as fallback
   */
  getBannerContainer() {
    // First prefer the new Tahvel controls wrapper that appeared in the updated UI
    const preferredSelector = '.tahvel-form-buttons'
    const preferred = document.querySelector(preferredSelector)
    if (preferred) {
      try {
        // If we haven't already created a stable insertion wrapper, create one after the preferred element
        let insertionWrapper = preferred.parentNode.querySelector('.ta-sync-banner-insertion')
        if (insertionWrapper && !insertionWrapper.isConnected) {
          insertionWrapper = null
        }
        if (!insertionWrapper) {
          insertionWrapper = document.createElement('div')
          insertionWrapper.className = 'ta-sync-banner-insertion'
          // Keep clear separation from Tahvel's layout
          insertionWrapper.style.marginTop = '12px'
          // Insert after the preferred element
          preferred.insertAdjacentElement('afterend', insertionWrapper)
          Logger.debug(`Created banner insertion wrapper after ${preferredSelector}`)
        }
        return insertionWrapper
      } catch (err) {
        Logger.warning(`Failed to create insertion wrapper after ${preferredSelector}: ${err.message}`)
        // Fall through to other selectors
      }
    }

    // Fallback to the configured container selector
    const container = document.querySelector(this.containerSelector)
    if (!container) {
      Logger.warning(`Banner container not found with selector: ${this.containerSelector}, falling back to document.body`)
      return document.body
    }
    return container
  }

  /**
   * Wait for the preferred banner container to be available in the DOM.
   * Call this once before the first banner display to avoid race conditions
   * with Angular rendering.
   * @param {number} timeout - Maximum time to wait in ms (default: 5000)
   * @returns {Promise<Element>} The banner container element
   */
  async waitForBannerContainer(timeout = 5000) {
    try {
      await domService.waitForElement('.tahvel-form-buttons', timeout)
    } catch {
      Logger.debug('Preferred banner container (.tahvel-form-buttons) not found within timeout, using fallback')
    }
    return this.getBannerContainer()
  }

  /**
   * Remove current banner from the DOM
   */
  removeBanner() {
    if (this.currentBanner && this.currentBanner.parentNode) {
      this.currentBanner.parentNode.removeChild(this.currentBanner)
      this.currentBanner = null
      this.progressContainer = null
      this.progressBar = null
      this.progressText = null
      this.loadingText = null
    }
  }

  /**
   * Show loading banner
   * @param {string} message - Loading message to display
   */
  showLoadingBanner(message = 'Töötlen andmeid, palun oota...') {
    this.loadStyles()
    const container = this.getBannerContainer()
    this.removeBanner()

    this.currentBanner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner', 'ta-banner-loading']
      },
      '',
      container,
      'afterbegin'
    )

    // Add loading text
    this.loadingText = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner-loading-text']
      },
      message,
      this.currentBanner
    )

    // Add progress container (initially hidden)
    this.progressContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner-progress-container'],
        style: 'display: none;'
      },
      '',
      this.currentBanner
    )

    // Add progress bar
    this.progressBar = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner-progress-bar'],
        style: 'width: 0%;'
      },
      '',
      this.progressContainer
    )

    // Add progress text
    this.progressText = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner-progress-text']
      },
      '0 / 0',
      this.progressContainer
    )

    Logger.debug('Loading banner created and displayed')
  }

  /**
   * Update progress UI during sync
   * @param {number} current - Current progress
   * @param {number} total - Total items
   * @param {string} loadingMessage - Optional loading message to update
   */
  updateProgressUI(current, total, loadingMessage = null) {
    // Log progress even if UI elements are missing
    Logger.debug(`Progress: ${current}/${total} (${Math.round((current / total) * 100)}%)`)

    // Safely update UI elements if they exist
    try {
      if (this.progressContainer && this.progressBar && this.progressText) {
        // Show progress container
        this.progressContainer.style.display = 'block'

        // Update loading text if provided
        if (loadingMessage && this.loadingText) {
          this.loadingText.textContent = loadingMessage
        }

        // Calculate percentage
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0

        // Update progress bar
        this.progressBar.style.width = `${percentage}%`

        // Update progress text
        this.progressText.textContent = `${current} / ${total} (${percentage}%)`
      } else {
        Logger.debug('Progress UI elements not available, but process continues...')
      }
    } catch (error) {
      Logger.warning(`Error updating progress UI: ${error.message}`)
      // Don't let UI errors stop the process
    }
  }

  /**
   * Show success banner
   * @param {string} message - Success message
   * @param {Object} options - Additional options
   * @param {Function} options.onRefresh - Callback for refresh button
   * @param {Function} options.onClose - Callback for close button
   */
  showSuccessBanner(message, options = {}) {
    this.loadStyles()
    Logger.info('=== SHOWING SUCCESS BANNER ===')
    Logger.info(`Success message: ${message}`)

    const container = this.getBannerContainer()
    if (!container) {
      Logger.error('Failed to get banner container for success banner')
      return
    }

    this.removeBanner()

    this.currentBanner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner', 'ta-banner-success']
      },
      '',
      container,
      'afterbegin'
    )

    // Add success icon
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-size: 1.5rem; margin-bottom: 10px;'
      },
      '✅',
      this.currentBanner
    )

    // Add success message
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-weight: bold; margin-bottom: 10px;'
      },
      message,
      this.currentBanner
    )

    // Add refresh button if callback provided
    if (options.onRefresh) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-banner-button'],
          onclick: options.onRefresh,
          style: 'margin-right: 10px; background-color: #28a745; border-color: #28a745; color: white;'
        },
        'Refresh',
        this.currentBanner
      )
    }

    // Add close button if callback provided
    if (options.onClose) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-banner-button'],
          onclick: options.onClose,
          style: 'background-color: transparent; border-color: #28a745; color: #28a745;'
        },
        'Close',
        this.currentBanner
      )
    }

    Logger.info('Success banner created and displayed')
  }

  /**
   * Show error banner
   * @param {string} error - Error message
   * @param {Object} options - Additional options
   * @param {Function} options.onRetry - Callback for retry button
   * @param {Function} options.onRefresh - Callback for refresh button
   */
  showErrorBanner(error, options = {}) {
    this.loadStyles()
    const container = this.getBannerContainer()
    this.removeBanner()

    this.currentBanner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-banner', 'ta-banner-error']
      },
      '',
      container,
      'afterbegin'
    )

    // Add error icon
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-size: 1.5rem; margin-bottom: 10px;'
      },
      '❌',
      this.currentBanner
    )

    // Add error title
    domService.createAndInsertElement(
      'h3',
      {
        classList: ['ta-banner-error-title']
      },
      'Error',
      this.currentBanner
    )

    // Add error message
    domService.createAndInsertElement(
      'p',
      {
        classList: ['ta-banner-error-message']
      },
      error,
      this.currentBanner
    )

    // Add retry button if callback provided
    if (options.onRetry) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-banner-button', 'ta-banner-error-button'],
          onclick: options.onRetry,
          style: 'margin-right: 10px;'
        },
        'Retry',
        this.currentBanner
      )
    }

    // Add refresh button if callback provided
    if (options.onRefresh) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-banner-button'],
          onclick: options.onRefresh
        },
        'Refresh',
        this.currentBanner
      )
    }

    Logger.debug('Error banner created and displayed')
  }

  /**
   * Get the current banner element (for custom content injection)
   * @returns {Element|null} Current banner element
   */
  getCurrentBanner() {
    return this.currentBanner
  }

  /**
   * Check if a banner is currently displayed
   * @returns {boolean} True if banner exists
   */
  hasBanner() {
    return this.currentBanner !== null
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.removeBanner()
    styleService.removeCSS('banner-service-styles')
  }

  /**
   * Utility method to create a container element with specified classes
   * @param {Element} parent - Parent element to append the container to
   * @param {Array} classList - Array of CSS classes to apply
   * @returns {Element} The created container element
   */
  createContainer(parent, classList = []) {
    return domService.createAndInsertElement(
      'div',
      {
        classList: classList
      },
      '',
      parent
    )
  }

  /**
   * Utility method to create a section with a title
   * @param {Element} parent - Parent element to append the section to
   * @param {string} title - Title for the section
   * @param {Array} classList - Array of CSS classes to apply
   * @returns {Element} The created section element
   */
  createSection(parent, title, classList = []) {
    const section = domService.createAndInsertElement(
      'div',
      {
        classList: classList
      },
      '',
      parent
    )

    if (title) {
      domService.createAndInsertElement(
        'h3',
        {
          classList: ['ta-banner-title']
        },
        title,
        section
      )
    }

    return section
  }

  /**
   * Utility method to create a message element
   * @param {Element} parent - Parent element to append the message to
   * @param {string} message - Message text to display
   * @param {Array} classList - Array of CSS classes to apply
   */
  createMessage(parent, message, classList = ['ta-banner-message']) {
    domService.createAndInsertElement(
      'div',
      {
        classList: classList
      },
      message,
      parent
    )
  }
}

// Export a singleton instance
export const bannerService = new BannerService()
