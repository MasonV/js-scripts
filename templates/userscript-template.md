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

```js
const LOG_PREFIX = '[Example Script]'
const SCRIPT_VERSION =
  typeof GM_info !== 'undefined' && GM_info.script?.version
    ? GM_info.script.version
    : '__DEV__'
const META_URL =
  'https://raw.githubusercontent.com/MasonV/js-scripts/main/example-script/example-script.meta.js'
const DOWNLOAD_URL =
  'https://raw.githubusercontent.com/MasonV/js-scripts/main/example-script/example-script.user.js'
```

## Standard Update Check

```js
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
          console.log(`${LOG_PREFIX} Update available: v${SCRIPT_VERSION} -> v${remote}`)
          showUpdateBanner(remote)
        }
      },
      onerror() {
        console.warn(`${LOG_PREFIX} Update check failed`)
      },
    })
  } catch (error) {
    console.warn(`${LOG_PREFIX} Update check unavailable:`, error)
  }
}

function showUpdateBanner(version) {
  const banner = document.createElement('button')
  banner.type = 'button'
  banner.textContent = `Example Script v${version} available - click to update`
  banner.addEventListener('click', () => window.open(DOWNLOAD_URL, '_blank'))
  document.body.appendChild(banner)
}
```

## Validation

Run this before publishing a script change:

```sh
node tools/check-metadata.mjs
```
