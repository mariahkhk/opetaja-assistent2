// HighlightMissingGradesFeature.js
// Highlights cells in independent work columns in red if due date has passed and no grade is assigned

import { BaseFeature } from '../../../core/BaseFeature.js'

class HighlightMissingGradesFeature extends BaseFeature {
  constructor() {
    super('highlightMissingGrades', /#\/journal\//)
    console.debug('[HighlightMissingGradesFeature] constructor called')
  }

  injectMissingGradeCSS() {
    if (!document.getElementById('highlight-missing-grade-style')) {
      const style = document.createElement('style')
      style.id = 'highlight-missing-grade-style'
      style.textContent = `
                .highlight-missing-grade {
                    background: #ffdddd !important;
                    box-shadow: 0 0 0 2px #ff0000 inset !important;
                    position: relative;
                    cursor: pointer;
                }
            `
      document.head.appendChild(style)
    }
  }

  onActivate() {
    console.debug('[HighlightMissingGradesFeature] onActivate called')

    // Set up message listener for real-time toggle from popup
    if (!this._messageListener) {
      this._messageListener = (message) => {
        if (message.action === 'highlightMissingGradesChanged') {
          if (!message.enabled) {
            this.#removeAllHighlights()
            if (this._activateTimer) { clearTimeout(this._activateTimer); this._activateTimer = null }
            if (this._observer) { this._observer.disconnect(); this._observer = null }
            if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null }
            this._isUpdating = false
          } else {
            this.#activateFeature()
          }
        }
      }
      chrome.runtime.onMessage.addListener(this._messageListener)
    }

    // Check if feature is enabled in settings (default: true)
    chrome.storage.sync.get(['OA_highlightMissingGrades'], (result) => {
      if (result['OA_highlightMissingGrades'] === false) {
        console.debug('[HighlightMissingGradesFeature] Feature disabled in settings')
        return
      }
      this.#activateFeature()
    })
  }

  #activateFeature() {
    if (this._activateTimer) clearTimeout(this._activateTimer)
    this._activateTimer = setTimeout(() => {
      this._activateTimer = null;
      (async() => {
        await this.run()
      })()
    }, 1000)
    if (!this._observer) {
      this._debounceTimer = null
      this._isUpdating = false // Flag to prevent recursive updates
      this._observer = new MutationObserver(mutations => {
        // Skip if we're currently updating (to prevent infinite loops)
        if (this._isUpdating) {
          return
        }

        // Filter out mutations that are just our own highlighting changes
        const relevantMutations = mutations.filter(mutation => {
          // Ignore class changes that only involve our highlight class
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target
            const oldValue = mutation.oldValue || ''
            const newValue = target.className || ''
            // If the only change is adding/removing highlight-missing-grade, ignore it
            const oldHasHighlight = oldValue.includes('highlight-missing-grade')
            const newHasHighlight = newValue.includes('highlight-missing-grade')
            const otherClassesOld = oldValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()
            const otherClassesNew = newValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()
            if (oldHasHighlight !== newHasHighlight && otherClassesOld === otherClassesNew) {
              return false // This is just our highlight change, ignore it
            }
          }

          // Ignore title attribute changes (our tooltips)
          if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
            return false
          }

          // Ignore style changes on non-header elements (hover effects on cells)
          if (mutation.type === 'attributes' && mutation.attributeName === 'style' && mutation.target.tagName !== 'TH') {
            return false
          }

          // Ignore childList mutations that don't add/remove table rows (e.g. tooltips, popovers on hover)
          if (mutation.type === 'childList') {
            const hasTableNodes = [...mutation.addedNodes, ...mutation.removedNodes].some(
              node => node.nodeType === 1 && ['TR', 'TD', 'TH', 'TABLE', 'THEAD', 'TBODY'].includes(node.tagName)
            )
            if (!hasTableNodes) return false
          }

          return true
        })

        if (relevantMutations.length === 0) {
          return // No relevant mutations
        }

        // Check if any relevant mutation affects the studentTable or its descendants
        const affectsStudentTable = relevantMutations.some(mutation => {
          const target = mutation.target
          // Check if the mutation target is within #studentTable
          const studentTable = document.getElementById('studentTable')
          if (!studentTable) return true // If studentTable not found, react to any change

          // Check if target is studentTable itself or a descendant
          return target === studentTable || studentTable.contains(target) || target.contains(studentTable)
        })

        if (affectsStudentTable) {
          console.debug('[HighlightMissingGradesFeature] studentTable change detected, scheduling re-run')
          // Debounce to avoid excessive re-runs during rapid DOM changes
          if (this._debounceTimer) {
            clearTimeout(this._debounceTimer)
          }
          this._debounceTimer = setTimeout(() => {
            this.run()
          }, 300) // Increased debounce time
        }
      })

      // Observe the entire document but filter mutations in the callback
      this._observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-grade', 'data-absence', 'data-student-id', 'data-journal-student', 'style'],
        attributeOldValue: true // This helps us compare old vs new values
      })
    }
  }

  #removeAllHighlights() {
    document.querySelectorAll('.highlight-missing-grade').forEach(el => {
      el.classList.remove('highlight-missing-grade')
      el.title = ''
    })
  }

  onDeactivate() {
    console.debug('[HighlightMissingGradesFeature] onDeactivate called')
    if (this._activateTimer) {
      clearTimeout(this._activateTimer)
      this._activateTimer = null
    }
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
      this._debounceTimer = null
    }
    if (this._messageListener) {
      chrome.runtime.onMessage.removeListener(this._messageListener)
      this._messageListener = null
    }
    this._isUpdating = false
  }

  async run() {
    // Prevent recursive calls
    if (this._isUpdating) {
      return
    }

    this._isUpdating = true
    this.injectMissingGradeCSS()

    // First try to find table within #studentTable container
    let table = null
    const studentTableContainer = document.getElementById('studentTable')
    if (studentTableContainer) {
      table = studentTableContainer.querySelector('table')
      console.debug('[HighlightMissingGradesFeature] run(): found table inside #studentTable')
    }

    if (!table) {
      const layoutPadding = document.querySelector('.layout-padding')
      if (!layoutPadding) {
        console.debug('[HighlightMissingGradesFeature] run(): .layout-padding not found, attempting fallbacks')
      }
      // Prefer table inside layoutPadding, but fall back to global selectors if not present
      if (layoutPadding) table = layoutPadding.querySelector('table.journalTable')
      if (!table) {
        // Try a few common alternative selectors used in different UI versions
        const candidates = ['table.journalTable', '#main-content table.journalTable', 'table[class*="journal"]', '#main-content table']
        for (const sel of candidates) {
          try {
            const t = document.querySelector(sel)
            if (t) {
              table = t
              console.debug('[HighlightMissingGradesFeature] run(): found table via fallback selector', sel)
              break
            }
          } catch (e) {
            // ignore
          }
        }
      } else {
        console.debug('[HighlightMissingGradesFeature] run(): found table inside .layout-padding')
      }
    }

    if (!table) {
      console.debug('[HighlightMissingGradesFeature] run(): journal table not found, aborting')
      this._isUpdating = false
      return
    }
    // Remove all previous highlights
    table.querySelectorAll('.highlight-missing-grade').forEach(cell => {
      cell.classList.remove('highlight-missing-grade')
      cell.title = ''
    })
    const headerCells = Array.from(table.querySelectorAll('thead th'))
    console.debug('[HighlightMissingGradesFeature] run(): headerCells count', headerCells.length)
    const nowDate = new Date()

    // Try to extract journalId from URL
    const journalIdMatch = window.location.href.match(/\/journal\/(\d+)/)
    const journalId = journalIdMatch ? parseInt(journalIdMatch[1], 10) : null
    if (!journalId) {
      this._isUpdating = false
      return
    }

    // Fetch journalEntries from API (cache for performance)
    let journalEntries = []
    try {
      journalEntries = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        { cache: true, cacheExpiration: 6e4 }
      )
    } catch (e) {
      console.info('[HighlightMissingGradesFeature] run(): failed to fetch journalEntries', e)
      this._isUpdating = false
      return
    }
    if (!Array.isArray(journalEntries) || journalEntries.length === 0) {
      console.debug('[HighlightMissingGradesFeature] run(): journalEntries empty or not array', journalEntries)
      this._isUpdating = false
      return
    }
    console.debug('[HighlightMissingGradesFeature] run(): journalEntries length', journalEntries.length)

    // Map columns to journalEntries by matching header cell date text to entry.entryDate
    const entryColumns = headerCells.slice(2)
    const iseseisevColumns = []

    // Build lookup by day-month string for entries (e.g. '18.09' -> [entries])
    const entriesByDayMonth = {}
    journalEntries.forEach(e => {
      const dStr =
        e && e.entryDate
          ? (() => {
              try {
                const d = new Date(e.entryDate)
                return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
              } catch (err) {
                return null
              }
            })()
          : null
      if (dStr) {
        if (!entriesByDayMonth[dStr]) entriesByDayMonth[dStr] = []
        entriesByDayMonth[dStr].push(e)
      }
    })

    const entryDetailPromises = entryColumns.map(async(th, i) => {
      const rawHeader = (th.textContent || th.innerText || '').replace(/\s+/g, ' ').trim()
      // Try to extract day.month from header (e.g. '18.09' or '18.09.2025' or '18.09')
      const dmMatch = rawHeader.match(/(\d{1,2})[./](\d{1,2})/)
      let matchedEntry = null
      if (dmMatch) {
        const day = String(dmMatch[1]).padStart(2, '0')
        const month = String(dmMatch[2]).padStart(2, '0')
        const key = `${day}.${month}`
        const candidates = entriesByDayMonth[key] || []
        if (candidates.length === 1) {
          matchedEntry = candidates[0]
        } else if (candidates.length > 1) {
          // Prefer independent-work entry if present
          const pref = candidates.find(c => c.entryType === 'SISSEKANNE_I')
          matchedEntry = pref || candidates[0]
        }
      }
      // Fallback to positional mapping if no match
      const entry = matchedEntry || journalEntries[i]
      if (entry && entry.entryType === 'SISSEKANNE_I') {
        let entryDetail = entry
        // Fetch full entry details to get homeworkDuedate if not present
        if (!entry.homeworkDuedate) {
          try {
            entryDetail = await this.api.tahvel.get(
              `/journals/${journalId}/journalEntry/${entry.id}`,
              { allStudents: true },
              { cache: true, cacheExpiration: 6e4 }
            )
          } catch (e) {
            void e
          }
        }
        const dueDateStr = entryDetail.homeworkDuedate || entryDetail.entryDate
        const dueDate = dueDateStr ? new Date(dueDateStr) : null
        if (dueDate && dueDate < nowDate) {
          iseseisevColumns.push({ idx: i + 2, entry: entryDetail })
        }
      }
    })
    await Promise.all(entryDetailPromises)
    console.debug(
      '[HighlightMissingGradesFeature] run(): detected iseseisevColumns (pre-filter)',
      iseseisevColumns.map(c => c.idx)
    )
    // Only keep columns whose header cell has the independent-work background color (#ecfccb / rgb(236, 252, 203))
    const isGreenHeader = th => {
      if (!th) return false
      try {
        // check inline style first
        const inline = th.style && th.style.backgroundColor
        const comp = window.getComputedStyle ? window.getComputedStyle(th).backgroundColor : null
        const bg = (inline && inline.trim()) || (comp && comp.trim()) || ''
        // normalize rgb/rgba to lowercase
        const normalized = (bg || '').replace(/\s+/g, '').toLowerCase()
        // possible representations
        const greenRgb = 'rgb(236,252,203)'
        const greenRgba = 'rgba(236,252,203,1)'
        const greenHex = '#ecfccb'
        return normalized === greenRgb || normalized === greenRgba || normalized === greenHex
      } catch (e) {
        return false
      }
    }
    const preFilterIdxs = iseseisevColumns.map(c => c.idx)
    const filtered = iseseisevColumns.filter(c => {
      const th = headerCells[c.idx]
      return isGreenHeader(th)
    })
    if (filtered.length !== iseseisevColumns.length) {
      console.debug(
        '[HighlightMissingGradesFeature] run(): filtered iseseisevColumns to only green headers. before:',
        preFilterIdxs,
        'after:',
        filtered.map(c => c.idx)
      )
    }
    // Use filtered list from now on
    const finalIseseisevColumns = filtered
    if (finalIseseisevColumns.length > 0) {
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      console.debug('[HighlightMissingGradesFeature] run(): rows count', rows.length)

      // helper: robustly extract student id from row/cell
      const extractStudentId = (r, c) => {
        // Try several attributes used in the app: data-student-id, data-journal-student, dataset.journalStudent
        const attrs = ['data-student-id', 'data-journal-student', 'data-journal-student-id', 'data-journalstudent', 'data-journal-student-id']
        for (const a of attrs) {
          const v = (c && c.getAttribute && c.getAttribute(a)) || (r && r.getAttribute && r.getAttribute(a))
          if (v) return v.toString()
        }
        if (r && r.dataset) {
          if (r.dataset.journalStudent) return r.dataset.journalStudent.toString()
          if (r.dataset.studentId) return r.dataset.studentId.toString()
        }
        return null
      }

      // helper: get visible text from a cell (prefer direct inner text of specific child elements)
      const getCellText = c => {
        if (!c) return ''
        // If there's an element that likely contains the grade, prefer its text
        const selectors = ['[data-grade]', '[data-absence]', '.grade', '.grade-value', '.value', 'span', 'div']
        for (const s of selectors) {
          try {
            const el = c.querySelector && c.querySelector(s)
            if (el && el.textContent && el.textContent.trim()) return el.textContent.trim()
          } catch (e) {
            // ignore selector errors
          }
        }
        return (c.textContent || '').trim()
      }

      rows.forEach((row, _rowIdx) => {
        const cells = Array.from(row.children)
        // Check if student has AP status in their name cell (check first 3 columns to be safe)
        const hasAPStatus = [cells[0], cells[1], cells[2]].some(cell => {
          if (!cell) return false
          const text = getCellText(cell)
          const hasAP = /\bAP\b/.test(text)
          if (hasAP) {
            console.debug('[HighlightMissingGradesFeature] Found AP status in row', _rowIdx, 'cell text:', text)
          }
          return hasAP
        })

        finalIseseisevColumns.forEach(({ idx, entry }) => {
          const cell = cells[idx]
          if (!cell) return
          const studentId = extractStudentId(row, cell)
          console.debug('[HighlightMissingGradesFeature] run(): row idx', _rowIdx, 'col idx', idx, 'studentId', studentId)
          let grade = ''
          let absence = ''
          if (studentId && entry.journalStudentResults && entry.journalStudentResults[studentId]) {
            const results = entry.journalStudentResults[studentId]
            if (Array.isArray(results) && results.length > 0) {
              const g = results[0].grade
              if (g === null || g === undefined || g === '' || (typeof g === 'object' && (!g.code || g.code === ''))) {
                grade = ''
              } else if (typeof g === 'object' && g.code) {
                grade = g.code
              } else {
                grade = g
              }
              if (!grade && results[0].verbalGrade) grade = results[0].verbalGrade
              absence = results[0].absence || ''
            }
          } else {
            // DOM-only fallback: try attributes first, then inner text
            grade = cell.getAttribute && (cell.getAttribute('data-grade') || cell.getAttribute('data-grade-value'))
            if (!grade && cell.dataset) grade = cell.dataset.grade || cell.dataset.value
            if (!grade) grade = getCellText(cell)
            const absenceAttr = cell.getAttribute && (cell.getAttribute('data-absence') || cell.getAttribute('data-absence-code'))
            absence = absenceAttr || ''
            // If absence not in attribute, try to detect from text (common short markers H, P, PUUDUMINE)
            if (!absence) {
              const txt = (cell.textContent || '').trim()
              if (/puudumine/i.test(txt)) absence = 'PUUDUMINE'
              else if (/^\s*[HP]\s*$/i.test(txt)) absence = txt.trim().toUpperCase()
            }
          }
          // Unified valid grades set
          const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])
          // Highlight if grade is missing (not in validGrades) and absence is empty or PUUDUMINE_H/PUUDUMINE_P/H/P
          // Don't highlight if student has AP status in their name cell
          const shouldHighlight =
            !hasAPStatus &&
            (!grade || !validGrades.has(grade)) &&
            (absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P')
          if (shouldHighlight) {
            console.debug('[HighlightMissingGradesFeature] run(): will highlight cell', { row: _rowIdx, col: idx, studentId, grade, absence })
            cell.classList.add('highlight-missing-grade')
            // Set tooltip with due date in required format
            const dueDateStr = entry.homeworkDuedate || entry.entryDate
            let tooltipDate = ''
            if (dueDateStr) {
              const d = new Date(dueDateStr)
              tooltipDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
            }
            cell.title = tooltipDate ? `Tähtaeg oli ${tooltipDate}, aga hinne puudub` : 'Hinne puudub'
          } else {
            if (console && console.debug)
              console.debug('[HighlightMissingGradesFeature] run(): not highlighting', { row: _rowIdx, col: idx, studentId, grade, absence })
            cell.classList.remove('highlight-missing-grade')
          }
        })
      })
    }

    // Reset the updating flag
    this._isUpdating = false
  }
}

export default HighlightMissingGradesFeature
