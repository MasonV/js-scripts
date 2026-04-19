# TODO — js-scripts

Synced from [Notion: AI Agent TODO Backlog](https://www.notion.so/faceefca3f034fd0b3177f9ef91e7ab7) on 2026-03-15.

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

- [ ] **Expand unit test coverage for pure functions** `test`
  - scoring.test.js missing coverage for scoreColor, scoreBg, ratingColor, formatBreakdown, formatTierPrice. Missing edge cases for existing tests.
  - Effort: 3 | Simplicity: 4 | Efficiency: 2 | Safety: 3 | Value: 3

- [ ] **Add $/savings stat card to header dashboard** `feature`
  - Add a stat card showing dollar savings and % saved (unowned MSRP vs bundle cost) prominently in the stats row.
  - Effort: 4 | Simplicity: 4 | Efficiency: 1 | Safety: 5 | Value: 4

- [ ] **Fix tier pricing extraction from classic view** `bug`
  - Tier prices not correctly detected. Barter uses "N for X USD" format in tier headers (e.g., "1 for 1 USD", "5 for 2.99 USD"). Current regex only matches "$X.XX". Need to parse the "N for X USD" pattern.
  - Effort: 3 | Simplicity: 3 | Efficiency: 3 | Safety: 3 | Value: 4

- [ ] **Add collapsible/hideable stat cards in header** `feature`
  - Allow users to hide individual stat cards in the header dashboard to reduce visual noise and focus on what matters to them.
  - Effort: 3 | Simplicity: 3 | Efficiency: 1 | Safety: 5 | Value: 3

- [ ] **Simplify tier pricing strip — remove unnamed tiers** `debt`
  - Tier strip shows confusing cards for tiers without prices (just dashes and game counts). Only show tiers that have detected pricing. Add a "View all tiers" toggle if needed.
  - Effort: 4 | Simplicity: 4 | Efficiency: 1 | Safety: 5 | Value: 3

- [ ] **Add spider/radar chart for score breakdown** `feature`
  - Show a visual breakdown of how each scoring dimension contributes (rating, confidence, value, bundle value, wishlist, rebundle penalty). Helps users understand why a game scored the way it did.
  - Effort: 2 | Simplicity: 2 | Efficiency: 1 | Safety: 5 | Value: 4

- [ ] **Optimize re-render for large bundles** `performance`
  - Full innerHTML rebuild on every filter/sort/search. Causes jank on 200+ game bundles.
  - Effort: 2 | Simplicity: 2 | Efficiency: 4 | Safety: 2 | Value: 3
