import { describe, it, expect, mock } from 'bun:test'
import {
  getCurrentStudyYearText,
  resolveLessonPlanDate,
  resolveCurrentStudyYearId,
  resolveStudyYearIdFromText
} from '../../src/lib/studyYear.js'

describe('studyYear helpers', () => {
  describe('getCurrentStudyYearText', () => {
    it('returns current academic year text for spring dates', () => {
      expect(getCurrentStudyYearText(new Date('2026-04-30T12:00:00Z'))).toBe('2025/2026')
    })

    it('returns current academic year text for autumn dates', () => {
      expect(getCurrentStudyYearText(new Date('2026-09-02T12:00:00Z'))).toBe('2026/2027')
    })
  })

  describe('resolveStudyYearIdFromText', () => {
    it('resolves study year id using hois_back base url', async () => {
      const get = mock(async () => [{ id: 727, nameEt: '2025/2026' }])
      const api = { tahvel: { baseUrl: 'https://tahvel.edu.ee/hois_back', get } }

      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBe(727)
      expect(get).toHaveBeenCalledWith('/autocomplete/studyYears', {}, expect.objectContaining({ cache: true }))
    })

    it('resolves study year id using full hois_back path when base url has no suffix', async () => {
      const get = mock(async () => [{ id: 727, nameEt: '2025/2026' }])
      const api = { tahvel: { baseUrl: 'https://tahvel.edu.ee', get } }

      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBe(727)
      expect(get).toHaveBeenCalledWith('/hois_back/autocomplete/studyYears', {}, expect.objectContaining({ cache: true }))
    })

    it('returns null when year is not found', async () => {
      const api = { tahvel: { get: mock(async () => [{ id: 667, nameEt: '2024/2025' }]) } }
      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBeNull()
    })
  })

  describe('resolveCurrentStudyYearId', () => {
    it('resolves current study year id from API data', async () => {
      const api = {
        tahvel: {
          get: mock(async () => [
            { id: 667, nameEt: '2024/2025' },
            { id: 727, nameEt: '2025/2026' }
          ])
        }
      }

      await expect(resolveCurrentStudyYearId(api, new Date('2026-04-30T12:00:00Z'))).resolves.toBe(727)
    })
  })

  describe('resolveLessonPlanDate', () => {
    it('returns first and last lesson dates from MAHT_a weeks', async () => {
      const api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('autocomplete/studyYears')) {
              return [{ id: 727, nameEt: '2025/2026' }]
            }

            return {
              journals: [{ id: 12345, hours: { MAHT_a: [null, 2, null, 4] } }],
              weekNrs: [10, 11, 12, 13],
              studyPeriods: [
                {
                  weekNrs: [10, 11, 12, 13],
                  weekBeginningDates: ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27']
                }
              ]
            }
          })
        }
      }

      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBe('2026-04-13')
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'last')).resolves.toBe('2026-04-27')
    })
  })
})
