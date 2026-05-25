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
      const div = document.createElement('div')
      div.id = 'test-element'
      document.body.appendChild(div)

      const element = await domService.waitForElement('#test-element')
      expect(element).toBe(div)
      expect(element.id).toBe('test-element')
    })

    test('should wait for element to appear', async () => {
      setTimeout(() => {
        const div = document.createElement('div')
        div.id = 'delayed-element'
        document.body.appendChild(div)
      }, 100)

      const element = await domService.waitForElement('#delayed-element', 1000, 50)
      expect(element.id).toBe('delayed-element')
    })

    test('should reject on timeout when element never appears', async () => {
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
      const a = document.createElement('div')
      a.className = 'immediate-element'
      const b = document.createElement('div')
      b.className = 'immediate-element'
      document.body.appendChild(a)
      document.body.appendChild(b)

      const callback = mock(() => {})
      domService.observeForElements('.immediate-element', callback)

      expect(callback).toHaveBeenCalledTimes(1)
      const found = callback.mock.calls[0][0]
      expect(Array.from(found)).toEqual([a, b])
      expect(callback.mock.calls[0][1]).toBe('.immediate-element')
    })

    test('should fire callback when matching elements appear later via mutation', async () => {
      const callback = mock(() => {})
      domService.observeForElements('.late-element', callback)

      const div = document.createElement('div')
      div.className = 'late-element'
      document.body.appendChild(div)

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(callback).toHaveBeenCalled()
      const lastCall = callback.mock.calls[callback.mock.calls.length - 1]
      expect(Array.from(lastCall[0])).toEqual([div])
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
      expect(element.textContent).toBe('Hello World')
    })

    test('should escape HTML when string content is passed', () => {
      const parent = { insertAdjacentElement: mock(() => {}) }
      const element = domService.createAndInsertElement('div', {}, '<img src=x onerror=alert(1)>', parent)
      expect(element.textContent).toBe('<img src=x onerror=alert(1)>')
      expect(element.children.length).toBe(0)
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
      expect(element.textContent).toBe('orphan element')
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

  describe('observeForElements immediate-find path', () => {
    test('returns a dummy observer when elements are found immediately', () => {
      const div = document.createElement('div')
      div.className = 'instant'
      document.body.appendChild(div)

      let calledWith = null
      const observer = domService.observeForElements('.instant', (els, selector) => {
        calledWith = { count: els.length, selector }
      })
      expect(calledWith.count).toBe(1)
      expect(calledWith.selector).toBe('.instant')
      expect(typeof observer.disconnect).toBe('function')
      observer.disconnect()
    })
  })

  describe('createAndInsertElement Node-content branch', () => {
    test('appends a Node child when content is a DOM node', () => {
      global.Node = window.Node
      const child = document.createElement('span')
      child.textContent = 'inner'
      const wrapper = domService.createAndInsertElement('div', {}, child)
      expect(wrapper.firstChild).toBe(child)
    })
  })
})
