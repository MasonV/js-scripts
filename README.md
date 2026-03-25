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

### `bonjourr-quick-add/` *(abandoned)*

A userscript for [Bonjourr](https://bonjourr.fr) new tab pages that provides a quick interface for adding shortcuts with automatic page title fetching. **Not functional** — Firefox's extension security model blocks userscript injection into `moz-extension://` pages. Kept in the repo in case browser APIs or Bonjourr change to make this viable. See [`REPORT.md`](bonjourr-quick-add/REPORT.md) for the full post-mortem.

### `lichess-declutter/`

A userscript for [lichess.org](https://lichess.org) that strips the homepage down to essentials for casual play.

**Features:**

- Removes streamers, tournaments, live game preview, donate/swag, and announcement feed
- Filters time controls to only 2+1 Bullet and 3+2 Blitz
- Removes lobby/correspondence tabs and game creation buttons (lobby, challenge, computer)
- Moves live player counter into the header bar
- Reflows layout to prioritize puzzle of the day and blog articles

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.meta.js`

### `yt-music-redirect/`

A userscript for [YouTube](https://www.youtube.com) that automatically redirects music videos to [YouTube Music](https://music.youtube.com).

**Features:**

- Detects videos categorized as "Music" via YouTube's embedded player response
- Redirects to the equivalent YouTube Music URL (`music.youtube.com/watch?v=...`)
- Handles both initial page loads and YouTube's SPA client-side navigation
- Fallback fetch for cases where the player response is stale after navigation

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/yt-music-redirect/yt-music-redirect.meta.js`

## Update workflow

1. Edit `barter-bundle-scorer/barter-bundle-scorer.user.js`.
2. Bump `@version` in both script files under `barter-bundle-scorer/`.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.
