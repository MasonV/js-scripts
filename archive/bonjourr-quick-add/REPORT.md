# Bonjourr Quick Add — Project Report

**Status:** Abandoned
**Date:** 2026-03-21
**Version reached:** 1.0.0 (never deployed)

## Goal

Create a Violentmonkey userscript to simplify adding shortcuts to Bonjourr, a minimalist browser new tab extension. The script would provide a floating button and keyboard shortcut (Alt+A) that opens a modal for quickly adding links with automatic page title fetching.

## What was built

- Full userscript (`bonjourr-quick-add.user.js`) with:
  - Floating "+" FAB button with translucent, Bonjourr-matching aesthetic
  - Modal dialog with URL input and auto-title fetching via `GM_xmlhttpRequest`
  - Title resolution chain: `og:title` -> `<title>` -> hostname fallback
  - Debounced fetch on URL input, immediate fetch on Enter
  - Manual title override detection
  - Form bridge that submits through Bonjourr's native `#f_addlink` form
  - Alt+A keyboard shortcut, Escape to close
  - Toast notifications for success/error feedback
  - MutationObserver-based initialization to wait for Bonjourr's DOM
- Metadata file (`bonjourr-quick-add.meta.js`) for update checks
- README entry with install/update URLs

## Why it was abandoned

Firefox's extension security model prevents userscript managers (Violentmonkey, Tampermonkey, etc.) from injecting scripts into other extensions' pages. Bonjourr runs as a browser extension at `moz-extension://` URLs, which are isolated from content script injection by design.

The `@match moz-extension://*/index.html` pattern is syntactically valid but functionally blocked by the browser — Violentmonkey simply cannot execute on these pages regardless of configuration.

### Alternatives considered

| Approach | Why rejected |
|----------|-------------|
| Use Bonjourr's web version (`online.bonjourr.fr`) | Loses extension benefits (offline, speed, sync). Not worth switching platforms for this feature. |
| Package as a standalone Firefox extension | Disproportionate effort for a shortcut-adding tool. Extension review process, maintenance burden, and cross-extension messaging complexity. |
| Inject via Bonjourr's custom CSS field | Bonjourr's `"css"` config field is CSS-only, no JS injection point. |
| CLI tool to edit Bonjourr's config JSON | Bonjourr stores settings in `chrome.storage.sync`, not an editable file. The exported JSON is a snapshot, not a live config. |

None of the workarounds justified the effort relative to the problem (manually adding shortcuts through Bonjourr's built-in settings).

## Lessons learned

- Validate the deployment environment before building. The `moz-extension://` injection limitation should have been identified during the initial feasibility analysis, before any code was written.
- Browser extension isolation is absolute — there is no opt-in or permission that allows cross-extension content script injection in Firefox.
