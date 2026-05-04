import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { restoreChromeMock, restoreGlobalDOM } from '../setup.js'
import { loadFeatures } from '../../src/core/FeaturesRegistry.js'

describe('FeaturesRegistry.loadFeatures', () => {
  beforeEach(() => {
    restoreGlobalDOM()
    restoreChromeMock()
  })

  afterEach(() => {
    restoreChromeMock()
  })

  function setKriitEnabled(enabled) {
    return new Promise(resolve => {
      global.chrome.storage.local.set({ OA_kriitEnabled: enabled }, () => resolve())
    })
  }

  it('returns an array of features', async () => {
    await setKriitEnabled(false)
    const features = await loadFeatures()
    expect(Array.isArray(features)).toBe(true)
  })

  it('skips Kriit-dependent features when Kriit is disabled', async () => {
    await setKriitEnabled(false)
    const features = await loadFeatures()
    const names = features.map(f => f.name)
    expect(names).not.toContain('journalListSync')
    expect(names).not.toContain('tahvelNewAssignmentSync')
    expect(names.some(n => /HeaderSyncButton/i.test(n))).toBe(false)
  })

  it('includes Kriit-dependent features when Kriit is enabled', async () => {
    await setKriitEnabled(true)
    const features = await loadFeatures()
    const names = features.map(f => f.name)
    expect(names).toContain('journalListSync')
    expect(names).toContain('tahvelNewAssignmentSync')
  })

  it('always includes non-Kriit features regardless of Kriit setting', async () => {
    await setKriitEnabled(false)
    const features = await loadFeatures()
    const names = features.map(f => f.name)
    expect(names).toContain('LessonCountWarningFeature')
    expect(names).toContain('FinalGradeWarningFeature')
    expect(names).toContain('LessonDiscrepanciesFeature')
    expect(names).toContain('TimetableDiscrepancyDetectionFeature')
  })

  it('treats undefined Kriit setting as disabled', async () => {
    const features = await loadFeatures()
    const names = features.map(f => f.name)
    expect(names).not.toContain('journalListSync')
  })

  it('treats non-true Kriit setting as disabled', async () => {
    await setKriitEnabled('truthy-string')
    const features = await loadFeatures()
    const names = features.map(f => f.name)
    expect(names).not.toContain('journalListSync')
  })

  it('returned features all have a name property', async () => {
    setKriitEnabled(true)
    const features = await loadFeatures()
    for (const feature of features) {
      expect(typeof feature.name).toBe('string')
      expect(feature.name.length).toBeGreaterThan(0)
    }
  })

  it('returned features have shouldActivate methods', async () => {
    setKriitEnabled(false)
    const features = await loadFeatures()
    for (const feature of features) {
      expect(typeof feature.shouldActivate).toBe('function')
    }
  })
})
