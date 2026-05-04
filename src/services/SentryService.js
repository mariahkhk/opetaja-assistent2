/**
 * Lightweight Sentry error tracking service
 *
 * Sends error events to Sentry using the envelope API.
 * Supports multiple DSNs — add yours to the SENTRY_DSNS array below.
 *
 * IMPORTANT: This file must NOT import Logger.js to avoid circular dependency.
 * Use console.warn for internal diagnostics.
 */

// ============================================================
// Sentry DSN(s) — errors are sent to ALL listed DSNs.
//
// To add your own:
// 1. Create a Sentry project at https://sentry.io
// 2. Go to Settings → Projects → [your project] → Client Keys (DSN)
// 3. Copy the DSN (looks like: https://<key>@<host>/<id>)
// 4. Add it to the array below
// 5. Rebuild the extension: bun run build
// ============================================================
const SENTRY_DSNS = [
  'https://162367f07e44e070e8382e4557fd8cb9@o4511196793733120.ingest.de.sentry.io/4511196828860496',
]

const MAX_EVENTS_PER_MINUTE = 10
const DEDUP_WINDOW_MS = 60_000
const MAX_PENDING_EVENTS = 20

// Internal state
let parsedDsns = []
let release = 'unknown'
let environment = 'production'
let initialized = false
let recentEvents = []
let eventsThisMinute = 0
let minuteResetTimer = null
let pendingEvents = []

/**
 * Parse a Sentry DSN string into its components
 * @param {string} dsn - Sentry DSN string
 * @returns {{ publicKey: string, host: string, projectId: string, envelopeUrl: string } | null}
 */
function parseDsn(dsn) {
  if (!dsn || typeof dsn !== 'string') return null
  const match = dsn.match(/^https:\/\/([a-f0-9]+)@([^/]+)\/(\d+)$/)
  if (!match) return null
  return {
    publicKey: match[1],
    host: match[2],
    projectId: match[3],
    envelopeUrl: `https://${match[2]}/api/${match[3]}/envelope/`
  }
}

/**
 * Parse a stack trace string into Sentry-compatible frames
 * @param {string} stack - Stack trace string
 * @returns {Array} Array of frame objects (bottom-up order for Sentry)
 */
function parseStackTrace(stack) {
  if (!stack) return []

  const frames = []
  const lines = stack.split('\n')

  for (const line of lines) {
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/)
    if (match) {
      frames.push({
        function: match[1] || '?',
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10)
      })
    }
  }

  // Sentry expects frames in bottom-up order (most recent last)
  return frames.reverse()
}

/**
 * Build base Sentry event fields shared by exception and message events.
 * Guards window/navigator access for service worker compatibility.
 * @param {string} level - Severity level
 * @param {Object} context - Additional context
 * @returns {Object} Base event fields
 */
function buildBaseEvent(level, context = {}) {
  const { tags, ...extra } = context

  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level,
    release,
    environment,
    tags: { ...tags },
    contexts: {
      browser: typeof navigator !== 'undefined'
        ? { name: navigator.userAgent.match(/Chrome|Firefox|Safari|Edge/)?.[0] ?? 'Unknown' }
        : { name: 'service-worker' },
      extension: { version: release, url: typeof window !== 'undefined' ? window.location.href : 'background' }
    },
    extra
  }
}

/**
 * Build a Sentry error event from an Error object
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context
 * @returns {Object} Sentry event object
 */
function buildExceptionEvent(error, context = {}) {
  const frames = parseStackTrace(error.stack)
  const base = buildBaseEvent('error', context)

  return {
    ...base,
    exception: {
      values: [{
        type: error.name || 'Error',
        value: error.message || String(error),
        stacktrace: frames.length > 0 ? { frames } : undefined
      }]
    }
  }
}

/**
 * Build a Sentry message event
 * @param {string} message - The message to capture
 * @param {string} level - Severity level
 * @param {Object} context - Additional context
 * @returns {Object} Sentry event object
 */
function buildMessageEvent(message, level = 'error', context = {}) {
  return {
    ...buildBaseEvent(level, context),
    message: { formatted: String(message) }
  }
}

/**
 * Serialize a Sentry event into the envelope format
 * @param {Object} event - Sentry event object
 * @param {Object} dsn - Parsed DSN object
 * @returns {string} Envelope string
 */
function serializeEnvelope(event, dsn) {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn: `https://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`
  })

  const itemBody = JSON.stringify(event)
  const itemHeader = JSON.stringify({
    type: 'event',
    length: new TextEncoder().encode(itemBody).length
  })

  return `${header}\n${itemHeader}\n${itemBody}`
}

/**
 * Check rate limit and dedup before sending
 * @param {string} fingerprint - Event fingerprint for dedup
 * @returns {boolean} True if event should be sent
 */
function shouldSend(fingerprint) {
  const now = Date.now()

  if (eventsThisMinute >= MAX_EVENTS_PER_MINUTE) return false

  const isDuplicate = recentEvents.some(
    e => e.fingerprint === fingerprint && (now - e.timestamp) < DEDUP_WINDOW_MS
  )
  if (isDuplicate) return false

  eventsThisMinute++
  recentEvents.push({ fingerprint, timestamp: now })

  // Clean up old dedup entries
  recentEvents = recentEvents.filter(
    e => (now - e.timestamp) < DEDUP_WINDOW_MS
  )

  // Reset minute counter
  if (!minuteResetTimer) {
    minuteResetTimer = setTimeout(() => {
      eventsThisMinute = 0
      minuteResetTimer = null
    }, 60_000)
  }

  return true
}

/**
 * Send an event to all configured DSNs via the background script.
 * Content scripts can't fetch cross-origin due to page CSP restrictions,
 * so we delegate to the background service worker which has its own origin.
 * @param {Object} event - Sentry event object
 */
function sendToAllDsns(event) {
  if (!chrome.runtime?.id) return

  const isServiceWorker = typeof window === 'undefined'

  for (const dsn of parsedDsns) {
    const envelope = serializeEnvelope(event, dsn)

    if (isServiceWorker) {
      // Background service worker: fetch directly
      fetch(dsn.envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${dsn.publicKey}`
        },
        body: envelope
      }).catch(err => {
        console.warn(`[SentryService] Failed to send to ${dsn.host}:`, err.message)
      })
    } else {
      // Content script: delegate to background service worker
      chrome.runtime.sendMessage({
        action: 'sentryEvent',
        url: dsn.envelopeUrl,
        publicKey: dsn.publicKey,
        envelope
      }).catch(err => {
        console.warn(`[SentryService] Failed to send to ${dsn.host}:`, err.message)
      })
    }
  }
}

/**
 * Flush events that were buffered before initialization
 */
function flushPendingEvents() {
  if (parsedDsns.length === 0) {
    pendingEvents = []
    return
  }

  for (const pending of pendingEvents) {
    const event = pending.type === 'exception'
      ? buildExceptionEvent(pending.error, pending.context)
      : buildMessageEvent(pending.message, pending.level, pending.context)
    sendToAllDsns(event)
  }
  pendingEvents = []
}

/**
 * Sentry service — public API
 */
export const sentryService = {
  /**
   * Initialize the Sentry service.
   * Parses DSNs, detects environment, registers global error handlers.
   */
  init() {
    if (initialized) return
    try {
      parsedDsns = SENTRY_DSNS.map(parseDsn).filter(Boolean)

      if (parsedDsns.length === 0) {
        initialized = true
        return
      }

      // Detect environment and version
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        const manifest = chrome.runtime.getManifest()
        release = `opetaja-assistent2@${manifest.version}`
        environment = manifest.update_url ? 'production' : 'development'
      }

      // Register global error handlers
      window.addEventListener('error', event => {
        this.captureException(event.error || new Error(event.message), {
          tags: { handler: 'window.onerror' },
          source: event.filename,
          lineno: event.lineno,
          colno: event.colno
        })
      })

      window.addEventListener('unhandledrejection', event => {
        const error = event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason))
        this.captureException(error, {
          tags: { handler: 'unhandledrejection' }
        })
      })

      initialized = true
      flushPendingEvents()
    } catch (err) {
      console.warn('[SentryService] Failed to initialize:', err)
    }
  },

  /**
   * Initialize for background service worker context.
   * Skips window event listeners (not available in service workers).
   */
  initBackground() {
    if (initialized) return
    try {
      parsedDsns = SENTRY_DSNS.map(parseDsn).filter(Boolean)

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        const manifest = chrome.runtime.getManifest()
        release = `opetaja-assistent2@${manifest.version}`
        environment = manifest.update_url ? 'production' : 'development'
      }

      initialized = true
      flushPendingEvents()
    } catch (err) {
      console.warn('[SentryService] Failed to initialize (background):', err)
    }
  },

  /**
   * Check if service has DSNs configured and is ready
   * @returns {boolean}
   */
  isActive() {
    return initialized && parsedDsns.length > 0
  },

  /**
   * Capture an Error object and send to Sentry
   * @param {Error} error - The error to capture
   * @param {Object} [context={}] - Additional context
   */
  captureException(error, context = {}) {
    try {
      if (!(error instanceof Error)) {
        this.captureMessage(String(error), 'error', context)
        return
      }

      if (!initialized) {
        if (pendingEvents.length < MAX_PENDING_EVENTS) {
          pendingEvents.push({ type: 'exception', error, context })
        }
        return
      }

      const fingerprint = `${error.name}:${error.message}`
      if (!shouldSend(fingerprint)) return

      sendToAllDsns(buildExceptionEvent(error, context))
    } catch (err) {
      console.warn('[SentryService] Failed to capture exception:', err)
    }
  },

  /**
   * Capture a message and send to Sentry
   * @param {string} message - The message
   * @param {string} [level='error'] - Severity level
   * @param {Object} [context={}] - Additional context
   */
  captureMessage(message, level = 'error', context = {}) {
    try {
      if (!initialized) {
        if (pendingEvents.length < MAX_PENDING_EVENTS) {
          pendingEvents.push({ type: 'message', message, level, context })
        }
        return
      }

      const fingerprint = `msg:${message}`
      if (!shouldSend(fingerprint)) return

      sendToAllDsns(buildMessageEvent(message, level, context))
    } catch (err) {
      console.warn('[SentryService] Failed to capture message:', err)
    }
  }
}

// Export internals for testing
export {
  parseDsn,
  shouldSend,
  flushPendingEvents,
  sendToAllDsns,
  buildBaseEvent,
  buildExceptionEvent,
  buildMessageEvent,
  parseStackTrace,
  serializeEnvelope,
  SENTRY_DSNS
}

export default sentryService

export function resetState(overrides = {}) {
  parsedDsns = overrides.parsedDsns ?? []
  release = overrides.release ?? 'unknown'
  environment = overrides.environment ?? 'production'
  initialized = overrides.initialized ?? false
  recentEvents = []
  eventsThisMinute = 0
  if (minuteResetTimer) {
    clearTimeout(minuteResetTimer)
    minuteResetTimer = null
  }
  pendingEvents = []
}

export function getState() {
  return { parsedDsns, release, environment, initialized, recentEvents, eventsThisMinute, pendingEvents }
}
