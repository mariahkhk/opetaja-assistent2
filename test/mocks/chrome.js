// Mock Chrome API for tests
import { mock } from 'bun:test'

// Mock browser globals that the code depends on
global.window = {
  location: {
    hostname: 'tahvel.edu.ee',
    href: 'https://tahvel.edu.ee/#/journals?_menu'
  }
}

global.document = {
  createElement: mock(() => ({
    classList: { add: mock(), remove: mock(), contains: mock() },
    setAttribute: mock(),
    addEventListener: mock(),
    appendChild: mock(),
    removeChild: mock(),
    style: {}
  })),
  querySelector: mock(),
  querySelectorAll: mock(() => []),
  readyState: 'complete'
}

global.chrome = {
  storage: {
    local: {
      get: mock((keys, callback) => {
        callback({})
      }),
      set: mock(),
      remove: mock(),
    },
  },
  runtime: {
    onMessage: {
      addListener: mock(),
    },
    sendMessage: mock(),
  },
}

export default global.chrome
