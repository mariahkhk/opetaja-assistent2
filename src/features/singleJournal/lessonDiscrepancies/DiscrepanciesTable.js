import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import IndependentWorkCapacityFeature from './IndependentWorkCapacityFeature.js'

/**
 * DiscrepanciesTable class
 * Handles table creation and manipulation for discrepancies
 */
export class DiscrepanciesTable {
  /**
   * Configuration constants for button colors
   */
  static HEX = {
    green: ['#28a745', '#218838', '#fff'],
    amber: ['#ffc107', '#e0a800', '#212529'],
    blue: ['#17a2b8', '#138496', '#fff']
  }

  static MIN_ENTRIES_FOR_BULK_ADD = 2

  /**
   * Creates button styling
   * @param {Array} colors - Array of [background, hover, text] colors
   * @returns {string} CSS style string
   */
  static createButtonStyle = ([bg, _hover, color]) =>
    `background:${bg};color:${color};border:none;padding:4px 8px;border-radius:3px;font-size:12px;font-weight:bold;cursor:pointer;`

  /**
   * Constructor for DiscrepanciesTable
   * @param {Object} options - Configuration options
   * @param {Object} options.api - API service instance
   * @param {Function} options.formatDate - Date formatting function
   * @param {Function} options.extractJournalId - Function to extract journal ID
   * @param {Function} options.calculateDuplicateIndex - Function to calculate duplicate index
   * @param {Function} options.findDuplicateMatches - Function to find duplicate matches
   * @param {Function} options.addDiscrepancyButtonListeners - Function to add button listeners
   * @param {Function} options.shouldContinue - Function to check if operation should continue
   */
  constructor({ api, extractJournalId, calculateDuplicateIndex, findDuplicateMatches, addDiscrepancyButtonListeners, shouldContinue }) {
    this.api = api
    this.extractJournalId = extractJournalId
    this.calculateDuplicateIndex = calculateDuplicateIndex
    this.findDuplicateMatches = findDuplicateMatches
    this.addDiscrepancyButtonListeners = addDiscrepancyButtonListeners
    this.shouldContinue = shouldContinue
    this.tableCreated = false
    this.currentJournalId = null
    this.lastMissingEntries = []
    this.name = 'DiscrepanciesTable'
  }

  /**
   * Injects CSS styles for the lesson discrepancies table
   * @private
   */
  #injectCSS() {
    const css = `
      .lesson-discrepancy-table-cell {
        padding: 8px;
        border-bottom: 1px solid #e0e0e0;
        border-right: 1px solid #dee2e6;
      }
      .lesson-discrepancy-table-cell:last-child {
        border-right: none;
      }
      .lesson-discrepancy-table-cell-center {
        padding: 8px;
        border-bottom: 1px solid #e0e0e0;
        border-right: 1px solid #dee2e6;
        text-align: center;
      }
      .lesson-discrepancy-table-cell-center:last-child {
        border-right: none;
      }
      .lesson-discrepancy-table-cell-20 {
        width: 20%;
      }
      .lesson-discrepancy-table-cell-25 {
        width: 25%;
      }
      .lesson-discrepancy-table-cell-30 {
        width: 30%;
      }
      .lesson-discrepancy-table-cell-50 {
        width: 50%;
      }
      .oa2-banner {
        color: #721c24;
        background: #f8d7da;
        font-weight: bold;
        font-size: 15px;
        text-align: center;
        border-radius: 4px;
        border: 1px solid #f5c6cb;
        padding: 12px 8px;
        margin-bottom: 10px;
        box-sizing: border-box;
        box-shadow: 0 1px 3px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.10);
      }
      .oa2-banner--red {
        color: #721c24;
        background: #f8d7da;
        border: 1.5px solid #f5c6cb;
        font-weight: bold;
        font-size: 15px;
        text-align: center;
        border-radius: 4px;
        padding: 12px 8px;
        margin-bottom: 10px;
        box-sizing: border-box;
        box-shadow: 0 1px 3px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.10);
      }
      .oa2-banner--yellow {
        color: #856404;
        background: #ffe066;
        border: 1.5px solid #ffd43b;
        font-weight: bold;
        font-size: 15px;
        text-align: center;
        border-radius: 4px;
        padding: 12px 8px;
        margin-bottom: 10px;
        box-sizing: border-box;
        box-shadow: 0 1px 3px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.10);
      }
      .oa2-banner--info {
        color: #0c5460;
        background: #d1ecf1;
        border: 1px solid #bee5eb;
      }
      .oa2-banner--success {
        color: #155724;
        background: #d4edda;
        border: 1px solid #c3e6cb;
      }
      .oa2-btn--green:not(:disabled):hover { background: #218838 !important; }
      .oa2-btn--amber:not(:disabled):hover { background: #e0a800 !important; }
      .oa2-btn--blue:not(:disabled):hover { background: #138496 !important; }
    `
    styleService.injectCSS(css, 'lesson-discrepancies-styles')
  }

  /**
   * Creates the main lesson discrepancies table
   * @param {Object} options - Table creation options
   * @param {Array} options.discrepancies - List of discrepancies
   * @param {Array} options.capacityProblems - List of capacity problems
   * @param {boolean} options.forceRefresh - Whether to force refresh
   * @returns {Promise<boolean>} Success status
   */
  async createTable({ discrepancies, capacityProblems, forceRefresh = false }) {
    try {
      // Always refresh independent work deadline messages before table build
      if (window.__lastLessonNotificationRefresh) {
        await window.__lastLessonNotificationRefresh(this.api)
      }
      const journalId = this.extractJournalId()
      if (!journalId) return false

      const existingTable = document.querySelector('[data-discrepancies-table]')
      if (!forceRefresh && this.tableCreated && this.currentJournalId === journalId && existingTable) {
        return true
      }
      if (existingTable) this.tableCreated = false

      // Collect all independent work messages (capacity and all deadlines), avoid duplicates
      const independentWorkMessages = []
      const capacityMsg = await IndependentWorkCapacityFeature.check(this.api, journalId)
      if (capacityMsg && !independentWorkMessages.includes(capacityMsg)) independentWorkMessages.push(capacityMsg)
      if (window.__lastLessonNotification_independentWorkMessage) {
        const globalMsgs = Array.isArray(window.__lastLessonNotification_independentWorkMessage)
          ? window.__lastLessonNotification_independentWorkMessage
          : [window.__lastLessonNotification_independentWorkMessage]
        for (const msg of globalMsgs) {
          if (msg && !independentWorkMessages.includes(msg)) independentWorkMessages.push(msg)
        }
        delete window.__lastLessonNotification_independentWorkMessage
      }
      // Check missing grades message using DOM state after table is rendered
      existingTable?.remove()
      const success = this.insertUnifiedTable(discrepancies, capacityProblems, independentWorkMessages, null)
      if (success) {
        // After table and highlighting, check for highlighted cells
        const highlighted = document.querySelector('.highlight-missing-grade')
        const missingGradesMessage = highlighted ? 'Mõnedel iseseisevatel töödel on hinded puudu' : null
        // Re-render notifications section with correct message
        this.updateMissingGradesBanner(missingGradesMessage)
        this.tableCreated = true
        this.currentJournalId = journalId
      }
      return success
    } catch (error) {
      Logger.error(`[${this.name}] table creation error`, error)
      return false
    }
  }

  /**
   * Inserts the unified table into the DOM
   * @param {Array} discrepancies - List of discrepancies
   * @param {Array} capacityProblems - List of capacity problems
   * @param {Array} independentWorkMessages - Array of independent work messages
   * @param {string} missingGradesMessage - Missing grades message
   * @returns {boolean} Success status
   */
  // eslint-disable-next-line no-unused-vars
  insertUnifiedTable(discrepancies, capacityProblems, independentWorkMessages, missingGradesMessage) {
    try {
      // Verify we should still continue before inserting
      if (this.shouldContinue && !this.shouldContinue()) {
        Logger.info(`[${this.name}] Operation cancelled - feature deactivated or URL changed`)
        return false
      }

      document.querySelector('[data-discrepancies-table]')?.remove()
      document.querySelector('[data-capacity-problems-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false
      this.#injectCSS()
      // Always render the main table, but do not render notifications section yet
      const flexContainer = document.createElement('div')
      flexContainer.style.display = 'flex'
      flexContainer.style.flexWrap = 'wrap'
      flexContainer.style.gap = '16px'
      flexContainer.style.alignItems = 'flex-start'
      flexContainer.style.margin = '0'
      flexContainer.setAttribute('data-discrepancies-table', 'true')
      // Main table only for now
      const mainTableSection = this.#createUnifiedTableElement(discrepancies, capacityProblems, independentWorkMessages, null, true)
      flexContainer.appendChild(mainTableSection)
      // If the chosen insertion point is a header/section element (accordion-header),
      // insert the table after that element (as a sibling) so it appears under the section,
      // otherwise insert as the first child (legacy behavior).
      try {
        // If the insertion point is the whole accordion component or the header, insert after it
        const tagName = insertionPoint.tagName && insertionPoint.tagName.toLowerCase()
        const isTahvelAccordion = tagName === 'tahvel-accordion'
        const isAccordionHeader = insertionPoint.classList && insertionPoint.classList.contains('accordion-header')
        if (isTahvelAccordion || isAccordionHeader) {
          // Place the container immediately after the accordion or header so it appears under the section but not inside it
          insertionPoint.insertAdjacentElement('afterend', flexContainer)
        } else {
          insertionPoint.insertBefore(flexContainer, insertionPoint.firstChild)
        }
      } catch (e) {
        // Fallback to safe behavior if DOM operations fail
        (insertionPoint.parentNode || document.body).insertBefore(flexContainer, insertionPoint.nextSibling || insertionPoint.firstChild)
      }
      setTimeout(() => {
        // Check for all highlight types and missing grades
        const ovCells = document.querySelectorAll('.highlight-ov-red')
        const ovYellowCells = document.querySelectorAll('.highlight-ov-yellow')
  const finalGradeRedCells = document.querySelectorAll('.highlight-final-grade-red')
  const finalGradeYellowCells = document.querySelectorAll('.highlight-final-grade-yellow')
  // OA-specific mismatches are marked with .oa-final-grade-red by FinalGrades feature
  const oaFinalGradeMismatchCells = document.querySelectorAll('.oa-final-grade-red')
        // Additionally detect whether the journal table contains ÕV columns at all (headers)
        let hasOvColumns = false
        try {
          const headerCells = document.querySelectorAll('table.journalTable thead th')
          hasOvColumns = Array.from(headerCells).some(th => {
            const txt = (th.textContent || th.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()
            return /^õv\d*[ _-]?.*$/.test(txt) || txt.includes('õpiväljund')
          })
        } catch (e) {
          hasOvColumns = false
        }
        // Detect final-grade header column indices and check for empty final-grade cells
        let finalGradeHeaderIndices = []
        let hasMissingFinals = false
        try {
          const headerRows = document.querySelectorAll('table.journalTable thead tr')
          headerRows.forEach(row => {
            let colIdx = 0
            Array.from(row.children).forEach(th => {
              const colspan = parseInt(th.getAttribute('colspan') || '1', 10) || 1
              const rawText = th.textContent || th.innerText || ''
              const normalized = (rawText || '').replace(/\s+/g, ' ').trim().toLowerCase()
              if (/lõpptulemus/.test(normalized)) {
                for (let i = 0; i < colspan; i++) finalGradeHeaderIndices.push(colIdx + i)
              }
              colIdx += colspan
            })
          })
          if (finalGradeHeaderIndices.length > 0) {
            const bodyRows = document.querySelectorAll('table.journalTable tbody tr')
            Array.from(bodyRows).some(row => {
              const cells = Array.from(row.children).filter(n => n.nodeType === 1)
              return finalGradeHeaderIndices.some(idx => {
                const c = cells[idx]
                if (!c) return false
                if (!(c.textContent || '').trim()) {
                  hasMissingFinals = true
                  return true
                }
                return false
              })
          })
          }
        } catch (e) {
          finalGradeHeaderIndices = []
          hasMissingFinals = false
        }
        const highlighted = document.querySelector('.highlight-missing-grade')
        const missingGradesMessage = highlighted ? 'Mõnedel iseseisevatel töödel on hinded puudu' : null
  // Should we show the notifications section?
  // Include OA-specific incorrect final-grade highlights (oa-final-grade-red) in decision
  // eslint-disable-next-line max-len
  const shouldShowNotifications = !!missingGradesMessage || ovCells.length > 0 || ovYellowCells.length > 0 || finalGradeRedCells.length > 0 || finalGradeYellowCells.length > 0 || oaFinalGradeMismatchCells.length > 0
        let notificationsEl = null
        if (shouldShowNotifications) {
          notificationsEl = this.#el('div', {
            className: 'notifications-section',
            style: 'background:#fff3cd;border:1px solid #ffeaa7;border-radius:4px;padding:15px;min-width:260px;max-width:340px;box-shadow:0 2px 4px rgba(0,0,0,.07);display:flex;flex-direction:column;flex:1 1 260px;'
          })
          notificationsEl.appendChild(this.#createTitleBar('Hinded'))
          if (missingGradesMessage) notificationsEl.appendChild(this.#createBanner(missingGradesMessage, 'oa2-banner--red'))
        }
        // Update flex container
        flexContainer.textContent = ''
        flexContainer.appendChild(this.#createUnifiedTableElement(discrepancies, capacityProblems, independentWorkMessages, null))
        if (notificationsEl) flexContainer.appendChild(notificationsEl)
        // Add button listeners after final content update
        this.addDiscrepancyButtonListeners()
        // Now inject banners if needed
        const notifications = flexContainer.querySelector('.notifications-section')
        if (notifications) {
          // Remove old banners (shouldn't be any, but for safety)
          notifications.querySelectorAll('.oa2-banner-ov').forEach(b => b.remove())
          notifications.querySelectorAll('.oa2-banner-final-grade').forEach(b => b.remove())
          // Inject ÕV banner if needed
          // If there are missing final-grade cells (even if not highlighted), show missing-final banner
          if (hasMissingFinals && notifications) {
            const text = hasOvColumns ? 'Mõnedel õpilastel puudub õpiväljund' : 'Mõnedel õpilastel puudub lõpptulemus'
            if (!this.#bannerExists(notifications, text)) {
              const missingFinalBanner = document.createElement('div')
              missingFinalBanner.className = 'oa2-banner oa2-banner--red oa2-banner-final-grade'
              missingFinalBanner.textContent = text
              const hindedHeader = Array.from(notifications.children).find(el => el.textContent && el.textContent.includes('Hinded'))
              if (hindedHeader && hindedHeader.nextSibling) {
                notifications.insertBefore(missingFinalBanner, hindedHeader.nextSibling)
              } else {
                notifications.appendChild(missingFinalBanner)
              }
            }
          }
          if (ovYellowCells.length > 0) {
            const text = 'Mõnedel õpilastel puudub õpiväljund (tähtaeg läheneb)!'
            if (!this.#bannerExists(notifications, text)) {
              const ovBanner = document.createElement('div')
              ovBanner.className = 'oa2-banner oa2-banner--yellow oa2-banner-ov'
              ovBanner.textContent = text
              const hindedHeader = Array.from(notifications.children).find(el => el.textContent && el.textContent.includes('Hinded'))
              if (hindedHeader && hindedHeader.nextSibling) {
                notifications.insertBefore(ovBanner, hindedHeader.nextSibling)
              } else {
                notifications.appendChild(ovBanner)
              }
            }
          } else if (ovCells.length > 0) {
            const text = 'Mõnedel õpilastel puudub õpiväljund'
            if (!this.#bannerExists(notifications, text)) {
              const ovBanner = document.createElement('div')
              ovBanner.className = 'oa2-banner oa2-banner--red oa2-banner-ov'
              ovBanner.textContent = text
              const hindedHeader = Array.from(notifications.children).find(el => el.textContent && el.textContent.includes('Hinded'))
              if (hindedHeader && hindedHeader.nextSibling) {
                notifications.insertBefore(ovBanner, hindedHeader.nextSibling)
              } else {
                notifications.appendChild(ovBanner)
              }
            }
          }
          // Inject final/ÕV-related banner if needed
          // If there are ÕV columns or highlights present, prefer an ÕV-specific incorrect banner when mismatches exist
          const hasOvHighlights = ovCells.length > 0 || ovYellowCells.length > 0 || hasOvColumns
          const hasFinalHighlights = finalGradeRedCells.length > 0 || finalGradeYellowCells.length > 0
          if (hasOvHighlights && (oaFinalGradeMismatchCells.length > 0 || hasFinalHighlights)) {
            const text = 'Mõnedel õpilastel on vale õpiväljundid!'
            if (!this.#bannerExists(notifications, text)) {
              const ovFgBanner = document.createElement('div')
              ovFgBanner.className = 'oa2-banner oa2-banner-final-grade oa2-banner--red'
              // When ÕV columns/highlights exist and mismatches found, show ÕV-specific incorrect message (plural)
              ovFgBanner.textContent = text
              const hindedHeader = Array.from(notifications.children).find(el => el.textContent && el.textContent.includes('Hinded'))
              const ovBanner = notifications.querySelector('.oa2-banner-ov')
              if (ovBanner && ovBanner.nextSibling) {
                notifications.insertBefore(ovFgBanner, ovBanner.nextSibling)
              } else if (hindedHeader && hindedHeader.nextSibling) {
                notifications.insertBefore(ovFgBanner, hindedHeader.nextSibling)
              } else {
                notifications.appendChild(ovFgBanner)
              }
            }
          } else if (oaFinalGradeMismatchCells.length > 0 || finalGradeRedCells.length > 0 || finalGradeYellowCells.length > 0) {
            let text = null
            if (oaFinalGradeMismatchCells.length > 0) {
              text = hasOvColumns ? 'Mõnedel õpilastel on vale õpiväljundid!' : 'Mõnedel õpilastel on vale lõpptulemus'
            } else if (finalGradeYellowCells.length > 0) {
              text = 'Mõnedel õpilastel puudub Lõpptulemus (tähtaeg läheneb)!'
            } else if (finalGradeRedCells.length > 0) {
              text = 'Mõnedel õpilastel puudub lõpptulemus'
            }
            if (text && !this.#bannerExists(notifications, text)) {
              const fgBanner = document.createElement('div')
              fgBanner.className = 'oa2-banner oa2-banner-final-grade'
              // If OA-specific mismatches present, show incorrect-final message (red)
              if (oaFinalGradeMismatchCells.length > 0) fgBanner.classList.add('oa2-banner--red')
              if (finalGradeYellowCells.length > 0) fgBanner.classList.add('oa2-banner--yellow')
              if (finalGradeRedCells.length > 0) fgBanner.classList.add('oa2-banner--red')
              fgBanner.textContent = text
              const hindedHeader = Array.from(notifications.children).find(el => el.textContent && el.textContent.includes('Hinded'))
              // Place after ÕV banner if present, else after Hinded header
              const ovBanner = notifications.querySelector('.oa2-banner-ov')
              if (ovBanner && ovBanner.nextSibling) {
                notifications.insertBefore(fgBanner, ovBanner.nextSibling)
              } else if (hindedHeader && hindedHeader.nextSibling) {
                notifications.insertBefore(fgBanner, hindedHeader.nextSibling)
              } else {
                notifications.appendChild(fgBanner)
              }
            }
          }
        }
      }, 50)
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert unified table error`, error)
      return false
    }
  }

  /**
   * Creates the unified table element
   * @param {Array} discrepancies - List of discrepancies
   * @param {Array} capacityProblems - List of capacity problems
   * @param {Array} independentWorkMessages - Array of independent work messages
   * @param {string} missingGradesMessage - Missing grades message
   * @returns {HTMLElement} The table element
   * @private
   */
  #el(tag, attrs = {}, ...children) {
    const el = document.createElement(tag)
    for (const [key, val] of Object.entries(attrs)) {
      if (key === 'style') el.setAttribute('style', val)
      else if (key === 'className') el.className = val
      else el.setAttribute(key, val)
    }
    for (const child of children) {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child))
      else if (child) el.appendChild(child)
    }
    return el
  }

  #createTitleBar(badgeText) {
    const emoji = this.#el('span', { style: 'font-size:20px;margin-right:10px;' }, '🎓')
    const title = this.#el('h3', { style: 'margin:0;color:#495057;' }, 'Õpetaja Assistent 2')
    const left = this.#el('div', { style: 'display:flex;align-items:center;' }, emoji, title)
    const badge = this.#el('div', { style: 'background:#ffc107;color:#212529;font-weight:bold;padding:6px 16px;border-radius:16px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.07);' }, badgeText)
    return this.#el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #dee2e6;' }, left, badge)
  }

  #createUnifiedTableElement(discrepancies, capacityProblems, independentWorkMessages, missingGradesMessage) {
    const hasProblems =
      discrepancies.length > 0 || capacityProblems.length > 0 || (independentWorkMessages && independentWorkMessages.length > 0) || !!missingGradesMessage
    const backgroundColor = hasProblems ? '#fff3cd' : '#d1edcc'
    const borderColor = hasProblems ? '#ffeaa7' : '#c3e6cb'
    const boxStyle =
      `background:${backgroundColor};border:1px solid ${borderColor};border-radius:4px;padding:15px;` +
      'box-shadow:0 2px 4px rgba(0,0,0,.1);width:600px;min-width:430px;max-width:600px;flex:0 0 600px;'

    const box = this.#el('div', { style: boxStyle })
    box.appendChild(this.#createTitleBar('Probleemid sissekannetega'))

    if (independentWorkMessages && independentWorkMessages.length > 0) {
      for (const msg of independentWorkMessages) {
        box.appendChild(this.#createBanner(msg, 'oa2-banner--red'))
      }
    }

    box.appendChild(this.#createTimetableSectionEl(discrepancies))
    box.appendChild(this.#createCapacitySectionEl(capacityProblems, null))
    return box
  }

  #createTimetableSectionEl(discrepancies) {
    const fragment = document.createDocumentFragment()
    if (!discrepancies.length) {
      fragment.appendChild(this.#el('p', { style: 'color:#28a745;margin:0 0 20px 0;' }, 'Erinevusi tunniplaaniga pole.'))
      return fragment
    }

    const header = this.#el('div', { style: 'margin-bottom:15px;' },
      this.#el('h4', { style: 'margin:0 0 10px 0;color:#495057;' }, 'Erinevused tunniplaaniga'))
    fragment.appendChild(header)

    const sortedDiscrepancies = [...discrepancies].sort((a, b) => {
      const dateComparison = new Date(a.date) - new Date(b.date)
      if (dateComparison !== 0) return dateComparison
      const aLessonNumber = a.lessonNumber ?? a.timetableStart ?? 0
      const bLessonNumber = b.lessonNumber ?? b.timetableStart ?? 0
      return aLessonNumber - bLessonNumber
    })

    const missingEntries = discrepancies.filter(d => d.type === 'missingJournalEntry')
    this.lastMissingEntries = missingEntries
    const showAddAll = missingEntries.length >= DiscrepanciesTable.MIN_ENTRIES_FOR_BULK_ADD

    const table = this.#el('table', { style: `width:100%;border-collapse:collapse;background:white;margin-bottom:${showAddAll ? '8px' : '20px'};border:1px solid #dee2e6;` })
    const thead = this.#el('thead')
    const headRow = this.#el('tr', { style: 'background:#f8f9fa' })
    const headCells = [
      ['lesson-discrepancy-table-cell lesson-discrepancy-table-cell-20', 'Kuupäev'],
      ['lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-25', 'Algustund'],
      ['lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-25', 'Tundide arv'],
      ['lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-30', 'Tegevus']
    ]
    for (const [cls, text] of headCells) headRow.appendChild(this.#el('th', { className: cls }, text))
    thead.appendChild(headRow)
    table.appendChild(thead)

    const tbody = this.#el('tbody')
    for (const discrepancy of sortedDiscrepancies) tbody.appendChild(this.#createDiscrepancyRowEl(discrepancy))
    table.appendChild(tbody)
    fragment.appendChild(table)

    if (showAddAll) {
      const btnWrap = this.#el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:20px' },
        this.#el('div', { style: 'width:30%;text-align:center' }, this.#createButtonEl(null, 'Lisa kõik', 'green', { handler: 'addAllMissing' })))
      fragment.appendChild(btnWrap)
    }

    return fragment
  }

  #createCapacitySectionEl(capacityProblems, independentWorkMessage) {
    const fragment = document.createDocumentFragment()
    const hasCapacityProblems = capacityProblems.length > 0
    const hasIndependentWorkMessage = !!independentWorkMessage

    if (hasCapacityProblems) {
      fragment.appendChild(this.#el('div', { style: 'margin-bottom:15px;' },
        this.#el('h4', { style: 'margin:0 0 10px 0;color:#495057;' }, 'Ebaloogilised sissekande liigi ja tüübi kombinatsioonid')))

      const sortedEntries = [...capacityProblems].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
      const table = this.#el('table', { style: 'width:100%;border-collapse:collapse;background:white;border:1px solid #dee2e6;' })
      const thead = this.#el('thead')
      const headRow = this.#el('tr', { style: 'background:#f9f9f9' })
      const headCells = [
        ['lesson-discrepancy-table-cell lesson-discrepancy-table-cell-20', 'Kuupäev'],
        ['lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-50', 'Märkus'],
        ['lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-30', 'Tegevus']
      ]
      for (const [cls, text] of headCells) headRow.appendChild(this.#el('th', { className: cls }, text))
      thead.appendChild(headRow)
      table.appendChild(thead)

      const tbody = this.#el('tbody')
      for (const entry of sortedEntries) tbody.appendChild(this.#createCapacityProblemRowEl(entry))
      table.appendChild(tbody)
      fragment.appendChild(table)
    }

    if (hasIndependentWorkMessage) {
      const inner = this.#el('div', { style: 'padding:12px 8px;color:#721c24;font-weight:bold;font-size:15px;text-align:center;background:#f8d7da;border-radius:4px;border:1px solid #f5c6cb;' }, independentWorkMessage)
      fragment.appendChild(this.#el('div', { style: 'margin-top:18px;margin-bottom:10px;padding:0 8px;' }, inner))
    }

    if (!hasCapacityProblems && !hasIndependentWorkMessage) {
      fragment.appendChild(this.#el('p', { style: 'color:#28a745;margin:0;' }, 'Ebaloogilisi sissekande liigi ja tüüpi kombinatsioone ei leitud.'))
    }

    return fragment
  }

  #createDiscrepancyRowEl(discrepancy) {
    const renderers = {
      missingJournalEntry: this.#renderMissingEntryEl,
      singleEntryFix: this.#renderSingleEntryFixEl,
      multiEntryFix: this.#renderMultiEntryFixEl
    }
    const renderer = renderers[discrepancy.type] || this.#renderSingleEntryFixEl
    const { start, count, action } = renderer.call(this, discrepancy)
    const tr = this.#el('tr', { style: 'background-color:white' })
    const dateTd = this.#el('td', { className: 'lesson-discrepancy-table-cell' }, this.#formatDisplayDate(discrepancy.date))
    const startTd = this.#el('td', { className: 'lesson-discrepancy-table-cell-center' })
    const countTd = this.#el('td', { className: 'lesson-discrepancy-table-cell-center' })
    const actionTd = this.#el('td', { className: 'lesson-discrepancy-table-cell-center' })
    startTd.appendChild(start)
    countTd.appendChild(count)
    actionTd.appendChild(action)
    tr.appendChild(dateTd)
    tr.appendChild(startTd)
    tr.appendChild(countTd)
    tr.appendChild(actionTd)
    return tr
  }

  /**
   * Creates a capacity problem row for the table
   * @param {Object} entry - Entry data
   * @returns {string} HTML string for the row
   * @private
   */
  #createCapacityProblemRowEl(entry) {
    let shortDate = 'Kuupäevata'
    if (entry.entryDate) {
      try {
        const dateObj = new Date(entry.entryDate)
        if (!isNaN(dateObj.getTime())) {
          shortDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}`
        }
      } catch (error) {
        Logger.debug('[LessonDiscrepanciesTable] Date formatting error for display:', error)
      }
    }

    const startLesson = entry.startLessonNr || entry.lessons?.[0]?.lessonNr || ''
    const dateWithLesson = startLesson ? `${shortDate} (${startLesson}.)` : shortDate

    let badgeColor = '#e0e0e0'
    if (entry.entryType === 'SISSEKANNE_I') badgeColor = '#f0f4c3'
    else if (entry.entryType === 'SISSEKANNE_P') badgeColor = '#b2dfdb'

    const dateBadge = this.#el('span', { style: `background-color:${badgeColor};padding:2px 6px;border-radius:4px;font-size:12px;border:1px solid #ccc;` }, dateWithLesson)

    const errorMessages = {
      no_teacher_selected: 'Õpetaja pole valitud',
      both_checkboxes_selected: 'Auditoorne õpe ja iseseiseva õppe linnukesed on samaaegselt sees',
      lesson_with_independent_work: 'Sissekande liik on tund, aga ainult iseseiseva õppe linnuke on sees',
      lesson_without_auditoorne: 'Sissekande liik on tund, aga auditoorne õpe linnuke pole sees',
      independent_work_with_auditory: 'Iseseisev tööl ei saa olla auditoorne õpe linnuke sees',
      praktiline_too_without_praktiline_checkbox: 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees',
      missing_auditoorne_checkbox: 'Auditoorne õpe puudub',
      missing_iseseisev_checkbox: 'Sissekande liik on iseseisev õpe, aga iseseiseva õppe linnukest ei ole sees',
      journal_missing_independent_work: 'Vigane sissekanne: päevikule pole määratud iseisevaid töid',
      missing_praktiline_checkbox: 'Praktiline töö puudub'
    }
    const message = errorMessages[entry.validationResult?.errorType] || 'Auditoorne õpe puudub'

    let safeFormattedDate = 'NO_DATE'
    if (entry.entryDate) {
      try {
        const dateObj = new Date(entry.entryDate)
        if (!isNaN(dateObj.getTime())) {
          const day = dateObj.getDate().toString().padStart(2, '0')
          const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
          const year = dateObj.getFullYear()
          safeFormattedDate = `${day}.${month}.${year}`
        }
      } catch (error) {
        Logger.debug('[DiscrepanciesTable] Date formatting error:', error)
        safeFormattedDate = 'NO_DATE'
      }
    }

    const duplicateIndex = this.calculateDuplicateIndex({ entryId: entry.id, date: safeFormattedDate, entryType: entry.entryType })
    const btnData = { entryid: entry.id, date: safeFormattedDate, duplicateindex: duplicateIndex }

    let action
    if (entry.validationResult?.errorType === 'journal_missing_independent_work') {
      action = this.#createButtonEl(`open-entry-${entry.id}`, 'Ava', 'blue', { handler: 'openEntry', ...btnData })
    } else {
      action = this.#createButtonEl(`fix-capacity-${entry.id}`, 'Paranda', 'amber', { handler: 'fixCapacity', ...btnData })
    }

    const tr = this.#el('tr', { style: 'background-color:white' })
    const dateTd = this.#el('td', { className: 'lesson-discrepancy-table-cell-center' })
    dateTd.appendChild(dateBadge)
    tr.appendChild(dateTd)
    tr.appendChild(this.#el('td', { className: 'lesson-discrepancy-table-cell-center' }, message))
    const actionTd = this.#el('td', { className: 'lesson-discrepancy-table-cell-center' })
    actionTd.appendChild(action)
    tr.appendChild(actionTd)
    return tr
  }

  /**
   * Renders a missing entry discrepancy
   * @param {Object} discrepancy - Discrepancy data
   * @returns {Object} Render data with start, count, and action
   * @private
   */
  #renderMissingEntryEl(discrepancy) {
    return {
      start: this.#el('span', { style: 'font-weight:bold;' }, String(discrepancy.lessonNumber)),
      count: this.#el('span', { style: 'font-weight:bold;' }, String(discrepancy.lessonCount)),
      action: this.#createButtonEl(`add-missing-${discrepancy.date}-${discrepancy.lessonNumber}`, 'Lisa', 'green', {
        handler: 'addMissing',
        date: discrepancy.date,
        startLesson: discrepancy.lessonNumber,
        lessonCount: discrepancy.lessonCount,
        timetableStart: discrepancy.lessonNumber,
        timetableCount: discrepancy.lessonCount,
        timeStart: discrepancy.timeStart,
        timeEnd: discrepancy.timeEnd,
        rooms: discrepancy.rooms
      })
    }
  }

  /**
   * Renders a single entry fix discrepancy
   * @param {Object} discrepancy - Discrepancy data
   * @returns {Object} Render data with start, count, and action
   * @private
   */
  #renderSingleEntryFixEl(discrepancy) {
    const duplicateIndex = this.calculateDuplicateIndex(discrepancy)
    const duplicateInfo = this.findDuplicateMatches(discrepancy.entryId, discrepancy.date)
    const hasDuplicates = duplicateInfo.exactMatches.length > 1

    const humanIndex = duplicateIndex + 1
    const buttonText = hasDuplicates ? `Muuda #${humanIndex}` : 'Muuda'
    const tooltip = `Entry ID: ${discrepancy.entryId}, Duplicate Index: ${duplicateIndex}`
    return {
      start: this.#createSmartDisplayEl(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplayEl(discrepancy.journalCount, discrepancy.timetableCount),
      action: this.#createButtonEl(
        `edit-single-${discrepancy.date}-${discrepancy.entryId}`,
        buttonText,
        'amber',
        {
          handler: 'editEntry',
          type: 'singleEntryFix',
          date: discrepancy.date,
          entryid: discrepancy.entryId,
          timetableStart: discrepancy.timetableStart,
          timetableCount: discrepancy.timetableCount,
          currentStart: discrepancy.journalStart,
          currentCount: discrepancy.journalCount,
          duplicateindex: duplicateIndex
        },
        tooltip
      )
    }
  }

  /**
   * Renders a multi-entry fix discrepancy
   * @param {Object} discrepancy - Discrepancy data
   * @returns {Object} Render data with start, count, and action
   * @private
   */
  #renderMultiEntryFixEl(discrepancy) {
    const firstEntry = discrepancy.entries?.[0]
    const firstEntryDiscrepancy = firstEntry
      ? {
          ...discrepancy,
          entryId: firstEntry.id,
          journalStart: firstEntry.startLessonNr,
          journalCount: firstEntry.lessons
        }
      : null
    const duplicateInfo = firstEntryDiscrepancy
      ? this.findDuplicateMatches(firstEntryDiscrepancy.entryId, firstEntryDiscrepancy.date)
      : { exactMatches: [] }
    const hasDuplicates = duplicateInfo.exactMatches.length > 1

    const btnContainer = this.#el('div', { style: 'display:flex;justify-content:center;flex-wrap:wrap;gap:4px;' })
    for (const entry of (discrepancy.entries ?? [])) {
      const entryDiscrepancy = {
        ...discrepancy,
        entryId: entry.id,
        journalStart: entry.startLessonNr,
        journalCount: entry.lessons
      }
      const duplicateIndex = this.calculateDuplicateIndex(entryDiscrepancy)
      const humanIndex = duplicateIndex + 1
      const buttonText = hasDuplicates
        ? `Muuda ${entry.startLessonNr}. (${entry.lessons}t) #${humanIndex}`
        : `Muuda ${entry.startLessonNr}. (${entry.lessons}t)`
      const tooltip = `Entry ID: ${entry.id}, Duplicate Index: ${duplicateIndex}`
      btnContainer.appendChild(this.#createButtonEl(
        `edit-entry-${discrepancy.date}-${entry.id}`,
        buttonText,
        'amber',
        {
          handler: 'editEntry',
          type: 'multiEntryFix',
          date: discrepancy.date,
          entryid: entry.id,
          duplicateindex: duplicateIndex
        },
        tooltip
      ))
    }

    return {
      start: this.#createSmartDisplayEl(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplayEl(discrepancy.journalCount, discrepancy.timetableCount),
      action: btnContainer
    }
  }

  /**
   * Finds the insertion point for the table in the DOM
   * @returns {HTMLElement} The insertion point element
   * @private
   */
  #findInsertionPoint() {
    // Prefer the new accordion header area introduced by the redesigned page.
    // The Angular-generated class part (e.g. ng-tns-c1628529983-11) may change between builds,
    // so prefer generic `.accordion-header` but fall back to the more specific pattern if present.
    const preferredSelectors = [
      // Prefer the whole accordion component so the table can be placed after it
      // Prefer the whole accordion component so the table can be placed after it
      'tahvel-accordion',
      // Generic accordion header used in new layout
      '.accordion-header',
      // Specific combined class (kept for backwards-compatibility with snapshot pages)
      '.accordion-header.ng-tns-c1628529983-11',
      // Older/fallback selectors
      'md-content .layout-padding',
      '.layout-padding',
      'md-content',
      '#main-content',
      '.main-content',
      'main'
    ]

    // Return the first visible element (width > 100px) from preferred selectors, or document.body as final fallback
    const candidates = preferredSelectors.map(selector => document.querySelector(selector))
    const found = candidates.find(element => {
      if (!element) return false
      if (!element.getBoundingClientRect) return false
      try {
        return element.getBoundingClientRect().width > 100
      } catch (e) {
        return false
      }
    })
    return found || document.body
  }

  /**
   * Creates a button with specified properties
   * @param {string} id - Button ID
   * @param {string} text - Button text
   * @param {string} colorKey - Color key from HEX object
   * @param {Object} data - Data attributes
   * @param {string} tooltip - Tooltip text
   * @returns {string} HTML string for the button
   * @private
   */
  #createButtonEl(id, text, colorKey, data = {}, tooltip = '') {
    const attrs = {
      className: `oa2-btn oa2-btn--${colorKey}`,
      style: DiscrepanciesTable.createButtonStyle(DiscrepanciesTable.HEX[colorKey])
    }
    if (id) attrs.id = id
    if (tooltip) attrs.title = tooltip
    const btn = this.#el('button', attrs, text)
    for (const [key, value] of Object.entries(data)) {
      btn.dataset[key.toLowerCase()] = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    return btn
  }

  /**
   * Formats a date for display in DD.MM.YYYY format
   * @param {string} date - Date string
   * @returns {string} Formatted date string
   * @private
   */
  #formatDisplayDate = date => {
    const dateObj = new Date(date)
    const day = dateObj.getDate().toString().padStart(2, '0')
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
    const year = dateObj.getFullYear()
    return `${day}.${month}.${year}`
  }

  /**
   * Creates a smart display showing current vs correct values
   * @param {number} currentValue - Current value
   * @param {number} correctValue - Correct value
   * @returns {string} HTML string for the display
   * @private
   */
  #createSmartDisplayEl = (currentValue, correctValue) => {
    const current = Number(currentValue)
    const correct = Number(correctValue)
    if (current === correct) return this.#el('span', { style: 'font-size:14px;font-weight:bold;' }, String(current))
    return this.#createDiffPillEl(current, correct)
  }

  #createPillEl = (text, color, backgroundColor, textDecoration = 'none') =>
    this.#el('span', { style: `background-color:${backgroundColor};color:${color};font-weight:bold;font-size:14px;padding:4px 8px;text-decoration:${textDecoration};` }, String(text))

  #createDiffPillEl = (current, correct) => {
    const currentPill = this.#createPillEl(current, '#721c24', '#f8d7da', 'line-through')
    const correctPill = this.#createPillEl(correct, '#155724', '#d1edcc')
    return this.#el('div', { style: 'display:inline-flex;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);' }, currentPill, correctPill)
  }
  #createBanner(text, colorClass, extraClass = '') {
    const div = document.createElement('div')
    div.className = `oa2-banner ${colorClass}${extraClass ? ' ' + extraClass : ''}`
    div.textContent = text
    return div
  }

  #createNotificationsHeader() {
    const header = document.createElement('div')
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #dee2e6;'
    const left = document.createElement('div')
    left.style.cssText = 'display:flex;align-items:center;'
    const emoji = document.createElement('span')
    emoji.style.cssText = 'font-size:20px;margin-right:10px;'
    emoji.textContent = '🎓'
    const title = document.createElement('h3')
    title.style.cssText = 'margin:0;color:#495057;'
    title.textContent = 'Õpetaja Assistent 2'
    left.appendChild(emoji)
    left.appendChild(title)
    const badge = document.createElement('div')
    badge.style.cssText = 'background:#ffc107;color:#212529;font-weight:bold;padding:6px 16px;border-radius:16px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.07);'
    badge.textContent = 'Hinded'
    header.appendChild(left)
    header.appendChild(badge)
    return header
  }

  // Helper to check whether a banner with the exact text already exists in the notifications node
  #bannerExists(notifications, text) {
    if (!notifications || !text) return false
    try {
      const banners = notifications.querySelectorAll('.oa2-banner, .oa2-banner-final-grade, .oa2-banner-ov')
      return Array.from(banners).some(b => (b.textContent || '').trim() === text.trim())
    } catch (e) {
      return false
    }
  }

  // Add this method to update the banner after highlighting
  updateMissingGradesBanner(missingGradesMessage) {
    const notifications = document.querySelector('[data-discrepancies-table] .notifications-section')
    if (!notifications) return
      notifications.textContent = ''
    notifications.appendChild(this.#createNotificationsHeader())
    // If missing grades message provided, show it.
    if (missingGradesMessage && !this.#bannerExists(notifications, missingGradesMessage)) {
      notifications.appendChild(this.#createBanner(missingGradesMessage, 'oa2-banner--red'))
    }

    // Check for OA final-grade mismatches (visual markers added by FinalGrades feature)
    try {
      const oaMismatches = document.querySelectorAll('.oa-final-grade-red')
      if (oaMismatches && oaMismatches.length > 0) {
        const text = 'Mõnedel õpilastel on vale lõpptulemus!'
        if (!this.#bannerExists(notifications, text)) {
          notifications.appendChild(this.#createBanner(text, 'oa2-banner--red', 'oa2-banner-final-grade'))
        }
      }
    } catch (e) { /* ignore DOM errors */ }

    // Also detect missing final-grade highlights (empty final grade cells highlighted by HighlightFinalGradesFeature)
    try {
      const finalRed = document.querySelectorAll('.highlight-final-grade-red')
      const finalYellow = document.querySelectorAll('.highlight-final-grade-yellow')
      if (finalRed && finalRed.length > 0) {
        const text = 'Mõnedel õpilastel puudub lõpptulemus'
        if (!this.#bannerExists(notifications, text)) {
          notifications.appendChild(this.#createBanner(text, 'oa2-banner--red', 'oa2-banner-final-grade'))
        }
      } else if (finalYellow && finalYellow.length > 0) {
        const text = 'Mõnedel õpilastel puudub Lõpptulemus (tähtaeg läheneb)!'
        if (!this.#bannerExists(notifications, text)) {
          notifications.appendChild(this.#createBanner(text, 'oa2-banner--yellow', 'oa2-banner-final-grade'))
        }
      }
    } catch (e) { /* ignore DOM errors */ }

    // Also detect final-grade header and empty final-grade cells even if highlight classes are missing
    try {
      const finalGradeHeaderIndices = []
      const headerRows = document.querySelectorAll('table.journalTable thead tr')
      headerRows.forEach(row => {
        let colIdx = 0
        Array.from(row.children).forEach(th => {
          const colspan = parseInt(th.getAttribute('colspan') || '1', 10) || 1
          const txt = (th.textContent || th.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()
          if (/lõpptulemus/.test(txt)) {
            for (let i = 0; i < colspan; i++) finalGradeHeaderIndices.push(colIdx + i)
          }
          colIdx += colspan
        })
      })
      if (finalGradeHeaderIndices.length > 0) {
        const bodyRows = document.querySelectorAll('table.journalTable tbody tr')
        let hasMissingFinals = false
        Array.from(bodyRows).some(row => {
          const cells = Array.from(row.children).filter(n => n.nodeType === 1)
          return finalGradeHeaderIndices.some(idx => {
            const c = cells[idx]
            if (!c) return false
            if (!(c.textContent || '').trim()) {
              hasMissingFinals = true
              return true
            }
            return false
          })
        })
        if (hasMissingFinals) {
          const text = 'Mõnedel õpilastel puudub lõpptulemus'
          if (!this.#bannerExists(notifications, text)) {
            notifications.appendChild(this.#createBanner(text, 'oa2-banner--red', 'oa2-banner-final-grade'))
          }
        }
      }
    } catch (e) { /* ignore DOM errors */ }
  }
}
