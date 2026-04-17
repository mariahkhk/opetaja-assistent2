# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Õpetaja Assistent 2** (Teacher Assistant 2) is a Chrome/browser extension that enhances the Tahvel educational platform used in Estonian vocational schools.

**What it does:**
- Adds features to Tahvel web pages to streamline teachers' workflow
- Syncs data between Tahvel (student information system) and Kriit (Moodle-like assignment tracking system)
- Provides visual indicators for missing grades, lesson discrepancies, and sync status
- Automates repetitive tasks like grade synchronization and validation

**Key systems:**
- **Tahvel**: Estonian educational platform (like PowerSchool or Blackboard) - the target platform this extension enhances
- **Kriit**: Assignment tracking system (like Moodle) that provides overview of ungraded assignments across journals

**Repository:** https://github.com/kriit-eu/opetaja-assistent2

## Core Concepts

**Journals:** In Tahvel, a "journal" represents a subject/course (e.g., "Agile Software Development"). It contains:
- Student list
- Lesson entries (attendance, topics covered)
- Assignments and grades
- Timetable (scheduled lessons)

**User roles:**
- **Teachers**: Primary users who grade students, manage journals, sync with Kriit
- **Students**: View their grades (extension focuses on teacher functionality)

**Synchronization:** The extension syncs data bidirectionally between Tahvel and Kriit:
- Assignments, students, grades
- Highlights discrepancies between systems
- Allows teachers to fix inconsistencies

## Architecture

**Entry Points:**
- `src/content.js`: Main content script injected into Tahvel pages
- `src/background.js`: Service worker for extension reload functionality
- `src/core/Extension.js`: Main extension controller that initializes features

**Feature Activation Flow:**
1. Content script loads and calls `TahvelExtension.init()`
2. Extension reads current URL and checks all registered features
3. Features with matching URL patterns get activated via `shouldActivate(url)`
4. Each feature's `activate()` method runs to inject UI/functionality
5. Features observe DOM changes and handle navigation events
6. On URL change, features get deactivated/reactivated as needed

**BaseFeature Pattern:**
- All features extend `BaseFeature` class (in `src/core/BaseFeature.js`)
- Constructor takes: `name`, `urlPattern` (string/regex/function), optional `requiredSelectors`
- URL patterns determine when feature activates (e.g., `/journal/\\d+/edit` for single journal pages)
- Features have access to `this.api.tahvel` and `this.api.kriit` for API calls
- Lifecycle methods: `activate()`, `onDeactivate()`

**Feature Registry:**
- `src/core/FeaturesRegistry.js` registers all available features
- Features auto-activate based on URL matching

## API Integration

**Tahvel API:**
- Base URL (dynamic based on environment):
  - Production: `https://tahvel.edu.ee/hois_back`
  - Test: `https://test.tahvel.eenet.ee/hois_back`
  - UusTahvel: `https://uustahvel.eenet.ee/hois_back`
- Authentication: Uses browser cookies (user must be logged into Tahvel)
- Common endpoints:
  - `/journals/{id}` - Get journal details
  - `/journals/{id}/journalEntriesByDate` - Get journal entries
  - `/timetableevents/timetableByTeacher/{schoolId}` - Get timetable
  - `/user` - Get current user info

**Kriit API:**
- Base URL: Configured by user in extension popup (stored in `chrome.storage.local`)
- API Key: Also configured in popup, sent as `X-API-KEY` header
- Common endpoints:
  - `/api/subjects/getDifferences` - Get sync differences
  - `/api/assignments` - Assignment management

**Caching:**
- API responses are cached via `CacheService`
- Cache keys based on endpoint + params
- Configurable expiration times (default: 24h for static data, 1min for dynamic)
- Cache stored in `chrome.storage.local`

## Testing

**Test Framework:** Bun's built-in test runner
**Run tests:** `bun test`

**Test files:** Located in `test/` directory, mirroring `src/` structure
**Example:** `test/features/singleJournal/LastLessonNotificationFeature.test.js`

**Testing approach:**
- Unit tests for individual features and services
- DOM mocking with JSDOM
- API mocking for external dependencies

## Development & Debugging

**Loading extension in browser:**
1. Run `bun start` to build and watch
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `dist/` directory
5. Install [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
6. After code changes, click Extensions Reloader icon (or Alt+R / Opt+Shift+R)

**Debug mode:**
- Enable via extension popup (click extension icon → toggle "Debug Mode")
- Or programmatically: `Logger.enableDebugMode()`
- Debug logs appear in browser console with "✨" prefix
- Filter console by "✨" to see only extension logs

**Common debugging patterns:**
- Check if feature activated: Look for `[FeatureName] activate called` in console
- Check API calls: Look for `[ApiService]` logs
- Check cache: Look for `[CacheService]` logs
- Inspect DOM changes: Features inject elements with `oa2-` class prefix

## Build Commands

| Command | Purpose |
|---------|---------|
| `bun start` | Install dependencies, format code, build, and start file watcher |
| `bun run dev` | Build and start watcher |
| `bun run build` | Production build (minified) |
| `bun run build:dev` | Single development build |
| `bun run build:prod` | Single production build |
| `bun run watch` | File watcher only |
| `bun test` | Run tests |

## Project Structure

**Core Architecture:**
- Manifest V3 browser extension
- Feature-based modules with shared services layer
- Entry point: `src/content.js`, controller: `src/core/Extension.js`

**Features by Page:**
- **Journal List** (`src/features/journalList/`): JournalListSync (Kriit sync), JournalSyncBanner, KriitSyncNotifier, OutComes, TahvelNewAssignmentSync
- **Single Journal** (`src/features/singleJournal/`): addFinalGrades, highlightFinalGrades, highlightMissingGrades, lastLessonNotification (with strobing), lessonDiscrepancies

**Services** (`src/services/`): ApiService, BannerService, CacheService, DomService, Logger, MessageListenerService, NavigationService, StyleService

**Assets** (`src/assets/`): Build scripts, icons (SVG→PNG conversion), styles, templates (manifest.json, icon.svg)

## Files to Avoid Reading

**Do NOT read these files unless specifically working on them:**

| File/Directory | When to Read |
|----------------|--------------|
| `src/assets/scripts/build.js` | Only when modifying build process |
| `src/assets/scripts/watch.js` | Only when modifying file watching |
| `src/assets/templates/manifest.json` | Only when changing extension permissions/config |
| `.eslintrc.json` | Only when modifying linting rules |
| `.editorconfig` | Only when changing editor settings |
| `package.json` | Only when adding/removing dependencies or scripts |
| `dist/*` | Never (generated files) |
| `node_modules/*` | Never |
| `src/popup/*` | Only when working on extension popup UI |
| Individual test files | Only when writing/fixing tests for that specific feature |

**When exploring the codebase:**
- Use the Quick Reference tables and Common Patterns section below instead of reading files
- Read only ONE similar feature file for reference, not multiple
- Trust the architecture documentation instead of reading core/* files

## Entry Points by Task Type

**Quick guide: "I need to do X, where do I start?"**

| Task | Start Here | Read These Files | Pattern to Use |
|------|-----------|-----------------|----------------|
| Add new feature to journal list page | `src/core/FeaturesRegistry.js` | One similar feature in `journalList/` | "Creating a New Feature" pattern |
| Add new feature to single journal page | `src/core/FeaturesRegistry.js` | One similar feature in `singleJournal/` | "Creating a New Feature" pattern |
| Add visual banner/notification | Use BannerService | `src/services/BannerService.js` | "Creating Banners" pattern |
| Add inline notification badge | Create custom DOM element | See "Creating Banners" pattern | Custom notification pattern |
| Fix API call issue | Check browser console first | `src/services/ApiService.js` | "Making API Calls" pattern |
| Fix caching issue | Clear cache via popup first | `src/services/CacheService.js` | Cache expiration config |
| Add new API endpoint | No new file needed | Use `this.api.tahvel.get()` | "Making API Calls" pattern |
| Fix date formatting | Use existing pattern | See "Date Formatting Pattern" | Don't read files |
| Add strobing/animation | Add CSS animation | See `LastLessonNotificationFeature.js:186-214` | Keyframe injection pattern |
| Fix feature not activating | Check URL pattern | Feature's `shouldActivate()` method | Debug with console logs |
| Add tests | Create test file | One similar test in `test/` | "Testing Pattern" |
| Fix sync logic | Start with understanding | `JournalListSync.js` (large file) | Read carefully, complex |

## Quick Reference

### File Path → Purpose Mapping

| Path | Purpose | Modification Frequency |
|------|---------|----------------------|
| `src/content.js` | Main entry point | Rarely |
| `src/background.js` | Extension reload service worker | Rarely |
| `src/core/Extension.js` | Feature initialization controller | Rarely |
| `src/core/BaseFeature.js` | Base class for features | Rarely |
| `src/core/FeaturesRegistry.js` | Feature registration | Often (when adding features) |
| `src/features/journalList/*.js` | Journal list page features | Often |
| `src/features/singleJournal/*/` | Single journal page features | Often |
| `src/services/*.js` | Shared utilities | Sometimes |
| `src/assets/scripts/*.js` | Build scripts | Rarely |
| `src/assets/templates/manifest.json` | Extension manifest template | Rarely |
| `test/**/*.test.js` | Unit tests | Often (alongside features) |
| `.eslintrc.json`, `.editorconfig` | Code style config | Rarely |

### Common URL Patterns

| Pattern | Matches | Used For |
|---------|---------|----------|
| `/journals` | Journal list page | JournalListSync, outcomes |
| `/journal/\d+/edit` | Single journal edit page | Last lesson notification, discrepancies, grades |
| `/journal/(\d+)` | Any journal page | Extract journal ID |

### Common Variable Conventions

| Pattern | Meaning | Example |
|---------|---------|---------|
| `journalId` | Journal identifier | `123` |
| `schoolId` | School identifier | `9` |
| `teacherId` | Teacher identifier | `456` |
| `entryType` | Journal entry type | `SISSEKANNE_I` (independent work), `SISSEKANNE_P` (practical work), `SISSEKANNE_L` (lesson) |
| `comparisonDate` | Date for comparisons (YYYY-MM-DD) | `2024-11-07` |

### Service Access Patterns

| Service | Access Pattern | Common Use |
|---------|---------------|------------|
| Logger | `import Logger from '../services/Logger.js'` | `Logger.debug()`, `Logger.error()` |
| API (Tahvel) | `this.api.tahvel` (in features) | `this.api.tahvel.get('/journals/123')` |
| API (Kriit) | `this.api.kriit` (in features) | `this.api.kriit.post('/api/subjects')` |
| Cache | `import { cacheService } from '../services/CacheService.js'` | Auto-used by ApiService |
| DOM | `import { domService } from '../services/DomService.js'` | `domService.waitForElement()` |
| Banner | `import { bannerService } from '../services/BannerService.js'` | `bannerService.show()` |

## Common Patterns

### Creating a New Feature

**Template:**
```javascript
import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'

export default class MyFeature extends BaseFeature {
  constructor() {
    super(
      'myFeatureName',           // Unique name
      /\/journal\/(\d+)\/edit/,  // URL pattern (string, regex, or function)
      ['.required-selector']     // Optional: Required DOM selectors
    )
    this.name = 'MyFeature'
  }

  async activate() {
    if (Logger.isDebugMode()) Logger.debug('[MyFeature] activate called')

    // Your feature logic here
    const journalId = this.#extractJournalId()
    const data = await this.api.tahvel.get(`/journals/${journalId}`)

    // Inject UI or modify DOM
    this.#showUI(data)
  }

  onDeactivate() {
    // Cleanup: remove injected elements, observers, etc.
    document.getElementById('my-feature-element')?.remove()
    super.onDeactivate()
  }

  #extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  #showUI(data) {
    // Create and inject DOM elements
  }
}
```

**Registration (in `src/core/FeaturesRegistry.js`):**
```javascript
import MyFeature from '../features/path/to/MyFeature.js'

export function getFeatures() {
  return [
    // ... existing features
    new MyFeature()
  ]
}
```

### Waiting for DOM Elements

```javascript
// In activate() method
const element = await this.waitForElement('.target-selector', 10000) // 10s timeout
if (!element) {
  Logger.error('[MyFeature] Required element not found')
  return
}
```

### Making API Calls with Caching

```javascript
// GET with cache (default 1min expiration)
const data = await this.api.tahvel.get('/journals/123')

// GET with custom cache expiration (24 hours)
const data = await this.api.tahvel.get(
  '/journals/123',
  {},
  { cache: true, cacheExpiration: 864e5 }
)

// POST (no caching)
const result = await this.api.kriit.post('/api/subjects', { data })

// Disable cache for specific request
const fresh = await this.api.tahvel.get('/journals/123', {}, { cache: false })
```

### Error Handling Pattern

```javascript
async activate() {
  try {
    // Feature logic
    const data = await this.api.tahvel.get('/endpoint')
    // ... process data
  } catch (error) {
    Logger.error('[MyFeature] Error in activate:', error)
    // Optionally show user-friendly error
    bannerService.show('Error loading feature', 'error')
  }
}
```

### Creating Banners/Notifications

```javascript
import { bannerService } from '../../../services/BannerService.js'

// Simple banner
bannerService.show('Message text', 'warning') // 'info', 'warning', 'error'

// Custom inline element
const notification = document.createElement('span')
notification.id = 'my-notification'
notification.style.cssText = `
  display: inline-block;
  background: #fff3cd;
  padding: 4px 12px;
  border-radius: 8px;
`
notification.textContent = 'My message'
targetElement.appendChild(notification)
```

### Date Formatting Pattern

```javascript
// Format date to DD.MM.YYYY
#formatDisplayDate(date) {
  const d = new Date(date)
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()
  return `${day}.${month}.${year}`
}

// Get current date in Tallinn timezone (YYYY-MM-DD)
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Tallinn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date())
```

### Testing Pattern

```javascript
import { describe, it, expect, beforeEach } from 'bun:test'
import { JSDOM } from 'jsdom'
import MyFeature from '../../../src/features/path/MyFeature.js'

describe('MyFeature', () => {
  let feature
  let dom

  beforeEach(() => {
    // Setup DOM
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    global.window = dom.window
    global.document = dom.window.document

    // Create feature instance
    feature = new MyFeature()
  })

  it('should activate on correct URL', () => {
    const url = 'https://tahvel.edu.ee/journal/123/edit'
    expect(feature.shouldActivate(url)).toBe(true)
  })
})
```

## Troubleshooting

### Feature Not Activating

**Symptoms:** Feature doesn't run on expected page

**Solutions:**
1. Check URL pattern matches current URL
   - Open browser console
   - Check for `[FeatureName] activate called` message
   - If missing, URL pattern doesn't match
2. Check required selectors (if specified in constructor)
   - Feature won't activate if required DOM elements missing
   - Use `waitForElement()` if elements load asynchronously
3. Check for JavaScript errors in console
   - Fix any errors that prevent feature initialization

### API Calls Failing

**Symptoms:** Data not loading, console shows API errors

**Solutions:**
1. Check browser console for error messages
2. For Tahvel API:
   - Verify user is logged into Tahvel
   - Check Network tab for failed requests
   - Verify endpoint URL is correct
3. For Kriit API:
   - Open extension popup → verify API URL and Key configured
   - Test with a simple GET request first
   - Check Kriit server is accessible

### Cache Issues

**Symptoms:** Stale data displayed, changes not reflected

**Solutions:**
1. Clear cache via extension popup:
   - Click extension icon
   - Click "Clear Cache" button
   - Refresh page
2. Disable cache for specific request (see "Making API Calls" pattern)
3. Check cache expiration times are appropriate

### Strobing/Animation Not Working

**Symptoms:** CSS animation doesn't play

**Solutions:**
1. Check keyframes are injected into `<head>`
2. Verify element has animation CSS property
3. Check browser DevTools → Elements → Computed tab for animation
4. Ensure condition for animation is true (e.g., `isLastLessonToday`)

### Tests Failing

**Symptoms:** `bun test` shows failures

**Common causes:**
1. **DOM not mocked properly**
   - Ensure JSDOM setup in `beforeEach()`
   - Set `global.window` and `global.document`
2. **Missing global objects**
   - Mock `chrome.storage` if feature uses it
   - Mock `window.location` if feature checks URL
3. **Async issues**
   - Use `await` for async operations
   - Use `async` in test function if needed

### Sync Not Working

**Symptoms:** Kriit sync shows errors or doesn't update

**Solutions:**
1. Check Kriit API credentials in popup
2. Check browser console for sync errors
3. Verify journal has students and assignments
4. Check network tab for failed API requests to Kriit

## Important Global Variables & Constants

### Window Variables (Feature Communication)

| Variable | Purpose | Set By | Used By |
|----------|---------|--------|---------|
| `window.__opetajaAssistentApiService` | Shared API service instance | Extension.js | Multiple features |
| `window.__lastLessonNotificationRefresh` | Refresh last lesson notification | LastLessonNotificationFeature.js | External callers |
| `window.__lastLessonNotification_independentWorkMessage` | Independent work messages | LastLessonNotificationFeature.js | DiscrepanciesTable |

### Cache Expiration Constants

| Value | Duration | Use Case |
|-------|----------|----------|
| `6e4` | 1 minute | Dynamic data (journal entries) |
| `3.6e6` | 1 hour | Semi-static data |
| `864e5` | 24 hours | Static data (timetables, school info) |

### Magic Strings

| String | Meaning | Context |
|--------|---------|---------|
| `SISSEKANNE_I` | Independent work entry | Journal entry type |
| `SISSEKANNE_P` | Practical work entry | Journal entry type |
| `SISSEKANNE_L` | Lesson entry | Journal entry type |
| `✨` | Extension log prefix | Logger service |
| `oa2-` | CSS class prefix | All injected elements |

### School ID Resolution

School ID is resolved via `getSchoolId(api, info)` from `src/lib/schoolId.js`:
1. `info.school?.id` from journal info
2. `/user` endpoint fallback
3. Returns `null` if unavailable — features skip timetable-dependent functionality

## Feature Dependencies & Interactions

### Features That Share State

| Feature A | Feature B | Shared State | Purpose |
|-----------|-----------|--------------|---------|
| LastLessonNotificationFeature | DiscrepanciesTable | `window.__lastLessonNotification_independentWorkMessage` | Pass independent work messages to table |
| All features | Extension.js | `window.__opetajaAssistentApiService` | Shared API service instance |

### Features That Call Each Other

| Caller | Called | Method | Purpose |
|--------|--------|--------|---------|
| External code | LastLessonNotificationFeature | `window.__lastLessonNotificationRefresh()` | Refresh notification after changes |

### Feature Load Order

- Features are loaded and registered in `FeaturesRegistry.js`
- All features activate simultaneously when URL matches
- No guaranteed load order (features should be independent)
- Use `window.__*` variables for cross-feature communication if needed

## Git Workflow Quick Reference

### Common Commands

```bash
# Start new feature (after creating issue #XX)
git checkout main
git pull --rebase
git checkout -b XX-feature-description

# Make changes and commit
git add .
git commit -m "Message"

# Update branch from main
git checkout main
git pull --rebase
git checkout XX-feature-description
git rebase main

# Squash merge to main (after feature complete)
git checkout main
git merge --squash XX-feature-description
git commit -m "Feature: description\nCloses #XX"
git push
git branch -D XX-feature-description

# Check out existing branch
git fetch
git checkout XX-feature-description

# View current branch and status
git branch --show-current
git status
```

### This Project's Workflow

1. Always start from `main` branch
2. Pull latest with `--rebase`
3. Create branch named `XX-description` (where XX = issue number)
4. Make commits on feature branch
5. When complete, squash merge to main
6. Delete feature branch
7. Push to remote

## Code Style & Formatting

**Style Guidelines:**
- Modern ES modules with `import`/`export` syntax
- 2-space indentation
- Class-based architecture with inheritance from BaseFeature
- Comprehensive JSDoc comments for all functions and parameters
- Service-oriented approach with singleton pattern for services
- Error handling with Logger service (using "✨" emoji prefix)
- Camel case for variables/methods, PascalCase for classes
- Private methods use `#` prefix (e.g., `#extractJournalId()`)
- DOM manipulation through DomService, URL handling through NavigationService

**Formatting Tools:**
- EditorConfig (.editorconfig) + ESLint (.eslintrc.json)
- Automatic formatting on `bun start`
- Manual: `bun run lint` (check) or `bun run lint:fix` (fix)

## Development Workflow

### Claude Workflow

When asked to change project source code:
1. Ask: "Should we create a GitHub issue for this?"
2. If yes:
   - Create issue using `gh issue create` (follow templates below)
   - Pull latest changes from origin using --rebase
   - Create branch `XX-short-descr` (XX = issue number). Do not ask the user for the name of the branch.
   - Implement and commit changes to branch
   - Ask: "Is there anything else you want to change, or should I squash merge this to main and close issue #XX?"
   - If changes needed: make additional commits
   - If complete: squash merge to main with proper commit message (see Commit Guidelines)
   - Push

### Issue Creation

```bash
gh issue create --title "Title" --body "Description"
```

**Feature:**
Title: `As a [role] I [can/want to] [action] so that [benefit]`
Body:
```
As a [role] I [can/want to] [action] so that [benefit]`

Acceptance criteria:
- Each criterion is one sentence on its own line
- Start with capital letter, describe expected behavior
- No numbering, no Given/When/Then format
- Keep simple, declarative, and testable
```

Example acceptance criteria:
```
- There is a new menu item called "Logs" in the main menu
- Clicking that takes to /logs which shows a list of events
- The most recent events are on the top
```

**Bug:**
Title: `[Brief description]`
Labels: `bug`
Body:
```
1. [Reproduction steps]
Expected: [What should happen]
Actual: [What happens]
```

### Implementation

- Branch: `XX-short-description` (XX = issue number)
- Commit following guidelines below
- Squash merge to main when complete

## Commit Guidelines

**Format:**
- Features: `As a [role] I [action] so that [benefit]\nCloses #XX`
- Fixes: `Fix: [description]\nCloses #XX`
- Refactor: `Refactor: [description]`
- Style: `Style: [description]`
- Revert: `Revert "[Original commit message]"`
- Simple: `[brief description]`

**Rules:**
- Always `Closes #XX` on separate line when resolving issues
- Optional body for complex changes:
  ```
  Fix: Return proper error message for unauthorized AJAX requests
  Closes #123

  - Changed empty array response to include 'Authorization required' message
  ```

**Good:** `Fix: Cache busting for js files\nCloses #73`, `As a student I can see my learning outcomes\nCloses #80`
**Bad:** `wip`, `fixed stuff`, `updates`
