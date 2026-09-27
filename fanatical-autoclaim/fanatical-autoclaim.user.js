// ==UserScript==
// @name         Fanatical Autoclaim
// @namespace    fanatical-autoclaim
// @version      1.4.1
// @description  Bulk-reveal and bulk-redeem Steam keys on Fanatical order pages
// @match        https://www.fanatical.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
    'use strict'

    const SCRIPT_VERSION =
        typeof GM_info !== 'undefined' && GM_info.script?.version
            ? GM_info.script.version
            : '__DEV__'
    const LOG_PREFIX = '[Fanatical Autoclaim]'
    const SHORT_PREFIX = '[FAC]'
    const UI_PREFIX = 'fac'

    const DEFAULT_REVEAL_DELAY_MS = 500
    const DEFAULT_REDEEM_DELAY_MS = 800

    // Mutable — updated by the UI input
    let revealDelayMs = DEFAULT_REVEAL_DELAY_MS
    let redeemDelayMs = DEFAULT_REDEEM_DELAY_MS

    // ═══════════════════════════════════════════════════════════════════
    //  LOGGING
    // ═══════════════════════════════════════════════════════════════════

    function log(...args) { console.log(LOG_PREFIX, ...args) }
    function warn(...args) { console.warn(LOG_PREFIX, ...args) }
    function error(...args) { console.error(LOG_PREFIX, ...args) }
    function logItem(...args) { console.log(SHORT_PREFIX, ...args) }

    // <update-check>
    // ═══════════════════════════════════════════════════════════════════
    //  UPDATE CHECK
    //  Generated from tools/update-check.template.js — do not edit here.
    //  Change the template, then run: node tools/sync-update-check.mjs
    // ═══════════════════════════════════════════════════════════════════

    const UPDATE_BANNER_ID = 'fanatical-autoclaim-update-banner'
    const UPDATE_DISMISS_KEY = 'fanatical_autoclaim_update_dismissed_v'

    // Tampermonkey exposes the script's own metadata block, so these URLs
    // don't have to be hand-maintained in two places. Greasemonkey 4 does
    // not expose them, hence the literal fallbacks.
    const META_URL =
        (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
        'https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.meta.js'
    const DOWNLOAD_URL =
        (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
        'https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.user.js'

    // Numeric per-segment compare. True only when `remote` is strictly newer,
    // so a local build that's ahead of main never nags. Non-numeric versions
    // (e.g. a tagged pre-release) fall back to plain inequality.
    function isNewerVersion(remote, local) {
        const r = String(remote).split('.').map(Number)
        const l = String(local).split('.').map(Number)
        if (r.some(Number.isNaN) || l.some(Number.isNaN)) return remote !== local
        for (let i = 0; i < Math.max(r.length, l.length); i++) {
            const a = r[i] || 0
            const b = l[i] || 0
            if (a > b) return true
            if (a < b) return false
        }
        return false
    }

    // Dismissal is scoped to the session *and* to the version being offered,
    // so a newer release re-surfaces the banner instead of staying hidden.
    function isUpdateDismissed(remote) {
        try {
            return sessionStorage.getItem(UPDATE_DISMISS_KEY + remote) === '1'
        } catch {
            return false
        }
    }

    function dismissUpdate(remote) {
        try {
            sessionStorage.setItem(UPDATE_DISMISS_KEY + remote, '1')
        } catch {
            /* private mode — the dismissal just won't persist */
        }
    }

    function checkForUpdate() {
        // A dev install has no GM_info version to compare against, so every
        // remote version would look like an update.
        if (SCRIPT_VERSION === '__DEV__') {
            console.log(`${LOG_PREFIX} Dev build — skipping update check.`)
            return
        }
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: META_URL + '?_=' + Date.now(),
                onload(resp) {
                    if (resp.status !== 200) return
                    const match = resp.responseText.match(/@version\s+(\S+)/)
                    if (!match) return
                    const remote = match[1]
                    if (isNewerVersion(remote, SCRIPT_VERSION)) {
                        console.log(`${LOG_PREFIX} Update available: v${SCRIPT_VERSION} → v${remote}`)
                        showUpdateBanner(remote)
                    } else {
                        console.log(`${LOG_PREFIX} Up to date (v${SCRIPT_VERSION}).`)
                    }
                },
                onerror() {
                    console.warn(`${LOG_PREFIX} Update check failed (network error)`)
                },
            })
        } catch (e) {
            console.warn(`${LOG_PREFIX} Update check unavailable:`, e)
        }
    }

    function showUpdateBanner(remote) {
        if (isUpdateDismissed(remote)) return

        function inject() {
            if (document.getElementById(UPDATE_BANNER_ID)) return

            // Styled inline rather than via a stylesheet so the banner works
            // the same in every script, including the ones with no GM_addStyle
            // grant and the ones running at document-start.
            const banner = document.createElement('div')
            banner.id = UPDATE_BANNER_ID
            Object.assign(banner.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                right: '0',
                zIndex: '2147483647',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '13px',
                lineHeight: '1.4',
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
            })

            const name = LOG_PREFIX.replace(/^\[|\]$/g, '')

            const message = document.createElement('span')
            message.textContent = `⬆ ${name} v${remote} available (you have v${SCRIPT_VERSION}) — click to update`
            Object.assign(message.style, { cursor: 'pointer', textDecoration: 'underline' })
            message.addEventListener('click', () => {
                window.open(DOWNLOAD_URL, '_blank')
            })

            const dismiss = document.createElement('button')
            dismiss.type = 'button'
            dismiss.textContent = '✕ Dismiss'
            Object.assign(dismiss.style, {
                flex: '0 0 auto',
                padding: '2px 10px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                borderRadius: '4px',
                background: 'transparent',
                color: '#fff',
                font: 'inherit',
                cursor: 'pointer',
            })
            dismiss.addEventListener('click', () => {
                dismissUpdate(remote)
                banner.remove()
                console.log(`${LOG_PREFIX} Update notice dismissed for this session.`)
            })

            banner.append(message, dismiss)
            document.body.prepend(banner)
        }

        // document-start scripts run before <body> exists.
        if (document.body) inject()
        else document.addEventListener('DOMContentLoaded', inject)
    }
    // </update-check>

    // <autoclaim-kit>
    // ═══════════════════════════════════════════════════════════════════
    //  AUTOCLAIM KIT — shared helpers and panel UI
    //  Generated from tools/blocks/autoclaim-kit.template.js — do not edit here.
    //  Change the template, then run: node tools/sync-blocks.mjs
    // ═══════════════════════════════════════════════════════════════════
    //
    // Expects UI_PREFIX (e.g. 'lac') in the enclosing scope: every id and class
    // the panel uses is `${UI_PREFIX}-…`, so two autoclaim scripts on one page
    // never collide. Needs @grant GM_addStyle.

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Poll `probe` until it returns something truthy or `timeoutMs` elapses.
     * Resolves with the probe's value, or null on timeout.
     */
    async function waitFor(probe, timeoutMs, intervalMs = 250) {
        const deadline = Date.now() + timeoutMs
        for (;;) {
            const value = probe()
            if (value) return value
            if (Date.now() >= deadline) return null
            await sleep(intervalMs)
        }
    }

    function isVisible(el) {
        return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
    }

    function isEnabled(el) {
        return !el.disabled && el.getAttribute('aria-disabled') !== 'true'
    }

    // Visible buttons/links whose text is exactly `text` (case-insensitive),
    // ignoring our own panel.
    function findVisibleButtonsByText(text) {
        const want = text.toLowerCase()
        return Array.from(
            document.querySelectorAll('button, a, [role="button"], input[type="submit"]'),
        ).filter(
            el =>
                !el.closest(`#${UI_PREFIX}-panel`) &&
                (el.value || el.textContent).trim().toLowerCase() === want &&
                isVisible(el),
        )
    }

    // The single visible, enabled button with this text — or null, so an
    // ambiguous page is never guessed at.
    function findOnlyButton(text) {
        const matches = findVisibleButtonsByText(text).filter(isEnabled)
        return matches.length === 1 ? matches[0] : null
    }

    function normalizeKey(key) {
        return key.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    }

    // Keys end up in the console and the status line — show only enough to
    // tell two apart.
    function maskKey(key) {
        return key.length > 5 ? `${key.slice(0, 5)}…` : key
    }

    // ── Panel ───────────────────────────────────────────────────────────

    let statusEl = null
    let panelStylesInjected = false

    // Floating panel with a title and a close button. The caller appends its
    // own controls, then the panel to document.body.
    function buildPanelShell(titleText) {
        const panel = document.createElement('div')
        panel.id = `${UI_PREFIX}-panel`

        const header = document.createElement('div')
        header.id = `${UI_PREFIX}-header`

        const title = document.createElement('div')
        title.id = `${UI_PREFIX}-title`
        title.textContent = titleText
        header.appendChild(title)

        const closeBtn = document.createElement('button')
        closeBtn.id = `${UI_PREFIX}-close-btn`
        closeBtn.textContent = '×'
        closeBtn.title = 'Close panel'
        closeBtn.addEventListener('click', () => panel.remove())
        header.appendChild(closeBtn)

        panel.appendChild(header)
        return panel
    }

    // The one status line updateStatus() writes to.
    function createStatusLine(panel, text = '') {
        statusEl = document.createElement('div')
        statusEl.id = `${UI_PREFIX}-status`
        statusEl.textContent = text
        panel.appendChild(statusEl)
        return statusEl
    }

    // tone: undefined (neutral) | 'ok' | 'error'
    function updateStatus(text, tone) {
        if (!statusEl) return
        statusEl.textContent = text
        statusEl.classList.toggle(`${UI_PREFIX}-status--ok`, tone === 'ok')
        statusEl.classList.toggle(`${UI_PREFIX}-status--error`, tone === 'error')
    }

    function setControlsEnabled(controls, enabled) {
        controls.forEach(btn => {
            if (!btn) return
            btn.disabled = !enabled
            btn.style.opacity = enabled ? '1' : '0.5'
            btn.style.pointerEvents = enabled ? 'auto' : 'none'
        })
    }

    function createDelayInput(labelText, defaultValue, onChange) {
        const row = document.createElement('div')
        row.className = `${UI_PREFIX}-delay-row`

        const label = document.createElement('label')
        label.className = `${UI_PREFIX}-delay-label`
        label.textContent = labelText

        const input = document.createElement('input')
        input.type = 'number'
        input.className = `${UI_PREFIX}-delay-input`
        input.min = '100'
        input.max = '10000'
        input.step = '100'
        input.value = defaultValue
        input.addEventListener('change', () => {
            const val = parseInt(input.value, 10)
            if (!isNaN(val) && val >= 100) onChange(val)
        })

        const unit = document.createElement('span')
        unit.className = `${UI_PREFIX}-delay-unit`
        unit.textContent = 'ms'

        row.appendChild(label)
        row.appendChild(input)
        row.appendChild(unit)
        return row
    }

    function removePanel() {
        document.getElementById(`${UI_PREFIX}-panel`)?.remove()
        statusEl = null
    }

    // Base panel styles. Safe to call on every route — only the first call
    // injects. Script-specific rules go in the script's own GM_addStyle.
    function injectPanelStyles() {
        if (panelStylesInjected) return
        panelStylesInjected = true
        const p = UI_PREFIX
        GM_addStyle(`
            #${p}-panel {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 10000;
                background: #2b2b2b;
                border: 1px solid #424242;
                border-radius: 8px;
                padding: 12px 16px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-width: 200px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                font-family: Lato, 'Open Sans', sans-serif;
                font-size: 14px;
                color: #eee;
            }

            #${p}-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            #${p}-title {
                font-weight: 700;
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #ff9800;
                flex: 1;
                text-align: center;
                padding-left: 20px;
            }

            #${p}-close-btn {
                background: none;
                border: none;
                color: #757575;
                font-size: 18px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
                width: 20px;
                font-family: inherit;
            }

            #${p}-close-btn:hover { color: #eee; }

            /* One-line context under the title, e.g. "Store: GOG" */
            #${p}-store {
                font-size: 12px;
                color: #bdbdbd;
                text-align: center;
                padding: 2px 0;
            }

            .${p}-btn {
                background: #424242;
                color: #eee;
                border: 1px solid #616161;
                border-radius: 4px;
                padding: 8px 12px;
                font-size: 13px;
                font-weight: 400;
                cursor: pointer;
                transition: background 0.15s ease, opacity 0.15s ease;
                font-family: inherit;
            }

            .${p}-btn:hover { background: #616161; }

            .${p}-btn-primary {
                background: #ff9800;
                color: #212121;
                border-color: #ff9800;
                font-weight: 700;
            }

            .${p}-btn-primary:hover { background: #ffb74d; }

            .${p}-btn-danger {
                background: transparent;
                color: #ef5350;
                border-color: #ef5350;
                font-size: 11px;
                padding: 4px 8px;
            }

            .${p}-btn-danger:hover {
                background: #ef5350;
                color: #fff;
            }

            #${p}-delays {
                display: flex;
                flex-direction: column;
                gap: 4px;
                border-top: 1px solid #424242;
                padding-top: 8px;
                margin-top: 2px;
            }

            .${p}-delay-row {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .${p}-delay-label {
                font-size: 11px;
                color: #9e9e9e;
                flex: 1;
                margin: 0;
            }

            .${p}-delay-input {
                width: 60px;
                background: #333;
                color: #eee;
                border: 1px solid #616161;
                border-radius: 3px;
                padding: 2px 4px;
                font-size: 12px;
                font-family: inherit;
                text-align: right;
            }

            .${p}-delay-unit {
                font-size: 11px;
                color: #757575;
            }

            #${p}-status {
                font-size: 12px;
                color: #9e9e9e;
                text-align: center;
                min-height: 16px;
            }

            #${p}-status.${p}-status--ok { color: #81c784; }
            #${p}-status.${p}-status--error { color: #ef5350; font-weight: 700; }
        `)
    }
    // </autoclaim-kit>

    // <steam-redeem>
    // ═══════════════════════════════════════════════════════════════════
    //  STEAM REDEEM
    //  Generated from tools/blocks/steam-redeem.template.js — do not edit here.
    //  Change the template, then run: node tools/sync-blocks.mjs
    // ═══════════════════════════════════════════════════════════════════
    //
    // Steam has no web redeem page a script can drive, so a key is handed to
    // the Steam client through a steam://registerkey/ URL.

    // Groups of five letters/digits separated by dashes: XXXXX-XXXXX-XXXXX
    const STEAM_KEY_RE = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/

    function steamRedeemUrl(key) {
        return `steam://registerkey/${key}`
    }

    /**
     * Steam keys shown on the page, each with the element it was found in.
     * Keys are often in readonly inputs, else in short text elements.
     */
    function findSteamKeys() {
        const keys = []

        document.querySelectorAll('input[type="text"], input:not([type])').forEach(input => {
            const match = input.value.match(STEAM_KEY_RE)
            if (match) keys.push({ key: match[0], element: input })
        })

        document.querySelectorAll('div, span, p').forEach(el => {
            // Only leaf-ish elements, so a key isn't reported once per ancestor.
            if (el.children.length > 3) return
            const text = el.textContent.trim()
            const match = text.match(STEAM_KEY_RE)
            if (match && text.length < 30 && !keys.some(k => k.key === match[0])) {
                keys.push({ key: match[0], element: el })
            }
        })

        return keys
    }
    // </steam-redeem>

    // ═══════════════════════════════════════════════════════════════════
    //  DOM HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Find all buttons whose visible text matches the given string (case-insensitive).
     * Searches both <button> and <a> elements since Fanatical uses both.
     */
    function findButtonsByText(text) {
        const lowerText = text.toLowerCase().trim()
        const candidates = document.querySelectorAll('button, a[role="button"], a.btn, a[href*="steam"]')
        return Array.from(candidates).filter(el => {
            const elText = el.textContent.trim().toLowerCase()
            return elText === lowerText
        })
    }

    /**
     * Get the game name associated with a key or button element by walking
     * up to the card container and finding heading/title text.
     */
    function getGameName(element) {
        // Walk up to find the card-level container (usually 3-6 levels up)
        let container = element
        for (let i = 0; i < 8; i++) {
            if (!container.parentElement) break
            container = container.parentElement
            // Look for elements that span a significant width — likely the card
            const rect = container.getBoundingClientRect()
            if (rect.width > 500) break
        }
        // Find heading or bold text within the container
        const heading = container.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], strong, b')
        if (heading) return heading.textContent.trim()
        // Fallback: look for an img alt text (game cover images often have alt)
        const img = container.querySelector('img[alt]')
        if (img) return img.alt.trim()
        return 'Unknown game'
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE ACTIONS
    // ═══════════════════════════════════════════════════════════════════

    async function revealAllKeys() {
        const revealButtons = findButtonsByText('Reveal Key')
        if (revealButtons.length === 0) {
            log('No "Reveal Key" buttons found — all keys may already be revealed')
            updateStatus('No keys to reveal')
            return
        }

        log(`Found ${revealButtons.length} key(s) to reveal`)
        updateStatus(`Revealing 0/${revealButtons.length}...`)
        setButtonsEnabled(false)

        for (let i = 0; i < revealButtons.length; i++) {
            const btn = revealButtons[i]
            const gameName = getGameName(btn)
            logItem(`Revealing key ${i + 1}/${revealButtons.length}: ${gameName}`)
            updateStatus(`Revealing ${i + 1}/${revealButtons.length}: ${gameName}`)

            btn.click()

            // Wait for the reveal to process before clicking the next one
            if (i < revealButtons.length - 1) {
                await sleep(revealDelayMs)
            }
        }

        // Wait a moment for the last reveal to render
        await sleep(revealDelayMs)
        log('All keys revealed')
        updateStatus(`Revealed ${revealButtons.length} key(s)`)
        setButtonsEnabled(true)
    }

    /**
     * Collect redeem URLs from the page. Extracts hrefs from "REDEEM ON STEAM"
     * links/buttons, falling back to building steam://registerkey/ URLs from
     * revealed keys if no redeem links exist.
     */
    function collectRedeemUrls() {
        const urls = []
        const redeemButtons = findButtonsByText('Redeem on Steam')

        for (const btn of redeemButtons) {
            const href = btn.href || btn.closest('a')?.href
            if (href) {
                urls.push({ url: href, name: getGameName(btn) })
            }
        }

        if (urls.length > 0) return urls

        // Fallback: build steam:// URLs from extracted keys
        const keys = findSteamKeys()
        for (const { key, element } of keys) {
            urls.push({
                url: steamRedeemUrl(key),
                name: getGameName(element),
            })
        }

        return urls
    }

    async function redeemAllOnSteam() {
        const urls = collectRedeemUrls()

        if (urls.length === 0) {
            log('No revealed keys or redeem buttons found — reveal keys first')
            updateStatus('No keys to redeem — reveal first')
            return
        }

        log(`Opening ${urls.length} redeem URL(s) in background tabs`)
        updateStatus(`Redeeming 0/${urls.length}...`)
        setButtonsEnabled(false)

        for (let i = 0; i < urls.length; i++) {
            const { url, name } = urls[i]
            logItem(`Redeeming ${i + 1}/${urls.length}: ${name}`)
            updateStatus(`Redeeming ${i + 1}/${urls.length}: ${name}`)

            // Open in a background tab so the script keeps running on this page
            GM_openInTab(url, { active: false, insert: true, setParent: true })

            if (i < urls.length - 1) {
                await sleep(redeemDelayMs)
            }
        }

        log('All redeem tabs opened')
        updateStatus(`Opened ${urls.length} redeem tab(s)`)
        setButtonsEnabled(true)
    }

    async function revealAndRedeem() {
        await revealAllKeys()
        // Brief pause to let the DOM update with revealed keys
        await sleep(1000)
        await redeemAllOnSteam()
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════════════════════════════

    let revealBtn = null
    let redeemBtn = null
    let revealAndRedeemBtn = null

    function setButtonsEnabled(enabled) {
        setControlsEnabled([revealBtn, redeemBtn, revealAndRedeemBtn], enabled)
    }

    function createPanel() {
        const panel = buildPanelShell('Autoclaim')

        revealBtn = document.createElement('button')
        revealBtn.id = 'fac-reveal-btn'
        revealBtn.className = 'fac-btn'
        revealBtn.textContent = 'Reveal All'
        revealBtn.addEventListener('click', revealAllKeys)
        panel.appendChild(revealBtn)

        redeemBtn = document.createElement('button')
        redeemBtn.id = 'fac-redeem-btn'
        redeemBtn.className = 'fac-btn'
        redeemBtn.textContent = 'Redeem All'
        redeemBtn.addEventListener('click', redeemAllOnSteam)
        panel.appendChild(redeemBtn)

        revealAndRedeemBtn = document.createElement('button')
        revealAndRedeemBtn.id = 'fac-reveal-redeem-btn'
        revealAndRedeemBtn.className = 'fac-btn fac-btn-primary'
        revealAndRedeemBtn.textContent = 'Reveal + Redeem All'
        revealAndRedeemBtn.addEventListener('click', revealAndRedeem)
        panel.appendChild(revealAndRedeemBtn)

        const delaySection = document.createElement('div')
        delaySection.id = 'fac-delays'
        delaySection.appendChild(createDelayInput('Reveal delay', DEFAULT_REVEAL_DELAY_MS, v => { revealDelayMs = v }))
        delaySection.appendChild(createDelayInput('Redeem delay', DEFAULT_REDEEM_DELAY_MS, v => { redeemDelayMs = v }))
        panel.appendChild(delaySection)

        createStatusLine(panel, 'Ready')

        document.body.appendChild(panel)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════

    // Fanatical is a single-page app: moving from the store or the order list
    // to an order page is a client-side route change, not a page load. The
    // script therefore matches the whole site and shows/hides the panel as
    // the route changes.
    const ORDER_PATH = /^\/[a-z]{2}(?:-[a-z]{2})?\/orders\/[^/]+/i

    let activeOrderPath = null
    let waitInterval = null

    function isOrderPage() {
        return ORDER_PATH.test(location.pathname)
    }

    /**
     * Wait for the React app to render order content before injecting the panel.
     * Polls for the presence of key-related buttons (REVEAL KEY or REDEEM ON STEAM).
     * Only one wait runs at a time; a new route cancels the previous one.
     */
    function waitForOrderContent(callback, maxWaitMs = 15000) {
        clearInterval(waitInterval)
        const startTime = Date.now()
        waitInterval = setInterval(() => {
            const hasReveal = findButtonsByText('Reveal Key').length > 0
            const hasRedeem = findButtonsByText('Redeem on Steam').length > 0
            if (hasReveal || hasRedeem) {
                clearInterval(waitInterval)
                log(`Order content detected (${Date.now() - startTime}ms)`)
                callback()
                return
            }
            if (Date.now() - startTime > maxWaitMs) {
                clearInterval(waitInterval)
                warn(`Timed out waiting for order content after ${maxWaitMs}ms`)
                // Still inject the panel — the user might have a slow connection
                callback()
            }
        }, 500)
    }

    function teardownPanel() {
        removePanel()
        revealBtn = redeemBtn = revealAndRedeemBtn = null
    }

    function showPanel() {
        injectPanelStyles()
        teardownPanel()
        createPanel()

        const revealCount = findButtonsByText('Reveal Key').length
        const redeemCount = findButtonsByText('Redeem on Steam').length
        const keyCount = findSteamKeys().length
        log(`Found ${revealCount} to reveal, ${redeemCount} redeem buttons, ${keyCount} visible keys`)
        updateStatus(`${revealCount} to reveal, ${redeemCount} ready`)
    }

    function handleRoute() {
        const path = isOrderPage() ? location.pathname : null
        if (path === activeOrderPath) return
        activeOrderPath = path

        clearInterval(waitInterval)
        teardownPanel()
        if (!path) return

        log(`Order page: ${path}`)
        waitForOrderContent(() => {
            // The user may have navigated away while we were waiting.
            if (location.pathname === path) showPanel()
        })
    }

    function watchForNavigation() {
        // Navigation API fires on client-side route changes in modern browsers.
        // The URL isn't always updated when it fires, so defer a tick.
        if (typeof window.navigation !== 'undefined') {
            window.navigation.addEventListener('navigate', () => setTimeout(handleRoute, 0))
        }
        window.addEventListener('popstate', handleRoute)
        // Fallback for browsers without the Navigation API. Patching
        // history.pushState doesn't work from the userscript sandbox, so poll
        // instead — handleRoute is a cheap string compare when nothing changed.
        setInterval(handleRoute, 1000)
    }

    function init() {
        log(`v${SCRIPT_VERSION} loaded`)
        checkForUpdate()
        watchForNavigation()
        handleRoute()
    }

    init()
})()
