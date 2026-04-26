# Test Coverage Report

## Summary

**Date:** 2026-04-26
**Test Framework:** Bun Test
**Test Files:** 39
**Total Tests:** 1124
**Passing:** 1124
**Failing:** 0
**Assertions:** 2142

**Overall coverage:** 76.01% functions / 70.72% lines

## Coverage by Module

### Excellent (≥90% lines)

| Module | % Funcs | % Lines |
| --- | ---: | ---: |
| `services/StyleService.js` | 100.00 | 100.00 |
| `services/Logger.js` | 100.00 | 97.37 |
| `services/ApiService.js` | 89.74 | 98.99 |
| `services/BannerService.js` | 93.33 | 92.69 |
| `services/VersionCheckService.js` | 80.00 | 98.57 |
| `core/BaseFeature.js` | 100.00 | 90.60 |
| `lib/parseJsonResponse.js` | 100.00 | 100.00 |
| `lib/schoolId.js` | 100.00 | 100.00 |
| `lib/fetchTeacherJournals.js` | 100.00 | 97.14 |
| `lib/finalGradeWarning.js` | 100.00 | 91.04 |
| `features/journalList/KriitSyncNotifier.js` | 100.00 | 100.00 |
| `features/journalList/OutComes.js` | 100.00 | 98.68 |
| `features/header/TimetableDiscrepancyDetectionFeature.js` | 86.11 | 95.50 |
| `features/header/HeaderSyncButtonFeature.js` | 87.50 | 91.61 |
| `features/singleJournal/addFinalGrades/FinalGradeHighlighter.js` | 100.00 | 94.12 |

### Good (60–89% lines)

| Module | % Funcs | % Lines |
| --- | ---: | ---: |
| `services/CacheService.js` | 88.71 | 88.75 |
| `services/CryptoService.js` | 90.00 | 87.78 |
| `services/DomService.js` | 83.33 | 83.33 |
| `features/journalList/JournalSyncBanner.js` | 86.67 | 72.61 |
| `features/singleJournal/highlightGradeCells/HighlightGradeCellsFeature.js` | 91.76 | 87.21 |
| `features/singleJournal/highlightMissingGrades/HighlightMissingGradesFeature.js` | 88.57 | 85.03 |
| `features/singleJournal/lastLessonNotification/LastLessonNotificationFeature.js` | 88.46 | 66.58 |
| `lib/kriitSyncCheck.js` | 80.33 | 62.13 |

### Needs work (<60% lines)

| Module | % Funcs | % Lines | Notes |
| --- | ---: | ---: | --- |
| `features/singleJournal/lessonDiscrepancies/DiscrepanciesTable.js` | 56.10 | 51.14 | Large UI component |
| `features/journalList/finalGradeWarning/FinalGradeWarningFeature.js` | 62.50 | 43.95 | |
| `features/journalList/JournalListSync.js` | 77.46 | 35.29 | 5000+ line module — algorithm-heavy |
| `features/journalList/lessonCountWarning/LessonCountWarningFeature.js` | 53.33 | 29.66 | |
| `features/singleJournal/highlightFinalGrades/HighlightFinalGradesFeature.js` | 78.26 | 29.71 | |
| `features/journalList/TahvelNewAssignmentSync.js` | 42.11 | 15.01 | |
| `features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js` | 21.24 | 9.93 | Large branching feature |
| `services/SentryService.js` | 57.14 | 9.27 | Most paths run only on real errors |
| `services/MessageListenerService.js` | 33.33 | 7.81 | Routing layer; mostly side effects |
| `features/singleJournal/lessonDiscrepancies/IndependentWorkCapacityFeature.js` | 0.00 | 2.44 | No tests yet |

## Test Layout

- `test/services/` — unit tests for shared singletons (ApiService, CacheService incl. crypto + tier + version-wipe variants, CryptoService, BannerService, Logger, DomService, StyleService, SentryService, VersionCheckService).
- `test/core/` — `BaseFeature` lifecycle tests.
- `test/lib/` — pure-helper tests (`fetchTeacherJournals`, `finalGradeWarning`, `kriitSyncCheck`, `schoolId`).
- `test/features/header/` — header-bar feature tests.
- `test/features/journalList/` — journal-list feature tests (sync algorithm, banner, notifier, outcomes, warnings).
- `test/features/singleJournal/` — single-journal feature tests (discrepancies, final grades, highlights, last-lesson notification).
- `test/mocks/` and `test/setup.js` — Chrome API mocks and JSDOM bootstrap.

## Commands

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run a specific file
bun test test/services/CacheService.test.js

# Watch mode
bun test --watch
```

To regenerate the numbers in this report, run `bun test --coverage` and replace the tables. The figures above are a snapshot — they will drift as code is added.
