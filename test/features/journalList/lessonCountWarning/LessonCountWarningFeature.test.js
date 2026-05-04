import { describe, test, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreChromeMock, restoreGlobalDOM } from '../../../setup.js'
import LessonCountWarningFeature from '../../../../src/features/journalList/lessonCountWarning/LessonCountWarningFeature.js'
import { cacheService } from '../../../../src/services/CacheService.js'
import Logger from '../../../../src/services/Logger.js'

describe('LessonCountWarningFeature', () => {
  let feature
  let mockApi

  beforeEach(async () => {
    restoreChromeMock()
    if (!global.window || !global.window.location) {
      global.window = { location: { hostname: 'tahvel.edu.ee' } }
    }
    await cacheService.clearCache()

    mockApi = {
      tahvel: {
        get: mock(() =>
          Promise.resolve({
            id: 123,
            lessonHours: {
              totalUsedHours: 10,
              capacityHours: [
                { capacity: 'MAHT_a', usedHours: 9 },
                { capacity: 'MAHT_i', usedHours: 1 }
              ]
            }
          })
        )
      }
    }

    feature = new LessonCountWarningFeature()
    feature.api = mockApi
    feature.currentSchoolId = 9
    feature.currentTeacherId = 100
    feature.currentStudyYear = '2025/2026'
  })

  describe('getLessonCountFromCache', () => {
    const PROD_KEY = 'GET_https://tahvel.edu.ee/hois_back/journals/123'

    test('should extract MAHT_a usedHours from cached journal', async () => {
      await cacheService.set(PROD_KEY, {
        id: 123,
        lessonHours: {
          totalUsedHours: 10,
          capacityHours: [
            { capacity: 'MAHT_a', usedHours: 9 },
            { capacity: 'MAHT_i', usedHours: 1 }
          ]
        }
      }, 0, false)

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(9)
    })

    test('should exclude MAHT_i (independent work) from count', async () => {
      await cacheService.set(PROD_KEY, {
        id: 123,
        lessonHours: {
          totalUsedHours: 15,
          capacityHours: [
            { capacity: 'MAHT_a', usedHours: 10 },
            { capacity: 'MAHT_i', usedHours: 5 }
          ]
        }
      }, 0, false)

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(10)
    })

    test('should fallback to totalUsedHours if MAHT_a not found', async () => {
      await cacheService.set(PROD_KEY, {
        id: 123,
        lessonHours: {
          totalUsedHours: 12,
          capacityHours: [{ capacity: 'MAHT_i', usedHours: 12 }]
        }
      }, 0, false)

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(12)
    })

    test('should fetch from API if not in cache', async () => {
      const count = await feature.getLessonCountFromCache(123)

      expect(count).toBe(9)
      expect(mockApi.tahvel.get).toHaveBeenCalledWith('/journals/123', {}, { cache: true, cacheExpiration: expect.any(Number) })
    })

    test('should return null if cache and API fail', async () => {
      mockApi.tahvel.get = mock(() => Promise.reject(new Error('API Error')))

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(null)
    })

    test('should return null if lessonHours is missing', async () => {
      await cacheService.set(PROD_KEY, { id: 123 }, 0, false)

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(null)
    })

    test('should return null if capacityHours is missing', async () => {
      await cacheService.set(PROD_KEY, {
        id: 123,
        lessonHours: { totalUsedHours: 10 }
      }, 0, false)

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(null)
    })

    test('should detect test.tahvel environment', async () => {
      global.window = { location: { hostname: 'test.tahvel.eenet.ee' } }
      const TEST_KEY = 'GET_https://test.tahvel.eenet.ee/hois_back/journals/123'
      await cacheService.set(TEST_KEY, {
        id: 123,
        lessonHours: {
          capacityHours: [{ capacity: 'MAHT_a', usedHours: 5 }]
        }
      }, 0, false)

      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(5)
    })
  })

  describe('parseStudyYear', () => {
    test('should parse study year string to date range', () => {
      const result = feature.parseStudyYear('2025/2026')

      expect(result.from).toBe('2025-09-01T00:00:00.000Z')
      expect(result.thru).toBe('2026-08-31T23:59:59.999Z')
    })

    test('should handle different year formats', () => {
      const result = feature.parseStudyYear('2024/2025')

      expect(result.from).toBe('2024-09-01T00:00:00.000Z')
      expect(result.thru).toBe('2025-08-31T23:59:59.999Z')
    })

    test('should fallback to current year if parsing fails', () => {
      const result = feature.parseStudyYear('invalid-format')

      expect(result.from).toBeDefined()
      expect(result.thru).toBeDefined()
    })
  })

  describe('countPastLessons', () => {
    test('should count only past timetable events', () => {
      const now = new Date()
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)

      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const events = [
        { date: yesterday.toISOString() },
        { date: tomorrow.toISOString() },
        { date: yesterday.toISOString() }
      ]

      const count = feature.countPastLessons(events)

      expect(count).toBe(2) // Only yesterday's events
    })

    test('should not count today as past', () => {
      const today = new Date()

      const events = [{ date: today.toISOString() }]

      const count = feature.countPastLessons(events)

      expect(count).toBe(0)
    })

    test('should handle events without dates', () => {
      const events = [{ date: null }, { name: 'No date' }]

      const count = feature.countPastLessons(events)

      expect(count).toBe(0)
    })

    test('should handle empty events array', () => {
      const count = feature.countPastLessons([])

      expect(count).toBe(0)
    })
  })

  describe('extractJournalInfoFromRow', () => {
    test('should extract journal ID from href', () => {
      const mockLinkElement = {
        getAttribute: mock(() => '/journal/12345'),
        textContent: 'Test Journal',
        closest: mock(() => ({ nextElementSibling: null }))
      }
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'a[href*="/journal/"]') {
            return mockLinkElement
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.id).toBe(12345)
    })

    test('should extract journal ID from ng-href', () => {
      const mockLinkElement = {
        getAttribute: mock(attr => (attr === 'ng-href' ? '/journal/67890' : null)),
        textContent: 'Test Journal',
        closest: mock(() => ({ nextElementSibling: null }))
      }
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'a[href*="/journal/"]') {
            return mockLinkElement
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.id).toBe(67890)
    })

    test('should return null if no journal link found', () => {
      const mockRow = {
        querySelector: mock(() => null),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info).toBe(null)
    })

    test('should return null if no journal ID in href', () => {
      const mockLinkElement = {
        getAttribute: mock(() => '/invalid/path'),
        textContent: 'Test Journal',
        closest: mock(() => ({ nextElementSibling: null }))
      }
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'a[href*="/journal/"]') {
            return mockLinkElement
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info).toBe(null)
    })

    test('should extract teacher IDs from links', () => {
      const mockLinkElement = {
        getAttribute: mock(() => '/journal/123'),
        textContent: 'Test Journal',
        closest: mock(() => ({ nextElementSibling: null }))
      }
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'a[href*="/journal/"]') {
            return mockLinkElement
          }
          return null
        }),
        querySelectorAll: mock(selector => {
          if (selector === 'td') {
            return [
              {
                querySelectorAll: mock(() => [
                  {
                    getAttribute: mock(() => '/teacher/456'),
                    textContent: 'John Doe'
                  }
                ])
              }
            ]
          }
          return []
        })
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.teacherIds).toEqual([456])
      expect(info.teacherNames).toEqual(['John Doe'])
    })

    test('should extract teacher names from adjacent cell when no teacher links exist', () => {
      const mockTeacherCell = {
        textContent: 'Jaan Tamm, Mari Mets'
      }
      const mockLinkElement = {
        getAttribute: mock(() => '#/journal/999/edit'),
        textContent: 'Test Journal',
        closest: mock(() => ({ nextElementSibling: mockTeacherCell }))
      }
      const mockRow = {
        querySelector: mock(selector => {
          if (selector === 'a[href*="/journal/"]') {
            return mockLinkElement
          }
          return null
        }),
        querySelectorAll: mock(() => [])
      }

      const info = feature.extractJournalInfoFromRow(mockRow)

      expect(info.id).toBe(999)
      expect(info.teacherNames).toEqual(['Jaan Tamm', 'Mari Mets'])
      expect(info.teacherIds).toEqual([])
    })
  })

  describe('getTimetableLessons', () => {
    test('should fetch timetable events for journal', async () => {
      mockApi.tahvel.get = mock(() =>
        Promise.resolve({
          timetableEvents: [
            { journalId: 123, date: '2025-09-01' },
            { journalId: 456, date: '2025-09-02' },
            { journalId: 123, date: '2025-09-03' }
          ]
        })
      )

      const lessons = await feature.getTimetableLessons(123, [100])

      expect(lessons).toHaveLength(2)
      expect(lessons[0].journalId).toBe(123)
      expect(lessons[1].journalId).toBe(123)
    })

    test('should handle multiple teacher IDs', async () => {
      mockApi.tahvel.get = mock(() =>
        Promise.resolve({
          timetableEvents: [{ journalId: 123, date: '2025-09-01' }]
        })
      )

      await feature.getTimetableLessons(123, [100, 200, 300])

      expect(mockApi.tahvel.get).toHaveBeenCalledWith(
        expect.stringContaining('teachers=100,200,300'),
        {},
        expect.any(Object)
      )
    })

    test('should return empty array if no teacher IDs', async () => {
      const lessons = await feature.getTimetableLessons(123, [])

      expect(lessons).toEqual([])
    })

    test('should return empty array if timetableEvents is missing', async () => {
      mockApi.tahvel.get = mock(() => Promise.resolve({}))

      const lessons = await feature.getTimetableLessons(123, [100])

      expect(lessons).toEqual([])
    })

    test('should handle API errors gracefully', async () => {
      mockApi.tahvel.get = mock(() => Promise.reject(new Error('Network error')))

      const lessons = await feature.getTimetableLessons(123, [100])

      expect(lessons).toEqual([])
    })
  })

  describe('addWarningIndicator', () => {
    let dom
    let originalDocument

    beforeEach(() => {
      dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
      originalDocument = global.document
      global.document = dom.window.document
    })

    afterEach(() => {
      global.document = originalDocument
    })

    function makeLinkInDOM() {
      const cell = global.document.createElement('td')
      const link = global.document.createElement('a')
      link.href = '#/journal/123'
      link.textContent = 'Test Journal'
      cell.appendChild(link)
      global.document.body.appendChild(cell)
      return link
    }

    test('sets plural Estonian tooltip for multiple extra lessons', () => {
      const link = makeLinkInDOM()
      feature.addWarningIndicator(link, { journalId: 123, domCount: 13, timetableCount: 10 })
      const indicator = global.document.querySelector('.oa-warning-indicator')
      expect(indicator).not.toBeNull()
      expect(indicator.title).toBe('Päevikus on 3 liigset tundi')
      expect(indicator.textContent).toBe('📅')
    })

    test('sets singular Estonian tooltip for one extra lesson', () => {
      const link = makeLinkInDOM()
      feature.addWarningIndicator(link, { journalId: 123, domCount: 11, timetableCount: 10 })
      const indicator = global.document.querySelector('.oa-warning-indicator')
      expect(indicator.title).toBe('Päevikus on 1 liigne tund')
    })

    test('sets plural Estonian tooltip for multiple missing lessons', () => {
      const link = makeLinkInDOM()
      feature.addWarningIndicator(link, { journalId: 123, domCount: 8, timetableCount: 10 })
      const indicator = global.document.querySelector('.oa-warning-indicator')
      expect(indicator.title).toBe('Päevikus puudub 2 tundi')
    })

    test('sets singular Estonian tooltip for one missing lesson', () => {
      const link = makeLinkInDOM()
      feature.addWarningIndicator(link, { journalId: 123, domCount: 9, timetableCount: 10 })
      const indicator = global.document.querySelector('.oa-warning-indicator')
      expect(indicator.title).toBe('Päevikus puudub 1 tund')
    })

    test('wraps the link in a span with the indicator appended', () => {
      const link = makeLinkInDOM()
      feature.addWarningIndicator(link, { journalId: 123, domCount: 11, timetableCount: 10 })
      const wrapper = link.parentElement
      expect(wrapper.tagName).toBe('SPAN')
      expect(wrapper.children.length).toBe(2)
      expect(wrapper.children[0]).toBe(link)
      expect(wrapper.children[1].classList.contains('oa-warning-indicator')).toBe(true)
    })

    test('does not add a duplicate indicator when one already exists', () => {
      const link = makeLinkInDOM()
      feature.addWarningIndicator(link, { journalId: 123, domCount: 12, timetableCount: 10 })
      feature.addWarningIndicator(link, { journalId: 123, domCount: 12, timetableCount: 10 })
      const indicators = global.document.querySelectorAll('.oa-warning-indicator')
      expect(indicators.length).toBe(1)
    })
  })

  describe('getDefaultStudyYear', () => {
    test('should return current year if after August', () => {
      // Mock September (month 8)
      const originalDate = Date
      global.Date = class extends Date {
        constructor() {
          super()
          return new originalDate(2025, 8, 15) // September 15, 2025
        }
      }

      const studyYear = feature.getDefaultStudyYear()

      expect(studyYear).toBe('2025/2026')

      global.Date = originalDate
    })

    test('should return previous year if before August', () => {
      const originalDate = Date
      global.Date = class extends Date {
        constructor() {
          super()
          return new originalDate(2025, 6, 15) // July 15, 2025
        }
      }

      const studyYear = feature.getDefaultStudyYear()

      expect(studyYear).toBe('2024/2025')

      global.Date = originalDate
    })
  })
})

function buildJournalTable(rows = []) {
  const wrapper = document.createElement('div')
  wrapper.id = 'tahvelTable'
  const table = document.createElement('table')
  table.className = 'tahvel-table'
  const tbody = document.createElement('tbody')
  for (const r of rows) tbody.appendChild(r)
  table.appendChild(tbody)
  wrapper.appendChild(table)
  return wrapper
}

function buildRow({ journalId = 123, teacherId = null, teacherText = null, includeTeacherCell = true } = {}) {
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  const a = document.createElement('a')
  a.setAttribute('href', `#/journal/${journalId}/edit`)
  a.textContent = `Journal ${journalId}`
  td.appendChild(a)
  tr.appendChild(td)

  if (includeTeacherCell) {
    const teacherCell = document.createElement('td')
    if (teacherId) {
      const teacherLink = document.createElement('a')
      teacherLink.setAttribute('href', `#/teacher/${teacherId}`)
      teacherLink.textContent = `Teacher ${teacherId}`
      teacherCell.appendChild(teacherLink)
    } else if (teacherText) {
      teacherCell.textContent = teacherText
    }
    tr.appendChild(teacherCell)
  }
  return { tr, link: a }
}

describe("LessonCountWarningFeature - integration", () => {
  let feature

  beforeEach(() => {
    restoreGlobalDOM()
    feature = new LessonCountWarningFeature()
    feature.api = {
      tahvel: { get: mock(async () => null), post: mock() },
      kriit: { post: mock(), enabled: false, authToken: '' },
      _kriitInitPromise: null
    }
    feature.currentSchoolId = 9
    feature.currentTeacherId = 100
    feature.currentStudyYear = '2025/2026'
  })

  afterEach(() => {
    feature.onDeactivate()
  })

  describe('getCurrentUserInfo', () => {
    it('populates currentSchoolId and currentTeacherId from API', async () => {
      feature.api.tahvel.get = mock(async url => {
        if (url === '/user') return { person: { id: 555 } }
        return { school: { id: 7 } }
      })
      await feature.getCurrentUserInfo()
      expect(feature.currentTeacherId).toBe(555)
    })

    it('catches errors and leaves state untouched', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      feature.currentTeacherId = null
      await feature.getCurrentUserInfo()
      expect(feature.currentTeacherId).toBeNull()
    })
  })

  describe('getAllTeachers', () => {
    it('returns filtered list when school matches', async () => {
      feature.currentSchoolId = 9
      feature.api.tahvel.get = mock(async () => ({
        content: [
          { id: 1, name: 'A', school: { id: 9 } },
          { id: 2, name: 'B', school: { id: 8 } },
          { id: 3, name: 'C', school: { id: 9 } }
        ]
      }))
      const teachers = await feature.getAllTeachers()
      expect(teachers.map(t => t.id)).toEqual([1, 3])
    })

    it('returns empty array when schoolId missing', async () => {
      feature.currentSchoolId = null
      const result = await feature.getAllTeachers()
      expect(result).toEqual([])
    })

    it('returns empty array when API response has no content', async () => {
      feature.api.tahvel.get = mock(async () => ({}))
      const result = await feature.getAllTeachers()
      expect(result).toEqual([])
    })

    it('returns empty array on API error', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      const result = await feature.getAllTeachers()
      expect(result).toEqual([])
    })
  })

  describe('getCurrentStudyYear', () => {
    it('reads value from study year dropdown when present', () => {
      const dropdown = document.createElement('div')
      dropdown.setAttribute('ng-model', 'criteria.studyYear')
      const inner = document.createElement('div')
      inner.className = 'md-text'
      const span = document.createElement('span')
      span.textContent = '  2024/2025  '
      inner.appendChild(span)
      dropdown.appendChild(inner)
      document.body.appendChild(dropdown)

      const result = feature.getCurrentStudyYear()
      expect(result).toBe('2024/2025')
    })

    it('falls back to default study year when dropdown missing', () => {
      const result = feature.getCurrentStudyYear()
      expect(result).toMatch(/\d{4}\/\d{4}/)
    })

    it('falls back when document.querySelector throws', () => {
      const orig = document.querySelector
      document.querySelector = () => { throw new Error('boom') }
      const result = feature.getCurrentStudyYear()
      expect(result).toMatch(/\d{4}\/\d{4}/)
      document.querySelector = orig
    })
  })

  describe('getDefaultStudyYear', () => {
    it('returns previous-year/current-year for spring dates', () => {
      const original = global.Date
      global.Date = class extends original {
        constructor(...args) {
          if (args.length === 0) return new original(2026, 4, 1)
          return new original(...args)
        }
        static now() { return new original(2026, 4, 1).getTime() }
      }
      try {
        const result = feature.getDefaultStudyYear()
        expect(result).toBe('2025/2026')
      } finally {
        global.Date = original
      }
    })

    it('returns current-year/next-year for autumn dates', () => {
      const original = global.Date
      global.Date = class extends original {
        constructor(...args) {
          if (args.length === 0) return new original(2026, 10, 1)
          return new original(...args)
        }
        static now() { return new original(2026, 10, 1).getTime() }
      }
      try {
        const result = feature.getDefaultStudyYear()
        expect(result).toBe('2026/2027')
      } finally {
        global.Date = original
      }
    })
  })

  describe('parseStudyYear', () => {
    it('returns ISO date range for valid YYYY/YYYY format', () => {
      const range = feature.parseStudyYear('2024/2025')
      expect(range.from).toMatch(/^2024-09-01/)
      expect(range.thru).toMatch(/^2025-08-31/)
    })

    it('falls back to current year when parsing fails', () => {
      const range = feature.parseStudyYear('not-a-year')
      expect(range.from).toMatch(/^\d{4}-09-01/)
      expect(range.thru).toMatch(/^\d{4}-08-31/)
    })

    it('falls back when match throws', () => {
      // Trigger the catch branch by passing a value whose .match throws
      const odd = { match: () => { throw new Error('x') } }
      const range = feature.parseStudyYear(odd)
      expect(range.from).toMatch(/^\d{4}-09-01/)
    })
  })

  describe('countPastLessons', () => {
    it('counts only events strictly before today', () => {
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      const tomorrow = new Date(today)
      tomorrow.setDate(today.getDate() + 1)
      const events = [
        { date: yesterday.toISOString() },
        { date: today.toISOString() },
        { date: tomorrow.toISOString() },
        { /* no date */ }
      ]
      expect(feature.countPastLessons(events)).toBe(1)
    })

    it('returns 0 for empty list', () => {
      expect(feature.countPastLessons([])).toBe(0)
    })
  })

  describe('mapTeacherNamesToIds', () => {
    it('returns empty array for empty input', async () => {
      expect(await feature.mapTeacherNamesToIds([])).toEqual([])
      expect(await feature.mapTeacherNamesToIds(null)).toEqual([])
    })

    it('maps exact name matches to ids', async () => {
      feature.api.tahvel.get = mock(async () => ({
        content: [
          { id: 1, name: 'Alice', school: { id: 9 } },
          { id: 2, name: 'Bob', school: { id: 9 } }
        ]
      }))
      const result = await feature.mapTeacherNamesToIds(['Alice'])
      expect(result).toEqual([1])
    })

    it('falls back to partial matches', async () => {
      feature.api.tahvel.get = mock(async () => ({
        content: [
          { id: 1, name: 'Alice Cooper', school: { id: 9 } },
          { id: 2, name: 'Bob', school: { id: 9 } }
        ]
      }))
      const result = await feature.mapTeacherNamesToIds(['Alice'])
      expect(result).toEqual([1])
    })

    it('skips names with no match', async () => {
      feature.api.tahvel.get = mock(async () => ({
        content: [{ id: 1, name: 'Alice', school: { id: 9 } }]
      }))
      const result = await feature.mapTeacherNamesToIds(['Dave'])
      expect(result).toEqual([])
    })

    it('returns empty array when teacher list is empty', async () => {
      feature.api.tahvel.get = mock(async () => ({ content: [] }))
      const result = await feature.mapTeacherNamesToIds(['Alice'])
      expect(result).toEqual([])
    })

    it('returns empty array when teacher API fetch throws', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      const result = await feature.mapTeacherNamesToIds(['Alice'])
      expect(result).toEqual([])
    })
  })

  describe('extractJournalInfoFromRow', () => {
    it('returns null when no journal link in row', () => {
      const tr = document.createElement('tr')
      expect(feature.extractJournalInfoFromRow(tr)).toBeNull()
    })

    it('returns null when journal link href has no /journal/ id', () => {
      const tr = document.createElement('tr')
      const a = document.createElement('a')
      a.setAttribute('href', '/journal/abc')
      const td = document.createElement('td')
      td.appendChild(a)
      tr.appendChild(td)
      expect(feature.extractJournalInfoFromRow(tr)).toBeNull()
    })

    it('returns parsed info with teacher ids from teacher links', () => {
      const { tr } = buildRow({ journalId: 123, teacherId: 99 })
      const info = feature.extractJournalInfoFromRow(tr)
      expect(info.id).toBe(123)
      expect(info.teacherIds).toEqual([99])
      expect(info.teacherNames).toContain('Teacher 99')
    })

    it('extracts teacher names from text when no teacher links', () => {
      const { tr } = buildRow({
        journalId: 123,
        teacherText: 'Mart Teder, Liis Mets ja Anu Saar'
      })
      const info = feature.extractJournalInfoFromRow(tr)
      expect(info.teacherNames.length).toBe(3)
    })

    it('skips empty teacher text fragments', () => {
      const { tr } = buildRow({ journalId: 123, teacherText: ',  ;' })
      const info = feature.extractJournalInfoFromRow(tr)
      expect(info.teacherNames.length).toBe(0)
    })

    it('returns null when row.querySelector throws', () => {
      const tr = { querySelector: () => { throw new Error('boom') } }
      expect(feature.extractJournalInfoFromRow(tr)).toBeNull()
    })

    it('avoids duplicate teacher ids', () => {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      const a = document.createElement('a')
      a.setAttribute('href', '#/journal/123/edit')
      td.appendChild(a)
      tr.appendChild(td)

      const teacherCell = document.createElement('td')
      const t1 = document.createElement('a')
      t1.setAttribute('href', '#/teacher/55')
      t1.textContent = 'A'
      const t2 = document.createElement('a')
      t2.setAttribute('href', '#/teacher/55')
      t2.textContent = 'A'
      teacherCell.appendChild(t1)
      teacherCell.appendChild(t2)
      tr.appendChild(teacherCell)

      const info = feature.extractJournalInfoFromRow(tr)
      expect(info.teacherIds).toEqual([55])
    })
  })

  describe('getTimetableLessons', () => {
    it('returns [] when school id is missing', async () => {
      feature.currentSchoolId = null
      const result = await feature.getTimetableLessons(123, [4303])
      expect(result).toEqual([])
    })

    it('returns [] when no teacher ids supplied', async () => {
      const result = await feature.getTimetableLessons(123, [])
      expect(result).toEqual([])
    })

    it('returns events filtered to the journal id', async () => {
      feature.api.tahvel.get = mock(async () => ({
        timetableEvents: [
          { date: '2026-01-05', journalId: 123 },
          { date: '2026-01-06', journalId: 124 }
        ]
      }))
      const result = await feature.getTimetableLessons(123, [4303])
      expect(result).toHaveLength(1)
      expect(result[0].journalId).toBe(123)
    })

    it('returns [] when API response is missing timetableEvents', async () => {
      feature.api.tahvel.get = mock(async () => ({}))
      const result = await feature.getTimetableLessons(123, [4303])
      expect(result).toEqual([])
    })

    it('returns [] when API throws', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('net') })
      const result = await feature.getTimetableLessons(123, [4303])
      expect(result).toEqual([])
    })
  })

  describe('addWarningIndicator', () => {
    it('inserts indicator with "liigne tund" tooltip when domCount > timetable by 1', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      td.appendChild(a)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, { journalId: 1, domCount: 5, timetableCount: 4 })
      const indicator = td.querySelector('.oa-warning-indicator')
      expect(indicator.title).toBe('Päevikus on 1 liigne tund')
    })

    it('uses plural form when domCount > timetable by more than 1', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      td.appendChild(a)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, { journalId: 1, domCount: 7, timetableCount: 4 })
      expect(td.querySelector('.oa-warning-indicator').title).toBe('Päevikus on 3 liigset tundi')
    })

    it('uses "puudub 1 tund" when timetable exceeds by 1', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      td.appendChild(a)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, { journalId: 1, domCount: 4, timetableCount: 5 })
      expect(td.querySelector('.oa-warning-indicator').title).toBe('Päevikus puudub 1 tund')
    })

    it('uses "puudub N tundi" plural when timetable exceeds by more than 1', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      td.appendChild(a)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, { journalId: 1, domCount: 4, timetableCount: 7 })
      expect(td.querySelector('.oa-warning-indicator').title).toBe('Päevikus puudub 3 tundi')
    })

    it('does nothing when an indicator already exists in the parent', () => {
      const td = document.createElement('td')
      const a = document.createElement('a')
      const existing = document.createElement('span')
      existing.className = 'oa-warning-indicator'
      td.appendChild(a)
      td.appendChild(existing)
      document.body.appendChild(td)

      feature.addWarningIndicator(a, { journalId: 1, domCount: 5, timetableCount: 4 })
      const indicators = td.querySelectorAll('.oa-warning-indicator')
      expect(indicators).toHaveLength(1)
    })

    it('catches errors thrown by DOM operations', () => {
      const fakeLink = { get parentElement() { throw new Error('hostile parent') } }
      expect(() => feature.addWarningIndicator(fakeLink, { journalId: 1, domCount: 1, timetableCount: 0 }))
        .not.toThrow()
    })
  })

  describe('removeAllWarningIndicators', () => {
    it('unwraps indicators with link siblings', () => {
      const td = document.createElement('td')
      const wrapper = document.createElement('span')
      const link = document.createElement('a')
      const indicator = document.createElement('span')
      indicator.className = 'oa-warning-indicator'
      wrapper.appendChild(link)
      wrapper.appendChild(indicator)
      td.appendChild(wrapper)
      document.body.appendChild(td)

      feature.removeAllWarningIndicators()
      expect(td.querySelector('.oa-warning-indicator')).toBeNull()
      expect(td.querySelector('a')).toBe(link)
    })

    it('removes a lone indicator without sibling link', () => {
      const td = document.createElement('td')
      const wrapper = document.createElement('span')
      const indicator = document.createElement('span')
      indicator.className = 'oa-warning-indicator'
      wrapper.appendChild(indicator)
      td.appendChild(wrapper)
      document.body.appendChild(td)

      feature.removeAllWarningIndicators()
      expect(td.querySelector('.oa-warning-indicator')).toBeNull()
    })

    it('catches errors thrown by querySelectorAll', () => {
      const orig = document.querySelectorAll
      document.querySelectorAll = () => { throw new Error('hostile') }
      expect(() => feature.removeAllWarningIndicators()).not.toThrow()
      document.querySelectorAll = orig
    })
  })

  describe('findJournalRows', () => {
    it('returns array of rows when table exists', () => {
      const wrapper = buildJournalTable([
        document.createElement('tr'),
        document.createElement('tr')
      ])
      document.body.appendChild(wrapper)
      const rows = feature.findJournalRows()
      expect(rows.length).toBe(2)
    })

    it('returns empty array when no table', () => {
      const rows = feature.findJournalRows()
      expect(rows).toEqual([])
    })
  })

  describe('processJournalList', () => {
    it('returns early when already processing (no rows touched)', async () => {
      feature._isProcessing = true
      const wrapper = buildJournalTable([buildRow({ journalId: 1 }).tr])
      document.body.appendChild(wrapper)
      await feature.processJournalList()
      // No indicator added because feature short-circuited
      expect(wrapper.querySelector('.oa-warning-indicator')).toBeNull()
    })

    it('returns early when no rows present', async () => {
      await feature.processJournalList()
      expect(feature._isProcessing).toBe(false)
    })

    it('catches errors thrown synchronously by findJournalRows', async () => {
      const orig = document.querySelectorAll
      document.querySelectorAll = () => { throw new Error('hostile') }
      await expect(feature.processJournalList()).resolves.toBeUndefined()
      expect(feature._isProcessing).toBe(false)
      document.querySelectorAll = orig
    })
  })

  describe('processJournalRow', () => {
    it('returns when row has no journal link', async () => {
      const tr = document.createElement('tr')
      await feature.processJournalRow(tr)
      expect(feature.processedJournals.size).toBe(0)
    })

    it('skips already-processed journals', async () => {
      const { tr } = buildRow({ journalId: 1 })
      feature.processedJournals.add(1)
      let apiCallCount = 0
      feature.api.tahvel.get = mock(async () => { apiCallCount++; return null })
      await feature.processJournalRow(tr)
      expect(apiCallCount).toBe(0)
    })
  })

  describe('observers', () => {
    it('setupStudyYearObserver does nothing when dropdown missing', () => {
      feature.setupStudyYearObserver()
      expect(feature.studyYearObserver).toBeNull()
    })

    it('setupStudyYearObserver attaches observer when dropdown exists', () => {
      const dropdown = document.createElement('div')
      dropdown.setAttribute('ng-model', 'criteria.studyYear')
      const inner = document.createElement('div')
      inner.className = 'md-text'
      const span = document.createElement('span')
      span.textContent = '2024/2025'
      inner.appendChild(span)
      dropdown.appendChild(inner)
      document.body.appendChild(dropdown)

      feature.setupStudyYearObserver()
      expect(feature.studyYearObserver).toBeTruthy()
    })

    it('setupMainContentObserver does nothing when #tahvelTable missing', () => {
      feature.setupMainContentObserver()
      expect(feature.mainContentObserver).toBeNull()
    })

    it('setupMainContentObserver attaches observer when present', () => {
      document.body.appendChild(buildJournalTable())
      feature.setupMainContentObserver()
      expect(feature.mainContentObserver).toBeTruthy()
    })

    it('main observer clears processedJournals on relevant mutations', async () => {
      const wrapper = buildJournalTable()
      document.body.appendChild(wrapper)
      feature.api.tahvel.get = mock(async () => null)
      feature.processedJournals.add(99)
      feature.setupMainContentObserver()

      wrapper.querySelector('tbody').appendChild(document.createElement('tr'))
      await new Promise(r => setTimeout(r, 500))
      expect(feature.processedJournals.has(99)).toBe(false)
    })
  })

  describe('onActivate / onDeactivate', () => {
    it('runs the activation pipeline and stores the timer', async () => {
      feature.api.tahvel.get = mock(async () => ({ school: { id: 9 } }))
      await feature.onActivate()
      expect(feature._activateTimeout).not.toBeNull()
    })

    it('clears active timeouts on deactivate', () => {
      feature._activateTimeout = setTimeout(() => {}, 60000)
      feature._contentChangeTimeout = setTimeout(() => {}, 60000)
      feature._studyYearChangeTimeout = setTimeout(() => {}, 60000)
      feature.onDeactivate()
      expect(feature._activateTimeout).toBeNull()
      expect(feature._contentChangeTimeout).toBeNull()
      expect(feature._studyYearChangeTimeout).toBeNull()
    })

    it('disconnects observers and resets state', () => {
      feature.studyYearObserver = { disconnect: mock() }
      feature.mainContentObserver = { disconnect: mock() }
      feature.processedJournals.add(1)
      feature.onDeactivate()
      expect(feature.studyYearObserver).toBeNull()
      expect(feature.mainContentObserver).toBeNull()
      expect(feature.processedJournals.size).toBe(0)
    })
  })

  describe('getLessonCountFromCache — additional branches', () => {
    it('uses test.tahvel.eenet.ee base when on test environment', async () => {
      const originalWindow = global.window
      global.window = { location: { hostname: 'test.tahvel.eenet.ee' } }
      try {
        feature.api.tahvel.get = mock(async () => ({
          lessonHours: { capacityHours: [{ capacity: 'MAHT_a', usedHours: 7 }] }
        }))
        const count = await feature.getLessonCountFromCache(123)
        expect(count).toBe(7)
      } finally {
        global.window = originalWindow
      }
    })

    it('returns null when API throws', async () => {
      feature.api.tahvel.get = mock(async () => { throw new Error('boom') })
      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBeNull()
    })

    it('falls back to totalUsedHours when no MAHT_a', async () => {
      await cacheService.set('GET_https://tahvel.edu.ee/hois_back/journals/123', {
        lessonHours: {
          totalUsedHours: 12,
          capacityHours: [{ capacity: 'MAHT_i', usedHours: 4 }]
        }
      }, 0, false)
      const count = await feature.getLessonCountFromCache(123)
      expect(count).toBe(12)
    })
  })
})
