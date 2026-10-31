// ==UserScript==
// @name         Luna Autoclaim
// @namespace    luna-autoclaim
// @version      0.12.0
// @description  Open available Prime Gaming claim pages on Luna one at a time with per-store filtering
// @include      /^https:\/\/luna\.amazon\.[a-z.]{2,6}\//
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
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

  const DISABLED_STORES_KEY = "lac_disabled_stores_v1";

  // All known stores in display order — used to build the settings list.
  const KNOWN_STORES = ["Amazon Games", "Epic Games", "GOG", "Legacy Games", "Microsoft Store"];

  // Maps the title-attribute suffix to the canonical store name.
  // "on Microsoft Store" is UNVERIFIED against a live page (see todo).
  const STORE_PATTERNS = [
    ["on Amazon Games", "Amazon Games"],
    ["on Epic Games Store", "Epic Games"],
    ["on GOG.com", "GOG"],
    ["on Legacy Games", "Legacy Games"],
    ["on Microsoft Store", "Microsoft Store"],
  ];

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
  //  PURE LOGIC
  // ═══════════════════════════════════════════════════════════════════

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

  /**
   * The store-looking labels on the page ("on <Something>"), for telling
   * the user what was seen when no known store matched.
   */
  function describeSeenStoresFromTitles(titles) {
    const seen = [...new Set(titles.filter((t) => /^on\s+\S/i.test(t.trim())))];
    return seen.length ? seen.map((t) => `"${t.trim()}"`).join(", ") : "no store label";
  }

  /**
   * Split listing items by the store toggles.
   * Items with an unknown store are still included in `toOpen` so the user
   * can inspect the claim page themselves; known stores set to Skip are
   * excluded from `toOpen` and placed in `skipped`.
   */
  function partitionClaimItems(items, disabledStores) {
    const toOpen = [];
    const skipped = [];
    let unknown = 0;
    for (const item of items) {
      if (item.store && disabledStores.has(item.store)) {
        skipped.push(item);
      } else {
        if (!item.store) unknown++;
        toOpen.push(item);
      }
    }
    return { toOpen, skipped, unknown };
  }

  /**
   * Select the next eligible claim entry that hasn't been opened yet in this
   * session, along with how many of the current `toOpen` list have already
   * been opened.
   */
  function pickNextClaim(toOpen, openedUrls) {
    let openedCount = 0;
    let next = null;
    for (const item of toOpen) {
      if (openedUrls.has(item.href)) {
        openedCount++;
      } else if (!next) {
        next = item;
      }
    }
    return { next, openedCount, total: toOpen.length };
  }

  function describePlan({ toOpen, skipped, unknown }, verb) {
    const parts = [`${verb} ${toOpen.length}`];
    if (skipped.length) parts.push(`skipped ${skipped.length} (store set to Skip)`);
    if (unknown) parts.push(`${unknown} store unknown`);
    return parts.join(" · ");
  }

  function describeProgress(openedCount, { toOpen, skipped, unknown }) {
    const parts = [`Opened ${openedCount} of ${toOpen.length}`];
    if (skipped.length) parts.push(`skipped ${skipped.length} (store set to Skip)`);
    if (unknown) parts.push(`${unknown} store unknown`);
    return parts.join(" · ");
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════

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

  function describeSeenStores() {
    return describeSeenStoresFromTitles(titlesIn(document));
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

  function planClaims() {
    const items = findButtonsByText("Claim game").map((btn) => ({
      btn,
      href: new URL(btn.href, window.location.href).href,
      gameName: getGameName(btn),
      store: getListingStore(btn),
    }));
    return partitionClaimItems(items, loadDisabledStores());
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CORE ACTIONS — HOME PAGE
  // ═══════════════════════════════════════════════════════════════════

  // Tracks claim URLs already opened via "Open Next" on the current listing.
  const openedUrls = new Set();

  function openNextClaim() {
    const plan = planClaims();
    const { toOpen, skipped } = plan;
    if (toOpen.length === 0 && skipped.length === 0) {
      log('No "Claim Game" buttons found — all keys may already be redeemed');
      updateStatus("No keys to reveal");
      return;
    }

    skipped.forEach(({ gameName, store }) =>
      logItem(`Skipping ${gameName} — ${store} is set to Skip`),
    );
    if (toOpen.length === 0) {
      log(`All ${skipped.length} claim(s) are for stores set to Skip — nothing opened`);
      updateStatus(describePlan(plan, "Opened"));
      return;
    }

    const { next, openedCount, total } = pickNextClaim(toOpen, openedUrls);
    if (!next) {
      log(`All ${total} eligible claim page(s) have already been opened`);
      updateStatus(describeProgress(openedCount, plan));
      setButtonsEnabled(false);
      return;
    }

    openedUrls.add(next.href);
    const newOpenedCount = openedCount + 1;
    logItem(
      `Opened ${newOpenedCount} of ${total}: ${next.gameName} (${next.store ?? "store unknown"})`,
    );
    GM_openInTab(next.href, { active: false });
    updateStatus(describeProgress(newOpenedCount, plan));
    setButtonsEnabled(newOpenedCount < total);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — SHARED
  // ═══════════════════════════════════════════════════════════════════

  let claimBtn = null;

  // Home page only: preview what "Open Next" will do under the current toggles.
  function refreshListingStatus() {
    const plan = planClaims();
    const { next, openedCount, total } = pickNextClaim(plan.toOpen, openedUrls);
    setButtonsEnabled(total === 0 || Boolean(next));
    if (openedCount > 0) {
      const progressText = describeProgress(openedCount, plan);
      log(`Listing: ${progressText}`);
      updateStatus(progressText);
      return;
    }
    log(`Listing: ${describePlan(plan, "to open")}`);
    updateStatus(describePlan(plan, "To open:"));
  }

  function setButtonsEnabled(enabled) {
    setControlsEnabled([claimBtn], enabled);
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

    claimBtn = document.createElement("button");
    claimBtn.id = "lac-claim-btn";
    claimBtn.className = "lac-btn lac-btn-primary";
    claimBtn.textContent = "Open Next";
    claimBtn.addEventListener("click", openNextClaim);
    panel.appendChild(claimBtn);

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
      updateStatus(`Store not recognised (saw ${describeSeenStores()})`, "error");
    } else if (isStoreDisabled(store)) {
      updateStatus("Store set to Skip");

      // Allow re-enabling without going back to the home page.
      const enableBtn = document.createElement("button");
      enableBtn.className = "lac-btn";
      enableBtn.textContent = `Enable ${store}`;
      enableBtn.addEventListener("click", () => {
        toggleStoreDisabled(store);
        log(`${store} re-enabled`);
        panel.remove();
        createClaimPagePanel(store);
      });
      panel.appendChild(enableBtn);
    } else {
      updateStatus("Ready — use page button to claim");

      const disableBtn = document.createElement("button");
      disableBtn.className = "lac-btn lac-btn-danger";
      disableBtn.textContent = `Skip ${store} always`;
      disableBtn.addEventListener("click", () => {
        toggleStoreDisabled(store);
        log(`${store} disabled`);
        panel.remove();
        createClaimPagePanel(store);
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
      openedUrls.clear();
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
