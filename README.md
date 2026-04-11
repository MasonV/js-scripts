# js-scripts

Monorepo of independent Tampermonkey/Greasemonkey userscripts. Vanilla JavaScript, no build step.

<a id="scripts"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Scripts  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

- [Utility](#utility)
  - [`auto-focus-search/`](#auto-focus-search)
  - [`llm-stats-show-all/`](#llm-stats-show-all)
  - [`yourtube/`](#yourtube)
- [Gaming](#gaming)
  - [`barter-bundle-scorer/`](#barter-bundle-scorer)
  - [`fanatical-autoclaim/`](#fanatical-autoclaim)
  - [`lichess-declutter/`](#lichess-declutter)
- [Work](#work)
  - [`google-address-autocomplete-ca/`](#google-address-autocomplete-ca)
  - [`odoo-heic-to-jpeg/`](#odoo-heic-to-jpeg)
- [Music streaming](#music-streaming)
  - [`yt-music-redirect/`](#yt-music-redirect)
  - [`ytm-desktop-handoff/`](#ytm-desktop-handoff)
- [Archived](#archived)
  - [`archive/bonjourr-quick-add/`](#archivebonjourr-quick-add)

<a id="utility"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Utility  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

### `auto-focus-search/`

A global userscript that automatically detects and focuses search input fields on any webpage, so you can start typing immediately without clicking.

**Features:**

- Cascading search field detection using semantic roles, input types, name attributes, placeholders, aria-labels, and common IDs/classes
- Dynamic detection via MutationObserver for search boxes that appear after page load (modals, SPAs, Ctrl+K dialogs)
- SPA-aware — re-triggers on `pushState`/`popstate`/`hashchange` navigation
- Safety checks — never steals focus from inputs you're already typing in, respects pages that auto-focus their own search
- Floating indicator with settings popover — appears briefly when a field is focused, click to toggle per-site enable/disable
- Keyboard shortcuts: `Alt+Shift+S` to toggle on current site, `Alt+Shift+N` to cycle through multiple search inputs
- Per-site exclusion list stored in localStorage

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/auto-focus-search/auto-focus-search.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/auto-focus-search/auto-focus-search.meta.js`

---

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

---

### `yourtube/`

A unified userscript for [YouTube](https://www.youtube.com) — "YouTube without the garbage." v1.0.0 is a scaffolding milestone: the shared duration parser is in place and the subscription-feed duration filter is registered as the first feature module, with DOM detection and UI landing in follow-up commits.

**Features:**

- Pure duration parser / formatter (HH:MM:SS ↔ seconds) — extractable, testable utility shared across features
- Feature-module architecture — each feature is route-scoped and re-runs on `yt-navigate-finish` so it activates/deactivates as you move between YouTube pages
- Duration Filter module (subscription feed) — scaffolded in v1.0.0; full DOM detection, filtering, and settings UI land in subsequent versions
- Per-feature logging prefixes (`[YourTube]`, `[YourTube/Duration]`) for easy console scanning
- Shared versioned settings blob (`yourtube_settings_v1`) keyed per-feature

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/yourtube/yourtube.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/yourtube/yourtube.meta.js`

<a id="gaming"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Gaming  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

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

---

### `fanatical-autoclaim/`

A userscript for [Fanatical](https://www.fanatical.com) order pages that bulk-reveals and bulk-redeems Steam keys.

**Features:**

- Floating control panel on order pages with Reveal All, Redeem All, and combined Reveal + Redeem buttons
- Sequential key reveal with delays to avoid API rate limits
- Redeems keys via existing "Redeem on Steam" buttons, with fallback to `steam://registerkey/` URLs
- Status display showing current progress and game names
- Waits for React SPA to render before activating

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.meta.js`

---

### `lichess-declutter/`

A userscript for [lichess.org](https://lichess.org) that strips the homepage down to essentials for casual play.

**Features:**

- Removes streamers, tournaments, live game preview, donate/swag, and announcement feed
- Filters time controls to only 2+1 Bullet, 10+0 Rapid, and 30+0 Classical
- Removes lobby/correspondence tabs and game creation buttons (lobby, challenge, computer)
- Moves live player counter into the header bar
- Reflows layout to prioritize puzzle of the day and blog articles

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/lichess-declutter/lichess-declutter.meta.js`

<a id="work"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Work  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

### `google-address-autocomplete-ca/`

A userscript for [Odoo](https://www.odoo.com) SaaS instances that restricts Google Places Autocomplete results to Canada with a location bias toward Southern Ontario.

**Features:**

- Wraps `google.maps.places.Autocomplete` constructor to inject `componentRestrictions: { country: "ca" }`
- Wraps `AutocompleteService.getPlacePredictions` with the same restriction plus a circular location bias (centered on Southern Ontario, 150 km radius)
- Non-destructive — does not override restrictions if already present
- Polls until `google.maps.places` is loaded before patching

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/google-address-autocomplete-ca/google-address-autocomplete-ca.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/google-address-autocomplete-ca/google-address-autocomplete-ca.meta.js`

---

### `odoo-heic-to-jpeg/`

A userscript for [Odoo](https://www.odoo.com) that converts HEIC/HEIF images to JPEG client-side before upload. Solves the browser HEIC rendering gap on Odoo SaaS where server-side conversion is blocked by sandbox restrictions.

**Features:**

- Automatically detects HEIC/HEIF files in file picker and drag-and-drop uploads
- Converts to JPEG client-side using heic2any before Odoo processes the upload
- Toast notification confirms conversion count
- Graceful fallback — if conversion fails, the original file is uploaded rather than silently lost

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/odoo-heic-to-jpeg/odoo-heic-to-jpeg.meta.js`

<a id="music-streaming"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Music streaming  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

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

---

### `ytm-desktop-handoff/`

A userscript for [YouTube Music](https://music.youtube.com) that adds a single-click pill button to hand off the current track/playlist to the [YouTube Music Desktop App](https://github.com/ytmdesktop/ytmdesktop) via its `ytmd://` custom protocol. Completes the YouTube → YouTube Music → YTMDesktop chain when paired with `yt-music-redirect/`.

**Features:**

- Single-click pill button anchored in the top-right of `/watch` pages — no menus, no modes
- Launches the current track in YTMDesktop and pauses the browser tab so the desktop app plays alone
- Uses a hidden iframe to trigger the `ytmd://play/<VideoId>[/<PlaylistId>]` protocol without navigating the tab
- SPA-aware — mounts/unmounts on `yt-navigate-finish` so the pill only appears when there's a track to hand off
- Requires [YouTube Music Desktop App](https://github.com/ytmdesktop/ytmdesktop) installed (registers the `ytmd://` protocol handler)

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-desktop-handoff/ytm-desktop-handoff.meta.js`

<a id="archived"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Archived  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

Scripts that are no longer functional or maintained. Kept in the repo for reference — not served via raw URLs.

### `archive/bonjourr-quick-add/`

A userscript for [Bonjourr](https://bonjourr.fr) new tab pages that provides a quick interface for adding shortcuts with automatic page title fetching. **Not functional** — Firefox's extension security model blocks userscript injection into `moz-extension://` pages. Kept in the repo in case browser APIs or Bonjourr change to make this viable. See [`REPORT.md`](archive/bonjourr-quick-add/REPORT.md) for the full post-mortem.

<a id="update-workflow"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Update workflow  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

1. Edit the script's `.user.js` file.
2. Bump `@version` in **both** the `.user.js` and `.meta.js` files (and the `SCRIPT_VERSION` constant in the script body). They must all match.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.
4. Merge to `main` — scripts are served via raw GitHub URLs from the `main` branch, so merging is deployment.
