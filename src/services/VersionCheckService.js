/**
 * VersionCheckService - Checks if the extension version is up to date
 *
 * This service:
 * - Loads local version from version.js (built with commit ID)
 * - Fetches latest version from Kriit API
 * - Compares versions and shows modal if outdated
 * - Disables extension functionality when outdated
 */

import Logger from './Logger.js'
import { VERSION } from '../version.js'

class VersionCheckService {
  constructor() {
    this.localVersion = null
    this.latestVersion = null
    this.isOutdated = false
    this.modalShown = false
  }

  /**
   * Load local version from version.js (injected during build)
   * @returns {Promise<Object|null>} Version object with commitId
   */
  async getLocalVersion() {
    if (this.localVersion) {
      return this.localVersion
    }

    try {
      // VERSION is imported from version.js which is generated during build
      this.localVersion = VERSION
      Logger.debug('[VersionCheckService] Local version loaded:', this.localVersion)
      return this.localVersion
    } catch (error) {
      Logger.error('[VersionCheckService] Failed to load local version:', error)
      return null
    }
  }

  /**
   * Fetch latest version from Kriit API via background script
   * @param {string} apiUrl - Kriit API base URL
   * @returns {Promise<Object|null>} Latest version object with commitId
   */
  async getLatestVersion(apiUrl) {
    try {
      if (!apiUrl) {
        Logger.debug('[VersionCheckService] No Kriit API URL configured, skipping version check')
        return null
      }

      const url = `${apiUrl}/extensionversion`

      // Use background script to bypass CORS restrictions
      const response = await chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'GET',
        url: url,
        headers: {
          Accept: 'application/json'
        }
      })

      if (response.status !== 'success') {
        Logger.error(`[VersionCheckService] Failed to fetch latest version: ${response.message}`)
        return null
      }

      // Kriit API returns {status, data}, extract the data field
      this.latestVersion = response.data.data || response.data
      Logger.debug('[VersionCheckService] Latest version from Kriit:', this.latestVersion)
      return this.latestVersion
    } catch (error) {
      Logger.error('[VersionCheckService] Failed to fetch latest version:', error)
      return null
    }
  }

  /**
   * Check if extension is outdated
   * @returns {Promise<boolean>} True if extension is outdated
   */
  async checkVersion() {
    try {
      // Get Kriit settings from storage
      const storage = await chrome.storage.sync.get(['OA_kriitEnabled', 'OA_kriitApiBaseUrl'])
      const kriitEnabled = storage.OA_kriitEnabled
      const apiUrl = storage.OA_kriitApiBaseUrl

      // Skip version check if Kriit integration is disabled
      if (!kriitEnabled) {
        Logger.debug('[VersionCheckService] Kriit integration is disabled, skipping version check')
        return false
      }

      // Skip version check if no Kriit URL is configured
      if (!apiUrl) {
        Logger.debug('[VersionCheckService] No Kriit API URL configured, skipping version check')
        return false
      }

      // Skip version check if using localhost (development mode)
      if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
        Logger.debug('[VersionCheckService] Development mode detected (localhost), skipping version check')
        return false
      }

      // Load local version
      const localVersion = await this.getLocalVersion()
      if (!localVersion) {
        Logger.error('[VersionCheckService] Cannot check version: local version not available')
        return false
      }

      // Fetch latest version
      const latestVersion = await this.getLatestVersion(apiUrl)
      if (!latestVersion) {
        // If we can't fetch the latest version, assume extension is up to date
        // This prevents blocking users when Kriit is unavailable
        Logger.debug('[VersionCheckService] Cannot fetch latest version, assuming up to date')
        return false
      }

      // Compare commit IDs
      this.isOutdated = localVersion.commitId !== latestVersion.commitId

      if (this.isOutdated) {
        Logger.warning('[VersionCheckService] Extension is outdated!', {
          local: localVersion.shortCommitId,
          latest: latestVersion.shortCommitId
        })
      } else {
        Logger.debug('[VersionCheckService] Extension is up to date', {
          version: localVersion.shortCommitId
        })
      }

      return this.isOutdated
    } catch (error) {
      Logger.error('[VersionCheckService] Error checking version:', error)
      return false
    }
  }

  /**
   * Show outdated version modal and disable extension
   */
  showOutdatedModal() {
    if (this.modalShown) {
      return
    }

    this.modalShown = true

    // Create modal overlay
    const overlay = document.createElement('div')
    overlay.id = 'oa2-outdated-modal-overlay'
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 999999;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `

    // Create modal content
    const modal = document.createElement('div')
    modal.id = 'oa2-outdated-modal'
    modal.style.cssText = `
      background: white;
      padding: 40px;
      border-radius: 12px;
      max-width: 500px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    `

    const title = document.createElement('h2')
    title.textContent = 'Laiendus on aegunud'
    title.style.cssText = `
      margin: 0 0 20px 0;
      color: #d32f2f;
      font-size: 24px;
      font-weight: 600;
    `

    const message = document.createElement('p')
    message.innerHTML = `
      Teie Õpetaja Assistent 2 laiendus on aegunud.<br><br>
      Palun värskendage laiendust, et jätkata kasutamist.
    `
    message.style.cssText = `
      margin: 0 0 30px 0;
      color: #333;
      font-size: 16px;
      line-height: 1.6;
    `

    const button = document.createElement('button')
    button.textContent = 'Laadi leht uuesti'
    button.style.cssText = `
      background: #1976d2;
      color: white;
      border: none;
      padding: 12px 32px;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `
    button.onmouseover = () => (button.style.background = '#1565c0')
    button.onmouseout = () => (button.style.background = '#1976d2')
    button.onclick = () => window.location.reload()

    modal.appendChild(title)
    modal.appendChild(message)
    modal.appendChild(button)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)

    Logger.info('[VersionCheckService] Outdated modal shown')
  }

  /**
   * Check version and show modal if outdated
   * This is the main entry point called from Extension.js
   * @returns {Promise<boolean>} True if extension is outdated
   */
  async checkAndNotify() {
    const isOutdated = await this.checkVersion()

    if (isOutdated) {
      this.showOutdatedModal()
    }

    return isOutdated
  }

  /**
   * Check if extension is currently marked as outdated
   * @returns {boolean} True if extension is outdated
   */
  isExtensionOutdated() {
    return this.isOutdated
  }
}

// Export singleton instance
export const versionCheckService = new VersionCheckService()
export default versionCheckService
