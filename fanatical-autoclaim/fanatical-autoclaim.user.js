// ==UserScript==
// @name         Fanatical Autoclaim
// @namespace    fanatical-autoclaim
// @version      1.1.0
// @description  Bulk-reveal and bulk-redeem Steam keys on Fanatical order pages
// @match        https://www.fanatical.com/en/orders/*
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

    const SCRIPT_VERSION = '1.1.0'
    const META_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.meta.js'
    const DOWNLOAD_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/fanatical-autoclaim/fanatical-autoclaim.user.js'
    const LOG_PREFIX = '[Fanatical Autoclaim]'
    const SHORT_PREFIX = '[FAC]'

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

    // ═══════════════════════════════════════════════════════════════════
    //  UPDATE CHECK
    // ═══════════════════════════════════════════════════════════════════

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

    function showUpdateBanner(version) {
        const banner = document.createElement('div')
        banner.id = 'fac-update-banner'
        banner.textContent = `Fanatical Autoclaim v${version} available — click to update`
        banner.addEventListener('click', () => window.open(DOWNLOAD_URL, '_blank'))
        document.body.appendChild(banner)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DOM HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

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
     * Extract Steam keys from the page. Keys are displayed in input fields
     * or text elements with the XXXXX-XXXXX-XXXXX format.
     */
    function findRevealedKeys() {
        const keys = []
        // Steam keys follow the pattern: groups of 5 alphanumeric chars separated by dashes
        const keyPattern = /\b[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/

        // Check input/textarea elements (keys often shown in readonly inputs)
        document.querySelectorAll('input[type="text"], input:not([type])').forEach(input => {
            const match = input.value.match(keyPattern)
            if (match) keys.push({ key: match[0], element: input })
        })

        // Check text nodes in common key display containers
        // Fanatical renders keys in styled divs/spans near the "REDEEM ON STEAM" button
        document.querySelectorAll('div, span, p').forEach(el => {
            // Only check leaf-ish elements to avoid duplicates from parent containers
            if (el.children.length > 3) return
            const text = el.textContent.trim()
            const match = text.match(keyPattern)
            if (match && text.length < 30) {
                // Avoid picking up keys we already found via inputs
                const isDupe = keys.some(k => k.key === match[0])
                if (!isDupe) keys.push({ key: match[0], element: el })
            }
        })

        return keys
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
        const keys = findRevealedKeys()
        for (const { key, element } of keys) {
            urls.push({
                url: `steam://registerkey/${key}`,
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

    let statusEl = null
    let revealBtn = null
    let redeemBtn = null
    let revealAndRedeemBtn = null

    function updateStatus(text) {
        if (statusEl) statusEl.textContent = text
    }

    function setButtonsEnabled(enabled) {
        ;[revealBtn, redeemBtn, revealAndRedeemBtn].forEach(btn => {
            if (!btn) return
            btn.disabled = !enabled
            btn.style.opacity = enabled ? '1' : '0.5'
            btn.style.pointerEvents = enabled ? 'auto' : 'none'
        })
    }

    function createDelayInput(labelText, defaultValue, onChange) {
        const row = document.createElement('div')
        row.className = 'fac-delay-row'

        const label = document.createElement('label')
        label.className = 'fac-delay-label'
        label.textContent = labelText

        const input = document.createElement('input')
        input.type = 'number'
        input.className = 'fac-delay-input'
        input.min = '100'
        input.max = '10000'
        input.step = '100'
        input.value = defaultValue
        input.addEventListener('change', () => {
            const val = parseInt(input.value, 10)
            if (!isNaN(val) && val >= 100) onChange(val)
        })

        const unit = document.createElement('span')
        unit.className = 'fac-delay-unit'
        unit.textContent = 'ms'

        row.appendChild(label)
        row.appendChild(input)
        row.appendChild(unit)
        return row
    }

    function createPanel() {
        const panel = document.createElement('div')
        panel.id = 'fac-panel'

        const title = document.createElement('div')
        title.id = 'fac-title'
        title.textContent = 'Autoclaim'
        panel.appendChild(title)

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

        statusEl = document.createElement('div')
        statusEl.id = 'fac-status'
        statusEl.textContent = 'Ready'
        panel.appendChild(statusEl)

        document.body.appendChild(panel)
    }

    function injectStyles() {
        GM_addStyle(`
            #fac-panel {
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

            #fac-title {
                font-weight: 700;
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #ff9800;
                text-align: center;
            }

            .fac-btn {
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

            .fac-btn:hover {
                background: #616161;
            }

            .fac-btn-primary {
                background: #ff9800;
                color: #212121;
                border-color: #ff9800;
                font-weight: 700;
            }

            .fac-btn-primary:hover {
                background: #ffb74d;
            }

            #fac-delays {
                display: flex;
                flex-direction: column;
                gap: 4px;
                border-top: 1px solid #424242;
                padding-top: 8px;
                margin-top: 2px;
            }

            .fac-delay-row {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .fac-delay-label {
                font-size: 11px;
                color: #9e9e9e;
                flex: 1;
                margin: 0;
            }

            .fac-delay-input {
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

            .fac-delay-unit {
                font-size: 11px;
                color: #757575;
            }

            #fac-status {
                font-size: 12px;
                color: #9e9e9e;
                text-align: center;
                min-height: 16px;
            }

            #fac-update-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 10001;
                background: #ff9800;
                color: #212121;
                text-align: center;
                padding: 8px 16px;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                font-family: Lato, 'Open Sans', sans-serif;
            }

            #fac-update-banner:hover {
                background: #ffb74d;
            }
        `)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Wait for the React app to render order content before injecting the panel.
     * Polls for the presence of key-related buttons (REVEAL KEY or REDEEM ON STEAM).
     */
    function waitForOrderContent(callback, maxWaitMs = 15000) {
        const startTime = Date.now()
        const interval = setInterval(() => {
            const hasReveal = findButtonsByText('Reveal Key').length > 0
            const hasRedeem = findButtonsByText('Redeem on Steam').length > 0
            if (hasReveal || hasRedeem) {
                clearInterval(interval)
                log(`Order content detected (${Date.now() - startTime}ms)`)
                callback()
                return
            }
            if (Date.now() - startTime > maxWaitMs) {
                clearInterval(interval)
                warn(`Timed out waiting for order content after ${maxWaitMs}ms`)
                // Still inject the panel — the user might have a slow connection
                callback()
            }
        }, 500)
    }

    function init() {
        log(`v${SCRIPT_VERSION} loaded`)
        checkForUpdate()

        waitForOrderContent(() => {
            injectStyles()
            createPanel()

            const revealCount = findButtonsByText('Reveal Key').length
            const redeemCount = findButtonsByText('Redeem on Steam').length
            const keyCount = findRevealedKeys().length
            log(`Found ${revealCount} to reveal, ${redeemCount} redeem buttons, ${keyCount} visible keys`)
            updateStatus(`${revealCount} to reveal, ${redeemCount} ready`)
        })
    }

    init()
})()
