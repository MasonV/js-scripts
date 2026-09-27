# js-scripts

Monorepo of independent Tampermonkey/Greasemonkey userscripts. Vanilla JavaScript, no build step.

<a id="scripts"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Scripts  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

- [Utility](#utility)
  - [`auto-focus-search/`](#auto-focus-search)
  - [`yourtube/`](#yourtube)
- [AI chat](#ai-chat)
  - [`ai-chat-widescreen/`](#ai-chat-widescreen)
- [Gaming](#gaming)
  - [`barter-bundle-scorer/`](#barter-bundle-scorer)
  - [`fanatical-autoclaim/`](#fanatical-autoclaim)
  - [`luna-autoclaim/`](#luna-autoclaim)
  - [`itch-bundle-autoclaim/`](#itch-bundle-autoclaim)
- [Work](#work)
  - [`odoo-heic-to-jpeg/`](#odoo-heic-to-jpeg)
- [Music streaming](#music-streaming)
  - [`yt-music-redirect/`](#yt-music-redirect)
  - [`ytm-desktop-handoff/`](#ytm-desktop-handoff)
  - [`ytm-data-panel/`](#ytm-data-panel)
- [Video streaming](#video-streaming)
  - [`prime-video-filter/`](#prime-video-filter)
- [Archived](#archived)
  - [`archive/bonjourr-quick-add/`](#archivebonjourr-quick-add)
  - [`archive/google-address-autocomplete-ca/`](#archivegoogle-address-autocomplete-ca)
  - [`archive/lichess-declutter/`](#archivelichess-declutter)
  - [`archive/llm-stats-show-all/`](#archivellm-stats-show-all)

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

<a id="ai-chat"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  AI chat  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

### `ai-chat-widescreen/`

A userscript for [ChatGPT](https://chatgpt.com), [Claude](https://claude.ai), and [Gemini](https://gemini.google.com) that widens the narrow chat column to fit the monitor you actually have.

**Features:**

- Per-site width, saved separately — a width that reads well on ChatGPT isn't the one that reads well on Gemini
- Slider from 50% to 100% of the window, with `Comfortable` / `Wide` / `Full` presets, and a live readout of the width in pixels (`≈ 1120 px of chat · 80% of this 1400 px window · site default 768 px`)
- Live preview — the page resizes as the slider moves, so the width you pick is the width you can see
- Optional "match the input box", so the composer can follow the thread or keep the site's own width
- Selector-light engine — walks up from a message (or the composer) and widens whatever the site capped along the way, so churn in generated class names costs at most one anchor
- Tables and code blocks follow the column too — where a site pinches its own table wrapper (Gemini clips wide tables mid-word), the wrapper is grown to match; a table that fits is left exactly as the site drew it
- Never narrower than the stock column, whatever the window size
- `Alt+Shift+W` toggles widescreen; switching it off leaves no trace of the script on the page
- Floating pill with an LED that reads on or off at a glance, and a two-step reset

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/ai-chat-widescreen/ai-chat-widescreen.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/ai-chat-widescreen/ai-chat-widescreen.meta.js`

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
- Waits for React SPA to render before activating, and follows in-site navigation so the panel appears on order pages without a reload

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.meta.js`

---

### `luna-autoclaim/`

A userscript for [Amazon Luna](https://luna.amazon.com) claim pages that opens available Prime Gaming claim pages and redeems exposed keys with optional per-store filtering.

**Features:**

- Floating control panel on Luna claim pages with reveal/open and auto-claim controls
- Opens claim pages in background tabs with configurable pacing
- Auto-claim handoff via URL flag so newly opened claim tabs can continue the flow
- Store detection for Amazon Games, Epic Games, GOG, Legacy Games, and Microsoft Store — a claim for a store it can't identify is refused, never guessed
- GOG: follows the "Claim code" link to gog.com in the same tab, then clicks Continue and (after asking, or automatically) Redeem exactly once
- Each claim is checked for a success signal instead of assumed; unconfirmed claims are flagged in red
- Per-store enable/disable settings persisted in `localStorage`
- Update banner using the repo's metadata check pattern

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js`

---

### `itch-bundle-autoclaim/`

A userscript for [itch.io](https://itch.io) bundle download pages that claims all unclaimed games in bulk, automatically paginating through every page of the bundle.

Script refined from the following existing (and somewhat functional) scripts
https://greasyfork.org/en/scripts/427686-itch-io-bundle-to-library
https://greasyfork.org/en/scripts/405532-itch-io-autoclaim

**Features:**

- Claims all unclaimed games on the current page via `fetch()` POST — no DOM clicking, no page flicker
- Automatically advances to the next page after finishing each page and resumes claiming seamlessly
- Survives page navigation using `sessionStorage` so the run continues uninterrupted across as many pages as the bundle has
- Stops automatically when no claimable games are found (end of bundle)
- Floating dark panel with "Claim All Pages" (full run) and "Claim This Page" (single page) buttons
- Live status line showing current game name and position (e.g. "Claiming 3/12: Celeste")
- Running claimed-total counter persisted across pages

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.meta.js`

<a id="work"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Work  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

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

---

### `ytm-data-panel/`

A userscript for [YouTube Music](https://music.youtube.com) that fills the empty space on `/watch` pages with a data-rich floating panel — the kind of info that's normally only on the YouTube page, surfaced directly in YTM.

**Features:**

- Floating, collapsible panel anchored in the top-right of `/watch` pages (collapsed state persists in `localStorage`)
- Overview section — title, author, view count, length, publish date, and category
- **Auto-detected chapters** — parses timestamp lines (`0:00 Intro`, `1:23 Verse`, `1:23:45 Outro`) out of the YouTube description and renders a clickable list that seeks the YTM player
- Tag chips — every keyword on the video, rendered as chips
- Full description text, preserving line breaks
- Reads YTM's in-page `ytInitialPlayerResponse` blob (no external network fetches) via `unsafeWindow`
- SPA-aware — waits for `ytInitialPlayerResponse` to catch up with the current URL after `yt-navigate-finish` before rendering, so you don't see stale data from the previous track

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-data-panel/ytm-data-panel.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/ytm-data-panel/ytm-data-panel.meta.js`

<a id="video-streaming"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Video streaming  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

### `prime-video-filter/`

A userscript for [Prime Video](https://www.primevideo.com) that removes titles you don't want from storefront rows, search results and your watchlist. Hidden titles are removed so the rest of the row closes up.

**Features:**

- **Hide titles not included with Prime** — rent, buy, and paid-channel titles. Uses the card's entitlement marker and falls back to its labels. A title the script can't check stays visible.
- **Hide titles you've watched** — from each card's progress bar, with an adjustable "counts as watched at" threshold (default 90%)
- **Hide low-rated titles** — below an IMDb rating you choose (default 7.0). Ratings are read from the card when it shows one; otherwise from the title's detail page, fetched two at a time, only for cards near the screen, and cached for 14 days. Titles with no rating stay unless you turn on "Hide titles with no IMDb rating".
- Hide rows with nothing left, so an all-paid row doesn't leave a bare heading
- Floating launcher showing how many titles are hidden; the panel explains the count (e.g. "Hiding 23 of 140 titles — 12 not included, 6 watched, 5 rated below 7.0")
- `Alt+Shift+F` pauses and resumes filtering so you can see everything
- Every filter is off on a fresh install
- Label matching is English-only; the entitlement marker and progress bars work in any language

**Install / download:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/prime-video-filter/prime-video-filter.user.js`

**Metadata update checks:**

`https://raw.githubusercontent.com/MasonV/js-scripts/main/prime-video-filter/prime-video-filter.meta.js`

<a id="archived"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Archived  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

Scripts that are no longer functional or maintained. Kept in the repo for reference — not served via raw URLs.

### `archive/bonjourr-quick-add/`

A userscript for [Bonjourr](https://bonjourr.fr) new tab pages that provides a quick interface for adding shortcuts with automatic page title fetching. **Not functional** — Firefox's extension security model blocks userscript injection into `moz-extension://` pages. Kept in the repo in case browser APIs or Bonjourr change to make this viable. See [`REPORT.md`](archive/bonjourr-quick-add/REPORT.md) for the full post-mortem.

### `archive/google-address-autocomplete-ca/`

A userscript for [Odoo](https://www.odoo.com) SaaS instances that restricted Google Places Autocomplete results to Canada with a location bias toward Southern Ontario. **No longer maintained.**

### `archive/lichess-declutter/`

A userscript for [lichess.org](https://lichess.org) that stripped the homepage down to essentials for casual play. **No longer maintained.**

### `archive/llm-stats-show-all/`

A userscript for [llm-stats.com](https://llm-stats.com) leaderboard pages that auto-paginated through all models and displayed them in a single table. **No longer maintained.**

<a id="update-workflow"></a>

---

<h2 align="center">━━━━━━━━━━━━━━━━━━━━━━━  Update workflow  ━━━━━━━━━━━━━━━━━━━━━━━</h2>

---

1. Edit the script's `.user.js` file.
2. Bump `@version` in **both** the `.user.js` and `.meta.js` files. Copy the metadata block manually; `SCRIPT_VERSION` reads from `GM_info.script.version`.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.
4. Run `node tools/check-metadata.mjs` before publishing.
5. Merge to `main` — scripts are served via raw GitHub URLs from the `main` branch, so merging is deployment.

For new scripts or repeated boilerplate, see [`templates/userscript-template.md`](templates/userscript-template.md).
