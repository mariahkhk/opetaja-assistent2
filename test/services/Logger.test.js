import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import Logger, {
  log,
  info,
  success,
  warning,
  error,
  debug,
  feature,
  LogLevel,
  isDebugMode,
  enableDebugMode,
  disableDebugMode
} from '../../src/services/Logger.js'
import { restoreChromeMock } from '../setup.js'

describe('Logger', () => {
  let originalConsole

  beforeEach(() => {
    originalConsole = { ...console }
    console.log = mock(() => {})
    console.groupCollapsed = mock(() => {})
    console.groupEnd = mock(() => {})
    console.trace = mock(() => {})

    global.chrome = {
      storage: {
        sync: {
          get: mock((keys, callback) => {
            callback({ OA_debug_mode: false })
          }),
          set: mock((items, callback) => {
            if (callback) callback()
          })
        }
      },
      runtime: {
        getManifest: mock(() => ({
          update_url: null
        }))
      }
    }
  })

  afterEach(() => {
    console.log = originalConsole.log
    console.groupCollapsed = originalConsole.groupCollapsed
    console.groupEnd = originalConsole.groupEnd
    console.trace = originalConsole.trace
    restoreChromeMock()
  })

  describe('LogLevel constants', () => {
    test('should have emoji prefixes', () => {
      expect(LogLevel.INFO).toBe('✨')
      expect(LogLevel.SUCCESS).toBe('✨')
      expect(LogLevel.WARNING).toBe('✨')
      expect(LogLevel.ERROR).toBe('✨')
      expect(LogLevel.DEBUG).toBe('✨')
      expect(LogLevel.FEATURE).toBe('✨')
    })
  })

  describe('log function', () => {
    test('should log message with emoji and elapsed time', () => {
      log('test message', LogLevel.INFO)

      expect(console.groupCollapsed).toHaveBeenCalled()
      const call = console.groupCollapsed.mock.calls[0]
      expect(call[0]).toMatch(/\[\d+s\] ✨ test message/)
    })

    test('should include additional arguments', () => {
      const extraData = { key: 'value' }
      log('test message', LogLevel.INFO, extraData)

      expect(console.groupCollapsed).toHaveBeenCalled()
      const call = console.groupCollapsed.mock.calls[0]
      expect(call[1]).toEqual(extraData)
    })

    test('should include trace information', () => {
      log('test message', LogLevel.INFO)

      expect(console.trace).toHaveBeenCalledWith('Source:')
    })

    test('should handle browsers without groupCollapsed', () => {
      console.groupCollapsed = undefined

      log('test message', LogLevel.INFO)

      expect(console.log).toHaveBeenCalled()
      expect(console.trace).toHaveBeenCalledWith('Source:')
    })
  })

  describe('info function', () => {
    test('should log info message', () => {
      info('info message')
      expect(console.groupCollapsed).toHaveBeenCalled()
    })
  })

  describe('success function', () => {
    test('should log success message', () => {
      success('success message')
      expect(console.groupCollapsed).toHaveBeenCalled()
    })
  })

  describe('warning function', () => {
    test('should log warning message', () => {
      warning('warning message')
      expect(console.groupCollapsed).toHaveBeenCalled()
    })
  })

  describe('error function', () => {
    test('should log error message', () => {
      error('error message')
      expect(console.groupCollapsed).toHaveBeenCalled()
    })

    test('should log error with additional data', () => {
      const errorObj = new Error('test error')
      error('error occurred', errorObj)

      expect(console.groupCollapsed).toHaveBeenCalled()
      const call = console.groupCollapsed.mock.calls[0]
      expect(call[1]).toEqual(errorObj)
    })
  })

  describe('debug function', () => {
    test('should not log when debug mode is disabled', () => {
      debug('debug message')
      expect(console.groupCollapsed).not.toHaveBeenCalled()
    })

    test('should log when debug mode is enabled', () => {
      enableDebugMode()
      debug('debug message')
      expect(console.groupCollapsed).toHaveBeenCalled()
    })
  })

  describe('feature function', () => {
    test('should log feature message with feature name', () => {
      feature('TestFeature', 'activated')

      expect(console.groupCollapsed).toHaveBeenCalled()
      const call = console.groupCollapsed.mock.calls[0]
      expect(call[0]).toMatch(/\[TestFeature\] activated/)
    })
  })

  describe('debug mode', () => {
    test('should enable debug mode', () => {
      enableDebugMode()
      expect(isDebugMode()).toBe(true)
      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ OA_debug_mode: true })
    })

    test('should disable debug mode', () => {
      disableDebugMode()
      expect(isDebugMode()).toBe(false)
      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ OA_debug_mode: false })
    })
  })

  describe('default export', () => {
    test('should export all functions', () => {
      expect(Logger.log).toBeDefined()
      expect(Logger.info).toBeDefined()
      expect(Logger.success).toBeDefined()
      expect(Logger.warning).toBeDefined()
      expect(Logger.error).toBeDefined()
      expect(Logger.debug).toBeDefined()
      expect(Logger.feature).toBeDefined()
      expect(Logger.isDebugMode).toBeDefined()
      expect(Logger.enableDebugMode).toBeDefined()
      expect(Logger.disableDebugMode).toBeDefined()
      expect(Logger.LogLevel).toBeDefined()
    })
  })
})
