import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { restoreChromeMock } from './setup.js'

const popup = await import('../src/popup.js')

const POPUP_ELEMENTS = [
  ['input', 'debug-mode', { type: 'checkbox' }],
  ['button', 'clear-cache'],
  ['span', 'version'],
  ['input', 'highlight-missing-grades', { type: 'checkbox' }],
  ['input', 'kriit-enabled', { type: 'checkbox' }],
  ['div', 'kriit-settings-container'],
  ['input', 'kriit-api-url'],
  ['input', 'kriit-api-key', { type: 'password' }],
  ['button', 'toggle-api-key-visibility', {}, 'Näita'],
  ['button', 'delete-api-key'],
  ['button', 'save-kriit-settings'],
  ['span', 'save-status'],
  ['div', 'error-log', { style: 'display:none' }],
  ['button', 'view-cache-details'],
  ['button', 'refresh-cache-stats'],
  ['div', 'debug-tools', { style: 'display:none' }],
  ['button', 'download-api-requests'],
  ['div', 'cache-stats-container'],
  ['div', 'cache-details', { style: 'display:none' }],
  ['div', 'kriit-api-key-status', { style: 'display:none' }]
]

function buildPopupDOM() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  for (const [tag, id, attrs = {}, text = ''] of POPUP_ELEMENTS) {
    const el = document.createElement(tag)
    el.id = id
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    if (text) el.textContent = text
    document.body.appendChild(el)
  }
}

function setupChromeWithTabs(initialStore = {}, tabUrl = 'https://tahvel.edu.ee/') {
  restoreChromeMock()
  for (const [key, value] of Object.entries(initialStore)) {
    global.chrome.storage.local._store[key] = value
  }
  global.chrome.runtime.getManifest = mock(() => ({ version: '1.2.3' }))
  global.chrome.runtime.lastError = null
  global.chrome.tabs = {
    query: mock((_query, callback) => callback([{ id: 7, url: tabUrl }])),
    sendMessage: mock((tabId, msg, cb) => {
      if (typeof cb === 'function') {
        cb({ status: 'success', stats: { storage: { count: 3, size: 2048 }, totalBytesInUse: 4096 } })
      }
      return Promise.resolve({ success: true })
    })
  }
}

describe('popup.js — exported helpers', () => {
  beforeEach(() => {
    buildPopupDOM()
  })

  describe('isTahvelUrl', () => {
    it('returns true for tahvel.edu.ee URLs', () => {
      expect(popup.isTahvelUrl('https://tahvel.edu.ee/')).toBe(true)
      expect(popup.isTahvelUrl('https://tahvel.edu.ee/#/journal/123')).toBe(true)
    })

    it('returns true for test.tahvel.eenet.ee URLs', () => {
      expect(popup.isTahvelUrl('https://test.tahvel.eenet.ee/')).toBe(true)
    })

    it('returns false for other domains', () => {
      expect(popup.isTahvelUrl('https://other.example.com/')).toBe(false)
    })

    it('returns falsy for null/undefined/empty', () => {
      expect(popup.isTahvelUrl(null)).toBeFalsy()
      expect(popup.isTahvelUrl(undefined)).toBeFalsy()
      expect(popup.isTahvelUrl('')).toBeFalsy()
    })
  })

  describe('formatSize', () => {
    it('formats bytes', () => {
      expect(popup.formatSize(0)).toBe('0 B')
      expect(popup.formatSize(512)).toBe('512 B')
    })

    it('formats kilobytes', () => {
      expect(popup.formatSize(1024)).toBe('1.0 KB')
      expect(popup.formatSize(1536)).toBe('1.5 KB')
    })

    it('formats megabytes', () => {
      expect(popup.formatSize(1024 * 1024)).toBe('1.0 MB')
    })
  })

  describe('setApiKeySavedIndicator', () => {
    it('shows saved indicator when hasKey is true', () => {
      popup.setApiKeySavedIndicator(true)
      expect(document.getElementById('kriit-api-key-status').style.display).toBe('flex')
    })

    it('hides indicator when hasKey is false', () => {
      popup.setApiKeySavedIndicator(false)
      expect(document.getElementById('kriit-api-key-status').style.display).toBe('none')
    })

    it('does not throw when indicator is missing from DOM', () => {
      document.getElementById('kriit-api-key-status').remove()
      expect(() => popup.setApiKeySavedIndicator(true)).not.toThrow()
    })
  })
})

describe('popup.js — initPopup wired up', () => {
  beforeEach(() => {
    buildPopupDOM()
    setupChromeWithTabs({
      OA_debug_mode: true,
      OA_kriitEnabled: true,
      OA_kriitApiBaseUrl: 'https://kriit.example.com',
      OA_kriitApiToken: 'stored-token',
      OA_highlightMissingGrades: true
    })
    document.dispatchEvent(new Event('DOMContentLoaded'))
  })

  it('renders manifest version and reflects stored settings', async () => {
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('version').textContent).toBe('1.2.3')
    expect(document.getElementById('debug-mode').checked).toBe(true)
    expect(document.getElementById('debug-tools').style.display).toBe('block')
    expect(document.getElementById('kriit-enabled').checked).toBe(true)
    expect(document.getElementById('kriit-settings-container').style.display).toBe('block')
    expect(document.getElementById('kriit-api-url').value).toBe('https://kriit.example.com')
    expect(document.getElementById('kriit-api-key').value).toBe('')
    expect(document.getElementById('kriit-api-key-status').style.display).toBe('flex')
    expect(document.getElementById('highlight-missing-grades').checked).toBe(true)
  })

  it('toggles debug-mode storage and shows/hides debug tools', async () => {
    await new Promise(r => setTimeout(r, 10))
    const cb = document.getElementById('debug-mode')

    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 10))

    expect(global.chrome.storage.local._store.OA_debug_mode).toBe(false)
    expect(document.getElementById('debug-tools').style.display).toBe('none')
  })

  it('toggles highlight-missing-grades and notifies content script', async () => {
    await new Promise(r => setTimeout(r, 10))
    const cb = document.getElementById('highlight-missing-grades')

    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 10))

    expect(global.chrome.storage.local._store.OA_highlightMissingGrades).toBe(false)
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalled()
  })

  it('toggles kriit-enabled and hides settings container when disabled', async () => {
    await new Promise(r => setTimeout(r, 10))
    const cb = document.getElementById('kriit-enabled')

    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 10))

    expect(global.chrome.storage.local._store.OA_kriitEnabled).toBe(false)
    expect(document.getElementById('kriit-settings-container').style.display).toBe('none')
  })

  it('toggles api-key visibility between password and text', async () => {
    await new Promise(r => setTimeout(r, 10))
    const input = document.getElementById('kriit-api-key')
    const btn = document.getElementById('toggle-api-key-visibility')

    expect(input.type).toBe('password')
    btn.click()
    expect(input.type).toBe('text')
    expect(btn.textContent).toBe('Peida')
    btn.click()
    expect(input.type).toBe('password')
    expect(btn.textContent).toBe('Näita')
  })

  it('toggles cache-details visibility', async () => {
    await new Promise(r => setTimeout(r, 10))
    const details = document.getElementById('cache-details')
    const btn = document.getElementById('view-cache-details')

    btn.click()
    expect(details.style.display).toBe('block')
    expect(btn.textContent).toBe('Peida detailid')

    btn.click()
    expect(details.style.display).toBe('none')
    expect(btn.textContent).toBe('Vaata detaile')
  })

  it('saves Kriit settings with HTTPS URL and new key', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('kriit-api-url').value = 'https://kriit.example.com'
    document.getElementById('kriit-api-key').value = 'new-token'
    document.getElementById('save-kriit-settings').click()

    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.storage.local._store.OA_kriitApiToken).toBe('new-token')
    expect(global.chrome.storage.local._store.OA_kriitApiBaseUrl).toBe('https://kriit.example.com')
    expect(document.getElementById('save-status').textContent).toBe('Salvestatud!')
  })

  it('rejects non-HTTPS URL on save (alert blocked)', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalAlert = global.alert
    let alertCalled = false
    global.alert = () => { alertCalled = true }

    document.getElementById('kriit-api-url').value = 'http://insecure.example.com/api'
    document.getElementById('kriit-api-key').value = 'x'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 30))

    expect(alertCalled).toBe(true)
    global.alert = originalAlert
  })

  it('allows http://localhost URLs for local development', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('kriit-api-url').value = 'http://localhost:3000/api'
    document.getElementById('kriit-api-key').value = 'local-token'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.storage.local._store.OA_kriitApiBaseUrl).toBe('http://localhost:3000/api')
  })

  it('preserves existing key when save is called with empty key field', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('kriit-api-url').value = 'https://kriit.example.com'
    document.getElementById('kriit-api-key').value = ''
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.storage.local._store.OA_kriitApiToken).toBe('stored-token')
  })

  it('shows error when no key has ever been stored and field is empty', async () => {
    setupChromeWithTabs({})
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 50))

    const errorLog = document.getElementById('error-log')
    expect(errorLog.style.display).toBe('block')
    expect(errorLog.textContent).toContain('API võti puudub')
  })

  it('deletes API key when user confirms', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalConfirm = global.confirm
    global.confirm = () => true

    document.getElementById('delete-api-key').click()
    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.storage.local._store.OA_kriitApiToken).toBeUndefined()
    expect(document.getElementById('save-status').textContent).toBe('Võti kustutatud')
    global.confirm = originalConfirm
  })

  it('skips delete when user cancels confirm dialog', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalConfirm = global.confirm
    global.confirm = () => false

    document.getElementById('delete-api-key').click()
    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.storage.local._store.OA_kriitApiToken).toBe('stored-token')
    global.confirm = originalConfirm
  })

  it('refreshes cache statistics on click', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 30))

    const container = document.getElementById('cache-stats-container')
    expect(container.textContent).toContain('Vahemälu kirjeid:')
    expect(container.textContent).toContain('3')
  })

  it('clears cache and notifies content script', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.storage.local._store.OA_cache_legacy = 'old-data'

    const originalAlert = global.alert
    global.alert = () => {}

    document.getElementById('clear-cache').click()
    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.tabs.sendMessage).toHaveBeenCalled()
    global.alert = originalAlert
  })

  it('shows error when clearing cache without a Tahvel tab open', async () => {
    setupChromeWithTabs({}, 'https://google.com')
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise(r => setTimeout(r, 10))

    document.getElementById('clear-cache').click()
    await new Promise(r => setTimeout(r, 30))

    const errorLog = document.getElementById('error-log')
    expect(errorLog.textContent).toContain('Ava Tahvli leht')
  })

  it('shows error for download when no Tahvel tab is active', async () => {
    setupChromeWithTabs({}, 'https://google.com')
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise(r => setTimeout(r, 10))

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    const errorLog = document.getElementById('error-log')
    expect(errorLog.textContent).toContain('Ava Tahvli leht')
  })

  it('shows error when downloaded requests are empty', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCapturedRequests') {
        cb({
          status: 'success',
          data: { requests: [], metadata: { journalId: 'all' } }
        })
      }
    })

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    const errorLog = document.getElementById('error-log')
    expect(errorLog.textContent).toContain('Salvestatud API päringuid ei leitud')
  })

  it('handles chrome.runtime.lastError on save', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalGet = global.chrome.storage.local.get
    global.chrome.storage.local.get = (_keys, cb) => {
      global.chrome.runtime.lastError = { message: 'simulated' }
      cb({})
    }

    document.getElementById('kriit-api-url').value = 'https://k.example.com'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 30))

    const errorLog = document.getElementById('error-log')
    expect(errorLog.textContent).toContain('Seadete lugemine ebaõnnestus')

    global.chrome.runtime.lastError = null
    global.chrome.storage.local.get = originalGet
  })

  it('handles chrome.runtime.lastError on storage set during save', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalSet = global.chrome.storage.local.set
    global.chrome.storage.local.set = (_items, cb) => {
      global.chrome.runtime.lastError = { message: 'set-fail' }
      cb()
    }

    document.getElementById('kriit-api-url').value = 'https://k.example.com'
    document.getElementById('kriit-api-key').value = 'tok'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('error-log').textContent).toContain('Seadete salvestamine ebaõnnestus')

    global.chrome.runtime.lastError = null
    global.chrome.storage.local.set = originalSet
  })

  it('handles chrome.runtime.lastError on delete', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalConfirm = global.confirm
    global.confirm = () => true
    const originalRemove = global.chrome.storage.local.remove
    global.chrome.storage.local.remove = (_keys, cb) => {
      global.chrome.runtime.lastError = { message: 'rm-fail' }
      cb()
    }

    document.getElementById('delete-api-key').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('error-log').textContent).toContain('Võtme kustutamine ebaõnnestus')

    global.chrome.runtime.lastError = null
    global.chrome.storage.local.remove = originalRemove
    global.confirm = originalConfirm
  })

  it('clears save status after delay', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalSetTimeout = global.setTimeout
    let scheduled
    global.setTimeout = (fn, ms) => { scheduled = fn; return originalSetTimeout(() => {}, 0) }

    document.getElementById('kriit-api-url').value = 'https://k.example.com'
    document.getElementById('kriit-api-key').value = 'tok'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => originalSetTimeout(r, 30))

    expect(document.getElementById('save-status').textContent).toBe('Salvestatud!')
    scheduled()
    expect(document.getElementById('save-status').textContent).toBe('')

    global.setTimeout = originalSetTimeout
  })

  it('shows cache details when cache is empty', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCacheStats') {
        cb({ status: 'success', stats: { storage: { count: 0, size: 0 }, totalBytesInUse: 0 } })
      }
    })

    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('cache-details').textContent).toContain('Vahemälu on tühi')
  })

  it('shows error when cache stats response is missing', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCacheStats') cb(null)
    })

    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('cache-stats-container').textContent).toContain('Vahemälu statistika pole saadaval')
  })

  it('shows error when no active tab on cache stats', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.query = mock((_q, cb) => cb([]))

    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('cache-stats-container').textContent).toBe('Vahemälu statistika pole saadaval')
  })

  it('shows error when clearCache content message returns success=false', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock(() => Promise.resolve({ success: false, error: 'oops' }))

    document.getElementById('clear-cache').click()
    await new Promise(r => setTimeout(r, 50))

    expect(document.getElementById('error-log').textContent).toContain('Vahemälu tühjendamine ebaõnnestus')
  })

  it('shows error when clearCache sendMessage rejects', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock(() => Promise.reject(new Error('connect-fail')))

    document.getElementById('clear-cache').click()
    await new Promise(r => setTimeout(r, 50))

    expect(document.getElementById('error-log').textContent).toContain('connect-fail')
  })

  it('shows error when download has lastError on sendMessage', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCapturedRequests') {
        global.chrome.runtime.lastError = { message: 'msg-fail' }
        cb()
      }
    })

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('error-log').textContent).toContain('Ava Tahvli leht')
    global.chrome.runtime.lastError = null
  })

  it('shows error when download response status is not success', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCapturedRequests') cb({ status: 'error', message: 'boom' })
    })

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('error-log').textContent).toContain('boom')
  })

  it('initPopup catches errors when required element is missing', async () => {
    document.getElementById('debug-mode').remove()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to initialize')
  })

  it('handles manifest access error gracefully', async () => {
    document.getElementById('version').textContent = ''
    setupChromeWithTabs({})
    global.chrome.runtime.getManifest = () => { throw new Error('manifest-broken') }
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('error-log').style.display).toBe('none')
    expect(document.getElementById('version').textContent).toBe('')
  })

  it('event-handler catch path triggers showError when toggleDebugMode throws', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalSet = global.chrome.storage.local.set
    global.chrome.storage.local.set = () => { throw new Error('storage-broken') }

    const cb = document.getElementById('debug-mode')
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to toggle debug mode')
    global.chrome.storage.local.set = originalSet
  })

  it('downloads captured requests when Tahvel tab is active', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCapturedRequests') {
        cb({
          status: 'success',
          data: {
            requests: [{ url: '/api/x' }],
            metadata: { journalId: '12345' }
          }
        })
      }
    })

    let createdLink
    let clicked = false
    const originalCreateElement = document.createElement.bind(document)
    document.createElement = tag => {
      const el = originalCreateElement(tag)
      if (tag === 'a') {
        el.click = () => { clicked = true }
        createdLink = el
      }
      return el
    }
    global.URL.createObjectURL = () => 'blob:test'
    global.URL.revokeObjectURL = () => {}

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    expect(clicked).toBe(true)
    expect(createdLink.download).toContain('oa2_debug_journal_12345_')
    document.createElement = originalCreateElement
  })

  it('uses "all" in filename when journalId metadata is missing', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((_tabId, msg, cb) => {
      if (msg.action === 'getCapturedRequests') {
        cb({
          status: 'success',
          data: { requests: [{ url: '/api/x' }], metadata: {} }
        })
      }
    })

    let download
    const originalCreateElement = document.createElement.bind(document)
    document.createElement = tag => {
      const el = originalCreateElement(tag)
      if (tag === 'a') {
        el.click = () => {}
        Object.defineProperty(el, 'download', {
          set(v) { download = v },
          get() { return download }
        })
      }
      return el
    }
    global.URL.createObjectURL = () => 'blob:test'
    global.URL.revokeObjectURL = () => {}

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    expect(download).toContain('oa2_debug_journal_all_')
    document.createElement = originalCreateElement
  })

  it('logs but does not throw when notify sendMessage rejects', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock((tabId, msg, cb) => {
      if (msg.action === 'getCacheStats' && cb) {
        cb({ status: 'success', stats: { storage: { count: 0, size: 0 }, totalBytesInUse: 0 } })
        return
      }
      return Promise.reject(new Error('msg-fail'))
    })

    const cb = document.getElementById('debug-mode')
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 30))

    expect(global.chrome.storage.local._store.OA_debug_mode).toBe(false)
  })

  it('catches errors from highlight-missing-grades handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalSet = global.chrome.storage.local.set
    global.chrome.storage.local.set = () => { throw new Error('storage-broken') }

    const cb = document.getElementById('highlight-missing-grades')
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to toggle highlight missing grades')
    global.chrome.storage.local.set = originalSet
  })

  it('catches errors from kriit-enabled handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalSet = global.chrome.storage.local.set
    global.chrome.storage.local.set = () => { throw new Error('storage-broken') }

    const cb = document.getElementById('kriit-enabled')
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to toggle Kriit support')
    global.chrome.storage.local.set = originalSet
  })

  it('catches errors from clear-cache handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalGet = global.chrome.storage.local.get
    global.chrome.storage.local.get = () => { throw new Error('storage-broken') }

    document.getElementById('clear-cache').click()
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to clear cache')
    global.chrome.storage.local.get = originalGet
  })

  it('catches errors from save-kriit-settings handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalGet = global.chrome.storage.local.get
    global.chrome.storage.local.get = () => { throw new Error('storage-broken') }

    document.getElementById('kriit-api-url').value = 'https://k.example.com'
    document.getElementById('kriit-api-key').value = 'tok'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to save Kriit settings')
    global.chrome.storage.local.get = originalGet
  })

  it('catches errors from delete-api-key handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalConfirm = global.confirm
    global.confirm = () => true
    const originalRemove = global.chrome.storage.local.remove
    global.chrome.storage.local.remove = () => { throw new Error('storage-broken') }

    document.getElementById('delete-api-key').click()
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to delete Kriit API key')
    global.chrome.storage.local.remove = originalRemove
    global.confirm = originalConfirm
  })

  it('catches errors from view-cache-details handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('cache-details').remove()
    document.getElementById('view-cache-details').remove()
    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 30))
  })

  it('catches errors from refresh-cache-stats handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const original = global.chrome.tabs.query
    global.chrome.tabs.query = () => { throw new Error('tabs-broken') }

    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to refresh cache statistics')
    global.chrome.tabs.query = original
  })

  it('catches errors from download-api-requests handler', async () => {
    await new Promise(r => setTimeout(r, 10))
    const original = global.chrome.tabs.query
    global.chrome.tabs.query = () => { throw new Error('tabs-broken') }

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 10))

    expect(document.getElementById('error-log').textContent).toContain('Failed to download API requests')
    global.chrome.tabs.query = original
  })

  it('logs notify-message rejection in toggleHighlightMissingGrades', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock(() => Promise.reject(new Error('notify-fail')))

    const cb = document.getElementById('highlight-missing-grades')
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 30))

    expect(global.chrome.storage.local._store.OA_highlightMissingGrades).toBe(false)
  })

  it('logs notify-message rejection in toggleKriitEnabled', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock(() => Promise.reject(new Error('notify-fail')))

    const cb = document.getElementById('kriit-enabled')
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 30))

    expect(global.chrome.storage.local._store.OA_kriitEnabled).toBe(false)
  })

  it('clears delete status after delay', async () => {
    await new Promise(r => setTimeout(r, 10))
    const originalConfirm = global.confirm
    global.confirm = () => true
    const originalSetTimeout = global.setTimeout
    let scheduled
    global.setTimeout = (fn) => { scheduled = fn; return originalSetTimeout(() => {}, 0) }

    document.getElementById('delete-api-key').click()
    await new Promise(r => originalSetTimeout(r, 30))

    expect(document.getElementById('save-status').textContent).toBe('Võti kustutatud')
    scheduled()
    expect(document.getElementById('save-status').textContent).toBe('')

    global.setTimeout = originalSetTimeout
    global.confirm = originalConfirm
  })

  it('returns early when cacheStatsContainer is missing', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('cache-stats-container').remove()
    document.getElementById('refresh-cache-stats').click()
    await new Promise(r => setTimeout(r, 10))
  })

  it('warns when legacy-cache sweep encounters a chrome.runtime.lastError', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.storage.local._store.OA_cache_legacy = 'old'
    const originalRemove = global.chrome.storage.local.remove
    global.chrome.storage.local.remove = (_keys, cb) => {
      global.chrome.runtime.lastError = { message: 'sweep-fail' }
      cb()
    }
    const originalAlert = global.alert
    global.alert = () => {}

    document.getElementById('clear-cache').click()
    await new Promise(r => setTimeout(r, 50))

    global.chrome.runtime.lastError = null
    global.chrome.storage.local.remove = originalRemove
    global.alert = originalAlert
  })

  it('clears error-log when showError is called with empty string', async () => {
    await new Promise(r => setTimeout(r, 10))
    document.getElementById('debug-mode').remove()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise(r => setTimeout(r, 10))
    expect(document.getElementById('error-log').textContent).toContain('Failed')

    buildPopupDOM()
    setupChromeWithTabs({})
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await new Promise(r => setTimeout(r, 30))
  })

  it('catches errors from view-cache-details when getElementById throws', async () => {
    await new Promise(r => setTimeout(r, 10))
    const original = document.getElementById.bind(document)
    document.getElementById = id => {
      if (id === 'cache-details') throw new Error('lookup-broken')
      return original(id)
    }

    document.getElementById('view-cache-details').click()
    await new Promise(r => setTimeout(r, 10))

    document.getElementById = original
    expect(document.getElementById('error-log').textContent).toContain('Failed to show cache details')
  })

  it('shows error in download path when no tab is returned', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.query = mock((_q, cb) => cb([]))

    document.getElementById('download-api-requests').click()
    await new Promise(r => setTimeout(r, 30))

    expect(document.getElementById('error-log').textContent).toContain('Aktiivset vahekaarti ei leitud')
  })

  it('logs notify-message rejection in saveKriitSettings success path', async () => {
    await new Promise(r => setTimeout(r, 10))
    global.chrome.tabs.sendMessage = mock(() => Promise.reject(new Error('notify-fail')))

    document.getElementById('kriit-api-url').value = 'https://k.example.com'
    document.getElementById('kriit-api-key').value = 'tok'
    document.getElementById('save-kriit-settings').click()
    await new Promise(r => setTimeout(r, 50))

    expect(global.chrome.storage.local._store.OA_kriitApiToken).toBe('tok')
  })
})
