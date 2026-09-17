# Lesson notifications (#156, #157, #158)

## Behaviour

- Chrome schedules native notifications from the signed-in teacher's timetable. Adjacent periods in the same journal/group/type become one block.
- Default notification time is the block end. The popup supports a whole-minute offset before/after the block start/end; changing it reschedules unsent notifications, without replaying already sent blocks.
- The scheduler refreshes every 15 minutes, on startup, on Tahvel navigation and at Tallinn midnight. It fetches adjacent/shifted dates when timing offsets cross midnight.
- Clicking a notification opens a new entry, prefills the subject title, factual timetable content, type/capacity/date/periods and copies available previous-lesson attendance. The teacher adds the actual topic/work completed and reviews the draft. Nothing saves automatically.
- Notification links are retained per tab in extension session storage across sign-in. Email links can reconstruct the lesson from the authenticated teacher's historical timetable without requiring a previously delivered Chrome notification.

## Subject-change alerts (#161)

A separate `oa2-subject:` alarm announces the next different subject at its start. It does not replace lesson-entry or email reminders and does not depend on their offset. Subject identity is the normalized timetable title (case/spacing ignored), not journal, group or room IDs. No alert is emitted for the first lesson of a day or between same-subject periods, even across breaks. Missing titles and overlapping conflicting subjects are treated as ambiguous and skipped. Identically named subjects cannot be distinguished without an authoritative subject identifier; timetable naming must be consistent.

The worker refreshes the authenticated identity and timetable immediately before delivery. Cancelled/changed events, expired sessions and account changes suppress stale alerts. No catch-up alert is emitted more than five minutes after the subject starts or after it ends. Sent transitions are deduplicated per teacher/date/start time. Clicking opens the new subject's journal, not a prefilled entry for a lesson which has only just started.

## Notification window focus (#162)

Both notification types create an active target tab, then query that tab's actual `windowId` and request `chrome.windows.update({ focused: true })`. Only a minimized window is restored to `normal`; maximized/fullscreen windows retain their state. Window-focus failures are logged without discarding the opened link. Tab-creation failures leave the notification available for retry. Lesson-entry query parameters and sign-in recovery are unchanged.

Unit tests cover normal/minimized/maximized/fullscreen states and failures. Browser integration checks exercise the real Chrome tab/window focus APIs in headless Chromium. **Windows foreground behavior still requires a manual check**: with a test notification, put another application in front, click the toast, then repeat with Chrome minimized and maximized. Confirm the target tab appears, a minimized window restores and a maximized window remains maximized. Automated checks cannot prove OS-level foreground activation from a real Windows toast.

## Entry prefill correction (#160)

The subject title comes from authenticated `GET /journals/{id}` (`nameEt`/`name`), falling back to the saved timetable name. Only empty or generic type titles are replaced. Content is a clearly labelled timetable summary (subject, date, time and group), not a claim about what was taught. Nonempty content and teacher-entered titles are preserved. Any trusted user interaction during asynchronous loading stops subsequent automatic changes.

On opening the form, `GET /lessontimes` searches the event date (`from`, `thru`, `page`, `size`). The contract was checked against Tahvel's public `timetable/timetable.lessonTime.list.html` and its list controller: paginated `content` rows have `lessonNr`, `startTime`, `endTime`, weekday flags, `validFrom`, `validThru`, `isDefault` and `buildings`. All pages (bounded at ten) must be available. Exact start/end matches and consecutive non-overlapping periods within one valid building/period plan are required. Conflicting numbering across plans is rejected; no 45-minute division or nearest-time guesses are used. If school lesson-time access is denied/unavailable, existing notification period values are retained with a verification warning; missing values remain empty with a manual-entry explanation. The notification scheduler still uses its existing bundled period table; this correction resolves form fields only.

There is no verified assignment-to-timetable-event relation exposed by the current Kriit API. Assignments are therefore **not** inferred merely from subject/date/deadline or copied through the mutating synchronization endpoint. The teacher adds the actual topic and assignments. Unit/browser fixtures cover exact live-period mapping when bundled numbers are absent, ambiguity, pagination, denied access and preservation of teacher input. They do not prove the teacher's live permissions or live Angular event handling; those still require the manual Tahvel check.

## Email deployment (#157)

Requires the companion Kriit change: https://github.com/kriit-eu/kriit/issues/203 (branch `203-lesson-reminders`). Deploy its migration and endpoint before enabling this flow in production.

With Kriit enabled and API URL/token configured, the extension schedules a separate alarm at block end + 10 minutes. It checks the current Tahvel identity, fresh timetable and fresh journal entries. Only an unrecorded block triggers `POST {configured API base}/lessonreminders/send`. This alarm is independent of the popup's Chrome-notification timing.

The request contains only origin, school/journal IDs, date, start/end times, starting period and subject name. It sends no Tahvel cookies, student details or attendance to Kriit. Kriit uses the authenticated teacher's email, validates timing and constructs the Tahvel link itself. Its unique database claim prevents duplicate emails across retries/devices.

An expired session, inaccessible or ambiguous lesson data, an unsupported/missing Kriit endpoint, or network failure does not count as successful delivery. Failed checks can retry on subsequent schedule refreshes, up to 24 hours after the block. Already recorded blocks are marked complete without emailing.

**Runtime requirement:** Chrome must be running (background mode is sufficient) and Tahvel authentication must remain valid for email checks. There is no server-side Tahvel cookie storage or offline verification. Sleeping/stopped browsers cannot guarantee exact delivery time. Kriit must have working SMTP and an email on the teacher's account.

## Verification

Automated coverage includes scheduling/rescheduling, duplicate suppression, all four timing combinations, midnight planning, validation, fresh-entry coverage, expired sessions, email payload privacy, older links, sign-in pending-link state, prefilled form controls and real popup/worker persistence.

Before closing #156, verify on Windows with a **test profile and test lesson**:

1. Load the development build, sign in and check the next notification time in the popup.
2. Enable Chrome background mode and Windows notifications; keep the computer awake.
3. Close the last Chrome window (do not terminate Chrome).
4. Confirm one native notification at the block's configured time.
5. Click it, confirm the correct journal/form, date, lesson count and attendance; do not save a synthetic lesson.
6. Repeat with an expired Tahvel session and confirm sign-in resumes the intended form.

## Automated integration verification (2026-09-16)

`tests/e2e/lesson-flow.e2e.js` adds five browser integration tests. The full suite passed **90/90 without retries**, including actual SMTP delivery through the real Kriit reminder controller, Auth, Db and Mail classes to a disposable MailHog inbox backed by a fresh MariaDB migration.

Verified:
- One merged block, correct scheduling and all four timing options persisted through popup reloads.
- A native Chrome alarm fires after the Tahvel tab closes; duplicate delivery is suppressed.
- Notification-click handling requests the correct URL; the form gets type/capacity/date/periods/previous attendance, with topic/content empty and no automatic save.
- A link survives expired authentication and loss of query parameters during sign-in, and an older email link works without saved notification state.
- No email before ten minutes, for recorded/cancelled lessons or while authentication is unavailable.
- Real email delivery, authenticated recipient, expected subject/date/time/link, and successful local completion tracking. This caught and fixed the client incorrectly expecting `ok` at the response root instead of Kriit's `{ status, data }` envelope.
- Unauthenticated/student/invalid-token requests, early requests and invalid origins/subjects are rejected. Eight concurrent requests across multiple PHP workers create only one additional email; a caller-provided recipient is ignored.

**Boundaries:** The five tests bundle the production lesson modules with test-only seams, use a synthetic Tahvel DOM/API contract and simulated clocks/authentication. OS notification display and click events are stubbed; the requested new-tab URL is navigated by Playwright because Chromium can navigate extension-created tabs before route interception attaches. The native Chrome alarm is real, but this is not a test with every Chrome window closed. It does not verify live Tahvel Angular components/ID-card authentication, Windows toast UI or production SMTP configuration. No real teacher accounts or recipients are used.

The shared full-suite browser helper now has a worker-scoped fixture that closes the actual persistent browser (rather than its per-test cleanup wrapper), clears session/alarm state between tests, and mocks incidental worker Tahvel fetches. The full run completed without worker teardown timeouts. Eight concurrent browsers still intermittently starved the existing outcome-sync test after the unit suite, so the default concurrency is now four workers. On a busy development host, set `OA_E2E_WORKERS=2` (also inherited by the pre-push hook) to reduce contention further without changing the tested cases. No assertions/tests were removed, no timeouts were extended and no hooks were bypassed.

### Reproduce the mail integration

From this repository, with the companion Kriit worktree at `../kriit-203-lesson-reminders`, its PHP dependencies at `../kriit/vendor` and the local `kriit/app` image built:

```bash
STACK=../kriit-203-lesson-reminders/tests/lesson-reminders/compose.yaml
docker compose -p oa2-reminder-verification -f "$STACK" up -d --wait
APP=$(docker compose -p oa2-reminder-verification -f "$STACK" port app 8080)
MAIL=$(docker compose -p oa2-reminder-verification -f "$STACK" port mail 8025)
LESSON_TEST_API="http://$APP/api" LESSON_TEST_MAIL="http://$MAIL" \
  bun --bun x playwright test tests/e2e/lesson-flow.e2e.js --workers=1 --retries=0
# Or run the full suite using the same environment variables.
docker compose -p oa2-reminder-verification -f "$STACK" down
```

The email test requires both environment variables and otherwise reports a skip. It refuses non-loopback URLs, checks the disposable server identity before resetting its data, and never uses production config/database credentials. The stack's database is tmpfs and MailHog captures rather than forwards messages.

Before release: deploy the backend migration/endpoint and extension through the usual process. Production SMTP and the Windows checklist above remain deployment/manual checks, not claims made by these tests.
