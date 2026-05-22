import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import { getNativeJournalHeaderCells } from '../../../lib/journalTableHeaders.js'
import { findEntryIndexForHeader } from '../../../lib/journalEntryColumnMatcher.js'

const POSITIVE_GRADES = new Set(['A', '3', '4', '5'])
const NEGATIVE_GRADES = new Set(['MA', '1', '2', 'X'])
const COMMENT_FAILURE_RETRY_DELAY = 5 * 60 * 1000

function getApiErrorStatus(error) {
  return error?.status || Number(error?.message?.match(/API Error:\s*(\d+)/)?.[1])
}

class HighlightGradeCellsFeature extends BaseFeature {
  constructor() {
    super('highlightGradeCells', /#\/journal\/\d+\/edit/)
    this._observer = null
    this._debounceTimeout = null
    this._activateTimeout = null
    this._formChangeListener = null
    this._mouseOverListener = null
    this._mouseMoveListener = null
    this._mouseOutListener = null
    this._tooltip = null
    this._tooltipSourceCell = null
    this._suppressedTitleCell = null
    this._pendingTooltipCell = null
    this._isActive = false
    this._commentJournalId = null
    this._commentPromise = null
    this._commentLoadedAt = 0
    this._commentFailedAt = 0
    this._gradeCommentCache = new Map()
    this._cellGradeComments = new WeakMap()
    this._studentIdToJournalStudentId = new Map()
    this._journalEntries = []
    this._idleRetryCount = 0
    this.styleId = 'highlight-grade-cells-style'
  }

  onActivate() {
    this._isActive = true
    if (Logger.isDebugMode()) Logger.debug('[HighlightGradeCellsFeature] onActivate called')
    this._formChangeListener = event => {
      const cell = this._getJournalCell(event.target)
      if (cell) this._updateSingleCell(cell)
    }
    document.addEventListener('change', this._formChangeListener, true)
    this._setupTooltipListeners()
    this._activateTimeout = setTimeout(() => {
      this._activateTimeout = null
      this.run()
      this._setupObserver()
    }, 1000)
  }

  onDeactivate() {
    this._isActive = false
    if (this._activateTimeout) {
      clearTimeout(this._activateTimeout)
      this._activateTimeout = null
    }
    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout)
      this._debounceTimeout = null
    }
    this._idleRetryCount = 0
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
    if (this._formChangeListener) {
      document.removeEventListener('change', this._formChangeListener, true)
      this._formChangeListener = null
    }
    this._removeTooltipListeners()
    this._clearCommentCache()
    this._commentJournalId = null
    this._commentPromise = null
    this._commentFailedAt = 0
    this._removeHighlights()
  }

  injectCSS() {
    styleService.injectCSS(
      `
        td.oa2-grade-cell-positive {
          background-color: #b6e1cd !important;
          box-shadow:
            inset -1px 0 0 rgba(58, 118, 88, 0.18),
            inset 0 -1px 0 rgba(58, 118, 88, 0.14) !important;
          cursor: default !important;
          text-align: center !important;
          vertical-align: middle !important;
        }

        td.oa2-grade-cell-negative {
          background-color: #f4c7c3 !important;
          box-shadow:
            inset -1px 0 0 rgba(147, 68, 61, 0.17),
            inset 0 -1px 0 rgba(147, 68, 61, 0.13) !important;
          cursor: default !important;
          text-align: center !important;
          vertical-align: middle !important;
        }

        td.oa2-grade-cell-ap-empty {
          background-color: #efefef !important;
          cursor: default !important;
          text-align: center !important;
          vertical-align: middle !important;
        }

        td.oa2-grade-cell-positive > *,
        td.oa2-grade-cell-negative > *,
        td.oa2-grade-cell-ap-empty > * {
          background-color: transparent !important;
        }

        td.oa2-grade-cell-positive .grade-cell .valid-grading-schema,
        td.oa2-grade-cell-positive .grade-cell .invalid-grading-schema:not(.negative),
        td.oa2-grade-cell-positive select.grade-select {
          color: #0b7a4b !important;
        }

        td.oa2-grade-cell-positive .grade-cell,
        td.oa2-grade-cell-negative .grade-cell {
          align-items: center !important;
          cursor: default !important;
          justify-content: center !important;
          text-align: center !important;
        }

        td.oa2-grade-cell-positive .grade-cell span,
        td.oa2-grade-cell-negative .grade-cell span {
          cursor: default !important;
        }

        td.oa2-grade-cell-positive textarea,
        td.oa2-grade-cell-negative textarea {
          cursor: text !important;
        }

        td.oa2-grade-cell-positive tahvel-tooltip,
        td.oa2-grade-cell-negative tahvel-tooltip {
          display: none !important;
          pointer-events: none !important;
        }

        .oa2-grade-tooltip {
          position: fixed;
          z-index: 2147483647;
          max-width: 320px;
          padding: 6px 8px;
          border-radius: 4px;
          background: rgba(33, 37, 41, 0.96);
          color: #fff;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.22);
          font-size: 12px;
          line-height: 1.35;
          pointer-events: none;
          white-space: pre-wrap;
        }
      `,
      this.styleId
    )
  }

  run() {
    this.injectCSS()
    this._hideTooltipIfSourceInvalid()

    if (this._isTahvelBusy()) {
      this._scheduleRunWhenIdle()
      return
    }
    this._idleRetryCount = 0

    const table = this._findJournalTable()
    if (!table) {
      if (Logger.isDebugMode()) Logger.debug('[HighlightGradeCellsFeature] journal table not found')
      return
    }

    const rows = Array.from(table.querySelectorAll('tbody tr'))
    const columnGrades = new Map()
    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(table)

    rows.forEach(row => {
      const cells = Array.from(row.children)
      cells.forEach((cell, columnIndex) => {
        if (columnIndex < firstGradeColumnIndex || cell.tagName !== 'TD') return
        const gradeType = this._getGradeType(this._getCellValue(cell))
        if (gradeType) columnGrades.set(columnIndex, true)
      })
    })

    const academicLeaveRows = new Set()
    rows.forEach(row => {
      if (this._isAcademicLeaveRow(row, firstGradeColumnIndex)) academicLeaveRows.add(row)
    })

    if (columnGrades.size === 0 && academicLeaveRows.size === 0) {
      this._removeHighlights(table)
      return
    }

    rows.forEach(row => {
      const cells = Array.from(row.children)
      cells.forEach((cell, columnIndex) => {
        if (cell.tagName !== 'TD') return

        const cellValue = this._getCellValue(cell)
        const gradeType = columnGrades.has(columnIndex) ? this._getGradeType(cellValue) : null
        const isAcademicLeaveEmpty = this._isAcademicLeaveEmptyCell(row, cellValue, columnIndex, firstGradeColumnIndex, academicLeaveRows)
        this._setGradeClass(cell, gradeType, { isAcademicLeaveEmpty })
      })
    })

    this._applyGradeComments(table, rows, firstGradeColumnIndex)
  }

  _setupObserver() {
    if (this._observer) this._observer.disconnect()
    if (!document.body) return
    this._observer = new MutationObserver(mutations => {
      if (!this._shouldHandleMutations(mutations)) return
      this._hideTooltipIfSourceInvalid()
      if (this._isTahvelBusy()) {
        this._scheduleRunWhenIdle()
        return
      }
      if (this._hasOpenQuickUpdate()) {
        this._updateOpenQuickUpdateColumns()
        return
      }
      if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
      this._debounceTimeout = setTimeout(() => {
        this.run()
      }, 100)
    })
    this._observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  _shouldHandleMutations(mutations) {
    const table = this._findJournalTable()
    return mutations.some(mutation => !this._isTooltipMutation(mutation) && this._isJournalTableMutation(mutation, table))
  }

  _isTooltipMutation(mutation) {
    if (this._isTooltipNode(mutation.target)) return true
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes]
    return changedNodes.length > 0 && changedNodes.every(node => this._isTooltipNode(node))
  }

  _isTooltipNode(node) {
    if (!node) return false
    const element = node.nodeType === 1 ? node : node.parentElement
    if (!element) return false
    const tooltipSelector = '.oa2-grade-tooltip, tahvel-tooltip'

    return element.matches?.(tooltipSelector) || Boolean(element.closest?.(tooltipSelector))
  }

  _isJournalTableMutation(mutation, table) {
    if (!table) {
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node => this._containsJournalTable(node))
    }

    const target = mutation.target
    if (target === table || table.contains(target)) return true
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node => {
      if (!node || node.nodeType !== 1) return false
      return node === table || table.contains(node) || node.contains?.(table)
    })
  }

  _containsJournalTable(node) {
    if (!node || node.nodeType !== 1) return false
    if (node.tagName === 'TABLE' && this._isJournalTable(node)) return true
    return Array.from(node.querySelectorAll?.('table') || []).some(table => this._isJournalTable(table))
  }

  _isTahvelBusy() {
    const busySelectors = [
      '.modal-background',
      '.modal-overlay',
      '.dialog-overlay',
      '.spinner',
      '.loading',
      '.progress',
      'md-progress-circular',
      'mat-progress-spinner'
    ]
    return Array.from(document.querySelectorAll(busySelectors.join(','))).some(element => {
      const style = window.getComputedStyle ? window.getComputedStyle(element) : null
      if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false

      const className = element.className?.toString?.() || ''
      if (/spinner|loading|progress|modal-background|modal-overlay|dialog-overlay/.test(className)) return true
      return ['MD-PROGRESS-CIRCULAR', 'MAT-PROGRESS-SPINNER'].includes(element.tagName)
    })
  }

  _hasOpenQuickUpdate() {
    const table = this._findJournalTable()
    return Boolean(table?.querySelector('.quick-update, select.grade-select, tahvel-grade-select select'))
  }

  _updateOpenQuickUpdateColumns() {
    const table = this._findJournalTable()
    if (!table) return
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(table)
    const openColumnIndexes = new Set()

    table.querySelectorAll('select.grade-select, tahvel-grade-select select').forEach(select => {
      const cell = this._getJournalCell(select)
      const columnIndex = Array.from(cell?.parentElement?.children || []).indexOf(cell)
      if (columnIndex >= firstGradeColumnIndex) openColumnIndexes.add(columnIndex)
    })

    openColumnIndexes.forEach(columnIndex => {
      const columnHasGrade = rows.some(row => {
        const cell = row.children[columnIndex]
        return cell?.tagName === 'TD' && this._getGradeType(this._getCellValue(cell))
      })
      rows.forEach(row => {
        const cell = row.children[columnIndex]
        if (cell?.tagName !== 'TD') return
        const cellValue = this._getCellValue(cell)
        const gradeType = columnHasGrade ? this._getGradeType(cellValue) : null
        const isAcademicLeaveEmpty = this._isAcademicLeaveEmptyCell(row, cellValue, columnIndex, firstGradeColumnIndex)
        this._setGradeClass(cell, gradeType, { isAcademicLeaveEmpty })
      })
    })
  }

  _scheduleRunWhenIdle() {
    if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
    if (this._idleRetryCount >= 40) return
    this._idleRetryCount += 1
    this._debounceTimeout = setTimeout(() => {
      if (this._isTahvelBusy()) {
        this._scheduleRunWhenIdle()
        return
      }
      this.run()
    }, 300)
  }

  _findJournalTable() {
    const selectors = [
      '#studentTable table.tahvel-table',
      '#studentTable table',
      '.tahvel-table-wrapper#studentTable table',
      '.layout-padding table.tahvel-table',
      '.layout-padding table.journalTable',
      'table.journalTable',
      'table.tahvel-table.with-borders'
    ]

    for (const selector of selectors) {
      const table = document.querySelector(selector)
      if (this._isJournalTable(table)) return table
    }

    return null
  }

  _isJournalTable(table) {
    if (!table) return false
    const headers = this._getNativeHeaderCells(table).map(th => (th.textContent || '').trim().toLowerCase())
    return headers.some(header => header.includes('õppija'))
  }

  _getFirstGradeColumnIndex(table) {
    const headers = this._getNativeHeaderCells(table)
    const studentHeaderIndex = headers.findIndex(th => (th.textContent || '').trim().toLowerCase().includes('õppija'))
    return studentHeaderIndex >= 0 ? studentHeaderIndex + 1 : 2
  }

  _getNativeHeaderCells(table) {
    return getNativeJournalHeaderCells(table)
  }

  _getCellValue(cell) {
    const gradeSelect = cell.querySelector('select.grade-select, tahvel-grade-select select, select')
    if (gradeSelect) {
      const selectedOptionText = gradeSelect.selectedOptions?.[0]?.textContent
      return this._normalizeGradeValue(selectedOptionText ?? gradeSelect.value)
    }

    return this._normalizeGradeValue(this._getCellTextWithoutComments(cell))
  }

  _getCellTextWithoutComments(cell) {
    const clone = cell.cloneNode(true)
    clone.querySelectorAll('tahvel-tooltip, .oa2-grade-tooltip, textarea').forEach(element => element.remove())
    return clone.innerText || clone.textContent || ''
  }

  _normalizeGradeValue(value) {
    // Cells with grade-modification history render as "4 * / 4 * / 3" where
    // only the trailing segment is the current grade and `*` marks a change.
    // Take just the last grade so classification reflects the current value.
    const collapsed = (value || '').replace(/\s+/g, ' ').trim().toUpperCase()
    if (!collapsed.includes('/')) return collapsed
    const segments = collapsed.split('/')
    return (segments[segments.length - 1] || '').replace(/\*/g, '').replace(/\s+/g, '').toUpperCase()
  }

  _getGradeType(value) {
    if (POSITIVE_GRADES.has(value)) return 'positive'
    if (NEGATIVE_GRADES.has(value)) return 'negative'
    return null
  }

  _isAcademicLeaveRow(row, firstGradeColumnIndex = 0) {
    if (!row?.children) return false
    const studentCells = Array.from(row.children).slice(0, firstGradeColumnIndex)
    return studentCells.some(cell => Array.from(cell.querySelectorAll('i span, i')).some(element => this._normalizeGradeValue(element.textContent) === 'AP'))
  }

  _isAcademicLeaveEmptyCell(row, cellValue, columnIndex, firstGradeColumnIndex, academicLeaveRows = null) {
    if (columnIndex < firstGradeColumnIndex || cellValue !== '') return false
    return academicLeaveRows ? academicLeaveRows.has(row) : this._isAcademicLeaveRow(row, firstGradeColumnIndex)
  }

  _setGradeClass(cell, gradeType, { isAcademicLeaveEmpty = false } = {}) {
    cell.classList.toggle('oa2-grade-cell-positive', gradeType === 'positive')
    cell.classList.toggle('oa2-grade-cell-negative', gradeType === 'negative')
    cell.classList.toggle('oa2-grade-cell-ap-empty', !gradeType && isAcademicLeaveEmpty)
  }

  _getJournalCell(target) {
    if (!target?.closest) return null
    const cell = target.closest('td')
    if (!cell) return null
    const table = this._findJournalTable()
    return table?.contains(cell) ? cell : null
  }

  _updateSingleCell(cell) {
    const cellValue = this._getCellValue(cell)
    const gradeType = this._getGradeType(cellValue)
    const table = this._findJournalTable()
    const firstGradeColumnIndex = table ? this._getFirstGradeColumnIndex(table) : 0
    const columnIndex = Array.from(cell.parentElement?.children || []).indexOf(cell)
    const isAcademicLeaveEmpty = this._isAcademicLeaveEmptyCell(cell.parentElement, cellValue, columnIndex, firstGradeColumnIndex)
    this._setGradeClass(cell, gradeType, { isAcademicLeaveEmpty })
    if (!gradeType) this._cellGradeComments.delete(cell)
  }

  _loadGradeComments(firstGradeColumnIndex) {
    const journalId = this._getJournalId()
    if (!journalId || !this.api?.tahvel) return Promise.resolve()
    if (this._commentJournalId === journalId && this._commentPromise) return this._commentPromise
    if (
      this._commentJournalId === journalId &&
      this._commentFailedAt &&
      Date.now() - this._commentFailedAt < COMMENT_FAILURE_RETRY_DELAY
    ) return Promise.resolve()
    if (this._commentJournalId === journalId && Date.now() - this._commentLoadedAt < 6e4) return Promise.resolve()

    if (this._commentJournalId !== journalId) {
      this._clearCommentCache()
      this._commentFailedAt = 0
    }
    this._commentJournalId = journalId
    this._commentPromise = Promise.all([
      this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: true, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] }),
      this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: true, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] })
    ])
      .then(([entries, journalStudents]) => {
        if (!this._isActive || this._getJournalId() !== journalId) return
        this._buildGradeCommentCache(entries, journalStudents)
        this._commentLoadedAt = Date.now()
        this._commentFailedAt = 0
        const table = this._findJournalTable()
        if (!table) return
        this._applyGradeComments(table, Array.from(table.querySelectorAll('tbody tr')), firstGradeColumnIndex)
      })
      .catch(error => {
        if (Logger.isDebugMode()) Logger.debug('[HighlightGradeCellsFeature] failed to load grade comments', error)
        if (this._getJournalId() === journalId) {
          this._clearCommentCache()
          if ([403, 412].includes(getApiErrorStatus(error))) this._commentFailedAt = Date.now()
        }
      })
      .finally(() => {
        if (this._commentJournalId === journalId) this._commentPromise = null
      })

    return this._commentPromise
  }

  _clearCommentCache() {
    this._gradeCommentCache = new Map()
    this._cellGradeComments = new WeakMap()
    this._studentIdToJournalStudentId = new Map()
    this._journalEntries = []
    this._commentLoadedAt = 0
  }

  _getJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  _buildGradeCommentCache(entries, journalStudents) {
    this._gradeCommentCache = new Map()
    this._studentIdToJournalStudentId = new Map()
    this._journalEntries = Array.isArray(entries) ? entries : []

    if (Array.isArray(journalStudents)) {
      journalStudents.forEach(student => {
        if (student?.studentId && student?.id) this._studentIdToJournalStudentId.set(String(student.studentId), String(student.id))
      })
    }

    this._journalEntries.forEach((entry, entryIndex) => {
      Object.entries(entry?.journalStudentResults || {}).forEach(([journalStudentId, results]) => {
        const addInfo = Array.isArray(results) ? results[0]?.addInfo : results?.addInfo
        if (addInfo?.trim()) this._gradeCommentCache.set(`${entryIndex}:${journalStudentId}`, addInfo.trim())
      })
    })
  }

  _applyGradeComments(table, rows, firstGradeColumnIndex) {
    const columnEntryIndexes = this._getColumnEntryIndexes(table, firstGradeColumnIndex)

    rows.forEach(row => {
      const journalStudentId = this._getJournalStudentId(row)
      Array.from(row.children).forEach((cell, columnIndex) => {
        if (cell.tagName !== 'TD') return
        if (!cell.classList.contains('oa2-grade-cell-positive') && !cell.classList.contains('oa2-grade-cell-negative')) {
          this._cellGradeComments.delete(cell)
          return
        }

        const entryIndex = columnEntryIndexes.get(columnIndex) ?? columnIndex - firstGradeColumnIndex
        const comment = journalStudentId ? this._gradeCommentCache.get(`${entryIndex}:${journalStudentId}`) : null
        if (comment) this._cellGradeComments.set(cell, comment)
        else this._cellGradeComments.delete(cell)
      })
    })
  }

  _getJournalStudentId(row) {
    const studentLink = row.querySelector('a[href*="/students/"]')
    const studentId = studentLink?.getAttribute('href')?.match(/\/students\/(\d+)/)?.[1]
    return studentId ? this._studentIdToJournalStudentId.get(studentId) : null
  }

  _getColumnEntryIndexes(table, firstGradeColumnIndex) {
    const columnEntryIndexes = new Map()
    if (!this._journalEntries.length) return columnEntryIndexes

    const usedEntryIndexes = new Set()
    const headers = this._getNativeHeaderCells(table)
    headers.forEach((header, columnIndex) => {
      if (columnIndex < firstGradeColumnIndex) return
      const entryIndex = this._findEntryIndexForHeader(header, usedEntryIndexes)
      if (entryIndex !== null) {
        usedEntryIndexes.add(entryIndex)
        columnEntryIndexes.set(columnIndex, entryIndex)
      }
    })

    return columnEntryIndexes
  }

  _findEntryIndexForHeader(header, usedEntryIndexes) {
    return findEntryIndexForHeader(header, this._journalEntries, usedEntryIndexes)
  }

  _setupTooltipListeners() {
    if (this._mouseOverListener) return

    this._mouseOverListener = event => {
      const cell = this._getHighlightedCell(event.target)
      if (!cell) return

      this._pendingTooltipCell = cell
      const tooltipText = this._getTooltipText(cell)
      if (!tooltipText) {
        this._hideTooltip()
        this._loadGradeCommentsForCell(cell, event)
        return
      }

      this._showTooltip(tooltipText, event, cell)
    }
    this._mouseMoveListener = event => {
      const cell = this._getHighlightedCell(event.target)
      if (!cell) return

      this._positionTooltip(event)
    }
    this._mouseOutListener = event => {
      const cell = this._getHighlightedCell(event.target)
      if (!cell || cell.contains(event.relatedTarget)) return
      if (this._pendingTooltipCell === cell) this._pendingTooltipCell = null
      this._hideTooltip()
    }

    document.addEventListener('mouseover', this._mouseOverListener, true)
    document.addEventListener('mousemove', this._mouseMoveListener, true)
    document.addEventListener('mouseout', this._mouseOutListener, true)
  }

  _removeTooltipListeners() {
    if (this._mouseOverListener) {
      document.removeEventListener('mouseover', this._mouseOverListener, true)
      this._mouseOverListener = null
    }
    if (this._mouseMoveListener) {
      document.removeEventListener('mousemove', this._mouseMoveListener, true)
      this._mouseMoveListener = null
    }
    if (this._mouseOutListener) {
      document.removeEventListener('mouseout', this._mouseOutListener, true)
      this._mouseOutListener = null
    }
    this._pendingTooltipCell = null
    this._restoreSuppressedTitle()
    this._hideTooltip()
  }

  _getHighlightedCell(target) {
    if (!target?.closest) return null
    return target.closest('td.oa2-grade-cell-positive, td.oa2-grade-cell-negative')
  }

  _getTooltipText(cell) {
    const textarea = cell.querySelector('textarea')
    const textareaValue = textarea?.value || textarea?.textContent
    if (textareaValue?.trim()) return textareaValue.trim()

    const comment = this._cellGradeComments.get(cell)
    if (comment?.trim()) return comment.trim()

    const title = cell.getAttribute('title') || cell.querySelector('[title]')?.getAttribute('title')
    if (title?.trim()) return title.trim()

    const ariaLabel = cell.getAttribute('aria-label') || cell.querySelector('[aria-label]')?.getAttribute('aria-label')
    if (ariaLabel?.trim()) return ariaLabel.trim()

    const tooltipText = cell.querySelector('tahvel-tooltip')?.textContent
    if (tooltipText?.trim()) return tooltipText.trim()

    return ''
  }

  _loadGradeCommentsForCell(cell, event) {
    const table = this._findJournalTable()
    if (!table || !cell.isConnected || this._isTahvelBusy()) return

    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(table)
    const columnIndex = Array.from(cell.parentElement?.children || []).indexOf(cell)
    if (columnIndex < firstGradeColumnIndex) return

    this._loadGradeComments(firstGradeColumnIndex)?.then(() => {
      if (!cell.isConnected || this._pendingTooltipCell !== cell) return
      this._applyGradeComments(table, [cell.parentElement], firstGradeColumnIndex)
      const tooltipText = this._getTooltipText(cell)
      if (tooltipText) this._showTooltip(tooltipText, event, cell)
    })
  }

  _showTooltip(text, event, sourceCell) {
    if (!this._tooltip) {
      this._tooltip = document.createElement('div')
      this._tooltip.className = 'oa2-grade-tooltip'
      document.body.appendChild(this._tooltip)
    }
    this._tooltipSourceCell = sourceCell
    this._tooltip.textContent = text
    this._tooltip.hidden = false
    this._suppressNativeTitle(sourceCell)
    this._positionTooltip(event)
  }

  _suppressNativeTitle(cell) {
    if (this._suppressedTitleCell && this._suppressedTitleCell !== cell) this._restoreSuppressedTitle()
    if (!cell?.hasAttribute?.('title')) return

    cell.dataset.oa2SuppressedTitle = cell.getAttribute('title') || ''
    cell.removeAttribute('title')
    this._suppressedTitleCell = cell
  }

  _restoreSuppressedTitle() {
    const cell = this._suppressedTitleCell
    this._suppressedTitleCell = null
    if (!cell?.isConnected || !Object.hasOwn(cell.dataset || {}, 'oa2SuppressedTitle')) return

    const title = cell.dataset.oa2SuppressedTitle
    if (title) cell.setAttribute('title', title)
    else cell.removeAttribute('title')
    delete cell.dataset.oa2SuppressedTitle
  }

  _positionTooltip(event) {
    if (!this._tooltip || this._tooltip.hidden) return
    const offset = 10
    const tooltipRect = this._tooltip.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const left = Math.min(event.clientX + offset, viewportWidth - tooltipRect.width - offset)
    const top = Math.min(event.clientY + offset, viewportHeight - tooltipRect.height - offset)

    this._tooltip.style.left = `${Math.max(offset, left)}px`
    this._tooltip.style.top = `${Math.max(offset, top)}px`
  }

  _hideTooltip() {
    this._restoreSuppressedTitle()
    if (this._tooltip) {
      this._tooltip.remove()
      this._tooltip = null
    }
    this._tooltipSourceCell = null
  }

  _hideTooltipIfSourceInvalid() {
    if (!this._tooltipSourceCell) return
    const isStillHighlighted = this._tooltipSourceCell.matches('.oa2-grade-cell-positive, .oa2-grade-cell-negative')
    if (!this._tooltipSourceCell.isConnected || !isStillHighlighted) this._hideTooltip()
  }

  _removeHighlights(root = document) {
    root.querySelectorAll('.oa2-grade-cell-positive, .oa2-grade-cell-negative, .oa2-grade-cell-ap-empty').forEach(cell => {
      cell.classList.remove('oa2-grade-cell-positive', 'oa2-grade-cell-negative', 'oa2-grade-cell-ap-empty')
    })
  }
}

export default HighlightGradeCellsFeature
