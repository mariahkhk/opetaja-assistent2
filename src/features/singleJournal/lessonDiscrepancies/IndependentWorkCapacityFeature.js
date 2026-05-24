// IndependentWorkCapacityFeature.js
// Checks if the number of independent work entries matches the planned hours

export default class IndependentWorkCapacityFeature {
  /**
   * Checks independent work capacity for a journal
   * @param {object} api - API object with tahvel.get
   * @param {number} journalId - Journal ID
   * @returns {Promise<string|null>} - Message to display or null
   */
  static async check(api, journalId) {
    // Wait for the inline notification to appear (up to 2s)
    let notif = null
    let waited = 0
    const maxWait = 2000
    const interval = 100
    while (waited < maxWait) {
      notif = document.getElementById('last-lesson-inline-notification')
      if (notif) break
      await new Promise(r => setTimeout(r, interval))
      waited += interval
    }
    if (!notif) return null
    const notifText = notif.textContent || ''
    const notifMatch = notifText.match(/Viimane tund toim(?:us|ub) (?:umbes )?\d{2}\.\d{2}\.\d{4}/)
    if (!notifMatch) return null

    try {
  // Force refresh to avoid using stale cached journal data when teacher updates
  const info = await api.tahvel.get(`/journals/${journalId}`, {}, { forceRefresh: true })
      const capacityHours = info.lessonHours?.capacityHours || []
      const indep = capacityHours.find(c => c.capacity === 'MAHT_i')
      if (!indep) return null
      if (typeof indep.usedHours !== 'number' || typeof indep.plannedHours !== 'number') return null
      const diff = indep.usedHours - indep.plannedHours
      const absDiff = Math.abs(diff)
      if (diff !== 0) {
        const suffix = diff < 0 ? 'liiga vähe' : 'liiga palju'
        return `iseseisevaid töid on ${absDiff}h ${suffix}`
      }
      return null
    } catch (e) {
      // Fail silently
      return null
    }
  }
}
