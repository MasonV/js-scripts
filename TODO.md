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

### Open

- [ ] **Add JSON export alongside clipboard text export** `feature` SCORE: 2.0
  - Current export copies formatted text to clipboard. Add structured JSON export for programmatic analysis and cross-tool data flow.
  - Effort: 4 | Simplicity: 1 | Efficiency: 1 | Safety: 1 | Value: 3

- [ ] **Stabilize colspan fixup logic** `debt` SCORE: 2.0
  - Last 4 commits (v4.3.1–v4.3.2) are all alignment fixes for colspan handling in injectScoreColumn(). Add explicit validation that header cell count matches data cell count after injection.
  - Effort: 2 | Simplicity: 1 | Efficiency: 1 | Safety: 3 | Value: 3

- [ ] **Add settings presets save/load** `feature` SCORE: 1.8
  - Users can only have one set of scoring weights at a time. Different bundle types benefit from different weight configurations. Add naming/saving/loading/deleting presets via localStorage.
  - Effort: 2 | Simplicity: 1 | Efficiency: 1 | Safety: 1 | Value: 4

- [ ] **Add unit tests for pure scoring functions** `test` SCORE: 1.8
  - No test framework exists. Pure functions (scoring, confidence, Wilson bound, DLC classification) have zero test coverage. Add test file covering edge cases.
  - Effort: 2 | Simplicity: 1 | Efficiency: 1 | Safety: 3 | Value: 2

- [ ] **Add 'why' comments to scoring weights and thresholds** `docs` SCORE: 1.8
  - Default settings (confidenceAnchor=800, bundledPenaltyCap=10, weight defaults) lack rationale. Add block comments explaining motivation and tradeoffs for each magic number.
  - Effort: 4 | Simplicity: 1 | Efficiency: 1 | Safety: 1 | Value: 2

- [ ] **Extract pure functions into testable module** `refactor` SCORE: 1.6
  - scoreGame(), confidenceFromReviews(), classifyItem(), wilsonLowerBound() are pure functions embedded in a 1250-line monolith. Make them isolatable for testing without DOM dependencies.
  - Effort: 2 | Simplicity: 1 | Efficiency: 1 | Safety: 2 | Value: 2
