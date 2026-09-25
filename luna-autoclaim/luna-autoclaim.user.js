// ==UserScript==
// @name         Luna Autoclaim
// @namespace    luna-autoclaim
// @version      0.10.0
// @description  Bulk-reveal and bulk-redeem keys on Luna
// @include      /^https:\/\/luna\.amazon\.[a-z.]{2,6}\//
// @match        https://www.gog.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
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
//
// @match www.gog.com: the GOG leg (Continue → Redeem on /redeem/<key>). The
// script runs on every GOG page but does nothing unless Luna handed it that
// exact key a few minutes earlier — see "GOG REDEMPTION — gog.com side".

(function () {
  "use strict";

  const SCRIPT_VERSION =
    typeof GM_info !== "undefined" && GM_info.script?.version
      ? GM_info.script.version
      : "__DEV__";
  const LOG_PREFIX = "[Luna Autoclaim]";
  const SHORT_PREFIX = "[LAC]";

  const DEFAULT_REVEAL_DELAY_MS = 500;
  const DEFAULT_REDEEM_DELAY_MS = 800;

  const DISABLED_STORES_KEY = "lac_disabled_stores_v1";

  // All known stores in display order — used to build the settings list.
  const KNOWN_STORES = ["Amazon Games", "Epic Games", "GOG", "Legacy Games"];

  // Maps the title-attribute suffix to the canonical store name.
  const STORE_PATTERNS = [
    ["on Amazon Games", "Amazon Games"],
    ["on Epic Games Store", "Epic Games"],
    ["on GOG.com", "GOG"],
    ["on Legacy Games", "Legacy Games"],
  ];

  // GOG: after the Luna claim, the key is exposed with a "Claim code" link
  // of the form https://www.gog.com/redeem/<game_key>. The handoff flag is
  // per-tab (sessionStorage) so it survives Luna navigating this same tab
  // to the page that exposes the key.
  const GOG_HANDOFF_KEY = "lac_gog_handoff_v1";
  const GOG_HANDOFF_TTL_MS = 2 * 60 * 1000;
  const GOG_LINK_TIMEOUT_MS = 20000;
  const GOG_REDEEM_URL_RE =
    /^https:\/\/(?:www\.)?gog\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?redeem\/([A-Za-z0-9-]+)\/?(?:[?#].*)?$/;

  // GOG, cross-site: localStorage/sessionStorage don't reach gog.com, so the
  // handoff is recorded in GM storage (shared by the script on every site).
  // The key itself travels in the redeem URL; the GM entry is what gives the
  // gog.com side permission to act on it, and records the Redeem click so it
  // can never happen twice. One entry per key so parallel tabs don't clobber.
  const GOG_PENDING_PREFIX = "lac_gog_pending_v1:";
  const GOG_PENDING_TTL_MS = 10 * 60 * 1000;
  const GOG_AUTO_REDEEM_KEY = "lac_gog_auto_redeem_v1"; // default false: stop before Redeem
  const GOG_STEP_TIMEOUT_MS = 20000;
  const GOG_REDEEM_PATH_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?redeem\/([A-Za-z0-9-]+)\/?$/;

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

  // ═══════════════════════════════════════════════════════════════════
  //  DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll `probe` until it returns something truthy or `timeoutMs` elapses.
   * Resolves with the probe's value, or null on timeout.
   */
  async function waitFor(probe, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = probe();
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(intervalMs);
    }
  }

  // Keys end up in the console and the status line — show only enough to
  // tell two apart.
  function maskKey(key) {
    return key.length > 5 ? `${key.slice(0, 5)}…` : key;
  }

  // The page's own window — Luna's click handlers call *its* window.open.
  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  /**
   * Click `el`, but keep whatever it opens in this tab: drop a
   * target="_blank" on its anchor, and for a few seconds route the page's
   * window.open() into a same-tab navigation. `onUrl` gets first refusal
   * on each URL (return true when handled).
   */
  function clickInSameTab(el, onUrl = () => false, windowMs = 10000) {
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
      if (!onUrl(abs)) window.location.assign(abs);
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
   * `unknown` entries are still opened: the claim page resolves their store
   * and enforces the toggle there.
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

  async function claimCurrentGame() {
    const btn = document.querySelector('[data-a-target="buy-box_call-to-action"]');
    if (!btn) {
      warn("Claim button not found");
      updateStatus("Claim button not found");
      return;
    }

    const store = detectStore() ?? "Unknown store";
    log(`Claiming via ${store}`);
    updateStatus(`Claiming via ${store}…`);
    setButtonsEnabled(false);

    if (store === "GOG") {
      // Luna opens a second claim page to expose the key — keep it in this
      // tab, then carry on to GOG's "Claim code" link.
      markGogHandoff();
      clickInSameTab(btn, tryGogHandoffUrl);
    } else {
      btn.click();
    }

    await sleep(redeemDelayMs);
    log("Claim submitted");
    updateStatus("Claim submitted");
    setButtonsEnabled(true);

    if (store === "GOG") followGogClaimCode();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GOG HANDOFF — Luna side
  // ═══════════════════════════════════════════════════════════════════
  //
  // Order of events: Claim on Luna → Luna exposes the key (same tab, either
  // in place or via a second claim page) → "Claim code" links to
  // https://www.gog.com/redeem/<game_key> → this tab navigates there.

  function markGogHandoff() {
    try {
      sessionStorage.setItem(GOG_HANDOFF_KEY, String(Date.now()));
    } catch {
      /* private mode — the in-page watcher still covers the SPA case */
    }
  }

  function clearGogHandoff() {
    try {
      sessionStorage.removeItem(GOG_HANDOFF_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  function hasPendingGogHandoff() {
    try {
      const at = Number(sessionStorage.getItem(GOG_HANDOFF_KEY));
      if (!at) return false;
      if (Date.now() - at > GOG_HANDOFF_TTL_MS) {
        clearGogHandoff();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find the "Claim code" target: an anchor whose href is a GOG redeem URL,
   * else the "Claim code" button itself (its link may be wired in JS).
   */
  function findGogClaimCode() {
    for (const a of document.querySelectorAll('a[href*="gog.com"]')) {
      if (GOG_REDEEM_URL_RE.test(a.href)) return { url: a.href };
    }
    const button = Array.from(document.querySelectorAll('a, button, [role="button"]')).find(
      (el) => !el.closest("#lac-panel") && el.textContent.trim().toLowerCase() === "claim code",
    );
    if (!button) return null;
    const href = button.closest("a")?.href;
    return href && GOG_REDEEM_URL_RE.test(href) ? { url: href } : { el: button };
  }

  function handOffToGog(url) {
    const key = url.match(GOG_REDEEM_URL_RE)[1];
    clearGogHandoff();
    GM_setValue(GOG_PENDING_PREFIX + key.toUpperCase(), {
      createdAt: Date.now(),
      game: document.querySelector("h1")?.textContent?.trim() || null,
      stage: "handoff",
    });
    log(`GOG: handing off key ${maskKey(key)} to gog.com`);
    updateStatus(`GOG: opening redeem page for ${maskKey(key)}…`);
    window.location.assign(url);
  }

  // clickInSameTab() hook: take over any GOG redeem URL the page tries to open.
  function tryGogHandoffUrl(url) {
    if (!GOG_REDEEM_URL_RE.test(url)) return false;
    handOffToGog(url);
    return true;
  }

  let gogWatchActive = false;

  async function followGogClaimCode() {
    if (gogWatchActive) return;
    gogWatchActive = true;
    try {
      log("GOG: waiting for the Claim code link…");
      updateStatus("GOG: waiting for the key…");
      const target = await waitFor(findGogClaimCode, GOG_LINK_TIMEOUT_MS);
      if (!target) {
        warn(`GOG: no Claim code link after ${GOG_LINK_TIMEOUT_MS}ms`);
        updateStatus("GOG: Claim code link not found — finish on this page", "error");
        clearGogHandoff();
        return;
      }
      if (target.url) {
        handOffToGog(target.url);
      } else {
        log("GOG: Claim code has no href — clicking it in this tab");
        clickInSameTab(target.el, tryGogHandoffUrl);
      }
    } finally {
      gogWatchActive = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GOG REDEMPTION — gog.com side
  // ═══════════════════════════════════════════════════════════════════
  //
  // Page 1 "Redeem code": key prefilled, green Continue.
  // Page 2 "You are about to redeem 1 item …": Cancel / Redeem.
  // Buttons are found by visible text, never by GOG's generated classes.
  // Redeem is exactly-once: the GM entry is stamped "redeem-clicked" *before*
  // the click, and a stamped entry is never clicked again — not after a
  // reload, not from a second tab. Any surprise stops the run.

  function isGogAutoRedeem() {
    return GM_getValue(GOG_AUTO_REDEEM_KEY, false) === true;
  }

  function setGogAutoRedeem(on) {
    GM_setValue(GOG_AUTO_REDEEM_KEY, on);
  }

  function isVisible(el) {
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function isEnabled(el) {
    return !el.disabled && el.getAttribute("aria-disabled") !== "true";
  }

  function findVisibleButtonsByText(text) {
    const want = text.toLowerCase();
    return Array.from(
      document.querySelectorAll('button, a, [role="button"], input[type="submit"]'),
    ).filter(
      (el) =>
        !el.closest("#lac-panel") &&
        (el.value || el.textContent).trim().toLowerCase() === want &&
        isVisible(el),
    );
  }

  // The single visible, enabled button with this text — or null, so an
  // ambiguous page is never guessed at.
  function findOnlyButton(text) {
    const matches = findVisibleButtonsByText(text).filter(isEnabled);
    return matches.length === 1 ? matches[0] : null;
  }

  function normalizeKey(key) {
    return key.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  // A prefilled input that holds a *different* key means we're on the wrong
  // code — stop. An empty or missing input is left to GOG.
  function prefilledKeyMismatch(key) {
    const values = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
      .filter(isVisible)
      .map((i) => normalizeKey(i.value))
      .filter(Boolean);
    return values.length > 0 && !values.includes(normalizeKey(key));
  }

  function createGogPanel(entry) {
    const panel = buildPanelShell("Autoclaim · GOG");

    const gameEl = document.createElement("div");
    gameEl.id = "lac-store";
    gameEl.textContent = entry.game ? `${entry.game}` : "GOG key from Luna";
    panel.appendChild(gameEl);

    statusEl = document.createElement("div");
    statusEl.id = "lac-status";
    panel.appendChild(statusEl);

    document.body.appendChild(panel);
    return panel;
  }

  function stopGog(message) {
    warn(`GOG: ${message}`);
    updateStatus(`${message} — stopped`, "error");
  }

  async function runGogRedemption() {
    const match = window.location.pathname.match(GOG_REDEEM_PATH_RE);
    if (!match) return;
    const key = match[1];
    const entryKey = GOG_PENDING_PREFIX + key.toUpperCase();
    const entry = GM_getValue(entryKey, null);
    if (!entry) return; // not a code Luna handed us — leave the page alone

    if (Date.now() - entry.createdAt > GOG_PENDING_TTL_MS) {
      log(`GOG: handoff for ${maskKey(key)} is stale — ignoring`);
      GM_deleteValue(entryKey);
      return;
    }

    checkForUpdate();
    injectStyles();
    const panel = createGogPanel(entry);

    if (entry.stage === "redeem-clicked") {
      stopGog("Redeem was already clicked for this code — not clicking again. Check GOG's result");
      return;
    }

    // ── Page 1: Continue ─────────────────────────────────────────────
    updateStatus("Waiting for Continue…");
    const continueBtn = await waitFor(() => findOnlyButton("Continue"), GOG_STEP_TIMEOUT_MS);
    if (!continueBtn) {
      stopGog("Continue button not found (signed in to GOG?)");
      return;
    }
    if (prefilledKeyMismatch(key)) {
      stopGog("The code on the page doesn't match the one from Luna");
      return;
    }
    log(`GOG: clicking Continue for ${maskKey(key)}`);
    GM_setValue(entryKey, { ...entry, stage: "continue-clicked" });
    continueBtn.click();

    // ── Page 2: wait for the transition, then Redeem ────────────────
    updateStatus("Waiting for the confirmation page…");
    const redeemBtn = await waitFor(() => {
      if (findVisibleButtonsByText("Continue").length) return null; // still on page 1
      if (!/you are about to redeem/i.test(document.body.innerText)) return null;
      return findOnlyButton("Redeem");
    }, GOG_STEP_TIMEOUT_MS);
    if (!redeemBtn) {
      stopGog("Confirmation page with a single Redeem button didn't appear");
      return;
    }

    let confirmBtn = null;
    let redeemStarted = false;
    const redeemOnce = async () => {
      if (redeemStarted) return;
      redeemStarted = true;
      confirmBtn?.remove();

      // Re-read: another tab or an earlier run may have got here first.
      const latest = GM_getValue(entryKey, null);
      if (!latest || latest.stage === "redeem-clicked") {
        stopGog("This code's Redeem was already handled elsewhere");
        return;
      }
      if (!redeemBtn.isConnected || !isVisible(redeemBtn) || !isEnabled(redeemBtn)) {
        stopGog("The Redeem button went away before it could be clicked");
        return;
      }

      GM_setValue(entryKey, { ...latest, stage: "redeem-clicked", redeemedAt: Date.now() });
      log(`GOG: clicking Redeem for ${maskKey(key)}`);
      redeemBtn.click();
      updateStatus("Redeem clicked — waiting for GOG…");

      const gone = await waitFor(() => !redeemBtn.isConnected || !isVisible(redeemBtn), GOG_STEP_TIMEOUT_MS);
      if (gone) {
        GM_deleteValue(entryKey);
        log(`GOG: Redeem accepted for ${maskKey(key)}`);
        updateStatus("Redeem sent — GOG's result is on the page", "ok");
      } else {
        // The entry stays stamped, so nothing will ever click Redeem again.
        stopGog("GOG didn't move on after Redeem. Check the page before trying by hand");
      }
    };

    if (isGogAutoRedeem()) {
      await redeemOnce();
      return;
    }

    updateStatus("Ready to redeem — confirm below");
    confirmBtn = document.createElement("button");
    confirmBtn.className = "lac-btn lac-btn-primary";
    confirmBtn.textContent = "✔ Redeem on GOG";
    confirmBtn.addEventListener("click", redeemOnce);
    panel.appendChild(confirmBtn);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — SHARED
  // ═══════════════════════════════════════════════════════════════════

  let statusEl = null;
  let claimBtn = null;
  let autoClaimBtn = null;

  // tone: undefined (neutral) | "ok" | "error"
  function updateStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("lac-status--ok", tone === "ok");
    statusEl.classList.toggle("lac-status--error", tone === "error");
  }

  // Home page only: preview what "Open All" would do under the current toggles.
  function refreshListingStatus() {
    // Don't clobber the "Opening i/n" progress line mid-run.
    if (claimBtn?.disabled) return;
    const plan = planClaims();
    log(`Listing: ${describePlan(plan, "to open")}`);
    updateStatus(describePlan(plan, "To open:"));
  }

  function setButtonsEnabled(enabled) {
    [claimBtn, autoClaimBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? "1" : "0.5";
      btn.style.pointerEvents = enabled ? "auto" : "none";
    });
  }

  function buildPanelShell(titleText) {
    const panel = document.createElement("div");
    panel.id = "lac-panel";

    const header = document.createElement("div");
    header.id = "lac-header";

    const title = document.createElement("div");
    title.id = "lac-title";
    title.textContent = titleText;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.id = "lac-close-btn";
    closeBtn.textContent = "\u00D7";
    closeBtn.title = "Close panel";
    closeBtn.addEventListener("click", () => panel.remove());
    header.appendChild(closeBtn);

    panel.appendChild(header);
    return panel;
  }

  function createDelayInput(labelText, defaultValue, onChange) {
    const row = document.createElement("div");
    row.className = "lac-delay-row";

    const label = document.createElement("label");
    label.className = "lac-delay-label";
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "number";
    input.className = "lac-delay-input";
    input.min = "100";
    input.max = "10000";
    input.step = "100";
    input.value = defaultValue;
    input.addEventListener("change", () => {
      const val = parseInt(input.value, 10);
      if (!isNaN(val) && val >= 100) onChange(val);
    });

    const unit = document.createElement("span");
    unit.className = "lac-delay-unit";
    unit.textContent = "ms";

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(unit);
    return row;
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

  // GOG's last step redeems the code for good, so the default stops and asks.
  function createGogRedeemModeRow() {
    const row = document.createElement("div");
    row.className = "lac-store-row";

    const label = document.createElement("span");
    label.className = "lac-store-label";
    label.textContent = "GOG final Redeem";

    const toggle = document.createElement("button");
    const render = (auto) => {
      toggle.className = `lac-store-toggle ${auto ? "lac-store-toggle--on" : "lac-store-toggle--off"}`;
      toggle.textContent = auto ? "Automatic" : "Ask first";
      toggle.title = auto
        ? "GOG's Redeem is clicked for you. Click to stop and ask first instead."
        : "Stops on GOG's confirmation page until you click Redeem. Click to make it automatic.";
    };
    render(isGogAutoRedeem());
    toggle.addEventListener("click", () => {
      const auto = !isGogAutoRedeem();
      setGogAutoRedeem(auto);
      render(auto);
      log(`GOG final Redeem: ${auto ? "automatic" : "ask first"}`);
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
    storeSection.appendChild(createGogRedeemModeRow());
    panel.appendChild(storeSection);

    statusEl = document.createElement("div");
    statusEl.id = "lac-status";
    statusEl.textContent = "Ready";
    panel.appendChild(statusEl);

    document.body.appendChild(panel);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — CLAIM PAGE PANEL
  // ═══════════════════════════════════════════════════════════════════

  function createClaimPagePanel(store) {
    const panel = buildPanelShell("Autoclaim");

    const storeEl = document.createElement("div");
    storeEl.id = "lac-store";
    storeEl.textContent = store ?? "Unknown store";
    panel.appendChild(storeEl);

    statusEl = document.createElement("div");
    statusEl.id = "lac-status";
    panel.appendChild(statusEl);

    if (store && isStoreDisabled(store)) {
      statusEl.textContent = "Store disabled — skipping";

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
      statusEl.textContent = "Ready";

      claimBtn = document.createElement("button");
      claimBtn.id = "lac-claim-btn";
      claimBtn.className = "lac-btn lac-btn-primary";
      claimBtn.textContent = "Claim";
      claimBtn.addEventListener("click", claimCurrentGame);
      panel.appendChild(claimBtn);

      if (store) {
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
    }

    document.body.appendChild(panel);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  STYLES
  // ═══════════════════════════════════════════════════════════════════

  function injectStyles() {
    GM_addStyle(`
            #lac-panel {
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

            #lac-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            #lac-title {
                font-weight: 700;
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #ff9800;
                flex: 1;
                text-align: center;
                padding-left: 20px;
            }

            #lac-close-btn {
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

            #lac-close-btn:hover { color: #eee; }

            #lac-store {
                font-size: 12px;
                color: #bdbdbd;
                text-align: center;
                padding: 2px 0;
            }

            .lac-btn {
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

            .lac-btn:hover { background: #616161; }

            .lac-btn-primary {
                background: #ff9800;
                color: #212121;
                border-color: #ff9800;
                font-weight: 700;
            }

            .lac-btn-primary:hover { background: #ffb74d; }

            .lac-btn-danger {
                background: transparent;
                color: #ef5350;
                border-color: #ef5350;
                font-size: 11px;
                padding: 4px 8px;
            }

            .lac-btn-danger:hover {
                background: #ef5350;
                color: #fff;
            }

            #lac-delays {
                display: flex;
                flex-direction: column;
                gap: 4px;
                border-top: 1px solid #424242;
                padding-top: 8px;
                margin-top: 2px;
            }

            .lac-delay-row {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .lac-delay-label {
                font-size: 11px;
                color: #9e9e9e;
                flex: 1;
                margin: 0;
            }

            .lac-delay-input {
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

            .lac-delay-unit {
                font-size: 11px;
                color: #757575;
            }

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

            #lac-status {
                font-size: 12px;
                color: #9e9e9e;
                text-align: center;
                min-height: 16px;
            }

            #lac-status.lac-status--ok { color: #81c784; }
            #lac-status.lac-status--error { color: #ef5350; font-weight: 700; }

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
    const panel = document.getElementById("lac-panel");
    if (panel) panel.remove();
    statusEl = null;
    claimBtn = null;
    autoClaimBtn = null;
  }

  function handleRoute() {
    const path = window.location.pathname;
    const isHome = /\/claims\/home/.test(path);
    const isClaim = /\/claims\/.+\/dp\//.test(path);

    // A GOG claim started in this tab carries on here, whatever route Luna
    // used to expose the key.
    if (hasPendingGogHandoff()) followGogClaimCode();

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
      if (!store) warn("Store not recognised — defaulting panel to unknown");
      log(`Store: ${store ?? "unknown"}`);
      injectStyles();
      createClaimPagePanel(store);

      const autoClaimParam =
        new URLSearchParams(window.location.search).get("lac_autoclaim") === "1";
      if (autoClaimParam) {
        if (store && isStoreDisabled(store)) {
          log(`Auto-claim skipped — ${store} is disabled`);
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
    if (/(^|\.)gog\.com$/.test(window.location.hostname)) {
      // Silent on every GOG page except a redeem page Luna handed off.
      runGogRedemption();
      return;
    }
    log(`v${SCRIPT_VERSION} loaded`);
    checkForUpdate();
    watchForNavigation();
    handleRoute();
  }

  init();
})();
