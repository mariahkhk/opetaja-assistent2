/**
 * Core extension module - Main entry point for the Õpetaja Assistent 2
 */

import { navigationService } from '../services/NavigationService.js'
import { loadFeatures } from './FeaturesRegistry.js'
import Logger from '../services/Logger.js'
import versionCheckService from '../services/VersionCheckService.js'
import { cacheService } from '../services/CacheService.js'

// Main extension controller
const tahvelExtension = {
  // Feature collection (will be populated dynamically)
  activeFeatures: [],

  // Initialize the extension
  async init() {
    Logger.success('Initializing Õpetaja Assistent 2...')

    // Show "extension updated" modal if the running version differs from the
    // last dismissed one
    versionCheckService.checkForUpdate().catch(err =>
      Logger.debug('[VersionCheckService] checkForUpdate failed:', err?.message)
    )

    // Add visual indicator to show the extension is active
    this.addVisualIndicator()

    // Set up URL change detection
    navigationService.init()

    try {
      // Load features dynamically
      this.activeFeatures = await loadFeatures()
      if (this.activeFeatures.length > 0) {
        Logger.success(`Loaded ${this.activeFeatures.length} features dynamically`)
      } else {
        Logger.error('No features were loaded')
      }
    } catch (error) {
      Logger.error('Failed to load features:', error)
    }

    // Listen for navigation events
    navigationService.onNavigate(this.handleNavigation.bind(this))

    // Initial navigation check
    this.handleNavigation(window.location.href)

    Logger.success('Initialization complete')
  },

  // Add visual indicator to show the extension is active
  addVisualIndicator() {
    // Keep track of whether we've added the indicator
    this.indicatorAdded = false

    // Function to add the indicator
    const addIndicator = () => {
      // If we've already added the indicator, don't add it again
      if (this.indicatorAdded) {
        return
      }

      const userMenuButton = document.querySelector('#user-menu-button')
      if (userMenuButton) {
        // Check if indicator is already added to the DOM
        if (userMenuButton.querySelector('.oa-indicator')) {
          this.indicatorAdded = true
          return
        }

        // Get Kriit API URL from storage
        chrome.storage.local.get(['OA_kriitApiBaseUrl'], result => {
          // Double-check that indicator hasn't been added while we were getting storage
          if (this.indicatorAdded || userMenuButton.querySelector('.oa-indicator')) {
            this.indicatorAdded = true
            return
          }

          const kriitApiUrl = result['OA_kriitApiBaseUrl'] || ''

          // Check if using dev Kriit (any URL that's not the default production Kriit)
          const isDevKriit = kriitApiUrl && !kriitApiUrl.includes('kriit.vikk.ee')

          // Create the indicator element
          const indicator = document.createElement('span')
          indicator.className = 'oa-indicator'
          indicator.style.cssText = `
            background-color: ${isDevKriit ? 'red' : 'green'};
            color: white;
            border-radius: 4px;
            padding: 2px;
            margin-left: 4px;
          `
          indicator.title = isDevKriit ? 'Õpetaja Assistent 2 kasutab dev Kriiti' : 'Õpetaja Assistent 2 on aktiivne'
          indicator.textContent = isDevKriit ? 'DEV' : 'ÕA2'

          // Append the indicator to the user menu button
          userMenuButton.appendChild(indicator)

          // Mark as added
          this.indicatorAdded = true

          Logger.debug(`Added visual indicator (${isDevKriit ? 'DEV' : 'ÕA2'})`)
        })
      }
    }

    // Try to add indicator immediately
    addIndicator()

    // If not found, wait for DOM changes and try again
    const observer = new MutationObserver(mutations => {
      // If we've already added the indicator, disconnect the observer
      if (this.indicatorAdded) {
        observer.disconnect()
        return
      }

      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          const userMenuButton = document.querySelector('#user-menu-button')
          if (userMenuButton && !userMenuButton.querySelector('.oa-indicator')) {
            addIndicator()

            // If indicator was added, disconnect the observer
            if (this.indicatorAdded) {
              observer.disconnect()
              break
            }
          }
        }
      }
    })

    // Start observing the document body for DOM changes
    observer.observe(document.body, { childList: true, subtree: true })

    // Also handle navigation events to ensure indicator is added after page changes
    navigationService.onNavigate(() => {
      // Check if the indicator is still in the DOM after navigation
      const userMenuButton = document.querySelector('#user-menu-button')
      const indicatorExists = userMenuButton && userMenuButton.querySelector('.oa-indicator')

      // Only reset the flag and try to add the indicator if it's not in the DOM
      if (!indicatorExists) {
        this.indicatorAdded = false
        setTimeout(addIndicator, 500)
      }
    })
  },

  // Check if URL is the main/home page (no specific sub-route)
  isMainPage(url) {
    try {
      const hash = new URL(url).hash
      return hash === '#/' || hash === '#' || hash === '' || hash === '#/students'
    } catch {
      return false
    }
  },

  // Check for role or school change and clear cache if needed
  async checkContextChange() {
    try {
      const { api } = await import('./BaseFeature.js')
      const apiService = api?.tahvel
      if (!apiService) return

      const userInfo = await apiService.get('/user', {}, { cache: false })
      if (!userInfo?.roleCode) return

      const currentSchoolId = userInfo.school?.id
      const stored = await new Promise(resolve =>
        chrome.storage.local.get(['OA_currentRole', 'OA_currentSchoolId'], resolve)
      )

      const roleChanged = stored.OA_currentRole && stored.OA_currentRole !== userInfo.roleCode
      const schoolChanged = stored.OA_currentSchoolId != null && currentSchoolId != null &&
        Number(stored.OA_currentSchoolId) !== Number(currentSchoolId)

      if (roleChanged || schoolChanged) {
        const reasons = []
        if (roleChanged) reasons.push(`role ${stored.OA_currentRole} → ${userInfo.roleCode}`)
        if (schoolChanged) reasons.push(`school ${stored.OA_currentSchoolId} → ${currentSchoolId}`)
        Logger.info(`[Extension] ${reasons.join(', ')}, clearing cache`)
        await cacheService.clearCache()
      }

      chrome.storage.local.set({
        OA_currentRole: userInfo.roleCode,
        ...(currentSchoolId != null && { OA_currentSchoolId: currentSchoolId })
      })
    } catch (e) {
      Logger.warning('[Extension] Error checking role/school change:', e.message)
    }
  },

  // Handle navigation events
  handleNavigation(url) {
    Logger.debug(`Navigation detected: ${url}`)

    // Evict expired cache entries when visiting main page
    if (this.isMainPage(url)) {
      cacheService.evictExpired().catch(e => Logger.warning('[Cache] evictExpired error:', e.message))
      // Fire-and-forget: cache clears before next navigation to a feature page
      this.checkContextChange()
    }

    // Activate relevant features for current page
    this.activeFeatures.forEach(feature => {
      if (feature.shouldActivate(url)) {
        if (!feature.isActive) {
          Logger.debug(`[${feature.name}] Activating feature`)
        }
        feature.activate()
      } else if (feature.isActive) {
        Logger.debug(`[${feature.name}] Deactivating feature`)
        feature.deactivate()
      }
    })
  }
}

// Initialize extension when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  tahvelExtension.init()
})

export default tahvelExtension
