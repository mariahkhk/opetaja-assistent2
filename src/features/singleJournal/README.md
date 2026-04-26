# Single Journal Features

Features active on an individual journal edit page (`/journal/:id/edit`).

## Modules

- **`lessonDiscrepancies/`** — Compares the timetable against actual journal entries.
  - `LessonDiscrepanciesFeature.js` orchestrates detection.
  - `DiscrepanciesTable.js` renders the inline table and "add missing entry" actions.
  - `IndependentWorkCapacityFeature.js` validates `auditoorne` vs. independent-work capacity types.
- **`lastLessonNotification/LastLessonNotificationFeature.js`** — Strobing yellow banner showing the date of the final lesson so teachers don't forget independent-work entries. The colour ramps up as the date approaches.
- **`highlightMissingGrades/HighlightMissingGradesFeature.js`** — Marks empty grade cells red once an independent-work due date has passed.
- **`highlightGradeCells/HighlightGradeCellsFeature.js`** — Color-codes grade cells by result so teachers can scan a journal at a glance.
- **`highlightFinalGrades/HighlightFinalGradesFeature.js`** — Highlights students who already qualify for a final grade.
- **`addFinalGrades/`** — Final-grade workflow.
  - `FinalGradeHighlighter.js` marks rows that need a final grade.
  - `FinalGradesManagementFeature.js` provides the one-click "add final grades" UI.

See the top-level `README.md` for the full feature catalogue and project structure.
