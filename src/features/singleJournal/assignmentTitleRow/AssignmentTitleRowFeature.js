import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import EstonianHyphenator from '../../../lib/EstonianHyphenator.js'
import { extractOutcomeNumbersFromEntryName } from '../../../lib/extractOutcomeNumbersFromEntryName.js'
import {
  ASSIGNMENT_OUTCOME_ROW_CLASS,
  ASSIGNMENT_TITLE_ROW_CLASS,
  getNativeJournalHeaderRows
} from '../../../lib/journalTableHeaders.js'
import { findEntryIndexForHeader } from '../../../lib/journalEntryColumnMatcher.js'

const CONTENT_FALLBACK_LABELS = new Set([
  'e-õpe',
  'hindamine',
  'iseseisev töö',
  'perioodi hinne',
  'praktiline töö',
  'tund'
])
const ENTRY_DETAIL_CONCURRENCY = 4

class AssignmentTitleRowFeature extends BaseFeature {
  constructor() {
    super('assignmentTitleRow', /#\/journal\/\d+\/edit/)
    this._observer = null
    this._debounceTimeout = null
    this._activateTimeout = null
    this._entriesPromise = null
    this._entriesJournalId = null
    this._entryDetailCache = new Map()
    this._entryDetailLoadFailed = false
    this._runVersion = 0
    this._mouseOverListener = null
    this._mouseMoveListener = null
    this._mouseOutListener = null
    this._saveClickListener = null
    this._postSaveRefreshTimeouts = []
    this._forceRefreshUntil = 0
    this._pendingPostSaveForceRefresh = false
    this._tooltip = null
    this._tableWrapper = null
    this._tableWrapperOriginalInlineHeight = ''
    this._tableWrapperOriginalInlineMaxHeight = ''
    this._tableWrapperOriginalInlineOverflowY = ''
    this._tableWrapperBaseHeight = 0
    this._tableWrapperBaseMaxHeight = 0
    this.styleId = 'oa2-assignment-title-row-style'
    this.rowClass = ASSIGNMENT_TITLE_ROW_CLASS
    this.outcomeRowClass = ASSIGNMENT_OUTCOME_ROW_CLASS
  }

  onActivate() {
    this._injectCSS()
    this._setupTooltipListeners()
    this._setupSaveListener()
    this._activateTimeout = setTimeout(() => {
      this._activateTimeout = null
      void this.run()
    }, 1000)
  }

  onJournalDataChanged(journalId) {
    if (this._entriesJournalId && Number(journalId) === Number(this._entriesJournalId)) {
      this._invalidateEntriesCache()
      this._entryDetailCache.clear()
    }
  }

  onDeactivate() {
    if (this._activateTimeout) {
      clearTimeout(this._activateTimeout)
      this._activateTimeout = null
    }
    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout)
      this._debounceTimeout = null
    }
    this._clearPostSaveRefreshTimeouts()
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
    this._runVersion += 1
    this._invalidateEntriesCache()
    this._entryDetailCache.clear()
    this._removeTooltipListeners()
    this._removeSaveListener()
    this._restoreTableWrapperHeight()
    this._removeTitleRow()
    super.onDeactivate()
  }

  _injectCSS() {
    styleService.injectCSS(
      `
        @keyframes oa2-assignment-title-slide-up {
          from {
            opacity: 0;
            transform: translateY(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        thead tr.oa2-assignment-outcome-row th {
          padding: 1px 2px !important;
          height: 1.65em !important;
          background: #fff !important;
          border-right: 1px solid #d9d9d6 !important;
          border-left: 0 !important;
          border-bottom: 1px solid #d9d9d6 !important;
          box-sizing: border-box !important;
          text-align: center !important;
          vertical-align: middle !important;
        }

        thead tr.oa2-assignment-outcome-row th.oa2-assignment-row__spacer {
          border-right-color: transparent !important;
        }

        thead tr.oa2-assignment-title-row th.oa2-assignment-row__spacer {
          border-right: 1px solid #d9d9d6 !important;
        }

        .oa2-assignment-outcome-row__badges {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          width: 100%;
          min-height: 1.2em;
        }

        .oa2-assignment-outcome-row__badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.6em;
          padding: 0 4px;
          border-radius: 999px;
          background: #e8f1ff;
          color: #1f4f99;
          font-size: 8px;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
        }

        thead tr.oa2-assignment-title-row,
        thead tr.oa2-assignment-title-row > th {
          animation: oa2-assignment-title-slide-up 560ms ease-out both;
        }

        thead tr.oa2-assignment-title-row th {
          padding: 1px 2px !important;
          height: 2.55em !important;
          background: #fff !important;
          border-right: 1px solid #d9d9d6 !important;
          border-left: 0 !important;
          border-bottom: 1px solid #d9d9d6 !important;
          box-sizing: border-box !important;
          color: #52606d !important;
          font-size: 8.5px !important;
          font-weight: 400 !important;
          font-family: 'Arial Narrow', Arial, sans-serif !important;
          line-height: 1.05 !important;
          letter-spacing: -0.01em !important;
          text-align: center !important;
          vertical-align: middle !important;
        }

        thead tr.oa2-assignment-title-row th .oa2-assignment-title-row__text {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 2.1em;
          max-height: 2.1em;
          margin: 0;
          overflow: hidden;
          hyphens: manual;
          overflow-wrap: normal;
          text-align: center;
          white-space: normal;
          word-break: normal;
        }

        .oa2-assignment-title-row__text--truncated {
          cursor: help;
        }

        .oa2-assignment-title-row__tooltip {
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

  _setupTooltipListeners() {
    if (this._mouseOverListener) return

    this._mouseOverListener = event => {
      const target = event.target?.closest?.('.oa2-assignment-title-row__text--truncated')
      if (!target) return
      const tooltipText = target.dataset.tooltipText || ''
      if (!tooltipText) return
      this._showTooltip(tooltipText, event)
    }

    this._mouseMoveListener = event => {
      if (!this._tooltip) return
      this._positionTooltip(event)
    }

    this._mouseOutListener = event => {
      const target = event.target?.closest?.('.oa2-assignment-title-row__text--truncated')
      if (!target || target.contains(event.relatedTarget)) return
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
    this._hideTooltip()
  }

  _setupSaveListener() {
    if (this._saveClickListener) return

    this._saveClickListener = event => {
      if (!this._isEntrySaveButtonClick(event)) return
      this._schedulePostSaveRefresh()
    }

    document.addEventListener('click', this._saveClickListener, true)
  }

  _removeSaveListener() {
    if (!this._saveClickListener) return
    document.removeEventListener('click', this._saveClickListener, true)
    this._saveClickListener = null
  }

  _isEntrySaveButtonClick(event) {
    const button = event.target?.closest?.('button')
    if (!button || button.disabled) return false

    const label = (button.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase()
    if (label !== 'SALVESTA') return false

    return Boolean(button.closest('add-entry'))
  }

  _schedulePostSaveRefresh() {
    this._clearPostSaveRefreshTimeouts()
    this._forceRefreshUntil = Date.now() + 5000
    this._pendingPostSaveForceRefresh = true

    this._postSaveRefreshTimeouts = [1200, 3000].map(delay => {
      const timeoutId = setTimeout(() => {
        this._postSaveRefreshTimeouts = this._postSaveRefreshTimeouts.filter(timeout => timeout !== timeoutId)
        this._forceRefreshAfterSave()
      }, delay)
      return timeoutId
    })
  }

  _clearPostSaveRefreshTimeouts() {
    this._postSaveRefreshTimeouts.forEach(timeout => clearTimeout(timeout))
    this._postSaveRefreshTimeouts = []
    this._forceRefreshUntil = 0
    this._pendingPostSaveForceRefresh = false
  }

  _forceRefreshAfterSave() {
    this._invalidateEntriesCache()
    this._entryDetailCache.clear()
    void this.run({ forceRefresh: true })
  }

  _showTooltip(text, event) {
    if (!this._tooltip) {
      this._tooltip = document.createElement('div')
      this._tooltip.className = 'oa2-assignment-title-row__tooltip'
      document.body.appendChild(this._tooltip)
    }
    this._tooltip.textContent = text
    this._tooltip.hidden = false
    this._positionTooltip(event)
  }

  _positionTooltip(event) {
    if (!this._tooltip) return
    this._tooltip.style.left = `${event.clientX + 12}px`
    this._tooltip.style.top = `${event.clientY + 12}px`
  }

  _hideTooltip() {
    if (!this._tooltip) return
    this._tooltip.remove()
    this._tooltip = null
  }

  _setupObserver(table = this._findJournalTable()) {
    if (this._observer) this._observer.disconnect()
    if (!document.body) return
    const target = table?.closest?.('#studentTable, .tahvel-table-wrapper') || table || document.body
    const isBootstrapObserver = target === document.body

    this._observer = new MutationObserver(mutations => {
      const journalTable = isBootstrapObserver ? null : this._findJournalTableInTarget(target)
      const hasRelevantMutation = mutations.some(mutation => this._isRelevantMutation(mutation, journalTable))
      if (!hasRelevantMutation) return

      const clearPostSaveForceRefreshOnSuccess = this._pendingPostSaveForceRefresh
      const forceRefresh = clearPostSaveForceRefreshOnSuccess || Date.now() < this._forceRefreshUntil
      this._invalidateEntriesCache()

      if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
      this._debounceTimeout = setTimeout(() => {
        this._debounceTimeout = null
        void this.run({ forceRefresh, clearPostSaveForceRefreshOnSuccess })
      }, 100)
    })

    this._observer.observe(target, { childList: true, subtree: true, characterData: !isBootstrapObserver })
  }

  _isRelevantMutation(mutation, journalTable = this._findJournalTable()) {
    const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement
    if (!target) return false
    if (this._isOwnedHeaderRowElement(target)) return false

    if (mutation.type === 'characterData') return Boolean(journalTable && target.closest('thead') && journalTable.contains(target))
    if (mutation.type !== 'childList') return false

    const changedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]
    if (changedNodes.length === 0) return false
    if (changedNodes.length > 0 && changedNodes.every(node => this._isOwnedMutationNode(node))) return false
    if (!journalTable) return changedNodes.some(node => this._containsJournalTable(node))

    const relevantTags = new Set(['TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'])
    if (target !== journalTable && !journalTable.contains(target)) {
      return changedNodes.some(node => node.nodeType === 1 && (node === journalTable || journalTable.contains(node)))
    }

    return changedNodes.some(node => {
      if (node.nodeType !== 1) return false
      if (this._isOwnedMutationNode(node)) return false
      return relevantTags.has(node.tagName)
    })
  }

  async run({ forceRefresh = false, clearPostSaveForceRefreshOnSuccess = false } = {}) {
    const runVersion = ++this._runVersion
    this._entryDetailLoadFailed = false
    const table = this._findJournalTable()
    if (!table) {
      this._removeTitleRow()
      this._setupObserver(null)
      return
    }

    const headerCells = this._getHeaderColumnCells(table)
    if (!headerCells.length) {
      this._removeTitleRow(table)
      this._setupObserver(table)
      return
    }

    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(headerCells)
    let journalEntries = await this._loadJournalEntries({ forceRefresh })
    if (!this.isActive || runVersion !== this._runVersion || !table.isConnected) return

    let titles = this._buildTitles(headerCells, firstGradeColumnIndex, journalEntries)
    const detailedEntries = await this._loadDetailedEntriesForTitles(titles, { forceRefresh })
    if (!this.isActive || runVersion !== this._runVersion || !table.isConnected) return
    if (detailedEntries.size > 0) {
      journalEntries = journalEntries.map(entry => detailedEntries.get(entry?.id) || entry)
      titles = this._buildTitles(headerCells, firstGradeColumnIndex, journalEntries)
    }

    if (!titles.some(item => item.title)) {
      this._restoreTableWrapperHeight()
      this._removeTitleRow(table)
      this._setupObserver(table)
      return
    }

    this._renderOutcomeRow(table, titles)
    this._renderTitleRow(table, titles)
    this._adjustTableWrapperHeight(table)
    this._setupObserver(table)
    if (clearPostSaveForceRefreshOnSuccess && !this._entryDetailLoadFailed) this._pendingPostSaveForceRefresh = false
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

  _findJournalTableInTarget(target) {
    if (target?.tagName === 'TABLE' && this._isJournalTable(target)) return target
    return Array.from(target?.querySelectorAll?.('table') || []).find(table => this._isJournalTable(table)) || null
  }

  _containsJournalTable(node) {
    if (!node || node.nodeType !== 1) return false
    if (node.tagName === 'TABLE' && this._isJournalTable(node)) return true
    return Array.from(node.querySelectorAll?.('table') || []).some(table => this._isJournalTable(table))
  }

  _isJournalTable(table) {
    if (!table) return false
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => (th.textContent || '').trim().toLowerCase())
    return headers.some(header => header.includes('õppija'))
  }

  _getFirstGradeColumnIndex(headerCells) {
    const studentHeaderIndex = headerCells.findIndex(cell => (cell.textContent || '').trim().toLowerCase().includes('õppija'))
    return studentHeaderIndex >= 0 ? studentHeaderIndex + 1 : 2
  }

  _getHeaderColumnCells(table) {
    const rows = Array.from(table.querySelectorAll('thead tr')).filter(row => !this._isOwnedHeaderRowElement(row))
    if (!rows.length) return []

    const occupancy = []
    const grid = rows.map(() => [])

    rows.forEach((row, rowIndex) => {
      let columnIndex = 0
      Array.from(row.children).forEach(cell => {
        while (occupancy[columnIndex] > rowIndex) columnIndex += 1

        const colSpan = Number(cell.getAttribute('colspan') || 1)
        const rowSpan = Number(cell.getAttribute('rowspan') || 1)

        for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
          const targetColumnIndex = columnIndex + colOffset
          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
            const targetRowIndex = rowIndex + rowOffset
            if (!grid[targetRowIndex]) continue
            grid[targetRowIndex][targetColumnIndex] = cell
          }
          occupancy[targetColumnIndex] = rowIndex + rowSpan
        }

        columnIndex += colSpan
      })
    })

    return grid.at(-1)?.filter(Boolean) || []
  }

  _isOwnedHeaderRowElement(element) {
    return Boolean(element?.closest?.(`.${this.rowClass}, .${this.outcomeRowClass}`))
  }

  _isOwnedMutationNode(node) {
    if (!node) return false
    const element = node.nodeType === 1 ? node : node.parentElement
    return this._isOwnedHeaderRowElement(element)
  }

  _getJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? Number(match[1]) : null
  }

  async _loadJournalEntries({ forceRefresh = false } = {}) {
    const journalId = this._getJournalId()
    if (!journalId || !this.api?.tahvel) return []
    if (!forceRefresh && this._entriesJournalId === journalId && this._entriesPromise) return this._entriesPromise

    this._entriesJournalId = journalId
    this._entriesPromise = this.api.tahvel
      .get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] })
      .then(entries => (Array.isArray(entries) ? entries : []))
      .catch(error => {
        this._invalidateEntriesCache()
        if (Logger.isDebugMode()) Logger.debug('[AssignmentTitleRowFeature] failed to load journal entries', error)
        return []
      })

    return this._entriesPromise
  }

  _invalidateEntriesCache() {
    this._entriesPromise = null
    this._entriesJournalId = null
  }

  async _loadDetailedEntriesForTitles(titles, { forceRefresh = false } = {}) {
    const journalId = this._getJournalId()
    if (!journalId || !this.api?.tahvel) return new Map()

    const entriesToLoad = titles
      .map(item => item.entry)
      .filter(entry => {
        if (!entry?.id) return false
        const needsContent = this._shouldUseEntryContentFallback(entry) && !this._getEntryContentTitle(entry)
        const needsOutcomes = this._shouldLoadOutcomeDetails(entry)
        return needsContent || needsOutcomes
      })

    if (entriesToLoad.length === 0) return new Map()

    const uniqueEntries = Array.from(new Map(entriesToLoad.map(entry => [entry.id, entry])).values())
    const detailedEntries = []
    for (let index = 0; index < uniqueEntries.length; index += ENTRY_DETAIL_CONCURRENCY) {
      const batch = uniqueEntries.slice(index, index + ENTRY_DETAIL_CONCURRENCY)
      detailedEntries.push(...await Promise.all(batch.map(entry => this._loadEntryDetail(journalId, entry, { forceRefresh }))))
    }
    return new Map(detailedEntries.filter(Boolean).map(entry => [entry.id, entry]))
  }

  async _loadEntryDetail(journalId, entry, { forceRefresh = false } = {}) {
    if (!forceRefresh && this._entryDetailCache.has(entry.id)) return this._entryDetailCache.get(entry.id)

    try {
      const detailedEntry = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntry/${entry.id}`,
        { allStudents: true },
        { cache: false, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] }
      )
      this._entryDetailCache.set(entry.id, detailedEntry)
      return detailedEntry
    } catch (error) {
      this._entryDetailLoadFailed = true
      if (Logger.isDebugMode()) Logger.debug('[AssignmentTitleRowFeature] failed to load journal entry detail', error)
      return entry
    }
  }

  _buildTitles(headerCells, firstGradeColumnIndex, journalEntries) {
    const usedEntryIndexes = new Set()

    return headerCells.map((headerCell, columnIndex) => {
      if (columnIndex < firstGradeColumnIndex) return { title: '', headerCell, entry: null }

      const visibleTitle = this._extractVisibleHeaderTitle(headerCell)
      const entryIndex = this._findEntryIndexForHeader(headerCell, journalEntries, usedEntryIndexes)
      if (entryIndex === null) return { title: visibleTitle || '', headerCell, entry: null }

      usedEntryIndexes.add(entryIndex)
      const entry = journalEntries[entryIndex]
      return { title: visibleTitle || this._getEntryTitle(entry), headerCell, entry, outcomes: this._getEntryOutcomes(entry) }
    })
  }

  _getEntryOutcomes(entry) {
    return extractOutcomeNumbersFromEntryName(entry?.nameEt || entry?.name || '')
  }

  _shouldLoadOutcomeDetails(entry) {
    const label = this._normalizeText(entry?.nameEt || entry?.name || '')
    return !this._getEntryOutcomes(entry).length && CONTENT_FALLBACK_LABELS.has(label.toLowerCase())
  }

  _extractVisibleHeaderTitle(headerCell) {
    const rawText = (headerCell.textContent || '').replace(/\s+/g, ' ').trim()
    const dateMatch = rawText.match(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/) // eslint-disable-line security/detect-unsafe-regex -- bounded date pattern from header text
    if (!dateMatch) return ''

    const withoutDate = this._stripOutcomeSuffixFromTitle(rawText.replace(dateMatch[0], '').replace(/^[\s|:-]+|[\s|:-]+$/g, '').trim())
    if (withoutDate) return withoutDate

    const nestedTitle = headerCell.querySelector('[title]')?.getAttribute('title') || headerCell.getAttribute('title') || ''
    const normalizedTitle = nestedTitle.replace(/\s+/g, ' ').trim()
    return normalizedTitle && normalizedTitle !== rawText ? this._stripOutcomeSuffixFromTitle(normalizedTitle) : ''
  }

  _findEntryIndexForHeader(headerCell, journalEntries, usedEntryIndexes) {
    return findEntryIndexForHeader(headerCell, journalEntries, usedEntryIndexes)
  }

  _getEntryTitle(entry) {
    const title = this._normalizeText(entry?.nameEt || entry?.name || '')
    if (title && !this._shouldUseEntryContentFallback(entry)) return this._stripOutcomeSuffixFromTitle(title)

    const contentTitle = this._getEntryContentTitle(entry)
    if (contentTitle) return this._stripOutcomeSuffixFromTitle(contentTitle)

    return this._stripOutcomeSuffixFromTitle(title)
  }

  _stripOutcomeSuffixFromTitle(title) {
    const normalizedTitle = this._normalizeText(title)
    if (!extractOutcomeNumbersFromEntryName(normalizedTitle).length) return normalizedTitle
    return this._normalizeText(normalizedTitle.replace(/\s*\([^()]+\)\s*$/, ''))
  }

  _shouldUseEntryContentFallback(entry) {
    return CONTENT_FALLBACK_LABELS.has(this._normalizeText(entry?.nameEt || entry?.name || '').toLowerCase())
  }

  _getEntryContentTitle(entry) {
    const content = this._normalizeText(entry?.content || '')
    if (!content) return ''

    const firstSentence = content.split(/\n|(?<=[!?])\s+|(?<=\.)\s+(?=[A-ZÕÄÖÜ])/)[0]?.trim()
    return this._normalizeText(firstSentence)
  }

  _normalizeText(value) {
    return typeof value === 'string'
      ? value.replace(/https?:\/\//gi, '').replace(/\s+/g, ' ').trim()
      : ''
  }

  _renderOutcomeRow(table, titles) {
    const thead = table.querySelector('thead')
    if (!thead) return
    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(titles.map(item => item.headerCell))
    const nativeRows = this._getNativeHeaderRows(thead)

    const hasAnyOutcomes = titles.some(item => item.outcomes?.length)
    let row = thead.querySelector(`tr.${this.outcomeRowClass}`)

    if (!hasAnyOutcomes) {
      row?.remove()
      this._restoreLeadingHeaderRowspan(nativeRows.at(-1))
      return
    }

    this._applyLeadingHeaderRowspan(nativeRows.at(-1), firstGradeColumnIndex)

    if (!row) {
      row = document.createElement('tr')
      row.className = this.outcomeRowClass
    }

    row.replaceChildren(
      ...titles.slice(firstGradeColumnIndex).map(({ headerCell, outcomes }, index) => {
        const th = document.createElement('th')
        th.scope = 'col'
        this._syncHeaderCellLayout(th, headerCell)
        if (index === 0) th.classList.add('oa2-assignment-row__first-content')

        const badges = document.createElement('div')
        badges.className = 'oa2-assignment-outcome-row__badges'

        for (const outcome of outcomes || []) {
          const badge = document.createElement('span')
          badge.className = 'oa2-assignment-outcome-row__badge'
          badge.textContent = `ÕV${outcome}`
          badges.appendChild(badge)
        }

        if (!badges.childElementCount) th.setAttribute('aria-hidden', 'true')
        th.appendChild(badges)
        return th
      })
    )

    const anchor = nativeRows.at(-1)?.nextSibling || null
    thead.insertBefore(row, anchor)
  }

  _getNativeHeaderRows(thead) {
    return getNativeJournalHeaderRows(thead)
  }

  _applyLeadingHeaderRowspan(row, count) {
    if (!row) return
    const leadingCells = Array.from(row.children).slice(0, count)
    leadingCells.forEach((cell, index) => {
      if (!Object.hasOwn(cell.dataset, 'oa2OriginalRowspan')) cell.dataset.oa2OriginalRowspan = cell.getAttribute('rowspan') || ''
      if (!Object.hasOwn(cell.dataset, 'oa2OriginalBorderRight')) cell.dataset.oa2OriginalBorderRight = cell.style.borderRight || ''
      cell.setAttribute('rowspan', '2')
      if (index === leadingCells.length - 1) cell.style.borderRight = '1px solid rgb(217, 217, 214)'
    })
  }

  _restoreLeadingHeaderRowspan(row) {
    if (!row) return
    Array.from(row.children).forEach(cell => {
      if (!Object.hasOwn(cell.dataset, 'oa2OriginalRowspan')) return
      const original = cell.dataset.oa2OriginalRowspan
      if (original) cell.setAttribute('rowspan', original)
      else cell.removeAttribute('rowspan')
      delete cell.dataset.oa2OriginalRowspan

      if (Object.hasOwn(cell.dataset, 'oa2OriginalBorderRight')) {
        cell.style.borderRight = cell.dataset.oa2OriginalBorderRight
        delete cell.dataset.oa2OriginalBorderRight
      }
    })
  }

  _renderTitleRow(table, titles) {
    const thead = table.querySelector('thead')
    if (!thead) return
    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(titles.map(item => item.headerCell))

    let row = thead.querySelector(`tr.${this.rowClass}`)
    if (!row) {
      row = document.createElement('tr')
      row.className = this.rowClass
    }
    thead.insertBefore(row, thead.firstChild)

    const cells = []
    if (firstGradeColumnIndex > 0) {
      const spacer = document.createElement('th')
      spacer.scope = 'col'
      spacer.colSpan = firstGradeColumnIndex
      spacer.setAttribute('aria-hidden', 'true')
      spacer.classList.add('oa2-assignment-row__spacer')
      this._syncMergedHeaderCellLayout(spacer, titles.slice(0, firstGradeColumnIndex).map(item => item.headerCell))
      cells.push(spacer)
    }

    const titleItems = titles.slice(firstGradeColumnIndex)
    for (let index = 0; index < titleItems.length; index += 1) {
      const { title, headerCell } = titleItems[index]

      if (!title) {
        const emptyItems = []
        while (index < titleItems.length && !titleItems[index].title) {
          emptyItems.push(titleItems[index])
          index += 1
        }
        index -= 1

        const th = document.createElement('th')
        th.scope = 'col'
        th.colSpan = emptyItems.length
        th.setAttribute('aria-hidden', 'true')
        this._syncMergedHeaderCellLayout(th, emptyItems.map(item => item.headerCell))
        if (index - emptyItems.length + 1 === 0) th.classList.add('oa2-assignment-row__first-content')
        cells.push(th)
        continue
      }

      const th = document.createElement('th')
      th.scope = 'col'
      this._syncHeaderCellLayout(th, headerCell)
      if (index === 0) th.classList.add('oa2-assignment-row__first-content')

      const text = document.createElement('span')
      text.className = 'oa2-assignment-title-row__text'
      text.textContent = EstonianHyphenator.hyphenate(title)
      th.dataset.fullText = title
      th.appendChild(text)
      cells.push(th)
    }

    row.replaceChildren(...cells)

    this._applyTruncationIndicators(row)
  }

  _adjustTableWrapperHeight(table) {
    const wrapper = table.closest('#studentTable.tahvel-table-wrapper, .tahvel-table-wrapper#studentTable, #studentTable.tahvel-table-wrapper')
    if (!wrapper) return

    if (this._tableWrapper !== wrapper) {
      this._restoreTableWrapperHeight()
      this._tableWrapper = wrapper
      this._tableWrapperOriginalInlineHeight = wrapper.style.height || ''
      this._tableWrapperOriginalInlineMaxHeight = wrapper.style.maxHeight || ''
      this._tableWrapperOriginalInlineOverflowY = wrapper.style.overflowY || ''
      this._tableWrapperBaseHeight = wrapper.clientHeight
      this._tableWrapperBaseMaxHeight = Number.parseFloat(window.getComputedStyle(wrapper).maxHeight) || 0
    }

    const overflowDelta = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight)
    if (overflowDelta === 0) return

    const scrollbarHeight = this._getHorizontalScrollbarHeight(wrapper)
    const targetHeight = wrapper.scrollHeight + scrollbarHeight
    wrapper.style.height = `${targetHeight}px`
    if (this._tableWrapperBaseMaxHeight > 0) wrapper.style.maxHeight = `${Math.max(this._tableWrapperBaseMaxHeight, targetHeight)}px`
    wrapper.style.overflowY = 'hidden'
  }

  _getHorizontalScrollbarHeight(wrapper) {
    const computed = window.getComputedStyle(wrapper)
    const borderHeight = (Number.parseFloat(computed.borderTopWidth) || 0) + (Number.parseFloat(computed.borderBottomWidth) || 0)
    return Math.max(0, wrapper.offsetHeight - wrapper.clientHeight - borderHeight)
  }

  _restoreTableWrapperHeight() {
    if (!this._tableWrapper) return
    this._tableWrapper.style.height = this._tableWrapperOriginalInlineHeight
    this._tableWrapper.style.maxHeight = this._tableWrapperOriginalInlineMaxHeight
    this._tableWrapper.style.overflowY = this._tableWrapperOriginalInlineOverflowY
    this._tableWrapper = null
    this._tableWrapperOriginalInlineHeight = ''
    this._tableWrapperOriginalInlineMaxHeight = ''
    this._tableWrapperOriginalInlineOverflowY = ''
    this._tableWrapperBaseHeight = 0
    this._tableWrapperBaseMaxHeight = 0
  }

  _applyTruncationIndicators(row) {
    row.querySelectorAll('.oa2-assignment-title-row__text').forEach(element => {
      const fullText = element.textContent || ''
      element.classList.remove('oa2-assignment-title-row__text--truncated')
      delete element.dataset.tooltipText
      if (!fullText || !this._isOverflowing(element)) return

      const truncated = this._truncateWithEllipsis(element, fullText)
      if (!truncated) return

      element.textContent = truncated
      element.classList.add('oa2-assignment-title-row__text--truncated')
      element.dataset.tooltipText = this._getTooltipText(element.closest('th')?.dataset.fullText || fullText)
    })
  }

  _getTooltipText(text) {
    return text.replace(/\u00AD/g, '')
  }

  _isOverflowing(element) {
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1
  }

  _truncateWithEllipsis(element, fullText) {
    const plainWordFit = this._findBestWholeWordFit(element, fullText)

    const softHyphenIndexes = []
    for (let index = 0; index < fullText.length; index += 1) {
      if (fullText[index] === '\u00AD') softHyphenIndexes.push(index)
    }

    const fittingText = softHyphenIndexes.length > 0
      ? this._findBestFittingText(element, fullText, softHyphenIndexes)
      : null

    if (!plainWordFit) return fittingText?.text || null
    if (!fittingText) return plainWordFit.text

    if (fittingText.visibleLength > plainWordFit.visibleLength) return fittingText.text
    return plainWordFit.text
  }

  _findBestWholeWordFit(element, fullText) {
    const originalText = element.textContent || ''
    const plainText = fullText.replace(/\u00AD/g, '')
    const boundaryIndexes = this._getWholeWordBreakpoints(plainText)
    return this._findBestBreakpointFit(element, boundaryIndexes, breakpoint => `${plainText.slice(0, breakpoint).trimEnd()}…`, originalText)
  }

  _findBestFittingText(element, fullText, softHyphenIndexes) {
    const originalText = element.textContent || ''
    return this._findBestBreakpointFit(
      element,
      softHyphenIndexes,
      breakpoint => `${fullText.slice(0, breakpoint).replace(/\u00AD/g, '').trimEnd()}…`,
      originalText
    )
  }

  _getWholeWordBreakpoints(plainText) {
    const boundaryIndexes = []
    for (let index = 1; index < plainText.length; index += 1) {
      if (/\s/.test(plainText[index])) boundaryIndexes.push(index)
    }
    return boundaryIndexes
  }

  _findBestBreakpointFit(element, breakpoints, buildCandidate, originalText) {
    if (!breakpoints.length) return null

    let low = 0
    let high = breakpoints.length - 1
    let bestFit = null

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const candidate = buildCandidate(breakpoints[mid])
      element.textContent = candidate
      if (this._isOverflowing(element)) {
        high = mid - 1
      } else {
        bestFit = { text: candidate, visibleLength: candidate.length - 1 }
        low = mid + 1
      }
    }

    element.textContent = originalText
    return bestFit
  }

  _syncHeaderCellLayout(targetCell, sourceCell) {
    if (!sourceCell) return

    const computed = window.getComputedStyle(sourceCell)
    const isSticky = computed.position === 'sticky'
    targetCell.style.width = computed.width
    targetCell.style.minWidth = computed.width
    targetCell.style.maxWidth = computed.width
    targetCell.style.borderRight = computed.borderRight
    targetCell.style.borderLeft = computed.borderLeft
    targetCell.style.borderBottom = computed.borderBottom

    if (isSticky) {
      targetCell.style.position = 'sticky'
      targetCell.style.left = `${this._getStickyLeftOffset(sourceCell)}px`
      targetCell.style.zIndex = computed.zIndex === 'auto' ? '2' : computed.zIndex
      targetCell.style.background = '#fff'
    }
  }

  _syncMergedHeaderCellLayout(targetCell, sourceCells) {
    const cells = sourceCells.filter(Boolean)
    if (!cells.length) return

    const firstComputed = window.getComputedStyle(cells[0])
    const lastComputed = window.getComputedStyle(cells.at(-1))
    const width = cells.reduce((sum, cell) => {
      const computed = window.getComputedStyle(cell)
      return sum + (Number.parseFloat(computed.width) || cell.getBoundingClientRect().width || 0)
    }, 0)

    if (width > 0) {
      targetCell.style.width = `${width}px`
      targetCell.style.minWidth = `${width}px`
      targetCell.style.maxWidth = `${width}px`
    }
    targetCell.style.borderRight = lastComputed.borderRight
    targetCell.style.borderLeft = firstComputed.borderLeft
    targetCell.style.borderBottom = lastComputed.borderBottom

    if (firstComputed.position === 'sticky') {
      targetCell.style.position = 'sticky'
      targetCell.style.left = `${this._getStickyLeftOffset(cells[0])}px`
      targetCell.style.zIndex = firstComputed.zIndex === 'auto' ? '2' : firstComputed.zIndex
      targetCell.style.background = '#fff'
    }
  }

  _getStickyLeftOffset(cell) {
    let offset = 0
    let current = cell.previousElementSibling
    while (current) {
      const computed = window.getComputedStyle(current)
      if (computed.position === 'sticky') {
        offset += Number.parseFloat(computed.width) || current.getBoundingClientRect().width || 0
      }
      current = current.previousElementSibling
    }
    return offset
  }

  _removeTitleRow(table = this._findJournalTable()) {
    const nativeRows = table ? this._getNativeHeaderRows(table.querySelector('thead')) : []
    this._restoreLeadingHeaderRowspan(nativeRows.at(-1))
    table?.querySelector(`thead tr.${this.rowClass}`)?.remove()
    table?.querySelector(`thead tr.${this.outcomeRowClass}`)?.remove()
  }
}

export default AssignmentTitleRowFeature
