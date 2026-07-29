# Userscript Template Notes

This repo intentionally ships each userscript as one installable file. Prefer copying small shared components into the target script over using `@require`; that keeps raw GitHub install URLs simple and avoids an external runtime dependency.

## Metadata Pair

Keep the metadata block in `<name>.user.js` and `<name>.meta.js` identical except that the `.meta.js` file has no script body. Copy it manually after metadata changes; this repo intentionally does not auto-generate metadata files.

```js
// ==UserScript==
// @name         Example Script
// @namespace    example-script
// @version      1.0.0
// @description  Plain-language description of the script
// @match        https://example.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/example-script/example-script.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/example-script/example-script.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==
```

## Standard Constants

Only these two are hand-written. The update check supplies its own constants.

```js
const LOG_PREFIX = '[Example Script]'
const SCRIPT_VERSION =
  typeof GM_info !== 'undefined' && GM_info.script?.version
    ? GM_info.script.version
    : '__DEV__'
```

## Standard Update Check

Do not copy this block between scripts — that is how `yourtube` ended up shipping without one. The single source of truth is `tools/update-check.template.js`. In the script, leave a marked region:

```js
// <update-check>
// </update-check>
```

Then fill it in:

```sh
node tools/sync-update-check.mjs
```

The generated code defines `UPDATE_BANNER_ID`, `META_URL`, `DOWNLOAD_URL`, `checkForUpdate()` and `showUpdateBanner()`, and reads the `LOG_PREFIX` and `SCRIPT_VERSION` declared above. Call `checkForUpdate()` from the init block.

To change update-check behaviour for every script, edit the template and re-run the sync — never edit the generated region in a `.user.js`.

## Validation

Run this before publishing a script change:

```sh
node tools/check-metadata.mjs
```

It fails on missing markers, an update check that is never called, unused `@grant`s, mismatched `.user.js`/`.meta.js` metadata, and any script whose update-check block has drifted from the template.
