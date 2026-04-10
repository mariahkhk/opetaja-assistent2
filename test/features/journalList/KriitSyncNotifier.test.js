import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { notifyKriitGradesSynced, buildGradesForNotification } from '../../../src/features/journalList/KriitSyncNotifier.js'
import Logger from '../../../src/services/Logger.js'

describe('KriitSyncNotifier', () => {
  describe('buildGradesForNotification', () => {
    test('should build grades array with personalCode field', () => {
      const students = [{ personalCode: '39001010000' }, { personalCode: '39002020000' }, { personalCode: '39003030000' }]

      const result = buildGradesForNotification('12345', '123', students)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        subjectExternalId: '12345',
        assignmentExternalId: '123',
        studentPersonalCode: '39001010000'
      })
      expect(result[1]).toEqual({
        subjectExternalId: '12345',
        assignmentExternalId: '123',
        studentPersonalCode: '39002020000'
      })
      expect(result[2]).toEqual({
        subjectExternalId: '12345',
        assignmentExternalId: '123',
        studentPersonalCode: '39003030000'
      })
    })

    test('should handle userPersonalCode field as fallback', () => {
      const students = [{ userPersonalCode: '39001010000' }, { userPersonalCode: '39002020000' }]

      const result = buildGradesForNotification('12345', '123', students)

      expect(result).toHaveLength(2)
      expect(result[0].studentPersonalCode).toBe('39001010000')
      expect(result[1].studentPersonalCode).toBe('39002020000')
    })

    test('should handle studentPersonalCode field as fallback', () => {
      const students = [{ studentPersonalCode: '39001010000' }, { studentPersonalCode: '39002020000' }]

      const result = buildGradesForNotification('12345', '123', students)

      expect(result).toHaveLength(2)
      expect(result[0].studentPersonalCode).toBe('39001010000')
      expect(result[1].studentPersonalCode).toBe('39002020000')
    })

    test('should prioritize personalCode over other fields', () => {
      const students = [
        {
          personalCode: '39001010000',
          userPersonalCode: '39001010001',
          studentPersonalCode: '39001010002'
        }
      ]

      const result = buildGradesForNotification('12345', '123', students)

      expect(result[0].studentPersonalCode).toBe('39001010000')
    })

    test('should filter out students without personal codes', () => {
      const students = [
        { personalCode: '39001010000' },
        { name: 'John Doe' },
        { personalCode: '39002020000' },
        { id: 456 },
        { personalCode: null },
        { personalCode: undefined }
      ]

      const result = buildGradesForNotification('12345', '123', students)

      expect(result).toHaveLength(2)
      expect(result[0].studentPersonalCode).toBe('39001010000')
      expect(result[1].studentPersonalCode).toBe('39002020000')
    })

    test('should convert journal and assignment IDs to strings', () => {
      const students = [{ personalCode: '39001010000' }]

      const result = buildGradesForNotification(12345, 123, students)

      expect(result[0].subjectExternalId).toBe('12345')
      expect(result[0].assignmentExternalId).toBe('123')
      expect(typeof result[0].subjectExternalId).toBe('string')
      expect(typeof result[0].assignmentExternalId).toBe('string')
    })

    test('should handle empty student array', () => {
      const result = buildGradesForNotification('12345', '123', [])

      expect(result).toEqual([])
    })

    test('should handle null/undefined students array', () => {
      const resultNull = buildGradesForNotification('12345', '123', null)
      const resultUndefined = buildGradesForNotification('12345', '123', undefined)

      expect(resultNull).toEqual([])
      expect(resultUndefined).toEqual([])
    })

    test('should handle mixed valid and invalid student objects', () => {
      const students = [
        { personalCode: '39001010000', name: 'Student 1' },
        null,
        { personalCode: '39002020000', name: 'Student 2' },
        undefined,
        { name: 'Student Without Code' },
        { personalCode: '39003030000', name: 'Student 3' }
      ]

      const result = buildGradesForNotification('12345', '123', students)

      expect(result).toHaveLength(3)
      expect(result[0].studentPersonalCode).toBe('39001010000')
      expect(result[1].studentPersonalCode).toBe('39002020000')
      expect(result[2].studentPersonalCode).toBe('39003030000')
    })
  })

  describe('notifyKriitGradesSynced', () => {
    let apiService
    let postMock
    let loggerInfoMock
    let loggerDebugMock
    let loggerWarningMock
    let loggerErrorMock

    beforeEach(() => {
      postMock = mock(async (endpoint, data) => ({
        success: true,
        affectedGrades: data.grades.length,
        syncedGrades: data.grades,
        message: `Marked ${data.grades.length} grade(s) as synchronized`
      }))

      apiService = {
        kriit: {
          enabled: true,
          post: postMock
        }
      }

      loggerInfoMock = mock()
      loggerDebugMock = mock()
      loggerWarningMock = mock()
      loggerErrorMock = mock()

      Logger.info = loggerInfoMock
      Logger.debug = loggerDebugMock
      Logger.warning = loggerWarningMock
      Logger.error = loggerErrorMock
    })

    test('should call Kriit API with correct payload', async () => {
      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        },
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39002020000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(postMock).toHaveBeenCalledTimes(1)
      expect(postMock).toHaveBeenCalledWith('/grades/markSynchronized', {
        grades: grades,
        systemId: 1
      })
    })

    test('should log success when Kriit responds successfully', async () => {
      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(loggerDebugMock).toHaveBeenCalledWith(expect.stringContaining('🔔 Notifying Kriit that 1 grade(s) are synced:'), grades)
      expect(loggerDebugMock).toHaveBeenCalledWith(expect.stringContaining('✅ Successfully marked 1 grade(s) as synchronized in Kriit'))
    })

    test('should handle empty grades array', async () => {
      await notifyKriitGradesSynced(apiService, [])

      expect(postMock).not.toHaveBeenCalled()
      expect(loggerDebugMock).toHaveBeenCalledWith('No grades to mark as synchronized')
    })

    test('should handle null grades array', async () => {
      await notifyKriitGradesSynced(apiService, null)

      expect(postMock).not.toHaveBeenCalled()
      expect(loggerDebugMock).toHaveBeenCalledWith('No grades to mark as synchronized')
    })

    test('should handle undefined grades array', async () => {
      await notifyKriitGradesSynced(apiService, undefined)

      expect(postMock).not.toHaveBeenCalled()
      expect(loggerDebugMock).toHaveBeenCalledWith('No grades to mark as synchronized')
    })

    test('should skip notification when Kriit is disabled', async () => {
      apiService.kriit.enabled = false
      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(postMock).not.toHaveBeenCalled()
      expect(loggerDebugMock).toHaveBeenCalledWith('Kriit integration is not enabled, skipping grade sync notification')
    })

    test('should skip notification when Kriit API is not available', async () => {
      apiService.kriit = null
      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(loggerDebugMock).toHaveBeenCalledWith('Kriit integration is not enabled, skipping grade sync notification')
    })

    test('should handle API errors gracefully', async () => {
      const apiError = new Error('Network error')
      postMock = mock(async () => {
        throw apiError
      })
      apiService.kriit.post = postMock

      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await expect(notifyKriitGradesSynced(apiService, grades)).resolves.toBeUndefined()

      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to notify Kriit about grades sync completion:', apiError)
    })

    test('should not throw when API fails', async () => {
      postMock = mock(async () => {
        throw new Error('API failure')
      })
      apiService.kriit.post = postMock

      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await expect(notifyKriitGradesSynced(apiService, grades)).resolves.toBeUndefined()
    })

    test('should warn on unexpected response format', async () => {
      postMock = mock(async () => ({
        status: 'ok'
      }))
      apiService.kriit.post = postMock

      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(loggerWarningMock).toHaveBeenCalledWith('Kriit sync confirmation returned unexpected response:', { status: 'ok' })
    })

    test('should handle response with success false', async () => {
      postMock = mock(async () => ({
        success: false,
        message: 'Invalid grades'
      }))
      apiService.kriit.post = postMock

      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(loggerWarningMock).toHaveBeenCalledWith('Kriit sync confirmation returned unexpected response:', {
        success: false,
        message: 'Invalid grades'
      })
    })

    test('should handle multiple grades in single request', async () => {
      const grades = []
      for (let i = 0; i < 50; i++) {
        grades.push({
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: `3900${String(i).padStart(6, '0')}`
        })
      }

      await notifyKriitGradesSynced(apiService, grades)

      expect(postMock).toHaveBeenCalledTimes(1)
      expect(postMock).toHaveBeenCalledWith('/grades/markSynchronized', {
        grades: grades,
        systemId: 1
      })
      expect(loggerDebugMock).toHaveBeenCalledWith(expect.stringContaining('✅ Successfully marked 50 grade(s) as synchronized in Kriit'))
    })

    test('should include systemId in request', async () => {
      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      const callArgs = postMock.mock.calls[0]
      expect(callArgs[1].systemId).toBe(1)
    })

    test('should handle partial success response', async () => {
      postMock = mock(async () => ({
        success: true,
        affectedGrades: 2,
        failedGrades: 1,
        syncedGrades: [
          {
            subjectExternalId: '12345',
            assignmentExternalId: '123',
            studentPersonalCode: '39001010000'
          },
          {
            subjectExternalId: '12345',
            assignmentExternalId: '123',
            studentPersonalCode: '39002020000'
          }
        ],
        message: 'Partially synced'
      }))
      apiService.kriit.post = postMock

      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        },
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39002020000'
        },
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39003030000'
        }
      ]

      await notifyKriitGradesSynced(apiService, grades)

      expect(loggerDebugMock).toHaveBeenCalledWith(expect.stringContaining('✅ Successfully marked 2 grade(s) as synchronized in Kriit'))
    })
  })

  describe('Integration scenarios', () => {
    let apiService
    let postMock

    beforeEach(() => {
      postMock = mock(async (endpoint, data) => ({
        success: true,
        affectedGrades: data.grades.length,
        syncedGrades: data.grades
      }))

      apiService = {
        kriit: {
          enabled: true,
          post: postMock
        }
      }

      Logger.info = mock()
      Logger.debug = mock()
      Logger.warning = mock()
      Logger.error = mock()
    })

    test('should build grades from students and notify Kriit', async () => {
      const students = [
        { personalCode: '39001010000', name: 'Student 1' },
        { personalCode: '39002020000', name: 'Student 2' },
        { personalCode: '39003030000', name: 'Student 3' }
      ]

      const grades = buildGradesForNotification('12345', '123', students)
      await notifyKriitGradesSynced(apiService, grades)

      expect(grades).toHaveLength(3)
      expect(postMock).toHaveBeenCalledTimes(1)
      expect(postMock).toHaveBeenCalledWith('/grades/markSynchronized', {
        grades: expect.arrayContaining([
          expect.objectContaining({
            subjectExternalId: '12345',
            assignmentExternalId: '123',
            studentPersonalCode: '39001010000'
          })
        ]),
        systemId: 1
      })
    })

    test('should handle batch processing of multiple assignments', async () => {
      const assignment1Students = [{ personalCode: '39001010000' }, { personalCode: '39002020000' }]

      const assignment2Students = [{ personalCode: '39003030000' }, { personalCode: '39004040000' }]

      const grades1 = buildGradesForNotification('12345', '123', assignment1Students)
      const grades2 = buildGradesForNotification('12345', '124', assignment2Students)

      await notifyKriitGradesSynced(apiService, grades1)
      await notifyKriitGradesSynced(apiService, grades2)

      expect(postMock).toHaveBeenCalledTimes(2)
    })

    test('should skip notification when no valid students after filtering', async () => {
      const students = [{ name: 'Student Without Code' }, { id: 123 }, null, undefined]

      const grades = buildGradesForNotification('12345', '123', students)
      await notifyKriitGradesSynced(apiService, grades)

      expect(grades).toEqual([])
      expect(postMock).not.toHaveBeenCalled()
    })
  })
})
