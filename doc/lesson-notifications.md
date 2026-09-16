# Lesson notifications (#156, #157, #158)

## Behaviour

- Chrome schedules native notifications from the signed-in teacher's timetable. Adjacent periods in the same journal/group/type become one block.
- Default notification time is the block end. The popup supports a whole-minute offset before/after the block start/end; changing it reschedules unsent notifications, without replaying already sent blocks.
- The scheduler refreshes every 15 minutes, on startup, on Tahvel navigation and at Tallinn midnight. It fetches adjacent/shifted dates when timing offsets cross midnight.
- Clicking a notification opens a new entry, prefills type/capacity/date/periods and copies available previous-lesson attendance. Topic/content remain manual. Nothing saves automatically.
- Notification links are retained per tab in extension session storage across sign-in. Email links can reconstruct the lesson from the authenticated teacher's historical timetable without requiring a previously delivered Chrome notification.

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
