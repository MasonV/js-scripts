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

Standard implementation pattern:

```js
const SCRIPT_VERSION =
    typeof GM_info !== 'undefined' && GM_info.script?.version
        ? GM_info.script.version
        : '__DEV__'
const META_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/<name>/<name>.meta.js'
const DOWNLOAD_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/<name>/<name>.user.js'

function checkForUpdate() {
    try {
        GM_xmlhttpRequest({
            method: 'GET',
            url: META_URL + '?_=' + Date.now(),
            onload(resp) {
                if (resp.status !== 200) return
                const match = resp.responseText.match(/@version\s+(\S+)/)
                if (!match) return
                const remote = match[1]
                if (remote !== SCRIPT_VERSION) {
                    log(`Update available: v${SCRIPT_VERSION} → v${remote}`)
                    showUpdateBanner(remote)
                } else {
                    log(`Up to date (v${SCRIPT_VERSION})`)
                }
            },
            onerror() {
                warn('Update check failed (network error)')
            },
        })
    } catch (e) {
        warn('Update check unavailable:', e)
    }
}
```

Call `checkForUpdate()` at the top of the initialization block. The banner should be a fixed-position element at the top of the page that opens `DOWNLOAD_URL` on click. Cache-bust the meta fetch with `?_=` + timestamp.

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

No test framework is set up. The scripts are heavily DOM-dependent (operating on third-party page structure), which makes traditional unit testing non-trivial.

When writing **pure functions** (math, scoring, data transformation), keep them extractable and testable. If a test framework is added later, these are the first candidates.

Before publishing a userscript change, run:

```sh
node tools/check-metadata.mjs
```

This validates `.user.js` / `.meta.js` pairs while skipping archives, diagnostics, and local dev resources.

## Adding a New Script

1. Create a folder: `<script-name>/`
2. Add `<script-name>.user.js` with a complete Tampermonkey metadata block (`@name`, `@version`, `@match`, `@grant GM_xmlhttpRequest`, `@connect raw.githubusercontent.com`, `@updateURL`, `@downloadURL`).
3. Add `<script-name>.meta.js` with matching metadata (no script body). Copy the header manually from `.user.js`; do not auto-generate it.
4. Include the in-page update check pattern (see above).
5. Update `README.md` with install/update URLs and a brief description.
6. Use `templates/userscript-template.md` for standard metadata and update-check boilerplate.
7. Use the section divider and logging prefix conventions documented above.
