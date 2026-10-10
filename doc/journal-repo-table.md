# Shared journal ↔ repository table (example)

A shared table maps Tahvel journals to GitHub repositories and grade files. It is meant for schools where several teachers use the same repositories: the mapping is described once, so teachers don't have to enter it on each journal's panel.

> **Status:** the extension reads this table only when a table URL (`configUrl`) is set in its settings. The UI does not offer that setting yet. Until then, the Classroom 50 classroom is detected automatically from the group code or entered manually on the journal panel (see the teacher guide [github-classroom50-tahvel.md](github-classroom50-tahvel.md), in Estonian).

## Columns

- **Journal ID**: the journal number from the Tahvel address bar (`#/journal/123456`). This is the most reliable way to identify a journal. If it is empty, the journal is matched by name and group.
- **Journal**: the journal name in Tahvel.
- **Group**: the student group code, e.g. `IT-24`.
- **Repo**: the repository as `owner/repository`, e.g. `my-org/classroom50`.
- **File**: the path of the grade file in the repository, e.g. `it24-automatiseerimine/scores.json`. The file format is described in the teacher guide.
- **Mode**: `5` (graded 1–5) or `A/MA` (pass/fail).

The Estonian column names (`Päevik ID`, `Päevik`, `Rühm`, `Repo`, `Fail`, `Hindamine`) are accepted too. Put only one table in the file: the extension takes the column names from the first table.

## Example

| Journal ID | Journal | Group | Repo | File | Mode |
|---|---|---|---|---|---|
| | Automatiseerimine | IT-24 | my-org/classroom50 | it24-automatiseerimine/scores.json | 5 |
| | Automatiseerimine | ITS-25 | my-org/classroom50 | its25-automatiseerimine/scores.json | 5 |
| | Arvutivõrkude alused-gr1 | IT-26 | other-org/classroom50 | it26-avalused/scores.json | 5 |
| | Arvutivõrkude alused-gr2 | IT-26 | other-org/classroom50 | it26-avalused/scores.json | 5 |
