/**
 * Final Grade Warning Feature - Shows colored warning icons for journals with missing final grades
 *
 * Requirements:
 * - Shows colored pill next to journal name when ÕV/outcome grades are missing
 * - Yellow pill: 7-2 days before final lesson (warning)
 * - Red pill: 1 day or less before final lesson, or past (urgent)
 * - Uses shared getWarningLevel() utility (no code duplication with HighlightFinalGradesFeature)
 * - Auto-updates when journal list changes (pagination, study year change)
 */

import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { getWarningLevel, getFinalLessonDate } from '../../../lib/finalGradeWarning.js'

const BATCH_SIZE = 5
const BASE_STYLE =
  'display:inline;border-radius:15px;padding:2px 8px;margin-left:6px;font-size:12px;font-weight:bold;cursor:help;vertical-align:middle;box-shadow:0 1px 3px rgba(0,0,0,0.15);white-space:nowrap;'

export default class FinalGradeWarningFeature extends BaseFeature {
  constructor() {
    super('finalGradeWarning', /#\/journals/)
    this.name = 'FinalGradeWarningFeature'
    this.processedJournals = new Set()
    this.mainContentObserver = null
    this._activateTimeout = null
    this._contentChangeTimeout = null
    this._isProcessing = false
  }

  /**
   * Activate the feature on journal list pages
   */
  onActivate() {
    if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Activating final grade warning feature`)

    this.setupMainContentObserver()

    this._activateTimeout = setTimeout(() => {
      this._activateTimeout = null
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in delayed processJournalList:`, error)
      })
    }, 1200)
  }

  /**
   * Deactivate the feature
   */
  onDeactivate() {
    super.onDeactivate()

    if (this._activateTimeout) {
      clearTimeout(this._activateTimeout)
      this._activateTimeout = null
    }
    if (this._contentChangeTimeout) {
      clearTimeout(this._contentChangeTimeout)
      this._contentChangeTimeout = null
    }

    if (this.mainContentObserver) {
      this.mainContentObserver.disconnect()
      this.mainContentObserver = null
    }

    this.removeAllIndicators()
    this.processedJournals.clear()
    this._isProcessing = false
  }

  /**
   * Set up observer for main content changes (journal list updates)
   */
  setupMainContentObserver() {
    const mainContentElement = document.querySelector('#tahvelTable')
    if (!mainContentElement) {
      Logger.warning(`[${this.name}] Main content element not found for observer`)
      return
    }

    let debounceTimer = null

    this.mainContentObserver = new MutationObserver(mutations => {
      const hasRelevantChanges = mutations.some(mutation => {
        if (mutation.type === 'childList') {
          const relevantNodes = [...mutation.addedNodes, ...mutation.removedNodes]
          return relevantNodes.some(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false
            return (
              node.matches &&
              (node.matches('table, tbody, tr, .tahvel-table, .tahvel-table-wrapper') ||
                (node.querySelector && node.querySelector('table, tbody, tr, .tahvel-table, .tahvel-table-wrapper')))
            )
          })
        }
        return false
      })

      if (hasRelevantChanges) {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          this.onMainContentChange()
        }, 300)
      }
    })

    this.mainContentObserver.observe(mainContentElement, {
      childList: true,
      subtree: true
    })
  }

  /**
   * Handle the main content change (journal list updated)
   */
  onMainContentChange() {
    if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Processing main content change`)
    this.processedJournals.clear()
    this.removeAllIndicators()

    this._contentChangeTimeout = setTimeout(() => {
      this._contentChangeTimeout = null
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in onMainContentChange processJournalList:`, error)
      })
    }, 100)
  }

  /**
   * Process all journals on the current page in parallel batches
   */
  async processJournalList() {
    if (this._isProcessing) return
    this._isProcessing = true
    try {
      const rows = document.querySelectorAll('#tahvelTable table.tahvel-table tbody tr')
      if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Found ${rows.length} journal rows`)

      if (rows.length === 0) return

      const now = new Date()
      now.setHours(0, 0, 0, 0)

      const rowArray = Array.from(rows)
      for (let i = 0; i < rowArray.length; i += BATCH_SIZE) {
        const batch = rowArray.slice(i, i + BATCH_SIZE)
        await Promise.allSettled(batch.map(row => this.processJournalRow(row, now)))
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error processing journal list:`, error)
    } finally {
      this._isProcessing = false
    }
  }

  /**
   * Process a single journal row
   * @param {HTMLElement} row
   * @param {Date} now - Current date normalized to midnight
   */
  async processJournalRow(row, now) {
    try {
      const linkElement = row.querySelector('td:nth-child(2) a.linked-name')
      if (!linkElement) return

      const href = linkElement.getAttribute('href') || linkElement.getAttribute('ng-href') || ''
      const match = href.match(/\/journal\/(\d+)/)
      if (!match) return

      const journalId = parseInt(match[1], 10)

      if (this.processedJournals.has(journalId)) return
      this.processedJournals.add(journalId)

      const hasMissing = await this.hasMissingFinalGrades(journalId)
      if (!hasMissing) return

      const finalLessonDateStr = await getFinalLessonDate(journalId, this.api)
      if (!finalLessonDateStr) return

      const finalDate = new Date(finalLessonDateStr)
      finalDate.setHours(0, 0, 0, 0)

      const warningLevel = getWarningLevel(now, finalDate)
      if (!warningLevel) return

      this.addWarningIndicator(linkElement, warningLevel)
    } catch (error) {
      Logger.error(`[${this.name}] Error processing journal row:`, error)
    }
  }

  /**
   * Check if a journal has missing final grades (ÕV outcome entries without grades).
   *
   * The /journalEntriesByDate response for SISSEKANNE_O entries has
   * `studentOutcomeResults` which only contains students who HAVE grades.
   * Students without grades are absent from the map. So we must compare
   * the number of graded students against the total journal student count.
   *
   * When `studentOutcomeResults` is missing entirely, we fall back to
   * fetching the detailed outcome via /journals/{id}/journalOutcome/{outcomeId}.
   *
   * @param {number} journalId
   * @returns {Promise<boolean>}
   */
  async hasMissingFinalGrades(journalId) {
    try {
      const [entries, journalStudents] = await Promise.all([
        this.api.tahvel.get(
          `/journals/${journalId}/journalEntriesByDate`,
          { allStudents: true },
          { cache: true, cacheExpiration: 3e5 }
        ),
        this.api.tahvel.get(
          `/journals/${journalId}/journalStudents`,
          {},
          { cache: true, cacheExpiration: 3e5 }
        )
      ])

      if (!Array.isArray(entries)) return false

      const outcomeEntries = entries.filter(e => e.entryType === 'SISSEKANNE_O')
      if (outcomeEntries.length === 0) return false

      const totalStudents = Array.isArray(journalStudents) ? journalStudents.length : 0
      if (totalStudents === 0) return false

      for (const entry of outcomeEntries) {
        let results = entry.studentOutcomeResults

        // If studentOutcomeResults is missing, fetch detailed outcome data
        if (!results && entry.curriculumModuleOutcomes) {
          try {
            const detailed = await this.api.tahvel.get(
              `/journals/${journalId}/journalOutcome/${entry.curriculumModuleOutcomes}`,
              {},
              { cache: true, cacheExpiration: 3e5 }
            )
            if (detailed && Array.isArray(detailed.outcomeStudents)) {
              // Count students with grades
              const gradedCount = detailed.outcomeStudents.filter(s => s.grade).length
              if (gradedCount < totalStudents) return true
              continue
            }
          } catch (e) {
            // Cannot determine — skip this outcome entry
            continue
          }
        }

        if (!results || typeof results !== 'object') {
          // No grade data available at all — treat as missing
          return true
        }

        // Count students with actual grades in studentOutcomeResults
        let gradedCount = 0
        for (const grades of Object.values(results)) {
          if (grades && grades.length > 0 && grades[0].grade) {
            gradedCount++
          }
        }

        if (gradedCount < totalStudents) return true
      }
      return false
    } catch (error) {
      Logger.error(`[${this.name}] Error checking missing final grades for journal ${journalId}:`, error)
      return false
    }
  }

  /**
   * Add colored warning indicator next to journal link
   * @param {HTMLElement} linkElement
   * @param {'yellow'|'red'} warningLevel
   */
  addWarningIndicator(linkElement, warningLevel) {
    try {
      const parentCell = linkElement.parentElement
      if (!parentCell) return

      if (parentCell.querySelector('.oa-final-grade-warning')) return

      const indicator = document.createElement('span')
      indicator.className = 'oa-final-grade-warning'
      indicator.title = 'Lõpphinded puuduvad'
      indicator.textContent = '!'

      if (warningLevel === 'yellow') {
        indicator.style.cssText = BASE_STYLE + 'background:#fff9c4;color:#f57f17;'
      } else {
        indicator.style.cssText = BASE_STYLE + 'background:#ffdddd;color:#d32f2f;'
      }

      const wrapper = document.createElement('span')
      wrapper.style.cssText = 'display: inline; white-space: nowrap;'

      parentCell.insertBefore(wrapper, linkElement)
      wrapper.appendChild(linkElement)
      wrapper.appendChild(indicator)

      if (Logger.isDebugMode()) Logger.info(`✨ [${this.name}] Added ${warningLevel} warning for journal link`)
    } catch (error) {
      Logger.error(`[${this.name}] Error adding warning indicator:`, error)
    }
  }

  /**
   * Remove all final grade warning indicators
   */
  removeAllIndicators() {
    try {
      const indicators = document.querySelectorAll('.oa-final-grade-warning')
      indicators.forEach(indicator => {
        const wrapper = indicator.parentElement
        if (wrapper && wrapper.children.length === 2) {
          const link = wrapper.querySelector('a')
          if (link) {
            const parentCell = wrapper.parentElement
            parentCell.insertBefore(link, wrapper)
          }
          wrapper.remove()
        } else {
          indicator.remove()
        }
      })
    } catch (error) {
      Logger.error(`[${this.name}] Error removing warning indicators:`, error)
    }
  }
}
