/**
 * Kriit Sync Notifier
 *
 * Handles notifying Kriit when grades have been successfully synced to Tahvel.
 * This allows Kriit to mark individual grades as synchronized and update the
 * "unsynced grades" warning banner count.
 */

import Logger from '../../services/Logger.js'

/**
 * Notify Kriit that specific student grades have been successfully synchronized to Tahvel
 * @param {Object} apiService - API service instance with kriit endpoint
 * @param {Array<Object>} grades - Array of grade objects with subjectExternalId, assignmentExternalId, studentPersonalCode
 * @returns {Promise<void>}
 */
export async function notifyKriitGradesSynced(apiService, grades) {
  if (!grades || grades.length === 0) {
    Logger.debug('No grades to mark as synchronized')
    return
  }

  // Wait for Kriit API settings to be loaded from chrome.storage
  if (apiService._kriitInitPromise) await apiService._kriitInitPromise

  // Check if Kriit integration is enabled
  if (!apiService.kriit || !apiService.kriit.enabled) {
    Logger.debug('Kriit integration is not enabled, skipping grade sync notification')
    return
  }

  try {
    Logger.debug(`🔔 Notifying Kriit that ${grades.length} grade(s) are synced:`, grades)

    const response = await apiService.kriit.post('/grades/markSynchronized', {
      grades: grades,
      systemId: 1 // Tahvel system ID
    })

    Logger.debug('Kriit API response:', response)

    if (response && response.success) {
      Logger.debug(`✅ Successfully marked ${response.affectedGrades} grade(s) as synchronized in Kriit`)
    } else {
      Logger.warning('Kriit sync confirmation returned unexpected response:', response)
    }
  } catch (error) {
    Logger.error('Failed to notify Kriit about grades sync completion:', error)
    // Don't throw - this is non-critical, grades are already in Tahvel
  }
}

/**
 * Build grade objects array from students data for Kriit notification
 * @param {string} journalId - Tahvel journal ID (subjectExternalId)
 * @param {string} assignmentId - Tahvel entry ID (assignmentExternalId)
 * @param {Array<Object>} students - Array of student objects with personalCode or userPersonalCode
 * @returns {Array<Object>} Array of grade objects ready for Kriit API
 */
export function buildGradesForNotification(journalId, assignmentId, students) {
  Logger.debug(`Building grades for notification: journalId=${journalId}, assignmentId=${assignmentId}, students:`, students)

  if (!students || !Array.isArray(students)) {
    Logger.debug('Built 0 grade(s) for notification: []')
    return []
  }

  const grades = students
    .filter(student => student != null) // Filter out null/undefined students first
    .map(student => ({
      subjectExternalId: String(journalId),
      assignmentExternalId: String(assignmentId),
      studentPersonalCode: student.personalCode || student.userPersonalCode || student.studentPersonalCode
    }))
    .filter(g => g.studentPersonalCode) // Only include grades with personal codes

  Logger.debug(`Built ${grades.length} grade(s) for notification:`, grades)

  return grades
}
