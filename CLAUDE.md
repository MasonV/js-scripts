# js-scripts — Repo Guide

Monorepo of independent Tampermonkey/Greasemonkey userscripts. Vanilla JavaScript, no build step, no package manager, no bundler. Scripts run in the browser extension sandbox.

## Architecture

Each script lives in its own folder with two files:

- `<name>.user.js` — full script with Tampermonkey metadata block
- `<name>.meta.js` — metadata-only file for lightweight update checks

Scripts are single-file by design. Organize sections with visual dividers:

```js
// ═══════════════════════════════════════════════════════════════════
//  SECTION NAME
// ═══════════════════════════════════════════════════════════════════
```

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
const SCRIPT_VERSION = '1.0.0'
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
2. Bump `@version` in **both** `.user.js` and `.meta.js` — they must match. Also update the `SCRIPT_VERSION` constant in the script body.
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

## Adding a New Script

1. Create a folder: `<script-name>/`
2. Add `<script-name>.user.js` with a complete Tampermonkey metadata block (`@name`, `@version`, `@match`, `@grant GM_xmlhttpRequest`, `@connect raw.githubusercontent.com`, `@updateURL`, `@downloadURL`).
3. Add `<script-name>.meta.js` with matching metadata (no script body).
4. Include the in-page update check pattern (see above).
5. Update `README.md` with install/update URLs and a brief description.
6. Use the section divider and logging prefix conventions documented above.
