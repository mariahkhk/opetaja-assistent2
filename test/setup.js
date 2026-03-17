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
global.Response = globalThis.Response || class Response {
  constructor(body, init = {}) {
    this._body = body
    this.headers = new Map(Object.entries(init.headers || {}))
  }
  async text() { return this._body }
  async json() { return JSON.parse(this._body) }
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

global.chrome = {
  storage: {
    sync: {
      get: mock((keys, callback) => {
        callback({})
      }),
      set: mock(),
      remove: mock()
    },
    local: {
      get: mock((keys, callback) => {
        callback({})
      }),
      set: mock(),
      remove: mock(),
      getBytesInUse: mock((keys, callback) => {
        callback(0)
      })
    }
  },
  runtime: {
    onMessage: {
      addListener: mock()
    },
    sendMessage: mock(),
    getManifest: mock(() => ({}))
  }
}

// Export a function to restore the default chrome mock
export function restoreChromeMock() {
  global.chrome = {
    storage: {
      sync: {
        get: mock((keys, callback) => {
          callback({})
        }),
        set: mock(),
        remove: mock()
      },
      local: {
        get: mock((keys, callback) => {
          callback({})
        }),
        set: mock(),
        remove: mock(),
        getBytesInUse: mock((keys, callback) => {
          callback(0)
        })
      }
    },
    runtime: {
      onMessage: {
        addListener: mock()
      },
      sendMessage: mock(),
      getManifest: mock(() => ({}))
    }
  }
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
