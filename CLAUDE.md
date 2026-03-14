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

## Version & Deployment

1. Edit the `.user.js` file.
2. Bump `@version` in **both** `.user.js` and `.meta.js` — they must match.
3. `@updateURL` → `.meta.js` (lightweight version check).
4. `@downloadURL` → `.user.js` (full script delivery).
5. Scripts are served via raw GitHub URLs from `main` branch. Merging to `main` is deployment.

## Testing

No test framework is set up. The scripts are heavily DOM-dependent (operating on third-party page structure), which makes traditional unit testing non-trivial.

When writing **pure functions** (math, scoring, data transformation), keep them extractable and testable. If a test framework is added later, these are the first candidates.

## Adding a New Script

1. Create a folder: `<script-name>/`
2. Add `<script-name>.user.js` with a complete Tampermonkey metadata block (`@name`, `@version`, `@match`, `@grant`, `@updateURL`, `@downloadURL`).
3. Add `<script-name>.meta.js` with matching metadata (no script body).
4. Update `README.md` with install/update URLs and a brief description.
5. Use the section divider and logging prefix conventions documented above.
