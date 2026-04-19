// ==UserScript==
// @name         Itch Bundle Autoclaim
// @namespace    itch-bundle-autoclaim
// @version      1.0.1
// @description  Claims all unclaimed games on an itch.io bundle download page, with automatic pagination
// @match        https://itch.io/bundle/download/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
    'use strict'

    // ═══════════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    const SCRIPT_VERSION =
        typeof GM_info !== 'undefined' && GM_info.script?.version
            ? GM_info.script.version
            : '__DEV__'
    const META_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.meta.js'
    const DOWNLOAD_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.user.js'
    const LOG_PREFIX = '[Itch Autoclaim]'
    const SHORT_PREFIX = '[ICA]'

    const STORAGE_KEY = 'itch_autoclaim_v1'
    const CLAIM_DELAY_MS = 400    // delay between individual fetch() claims
    const NAV_DELAY_MS = 1500     // pause before navigating to the next page
    const GAME_ROW_SELECTOR = '.game_row form.form'

    // ═══════════════════════════════════════════════════════════════════
    //  LOGGING
    // ═══════════════════════════════════════════════════════════════════

    function log(...args)     { console.log(LOG_PREFIX,   ...args) }
    function warn(...args)    { console.warn(LOG_PREFIX,  ...args) }
    function error(...args)   { console.error(LOG_PREFIX, ...args) }
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
        banner.id = 'ica-update-banner'
        banner.textContent = `Itch Autoclaim v${version} available — click to update`
        banner.addEventListener('click', () => window.open(DOWNLOAD_URL, '_blank'))
        document.body.appendChild(banner)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════════

    // In-memory flag so within-page code knows if a multi-page run is active
    let isMultiPageRun = false

    function loadState() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY)
            return raw ? JSON.parse(raw) : null
        } catch (e) {
            warn('Failed to read sessionStorage:', e)
            return null
        }
    }

    function saveState(state) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
        } catch (e) {
            warn('Failed to write sessionStorage:', e)
        }
    }

    function clearState() {
        try {
            sessionStorage.removeItem(STORAGE_KEY)
        } catch (e) {
            warn('Failed to clear sessionStorage:', e)
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PAGE HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    function getCurrentPage() {
        const params = new URLSearchParams(window.location.search)
        const p = parseInt(params.get('page'), 10)
        return isNaN(p) || p < 1 ? 1 : p
    }

    function getNextPageUrl() {
        const url = new URL(window.location.href)
        url.searchParams.set('page', getCurrentPage() + 1)
        return url.toString()
    }

    function getClaimableForms() {
        return Array.from(document.querySelectorAll(GAME_ROW_SELECTOR))
    }

    function getGameName(form) {
        const row = form.closest('.game_row') || form.parentElement
        if (!row) return 'Unknown game'
        const heading = row.querySelector('h2, h3, [class*="game_title"], [class*="title"], strong')
        if (heading) return heading.textContent.trim()
        const img = row.querySelector('img[alt]')
        if (img) return img.alt.trim()
        return 'Unknown game'
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CLAIMING
    // ═══════════════════════════════════════════════════════════════════

    async function claimForm(form) {
        const body = Array.from(form.querySelectorAll('[name]'))
            .map(el => encodeURIComponent(el.name) + '=' + encodeURIComponent(el.value))
            .join('&')

        const response = await fetch(window.location.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            redirect: 'manual',
        })
        // itch.io returns a redirect (opaqueredirect, type==='opaqueredirect', status===0)
        // on success via POST-redirect-GET; treat both 2xx and opaqueredirect as success
        return response.ok || response.type === 'opaqueredirect'
    }

    async function claimAllOnPage(state, onProgress) {
        const forms = getClaimableForms()
        let claimedThisPage = 0

        for (let i = 0; i < forms.length; i++) {
            const form = forms[i]
            const gameName = getGameName(form)
            logItem(`Claiming ${i + 1}/${forms.length}: ${gameName}`)
            onProgress(i + 1, forms.length, gameName, state.totalClaimed + claimedThisPage)

            try {
                const ok = await claimForm(form)
                if (ok) {
                    claimedThisPage++
                } else {
                    warn(`Claim may have failed for: ${gameName}`)
                }
            } catch (e) {
                warn(`Fetch error claiming "${gameName}":`, e)
            }

            if (i < forms.length - 1) await sleep(CLAIM_DELAY_MS)
        }

        return claimedThisPage
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════════════════════════════

    let panelEl      = null
    let statusEl     = null
    let counterEl    = null
    let claimAllBtn  = null
    let claimPageBtn = null

    function updateStatus(text) {
        if (statusEl) statusEl.textContent = text
    }

    function updateCounter(n) {
        if (counterEl) counterEl.textContent = `${n} claimed total`
    }

    function setButtonsEnabled(enabled) {
        ;[claimAllBtn, claimPageBtn].forEach(btn => {
            if (!btn) return
            btn.disabled = !enabled
            btn.style.opacity = enabled ? '1' : '0.5'
            btn.style.pointerEvents = enabled ? 'auto' : 'none'
        })
    }

    function makeProgressCallback() {
        return function onProgress(current, total, gameName, totalSoFar) {
            updateStatus(`Claiming ${current}/${total}: ${gameName}`)
            updateCounter(totalSoFar)
        }
    }

    async function runCurrentPage(state) {
        state.pagesVisited++
        const forms = getClaimableForms()

        if (forms.length === 0) {
            // No claimable games — either past the last page or nothing left to claim
            clearState()
            isMultiPageRun = false
            const pages = state.pagesVisited - 1
            log(`Finished. Total: ${state.totalClaimed} claimed across ${pages} page(s)`)
            updateStatus('All done!')
            updateCounter(state.totalClaimed)
            setButtonsEnabled(true)
            return
        }

        log(`Page ${getCurrentPage()}: ${forms.length} claimable game(s)`)
        saveState(state)

        const claimedThisPage = await claimAllOnPage(state, makeProgressCallback())
        state.totalClaimed += claimedThisPage
        saveState(state)
        log(`Page ${getCurrentPage()}: claimed ${claimedThisPage}, total so far ${state.totalClaimed}`)

        updateStatus(`Page ${getCurrentPage()} done — moving to next page...`)
        await sleep(NAV_DELAY_MS)
        window.location.replace(getNextPageUrl())
    }

    async function runClaimAllPages() {
        isMultiPageRun = true
        const state = { active: true, totalClaimed: 0, pagesVisited: 0 }
        saveState(state)
        setButtonsEnabled(false)
        await runCurrentPage(state)
    }

    async function runClaimThisPage() {
        setButtonsEnabled(false)
        updateStatus('Claiming...')
        const state = { active: false, totalClaimed: 0, pagesVisited: 0 }
        const count = await claimAllOnPage(state, makeProgressCallback())
        setButtonsEnabled(true)
        if (count > 0) {
            updateStatus(`Done — claimed ${count} game(s) on this page`)
        } else {
            updateStatus('Nothing to claim on this page')
        }
        updateCounter(count)
    }

    function createPanel() {
        panelEl = document.createElement('div')
        panelEl.id = 'ica-panel'

        const header = document.createElement('div')
        header.id = 'ica-header'

        const title = document.createElement('div')
        title.id = 'ica-title'
        title.textContent = 'Itch Autoclaim'
        header.appendChild(title)

        const closeBtn = document.createElement('button')
        closeBtn.id = 'ica-close-btn'
        closeBtn.textContent = '\u00D7'
        closeBtn.title = 'Close panel'
        closeBtn.addEventListener('click', () => {
            if (isMultiPageRun) clearState()
            panelEl.remove()
        })
        header.appendChild(closeBtn)

        panelEl.appendChild(header)

        claimAllBtn = document.createElement('button')
        claimAllBtn.id = 'ica-claim-all-btn'
        claimAllBtn.className = 'ica-btn ica-btn-primary'
        claimAllBtn.textContent = 'Claim All Pages'
        claimAllBtn.addEventListener('click', runClaimAllPages)
        panelEl.appendChild(claimAllBtn)

        claimPageBtn = document.createElement('button')
        claimPageBtn.id = 'ica-claim-page-btn'
        claimPageBtn.className = 'ica-btn'
        claimPageBtn.textContent = 'Claim This Page'
        claimPageBtn.addEventListener('click', runClaimThisPage)
        panelEl.appendChild(claimPageBtn)

        statusEl = document.createElement('div')
        statusEl.id = 'ica-status'
        statusEl.textContent = 'Ready'
        panelEl.appendChild(statusEl)

        counterEl = document.createElement('div')
        counterEl.id = 'ica-counter'
        counterEl.textContent = '0 claimed total'
        panelEl.appendChild(counterEl)

        document.body.appendChild(panelEl)
    }

    function injectStyles() {
        GM_addStyle(`
            #ica-panel {
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
                min-width: 210px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                font-family: 'Itch Sans', 'Helvetica Neue', Helvetica, sans-serif;
                font-size: 14px;
                color: #eee;
            }

            #ica-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            #ica-title {
                font-weight: 700;
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #FA5C5C;
                flex: 1;
                text-align: center;
                padding-left: 20px;
            }

            #ica-close-btn {
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

            #ica-close-btn:hover {
                color: #eee;
            }

            .ica-btn {
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

            .ica-btn:hover {
                background: #616161;
            }

            .ica-btn-primary {
                background: #FA5C5C;
                color: #fff;
                border-color: #FA5C5C;
                font-weight: 700;
            }

            .ica-btn-primary:hover {
                background: #e04848;
                border-color: #e04848;
            }

            #ica-status {
                font-size: 12px;
                color: #9e9e9e;
                text-align: center;
                min-height: 16px;
            }

            #ica-counter {
                font-size: 11px;
                color: #757575;
                text-align: center;
                min-height: 14px;
            }

            #ica-update-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 10001;
                background: #FA5C5C;
                color: #fff;
                text-align: center;
                padding: 8px 16px;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                font-family: 'Itch Sans', 'Helvetica Neue', Helvetica, sans-serif;
            }

            #ica-update-banner:hover {
                background: #e04848;
            }
        `)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════════════

    function init() {
        log(`v${SCRIPT_VERSION} loaded`)
        checkForUpdate()
        injectStyles()
        createPanel()

        const state = loadState()
        if (state && state.active) {
            // Resumed after window.location.replace() navigation — auto-continue
            isMultiPageRun = true
            log(`Resuming multi-page run on page ${getCurrentPage()} (${state.totalClaimed} claimed so far)`)
            updateCounter(state.totalClaimed)
            updateStatus(`Resumed on page ${getCurrentPage()}...`)
            setButtonsEnabled(false)
            runCurrentPage(state)
        } else {
            const count = getClaimableForms().length
            log(`Ready — found ${count} claimable game(s) on page ${getCurrentPage()}`)
            updateStatus(count > 0 ? `Found ${count} game(s) — ready to claim` : 'No unclaimed games on this page')
        }
    }

    init()
})()
