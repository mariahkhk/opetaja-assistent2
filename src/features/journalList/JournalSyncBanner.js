import { domService } from '../../services/DomService.js'
import { styleService } from '../../services/StyleService.js'
import { bannerService } from '../../services/BannerService.js'
import Logger from '../../services/Logger.js'

class DifferenceRenderer {
  render(container, assignmentNameDiffs, gradeDiffs, dueDateDiffs, entryDateDiffs, assignmentHoursDiffs, entryTypeDiffs, newAssignments) {
    // Only render on journal list page, never on edit page - accept modern variants
    if (!(window.location && window.location.hash && window.location.hash.indexOf('journals') !== -1)) return
    const groupedDiffs = this.collectAndGroupDifferences(
      assignmentNameDiffs,
      gradeDiffs,
      dueDateDiffs,
      entryDateDiffs,
      assignmentHoursDiffs,
      entryTypeDiffs,
      newAssignments
    )

    for (const subjectName in groupedDiffs) {
      const subjectContainer = this.createSubjectContainer(container, subjectName)
      groupedDiffs[subjectName].forEach(diff => {
        const row = this.createRow(subjectContainer, {
          journalId: diff.journalId,
          assignmentId: diff.assignmentId,
          type: diff.type,
          studentPersonalCode: diff.studentPersonalCode
        })
        const badges = domService.createAndInsertElement('div', { classList: ['badges'] }, '', row)
        // Use a special class for new assignments for styling
        if (diff.type === 'new') {
          this.createBadge(badges, diff.typeName, `badge-new`)
        } else {
          this.createBadge(badges, diff.typeName, `badge-${diff.type}`)
        }
        this.createBadge(badges, diff.assignmentName, 'badge-assignment')

        const values = domService.createAndInsertElement('div', { classList: ['values'] }, '', row)
        if (diff.studentName) {
          domService.createAndInsertElement('span', { classList: ['student-name'] }, `${diff.studentName}:`, values)
        }

        // For new assignments, show entryDate then dueDate (omit when missing)
        if (diff.type === 'new') {
          const datesContainer = domService.createAndInsertElement('div', { classList: ['new-assignment-dates'] }, '', values)
          if (diff.entryDate) {
            domService.createAndInsertElement('span', { classList: ['date-entry'] }, `Sissekanne: ${diff.entryDate}`, datesContainer)
          }
          if (diff.dueDate) {
            // show due date only if present
            domService.createAndInsertElement('span', { classList: ['date-due'] }, `Tähtaeg: ${diff.dueDate}`, datesContainer)
          }
        } else {
          const valueBadge = domService.createAndInsertElement('span', { classList: ['value-badge'] }, '', values)
          domService.createAndInsertElement('span', { classList: ['value-old'] }, diff.oldValue, valueBadge)
          domService.createAndInsertElement('span', { classList: ['value-new'] }, diff.newValue, valueBadge)
        }
      })
    }
  }

  // Utility to count newAssignments quickly
  countNewAssignmentsObj(newAssignments) {
    if (!newAssignments) return 0
    try {
      return Object.values(newAssignments).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
    } catch (err) {
      return 0
    }
  }

  collectAndGroupDifferences(assignmentNameDiffs, gradeDiffs, dueDateDiffs, entryDateDiffs, assignmentHoursDiffs, entryTypeDiffs, newAssignments) {
    const grouped = {}
    // Improved normalization: extract string from object, fallback to JSON if needed
    const normalize = val => {
      if (val === null || val === undefined || val === '') return null
      if (typeof val === 'object') {
        if ('kriit' in val && val.kriit) return String(val.kriit)
        if ('Tahvel' in val && val.Tahvel) return String(val.Tahvel)
        if (typeof val.toString === 'function' && val.toString !== Object.prototype.toString) return val.toString()
        return JSON.stringify(val)
      }
      return String(val)
    }

    // Format date as dd.mm.yyyy if possible
    const formatDate = val => {
      if (!val) return null
      // Accept ISO, yyyy-mm-dd, yyyy-mm-ddTHH:mm:ss, etc.
      const dateMatch = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (dateMatch) {
        return `${dateMatch[3]}.${dateMatch[2]}.${dateMatch[1]}`
      }
      return String(val)
    }

    // Track latest assignment name for each assignmentExternalId
    const latestNames = {}

    // Helper to add a difference to the grouped object (by subjectName only)
    const addDiff = (subjectName, diff) => {
      const key = subjectName
      if (!grouped[key]) {
        grouped[key] = []
      }
      grouped[key].push(diff)
    }

    // Name Diffs first
    ;(assignmentNameDiffs || []).forEach(subject => {
      (subject.nameDiffs || []).forEach(nameDiff => {
        // Update latest name for this assignment
        latestNames[nameDiff.assignmentExternalId] = nameDiff.kriit || nameDiff.Tahvel
        // Always show both old and new name in the badge
        const oldName = normalize(nameDiff.Tahvel) || 'puudub'
        const newName = normalize(nameDiff.kriit) || 'puudub'
        addDiff(subject.subjectName, {
          type: 'name',
          typeName: 'Nimetus',
          assignmentName: oldName,
          studentName: '',
          oldValue: oldName,
          newValue: newName,
          journalId: subject.subjectExternalId,
          assignmentId: nameDiff.assignmentExternalId
        })
      })
    })

    // Helper to get latest assignment name
    const getAssignmentName = (assignmentExternalId, fallback) => latestNames[assignmentExternalId] || fallback

    // Helper to get new name if a name change exists for this assignmentExternalId
    const getNewNameIfChanged = assignmentExternalId => {
      // Search assignmentNameDiffs for a nameDiff with this assignmentExternalId
      for (const subject of assignmentNameDiffs || []) {
        for (const nameDiff of subject.nameDiffs || []) {
          if (nameDiff.assignmentExternalId === assignmentExternalId && nameDiff.kriit) {
            return nameDiff.kriit
          }
        }
      }
      return null
    }

    // Grade Diffs
    ;(gradeDiffs || []).forEach(subject => {
      (subject.assignments || []).forEach(assignment => {
        // Always use the new name if a name change exists, fallback to latest name, then all possible sources, and normalize
        let assignmentName = getNewNameIfChanged(assignment.assignmentExternalId)
        if (!assignmentName)
          assignmentName = getAssignmentName(
            assignment.assignmentExternalId,
            typeof assignment.assignmentName === 'object' && assignment.assignmentName !== null
              ? assignment.assignmentName.kriit || assignment.assignmentName.Tahvel
              : assignment.assignmentName
          )
        if (!assignmentName) assignmentName = assignment.assignmentName || assignment.assignmentName?.kriit || assignment.assignmentName?.Tahvel
        assignmentName = normalize(assignmentName) || '—'
        ;(assignment.results || []).forEach(result => {
          const tahvelGrade = normalize(result.currentGrade)
          const kriitGrade = normalize(result.grade)

          if (tahvelGrade !== kriitGrade) {
            addDiff(subject.subjectName, {
              type: 'grade',
              typeName: 'Hinne',
              assignmentName: assignmentName,
              studentName: result.studentName,
              oldValue: tahvelGrade || 'puudub',
              newValue: kriitGrade || 'puudub',
              journalId: subject.subjectExternalId,
              assignmentId: assignment.assignmentExternalId,
              studentPersonalCode: result.studentPersonalCode
            })
          }
        })
      })
    })

    // Due Date Diffs
    ;(dueDateDiffs || []).forEach(diff => {
      // assignmentName should always be the assignment's name, not a date
      let assignmentName = getNewNameIfChanged(diff.assignmentExternalId)
      if (!assignmentName)
        assignmentName = getAssignmentName(
          diff.assignmentExternalId,
          typeof diff.assignmentName === 'object' && diff.assignmentName !== null
            ? diff.assignmentName.kriit || diff.assignmentName.Tahvel
            : diff.assignmentName
        )
      if (!assignmentName) assignmentName = diff.assignmentName || diff.kriit || diff.Tahvel
      assignmentName = normalize(assignmentName) || '—'
      addDiff(diff.subjectName || '', {
        type: 'duedate',
        typeName: 'Tähtaeg',
        assignmentName: assignmentName,
        studentName: '',
        oldValue: formatDate(normalize(diff.Tahvel)) || 'puudub',
        newValue: formatDate(normalize(diff.kriit)) || 'puudub',
        journalId: diff.subjectExternalId,
        assignmentId: diff.assignmentExternalId
      })
    })

    // Entry Date Diffs
    ;(entryDateDiffs || []).forEach(diff => {
      // assignmentName should always be the assignment's name, not a date
      let assignmentName = getNewNameIfChanged(diff.assignmentExternalId)
      if (!assignmentName)
        assignmentName = getAssignmentName(
          diff.assignmentExternalId,
          typeof diff.assignmentName === 'object' && diff.assignmentName !== null
            ? diff.assignmentName.kriit || diff.assignmentName.Tahvel
            : diff.assignmentName
        )
      if (!assignmentName) assignmentName = diff.assignmentName || diff.kriit || diff.Tahvel
      assignmentName = normalize(assignmentName) || '—'
      addDiff(diff.subjectName || '', {
        type: 'entrydate',
        typeName: 'Sissekande kuupäev',
        assignmentName: assignmentName,
        studentName: '',
        oldValue: formatDate(normalize(diff.Tahvel)) || 'puudub',
        newValue: formatDate(normalize(diff.kriit)) || 'puudub',
        journalId: diff.subjectExternalId,
        assignmentId: diff.assignmentExternalId
      })
    })

    // Assignment Hours Diffs
    ;(assignmentHoursDiffs || []).forEach(diff => {
      let assignmentName = getNewNameIfChanged(diff.assignmentExternalId)
      if (!assignmentName)
        assignmentName = getAssignmentName(
          diff.assignmentExternalId,
          typeof diff.assignmentName === 'object' && diff.assignmentName !== null
            ? diff.assignmentName.kriit || diff.assignmentName.Tahvel
            : diff.assignmentName
        )
      if (!assignmentName) assignmentName = diff.assignmentName
      assignmentName = normalize(assignmentName) || '—'

      // Get the current lessons value from Tahvel data sent to Kriit
      let currentLessons = 'määramata'
      try {
        const tahvelData = (window.journalListSync && window.journalListSync.tahvelData) || []
        // Find the subject and assignment to get the current lessons value
        const subject = tahvelData.find(s => String(s.subjectExternalId) === String(diff.subjectExternalId))
        if (subject && subject.assignments) {
          const assignment = subject.assignments.find(a => String(a.assignmentExternalId) === String(diff.assignmentExternalId))
          if (assignment && typeof assignment.lessons !== 'undefined' && assignment.lessons !== null) {
            currentLessons = `${assignment.lessons} tundi`
          }
        }
      } catch (err) {
        // If we can't find the current value, fall back to 'määramata'
      }

      addDiff(diff.subjectName || '', {
        type: 'hours',
        typeName: 'Tundide arv',
        assignmentName: assignmentName,
        studentName: '',
        oldValue: currentLessons,
        newValue: `${diff.kriitHours} tundi`,
        journalId: diff.subjectExternalId,
        assignmentId: diff.assignmentExternalId
      })
    })

    // Helper to convert entry type codes to readable names
    const getEntryTypeName = code => {
      if (!code) return 'puudub'
      const entryTypeMap = {
        SISSEKANNE_I: 'Iseseisev töö',
        SISSEKANNE_P: 'Praktiline töö',
        SISSEKANNE_H: 'Hindeline töö',
        SISSEKANNE_L: 'Tund',
        SISSEKANNE_O: 'Õpitulemused'
      }
      return entryTypeMap[code] || code
    }

    // Entry Type Diffs
    ;(entryTypeDiffs || []).forEach(diff => {
      let assignmentName = getNewNameIfChanged(diff.assignmentExternalId)
      if (!assignmentName)
        assignmentName = getAssignmentName(
          diff.assignmentExternalId,
          typeof diff.assignmentName === 'object' && diff.assignmentName !== null
            ? diff.assignmentName.kriit || diff.assignmentName.Tahvel
            : diff.assignmentName
        )
      if (!assignmentName) assignmentName = diff.assignmentName
      assignmentName = normalize(assignmentName) || '—'
      addDiff(diff.subjectName || '', {
        type: 'entrytype',
        typeName: 'Sissekande tüüp',
        assignmentName: assignmentName,
        studentName: '',
        oldValue: getEntryTypeName(diff.Tahvel),
        newValue: getEntryTypeName(diff.kriit)
      })
    })

    // New Assignments (returned by Kriit as newAssignments: { subjectExternalId: [ { assignmentName, ... } ] })
    try {
      const na = newAssignments || (window.journalListSync && window.journalListSync.newAssignments) || {}

      // Ensure a small cache on window.journalListSync for subject names by external id
      if (typeof window !== 'undefined') {
        window.journalListSync = window.journalListSync || {}
        window.journalListSync.subjectsCache = window.journalListSync.subjectsCache || {}
      }
      const subjectsCache = (window.journalListSync && window.journalListSync.subjectsCache) || {}

      // Source of subject names from existing difference data if available
      const subjectFromDiffs = (window.journalListSync && window.journalListSync.differences) || []

      // Iterate subjects
      for (const subjectExternalId of Object.keys(na)) {
        const arr = na[subjectExternalId] || []

        // Prefer cached subject name
        let subjectName = subjectsCache[subjectExternalId]

        // Try to derive from differences if not cached
        if (!subjectName) {
          const subjectObj = subjectFromDiffs.find(s => String(s.subjectExternalId) === String(subjectExternalId))
          subjectName = (subjectObj && subjectObj.subjectName) || null
        }

        // Fallback
        if (!subjectName) {
          subjectName = `Päevik ${subjectExternalId}`
        }

        // Keep it in cache for future renders
        try {
          if (window && window.journalListSync) window.journalListSync.subjectsCache[subjectExternalId] = subjectName
        } catch (err) {
          // ignore cache write errors
        }

        arr.forEach(a => {
          const assignmentName = normalize(a.assignmentName) || `Ülesanne ${a.createdAssignmentId || ''}`
          const entryRaw = a.assignmentEntryDate || null
          const dueRaw = a.assignmentDueAt || null
          const entryFormatted = formatDate(entryRaw)
          const dueFormatted = formatDate(dueRaw)
          addDiff(subjectName || '', {
            type: 'new',
            typeName: 'Uus ülesanne',
            assignmentName: assignmentName,
            studentName: '',
            entryDate: entryFormatted,
            dueDate: dueFormatted,
            createdAssignmentId: a.createdAssignmentId || null,
            assignmentExternalId: a.assignmentExternalId || null,
            journalId: subjectExternalId
          })
        })
      }
    } catch (err) {
      // don't let banner rendering fail on unexpected data
      Logger.debug('Error rendering newAssignments in banner:', err)
    }

    return grouped
  }

  createSubjectContainer(container, subjectGroupKey) {
    const subjectContainer = domService.createAndInsertElement('div', {}, '', container)
    domService.createAndInsertElement('h3', {}, subjectGroupKey, subjectContainer)
    return subjectContainer
  }

  createRow(container, rowIdentifier = {}) {
    const row = domService.createAndInsertElement('div', { classList: ['change-item'] }, '', container)

    // Add data attributes for row identification
    if (rowIdentifier.journalId) row.dataset.journalId = rowIdentifier.journalId
    if (rowIdentifier.assignmentId) row.dataset.assignmentId = rowIdentifier.assignmentId
    if (rowIdentifier.type) row.dataset.diffType = rowIdentifier.type
    if (rowIdentifier.studentPersonalCode) row.dataset.studentPersonalCode = rowIdentifier.studentPersonalCode

    // Add status indicator element (initially hidden)
    const statusIndicator = domService.createAndInsertElement(
      'span',
      {
        classList: ['sync-status-indicator'],
        style: 'margin-left: 8px; font-size: 1.2em; display: none;'
      },
      '',
      row
    )

    return row
  }

  createBadge(row, text, className) {
    return domService.createAndInsertElement(
      'span',
      {
        classList: ['badge', className]
      },
      text,
      row
    )
  }
}

export const differenceRenderer = new DifferenceRenderer()

export class JournalSyncBannerService {
  constructor() {
    this.stylesLoaded = false
  }

  /**
   * Load CSS styles specific to sync banners (lazy loading)
   */
  loadSyncStyles() {
    if (this.stylesLoaded || typeof document === 'undefined') {
      return
    }

    this.stylesLoaded = true

    // Load CSS asynchronously without blocking UI
    this._loadCSSAsync()
  }

  /**
   * Asynchronously load CSS from external file
   * @private
   */
  async _loadCSSAsync() {
    try {
      // Load CSS from external file
      const cssUrl = chrome.runtime.getURL('styles/JournalSyncBannerService.css')
      const response = await fetch(cssUrl)

      if (!response.ok) {
        throw new Error(`Failed to load CSS: ${response.status} ${response.statusText}`)
      }

      const css = await response.text()
      styleService.injectCSS(css, 'journal-sync-banner-styles')
    } catch (error) {
      Logger.error('Failed to load JournalSyncBannerService CSS:', error)
      // Fallback: continue without styles rather than breaking functionality
    }
  }

  /**
   * Show a banner when the Kriit API key is missing
   * @param {Function} onOpenSettings - Callback for opening settings
   */
  showMissingApiKeyBanner(onOpenSettings = null) {
    this.loadSyncStyles()
    if (!(window.location && window.location.hash && window.location.hash.indexOf('journals') !== -1)) return
    const container = bannerService.getBannerContainer()
    if (!container) return
    Logger.debug('Using banner container:', container)
    bannerService.removeBanner()

    // Add scoping container to prevent CSS leakage
    const scopedContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner-container']
      },
      '',
      container,
      'afterbegin'
    )

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['container']
      },
      '',
      scopedContainer
    )

    // Add title
    domService.createAndInsertElement('h1', {}, 'Kriit API võti puudub', banner)

    // Add message
    domService.createAndInsertElement(
      'p',
      {},
      'Kriit API võti on vajalik, et sünkroniseerida hindeid Tahvli ja Kriidi vahel. Palun sisestage API võti laienduse seadetes.',
      banner
    )

    // Add button to open extension popup
    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)
    domService.createAndInsertElement(
      'button',
      {
        classList: ['btn-primary'],
        onclick:
          onOpenSettings ||
          (() => {
            alert('Klõpsake laienduse ikoonil brauseri tööriistaribal ja sisestage Kriit API võti.')
          })
      },
      'Ava seaded',
      actions
    )

    // Update the banner service's current banner reference
    bannerService.currentBanner = scopedContainer

    Logger.debug('Missing API key banner created and displayed')
  }

  /**
   * Show green banner when all grades are in sync
   * @param {Function} onRefresh - Callback for refresh button
   * @param {Function} onClose - Callback for close button
   */
  showAllInSyncBanner(onRefresh = null, onClose = null) {
    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    Logger.debug('Using banner container:', container)
    bannerService.removeBanner()

    // Add scoping container to prevent CSS leakage
    const scopedContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner-container']
      },
      '',
      container,
      'afterbegin'
    )

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['container', 'ta-sync-info'],
        style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px;'
      },
      '',
      scopedContainer
    )

    // Add success icon
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-size: 3rem; margin-bottom: 18px; text-align: center;'
      },
      '✅',
      banner
    )

    // Add title
    domService.createAndInsertElement('h1', { style: 'margin-bottom: 12px; text-align: center;' }, 'Kõik hinded on sünkroonis!', banner)

    // Add message
    domService.createAndInsertElement(
      'p',
      { style: 'font-size: 1.15rem; margin-bottom: 18px; text-align: center;' },
      'Tahvli ja Kriidi vahel pole erinevusi. Kõik hinded on juba õigesti sünkroniseeritud.',
      banner
    )

    const actions = domService.createAndInsertElement('div', { classList: ['actions'], style: 'justify-content: center;' }, '', banner)
    // Add refresh button
    if (onRefresh) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-secondary'],
          onclick: onRefresh
        },
        'Värskenda',
        actions
      )
    }

    // Add close button
    if (onClose) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-secondary'],
          onclick: onClose
        },
        'Sulge',
        actions
      )
    }

    // Update the banner service's current banner reference
    bannerService.currentBanner = scopedContainer

    Logger.debug('All in sync banner created and displayed')
  }

  /**
   * Show differences banner
   * @param {number} totalDifferences - Total number of differences
   * @param {Function} onSync - Callback for sync button
   * @param {Function} onRefresh - Callback for refresh button
   * @param {Function} renderDifferences - Function to render the differences content
   */
  showDifferencesBanner(totalDifferences, onSync = null, onRefresh = null, renderDifferences = null) {
    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    Logger.debug('Using banner container:', container)
    bannerService.removeBanner()

    // Add scoping container to prevent CSS leakage
    const scopedContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner-container']
      },
      '',
      container,
      'afterbegin'
    )

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['container']
      },
      '',
      scopedContainer
    )

    // Add title
    domService.createAndInsertElement('h1', {}, 'Sünkroniseerimata muudatused', banner)

    const changesContainer = domService.createAndInsertElement('div', { id: 'changes' }, '', banner)

    // Add differences content if render function provided
    if (renderDifferences) {
      renderDifferences(changesContainer)
    }

    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)

    // Add sync button only if there are differences to sync
    let syncBtn = null
    let refreshBtn = null
    if (totalDifferences > 0 && onSync) {
      syncBtn = domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-primary']
        },
        'Sünkroniseeri kõik',
        actions
      )

      // Create a small spinner element (styled via CSS animation)
      const spinner = domService.createAndInsertElement(
        'span',
        { classList: ['sync-spinner'], style: 'margin-left:8px; display: none;', 'aria-hidden': 'true' },
        '',
        syncBtn
      )

      // Click handler wraps the provided onSync to manage UI state
      syncBtn.addEventListener('click', async() => {
        try {
          // Disable both action buttons
          const buttons = actions.querySelectorAll('button')
          buttons.forEach(b => (b.disabled = true))

          // Show spinner and change label
          spinner.style.display = 'inline-block'
          syncBtn.setAttribute('aria-busy', 'true')
          syncBtn.classList.add('loading')

          // Await the provided sync callback
          await onSync()
        } catch (err) {
          // Swallow here; error handling will be shown by the caller via banners
          Logger.warning('Sync action failed:', err)
        } finally {
          // Re-enable buttons and hide spinner
          const buttons = actions.querySelectorAll('button')
          buttons.forEach(b => (b.disabled = false))
          spinner.style.display = 'none'
          syncBtn.removeAttribute('aria-busy')
          syncBtn.classList.remove('loading')
        }
      })
    }

    if (onRefresh) {
      // If we've already created syncBtn above, create refreshBtn and keep reference
      refreshBtn = domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-secondary']
        },
        'Värskenda',
        actions
      )

      // Wire refresh to provided callback
      refreshBtn.addEventListener('click', () => onRefresh())
    }

    // Update the banner service's current banner reference
    bannerService.currentBanner = scopedContainer

    Logger.debug('Differences banner created and displayed')
  }

  /**
   * Update sync status for a specific difference item
   * @param {string} journalId - Journal/subject external ID
   * @param {string} assignmentId - Assignment external ID
   * @param {string} type - Difference type (name, grade, duedate, entrydate, hours, new)
   * @param {boolean} success - Whether the sync was successful
   * @param {string|null} studentPersonalCode - Student personal code (for grade changes)
   */
  updateItemSyncStatus(journalId, assignmentId, type, success, studentPersonalCode = null) {
    try {
      // Find all matching rows
      const selector = `.ta-sync-banner-container .change-item[data-journal-id="${journalId}"][data-assignment-id="${assignmentId}"][data-diff-type="${type}"]`
      const rows = document.querySelectorAll(selector)

      rows.forEach(row => {
        // For grade changes, also match student personal code
        if (type === 'grade' && studentPersonalCode) {
          const rowStudentCode = row.dataset.studentPersonalCode
          if (rowStudentCode !== studentPersonalCode) {
            return // Skip this row if student doesn't match
          }
        }

        // Find the status indicator in this row
        const statusIndicator = row.querySelector('.sync-status-indicator')
        if (statusIndicator) {
          statusIndicator.textContent = success ? '\u2705' : '\u274c' // ✅ or ❌
          statusIndicator.style.display = 'inline-block'
          statusIndicator.title = success ? 'Sünkroniseeritud' : 'Sünkroniseerimine ebaõnnestus'
        }
      })
    } catch (err) {
      Logger.warning(`Failed to update sync status for ${journalId}/${assignmentId}/${type}:`, err)
    }
  }

  /**
   * Show sync-specific error banner with detailed error handling
   * @param {string} error - Error message
   * @param {Object} options - Additional options
   * @param {Function} options.onRetry - Callback for retry button
   * @param {Function} options.onClearCache - Callback for clear cache button
   * @param {Function} options.onSettings - Callback for settings button
   * @param {Function} options.onRefresh - Callback for refresh button
   */
  showSyncErrorBanner(error, options = {}) {
    // If all grades are already synced, show the green banner instead
    // But *only* show the green banner when there are no newAssignments returned by Kriit
    if (error && error.includes('Kõik hinded on juba sünkroonis')) {
      const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
      if (!globalNewAssignments || Object.keys(globalNewAssignments).length === 0) {
        this.showAllInSyncBanner(options.onRetry, null)
        return
      }
      // If there are new assignments, fall through and let the caller show the differences banner
    }

    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    Logger.debug('Using banner container:', container)
    bannerService.removeBanner()

    // Add scoping container to prevent CSS leakage
    const scopedContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner-container']
      },
      '',
      container,
      'afterbegin'
    )

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['container', 'ta-sync-error']
      },
      '',
      scopedContainer
    )

    // Add error icon
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-size: 1.5rem; margin-bottom: 10px;'
      },
      '❌',
      banner
    )

    // Add error title - use different titles based on error type
    let errorTitle = 'Viga'

    if (error && error.includes('403')) {
      if (error.includes('Permission denied') || error.includes('rights to modify')) {
        errorTitle = 'Õiguste viga'
      } else {
        errorTitle = 'Autentimise viga'
      }
    } else if (error && error.includes('No journal links found')) {
      errorTitle = 'Päevikute leidmise viga'
    } else if (error && error.includes('API')) {
      errorTitle = 'API viga'
    } else if (error && error.includes('sync')) {
      errorTitle = 'Sünkroniseerimise viga'
    }

    domService.createAndInsertElement('h1', {}, errorTitle, banner)

    // Add error message
    domService.createAndInsertElement('p', {}, error, banner)

    // Add appropriate action buttons and help text based on error type
    this._addSyncErrorActions(banner, error, options)

    // Update the banner service's current banner reference
    bannerService.currentBanner = scopedContainer

    Logger.debug('Sync error banner created and displayed')
  }

  /**
   * Add sync-specific error actions and help text
   * @private
   */
  _addSyncErrorActions(banner, error, options) {
    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)
    if (error && error.includes('403')) {
      if (error.includes('Permission denied') || error.includes('rights to modify')) {
        // Permission error for journal modification
        domService.createAndInsertElement(
          'p',
          {},
          'Teil puuduvad õigused selle päeviku muutmiseks. Sünkroniseerimine Tahvlisse on võimalik ainult päeviku õpetajal.',
          banner
        )

        domService.createAndInsertElement(
          'p',
          {},
          'Tahvel lubab päeviku hindeid muuta ainult päeviku õpetajal. Kui te pole selle päeviku õpetaja, siis ei saa te hindeid sünkroniseerida.',
          banner
        )

        // Add refresh button
        if (options.onRetry) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-secondary'],
              onclick: options.onRetry
            },
            'Värskenda andmeid',
            actions
          )
        }
      } else {
        // Authentication error
        domService.createAndInsertElement('p', {}, 'See on autentimise viga. Palun kontrollige oma Kriit API võtit.', banner)

        // Add button to reset token
        if (options.onSettings) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-primary'],
              onclick: options.onSettings
            },
            'Lähtesta Kriit API võti',
            actions
          )

          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-secondary'],
              onclick: () => {
                alert('Klõpsake laienduse ikoonil brauseri tööriistaribal ja sisestage Kriit API võti.')
              }
            },
            'Ava seaded',
            actions
          )
        }
      }
    } else if (error && error.includes('No journal links found')) {
      // Journal link detection error
      domService.createAndInsertElement('p', {}, 'See funktsioon vajab päeviku linke lehel. Palun veenduge, et olete päevikute nimekirja lehel.', banner)

      // Add refresh page button
      if (options.onRefresh) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onRefresh
          },
          'Värskenda lehte',
          actions
        )
      }
    } else if (error && error.includes('Kõik hinded on juba sünkroonis')) {
      // Only treat this as 'all in sync' when there are no new assignments returned by Kriit
      const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
      if (!globalNewAssignments || Object.keys(globalNewAssignments).length === 0) {
        // All grades already in sync - show as info, not error
        banner.classList.remove('ta-sync-error')
        banner.classList.add('ta-sync-info')

        // Add refresh button
        if (options.onRetry) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-secondary'],
              onclick: options.onRetry
            },
            'Värskenda andmeid',
            actions
          )
        }

        // Add clear cache button
        if (options.onClearCache) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-secondary'],
              onclick: options.onClearCache
            },
            'Puhasta vahemälu',
            actions
          )
        }
      } else {
        // There are new assignments; do not show the all-in-sync info banner. Let the differences banner be shown.
      }
    } else if (error && (error.includes('sync') || error.includes('sünkroniseerimine'))) {
      // Sync error
      let helpText = 'Sünkroniseerimisel tekkis viga. Täpsemad veateated on saadaval konsoolist (F12).'

      // Add more specific help text for common errors
      if (error.includes('is not enrolled in this assignment')) {
        helpText =
          'Õpilane on leitud Tahvlis, kuid ta ei ole selle ülesande nimekirjas. Sünkroniseerimine ei ole võimalik, kuna õpilane ei ole selle ülesande osalejate nimekirjas. See võib juhtuda, kui õpilane on Kriidis, kuid ei ole selle konkreetse ülesande nimekirjas Tahvlis.'
      } else if (error.includes('Could not find student with personal code') || error.includes('Refusing to update a different student')) {
        helpText =
          'Õpilase isikukoodi ei leitud Tahvlis. Sünkroniseerimine ei ole võimalik, kuna me ei saa tuvastada, millise õpilase hinnet tuleks muuta. See võib juhtuda, kui õpilane on Kriidis, kuid mitte Tahvlis, või kui isikukoodid on erinevates formaatides.'
      }

      domService.createAndInsertElement('p', {}, helpText, banner)

      // Add retry button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onRetry
          },
          'Värskenda andmeid',
          actions
        )
      }
    } else {
      // Generic error
      domService.createAndInsertElement('p', {}, 'Proovige lehte värskendada või puhastada vahemälu.', banner)

      // Add retry button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onRetry
          },
          'Proovi uuesti',
          actions
        )
      }

      // Add refresh page button
      if (options.onRefresh) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: () => window.location.reload()
          },
          'Värskenda lehte',
          actions
        )
      }

      // Add clear cache button
      if (options.onClearCache) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onClearCache
          },
          'Puhasta vahemälu',
          actions
        )
      }
    }
  }
}

// Export a singleton instance
export const journalSyncBannerService = new JournalSyncBannerService()
