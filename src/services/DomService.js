/**
 * DOM Service - Utilities for DOM manipulation
 */

import Logger from './Logger.js'

const domService = {
  /**
   * Wait for an element to appear in the DOM
   * @param {string} selector - CSS selector for the element
   * @param {number} timeout - Maximum time to wait in ms (default: 10000)
   * @param {number} interval - Check interval in ms (default: 100)
   * @returns {Promise<Element>} The found element
   */
  waitForElement(selector, timeout = 10000, interval = 100) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector)
      if (element) {
        return resolve(element)
      }

      const startTime = Date.now()
      const timer = setInterval(() => {
        const element = document.querySelector(selector)
        if (element) {
          clearInterval(timer)
          resolve(element)
        } else if (Date.now() - startTime >= timeout) {
          clearInterval(timer)
          reject(new Error(`Element not found: ${selector}`))
        }
      }, interval)
    })
  },

  /**
   * Wait for elements to appear in the DOM using MutationObserver
   * @param {string|string[]} selectors - CSS selector(s) to observe for
   * @param {function} callback - Function to call when elements are found
   * @param {number} timeout - Maximum time to wait in ms (default: 20000)
   * @returns {Object} Observer control object with disconnect method
   */
  observeForElements(selectors, callback, timeout = 20000) {
    // Convert single selector to array
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors]

    // Check if elements already exist
    for (const selector of selectorArray) {
      const elements = document.querySelectorAll(selector)
      if (elements && elements.length > 0) {
        Logger.debug(`Found ${elements.length} elements immediately with selector: ${selector}`)
        callback(elements, selector)
        // Return a dummy observer with a no-op disconnect method
        return {
          disconnect: () => {
            Logger.debug('Dummy observer disconnected (elements found immediately)')
          }
        }
      }
    }

    Logger.debug('No elements found immediately, setting up MutationObserver')

    // Set up observer to watch for DOM changes
    const observer = new MutationObserver(() => {
      // Check each selector after DOM changes
      for (const selector of selectorArray) {
        const elements = document.querySelectorAll(selector)
        if (elements && elements.length > 0) {
          Logger.debug(`Observer found ${elements.length} elements with selector: ${selector}`)
          // Clear the timeout to prevent the error callback from being called
          clearTimeout(timeoutId)
          // Call the callback with the found elements
          callback(elements, selector)
          // Disconnect the observer
          observer.disconnect()
          return
        }
      }
    })

    // Start observing the document
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    })

    // Set a timeout to stop the observer after the specified time
    const timeoutId = setTimeout(() => {
      if (observer) {
        Logger.debug(`Stopping observer after ${timeout}ms timeout`)
        observer.disconnect()
        callback(null, null, new Error('Timeout waiting for elements'))
      }
    }, timeout)

    // Return an object with disconnect method
    return {
      disconnect: () => {
        clearTimeout(timeoutId)
        observer.disconnect()
      }
    }
  },

  /**
   * Create and insert an element into the DOM
   * @param {string} tag - HTML tag name
   * @param {Object} attributes - Element attributes
   * @param {string|Node} content - Inner content (string or DOM node)
   * @param {Element} parent - Parent element to append to
   * @param {string} position - InsertPosition (beforebegin, afterbegin, beforeend, afterend)
   * @returns {Element} The created element
   */
  createAndInsertElement(tag, attributes = {}, content = '', parent, position = 'beforeend') {
    const element = document.createElement(tag)

    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value)
      } else if (key === 'classList' && Array.isArray(value)) {
        element.classList.add(...value)
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.entries(value).forEach(([dataKey, dataValue]) => {
          element.dataset[dataKey] = dataValue
        })
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.substring(2).toLowerCase()
        element.addEventListener(eventName, value)
      } else {
        element.setAttribute(key, value)
      }
    })

    // Set content
    if (content) {
      if (typeof content === 'string') {
        element.innerHTML = content
      } else if (content instanceof Node) {
        element.appendChild(content)
      }
    }

    // Insert into parent
    if (parent) {
      parent.insertAdjacentElement(position, element)
    }

    return element
  },

  /**
   * Add styles to the page
   * @param {string} css - CSS rules to add
   * @returns {HTMLStyleElement} The created style element
   */
  addStyles(css) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    return style
  },

  /**
   * Write a value into an Angular reactive-form input so the bound model
   * picks it up. The native `value` property setter is called via the
   * prototype descriptor — assigning to `.value` directly bypasses the
   * setter React/Angular monkey-patches, so the framework never sees the
   * change. Then dispatch a bubbling `input` event for the framework
   * listener.
   * @param {HTMLInputElement} input
   * @param {string} newValue
   */
  setReactiveInputValue(input, newValue) {
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, newValue)
    else input.value = newValue
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

export { domService }
