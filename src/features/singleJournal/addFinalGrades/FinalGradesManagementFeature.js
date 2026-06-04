/* eslint-disable security/detect-unsafe-regex -- all regexes in this file operate on short, anchored grade strings from Tahvel API */
import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { domService } from '../../../services/DomService.js'
import { extractOutcomeNumberFromOutcomeEntryName, extractOutcomeNumbersFromEntryName } from '../../../lib/extractOutcomeNumbersFromEntryName.js'
import { getNativeJournalHeaderRows } from '../../../lib/journalTableHeaders.js'
import { injectFinalGradeCSS, markMismatch, clearMismatch } from './FinalGradeHighlighter.js'
import {
  applyGradingMode,
  resolveGradingMode,
  getRecordedOutcomeGradeTokens,
  getRecordedFinalGradeTokens
} from './GradingMode.js'

class FinalGradesByOvFeature extends BaseFeature {
  // Helper to fetch and transform detailed outcome data for SISSEKANNE_O
  async fetchDetailedOutcomeStudents(journalId, outcomeId, students, opts = {}) {
    // opts: { output: 'studentOutcomeResults' | 'existingGradesMap', ovNum }
    try {
      const detailedOutcome = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${outcomeId}`)
      if (!detailedOutcome.outcomeStudents) return opts.output === 'studentOutcomeResults' ? {} : {}
      if (opts.output === 'studentOutcomeResults') {
        // Map to { [journalStudentId]: [ { grade } ] }
        const result = {}
        detailedOutcome.outcomeStudents.forEach(outcomeStudent => {
          const matchingStudent = students.find(s => {
            const studentId = s.student ? s.student.id : s.id
            return String(studentId) === String(outcomeStudent.studentId)
          })
          if (matchingStudent && outcomeStudent.grade) {
            const journalStudentId = matchingStudent.id
            result[journalStudentId] = [{ grade: outcomeStudent.grade }]
          }
        })
        return result
      } else if (opts.output === 'existingGradesMap' && opts.ovNum) {
        // Map to { `${studentId}|${ovNum}`: outcomeStudent }
        const result = {}
        detailedOutcome.outcomeStudents.forEach(outcomeStudent => {
          if (outcomeStudent.studentId && outcomeStudent.grade) {
            const key = `${outcomeStudent.studentId}|${opts.ovNum}`
            result[key] = outcomeStudent
          }
        })
        return result
      }
      return {}
    } catch (err) {
      // Logging is handled by caller
      return opts.output === 'studentOutcomeResults' ? {} : {}
    }
  }
  static OA_BTN_STYLE = {
    margin: '16px 0px',
    padding: '8px 16px',
    background: 'rgb(21, 101, 192)',
    color: 'rgb(255, 255, 255)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    zIndex: 1000,
    display: 'block',
    width: 'auto',
    maxWidth: '100%'
  }

  mapGradeToSchema(grade) {
    let code = null,
      nameEt = '',
      nameEn = '',
      value = ''
    if (['1', '2', '3', '4', '5'].includes(grade)) {
      code = `KUTSEHINDAMINE_${grade}`
      value = grade
      const gradeNames = {
        5: { nameEt: 'Väga hea', nameEn: 'Very good' },
        4: { nameEt: 'Hea', nameEn: 'Good' },
        3: { nameEt: 'Rahuldav', nameEn: 'Satisfactory' },
        2: { nameEt: 'Puudulik', nameEn: 'Insufficient' },
        1: { nameEt: 'Nõrk', nameEn: 'Weak' }
      }
      nameEt = gradeNames[grade]?.nameEt || ''
      nameEn = gradeNames[grade]?.nameEn || ''
    } else if (grade === 'MA') {
      code = 'KUTSEHINDAMINE_MA'
      value = 'MA'
      nameEt = 'Mitte arvestatud'
      nameEn = 'Fail'
    } else if (grade === 'A') {
      code = 'KUTSEHINDAMINE_A'
      value = 'A'
      nameEt = 'Arvestatud'
      nameEn = 'Pass'
    } else {
      return null
    }
    return { code, value, nameEt, nameEn }
  }

  async syncOvGrades({ results, ovNumToOutcomeId, filteredOutput, container, statusDiv = null, button = null }) {
    // Prevent concurrent sync runs across different handlers/buttons
    if (this._oaSyncRunning) {
      Logger.debug('FinalGradesByOvFeature: Sync already in progress, skipping second invocation')
      return false
    }
    this._oaSyncRunning = true
    let allSuccess = true
    try {
      const journalId = this.extractJournalId()
      const estDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Tallinn' })
      const gradeDate = estDate + 'T00:00:00.000Z'
      for (const ovNum of results.allOvNums) {
        if (!ovNumToOutcomeId || !ovNumToOutcomeId[ovNum]) {
          Logger.error('FinalGradesByOvFeature: No outcomeId mapping for ÕV', { ovNum, ovNumToOutcomeId })
          if (container) {
            container.textContent = ''
            const errDiv = document.createElement('div')
            errDiv.style.cssText = 'margin:16px 0;color:#d32f2f;font-weight:bold;'
            errDiv.textContent = `Viga: ei leitud ÕV ${ovNum} outcomeId vastendust selles päevikus!`
            container.appendChild(errDiv)
          }
          allSuccess = false
          continue
        }
        const journalOutcomeId = ovNumToOutcomeId[ovNum]
        let latestOutcomeEntry = null
        try {
          latestOutcomeEntry = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${journalOutcomeId}`)
        } catch (err) {
          Logger.error('FinalGradesByOvFeature: Error fetching journalOutcome', { journalId, journalOutcomeId, err })
          if (container) {
            container.textContent = ''
            const errDiv = document.createElement('div')
            errDiv.style.cssText = 'margin:16px 0;color:#d32f2f;font-weight:bold;'
            errDiv.textContent = `Viga: ei saanud kätte ÕV ${ovNum} outcome andmeid!`
            container.appendChild(errDiv)
          }
          allSuccess = false
          continue
        }
        const freshGradesMap = {}
        if (latestOutcomeEntry && latestOutcomeEntry.outcomeStudents && Array.isArray(latestOutcomeEntry.outcomeStudents)) {
          latestOutcomeEntry.outcomeStudents.forEach(outcomeStudent => {
            if (outcomeStudent.studentId) {
              const key = `${outcomeStudent.studentId}|${ovNum}`
              freshGradesMap[key] = outcomeStudent
            }
          })
        }
        // Fetch statuses for students in filteredOutput so we can apply OPPURSTAATUS_A rule
        const uniqueStudentIds = Array.from(new Set((filteredOutput || []).map(r => Number(r.studentId)).filter(Boolean)))
        const studentStatusMap = {}
        await Promise.all(
          uniqueStudentIds.map(async sid => {
            try {
              const det = await this.api.tahvel.get(`/students/${sid}`)
              studentStatusMap[String(sid)] = det && det.status ? det.status : null
            } catch (e) {
              Logger.error('FinalGradesByOvFeature: Failed to fetch student details, defaulting to include', { studentId: sid, err: e })
              studentStatusMap[String(sid)] = null
            }
          })
        )
        const outcomeStudents = filteredOutput
          .map(r => {
            let grade = r.ovGrades[ovNum]
            if (!grade) return null
            if (/^\d+(?:\.\d+)?$/.test(grade)) {
              const rounded = Math.round(Number(grade))
              if (rounded >= 1 && rounded <= 5) grade = String(rounded)
            }
            const studentId = Number(r.studentId)
            // If student is on academic leave (OPPURSTAATUS_A) only allow adding ÕV if grade is not MA, 1 or 2
            const status = studentStatusMap[String(studentId)]
            const normalizedGrade = String(grade || '').toUpperCase()
            if (status === 'OPPURSTAATUS_A' && (normalizedGrade === 'MA' || normalizedGrade === '1' || normalizedGrade === '2')) {
              Logger.debug('FinalGradesByOvFeature: Skipping ÕV grade for OPPURSTAATUS_A student due to disallowed grade', {
                studentId,
                ovNum,
                grade: normalizedGrade
              })
              return null
            }
            const lookupKey = `${studentId}|${ovNum}`
            const mapped = this.mapGradeToSchema(grade)
            if (!mapped) return null
            const existing = freshGradesMap[lookupKey]
            // If an existing grade is present and it matches the mapped grade, skip to avoid a no-op update
            try {
              if (existing && existing.grade) {
                const existingCode = existing.grade.code || (existing.grade.value ? `KUTSEHINDAMINE_${String(existing.grade.value)}` : null)
                const existingValue = existing.grade.value != null ? String(existing.grade.value) : null
                if (existingCode === mapped.code || existingValue === String(mapped.value)) {
                  Logger.debug('FinalGradesByOvFeature: Skipping no-op ÕV update (existing equals calculated)', {
                    studentId,
                    ovNum,
                    existingCode,
                    mappedCode: mapped.code
                  })
                  return null
                }
              }
            } catch (e) {
              // ignore comparison errors and proceed to include the student
              Logger.debug('FinalGradesByOvFeature: Error comparing existing grade, will include update', e)
            }
            const gradeObj = {
              code: mapped.code,
              gradingSchemaRowId: null,
              value: mapped.value,
              value2: mapped.value,
              extraval1: null,
              extraval2: null,
              nameEt: mapped.nameEt,
              nameEn: mapped.nameEn,
              valid: true
            }
            if (existing) {
              return {
                version: existing.version,
                id: existing.id,
                studentId,
                canEdit: true,
                isCurriculumOutcome: true,
                grade: gradeObj,
                gradeDate,
                removeStudentHistory: true,
                addInfo: null,
                gradeInserted: existing.gradeInserted,
                gradeInsertedBy: existing.gradeInsertedBy,
                history: existing.history || []
              }
            } else {
              return {
                studentId,
                canEdit: true,
                isCurriculumOutcome: true,
                grade: gradeObj,
                gradeDate
              }
            }
          })
          .filter(Boolean)
        if (!outcomeStudents.length) continue
        const url = `/journals/${journalId}/journalOutcome/${journalOutcomeId}`
        const payload = { outcomeStudents }
        Logger.debug('✨ FinalGradesByOvFeature: Sending payload for ÕV', { ovNum, payload })
        try {
          await this.api.tahvel.post(url, payload)
          if (statusDiv) statusDiv.textContent += `ÕV ${ovNum}: OK. `
        } catch (err) {
          allSuccess = false
          if (statusDiv) statusDiv.textContent += `ÕV ${ovNum}: VIGA! `
        }
      }
      if (allSuccess) {
        // mark button as intentionally disabled after successful send
        if (button) {
          try {
            button._oaFinalGradesDisabled = true
            button.disabled = true
            button.style.opacity = '0.6'
            button.title = 'Hinded saadetud — enam pole midagi saata'
            try {
              const isL =
                button &&
                String(button.textContent || '')
                  .toLowerCase()
                  .includes('lõpptulemus')
              button.textContent = isL ? 'Lõpptulemused saadetud' : 'Õpiväljundite hinded saadetud'
            } catch (innerErr) {
              Logger.debug('FinalGradesByOvFeature: Ignored inner error', innerErr)
            }
          } catch (e) {
            Logger.debug('FinalGradesByOvFeature: Failed to update button state after sync', e)
          }
        }
        if (statusDiv && statusDiv.textContent === '') statusDiv.textContent = 'Kõik õpiväljundite hinded saadetud.'
      } else if (!allSuccess && statusDiv && statusDiv.textContent === '') {
        statusDiv.textContent = 'Ühtegi hinnet ei saadetud.'
      }
      return allSuccess
    } catch (err) {
      if (statusDiv) statusDiv.textContent = 'Viga saatmisel.'
      throw err
    } finally {
      try {
        this._oaSyncRunning = false
      } catch (e) {
        void e
      }
    }
  }
  constructor() {
    super('finalGradesByOv', () => true, null) // Activate on any page for testing
    // In-session manual grading-mode override, keyed by journalId. No persistence:
    // recorded grades in Tahvel are the cross-session memory. Survives re-renders so
    // the teacher's pick never snaps back. NOT cleared by onJournalDataChanged.
    this.gradingModeUserPickByJournal = {}
    Logger.debug('✨ FinalGradesByOvFeature: Constructor called - will activate on any page for testing')
  }

  shouldActivate(url) {
    // Activate on /journal/<id>/edit and also on /journal/<id> (non-edit view) for broader coverage
    const match = url.match(/\/journal\/(\d+)(?:\/edit)?/)
    const result = !!match && super.shouldActivate(url)
    Logger.debug('✨ FinalGradesByOvFeature: shouldActivate called', { url, result })
    if (!result && url.match(/\/journal\/(\d+)/)) {
      Logger.debug('[DEBUG] Not activating: journal page but not /edit subpage', { url })
    }
    return result
  }

  onJournalDataChanged(journalId) {
    const activeJournalId = this.extractJournalId()
    if (activeJournalId && Number(journalId) === Number(activeJournalId)) {
      this._lastEntries = null
      this._lastStudents = null
      this._lastJournalId = null
    }
  }

  async onActivate() {
    Logger.debug('✨ FinalGradesByOvFeature: onActivate called')
    Logger.debug('✨ FinalGradesByOvFeature: Current URL:', window.location.href)

    // Mutation observer to re-attach the real async handler if button is replaced
    const attachAsyncHandler = () => {
      const btn = document.querySelector('.oa-final-grades-btn')
      Logger.debug('[DEBUG] attachAsyncHandler called. Button found:', btn)
      if (!btn) return
      if (!btn._oaHandlerAttached) {
        Logger.debug('[DEBUG] Attaching direct click handler to button')
        btn.addEventListener('click', async() => {
          Logger.debug('✨ FinalGradesByOvFeature: Direct button click detected')
          // Prevent re-entrancy if a delegated handler or another click is already processing
          if (btn._oaRunning) {
            Logger.debug('✨ FinalGradesByOvFeature: Direct click ignored, operation already running')
            return
          }
          btn._oaRunning = true
          btn.disabled = true
          btn.textContent = 'Laen...'
          btn.style.background = '#ff9800'
          try {
            Logger.debug('✨ FinalGradesByOvFeature: Button click handler start (direct)')
            const journalId = this.extractJournalId()
            Logger.debug('[DEBUG] Direct click: journalId:', journalId)
            if (!journalId) {
              Logger.error('[DEBUG] Direct click: No journalId found!')
              btn.textContent = 'Viga!'
              btn.style.background = '#d32f2f'
              return
            }
            let entries, students
            if (this._lastJournalId && this._lastJournalId === journalId && this._lastEntries && this._lastStudents) {
              entries = this._lastEntries
              students = this._lastStudents
              Logger.debug('✨ FinalGradesByOvFeature: Reusing cached entries/students for journalId:', journalId)
            } else {
              [entries, students] = await Promise.all([
                this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
                this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
              ])
              Logger.debug('✨ FinalGradesByOvFeature: API entries fetched:', entries)
              Logger.debug('✨ FinalGradesByOvFeature: API students fetched:', students)
              this._lastEntries = entries
              this._lastStudents = students
              this._lastJournalId = journalId
            }
            const results = await this.calculateFinalGrades(entries, students)
            Logger.debug('✨ FinalGradesByOvFeature: Results calculated:', results)
            await this.showResults(results, btn)
            btn.textContent = 'Valmis!'
            btn.style.background = '#388e3c'
          } catch (e) {
            Logger.error('FinalGradesByOvFeature error', e && (e.stack || e.message || e))
            btn.textContent = 'Viga!'
            btn.style.background = '#d32f2f'
          } finally {
            // Clear running flag so future clicks can proceed (if not intentionally disabled)
            try {
              btn._oaRunning = false
            } catch (e) {
              void e
            }
            setTimeout(() => {
              try {
                if (!btn._oaFinalGradesDisabled) {
                  btn.disabled = false
                  btn.textContent = 'Lisa õpiväljundite hinded'
                  btn.style.background = 'rgb(21, 101, 192)'
                }
              } catch (e) {
                Logger.debug('FinalGradesByOvFeature: Error restoring button state', e)
              }
            }, 3000)
          }
        })
        btn._oaHandlerAttached = true
      }
    }

    // Observe changes to #studentTable so we re-attach handlers if the table/button is replaced
    const tableForObserver = document.querySelector('#studentTable')
    Logger.debug('[DEBUG] #studentTable found for observer:', tableForObserver)
    if (tableForObserver) {
      const observer = new MutationObserver(() => {
        Logger.debug('[DEBUG] MutationObserver triggered on #studentTable')
        attachAsyncHandler()
      })
      observer.observe(tableForObserver, { childList: true, subtree: true })
      // Initial attach
      Logger.debug('[DEBUG] Initial attachAsyncHandler call')
      attachAsyncHandler()
    } else {
      Logger.debug('#studentTable not found on page load')
    }

    Logger.debug('✨ FinalGradesByOvFeature: Test button logic start')

    try {
      // Only proceed if URL matches /journal/<id>/edit
      const url = window.location.href
      const match = url.match(/\/journal\/(\d+)\/edit/)
      if (!match) {
        Logger.debug('[DEBUG] Not on /journal/<id>/edit, skipping button logic', { url })
        return
      }
      const journalId = match[1]
      Logger.debug('[DEBUG] Journal ID extracted:', journalId)
      if (!journalId) {
        Logger.debug('✨ FinalGradesByOvFeature: No journal ID found, feature will not work')
        return
      }
      // Fetch entries and students to check for ÕV columns or SISSEKANNE_L
      Logger.debug('[DEBUG] Fetching entries and students for journalId:', journalId)
      let entries, students
      if (this._lastJournalId && this._lastJournalId === journalId && this._lastEntries && this._lastStudents) {
        entries = this._lastEntries
        students = this._lastStudents
        Logger.debug('[DEBUG] Reusing cached entries/students for journalId:', journalId)
      } else {
        [entries, students] = await Promise.all([
          this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
          this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
        ])
        Logger.debug('[DEBUG] Entries fetched:', entries)
        Logger.debug('[DEBUG] Students fetched:', students)
        this._lastEntries = entries
        this._lastStudents = students
        this._lastJournalId = journalId
      }
      const hasSissekanneL = this.detectLGrades(entries)
      Logger.debug('[DEBUG] hasSissekanneL:', hasSissekanneL)
      const results = hasSissekanneL ? this.extractFinalGrades(entries, students) : await this.calculateFinalGrades(entries, students)
      Logger.debug('[DEBUG] Results:', results)
      if (!hasSissekanneL && (!results.allOvNums || results.allOvNums.length === 0)) {
        Logger.debug('✨ FinalGradesByOvFeature: No ÕV columns or SISSEKANNE_L detected, feature will not activate')
        Logger.debug('[DEBUG] Not activating: hasSissekanneL:', hasSissekanneL, 'allOvNums:', results.allOvNums)
        return
      }
      // Wait for the student table element (#studentTable) - strict placement under the real table
      let tableContainer = null
      try {
        Logger.debug('[DEBUG] Waiting for #studentTable')
        tableContainer = await domService.waitForElement('#studentTable', 20000, 100)
        Logger.debug('✨ FinalGradesByOvFeature: #studentTable found', tableContainer)
      } catch (e) {
        Logger.error('FinalGradesByOvFeature: #studentTable not found, aborting feature initialization', e)
        return
      }
      // Use existing button if present, otherwise insert
      let button = document.querySelector('.oa-final-grades-btn')
      Logger.debug('[DEBUG] Existing button found:', button)
      const buttonText = hasSissekanneL ? 'Lisa lõpptulemuse hinded' : 'Lisa õpiväljundite hinded'
      if (!button) {
        Logger.debug('[DEBUG] No existing button, will insert new button under #studentTable')
        // Strictly insert right after the #studentTable element (no legacy fallbacks)
        button = domService.createAndInsertElement(
          'button',
          {
            type: 'button',
            class: 'oa-final-grades-btn',
            style: FinalGradesByOvFeature.OA_BTN_STYLE
          },
          buttonText,
          tableContainer,
          'afterend'
        )
        Logger.debug('✨ FinalGradesByOvFeature: Button inserted after #studentTable', button)
      } else {
        Logger.debug('✨ FinalGradesByOvFeature: Using existing button', button)
        Logger.debug('✨ FinalGradesByOvFeature: Button visibility:', {
          display: button.style.display,
          visibility: button.style.visibility,
          opacity: button.style.opacity,
          offsetWidth: button.offsetWidth,
          offsetHeight: button.offsetHeight,
          clientWidth: button.clientWidth,
          clientHeight: button.clientHeight
        })
      }
      // Store entries for later use (used by #showResults and delegated handler)
      this._lastEntries = entries

      // --- NEW: Calculate grades on page load (without auto-sync) ---
      try {
        Logger.debug('✨ FinalGradesByOvFeature: Calculating grades on page load')
        const hasSissekanneL = this.detectLGrades(entries)
        const resultsOnLoad = hasSissekanneL ? this.extractFinalGrades(entries, students) : await this.calculateFinalGrades(entries, students)
        // Call showResults with autoSync=false so we only compute filteredOutput and update button state/UI
        if (hasSissekanneL) {
          // Use the L feature's showResults which accepts autoSync flag
          await this.showLGradeResults(resultsOnLoad, button, entries, { autoSync: false })
          // Ensure L-grade dropdowns are available on initial load
          try {
            this.ensureLGradeDropdowns()
          } catch (e) {
            Logger.debug('FinalGradesByOvFeature: Failed to ensure L-grade dropdowns on load', e)
          }
          // Attach L-specific DOM observer so the L-button is kept up-to-date on meaningful DOM changes
          try {
            const lObserver = this.attachDomObserver(button, entries)
            // store observer so it can be disconnected later if needed
            this._lObserver = lObserver
          } catch (e) {
            Logger.debug('FinalGradesByOvFeature: Failed to attach L DOM observer', e)
          }
        } else {
          await this.showResults(resultsOnLoad, button, { autoSync: false })
        }
      } catch (err) {
        Logger.debug('FinalGradesByOvFeature: Failed to calculate grades on page load', err)
      }

      // Determine whether there are any grade changes to send and disable button if none
      try {
        const allOvNums = results.allOvNums || []
        const existingGradesMap = {}
        if (this._lastEntries) {
          for (const entry of this._lastEntries) {
            if (entry.entryType === 'SISSEKANNE_O') {
              const ovNum = extractOutcomeNumberFromOutcomeEntryName(entry.nameEt)
              if (ovNum) {
                const studentOutcomeResults = entry.studentOutcomeResults
                if (!studentOutcomeResults && entry.curriculumModuleOutcomes) {
                  // best-effort: try to fetch detailed outcome map synchronously-like (avoid awaiting here)
                } else if (studentOutcomeResults) {
                  Object.entries(studentOutcomeResults).forEach(([studentIdFromResults, res]) => {
                    const studentId = studentIdFromResults
                    if (studentId && res && res.grade) {
                      const key = `${studentId}|${ovNum}`
                      existingGradesMap[key] = res
                    }
                  })
                }
              }
            }
          }
        }
        const output = results.output || []
        const filteredOutput = output.filter(student => {
          if (allOvNums.length > 0) {
            return allOvNums.some(ovNum => {
              const calculatedGrade = student.ovGrades[ovNum]
              const existingGradeKey = `${student.studentId}|${ovNum}`
              const existingGradeEntry = existingGradesMap[existingGradeKey]
              let existingGrade = ''
              if (existingGradeEntry && existingGradeEntry.grade && existingGradeEntry.grade.code) {
                existingGrade = existingGradeEntry.grade.code.replace('KUTSEHINDAMINE_', '')
              }
              let normalizedCalculated = String(calculatedGrade || '').trim()
              const normalizedExisting = String(existingGrade || '').trim()
              if (/^\d+(?:\.\d+)?$/.test(normalizedCalculated) && /^\d+$/.test(normalizedExisting)) {
                normalizedCalculated = String(Math.round(Number(normalizedCalculated)))
              }
              return normalizedCalculated !== normalizedExisting
            })
          } else {
            return true
          }
        })
        if (allOvNums.length > 0 && filteredOutput.length === 0) {
          // No changes needed — disable button and indicate so with clearer text/title
          try {
            button.disabled = true
            button.style.opacity = '0.6'
            button.title = 'Kõik õpiväljundite hinded on juba olemas — pole vaja saata'
            try {
              const isL =
                button &&
                String(button.textContent || '')
                  .toLowerCase()
                  .includes('lõpptulemus')
              button.textContent = isL ? 'Kõik hinded on õiged' : 'Kõik hinded on õiged'
            } catch (innerErr) {
              Logger.debug('FinalGradesByOvFeature: Ignored inner error', innerErr)
            }
            // mark as intentionally disabled (no further re-enable)
            button._oaFinalGradesDisabled = true
            Logger.debug('✨ FinalGradesByOvFeature: No grade changes detected — disabled button')
          } catch (e) {
            Logger.debug('FinalGradesByOvFeature: Failed to disable button', e)
          }
        }
      } catch (e) {
        Logger.debug('FinalGradesByOvFeature: Error while checking for grade changes', e)
      }
      // Remove any old event delegation to avoid duplicates
      if (window._oaFinalGradesDelegation) {
        Logger.debug('[DEBUG] Removing old event delegation')
        document.removeEventListener('click', window._oaFinalGradesDelegation, true)
      }
      // Use event delegation for robustness
      const delegatedHandler = async e => {
        const btn = e.target.closest('.oa-final-grades-btn')
        if (!btn) return
        // Ignore if another handler is already processing this button
        if (btn._oaRunning) {
          Logger.debug('✨ FinalGradesByOvFeature: Delegated click ignored, operation already running')
          return
        }
        btn._oaRunning = true
        Logger.debug('✨ FinalGradesByOvFeature: Delegated button click detected')
        btn.disabled = true
        btn.textContent = 'Laen...'
        btn.style.background = '#ff9800'
        try {
          Logger.debug('✨ FinalGradesByOvFeature: Button click handler start (delegated)')
          const journalId = this.extractJournalId()
          Logger.debug('[DEBUG] Delegated click: journalId:', journalId)
          if (!journalId) {
            Logger.error('[DEBUG] Delegated click: No journalId found!')
            btn.textContent = 'Viga!'
            btn.style.background = '#d32f2f'
            return
          }
          let entries, students
          if (this._lastJournalId && this._lastJournalId === journalId && this._lastEntries && this._lastStudents) {
            entries = this._lastEntries
            students = this._lastStudents
            Logger.debug('✨ FinalGradesByOvFeature: Reusing cached entries/students for journalId:', journalId)
          } else {
            [entries, students] = await Promise.all([
              this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
              this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
            ])
            Logger.debug('✨ FinalGradesByOvFeature: API entries fetched:', entries)
            Logger.debug('✨ FinalGradesByOvFeature: API students fetched:', students)
            this._lastEntries = entries
            this._lastStudents = students
            this._lastJournalId = journalId
          }
          const hasSissekanneL = this.detectLGrades(entries)
          Logger.debug('[DEBUG] Delegated click: hasSissekanneL:', hasSissekanneL)
          const results = hasSissekanneL ? this.extractFinalGrades(entries, students) : await this.calculateFinalGrades(entries, students)
          Logger.debug('[DEBUG] Delegated click: results:', results)
          if (!hasSissekanneL && (!results.allOvNums || results.allOvNums.length === 0)) {
            Logger.debug('✨ FinalGradesByOvFeature: No ÕV columns or SISSEKANNE_L detected on button click, aborting')
            Logger.debug('[DEBUG] Delegated click: Not activating: hasSissekanneL:', hasSissekanneL, 'allOvNums:', results.allOvNums)
            btn.textContent = 'ÕV-sid või lõpptulemust ei leitud'
            btn.style.background = '#d32f2f'
            setTimeout(() => {
              btn.disabled = false
              btn.textContent = 'Lisa lõpptulemuse hinded'
              btn.style.background = 'rgb(21, 101, 192)'
            }, 3000)
            return
          }
          Logger.debug('✨ FinalGradesByOvFeature: Results calculated:', results)
          if (hasSissekanneL) {
            await this.showLGradeResults(results, btn, entries)
          } else {
            await this.showResults(results, btn)
          }
          btn.textContent = 'Valmis!'
          btn.style.background = '#388e3c'
        } catch (e) {
          Logger.error('FinalGradesByOvFeature error', e)
          btn.textContent = 'Viga!'
          btn.style.background = '#d32f2f'
        } finally {
          // Clear running flag so future clicks can proceed (if not intentionally disabled)
          try {
            btn._oaRunning = false
          } catch (e) {
            void e
          }
          setTimeout(() => {
            try {
              if (!btn._oaFinalGradesDisabled) {
                btn.disabled = false
                // Set button text based on latest SISSEKANNE_L detection and whether any ÕV grades already exist
                const hasL = this.detectLGrades(this._lastEntries || [])
                if (hasL) {
                  btn.textContent = 'Lisa lõpptulemuse hinded'
                } else {
                  const hasExistingOv = this.hasAnyOvGrades(this._lastEntries || [])
                  btn.textContent = hasExistingOv ? 'Uuenda õpiväljundite hinded' : 'Lisa õpiväljundite hinded'
                }
                btn.style.background = 'rgb(21, 101, 192)'
              }
            } catch (e) {
              Logger.debug('FinalGradesByOvFeature: Error restoring button state (delegated)', e)
            }
          }, 3000)
        }
      }
      window._oaFinalGradesDelegation = delegatedHandler
      Logger.debug('[DEBUG] Adding event delegation for .oa-final-grades-btn')
      document.addEventListener('click', delegatedHandler, true)
      // No need to add a direct event listener here; handled by mutation observer logic above
      // --- NEW: Observe journal table for changes and re-evaluate button state ---
      try {
        const tableEl = document.querySelector('#studentTable')
        if (tableEl) {
          let debounceTimer = null
          let lastSnapshot = null
          const getSnapshot = () => {
            try {
              // Lightweight visible text snapshot — trim to avoid huge strings
              const txt = tableEl && tableEl.innerText ? tableEl.innerText.trim() : ''
              return txt ? txt.slice(0, 20000) : ''
            } catch (e) {
              return ''
            }
          }
          const onTableChange = _records => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(async() => {
              try {
                // Compute snapshot and bail out quickly if nothing meaningful changed
                const snapshot = getSnapshot()
                if (snapshot === lastSnapshot) {
                  Logger.debug('✨ FinalGradesByOvFeature: DOM changed but table snapshot unchanged — skipping API')
                  return
                }
                lastSnapshot = snapshot
                Logger.debug('✨ FinalGradesByOvFeature: Detected meaningful DOM change — re-evaluating grade diffs')
                const journalId = this.extractJournalId()
                if (!journalId) return
                let newEntries, newStudents
                if (this._lastJournalId && this._lastJournalId === journalId && this._lastEntries && this._lastStudents) {
                  newEntries = this._lastEntries
                  newStudents = this._lastStudents
                  Logger.debug('✨ FinalGradesByOvFeature: Reusing cached entries/students for journalId (DOM change):', journalId)
                } else {
                  [newEntries, newStudents] = await Promise.all([
                    this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
                    this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
                  ])
                  this._lastEntries = newEntries
                  this._lastStudents = newStudents
                  this._lastJournalId = journalId
                }
                const hasLLocal = this.detectLGrades(newEntries)
                let newResults
                if (hasLLocal) {
                  newResults = this.extractFinalGrades(newEntries, newStudents)
                } else {
                  newResults = await this.calculateFinalGrades(newEntries, newStudents)
                }
                // Call showResults with autoSync=false to compute filteredOutput and update button state
                const filtered = await this.showResults(newResults, button, { autoSync: false })
                // If filtered is an array and has items -> enable button, otherwise disable and set global marker
                try {
                  if (Array.isArray(filtered) && filtered.length > 0) {
                    // enable
                    window._oaFinalGradesDisabled = false
                    if (button) {
                      button._oaFinalGradesDisabled = false
                      button.disabled = false
                      button.style.opacity = ''
                      button.title = ''
                      try {
                        // Decide proper label based on whether L-flow is present
                        const hasLNow = this.detectLGrades(this._lastEntries || [])
                        if (hasLNow) {
                          button.textContent = 'Lisa lõpptulemuse hinded'
                        } else {
                          const hasExistingOvNow = this.hasAnyOvGrades(this._lastEntries || [])
                          button.textContent = hasExistingOvNow ? 'Uuenda õpiväljundite hinded' : 'Lisa õpiväljundite hinded'
                        }
                        button.style.background = 'rgb(21, 101, 192)'
                      } catch (innerErr) {
                        // ignore and leave title/style as-is
                      }
                    }
                    Logger.debug('✨ FinalGradesByOvFeature: Button enabled after DOM change — changes detected')
                  } else {
                    // disable globally
                    window._oaFinalGradesDisabled = true
                    if (button) {
                      button._oaFinalGradesDisabled = true
                      button.disabled = true
                      button.style.opacity = '0.6'
                      button.title = 'Kõik õpiväljundite hinded on juba olemas — pole vaja saata'
                      try {
                        const isL =
                          typeof buttonText !== 'undefined' && buttonText
                            ? buttonText.toLowerCase().includes('lõpptulemus')
                            : button &&
                              String(button.textContent || '')
                                .toLowerCase()
                                .includes('lõpptulemus')
                        button.textContent = isL ? 'Kõik hinded on õiged' : 'Kõik hinded on õiged'
                      } catch (innerErr) {
                        Logger.debug('FinalGradesByOvFeature: Ignored inner error', innerErr)
                      }
                    }
                    Logger.debug('✨ FinalGradesByOvFeature: Button disabled after DOM change — no changes detected')
                  }
                } catch (e) {
                  Logger.debug('FinalGradesByOvFeature: Failed to update button state after DOM change', e)
                }
              } catch (err) {
                Logger.debug('FinalGradesByOvFeature: Error while re-evaluating after DOM change', err)
              }
            }, 250)
          }
          const mo = new MutationObserver(onTableChange)
          mo.observe(tableEl, { childList: true, subtree: true, attributes: true })
        }
      } catch (e) {
        Logger.debug('FinalGradesByOvFeature: Failed to attach DOM observer for table changes', e)
      }
    } catch (e) {
      Logger.error('FinalGradesByOvFeature init error', e)
      Logger.debug('[DEBUG] Exception in onActivate:', e)
    }
  }

  extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? match[1] : null
  }

  async calculateFinalGrades(entries, students) {
    Logger.debug('✨ FinalGradesByOvFeature: DEBUG students structure:', students)
    const studentMap = {}
    const journalStudentIdToStudentId = {}
    let hasOvTaggedEntries = false
    students.forEach(s => {
      Logger.debug('✨ FinalGradesByOvFeature: DEBUG processing student:', s)
      // Check if student data is nested under .student or directly on the object
      let name, idcode, studentId, journalStudentId
      if (s.student && s.student.idcode) {
        name = s.student.fullname || `${s.student.firstname} ${s.student.lastname}`
        idcode = s.student.idcode
        studentId = s.student.id
        journalStudentId = s.id
      } else {
        name = s.fullname || `${s.firstname} ${s.lastname}`
        idcode = s.idcode || 'N/A'
        studentId = s.studentId || s.id
        journalStudentId = s.id
      }
      studentMap[journalStudentId] = { name, idcode, studentId }
      journalStudentIdToStudentId[journalStudentId] = studentId
    })
    Logger.debug('✨ FinalGradesByOvFeature: DEBUG studentMap after processing:', studentMap)

    // Map ÕV number using outcomeOrderNr+1 for SISSEKANNE_O (robust to all nameEt formats)
    // This ensures correct mapping regardless of how ÕV is tagged in nameEt
    const ovNumToOutcomeId = {} // Map ÕV number (as string) to curriculumModuleOutcomes from SISSEKANNE_O
    // Track how many tagged grade entries reference each ÕV — used to count expected assignments
    const ovExpectedAssignmentCount = {}
    entries.forEach(entry => {
      const ovNums = extractOutcomeNumbersFromEntryName(entry.nameEt)
      const hasGradeData = !!(entry.journalStudentResults || entry.journalEntryStudents)

      if (entry.entryType === 'SISSEKANNE_O' && typeof entry.outcomeOrderNr === 'number') {
        const ovNum = String(entry.outcomeOrderNr + 1)
        if (entry.curriculumModuleOutcomes) {
          ovNumToOutcomeId[ovNum] = entry.curriculumModuleOutcomes
        }
      }

      if (ovNums.length > 0 && hasGradeData) {
        hasOvTaggedEntries = true
        ovNums.forEach(ovNum => {
          ovExpectedAssignmentCount[ovNum] = (ovExpectedAssignmentCount[ovNum] || 0) + 1
        })
      }
    })
    Logger.debug('✨ FinalGradesByOvFeature: ovNumToOutcomeId mapping for this journal', ovNumToOutcomeId)

    // Collect grades for each student
    const gradesByStudent = {}
    // Collect outcome grades for each student and outcome number
    const outcomeGradesByStudent = {}
    // Collect final grades from SISSEKANNE_L entries
    const finalGradesByStudent = {}

    for (const entry of entries) {
      // SISSEKANNE_L: final grades (lõpptulemus)
      if (entry.entryType === 'SISSEKANNE_L' && entry.journalEntryStudents) {
        entry.journalEntryStudents.forEach(entryStudent => {
          if (entryStudent.grade && entryStudent.grade.code && entryStudent.journalStudent) {
            const grade = entryStudent.grade.code.replace('KUTSEHINDAMINE_', '')
            finalGradesByStudent[entryStudent.journalStudent] = grade
            Logger.debug('✨ FinalGradesByOvFeature: Found SISSEKANNE_L grade', {
              journalStudent: entryStudent.journalStudent,
              grade
            })
          }
        })
      }
      // SISSEKANNE_O: outcomes (for display, not for calculation)
      else if (entry.entryType === 'SISSEKANNE_O') {
        let studentOutcomeResults = entry.studentOutcomeResults

        // If studentOutcomeResults is missing, fetch detailed outcome data
        if (!studentOutcomeResults && entry.curriculumModuleOutcomes) {
          const journalId = this.extractJournalId()
          studentOutcomeResults = await this.fetchDetailedOutcomeStudents(journalId, entry.curriculumModuleOutcomes, students, {
            output: 'studentOutcomeResults'
          })
        }

        if (studentOutcomeResults) {
          Object.entries(studentOutcomeResults).forEach(([journalStudentId, results]) => {
            if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
            if (Array.isArray(results)) {
              results.forEach(r => {
                if (r.grade && r.grade.code) gradesByStudent[journalStudentId].push(r.grade.code.replace('KUTSEHINDAMINE_', ''))
              })
            } else {
              Logger.debug('✨ FinalGradesByOvFeature: SISSEKANNE_O results is not array', { journalStudentId, results })
            }
          })
        }
      }
      else {
        const ovNums = extractOutcomeNumbersFromEntryName(entry.nameEt)
        const shouldCollectGrades = entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_I' || ovNums.length > 0

        if (!shouldCollectGrades || !(entry.journalStudentResults || entry.journalEntryStudents)) continue

        const collectEntryGrade = (journalStudentId, grade) => {
          if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
          gradesByStudent[journalStudentId].push(grade)

          if (ovNums.length > 0) {
            ovNums.forEach(ovNum => {
              if (!outcomeGradesByStudent[journalStudentId]) outcomeGradesByStudent[journalStudentId] = {}
              if (!outcomeGradesByStudent[journalStudentId][ovNum]) outcomeGradesByStudent[journalStudentId][ovNum] = []
              outcomeGradesByStudent[journalStudentId][ovNum].push(grade)
            })
          }

          if (Logger.isDebugMode()) {
            Logger.debug('FinalGradesByOvFeature: Mapped entry grade to ÕV columns', {
              journalStudentId,
              grade,
              ovNums,
              entryName: entry.nameEt,
              entryType: entry.entryType
            })
          }
        }

        if (entry.journalStudentResults) {
          Object.entries(entry.journalStudentResults).forEach(([journalStudentId, results]) => {
            if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
            if (Array.isArray(results)) {
              results.forEach(r => {
                if (r.grade && r.grade.code) collectEntryGrade(journalStudentId, r.grade.code.replace('KUTSEHINDAMINE_', ''))
              })
            } else {
              Logger.debug('✨ FinalGradesByOvFeature: Entry results is not array', {
                journalStudentId,
                results,
                entryType: entry.entryType,
                entryName: entry.nameEt
              })
            }
          })
        } else if (Array.isArray(entry.journalEntryStudents)) {
          entry.journalEntryStudents.forEach(entryStudent => {
            if (entryStudent.grade && entryStudent.grade.code && entryStudent.journalStudent != null) {
              collectEntryGrade(String(entryStudent.journalStudent), entryStudent.grade.code.replace('KUTSEHINDAMINE_', ''))
            }
          })
        }
      }
    }

    // Calculate per-ÕV grades for each student
    // Use ovNumToOutcomeId keys for allOvNums
    const allOvNums = Object.keys(ovNumToOutcomeId).sort((a, b) => Number(a) - Number(b))
    Logger.debug('✨ FinalGradesByOvFeature: All ÕV numbers:', allOvNums)

    const output = []
    const summary = []
    Object.entries(studentMap).forEach(([journalStudentId, student]) => {
      // Final grade: prioritize SISSEKANNE_L, otherwise let grading mode logic handle it
      let finalGrade = ''
      if (finalGradesByStudent[journalStudentId]) {
        finalGrade = finalGradesByStudent[journalStudentId]
        Logger.debug('✨ FinalGradesByOvFeature: Using SISSEKANNE_L grade', { student: student.name, finalGrade })
      } else {
        // Placeholder - grading mode logic will calculate the actual final grade
        const grades = gradesByStudent[journalStudentId] || []
        const numeric = grades.filter(g => ['1', '2', '3', '4', '5'].includes(g)).map(Number)
        if (numeric.length) {
          finalGrade = (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2)
        } else {
          finalGrade = ''
        }
        Logger.debug('✨ FinalGradesByOvFeature: Initial placeholder grade (will be overridden by grading mode)', {
          student: student.name,
          finalGrade,
          grades
        })
      }

      // Per-ÕV grades
      const ovGrades = {}
      allOvNums.forEach(ovNum => {
        const gradesArr = (outcomeGradesByStudent[journalStudentId] && outcomeGradesByStudent[journalStudentId][ovNum]) || []
        let ovGrade = ''

        // Convert all grades to numeric for calculation, including MA→2
        // Convert all grades to numeric for calculation, including MA→2.
        // Treat missing/ungraded/unknown tokens as numeric 2 per requirement.
        const allGradesAsNumeric = gradesArr
          .map(g => {
            // Normalize
            if (g === null || g === undefined || String(g).trim() === '') {
              // Missing/ungraded -> treat as 2
              return 2
            }
            if (g === 'MA') {
              return 2
            }
            if (g === 'A') {
              return 5
            }
            const s = String(g).trim()
            if (/^\d+(?:\.\d+)?$/.test(s)) {
              const n = Number(s)
              if (n >= 1 && n <= 5) return n
            }
            // Unknown token -> treat as 2
            return 2
          })
          .filter(g => g !== null)

        // If there are expected assignments for this ÕV, ensure student has submitted all of them.
        // If not all assignments are present, force the ÕV grade to 2 (low) instead of averaging partial data.
        const expectedCount = ovExpectedAssignmentCount[ovNum] || 0
        const presentCount = gradesArr.filter(g => !(g === null || g === undefined || String(g).trim() === '')).length
        if (expectedCount > 0 && presentCount < expectedCount) {
          // Mark as low and fixed value 2.00 to reflect incomplete grading
          ovGrade = '2.00_hasLow'
        } else {
          // If all expected assignments are present (or we don't know expected count), pad missing as 2 and average
          if (expectedCount > allGradesAsNumeric.length) {
            const missing = expectedCount - allGradesAsNumeric.length
            for (let i = 0; i < missing; i++) allGradesAsNumeric.push(2)
          }

          if (allGradesAsNumeric.length > 0) {
            const average = (allGradesAsNumeric.reduce((a, b) => a + b, 0) / allGradesAsNumeric.length).toFixed(2)
            // Check if any individual grade is ≤ 2 (important for mitte mode)
            const hasLowGrade = allGradesAsNumeric.some(grade => grade <= 2)
            // Store both average and low-grade flag for later processing
            ovGrade = hasLowGrade ? `${average}_hasLow` : average
          } else if (gradesArr.includes('A')) {
            ovGrade = 'A'
          } else if (gradesArr.includes('MA')) {
            ovGrade = 'MA'
          }
        }

        ovGrades[ovNum] = ovGrade
        Logger.debug('✨ FinalGradesByOvFeature: Per-ÕV grade calculated', { student: student.name, ovNum, ovGrade, gradesArr, allGradesAsNumeric })
      })

      output.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        ovGrades,
        journalStudentId, // for reference
        studentId: student.studentId // <-- add correct studentId for payload
      })
      summary.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        ovGrades,
        journalStudentId,
        studentId: student.studentId
      })
    })
    Logger.debug('✨ FinalGradesByOvFeature: SUMMARY', summary)
    return { output, allOvNums, ovNumToOutcomeId, journalStudentIdToStudentId, hasOvTaggedEntries }
  }

  // Apply grading-mode rules to a previously calculated `results` object in-place.
  // modes:
  // - 'mitte' (Mitteeristav hindamine): numeric 3-5 -> A, 2 (and 1) -> MA; final = A if all OV grades are A and none ungraded, otherwise MA
  // - 'eristav' (Eristav hindamine): A -> 5, MA or ungraded -> 2, final = rounded average of all grades
  // Assumptions: grade '1' is treated as worst-case and maps to MA under 'mitte'; unknown tokens treated as ungraded or MA when sensible.
  // Take a one-time pristine snapshot of the computed output so grading-mode
  // conversion always derives from the original tokens. This makes mode switching
  // non-lossy and idempotent (A/MA and `_hasLow` survive a mitte<->eristav toggle).
  ensureRawOutputSnapshot(results) {
    if (results && Array.isArray(results.output) && !results.rawOutput) {
      results.rawOutput = structuredClone(results.output)
    }
  }

  // Apply a grading mode to results.output by converting from the pristine snapshot.
  // Mutates results.output in place so existing references (e.g. the destructured
  // `output` in showResults) stay valid. See gradingMode.js for the conversion rules.
  applyGradingModeToResults(results, mode) {
    try {
      if (!results || !Array.isArray(results.output)) return
      this.ensureRawOutputSnapshot(results)
      const converted = applyGradingMode(results.rawOutput, mode)
      results.output.length = 0
      results.output.push(...converted)
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error applying grading mode to results', e)
    }
  }

  // Fetch the journal's declared assessment type ('KUTSEHINDAMISVIIS_M'/'_E' or '').
  // Used only as the fallback when no grades are recorded yet. Response is cached by ApiService.
  async getJournalAssessment() {
    try {
      const journalId = this.extractJournalId()
      if (!journalId) return ''
      const journal = await this.api.tahvel.get(`/journals/${journalId}`)
      return journal?.assessment ? String(journal.assessment) : ''
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Could not fetch journal assessment', e)
      return ''
    }
  }

  // Create (or move) the single grading-mode dropdown next to `button`, reflect the
  // resolved mode, and wire exactly one change handler. Programmatic `.value =` does
  // not fire 'change', so reflecting the resolved mode never triggers a re-sync loop.
  ensureGradingModeSelect(button, resolvedMode) {
    let select = document.getElementById('oa-grading-mode-select')
    if (!select) {
      select = document.createElement('select')
      select.id = 'oa-grading-mode-select'
      select.setAttribute('aria-label', 'Hindamissüsteem')
      select.title = 'Vali hindamissüsteem: Mitteeristav või Eristav (mõjutab, kuidas ÕV ja lõpptulemused teisendatakse)'
      select.style.cssText = 'margin-left:8px;padding:6px 8px;font-size:14px;font-weight:bold;display:inline-block;vertical-align:middle;'
      const mitteOption = document.createElement('option')
      mitteOption.value = 'mitte'
      mitteOption.textContent = 'Mitteeristav hindamine'
      mitteOption.title = 'Mitteeristav: 3–5 → A; 1–2 või MA → MA; lõpptulemus: A ainult kui kõik ÕV on A, muidu MA'
      const eristavOption = document.createElement('option')
      eristavOption.value = 'eristav'
      eristavOption.textContent = 'Eristav hindamine'
      eristavOption.title = 'Eristav: A → 5; MA või hindamata → 2; lõpptulemus = hinnete ümardatud keskmine'
      select.appendChild(mitteOption)
      select.appendChild(eristavOption)
      select.addEventListener('change', () => this.handleGradingModeChange())
    }
    try {
      if (button && button.parentNode) {
        if (button.nextSibling !== select) button.parentNode.insertBefore(select, button.nextSibling)
        if (button.style) {
          button.style.display = 'inline-block'
          button.style.verticalAlign = 'middle'
          button.style.marginRight = '8px'
        }
      } else if (!select.parentNode) {
        document.body.appendChild(select)
      }
    } catch (e) {
      if (!select.parentNode) {
        try {
          document.body.appendChild(select)
        } catch (appendError) {
          void appendError
        }
      }
    }
    if (resolvedMode) select.value = resolvedMode
    return select
  }

  // One change handler shared by both flows: record the teacher's in-session pick
  // for this journal, then re-render the active flow (without auto-syncing).
  handleGradingModeChange() {
    try {
      const select = document.getElementById('oa-grading-mode-select')
      if (!select) return
      const journalId = this.extractJournalId()
      if (journalId != null) this.gradingModeUserPickByJournal[String(journalId)] = select.value
      const ctx = this.gradingModeChangeContext
      if (!ctx) return
      if (ctx.flow === 'l') {
        this.showLGradeResults(ctx.results, ctx.button, ctx.lastEntries, { autoSync: false })
      } else {
        this.showResults(ctx.results, ctx.button, { autoSync: false })
      }
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error handling grading-mode change', e)
    }
  }

  async showResults(results, button, opts = { autoSync: true }) {
    Logger.debug('✨ FinalGradesByOvFeature: #showResults called', { results, button, opts })
    // Only perform sync logic, do not render a table

    const { allOvNums, ovNumToOutcomeId, hasOvTaggedEntries, output } = results
    // Snapshot pristine computed grades once so mode conversion stays non-lossy/idempotent.
    this.ensureRawOutputSnapshot(results)
    const journalId = this.extractJournalId()
    // Build a map of (studentId|ovNum) => existing grade object for updating
    const existingGradesMap = {}
    if (this._lastEntries) {
      for (const entry of this._lastEntries) {
        if (entry.entryType === 'SISSEKANNE_O') {
          const ovNum = extractOutcomeNumberFromOutcomeEntryName(entry.nameEt)
          if (ovNum) {
            const studentOutcomeResults = entry.studentOutcomeResults
            if (!studentOutcomeResults && entry.curriculumModuleOutcomes) {
              const map = await this.fetchDetailedOutcomeStudents(journalId, entry.curriculumModuleOutcomes, [], { output: 'existingGradesMap', ovNum })
              Object.assign(existingGradesMap, map)
            } else if (studentOutcomeResults) {
              Object.entries(studentOutcomeResults).forEach(([studentIdFromResults, results]) => {
                const studentId = studentIdFromResults
                if (studentId && results && results.grade) {
                  const key = `${studentId}|${ovNum}`
                  existingGradesMap[key] = results
                }
              })
            }
          }
        }
      }
    }
    // Resolve the grading scale: recorded ÕV-outcome grades are the cross-session
    // memory; an in-session pick overrides; the journal's declared type is the
    // fallback when nothing is recorded yet. Then convert grades to that scale
    // before computing diffs/sync, so A/MA vs 1-5 is consistent end-to-end.
    const recordedTokens = getRecordedOutcomeGradeTokens(existingGradesMap)
    const journalAssessment = await this.getJournalAssessment()
    const userPick = journalId != null ? this.gradingModeUserPickByJournal[String(journalId)] : undefined
    const gradingMode = resolveGradingMode({ recordedTokens, journalAssessment, userPick })
    this.applyGradingModeToResults(results, gradingMode)
    const filteredOutput = output.filter(student => {
      if (allOvNums.length > 0) {
        return allOvNums.some(ovNum => {
          const calculatedGrade = student.ovGrades[ovNum]
          const existingGradeKey = `${student.studentId}|${ovNum}`
          const existingGradeEntry = existingGradesMap[existingGradeKey]
          let existingGrade = ''
          if (existingGradeEntry && existingGradeEntry.grade && existingGradeEntry.grade.code) {
            existingGrade = existingGradeEntry.grade.code.replace('KUTSEHINDAMINE_', '')
          }
          let normalizedCalculated = String(calculatedGrade || '').trim()
          const normalizedExisting = String(existingGrade || '').trim()
          if (/^\d+(?:\.\d+)?$/.test(normalizedCalculated) && /^\d+$/.test(normalizedExisting)) {
            normalizedCalculated = String(Math.round(Number(normalizedCalculated)))
          }
          return normalizedCalculated !== normalizedExisting
        })
      } else {
        return true
      }
    })
    // If ÕV columns exist but there are no tagged entries, show message
    let container = document.getElementById('oa-final-grades-results')
    if (!container) {
      container = domService.createAndInsertElement('div', { id: 'oa-final-grades-results' }, '', button, 'afterend')
    }
    if (allOvNums.length > 0 && !hasOvTaggedEntries) {
      container.textContent = ''
      const noOvDiv = document.createElement('div')
      noOvDiv.style.cssText = 'margin:16px 0;color:#d32f2f;font-weight:bold;'
      noOvDiv.textContent = 'Ühtegi õpiväljundit pole märgitud sissekannete nimetustesse!'
      container.appendChild(noOvDiv)
      return
    }
    // If ÕV columns exist, automatically sync grades silently (no status message unless error)
    if (allOvNums.length > 0) {
      container.textContent = ''
      // Single consolidated grading-mode dropdown next to the button.
      this.gradingModeChangeContext = { flow: 'ov', results, button }
      this.ensureGradingModeSelect(button, gradingMode)
      // --- Highlight mismatched cells in the journal table ---
      try {
        // Locate the journal table
        const table = this.findJournalTable()
        if (table) {
          // Ensure OA local CSS is available and detect column indices using local helper
          // (avoid depending on HighlightFinalGradesFeature which isn't imported here)
          injectFinalGradeCSS()
          const outcomeEntryNames = (this._lastEntries || [])
            .filter(e => e.entryType === 'SISSEKANNE_O' && e.nameEt)
            .map(e => e.nameEt.replace(/\s+/g, ' ').trim().toLowerCase())
            .filter(name => name.length > 0)
          const { finalGradeCols, ovCols } = this.findColumnIndices(table, outcomeEntryNames)
          // Map ovCols -> ovNum using results.allOvNums; fall back to sequence if lengths mismatch
          const sortedOvCols = (ovCols || []).slice().sort((a, b) => a - b)
          const ovColToNum = {}
          if (sortedOvCols.length === (allOvNums || []).length) {
            sortedOvCols.forEach((colIdx, i) => {
              ovColToNum[colIdx] = String(allOvNums[i])
            })
          } else {
            // Best-effort: try to parse numbers from header cells
            const headerCols = []
            const headerRows = Array.from(table.querySelectorAll('thead tr'))
            headerRows.forEach(row => {
              let colIdx = 0
              Array.from(row.children).forEach(th => {
                const colspan = parseInt(th.getAttribute('colspan') || '1', 10)
                const rawText = th.innerText || th.textContent || ''
                for (let i = 0; i < colspan; i++) {
                  headerCols[colIdx + i] = rawText
                }
                colIdx += colspan
              })
            })
            sortedOvCols.forEach(colIdx => {
              const txt = headerCols[colIdx] || ''
              const m = txt.match(/õv\s*[_\-\s]?(\d+)/i) || txt.match(/õv(\d+)/i)
              if (m && m[1]) ovColToNum[colIdx] = String(m[1])
            })
            // If still empty, map in order to available ovNums
            const unmappedCols = sortedOvCols.filter(c => !ovColToNum[c])
            let next = 0
            for (const c of unmappedCols) {
              if (allOvNums[next]) ovColToNum[c] = String(allOvNums[next])
              next++
            }
          }

          const rows = Array.from(table.querySelectorAll('tbody tr'))

          // Helper to detect AP rows (academic leave)
          const rowHasAcademicLeave = r => {
            try {
              return Array.from(r.querySelectorAll('span')).some(s => (s.textContent || '').trim() === 'AP')
            } catch (e) {
              return false
            }
          }

          // Helper: extract canonical grade token from text: 'MA', 'A', or numeric (supports comma decimal)
          const extractGradeToken = input => {
            if (!input) return ''
            let s = ''
            try {
              if (typeof input === 'object' && input !== null && input.innerText != null) {
                s = String(input.innerText || '')
              } else {
                s = String(input || '')
              }
            } catch (e) {
              s = String(input || '')
            }
            s = s
              .replace(/\u00A0/g, ' ') // NBSP
              .replace(/[,\s]+(?=\d{1,2}$)/, '.') // convert comma decimals like '4,0' to '4.0' conservatively
              .trim()
            // Find all tokens (MA, A, or numeric) and prefer the last occurring token in the cell
            const tokens = []
            // push MA/A tokens with an explicit marker
            Array.from(s.matchAll(/\bMA\b/gi)).forEach(m => tokens.push({ type: 'MA', value: 'MA', index: m.index }))
            Array.from(s.matchAll(/\bA\b/gi)).forEach(m => tokens.push({ type: 'A', value: 'A', index: m.index }))
            // numeric tokens
            Array.from(s.matchAll(/\b([1-5](?:[.,]\d+)?)\b/g)).forEach(m => tokens.push({ type: 'NUM', value: m[1].replace(',', '.'), index: m.index }))
            if (tokens.length) {
              // sort by occurrence index and pick last
              tokens.sort((a, b) => (a.index || 0) - (b.index || 0))
              const lastTok = tokens[tokens.length - 1]
              if (lastTok.type === 'MA') return 'MA'
              if (lastTok.type === 'A') return 'A'
              if (lastTok.type === 'NUM') return lastTok.value
            }
            return ''
          }

          // Iterate over results and try to find matching row for each student
          for (const student of output) {
            let row = null
            // Prefer matching by name or idcode within row text to avoid index-order mismatches
            const needleName = (student.name || '').trim()
            const needleIdcode = (student.idcode || '').trim()
            if (needleName) {
              row = rows.find(r => (r.textContent || '').includes(needleName)) || null
            }
            if (!row && needleIdcode) {
              row = rows.find(r => (r.textContent || '').includes(needleIdcode)) || null
            }
            if (!row) continue
            const isAP = rowHasAcademicLeave(row)
            if (isAP) continue
            const cells = Array.from(row.children).filter(n => n.nodeType === 1)

            // Check final grade columns
            finalGradeCols.forEach(colIdx => {
              const cell = cells[colIdx]
              if (!cell) return
              const cellToken = extractGradeToken(cell)
              const calcToken = extractGradeToken(String(student.finalGrade || ''))
              const setTooltip = (current, calculated) => {
                try {
                  cell.title = `Praegune hinne erineb arvutatud hindest\nPraegune: ${current}\nArvutatud: ${calculated}`
                } catch (e) {
                  void e
                }
              }
              const clearTooltip = () => {
                try {
                  cell.title = ''
                } catch (e) {
                  void e
                }
              }
              // If both empty, consider equal
              if (!cellToken && !calcToken) {
                clearMismatch(cell)
                clearTooltip()
                return
              }
              // If either token empty, treat as mismatch
              if (!cellToken || !calcToken) {
                // Pass null for empty current/calculated so markMismatch can avoid marking empty as incorrect
                markMismatch(cell, cellToken || null, calcToken || null)
                setTooltip(cellToken || '(tühi)', calcToken || '(tühi)')
                return
              }
              // Compare MA/A directly
              if (/^MA$/i.test(calcToken) || /^MA$/i.test(cellToken) || /^A$/i.test(calcToken) || /^A$/i.test(cellToken)) {
                if (calcToken.toUpperCase() !== cellToken.toUpperCase()) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltip(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltip()
                }
                return
              }
              // Numeric comparison: if cell shows integer (no dot), round calculated to nearest int
              const cellIsInt = /^[1-5]$/.test(cellToken)
              const calcIsNum = /^[1-5](?:\.\d+)?$/.test(calcToken)
              if (cellIsInt && calcIsNum) {
                const rounded = String(Math.round(Number(calcToken)))
                if (rounded !== cellToken) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltip(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltip()
                }
                return
              }
              // Otherwise compare numeric to two decimals
              if (calcIsNum && /^[1-5](?:\.\d+)?$/.test(cellToken)) {
                const c1 = Number(parseFloat(calcToken).toFixed(2))
                const c2 = Number(parseFloat(cellToken).toFixed(2))
                if (Number.isNaN(c1) || Number.isNaN(c2) || Math.abs(c1 - c2) > 0.01) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltip(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltip()
                }
                return
              }
              // Fallback: strict comparison
              if (calcToken !== cellToken) {
                markMismatch(cell, cellToken, calcToken)
                setTooltip(cellToken, calcToken)
              } else {
                clearMismatch(cell)
                clearTooltip()
              }
            })

            // Check ÕV columns
            Object.entries(ovColToNum).forEach(([colIdxStr, ovNum]) => {
              const colIdx = Number(colIdxStr)
              const cell = cells[colIdx]
              if (!cell) return
              const cellToken = extractGradeToken(cell)
              const calcToken = extractGradeToken(String(student.ovGrades && student.ovGrades[ovNum] ? student.ovGrades[ovNum] : ''))
              const setTooltipOv = (current, calculated) => {
                try {
                  cell.title = `Praegune hinne erineb arvutatud hindest\nPraegune: ${current}\nArvutatud: ${calculated}`
                } catch (e) {
                  void e
                }
              }
              const clearTooltipOv = () => {
                try {
                  cell.title = ''
                } catch (e) {
                  void e
                }
              }
              if (!cellToken && !calcToken) {
                clearMismatch(cell)
                clearTooltipOv()
                return
              }
              if (!cellToken || !calcToken) {
                // Pass null for empty current/calculated so markMismatch can avoid marking empty as incorrect
                markMismatch(cell, cellToken || null, calcToken || null)
                setTooltipOv(cellToken || '(tühi)', calcToken || '(tühi)')
                return
              }
              if (/^MA$/i.test(calcToken) || /^MA$/i.test(cellToken) || /^A$/i.test(calcToken) || /^A$/i.test(cellToken)) {
                if (calcToken.toUpperCase() !== cellToken.toUpperCase()) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltipOv(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltipOv()
                }
                return
              }
              const cellIsInt = /^[1-5]$/.test(cellToken)
              const calcIsNum = /^[1-5](?:\.\d+)?$/.test(calcToken)
              if (cellIsInt && calcIsNum) {
                const rounded = String(Math.round(Number(calcToken)))
                if (rounded !== cellToken) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltipOv(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltipOv()
                }
                return
              }
              if (calcIsNum && /^[1-5](?:\.\d+)?$/.test(cellToken)) {
                const c1 = Number(parseFloat(calcToken).toFixed(2))
                const c2 = Number(parseFloat(cellToken).toFixed(2))
                if (Number.isNaN(c1) || Number.isNaN(c2) || Math.abs(c1 - c2) > 0.01) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltipOv(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltipOv()
                }
                return
              }
              if (calcToken !== cellToken) {
                markMismatch(cell, cellToken, calcToken)
                setTooltipOv(cellToken, calcToken)
              } else {
                clearMismatch(cell)
                clearTooltipOv()
              }
            })
          }
        }
      } catch (e) {
        Logger.debug('FinalGradesByOvFeature: Failed to highlight mismatched cells', e)
      }
      // If autoSync is false, we only compute filteredOutput and update button/UI state, do not post grades
      if (!opts.autoSync) {
        Logger.debug('✨ FinalGradesByOvFeature: autoSync disabled on page load — skipping POST')
        // If there are no changes, disable the button (this logic mirrors earlier checks)
        if (filteredOutput.length === 0) {
          try {
            button.disabled = true
            button.style.opacity = '0.6'
            // Use a clearer, localized disabled title
            button.title = 'Kõik õpiväljundite hinded on juba olemas — pole vaja saata'
            // Prefer to set visible text when possible (use existing button text to detect L-flow)
            try {
              const isL =
                button &&
                String(button.textContent || '')
                  .toLowerCase()
                  .includes('lõpptulemus')
              button.textContent = isL ? 'Kõik hinded on õiged' : 'Kõik hinded on õiged'
            } catch (innerErr) {
              Logger.debug('FinalGradesByOvFeature: Ignored inner error setting button text', innerErr)
            }
            // Mark as intentionally disabled so click handlers don't re-enable
            button._oaFinalGradesDisabled = true
            Logger.debug('✨ FinalGradesByOvFeature: Button disabled on page load because no changes detected')
          } catch (e) {
            Logger.debug('FinalGradesByOvFeature: Failed to disable button on page load', e)
          }
        }
        return filteredOutput
      }

      setTimeout(() => {
        this.syncOvGrades({ results, ovNumToOutcomeId, filteredOutput, container, button })
          .then(success => {
            if (success) {
              window.location.reload()
            }
          })
          .catch(err => {
            Logger.error('FinalGradesByOvFeature: Fatal error in sync loop', { err })
            container.textContent = ''
            const errDiv = document.createElement('div')
            errDiv.style.cssText = 'margin:16px 0;color:#d32f2f;font-weight:bold;'
            errDiv.textContent = 'Viga õpiväljundite hinnete saatmisel!'
            container.appendChild(errDiv)
          })
      }, 0)
      return filteredOutput
    }
    // If no ÕV columns, do not render a table, just remove any old send button/status
    const existingSendBtn = document.getElementById('oa-send-ov-grades-btn')
    if (existingSendBtn) {
      existingSendBtn.remove()
    }
    const existingStatusDiv = document.getElementById('oa-send-ov-status')
    if (existingStatusDiv) {
      existingStatusDiv.remove()
    }
    Logger.debug('✨ FinalGradesByOvFeature: Table rendering skipped as requested')
  }

  // ============= L-GRADE (SISSEKANNE_L) FUNCTIONALITY =============
  // Merged from FinalGradesLFeature.js to consolidate similar logic

  detectLGrades(entries) {
    return entries.some(entry => entry.entryType === 'SISSEKANNE_L')
  }

  extractFinalGrades(entries, students) {
    const studentMap = {}
    students.forEach(s => {
      let name, idcode, studentId, journalStudentId
      if (s.student && s.student.idcode) {
        name = s.student.fullname || `${s.student.firstname} ${s.student.lastname}`
        idcode = s.student.idcode
        studentId = s.student.id
        journalStudentId = s.id
      } else {
        name = s.fullname || `${s.firstname} ${s.lastname}`
        idcode = s.idcode || 'N/A'
        studentId = s.studentId || s.id
        journalStudentId = s.id
      }
      studentMap[journalStudentId] = { name, idcode, studentId }
    })

    // Only use grades from SISSEKANNE_I and SISSEKANNE_T for calculation
    const gradesT = {} // Will store arrays of grades for each student
    const gradesI = {} // Will store arrays of grades for each student

    entries.forEach(entry => {
      if (entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_I') {
        // 1. Extract from journalStudentResults (if present)
        if (entry.journalStudentResults) {
          Logger.debug(`✨ FinalGradesLFeature: Processing ${entry.entryType} entry (journalStudentResults)`, entry.journalStudentResults)
          Object.entries(entry.journalStudentResults).forEach(([journalStudentId, resultsArr]) => {
            if (Array.isArray(resultsArr)) {
              resultsArr.forEach(result => {
                if (result.grade && result.grade.code) {
                  const grade = result.grade.code.replace('KUTSEHINDAMINE_', '')
                  if (['1', '2', '3', '4', '5'].includes(grade)) {
                    if (entry.entryType === 'SISSEKANNE_T') {
                      if (!gradesT[journalStudentId]) gradesT[journalStudentId] = []
                      gradesT[journalStudentId].push(parseInt(grade))
                      Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_T grade for student ${journalStudentId}: ${grade}`)
                    } else if (entry.entryType === 'SISSEKANNE_I') {
                      if (!gradesI[journalStudentId]) gradesI[journalStudentId] = []
                      gradesI[journalStudentId].push(parseInt(grade))
                      Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_I grade for student ${journalStudentId}: ${grade}`)
                    }
                  } else if (['A', 'MA'].includes(grade)) {
                    const key = journalStudentId + '_str'
                    if (entry.entryType === 'SISSEKANNE_T') {
                      if (!gradesT[key]) gradesT[key] = []
                      gradesT[key].push(grade)
                      Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_T string grade for student ${journalStudentId}: ${grade}`)
                    } else if (entry.entryType === 'SISSEKANNE_I') {
                      if (!gradesI[key]) gradesI[key] = []
                      gradesI[key].push(grade)
                      Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_I string grade for student ${journalStudentId}: ${grade}`)
                    }
                  }
                }
              })
            }
          })
        }
        // 2. Extract from journalEntryStudents (if present)
        if (Array.isArray(entry.journalEntryStudents)) {
          Logger.debug(`✨ FinalGradesLFeature: Processing ${entry.entryType} entry (journalEntryStudents)`, entry.journalEntryStudents)
          entry.journalEntryStudents.forEach(entryStudent => {
            if (entryStudent.grade && entryStudent.grade.code) {
              const grade = entryStudent.grade.code.replace('KUTSEHINDAMINE_', '')
              const journalStudentId = entryStudent.journalStudent
              if (['1', '2', '3', '4', '5'].includes(grade)) {
                if (entry.entryType === 'SISSEKANNE_T') {
                  if (!gradesT[journalStudentId]) gradesT[journalStudentId] = []
                  gradesT[journalStudentId].push(parseInt(grade))
                  Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_T grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                } else if (entry.entryType === 'SISSEKANNE_I') {
                  if (!gradesI[journalStudentId]) gradesI[journalStudentId] = []
                  gradesI[journalStudentId].push(parseInt(grade))
                  Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_I grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                }
              } else if (['A', 'MA'].includes(grade)) {
                const key = journalStudentId + '_str'
                if (entry.entryType === 'SISSEKANNE_T') {
                  if (!gradesT[key]) gradesT[key] = []
                  gradesT[key].push(grade)
                  Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_T string grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                } else if (entry.entryType === 'SISSEKANNE_I') {
                  if (!gradesI[key]) gradesI[key] = []
                  gradesI[key].push(grade)
                  Logger.debug(`✨ FinalGradesLFeature: Added SISSEKANNE_I string grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                }
              }
            }
          })
        }
      }
    })

    Logger.debug('✨ FinalGradesLFeature: All SISSEKANNE_T grades', gradesT)
    Logger.debug('✨ FinalGradesLFeature: All SISSEKANNE_I grades', gradesI)

    const output = []
    Object.entries(studentMap).forEach(([journalStudentId, student]) => {
      const tGrades = gradesT[journalStudentId] || []
      const iGrades = gradesI[journalStudentId] || []
      const allGrades = [...tGrades, ...iGrades]
      const allStringGrades = [...(gradesT[journalStudentId + '_str'] || []), ...(gradesI[journalStudentId + '_str'] || [])]
      Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL SISSEKANNE_T grades:`, tGrades)
      Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL SISSEKANNE_I grades:`, iGrades)
      Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL COMBINED grades:`, allGrades)
      Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL STRING grades:`, allStringGrades)
      let finalGrade = ''
      if (allStringGrades.includes('MA')) {
        finalGrade = 'MA'
        Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: at least one MA → MA`)
      } else if (allStringGrades.length > 0 && allStringGrades.every(g => g === 'A')) {
        finalGrade = 'A'
        Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: all A → A`)
      } else if (allGrades.length > 0) {
        const sum = allGrades.reduce((a, b) => a + b, 0)
        const avg = sum / allGrades.length
        finalGrade = String(Math.round(avg))
        Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: combined avg ${avg} → ${finalGrade}`)
      } else {
        finalGrade = null
        Logger.debug(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: no SISSEKANNE_T/I grades, skipping calculation`)
      }
      output.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        journalStudentId,
        studentId: student.studentId
      })
    })
    Logger.debug('✨ FinalGradesLFeature: output', output)
    return { output }
  }

  // Highlight cells in the journal table where the current L-grade differs from our calculated grade
  _highlightIncorrectCurrentGrades(results) {
    try {
      if (!results || !results.output || !Array.isArray(results.output)) return
      const table = this.findJournalTable()
      if (!table) return

      // Ensure local CSS is injected for OA final-grade mismatch highlights
      injectFinalGradeCSS()

      const outcomeEntryNames = (this._lastEntries || [])
        .filter(e => e.entryType === 'SISSEKANNE_O' && e.nameEt)
        .map(e => e.nameEt.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter(name => name.length > 0)
      const { finalGradeCols } = this.findColumnIndices(table, outcomeEntryNames)
      if (!finalGradeCols || finalGradeCols.length === 0) return

      const extractGradeToken = input => {
        if (!input) return ''
        let s = ''
        try {
          if (typeof input === 'object' && input !== null && input.innerText != null) s = String(input.innerText || '')
          else s = String(input || '')
        } catch (e) {
          s = String(input || '')
        }
        s = s
          .replace(/\u00A0/g, ' ')
          .replace(/[,\s]+(?=\d{1,2}$)/, '.')
          .trim()
        const tokens = []
        Array.from(s.matchAll(/\bMA\b/gi)).forEach(m => tokens.push({ type: 'MA', value: 'MA', index: m.index }))
        Array.from(s.matchAll(/\bA\b/gi)).forEach(m => tokens.push({ type: 'A', value: 'A', index: m.index }))
        Array.from(s.matchAll(/\b([1-5](?:[.,]\d+)?)\b/g)).forEach(m => tokens.push({ type: 'NUM', value: m[1].replace(',', '.'), index: m.index }))
        if (tokens.length) {
          tokens.sort((a, b) => (a.index || 0) - (b.index || 0))
          const lastTok = tokens[tokens.length - 1]
          if (lastTok.type === 'MA') return 'MA'
          if (lastTok.type === 'A') return 'A'
          if (lastTok.type === 'NUM') return lastTok.value
        }
        return ''
      }

      const rows = Array.from(table.querySelectorAll('tbody tr'))

      const rowHasAcademicLeave = r => {
        try {
          return Array.from(r.querySelectorAll('span')).some(s => (s.textContent || '').trim() === 'AP')
        } catch (e) {
          return false
        }
      }

      const resultMap = {}
      results.output.forEach(r => {
        if (r && r.journalStudentId != null) resultMap[String(r.journalStudentId).trim()] = r
      })

      rows.forEach(row => {
        try {
          if (rowHasAcademicLeave(row)) return
          const cells = Array.from(row.children).filter(n => n.nodeType === 1)

          const ds = (
            row.getAttribute('data-student-id') ||
            row.getAttribute('data-journal-student') ||
            (row.dataset ? row.dataset.journalStudent : null) ||
            ''
          ).toString()
          let student = null
          if (ds && resultMap[ds]) student = resultMap[ds]

          if (!student) {
            const txt = row.textContent || ''
            student =
              results.output.find(r => {
                const name = (r.name || '').trim()
                const idcode = (r.idcode || '').trim()
                if (name && txt.includes(name)) return true
                if (idcode && txt.includes(idcode)) return true
                return false
              }) || null
          }

          if (!student || student.finalGrade === null) return

          finalGradeCols.forEach(colIdx => {
            const cell = cells[colIdx]
            if (!cell) return
            try {
              const cellToken = extractGradeToken(cell)
              const calcToken = extractGradeToken(String(student.finalGrade || '').toString())
              const setTooltip = (current, calculated) => {
                try {
                  cell.title = `Praegune hinne erineb arvutatud hindest\nPraegune: ${current}\nArvutatud: ${calculated}`
                } catch (e) {
                  void e
                }
              }
              const clearTooltip = () => {
                try {
                  cell.title = ''
                } catch (e) {
                  void e
                }
              }

              if (!cellToken && !calcToken) {
                clearMismatch(cell)
                clearTooltip()
                return
              }
              if (!cellToken || !calcToken) {
                // missing one side -> mark as red (mismatch)
                // Pass null for empty values so markMismatch can correctly skip marking empty currents
                markMismatch(cell, cellToken || null, calcToken || null)
                setTooltip(cellToken || '(tühi)', calcToken || '(tühi)')
                return
              }
              if (/^MA$/i.test(calcToken) || /^MA$/i.test(cellToken) || /^A$/i.test(calcToken) || /^A$/i.test(cellToken)) {
                if (calcToken.toUpperCase() !== cellToken.toUpperCase()) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltip(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltip()
                }
                return
              }
              const cellIsInt = /^[1-5]$/.test(cellToken)
              const calcIsNum = /^[1-5](?:\.\d+)?$/.test(calcToken)
              if (cellIsInt && calcIsNum) {
                const rounded = String(Math.round(Number(calcToken)))
                if (rounded !== cellToken) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltip(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltip()
                }
                return
              }
              if (calcIsNum && /^[1-5](?:\.\d+)?$/.test(cellToken)) {
                const c1 = Number(parseFloat(calcToken).toFixed(2))
                const c2 = Number(parseFloat(cellToken).toFixed(2))
                if (Number.isNaN(c1) || Number.isNaN(c2) || Math.abs(c1 - c2) > 0.01) {
                  markMismatch(cell, cellToken, calcToken)
                  setTooltip(cellToken, calcToken)
                } else {
                  clearMismatch(cell)
                  clearTooltip()
                }
                return
              }
              if (calcToken !== cellToken) {
                markMismatch(cell, cellToken, calcToken)
                setTooltip(cellToken, calcToken)
              } else {
                clearMismatch(cell)
                clearTooltip()
              }
            } catch (e) {
              // ignore per-cell errors
            }
          })
        } catch (e) {
          // ignore per-row errors
        }
      })
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error while highlighting incorrect current grades', e)
    }
  }

  async showLGradeResults(results, button, lastEntries, opts = { autoSync: true }) {
    // Only sync grades and show a status message, do not render a table
    let container = document.getElementById('oa-final-grades-results')
    if (!container) {
      container = domService.createAndInsertElement('div', { id: 'oa-final-grades-results' }, '', button, 'afterend')
    }
    container.textContent = ''
    let statusDiv = document.getElementById('oa-sync-lopp-status')
    if (!statusDiv) {
      statusDiv = domService.createAndInsertElement(
        'div',
        { id: 'oa-sync-lopp-status', style: { margin: '8px 0', color: '#1976d2', fontWeight: 'bold' } },
        '',
        container,
        'afterend'
      )
    }
    statusDiv.textContent = ''

    // Ensure per-cell L-grade selection dropdowns are available in the journal table.
    try {
      this.ensureLGradeDropdowns()
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Failed to ensure L-grade dropdowns', e)
    }
    // Snapshot pristine computed grades once so mode conversion stays non-lossy/idempotent.
    // The grading mode itself is resolved below, after the recorded L grades are fetched.
    this.ensureRawOutputSnapshot(results)

    try {
      const journalId = this.extractJournalId()
      // Find the SISSEKANNE_L entry
      const lEntry = (lastEntries || []).find(e => e.entryType === 'SISSEKANNE_L')
      if (!lEntry) {
        statusDiv.textContent = 'Lõpptulemus puudub.'
        return
      }
      // Prefer using provided lastEntries to avoid unnecessary API calls when possible
      let currentEntry = null
      if (lastEntries && Array.isArray(lastEntries)) {
        currentEntry = lastEntries.find(e => e.id === lEntry.id) || null
      }
      // If we don't have a usable currentEntry (or it lacks journalEntryStudents), fetch fresh from API
      if (!currentEntry || !Array.isArray(currentEntry.journalEntryStudents)) {
        currentEntry = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${lEntry.id}`, {}, { cache: false })
        Logger.debug('✨ FinalGradesLFeature: Fetched current entry from API', currentEntry)
      } else {
        Logger.debug('✨ FinalGradesLFeature: Using current entry from lastEntries', currentEntry)
      }
      // Fail closed: if we still couldn't read the recorded final grades (entry missing or a
      // malformed response), do NOT guess a grading scale or sync — that could overwrite correct
      // grades. This is distinct from an entry that simply has no grades yet
      // (journalEntryStudents === []), which IS readable and is handled normally below.
      if (!currentEntry || !Array.isArray(currentEntry.journalEntryStudents)) {
        Logger.error('FinalGradesByOvFeature: Could not read recorded L grades; skipping resolution/sync', {
          journalId,
          lEntryId: lEntry.id
        })
        statusDiv.textContent = 'Ei õnnestunud lõpptulemuse hindeid laadida.'
        if (button) {
          button.disabled = true
          button.style.opacity = '0.6'
        }
        return
      }
      // Build a map of recorded final grades per student (journalStudentId -> token).
      const lGrades = {}
      currentEntry.journalEntryStudents.forEach(entryStudent => {
        if (entryStudent && entryStudent.journalStudent != null && entryStudent.grade && entryStudent.grade.code) {
          const code = entryStudent.grade.code
          lGrades[String(entryStudent.journalStudent)] = code.replace('KUTSEHINDAMINE_', '').toUpperCase()
        }
      })
      // Resolve the grading scale from the recorded final (lõpptulemus) grades — the
      // cross-session memory. Resolve here, AFTER fetching currentEntry, so the recorded
      // grades are available (lastEntries may arrive without journalEntryStudents). An
      // in-session pick overrides; the journal's declared type is the fallback when nothing
      // is recorded yet. Convert results to that scale, then wire the dropdown to it.
      const recordedTokens = getRecordedFinalGradeTokens(currentEntry.journalEntryStudents)
      const journalAssessment = await this.getJournalAssessment()
      const userPick = journalId != null ? this.gradingModeUserPickByJournal[String(journalId)] : undefined
      const gradingMode = resolveGradingMode({ recordedTokens, journalAssessment, userPick })
      this.applyGradingModeToResults(results, gradingMode)
      this.gradingModeChangeContext = { flow: 'l', results, button, lastEntries }
      this.ensureGradingModeSelect(button, gradingMode)
      const filteredOutput = results.output.filter(r => {
        if (r.finalGrade === null) return false
        const key = String(r.journalStudentId).trim()
        const current = lGrades[key]
        if (!current) return r.finalGrade && r.finalGrade !== ''
        return (r.finalGrade && String(r.finalGrade).toUpperCase()) !== current
      })
      // Update UI highlights for incorrect current L grades (visual aid)
      try {
        this._highlightIncorrectCurrentGrades(results)
      } catch (e) {
        Logger.debug('FinalGradesByOvFeature: Failed to update current grade highlights', e)
      }
      // If autoSync is disabled, we only compute filteredOutput and update button state/UI
      if (!opts.autoSync) {
        try {
          if (!button) return filteredOutput
          if (!Array.isArray(filteredOutput) || filteredOutput.length === 0) {
            // No changes -> disable button and show clear label/title
            try {
              button.disabled = true
              button.style.opacity = '0.6'
              button.title = 'Kõik lõpptulemuse hinded ühtivad juba olemasolevate hinnetega'
              // Prefer keeping a marker both on the button and globally
              button._oaFinalGradesDisabled = true
              window._oaFinalGradesDisabled = true
              // Use a clearer disabled text
              try {
                button.textContent = 'Kõik hinded on õiged'
              } catch (inner) {
                Logger.debug('FinalGradesByOvFeature: Ignored inner error setting button text', inner)
              }
            } catch (innerErr) {
              Logger.debug('FinalGradesByOvFeature: Failed to set disabled button state', innerErr)
            }
            Logger.debug('✨ FinalGradesByOvFeature: Button disabled on page load because no L changes detected')
          } else {
            // enable button if previously disabled
            try {
              window._oaFinalGradesDisabled = false
              button._oaFinalGradesDisabled = false
              button.disabled = false
              button.style.opacity = ''
              button.title = ''
              // Restore proper label and primary blue background
              try {
                // When there are changes to apply, present the update action label
                button.textContent = 'Uuenda õpiväljundite hinded'
                button.style.background = 'rgb(21, 101, 192)'
              } catch (innerErr) {
                Logger.debug('FinalGradesByOvFeature: Failed to restore button text/style', innerErr)
              }
            } catch (e) {
              Logger.debug('FinalGradesByOvFeature: Failed to enable button', e)
            }
            // Decide label: if there are existing L grades, present update action; otherwise present add action
            try {
              const hasExistingL = this.hasAnyLGrades(currentEntry ? [currentEntry] : lastEntries || [])
              if (hasExistingL) {
                button.textContent = 'Uuenda õpiväljundite hinded'
              } else {
                button.textContent = 'Lisa lõpptulemuse hinded'
              }
              button.style.background = 'rgb(21, 101, 192)'
            } catch (innerErr) {
              Logger.debug('FinalGradesByOvFeature: Failed deciding button label', innerErr)
            }
            Logger.debug('✨ FinalGradesByOvFeature: Button enabled on page load — L changes detected')
          }
        } catch (e) {
          Logger.debug('FinalGradesByOvFeature: Error while updating button state on page load', e)
        }
        return filteredOutput
      }
      Logger.debug(
        '✨ FinalGradesByOvFeature: filtered results.output journalStudentIds',
        filteredOutput.map(r => r.journalStudentId)
      )
      // Fetch student statuses for filtered students so we can apply OPPURSTAATUS_A rule
      const uniqueStudentIds = Array.from(new Set(filteredOutput.map(r => r.studentId).filter(Boolean)))
      const studentStatusMap = {}
      await Promise.all(
        uniqueStudentIds.map(async id => {
          try {
            const det = await this.api.tahvel.get(`/students/${id}`, {}, { cache: false })
            studentStatusMap[String(id)] = det && det.status ? det.status : null
          } catch (e) {
            Logger.error('✨ FinalGradesByOvFeature: Failed to fetch student details, defaulting to include', { studentId: id, err: e })
            studentStatusMap[String(id)] = null
          }
        })
      )
      const mappedStudents = filteredOutput
        .map(r => {
          // If student is on status A (OPPURSTAATUS_A) only allow adding if finalGrade is not MA, 1 or 2
          const status = studentStatusMap[String(r.studentId)]
          const gradeStr = String(r.finalGrade || '').toUpperCase()
          if (status === 'OPPURSTAATUS_A' && (gradeStr === 'MA' || gradeStr === '1' || gradeStr === '2')) {
            Logger.debug('✨ FinalGradesByOvFeature: Skipping L grade for OPPURSTAATUS_A student due to disallowed grade', {
              journalStudentId: r.journalStudentId,
              studentId: r.studentId,
              grade: gradeStr
            })
            return null
          }
          const existing = (currentEntry.journalEntryStudents || []).find(
            entryStudent => String(entryStudent.journalStudent) === String(r.journalStudentId)
          )
          const grade = r.finalGrade
          let code = null,
            value = '',
            value2 = '',
            nameEt = '',
            nameEn = ''
          const valid = true
          if (['1', '2', '3', '4', '5'].includes(grade)) {
            code = `KUTSEHINDAMINE_${grade}`
            value = grade
            value2 = grade
            const gradeNames = {
              5: { nameEt: 'Väga hea', nameEn: 'Very good' },
              4: { nameEt: 'Hea', nameEn: 'Good' },
              3: { nameEt: 'Rahuldav', nameEn: 'Satisfactory' },
              2: { nameEt: 'Puudulik', nameEn: 'Insufficient' },
              1: { nameEt: 'Nõrk', nameEn: 'Weak' }
            }
            nameEt = gradeNames[grade]?.nameEt || ''
            nameEn = gradeNames[grade]?.nameEn || ''
          } else if (grade === 'MA') {
            code = 'KUTSEHINDAMINE_MA'
            value = 'MA'
            value2 = 'ma'
            nameEt = 'Mittearvestatud'
            nameEn = 'Failed'
          } else if (grade === 'A') {
            code = 'KUTSEHINDAMINE_A'
            value = 'A'
            value2 = 'a'
            nameEt = 'Arvestatud'
            nameEn = 'Passed'
          } else {
            return null
          }
          if (existing) {
            return {
              ...existing,
              journalStudent: String(r.journalStudentId),
              grade: {
                code,
                gradingSchemaRowId: null,
                value,
                value2,
                extraval1: null,
                extraval2: null,
                nameEt,
                nameEn,
                valid
              },
              removeStudentHistory: true
            }
          } else {
            return {
              id: undefined,
              journalStudent: String(r.journalStudentId),
              absence: null,
              grade: {
                code,
                gradingSchemaRowId: null,
                value,
                value2,
                extraval1: null,
                extraval2: null,
                nameEt,
                nameEn,
                valid: true
              },
              verbalGrade: null,
              removeStudentHistory: true,
              addInfo: null,
              isLessonAbsence: false,
              hasOverlappingLessonAbsence: false,
              isPraise: false,
              isRemark: false,
              lessonAbsences: {},
              studentName: null,
              studentGroup: null,
              journalEntryStudentHistories: [],
              hasWholeDayAcceptedAbsence: false,
              wholeDayAbsenceCode: null
            }
          }
        })
        .filter(Boolean)
      // Deduplicate by journalStudent (last one wins), filter out null/undefined journalStudent
      const seen = new Map()
      mappedStudents.forEach(entryStudent => {
        if (entryStudent && entryStudent.journalStudent != null) {
          seen.set(String(entryStudent.journalStudent), entryStudent)
        }
      })
      const journalEntryStudents = Array.from(seen.values()).filter(entryStudent => entryStudent && entryStudent.journalStudent != null)
      Logger.debug('✨ FinalGradesByOvFeature: journalEntryStudents to send', journalEntryStudents)
      // Build payload using the current entry from API
      const payload = {
        ...currentEntry,
        journalEntryStudents
      }
      Logger.debug('✨ FinalGradesByOvFeature: Sending SISSEKANNE_L PUT', { url: `/journals/${journalId}/journalEntry/${lEntry.id}`, payload })
      await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${lEntry.id}`, payload)
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      statusDiv.textContent = 'Viga saatmisel.'
    }
  }

  // Ensure that L-grade (SISSEKANNE_L) entries have proper grade selection dropdowns in journal table cells
  ensureLGradeDropdowns() {
    try {
      const table = this.findJournalTable()
      if (!table) return

      // Find journal entry header that contains "Lõpptulemus" or similar final result text
      const headerRow = table.querySelector('thead tr')
      if (!headerRow) return

      const headerCells = Array.from(headerRow.children)
      let lGradeColIndex = -1

      // Look for header containing final result keywords
      headerCells.forEach((cell, index) => {
        const text = (cell.textContent || '').toLowerCase().trim()
        if (text.includes('lõpptulemus') || text.includes('final') || text.includes('kokkuvõte')) {
          lGradeColIndex = index
        }
      })

      if (lGradeColIndex === -1) return

      // Process each student row to ensure grade dropdowns exist
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      rows.forEach(row => {
        try {
          const cells = Array.from(row.children)
          const lGradeCell = cells[lGradeColIndex]
          if (!lGradeCell) return

          // Check if the cell already has a grade selection element
          const existingSelect = lGradeCell.querySelector('md-select, select')
          const existingInput = lGradeCell.querySelector('input')

          if (!existingSelect && !existingInput) {
            // Create a simple grade selection dropdown
            this.createLGradeDropdown(lGradeCell, row)
          }
        } catch (e) {
          // Ignore per-row errors
        }
      })
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error ensuring L-grade dropdowns', e)
    }
  }

  // Create a grade selection dropdown for an L-grade table cell
  createLGradeDropdown(cell, row) {
    try {
      // Extract student identifier from row
      const studentId =
        row.getAttribute('data-student-id') || row.getAttribute('data-journal-student') || (row.dataset ? row.dataset.journalStudent : null)
      if (!studentId) return

      // Create a select element for grade selection
      const select = document.createElement('select')
      select.className = 'oa-lgrade-select'
      select.style.cssText = `
        width: 80px;
        padding: 4px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 14px;
        background: white;
      `

      // Add grade options
      const grades = [
        { value: '', text: '-' },
        { value: '5', text: '5 (Väga hea)' },
        { value: '4', text: '4 (Hea)' },
        { value: '3', text: '3 (Rahuldav)' },
        { value: '2', text: '2 (Puudulik)' },
        { value: '1', text: '1 (Nõrk)' },
        { value: 'A', text: 'A (Arvestatud)' },
        { value: 'MA', text: 'MA (Mittearvestatud)' }
      ]

      grades.forEach(grade => {
        const option = document.createElement('option')
        option.value = grade.value
        option.textContent = grade.text
        select.appendChild(option)
      })

      // Set current value if one exists in the cell
      const currentText = (cell.innerText || cell.textContent || '').trim()
      const currentGrade = this.extractGradeFromText(currentText)
      if (currentGrade && grades.some(g => g.value === currentGrade)) {
        select.value = currentGrade
      }

      // Add change event listener to update the grade
      select.addEventListener('change', e => {
        this.handleLGradeChange(studentId, e.target.value, cell)
      })

      // Replace cell content with the dropdown
      cell.textContent = ''
      cell.appendChild(select)
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error creating L-grade dropdown', e)
    }
  }

  // Extract grade value from text content
  extractGradeFromText(text) {
    if (!text) return ''
    const cleaned = text.trim().toUpperCase()
    if (['1', '2', '3', '4', '5'].includes(cleaned)) return cleaned
    if (cleaned === 'A' || cleaned === 'MA') return cleaned
    return ''
  }

  // Handle grade selection change
  async handleLGradeChange(studentId, newGrade, cell) {
    try {
      if (!newGrade) {
        // Clear grade - could implement grade removal logic here
        cell.style.backgroundColor = ''
        return
      }

      // Visual feedback while saving
      cell.style.backgroundColor = '#fff3cd'

      // Here you could implement actual grade saving logic
      // For now, just update the visual state
      Logger.debug('FinalGradesByOvFeature: L-grade changed', { studentId, newGrade })

      // Reset background after a delay
      setTimeout(() => {
        cell.style.backgroundColor = '#d4edda' // Light green to indicate saved
        setTimeout(() => {
          cell.style.backgroundColor = ''
        }, 2000)
      }, 500)
    } catch (e) {
      Logger.error('FinalGradesByOvFeature: Error handling L-grade change', e)
      cell.style.backgroundColor = '#f8d7da' // Light red to indicate error
    }
  }

  // Attach a DOM observer that re-evaluates L-grade diffs and updates the provided button
  // Uses a lightweight visible-text snapshot to avoid API calls for minor/no-op mutations
  attachDomObserver(button, initialEntries) {
    try {
      const tableEl = document.querySelector('#studentTable')
      if (!tableEl) {
        Logger.debug('FinalGradesByOvFeature: attachDomObserver - #studentTable not found, skipping')
        return null
      }
      let debounceTimer = null
      let lastSnapshot = null
      const getSnapshot = () => {
        try {
          const txt = tableEl && tableEl.innerText ? tableEl.innerText.trim() : ''
          return txt ? txt.slice(0, 20000) : ''
        } catch (e) {
          return ''
        }
      }
      // Initialize snapshot from provided initialEntries if available
      if (initialEntries) {
        try {
          const fakeEl = { innerText: JSON.stringify(initialEntries).slice(0, 20000) }
          lastSnapshot = (fakeEl.innerText || '').trim()
        } catch (e) {
          lastSnapshot = null
        }
      }
      const onChange = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(async() => {
          try {
            const snapshot = getSnapshot()
            if (snapshot === lastSnapshot) {
              Logger.debug('✨ FinalGradesByOvFeature: DOM changed but table snapshot unchanged — skipping API')
              return
            }
            lastSnapshot = snapshot
            Logger.debug('✨ FinalGradesByOvFeature: Detected meaningful DOM change — re-evaluating L diffs')
            const journalId = this.extractJournalId()
            if (!journalId) return
            const [newEntries, newStudents] = await Promise.all([
              this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
              this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
            ])
            this._lastEntries = newEntries
            const newResults = this.extractFinalGrades(newEntries, newStudents)
            await this.showLGradeResults(newResults, button, newEntries, { autoSync: false })
            Logger.debug('✨ FinalGradesByOvFeature: Button state updated after DOM change')
          } catch (err) {
            Logger.debug('✨ FinalGradesByOvFeature: Error while re-evaluating after DOM change', err)
          }
        }, 250)
      }
      const mo = new MutationObserver(onChange)
      mo.observe(tableEl, { childList: true, subtree: true, attributes: true })
      return mo
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Failed to attach DOM observer for table changes', e)
      return null
    }
  }

  // Helper: detect whether there are any existing SISSEKANNE_L grades in provided entries
  // Returns true if at least one journalEntryStudents array contains a grade code
  hasAnyLGrades(entries) {
    try {
      if (!entries || !Array.isArray(entries)) return false
      for (const entry of entries) {
        if (entry && entry.entryType === 'SISSEKANNE_L') {
          const journalEntryStudents = entry.journalEntryStudents
          if (Array.isArray(journalEntryStudents) && journalEntryStudents.length > 0) {
            for (const entryStudent of journalEntryStudents) {
              if (entryStudent && entryStudent.grade && entryStudent.grade.code) return true
            }
          }
        }
      }
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error while checking for existing L grades', e)
    }
    return false
  }

  // Helper: detect whether any SISSEKANNE_O outcome grades exist in the provided entries
  // Returns true if at least one student outcome grade exists for any SISSEKANNE_O entry
  hasAnyOvGrades(entries) {
    try {
      if (!entries || !Array.isArray(entries)) return false
      for (const entry of entries) {
        if (entry && entry.entryType === 'SISSEKANNE_O') {
          const sor = entry.studentOutcomeResults
          if (sor && typeof sor === 'object' && Object.keys(sor).length > 0) return true
          if (entry.outcomeStudents && Array.isArray(entry.outcomeStudents) && entry.outcomeStudents.length > 0) return true
        }
      }
    } catch (e) {
      Logger.debug('FinalGradesByOvFeature: Error while checking for existing ÕV grades', e)
    }
    return false
  }

  findJournalTable() {
    const selectors = [
      '#studentTable table.tahvel-table',
      '#studentTable table',
      '.tahvel-table-wrapper#studentTable table',
      '.layout-padding table.tahvel-table',
      '.layout-padding table.journalTable',
      'table.journalTable',
    ]
    for (const sel of selectors) {
      const t = document.querySelector(sel)
      if (t) return t
    }
    return null
  }

  // Find column indices for final grade and ÕV columns in the journal table
  // Copied from HighlightFinalGradesFeature to avoid dependency
  findColumnIndices(table, outcomeEntryNames = []) {
    const headerRows = getNativeJournalHeaderRows(table)
    const finalGradeCols = []
    const ovCols = []
    const debugHeaders = []
    headerRows.forEach(row => {
      let colIdx = 0
      Array.from(row.children).forEach(th => {
        const colspan = parseInt(th.getAttribute('colspan') || '1', 10)
        const rawText = th.innerText || th.textContent
        // Normalize: replace all whitespace (including line breaks) with single space, trim, lowercase
        const normalized = (rawText || '').replace(/\s+/g, ' ').trim().toLowerCase()
        let ovMatch = false
        let finalMatch = false
        // ÕV: match 'õv', 'õv1', 'õv2', 'õv 2', 'õv_2', 'õv-2', 'õv2 forward', or contains 'õpiväljund'
        if (/^õv\d*[ _-]?.*$/i.test(normalized) || normalized.includes('õpiväljund')) {
          ovMatch = true
          for (let i = 0; i < colspan; i++) ovCols.push(colIdx + i)
        }
        // Also match SISSEKANNE_O outcome columns by their nameEt text
        if (!ovMatch && outcomeEntryNames.length > 0) {
          const MIN_PREFIX_LEN = 10
          if (outcomeEntryNames.some(name =>
            name === normalized ||
            (normalized.length >= MIN_PREFIX_LEN && name.startsWith(normalized)) ||
            (name.length >= MIN_PREFIX_LEN && normalized.startsWith(name))
          )) {
            ovMatch = true
            for (let i = 0; i < colspan; i++) ovCols.push(colIdx + i)
          }
        }
        // Final grade: match 'lõpptulemus', 'lõpptulemus 1', 'lõpptulemus_2', etc.
        if (/lõpptulemus/.test(normalized)) {
          finalMatch = true
          for (let i = 0; i < colspan; i++) finalGradeCols.push(colIdx + i)
        }
        debugHeaders.push(`[${colIdx}] "${rawText.trim()}" => "${normalized}" | OV: ${ovMatch} | FINAL: ${finalMatch} | colspan=${colspan}`)
        colIdx += colspan
      })
    })
    if (Logger.isDebugMode()) Logger.debug('✨ FinalGradesByOvFeature: header debug:', debugHeaders.join(' | '))
    if (Logger.isDebugMode()) Logger.debug('✨ FinalGradesByOvFeature: detected final grade columns:', finalGradeCols)
    if (Logger.isDebugMode()) Logger.debug('✨ FinalGradesByOvFeature: detected ÕV columns:', ovCols)
    return { finalGradeCols: Array.from(new Set(finalGradeCols)), ovCols: Array.from(new Set(ovCols)) }
  }
}
export default FinalGradesByOvFeature
