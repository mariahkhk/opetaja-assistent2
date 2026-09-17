import Logger from './Logger.js'

/** Open the notification target as an active tab and bring its actual Chrome window forward.
 * Preserve maximized/fullscreen windows; restore only a minimized window. A focus failure
 * must not lose an already-opened lesson link. Tab creation failures still propagate so
 * the caller can retain the notification for retry.
 * @param {string} url The validated notification target URL.
 * @returns {Promise<object>} The newly created Chrome tab.
 */
export async function openNotificationTab(url) {
  const tab = await chrome.tabs.create({ url, active: true })
  try {
    const window = await chrome.windows.get(tab.windowId)
    await chrome.windows.update(tab.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) })
  } catch (error) {
    Logger.warning('Teavituse vaheleht avati, kuid Chrome’i akent ei saanud esiplaanile tuua:', error.message)
  }
  return tab
}
