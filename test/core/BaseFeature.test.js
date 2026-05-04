import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { BaseFeature, api, getTahvelBaseUrl } from '../../src/core/BaseFeature.js'
import Logger from '../../src/services/Logger.js'
import { JSDOM } from 'jsdom'
import { restoreChromeMock } from '../setup.js'

describe('BaseFeature', () => {
  beforeEach(async () => {
    restoreChromeMock()
    await new Promise(r => global.chrome.storage.local.set({
      OA_kriitApiBaseUrl: 'https://api.kriit.test',
      OA_kriitApiToken: 'test-token',
      OA_kriitEnabled: true
    }, r))

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://tahvel.edu.ee/' })
    global.window = dom.window
    global.document = dom.window.document

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

  class CountingFeature extends BaseFeature {
    constructor(name, urlPattern, requiredSelectors) {
      super(name, urlPattern, requiredSelectors)
      this.activateCount = 0
      this.deactivateCount = 0
      this.foundElements = null
    }
    onActivate() { this.activateCount++ }
    onDeactivate() {
      this.deactivateCount++
      super.onDeactivate()
    }
    onRequiredElementsFound(elements) { this.foundElements = elements }
  }

  describe('activate', () => {
    test('should activate feature without required selectors', () => {
      const feature = new CountingFeature('test', '/test')

      feature.activate()

      expect(feature.isActive).toBe(true)
      expect(feature.activateCount).toBe(1)
    })

    test('should not activate twice', () => {
      const feature = new CountingFeature('test', '/test')

      feature.activate()
      feature.activate()

      expect(feature.activateCount).toBe(1)
    })

    test('should wait for required elements', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      const feature = new BaseFeature('test', '/test', '.required')

      feature.activate()

      expect(feature.isActive).toBe(true)
      expect(feature.elementsObserver).toBeDefined()

      if (feature.elementsObserver) {
        feature.elementsObserver.disconnect()
      }
    })

    test('should call onActivate when required elements are found', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="required"></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      const feature = new CountingFeature('test', '/test', '.required')
      feature.activate()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(feature.activateCount).toBe(1)
    })
  })

  describe('deactivate', () => {
    test('should deactivate active feature', () => {
      const feature = new CountingFeature('test', '/test')

      feature.activate()
      feature.deactivate()

      expect(feature.isActive).toBe(false)
      expect(feature.deactivateCount).toBe(1)
    })

    test('should not deactivate inactive feature', () => {
      const feature = new CountingFeature('test', '/test')

      feature.deactivate()

      expect(feature.deactivateCount).toBe(0)
    })

    test('should disconnect observers on deactivate', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      const feature = new BaseFeature('test', '/test', '.required')

      feature.activate()
      expect(feature.elementsObserver).not.toBeNull()

      feature.deactivate()
      expect(feature.elementsObserver).toBeNull()
    })
  })

  describe('onRequiredElementsFound', () => {
    test('should be called with found elements', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><div class="test-element"></div></body></html>')
      global.document = dom.window.document
      global.MutationObserver = dom.window.MutationObserver

      const feature = new CountingFeature('test', '/test', '.test-element')
      feature.activate()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(feature.foundElements).not.toBeNull()
      expect(feature.foundElements.length).toBe(1)
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
      api.kriit.baseUrl = ''
      api._kriitInitPromise = null

      await new Promise(r => global.chrome.storage.local.set({
        OA_kriitApiToken: 'test-token',
        OA_kriitApiBaseUrl: 'http://localhost:3000',
        OA_kriitEnabled: true
      }, r))

      const feature = new BaseFeature('test', '/test')
      await feature.api._kriitInitPromise

      expect(feature.api.kriit.baseUrl).toBe('http://localhost:3000')
      expect(feature.api.kriit.authToken).toBe('test-token')
    })

    test('should set Kriit API enabled status', async () => {
      const feature = new BaseFeature('test', '/test')
      await feature.api._kriitInitPromise

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
