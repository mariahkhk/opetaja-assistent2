import { describe, expect, mock, test } from 'bun:test'
import { journalListSync } from '../../../src/features/journalList/JournalListSync.js'

describe('Kriit timetable sync payload', () => {
  test('keeps only synchronized journals and maps lesson fields', async() => {
    journalListSync.api = {
      tahvel: {
        get: mock(async endpoint => {
          if (endpoint === '/user') return { teacher: 22816, school: { id: 9 } }
          return {
            timetableEvents: [
              {
                id: 77,
                journalId: 404498,
                date: '2026-05-04T00:00:00Z',
                timeStart: '08:30:00',
                timeEnd: '10:00:00',
                rooms: [{ roomCode: 'A203' }]
              },
              {
                id: 78,
                journalId: 999999,
                date: '2026-05-04T00:00:00Z',
                timeStart: '10:15:00',
                timeEnd: '11:45:00'
              }
            ]
          }
        })
      }
    }

    const events = await journalListSync.collectTimetableEventsForKriit([
      { subjectExternalId: 404498 }
    ])

    expect(events).toEqual([{
      id: 77,
      journalId: 404498,
      date: '2026-05-04',
      timeStart: '08:30:00',
      timeEnd: '10:00:00',
      roomName: 'A203'
    }])
  })

  test('does not fail journal sync when timetable request fails', async() => {
    journalListSync.api = {
      tahvel: { get: mock(async() => { throw new Error('Tahvel unavailable') }) }
    }

    expect(await journalListSync.collectTimetableEventsForKriit([])).toEqual([])
  })
})
