import { mock } from 'bun:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const window = dom.window
const document = window.document

global.window = window
global.document = document
global.HTMLElement = window.HTMLElement
global.MutationObserver = window.MutationObserver

// --- Cache API mock ---

function createCacheApiMock() {
  const stores = {}

  class MockCache {
    constructor(name) {
      this.name = name
      if (!stores[name]) stores[name] = new Map()
    }

    async put(request, response) {
      const url = typeof request === 'string' ? request : request.url
      const body = await response.text()
      const headers = {}
      response.headers.forEach((value, key) => { headers[key] = value })
      stores[this.name].set(url, { body, headers })
    }

    async match(request) {
      const url = typeof request === 'string' ? request : request.url
      const entry = stores[this.name]?.get(url)
      if (!entry) return undefined
      return new Response(entry.body, { headers: entry.headers })
    }

    async delete(request) {
      const url = typeof request === 'string' ? request : request.url
      return stores[this.name]?.delete(url) ?? false
    }

    async keys() {
      const entries = stores[this.name]
      if (!entries) return []
      return [...entries.keys()].map(url => new Request(url))
    }
  }

  return {
    open: mock(async (name) => new MockCache(name)),
    delete: mock(async (name) => { delete stores[name]; return true }),
    _stores: stores,
    _clear: () => { Object.keys(stores).forEach(k => delete stores[k]) }
  }
}

global.caches = createCacheApiMock()
global.Request = globalThis.Request || class Request { constructor(url) { this.url = url } }
// Case-insensitive Headers shim to mirror real Fetch API Headers (which lower-
// cases keys). Without this, `headers.get('X-Cache-IV')` then
// `headers['x-cache-iv']` reads in production code wouldn't round-trip.
class CaseInsensitiveHeaders {
  constructor(init = {}) {
    this._map = new Map()
    for (const [k, v] of Object.entries(init || {})) {
      this._map.set(String(k).toLowerCase(), String(v))
    }
  }
  get(key) {
    const v = this._map.get(String(key).toLowerCase())
    return v === undefined ? null : v
  }
  set(key, value) { this._map.set(String(key).toLowerCase(), String(value)) }
  has(key) { return this._map.has(String(key).toLowerCase()) }
  delete(key) { return this._map.delete(String(key).toLowerCase()) }
  forEach(fn) { for (const [k, v] of this._map) fn(v, k) }
  entries() { return this._map.entries() }
  keys() { return this._map.keys() }
  values() { return this._map.values() }
  *[Symbol.iterator]() { yield* this._map }
}

global.Response = globalThis.Response || class Response {
  constructor(body, init = {}) {
    this._body = body
    this._consumed = false
    this.headers = new CaseInsensitiveHeaders(init.headers || {})
  }
  async text() {
    if (this._consumed) throw new TypeError('Body already read')
    this._consumed = true
    return this._body
  }
  async json() {
    if (this._consumed) throw new TypeError('Body already read')
    this._consumed = true
    return JSON.parse(this._body)
  }
  clone() {
    const init = { headers: {} }
    this.headers.forEach((v, k) => { init.headers[k] = v })
    return new Response(this._body, init)
  }
}

// Mock console for Logger service
global.console = {
  log: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  info: () => {},
  group: () => {},
  groupEnd: () => {},
  groupCollapsed: () => {},
  trace: () => {}
}

function createChromeMock() {
  const store = {}
  return {
    storage: {
      local: {
        get: mock((keys, callback) => {
          if (keys === null || keys === undefined) return callback({ ...store })
          if (typeof keys === 'string') return callback(keys in store ? { [keys]: store[keys] } : {})
          if (Array.isArray(keys)) {
            const out = {}
            for (const k of keys) if (k in store) out[k] = store[k]
            return callback(out)
          }
          callback({ ...store })
        }),
        set: mock((items, callback) => {
          Object.assign(store, items)
          if (callback) callback()
        }),
        remove: mock((keys, callback) => {
          const list = Array.isArray(keys) ? keys : [keys]
          for (const k of list) delete store[k]
          if (callback) callback()
        }),
        getBytesInUse: mock((_keys, callback) => callback(0)),
        _store: store
      }
    },
    runtime: {
      onMessage: { addListener: mock() },
      sendMessage: mock(),
      getManifest: mock(() => ({}))
    }
  }
}

global.chrome = createChromeMock()

// Export a function to restore the default chrome mock
export function restoreChromeMock() {
  global.chrome = createChromeMock()
}

// Export a function to restore the default DOM
export function restoreGlobalDOM() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const window = dom.window
  const document = window.document

  global.window = window
  global.document = document
  global.HTMLElement = window.HTMLElement
  global.MutationObserver = window.MutationObserver

  // Restore console mock
  global.console = {
    log: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    info: () => {},
    group: () => {},
    groupEnd: () => {},
    groupCollapsed: () => {},
    trace: () => {}
  }
}
