/**
 * VersionCheckService - Shows a one-time "extension updated" modal on Tahvel.
 *
 * Architecture:
 * - background.js seeds OA_updateBannerDismissed = manifest.version on fresh
 *   install (reason === 'install') so brand-new installs don't see a banner.
 * - On every Tahvel page load, Extension.init() calls checkForUpdate(), which
 *   reads chrome.storage.local and compares the dismissed version to
 *   chrome.runtime.getManifest().version. If they differ, the modal renders.
 * - Dismissing writes the current manifest version, suppressing the banner
 *   until the next update.
 */

import Logger from './Logger.js'

export const DISMISS_KEY = 'OA_updateBannerDismissed'

class VersionCheckService {
  constructor() {
    this.shown = false
  }

  /**
   * Show the update modal if the running extension version differs from the
   * last version the user dismissed. Safe to call multiple times — at most
   * one modal renders.
   */
  async checkForUpdate() {
    const version = chrome.runtime.getManifest().version
    try {
      const result = await chrome.storage.local.get(DISMISS_KEY)
      if (result[DISMISS_KEY] === version) {
        Logger.debug('[VersionCheckService] Banner already dismissed for this version, skipping')
        return
      }
    } catch (error) {
      Logger.debug('[VersionCheckService] Could not check dismiss state:', error.message)
    }

    this.#showModal(version)
  }

  /**
   * Dismiss and remove the modal
   * @param {HTMLElement} overlay - The modal overlay element
   * @param {string} version - Version to persist as dismissed
   */
  #dismiss(overlay, version) {
    overlay.remove()
    chrome.storage.local.set({ [DISMISS_KEY]: version }).catch(() => {})
  }

  /**
   * Show update notification as a modal overlay on the current page
   * @param {string} version - Current manifest version
   */
  #showModal(version) {
    if (this.shown || document.getElementById('oa2-update-modal')) return
    this.shown = true

    // Overlay backdrop
    const overlay = document.createElement('div')
    overlay.id = 'oa2-update-modal'
    overlay.style.cssText = `
      position:fixed; top:0; left:0; right:0; bottom:0;
      background:rgba(0,0,0,0.5);
      display:flex; justify-content:center; align-items:center;
      z-index:99999;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    `

    // Card
    const card = document.createElement('div')
    card.style.cssText = `
      background:white; border-radius:12px;
      box-shadow:0 4px 24px rgba(0,0,0,0.2);
      padding:40px; max-width:560px; width:90%; max-height:90vh; overflow-y:auto;
    `

    // Header
    const header = document.createElement('div')
    header.style.cssText = 'text-align:center;margin-bottom:28px'

    const icon = document.createElement('div')
    icon.style.cssText = 'font-size:48px;margin-bottom:16px'
    icon.textContent = '✨'

    const title = document.createElement('h1')
    title.style.cssText = 'font-size:22px;color:#333;margin:0 0 8px'
    title.textContent = 'Õpetaja Assistent 2 uuendus'

    header.appendChild(icon)
    header.appendChild(title)

    const versionEl = document.createElement('div')
    versionEl.style.cssText = 'font-size:15px;color:#666;margin-bottom:16px'
    versionEl.textContent = `Versioon ${version}`
    header.appendChild(versionEl)

    const hint = document.createElement('p')
    hint.style.cssText = 'font-size:14px;color:#888;line-height:1.5;margin:0'
    hint.textContent = 'Versioon on edukalt uuendatud.'
    header.appendChild(hint)

    // Footer
    const footer = document.createElement('div')
    footer.style.cssText = 'text-align:center'

    const closeBtn = document.createElement('button')
    closeBtn.style.cssText = `
      background:#4CAF50; color:white; border:none; border-radius:6px;
      padding:10px 32px; font-size:15px; cursor:pointer;
    `
    closeBtn.textContent = 'Selge'
    closeBtn.onclick = () => this.#dismiss(overlay, version)
    footer.appendChild(closeBtn)

    // Assemble
    card.appendChild(header)
    card.appendChild(footer)
    overlay.appendChild(card)

    // Close on backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) this.#dismiss(overlay, version)
    })

    document.body.appendChild(overlay)
    Logger.info('[VersionCheckService] Update modal shown')
  }
}

// Export singleton instance
export const versionCheckService = new VersionCheckService()
export default versionCheckService
