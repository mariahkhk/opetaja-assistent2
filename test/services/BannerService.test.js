import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { BannerService } from '../../src/services/BannerService.js'
import { restoreChromeMock, restoreGlobalDOM } from '../setup.js'

describe('BannerService', () => {
  let bannerService
  let mockContainer

  beforeEach(() => {
    restoreGlobalDOM()
    mockContainer = global.document.createElement('div')
    mockContainer.id = 'test-container'
    global.document.body.appendChild(mockContainer)

    bannerService = new BannerService('#test-container')
  })

  afterEach(() => {
    restoreChromeMock()
    restoreGlobalDOM()
  })

  describe('constructor', () => {
    test('should initialize with default container selector', () => {
      const service = new BannerService()
      expect(service.containerSelector).toBe('#main-content > div.layout-padding > div')
      expect(service.currentBanner).toBeNull()
      expect(service.stylesLoaded).toBe(false)
    })

    test('should initialize with custom container selector', () => {
      const service = new BannerService('#custom-selector')
      expect(service.containerSelector).toBe('#custom-selector')
    })

    test('should initialize all properties to null', () => {
      expect(bannerService.progressContainer).toBeNull()
      expect(bannerService.progressBar).toBeNull()
      expect(bannerService.progressText).toBeNull()
      expect(bannerService.loadingText).toBeNull()
    })
  })

  describe('loadStyles', () => {
    test('should load styles only once', () => {
      expect(bannerService.stylesLoaded).toBe(false)
      bannerService.loadStyles()
      expect(bannerService.stylesLoaded).toBe(true)

      const firstStyleElement = global.document.getElementById('banner-service-styles')
      bannerService.loadStyles()
      const secondStyleElement = global.document.getElementById('banner-service-styles')

      expect(firstStyleElement).toBe(secondStyleElement)
    })

    test('should not load styles when document is undefined', () => {
      const service = new BannerService()
      const originalDocument = global.document
      global.document = undefined

      service.loadStyles()
      expect(service.stylesLoaded).toBe(false)

      global.document = originalDocument
    })

    test('should inject CSS with correct style ID', () => {
      bannerService.loadStyles()
      const styleElement = global.document.getElementById('banner-service-styles')
      expect(styleElement).toBeTruthy()
      expect(styleElement.tagName).toBe('STYLE')
    })
  })

  describe('getBannerContainer', () => {
    test('should return preferred container when .tahvel-form-buttons exists', () => {
      const preferredElement = global.document.createElement('div')
      preferredElement.className = 'tahvel-form-buttons'
      global.document.body.appendChild(preferredElement)

      const container = bannerService.getBannerContainer()
      expect(container.className).toContain('ta-sync-banner-insertion')
      expect(container.parentNode).toBe(preferredElement.parentNode)
    })

    test('should create insertion wrapper after preferred element', () => {
      const preferredElement = global.document.createElement('div')
      preferredElement.className = 'tahvel-form-buttons'
      global.document.body.appendChild(preferredElement)

      bannerService.getBannerContainer()
      const wrapper = preferredElement.parentNode.querySelector('.ta-sync-banner-insertion')

      expect(wrapper).toBeTruthy()
      expect(wrapper.style.marginTop).toBe('12px')
    })

    test('should reuse existing insertion wrapper', () => {
      const preferredElement = global.document.createElement('div')
      preferredElement.className = 'tahvel-form-buttons'
      global.document.body.appendChild(preferredElement)

      const firstContainer = bannerService.getBannerContainer()
      const secondContainer = bannerService.getBannerContainer()

      expect(firstContainer).toBe(secondContainer)
    })

    test('should fallback to configured selector when preferred not found', () => {
      const container = bannerService.getBannerContainer()
      expect(container).toBe(mockContainer)
    })

    test('should fallback to document.body when container not found', () => {
      const service = new BannerService('#non-existent')
      const container = service.getBannerContainer()
      expect(container).toBe(global.document.body)
    })
  })

  describe('removeBanner', () => {
    test('should remove current banner from DOM', () => {
      bannerService.showLoadingBanner('Test')
      expect(bannerService.currentBanner).toBeTruthy()

      bannerService.removeBanner()
      expect(bannerService.currentBanner).toBeNull()
    })

    test('should reset all banner-related properties', () => {
      bannerService.showLoadingBanner('Test')
      bannerService.removeBanner()

      expect(bannerService.progressContainer).toBeNull()
      expect(bannerService.progressBar).toBeNull()
      expect(bannerService.progressText).toBeNull()
      expect(bannerService.loadingText).toBeNull()
    })

    test('should handle removal when no banner exists', () => {
      expect(() => bannerService.removeBanner()).not.toThrow()
    })
  })

  describe('showLoadingBanner', () => {
    test('should create loading banner with default message', () => {
      bannerService.showLoadingBanner()

      expect(bannerService.currentBanner).toBeTruthy()
      expect(bannerService.currentBanner.className).toContain('ta-banner-loading')
      expect(bannerService.loadingText.textContent).toBe('Töötlen andmeid, palun oota...')
    })

    test('should create loading banner with custom message', () => {
      bannerService.showLoadingBanner('Custom loading message')
      expect(bannerService.loadingText.textContent).toBe('Custom loading message')
    })

    test('should create progress container initially hidden', () => {
      bannerService.showLoadingBanner()
      expect(bannerService.progressContainer).toBeTruthy()
      expect(bannerService.progressContainer.style.display).toBe('none')
    })

    test('should create progress bar with 0% width', () => {
      bannerService.showLoadingBanner()
      expect(bannerService.progressBar).toBeTruthy()
      expect(bannerService.progressBar.style.width).toBe('0%')
    })

    test('should create progress text showing 0/0', () => {
      bannerService.showLoadingBanner()
      expect(bannerService.progressText.textContent).toBe('0 / 0')
    })

    test('should load styles before showing banner', () => {
      expect(bannerService.stylesLoaded).toBe(false)
      bannerService.showLoadingBanner()
      expect(bannerService.stylesLoaded).toBe(true)
    })

    test('should remove previous banner before showing new one', () => {
      bannerService.showLoadingBanner('First')
      const firstBanner = bannerService.currentBanner

      bannerService.showLoadingBanner('Second')
      expect(bannerService.currentBanner).not.toBe(firstBanner)
    })
  })

  describe('updateProgressUI', () => {
    beforeEach(() => {
      bannerService.showLoadingBanner()
    })

    test('should update progress bar width based on percentage', () => {
      bannerService.updateProgressUI(5, 10)
      expect(bannerService.progressBar.style.width).toBe('50%')
    })

    test('should update progress text with current/total', () => {
      bannerService.updateProgressUI(3, 10)
      expect(bannerService.progressText.textContent).toBe('3 / 10 (30%)')
    })

    test('should show progress container when updating', () => {
      bannerService.updateProgressUI(1, 5)
      expect(bannerService.progressContainer.style.display).toBe('block')
    })

    test('should update loading text when provided', () => {
      bannerService.updateProgressUI(2, 5, 'Processing items...')
      expect(bannerService.loadingText.textContent).toBe('Processing items...')
    })

    test('should handle zero total gracefully', () => {
      bannerService.updateProgressUI(0, 0)
      expect(bannerService.progressBar.style.width).toBe('0%')
    })

    test('should handle 100% progress', () => {
      bannerService.updateProgressUI(10, 10)
      expect(bannerService.progressBar.style.width).toBe('100%')
      expect(bannerService.progressText.textContent).toBe('10 / 10 (100%)')
    })

    test('should not throw when progress elements are missing', () => {
      bannerService.progressContainer = null
      expect(() => bannerService.updateProgressUI(1, 5)).not.toThrow()
    })
  })

  describe('showSuccessBanner', () => {
    test('should create success banner with message', () => {
      bannerService.showSuccessBanner('Operation successful')

      expect(bannerService.currentBanner).toBeTruthy()
      expect(bannerService.currentBanner.className).toContain('ta-banner-success')
      expect(bannerService.currentBanner.textContent).toContain('Operation successful')
    })

    test('should include success icon', () => {
      bannerService.showSuccessBanner('Success')
      expect(bannerService.currentBanner.textContent).toContain('✅')
    })

    test('should create refresh button when onRefresh provided', () => {
      const onRefresh = mock(() => {})
      bannerService.showSuccessBanner('Success', { onRefresh })

      const refreshButton = bannerService.currentBanner.querySelector('button')
      expect(refreshButton).toBeTruthy()
      expect(refreshButton.textContent).toBe('Refresh')
    })

    test('should create close button when onClose provided', () => {
      const onClose = mock(() => {})
      bannerService.showSuccessBanner('Success', { onClose })

      const buttons = bannerService.currentBanner.querySelectorAll('button')
      const closeButton = Array.from(buttons).find(btn => btn.textContent === 'Close')
      expect(closeButton).toBeTruthy()
    })

    test('should create both buttons when both callbacks provided', () => {
      const onRefresh = mock(() => {})
      const onClose = mock(() => {})
      bannerService.showSuccessBanner('Success', { onRefresh, onClose })

      const buttons = bannerService.currentBanner.querySelectorAll('button')
      expect(buttons.length).toBe(2)
    })

    test('should load styles before showing banner', () => {
      expect(bannerService.stylesLoaded).toBe(false)
      bannerService.showSuccessBanner('Success')
      expect(bannerService.stylesLoaded).toBe(true)
    })
  })

  describe('showErrorBanner', () => {
    test('should create error banner with message', () => {
      bannerService.showErrorBanner('An error occurred')

      expect(bannerService.currentBanner).toBeTruthy()
      expect(bannerService.currentBanner.className).toContain('ta-banner-error')
      expect(bannerService.currentBanner.textContent).toContain('An error occurred')
    })

    test('should include error icon', () => {
      bannerService.showErrorBanner('Error')
      expect(bannerService.currentBanner.textContent).toContain('❌')
    })

    test('should include error title', () => {
      bannerService.showErrorBanner('Error message')
      expect(bannerService.currentBanner.textContent).toContain('Error')
    })

    test('should create retry button when onRetry provided', () => {
      const onRetry = mock(() => {})
      bannerService.showErrorBanner('Error', { onRetry })

      const buttons = bannerService.currentBanner.querySelectorAll('button')
      const retryButton = Array.from(buttons).find(btn => btn.textContent === 'Retry')
      expect(retryButton).toBeTruthy()
    })

    test('should create refresh button when onRefresh provided', () => {
      const onRefresh = mock(() => {})
      bannerService.showErrorBanner('Error', { onRefresh })

      const buttons = bannerService.currentBanner.querySelectorAll('button')
      const refreshButton = Array.from(buttons).find(btn => btn.textContent === 'Refresh')
      expect(refreshButton).toBeTruthy()
    })

    test('should load styles before showing banner', () => {
      expect(bannerService.stylesLoaded).toBe(false)
      bannerService.showErrorBanner('Error')
      expect(bannerService.stylesLoaded).toBe(true)
    })
  })

  describe('getCurrentBanner', () => {
    test('should return current banner element', () => {
      bannerService.showLoadingBanner()
      const banner = bannerService.getCurrentBanner()
      expect(banner).toBe(bannerService.currentBanner)
    })

    test('should return null when no banner exists', () => {
      expect(bannerService.getCurrentBanner()).toBeNull()
    })
  })

  describe('hasBanner', () => {
    test('should return true when banner exists', () => {
      bannerService.showLoadingBanner()
      expect(bannerService.hasBanner()).toBe(true)
    })

    test('should return false when no banner exists', () => {
      expect(bannerService.hasBanner()).toBe(false)
    })

    test('should return false after banner is removed', () => {
      bannerService.showLoadingBanner()
      bannerService.removeBanner()
      expect(bannerService.hasBanner()).toBe(false)
    })
  })

  describe('destroy', () => {
    test('should remove banner and styles', () => {
      bannerService.showLoadingBanner()
      bannerService.destroy()

      expect(bannerService.currentBanner).toBeNull()
      expect(global.document.getElementById('banner-service-styles')).toBeNull()
    })
  })

  describe('createContainer', () => {
    test('should create container with specified classes', () => {
      bannerService.showLoadingBanner()
      const parent = bannerService.currentBanner
      const container = bannerService.createContainer(parent, ['test-class-1', 'test-class-2'])

      expect(container.tagName).toBe('DIV')
      expect(container.className).toContain('test-class-1')
      expect(container.className).toContain('test-class-2')
    })

    test('should create container without classes', () => {
      bannerService.showLoadingBanner()
      const parent = bannerService.currentBanner
      const container = bannerService.createContainer(parent)

      expect(container.tagName).toBe('DIV')
    })
  })

  describe('createSection', () => {
    test('should create section with title', () => {
      bannerService.showLoadingBanner()
      const parent = bannerService.currentBanner
      const section = bannerService.createSection(parent, 'Test Title', ['section-class'])

      expect(section.tagName).toBe('DIV')
      expect(section.className).toContain('section-class')
      const title = section.querySelector('h3')
      expect(title).toBeTruthy()
      expect(title.textContent).toBe('Test Title')
    })

    test('should create section without title', () => {
      bannerService.showLoadingBanner()
      const parent = bannerService.currentBanner
      const section = bannerService.createSection(parent, null, ['section-class'])

      const title = section.querySelector('h3')
      expect(title).toBeNull()
    })
  })

  describe('createMessage', () => {
    test('should create message with default classes', () => {
      bannerService.showLoadingBanner()
      const parent = bannerService.currentBanner
      bannerService.createMessage(parent, 'Test message')

      const message = parent.querySelector('.ta-banner-message')
      expect(message).toBeTruthy()
      expect(message.textContent).toBe('Test message')
    })

    test('should create message with custom classes', () => {
      bannerService.showLoadingBanner()
      const parent = bannerService.currentBanner
      bannerService.createMessage(parent, 'Custom message', ['custom-class'])

      const message = parent.querySelector('.custom-class')
      expect(message).toBeTruthy()
      expect(message.textContent).toBe('Custom message')
    })
  })

  describe('getBannerContainer fallbacks', () => {
    test('creates an insertion wrapper after .tahvel-form-buttons', () => {
      const preferred = document.createElement('div')
      preferred.className = 'tahvel-form-buttons'
      document.body.appendChild(preferred)

      const wrapper = bannerService.getBannerContainer()
      expect(wrapper.className).toBe('ta-sync-banner-insertion')
      expect(preferred.nextElementSibling).toBe(wrapper)
    })

    test('falls back to document.body when no container or preferred is present', () => {
      const service = new BannerService('.does-not-exist')
      const wrapper = service.getBannerContainer()
      expect(wrapper).toBe(document.body)
    })

    test('catches errors when insertion-wrapper creation throws', () => {
      const preferred = document.createElement('div')
      preferred.className = 'tahvel-form-buttons'
      document.body.appendChild(preferred)

      const originalInsert = preferred.insertAdjacentElement.bind(preferred)
      preferred.insertAdjacentElement = () => { throw new Error('insert-broken') }

      const result = bannerService.getBannerContainer()
      expect(result).toBeTruthy()
      preferred.insertAdjacentElement = originalInsert
    })
  })

  describe('waitForBannerContainer', () => {
    test('resolves with banner container when preferred element appears', async () => {
      const preferred = document.createElement('div')
      preferred.className = 'tahvel-form-buttons'
      document.body.appendChild(preferred)

      const result = await bannerService.waitForBannerContainer(100)
      expect(result.className).toBe('ta-sync-banner-insertion')
    })

    test('falls back gracefully when preferred element never appears', async () => {
      const result = await bannerService.waitForBannerContainer(100)
      expect(result).toBeTruthy()
    })
  })
})
