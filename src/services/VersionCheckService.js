/**
 * VersionCheckService - Displays update banner when background script detects an update
 *
 * Architecture:
 * - background.js calls requestUpdateCheck() and listens for onUpdateAvailable
 * - When an update is detected, background.js sends a message to content script tabs
 * - This service listens for that message and shows a dismissible banner
 * - Dismiss state is persisted to chrome.storage.session so banner stays dismissed until browser restart
 */

import Logger from './Logger.js'

const DISMISS_KEY = 'oa2_update_banner_dismissed'

class VersionCheckService {
  constructor() {
    this.bannerShown = false
  }

  /**
   * Register message listener for update notifications from background script.
   * Call once during extension initialization.
   */
  listenForUpdates() {
    chrome.runtime.onMessage.addListener(message => {
      if (message.action === 'updateAvailable') {
        Logger.info('[VersionCheckService] Received update notification:', message.version)
        this.#showUpdateBannerIfNotDismissed(message.version || null)
      }
    })
  }

  /**
   * Check dismiss state before showing banner
   * @param {string|null} version - Available version string
   */
  async #showUpdateBannerIfNotDismissed(version) {
    try {
      const result = await chrome.storage.session.get(DISMISS_KEY)
      if (result[DISMISS_KEY]) {
        Logger.debug('[VersionCheckService] Banner previously dismissed this session, skipping')
        return
      }
    } catch (error) {
      // storage.session may not be available in all contexts, proceed to show banner
      Logger.debug('[VersionCheckService] Could not check dismiss state:', error.message)
    }

    this.#showUpdateBanner(version)
  }

  /**
   * Show a non-blocking dismissible update banner at the top of the page
   * @param {string|null} version - Available version string
   */
  #showUpdateBanner(version) {
    if (this.bannerShown || document.getElementById('oa2-update-banner')) {
      return
    }

    this.bannerShown = true

    const banner = document.createElement('div')
    banner.id = 'oa2-update-banner'
    banner.style.cssText = `
      background: #fff3cd;
      border-bottom: 2px solid #ffc107;
      padding: 10px 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      color: #856404;
    `

    const message = document.createElement('span')
    const versionText = version ? ` (v${version})` : ''
    message.textContent = `Õpetaja Assistent 2 uuendus on saadaval${versionText}. Chrome uuendab laiendust automaatselt.`

    const closeButton = document.createElement('button')
    closeButton.textContent = '\u00D7'
    closeButton.style.cssText = `
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #856404;
      padding: 0 4px;
      line-height: 1;
    `
    closeButton.onclick = () => {
      banner.remove()
      chrome.storage.session.set({ [DISMISS_KEY]: true }).catch(() => {})
    }

    banner.appendChild(message)
    banner.appendChild(closeButton)
    document.body.insertBefore(banner, document.body.firstChild)

    Logger.info('[VersionCheckService] Update banner shown')
  }
}

// Export singleton instance
export const versionCheckService = new VersionCheckService()
export default versionCheckService
