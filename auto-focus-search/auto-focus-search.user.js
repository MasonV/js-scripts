// ==UserScript==
// @name         Auto Focus Search
// @namespace    auto-focus-search
// @version      1.0.1
// @description  Automatically detects and focuses search input fields on any webpage
// @match        *://*/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/auto-focus-search/auto-focus-search.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/auto-focus-search/auto-focus-search.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

;(function () {
    'use strict'

    // ═══════════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    const LOG_PREFIX = '[Auto Focus Search]'
    const SHORT_PREFIX = '[AFS]'
    const SCRIPT_VERSION = '1.0.1'
    const META_URL =
        'https://raw.githubusercontent.com/MasonV/js-scripts/main/auto-focus-search/auto-focus-search.meta.js'
    const DOWNLOAD_URL =
        'https://raw.githubusercontent.com/MasonV/js-scripts/main/auto-focus-search/auto-focus-search.user.js'
    const UPDATE_BANNER_ID = 'afs-update-banner'
    const INDICATOR_ID = 'afs-indicator'
    const POPOVER_ID = 'afs-popover'
    const STORAGE_KEY = 'auto_focus_search_disabled_v1'

    const FOCUS_DELAY_MS = 150
    const OBSERVER_DEBOUNCE_MS = 200
    const OBSERVER_TIMEOUT_MS = 30000
    const INDICATOR_FADE_MS = 3000

    // Priority-ordered CSS selectors for search field detection
    const SEARCH_SELECTORS = [
        // Tier 1: Semantic role-based (highest confidence)
        '[role="search"] input:not([type="hidden"])',
        '[role="search"] textarea',

        // Tier 2: Explicit type
        'input[type="search"]',

        // Tier 3: Common name attributes
        'input[name="q"]',
        'input[name="query"]',
        'input[name="search"]',
        'input[name="search_query"]',
        'input[name="s"]',

        // Tier 4: Accessible labels (case-insensitive)
        'input[placeholder*="search" i]',
        'input[aria-label*="search" i]',
        'textarea[placeholder*="search" i]',
        'textarea[aria-label*="search" i]',

        // Tier 5: Common IDs and classes
        '#search-input',
        '#searchbox',
        '#search',
        '#q',
        '.search-input',
        '.search-box',
        '.search-field',
        'input.search',
    ]

    // ═══════════════════════════════════════════════════════════════════
    //  LOGGING
    // ═══════════════════════════════════════════════════════════════════

    function log(msg, ...args) {
        console.log(`${LOG_PREFIX} ${msg}`, ...args)
    }

    function warn(msg, ...args) {
        console.warn(`${LOG_PREFIX} ${msg}`, ...args)
    }

    function logVerbose(msg, ...args) {
        console.log(`${SHORT_PREFIX} ${msg}`, ...args)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  EXCLUSION LIST
    // ═══════════════════════════════════════════════════════════════════

    function isExcluded() {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1'
        } catch {
            return false
        }
    }

    function toggleExclusion() {
        const excluded = isExcluded()
        try {
            if (excluded) localStorage.removeItem(STORAGE_KEY)
            else localStorage.setItem(STORAGE_KEY, '1')
        } catch {
            /* ignore */
        }
        return !excluded
    }

    // ═══════════════════════════════════════════════════════════════════
    //  SEARCH FIELD DETECTION
    // ═══════════════════════════════════════════════════════════════════

    function isVisible(el) {
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
        if (getComputedStyle(el).visibility === 'hidden') return false
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
    }

    function isFocusable(el) {
        return !el.disabled && !el.readOnly && el.tabIndex !== -1
    }

    function findSearchInput() {
        for (const selector of SEARCH_SELECTORS) {
            try {
                const els = document.querySelectorAll(selector)
                for (const el of els) {
                    if (isVisible(el) && isFocusable(el)) return el
                }
            } catch {
                // invalid selector on some pages, skip
            }
        }
        return null
    }

    function findAllSearchInputs() {
        const seen = new Set()
        const results = []
        for (const selector of SEARCH_SELECTORS) {
            try {
                const els = document.querySelectorAll(selector)
                for (const el of els) {
                    if (!seen.has(el) && isVisible(el) && isFocusable(el)) {
                        seen.add(el)
                        results.push(el)
                    }
                }
            } catch {
                // skip
            }
        }
        return results
    }

    function isSearchInput(el) {
        for (const selector of SEARCH_SELECTORS) {
            try {
                if (el.matches(selector)) return true
            } catch {
                // skip
            }
        }
        return false
    }

    // ═══════════════════════════════════════════════════════════════════
    //  SAFETY CHECKS
    // ═══════════════════════════════════════════════════════════════════

    function shouldFocus() {
        if (isExcluded()) return false

        const active = document.activeElement
        if (!active || active === document.body || active === document.documentElement) return true

        const tag = active.tagName
        const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable

        if (!isInput) return true

        // A search input is already focused — no action needed
        if (isSearchInput(active)) return false

        // Some other input is focused — don't steal
        return false
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FOCUS LOGIC
    // ═══════════════════════════════════════════════════════════════════

    let cycleIndex = -1

    function attemptFocus() {
        if (!shouldFocus()) {
            logVerbose('Skipped focus (safety check)')
            return false
        }

        const el = findSearchInput()
        if (!el) {
            logVerbose('No search input found')
            return false
        }

        el.focus({ preventScroll: true })
        cycleIndex = 0
        const label = describeElement(el)
        logVerbose(`Focused: ${label}`)
        showIndicator(label)
        return true
    }

    function cycleFocus() {
        const all = findAllSearchInputs()
        if (all.length === 0) {
            logVerbose('No search inputs to cycle')
            return
        }

        cycleIndex = (cycleIndex + 1) % all.length
        const el = all[cycleIndex]
        el.focus({ preventScroll: true })
        const label = describeElement(el)
        logVerbose(`Cycled to (${cycleIndex + 1}/${all.length}): ${label}`)
        showIndicator(label)
    }

    function describeElement(el) {
        const tag = el.tagName.toLowerCase()
        const id = el.id ? `#${el.id}` : ''
        const name = el.name ? `[name="${el.name}"]` : ''
        const placeholder = el.placeholder ? `"${el.placeholder}"` : ''
        return `${tag}${id}${name} ${placeholder}`.trim()
    }

    // ═══════════════════════════════════════════════════════════════════
    //  MUTATION OBSERVER
    // ═══════════════════════════════════════════════════════════════════

    let _observer = null
    let _observerTimer = null
    let _debounce = null

    function startObserver() {
        if (_observer) _observer.disconnect()
        clearTimeout(_observerTimer)

        _observer = new MutationObserver((mutations) => {
            let hasNewInput = false
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue
                    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
                        hasNewInput = true
                        break
                    }
                    if (node.querySelector && node.querySelector('input, textarea')) {
                        hasNewInput = true
                        break
                    }
                }
                if (hasNewInput) break
            }

            if (!hasNewInput) return

            clearTimeout(_debounce)
            _debounce = setTimeout(() => attemptFocus(), OBSERVER_DEBOUNCE_MS)
        })

        _observer.observe(document.body, { childList: true, subtree: true })

        _observerTimer = setTimeout(() => {
            if (_observer) {
                _observer.disconnect()
                _observer = null
            }
            logVerbose('Observer disconnected (timeout)')
        }, OBSERVER_TIMEOUT_MS)
    }

    function stopObserver() {
        if (_observer) {
            _observer.disconnect()
            _observer = null
        }
        clearTimeout(_observerTimer)
        clearTimeout(_debounce)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  SPA NAVIGATION
    // ═══════════════════════════════════════════════════════════════════

    // The script runs in Tampermonkey's sandbox (due to @grant), so
    // history.pushState here is the sandbox's copy — NOT the page's.
    // SPA frameworks call the real pushState on the page context.
    // We must use unsafeWindow to patch the page's actual history,
    // or use the Navigation API which fires for all navigations.

    function setupSPADetection() {
        let lastUrl = location.href

        function onNavigation() {
            if (location.href === lastUrl) return
            lastUrl = location.href
            logVerbose('SPA navigation detected')
            cycleIndex = -1
            hideIndicator()
            setTimeout(() => {
                if (!isExcluded()) {
                    attemptFocus()
                    startObserver()
                }
            }, FOCUS_DELAY_MS)
        }

        // Modern Navigation API — catches all navigation types
        if (unsafeWindow.navigation) {
            unsafeWindow.navigation.addEventListener('navigatesuccess', onNavigation)
            logVerbose('Using Navigation API for SPA detection')
        } else {
            // Fallback: patch the PAGE's history (via unsafeWindow, not sandbox)
            const pageHistory = unsafeWindow.history
            const origPush = pageHistory.pushState
            pageHistory.pushState = function () {
                origPush.apply(this, arguments)
                onNavigation()
            }

            const origReplace = pageHistory.replaceState
            pageHistory.replaceState = function () {
                origReplace.apply(this, arguments)
                onNavigation()
            }
            logVerbose('Using pushState/replaceState patch for SPA detection')
        }

        // These events fire correctly even in sandbox
        window.addEventListener('popstate', onNavigation)
        window.addEventListener('hashchange', onNavigation)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FLOATING INDICATOR
    // ═══════════════════════════════════════════════════════════════════

    let _fadeTimer = null
    let _popoverOpen = false

    function showIndicator(label) {
        clearTimeout(_fadeTimer)

        let indicator = document.getElementById(INDICATOR_ID)
        if (!indicator) {
            indicator = document.createElement('div')
            indicator.id = INDICATOR_ID
            indicator.innerHTML = '<span class="afs-icon">&#128269;</span>'
            indicator.addEventListener('click', (e) => {
                e.stopPropagation()
                togglePopover(label)
            })
            document.body.appendChild(indicator)
        }

        // Store latest label for popover
        indicator.dataset.label = label

        // Show
        indicator.style.opacity = '1'
        indicator.style.pointerEvents = 'auto'
        _popoverOpen = false
        hidePopover()

        // Schedule fade
        _fadeTimer = setTimeout(() => {
            if (!_popoverOpen) {
                indicator.style.opacity = '0'
                indicator.style.pointerEvents = 'none'
            }
        }, INDICATOR_FADE_MS)
    }

    function hideIndicator() {
        clearTimeout(_fadeTimer)
        const indicator = document.getElementById(INDICATOR_ID)
        if (indicator) {
            indicator.style.opacity = '0'
            indicator.style.pointerEvents = 'none'
        }
        hidePopover()
    }

    function togglePopover(label) {
        const existing = document.getElementById(POPOVER_ID)
        if (existing) {
            hidePopover()
            return
        }
        showPopover(label)
    }

    function showPopover(label) {
        _popoverOpen = true
        clearTimeout(_fadeTimer)

        const indicator = document.getElementById(INDICATOR_ID)
        if (!indicator) return

        // Use stored label if not provided
        const displayLabel = label || indicator.dataset.label || 'unknown'

        const popover = document.createElement('div')
        popover.id = POPOVER_ID

        const excluded = isExcluded()
        const hostname = window.location.hostname

        popover.innerHTML = `
            <div class="afs-popover-header">
                <span class="afs-popover-title">Auto Focus Search</span>
                <button class="afs-popover-close">&times;</button>
            </div>
            <div class="afs-popover-body">
                <div class="afs-popover-row">
                    <span class="afs-popover-label">${hostname}</span>
                    <button class="afs-popover-toggle ${excluded ? 'afs-off' : 'afs-on'}">
                        ${excluded ? 'Disabled' : 'Enabled'}
                    </button>
                </div>
                <div class="afs-popover-row afs-popover-element">
                    <span class="afs-popover-label">Focused:</span>
                    <code class="afs-popover-code">${displayLabel}</code>
                </div>
            </div>
        `

        // Close button
        popover.querySelector('.afs-popover-close').addEventListener('click', (e) => {
            e.stopPropagation()
            hidePopover()
            hideIndicator()
        })

        // Toggle button
        popover.querySelector('.afs-popover-toggle').addEventListener('click', (e) => {
            e.stopPropagation()
            const nowExcluded = toggleExclusion()
            const btn = e.target
            if (nowExcluded) {
                btn.textContent = 'Disabled'
                btn.classList.remove('afs-on')
                btn.classList.add('afs-off')
                stopObserver()
                log(`Disabled on ${hostname}`)
            } else {
                btn.textContent = 'Enabled'
                btn.classList.remove('afs-off')
                btn.classList.add('afs-on')
                startObserver()
                attemptFocus()
                log(`Enabled on ${hostname}`)
            }
        })

        // Close on outside click
        popover._outsideClick = (e) => {
            if (!popover.contains(e.target) && e.target.id !== INDICATOR_ID) {
                hidePopover()
                hideIndicator()
            }
        }
        setTimeout(() => document.addEventListener('click', popover._outsideClick), 0)

        document.body.appendChild(popover)
    }

    function hidePopover() {
        const popover = document.getElementById(POPOVER_ID)
        if (popover) {
            document.removeEventListener('click', popover._outsideClick)
            popover.remove()
        }
        _popoverOpen = false
    }

    // ═══════════════════════════════════════════════════════════════════
    //  KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════════════════════════════════

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Alt+Shift+S — toggle on current site
            if (e.altKey && e.shiftKey && e.key === 'S') {
                e.preventDefault()
                const nowExcluded = toggleExclusion()
                const hostname = window.location.hostname
                if (nowExcluded) {
                    log(`Disabled on ${hostname}`)
                    stopObserver()
                    hideIndicator()
                } else {
                    log(`Enabled on ${hostname}`)
                    startObserver()
                    attemptFocus()
                }
                return
            }

            // Alt+Shift+N — cycle through search inputs
            if (e.altKey && e.shiftKey && e.key === 'N') {
                e.preventDefault()
                if (isExcluded()) return
                cycleFocus()
            }
        })
    }

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
                        logVerbose(`Up to date (v${SCRIPT_VERSION})`)
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

    function showUpdateBanner(remote) {
        if (document.getElementById(UPDATE_BANNER_ID)) return
        const banner = document.createElement('div')
        banner.id = UPDATE_BANNER_ID
        banner.textContent = `Auto Focus Search v${remote} available — click to update`
        banner.addEventListener('click', () => {
            window.open(DOWNLOAD_URL, '_blank')
        })
        document.body.prepend(banner)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CSS
    // ═══════════════════════════════════════════════════════════════════

    GM_addStyle(`
        /* Floating indicator */
        #${INDICATOR_ID} {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 40px;
            height: 40px;
            background: #1a1a2e;
            border: 2px solid #16213e;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 2147483646;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease, transform 0.2s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            font-size: 18px;
            line-height: 1;
        }
        #${INDICATOR_ID}:hover {
            transform: scale(1.1);
            background: #16213e;
        }
        #${INDICATOR_ID} .afs-icon {
            pointer-events: none;
        }

        /* Settings popover */
        #${POPOVER_ID} {
            position: fixed;
            bottom: 70px;
            right: 20px;
            width: 280px;
            background: #1a1a2e;
            border: 1px solid #16213e;
            border-radius: 8px;
            z-index: 2147483647;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: #e0e0e0;
            overflow: hidden;
        }
        .afs-popover-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            border-bottom: 1px solid #16213e;
            background: #0f3460;
        }
        .afs-popover-title {
            font-weight: 600;
            font-size: 13px;
        }
        .afs-popover-close {
            background: none;
            border: none;
            color: #e0e0e0;
            font-size: 18px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
            opacity: 0.7;
        }
        .afs-popover-close:hover { opacity: 1; }
        .afs-popover-body {
            padding: 10px 12px;
        }
        .afs-popover-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .afs-popover-row:last-child { margin-bottom: 0; }
        .afs-popover-label {
            font-size: 12px;
            color: #a0a0a0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 160px;
        }
        .afs-popover-toggle {
            padding: 4px 10px;
            border-radius: 4px;
            border: none;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
        }
        .afs-popover-toggle.afs-on {
            background: #2ecc71;
            color: #fff;
        }
        .afs-popover-toggle.afs-on:hover { background: #27ae60; }
        .afs-popover-toggle.afs-off {
            background: #e74c3c;
            color: #fff;
        }
        .afs-popover-toggle.afs-off:hover { background: #c0392b; }
        .afs-popover-element {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
        }
        .afs-popover-code {
            background: #16213e;
            padding: 3px 6px;
            border-radius: 3px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 11px;
            color: #7ec8e3;
            word-break: break-all;
            max-width: 100%;
        }

        /* Update banner */
        #${UPDATE_BANNER_ID} {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #0f3460;
            color: #e0e0e0;
            text-align: center;
            padding: 8px 16px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            cursor: pointer;
            z-index: 2147483647;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        #${UPDATE_BANNER_ID}:hover {
            background: #1a1a5e;
        }
    `)

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════

    function init() {
        log(`v${SCRIPT_VERSION} loaded on ${window.location.hostname}`)
        checkForUpdate()
        setupKeyboardShortcuts()
        setupSPADetection()

        if (isExcluded()) {
            log('Site excluded, skipping')
            return
        }

        setTimeout(() => {
            attemptFocus()
            startObserver()
        }, FOCUS_DELAY_MS)
    }

    init()
})()
