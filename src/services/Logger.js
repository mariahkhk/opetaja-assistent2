/**
 * Logger utility - Provides consistent logging across the extension
 * with better source line information in developer tools
 */

import { sentryService } from './SentryService.js'

// Store the page load timestamp
const PAGE_LOAD_TIME = Date.now()

// Define log levels with their emoji prefixes (using only yellow emojis)
export const LogLevel = {
  INFO: '✨',
  SUCCESS: '✨',
  WARNING: '✨',
  ERROR: '✨',
  DEBUG: '✨',
  FEATURE: '✨'
}

// Debug mode configuration
const DEBUG_MODE_KEY = 'OA_debug_mode'
let debugModeCache = false

// Initialize debug mode from storage
chrome.storage.sync.get([DEBUG_MODE_KEY], function(result) {
  debugModeCache = result[DEBUG_MODE_KEY] === true
})

/**
 * Check if debug mode is enabled
 * @returns {boolean} True if debug mode is enabled
 */
export function isDebugMode() {
  return debugModeCache
}

/**
 * Enable debug mode
 */
export function enableDebugMode() {
  debugModeCache = true
  chrome.storage.sync.set({ [DEBUG_MODE_KEY]: true })
  console.log('[Logger] Debug mode enabled - all log messages will be shown')
}

/**
 * Disable debug mode
 */
export function disableDebugMode() {
  debugModeCache = false
  chrome.storage.sync.set({ [DEBUG_MODE_KEY]: false })
  console.log('[Logger] Debug mode disabled - only important log messages will be shown')
}

/**
 * Get the number of seconds elapsed since page load
 * @returns {number} Seconds elapsed (integer)
 */
function getSecondsElapsed() {
  return Math.floor((Date.now() - PAGE_LOAD_TIME) / 1000)
}

/**
 * Log a message to the console with better caller information
 * @param {string} message - The message to log
 * @param {string} emoji - The emoji prefix (use LogLevel constants)
 * @param {any[]} args - Additional arguments to log
 */
export function log(message, emoji = LogLevel.INFO, ...args) {
  // Get seconds elapsed since page load
  const secondsElapsed = getSecondsElapsed()

  // Format the basic message with elapsed time
  const formattedMessage = `[${secondsElapsed}s] ${emoji} ${message}`

  // For browsers that support it, use console.groupCollapsed for cleaner output
  if (typeof console.groupCollapsed === 'function') {
    // Open a collapsed group with our message
    console.groupCollapsed(formattedMessage, ...args)

    // Show the trace inside the group - this will include clickable links to the actual source
    console.trace('Source:')

    // Close the group
    console.groupEnd()
  } else {
    // Fallback for browsers without groupCollapsed support
    console.log(formattedMessage, ...args)
    console.trace('Source:')
  }
}

/**
 * Log an info message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function info(message, ...args) {
  log(message, LogLevel.INFO, ...args)
}

/**
 * Log a success message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function success(message, ...args) {
  log(message, LogLevel.SUCCESS, ...args)
}

/**
 * Log a warning message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function warning(message, ...args) {
  log(message, LogLevel.WARNING, ...args)
}

/**
 * Log an error message
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments to log
 */
export function error(message, ...args) {
  log(message, LogLevel.ERROR, ...args)

  // Skip Sentry for expected HTTP errors (auth expired, not found, precondition failed)
  const EXPECTED_ERROR_PATTERN = /API Error: (401|403|404|412)\b/
  const errorObj = args.find(a => a instanceof Error)
  if (message instanceof Error && EXPECTED_ERROR_PATTERN.test(message.message)) return
  if (errorObj && EXPECTED_ERROR_PATTERN.test(errorObj.message)) return

  // Forward to Sentry
  if (message instanceof Error) {
    sentryService.captureException(message)
    return
  }
  if (errorObj) {
    sentryService.captureException(errorObj, { message })
  } else {
    sentryService.captureMessage(String(message), 'error')
  }
}

/**
 * Log a debug message (only shown if in development mode or debug mode is enabled)
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function debug(message, ...args) {
  // Check if we're in development mode
  let isDev = true

  // If chrome API is available, use it to check for production mode
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    isDev = !chrome.runtime.getManifest().update_url
  }

  // Log if in development mode OR if debug mode is explicitly enabled
  if (isDev || isDebugMode()) {
    log(message, LogLevel.DEBUG, ...args)
  }
}

/**
 * Log a feature-related message
 * @param {string} featureName - The name of the feature
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function feature(featureName, message, ...args) {
  log(`[${featureName}] ${message}`, LogLevel.FEATURE, ...args)
}

// Default export for convenient importing
export default {
  log,
  info,
  success,
  warning,
  error,
  debug,
  feature,
  LogLevel,
  isDebugMode,
  enableDebugMode,
  disableDebugMode
}
