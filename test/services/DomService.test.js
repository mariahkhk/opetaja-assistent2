import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { domService } from '../../src/services/DomService.js'

describe('DomService', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    global.window = dom.window
    global.document = dom.window.document
    global.HTMLElement = dom.window.HTMLElement
    global.MutationObserver = dom.window.MutationObserver
  })

  afterEach(() => {
    global.document = undefined
    global.window = undefined
  })

  describe('waitForElement', () => {
    test('should resolve immediately if element exists', async () => {
      const mockElement = { id: 'test-element' }
      global.document.querySelector = mock(() => mockElement)

      const element = await domService.waitForElement('#test-element')
      expect(element).toBe(mockElement)
    })

    test('should wait for element to appear', async () => {
      let callCount = 0
      global.document.querySelector = mock(() => {
        callCount++
        if (callCount > 2) {
          return { id: 'delayed-element' }
        }
        return null
      })

      const element = await domService.waitForElement('#delayed-element', 1000, 50)
      expect(element.id).toBe('delayed-element')
    })

    test('should reject on timeout', async () => {
      global.document.querySelector = mock(() => null)

      try {
        await domService.waitForElement('#non-existent', 100, 20)
        expect(true).toBe(false)
      } catch (error) {
        expect(error.message).toContain('Element not found: #non-existent')
      }
    })
  })

  describe('observeForElements', () => {
    test('should find elements immediately if they exist', () => {
      const mockElements = [{ className: 'immediate-element' }]
      global.document.querySelectorAll = mock(() => mockElements)

      const callback = mock(() => {})
      const observer = domService.observeForElements('.immediate-element', callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toEqual(mockElements)
      expect(callback.mock.calls[0][1]).toBe('.immediate-element')
    })
  })

  describe('createAndInsertElement', () => {
    test('should create element with basic attributes', () => {
      // Test isolation issue fixed with proper chrome mock restoration
      const parent = { insertAdjacentElement: mock(() => {}), contains: mock(() => true) }

      const element = domService.createAndInsertElement('span', { id: 'test-span', class: 'test-class' }, 'Hello World', parent)

      expect(element.tagName).toBe('SPAN')
      expect(element.id).toBe('test-span')
      expect(element.getAttribute('class')).toBe('test-class')
      expect(element.innerHTML).toBe('Hello World')
    })

    test('should handle style object', () => {
      // Test isolation issue fixed with proper chrome mock restoration
      const parent = { insertAdjacentElement: mock(() => {}) }

      const element = domService.createAndInsertElement(
        'div',
        {
          style: {
            color: 'red',
            fontSize: '16px'
          }
        },
        '',
        parent
      )

      expect(element.style.color).toBe('red')
      expect(element.style.fontSize).toBe('16px')
    })

    test('should handle classList array', () => {
      // SKIPPED: Test isolation issue - passes individually
      const parent = { insertAdjacentElement: mock(() => {}) }

      const element = domService.createAndInsertElement('div', { classList: ['class1', 'class2', 'class3'] }, '', parent)

      expect(element.classList.contains('class1')).toBe(true)
      expect(element.classList.contains('class2')).toBe(true)
      expect(element.classList.contains('class3')).toBe(true)
    })

    test('should handle dataset object', () => {
      // SKIPPED: Test isolation issue - passes individually
      const parent = { insertAdjacentElement: mock(() => {}) }

      const element = domService.createAndInsertElement(
        'div',
        {
          dataset: {
            userId: '123',
            userName: 'test'
          }
        },
        '',
        parent
      )

      expect(element.dataset.userId).toBe('123')
      expect(element.dataset.userName).toBe('test')
    })

    test('should create element without parent', () => {
      // SKIPPED: Test isolation issue - passes individually
      const element = domService.createAndInsertElement('div', { id: 'no-parent' }, 'orphan element')

      expect(element.id).toBe('no-parent')
      expect(element.innerHTML).toBe('orphan element')
    })
  })

  describe('addStyles', () => {
    test('should add CSS to the page', () => {
      const css = '.test-class { color: red; }'
      const styleElement = domService.addStyles(css)

      expect(styleElement.tagName).toBe('STYLE')
      expect(styleElement.textContent).toBe(css)
    })

    test('should return the created style element', () => {
      const css = 'body { margin: 0; }'
      const styleElement = domService.addStyles(css)

      expect(styleElement).toBeInstanceOf(Object)
      expect(styleElement.tagName).toBe('STYLE')
    })
  })
})
