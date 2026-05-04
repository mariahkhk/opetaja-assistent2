import { describe, it, expect, mock } from 'bun:test'
import {
  getCurrentStudyYearText,
  getStudyYearsEndpoint,
  getWeekIndex,
  resolveCurrentStudyYearId,
  resolveLessonPlanDate,
  resolveStudyYearIdFromText
} from '../../src/lib/studyYear.js'

describe('studyYear helpers', () => {
  describe('getCurrentStudyYearText', () => {
    it('returns previous-year/current-year for spring dates (Jan-Aug)', () => {
      expect(getCurrentStudyYearText(new Date('2026-01-15T00:00:00Z'))).toBe('2025/2026')
      expect(getCurrentStudyYearText(new Date('2026-04-30T12:00:00Z'))).toBe('2025/2026')
      expect(getCurrentStudyYearText(new Date('2026-08-15T12:00:00Z'))).toBe('2025/2026')
    })

    it('returns current-year/next-year for autumn dates (Sep-Dec)', () => {
      expect(getCurrentStudyYearText(new Date('2026-09-02T12:00:00Z'))).toBe('2026/2027')
      expect(getCurrentStudyYearText(new Date('2026-12-31T23:59:00Z'))).toBe('2026/2027')
    })

    it('treats August as the final spring month and September as the first autumn month', () => {
      expect(getCurrentStudyYearText(new Date('2026-08-01T00:00:00Z'))).toBe('2025/2026')
      expect(getCurrentStudyYearText(new Date('2026-09-01T00:00:00Z'))).toBe('2026/2027')
    })

    it('uses the current date when no argument is supplied', () => {
      const expected = getCurrentStudyYearText(new Date())
      expect(getCurrentStudyYearText()).toBe(expected)
      expect(expected).toMatch(/^\d{4}\/\d{4}$/)
    })
  })

  describe('getStudyYearsEndpoint', () => {
    it('returns the bare path when baseUrl already ends with /hois_back', () => {
      expect(getStudyYearsEndpoint({ tahvel: { baseUrl: 'https://tahvel.edu.ee/hois_back' } }))
        .toBe('/autocomplete/studyYears')
    })

    it('prefixes /hois_back when baseUrl does not end with it', () => {
      expect(getStudyYearsEndpoint({ tahvel: { baseUrl: 'https://tahvel.edu.ee' } }))
        .toBe('/hois_back/autocomplete/studyYears')
    })

    it('returns the prefixed path when api is missing or partial', () => {
      expect(getStudyYearsEndpoint(undefined)).toBe('/hois_back/autocomplete/studyYears')
      expect(getStudyYearsEndpoint(null)).toBe('/hois_back/autocomplete/studyYears')
      expect(getStudyYearsEndpoint({})).toBe('/hois_back/autocomplete/studyYears')
      expect(getStudyYearsEndpoint({ tahvel: {} })).toBe('/hois_back/autocomplete/studyYears')
      expect(getStudyYearsEndpoint({ tahvel: { baseUrl: '' } })).toBe('/hois_back/autocomplete/studyYears')
    })

    it('coerces non-string baseUrl values via String()', () => {
      const apiWithNumberLike = { tahvel: { baseUrl: { toString: () => 'https://example.com/hois_back' } } }
      expect(getStudyYearsEndpoint(apiWithNumberLike)).toBe('/autocomplete/studyYears')
    })
  })

  describe('resolveStudyYearIdFromText', () => {
    it('returns null without calling the API when yearText is falsy', async () => {
      const get = mock(async () => [])
      const api = { tahvel: { get } }

      await expect(resolveStudyYearIdFromText(api, '')).resolves.toBeNull()
      await expect(resolveStudyYearIdFromText(api, null)).resolves.toBeNull()
      await expect(resolveStudyYearIdFromText(api, undefined)).resolves.toBeNull()
      expect(get).not.toHaveBeenCalled()
    })

    it('resolves study year id using bare path when baseUrl ends with /hois_back', async () => {
      const get = mock(async () => [{ id: 727, nameEt: '2025/2026' }])
      const api = { tahvel: { baseUrl: 'https://tahvel.edu.ee/hois_back', get } }

      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBe(727)
      expect(get).toHaveBeenCalledWith(
        '/autocomplete/studyYears',
        {},
        expect.objectContaining({ cache: true, cacheExpiration: 24 * 60 * 60 * 1000 })
      )
    })

    it('resolves study year id with /hois_back prefix when baseUrl is missing the suffix', async () => {
      const get = mock(async () => [{ id: 727, nameEt: '2025/2026' }])
      const api = { tahvel: { baseUrl: 'https://tahvel.edu.ee', get } }

      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBe(727)
      expect(get).toHaveBeenCalledWith(
        '/hois_back/autocomplete/studyYears',
        {},
        expect.objectContaining({ cache: true })
      )
    })

    it('returns null when the year text is not in the response array', async () => {
      const api = { tahvel: { get: mock(async () => [{ id: 667, nameEt: '2024/2025' }]) } }
      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBeNull()
    })

    it('returns null when the API response is not an array', async () => {
      const objectApi = { tahvel: { get: mock(async () => ({ unexpected: true })) } }
      const nullApi = { tahvel: { get: mock(async () => null) } }
      const stringApi = { tahvel: { get: mock(async () => 'oops') } }

      await expect(resolveStudyYearIdFromText(objectApi, '2025/2026')).resolves.toBeNull()
      await expect(resolveStudyYearIdFromText(nullApi, '2025/2026')).resolves.toBeNull()
      await expect(resolveStudyYearIdFromText(stringApi, '2025/2026')).resolves.toBeNull()
    })

    it('returns null when the matching entry has no id', async () => {
      const api = { tahvel: { get: mock(async () => [{ nameEt: '2025/2026' }]) } }
      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBeNull()
    })

    it('returns null when the matching entry has id 0 (truthy guard)', async () => {
      const api = { tahvel: { get: mock(async () => [{ id: 0, nameEt: '2025/2026' }]) } }
      await expect(resolveStudyYearIdFromText(api, '2025/2026')).resolves.toBeNull()
    })
  })

  describe('resolveCurrentStudyYearId', () => {
    it('looks up the current academic year text against the API', async () => {
      const get = mock(async () => [
        { id: 667, nameEt: '2024/2025' },
        { id: 727, nameEt: '2025/2026' }
      ])
      const api = { tahvel: { get } }

      await expect(resolveCurrentStudyYearId(api, new Date('2026-04-30T12:00:00Z'))).resolves.toBe(727)
    })

    it('returns null when the current year is not in the API response', async () => {
      const api = { tahvel: { get: mock(async () => [{ id: 1, nameEt: '1999/2000' }]) } }
      await expect(resolveCurrentStudyYearId(api, new Date('2026-04-30T12:00:00Z'))).resolves.toBeNull()
    })

    it('falls back to today when no date is supplied', async () => {
      const expectedYearText = getCurrentStudyYearText(new Date())
      const get = mock(async () => [{ id: 999, nameEt: expectedYearText }])
      const api = { tahvel: { get } }

      await expect(resolveCurrentStudyYearId(api)).resolves.toBe(999)
    })
  })

  describe('getWeekIndex', () => {
    it('returns the index of the first non-null entry for position "first"', () => {
      expect(getWeekIndex([null, null, 2, null, 4], 'first')).toBe(2)
      expect(getWeekIndex([1, 2, 3], 'first')).toBe(0)
    })

    it('returns -1 for position "first" when every entry is null', () => {
      expect(getWeekIndex([null, null, null], 'first')).toBe(-1)
      expect(getWeekIndex([], 'first')).toBe(-1)
    })

    it('returns the index of the last non-null entry for position "last"', () => {
      expect(getWeekIndex([null, 2, null, 4, null], 'last')).toBe(3)
      expect(getWeekIndex([1, 2, 3], 'last')).toBe(2)
    })

    it('returns -1 for position "last" when every entry is null', () => {
      expect(getWeekIndex([null, null, null], 'last')).toBe(-1)
      expect(getWeekIndex([], 'last')).toBe(-1)
    })

    it('treats unknown positions the same as "last"', () => {
      expect(getWeekIndex([null, 2, null, 4], 'middle')).toBe(3)
      expect(getWeekIndex([null, null, null], 'middle')).toBe(-1)
    })
  })

  describe('resolveLessonPlanDate', () => {
    function makeApi(planData, yearText = getCurrentStudyYearText()) {
      return {
        tahvel: {
          get: mock(async url => {
            if (url.includes('autocomplete/studyYears')) {
              return [{ id: 727, nameEt: yearText }]
            }
            return planData
          })
        }
      }
    }

    it('returns the first and last lesson dates from MAHT_a weeks', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [null, 2, null, 4] } }],
        weekNrs: [10, 11, 12, 13],
        studyPeriods: [
          {
            weekNrs: [10, 11, 12, 13],
            weekBeginningDates: ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27']
          }
        ]
      })

      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBe('2026-04-13')
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'last')).resolves.toBe('2026-04-27')
    })

    it('returns null without fetching the plan when current study year cannot be resolved', async () => {
      const get = mock(async () => [{ id: 667, nameEt: '1900/1901' }])
      const api = { tahvel: { get } }

      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
      expect(get).toHaveBeenCalledTimes(1)
    })

    it('returns null when planData is null', async () => {
      const api = makeApi(null)
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when planData is missing journals', async () => {
      const api = makeApi({ studyPeriods: [{ weekNrs: [], weekBeginningDates: [] }] })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when planData is missing studyPeriods', async () => {
      const api = makeApi({ journals: [{ id: 12345, hours: { MAHT_a: [1] } }] })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when the journal id is not present in the plan', async () => {
      const api = makeApi({
        journals: [{ id: 999, hours: { MAHT_a: [1, 2] } }],
        weekNrs: [10, 11],
        studyPeriods: [{ weekNrs: [10, 11], weekBeginningDates: ['2026-04-06', '2026-04-13'] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when the journal has no hours', async () => {
      const api = makeApi({
        journals: [{ id: 12345 }],
        weekNrs: [10],
        studyPeriods: [{ weekNrs: [10], weekBeginningDates: ['2026-04-06'] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when journal hours has no MAHT_a array', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_p: [1] } }],
        weekNrs: [10],
        studyPeriods: [{ weekNrs: [10], weekBeginningDates: ['2026-04-06'] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when MAHT_a contains only nulls (weekIndex -1)', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [null, null, null] } }],
        weekNrs: [10, 11, 12],
        studyPeriods: [{ weekNrs: [10, 11, 12], weekBeginningDates: ['x', 'y', 'z'] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'last')).resolves.toBeNull()
    })

    it('returns null when the resolved weekIndex points to a missing weekNr', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [null, null, 3] } }],
        weekNrs: [10, 11],
        studyPeriods: [{ weekNrs: [10, 11], weekBeginningDates: ['2026-04-06', '2026-04-13'] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'last')).resolves.toBeNull()
    })

    it('falls through to null when no studyPeriod contains the matching weekNr', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [null, 2] } }],
        weekNrs: [10, 11],
        studyPeriods: [{ weekNrs: [99, 100], weekBeginningDates: ['2026-04-06', '2026-04-13'] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('returns null when matching period lacks weekBeginningDates entry', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [1, 2] } }],
        weekNrs: [10, 11],
        studyPeriods: [{ weekNrs: [10, 11] }]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBeNull()
    })

    it('continues searching when an earlier period matches weekNr but has no date', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [null, 2] } }],
        weekNrs: [10, 11],
        studyPeriods: [
          { weekNrs: [11], weekBeginningDates: [] },
          { weekNrs: [11], weekBeginningDates: ['2026-04-13'] }
        ]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'first')).resolves.toBe('2026-04-13')
    })

    it('returns the date from the second studyPeriod when the first does not contain the weekNr', async () => {
      const api = makeApi({
        journals: [{ id: 12345, hours: { MAHT_a: [null, 2] } }],
        weekNrs: [10, 20],
        studyPeriods: [
          { weekNrs: [10], weekBeginningDates: ['2026-01-05'] },
          { weekNrs: [20], weekBeginningDates: ['2026-04-13'] }
        ]
      })
      await expect(resolveLessonPlanDate(api, 12345, 4303, 'last')).resolves.toBe('2026-04-13')
    })

    it('passes the cache option to the lessonplans request', async () => {
      const planData = {
        journals: [{ id: 12345, hours: { MAHT_a: [1] } }],
        weekNrs: [10],
        studyPeriods: [{ weekNrs: [10], weekBeginningDates: ['2026-04-06'] }]
      }
      const api = makeApi(planData)

      await resolveLessonPlanDate(api, 12345, 4303, 'first')

      expect(api.tahvel.get).toHaveBeenCalledWith(
        '/lessonplans/byteacher/4303/727',
        {},
        expect.objectContaining({ cache: true, cacheExpiration: 24 * 60 * 60 * 1000 })
      )
    })
  })
})
