import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { BaseFeature, api, getTahvelBaseUrl } from '../../src/core/BaseFeature.js'
import Logger from '../../src/services/Logger.js'
import { JSDOM } from 'jsdom'

describe('BaseFeature', () => {
  beforeEach(() => {
    global.chrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get: mock((keys, callback) => {
            callback({
              OA_kriitApiBaseUrl: 'https://api.kriit.test',
              OA_kriitApiToken: 'test-token',
              OA_kriitEnabled: true
            })
          })
        }
      }
    }

    global.window = {
      location: {
        hostname: 'tahvel.edu.ee',
        protocol: 'https:'
      }
    }

    global.document = {
      body: {
        innerHTML: '',
        appendChild: mock(),
        querySelector: mock(),
        querySelectorAll: mock(() => [])
      },
      createElement: mock(tag => ({
        classList: { add: mock(), contains: mock() },
        setAttribute: mock(),
        addEventListener: mock(),
        className: '',
        tagName: tag.toUpperCase(),
        appendChild: mock()
      })),
      querySelector: mock(),
      querySelectorAll: mock(() => [])
    }

    // Reset shared singleton state between tests
    api._kriitInitPromise = null
  })

  describe('constructor', () => {
    test('should create feature with name and pattern', () => {
      const feature = new BaseFeature('testFeature', '/test-url')

      expect(feature.name).toBe('testFeature')
      expect(feature.urlPattern).toBe('/test-url')
      expect(feature.isActive).toBe(false)
    })

    test('should initialize with required selectors', () => {
      const feature = new BaseFeature('testFeature', '/test', '.required-element')

      expect(feature.requiredSelectors).toBe('.required-element')
    })

    test('should have access to API instances', () => {
      const feature = new BaseFeature('testFeature', '/test')

      expect(feature.api).toBeDefined()
      expect(feature.api.tahvel).toBeDefined()
      expect(feature.api.kriit).toBeDefined()
    })
  })

  describe('shouldActivate', () => {
    test('should activate for string pattern match', () => {
      const feature = new BaseFeature('test', '/journals')

      expect(feature.shouldActivate('/schools/123/journals/456')).toBe(true)
      expect(feature.shouldActivate('/students/789')).toBe(false)
    })

    test('should activate for regex pattern match', () => {
      const feature = new BaseFeature('test', /\/journals\/\d+/)

      expect(feature.shouldActivate('/journals/123')).toBe(true)
      expect(feature.shouldActivate('/journals/abc')).toBe(false)
    })

    test('should activate for function pattern match', () => {
      const pattern = url => url.includes('test') && url.includes('123')
      const feature = new BaseFeature('test', pattern)

      expect(feature.shouldActivate('/test/123')).toBe(true)
      expect(feature.shouldActivate('/test/456')).toBe(false)
    })
  })

  describe('activate', () => {
    test('should activate feature without required selectors', () => {
      const feature = new BaseFeature('test', '/test')
      const onActivateMock = mock(() => {})
      feature.onActivate = onActivateMock

      feature.activate()

      expect(feature.isActive).toBe(true)
      expect(onActivateMock).toHaveBeenCalled()
    })

    test('should not activate twice', () => {
      const feature = new BaseFeature('test', '/test')
      const onActivateMock = mock(() => {})
      feature.onActivate = onActivateMock

      feature.activate()
      feature.activate()

      expect(onActivateMock).toHaveBeenCalledTimes(1)
    })

    test('should wait for required elements', () => {
      // Set up real jsdom for MutationObserver
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      const feature = new BaseFeature('test', '/test', '.required')

      feature.activate()

      expect(feature.isActive).toBe(true)
      expect(feature.elementsObserver).toBeDefined()

      // Clean up
      if (feature.elementsObserver) {
        feature.elementsObserver.disconnect()
      }
    })

    test('should call onActivate when required elements are found', async () => {
      const feature = new BaseFeature('test', '/test', '.required')
      const onActivateMock = mock(() => {})
      feature.onActivate = onActivateMock

      const mockElement = { className: 'required' }
      global.document.querySelectorAll = mock(selector => {
        if (selector === '.required') {
          return [mockElement]
        }
        return []
      })

      feature.activate()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(onActivateMock).toHaveBeenCalled()
    })
  })

  describe('deactivate', () => {
    test('should deactivate active feature', () => {
      const feature = new BaseFeature('test', '/test')
      const onDeactivateMock = mock(() => {})
      feature.onDeactivate = onDeactivateMock

      feature.activate()
      feature.deactivate()

      expect(feature.isActive).toBe(false)
      expect(onDeactivateMock).toHaveBeenCalled()
    })

    test('should not deactivate inactive feature', () => {
      const feature = new BaseFeature('test', '/test')
      const onDeactivateMock = mock(() => {})
      feature.onDeactivate = onDeactivateMock

      feature.deactivate()

      expect(onDeactivateMock).not.toHaveBeenCalled()
    })

    test('should disconnect observers on deactivate', () => {
      // Set up real jsdom for MutationObserver
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      const feature = new BaseFeature('test', '/test', '.required')

      feature.activate()

      const mockObserver = { disconnect: mock(() => {}) }
      feature.elementsObserver = mockObserver

      feature.deactivate()

      expect(mockObserver.disconnect).toHaveBeenCalled()
      expect(feature.elementsObserver).toBeNull()
    })
  })

  describe('onRequiredElementsFound', () => {
    test('should be called with found elements', async () => {
      const feature = new BaseFeature('test', '/test', '.test-element')
      const onFoundMock = mock(() => {})
      feature.onRequiredElementsFound = onFoundMock

      const mockElement = { className: 'test-element' }
      global.document.querySelectorAll = mock(selector => {
        if (selector === '.test-element') {
          return [mockElement]
        }
        return []
      })

      feature.activate()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(onFoundMock).toHaveBeenCalled()
    })
  })

  describe('onRequiredElementsNotFound (default implementation)', () => {
    test('logs a warning with the feature name and error message, does not throw', () => {
      const feature = new BaseFeature('test', '/test')
      const originalWarning = Logger.warning
      const calls = []
      Logger.warning = (...args) => calls.push(args)

      try {
        expect(() => feature.onRequiredElementsNotFound(new Error('Timeout boom'))).not.toThrow()
        expect(calls.length).toBe(1)
        expect(calls[0][0]).toContain('test')
        expect(calls[0][0]).toContain('Timeout boom')
      } finally {
        Logger.warning = originalWarning
      }
    })
  })

  describe('initializeKriitApi', () => {
    test('should load Kriit API settings from storage', async () => {
      // Reset the shared api singleton
      api.kriit.baseUrl = ''

      let getCalled = false
      global.chrome.storage.local.get = mock((keys, callback) => {
        getCalled = true
        callback({
          OA_kriitApiToken: 'test-token',
          OA_kriitApiBaseUrl: 'http://localhost:3000',
          OA_kriitEnabled: true
        })
      })

      const feature = new BaseFeature('test', '/test')

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(getCalled).toBe(true)
    })

    test('should set Kriit API enabled status', async () => {
      const feature = new BaseFeature('test', '/test')

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(feature.api.kriit.enabled).toBe(true)
    })
  })

  describe('getTahvelBaseUrl', () => {
    test('returns production URL for tahvel.edu.ee hostname', () => {
      const originalWindow = global.window
      global.window = { location: { hostname: 'tahvel.edu.ee' } }
      try {
        expect(getTahvelBaseUrl()).toBe('https://tahvel.edu.ee/hois_back')
      } finally {
        global.window = originalWindow
      }
    })

    test('returns test URL for test.tahvel.eenet.ee hostname', () => {
      const originalWindow = global.window
      global.window = { location: { hostname: 'test.tahvel.eenet.ee' } }
      try {
        expect(getTahvelBaseUrl()).toBe('https://test.tahvel.eenet.ee/hois_back')
      } finally {
        global.window = originalWindow
      }
    })

    test('falls back to production URL for unknown hostnames', () => {
      const originalWindow = global.window
      global.window = { location: { hostname: 'localhost' } }
      try {
        expect(getTahvelBaseUrl()).toBe('https://tahvel.edu.ee/hois_back')
      } finally {
        global.window = originalWindow
      }
    })
  })

  describe('removeFinalGradeBanner', () => {
    test('default implementation returns undefined (no-op) and does not throw', () => {
      const feature = new BaseFeature('test', '/test')
      expect(feature.removeFinalGradeBanner()).toBeUndefined()
    })

    test('subclasses can override with banner-removal logic', () => {
      class FeatureWithBanner extends BaseFeature {
        removeFinalGradeBanner() {
          this.bannerRemoved = true
          return 'removed'
        }
      }
      const feature = new FeatureWithBanner('test', '/test')
      expect(feature.removeFinalGradeBanner()).toBe('removed')
      expect(feature.bannerRemoved).toBe(true)
    })
  })
})
