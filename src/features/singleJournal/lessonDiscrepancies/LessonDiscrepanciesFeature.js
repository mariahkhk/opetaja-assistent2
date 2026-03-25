import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { styleService } from '../../../services/StyleService.js'
import { DiscrepanciesTable } from './DiscrepanciesTable.js'
import { getSchoolId } from '../../../lib/schoolId.js'

// HEX constant and createButtonStyle function moved to DiscrepanciesTable class

/**
 * @typedef {Object} JournalInfo
 * @property {Array} journalTeachers - Array of teacher objects
 * @property {Object} school - School information
 * @property {number} school.id - School ID
 * @property {string} [studyYearStartDate] - Study year's start date
 * @property {string} [studyYearEndDate] - Study year's end date
 * @property {string} id - Journal ID
 */

/**
 * @typedef {Object} TimetableEvent
 * @property {string} journalId - Journal ID
 * @property {string} date - Event date
 * @property {string} timeStart - Start time
 */

/**
 * @typedef {Object} ButtonData
 * @property {string} [entryid] - Entry ID
 * @property {number} [duplicateindex] - Duplicate index
 * @property {number} [currentstart] - Current start lesson
 * @property {number} [timetablestart] - Timetable start lesson
 * @property {number} [currentcount] - Current lesson count
 * @property {number} [timetablecount] - Timetable lesson count
 */

export default class LessonDiscrepanciesFeature extends BaseFeature {
  #tableCreated = false
  #currentJournalId = null
  #saveMonitoringSetup = false
  #tableObserver = null
  #dialogObserver = null
  #isRefreshing = false
  #lastJournalData = null
  #originalFetch = null
  #problematicEntriesCache = null
  #dialogCloseObserver = null
  #refreshDebounceTimer = null
  #lastRefreshTs = 0
  #refreshInProgress = false
  #bulkAddInProgress = false
  #refreshPending = false

  static JOURNAL_ENTRY_CONTACT_TYPES = ['SISSEKANNE_T', 'SISSEKANNE_P', 'SISSEKANNE_E']
  static JOURNAL_ENTRY_DEFAULT_TYPE = 'SISSEKANNE_T'

  constructor() {
    super('lessonDiscrepancies', /\/journal\/\d+\/edit/)
    this.name = 'LessonDiscrepanciesFeature'

    // Initialize the table class
    this.table = new DiscrepanciesTable({
      api: this.api,
      formatDate: this.#formatDisplayDate,
      extractJournalId: () => this.#extractJournalId(),
      calculateDuplicateIndex: discrepancy => this.#calculateDuplicateIndex(discrepancy),
      findDuplicateMatches: (entryId, date) => this.#findDuplicateMatches(entryId, date),
      addDiscrepancyButtonListeners: () => this.#addDiscrepancyButtonListeners(),
      shouldContinue: () => this.isActive && this.shouldActivate(window.location.href)
    })
  }

  async activate() {
    // CSS injection is now handled by the table class
    this.isActive = true
    this.reset()
    await this.#clearStaleCache()
    await this.#delay(1000)
    await this.#createLessonDiscrepanciesTable(false, 'activate')
    this.#setupJournalSaveMonitoring()
    this.#setupDialogObserver()
  }

  onDeactivate() {
    this.isActive = false
    this.#cleanupMonitoring()
    this.reset()
    styleService.removeCSS('lesson-discrepancies-styles')
    document.querySelectorAll('[data-oa2-entry-id]').forEach(el => el.removeAttribute('data-oa2-entry-id'))
    super.onDeactivate()
  }

  reset() {
    this.#tableCreated = false
    this.#currentJournalId = null
    this.#cleanupMonitoring()
    document.querySelector('[data-discrepancies-table]')?.remove()
  }

  #delay = ms => new Promise(resolve => setTimeout(resolve, ms))

  #formatDate = date => {
    try {
      // Handle null, undefined, or empty values
      if (!date) {
        return null
      }
      return new Date(date).toISOString().split('T')[0]
    } catch {
      return null
    }
  }

  #formatDisplayDate = date => {
    // Handle null, undefined, or empty values
    if (!date) {
      return 'Invalid Date'
    }

    // If the date is already in DD.MM.YYYY format, return it as-is
    if (typeof date === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
      return date
    }

    let dateObj

    // If the date is in DD.MM.YYYY format, parse it manually
    if (typeof date === 'string' && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(date)) {
      const [day, month, year] = date.split('.')
      dateObj = new Date(year, month - 1, day)
    } else {
      // For other formats (ISO, etc.), use Date constructor
      dateObj = new Date(date)
    }

    // Check if the date is valid
    if (isNaN(dateObj.getTime())) {
      return 'Invalid Date'
    }

    const day = dateObj.getDate().toString().padStart(2, '0')
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
    const year = dateObj.getFullYear()
    return `${day}.${month}.${year}`
  }

  #isElementVisible = element => {
    if (!element) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0
  }

  #extractJournalId = () => {
    const match = window.location.href.match(/\/journal\/(\d+)/) || window.location.href.match(/journalId[=:](\d+)/i)
    return match ? parseInt(match[1], 10) : null
  }

  async #clearStaleCache() {
    const journalId = this.#extractJournalId()
    if (journalId) {
      await cacheService.clearJournalCache(journalId)
    }
  }

  async #createLessonDiscrepanciesTable(forceRefresh = false, trigger = 'unknown') {
    // Lock: only one refresh at a time, queue one extra if needed
    if (this.#refreshInProgress) {
      Logger.info(
        `[${this.name}] Refresh requested (trigger: ${trigger}, forceRefresh: ${forceRefresh}) but refresh is already in progress. Queueing one more.`
      )
      this.#refreshPending = true
      return
    }
    this.#refreshInProgress = true
    this.#refreshPending = false
    Logger.info(`[${this.name}] Starting refresh (trigger: ${trigger}, forceRefresh: ${forceRefresh})`)

    // Debounce: only allow one refresh per 750ms window
    const now = Date.now()
    if (this.#refreshDebounceTimer) {
      clearTimeout(this.#refreshDebounceTimer)
    }
    if (now - this.#lastRefreshTs < 750 && !forceRefresh) {
      Logger.info(`[${this.name}] Debouncing refresh (trigger: ${trigger})`)
      // Schedule a single refresh after debounce window
      this.#refreshDebounceTimer = setTimeout(
        () => {
          this.#createLessonDiscrepanciesTable(forceRefresh, 'debounce')
        },
        750 - (now - this.#lastRefreshTs)
      )
      this.#refreshInProgress = false
      return
    }
    this.#lastRefreshTs = now
    try {
      const journalId = this.#extractJournalId()
      if (!journalId) {
        this.#refreshInProgress = false
        return
      }

      const { journalData, timetableData } = await this.#fetchJournalAndTimetableData(journalId, forceRefresh)
      this.#lastJournalData = journalData

      const discrepancies = await this.#findLessonDiscrepancies(journalData, timetableData)
      const capacityProblems = await this.#getCapacityTypeProblems(journalData)

      // Verify we're still on the correct page before inserting the table
      if (!this.isActive || !this.shouldActivate(window.location.href)) {
        Logger.info(`[${this.name}] Feature deactivated or URL changed, skipping table insertion`)
        this.#refreshInProgress = false
        return
      }

      // Use the table class to create the table
      const success = await this.table.createTable({
        discrepancies,
        capacityProblems,
        forceRefresh
      })

      if (success) {
        this.#tableCreated = true
        this.#currentJournalId = journalId
      }
    } catch (error) {
      Logger.error(`[${this.name}] table error`, error)
    } finally {
      this.#refreshInProgress = false
      if (this.#refreshPending) {
        this.#refreshPending = false
        Logger.info(`[${this.name}] Running queued refresh after previous finished`)
        await this.#createLessonDiscrepanciesTable(true, 'queued')
      }
    }
  }

  async #fetchJournalAndTimetableData(journalId, forceRefresh = false) {
    const cacheExpiration = forceRefresh ? 0 : 6e4
    const cacheBuster = forceRefresh ? Date.now() : undefined
    const params = cacheBuster ? { _t: cacheBuster } : {}
    const entriesParams = { allStudents: true, ...params }

    const [info, entries] = await Promise.all([
      this.api.tahvel.get(`/journals/${journalId}`, params, {
        cache: true,
        cacheExpiration: 864e5
      }),
      this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, entriesParams, {
        cache: true,
        cacheExpiration
      })
    ])
    const schoolId = await getSchoolId(this.api, info)
    const timetable = await this.#fetchTimetableData(info, schoolId, forceRefresh)
    return {
      journalData: {
        info,
        entries: entries ?? [],
        schoolId
      },
      timetableData: timetable ?? []
    }
  }

  #getCurrentStudyYearDates() {
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(),
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    }
  }

  /**
   * @param {JournalInfo} info - Journal info object
   * @param {number} schoolId - School ID for timetable endpoint
   * @param {boolean} forceRefresh - Whether to force refresh cache
   * @returns {Promise<Array<TimetableEvent>>} Timetable events
   */
  async #fetchTimetableData(info, schoolId, forceRefresh = false) {
    try {
      const teacherId = info.journalTeachers?.[0]?.id
      if (!teacherId || !schoolId) return []
      const { from: defaultFrom, thru: defaultThru } = this.#getCurrentStudyYearDates()
      const from = info.studyYearStartDate ?? defaultFrom
      const thru = info.studyYearEndDate ?? defaultThru
      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
      const isPastData = new Date(thru) < new Date()
      const baseCacheExpiration = isPastData ? 2592e6 : 864e5
      const cacheExpiration = forceRefresh ? 0 : baseCacheExpiration

      const params = forceRefresh ? { _t: Date.now() } : {}
      /** @type {{timetableEvents?: Array<TimetableEvent>}} */
      const data = await this.api.tahvel.get(endpoint, params, {
        cache: true,
        cacheExpiration
      })
      return data?.timetableEvents?.filter(event => event.journalId === info.id) ?? []
    } catch (error) {
      Logger.warning(`[${this.name}] timetable`, error.message)
      return []
    }
  }

  async #fetchLessonTimes(schoolId) {
    if (!schoolId) return []
    try {
      return await new Promise((resolve, reject) => {
        /** @type {any} */
        const message = { action: 'loadLessonTimes' }
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message))
          }
          if (response.error) {
            return reject(new Error(response.error))
          }
          resolve(response.data?.[schoolId] || [])
        })
      })
    } catch (error) {
      Logger.warning(`[${this.name}] times`, error.message)
      return []
    }
  }

  async #calculateLessonNumber(timeStart, schoolId) {
    const times = await this.#fetchLessonTimes(schoolId)
    if (!timeStart || !times.length) return 1

    const exactMatch = times.find(lesson => lesson.timeStart === timeStart)
    if (exactMatch) return exactMatch.number

    const targetTime = new Date(`1970-01-01T${timeStart}`).getTime()
    const timesWithMs = times.map(lesson => ({
      ...lesson,
      timeMs: new Date(`1970-01-01T${lesson.timeStart}`).getTime()
    }))

    return timesWithMs.reduce((closest, current) => {
      const currentDiff = Math.abs(current.timeMs - targetTime)
      const closestDiff = Math.abs(closest.timeMs - targetTime)
      return currentDiff < closestDiff ? current : closest
    }).number
  }

  #aggregateJournalEntries(entries) {
    return entries.reduce((aggregated, entry) => {
      if (!LessonDiscrepanciesFeature.JOURNAL_ENTRY_CONTACT_TYPES.includes(entry.entryType)) {
        return aggregated
      }

      const date = this.#formatDate(entry.entryDate)
      aggregated[date] ??= {
        count: 0,
        start: Infinity,
        entries: []
      }
      aggregated[date].count += entry.lessons ?? 1

      const startLessonNumber = Number(entry.startLessonNr ?? 1)
      aggregated[date].start = Math.min(aggregated[date].start, startLessonNumber)
      aggregated[date].entries.push(entry)
      return aggregated
    }, {})
  }

  async #aggregateTimetableEvents(events, schoolId) {
    const stats = {}
    for (const event of events) {
      const date = this.#formatDate(event.date)
      stats[date] ??= {
        count: 0,
        start: Infinity
      }

      const lessonNumber = await this.#calculateLessonNumber(event.timeStart, schoolId)
      const validLessonNumber = Number(lessonNumber)
      stats[date].count++
      stats[date].start = Math.min(stats[date].start, validLessonNumber)
    }
    return stats
  }

  async #findLessonDiscrepancies(journal, timetable) {
    const schoolId = journal.schoolId
    const journalStats = this.#aggregateJournalEntries(journal.entries)
    const timetableStats = await this.#aggregateTimetableEvents(timetable, schoolId)

    const allDates = [...new Set([...Object.keys(journalStats), ...Object.keys(timetableStats)])]

    const differences = allDates
      .map(date => {
        const journalData = journalStats[date] ?? {
          count: 0,
          start: Infinity,
          entries: []
        }
        const timetableData = timetableStats[date] ?? {
          count: 0,
          start: Infinity
        }
        const hasDifference = journalData.count !== timetableData.count || journalData.start !== timetableData.start

        return hasDifference
          ? {
              date,
              journal: journalData,
              timetable: timetableData
            }
          : null
      })
      .filter(Boolean)

    return this.#convertDifferencesToDiscrepancies(differences, journal, timetable)
  }

  async #convertDifferencesToDiscrepancies(differences, journal, timetable) {
    const discrepancies = []

    for (const difference of differences) {
      const { date, journal: journalData, timetable: timetableData } = difference
      const { count: journalCount, start: journalStart, entries } = journalData
      const { count: timetableCount, start: timetableStart } = timetableData
      const timetableEntries = timetable.filter(event => this.#formatDate(event.date) === date)

      if (!journalCount && timetableCount) {
        await this.#createMissingLessonDiscrepancies(
          {
            date,
            tEntries: timetableEntries
          },
          journal,
          discrepancies
        )
      } else if (journalCount && timetableCount) {
        await this.#createLessonMismatchDiscrepancies(
          {
            date,
            journalCount,
            journalStart,
            timetableCount,
            timetableStart,
            entries,
            tEntries: timetableEntries
          },
          journal,
          discrepancies
        )
      }
    }

    return discrepancies
  }

  async #createMissingLessonDiscrepancies({ date, tEntries }, journal, discrepancies) {
    // Do not create discrepancies for lessons that are strictly in the future.
    // Same-day missing lessons are allowed per AC.
    try {
      const today = new Date()
      const target = new Date(date)
      // Normalize to year-month-day for comparison (local timezone)
      const isSameDay = target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth() && target.getDate() === today.getDate()
      const isFuture = !isSameDay && target.getTime() > today.setHours(23, 59, 59, 999)
      if (isFuture) {
        // Skip adding any discrepancies for future-only lessons
        return
      }
    } catch (err) {
      // If date parsing fails, continue normally (safer to show discrepancy)
      Logger.debug(`[${this.name}] date parsing error in #createMissingLessonDiscrepancies:`, err)
    }
    const schoolId = journal.schoolId
    /** @type {Array<{date: string, timeStart: string, timeEnd: string, name: string, rooms: Array, lessonNumber: number, type: string}>} */
    const missingLessons = await Promise.all(
      tEntries.map(async entry => ({
        date,
        timeStart: entry.timeStart,
        timeEnd: entry.timeEnd,
        name: entry.nameEt || journal.info.nameEt,
        rooms: entry.rooms ?? [],
        lessonNumber: await this.#calculateLessonNumber(entry.timeStart, schoolId),
        type: 'missingJournalEntry'
      }))
    )

    if (missingLessons.length > 0) {
      const lessonNumbers = missingLessons.map(lesson => lesson.lessonNumber).sort((a, b) => a - b)
      const firstLesson = missingLessons.find(lesson => lesson.lessonNumber === Math.min(...lessonNumbers))
      const allRooms = [...new Set(missingLessons.flatMap(lesson => lesson.rooms ?? []))]

      discrepancies.push({
        ...firstLesson,
        lessonNumber: Math.min(...lessonNumbers),
        lessonCount: missingLessons.length,
        lessonNumbers: lessonNumbers,
        rooms: allRooms,
        type: 'missingJournalEntry'
      })
    }
  }

  async #createLessonMismatchDiscrepancies(data, journal, discrepancies) {
    const [firstTimetableEntry] = data.tEntries
    if (!firstTimetableEntry) return

    const baseDiscrepancy = {
      date: data.date,
      timeStart: firstTimetableEntry.timeStart,
      timeEnd: firstTimetableEntry.timeEnd,
      name: firstTimetableEntry.nameEt || journal.info.nameEt,
      rooms: firstTimetableEntry.rooms ?? [],
      journalCount: data.journalCount,
      journalStart: data.journalStart,
      timetableCount: data.timetableCount,
      timetableStart: data.timetableStart
    }

    if (data.entries.length === 1) {
      discrepancies.push({
        ...baseDiscrepancy,
        type: 'singleEntryFix',
        entryId: data.entries[0].id,
        entries: data.entries
      })
    } else {
      discrepancies.push({
        ...baseDiscrepancy,
        type: 'multiEntryFix',
        entries: data.entries
      })
    }
  }

  #calculateDuplicateIndex(discrepancy) {
    // Use the same logic as #findJournalEntryElement to ensure consistency
    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] calculateDuplicateIndex called with:`, discrepancy)
    const duplicateInfo = this.#findDuplicateMatches(discrepancy.entryId, discrepancy.date)
    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] calculateDuplicateIndex result: targetIndex=${duplicateInfo.targetIndex}`)
    return duplicateInfo.targetIndex
  }

  #findDuplicateMatches(entryId, date) {
    if (!this.#lastJournalData?.entries) {
      Logger.warning(`No journal data available for findDuplicateMatches`)
      return {
        exactMatches: [],
        targetIndex: 0
      }
    }

    const targetEntry = this.#lastJournalData.entries.find(entry => entry.id == entryId)
    if (!targetEntry) {
      Logger.warning(`Target entry ${entryId} not found in journal data`)
      return {
        exactMatches: [],
        targetIndex: 0
      }
    }

    // Handle special case for null dates that show as "-"
    let dateSearchCriteria
    if (date === 'NO_DATE') {
      dateSearchCriteria = '-'
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Searching for null date entries (showing as "-")`)
    } else {
      dateSearchCriteria = this.#formatDisplayDate(date).slice(0, 5)
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Searching for date prefix: ${dateSearchCriteria}`)
    }

    // Try multiple selectors to find journal entry rows.
    // New page layout may render entries inside #entryTable or table.tahvel-table
    const rowSelectors = [
      'tr[ng-click*="editJournalEntry"]',
      'tr[onclick*="editJournalEntry"]',
      '#entryTable tr',
      'table.tahvel-table tr',
      'tr[ng-click], tr[onclick]'
    ]

    let allRows = []
    for (const sel of rowSelectors) {
      const nodes = document.querySelectorAll(sel)
      if (nodes && nodes.length > 0) {
        allRows = nodes
        break
      }
    }

    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Total rows found: ${allRows.length}`)

    // Filter rows based on date criteria
    let dateMatchingRows
    if (date === 'NO_DATE') {
      // For null dates, we need to be more precise - only get journal entry rows
      // that have a null date (shown as "-" in the date column)
      dateMatchingRows = [...allRows].filter(row => {
        // Check if this is a journal entry row with ng-click
        const hasEditJournalEntry = row.hasAttribute('ng-click') && row.getAttribute('ng-click').includes('editJournalEntry')
        if (!hasEditJournalEntry) return false

        // Check for a date cell containing only "-"
        const cells = row.querySelectorAll('td')
        for (const cell of cells) {
          const text = cell.textContent.trim()
          // The date column typically contains just "-" for null dates
          if (text === '-' && !cell.querySelector('a') && !cell.querySelector('button')) {
            return true
          }
        }
        return false
      })

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Found ${dateMatchingRows.length} journal entry rows with null date`)
    } else {
      dateMatchingRows = [...allRows].filter(row => row.textContent.includes(dateSearchCriteria))
    }

    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Found ${dateMatchingRows.length} rows matching date ${dateSearchCriteria}`)

    // Get the lesson count from targetEntry (could be lessons or lessonCount property)
    const targetLessonCount = targetEntry.lessons || targetEntry.lessonCount || 1

    // Filter by lesson count and type to get the exact matches in DOM order
    const exactMatches = dateMatchingRows.filter(row => {
      const { lessonCount, entryType } = this.#parseRowLessonInfo(row)
      return lessonCount === targetLessonCount && entryType === targetEntry.entryType
    })

    // We still need to calculate the target index even if there are no exact DOM matches
    // because this method is also used for calculating duplicate indices for button creation

    // Find all duplicate entries in API data, sorted by ID (for consistent ordering)
    // Handle null dates specially since they need to match by null status, not formatted value
    const duplicateEntries = this.#lastJournalData.entries.filter(entry => {
      // For null dates, both entries must have null/undefined entryDate
      const targetDateIsNull = !targetEntry.entryDate
      const entryDateIsNull = !entry.entryDate

      let dateMatches
      if (targetDateIsNull && entryDateIsNull) {
        // Both are null - they match
        dateMatches = true
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Both entries have null dates - match: ${entry.id}`)
      } else if (!targetDateIsNull && !entryDateIsNull) {
        // Both have dates - compare formatted dates
        dateMatches = this.#formatDate(entry.entryDate) === this.#formatDate(targetEntry.entryDate)
        if (Logger.isDebugMode())
          Logger.debug(
            `[${this.name}] Comparing formatted dates: ${this.#formatDate(entry.entryDate)} === ${this.#formatDate(targetEntry.entryDate)} = ${dateMatches}`
          )
      } else {
        // One is null, one isn't - no match
        dateMatches = false
        if (Logger.isDebugMode())
          Logger.debug(`[${this.name}] Date null mismatch: entry ${entry.id} has ${entry.entryDate}, target has ${targetEntry.entryDate}`)
      }

      // For independent work entries, both entries often have null lesson counts
      let lessonCountMatches
      if (entry.entryType === 'SISSEKANNE_I' && targetEntry.entryType === 'SISSEKANNE_I') {
        // For independent work, we don't compare lesson counts as they're often null
        lessonCountMatches = true
      } else {
        // For other types, compare lesson counts normally
        const entryLessonCount = entry.lessons || entry.lessonCount || null
        const targetLessonCountValue = targetEntry.lessons || targetEntry.lessonCount || targetLessonCount
        lessonCountMatches = entryLessonCount === targetLessonCountValue
      }

      const entryTypeMatches = entry.entryType === targetEntry.entryType

      if (Logger.isDebugMode())
        Logger.debug(
          `[${this.name}] Entry ${entry.id}: dateMatches=${dateMatches}, lessonCountMatches=${lessonCountMatches}, entryTypeMatches=${entryTypeMatches}, entryType=${entry.entryType}`
        )

      return dateMatches && lessonCountMatches && entryTypeMatches
    })
    // Don't sort by ID - keep the natural order from the journal data
    // which should match the DOM order

    // Simple position-based matching: assume DOM order matches API order
    const targetIndex = duplicateEntries.findIndex(entry => entry.id == entryId)

    // Attempt to find DOM rows that explicitly reference the entry id in their click handlers
    // (e.g. ng-click="editJournalEntry(12345)" or onclick="editJournalEntry(12345)")
    try {
      const idStr = String(entryId)
      const idMatchingRows = [...allRows].filter(row => {
        const ng = row.getAttribute('ng-click') || ''
        const on = row.getAttribute('onclick') || ''
        return ng.includes(idStr) || on.includes(idStr)
      })

      if (idMatchingRows.length > 0) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Found DOM rows referencing entry id ${idStr} directly: ${idMatchingRows.length}`)
        return {
          exactMatches: idMatchingRows,
          targetIndex: Math.max(0, targetIndex)
        }
      }
    } catch (e) {
      // Ignore and continue with existing heuristics
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] id-based DOM matching failed`, e)
    }

    if (Logger.isDebugMode()) {
      Logger.debug(`[${this.name}] Duplicate matching results:`)
      Logger.debug(`[${this.name}] - Target entry ID: ${entryId}`)
      Logger.debug(`[${this.name}] - Target entry date: ${targetEntry.entryDate}`)
      Logger.debug(`[${this.name}] - Target entry type: ${targetEntry.entryType}`)
      Logger.debug(`[${this.name}] - Duplicate entries found: ${duplicateEntries.length}`)
      Logger.debug(`[${this.name}] - Duplicate entry IDs: [${duplicateEntries.map(e => e.id).join(', ')}]`)
      Logger.debug(`[${this.name}] - Target index in duplicates: ${targetIndex}`)
      Logger.debug(`[${this.name}] - DOM exact matches found: ${exactMatches.length}`)
    }

    return {
      exactMatches,
      targetIndex: Math.max(0, targetIndex)
    }
  }

  #addDiscrepancyButtonListeners() {
    const buttons = document.querySelectorAll('[data-discrepancies-table] button')
    buttons.forEach(
      /** @param {HTMLElement} button */ button => {
        if (button.dataset.handler) {
          button.addEventListener('click', event => this.#handleDiscrepancyButtonClick(event, button))
        }
      }
    )
  }

  async #handleDiscrepancyButtonClick(event, button) {
    event.preventDefault()
    event.stopPropagation()
    if (button.disabled || this.#bulkAddInProgress) return

    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Button clicked - starting click handler`)
    if (Logger.isDebugMode())
      Logger.debug(`[${this.name}] Button element:`, {
        tagName: button.tagName,
        className: button.className,
        textContent: button.textContent,
        id: button.id,
        innerHTML: button.innerHTML.substring(0, 200) + (button.innerHTML.length > 200 ? '...' : '')
      })

    const originalState = this.#captureButtonState(button)
    this.#setButtonProcessingState(button)

    let data
    let isLisaButton = false
    let fadeTarget = null
    let fadeTable = null
    let restorePending = false
    try {
      data = this.#parseButtonData(button)
      isLisaButton = data.handler === 'addMissing'

      if (Logger.isDebugMode()) {
        Logger.debug(`[${this.name}] Raw button dataset:`, button.dataset)
        Logger.debug(`[${this.name}] Parsed button data:`, data)
        Logger.debug(
          `[${this.name}] Button data types:`,
          Object.entries(data).map(([key, value]) => [key, typeof value, value])
        )
      }

      // Special-case: duplicate "Muuda ... #1/#2" buttons should only open the
      // journal entry for manual editing. Do not perform any server-side fetch/PUT
      // for this exact UI case to avoid unintended API modifications.
      try {
        const text = (button.textContent || '').trim()
        if (data.handler === 'editEntry' && /^Muuda\s+#\d+$/i.test(text)) {
          Logger.info(`[${this.name}] Detected duplicate 'Muuda' button - opening entry instead of server-side edit`, { text, data })
          // Prefer entryId camelCase, fall back to lower-case dataset variant
          const entryId = data.entryId ?? data.entryid
          await this.#handleOpenEntry(entryId, data)
          // Early return: skip the normal execute flow (no API calls)
          return
        }
      } catch (err) {
        Logger.error(`[${this.name}] Error during duplicate Muuda short-circuit`, err)
      }

      // Fade out row or table for 'Lisa' button
      if (data.handler === 'addMissing') {
        fadeTarget = button.closest('tr')
        if (fadeTarget) {
          fadeTarget.classList.add('fade-up')
          // If this is the last row, fade out the table as well
          const tbody = fadeTarget.parentElement
          if (tbody && tbody.children.length === 1) {
            fadeTable = tbody.closest('table')
            if (fadeTable) fadeTable.classList.add('fade-up')
          }
        }
      }

      await this.#executeButtonAction(data, button)
      if (data.handler === 'addMissing') {
        Logger.debug(`[${this.name}] Lisa button clicked, waiting for table refresh...`)
        await this.#delay(1000)
        await this.#refreshTableWithRetry()
        restorePending = true
      }
    } catch (error) {
      Logger.error(`[${this.name}] button action error`, error)
      // On error, allow restore
      restorePending = true
    } finally {
      // The addAllMissing handler manages its own button lifecycle — do not restore
      if (data?.handler === 'addAllMissing') return

      if (isLisaButton && fadeTarget) {
        // Only restore when the row is actually removed from DOM
        const checkRowRemoved = () => {
          if (!fadeTarget.isConnected) {
            this.#restoreButtonState(button, originalState, isLisaButton)
          } else {
            setTimeout(checkRowRemoved, 200)
          }
        }
        if (restorePending) checkRowRemoved()
      } else {
        this.#restoreButtonState(button, originalState, isLisaButton)
      }
    }
  }

  #captureButtonState(button) {
    return {
      text: button.textContent,
      background: button.style.background,
      opacity: button.style.opacity,
      cursor: button.style.cursor
    }
  }

  #setButtonProcessingState(button) {
    button.disabled = true
    button.style.background = '#6c757d'
    button.style.opacity = '0.6'
    button.style.cursor = 'not-allowed'
  }

  #parseButtonData(button) {
    Logger.debug(`[${this.name}] Parsing button data from dataset:`, button.dataset)

    const parsedData = {}
    for (const [key, value] of Object.entries(button.dataset)) {
      // Only try to JSON.parse values that look like JSON (start with [ or {)
      if (value.startsWith('[') || value.startsWith('{')) {
        try {
          parsedData[key] = JSON.parse(value)
          Logger.debug(`[${this.name}] Successfully parsed ${key} as JSON:`, {
            originalValue: value,
            parsedValue: parsedData[key],
            type: typeof parsedData[key]
          })
        } catch (parseError) {
          Logger.error(`[${this.name}] Failed to parse button data key '${key}' with value '${value}':`, parseError)
          parsedData[key] = value // Fallback to original value
        }
      } else {
        // For simple values, try to convert numbers, otherwise keep as string
        const numValue = Number(value)
        if (!isNaN(numValue) && value !== '') {
          parsedData[key] = numValue
          Logger.debug(`[${this.name}] Converted ${key} to number:`, {
            originalValue: value,
            parsedValue: numValue,
            type: 'number'
          })
        } else {
          parsedData[key] = value
          Logger.debug(`[${this.name}] Kept ${key} as string:`, {
            originalValue: value,
            parsedValue: value,
            type: 'string'
          })
        }
      }
    }

    // Normalize common dataset key variants so callers can use either camelCase or
    // lowercase keys. The DiscrepanciesTable currently emits data attributes using
    // `data-${key.toLowerCase()}` which yields dataset keys like `entryid` and
    // `timetablestart`. Other code paths expect camelCase names like `entryId` or
    // `timetableStart`. Create aliases for the most common keys to avoid
    // undefined values at call sites.
    const aliasMap = {
      entryid: 'entryId',
      duplicateindex: 'duplicateIndex',
      startlesson: 'startLesson',
      timetablestart: 'timetableStart',
      timetablecount: 'timetableCount',
      currentstart: 'currentStart',
      currentcount: 'currentCount',
      lessoncount: 'lessonCount',
      timestart: 'timeStart',
      timeend: 'timeEnd'
    }

    for (const [lower, camel] of Object.entries(aliasMap)) {
      if (Object.prototype.hasOwnProperty.call(parsedData, lower) && parsedData[camel] === undefined) {
        parsedData[camel] = parsedData[lower]
      }
      if (Object.prototype.hasOwnProperty.call(parsedData, camel) && parsedData[lower] === undefined) {
        parsedData[lower] = parsedData[camel]
      }
    }

    Logger.debug(`[${this.name}] Final parsed button data:`, parsedData)
    return parsedData
  }

  async #executeButtonAction(data, button) {
    if (Logger.isDebugMode()) {
      Logger.debug(`[${this.name}] Executing button action with data:`, data)
      Logger.debug(`[${this.name}] Action data analysis:`, {
        handler: data.handler,
        date: data.date,
        dateType: typeof data.date,
        entryId: data.entryId,
        entryIdType: typeof data.entryId,
        allKeys: Object.keys(data),
        allValues: Object.values(data)
      })
    }

    const actionHandlers = {
      addMissing: () => {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Calling handleAddMissingEntry with:`, { date: data.date, startLesson: data.startLesson, lessonCount: data.lessonCount })
        return this.#handleAddMissingEntry(data.date, data.startLesson, data.lessonCount, data)
      },
      editEntry: () => {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Calling handleEditEntry with:`, { date: data.date, entryId: data.entryId, type: data.type })
        return this.#handleEditEntry(data.date, data.entryId, data.type, data)
      },
      fixCapacity: () => {
        if (Logger.isDebugMode()) {
          Logger.debug(`[${this.name}] Calling handleFixCapacity with:`, { date: data.date, entryId: data.entryId })
          Logger.debug(`[${this.name}] Date formatting test - input: ${data.date}, output: ${this.#formatDisplayDate(data.date)}`)
        }
        return this.#handleFixCapacity(data.date, data.entryId, data)
      },
      openEntry: () => {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Calling handleOpenEntry with:`, { entryId: data.entryId })
        return this.#handleOpenEntry(data.entryId, data)
      },
      addAllMissing: () => {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Calling handleAddAllMissingEntries`)
        return this.#handleAddAllMissingEntries(button)
      }
    }

    const handler = actionHandlers[data.handler]
    if (handler) {
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Handler found for '${data.handler}', executing...`)
      await handler()
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Handler '${data.handler}' completed`)
    } else {
      Logger.warning(`[${this.name}] Unknown handler: ${data.handler}`)
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Available handlers:`, Object.keys(actionHandlers))
    }
  }

  #restoreButtonState(button, originalState, isLisaButton = false) {
    const delayTime = isLisaButton ? 5000 : 2000
    setTimeout(() => {
      button.disabled = false
      button.textContent = originalState.text
      button.style.background = originalState.background
      button.style.opacity = originalState.opacity || ''
      button.style.cursor = originalState.cursor || ''
    }, delayTime)
  }

  async #handleAddMissingEntry(date, start, count, timetableData = {}) {
    // Show a confirmation overlay that previews what will be inserted and
    // Directly create the missing entry without showing confirmation.
    try {
      await this.#createMissingEntryDirect({ date, start, count, timetableData })
    } catch (err) {
      Logger.error(`[${this.name}] Error creating missing entry directly`, err)
    }
  }

  /**
   * Handles the "Lisa koik" (Add all) button click.
   * Collects all individual "Lisa" (addMissing) buttons from the DOM,
   * creates each missing entry sequentially, then reloads once.
   */
  async #handleAddAllMissingEntries(addAllButton) {
    if (this.#bulkAddInProgress) return
    this.#bulkAddInProgress = true

    try {
      const entries = this.table.lastMissingEntries || []
      if (entries.length === 0) {
        Logger.warning(`[${this.name}] No missing entries found for addAllMissing`)
        return
      }

      Logger.info(`[${this.name}] Adding all ${entries.length} missing entries`)

      // Disable all individual Lisa buttons during bulk operation
      const lisaButtons = document.querySelectorAll('[data-discrepancies-table] button[data-handler="addMissing"]')
      lisaButtons.forEach(btn => {
        btn.disabled = true
        btn.style.opacity = '0.6'
        btn.style.cursor = 'not-allowed'
      })
      let successCount = 0
      let failCount = 0

      for (let i = 0; i < entries.length; i++) {
        if (!this.isActive) {
          Logger.warning(`[${this.name}] Aborting bulk add - feature deactivated`)
          break
        }
        if (addAllButton) addAllButton.textContent = `Lisamine (${i + 1}/${entries.length})...`
        try {
          await this.#createMissingEntryDirect({
            date: entries[i].date,
            start: entries[i].lessonNumber,
            count: entries[i].lessonCount,
            timetableData: entries[i],
            skipReload: true
          })
          successCount++
        } catch (err) {
          failCount++
          Logger.error(`[${this.name}] Failed to add entry for ${entries[i].date}`, err)
        }
      }

      const journalId = this.#currentJournalId || this.#extractJournalId()
      if (journalId) {
        try {
          await cacheService.clearJournalCache(journalId)
        } catch (e) {
          Logger.warning('Failed to clear journal cache', e)
        }
      }

      Logger.info(`[${this.name}] Bulk add complete: ${successCount} succeeded, ${failCount} failed`)

      if (!this.isActive) return

      if (successCount === 0) {
        if (addAllButton) {
          addAllButton.textContent = 'Lisa kõik'
          addAllButton.disabled = false
          addAllButton.style.opacity = ''
          addAllButton.style.cursor = ''
        }
        lisaButtons.forEach(btn => {
          btn.disabled = false
          btn.style.opacity = ''
          btn.style.cursor = ''
        })
        return
      }

      if (failCount > 0) {
        if (addAllButton) addAllButton.textContent = `Lisatud: ${successCount}, ebaõnnestus: ${failCount}`
        await this.#delay(1000)
        await this.#refreshTableWithRetry()
        return
      }

      await this.#delay(400)
      window.location.reload()
    } finally {
      this.#bulkAddInProgress = false
    }
  }

  // Create and show a lightweight confirmation overlay. When user clicks
  // "Open form" the add-entry modal is opened and pre-filled via existing
  // helpers (#findAndClickAddButton and #fillAddForm).
  // Immediately create a missing journal entry (no confirmation UI).
  async #createMissingEntryDirect({ date, start, count, timetableData = {}, skipReload = false } = {}) {
    const journalId = this.#currentJournalId || this.#extractJournalId()
    if (!journalId) throw new Error('Journal ID puudub')

    const effectiveStart = timetableData.timetablestart ?? timetableData.timetableStart ?? start ?? 1
    const effectiveCount = timetableData.timetablecount ?? timetableData.timetableCount ?? count ?? 1
    const teacherId = this.#lastJournalData?.info?.journalTeachers?.[0]?.id

    const payload = {
      startLessonNr: Number(effectiveStart),
      lessons: Number(effectiveCount),
      entryType: LessonDiscrepanciesFeature.JOURNAL_ENTRY_DEFAULT_TYPE,
      nameEt: timetableData.name || this.#lastJournalData?.info?.nameEt || 'Tund',
      studyPeriodEvent: null,
      journalOmoduleTheme: null,
      entryDate: new Date(date).toISOString(),
      journalEntryStudents: [],
      journalEntryCapacityTypes: ['MAHT_a'],
      journalEntryTeachers: teacherId ? [String(teacherId)] : []
    }

    const url = `/journals/${journalId}/journalEntry`
    Logger.info(`[${this.name}] Creating missing journal entry (direct)`, { url, payload })

    try {
      const res = await this.api.tahvel.post(url, payload)

      if (skipReload) return res

      try {
        await cacheService.clearJournalCache(journalId)
      } catch (e) {
        Logger.warn('Failed to clear journal cache', e)
      }

      // Show success message overlay and wait for it to be dismissed before refreshing
      let overlay = null
      try {
        overlay = await this.#safeNotify({ title: 'Sissekanne lisatud', message: 'Uus sissekanne on loodud.', duration: 3500 })
      } catch (e) {
        Logger.debug('safeNotify failed', e)
      }

      // Give backend a short moment before attempting to refresh
      await this.#delay(400)

      // If overlay exists, wait for it to be removed (user clicks OK or it auto-dismisses)
      if (overlay) {
        try {
          await this.#waitForElementRemoval('#ra-overlay-message', 8000)
        } catch (waitErr) {
          Logger.debug(`[${this.name}] Overlay did not disappear within timeout`, waitErr)
        }
      }

      // Now attempt a full reload; fallback to table refresh
      try {
        Logger.info(`[${this.name}] Reloading page to show newly created entry`)
        window.location.reload()
      } catch (reloadErr) {
        Logger.warn(`[${this.name}] window.location.reload failed, falling back to table refresh`, reloadErr)
        try {
          await this.#refreshTableWithRetry()
        } catch (e) {
          Logger.warn('Failed to refresh table after create', e)
        }
      }

      return res
    } catch (err) {
      Logger.error(`[${this.name}] Failed to create missing journal entry`, err)
      try {
        await this.#safeNotify({ title: 'Viga', message: 'Sissekande loomine ebaõnnestus. Kontrolli konsooli.', duration: 5000 })
      } catch (e) {
        Logger.debug('safeNotify failed', e)
      }
      throw err
    }
  }

  async #waitForElementRemoval(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const check = () => {
        const exists = document.querySelector(selector)
        if (!exists) return resolve()
        if (Date.now() - start > timeout) return reject(new Error('element not removed within timeout'))
        setTimeout(check, 150)
      }
      check()
    })
  }

  // Non-blocking notification helper - logs and optionally shows a lightweight banner
  async #safeNotify({ title = 'Teade', message = '', duration = 3000 } = {}) {
    try {
      // Prefer centralized BannerService if available to avoid modal overlays
      if (window.raBannerService && typeof window.raBannerService.show === 'function') {
        try {
          return window.raBannerService.show({ title, message, duration })
        } catch (e) {
          Logger.debug(`${this.name} BannerService failed:`, e)
        }
      }

      // Fallback: log to console so nothing blocks UI
      Logger.info(`[${this.name}] ${title} - ${message}`)
      return null
    } catch (err) {
      Logger.debug(`[${this.name}] safeNotify error`, err)
      return null
    }
  }

  // ...existing code...

  /**
   * @param {string} date - Entry date
   * @param {string} entryId - Entry ID
   * @param {string} type - Entry type
   * @param {ButtonData} data - Button data object
   */
  async #handleEditEntry(date, entryId, type, data) {
    try {
      const actualEntryId = entryId || data.entryid
      const duplicateIndex = data.duplicateindex || 0
      // multiEntryFix buttons don't carry timetable data, so the extension lacks
      // the data to construct a meaningful PUT. Open the entry for manual editing instead.
      if (type === 'multiEntryFix') {
        return this.#handleOpenEntry(actualEntryId, data)
      }

      // Preferred flow: perform a server-side fetch -> modify -> PUT to update the entry
      const journalId = this.#currentJournalId || this.#extractJournalId()
      if (journalId && actualEntryId && this.api?.tahvel?.get && this.api?.tahvel?.put) {
        try {
          const detailUrl = `/journals/${journalId}/journalEntry/${actualEntryId}`
          Logger.info(`[${this.name}] Fetching current entry for server-side edit`, { detailUrl })
          const current = await this.api.tahvel.get(detailUrl, { allStudents: true }, { cache: false, cacheExpiration: 0 })

          if (!current) throw new Error('failed to fetch current entry')

          // Build a safe PUT payload by copying server object and applying minimal changes
          const putPayload = { ...current }

          // Apply changes if provided by the button data (timetable suggested values)
          // Only change startLessonNr, lessons and entryDate/nameEt when the parsed data differs
          if (this.#isValidValue(data.timetablestart) && Number(data.timetablestart) !== Number(current.startLessonNr)) {
            putPayload.startLessonNr = Number(data.timetablestart)
          }
          if (this.#isValidValue(data.timetablecount) && Number(data.timetablecount) !== Number(current.lessons)) {
            putPayload.lessons = Number(data.timetablecount)
          }

          // Normalize entryDate to ISO if date is provided
          if (date) {
            const iso = new Date(date).toISOString()
            if (iso !== current.entryDate) putPayload.entryDate = iso
          }

          // Ensure entryType stays correct (it should already), but keep nameEt consistent with timetable if available
          if (data.name) putPayload.nameEt = data.name

          // Normalize teacher ids: use current first teacher or the journal's first teacher
          const teacherIdFromJournal = this.#lastJournalData?.info?.journalTeachers?.[0]?.id
          if (!Array.isArray(putPayload.journalEntryTeachers) || putPayload.journalEntryTeachers.length === 0) {
            putPayload.journalEntryTeachers = teacherIdFromJournal ? [Number(teacherIdFromJournal)] : []
          } else {
            // Ensure teachers are numbers
            putPayload.journalEntryTeachers = putPayload.journalEntryTeachers.map(t => Number(t))
          }

          // Ensure capacity types are an array (don't introduce UI-only fields)
          if (!Array.isArray(putPayload.journalEntryCapacityTypes)) {
            putPayload.journalEntryCapacityTypes = putPayload.journalEntryCapacityTypes ? [putPayload.journalEntryCapacityTypes] : ['MAHT_a']
          }

          // Remove fields that are UI-only or could cause server errors
          delete putPayload.teacherSelection
          delete putPayload._links

          Logger.info(`[${this.name}] Sending PUT to update journal entry`, { url: detailUrl, payload: putPayload })

          try {
            const putRes = await this.api.tahvel.put(detailUrl, putPayload)
            try {
              await cacheService.clearJournalCache(journalId)
            } catch (e) {
              Logger.warn('Failed to clear journal cache', e)
            }
            try {
              await this.#refreshTableWithRetry()
            } catch (e) {
              Logger.warn('Failed to refresh table after PUT', e)
            }
            return putRes
          } catch (putErr) {
            // Try to extract response body for better diagnostics
            try {
              if (putErr?.response && typeof putErr.response.json === 'function') {
                const body = await putErr.response.json()
                Logger.error(`[${this.name}] PUT failed for entry ${actualEntryId} - response body:`, body)
              } else if (putErr?.response && typeof putErr.response.text === 'function') {
                const body = await putErr.response.text()
                Logger.error(`[${this.name}] PUT failed for entry ${actualEntryId} - response text:`, body)
              } else {
                Logger.error(`[${this.name}] PUT failed for entry ${actualEntryId}`, putErr)
              }
            } catch (bodyErr) {
              Logger.error(`[${this.name}] PUT failed and response body could not be read`, bodyErr)
            }

            // Fall through to UI modal fallback below
          }
        } catch (fetchErr) {
          Logger.error(`[${this.name}] Failed to prepare server-side edit for entry ${actualEntryId}`, fetchErr)
          // Fall through to UI modal fallback below
        }
      }

      // Fallback UX: open the edit modal and prefill fields if server-side flow is not possible or failed
      const element = await this.#findJournalEntryElement(actualEntryId, date, duplicateIndex)
      if (!element) {
        Logger.error(`[${this.name}] Entry element not found for ID=${actualEntryId}, date=${date}, duplicateIndex=${duplicateIndex}`)
        throw new Error('entry element not found')
      }

      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      await this.#fillEditForm(type, data)
    } catch (error) {
      Logger.error(`[${this.name}] edit entry error`, error)
    }
  }

  async #findAndClickAddButton() {
    const selectors = ['button[ng-click*="addEntry"]', 'button[ng-click*="lisa"]', '[aria-label*="Lisa sissekanne"]']

    for (const selector of selectors) {
      const button = document.querySelector(selector)
      if (button && this.#isElementVisible(button) && !button.closest('[data-discrepancies-table]')) {
        await this.#clickElement(button)
        return button
      }
    }

    // Fallback: search for button by visible text content (case-insensitive, Estonian)
    const allButtons = document.querySelectorAll('button,md-button,[role="button"]')
    const addButton = [...allButtons].find(
      button => /lisa.*sissekanne|add.*entry/i.test(button.textContent) && this.#isElementVisible(button) && !button.closest('[data-discrepancies-table]')
    )

    if (addButton) {
      await this.#clickElement(addButton)
      return addButton
    }

    Logger.warning(`[${this.name}] Lisa sissekanne button not found in DOM`)
    return null
  }

  async #fillAddForm(date, start, count, timetableData) {
    const formattedDate = this.#formatDisplayDate(date)
    const effectiveStart = timetableData.timetablestart || timetableData.timetableStart || start
    const effectiveCount = timetableData.timetablecount || timetableData.timetableCount || count

    // Fill entry type (md-select)
    try {
      const entryTypeField = this.#findVisibleElement(['md-select[ng-model*="entryType"]'])
      if (entryTypeField) {
        await this.#selectMdSelectOption(entryTypeField, LessonDiscrepanciesFeature.JOURNAL_ENTRY_DEFAULT_TYPE)
      } else {
        Logger.warning(`[${this.name}] Entry type field not found`)
      }
    } catch (err) {
      Logger.error(`[${this.name}] Error setting entry type`, err)
    }

    // Fill date input
    try {
      const dateField = this.#findVisibleElement(['md-datepicker input'])
      if (dateField) {
        await this.#fillInputField(dateField, formattedDate)
      } else {
        Logger.warning(`[${this.name}] Date field not found`)
      }
    } catch (err) {
      Logger.error(`[${this.name}] Error setting date field`, err)
    }

    await Promise.all([
      this.#fillStartLessonField(String(effectiveStart)),
      this.#fillLessonCountField(String(effectiveCount)),
      this.#checkAuditoriumLearningCheckbox(),
      this.#checkTeacherCheckbox()
    ])

    // Add teacher checkbox change listeners for validation refresh
    this.#addTeacherCheckboxListeners()
  }

  async #fillEditForm(type, data) {
    try {
      if (type === 'singleEntryFix' || type === 'multiEntryFix') {
        // Both single and multi-entry fixes use the same form filling logic
        // Multi-entry just means multiple buttons are shown, but each operates on a single entry
        await this.#fillSingleEntryForm(data)
      } else {
        Logger.warning(`[${this.name}] Unknown edit form type: ${type}`)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error filling edit form:`, error)
    }
  }

  /**
   * @param {ButtonData} data - Form data object
   */
  async #fillSingleEntryForm(data) {
    const currentStart = data.currentstart
    const timetableStart = data.timetablestart
    const currentCount = data.currentcount
    const timetableCount = data.timetablecount

    if (this.#isValidValue(timetableStart) && currentStart !== timetableStart) {
      await this.#fillStartLessonField(String(timetableStart))
    }

    if (this.#isValidValue(timetableCount) && currentCount !== timetableCount) {
      await this.#fillLessonCountField(String(timetableCount))
    }
  }

  #isValidValue(value) {
    return value !== Infinity && value !== -Infinity && !isNaN(value) && value != null
  }

  #setFieldState(_field, _state) {
    // Visual highlighting disabled. Keep method to avoid breaking callers.
    return
  }

  async #fillFieldWithVisualFeedback(selectors, value, logName) {
    // Removed: visual feedback helper replaced by direct calls to lower-level helpers.
    // Kept as a placeholder to avoid breaking references during refactor (should be removed).
    const field = this.#findVisibleElement(selectors)
    if (!field) {
      Logger.warning(`[${this.name}] ${logName} field not found`)
      return false
    }

    if (field.tagName.toLowerCase() === 'md-select') {
      return await this.#selectMdSelectOption(field, value)
    }

    return await this.#fillInputField(field, value)
  }

  async #fillStartLessonField(value) {
    const selectors = ['md-select[aria-label*="Algustund"]', 'md-select[ng-model*="startLessonNr"]', '#select_89']
    const field = this.#findVisibleElement(selectors)
    if (!field) {
      Logger.warning(`[${this.name}] Start lesson field not found`)
      return false
    }
    return await this.#selectMdSelectOption(field, value)
  }

  async #fillLessonCountField(value) {
    const selectors = ['input[aria-label="lessons"]', 'input[ng-model*="lessons"]', '#input_69']
    const field = this.#findVisibleElement(selectors)
    if (!field) {
      Logger.warning(`[${this.name}] Lesson count field not found`)
      return false
    }
    return await this.#fillInputField(field, value)
  }

  async #fillInputField(field, value) {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  async #selectMdSelectOption(field, value) {
    field.click()
    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const contentId = await this.#getOrWaitForContentId(field)
    if (!contentId) return false

    const optionElement = await this.#waitForElement(`md-content[id="${contentId}"] md-option[value="${value}"]`).catch(() => null)
    if (!optionElement) return false

    optionElement.scrollIntoView()
    await this.#delay(200)
    optionElement.click()
    optionElement.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }

  async #getOrWaitForContentId(field) {
    const existingId = field.getAttribute('aria-owns')
    if (existingId) return existingId

    try {
      return await this.#waitForAttributeToAppear(field, 'aria-owns', 3000)
    } catch {
      return null
    }
  }

  async #waitForAttributeToAppear(element, attribute, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const attributeValue = element.getAttribute(attribute)
        if (attributeValue) {
          observer.disconnect()
          resolve(attributeValue)
        }
      })
      observer.observe(element, { attributes: true })

      setTimeout(() => {
        observer.disconnect()
        reject(new Error(`${attribute} attribute not found within ${timeout} milliseconds`))
      }, timeout)
    })
  }

  async #waitForElement(selector, timeout = 3000) {
    const existing = document.querySelector(selector)
    if (existing) return existing

    return new Promise((resolve, reject) => {
      let resolved = false

      const intervalId = setInterval(() => {
        const targetElement = document.querySelector(selector)
        if (targetElement && !resolved) {
          resolved = true
          clearInterval(intervalId)
          resolve(targetElement)
        }
      }, 100)

      setTimeout(() => {
        if (!resolved) {
          resolved = true
          clearInterval(intervalId)
          const finalElement = document.querySelector(selector)
          if (finalElement) {
            resolve(finalElement)
          } else {
            reject(new Error(`Element ${selector} not found within ${timeout / 1000} sec time limit`))
          }
        }
      }, timeout)
    })
  }

  async #clickElement(element, delay = 500) {
    await this.#clickElementWithScrollPreservation(element)
    await this.#delay(delay)
  }

  #createScrollPreservation() {
    const originalPosition = {
      x: window.scrollX || document.documentElement.scrollLeft,
      y: window.scrollY || document.documentElement.scrollTop
    }

    const restoreScroll = () => window.scrollTo(originalPosition.x, originalPosition.y)
    let scrollMonitorInterval = null

    const startScrollMonitoring = () => {
      scrollMonitorInterval = setInterval(() => {
        const currentX = window.scrollX || document.documentElement.scrollLeft
        const currentY = window.scrollY || document.documentElement.scrollTop
        if (currentX !== originalPosition.x || currentY !== originalPosition.y) {
          restoreScroll()
        }
      }, 10)
    }

    const stopScrollMonitoring = () => {
      if (scrollMonitorInterval) {
        clearInterval(scrollMonitorInterval)
        scrollMonitorInterval = null
      }
    }

    return {
      restoreScroll,
      startScrollMonitoring,
      stopScrollMonitoring
    }
  }

  async #clickElementWithScrollPreservation(element) {
    const { restoreScroll, startScrollMonitoring, stopScrollMonitoring } = this.#createScrollPreservation()

    try {
      startScrollMonitoring()
      const rect = element.getBoundingClientRect()
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      })

      element.dispatchEvent(clickEvent)
      await this.#delay(100)
    } finally {
      stopScrollMonitoring()
      restoreScroll()
    }
  }

  #findVisibleElement(selectors) {
    return selectors.map(selector => document.querySelector(selector)).find(element => this.#isElementVisible(element))
  }

  async #findJournalEntryElement(entryId, date, duplicateIndex = 0) {
    // New Tahvel (Angular): entries are columns, not rows. Match by column index.
    const headerLink = this.#findEntryInNewTahvel(entryId)
    if (headerLink) return headerLink

    // Old Tahvel (AngularJS): entries are rows with ng-click
    if (document.querySelector('tr[ng-click*="editJournalEntry"]')) {
      const annotatedRow = await this.#findEntryRowViaAngularScope(entryId)
      if (annotatedRow) return annotatedRow
    }

    const { exactMatches, targetIndex } = this.#findDuplicateMatches(entryId, date)

    Logger.debug(
      `[${this.name}] findJournalEntryElement: entryId=${entryId}, date=${date}, exactMatches.length=${exactMatches.length}, targetIndex=${targetIndex}`
    )

    if (exactMatches.length === 0) {
      // Broader fallback: try text-based search
      Logger.warning(`[${this.name}] No exact matches found, trying fallback search`)

      // For null dates, we need to find all independent work entries with "-" date
      // and use the position-based matching from the journal data
      if (date === 'NO_DATE' && this.#lastJournalData?.entries) {
        const targetEntry = this.#lastJournalData.entries.find(entry => entry.id == entryId)
        if (!targetEntry) {
          Logger.error(`[${this.name}] Target entry ${entryId} not found in journal data for fallback`)
          return null
        }

        // Find all null date entries of the same type in the journal data
        const nullDateEntries = this.#lastJournalData.entries
          .filter(entry => !entry.entryDate && entry.entryType === targetEntry.entryType)
          .sort((a, b) => a.id - b.id)

        const entryPositionInNullDates = nullDateEntries.findIndex(entry => entry.id == entryId)

        Logger.debug(`[${this.name}] Fallback: Found ${nullDateEntries.length} null date entries of type ${targetEntry.entryType}`)
        Logger.debug(`[${this.name}] Fallback: Target entry position in null dates: ${entryPositionInNullDates}`)

        // Find all rows with "-" date in the DOM - only look at journal entry rows
        const allRows = document.querySelectorAll('tr[ng-click*="editJournalEntry"]')
        if (allRows.length === 0) {
          Logger.error(`[${this.name}] No journal entry rows found in DOM`)
          return null
        }

        // Find all rows that match our criteria (null date + correct type)
        // Then use position-based matching
        const nullDateRows = [...allRows].filter(row => {
          // Check for date cell containing only "-"
          const cells = row.querySelectorAll('td')
          let hasNullDate = false
          let isCorrectEntryType = false

          // Check if this row has the background color for independent work entries
          const hasIndependentWorkBackground = row.style.background && row.style.background.includes('rgb(240, 244, 195)')

          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            const text = cell.textContent.trim()

            // The date column is typically the 3rd column (index 2)
            if (i === 2 && text === '-') {
              hasNullDate = true
            }

            // Check for entry type - for SISSEKANNE_I, we rely on background color
            if (targetEntry.entryType === 'SISSEKANNE_I') {
              isCorrectEntryType = hasIndependentWorkBackground
            } else if (targetEntry.entryType === 'SISSEKANNE_T' && i === 4) {
              // For lessons, check the type column
              const spanElement = cell.querySelector('span')
              if (spanElement && spanElement.textContent.trim() === 'Tund') {
                isCorrectEntryType = true
              }
            } else if (targetEntry.entryType === 'SISSEKANNE_P' && i === 4) {
              const spanElement = cell.querySelector('span')
              if (spanElement && spanElement.textContent.includes('Praktiline töö')) {
                isCorrectEntryType = true
              }
            }
          }

          const matches = hasNullDate && isCorrectEntryType
          if (matches) {
            Logger.debug(
              `[${this.name}] Fallback: Row matches - hasNullDate=${hasNullDate}, isCorrectEntryType=${isCorrectEntryType}, hasIndependentWorkBackground=${hasIndependentWorkBackground}`
            )
          }

          return matches
        })

        Logger.debug(`[${this.name}] Fallback: Found ${nullDateRows.length} DOM rows with "-" date and matching type`)

        if (entryPositionInNullDates >= 0 && entryPositionInNullDates < nullDateRows.length) {
          Logger.debug(`[${this.name}] Fallback: Using position-based match at index ${entryPositionInNullDates}`)
          return nullDateRows[entryPositionInNullDates]
        }
      }

      // Original fallback logic for non-null dates
      let dateSearchCriteria
      if (date === 'NO_DATE') {
        dateSearchCriteria = '-'
      } else {
        dateSearchCriteria = this.#formatDisplayDate(date).slice(0, 5)
      }

      const allRows = document.querySelectorAll(
        'tr[ng-click*="editJournalEntry"], tr[onclick*="editJournalEntry"], #entryTable tr, table.tahvel-table tr, tr[ng-click], tr[onclick]'
      )
      const dateMatchingRows = [...allRows].filter(row => row.textContent.includes(dateSearchCriteria))

      Logger.debug(`[${this.name}] Fallback found ${dateMatchingRows.length} rows matching date ${dateSearchCriteria}`)

      if (dateMatchingRows.length > 0) {
        // Use duplicateIndex if provided, otherwise first match
        const indexToUse = duplicateIndex < dateMatchingRows.length ? duplicateIndex : 0
        Logger.warning(`[${this.name}] Using fallback row at index ${indexToUse} for entryId ${entryId}`)
        return dateMatchingRows[indexToUse]
      }

      return null
    }

    if (exactMatches.length === 1) {
      Logger.debug(`[${this.name}] Single exact match found, returning it`)
      return exactMatches[0]
    }

    // Multiple matches - use the targetIndex from findDuplicateMatches
    Logger.debug(`[${this.name}] Multiple exact matches (${exactMatches.length}), using targetIndex ${targetIndex}`)
    Logger.debug(
      `[${this.name}] Available matches: ${exactMatches.map((match, idx) => `[${idx}]: ${match.tagName} with text="${match.textContent.slice(0, 50)}..."`).join(', ')}`
    )

    if (targetIndex < exactMatches.length) {
      Logger.debug(`[${this.name}] Returning match at index ${targetIndex}`)
      return exactMatches[targetIndex]
    }
    Logger.warning(`[${this.name}] Target index ${targetIndex} out of range, returning first match`)
    return exactMatches[0]
  }

  /**
   * New Tahvel (Angular): entries are table COLUMNS, not rows.
   * Header <th class="header-cell"> elements correspond 1:1 with API entries.
   * Find the column by matching the entry's index in the API data.
   */
  #findEntryInNewTahvel(entryId) {
    const headers = document.querySelectorAll('th.header-cell')
    if (headers.length === 0 || !this.#lastJournalData?.entries) return null

    const entries = this.#lastJournalData.entries

    if (headers.length !== entries.length) {
      Logger.warning(`[${this.name}] New Tahvel: header/entry count mismatch (${headers.length} headers, ${entries.length} entries) - skipping positional match`)
      return null
    }

    const entryIndex = entries.findIndex(e => String(e.id) === String(entryId))
    if (entryIndex < 0 || entryIndex >= headers.length) {
      Logger.debug(`[${this.name}] New Tahvel: entry ${entryId} at index ${entryIndex}, ${headers.length} headers`)
      return null
    }

    const th = headers[entryIndex]
    const link = th.querySelector('a')
    if (!link) {
      Logger.debug(`[${this.name}] New Tahvel: header at index ${entryIndex} has no <a> child: "${th.innerHTML.slice(0, 100)}"`)
      return null
    }

    // Verify the link actually relates to this journal entry (not an unrelated table)
    const href = link.getAttribute('href') || ''
    if (href && !href.includes(`${entryId}`)) {
      Logger.warning(`[${this.name}] New Tahvel: header link href "${href}" does not contain entryId ${entryId} - skipping`)
      return null
    }

    Logger.info(`[${this.name}] New Tahvel: found entry column at index ${entryIndex}`)
    return link
  }

  /**
   * Injects a page-context script to read Angular scopes and find the entry row by ID.
   * Content scripts can't access Angular directly (isolated world), so we inject a
   * <script> tag that runs in the main world, annotates rows, then read the result.
   */
  async #findEntryRowViaAngularScope(entryId) {
    try {
      const attrName = 'data-oa2-entry-id'
      const safeId = CSS.escape(String(entryId))
      // Check if rows are already annotated from a previous call
      const existing = document.querySelector(`tr[${attrName}="${safeId}"]`)
      if (existing && existing.isConnected) return existing

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          document.removeEventListener('oa2-rows-annotated', handler)
          reject(new Error('Timeout annotating rows'))
        }, 2000)
        const handler = () => {
          clearTimeout(timeout)
          document.removeEventListener('oa2-rows-annotated', handler)
          resolve()
        }
        document.addEventListener('oa2-rows-annotated', handler)

        const script = document.createElement('script')
        script.textContent = `(function(){
          try {
            if (typeof angular === 'undefined') { document.dispatchEvent(new Event('oa2-rows-annotated')); return; }
            document.querySelectorAll('[data-oa2-entry-id]').forEach(function(el) { el.removeAttribute('data-oa2-entry-id'); });
            document.querySelectorAll('tr[ng-click*="editJournalEntry"]').forEach(function(row) {
              try {
                var scope = angular.element(row).scope();
                if (!scope) return;
                var ngClick = row.getAttribute('ng-click') || '';
                var m = ngClick.match(/editJournalEntry\\((\\w+)/);
                var entry = m ? scope[m[1]] : (scope.row || scope.entry);
                if (entry && entry.id != null) row.setAttribute('data-oa2-entry-id', entry.id);
              } catch(e) {}
            });
          } catch(e) {}
          document.dispatchEvent(new Event('oa2-rows-annotated'));
        })();`
        try {
          document.head.appendChild(script)
          script.remove()
        } catch (injectErr) {
          Logger.warning(`[${this.name}] Script injection blocked (CSP?):`, injectErr)
          document.dispatchEvent(new Event('oa2-rows-annotated'))
        }
      })

      const row = document.querySelector(`tr[${attrName}="${safeId}"]`)
      if (row) {
        Logger.info(`[${this.name}] Found entry row via Angular scope for entryId=${entryId}`)
        return row
      }
      Logger.debug(`[${this.name}] Angular scope annotation did not find entryId=${entryId}`)
    } catch (err) {
      if (err.message?.includes('Timeout')) {
        Logger.warning(`[${this.name}] Angular scope matching timed out:`, err)
      } else {
        Logger.debug(`[${this.name}] Angular scope matching failed:`, err)
      }
    }
    return null
  }

  #parseRowLessonInfo(row) {
    const cells = row.querySelectorAll('td')
    let lessonCount = null
    let entryType = null

    // Check if this is actually a journal entry row (not a student row)
    const hasEditJournalEntry = row.hasAttribute('ng-click') && row.getAttribute('ng-click').includes('editJournalEntry')
    if (!hasEditJournalEntry) {
      // This is not a journal entry row, return null values
      return { lessonCount: null, entryType: null }
    }

    // For independent work entries, check the background color
    const hasIndependentWorkBackground = row.style.background && row.style.background.includes('rgb(240, 244, 195)')

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      const text = cell.textContent.trim()

      // Lesson count is typically in column 4 (index 3)
      if (i === 3) {
        if (/^\d+$/.test(text)) {
          lessonCount = parseInt(text)
        } else if (text === '-') {
          // For independent work, "-" means no lesson count
          lessonCount = null
        }
      }

      // Entry type is in column 5 (index 4)
      if (i === 4) {
        const spanElement = cell.querySelector('span')
        if (spanElement) {
          const spanText = spanElement.textContent.trim()
          if (spanText === 'Tund') {
            entryType = 'SISSEKANNE_T'
          } else if (spanText === 'Iseseisev töö' || hasIndependentWorkBackground) {
            entryType = 'SISSEKANNE_I'
          } else if (spanText === 'Praktiline töö') {
            entryType = 'SISSEKANNE_P'
          } else if (spanText === 'E-õpe') {
            entryType = 'SISSEKANNE_E'
          }
        }
      }
    }

    // Additional check for independent work based on background color
    if (!entryType && hasIndependentWorkBackground) {
      entryType = 'SISSEKANNE_I'
    }

    return {
      lessonCount,
      entryType
    }
  }

  async #clickJournalEntry(element) {
    // New Tahvel: <a> links navigate the SPA to the entry detail page.
    // No md-dialog will appear, so skip the dialog-waiting logic.
    if (element.tagName === 'A') {
      Logger.info(`[${this.name}] New Tahvel: clicking <a> link for SPA navigation`)
      await this.#clickElementWithScrollPreservation(element)
      return
    }

    const { restoreScroll, startScrollMonitoring, stopScrollMonitoring } = this.#createScrollPreservation()

    try {
      startScrollMonitoring()
      const dialogPromise = this.#waitForDialogToOpen()

      // First try: click the element directly
      await this.#clickElementWithScrollPreservation(element)
      await this.#delay(300)

      // Check if dialog opened
      let isFormOpen = await this.#isEditFormOpen()
      if (!isFormOpen) {
        await this.#performDoubleClick(element)
        await this.#delay(300)
        isFormOpen = await this.#isEditFormOpen()
      }

      // If still not open, try clicking a specific child element
      if (!isFormOpen) {
        const clickableChild = element.querySelector('[ng-click*="editJournalEntry"], [onclick*="editJournalEntry"], td, a')
        if (clickableChild && clickableChild !== element) {
          await this.#clickElementWithScrollPreservation(clickableChild)
          await this.#delay(300)
          isFormOpen = await this.#isEditFormOpen()
        }
      }

      // Final check and error handling
      if (!isFormOpen) {
        // Sometimes the dialog opens, but we don't detect it immediately
        await this.#delay(500)
        isFormOpen = await this.#isEditFormOpen()
      }

      if (!isFormOpen) {
        throw new Error('Edit form failed to open after all attempts')
      }

      try {
        await dialogPromise
      } catch (error) {
        Logger.error(`[${this.name}] Dialog failed to open:`, error.message)

        if (await this.#isEditFormOpen()) {
          return
        }

        throw new Error('edit form not open')
      }
    } finally {
      await this.#delay(100)
      stopScrollMonitoring()
      restoreScroll()
    }
  }

  async #performDoubleClick(element) {
    const rect = element.getBoundingClientRect()
    const doubleClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    })
    element.dispatchEvent(doubleClickEvent)
    await this.#delay(200)
  }

  async #waitForDialogToOpen(timeout = 15000) {
    return new Promise((resolve, reject) => {
      let observer = null

      const timeoutId = setTimeout(() => {
        if (observer) observer.disconnect()
        reject(new Error('Dialog open timeout'))
      }, timeout)

      observer = new MutationObserver(_mutations => {
        const algustundField = document.querySelector('md-select[aria-label*="Algustund"]')

        if (algustundField && this.#isElementVisible(algustundField)) {
          const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')

          if (dialog && this.#isElementVisible(dialog)) {
            clearTimeout(timeoutId)
            observer.disconnect()
            resolve(dialog)
          }
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true
      })

      const existingAlgustundField = document.querySelector('md-select[aria-label*="Algustund"]')
      if (existingAlgustundField && this.#isElementVisible(existingAlgustundField)) {
        const existingDialog = existingAlgustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
        if (existingDialog && this.#isElementVisible(existingDialog)) {
          clearTimeout(timeoutId)
          observer.disconnect()
          resolve(existingDialog)
        }
      }
    })
  }

  async #waitForDialogContentLoaded(timeout = 15000) {
    return new Promise((resolve, reject) => {
      let observer = null

      const timeoutId = setTimeout(() => {
        if (observer) observer.disconnect()
        reject(new Error('Dialog content load timeout'))
      }, timeout)

      const checkDialogReady = () => {
        const algustundField = document.querySelector('md-select[aria-label="Algustund"]')
        const lessonsField = document.querySelector('input[aria-label="lessons"]')

        if (algustundField && lessonsField && this.#isElementVisible(algustundField) && this.#isElementVisible(lessonsField)) {
          const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
          if (dialog && this.#isElementVisible(dialog)) {
            clearTimeout(timeoutId)
            if (observer) observer.disconnect()
            resolve(dialog)
            return true
          }
        }
        return false
      }

      if (checkDialogReady()) return

      observer = new MutationObserver(() => checkDialogReady())
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      })
    })
  }

  async #isEditFormOpen() {
    // Method 1: Check for "Algustund" field
    const algustundField = document.querySelector('md-select[aria-label*="Algustund"]')
    if (algustundField && this.#isElementVisible(algustundField)) {
      const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
      if (dialog && this.#isElementVisible(dialog)) {
        return true
      }
    }

    // Method 2: Check for any visible md-dialog
    const anyDialog = document.querySelector('md-dialog')
    if (anyDialog && this.#isElementVisible(anyDialog)) {
      // Check if it contains journal entry fields
      const hasJournalFields = anyDialog.querySelector('md-select[aria-label*="Algustund"], input[aria-label="lessons"], md-select[ng-model*="entryType"]')
      if (hasJournalFields) {
        return true
      }
    }

    // Method 3: Check for "lessons" field (another common field in journal entry forms)
    const lessonsField = document.querySelector('input[aria-label="lessons"]')
    if (lessonsField && this.#isElementVisible(lessonsField)) {
      const dialog = lessonsField.closest('md-dialog, .md-dialog, [role="dialog"]')
      if (dialog && this.#isElementVisible(dialog)) {
        return true
      }
    }

    return false
  }

  async #checkAuditoriumLearningCheckbox() {
    // Disabled: do not programmatically toggle auditorium capacity checkbox.
    // The selection should be performed manually by the user in the form.
    return false
  }

  async #checkTeacherCheckbox() {
    // Disabled: do not programmatically toggle teacher checkboxes.
    // Teachers should be selected manually in the add-entry form.
    return false
  }

  #getTeacherCheckboxState() {
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')
    const checkboxes = []
    let checkedCount = 0

    teacherCheckboxes.forEach(checkbox => {
      const checked = checkbox.getAttribute('aria-checked') === 'true'
      if (checked) checkedCount++

      checkboxes.push({
        element: checkbox,
        checked,
        label: checkbox.getAttribute('aria-label') || checkbox.textContent.trim()
      })
    })

    return {
      hasTeacher: checkedCount > 0,
      checkboxCount: teacherCheckboxes.length,
      checkedCount,
      checkboxes
    }
  }

  async #refreshTableWithRetry(maxRetries = 3) {
    this.maxRetries = maxRetries
    Logger.info(`[${this.name}] #refreshTableWithRetry called`)
    await this.#createLessonDiscrepanciesTable(true, 'refreshTableWithRetry')
  }
  #setupJournalSaveMonitoring() {
    if (this.#saveMonitoringSetup) return

    this.#setupJournalTableMonitoring()
    this.#setupJournalDialogSaveMonitoring()
    this.#saveMonitoringSetup = true
  }

  #setupJournalTableMonitoring() {
    const journalTable = document.querySelector('table.journalTable')
    if (journalTable) {
      const tableObserver = new MutationObserver(mutations => {
        if (this.#isRefreshing) return

        let hasTableChanges = false
        for (const mutation of mutations) {
          if (mutation.type === 'childList' && (mutation.removedNodes.length > 0 || mutation.addedNodes.length > 0)) {
            for (const node of [...mutation.removedNodes, ...mutation.addedNodes]) {
              if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'TR') {
                hasTableChanges = true
                break
              }
            }
          }
        }

        if (hasTableChanges) {
          setTimeout(() => this.#refreshTableWithRetry(), 1000)
        }
      })

      tableObserver.observe(journalTable, {
        childList: true,
        subtree: true
      })

      this.#tableObserver = tableObserver
    }
  }

  #setupJournalDialogSaveMonitoring() {
    // Only set up monitoring once and store original fetch
    if (!this.#originalFetch) {
      this.#originalFetch = window.fetch

      // Monitor for journal entry dialog saves by watching for PUT requests to journal entry endpoints
      window.fetch = async(...args) => {
        const response = await this.#originalFetch.apply(window, args)

        // Check if this is a PUT request to a journal entry endpoint
        const url = args[0]
        if (typeof url === 'string' && url.includes('/journalEntry/') && args[1]?.method === 'PUT') {
          // Extract journal ID from URL
          const journalIdMatch = url.match(/\/journals\/(\d+)\/journalEntry\//)
          if (journalIdMatch && parseInt(journalIdMatch[1]) === this.#currentJournalId) {
            // Wait a bit for the save to complete, then refresh validation
            setTimeout(async() => {
              await this.#refreshCapacityValidationAfterSave()
            }, 1500)
          }
        }

        return response
      }
    }
  }

  /**
   * Setup observer to monitor for journal entry dialogs being opened and auto-check teacher checkboxes
   */
  #setupDialogObserver() {
    // Dialog observer removed - no longer auto-checking teacher checkbox
    // Teacher validation is now handled in table/background validation
  }

  async #refreshCapacityValidationAfterSave() {
    try {
      // Check if we have a current journal ID
      if (!this.#currentJournalId) {
        return
      }

      // Clear journal cache to get fresh data
      await cacheService.clearJournalCache(this.#currentJournalId)

      // Fetch fresh journal data
      const { journalData } = await this.#fetchJournalAndTimetableData(this.#currentJournalId, true)

      // Re-run unified validation
      const _capacityProblems = await this.#getCapacityTypeProblems(journalData)

      // Instead of only updating capacity problems (which hides timetable discrepancies),
      // perform a full table refresh so both timetable discrepancies and capacity problems
      // are recalculated and displayed consistently.
      await this.#createLessonDiscrepanciesTable(true, 'refreshCapacityValidationAfterSave')
    } catch (error) {
      Logger.error(`[${this.name}] Error refreshing capacity validation:`, error)
    }
  }

  #cleanupMonitoring() {
    this.#tableObserver?.disconnect()
    this.#tableObserver = null

    this.#dialogObserver?.disconnect()
    this.#dialogObserver = null

    // Restore original fetch if we modified it
    if (this.#originalFetch) {
      window.fetch = this.#originalFetch
      this.#originalFetch = null
    }

    this.#saveMonitoringSetup = false
  }

  async #getCapacityTypeProblems(journalData) {
    try {
      // First check if there's a discrepancy between planned and used hours for "MAHT_a"
      const capacityHours = journalData.info?.lessonHours?.capacityHours || []
      const auditoorneCapacity = capacityHours.find(c => c.capacity === 'MAHT_a')

      // Log capacity type code mappings

      // Get detailed capacity validation results
      const validationResults = await this.#performDetailedCapacityValidation(journalData, auditoorneCapacity, capacityHours)

      // Return problematic entries
      const problematicEntries = validationResults.filter(result => !result.isValid)
      const enrichedProblematicEntries = problematicEntries.map(r => ({
        ...r.entry,
        validationResult: r
      }))

      // Store problematic entries for later access during fixing
      this.#problematicEntriesCache = enrichedProblematicEntries

      return enrichedProblematicEntries
    } catch (error) {
      Logger.error(`[${this.name}] capacity check error`, error)
      return []
    }
  }

  async #performDetailedCapacityValidation(journalData, auditoorneCapacity, capacityHours) {
    const entries = journalData.entries || []
    const journalId = journalData.info?.id

    // Filter entries by type with detailed logging
    const targetEntries = entries.filter(
      entry => entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P' || entry.entryType === 'SISSEKANNE_I'
    )

    // Verify string comparison logic

    if (targetEntries.length === 0) {
      return
    }

    // Fetch detailed data for each target entry
    const validationResults = await this.#validateEntriesWithDetailedData(journalId, targetEntries, capacityHours)

    // Log validation summary
    this.#logValidationSummary(validationResults, auditoorneCapacity)

    // Return validation results
    return validationResults
  }

  async #validateEntriesWithDetailedData(journalId, targetEntries, journalCapacityHours) {
    const validationResults = []

    for (const entry of targetEntries) {
      try {
        // Fetch detailed entry data from API
        const detailUrl = `/journals/${journalId}/journalEntry/${entry.id}`

        const detailedEntry = await this.api.tahvel.get(
          detailUrl,
          { allStudents: true },
          {
            cache: false,
            cacheExpiration: 0
          }
        )

        // Analyze journalEntryCapacityTypes structure
        const capacityTypes = detailedEntry.journalEntryCapacityTypes

        // Validate the entry
        const validationResult = this.#validateSingleEntry(entry, detailedEntry, capacityTypes, journalCapacityHours)
        validationResults.push(validationResult)
      } catch (error) {
        validationResults.push({
          entry,
          isValid: false,
          errorType: 'api_fetch_error',
          error: error.message,
          detailedData: null
        })
      }
    }

    return validationResults
  }

  #validateSingleEntry(entry, detailedEntry, capacityTypes, journalCapacityHours) {
    // Create a combined entry object with fallback for missing fields
    const combinedEntry = {
      ...entry,
      entryDate: entry.entryDate || detailedEntry.entryDate || detailedEntry.journalEntryDate || detailedEntry.date
    }

    // Check if entry requires independent work but journal doesn't have MAHT_i configured
    const journalHasIndependentWork = journalCapacityHours && journalCapacityHours.some(c => c.capacity === 'MAHT_i')

    if (entry.entryType === 'SISSEKANNE_I' && !journalHasIndependentWork) {
      return {
        entry: combinedEntry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'journal_missing_independent_work',
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true
        },
        expectedState: {
          auditoorne: false,
          iseseisev: true,
          praktiline: false,
          teacher: true,
          reasoning: 'Journal must have MAHT_i capacity configured for independent work entries'
        },
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Handle edge cases
    if (capacityTypes === null || capacityTypes === undefined) {
      return {
        entry: combinedEntry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'null_capacity_types',
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true
        },
        expectedState: {
          auditoorne: true,
          iseseisev: false,
          praktiline: false,
          teacher: true,
          reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe'
        }
      }
    }

    if (!Array.isArray(capacityTypes)) {
      return {
        entry: combinedEntry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'invalid_capacity_types_format',
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true
        },
        expectedState: {
          auditoorne: true,
          iseseisev: false,
          praktiline: false,
          teacher: true,
          reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe'
        }
      }
    }

    // Detect checkbox states using different methods

    // Method 1: Array.includes()
    const hasAuditoorneIncludes = capacityTypes.includes('MAHT_a')
    const hasiseseisevIncludes = capacityTypes.includes('MAHT_i')
    const hasPraktiliseIncludes = capacityTypes.includes('MAHT_p')

    // Teacher validation - check if any teachers are selected
    const hasTeacher = Array.isArray(detailedEntry?.journalEntryTeachers) && detailedEntry.journalEntryTeachers.length > 0

    // Using includes() as the primary method

    return this.#performBusinessLogicValidation(
      combinedEntry,
      detailedEntry,
      {
        auditoorne: hasAuditoorneIncludes,
        iseseisev: hasiseseisevIncludes,
        praktiline: hasPraktiliseIncludes,
        teacher: hasTeacher
      },
      capacityTypes
    )
  }

  #performBusinessLogicValidation(entry, detailedEntry, actualState, capacityTypes) {
    // Log the business rules

    // Determine expected state based on entry type
    const shouldHaveAuditoorne = entry.entryType === 'SISSEKANNE_T' // Only SISSEKANNE_T should have auditoorne
    const shouldHaveIseseisev = entry.entryType === 'SISSEKANNE_I'
    const shouldHavePraktiline = entry.entryType === 'SISSEKANNE_P'

    const expectedState = {
      auditoorne: shouldHaveAuditoorne,
      iseseisev: shouldHaveIseseisev,
      praktiline: shouldHavePraktiline,
      teacher: true, // All entries should have a teacher selected
      reasoning: shouldHaveAuditoorne
        ? `Entry type "${entry.entryType}" requires auditoorne õpe checkbox`
        : shouldHaveIseseisev
          ? `Entry type "${entry.entryType}" requires iseseisev õpe checkbox`
          : shouldHavePraktiline
            ? `Entry type "${entry.entryType}" requires praktiline töö checkbox`
            : `Entry type "${entry.entryType}" has specific checkbox requirements`
    }

    // Check for specific error condition: SISSEKANNE_T (Tund) without auditoorne õpe
    if (entry.entryType === 'SISSEKANNE_T' && !actualState.auditoorne) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'lesson_without_auditoorne',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: no teacher selected
    if (!actualState.teacher) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'no_teacher_selected',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: both checkboxes selected
    const hasBothCheckboxes = actualState.auditoorne && actualState.iseseisev
    if (hasBothCheckboxes) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'both_checkboxes_selected',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: SISSEKANNE_T (lesson) with MAHT_i (independent work)
    const isLessonWithIndependentWork = entry.entryType === 'SISSEKANNE_T' && actualState.iseseisev && !actualState.auditoorne
    if (isLessonWithIndependentWork) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'lesson_with_independent_work',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: SISSEKANNE_I (independent work) with MAHT_a (auditory learning)
    const isIndependentWorkWithAuditory = entry.entryType === 'SISSEKANNE_I' && actualState.auditoorne && !actualState.iseseisev
    if (isIndependentWorkWithAuditory) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'independent_work_with_auditory',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: SISSEKANNE_P (praktiline töö) without praktiline töö checkbox
    const isPraktiliseTooWithoutPraktiliseCheckbox = entry.entryType === 'SISSEKANNE_P' && !actualState.praktiline
    if (isPraktiliseTooWithoutPraktiliseCheckbox) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'praktiline_too_without_praktiline_checkbox',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Validate against expected state
    const auditoorneValid = actualState.auditoorne === expectedState.auditoorne
    const iseseisevValid = actualState.iseseisev === expectedState.iseseisev
    const praktiliseValid = actualState.praktiline === expectedState.praktiline
    const teacherValid = actualState.teacher === expectedState.teacher
    const isValid = auditoorneValid && iseseisevValid && praktiliseValid && teacherValid
    const validationResult = isValid ? 'pass' : 'fail'

    // Determine specific error type
    let errorType = null
    if (!isValid) {
      errorType = 'missing_required_checkbox'
      if (entry.entryType === 'SISSEKANNE_T') {
        errorType = 'missing_auditoorne_checkbox'
      } else if (entry.entryType === 'SISSEKANNE_P') {
        if (!praktiliseValid) {
          errorType = 'missing_praktiline_checkbox'
        } else {
          errorType = 'missing_auditoorne_checkbox'
        }
      } else if (entry.entryType === 'SISSEKANNE_I') {
        errorType = 'missing_iseseisev_checkbox'
      }
    }

    return {
      entry,
      detailedData: detailedEntry,
      isValid,
      errorType,
      actualState,
      expectedState,
      capacityTypes,
      validationResult
    }
  }

  #logValidationSummary(validationResults, auditoorneCapacity) {
    // Log detailed results for each entry

    // Log specific entry IDs that are failing each type of validation

    // Root cause analysis logging
    this.#logRootCauseAnalysis(validationResults, auditoorneCapacity)
  }

  #logRootCauseAnalysis(validationResults, _auditoorneCapacity) {
    // Investigate potential causes

    // a) Incorrect business logic
    const allEntriesFailed = validationResults.every(r => !r.isValid)
    if (allEntriesFailed && validationResults.length > 0) {
      Logger.warning('All entries failed validation - possible business logic error')
    }

    // b) Faulty API data parsing
    const hasValidCapacityTypes = validationResults.some(r => Array.isArray(r.capacityTypes) && r.capacityTypes.length > 0)
    if (!hasValidCapacityTypes) {
      Logger.warning('No valid capacity types found - possible API data parsing error')
    }

    // c) Wrong capacity type code
    const hasMAHT_a = validationResults.some(r => Array.isArray(r.capacityTypes) && r.capacityTypes.includes('MAHT_a'))
    if (!hasMAHT_a && hasValidCapacityTypes) {
      Logger.warning('No MAHT_a capacity type found - possible wrong capacity type code')
    }

    // d) Logic errors in boolean comparison
    const hasInconsistentDetection = validationResults.some(r => {
      if (!Array.isArray(r.capacityTypes)) return false
      const includesResult = r.capacityTypes.includes('MAHT_a')
      const indexOfResult = r.capacityTypes.indexOf('MAHT_a') !== -1
      return includesResult !== indexOfResult
    })
    if (hasInconsistentDetection) {
      Logger.warning('Inconsistent capacity type detection - possible logic error')
    }

    // e) Case sensitivity issues
    const uniqueCapacityTypes = new Set()
    validationResults.forEach(r => {
      if (Array.isArray(r.capacityTypes)) {
        r.capacityTypes.forEach(type => uniqueCapacityTypes.add(type))
      }
    })
  }

  // #createCapacityProblemRow method moved to DiscrepanciesTable class

  #highlightProblematicElements(elements, message = '', color = '#ff0000') {
    // Clean up any existing highlights first
    this.#cleanupHighlights()

    const highlights = []

    elements.forEach(element => {
      if (!element) return

      // Add border highlight directly to the element instead of creating an overlay
      element.style.border = `2px solid ${color}`
      element.style.boxShadow = `0 0 8px ${color}`
      element.dataset.capacityHighlight = 'true'

      highlights.push(element)
    })

    // Store original styles for restoration
    if (highlights.length > 0) {
      highlights.forEach(element => {
        if (!element.dataset.originalBorder) {
          element.dataset.originalBorder = element.style.border || ''
          element.dataset.originalBoxShadow = element.style.boxShadow || ''
        }
      })
    }

    // Add a message tooltip if provided
    if (message && highlights.length > 0) {
      const tooltip = document.createElement('div')
      tooltip.dataset.capacityHighlight = 'true'
      tooltip.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${color};
        color: white;
        padding: 12px 18px;
        border-radius: 8px;
        z-index: 10000;
        font-weight: bold;
        font-size: 14px;
        max-width: 350px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        border: 2px solid #ffffff;
        line-height: 1.4;
      `
      tooltip.textContent = message
      document.body.appendChild(tooltip)
    }

    // Auto-remove highlights after 15 seconds
    setTimeout(() => {
      this.#cleanupHighlights()
    }, 15000)

    return highlights
  }

  #findProblematicElementsForHighlighting(entryType, validationResult) {
    const elements = []

    // Find capacity type checkbox elements specifically
    const allCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"]')

    // Handle specific error types
    if (entryType === 'SISSEKANNE_T' && validationResult?.errorType === 'lesson_with_independent_work') {
      // Find and highlight both "Iseseisev õpe" (incorrectly checked) and "Praktiline töö" checkboxes
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (
          ariaLabel.includes('Iseseisev õpe') ||
          textContent.includes('Iseseisev õpe') ||
          ariaLabel.includes('Praktiline töö') ||
          textContent.includes('Praktiline töö')
        ) {
          elements.push(checkbox)
        }
      })
    } else if (entryType === 'SISSEKANNE_T' && validationResult?.errorType === 'lesson_without_auditoorne') {
      // Find and highlight only "Auditoorne õpe" checkbox (should be checked but isn't)
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
          elements.push(checkbox)
        }
      })
    } else if (entryType === 'SISSEKANNE_I' && validationResult?.errorType === 'independent_work_with_auditory') {
      // Find and highlight only "Auditoorne õpe" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
          elements.push(checkbox)
        }
      })
    } else if (validationResult?.errorType === 'both_checkboxes_selected') {
      // Highlight both "Auditoorne õpe" and "Iseseisev õpe" checkboxes only
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (
          ariaLabel.includes('Auditoorne õpe') ||
          textContent.includes('Auditoorne õpe') ||
          ariaLabel.includes('Iseseisev õpe') ||
          textContent.includes('Iseseisev õpe')
        ) {
          elements.push(checkbox)
        }
      })
    } else if (validationResult?.errorType === 'missing_auditoorne_checkbox') {
      // Find and highlight only "Auditoorne õpe" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
          elements.push(checkbox)
        }
      })
    } else if (validationResult?.errorType === 'missing_iseseisev_checkbox') {
      // Find and highlight only "Iseseisev õpe" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe')) {
          elements.push(checkbox)
        }
      })
    } else if (validationResult?.errorType === 'journal_missing_independent_work') {
      // For journal missing independent work, no specific checkbox highlighting needed
      // The issue is with journal configuration, not entry checkboxes
    } else if (validationResult?.errorType === 'praktiline_too_without_praktiline_checkbox') {
      // Find and highlight only "Praktiline töö" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö')) {
          elements.push(checkbox)
        }
      })
    } else if (validationResult?.errorType === 'missing_praktiline_checkbox') {
      // Find and highlight only "Praktiline töö" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö')) {
          elements.push(checkbox)
        }
      })
    }

    // Handle cases where we have entryType but no specific validation result
    else if (entryType && !validationResult?.errorType) {
      if (entryType === 'SISSEKANNE_T') {
        // For lesson entries, highlight "Auditoorne õpe" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
            elements.push(checkbox)
          }
        })
      } else if (entryType === 'SISSEKANNE_P') {
        // For practical work entries, highlight "Praktiline töö" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö')) {
            elements.push(checkbox)
          }
        })
      } else if (entryType === 'SISSEKANNE_I') {
        // For independent work entries, highlight "Iseseisev õpe" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe')) {
            elements.push(checkbox)
          }
        })
      }
    }

    // General fallback: if no elements found yet, highlight only the main capacity checkboxes
    if (elements.length === 0) {
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        // Look for any capacity-related checkboxes (including Praktiline töö)
        if (
          ariaLabel.includes('Auditoorne õpe') ||
          textContent.includes('Auditoorne õpe') ||
          ariaLabel.includes('Iseseisev õpe') ||
          textContent.includes('Iseseisev õpe') ||
          ariaLabel.includes('Praktiline töö') ||
          textContent.includes('Praktiline töö')
        ) {
          elements.push(checkbox)
        }
      })

      // If still no capacity checkboxes found, highlight ALL checkboxes for debugging
      if (elements.length === 0) {
        // Fall back to any checkbox with capacity-related ng-model or all checkboxes if none found
        const anyCapacityCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"], md-checkbox[ng-model*="capacityType"]')
        if (anyCapacityCheckboxes.length > 0) {
          anyCapacityCheckboxes.forEach(checkbox => {
            elements.push(checkbox)
          })
        } else {
          // Last resort: highlight all checkboxes
          document.querySelectorAll('md-checkbox').forEach(checkbox => {
            elements.push(checkbox)
          })
        }
      }
    }

    return [...new Set(elements)] // Remove duplicates
  }

  /**
   * @param {string} date - Entry date
   * @param {string} entryId - Entry ID
   * @param {ButtonData} data - Button data object
   */
  async #handleFixCapacity(date, entryId, data = {}) {
    Logger.debug(`[${this.name}] handleFixCapacity called with parameters:`, {
      date: date,
      dateType: typeof date,
      dateValue: date,
      entryId: entryId,
      entryIdType: typeof entryId,
      entryIdValue: entryId,
      data: data,
      dataKeys: Object.keys(data)
    })

    try {
      const actualEntryId = entryId || data.entryid
      const duplicateIndex = data.duplicateindex || 0

      Logger.debug(`[${this.name}] Processing parameters:`, {
        originalDate: date,
        originalEntryId: entryId,
        dataEntryId: data.entryid,
        actualEntryId: actualEntryId,
        duplicateIndex: duplicateIndex
      })

      // Test date formatting with detailed logging
      Logger.debug(`[${this.name}] Testing date formatting:`, {
        inputDate: date,
        inputType: typeof date,
        inputValue: date,
        isNull: date === null,
        isUndefined: date === undefined,
        isEmpty: date === '',
        isString: typeof date === 'string',
        stringLength: typeof date === 'string' ? date.length : 'N/A'
      })

      const formattedDate = this.#formatDisplayDate(date)
      Logger.debug(`[${this.name}] Date formatting result:`, {
        input: date,
        output: formattedDate,
        isInvalidDate: formattedDate === 'Invalid Date'
      })

      // Debug logging for entryId resolution
      Logger.debug(`[${this.name}] handleFixCapacity called with entryId=${entryId}, data.entryid=${data.entryid}, actualEntryId=${actualEntryId}`)

      // Try to refresh journal data if it's missing
      if (!this.#lastJournalData && this.#currentJournalId) {
        try {
          const { journalData } = await this.#fetchJournalAndTimetableData(this.#currentJournalId, true)
          this.#lastJournalData = journalData
        } catch (refreshError) {
          Logger.error(`[${this.name}] Failed to refresh journal data:`, refreshError)
        }
      }

      // Attempt server-side capacity fix first: fetch detailed entry and PUT modified payload
      try {
        const journalId = this.#currentJournalId || this.#extractJournalId()
        if (journalId && actualEntryId && this.api?.tahvel?.get && this.api?.tahvel?.put) {
          const detailUrl = `/journals/${journalId}/journalEntry/${actualEntryId}`
          // Fetch fresh detailed entry (no cache)
          const detailedEntry = await this.api.tahvel.get(detailUrl, { allStudents: true }, { cache: false, cacheExpiration: 0 })
          if (detailedEntry) {
            // Create a safe copy for PUT: copy server object and normalize important types
            const safeCopy = { ...detailedEntry }

            // Ensure capacity types is an array (copy to avoid mutating original)
            safeCopy.journalEntryCapacityTypes = Array.isArray(safeCopy.journalEntryCapacityTypes) ? safeCopy.journalEntryCapacityTypes.slice() : []

            // Normalize teacher IDs to strings and populate from teacherSelection or journal info when missing
            if (Array.isArray(safeCopy.journalEntryTeachers) && safeCopy.journalEntryTeachers.length > 0) {
              safeCopy.journalEntryTeachers = safeCopy.journalEntryTeachers.map(id => String(id))
            } else {
              // Try to populate from detailedEntry.teacherSelection first
              if (Array.isArray(detailedEntry.teacherSelection) && detailedEntry.teacherSelection.length > 0) {
                const sel = detailedEntry.teacherSelection[0]
                safeCopy.journalEntryTeachers = [String(sel.id)]
                // Preserve teacherSelection but ensure id is string
                safeCopy.teacherSelection = detailedEntry.teacherSelection.map(t => ({ ...t, id: String(t.id) }))
              } else if (this.#lastJournalData?.info?.journalTeachers && this.#lastJournalData.info.journalTeachers.length > 0) {
                const fallback = this.#lastJournalData.info.journalTeachers[0]
                safeCopy.journalEntryTeachers = [String(fallback.id)]
                safeCopy.teacherSelection = [{ id: String(fallback.id), displayName: fallback.displayName || fallback.name || '' }]
              } else {
                safeCopy.journalEntryTeachers = []
              }
            }

            // Ensure capacity types is an array (copy to avoid mutating original)
            safeCopy.journalEntryCapacityTypes = Array.isArray(safeCopy.journalEntryCapacityTypes) ? safeCopy.journalEntryCapacityTypes.slice() : []

            // Special case: if this is a lesson entry and auditoorne capacity is missing,
            // perform a focused server-side PUT to add MAHT_a and return early (no UI fallback).
            if (safeCopy.entryType === 'SISSEKANNE_T' && !safeCopy.journalEntryCapacityTypes.includes('MAHT_a')) {
              Logger.info(`[${this.name}] Detected lesson entry without auditoorne capacity - adding MAHT_a via API for entry ${actualEntryId}`)
              // Add MAHT_a while keeping uniqueness
              safeCopy.journalEntryCapacityTypes = Array.from(new Set([...(safeCopy.journalEntryCapacityTypes || []), 'MAHT_a']))

              // Remove UI-only fields that might cause server errors
              delete safeCopy._links
              delete safeCopy.journalStudent

              try {
                Logger.debug(`[${this.name}] Performing focused PUT to add MAHT_a for entry ${actualEntryId}`, safeCopy)
                const putRes = await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${actualEntryId}`, safeCopy)
                Logger.debug(`[${this.name}] Focused PUT response for entry ${actualEntryId}:`, putRes)

                try {
                  await cacheService.clearJournalCache(journalId)
                } catch (cErr) {
                  Logger.debug(`[${this.name}] cache clear error after focused PUT:`, cErr)
                }
                try {
                  const { journalData } = await this.#fetchJournalAndTimetableData(journalId, true)
                  this.#lastJournalData = journalData
                } catch (e) {
                  Logger.debug(`[${this.name}] refresh after focused PUT failed:`, e)
                }
                await this.#refreshTableWithRetry()

                // Done - server-side fix applied. Exit without opening UI fallback.
                return
              } catch (putErrFocused) {
                // Try to extract response body for diagnostics and show user message but do NOT open UI fallback
                try {
                  if (putErrFocused?.response && typeof putErrFocused.response.json === 'function') {
                    const body = await putErrFocused.response.json()
                    Logger.error(`[${this.name}] Focused PUT failed for entry ${actualEntryId} - response body:`, body)
                  } else if (putErrFocused?.response && typeof putErrFocused.response.text === 'function') {
                    const body = await putErrFocused.response.text()
                    Logger.error(`[${this.name}] Focused PUT failed for entry ${actualEntryId} - response text:`, body)
                  } else {
                    Logger.error(`[${this.name}] Focused PUT failed for entry ${actualEntryId}:`, putErrFocused)
                  }
                } catch (bodyErr) {
                  Logger.error(`[${this.name}] Focused PUT failed and response body could not be read`, bodyErr)
                }

                try {
                  await this.#safeNotify({
                    title: 'Parandus ebaõnnestus',
                    message: 'Server ei suutnud automaatselt auditoorset õpet lisada. Palun parandage sissekanne käsitsi.',
                    duration: 7000
                  })
                } catch (e) {
                  Logger.debug(`[${this.name}] safeNotify failed:`, e)
                }

                // Do not continue to UI fallback - return after informing the user
                return
              }
            }

            // Special case: if this is a practical-work entry and praktiline capacity is missing,
            // perform a focused server-side PUT to add MAHT_p and return early (no UI fallback).
            if (safeCopy.entryType === 'SISSEKANNE_P' && !safeCopy.journalEntryCapacityTypes.includes('MAHT_p')) {
              Logger.info(`[${this.name}] Detected practical-work entry without praktiline capacity - adding MAHT_p via API for entry ${actualEntryId}`)
              // Add MAHT_p while keeping uniqueness
              safeCopy.journalEntryCapacityTypes = Array.from(new Set([...(safeCopy.journalEntryCapacityTypes || []), 'MAHT_p']))

              // Ensure we have at least one teacher id string present (server examples use strings)
              if (!Array.isArray(safeCopy.journalEntryTeachers) || safeCopy.journalEntryTeachers.length === 0) {
                if (Array.isArray(detailedEntry.teacherSelection) && detailedEntry.teacherSelection.length > 0) {
                  safeCopy.journalEntryTeachers = [String(detailedEntry.teacherSelection[0].id)]
                } else if (this.#lastJournalData?.info?.journalTeachers && this.#lastJournalData.info.journalTeachers.length > 0) {
                  safeCopy.journalEntryTeachers = [String(this.#lastJournalData.info.journalTeachers[0].id)]
                } else {
                  safeCopy.journalEntryTeachers = []
                }
              } else {
                safeCopy.journalEntryTeachers = safeCopy.journalEntryTeachers.map(id => String(id))
              }

              // Remove UI-only fields that might cause server errors
              delete safeCopy._links
              delete safeCopy.journalStudent

              try {
                Logger.debug(`[${this.name}] Performing focused PUT to add MAHT_p for entry ${actualEntryId}`, safeCopy)
                const putRes = await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${actualEntryId}`, safeCopy)
                Logger.debug(`[${this.name}] Focused PUT response for practical entry ${actualEntryId}:`, putRes)

                try {
                  await cacheService.clearJournalCache(journalId)
                } catch (cErr) {
                  Logger.debug(`[${this.name}] cache clear error after focused PUT:`, cErr)
                }
                try {
                  const { journalData } = await this.#fetchJournalAndTimetableData(journalId, true)
                  this.#lastJournalData = journalData
                } catch (e) {
                  Logger.debug(`[${this.name}] refresh after focused PUT failed:`, e)
                }
                await this.#refreshTableWithRetry()

                // Done - server-side fix applied. Exit without opening UI fallback.
                return
              } catch (putErrFocused) {
                // Diagnostics similar to lesson-focused path
                try {
                  if (putErrFocused?.response && typeof putErrFocused.response.json === 'function') {
                    const body = await putErrFocused.response.json()
                    Logger.error(`[${this.name}] Focused PUT failed for practical entry ${actualEntryId} - response body:`, body)
                  } else if (putErrFocused?.response && typeof putErrFocused.response.text === 'function') {
                    const body = await putErrFocused.response.text()
                    Logger.error(`[${this.name}] Focused PUT failed for practical entry ${actualEntryId} - response text:`, body)
                  } else {
                    Logger.error(`[${this.name}] Focused PUT failed for practical entry ${actualEntryId}:`, putErrFocused)
                  }
                } catch (bodyErr) {
                  Logger.error(`[${this.name}] Focused PUT failed and response body could not be read`, bodyErr)
                }

                try {
                  await this.#safeNotify({
                    title: 'Parandus ebaõnnestus',
                    message: 'Server ei suutnud automaatselt praktilist tööd lisada. Palun parandage sissekanne käsitsi.',
                    duration: 7000
                  })
                } catch (e) {
                  Logger.debug(`[${this.name}] safeNotify failed:`, e)
                }

                // Do not continue to UI fallback - return after informing the user
                return
              }
            }

            // Business rule: if both MAHT_a and MAHT_i present for a lesson entry, remove MAHT_i (auditoorne wins)
            if (
              safeCopy.entryType === 'SISSEKANNE_T' &&
              safeCopy.journalEntryCapacityTypes.includes('MAHT_a') &&
              safeCopy.journalEntryCapacityTypes.includes('MAHT_i')
            ) {
              Logger.info(`[${this.name}] Normalizing capacity types for entry ${actualEntryId}: removing MAHT_i since MAHT_a is present`)
              safeCopy.journalEntryCapacityTypes = safeCopy.journalEntryCapacityTypes.filter(t => t !== 'MAHT_i')
            }

            // For independent work entries, ensure MAHT_i is present; remove MAHT_a if present
            if (safeCopy.entryType === 'SISSEKANNE_I') {
              const has_i = safeCopy.journalEntryCapacityTypes.includes('MAHT_i')
              if (!has_i) {
                Logger.info(`[${this.name}] Adding MAHT_i for independent work entry ${actualEntryId}`)
                safeCopy.journalEntryCapacityTypes = safeCopy.journalEntryCapacityTypes.filter(t => t !== 'MAHT_a')
                safeCopy.journalEntryCapacityTypes.push('MAHT_i')
              }
            }

            // Remove other UI-only fields that are not needed or may cause server errors
            delete safeCopy._links
            delete safeCopy.journalStudent

            // If there is any change compared to server copy, perform PUT
            const needsPut = JSON.stringify(safeCopy) !== JSON.stringify(detailedEntry)
            if (needsPut) {
              try {
                Logger.debug(`[${this.name}] Performing PUT for entry ${actualEntryId} with payload:`, safeCopy)
                const putRes = await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${actualEntryId}`, safeCopy)
                Logger.debug(`[${this.name}] PUT response for normalized entry ${actualEntryId}:`, putRes)

                // Clear cache and refresh local journal data
                try {
                  await cacheService.clearJournalCache(journalId)
                } catch (cErr) {
                  Logger.debug(`[${this.name}] cache clear error after PUT:`, cErr)
                }

                // Re-fetch journal data to reflect changes
                try {
                  const { journalData } = await this.#fetchJournalAndTimetableData(journalId, true)
                  this.#lastJournalData = journalData
                } catch (reErr) {
                  Logger.debug(`[${this.name}] failed to refresh journal data after PUT:`, reErr)
                }

                // Refresh the discrepancies display
                await this.#refreshTableWithRetry()

                // Server-side fix applied; refresh display and exit early.
                // Note: UI success overlay removed per user preference.
                return
              } catch (putErr) {
                // Try to extract response body for diagnostics
                try {
                  if (putErr?.response && typeof putErr.response.json === 'function') {
                    const body = await putErr.response.json()
                    Logger.error(`[${this.name}] Failed to PUT normalized entry ${actualEntryId} - response body:`, body)
                  } else if (putErr?.response && typeof putErr.response.text === 'function') {
                    const body = await putErr.response.text()
                    Logger.error(`[${this.name}] Failed to PUT normalized entry ${actualEntryId} - response text:`, body)
                  } else {
                    Logger.error(`[${this.name}] Failed to PUT normalized entry ${actualEntryId}:`, putErr)
                  }
                } catch (bodyErr) {
                  Logger.error(`[${this.name}] PUT failed and response body could not be read`, bodyErr)
                }

                // Fall through to UI-based flow as a fallback
              }
            } else {
              Logger.debug(`[${this.name}] No normalization needed for entry ${actualEntryId}; skipping server PUT`)
            }
          }
        }
      } catch (srvErr) {
        Logger.debug(`[${this.name}] Server-side fix attempt failed:`, srvErr)
        // Continue to fallback UI flow
      }

      const element = await this.#findJournalEntryElement(actualEntryId, date, duplicateIndex)
      if (!element) {
        // Enhanced error logging
        const debugInfo = {
          entryId,
          actualEntryId,
          date,
          duplicateIndex,
          formattedDate: this.#formatDisplayDate(date),
          datePrefix: this.#formatDisplayDate(date).slice(0, 5),
          hasJournalData: !!this.#lastJournalData,
          entriesInCache: this.#lastJournalData?.entries?.length || 0,
          targetEntryExists: !!(this.#lastJournalData?.entries ?? []).find(entry => entry.id == actualEntryId),
          rowsFound: document.querySelectorAll('tr[ng-click*="editJournalEntry"]').length,
          clickableRowsFound: document.querySelectorAll('tr[ng-click*="editJournalEntry"], tr[onclick*="editJournalEntry"]').length,
          allTableRows: document.querySelectorAll('tr').length
        }

        Logger.error(`[${this.name}] Entry element not found for ID=${actualEntryId}, date=${date}, duplicateIndex=${duplicateIndex}`, debugInfo)

        // Show user-friendly error message
        alert(`Viga: Ei suutnud leida õiget sissekande rida (ID: ${actualEntryId}). Palun proovige lehte värskendada ja uuesti.`)

        throw new Error(`entry element not found - entryId: ${entryId}, actualEntryId: ${actualEntryId}, date: ${date}, duplicateIndex: ${duplicateIndex}`)
      }

      return this.#continueFixCapacity(element, actualEntryId, date)
    } catch (error) {
      Logger.error(`[${this.name}] fix capacity error`, error)
    }
  }

  async #continueFixCapacity(element, entryId, _date) {
    try {
      // Get the entry to determine its type and validation result for highlighting
      let entryData = null
      let validationResult = null

      // First try to get from cached problematic entries (this is the most reliable source)
      if (this.#problematicEntriesCache) {
        const cachedEntry = this.#problematicEntriesCache.find(e => e.id == entryId)
        if (cachedEntry) {
          entryData = cachedEntry
          validationResult = cachedEntry.validationResult
        }
      }

      // Fallback to journal data if not found in problematic entries cache
      if (!entryData && this.#lastJournalData?.entries) {
        entryData = this.#lastJournalData.entries.find(e => e.id == entryId)
        if (entryData) {
          // Note: validationResult will be null in this case
        }
      }

      const entryType = entryData?.entryType

      // Prepare highlight message
      let highlightMessage
      if (validationResult?.errorType === 'no_teacher_selected') {
        highlightMessage = 'Õpetaja pole valitud! Palun valige õpetaja.'
      } else if (validationResult?.errorType === 'lesson_with_independent_work') {
        highlightMessage = 'Sissekande liik on tund, aga ainult iseseiseva õppe linnuke on sees. Palun eemalda iseseisev õpe ja märgi auditoorne õpe!'
      } else if (validationResult?.errorType === 'lesson_without_auditoorne') {
        highlightMessage = 'Sissekande liik on tund, aga auditoorne õpe linnuke pole sees. Palun lülita auditoorne õpe sisse!'
      } else if (validationResult?.errorType === 'independent_work_with_auditory') {
        highlightMessage = 'Iseseisev tööl ei saa olla auditoorne õpe linnuke sees. Palun eemalda vale linnuke!'
      } else if (validationResult?.errorType === 'both_checkboxes_selected') {
        highlightMessage = 'Korraga ei saa auditoorne õpe ja individuaalne õpe aktiivsed olla. Palun eemalda üks linnuke!'
      } else if (validationResult?.errorType === 'praktiline_too_without_praktiline_checkbox') {
        highlightMessage = 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees. Palun lülita praktiline töö sisse!'
      } else if (validationResult?.errorType === 'missing_auditoorne_checkbox') {
        highlightMessage = 'Auditoorne õpe linnuke puudub. Palun lülita see sisse!'
      } else if (validationResult?.errorType === 'missing_iseseisev_checkbox') {
        highlightMessage = 'Iseseisev õpe linnuke puudub. Palun lülita see sisse!'
      } else if (validationResult?.errorType === 'journal_missing_independent_work') {
        highlightMessage = 'Vigane sissekanne: päevikule pole määratud iseisevaid töid. Kontrolli päeviku seadistusi!'
      } else if (validationResult?.errorType === 'missing_praktiline_checkbox') {
        highlightMessage = 'Praktiline töö linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_T') {
        // Default message for lesson entries
        highlightMessage = 'Auditoorne õpe linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_P') {
        // Default message for practical work entries
        highlightMessage = 'Praktiline töö linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_I') {
        // Default message for independent work entries
        highlightMessage = 'Iseseisev õpe linnuke puudub. Palun lülita see sisse!'
      } else {
        // Fallback message
        highlightMessage = 'Kontrollige auditoorse õppe ja iseseiseva õppe linnukesi!'
      }

      // Special handling for teacher validation issues: try server-side assignment BEFORE opening the dialog
      if (validationResult?.errorType === 'no_teacher_selected') {
        try {
          const journalId = this.#currentJournalId || this.#extractJournalId()
          if (journalId && entryId && this.api?.tahvel?.get && this.api?.tahvel?.put) {
            const detailUrl = `/journals/${journalId}/journalEntry/${entryId}`
            const detailedEntry = await this.api.tahvel.get(detailUrl, { allStudents: true }, { cache: false, cacheExpiration: 0 })

            if (detailedEntry) {
              // Determine teacher id to assign: prefer server-provided teacherSelection, then journal info
              let teacherId = null
              if (Array.isArray(detailedEntry.teacherSelection) && detailedEntry.teacherSelection.length > 0) {
                teacherId = detailedEntry.teacherSelection[0].id
              }
              if (!teacherId) {
                teacherId = this.#lastJournalData?.info?.journalTeachers?.[0]?.id
              }

              if (teacherId) {
                const safeCopy = { ...detailedEntry }
                // Find teacher object (prefer detailedEntry.teacherSelection, fallback to journal info)
                let teacherObj = null
                if (Array.isArray(detailedEntry.teacherSelection) && detailedEntry.teacherSelection.length > 0) {
                  teacherObj = detailedEntry.teacherSelection.find(t => Number(t.id) === Number(teacherId)) || detailedEntry.teacherSelection[0]
                } else if (this.#lastJournalData?.info?.journalTeachers) {
                  teacherObj = this.#lastJournalData.info.journalTeachers.find(t => Number(t.id) === Number(teacherId)) || null
                }

                // Server expects teacher ids as strings in some cases; use string form to match example payload
                safeCopy.journalEntryTeachers = [String(teacherId)]
                safeCopy.journalEntryCapacityTypes = Array.isArray(safeCopy.journalEntryCapacityTypes) ? safeCopy.journalEntryCapacityTypes.slice() : []

                // Preserve or set teacherSelection so server receives the teacher metadata (helps server-side processing)
                if (teacherObj) {
                  safeCopy.teacherSelection = [
                    // Build a minimal teacher object if the server response didn't include one
                    Object.assign(
                      { id: String(teacherObj.id), displayName: teacherObj.displayName || teacherObj.name || '' },
                      // Keep extra known fields if present
                      teacherObj
                    )
                  ]
                } else if (Array.isArray(safeCopy.teacherSelection) && safeCopy.teacherSelection.length > 0) {
                  // Ensure IDs inside teacherSelection are strings
                  safeCopy.teacherSelection = safeCopy.teacherSelection.map(t => ({ ...t, id: String(t.id) }))
                } else {
                  // No teacher metadata available - set minimal teacherSelection using journal info if present
                  const fallbackTeacher = this.#lastJournalData?.info?.journalTeachers?.find(t => Number(t.id) === Number(teacherId))
                  if (fallbackTeacher) {
                    safeCopy.teacherSelection = [
                      { id: String(fallbackTeacher.id), displayName: fallbackTeacher.displayName || fallbackTeacher.name || '' }
                    ]
                  } else {
                    delete safeCopy.teacherSelection
                  }
                }

                // Remove other UI-only fields
                delete safeCopy._links
                delete safeCopy.journalStudent

                Logger.info(`[${this.name}] Attempting server-side teacher assignment for entry ${entryId}`, {
                  journalId,
                  teacherId,
                  payloadPreview: { journalEntryTeachers: safeCopy.journalEntryTeachers, teacherSelection: safeCopy.teacherSelection }
                })

                try {
                  // Log the full payload at debug level (avoid verbose logging at info level)
                  Logger.debug(`[${this.name}] Teacher assignment PUT payload for entry ${entryId}:`, safeCopy)
                  const putRes = await this.api.tahvel.put(detailUrl, safeCopy)
                  Logger.debug(`[${this.name}] PUT response for teacher assignment:`, putRes)
                  try {
                    await cacheService.clearJournalCache(journalId)
                  } catch (e) {
                    Logger.debug(`[${this.name}] cache clear error after teacher PUT:`, e)
                  }
                  try {
                    const { journalData } = await this.#fetchJournalAndTimetableData(journalId, true)
                    this.#lastJournalData = journalData
                  } catch (e) {
                    Logger.debug(`[${this.name}] refresh after teacher PUT failed:`, e)
                  }
                  await this.#refreshTableWithRetry()

                  try {
                    await this.#safeNotify({ title: 'Õpetaja lisatud', message: 'Õpetaja on automaatselt määratud ja salvestatud.', duration: 4000 })
                  } catch (e) {
                    Logger.debug(`[${this.name}] safeNotify failed:`, e)
                  }

                  return // success, exit early
                } catch (putErr) {
                  // Try to extract server response body if available for diagnostics
                  try {
                    if (putErr?.response && typeof putErr.response.json === 'function') {
                      const body = await putErr.response.json()
                      Logger.error(`[${this.name}] Server PUT to assign teacher failed for entry ${entryId} - response body:`, body)
                    } else if (putErr?.response && typeof putErr.response.text === 'function') {
                      const body = await putErr.response.text()
                      Logger.error(`[${this.name}] Server PUT to assign teacher failed for entry ${entryId} - response text:`, body)
                    } else {
                      Logger.error(`[${this.name}] Server PUT to assign teacher failed for entry ${entryId}:`, putErr)
                    }
                  } catch (bodyErr) {
                    Logger.error(`[${this.name}] Server PUT failed and response body parsing threw:`, bodyErr)
                  }

                  // On failure, show message and exit (no UI fallback)
                  try {
                    await this.#safeNotify({
                      title: 'Parandus ebaõnnestus',
                      message: 'Server ei suutnud automaatselt õpetajat määrata. Palun valige õpetaja käsitsi.',
                      duration: 6000
                    })
                  } catch (e) {
                    Logger.debug(`[${this.name}] safeNotify failed:`, e)
                  }
                  return
                }
              } else {
                Logger.debug(`[${this.name}] No teacher available to assign for entry ${entryId}`)
                try {
                  await this.#safeNotify({
                    title: 'Õpetajat ei leitud',
                    message: 'Päevikust või sissekandest ei leitud õpetajat, palun valige õpetaja käsitsi.',
                    duration: 6000
                  })
                } catch (e) {
                  Logger.debug(`[${this.name}] safeNotify failed:`, e)
                }
                return
              }
            }
          }
        } catch (srvAssignErr) {
          Logger.debug(`[${this.name}] Server-side teacher assignment attempt failed:`, srvAssignErr)
          try {
            await this.#safeNotify({ title: 'Parandus ebaõnnestus', message: 'Serveri päring ebaõnnestus. Palun valige õpetaja käsitsi.', duration: 6000 })
          } catch (e) {
            Logger.debug(`[${this.name}] safeNotify failed:`, e)
          }
          return
        }
      }

      // Open the dialog only for non-teacher issues or if we reached here
      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      // Wait a bit for dialog content to fully render
      await new Promise(resolve => setTimeout(resolve, 500))

      // Special handling for lesson_without_auditoorne - only check capacity checkbox, not teacher
      if (validationResult?.errorType === 'lesson_without_auditoorne') {
        // Do NOT auto-check teacher checkbox for this specific error type
        // Just highlight the auditoorne checkbox and let user handle teacher selection manually
      } else {
        // Ensure teacher checkbox is always checked for other validation types
        await this.#checkTeacherCheckbox()
      }

      // Check if teacher is actually selected after auto-checking (skip for lesson_without_auditoorne)
      if (validationResult?.errorType !== 'lesson_without_auditoorne') {
        const teacherState = this.#getTeacherCheckboxState()

        // If no teacher is selected, show specific error and highlight teacher checkboxes
        if (!teacherState.hasTeacher) {
          const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')
          const teacherElements = [...teacherCheckboxes].filter(cb => this.#isElementVisible(cb))

          if (teacherElements.length > 0) {
            this.#highlightProblematicElements(teacherElements, 'Õpetaja pole valitud! Palun valige õpetaja enne salvestamist.')
            this.#addDialogCloseListeners()

            // Add event listeners to automatically clear the highlight when a teacher is selected
            this.#addTeacherSelectionMonitoring()

            return // Exit early - don't process capacity checkboxes until teacher is selected
          }
        }

        // Add teacher checkbox change listeners for validation refresh
        this.#addTeacherCheckboxListeners()
      }

      // Find and highlight problematic elements to guide the user
      const elementsToHighlight = this.#findProblematicElementsForHighlighting(entryType, validationResult)

      // Special green highlight for praktiline töö missing checkbox error
      if (validationResult?.errorType === 'praktiline_too_without_praktiline_checkbox') {
        // Find the relevant checkboxes
        const capacityTypeCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"]')
        const praktiliseCheckbox = Array.from(capacityTypeCheckboxes).find(
          checkbox => checkbox.getAttribute('aria-label')?.includes('Praktiline töö') || checkbox.textContent.includes('Praktiline töö')
        )
        const iseseisevCheckbox = Array.from(capacityTypeCheckboxes).find(
          checkbox => checkbox.getAttribute('aria-label')?.includes('Iseseisev õpe') || checkbox.textContent.includes('Iseseisev õpe')
        )

        // Uncheck and highlight Iseseisev õpe in red if checked
        if (iseseisevCheckbox && iseseisevCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseisevCheckbox)
          this.#highlightProblematicElements([iseseisevCheckbox], 'Iseseisev õpe linnuke eemaldati!', '#ff0000')
        }
        // Check and highlight Praktiline töö in green if not checked
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(praktiliseCheckbox)
          this.#highlightProblematicElements([praktiliseCheckbox], highlightMessage, '#4CAF50')
        }
        this.#addDialogCloseListeners()
      } else if (elementsToHighlight.length > 0) {
        this.#highlightProblematicElements(elementsToHighlight, highlightMessage)
        // Add listeners to remove highlights when dialog is closed or saved
        this.#addDialogCloseListeners()
      } else {
        Logger.warning(`[${this.name}] No elements found to highlight for error type: ${validationResult?.errorType}`)
        // Show tooltip anyway to guide user
        if (highlightMessage) {
          const tooltip = document.createElement('div')
          tooltip.dataset.capacityHighlight = 'true'
          tooltip.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff0000;
            color: white;
            padding: 12px 18px;
            border-radius: 8px;
            z-index: 10000;
            font-weight: bold;
            font-size: 14px;
            max-width: 350px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            border: 2px solid #ffffff;
            line-height: 1.4;
          `
          tooltip.textContent = highlightMessage
          document.body.appendChild(tooltip)

          setTimeout(() => tooltip.remove(), 10000)
        }
      }

      // Find capacity type checkboxes
      // noinspection CssInvalidHtmlTagReference
      const capacityTypeCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"]')
      const auditoorneCheckbox = Array.from(capacityTypeCheckboxes).find(
        checkbox => checkbox.getAttribute('aria-label')?.includes('Auditoorne õpe') || checkbox.textContent.includes('Auditoorne õpe')
      )
      const iseseisevCheckbox = Array.from(capacityTypeCheckboxes).find(
        checkbox =>
          checkbox.getAttribute('aria-label')?.includes('Iseseisev õpe') ||
          checkbox.getAttribute('aria-label')?.includes('Individuaalne õpe') ||
          checkbox.textContent.includes('iseseisev õpe') ||
          checkbox.textContent.includes('Individuaalne õpe')
      )
      const praktiliseCheckbox = Array.from(capacityTypeCheckboxes).find(
        checkbox => checkbox.getAttribute('aria-label')?.includes('Praktiline töö') || checkbox.textContent.includes('Praktiline töö')
      )

      // Special auto-fix for lesson_without_auditoorne: automatically check auditoorne õpe
      if (validationResult?.errorType === 'lesson_without_auditoorne') {
        // Auto-check the auditoorne checkbox but don't auto-save
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(auditoorneCheckbox)

          // Highlight the checkbox in green to show it was automatically fixed
          this.#highlightProblematicElements(
            [auditoorneCheckbox],
            'Auditoorne õpe on automaatselt sisse lülitatud! Palun salvestage muudatused käsitsi.',
            '#4CAF50'
          )
          this.#addDialogCloseListeners()
        }
      } else if (entryType === 'SISSEKANNE_I') {
        // For independent work entries: ensure iseseisevCheckbox is checked, others are unchecked
        if (iseseisevCheckbox && iseseisevCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(iseseisevCheckbox)
        }
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(auditoorneCheckbox)
        }
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(praktiliseCheckbox)
        }
      } else if (entryType === 'SISSEKANNE_P') {
        // For practical work entries: ensure praktiline töö is checked, others are unchecked
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(praktiliseCheckbox)
        }
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(auditoorneCheckbox)
        }
        if (iseseisevCheckbox && iseseisevCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseisevCheckbox)
        }
      } else {
        // For regular lesson entries (SISSEKANNE_T): ensure auditoorne õpe is checked, others are unchecked
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(auditoorneCheckbox)
        }
        if (iseseisevCheckbox && iseseisevCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseisevCheckbox)
        }
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(praktiliseCheckbox)
        }
      }

      // Note: No auto-save functionality - user must manually save after making changes
    } catch (error) {
      Logger.error(`[${this.name}] fix capacity error`, error)
    }
  }

  #addTeacherSelectionMonitoring() {
    /** @type {NodeListOf<HTMLElement>} */
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')

    for (const checkbox of teacherCheckboxes) {
      if (checkbox && this.#isElementVisible(checkbox) && !checkbox.dataset.teacherMonitoringAdded) {
        const handleTeacherSelection = () => {
          // Small delay to let the change propagate
          setTimeout(() => {
            const teacherState = this.#getTeacherCheckboxState()
            if (teacherState.hasTeacher) {
              // Teacher is now selected, clear highlights and continue with normal validation
              this.#cleanupHighlights()
              Logger.debug(`[${this.name}] Teacher selected, continuing with capacity validation...`)
            }
          }, 200)
        }

        checkbox.addEventListener('click', handleTeacherSelection)
        checkbox.addEventListener('change', handleTeacherSelection)
        checkbox.dataset.teacherMonitoringAdded = 'true'
      }
    }
  }

  #addTeacherCheckboxListeners() {
    /** @type {NodeListOf<HTMLElement>} */
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]:not([data-teacher-listener-added])')

    for (const checkbox of teacherCheckboxes) {
      if (checkbox && this.#isElementVisible(checkbox)) {
        const handleTeacherChange = async() => {
          Logger.debug(`[${this.name}] Teacher checkbox state changed, refreshing validation...`)
          // Small delay to let the change propagate
          await this.#delay(300)
          // Refresh the capacity validation table
          await this.#refreshTableWithRetry()
        }

        // Listen for both click and change events
        checkbox.addEventListener('click', handleTeacherChange)
        checkbox.addEventListener('change', handleTeacherChange)

        // Mark this checkbox as having listeners to avoid duplicates
        checkbox.dataset.teacherListenerAdded = 'true'
      }
    }
  }

  #addDialogCloseListeners() {
    // Remove any existing listeners to avoid duplicates
    if (this.dialogCloseListener) {
      document.removeEventListener('click', this.dialogCloseListener, true)
      this.dialogCloseListener = null
    }

    // Create a listener function that will clean up highlights
    this.dialogCloseListener = event => {
      const target = event.target

      // Check if user clicked close button, cancel button, or save button
      // noinspection HtmlUnknownTag
      const isCloseButton = target.matches(
        'md-icon[aria-label*="close"], button[aria-label*="close"], .md-dialog-close, [ng-click*="close"], [ng-click*="cancel"]'
      )
      const isSaveButton = target.matches('button[type="submit"], button[ng-click*="save"], .md-primary, [aria-label*="save"], [ng-click*="submit"]')
      const isDialogBackdrop =
        target.matches('md-backdrop, .md-backdrop') || (target.classList.contains('md-dialog-container') && event.target === event.currentTarget)

      // Also check if clicked element is inside a close/save button
      // noinspection HtmlUnknownTag
      const closestCloseButton = target.closest(
        '.md-icon[aria-label*="close"], button[aria-label*="close"], .md-dialog-close, [ng-click*="close"], [ng-click*="cancel"]'
      )
      const closestSaveButton = target.closest('button[type="submit"], button[ng-click*="save"], .md-primary, [aria-label*="save"], [ng-click*="submit"]')

      if (isCloseButton || isSaveButton || isDialogBackdrop || closestCloseButton || closestSaveButton) {
        // Small delay to allow dialog close animation
        setTimeout(() => {
          this.#cleanupHighlights()
        }, 100)
      }
    }

    // Add listener to capture clicks globally
    document.addEventListener('click', this.dialogCloseListener, true)

    // Also listen for dialog removal via mutation observer
    if (!this.dialogMutationObserver) {
      this.dialogMutationObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.removedNodes.forEach(
            /** @param {Element} node */ node => {
              // Check if a dialog was removed
              if (node.nodeType === Node.ELEMENT_NODE && (node.matches('md-dialog') || node.querySelector('md-dialog'))) {
                this.#cleanupHighlights()
              }
            }
          )
        })
      })

      this.dialogMutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      })
    }
  }

  #cleanupHighlights() {
    document.querySelectorAll('[data-capacity-highlight="true"]').forEach(el => {
      /** @type {HTMLElement} */ const checkbox = el

      if (checkbox.tagName === 'MD-CHECKBOX') {
        // Restore original styles and remove highlight attribute
        if (checkbox.dataset.originalBorder !== undefined) {
          checkbox.style.border = checkbox.dataset.originalBorder
          delete checkbox.dataset.originalBorder
        } else {
          checkbox.style.border = ''
        }

        if (checkbox.dataset.originalBoxShadow !== undefined) {
          checkbox.style.boxShadow = checkbox.dataset.originalBoxShadow
          delete checkbox.dataset.originalBoxShadow
        } else {
          checkbox.style.boxShadow = ''
        }

        checkbox.removeAttribute('data-capacity-highlight')
      } else {
        checkbox.remove()
      }
    })

    if (this.#dialogCloseObserver) {
      this.#dialogCloseObserver.disconnect()
      this.#dialogCloseObserver = null
    }
  }

  /**
   * Handle opening a journal entry and highlighting the entry type field
   * @param {string} entryId - Entry ID
   * @param {Object} data - Button data object
   */
  async #handleOpenEntry(entryId, data = {}) {
    try {
      const actualEntryId = entryId || data.entryid
      Logger.debug(`[${this.name}] handleOpenEntry called with entryId=${entryId}, actualEntryId=${actualEntryId}`)

      // Find the journal entry element and click it to open
      const element = await this.#findJournalEntryElement(actualEntryId, data.date)
      if (!element) {
        Logger.error(`[${this.name}] Could not find journal entry element for ID: ${actualEntryId}`)
        return
      }

      // Click the element to open the entry (dialog on Old Tahvel, SPA navigation on New Tahvel)
      await this.#clickElement(element)

      // Old Tahvel: wait for dialog and highlight entry type field
      if (element.tagName !== 'A') {
        await this.#waitForElement('md-dialog', 5000)
        setTimeout(() => {
          this.#highlightEntryTypeField()
        }, 500)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error in handleOpenEntry:`, error)
    }
  }

  /**
   * Find and highlight the entry type field with a red box
   */
  #highlightEntryTypeField() {
    try {
      // Look for entry type related elements
      const entryTypeSelectors = [
        'md-select[ng-model*="entryType"]',
        'md-select[ng-model*="EntryType"]',
        'md-select[aria-label*="sissekande liik"]',
        'md-select[aria-label*="Sissekande liik"]',
        'select[ng-model*="entryType"]',
        '[ng-model*="entryType"]'
      ]

      let entryTypeElement = null

      for (const selector of entryTypeSelectors) {
        entryTypeElement = document.querySelector(selector)
        if (entryTypeElement) {
          Logger.debug(`[${this.name}] Found entry type element with selector: ${selector}`)
          break
        }
      }

      // If not found, try finding by text content
      if (!entryTypeElement) {
        const labels = document.querySelectorAll('label, .md-input-label, md-input-container label')
        for (const label of labels) {
          if (label.textContent.toLowerCase().includes('sissekande liik') || label.textContent.toLowerCase().includes('sissekannetüüp')) {
            // Look for nearby input/select elements
            const parent = label.closest('md-input-container, .md-input-container, md-select, .form-group')
            if (parent) {
              entryTypeElement = parent.querySelector('md-select, select, input') || parent
              Logger.debug(`[${this.name}] Found entry type element by label text`)
              break
            }
          }
        }
      }

      if (entryTypeElement) {
        // Previously we displayed a prominent red highlight and tooltip
        // warning the user about incorrect entry type. This was noisy and
        // showed the message: "Vigane sissekanne: Kontrollige sissekande liiki! ...".
        // Remove the visual tooltip and heavy highlight; keep a debug log and
        // attach the cleanup listeners so any legacy hooks still work.
        this.#addEntryTypeHighlightCleanup()
        Logger.debug(`[${this.name}] Entry type field detected but interactive highlighting suppressed`)
      } else {
        Logger.warn(`[${this.name}] Could not find entry type field to highlight`)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error highlighting entry type field:`, error)
    }
  }

  /**
   * Add listeners to clean up entry type highlights when dialog is closed or entry type is clicked
   */
  #addEntryTypeHighlightCleanup() {
    const cleanupHighlights = () => {
      // Remove highlight box
      document.querySelectorAll('[data-entry-type-highlight="true"]').forEach(el => el.remove())
      // Remove tooltip
      document.querySelectorAll('[data-entry-type-tooltip="true"]').forEach(el => el.remove())
    }

    // Listen for clicks on entry type elements to remove highlight when user interacts
    const addEntryTypeClickListeners = () => {
      const entryTypeSelectors = [
        'md-select[ng-model*="entryType"]',
        'md-select[ng-model*="EntryType"]',
        'md-select[aria-label*="sissekande liik"]',
        'md-select[aria-label*="Sissekande liik"]',
        'select[ng-model*="entryType"]',
        '[ng-model*="entryType"]'
      ]

      entryTypeSelectors.forEach(selector => {
        /** @type {HTMLElement | null} */
        const element = document.querySelector(selector)
        if (element && !element.dataset.highlightCleanupAdded) {
          element.dataset.highlightCleanupAdded = 'true'
          element.addEventListener('click', cleanupHighlights, { once: true })
          element.addEventListener('focus', cleanupHighlights, { once: true })
          Logger.debug(`[${this.name}] Added cleanup listener to entry type element: ${selector}`)
        }
      })

      // Also look for entry type elements by label text
      const labels = document.querySelectorAll('label, .md-input-label, md-input-container label')
      labels.forEach(label => {
        if (label.textContent.toLowerCase().includes('sissekande liik') || label.textContent.toLowerCase().includes('sissekannetüüp')) {
          const parent = label.closest('md-input-container, .md-input-container, md-select, .form-group')
          if (parent) {
            /** @type {HTMLElement | null} */
            const entryTypeElement = parent.querySelector('md-select, select, input')
            if (entryTypeElement && !entryTypeElement.dataset.highlightCleanupAdded) {
              entryTypeElement.dataset.highlightCleanupAdded = 'true'
              entryTypeElement.addEventListener('click', cleanupHighlights, { once: true })
              entryTypeElement.addEventListener('focus', cleanupHighlights, { once: true })
              Logger.debug(`[${this.name}] Added cleanup listener to entry type element found by label`)
            }
          }
        }
      })
    }

    // Add entry type click listeners with a small delay to ensure elements are loaded
    setTimeout(addEntryTypeClickListeners, 100)

    // Listen for dialog close
    const dialog = document.querySelector('md-dialog')
    if (dialog) {
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          if (mutation.type === 'childList') {
            mutation.removedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                /** @type {Element} */
                const el = node

                if (el.matches('md-dialog') || el.querySelector('md-dialog')) {
                  cleanupHighlights()
                  observer.disconnect()
                }
              }
            })
          }
        })
      })
      observer.observe(document.body, {
        childList: true,
        subtree: true
      })
    }

    // Also clean up after 30 seconds as fallback
    setTimeout(cleanupHighlights, 30000)
  }
}
