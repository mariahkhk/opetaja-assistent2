# Copilot Instructions for Õpetaja Assistent 2

## Project Overview

- **Õpetaja Assistent 2** is a browser extension for the Tahvel educational platform, automating teacher workflows, syncing with Kriit, and improving data visualization.
- **Architecture:**
  - **Core modules** (`src/core/`): Extension entrypoint, feature registry, navigation handling.
  - **Features** (`src/features/`): Modular, page-context-specific features (e.g., journal list sync, lesson discrepancies).
  - **Services** (`src/services/`): Shared utilities (API, DOM, caching, logging, navigation, styles).
  - **Assets** (`src/assets/`): Icons, CSS, build scripts, templates.

## Key Patterns & Conventions

- **Feature Modules:**
  - Inherit from `BaseFeature` (see `src/core/BaseFeature.js`).
  - Registered via `FeaturesRegistry` and loaded dynamically by `Extension.js`.
  - Use service singletons (e.g., `Logger`, `DomService`) for cross-cutting concerns.
- **Service Layer:**
  - All DOM, API, and navigation logic must go through the corresponding service in `src/services/`.
  - Avoid direct DOM or network access in features.
- **Logging:**
  - Use `Logger` for all logs. Info/debug logs use "✨" prefix for easy filtering. Warnings/errors are always shown.
  - Debug mode can be toggled via the popup interface.

## Developer Workflow

- **Development:**
  - Start with `bun start` (installs deps, lints, formats, builds, watches).
  - Load the unpacked extension from the `dist/` directory in your browser.
  - Use the Extensions Reloader Chrome extension for fast reloads.
- **Production Build:**
  - Run `bun run build` to generate a minified, production-ready extension in `dist/`.
- **Linting/Formatting:**
  - Enforced by `.editorconfig` and `.eslintrc.json`.
  - Run `bun run lint` or `bun run lint:fix` as needed.

## Project-Specific Guidelines

- **Code Style:**
  - Modern ES modules, 2-space indent, camelCase for variables, PascalCase for classes.
  - Prefer self-documenting code—comments only when the *why* is non-obvious.
  - Private methods use `#` prefix (`#extractJournalId()`).
  - Eliminate duplication, merge similar logic, and avoid deep nesting.
  - Use services for DOM/network/cache; never access them directly in features.
- **Feature Examples:**
  - See `src/features/journalList/JournalListSync.js` for a complete feature module.
  - See `src/features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js` for advanced validation and logging patterns.

## Integration Points

- **Tahvel**: Main UI integration point (content script, DOM hooks).
- **Kriit**: External API for journal/assignment sync (see `ApiService.js`).
- **Popup**: User settings, debug toggle, cache management (see `src/popup.js`).

---

For more, see `README.md`, `CLAUDE.md`, and `doc/project-documentation.md`.
