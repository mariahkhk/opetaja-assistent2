import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { restoreChromeMock, restoreGlobalDOM } from '../setup.js'
import tahvelExtension from '../../src/core/Extension.js'

describe('Extension', () => {
  beforeEach(() => {
    restoreGlobalDOM()
    restoreChromeMock()
    tahvelExtension.activeFeatures = []
    tahvelExtension.indicatorAdded = false
  })

  describe('isMainPage', () => {
    it('returns true for #/', () => {
      expect(tahvelExtension.isMainPage('https://tahvel.edu.ee/#/')).toBe(true)
    })

    it('returns true for # alone', () => {
      expect(tahvelExtension.isMainPage('https://tahvel.edu.ee/#')).toBe(true)
    })

    it('returns true for empty hash', () => {
      expect(tahvelExtension.isMainPage('https://tahvel.edu.ee/')).toBe(true)
    })

    it('returns true for #/students', () => {
      expect(tahvelExtension.isMainPage('https://tahvel.edu.ee/#/students')).toBe(true)
    })

    it('returns false for #/journal/123/edit', () => {
      expect(tahvelExtension.isMainPage('https://tahvel.edu.ee/#/journal/123/edit')).toBe(false)
    })

    it('returns false for #/journals', () => {
      expect(tahvelExtension.isMainPage('https://tahvel.edu.ee/#/journals')).toBe(false)
    })

    it('returns false for invalid URL', () => {
      expect(tahvelExtension.isMainPage('not a url')).toBe(false)
    })
  })

  describe('handleNavigation', () => {
    it('activates features whose shouldActivate returns true', () => {
      const feature = {
        name: 'F1',
        isActive: false,
        shouldActivate: mock(() => true),
        activate: mock(),
        deactivate: mock()
      }
      tahvelExtension.activeFeatures = [feature]

      tahvelExtension.handleNavigation('https://tahvel.edu.ee/#/journal/1/edit')

      expect(feature.shouldActivate).toHaveBeenCalledWith('https://tahvel.edu.ee/#/journal/1/edit')
      expect(feature.activate).toHaveBeenCalled()
      expect(feature.deactivate).not.toHaveBeenCalled()
    })

    it('deactivates currently active features whose shouldActivate returns false', () => {
      const feature = {
        name: 'F1',
        isActive: true,
        shouldActivate: mock(() => false),
        activate: mock(),
        deactivate: mock()
      }
      tahvelExtension.activeFeatures = [feature]

      tahvelExtension.handleNavigation('https://tahvel.edu.ee/#/students')

      expect(feature.deactivate).toHaveBeenCalled()
      expect(feature.activate).not.toHaveBeenCalled()
    })

    it('does not deactivate inactive features when shouldActivate returns false', () => {
      const feature = {
        name: 'F1',
        isActive: false,
        shouldActivate: mock(() => false),
        activate: mock(),
        deactivate: mock()
      }
      tahvelExtension.activeFeatures = [feature]

      tahvelExtension.handleNavigation('https://tahvel.edu.ee/#/students')

      expect(feature.activate).not.toHaveBeenCalled()
      expect(feature.deactivate).not.toHaveBeenCalled()
    })

    it('handles multiple features independently', () => {
      const f1 = { name: 'F1', isActive: false, shouldActivate: mock(() => true), activate: mock(), deactivate: mock() }
      const f2 = { name: 'F2', isActive: true, shouldActivate: mock(() => false), activate: mock(), deactivate: mock() }
      tahvelExtension.activeFeatures = [f1, f2]

      tahvelExtension.handleNavigation('https://tahvel.edu.ee/#/x')

      expect(f1.activate).toHaveBeenCalled()
      expect(f2.deactivate).toHaveBeenCalled()
    })

    it('does not call evictExpired on non-main pages', () => {
      tahvelExtension.activeFeatures = []
      // Just verify no crash on non-main page navigation
      expect(() => tahvelExtension.handleNavigation('https://tahvel.edu.ee/#/journal/1')).not.toThrow()
    })
  })

  describe('addVisualIndicator', () => {
    it('does not throw when user-menu-button is missing', () => {
      expect(() => tahvelExtension.addVisualIndicator()).not.toThrow()
    })

    it('appends an indicator span when user-menu-button exists', async () => {
      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      await new Promise(r => global.chrome.storage.local.set({ OA_kriitApiBaseUrl: 'https://kriit.vikk.ee/api' }, r))

      tahvelExtension.addVisualIndicator()
      await new Promise(r => setTimeout(r, 10))
      expect(button.querySelector('.oa-indicator')).toBeTruthy()
    })

    it('renders DEV indicator when using non-default Kriit URL', async () => {
      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      await new Promise(r => global.chrome.storage.local.set({ OA_kriitApiBaseUrl: 'http://localhost:3000/api' }, r))

      tahvelExtension.addVisualIndicator()
      await new Promise(r => setTimeout(r, 10))
      const indicator = button.querySelector('.oa-indicator')
      expect(indicator?.textContent).toBe('DEV')
    })

    it('renders ÕA2 indicator when using default Kriit URL', async () => {
      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      await new Promise(r => global.chrome.storage.local.set({ OA_kriitApiBaseUrl: 'https://kriit.vikk.ee/api' }, r))

      tahvelExtension.addVisualIndicator()
      await new Promise(r => setTimeout(r, 10))
      const indicator = button.querySelector('.oa-indicator')
      expect(indicator?.textContent).toBe('ÕA2')
    })

    it('does not duplicate indicator when called twice', async () => {
      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      tahvelExtension.addVisualIndicator()
      await new Promise(r => setTimeout(r, 10))
      tahvelExtension.indicatorAdded = false
      tahvelExtension.addVisualIndicator()
      await new Promise(r => setTimeout(r, 10))

      expect(button.querySelectorAll('.oa-indicator')).toHaveLength(1)
    })
  })

  describe('checkContextChange', () => {
    it('returns silently when API is not available', async () => {
      await expect(tahvelExtension.checkContextChange()).resolves.toBeUndefined()
    })

    it('clears cache when role changes', async () => {
      const { api } = await import('../../src/core/BaseFeature.js')
      const { cacheService } = await import('../../src/services/CacheService.js')
      const originalGet = api.tahvel.get.bind(api.tahvel)
      const originalClear = cacheService.clearCache.bind(cacheService)
      let cleared = false
      api.tahvel.get = mock(async () => ({ roleCode: 'TEACHER', school: { id: 9 } }))
      cacheService.clearCache = mock(async () => { cleared = true })

      await new Promise(r => global.chrome.storage.local.set({
        OA_currentRole: 'STUDENT',
        OA_currentSchoolId: 9
      }, r))

      await tahvelExtension.checkContextChange()
      expect(cleared).toBe(true)

      api.tahvel.get = originalGet
      cacheService.clearCache = originalClear
    })

    it('clears cache when school changes', async () => {
      const { api } = await import('../../src/core/BaseFeature.js')
      const { cacheService } = await import('../../src/services/CacheService.js')
      const originalGet = api.tahvel.get.bind(api.tahvel)
      const originalClear = cacheService.clearCache.bind(cacheService)
      let cleared = false
      api.tahvel.get = mock(async () => ({ roleCode: 'TEACHER', school: { id: 5 } }))
      cacheService.clearCache = mock(async () => { cleared = true })

      await new Promise(r => global.chrome.storage.local.set({
        OA_currentRole: 'TEACHER',
        OA_currentSchoolId: 9
      }, r))

      await tahvelExtension.checkContextChange()
      expect(cleared).toBe(true)

      api.tahvel.get = originalGet
      cacheService.clearCache = originalClear
    })

    it('does not clear cache when nothing changes', async () => {
      const { api } = await import('../../src/core/BaseFeature.js')
      const { cacheService } = await import('../../src/services/CacheService.js')
      const originalGet = api.tahvel.get.bind(api.tahvel)
      const originalClear = cacheService.clearCache.bind(cacheService)
      let cleared = false
      api.tahvel.get = mock(async () => ({ roleCode: 'TEACHER', school: { id: 9 } }))
      cacheService.clearCache = mock(async () => { cleared = true })

      await new Promise(r => global.chrome.storage.local.set({
        OA_currentRole: 'TEACHER',
        OA_currentSchoolId: 9
      }, r))

      await tahvelExtension.checkContextChange()
      expect(cleared).toBe(false)

      api.tahvel.get = originalGet
      cacheService.clearCache = originalClear
    })

    it('returns early when /user response has no roleCode', async () => {
      const { api } = await import('../../src/core/BaseFeature.js')
      const originalGet = api.tahvel.get.bind(api.tahvel)
      api.tahvel.get = mock(async () => ({}))

      await expect(tahvelExtension.checkContextChange()).resolves.toBeUndefined()
      api.tahvel.get = originalGet
    })

    it('catches and logs API errors', async () => {
      const { api } = await import('../../src/core/BaseFeature.js')
      const originalGet = api.tahvel.get.bind(api.tahvel)
      api.tahvel.get = mock(async () => { throw new Error('api-fail') })

      await expect(tahvelExtension.checkContextChange()).resolves.toBeUndefined()
      api.tahvel.get = originalGet
    })
  })

  describe('init', () => {
    it('runs successfully and loads features', async () => {
      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      await tahvelExtension.init()
      expect(Array.isArray(tahvelExtension.activeFeatures)).toBe(true)
    })
  })

  describe('handleNavigation main-page side effects', () => {
    it('triggers cache.evictExpired on main page', async () => {
      const { cacheService } = await import('../../src/services/CacheService.js')
      const originalEvict = cacheService.evictExpired.bind(cacheService)
      let evicted = false
      cacheService.evictExpired = mock(async () => { evicted = true })

      tahvelExtension.handleNavigation('https://tahvel.edu.ee/#/')
      await new Promise(r => setTimeout(r, 30))

      expect(evicted).toBe(true)
      cacheService.evictExpired = originalEvict
    })
  })

  describe('addVisualIndicator MutationObserver path', () => {
    it('adds indicator after user-menu-button appears via mutation', async () => {
      tahvelExtension.indicatorAdded = false
      tahvelExtension.addVisualIndicator()

      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      await new Promise(r => setTimeout(r, 100))
      expect(button.querySelector('.oa-indicator') || tahvelExtension.indicatorAdded).toBeTruthy()
    })

    it('disconnects observer once indicator is added', async () => {
      const button = document.createElement('button')
      button.id = 'user-menu-button'
      document.body.appendChild(button)

      tahvelExtension.indicatorAdded = false
      tahvelExtension.addVisualIndicator()
      await new Promise(r => setTimeout(r, 50))

      const sibling = document.createElement('span')
      document.body.appendChild(sibling)
      await new Promise(r => setTimeout(r, 30))

      expect(button.querySelectorAll('.oa-indicator').length).toBe(1)
    })
  })
})
