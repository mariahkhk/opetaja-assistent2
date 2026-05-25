# Õpetaja Assistent 2

A browser extension providing additional functionality for Tahvel educational platform.

## Purpose

The primary goal of this project is to streamline the workflow for teachers using the Tahvel platform by automating
repetitive tasks, providing better data visualization, and integrating with external systems like Kriit (like Moodle but
provides a nice overview of all ungraded assignments across all journals on a single web page). This helps reduce manual
effort and ensures data consistency across systems.

### Features

**Journal list page:**
- **Kriit sync**: Two-way synchronization between Tahvel and Kriit. Compares grades, due dates, students, and personal codes; surfaces discrepancies in an interactive banner with one-click fixes.
- **Sync notifier**: Highlights journals where Kriit and Tahvel have diverged so the teacher can act before the next lesson.
- **Outcomes sync**: Pushes Tahvel curriculum outcome assessments to Kriit and skips inaccessible journals gracefully.
- **New assignment sync**: Mirrors freshly created Tahvel assignments to Kriit in the background.
- **Final grade warning**: Flags journals with missing final grades — yellow pill 7–2 days before the final lesson, red pill within 1 day of or past the final lesson.
- **Lesson count warning**: Flags journals where the planned lesson count and timetable disagree.

**Single journal page:**
- **Lesson discrepancies table**: Compares timetable against journal entries, validates lesson capacity types (auditoorne / independent work), and lets the teacher add or correct entries inline.
- **Last lesson notification**: Strobing yellow banner showing the date of the final lesson so teachers don't forget independent-work entries.
- **Highlight missing grades**: Marks empty grade cells red once an independent-work due date has passed.
- **Highlight grade cells**: Color-codes grade cells by result so teachers can scan a journal at a glance.
- **Assignment title helper row**: Injects an extra header row in the assignment table with shortened titles and learning-outcome badges (ÕV{n}) so teachers can identify columns at a glance, with a tooltip showing the full title on hover.
- **Final grade tools**: Highlights students who already qualify for a final grade, and offers a one-click "add final grades" management UI.

**Header (all Tahvel pages):**
- **Sync button**: Manual Kriit-sync trigger surfaced in the Tahvel header.
- **Timetable discrepancy detection**: Background check that surfaces issues without requiring the teacher to open each journal.

**Cross-cutting:**
- **Encrypted cache**: All persisted API responses are AES-256-GCM encrypted at rest with a pre-install key stored in `chrome.storage.local`. Cache keys are HMAC-hashed so other extensions enumerating the Cache API see only opaque hex. Eviction runs every 6 h via `chrome.alarms`.
- **Update notification**: Shows a modal overlay on the Tahvel page when Chrome detects a new extension version is available; dismissal is remembered per version so it only appears once.
- **Sentry error reporting**: Captures crash reports filtered for known PII; expected 401/403/404/412 responses are excluded.
- **Privacy-aware popup**: Settings stay in `chrome.storage.local` (never synced to Google's servers); the saved Kriit API key is never loaded into the popup field — a separate indicator shows whether one is stored — and the URL is HTTPS-only (with a `localhost` exception for development).
- **Debug mode**: Toggleable via the popup; logs are tagged with "✨" for easy filtering, and request/response bodies for known-PII Kriit endpoints are scrubbed to `[REDACTED-PII]` in the debug buffer.

### Architecture:

- **Core Modules**: Handle the main extension logic, feature activation, and navigation handling.
- **Features**: Implement specific functionalities organized by page context (journal list, single journal).
- **Services**: Provide shared utilities like DOM manipulation, API communication, caching, and UI components.
- **Popup Interface**: Provides user settings, debug controls, and cache management.
- **Testing Suite**: Comprehensive tests for core functionality and edge cases.

## Project Structure

This extension uses a Feature-Based Module System with Services Layer architecture:

```
src/
├── background.js                          # Service worker (cache eviction alarm, reload helper)
├── content.js                             # Main content-script entry point
├── popup.js                               # Extension popup logic
├── assets/                                # Build inputs
│   ├── icons/                             # SVG icon assets (incompleteScore.svg)
│   ├── scripts/                           # Build and watch scripts (build.js, watch.js)
│   ├── styles/                            # CSS for injected UI
│   └── templates/                         # manifest.json, popup.html, icon.svg
├── core/
│   ├── Extension.js                       # Main controller
│   ├── BaseFeature.js                     # Lifecycle base class for features
│   └── FeaturesRegistry.js                # Registers all features
├── features/
│   ├── header/                            # Features active on every Tahvel page
│   │   ├── HeaderSyncButtonFeature.js
│   │   └── TimetableDiscrepancyDetectionFeature.js
│   ├── journalList/                       # Features for the journal list page
│   │   ├── JournalListSync.js
│   │   ├── JournalSyncBanner.js
│   │   ├── KriitSyncNotifier.js
│   │   ├── OutComes.js
│   │   ├── TahvelNewAssignmentSync.js
│   │   ├── finalGradeWarning/FinalGradeWarningFeature.js
│   │   └── lessonCountWarning/LessonCountWarningFeature.js
│   └── singleJournal/                     # Features for an individual journal page
│       ├── addFinalGrades/                # FinalGradeHighlighter + FinalGradesManagementFeature
│       ├── assignmentTitleRow/            # AssignmentTitleRowFeature (assignment header helper row)
│       ├── highlightFinalGrades/          # HighlightFinalGradesFeature
│       ├── highlightGradeCells/           # HighlightGradeCellsFeature (color-by-result)
│       ├── highlightMissingGrades/        # HighlightMissingGradesFeature
│       ├── lastLessonNotification/        # LastLessonNotificationFeature
│       └── lessonDiscrepancies/           # DiscrepanciesTable + LessonDiscrepanciesFeature
│                                          # + IndependentWorkCapacityFeature + LessonTimes.json
├── lib/                                   # Pure helpers shared across features
│   ├── EstonianHyphenator.js
│   ├── extractOutcomeNumbersFromEntryName.js
│   ├── fetchTeacherJournals.js
│   ├── finalGradeWarning.js
│   ├── isTahvelAuthenticated.js
│   ├── journalTableHeaders.js
│   ├── kriitSyncCheck.js
│   ├── parseJsonResponse.js
│   ├── schoolId.js
│   └── studyYear.js
└── services/                              # Shared singletons
    ├── ApiService.js                      # HTTP client for Tahvel & Kriit
    ├── BannerService.js                   # In-page banner UI
    ├── CacheService.js                    # AES-256-GCM encrypted Cache API wrapper
    ├── CryptoService.js                   # Per-install key + HMAC helpers
    ├── DomService.js                      # DOM helpers (waitForElement, etc.)
    ├── Logger.js                          # "✨"-prefixed structured logging
    ├── MessageListenerService.js          # chrome.runtime message routing
    ├── NavigationService.js               # SPA navigation detection
    ├── SentryService.js                   # PII-filtered error reporting
    ├── StyleService.js                    # CSS injection
    └── VersionCheckService.js             # New-version notifications
```

## Development

### Prerequisites

- [Git](https://git-scm.com/downloads)
- [Bun](https://bun.sh) v1.0.0 or higher
- [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
  Chrome extension (for extension reloading)
- A Tahvel teacher account (the extension enhances pages that are only accessible to authenticated teachers)

### Getting Started

Clone the repository:

```bash
git clone https://github.com/kriit-eu/opetaja-assistent2.git
cd opetaja-assistent2
```

### Development Workflow

1. Start the development server:
   ```bash
   bun start
   ```

   This single command:
    - Installs dependencies
    - Automatically formats and lints code
    - Builds the extension
    - Starts the file watcher

2. Load the extension in your browser:
    - Navigate to `chrome://extensions/` (or equivalent for your browser)
    - Enable "Developer mode"
    - Click "Load unpacked" and select the `dist` directory

3. Set up Extensions Reloader:
    - Install
      the [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
      Chrome extension
    - Configure it to reload the page automatically (via its options)

4. Make changes to the code:
    - Edit files in the `src` directory and save the file
    - The dev server will automatically rebuild when files change
    - Click the Extensions Reloader's icon or use its keyboard shortcut (Alt+R or Opt+Shift+R) to reload the extension
      and refresh the page

5. (Optional) Set up Kriit integration:
    - Click the extension icon in Chrome to open the popup
    - Enter the Kriit API URL and API key under "Kriit integratsioon"
    - Click "Salvesta" to save

6. View debug output:
    - Open browser's Developer Tools (F12 or Cmd+Option+I)
    - Look for extension logs in the Console tab
    - Filter console by "✨" to see only extension logs

### Code Style and Linting

This project uses several tools to maintain consistent code style:

- **EditorConfig**: Ensures consistent editor settings across different IDEs
- **ESLint**: Enforces code quality and style rules

Code is formatted and linted on the initial `bun start` invocation. The watcher only rebuilds — it does not re-lint, so run the commands below before pushing:

```bash
# Check for linting issues
bun run lint

# Fix linting issues automatically
bun run lint:fix

# Format code with ESLint
bun run format
```

### Tests and git hooks

Run the test suite:

```bash
bun test
```

[Husky](https://typicode.github.io/husky/) is installed automatically via the `prepare` script in `package.json`. The `pre-push` hook runs `bun run lint`, `bun test`, and the full Playwright E2E suite (`bun run test:e2e`); `git push` is blocked if any of them fails, so fix them locally first.

> If you install dependencies in a directory that isn't a Git working tree (e.g. a downloaded zip), the `prepare` script will fail trying to set up Husky. Clone via `git clone` instead.

## Production Build

```bash
bun run build
```

`bun run build` lints the source, then runs `src/assets/scripts/build.js --prod`, which:

1. Cleans `dist/`
2. Bundles and minifies `content.js`, `background.js`, and `popup.js`
3. Converts `src/assets/templates/icon.svg` to PNGs (48 px and 128 px)
4. Copies `manifest.json` (with the version synced from `package.json`), `popup.html`, `icon.svg`, `JournalSyncBannerService.css`, and `LessonTimes.json` into `dist/`

The build script does **not** install the extension in your browser — to load the freshly built `dist/`, follow the same "Load the extension" steps as in the [Development Workflow](#development-workflow) above.

## Useful Commands

| Command | Purpose |
|---------|---------|
| `bun start` | Install dependencies, lint, build, and start file watcher |
| `bun run dev` | Build and start file watcher |
| `bun run build` | Production build (lint + minify) |
| `bun run build:dev` | Single development build |
| `bun test` | Run unit tests |
| `bun run test:e2e` | Run Playwright E2E tests |
| `bun run lint` | Check for linting issues |
| `bun run lint:fix` | Fix linting issues automatically |
| `bun run format` | Format code with ESLint |

## Privacy & Security

The extension only reads data already accessible to the signed-in teacher in Tahvel. Nothing is sent to third parties — settings live in `chrome.storage.local` (which never syncs to Google), all persisted cache entries are AES-256-GCM encrypted, and outbound traffic only ever goes to Tahvel and the teacher's configured Kriit server (HTTPS-only, with a `localhost` exception for development).

Crash reports go through Sentry with PII filtered out before transmission. Full details are in [`privacy_policy.md`](./privacy_policy.md) (Estonian).

## Repository

Source code: <https://github.com/kriit-eu/opetaja-assistent2>

Issues and feature requests: <https://github.com/kriit-eu/opetaja-assistent2/issues>

## License

Released under the [MIT License](./LICENSE).
