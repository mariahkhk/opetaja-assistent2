import { BaseFeature } from '../../../core/BaseFeature.js'
import { styleService } from '../../../services/StyleService.js'
import Logger from '../../../services/Logger.js'
import { getWarningLevel, getFinalLessonDate as getFinalLessonDateShared, getStudyYearRange } from '../../../lib/finalGradeWarning.js'

class HighlightFinalGradesFeature extends BaseFeature {
  constructor() {
    super('highlightFinalGrades', /#\/journal\//)
    this.finalGradeStyleId = 'highlight-final-grade-style'
    this._observer = null
    this._docObserver = null
    this._debounceTimeout = null
    this._docObserverTable = null
    this._tableRetryTimeout = null
    this._tableRetryCount = 0
    this._bannerObserver = null
  }

  injectFinalGradeCSS() {
    if (!document.getElementById(this.finalGradeStyleId)) {
      styleService.injectCSS(
        `
        .highlight-final-grade-yellow {
          background: #fff9c4 !important;
          box-shadow: 0 0 0 2px #ffeaa7 inset !important;
          position: relative;
          cursor: pointer;
        }
        .highlight-final-grade-red {
          background: #ffdddd !important;
          box-shadow: 0 0 0 2px #ff0000 inset !important;
          position: relative;
          cursor: pointer;
        }
        .highlight-ov-red {
          background: #ffdddd !important;
          box-shadow: 0 0 0 2px #ff0000 inset !important;
          position: relative;
          cursor: pointer;
        }
        .highlight-ov-yellow {
          background: #ffe066 !important;
          box-shadow: 0 0 0 2px #ffd43b inset !important;
          position: relative;
          cursor: pointer;
        }
      `,
        this.finalGradeStyleId
      )
    }
  }

  _isJournalEntriesTable(table) {
    if (!table) return false
    const headerTexts = Array.from(table.querySelectorAll('thead th')).map(th => (th.textContent || '').toLowerCase())
    if (headerTexts.length === 0) return false
    if (headerTexts.some(text => text.includes('õppija'))) return true
    if (headerTexts.some(text => text.includes('lõpptulemus'))) return true
    if (headerTexts.some(text => /õv/.test(text))) return true
    return false
  }

  _findJournalTable() {
    const selectors = [
      '#studentTable table.tahvel-table',
      '#studentTable table',
      '.tahvel-table-wrapper#studentTable table',
      '.layout-padding table.tahvel-table',
      '.layout-padding table.journalTable',
      'table.journalTable'
    ]
    for (const selector of selectors) {
      const candidate = document.querySelector(selector)
      if (candidate && this._isJournalEntriesTable(candidate)) return candidate
    }
    const layoutPadding = document.querySelector('.layout-padding')
    if (layoutPadding) {
      const fallback = layoutPadding.querySelector('table.tahvel-table, table.journalTable')
      if (fallback && this._isJournalEntriesTable(fallback)) return fallback
    }
    return null
  }

  _getComparisonDate(finalLessonDate, lastLessonBanner) {
    const finalDate = new Date(finalLessonDate)
    finalDate.setHours(0, 0, 0, 0)
    let now
    let comparisonDateStr = null
    if (lastLessonBanner) {
      const compMatch = lastLessonBanner.textContent && lastLessonBanner.textContent.match(/\(võrdlus kuupäevaga (\d{2})\.(\d{2})\.(\d{4})\)/)
      if (compMatch) {
        const [_, day, month, year] = compMatch
        comparisonDateStr = `${year}-${month}-${day}`
      }
    }
    if (!comparisonDateStr && window.__oa2ComparisonDate) {
      comparisonDateStr = window.__oa2ComparisonDate
    }
    if (comparisonDateStr) {
      now = new Date(comparisonDateStr)
    } else {
      now = new Date()
    }
    now.setHours(0, 0, 0, 0)
    return { now, finalDate }
  }

  async getFinalLessonDate(journalId) {
    return getFinalLessonDateShared(journalId, this.api)
  }

  findColumnIndices(table) {
    const headerRows = Array.from(table.querySelectorAll('thead tr'))
    const finalGradeCols = new Set()
    const ovCols = new Set()
    const debugHeaders = []
    headerRows.forEach(row => {
      let colIdx = 0
      Array.from(row.children).forEach(th => {
        const colspan = parseInt(th.getAttribute('colspan') || '1', 10)
        const rawText = th.innerText || th.textContent
        // Normalize: replace all whitespace (including line breaks) with single space, trim, lowercase
        const normalized = (rawText || '').replace(/\s+/g, ' ').trim().toLowerCase()
        const attrTextParts = [normalized]
        const ariaLabel = (th.getAttribute('aria-label') || '').trim().toLowerCase()
        const titleAttr = (th.getAttribute('title') || '').trim().toLowerCase()
        const dataColumnType = (th.dataset?.columnType || th.getAttribute('data-column-type') || '').trim().toLowerCase()
        const className = (th.className || '').toLowerCase()
        const styleAttr = (th.getAttribute('style') || '').toLowerCase()
        if (ariaLabel) attrTextParts.push(ariaLabel)
        if (titleAttr) attrTextParts.push(titleAttr)
        if (dataColumnType) attrTextParts.push(dataColumnType)
        if (className) attrTextParts.push(className)
        const attrText = attrTextParts.join(' ')
        const hasPinkBackground = /249\s*,\s*168\s*,\s*212/.test(styleAttr) || styleAttr.includes('#f9a8d4')
        let ovMatch = false
        let finalMatch = false
        // ÕV: match 'õv', 'õv1', 'õv2', 'õv 2', 'õv_2', 'õv-2', 'õv2 forward', or contains 'õpiväljund'
        if (/^õv(\d+)?([ _-]?.*)?$/i.test(normalized) || normalized.includes('õpiväljund')) {
          ovMatch = true
          for (let i = 0; i < colspan; i++) ovCols.add(colIdx + i)
        }
        const finalTextPatterns = [/lõpp\s*tulemus/, /final\s*grade/, /lõpphinne/, /kokkuvõt/, /perioodi\s*hinne/, /lopp\s*tulemus/]
        if (finalTextPatterns.some(pattern => pattern.test(attrText)) || hasPinkBackground || className.includes('final-grade')) {
          finalMatch = true
          for (let i = 0; i < colspan; i++) finalGradeCols.add(colIdx + i)
        }
        debugHeaders.push(
          `[${colIdx}] "${rawText.trim()}" => "${normalized}" | attrs="${attrText}" | style="${styleAttr}" | OV: ${ovMatch} | FINAL: ${finalMatch} | colspan=${colspan}`
        )
        colIdx += colspan
      })
    })
    if (finalGradeCols.size === 0 && ovCols.size > 0) {
      const candidateIndex = Math.max(...ovCols) + 1
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      const hasCandidate = rows.some(row => {
        const cells = Array.from(row.children).filter(node => node.nodeType === 1)
        return cells.length > candidateIndex
      })
      if (hasCandidate) {
        finalGradeCols.add(candidateIndex)
        if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: using fallback final grade column index:', candidateIndex)
      }
    }
    if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: header debug:', debugHeaders.join(' | '))
    if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: detected final grade columns:', Array.from(finalGradeCols))
    if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: detected ÕV columns:', Array.from(ovCols))
    return { finalGradeCols: Array.from(finalGradeCols), ovCols: Array.from(ovCols) }
  }

  onActivate() {
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] onActivate called')
    this._tableRetryCount = 0
    setTimeout(() => {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Calling run() after timeout')
      void this.run()
      this._setupTableObserver()
    }, 1000)
  }

  _setupTableObserver() {
    if (this._docObserver) {
      this._docObserver.disconnect()
      this._docObserver = null
    }
    const table = this._findJournalTable()
    if (!table) {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] MutationObserver setup skipped: journal table not found')
      return
    }
    if (this._tableRetryTimeout) {
      clearTimeout(this._tableRetryTimeout)
      this._tableRetryTimeout = null
    }
    this._docObserver = new MutationObserver(mutations => {
      let relevant = false
      for (const m of mutations) {
        if (m.target === table || table.contains(m.target)) {
          relevant = true
          break
        }
      }
      if (relevant) {
        if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
        this._debounceTimeout = setTimeout(() => {
          if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Table MutationObserver triggered run()')
          void this.run()
        }, 50)
      }
    })
    this._docObserver.observe(table, { childList: true, subtree: true, attributes: false })
    this._docObserverTable = table
  }

  async run() {
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] run() called')
    this.injectFinalGradeCSS()
    const table = this._findJournalTable()
    if (!table) {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Journal table not found, skipping highlight')
      // Only retry up to 40 times (10 seconds total) and check if feature is still active
      if (!this._tableRetryTimeout && this._tableRetryCount < 40 && this.isActive) {
        this._tableRetryCount++
        this._tableRetryTimeout = setTimeout(() => {
          this._tableRetryTimeout = null
          void this.run()
        }, 250)
      } else if (this._tableRetryCount >= 40) {
        if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Max retry count reached, giving up')
      }
      return
    }
    // Reset retry count when table is found
    this._tableRetryCount = 0
    // If observer is not set or table changed, re-setup observer
    if (!this._docObserver || this._docObserverTable !== table) {
      this._setupTableObserver()
      this._docObserverTable = table
    }
    const { finalGradeCols, ovCols } = this.findColumnIndices(table)
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] finalGradeCols:', finalGradeCols)
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] ovCols:', ovCols)
    if (finalGradeCols.length === 0 && ovCols.length === 0) {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] No final grade or ÕV columns detected')
      return
    }
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    table.querySelectorAll('.highlight-final-grade-yellow, .highlight-final-grade-red, .highlight-ov-red, .highlight-ov-yellow').forEach(cell => {
      // Do not remove highlight classes that were applied by Angular templates.
      // If a cell has `ng-star-inserted` AND already contains one of the highlight classes,
      // leave it untouched. Otherwise remove the classes as normal.
      if (
        cell.classList &&
        cell.classList.contains('ng-star-inserted') &&
        (cell.classList.contains('highlight-final-grade-yellow') ||
          cell.classList.contains('highlight-final-grade-red') ||
          cell.classList.contains('highlight-ov-red') ||
          cell.classList.contains('highlight-ov-yellow'))
      ) {
        return
      }
      cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red', 'highlight-ov-red', 'highlight-ov-yellow')
    })

    // Get journalId from URL/hash robustly (support both hash and pathname)
    let journalId = null
    try {
      const hrefMatch = window.location.href.match(/journal\/(\d+)/)
      if (hrefMatch) journalId = hrefMatch[1]
    } catch (e) {
      journalId = null
    }
    // Try to read last lesson date from LastLessonNotificationFeature banner
    let bannerLessonDate = null
    const lastLessonBanner = document.getElementById('last-lesson-inline-notification')
    if (lastLessonBanner) {
      const text = lastLessonBanner.textContent || ''
      // Match date in format DD.MM.YYYY
      const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/)
      if (match) {
        const [_, day, month, year] = match
        // Use local time for date comparison
        bannerLessonDate = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0)
        if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Using last lesson date from banner:', bannerLessonDate.toISOString())
      }
    }
    let finalLessonDate = bannerLessonDate
    let inWarningWindow = false
    // If banner is not yet present, wait briefly for it to appear before falling back
    // to API. This prevents premature highlighting (yellow) on initial page load.
    if (!finalLessonDate) {
      const banner = document.getElementById('last-lesson-inline-notification')
      if (!banner && !this._bannerObserver) {
        // Observe document body for banner insertion and re-run highlighting when it appears
        this._bannerObserver = new MutationObserver((mutations, obs) => {
          const b = document.getElementById('last-lesson-inline-notification')
          if (b) {
            if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Detected last-lesson banner insertion, re-running highlight')
            obs.disconnect()
            this._bannerObserver = null
            // Re-run highlighting asynchronously to allow DOM settle
            setTimeout(() => void this.run(), 50)
          }
        })
        this._bannerObserver.observe(document.body, { childList: true, subtree: true })
      }
    }

    if (!finalLessonDate && journalId) {
      try {
        const apiDate = await this.getFinalLessonDate(journalId)
        if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] getFinalLessonDate result:', apiDate)
        if (apiDate) finalLessonDate = new Date(apiDate)
      } catch (e) {
        Logger.debug('✨ [HighlightFinalGradesFeature] Failed to get final lesson date:', e)
      }
    }
    if (finalLessonDate) {
      const { now, finalDate } = this._getComparisonDate(finalLessonDate, lastLessonBanner)
      const warningLevel = getWarningLevel(now, finalDate)
      inWarningWindow = warningLevel === 'yellow'
      if (Logger.isDebugMode()) {
        Logger.info(
          '✨ [HighlightFinalGradesFeature] Today:',
          now.toISOString(),
          'Final lesson:',
          finalDate.toISOString(),
          'Warning level:',
          warningLevel
        )
        Logger.info('✨ [HighlightFinalGradesFeature] inWarningWindow:', inWarningWindow)
      }
    }
    // Only highlight if within 7 days of the final lesson date
    const shouldHighlight =
      finalLessonDate &&
      (() => {
        const { now, finalDate } = this._getComparisonDate(finalLessonDate, lastLessonBanner)
        return getWarningLevel(now, finalDate) !== null
      })()

    rows.forEach((row, rowIdx) => {
      // Helper: detect AP (academic leave) marker in the student row. The template renders
      // <span ng-if="row.status === 'OPPURSTAATUS_A'">AP</span> inside the first fixed-cell.
      const rowHasAcademicLeave = r => {
        try {
          // Look for a span whose textContent is exactly 'AP' inside the row
          return Array.from(r.querySelectorAll('span')).some(s => (s.textContent || '').trim() === 'AP')
        } catch (e) {
          return false
        }
      }
      const cells = Array.from(row.children).filter(n => n.nodeType === 1)
      const isRowAP = rowHasAcademicLeave(row)
      if (Logger.isDebugMode()) Logger.info(`✨ [HighlightFinalGradesFeature] Row ${rowIdx} has ${cells.length} cells`)
      finalGradeCols.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell) {
          // If this cell was highlighted by Angular (ng-star-inserted + highlight class), leave it unchanged.
          if (
            cell.classList &&
            cell.classList.contains('ng-star-inserted') &&
            (cell.classList.contains('highlight-final-grade-yellow') ||
              cell.classList.contains('highlight-final-grade-red') ||
              cell.classList.contains('highlight-ov-red') ||
              cell.classList.contains('highlight-ov-yellow'))
          ) {
            return
          }
          // If the cell is Angular-rendered (ng-star-inserted) but DOES NOT contain the
          // expected Angular form state classes, skip adding/removing highlights. This prevents
          // highlighting nodes like icons/links that only have `ng-star-inserted`.
          if (
            cell.classList &&
            cell.classList.contains('ng-star-inserted') &&
            !(cell.classList.contains('ng-untouched') && cell.classList.contains('ng-pristine') && cell.classList.contains('ng-valid'))
          ) {
            return
          }
          // Skip highlighting for students on academic leave
          if (isRowAP) {
            cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red')
            return
          }
          if (Logger.isDebugMode())
            Logger.info(`✨ [HighlightFinalGradesFeature] Highlighting FINAL cell at row ${rowIdx}, col ${colIdx}, value: "${cell.textContent.trim()}"`)
          if (!cell.textContent.trim()) {
            if (shouldHighlight) {
              if (inWarningWindow) {
                cell.classList.add('highlight-final-grade-yellow')
                cell.classList.remove('highlight-final-grade-red')
              } else {
                cell.classList.add('highlight-final-grade-red')
                cell.classList.remove('highlight-final-grade-yellow')
              }
            } else {
              cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red')
            }
          } else {
            cell.classList.remove('highlight-final-grade-red', 'highlight-final-grade-yellow')
          }
        }
      })
      ovCols.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell) {
          // If this cell was highlighted by Angular (ng-star-inserted + highlight class), leave it unchanged.
          if (
            cell.classList &&
            cell.classList.contains('ng-star-inserted') &&
            (cell.classList.contains('highlight-final-grade-yellow') ||
              cell.classList.contains('highlight-final-grade-red') ||
              cell.classList.contains('highlight-ov-red') ||
              cell.classList.contains('highlight-ov-yellow'))
          ) {
            return
          }
          // If the cell is Angular-rendered (ng-star-inserted) but DOES NOT contain the
          // expected Angular form state classes, skip adding/removing highlights. This prevents
          // highlighting nodes like icons/links that only have `ng-star-inserted`.
          if (
            cell.classList &&
            cell.classList.contains('ng-star-inserted') &&
            !(cell.classList.contains('ng-untouched') && cell.classList.contains('ng-pristine') && cell.classList.contains('ng-valid'))
          ) {
            return
          }
          // Skip highlighting for students on academic leave
          if (isRowAP) {
            cell.classList.remove('highlight-ov-yellow', 'highlight-ov-red')
            return
          }
          if (Logger.isDebugMode())
            Logger.info(`✨ [HighlightFinalGradesFeature] Highlighting ÕV cell at row ${rowIdx}, col ${colIdx}, value: "${cell.textContent.trim()}"`)
          if (!cell.textContent.trim()) {
            if (shouldHighlight) {
              if (inWarningWindow) {
                cell.classList.add('highlight-ov-yellow')
                cell.classList.remove('highlight-ov-red')
              } else {
                cell.classList.add('highlight-ov-red')
                cell.classList.remove('highlight-ov-yellow')
              }
            } else {
              cell.classList.remove('highlight-ov-yellow', 'highlight-ov-red')
            }
          } else {
            cell.classList.remove('highlight-ov-red', 'highlight-ov-yellow')
          }
        }
      })
    })
  }

  onDeactivate() {
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
    if (this._docObserver) {
      this._docObserver.disconnect()
      this._docObserver = null
    }
    if (this._bannerObserver) {
      this._bannerObserver.disconnect()
      this._bannerObserver = null
    }
    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout)
      this._debounceTimeout = null
    }
    if (this._tableRetryTimeout) {
      clearTimeout(this._tableRetryTimeout)
      this._tableRetryTimeout = null
    }
    this._tableRetryCount = 0
    this.removeFinalGradeBanner()
  }
}

export default HighlightFinalGradesFeature
