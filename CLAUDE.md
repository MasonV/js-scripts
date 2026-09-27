# js-scripts — Repo Guide

Monorepo of independent Tampermonkey/Greasemonkey userscripts. Vanilla JavaScript, no build step, no package manager, no bundler. Scripts run in the browser extension sandbox.

## Architecture

Each script lives in its own folder with two files:

- `<name>.dev.resources/` or `<name>.dev.res/` — local resources used during development (e.g., source HTML captures, screenshots); ignored by git by default
- `<name>.user.js` — full script with Tampermonkey metadata block
- `<name>.meta.js` — metadata-only file for lightweight update checks
- `<name>.todo.md` — list of things to do, in Markdown format
- `diagnostics/` — optional per-script folder for throwaway/debug userscripts that are not normal install targets
Scripts are single-file by design. Organize sections with visual dividers:

```js
// ═══════════════════════════════════════════════════════════════════
//  SECTION NAME
// ═══════════════════════════════════════════════════════════════════
```

## Core Principles

These apply to every script in this repo. When in doubt, re-read these before making a design call.

**Natural flow.** Controls should read like a sentence when scanned top-to-bottom. Group related controls. Put the most common action first. A user seeing the UI for the first time should be able to guess what each control does without reading docs.

**Obvious execution.** Every control says what it does in plain language. No jargon, no hidden modes, no settings whose meaning requires reading the source. The button label is the contract.

**Show the result.** When input needs parsing (durations, regexes, URLs), echo the parsed interpretation next to the input. The user should never have to guess whether the script understood them.

**Positive phrasing.** Prefer "Show / Hide" over "Don't show." Prefer enabled toggles over inverted ones. Avoid double negatives.

**Icon + text, never icon alone.** Glyphs are memory aids, not replacements for labels. Every button with an icon also has a text label.

**Defaults that do no harm.** A fresh install behaves conservatively — hide nothing the user didn't ask to hide, never lose data, never surprise. Destructive actions (reset to defaults, delete, etc.) get a distinct visual treatment (red) and a confirmation.

**Delight is allowed.** Within the above constraints, playful visual touches (circuit-breaker toggles, glowing LEDs, satisfying animations) are encouraged. Serious tools can still be fun.

## Conventions

### Logging

`console.log/warn/error` is the correct logging approach here — there is no logger library in the userscript environment. This is an intentional exception to the global "no raw console.log" rule.

Prefix all log messages with the script name in brackets:

```js
console.log('[BVG Scorer] Found 12 games.');
console.warn('[BVG Scorer] No game table found.');
console.error('[BVG Scorer] Error:', e);
```

For verbose per-item logs, use a shorter prefix: `[BVG]`.

New scripts should follow the same `[Script Name]` prefix pattern.

### Persistence

Use `localStorage` with versioned key names (e.g., `bvg_scorer_settings_v2`). When the schema changes, bump the suffix and let old keys silently expire. Use `GM_addStyle()` for CSS injection to bypass CSP.

### DOM Patterns (Barter Bundle Scorer)

- **Right-to-left cell scanning** — column positions aren't fixed; scan from the right edge where MSRP, reviews, and rating are reliably ordered.
- **Paired row groups** — Barter uses `rowspan=2` (game row + bargraph row). Always move these as a unit during sorting or DOM manipulation.
- **Colspan fixup** — when inserting a new column (e.g., Score), decrement `colspan` on spanning header cells rather than adding new `<td>`s.

### In-Page Update Check

All scripts should include an in-page update check that runs on load. This uses `GM_xmlhttpRequest` to fetch the `.meta.js` from GitHub, compares `@version`, and shows a clickable banner if an update is available. Required metadata grants:

```
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
```

**Sandbox caveat:** Any `@grant` other than `none` puts the script in Tampermonkey's sandbox. If the script also accesses page-context globals (e.g., YouTube's `ytInitialPlayerResponse`), add `// @grant unsafeWindow` and use `unsafeWindow` instead of `window` for those accesses.

**Do not hand-write this block.** It lives in one place — `tools/update-check.template.js` — and is copied into each script by `tools/sync-blocks.mjs` (`tools/sync-update-check.mjs` still works as an alias). In the `.user.js`, mark the region and let the tool fill it:

```js
// <update-check>
// </update-check>
```

Then run:

```sh
node tools/sync-blocks.mjs
```

The generated block owns `UPDATE_BANNER_ID`, `META_URL`, `DOWNLOAD_URL`, `checkForUpdate()` and `showUpdateBanner()`. It expects two constants to already exist in the enclosing scope:

- `SCRIPT_VERSION` — read from `GM_info.script.version`, falling back to `'__DEV__'`
- `LOG_PREFIX` — e.g. `'[Script Name]'`; the banner strips the brackets to name the script

Everything else is handled for you: the update URLs are read from `GM_info.script.updateURL`/`downloadURL` (with literal fallbacks for Greasemonkey), versions are compared numerically so a local build ahead of `main` never nags, dev builds skip the check entirely, the banner de-duplicates itself, and it carries a `✕ Dismiss` control scoped to the session and the offered version.

Call `checkForUpdate()` at the top of the initialization block. `node tools/check-metadata.mjs` fails the build if a script is missing the markers, never calls `checkForUpdate()`, or has let its block drift from the template.

### Shared Blocks

Code that more than one script needs is kept once in `tools/blocks/` and copied in by the same tool, `node tools/sync-blocks.mjs`, using the same marker pattern (`// <block-name>` / `// </block-name>`). Unlike `update-check`, these are opt-in: a script gets a block only if it carries that block's markers. Never edit a generated region in a `.user.js` — change the template and re-sync. Each template's header lists what it expects from the host script.

| Block | Provides | Host must define / grant |
| --- | --- | --- |
| `autoclaim-kit` | `sleep`, `waitFor`, visible-button lookup, `maskKey`/`normalizeKey`; the floating panel (`buildPanelShell`, `createStatusLine`, `updateStatus`, `createDelayInput`, `setControlsEnabled`, `removePanel`) and its base CSS (`injectPanelStyles`) | `UI_PREFIX` (e.g. `'lac'` → `#lac-panel`); `@grant GM_addStyle` |
| `steam-redeem` | `STEAM_KEY_RE`, `steamRedeemUrl(key)`, `findSteamKeys()` | nothing |
| `gog-redeem` | Store side `sendToGogRedeem(url, game)`; gog.com side `runGogRedemption()` (Continue → Redeem, exactly once, "Ask first" by default); `isGogHost()` | `autoclaim-kit`, `KEY_PREFIX`, `log`, `warn`, `checkForUpdate`; `@match https://www.gog.com/*`; `@grant GM_getValue`, `GM_setValue`, `GM_deleteValue` |

Place `autoclaim-kit` before any block that uses it. Changing a template changes every script that includes it, so each of those scripts needs its own version bump in the same commit.

Adding a block: write `tools/blocks/<name>.template.js` (tab-indented; the tool re-indents it to the host file), register it in `BLOCKS` in `tools/sync-blocks.mjs`, and cover its pure functions in `tools/sync-blocks.test.mjs`. That file evaluates the real template text, so its tests can't drift from the shipped code.

## Version & Deployment

**Every commit that changes a script MUST bump the version.** No exceptions. This is how Tampermonkey detects updates — if the version doesn't change, users don't get the fix.

1. Edit the `.user.js` file.
2. Bump `@version` in **both** `.user.js` and `.meta.js` — they must match. `SCRIPT_VERSION` reads from `GM_info.script.version`; do not hard-code it.
3. Use semver: patch for bug fixes, minor for new features, major for breaking changes.
4. `@updateURL` → `.meta.js` (lightweight version check).
5. `@downloadURL` → `.user.js` (full script delivery).
6. Scripts are served via raw GitHub URLs from `main` branch. Merging to `main` is deployment.

## Git Workflow

- **One PR per logical change.** Don't merge a PR and then push more commits to the same branch — create a new branch/PR for follow-up work.
- **Don't push to a merged branch.** If a PR is already merged and you have more changes, branch off `main` fresh.
- Before creating a PR, verify the branch is up to date with `main` and all intended commits are included.

## Testing

The scripts are heavily DOM-dependent (operating on third-party page structure), so most of the code isn't unit-testable. **Pure functions** (math, scoring, data transformation) are the exception — keep them extractable and cover them.

Tests use the built-in Node runner, no dependencies:

```sh
node --test barter-bundle-scorer/scoring.test.js
node --test tools/sync-blocks.test.mjs
node --test prime-video-filter/logic.test.js
```

`prime-video-filter/logic.test.js` evaluates the userscript's own `PURE LOGIC` section, so it can't drift. `scoring.test.js` instead mirrors the pure scoring functions out of the userscript, because there's no module system to import them through. **When you change the MATH or SCORING sections of `barter-bundle-scorer.user.js`, update the copies in the test file too** — nothing enforces this automatically yet.

Before publishing a userscript change, run:

```sh
node tools/check-metadata.mjs
```

This validates `.user.js` / `.meta.js` pairs — matching metadata, correct update/download URLs, a wired-up update check, no unused `@grant`s, and no drift in the generated update-check block — while skipping archives, diagnostics, and local dev resources.

## Adding a New Script

1. Create a folder: `<script-name>/`
2. Add `<script-name>.user.js` with a complete Tampermonkey metadata block (`@name`, `@version`, `@match`, `@grant GM_xmlhttpRequest`, `@connect raw.githubusercontent.com`, `@updateURL`, `@downloadURL`).
3. Add `<script-name>.meta.js` with matching metadata (no script body). Copy the header manually from `.user.js`; do not auto-generate it.
4. Define `SCRIPT_VERSION` and `LOG_PREFIX`, add the `// <update-check>` / `// </update-check>` markers, and run `node tools/sync-blocks.mjs` to fill them in. Add markers for any shared blocks the script needs (see Shared Blocks). Call `checkForUpdate()` from the init block.
5. Update `README.md` with install/update URLs and a brief description.
6. Use `templates/userscript-template.md` for standard metadata boilerplate.
7. Use the section divider and logging prefix conventions documented above.
8. Run `node tools/check-metadata.mjs` — it should report `ok` before you commit.
