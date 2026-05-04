import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { restoreGlobalDOM } from '../../../setup.js'
import IndependentWorkCapacityFeature from '../../../../src/features/singleJournal/lessonDiscrepancies/IndependentWorkCapacityFeature.js'

function makeApi(journalInfo, { throws } = {}) {
  return {
    tahvel: {
      get: mock(async () => {
        if (throws) throw new Error('boom')
        return journalInfo
      })
    }
  }
}

function placeNotification(text = 'Viimane tund toimus 13.04.2026') {
  const el = document.createElement('div')
  el.id = 'last-lesson-inline-notification'
  el.textContent = text
  document.body.appendChild(el)
  return el
}

describe('IndependentWorkCapacityFeature', () => {
  beforeEach(() => {
    restoreGlobalDOM()
  })

  it('returns null when the inline notification never appears', async () => {
    // No notification in DOM — feature polls for 2s then gives up
    const api = makeApi({})
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
    expect(api.tahvel.get).not.toHaveBeenCalled()
  }, 5000)

  it('returns null when the notification text does not match the expected pattern', async () => {
    placeNotification('Mingit muud teksti')
    const api = makeApi({})
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
    expect(api.tahvel.get).not.toHaveBeenCalled()
  })

  it('accepts both "toimus" (past) and "toimub" (future) phrasings', async () => {
    placeNotification('Viimane tund toimub 13.04.2026')
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: 4, plannedHours: 4 }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
    expect(api.tahvel.get).toHaveBeenCalledWith('/journals/12345', {}, { forceRefresh: true })
  })

  it('returns null when capacityHours is missing entirely', async () => {
    placeNotification()
    const api = makeApi({})
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
  })

  it('returns null when capacityHours has no MAHT_i entry', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_t', usedHours: 4, plannedHours: 4 }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
  })

  it('returns null when usedHours is not a number', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: null, plannedHours: 4 }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
  })

  it('returns null when plannedHours is not a number', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: 4, plannedHours: '4' }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
  })

  it('returns null when used and planned hours match exactly', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: 6, plannedHours: 6 }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
  })

  it('returns "liiga vähe" message when there are fewer used hours than planned', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: 2, plannedHours: 6 }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345))
      .resolves.toBe('iseseisevaid töid on 4h liiga vähe')
  })

  it('returns "liiga palju" message when there are more used hours than planned', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: 9, plannedHours: 6 }] }
    })
    await expect(IndependentWorkCapacityFeature.check(api, 12345))
      .resolves.toBe('iseseisevaid töid on 3h liiga palju')
  })

  it('returns null when API call throws', async () => {
    placeNotification()
    const api = makeApi({}, { throws: true })
    await expect(IndependentWorkCapacityFeature.check(api, 12345)).resolves.toBeNull()
  })

  it('forwards journalId in the API request path', async () => {
    placeNotification()
    const api = makeApi({
      lessonHours: { capacityHours: [{ capacity: 'MAHT_i', usedHours: 4, plannedHours: 4 }] }
    })
    await IndependentWorkCapacityFeature.check(api, 98765)
    expect(api.tahvel.get).toHaveBeenCalledWith('/journals/98765', {}, { forceRefresh: true })
  })
})
