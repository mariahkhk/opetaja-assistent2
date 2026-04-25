/**
 * Features Registry - Import-based feature loading with organized structure
 */
import Logger from '../services/Logger.js'

/**
 * Provides a structured approach to loading features
 * @returns {Promise<Array>} Array of all features
 */
export async function loadFeatures() {
  Logger.debug('Loading features...')

  // Check if Kriit is enabled
  const kriitEnabled = await new Promise(resolve => {
    chrome.storage.local.get(['OA_kriitEnabled'], result => {
      resolve(result['OA_kriitEnabled'] === true)
    })
  })

  Logger.debug(`Kriit support is ${kriitEnabled ? 'enabled' : 'disabled'}`)

  // Define all available features - load them conditionally
  const allAvailableFeatures = {
    header: [],
    journalList: [],
    singleJournal: [] // TODO: Add features when implemented
  }

  // Only import and instantiate features that should be loaded
  if (kriitEnabled) {
    // Import Kriit-dependent features only when Kriit is enabled
    try {
      const { journalListSync } = await import('../features/journalList/JournalListSync.js')
      allAvailableFeatures.journalList.push(journalListSync)
      Logger.debug('Feature "journalListSync" created')
    } catch (error) {
      Logger.error('Error loading journalListSync feature:', error)
    }

    // Import Tahvel New Assignment Sync feature
    try {
      const { tahvelNewAssignmentSync } = await import('../features/journalList/TahvelNewAssignmentSync.js')
      allAvailableFeatures.journalList.push(tahvelNewAssignmentSync)
      Logger.debug('Feature "tahvelNewAssignmentSync" created')
    } catch (error) {
      Logger.error('Error loading tahvelNewAssignmentSync feature:', error)
    }

    // Import Header Sync Button feature
    try {
      const HeaderSyncButtonFeature = (await import('../features/header/HeaderSyncButtonFeature.js')).default
      const headerSyncButtonFeature = new HeaderSyncButtonFeature()
      allAvailableFeatures.header.push(headerSyncButtonFeature)
      Logger.debug('Feature "HeaderSyncButtonFeature" created')
    } catch (error) {
      Logger.error('Error loading HeaderSyncButtonFeature:', error)
    }

    // TODO: Import other Kriit-dependent features when implemented
  } else {
    Logger.debug('Skipping Kriit-dependent features because Kriit is disabled')
  }

  // Load non-Kriit features here (they should always be loaded)

  // Load timetable discrepancy detection feature with button (always enabled)
  try {
    const TimetableDiscrepancyDetectionFeature = (await import('../features/header/TimetableDiscrepancyDetectionFeature.js')).default
    const timetableDiscrepancyDetectionFeature = new TimetableDiscrepancyDetectionFeature()
    allAvailableFeatures.header.push(timetableDiscrepancyDetectionFeature)
    Logger.debug('Feature "TimetableDiscrepancyDetectionFeature" created')
  } catch (error) {
    Logger.error('Error loading TimetableDiscrepancyDetectionFeature:', error)
  }

  // Load lesson count warning feature (always enabled)
  try {
    const LessonCountWarningFeature = (await import('../features/journalList/lessonCountWarning/LessonCountWarningFeature.js')).default
    const lessonCountWarningFeature = new LessonCountWarningFeature()
    allAvailableFeatures.journalList.push(lessonCountWarningFeature)
    Logger.debug('Feature "LessonCountWarningFeature" created')
  } catch (error) {
    Logger.error('Error loading LessonCountWarningFeature:', error)
  }

  // Load final grade warning feature (always enabled)
  try {
    const FinalGradeWarningFeature = (await import('../features/journalList/finalGradeWarning/FinalGradeWarningFeature.js')).default
    const finalGradeWarningFeature = new FinalGradeWarningFeature()
    allAvailableFeatures.journalList.push(finalGradeWarningFeature)
    Logger.debug('Feature "FinalGradeWarningFeature" created')
  } catch (error) {
    Logger.error('Error loading FinalGradeWarningFeature:', error)
  }

  // Load lesson discrepancies feature (always enabled)
  try {
    const LessonDiscrepanciesFeature = (await import('../features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js')).default
    const lessonDiscrepanciesFeature = new LessonDiscrepanciesFeature()
    allAvailableFeatures.singleJournal.push(lessonDiscrepanciesFeature)
    Logger.debug('Feature "LessonDiscrepanciesFeature" created')
  } catch (error) {
    Logger.error('Error loading LessonDiscrepanciesFeature:', error)
  }
  // Load last lesson notification feature (always enabled)
  try {
    const LastLessonNotificationFeature = (await import('../features/singleJournal/lastLessonNotification/LastLessonNotificationFeature.js')).default
    const lastLessonNotificationFeature = new LastLessonNotificationFeature()
    allAvailableFeatures.singleJournal.push(lastLessonNotificationFeature)
    Logger.debug('Feature "LastLessonNotificationFeature" created')
  } catch (error) {
    Logger.error('Error loading LastLessonNotificationFeature:', error)
  }
  // Load highlight missing grades feature (always enabled)
  try {
    const HighlightMissingGradesFeature = (await import('../features/singleJournal/highlightMissingGrades/HighlightMissingGradesFeature.js')).default
    const highlightMissingGradesFeature = new HighlightMissingGradesFeature()
    allAvailableFeatures.singleJournal.push(highlightMissingGradesFeature)
    Logger.debug('Feature "HighlightMissingGradesFeature" created')
  } catch (error) {
    Logger.error('Error loading HighlightMissingGradesFeature:', error)
  }

  // Load journal grade cell highlighting feature (always enabled)
  try {
    const HighlightGradeCellsFeature = (await import('../features/singleJournal/highlightGradeCells/HighlightGradeCellsFeature.js')).default
    const highlightGradeCellsFeature = new HighlightGradeCellsFeature()
    allAvailableFeatures.singleJournal.push(highlightGradeCellsFeature)
    Logger.debug('Feature "HighlightGradeCellsFeature" created')
  } catch (error) {
    Logger.error('Error loading HighlightGradeCellsFeature:', error)
  }

  // Load highlight final grades feature (always enabled)
  try {
    const HighlightFinalGradesFeature = (await import('../features/singleJournal/highlightFinalGrades/HighlightFinalGradesFeature.js')).default
    const highlightFinalGradesFeature = new HighlightFinalGradesFeature()
    allAvailableFeatures.singleJournal.push(highlightFinalGradesFeature)
    Logger.debug('Feature "HighlightFinalGradesFeature" created')
  } catch (error) {
    Logger.error('Error loading HighlightFinalGradesFeature:', error)
  }

  // Load final grades by outcomes feature (always enabled)
  try {
    const FinalGradesManagementFeature = (await import('../features/singleJournal/addFinalGrades/FinalGradesManagementFeature.js')).default
    const finalGradesManagementFeature = new FinalGradesManagementFeature()
    allAvailableFeatures.singleJournal.push(finalGradesManagementFeature)
    Logger.debug('Feature "FinalGradesManagementFeature" created')
  } catch (error) {
    Logger.error('Error loading FinalGradesManagementFeature:', error)
  }

  // Create a copy of the features structure for returning
  const featureGroups = {
    header: [...allAvailableFeatures.header],
    journalList: [...allAvailableFeatures.journalList],
    singleJournal: [...allAvailableFeatures.singleJournal]
  }

  // Flatten all features into a single array
  const allFeatures = Object.values(featureGroups).flat()

  // Log loaded features
  for (const feature of allFeatures) {
    Logger.debug(`Loaded feature: ${feature.name}`)
  }

  Logger.debug(`Loaded ${allFeatures.length} feature(s)`)
  return allFeatures
}
