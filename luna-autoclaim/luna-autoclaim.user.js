// ==UserScript==
// @name         Luna Autoclaim
// @namespace    luna-autoclaim
// @version      0.12.0
// @description  Bulk-reveal and bulk-redeem keys on Luna
// @include      /^https:\/\/luna\.amazon\.[a-z.]{2,6}\//
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

// @include regex: luna.amazon.<TLD> where TLD is 2–6 chars (covers .com, .ca, .co.uk, etc.)
// Matches the whole site, not just the claim paths — Luna is a single-page
// app that swaps routes via client-side (fake) navigation, so Tampermonkey
// may never inject the script if it only matches /claims/home or
// /claims/.../dp/ and the user first lands somewhere else. Route-specific
// behavior is handled internally by handleRoute(), which also re-runs on
// SPA navigation (see "SPA NAVIGATION" below) instead of relying on a full
// page load.
// Path arm 1 — home listing:  /claims/home…
// Path arm 2 — claim detail:  /claims/<slug>/dp/…

(function () {
  "use strict";

  const SCRIPT_VERSION =
    typeof GM_info !== "undefined" && GM_info.script?.version
      ? GM_info.script.version
      : "__DEV__";
  const LOG_PREFIX = "[Luna Autoclaim]";
  const SHORT_PREFIX = "[LAC]";
  const UI_PREFIX = "lac"; // panel ids/classes — see the autoclaim-kit block

  const DEFAULT_REVEAL_DELAY_MS = 500;
  const DEFAULT_REDEEM_DELAY_MS = 800;

  const DISABLED_STORES_KEY = "lac_disabled_stores_v1";

  // All known stores in display order — used to build the settings list.
  // A store not listed here is never claimed — see claimRefusal().
  const KNOWN_STORES = ["Amazon Games", "Epic Games", "GOG", "Legacy Games", "Microsoft Store"];

  // Maps the title-attribute suffix to the canonical store name.
  // "on Microsoft Store" is UNVERIFIED against a live page (see todo). A wrong
  // guess is safe: it just leaves Microsoft keys unrecognised, and those are
  // refused rather than claimed.
  const STORE_PATTERNS = [
    ["on Amazon Games", "Amazon Games"],
    ["on Epic Games Store", "Epic Games"],
    ["on GOG.com", "GOG"],
    ["on Legacy Games", "Legacy Games"],
    ["on Microsoft Store", "Microsoft Store"],
  ];

  // GOG: after the Luna claim, the key is exposed with a "Claim code" link
  // of the form https://www.gog.com/redeem/<game_key>. The script stops
  // there — redeeming on gog.com is left to the user (see archive/gog-redeem).
  const GOG_REDEEM_URL_RE =
    /^https:\/\/(?:www\.)?gog\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?redeem\/([A-Za-z0-9-]+)\/?(?:[?#].*)?$/;

  // Mutable — updated by the UI input
  let revealDelayMs = DEFAULT_REVEAL_DELAY_MS;
  let redeemDelayMs = DEFAULT_REDEEM_DELAY_MS;

  // ═══════════════════════════════════════════════════════════════════
  //  LOGGING
  // ═══════════════════════════════════════════════════════════════════

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }
  function logItem(...args) {
    console.log(SHORT_PREFIX, ...args);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  STORE PREFS — persisted to localStorage
  // ═══════════════════════════════════════════════════════════════════

  function loadDisabledStores() {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISABLED_STORES_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  function saveDisabledStores(set) {
    localStorage.setItem(DISABLED_STORES_KEY, JSON.stringify([...set]));
  }

  function isStoreDisabled(store) {
    return loadDisabledStores().has(store);
  }

  // Toggles disabled state for a store. Returns the new disabled state (true = now disabled).
  function toggleStoreDisabled(store) {
    const set = loadDisabledStores();
    if (set.has(store)) {
      set.delete(store);
    } else {
      set.add(store);
    }
    saveDisabledStores(set);
    return set.has(store);
  }

  // <update-check>
  // ═══════════════════════════════════════════════════════════════════
  //  UPDATE CHECK
  //  Generated from tools/update-check.template.js — do not edit here.
  //  Change the template, then run: node tools/sync-update-check.mjs
  // ═══════════════════════════════════════════════════════════════════

  const UPDATE_BANNER_ID = 'luna-autoclaim-update-banner'
  const UPDATE_DISMISS_KEY = 'luna_autoclaim_update_dismissed_v'

  // Tampermonkey exposes the script's own metadata block, so these URLs
  // don't have to be hand-maintained in two places. Greasemonkey 4 does
  // not expose them, hence the literal fallbacks.
  const META_URL =
    (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.updateURL) ||
    'https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js'
  const DOWNLOAD_URL =
    (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.downloadURL) ||
    'https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js'

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

  // ═══════════════════════════════════════════════════════════════════
  //  DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════

  // The page's own window — Luna's click handlers call *its* window.open.
  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  /**
   * Click `el`, but keep whatever it opens in this tab: drop a
   * target="_blank" on its anchor, and for a few seconds route the page's
   * window.open() into a same-tab navigation.
   */
  function clickInSameTab(el, windowMs = 10000) {
    const anchor = el.closest("a");
    if (anchor && anchor.getAttribute("target") && anchor.getAttribute("target") !== "_self") {
      anchor.removeAttribute("target");
    }

    const originalOpen = pageWindow.open;
    const sameTabOpen = function (url, ...rest) {
      // window.open() with no URL is the "open blank, set location later"
      // pattern — there's nothing to redirect, so let the page have it.
      if (!url) return originalOpen.call(pageWindow, url, ...rest);
      const abs = new URL(String(url), window.location.href).href;
      log(`Keeping window.open in this tab → ${abs.replace(GOG_REDEEM_URL_RE, "gog.com/redeem/…")}`);
      window.location.assign(abs);
      return null;
    };
    // Firefox's sandbox needs the function exported into the page scope.
    pageWindow.open =
      typeof exportFunction === "function" ? exportFunction(sameTabOpen, pageWindow) : sameTabOpen;
    try {
      el.click();
    } finally {
      setTimeout(() => {
        pageWindow.open = originalOpen;
      }, windowMs);
    }
  }

  function findButtonsByText(text) {
    const candidates = document.querySelectorAll(
      '.item-card__claim-button a.tw-button[data-a-target="FGWPOffer"]',
    );
    return Array.from(candidates).filter((el) => el.textContent.trim() === text);
  }

  /**
   * Walk up from a claim button to the card root, then find the title h3.
   * Uses the `title` attribute which Luna sets to the exact game name.
   */
  function getGameName(btn) {
    const card = btn.closest(".item-card-details");
    if (!card) return "unknown";
    const h3 = card.querySelector("h3[title]");
    return h3 ? h3.getAttribute("title") : h3?.textContent?.trim() ?? "unknown";
  }

  /**
   * Match a set of title strings against STORE_PATTERNS.
   * Returns the canonical store name, or null when none — or more than one
   * — store matches, so an ambiguous scope never gets guessed at.
   */
  function matchStore(titles) {
    const stores = new Set(
      STORE_PATTERNS.filter(([pattern]) => titles.some((t) => t.includes(pattern))).map(
        ([, store]) => store,
      ),
    );
    return stores.size === 1 ? [...stores][0] : null;
  }

  function titlesIn(root) {
    return Array.from(root.querySelectorAll("p[title]")).map((p) => p.getAttribute("title"));
  }

  /**
   * Detect which store the current claim page is for.
   * Checks all p[title] elements to avoid false-positives from unrelated elements.
   */
  function detectStore() {
    return matchStore(titlesIn(document));
  }

  /**
   * The store-looking labels on the page ("on <Something>"), for telling
   * the user what was seen when no known store matched.
   */
  function describeSeenStores() {
    const seen = [...new Set(titlesIn(document).filter((t) => /^on\s+\S/i.test(t.trim())))];
    return seen.length ? seen.map((t) => `"${t.trim()}"`).join(", ") : "no store label";
  }

  /**
   * Why this claim page must not be claimed, or null when it may be.
   * An unrecognised store is a hard stop: clicking would claim a store the
   * script doesn't understand.
   */
  function claimRefusal(store) {
    if (!store) return `Store not recognised (saw ${describeSeenStores()}) — not claiming`;
    if (isStoreDisabled(store)) return `${store} is set to Skip — not claiming`;
    return null;
  }

  /**
   * Detect the store for one listing entry, before its claim page exists.
   * Same card walk as getGameName(), same p[title] vocabulary as detectStore().
   * Returns null when the card doesn't expose a store label — callers must
   * not guess from the game name.
   */
  function getListingStore(btn) {
    const card = btn.closest(".item-card-details");
    return card ? matchStore(titlesIn(card)) : null;
  }

  /**
   * Split the listing's claim buttons by the store toggles.
   * `unknown` entries are still opened: the claim page resolves their store,
   * enforces the toggle there, and refuses to claim a store it can't identify.
   */
  function planClaims() {
    const disabled = loadDisabledStores();
    const toOpen = [];
    const skipped = [];
    let unknown = 0;
    for (const btn of findButtonsByText("Claim game")) {
      const store = getListingStore(btn);
      if (store && disabled.has(store)) {
        skipped.push({ btn, store });
      } else {
        if (!store) unknown++;
        toOpen.push({ btn, store });
      }
    }
    return { toOpen, skipped, unknown };
  }

  function describePlan({ toOpen, skipped, unknown }, verb) {
    const parts = [`${verb} ${toOpen.length}`];
    if (skipped.length) parts.push(`skipped ${skipped.length} (store set to Skip)`);
    if (unknown) parts.push(`${unknown} store unknown`);
    return parts.join(" · ");
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CORE ACTIONS — HOME PAGE
  // ═══════════════════════════════════════════════════════════════════

  async function openAllClaims({ autoClaim = false } = {}) {
    const plan = planClaims();
    const { toOpen, skipped } = plan;
    if (toOpen.length === 0 && skipped.length === 0) {
      log('No "Claim Game" buttons found — all keys may already be redeemed');
      updateStatus("No keys to reveal");
      return;
    }

    skipped.forEach(({ btn, store }) =>
      logItem(`Skipping ${getGameName(btn)} — ${store} is set to Skip`),
    );
    if (toOpen.length === 0) {
      log(`All ${skipped.length} claim(s) are for stores set to Skip — nothing opened`);
      updateStatus(describePlan(plan, "Opened"));
      return;
    }

    log(
      `Found ${toOpen.length} key(s) to claim, ${skipped.length} skipped, ` +
        `${plan.unknown} with unknown store (autoClaim=${autoClaim})`,
    );
    updateStatus(`Opening 0/${toOpen.length}...`);
    setButtonsEnabled(false);

    for (let i = 0; i < toOpen.length; i++) {
      const { btn, store } = toOpen[i];
      const gameName = getGameName(btn);

      logItem(`Opening ${i + 1}/${toOpen.length}: ${gameName} (${store ?? "store unknown"})`);
      updateStatus(`Opening ${i + 1}/${toOpen.length}: ${gameName}`);

      const url = new URL(btn.href);
      if (autoClaim) url.searchParams.set("lac_autoclaim", "1");
      GM_openInTab(url.toString(), { active: false });

      if (i < toOpen.length - 1) {
        await sleep(revealDelayMs);
      }
    }

    await sleep(revealDelayMs);
    log("All claim pages opened");
    updateStatus(describePlan(plan, "Opened"));
    setButtonsEnabled(true);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CORE ACTIONS — CLAIM PAGE
  // ═══════════════════════════════════════════════════════════════════

  function findClaimCta() {
    return document.querySelector('[data-a-target="buy-box_call-to-action"]');
  }

  async function claimCurrentGame() {
    const btn = findClaimCta();
    if (!btn) {
      warn("Claim button not found");
      updateStatus("Claim button not found", "error");
      return;
    }

    // Re-checked at click time: the panel may have been built before the
    // page finished rendering, and the auto-claim path gets here directly.
    const store = detectStore();
    const refusal = claimRefusal(store);
    if (refusal) {
      warn(refusal);
      updateStatus(refusal, "error");
      return;
    }
    log(`Claiming via ${store}`);
    updateStatus(`Claiming via ${store}…`);
    setButtonsEnabled(false);

    const before = snapshotClaimState(btn);
    if (store === "GOG") {
      // Luna opens a second claim page to expose the key — keep it in this
      // tab so the claim can be verified here.
      clickInSameTab(btn);
    } else {
      btn.click();
    }

    updateStatus(`Claim clicked — checking it went through…`);
    const result = await verifyClaim(before, store);
    setButtonsEnabled(true);
    reportClaimResult(result);

    if (store === "GOG" && result.ok) {
      updateStatus('✓ Claimed — click "Claim code" to redeem on GOG', "ok");
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CLAIM VERIFICATION
  // ═══════════════════════════════════════════════════════════════════
  //
  // A claim only counts once Luna shows it worked. Anything else — an error
  // popup, or no signal before the timeout — is reported as a failure, and
  // the tab is left exactly where it is so the user can reload and check.
  //
  // UNVERIFIED signals (no before/after capture exists yet — see todo):
  //   success: the call-to-action reads "Claimed"/"Redeemed", a dialog or
  //            alert says so, or (GOG) the "Claim code" link appears.
  //   error:   a dialog/alert/live region, new since the click, whose text
  //            reads like an error; or the call-to-action itself does.

  const CLAIM_VERIFY_TIMEOUT_MS = 15000;
  const CLAIM_SUCCESS_RE = /\b(claimed|redeemed|successfully)\b/i;
  const CLAIM_ERROR_RE =
    /\b(error|went wrong|try again|unable to|failed|couldn['’]t|could not|not available)\b/i;
  const CLAIM_PENDING_RE = /\b(claiming|loading|processing)\b/i;

  function noticeTexts() {
    return Array.from(
      document.querySelectorAll('[role="alert"], [role="alertdialog"], [role="dialog"], [aria-live]'),
    )
      .filter((el) => !el.closest("#lac-panel") && el.getClientRects().length > 0)
      .map((el) => el.textContent.trim().replace(/\s+/g, " "))
      .filter(Boolean);
  }

  function snapshotClaimState(btn) {
    return { label: btn.textContent.trim(), notices: new Set(noticeTexts()) };
  }

  function probeClaim(before, store) {
    const cta = findClaimCta();
    const label = cta?.textContent.trim() ?? "";

    const fresh = noticeTexts().filter((t) => !before.notices.has(t));
    const errorNotice = fresh.find((t) => CLAIM_ERROR_RE.test(t));
    if (errorNotice) return { ok: false, reason: `Luna says: "${errorNotice.slice(0, 120)}"` };
    if (label && label !== before.label && CLAIM_ERROR_RE.test(label)) {
      return { ok: false, reason: `Claim button now reads "${label}"` };
    }

    if (store === "GOG" && findGogClaimCode()) return { ok: true, signal: "GOG key exposed" };
    if (label && label !== before.label && CLAIM_SUCCESS_RE.test(label)) {
      return { ok: true, signal: `button reads "${label}"` };
    }
    const successNotice = fresh.find((t) => CLAIM_SUCCESS_RE.test(t));
    if (successNotice) return { ok: true, signal: `"${successNotice.slice(0, 80)}"` };
    return null;
  }

  async function verifyClaim(before, store) {
    const result = await waitFor(() => probeClaim(before, store), CLAIM_VERIFY_TIMEOUT_MS);
    if (result) return result;

    const label = findClaimCta()?.textContent.trim();
    let reason = `no confirmation from Luna after ${CLAIM_VERIFY_TIMEOUT_MS / 1000}s`;
    if (!label) reason += " (claim button is gone)";
    else if (label !== before.label) reason += ` (button now reads "${label}")`;
    if (label && CLAIM_PENDING_RE.test(label)) reason += " — still pending";
    return { ok: false, reason };
  }

  function reportClaimResult(result) {
    if (result.ok) {
      log(`Claim confirmed: ${result.signal}`);
      updateStatus(`✓ Claimed — ${result.signal}`, "ok");
    } else {
      warn(`Claim NOT confirmed: ${result.reason}`);
      updateStatus(`⚠ Claim not confirmed: ${result.reason}. Reload and check.`, "error");
    }
    // Background tabs from "Auto Claim All" are easiest to triage from the
    // tab strip. Best effort — Luna may rewrite the title.
    const mark = result.ok ? "✓ " : "⚠ ";
    if (!document.title.startsWith(mark)) document.title = mark + document.title;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GOG CLAIM CODE
  // ═══════════════════════════════════════════════════════════════════
  //
  // Only read, never followed: its appearance is the success signal for a
  // GOG claim. The user clicks it and redeems on gog.com by hand.

  /**
   * The "Claim code" target: an anchor whose href is a GOG redeem URL,
   * else the "Claim code" button itself (its link may be wired in JS).
   */
  function findGogClaimCode() {
    for (const a of document.querySelectorAll('a[href*="gog.com"]')) {
      if (GOG_REDEEM_URL_RE.test(a.href)) return { url: a.href };
    }
    const button = Array.from(document.querySelectorAll('a, button, [role="button"]')).find(
      (el) => !el.closest("#lac-panel") && el.textContent.trim().toLowerCase() === "claim code",
    );
    return button ? { el: button } : null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — SHARED
  // ═══════════════════════════════════════════════════════════════════

  let claimBtn = null;
  let autoClaimBtn = null;

  // Home page only: preview what "Open All" would do under the current toggles.
  function refreshListingStatus() {
    // Don't clobber the "Opening i/n" progress line mid-run.
    if (claimBtn?.disabled) return;
    const plan = planClaims();
    log(`Listing: ${describePlan(plan, "to open")}`);
    updateStatus(describePlan(plan, "To open:"));
  }

  function setButtonsEnabled(enabled) {
    setControlsEnabled([claimBtn, autoClaimBtn], enabled);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — HOME PAGE PANEL
  // ═══════════════════════════════════════════════════════════════════

  function createStoreToggleRow(storeName) {
    const row = document.createElement("div");
    row.className = "lac-store-row";

    const label = document.createElement("span");
    label.className = "lac-store-label";
    label.textContent = storeName;

    const toggle = document.createElement("button");
    const disabled = isStoreDisabled(storeName);
    toggle.className = `lac-store-toggle ${disabled ? "lac-store-toggle--off" : "lac-store-toggle--on"}`;
    toggle.textContent = disabled ? "Skip" : "Claim";
    toggle.title = `Click to ${disabled ? "enable" : "disable"} claiming for ${storeName}`;

    toggle.addEventListener("click", () => {
      const nowDisabled = toggleStoreDisabled(storeName);
      toggle.className = `lac-store-toggle ${nowDisabled ? "lac-store-toggle--off" : "lac-store-toggle--on"}`;
      toggle.textContent = nowDisabled ? "Skip" : "Claim";
      toggle.title = `Click to ${nowDisabled ? "enable" : "disable"} claiming for ${storeName}`;
      log(`${storeName}: ${nowDisabled ? "disabled" : "enabled"}`);
      refreshListingStatus();
    });

    row.appendChild(label);
    row.appendChild(toggle);
    return row;
  }

  function createPanel() {
    const panel = buildPanelShell("Autoclaim");

    autoClaimBtn = document.createElement("button");
    autoClaimBtn.id = "lac-auto-claim-btn";
    autoClaimBtn.className = "lac-btn lac-btn-primary";
    autoClaimBtn.textContent = "Auto Claim All";
    autoClaimBtn.addEventListener("click", () => openAllClaims({ autoClaim: true }));
    panel.appendChild(autoClaimBtn);

    claimBtn = document.createElement("button");
    claimBtn.id = "lac-claim-btn";
    claimBtn.className = "lac-btn";
    claimBtn.textContent = "Open All";
    claimBtn.addEventListener("click", () => openAllClaims());
    panel.appendChild(claimBtn);

    const delaySection = document.createElement("div");
    delaySection.id = "lac-delays";
    delaySection.appendChild(
      createDelayInput("Open delay", DEFAULT_REVEAL_DELAY_MS, (v) => {
        revealDelayMs = v;
      }),
    );
    delaySection.appendChild(
      createDelayInput("Redeem delay", DEFAULT_REDEEM_DELAY_MS, (v) => {
        redeemDelayMs = v;
      }),
    );
    panel.appendChild(delaySection);

    const storeSection = document.createElement("div");
    storeSection.id = "lac-stores";
    const storesLabel = document.createElement("div");
    storesLabel.className = "lac-section-label";
    storesLabel.textContent = "Stores";
    storeSection.appendChild(storesLabel);
    KNOWN_STORES.forEach((s) => storeSection.appendChild(createStoreToggleRow(s)));
    panel.appendChild(storeSection);

    createStatusLine(panel, "Ready");

    document.body.appendChild(panel);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — CLAIM PAGE PANEL
  // ═══════════════════════════════════════════════════════════════════

  function createClaimPagePanel(store) {
    const panel = buildPanelShell("Autoclaim");

    const storeEl = document.createElement("div");
    storeEl.id = "lac-store";
    storeEl.textContent = store
      ? `Store: ${store}`
      : `Store: not recognised (saw ${describeSeenStores()})`;
    panel.appendChild(storeEl);

    createStatusLine(panel);

    if (!store) {
      // No Claim button: an unknown store is never claimed from here.
      updateStatus(claimRefusal(store), "error");
    } else if (isStoreDisabled(store)) {
      updateStatus("Store set to Skip — not claiming");

      // Allow re-enabling without going back to the home page.
      const enableBtn = document.createElement("button");
      enableBtn.className = "lac-btn";
      enableBtn.textContent = `Enable ${store}`;
      enableBtn.addEventListener("click", () => {
        toggleStoreDisabled(store);
        log(`${store} re-enabled`);
        panel.remove();
        createClaimPagePanel(store);
        document.body.appendChild(document.getElementById("lac-panel"));
      });
      panel.appendChild(enableBtn);
    } else {
      updateStatus("Ready");

      claimBtn = document.createElement("button");
      claimBtn.id = "lac-claim-btn";
      claimBtn.className = "lac-btn lac-btn-primary";
      claimBtn.textContent = "Claim";
      claimBtn.addEventListener("click", claimCurrentGame);
      panel.appendChild(claimBtn);

      const disableBtn = document.createElement("button");
      disableBtn.className = "lac-btn lac-btn-danger";
      disableBtn.textContent = `Skip ${store} always`;
      disableBtn.addEventListener("click", () => {
        toggleStoreDisabled(store);
        log(`${store} disabled`);
        panel.remove();
        createClaimPagePanel(store);
        document.body.appendChild(document.getElementById("lac-panel"));
      });
      panel.appendChild(disableBtn);
    }

    document.body.appendChild(panel);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  STYLES
  // ═══════════════════════════════════════════════════════════════════

  // Base panel styles come from the autoclaim-kit block; these are the
  // Luna-only additions (store toggles).
  let lunaStylesInjected = false;

  function injectStyles() {
    injectPanelStyles();
    if (lunaStylesInjected) return;
    lunaStylesInjected = true;
    GM_addStyle(`
            #lac-stores {
                border-top: 1px solid #424242;
                padding-top: 8px;
                margin-top: 2px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .lac-section-label {
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #616161;
                margin-bottom: 2px;
            }

            .lac-store-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }

            .lac-store-label {
                font-size: 12px;
                color: #9e9e9e;
            }

            .lac-store-toggle {
                font-size: 10px;
                padding: 2px 8px;
                border-radius: 10px;
                border: 1px solid;
                cursor: pointer;
                font-family: inherit;
                font-weight: 600;
                transition: background 0.15s ease;
            }

            .lac-store-toggle--on {
                background: #1b5e20;
                color: #a5d6a7;
                border-color: #388e3c;
            }

            .lac-store-toggle--on:hover {
                background: #2e7d32;
            }

            .lac-store-toggle--off {
                background: #424242;
                color: #757575;
                border-color: #616161;
            }

            .lac-store-toggle--off:hover {
                background: #616161;
                color: #9e9e9e;
            }
        `);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════

  function waitForOrderContent(callback, maxWaitMs = 15000) {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const hasClaim = findButtonsByText("Claim game").length > 0;
      if (hasClaim) {
        clearInterval(interval);
        log(`Order content detected (${Date.now() - startTime}ms)`);
        callback();
        return;
      }
      if (Date.now() - startTime > maxWaitMs) {
        clearInterval(interval);
        warn(`Timed out waiting for order content after ${maxWaitMs}ms`);
        callback();
      }
    }, 500);
  }

  function waitForClaimPageContent(callback, maxWaitMs = 15000) {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const hasButton = !!document.querySelector('[data-a-target="buy-box_call-to-action"]');
      if (hasButton) {
        clearInterval(interval);
        log(`Claim page content detected (${Date.now() - startTime}ms)`);
        callback();
        return;
      }
      if (Date.now() - startTime > maxWaitMs) {
        clearInterval(interval);
        warn(`Timed out waiting for claim page content after ${maxWaitMs}ms`);
        callback();
      }
    }, 500);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SPA NAVIGATION
  // ═══════════════════════════════════════════════════════════════════
  //
  // Luna swaps routes client-side without a full page load, so the panel
  // has to be (re)built on navigation rather than only once at document-idle.
  // `routeGeneration` invalidates any in-flight waitFor*Content() callback
  // from a route we've since navigated away from (e.g. hopping between two
  // different claim pages before the first one's content ever appeared).

  let currentPanelRoute = null; // 'home' | 'claim' | null
  let routeGeneration = 0;

  function teardownPanel() {
    removePanel();
    claimBtn = null;
    autoClaimBtn = null;
  }

  function handleRoute() {
    const path = window.location.pathname;
    const isHome = /\/claims\/home/.test(path);
    const isClaim = /\/claims\/.+\/dp\//.test(path);

    if (!isHome && !isClaim) {
      if (currentPanelRoute !== null) {
        routeGeneration++;
        teardownPanel();
        currentPanelRoute = null;
      }
      return;
    }

    const newRoute = isHome ? "home" : "claim";
    // A claim page always re-runs even if the previous route was also
    // "claim" — it's a different game/store, not the same page re-rendering.
    if (newRoute === currentPanelRoute && newRoute === "home") return;

    const generation = ++routeGeneration;
    teardownPanel();
    currentPanelRoute = newRoute;

    if (isHome) {
      waitForOrderContent(() => {
        if (generation !== routeGeneration) return;
        injectStyles();
        createPanel();
        refreshListingStatus();
      });
      return;
    }

    waitForClaimPageContent(() => {
      if (generation !== routeGeneration) return;
      const store = detectStore();
      if (!store) warn(`Store not recognised — saw ${describeSeenStores()}`);
      log(`Store: ${store ?? "unknown"}`);
      injectStyles();
      createClaimPagePanel(store);

      const autoClaimParam =
        new URLSearchParams(window.location.search).get("lac_autoclaim") === "1";
      if (autoClaimParam) {
        const refusal = claimRefusal(store);
        if (refusal) {
          warn(`Auto-claim stopped: ${refusal}`);
        } else {
          log("Auto-claim triggered by URL param");
          // Brief delay so the page's own JS finishes binding before we click.
          sleep(redeemDelayMs).then(claimCurrentGame);
        }
      }
    });
  }

  function watchForNavigation() {
    let lastPath = window.location.pathname;

    const onLocationChange = () => {
      if (window.location.pathname === lastPath) return;
      lastPath = window.location.pathname;
      log(`Navigation detected → ${lastPath}`);
      handleRoute();
    };

    // Modern browsers: fires on SPA (pushState/replaceState-driven) navigation.
    if (typeof window.navigation !== "undefined") {
      window.navigation.addEventListener("navigate", () => {
        // The path isn't always updated yet when this fires — defer a tick.
        setTimeout(onLocationChange, 0);
      });
    }

    // Fallback for browsers without the Navigation API, and belt-and-braces
    // in case Luna's router doesn't fire "navigate" reliably.
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        onLocationChange();
        return result;
      };
    }
    window.addEventListener("popstate", onLocationChange);

    // Last-resort fallback: catch route changes that don't touch history at
    // all. The check inside onLocationChange is a cheap string compare, so
    // this is safe to run on every DOM mutation.
    new MutationObserver(onLocationChange).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    log(`v${SCRIPT_VERSION} loaded`);
    checkForUpdate();
    watchForNavigation();
    handleRoute();
  }

  init();
})();
