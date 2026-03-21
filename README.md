# js-scripts

Monorepo of independent Tampermonkey/Greasemonkey userscripts. Vanilla JavaScript, no build step.

## Scripts

### `barter-bundle-scorer/`

A userscript for [Barter.vg](https://barter.vg) bundle pages that scores each game and provides a side-panel evaluation of the overall bundle.

**Features:**

- Per-game scoring (0–100) based on Steam rating, review count, MSRP, rebundle frequency, and wishlist status
- Bundle-level ratings: top-N average, depth score, and personal score (excluding owned games)
- Deal quality metric (unowned MSRP vs. bundle cost)
- Side evaluation panel with score histogram, top picks, and per-tier breakdowns
- Automatic owned-game detection (via Barter's library indicator) with manual toggle
- DLC / soundtrack / artbook detection — excluded from bundle scores
- Tiered bundle support with per-tier average and best scores
- Review column split (separate # and Rating columns)
- All-column sorting (group-aware, preserving paired bargraph rows)
- Configurable weights, MSRP cap, confidence anchor, and Wilson-adjusted rating mode
- One-click "Copy Summary" to clipboard
- Settings persist in `localStorage`

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.meta.js`

### `llm-stats-show-all/`

A userscript for [llm-stats.com](https://llm-stats.com) leaderboard pages that auto-paginates through all models and displays them in a single table.

**Features:**

- Automatically clicks through all pagination pages, collecting every model row
- Replaces the paginated table with a single view of all models
- Progress banner with percentage indicator during loading
- Deduplicates rows to handle any overlap between pages
- Hides pagination controls once all models are loaded

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/llm-stats-show-all/llm-stats-show-all.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/llm-stats-show-all/llm-stats-show-all.meta.js`

### `bonjourr-quick-add/`

A userscript for [Bonjourr](https://bonjourr.fr) new tab pages that provides a quick interface for adding shortcuts with automatic page title fetching.

**Features:**

- Floating "+" button and Alt+A keyboard shortcut to open the add-link modal
- Automatic page title detection (og:title, then `<title>`, then hostname fallback)
- Submits through Bonjourr's native add-link form for full compatibility
- Works on Chrome/Firefox extensions and the online web version

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/bonjourr-quick-add/bonjourr-quick-add.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/bonjourr-quick-add/bonjourr-quick-add.meta.js`

## Update workflow

1. Edit `barter-bundle-scorer/barter-bundle-scorer.user.js`.
2. Bump `@version` in both script files under `barter-bundle-scorer/`.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.
