/**
 * Tahvel New Assignment Sync Feature
 *
 * Syncs new assignments from Kriit to Tahvel by:
 * 1. Making GET request to fetch existing journal entries
 * 2. Creating new assignments via POST requests
 * 3. Making another GET request to retrieve external IDs
 * 4. Sending external IDs back to Kriit
 *
 * Handles multiple assignments in a loop, always starts with GET requests
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { bannerService } from '../../services/BannerService.js'
import { formatFinalGradeUpdateSummary, recalculateFinalGradesForTouchedJournals } from './FinalGradeRecalculation.js'

class TahvelNewAssignmentSyncFeature extends BaseFeature {
  constructor() {
    // This feature activates on the journal list page
    // No required DOM selectors - activate immediately and perform internal checks
    super('tahvelNewAssignmentSync', /#\/journals/, null)

    this.isProcessing = false
    this.newAssignments = []
  }

  /**
   * Called when the feature is activated
   */
  async onActivate() {
    Logger.debug(`[${this.name}] Tahvel New Assignment Sync feature initialized`)

    // Wait for Kriit API settings to be loaded from chrome.storage
    if (this.api._kriitInitPromise) await this.api._kriitInitPromise
    if (!this.isActive) return

    // Check if Kriit support is enabled
    if (!this.api.kriit.enabled) {
      Logger.debug('Kriit support is disabled - TahvelNewAssignmentSync will not be activated')
      return
    }

    // Feature is ready but will only sync when explicitly called via syncNewAssignmentsToTahvel()
    Logger.debug('TahvelNewAssignmentSync ready - waiting for manual sync trigger')
  }

  /**
   * Check if there are new assignments to sync to Tahvel
   * Returns the new assignments without automatically syncing them
   */
  async checkForNewAssignments() {
    try {
      if (this.isProcessing) {
        Logger.debug('Already processing new assignments, skipping')
        return null
      }

      // Get new assignments from Kriit differences response
      const newAssignments = await this.getNewAssignmentsFromKriit()

      if (!newAssignments || Object.keys(newAssignments).length === 0) {
        Logger.debug('No new assignments to sync to Tahvel')
        return null
      }

      Logger.debug(`Found new assignments ready for sync: ${Object.keys(newAssignments).length} subjects`)
      return newAssignments
    } catch (error) {
      Logger.error('Error checking for new assignments:', error)
      return null
    }
  }

  /**
   * Get new assignments from the latest Kriit sync response
   */
  async getNewAssignmentsFromKriit() {
    try {
      // Check if we have new assignments from the latest sync
      const syncData = window.journalListSync?.newAssignments || {}

      if (Object.keys(syncData).length > 0) {
        Logger.debug(`Retrieved ${Object.keys(syncData).length} subjects with new assignments`)
        return syncData
      }

      // If no cached data, make a fresh call to Kriit to get differences
      Logger.debug('No cached new assignments found, checking with fresh Kriit call')

      // Get journal data from Tahvel
      const journalData = await this.collectJournalDataForSync()

      if (!journalData || journalData.length === 0) {
        Logger.debug('No journal data available for sync check')
        return {}
      }

      // Call Kriit API to get differences and new assignments
      const response = await this.api.kriit.post('/subjects/getDifferences', journalData)

      if (response && response.newAssignments) {
        Logger.debug(`Kriit returned ${Object.keys(response.newAssignments).length} subjects with new assignments`)

        // Cache the new assignments for other features
        if (!window.journalListSync) window.journalListSync = {}
        window.journalListSync.newAssignments = response.newAssignments

        return response.newAssignments
      }

      return {}
    } catch (error) {
      Logger.error('Error getting new assignments from Kriit:', error)
      return {}
    }
  }

  /**
   * Collect journal data needed for sync (simplified version of JournalListSync logic)
   */
  async collectJournalDataForSync() {
    try {
      // Get journal links from the DOM
      const journalLinkSelectors = ['#main-content md-table-container td:nth-child(2) > a', 'span.linked-name', 'a[href*="/journal/"]', '#main-content a']

      const journalLinks = document.querySelectorAll(journalLinkSelectors.join(', '))

      if (!journalLinks || journalLinks.length === 0) {
        Logger.warning('No journal links found for sync')
        return []
      }

      Logger.debug(`Found ${journalLinks.length} journal links for new assignment sync`)

      // For this sync, we just need basic subject info - no need for full data collection
      const journalData = []

      for (const link of Array.from(journalLinks).slice(0, 10)) {
        // Limit to first 10 for performance
        try {
          const resolved = this.resolveJournalFromElement(link)
          if (!resolved || !resolved.id) continue

          const journalInfo = await this.api.tahvel.get(`/journals/${resolved.id}`)
          if (!journalInfo) continue

          let teacherPersonalCode = ''
          if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
            const teacher = journalInfo.journalTeachers[0]
            try {
              const teacherDetails = await this.api.tahvel.get(`/teachers/${teacher.id}`)
              if (teacherDetails && teacherDetails.person && teacherDetails.person.idcode) {
                teacherPersonalCode = teacherDetails.person.idcode
              }
            } catch (error) {
              Logger.warning(`Could not get teacher personal code: ${error.message}`)
            }
          }

          journalData.push({
            subjectName: journalInfo.nameEt || '',
            subjectExternalId: resolved.id,
            groupName: journalInfo.studentGroups?.[0] || '',
            teacherPersonalCode,
            assignments: [] // Empty for this sync check
          })
        } catch (error) {
          Logger.warning(`Error processing journal link: ${error.message}`)
          continue
        }
      }

      return journalData
    } catch (error) {
      Logger.error('Error collecting journal data for sync:', error)
      return []
    }
  }

  /**
   * Sync new assignments to Tahvel
   */
  async syncNewAssignmentsToTahvel(newAssignments) {
    this.isProcessing = true

    try {
      Logger.debug('🚀 Starting sync of new assignments to Tahvel')
      Logger.debug('New assignments to sync:', newAssignments)

      const results = {
        success: [],
        failed: [],
        touchedJournalIds: []
      }

      // Process each subject with new assignments
      for (const [subjectExternalId, assignments] of Object.entries(newAssignments)) {
        try {
          Logger.debug(`📚 Processing subject ${subjectExternalId} with ${assignments.length} new assignments`)

          // Process assignments for this subject
          const subjectResults = await this.syncAssignmentsForSubject(subjectExternalId, assignments)

          results.success.push(...subjectResults.success)
          results.failed.push(...subjectResults.failed)
          results.touchedJournalIds.push(...subjectResults.touchedJournalIds)

          Logger.debug(`Subject ${subjectExternalId} results:`, subjectResults)
        } catch (error) {
          Logger.error(`💥 Error processing subject ${subjectExternalId}:`, error)
          results.failed.push({
            subjectExternalId,
            error: error.message
          })
        }
      }

      Logger.debug(`🎯 New assignment sync completed: ${results.success.length} success, ${results.failed.length} failed`)

      if (results.touchedJournalIds.length > 0) {
        const finalGradeUpdates = await recalculateFinalGradesForTouchedJournals(this.api, results.touchedJournalIds)
        const finalGradeSummary = formatFinalGradeUpdateSummary(finalGradeUpdates)
        if (finalGradeSummary) bannerService.showSuccessBanner(finalGradeSummary)
      }

      if (results.success.length > 0) {
        Logger.debug('📋 Successful syncs:', results.success)
        Logger.debug('📤 Now sending external IDs back to Kriit...')
        await this.sendExternalIdsToKriit(results.success)
      } else {
        Logger.warning('⚠️ No successful assignment syncs to send back to Kriit')
      }

      if (results.failed.length > 0) {
        Logger.error('❌ Failed syncs:', results.failed)
      }
    } catch (error) {
      Logger.error('💥 Critical error syncing new assignments to Tahvel:', error)
    } finally {
      this.isProcessing = false
      Logger.debug('🏁 Assignment sync process finished')
    }
  }

  /**
   * Sync assignments for a specific subject/journal
   */
  async syncAssignmentsForSubject(subjectExternalId, assignments) {
    const results = {
      success: [],
      failed: [],
      touchedJournalIds: []
    }

    try {
      const journalId = parseInt(subjectExternalId, 10)

      // Step 1: GET existing journal entries to map out current state
      Logger.debug(`Step 1: Getting existing entries for journal ${journalId}`)
      const existingEntries = await this.getExistingJournalEntries(journalId)

      // Step 2: Process each new assignment
      for (const assignment of assignments) {
        try {
          Logger.debug(`Processing assignment: ${assignment.assignmentName}`)

          // Check if assignment already exists
          if (this.assignmentExists(assignment, existingEntries)) {
            Logger.debug(`Assignment "${assignment.assignmentName}" already exists, skipping`)
            continue
          }

          // Step 3: POST to create the assignment
          Logger.debug(`Step 3: Creating assignment "${assignment.assignmentName}" in Tahvel`)
          const createResult = await this.createAssignmentInTahvel(journalId, assignment)
          // Create result is logged via Logger.debug above
          Logger.debug('Create result for assignment:', createResult)

          if (!createResult.success) {
            results.failed.push({
              subjectExternalId,
              assignmentName: assignment.assignmentName,
              error: createResult.error
            })
            continue
          }

          results.touchedJournalIds.push(subjectExternalId)

          // Step 4: GET again to retrieve the external ID
          Logger.debug(`Step 4: Retrieving external ID for created assignment`)
          const externalId = createResult.response?.id || await this.getCreatedAssignmentExternalId(journalId, assignment)

          if (externalId) {
            results.success.push({
              subjectExternalId,
              assignmentName: assignment.assignmentName,
              kriitAssignmentId: assignment.createdAssignmentId,
              tahvelExternalId: externalId
            })
            Logger.debug(`✓ Successfully created assignment "${assignment.assignmentName}" with external ID: ${externalId}`)
          } else {
            results.failed.push({
              subjectExternalId,
              assignmentName: assignment.assignmentName,
              error: 'Could not retrieve external ID for created assignment'
            })
          }
        } catch (error) {
          Logger.error(`Error processing assignment "${assignment.assignmentName}":`, error)
          results.failed.push({
            subjectExternalId,
            assignmentName: assignment.assignmentName,
            error: error.message
          })
        }
      }
    } catch (error) {
      Logger.error(`Error syncing assignments for subject ${subjectExternalId}:`, error)
      // Mark all assignments as failed
      assignments.forEach(assignment => {
        results.failed.push({
          subjectExternalId,
          assignmentName: assignment.assignmentName,
          error: error.message
        })
      })
    }

    return results
  }

  /**
   * Get existing journal entries from Tahvel
   */
  async getExistingJournalEntries(journalId) {
    try {
      // Use the same endpoint as shown in getjournals.txt
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        { cache: false } // Don't cache during sync to get fresh data
      )

      if (Array.isArray(response)) {
        Logger.debug(`Retrieved ${response.length} existing entries for journal ${journalId}`)
        return response
      }

      Logger.warning(`Unexpected response format from journalEntriesByDate: ${typeof response}`)
      return []
    } catch (error) {
      Logger.error(`Error getting existing entries for journal ${journalId}:`, error)
      return []
    }
  }

  /**
   * Check if an assignment already exists in Tahvel
   */
  assignmentExists(assignment, existingEntries) {
    if (!existingEntries || !Array.isArray(existingEntries)) {
      return false
    }

    // Check by name and entry type
    const exists = existingEntries.some(
      entry => entry.nameEt === assignment.assignmentName && entry.entryType === this.getEntryTypeFromAssignment(assignment)
    )

    return exists
  }

  /**
   * Get Tahvel entry type based on assignment data
   */
  getEntryTypeFromAssignment(assignment) {
    // Check if Kriit provided an entry type
    if (assignment && assignment.assignmentEntryType) {
      return assignment.assignmentEntryType
    }

    // Default to independent work (Iseseisev töö) if not specified
    return 'SISSEKANNE_I'
  }

  /**
   * Create a new assignment in Tahvel
   */
  async createAssignmentInTahvel(journalId, assignment) {
    try {
      // Build the request payload based on the example in postentry.txt
      // Build homework text: include instructions and append any assignment link provided by Kriit
      const buildHomeworkText = (instructions, link) => {
        const instr = instructions ? String(instructions).trim() : ''
        const l = link ? String(link).trim() : ''
        if (instr && l) return `${instr}\n\n${l}`
        if (l) return l
        return instr
      }

      // Try to include the journal's teacher id so the created entry has a teacher
      let journalEntryTeachers = []
      try {
        const journalInfo = await this.api.tahvel.get(`/journals/${journalId}`)
        if (journalInfo && journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
          const t = journalInfo.journalTeachers[0]
          if (t && typeof t.id !== 'undefined') {
            journalEntryTeachers = [String(t.id)]
            Logger.debug(`Adding journal teacher ${t.id} to created assignment payload for journal ${journalId}`)
          }
        }
      } catch (err) {
        Logger.warning(`Could not fetch journal info for ${journalId} to populate teacher: ${err.message}`)
      }

      // Get entry type and set capacity types accordingly
      const entryType = this.getEntryTypeFromAssignment(assignment)
      let journalEntryCapacityTypes = []
      if (entryType === 'SISSEKANNE_I') {
        journalEntryCapacityTypes = ['MAHT_i']
      } else if (entryType === 'SISSEKANNE_H') {
        journalEntryCapacityTypes = ['MAHT_h']
      } else if (entryType === 'SISSEKANNE_P') {
        journalEntryCapacityTypes = ['MAHT_p']
      }

      const payload = {
        // Keep `startLessonNr` present for Tahvel; always send null here (simplified)
        startLessonNr: null,
        // If Kriit provided lesson info, pass lessons through; otherwise leave null
        lessons: typeof assignment.lessons !== 'undefined' && assignment.lessons !== null ? Number(assignment.lessons) : null,
        entryType: entryType,
        nameEt: assignment.assignmentName,
        studyPeriodEvent: null,
        entryDate: this.formatDateForTahvel(assignment.assignmentEntryDate),
        homework: buildHomeworkText(assignment.assignmentInstructions, assignment.assignmentLink),
        homeworkDuedate: this.formatDateForTahvel(assignment.assignmentDueAt),
        journalOmoduleTheme: null,
        journalEntryStudents: [],
        journalEntryCapacityTypes: journalEntryCapacityTypes,
        journalEntryTeachers: journalEntryTeachers
      }

      Logger.debug(`Creating assignment payload:`, payload)

      const response = await this.api.tahvel.post(`/journals/${journalId}/journalEntry`, payload, { cache: false })

      // Raw response is logged via Logger.debug above
      Logger.debug(`Raw Tahvel POST response for journal ${journalId}:`, response)

      if (response) {
        Logger.debug(`Assignment created successfully in journal ${journalId}`)
        // If Tahvel returns an id in the POST response, surface it in the returned object
        if (response.id) {
          Logger.debug(`Tahvel created entry ID returned in POST response: ${response.id}`)
        }
        return { success: true, response }
      } else {
        return { success: false, error: 'No response received from Tahvel' }
      }
    } catch (error) {
      Logger.error(`Error creating assignment in Tahvel:`, error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Format date for Tahvel API (ISO string format)
   */
  formatDateForTahvel(dateString) {
    if (!dateString) return null

    try {
      // If it's already in ISO format, return as-is
      if (typeof dateString === 'string' && dateString.includes('T')) {
        return dateString
      }

      // Convert date to ISO format
      const date = new Date(dateString)
      if (isNaN(date.getTime())) return null

      return date.toISOString()
    } catch (error) {
      Logger.warning(`Error formatting date ${dateString}:`, error)
      return null
    }
  }

  /**
   * Get external ID of a newly created assignment
   */
  async getCreatedAssignmentExternalId(journalId, assignment) {
    try {
      Logger.debug(`🔍 Looking for external ID of created assignment "${assignment.assignmentName}" in journal ${journalId}`)

      // Wait a moment for the assignment to be fully created
      Logger.debug('⏳ Waiting 1 second for assignment to be fully created...')
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Get fresh entries from Tahvel
      Logger.debug('📥 Fetching fresh entries from Tahvel...')
      const entries = await this.getExistingJournalEntries(journalId)
      Logger.debug(`📝 Retrieved ${entries.length} entries from Tahvel`)

      const expectedEntryType = this.getEntryTypeFromAssignment(assignment)
      Logger.debug(`🎯 Looking for assignment with name "${assignment.assignmentName}" and type "${expectedEntryType}"`)

      // Find the newly created assignment by name and entry type
      const createdEntry = entries.find(entry => entry.nameEt === assignment.assignmentName && entry.entryType === expectedEntryType)

      if (createdEntry && createdEntry.id) {
        Logger.debug(`✅ Found created assignment with external ID: ${createdEntry.id}`)
        Logger.debug('Assignment details:', {
          id: createdEntry.id,
          nameEt: createdEntry.nameEt,
          entryType: createdEntry.entryType,
          entryDate: createdEntry.entryDate
        })
        return createdEntry.id
      }

      Logger.error(`❌ Could not find created assignment "${assignment.assignmentName}" in journal ${journalId}`)
      Logger.debug(
        'Available assignments in journal:',
        entries.map(e => ({
          id: e.id,
          nameEt: e.nameEt,
          entryType: e.entryType,
          entryDate: e.entryDate
        }))
      )

      return null
    } catch (error) {
      Logger.error(`💥 Error getting external ID for created assignment:`, error)
      return null
    }
  }

  /**
   * Test function to manually send external ID to Kriit
   * Can be called from browser console for debugging
   */
  async testSendExternalId(kriitAssignmentId, tahvelExternalId) {
    try {
      Logger.debug(`🧪 TEST: Sending external ID ${tahvelExternalId} for Kriit assignment ${kriitAssignmentId}`)

      const payload = {
        assignmentId: kriitAssignmentId,
        assignmentExternalId: tahvelExternalId,
        systemId: 1
      }

      Logger.debug('🧪 TEST: Payload:', payload)

      const response = await this.api.kriit.post('/assignments/setAssignmentExternalId', payload)

      Logger.debug('🧪 TEST: Response:', response)

      if (response && response.status === 200) {
        Logger.debug('🧪 TEST: ✅ Success!')
      } else {
        Logger.error('🧪 TEST: ❌ Failed!')
      }

      return response
    } catch (error) {
      Logger.error('🧪 TEST: 💥 Error:', error)
      throw error
    }
  }

  /**
   * Send external IDs back to Kriit
   */
  async sendExternalIdsToKriit(successfulSyncs) {
    try {
      Logger.debug(`🔄 Starting to send ${successfulSyncs.length} external IDs back to Kriit`)

      let successCount = 0
      let failureCount = 0

      // Send individual requests for each assignment
      for (const sync of successfulSyncs) {
        try {
          // Build the payload for this specific assignment
          const payload = {
            assignmentId: sync.kriitAssignmentId,
            assignmentExternalId: sync.tahvelExternalId,
            systemId: 1 // Default system ID for Tahvel
          }

          Logger.debug(`📤 Sending external ID for Kriit assignment ${sync.kriitAssignmentId} → Tahvel ID ${sync.tahvelExternalId}`)
          Logger.debug(`Payload:`, payload)

          // Send individual POST request
          const response = await this.api.kriit.post('/assignments/setAssignmentExternalId', payload)

          Logger.debug(`Response received:`, response)

          if (response && response.status === 200) {
            successCount++
            Logger.debug(`✅ Successfully set external ID for assignment ${sync.kriitAssignmentId}`)
          } else {
            failureCount++
            Logger.warning(`❌ Unexpected response for assignment ${sync.kriitAssignmentId}:`, response)
          }
        } catch (error) {
          failureCount++
          Logger.error(`💥 Error setting external ID for assignment ${sync.kriitAssignmentId}:`, error)
          Logger.error(`Error details:`, {
            message: error.message,
            stack: error.stack,
            payload: {
              assignmentId: sync.kriitAssignmentId,
              assignmentExternalId: sync.tahvelExternalId,
              systemId: 1
            }
          })
        }
      }

      // After sending external IDs, remove those assignments from runtime cache so the banner updates
      try {
        if (typeof window !== 'undefined' && window.journalListSync && window.journalListSync.newAssignments) {
          for (const sync of successfulSyncs) {
            const kriitId = String(sync.kriitAssignmentId)
            for (const subjectId of Object.keys(window.journalListSync.newAssignments)) {
              const arr = window.journalListSync.newAssignments[subjectId] || []
              const filtered = arr.filter(a => String(a.createdAssignmentId) !== kriitId)
              if (filtered.length !== arr.length) {
                if (filtered.length > 0) {
                  window.journalListSync.newAssignments[subjectId] = filtered
                } else {
                  delete window.journalListSync.newAssignments[subjectId]
                }
              }
            }
          }

          if (Object.keys(window.journalListSync.newAssignments || {}).length === 0) {
            window.journalListSync.newAssignments = {}
          }
          Logger.debug('Updated runtime newAssignments cache after sending external IDs')
        }
      } catch (err) {
        Logger.debug('Failed to update runtime newAssignments cache:', err)
      }

      if (successCount > 0) {
        Logger.debug(`✨ Successfully sent ${successCount} external IDs to Kriit`)
      }
      if (failureCount > 0) {
        Logger.error(`⚠️ Failed to send ${failureCount} external IDs to Kriit`)
      }

      Logger.debug(`📊 External ID sync summary: ${successCount} success, ${failureCount} failed`)
    } catch (error) {
      Logger.error('💥 Critical error in sendExternalIdsToKriit:', error)
    }
  }

  /**
   * Resolve journal from DOM element (simplified version from JournalListSync)
   */
  resolveJournalFromElement(el) {
    if (!el) return null

    // If it's an anchor
    if (el.tagName && el.tagName.toLowerCase() === 'a') {
      const href = el.getAttribute('href') || el.getAttribute('ng-href') || ''
      const idMatch = String(href).match(/\/journal\/(\d+)/)
      if (idMatch && idMatch[1]) return { href, id: parseInt(idMatch[1], 10) }
    }

    // Walk up to find anchor
    let parent = el
    while (parent && parent !== document.body) {
      if (parent.tagName && parent.tagName.toLowerCase() === 'a') {
        return this.resolveJournalFromElement(parent)
      }
      parent = parent.parentNode
    }

    // Check data attributes
    if (el.dataset && el.dataset.journalId) {
      return { href: null, id: parseInt(el.dataset.journalId, 10) }
    }

    return null
  }
}

// Create and export instance
export const tahvelNewAssignmentSync = new TahvelNewAssignmentSyncFeature()

// Make it globally available for debugging
if (typeof window !== 'undefined') {
  window.tahvelNewAssignmentSync = tahvelNewAssignmentSync
}

export default TahvelNewAssignmentSyncFeature
