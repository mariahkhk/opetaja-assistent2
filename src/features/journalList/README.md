# Journal List Features

Features active on the Tahvel journal list page (`/journals`).

## Modules

- **`JournalListSync.js`** — Two-way Tahvel ↔ Kriit reconciliation. Compares grades, due dates, students, and personal codes; surfaces discrepancies through `JournalSyncBanner`.
- **`JournalSyncBanner.js`** — Renders the interactive banner with one-click resolution actions for each detected difference.
- **`KriitSyncNotifier.js`** — Highlights individual journals that have unresolved Kriit-side issues so the teacher can see the problem without opening each journal.
- **`OutComes.js`** — Pushes Tahvel curriculum outcome assessments to Kriit, skipping inaccessible journals gracefully.
- **`TahvelNewAssignmentSync.js`** — Mirrors freshly created Tahvel assignments to Kriit in the background.
- **`finalGradeWarning/FinalGradeWarningFeature.js`** — Flags journals where the study period has ended but final grades are still missing.
- **`lessonCountWarning/LessonCountWarningFeature.js`** — Flags journals where the planned lesson count and the timetable disagree.

See the top-level `README.md` for the full feature catalogue and project structure.
