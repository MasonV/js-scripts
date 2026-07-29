// ==UserScript==
// @name         Itch Bundle Autoclaim
// @namespace    itch-bundle-autoclaim
// @version      1.1.0
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

    // <update-check>
    // ═══════════════════════════════════════════════════════════════════
    //  UPDATE CHECK
    //  Generated from tools/update-check.template.js — do not edit here.
    //  Change the template, then run: node tools/sync-update-check.mjs
    // ═══════════════════════════════════════════════════════════════════

    const UPDATE_BANNER_ID = 'itch-bundle-autoclaim-update-banner'
    const UPDATE_DISMISS_KEY = 'itch_bundle_autoclaim_update_dismissed_v'

    // Tampermonkey exposes the script's own metadata block, so these URLs
    // don't have to be hand-maintained in two places. Greasemonkey 4 does
    // not expose them, hence the literal fallbacks.
    const META_URL =
        (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
        'https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.meta.js'
    const DOWNLOAD_URL =
        (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
        'https://raw.githubusercontent.com/MasonV/js-scripts/main/itch-bundle-autoclaim/itch-bundle-autoclaim.user.js'

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
