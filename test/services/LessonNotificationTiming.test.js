import { test, expect } from 'bun:test'
import { DEFAULT_LESSON_TIMING, validateLessonTiming, lessonNotificationAt, lessonNotificationDates } from '../../src/services/LessonNotificationTiming.js'

const block = { start: 10000000, end: 13600000 }
test('defaults to the real block end and supports all four timing combinations', () => {
  expect(lessonNotificationAt(block)).toBe(block.end)
  for (const reference of ['start', 'end']) {
    for (const direction of ['before', 'after']) {
      const timing = validateLessonTiming({ reference, direction, minutes: 10 })
      expect(lessonNotificationAt(block, timing)).toBe(block[reference] + (direction === 'before' ? -600000 : 600000))
      expect(lessonNotificationAt(block, { ...timing, minutes: 0 })).toBe(block[reference])
    }
  }
})

test('planning includes adjacent days for offsets across Tallinn midnight', () => {
  const now = Date.parse('2026-09-14T20:55:00Z')
  expect(lessonNotificationDates({ reference: 'start', direction: 'before', minutes: 10 }, now)).toEqual(['2026-09-14', '2026-09-15'])
  expect(lessonNotificationDates({ reference: 'end', direction: 'after', minutes: 1440 }, now)).toEqual(['2026-09-14', '2026-09-13'])
})

test('rejects malformed, negative, fractional, blank and unsafe offsets', () => {
  for (const minutes of [-1, 0.5, NaN, Infinity, '', '3', null, Number.MAX_SAFE_INTEGER]) {
    expect(() => validateLessonTiming({ ...DEFAULT_LESSON_TIMING, minutes })).toThrow()
  }
  expect(() => validateLessonTiming({ reference: 'middle', direction: 'after', minutes: 0 })).toThrow()
  expect(() => validateLessonTiming({ reference: 'end', direction: 'invalid', minutes: 0 })).toThrow()
})
