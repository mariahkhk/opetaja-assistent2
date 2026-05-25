/**
 * Main-world XHR/fetch interceptor for Õpetaja Assistent 2.
 *
 * Injected into the page's main world via manifest content_scripts with
 * "world": "MAIN". Detects successful non-GET requests to Tahvel's backend
 * that target a journal and notifies the content script (isolated world)
 * via window.postMessage so it can invalidate stale cache entries.
 *
 * MUST be self-contained — no imports, no ES modules, no extension APIs.
 */
;(function() {
  'use strict'

  const BACKEND_PATH = '/hois_back/'
  const JOURNAL_ID_RE = /\/journals\/(\d+)/
  const JOURNAL_RELATED_RE = /\/(?:journals|journalEntry|journalEntriesByDate|journalStudents|journalOutcome)\b/
  const MESSAGE_TYPE = 'oa2:journalMutation'

  function extractJournalId(url) {
    if (!url || url.indexOf(BACKEND_PATH) === -1) return null
    const m = url.match(JOURNAL_ID_RE)
    return m ? Number(m[1]) : null
  }

  function isJournalRelatedUrl(url) {
    return url && url.indexOf(BACKEND_PATH) !== -1 && JOURNAL_RELATED_RE.test(url)
  }

  function notify(method, url) {
    if (!isJournalRelatedUrl(url)) return
    const journalId = extractJournalId(url)
    window.postMessage({ type: MESSAGE_TYPE, journalId, method }, window.location.origin)
  }

  // --- XMLHttpRequest patch ---------------------------------------------------

  const xhrOpen = XMLHttpRequest.prototype.open
  const xhrSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function(method, url) {
    this._oa2Method = method
    this._oa2Url = typeof url === 'string' ? url : String(url)
    return xhrOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function() {
    const method = this._oa2Method
    const url = this._oa2Url
    if (method && method.toUpperCase() !== 'GET') {
      this.addEventListener('load', function() {
        if (this.status >= 200 && this.status < 300) {
          notify(method, url)
        }
      }, { once: true })
    }
    return xhrSend.apply(this, arguments)
  }

  // --- fetch patch ------------------------------------------------------------

  const nativeFetch = window.fetch
  window.fetch = function(input, init) {
    const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : (input?.url || '')

    if (method !== 'GET') {
      return nativeFetch.apply(this, arguments).then(response => {
        if (response.ok) {
          notify(method, url)
        }
        return response
      })
    }

    return nativeFetch.apply(this, arguments)
  }
})()
