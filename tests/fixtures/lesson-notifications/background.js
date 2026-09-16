import './worker-seams.js'
import { registerLessonNotifications } from '../../../src/services/LessonNotificationService.js'
import { cryptoService } from '../../../src/services/CryptoService.js'
lessonHarness.readState = async() => {
  const stored = (await chrome.storage.local.get('OA_lessonNotifications')).OA_lessonNotifications
  return stored ? JSON.parse(await cryptoService.decrypt(stored)) : {}
}
lessonHarness.writeState = async state => {
  await chrome.storage.local.set({ OA_lessonNotifications: await cryptoService.encrypt(JSON.stringify(state)) })
}
registerLessonNotifications()
