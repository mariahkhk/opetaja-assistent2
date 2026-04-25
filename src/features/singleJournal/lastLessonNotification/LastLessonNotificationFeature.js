// LastLessonNotificationFeature.js
// Feature: Notify teacher about the date of the last lesson in the journal, based on timetable and journal entries.
// See feature.md for requirements and LessonDiscrepanciesFeature.js for reference implementation.

import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { getSchoolId } from '../../../lib/schoolId.js'

function getApiErrorStatus(error) {
  return error?.status || Number(error?.message?.match(/API Error:\s*(\d+)/)?.[1])
}

function isExpectedTahvelStatus(error, statuses) {
  return statuses.includes(getApiErrorStatus(error))
}

/**
 * LastLessonNotificationFeature
 * Notifies the teacher about the last lesson date if all lessons are not yet in the past.
 */
export default class LastLessonNotificationFeature extends BaseFeature {
  constructor() {
    super('lastLessonNotification', /\/journal\/(\d+)\/edit/)
    this.name = 'LastLessonNotificationFeature'

    // Use Intl.DateTimeFormat with timeZone 'Europe/Tallinn' and en-CA locale
    // to produce an ISO-like YYYY-MM-DD string directly.
    this.comparisonDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Tallinn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
    // this.comparisonDate = '2024-11-07' // Uncomment for testing with a fixed date  22.11.2024
  }

  async activate() {
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] activate called')
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Using comparison date:', this.comparisonDate)
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Current URL:', window.location.href)

    try {
      // Only show the last lesson notification banner
      await this.#showLastLessonNotification()
      // Table creation is now handled by DiscrepanciesTable
    } catch (error) {
      if (isExpectedTahvelStatus(error, [403, 412])) {
        if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Expected Tahvel response, skipping banner:', error.message)
        this._removeBanner()
        return
      }
      console.error('[LastLessonNotificationFeature] Error in activate:', error)
    }
  }

  onDeactivate() {
    this._removeBanner()
    super.onDeactivate()
  }
  async #showLastLessonNotification() {
    const journalId = this.#extractJournalId()
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] journalId:', journalId)
    if (!journalId) {
      if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] No journalId found, exiting')
      return
    }

    const { timetable, journalEntries, journalInfo } = await this.#fetchData(journalId)
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] timetable:', timetable)
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] journalEntries:', journalEntries)

    if (!journalEntries.length) {
      if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] No journal entries, exiting')
      this._removeBanner()
      return
    }

    // Determine last lesson date - check if timetable is complete or use approximate from plan
    let lastLessonDate = null
    let isApproximate = false
    const sortedTimetable = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))

    if (timetable.length > 0) {
      // Get planned MAHT_a lessons count
      const mahtACapacity = journalInfo?.lessonHours?.capacityHours?.find(c => c.capacity === 'MAHT_a')
      const plannedMahtALessons = mahtACapacity?.plannedHours || 0
      const timetableLessons = timetable.length

      if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] plannedMahtALessons=${plannedMahtALessons}, timetableLessons=${timetableLessons}`)

      if (plannedMahtALessons > 0 && timetableLessons >= plannedMahtALessons) {
        // Timetable is complete - use last timetable entry (exact)
        lastLessonDate = sortedTimetable[sortedTimetable.length - 1].date
        isApproximate = false
        if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Using exact last lesson from timetable: ${lastLessonDate}`)
      } else if (plannedMahtALessons > 0 && timetableLessons < plannedMahtALessons) {
        // Timetable is incomplete - get approximate from lesson plan
        if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Timetable incomplete (${timetableLessons}/${plannedMahtALessons}), fetching from lesson plan`)
        const teacherId = journalInfo?.journalTeachers?.[0]?.id
        if (teacherId) {
          const lastLessonFromPlan = await this.#getLastLessonFromPlan(journalId, teacherId)
          if (lastLessonFromPlan) {
            lastLessonDate = lastLessonFromPlan
            isApproximate = true
            if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Using approximate last lesson from plan: ${lastLessonDate}`)
          } else {
            // Fallback to timetable's last entry if plan lookup fails
            lastLessonDate = sortedTimetable[sortedTimetable.length - 1].date
            isApproximate = false
            if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Plan lookup failed, falling back to timetable: ${lastLessonDate}`)
          }
        } else {
          // No teacher ID, use timetable
          lastLessonDate = sortedTimetable[sortedTimetable.length - 1].date
          isApproximate = false
        }
      } else {
        // No MAHT_a data, just use timetable
        lastLessonDate = sortedTimetable[sortedTimetable.length - 1].date
        isApproximate = false
      }
    } else {
      // No timetable entries - try to get from lesson plan
      const teacherId = journalInfo?.journalTeachers?.[0]?.id
      if (teacherId) {
        const lastLessonFromPlan = await this.#getLastLessonFromPlan(journalId, teacherId)
        if (lastLessonFromPlan) {
          lastLessonDate = lastLessonFromPlan
          isApproximate = true
          if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] No timetable, using approximate from plan: ${lastLessonDate}`)
        }
      }
    }

    let independentWorkMessages = []
    if (lastLessonDate && Array.isArray(journalEntries)) {
      const lastLesson = new Date(lastLessonDate)
      lastLesson.setHours(0, 0, 0, 0)
      const futureIndependents = journalEntries
        .filter(entry => entry.entryType === 'SISSEKANNE_I')
        .map(entry => {
          const dueDateStr = entry.homeworkDuedate || entry.entryDate
          if (!dueDateStr) return null
          const deadline = new Date(dueDateStr)
          deadline.setHours(0, 0, 0, 0)
          return { deadline, entry }
        })
        .filter(Boolean)
        .filter(({ deadline }) => deadline > lastLesson)
        .sort((a, b) => a.deadline - b.deadline)
      if (futureIndependents.length > 0) {
        independentWorkMessages = futureIndependents.map(({ deadline }) => {
          const diffDays = Math.round((deadline - lastLesson) / (1000 * 60 * 60 * 24))
          const deadlineStr = this.#formatDisplayDate(deadline)
          return `${deadlineStr} iseseiseva töö tähtaeg on ${diffDays} päeva hiljem kui viimane tund`
        })
      }
    }

    if (independentWorkMessages.length > 0) {
      window.__lastLessonNotification_independentWorkMessage = independentWorkMessages
      document.getElementById('independent-work-deadline-banner')?.remove()
      if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Provided independent work messages to table:', independentWorkMessages)
    }

    const comparisonDateTime = new Date(this.comparisonDate)
    comparisonDateTime.setHours(0, 0, 0, 0)
    let allPast = false
    if (timetable.length > 0) {
      allPast = timetable.every(lesson => {
        const lessonDate = new Date(lesson.date)
        lessonDate.setHours(0, 0, 0, 0)
        return lessonDate < comparisonDateTime
      })
    } else if (lastLessonDate) {
      // If no timetable but we have approximate date, check if it's past
      const lastDate = new Date(lastLessonDate)
      lastDate.setHours(0, 0, 0, 0)
      allPast = lastDate < comparisonDateTime
    }

    let displayDate = 'not found in timetable'
    if (lastLessonDate) {
      displayDate = lastLessonDate
    }

    // Always show the banner if there are journal entries
    this._showBanner(displayDate, allPast, isApproximate)
  }

  _showBanner(date, allPast = false, isApproximate = false) {
    this._removeBanner()
    // Try the original subject span, then try the new accordion header selector and a few sensible fallbacks
    const selectors = ['.hois-collapse-header .flex-gt-md-50 span', '.accordion-header', '.hois-collapse-header span']
    let subjectSpan = null
    for (const sel of selectors) {
      subjectSpan = document.querySelector(sel)
      if (subjectSpan) {
        if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Found insertion target with selector:', sel)
        break
      }
    }
    if (!subjectSpan) {
      if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] No suitable insertion target found, cannot show notification')
      return
    }
    const oldNotif = document.getElementById('last-lesson-inline-notification')
    if (oldNotif) oldNotif.remove()
    let isLastLessonToday = false
    let isPast = false
    if (date !== 'not found in timetable') {
      const d1 = new Date(date)
      const d2 = new Date(this.comparisonDate)
      d1.setHours(0, 0, 0, 0)
      d2.setHours(0, 0, 0, 0)
      if (d1.getTime() === d2.getTime()) {
        isLastLessonToday = true
      } else if (d1.getTime() < d2.getTime()) {
        isPast = true
      }
    }
    const comparisonDateStr = this.#formatDisplayDate(this.comparisonDate)
    const todayStr = this.#formatDisplayDate(new Date())
    const showComparisonDate = comparisonDateStr !== todayStr
    let bannerMessage
    if (date === 'not found in timetable') {
      bannerMessage = `NB! Õppetöö kirjed on olemas, kuid tunniplaani andmeid ei leitud${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
    } else {
      const verb = allPast ? 'toimus' : 'toimub'
      const approxText = isApproximate ? 'umbes ' : ''
      bannerMessage = `Viimane tund ${verb} ${approxText}${this.#formatDisplayDate(date)}${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
    }
    let bgColor = '#fff3cd' // yellow default
    let borderColor = '#ffeaa7'
    if (isLastLessonToday) {
      bgColor = '#ffcccc' // red
      borderColor = '#ff8888'
    } else if (isPast) {
      bgColor = '#e9ecef' // gray
      borderColor = '#adb5bd'
    }
    // Force red if last lesson date equals comparison date
    if (date !== 'not found in timetable') {
      const d1 = new Date(date)
      const d2 = new Date(this.comparisonDate)
      d1.setHours(0, 0, 0, 0)
      d2.setHours(0, 0, 0, 0)
      if (d1.getTime() === d2.getTime()) {
        bgColor = '#ffcccc'
        borderColor = '#ff8888'
      }
    }
    const notif = document.createElement('span')
    notif.id = 'last-lesson-inline-notification'
    let animationCss = ''
    if (isLastLessonToday) {
      animationCss = 'animation: oa2-strobe 2s ease-in-out infinite;'
      // Inject keyframes if not already present
      if (!document.getElementById('oa2-strobe-keyframes')) {
        const style = document.createElement('style')
        style.id = 'oa2-strobe-keyframes'
        style.textContent = `
          @keyframes oa2-strobe {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `
        document.head.appendChild(style)
      }
    }
    notif.style.cssText = `
      display: inline-block;
      flex-shrink: 0;
      margin-left: 16px;
      background: ${bgColor};
      border: 1px solid ${borderColor};
      border-radius: 12px;
      padding: 4px 12px;
      font-size: 15px;
      font-weight: bold;
      color: #212529;
      vertical-align: middle;
      ${animationCss}
    `
    notif.textContent = bannerMessage
    // Insert inside .label-wrapper to avoid disrupting the accordion header's flex/grid layout
    const searchRoot = subjectSpan.closest('.accordion-header, .hois-collapse-header') || subjectSpan
    const labelWrapper = searchRoot.querySelector('.label-wrapper')
    if (labelWrapper) {
      labelWrapper.appendChild(notif)
    } else {
      subjectSpan.appendChild(notif)
    }
  }

  _removeBanner() {
    document.getElementById('last-lesson-inline-notification')?.remove()
    document.getElementById('last-lesson-banner')?.remove()
  }
  #formatDisplayDate(date) {
    const d = new Date(date)
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()
    return `${day}.${month}.${year}`
  }

  #extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  async #fetchData(journalId) {
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] #fetchData called with journalId:', journalId)

    // Fetch journal info to get schoolId and teacherId
    let info
    try {
      info = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true, cacheExpiration: 864e5, suppressErrorStatuses: [412] })
    } catch (error) {
      if (isExpectedTahvelStatus(error, [412])) return { timetable: [], journalEntries: [], journalInfo: null }
      throw error
    }
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Journal info:', info)

    if (!info) {
      if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] No journal info found')
      return { timetable: [], journalEntries: [], journalInfo: null }
    }

    const schoolId = await getSchoolId(this.api, info)
    const teacherId = info.journalTeachers?.[0]?.id
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] schoolId:', schoolId, 'teacherId:', teacherId)

    if (!teacherId || !schoolId) {
      if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Missing teacherId or schoolId')
      return { timetable: [], journalEntries: [], journalInfo: info }
    }

    // Get study year dates
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = info.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = info.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Date range:', { from, thru })

    const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Timetable endpoint:', endpoint)

    const timetableData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Raw timetable data:', timetableData)
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Timetable events count:', timetableData?.timetableEvents?.length || 0)

    const timetable = timetableData?.timetableEvents?.filter(event => event.journalId == journalId) || []

    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Filtered timetable events for journal:', timetable)

    // Fetch journal entries
    let journalEntries = []
    try {
      journalEntries = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: false },
        { cache: true, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] }
      )
    } catch (error) {
      if (isExpectedTahvelStatus(error, [403, 412])) journalEntries = []
      else throw error
    }
    if (Logger.isDebugMode()) Logger.debug('[LastLessonNotificationFeature] Journal entries:', journalEntries)

    return { timetable, journalEntries: journalEntries ?? [], journalInfo: info }
  }

  /**
   * Get last lesson date from lesson plan (plankoormused) when timetable doesn't have all entries
   * @param {number} journalId - Journal ID
   * @param {number} teacherId - Teacher ID
   * @returns {Promise<string|null>} Last lesson date in ISO format or null
   */
  async #getLastLessonFromPlan(journalId, teacherId) {
    try {
      // Get study year ID
      const now = new Date()
      const currentYear = now.getFullYear()
      const currentMonth = now.getMonth()

      // Determine study year (starts in September)
      const studyYearStart = currentMonth < 8 ? currentYear - 1 : currentYear

      // Study year ID appears to be based on pattern from the data: 726 for 2025-26
      // The pattern seems to be: year - 1299 (e.g., 2025 - 1299 = 726)
      const studyYearId = studyYearStart - 1299

      const endpoint = `/lessonplans/byteacher/${teacherId}/${studyYearId}`

      if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Fetching lesson plan for journal ${journalId}, teacher ${teacherId}, studyYear ${studyYearId}`)

      const planData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })

      if (!planData?.journals || !planData?.studyPeriods) {
        if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] No plan data found for journal ${journalId}`)
        return null
      }

      // Find the journal in the plan
      const journalPlan = planData.journals.find(j => j.id === journalId)
      if (!journalPlan?.hours?.MAHT_a) {
        if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] No MAHT_a hours found for journal ${journalId}`)
        return null
      }

      // Find the last week with MAHT_a hours (non-null value)
      const mahtAWeeks = journalPlan.hours.MAHT_a
      let lastWeekIndex = -1

      for (let i = mahtAWeeks.length - 1; i >= 0; i--) {
        if (mahtAWeeks[i] !== null) {
          lastWeekIndex = i
          break
        }
      }

      if (lastWeekIndex === -1) {
        if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] No non-null MAHT_a hours found for journal ${journalId}`)
        return null
      }

      if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Found last week index: ${lastWeekIndex}, hours: ${mahtAWeeks[lastWeekIndex]}`)

      // Get the week number for that index
      const weekNr = planData.weekNrs[lastWeekIndex]

      if (!weekNr) {
        if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] No week number found at index ${lastWeekIndex}`)
        return null
      }

      if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Week number: ${weekNr}`)

      // Find the study period that contains this week
      for (const period of planData.studyPeriods) {
        const weekPosition = period.weekNrs.indexOf(weekNr)
        if (weekPosition !== -1 && period.weekBeginningDates?.[weekPosition]) {
          // Return the Monday of that week
          const lastLessonDate = period.weekBeginningDates[weekPosition]
          if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Found last lesson date: ${lastLessonDate} in period ${period.nameEt}`)
          return lastLessonDate
        }
      }

      if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Week ${weekNr} not found in any study period`)
      return null
    } catch (error) {
      if (Logger.isDebugMode()) Logger.debug(`[LastLessonNotificationFeature] Could not get last lesson from plan for journal ${journalId}:`, error.message)
      return null
    }
  }

  static async refresh(api) {
    if (!window.location.href.match(/\/journal\/(\d+)\/edit/)) return
    const feature = new LastLessonNotificationFeature()
    feature.api = api || (window.__opetajaAssistentApiService && window.__opetajaAssistentApiService.api)
    if (!feature.api) return
    await feature.#showLastLessonNotification()
  }
}

// Attach refresh to window for global access (outside class)
if (typeof window !== 'undefined' && !window.__lastLessonNotificationRefresh) {
  window.__lastLessonNotificationRefresh = LastLessonNotificationFeature.refresh
}
