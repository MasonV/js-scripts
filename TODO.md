# TODO — js-scripts

Synced from [Notion: AI Agent TODO Backlog](https://www.notion.so/faceefca3f034fd0b3177f9ef91e7ab7) on 2026-03-14.

---

## barter-bundle-scorer

### Done

- [x] **Fix XSS vulnerability in banner title rendering** `bug` SCORE: 2.8
  - Game titles and tier names interpolated into innerHTML via renderBanner(). All DOM-sourced strings now passed through escHtml() before innerHTML interpolation.
  - Completed: 2026-03-13

- [x] **Add input validation to settings panel** `debt` SCORE: 2.4
  - readSettingsFromPanel() parsed numeric inputs with no bounds validation. Now validated with Number.isFinite() and clamped to min/max HTML attributes.
  - Completed: 2026-03-13

- [x] **Fix regex escape bug in DLC_KEYWORDS pattern** `bug` SCORE: 2.4
  - 'collector.s' used unescaped dot matching any character. Now uses character class for apostrophe variants.
  - Completed: 2026-03-13

- [x] **Add MutationObserver cleanup on re-run** `performance` SCORE: 2.2
  - MutationObserver in boot() watched document.body with subtree:true and never disconnected. Now stores ref in _bvgObserver and disconnects before creating new one.
  - Completed: 2026-03-13

- [x] **UI Refresh — Modern panel redesign** `feature`
  - Extracts all game data from Barter's DOM into a structured data model and renders a card-based modern panel with search, sorting, ownership toggle, tier dividers, and filter chips. Original table hidden by default with a Modern/Classic toggle to switch views. View preference persisted in localStorage.
  - Completed: 2026-03-14

- [x] **Add bounds checking to sortByColumn** `bug` SCORE: 2.4
  - sortByColumn() directly accessed td[colIdx] without bounds checking. Extracted cellText() helper with bounds guard so rows with fewer cells than expected return empty string instead of crashing the comparator.
  - Completed: 2026-03-14

- [x] **Improve review/rating detection fallback validation** `bug` SCORE: 2.4
  - Fallback scan now enforces reasonableness: rating must be 1-100, review count must be <10M. Prevents misidentifying unrelated numeric cells (app IDs, prices) as review data on malformed pages.
  - Completed: 2026-03-14

- [x] **Centralize column injection pipeline** `refactor` SCORE: 2.2
  - Created injectColumns() orchestrator that enforces correct ordering of score column, review split, tier labels, colspan fixup, and sortable headers. Includes post-injection validation that header colspan sum matches data row cell count.
  - Completed: 2026-03-14

- [x] **Add localStorage availability test and error reporting** `debt` SCORE: 2.2
  - Added startup probe for localStorage availability. All setItem calls routed through safeStorageSet() wrapper. Shows visible warning banner when storage is unavailable (incognito, quota exceeded, policy blocked). Warns once per session.
  - Completed: 2026-03-14

### Open

- [x] **Add JSON export alongside clipboard text export** `feature` SCORE: 2.0
  - Added "Export JSON" button in toolbar. Exports structured JSON with metadata (URL, date, version), bundle scores, and per-game data (title, type, score, breakdown, rating, reviews, msrp, owned, wishlisted) to clipboard.
  - Completed: 2026-03-15

- [x] **Stabilize colspan fixup logic** `debt` SCORE: 2.0
  - Obsolete: Modern UI redesign (v6.0) replaced column injection with a standalone card grid. Classic view shows the original page unmodified — no colspan manipulation needed.
  - Completed: 2026-03-15 (resolved by prior UI redesign)

- [x] **Fix DLC classification logic inconsistency** `bug` SCORE: 2.0
  - Unified both DLC-keyword and package sub-item classification paths to use a single DLC_REVIEW_THRESHOLD constant (50). Previously used >100 for keywords and <10 for packages, causing items with 10-100 reviews to be classified inconsistently.
  - Completed: 2026-03-15

- [x] **Unify view state management across classic and modern views** `refactor` SCORE: 2.0
  - Obsolete: Classic view now shows the original page as-is with no custom state. Only _gridState exists for the modern view — no dual-state problem remains.
  - Completed: 2026-03-15 (resolved by prior UI redesign)

- [x] **Add settings presets save/load** `feature` SCORE: 1.8
  - Added preset management to settings modal: save/load/delete named presets via localStorage (bvg_scorer_presets_v1). Dropdown selector with save, load, and delete buttons. Panel refreshes on preset operations.
  - Completed: 2026-03-15

- [x] **Add unit tests for pure scoring functions** `test` SCORE: 1.8
  - Added scoring.test.js with 28 tests covering clamp01, confidenceFromReviews, wilsonLowerBound, classifyItem, and scoreGame. Uses Node built-in test runner (`node --test`). Functions copied into test file since userscript has no module system.
  - Completed: 2026-03-15

- [x] **Add 'why' comments to scoring weights and thresholds** `docs` SCORE: 1.8
  - Added block comments to DEFAULT_SETTINGS explaining rationale for msrpCap ($40 indie ceiling), bundledPenaltyCap (10 = perma-bundled), confidenceAnchor (800 = conservative Bayesian anchor), each weight, and Wilson lower-bound z-score.
  - Completed: 2026-03-15

- [x] **Extract pure functions into testable module** `refactor` SCORE: 1.6
  - Added PURE FUNCTIONS — START/END markers around clamp01, escHtml, confidenceFromReviews, wilsonLowerBound. Added sync notes to SCORING and classifyItem sections pointing to scoring.test.js. Full module extraction not viable (single-file userscript, no module system).
  - Completed: 2026-03-15
