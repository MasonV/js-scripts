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

## Update workflow

1. Edit `barter-bundle-scorer/barter-bundle-scorer.user.js`.
2. Bump `@version` in both script files under `barter-bundle-scorer/`.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.
