/**
 * Global Message Listener Service
 *
 * Handles Chrome runtime messages for Kriit settings changes across all features
 * This service can be imported and used by any feature that needs to respond to
 * settings changes from the popup.
 */

import Logger from './Logger.js'

/**
 * Set up global message listener for Kriit settings changes
 * @param {Object} context - The context object (usually 'this' from a feature class)
 * @param {Object} context.api - API service instance with kriit property
 * @param {boolean} context.isEnabled - Feature enabled state
 * @param {Function} context.removeSyncBanner - Function to remove sync banner
 * @param {Function} context.fetchJournalData - Function to fetch journal data
 * @param {Function} context.showMissingApiKeyBanner - Function to show missing API key banner
 */
export function setupKriitMessageListener(context) {
  // Guard against missing chrome.runtime (e.g., in test environments)
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    return
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return
    if (message.action === 'kriitEnabledChanged') {
      Logger.debug('Received kriitEnabledChanged message:', message.enabled)

      // Update the enabled state
      context.api.kriit.enabled = message.enabled

      if (message.enabled) {
        // If enabled and we have a token, activate the feature
        if (context.api.kriit.authToken) {
          Logger.debug('Kriit support enabled and token available - activating feature')
          context.isEnabled = true
          context.removeSyncBanner()
          context.fetchJournalData()
        } else {
          Logger.debug('Kriit support enabled but no token available')
          context.isEnabled = false
          context.showMissingApiKeyBanner()
        }
      } else {
        // If disabled, deactivate the feature
        Logger.debug('Kriit support disabled - deactivating feature')
        context.isEnabled = false
        context.removeSyncBanner()
      }
    } else if (message.action === 'kriitSettingsUpdated') {
      Logger.debug('Received kriitSettingsUpdated message')

      // Update API settings
      if (message.apiUrl) {
        context.api.kriit.setBaseUrl(message.apiUrl)
      }

      // A string apiKey (including '') is treated as authoritative; only skip
      // when the field is absent so URL-only updates do not disturb the token.
      if (typeof message.apiKey === 'string') {
        context.api.kriit.setAuthToken(message.apiKey)
      }

      // Update enabled state
      if (message.enabled !== undefined) {
        context.api.kriit.enabled = message.enabled
      }

      // If we have a token and Kriit is enabled, activate the feature
      if (context.api.kriit.authToken && context.api.kriit.enabled) {
        Logger.debug('Kriit settings updated with valid token - activating feature')
        context.isEnabled = true
        context.removeSyncBanner()
        context.fetchJournalData()
      } else if (!context.api.kriit.authToken && context.api.kriit.enabled) {
        // Token was just cleared (e.g. via popup Kustuta). Surface the missing-key banner.
        Logger.debug('Kriit settings updated but no token available - showing missing key banner')
        context.isEnabled = false
        context.removeSyncBanner()
        context.showMissingApiKeyBanner()
      }
    }
  })
}

/**
 * Alternative setup function for features that need custom handling
 * @param {Function} messageHandler - Custom message handler function
 */
export function setupCustomMessageListener(messageHandler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return
    messageHandler(message, sender, sendResponse)
  })
}
