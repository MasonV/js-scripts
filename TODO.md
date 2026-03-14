# TODO

## Barter Bundle Scorer

### UI Refresh — Modern Panel Redesign

- [ ] **Scrape table data into a fresh modern panel**
  - Extract all game data (title, score, rating, reviews, MSRP, ownership, wishlist, DLC status) from Barter's DOM into a structured data model
  - Render a new standalone panel with a clean, modern look (card-based or clean table layout, better typography, color-coded tiers)
  - Hide the original Barter table by default
  - Add a toggle button to show/hide the original table for reference
  - Preserve all existing interactivity (sorting, ownership toggle, copy summary) in the new panel

### Robustness

- [ ] Add fallback handling for Barter.vg DOM layout changes (detect missing columns gracefully)
- [ ] Improve DLC/soundtrack classification — current keyword-based detection can produce false positives
- [ ] Harden tier header detection for non-standard colspan layouts

### UX Polish

- [ ] Remember sort state across page loads
- [ ] Add keyboard navigation and ARIA labels for accessibility
- [ ] Improve mobile layout below 1300px breakpoint

### Testing

- [ ] Extract pure functions (scoring math, Wilson bounds, data transforms) into testable units
- [ ] Set up a lightweight test harness (even a simple HTML page with assertions)

### Performance

- [ ] Tune MutationObserver debounce timing (currently 400ms)
- [ ] Profile scoring pass on large bundles (100+ games)

---

## Repository-Level

- [ ] Add a second userscript (next project TBD)
- [ ] Consider a shared snippet/utility pattern if scripts start sharing logic
