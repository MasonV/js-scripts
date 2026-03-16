// ==UserScript==
// @name         Barter.vg Bundle Scorer
// @namespace    https://tampermonkey.net/
// @version      6.4.1
// @description  Full-page bundle evaluation dashboard with per-game scoring, card grid, stats dashboard, and settings for Barter.vg bundle pages.
// @match        *://barter.vg/bundle/*
// @match        *://*.barter.vg/bundle/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  const SCRIPT_VERSION = '6.4.1';
  console.log(`[BVG Scorer] v${SCRIPT_VERSION} loaded on`, location.href);

  // ═══════════════════════════════════════
  // UPDATE CHECK
  // ═══════════════════════════════════════
  function checkForUpdate() {
    const META_URL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.meta.js';
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url: META_URL + '?_=' + Date.now(), // cache bust
        onload(resp) {
          if (resp.status !== 200) return;
          const match = resp.responseText.match(/@version\s+(\S+)/);
          if (!match) return;
          const remote = match[1];
          if (remote !== SCRIPT_VERSION) {
            console.log(`[BVG Scorer] Update available: v${SCRIPT_VERSION} → v${remote}`);
            showUpdateBanner(remote);
          } else {
            console.log(`[BVG Scorer] Up to date (v${SCRIPT_VERSION})`);
          }
        },
        onerror() { console.warn('[BVG Scorer] Update check failed (network error)'); },
      });
    } catch (e) {
      console.warn('[BVG Scorer] Update check unavailable:', e);
    }
  }

  function showUpdateBanner(remoteVersion) {
    const downloadURL = 'https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.user.js';
    const anchor = document.getElementById('bvg-app');
    if (!anchor) return;
    const banner = document.createElement('div');
    banner.className = 'bvg-update-banner';
    banner.innerHTML = `
      <span>Update available: <strong>v${SCRIPT_VERSION}</strong> → <strong>v${remoteVersion}</strong>
        — <a href="${downloadURL}" target="_blank">Install update</a></span>
      <button class="bvg-update-dismiss" title="Dismiss">&times;</button>
    `;
    banner.querySelector('.bvg-update-dismiss').addEventListener('click', () => banner.remove());
    anchor.prepend(banner);
  }

  // Fire update check immediately on load
  checkForUpdate();

  // ═══════════════════════════════════════
  // STYLES (GM_addStyle bypasses CSP)
  // ═══════════════════════════════════════
  GM_addStyle(`
    /* ── App root ── */
    #bvg-app {
      display: grid;
      grid-template-rows: auto auto auto 1fr;
      grid-template-columns: 1fr;
      min-height: 100vh;
      max-width: 2400px;
      margin: 0 auto;
      padding: 16px 48px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #c9d1d9;
      background: #010409;
      box-sizing: border-box;
    }
    #bvg-app *, #bvg-app *::before, #bvg-app *::after { box-sizing: border-box; }
    #bvg-app strong { color: #e6edf3; }
    #bvg-app a { color: #58a6ff; text-decoration: none; }
    #bvg-app a:hover { text-decoration: underline; }

    /* ── Update banner ── */
    .bvg-update-banner {
      background: #1a2332;
      border: 1px solid #58a6ff;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 10px;
      font-size: 12px;
      color: #c9d1d9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .bvg-update-banner a { color: #58a6ff; font-weight: 600; }
    .bvg-update-dismiss {
      background: none; border: none; color: #8b949e;
      cursor: pointer; font-size: 14px; padding: 0 4px;
    }

    /* ── Header bar ── */
    .bvg-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0 12px;
      border-bottom: 1px solid #21262d;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .bvg-header-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .bvg-header-title {
      font-size: 20px; font-weight: 700; color: #e6edf3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bvg-header-sub {
      font-size: 12px; color: #8b949e;
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    }
    .bvg-header-right {
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap; flex-shrink: 0;
    }
    .bvg-header-link {
      display: inline-flex; align-items: center; gap: 4px;
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 5px 12px; font-size: 12px; font-weight: 600;
      color: #c9d1d9; transition: all .15s;
    }
    .bvg-header-link:hover { color: #e6edf3; border-color: #58a6ff; text-decoration: none; }
    .bvg-header-badge {
      font-size: 10px; color: #8b949e; background: #161b22;
      border: 1px solid #21262d; border-radius: 4px;
      padding: 2px 8px; font-weight: 600;
    }

    /* ── Stats dashboard (horizontal strip) ── */
    .bvg-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
      padding: 12px 0;
      border-bottom: 1px solid #21262d;
      margin-bottom: 12px;
    }
    .bvg-stat-card {
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px 14px;
      position: relative;
      overflow: hidden;
    }
    .bvg-stat-card .bvg-score-bar {
      position: absolute; left: 0; bottom: 0;
      height: 3px; border-radius: 0 0 10px 10px;
      transition: width .3s ease;
    }
    .bvg-stat-card .bvg-score-num {
      font-size: 22px; font-weight: 800;
      letter-spacing: -0.5px; font-variant-numeric: tabular-nums;
    }
    .bvg-stat-card .bvg-score-denom {
      font-size: 11px; opacity: .45; font-weight: 400;
    }
    .bvg-stat-card .bvg-score-label {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: .5px; opacity: .55; font-weight: 600;
    }
    /* ── Picks card ── */
    .bvg-picks-card {
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px 14px;
    }
    .bvg-picks-card .bvg-section-label {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: .5px; color: #8b949e; font-weight: 600;
      margin-bottom: 6px;
    }
    .bvg-pick-item {
      font-size: 12px; line-height: 1.6;
      display: flex; gap: 6px; align-items: baseline;
    }
    .bvg-pick-name { font-weight: 600; }
    .bvg-pick-score { opacity: .45; font-size: 11px; font-weight: 400; }
    /* ── Histogram card ── */
    .bvg-histogram-card {
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px 14px;
    }
    /* ── Meta card ── */
    .bvg-meta-card {
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 12px;
      color: #8b949e;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bvg-meta-card .bvg-meta-highlight {
      color: #e6edf3; font-weight: 700;
    }
    /* ── Tier scoring card ── */
    .bvg-tiers-card {
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px 14px;
    }
    .bvg-tiers-card .bvg-section-label {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: .5px; color: #8b949e; font-weight: 600;
      margin-bottom: 6px;
    }
    .bvg-tier-row {
      display: flex; justify-content: space-between;
      padding: 3px 0; border-bottom: 1px solid #21262d;
      font-size: 12px;
    }
    .bvg-tier-row:last-child { border-bottom: none; }
    .bvg-tier-price { font-weight: 700; color: #58a6ff; }

    /* ── Toolbar ── */
    .bvg-toolbar {
      display: flex;
      gap: 8px;
      padding: 10px 0;
      flex-wrap: wrap;
      align-items: center;
      border-bottom: 1px solid #21262d;
      margin-bottom: 14px;
    }
    .bvg-page-toggle {
      display: inline-flex;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .bvg-page-toggle button {
      background: transparent; border: none; color: #8b949e;
      padding: 7px 16px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s;
      -webkit-appearance: none; appearance: none;
    }
    .bvg-page-toggle button.active { background: #21262d; color: #e6edf3; }
    .bvg-page-toggle button:hover:not(.active) { color: #c9d1d9; }
    .bvg-toolbar input[type="text"] {
      background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
      color: #c9d1d9; padding: 6px 12px; font-size: 13px; width: 220px;
    }
    .bvg-toolbar input[type="text"]:focus { outline: none; border-color: #58a6ff; }
    .bvg-toolbar select {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      color: #c9d1d9; padding: 6px 10px; font-size: 12px; cursor: pointer;
    }
    .bvg-filter-chip {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      color: #8b949e; padding: 5px 12px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s;
      -webkit-appearance: none; appearance: none;
    }
    .bvg-filter-chip:hover, .bvg-filter-chip.active {
      color: #e6edf3; border-color: #58a6ff; background: #1a2332;
    }
    .bvg-settings-btn {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      color: #8b949e; padding: 5px 14px; cursor: pointer;
      font-size: 11px; font-weight: 600; transition: all .15s;
    }
    .bvg-settings-btn:hover {
      color: #e6edf3; border-color: #58a6ff; background: #1a2332;
    }
    .bvg-toolbar-spacer { flex: 1; }

    /* ── Game cards ── */
    .bvg-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 6px;
    }
    .bvg-card {
      display: grid;
      grid-template-columns: 160px 1fr auto;
      gap: 0;
      align-items: stretch;
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      overflow: hidden;
      transition: border-color .15s, background .15s;
    }
    .bvg-card:hover { border-color: #30363d; background: #111820; }
    .bvg-card.bvg-card-owned { opacity: .5; }
    .bvg-card.bvg-card-dlc { opacity: .45; border-style: dashed; }
    .bvg-card-img-wrap {
      overflow: hidden;
      background: #161b22; min-height: 56px;
    }
    .bvg-card-img {
      width: 100%; height: 100%;
      object-fit: cover; object-position: left center;
      display: block;
    }
    .bvg-card-img-placeholder { min-height: 56px; background: #161b22; }
    .bvg-card-body {
      min-width: 0; padding: 8px 14px;
      display: flex; flex-direction: column; justify-content: center;
    }
    .bvg-card-title {
      font-size: 14px; font-weight: 600; color: #e6edf3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bvg-card-title a { color: inherit; text-decoration: none; }
    .bvg-card-title a:hover { text-decoration: underline; }
    .bvg-card-rank {
      font-size: 11px; font-weight: 700; color: #8b949e;
      margin-right: 6px; letter-spacing: .3px;
    }
    .bvg-card-meta {
      font-size: 11px; color: #8b949e; margin-top: 3px;
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    }
    .bvg-card-meta .bvg-cm-val { color: #c9d1d9; font-weight: 600; }
    .bvg-card-meta .bvg-cm-rating { font-size: 13px; font-weight: 800; }
    .bvg-card-meta .bvg-cm-wish { color: #58a6ff; font-weight: 600; }
    .bvg-card-meta .bvg-cm-sep { color: #30363d; font-size: 10px; }
    .bvg-card-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
    .bvg-card-tag {
      font-size: 10px; font-weight: 600; padding: 1px 7px;
      border-radius: 4px; background: #21262d; color: #8b949e;
    }
    .bvg-card-tag.tag-owned { background: #1d2b1d; color: #3fb950; }
    .bvg-card-tag.tag-dlc { background: #2b221d; color: #d29922; }
    .bvg-card-tag.tag-unrated { background: #2d333b; color: #8b949e; }
    .bvg-card-right {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 4px; padding: 8px 16px; white-space: nowrap;
    }
    .bvg-card-score {
      width: 48px; min-height: 48px; border-radius: 10px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-weight: 800; font-size: 20px; color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.5);
      cursor: pointer; user-select: none; transition: transform .1s;
      flex-shrink: 0; letter-spacing: -0.5px; padding: 4px 2px;
    }
    .bvg-card-score:hover { transform: scale(1.08); }
    .bvg-card-score.bvg-unrated {
      background: #2d333b !important; font-size: 11px;
      font-weight: 600; letter-spacing: 0; text-shadow: none; color: #8b949e;
    }
    .bvg-card-msrp { font-weight: 600; font-size: 12px; color: #8b949e; }
    .bvg-card-steam {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 10px; font-weight: 600; color: #8b949e;
      background: #161b22; border: 1px solid #30363d; border-radius: 4px;
      padding: 2px 6px; text-decoration: none; transition: all .15s;
    }
    .bvg-card-steam:hover { color: #c9d1d9; border-color: #58a6ff; text-decoration: none; }

    /* ── Tier sections in card view ── */
    .bvg-tier-section {
      margin-bottom: 8px;
    }
    .bvg-tier-section-header {
      background: #161b22; border: 1px solid #21262d; border-radius: 10px 10px 0 0;
      padding: 12px 20px;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 14px; font-weight: 700; color: #e6edf3;
      border-bottom: 2px solid #58a6ff;
    }
    .bvg-tier-section-header .bvg-ts-left {
      display: flex; align-items: center; gap: 12px;
    }
    .bvg-tier-section-header .bvg-ts-price {
      color: #58a6ff; font-weight: 800; font-size: 16px;
    }
    .bvg-tier-section-header .bvg-ts-stats {
      font-size: 11px; font-weight: 400; color: #8b949e;
      display: flex; gap: 12px;
    }
    .bvg-tier-section-header .bvg-ts-stat-val {
      color: #c9d1d9; font-weight: 600;
    }
    .bvg-tier-section .bvg-cards {
      border-radius: 0 0 10px 10px;
    }

    /* ── Tier pricing strip (dashboard) ── */
    .bvg-tier-strip {
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px 14px;
      grid-column: 1 / -1;
    }
    .bvg-tier-strip .bvg-section-label {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: .5px; color: #8b949e; font-weight: 600;
      margin-bottom: 8px;
    }
    .bvg-tier-strip-items {
      display: flex; gap: 10px; flex-wrap: wrap;
    }
    .bvg-tier-strip-item {
      background: #161b22; border: 1px solid #21262d; border-radius: 8px;
      padding: 8px 14px; flex: 1; min-width: 160px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .bvg-tier-strip-item .bvg-tsi-label {
      font-size: 11px; color: #8b949e; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bvg-tier-strip-item .bvg-tsi-price {
      font-size: 18px; font-weight: 800; color: #58a6ff;
    }
    .bvg-tier-strip-item .bvg-tsi-detail {
      font-size: 10px; color: #8b949e;
    }

    /* ── Card count footer ── */
    .bvg-cards-footer {
      grid-column: 1 / -1;
      text-align: center; color: #8b949e; font-size: 11px; padding: 10px 0;
    }

    /* ── Settings modal ── */
    .bvg-modal-backdrop {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.6); display: flex;
      align-items: center; justify-content: center;
    }
    .bvg-modal {
      background: #0d1117; border: 1px solid #30363d; border-radius: 12px;
      padding: 20px 24px; max-width: 520px; width: 90%;
      max-height: 80vh; overflow-y: auto; color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 12px;
    }
    .bvg-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 14px;
    }
    .bvg-modal-header h3 {
      margin: 0; font-size: 16px; font-weight: 700; color: #e6edf3;
    }
    .bvg-modal-close {
      background: none; border: none; color: #8b949e;
      cursor: pointer; font-size: 18px; padding: 0 4px;
    }
    .bvg-modal-close:hover { color: #e6edf3; }
    .bvg-modal label {
      display: flex; align-items: center; gap: 10px;
      margin: 6px 0; color: #8b949e;
    }
    .bvg-modal input[type="number"] {
      width: 58px; background: #161b22; color: #c9d1d9;
      border: 1px solid #30363d; border-radius: 5px;
      padding: 3px 7px; font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .bvg-modal input[type="number"]:focus { outline: none; border-color: #58a6ff; }
    .bvg-modal input[type="checkbox"] { accent-color: #58a6ff; }

    /* ── Floating view toggle (always visible) ── */
    #bvg-view-fab {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      box-shadow: 0 4px 12px rgba(0,0,0,.5);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    #bvg-view-fab button {
      background: transparent; border: none; color: #8b949e;
      padding: 8px 16px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s;
      -webkit-appearance: none; appearance: none;
    }
    #bvg-view-fab button.active { background: #21262d; color: #e6edf3; }
    #bvg-view-fab button:hover:not(.active) { color: #c9d1d9; }

    /* ── Focus indicators for keyboard navigation ── */
    .bvg-page-toggle button:focus-visible,
    .bvg-filter-chip:focus-visible,
    .bvg-settings-btn:focus-visible,
    .bvg-card-steam:focus-visible,
    .bvg-card-score:focus-visible,
    #bvg-view-fab button:focus-visible,
    .bvg-modal-close:focus-visible,
    #bvg-app select:focus-visible,
    #bvg-app input:focus-visible {
      outline: 2px solid #58a6ff;
      outline-offset: -2px;
    }

    /* ── Score tier label ── */
    .bvg-card-score .bvg-score-tier {
      font-size: 8px; font-weight: 600; letter-spacing: .3px;
      text-transform: uppercase; opacity: .85;
      text-shadow: none; margin-top: 1px;
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      #bvg-app { padding: 8px 16px; }
      .bvg-cards { grid-template-columns: 1fr; }
      .bvg-card { grid-template-columns: 120px 1fr auto; }
      .bvg-header { flex-direction: column; align-items: flex-start; }
      .bvg-toolbar { flex-direction: column; align-items: stretch; }
      .bvg-toolbar input[type="text"] { width: 100%; }
    }
  `);

  // ═══════════════════════════════════════
  // STORAGE AVAILABILITY
  //
  // localStorage can fail in private/incognito
  // mode, when quota is exceeded, or when
  // blocked by browser policy. We probe once
  // at startup and surface a visible warning
  // so users know settings won't persist.
  // ═══════════════════════════════════════
  let _storageAvailable = true;
  (function probeStorage() {
    const testKey = '__bvg_storage_probe__';
    try {
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
    } catch (e) {
      _storageAvailable = false;
      console.warn('[BVG Scorer] localStorage unavailable — settings will not persist.', e.message || e);
    }
  })();

  // Wrapper for localStorage.setItem that warns once per session on failure
  let _storageWarningShown = false;
  function safeStorageSet(key, value) {
    if (!_storageAvailable) return;
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (!_storageWarningShown) {
        _storageWarningShown = true;
        console.warn(`[BVG Scorer] Failed to write "${key}" — quota exceeded or storage blocked.`, e.message || e);
        showStorageWarning();
      }
    }
  }

  function showStorageWarning() {
    const app = document.getElementById('bvg-app');
    if (!app) return;
    const warn = document.createElement('div');
    warn.style.cssText = 'background:#2d1b1b;border:1px solid #8a1f1f;border-radius:6px;padding:6px 10px;margin-bottom:8px;font-size:11px;color:#f0a0a0;';
    warn.textContent = '⚠ Storage unavailable — your settings and owned-game overrides will not persist. Check browser privacy settings or quota.';
    app.prepend(warn);
  }

  // ═══════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════
  const STORAGE_KEY_OWNED    = 'bvg_scorer_owned_v2';
  const STORAGE_KEY_SETTINGS = 'bvg_scorer_settings_v2';
  const DEFAULT_SETTINGS = {
    // Wilson lower-bound adjusts rating downward for low-review games, penalizing
    // uncertainty. Off by default because most bundle games have few reviews, and
    // Wilson would flatten nearly all scores toward 50%.
    useWilsonAdjustedRating: false,
    topNMain: 5, topNDepth: 10,
    // msrpCap: Games above this price get value=1.0. Set to ~$40 because that's the
    // typical "full price indie" ceiling; AAA titles ($60+) shouldn't score higher
    // just for being expensive — value above $40 has diminishing informational return.
    msrpCap: 39.99,
    // bundledPenaltyCap: A game bundled this many times gets the maximum rebundle
    // penalty. 10 is the point where a game is "perma-bundled" and likely valueless
    // as trade fodder — most traders already own it.
    bundledPenaltyCap: 10,
    // confidenceAnchor: The review count where confidence reaches 50% (Bayesian
    // anchor). At 800, a game with 800 reviews has 50% confidence, 4000 reviews ~83%.
    // This is deliberately high to avoid over-trusting niche games with 20-50 reviews
    // that often have inflated ratings from fans.
    confidenceAnchor: 800,
    weights: {
      // Rating dominates because it's the strongest signal of game quality.
      rating: 0.55,
      // Confidence rewards well-reviewed games — 20% ensures obscure titles with
      // perfect ratings don't outrank popular games with slightly lower scores.
      confidence: 0.20,
      // Value (MSRP/cap) gives credit for higher-priced games — you're getting
      // more dollar value per bundle dollar. 20% keeps it meaningful but secondary.
      value: 0.20,
      // BundleValue (MSRP/bundle cost) measures deal quality for this specific
      // bundle. 15% because it overlaps with value but adds bundle-price context.
      bundleValue: 0.15,
      // Wishlist is a personal relevance signal — small weight (8%) because it's
      // binary and shouldn't override quality metrics, just break ties.
      wishlist: 0.08,
      // RebundlePenalty subtracts from the score (not normalized with positives).
      // 20% at max penalty (bundled 10+ times) is enough to push perma-bundled
      // games noticeably down without completely zeroing otherwise-good games.
      rebundlePenalty: 0.20,
    },
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (!raw) return clone(DEFAULT_SETTINGS);
      const s = JSON.parse(raw);
      const d = clone(DEFAULT_SETTINGS);
      return { ...d, ...s, weights: { ...d.weights, ...(s.weights || {}) } };
    } catch { return clone(DEFAULT_SETTINGS); }
  }
  function saveSettings(s) { safeStorageSet(STORAGE_KEY_SETTINGS, JSON.stringify(s)); }
  let SETTINGS = loadSettings();
  let CURRENT_BUNDLE_COST = null;

  // Settings presets — named configurations stored in localStorage
  const STORAGE_KEY_PRESETS = 'bvg_scorer_presets_v1';
  function loadPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function savePresets(presets) { safeStorageSet(STORAGE_KEY_PRESETS, JSON.stringify(presets)); }
  function savePreset(name, settings) {
    const presets = loadPresets();
    presets[name] = clone(settings);
    savePresets(presets);
    console.log(`[BVG Scorer] Saved preset: "${name}"`);
  }
  function deletePreset(name) {
    const presets = loadPresets();
    delete presets[name];
    savePresets(presets);
    console.log(`[BVG Scorer] Deleted preset: "${name}"`);
  }

  // ═══════════════════════════════════════
  // PURE FUNCTIONS — START
  // Math, confidence, and Wilson bound utilities. No DOM dependencies.
  // Mirrored in scoring.test.js — keep both in sync when modifying.
  // ═══════════════════════════════════════
  const clamp01 = x => Math.max(0, Math.min(1, x));
  // Prevent XSS when interpolating DOM-sourced strings into innerHTML templates
  const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function confidenceFromReviews(n) {
    if (!n || n <= 0) return 0;
    return clamp01(n / (n + SETTINGS.confidenceAnchor));
  }
  // Wilson lower-bound of a binomial proportion at 95% confidence (z=1.96).
  // Returns the pessimistic estimate of true rating given observed proportion p
  // and sample size n. With few reviews, the bound drops well below p, penalizing
  // uncertainty. Useful when comparing a 95% game with 8 reviews vs 85% with 2000.
  function wilsonLowerBound(p, n) {
    if (!n || n <= 0) return 0;
    const z = 1.96, z2 = z * z; // 95% confidence interval
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const adj = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return clamp01((centre - adj) / denom);
  }
  // ═══════════════════════════════════════
  // PURE FUNCTIONS — END
  // ═══════════════════════════════════════

  // ═══════════════════════════════════════
  // OWNED SET (manual overrides)
  // ═══════════════════════════════════════
  function loadOwnedSet() {
    try {
      const r = localStorage.getItem(STORAGE_KEY_OWNED);
      if (!r) return new Set();
      const a = JSON.parse(r);
      return new Set(Array.isArray(a) ? a : []);
    } catch { return new Set(); }
  }
  function saveOwnedSet(s) { safeStorageSet(STORAGE_KEY_OWNED, JSON.stringify([...s])); }

  // ═══════════════════════════════════════
  // DOM: TABLE DETECTION
  // ═══════════════════════════════════════
  function findItemTable() {
    const tables = [...document.querySelectorAll('table')];
    let best = null, bestScore = 0;
    for (const t of tables) {
      const rows = t.querySelectorAll('tr').length;
      const steamLinks = t.querySelectorAll('a[href*="store.steampowered.com/app/"]').length;
      const gameLinks = t.querySelectorAll('a[href*="/i/"], a[href*="/game/"]').length;
      const score = steamLinks * 3 + gameLinks * 2 + Math.min(rows, 50);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore >= 6 ? best : null;
  }

  // ═══════════════════════════════════════
  // ROW CLASSIFICATION
  //
  // Barter tables have 3 types of rows:
  // 1. Game rows — contain a link to /i/NNN/ or /game/NNN/
  // 2. Tier headers — "Pick & Mix", "Heavy Rain & Beyond..." etc.
  //    Usually have colspan or very few <td> cells
  // 3. Summary row — "19 items..." at the bottom
  //
  // We tag each row so sorting only moves
  // game rows while keeping structure rows
  // anchored.
  // ═══════════════════════════════════════
  const ROW_GAME     = 'game';
  const ROW_TIER     = 'tier';
  const ROW_BARGRAPH = 'bargraph';
  const ROW_SUMMARY  = 'summary';
  const ROW_HEADER   = 'header';
  const ROW_OTHER    = 'other';
  function classifyRow(tr) {
    // Header row (contains <th>)
    if (tr.querySelector('th')) return ROW_HEADER;
    // Game row: has a link to /i/ or /game/
    if (tr.querySelector('a[href*="/i/"], a[href*="/game/"]')) return ROW_GAME;
    const text = tr.textContent.trim().toLowerCase();
    // Summary row: contains "items" and usually a dollar total
    if (/\d+\s*items/.test(text)) return ROW_SUMMARY;
    // Bargraph row: has a td with class "bargraphs"
    if (tr.querySelector('td.bargraphs')) return ROW_BARGRAPH;
    // Tier header: has colspan or very few cells, contains descriptive text
    const cells = tr.querySelectorAll('td');
    const hasColspan = [...cells].some(td => td.colSpan > 1);
    if (hasColspan || cells.length <= 3) return ROW_TIER;
    return ROW_OTHER;
  }
  function findGameRows(table) {
    return [...table.querySelectorAll('tr')]
      .filter(tr => classifyRow(tr) === ROW_GAME);
  }

  // ═══════════════════════════════════════
  // TIER DETECTION
  //
  // Barter.vg tiered bundles use "tier" rows
  // to separate groups of games. We walk the
  // table in order and tag each game row with
  // its tier name and price.
  // ═══════════════════════════════════════
  const STORAGE_KEY_CURRENCY = 'bvg_scorer_currency_v1';
  // Currency symbols and regex patterns for extraction from tier text
  // Matches both symbol-prefix ($9.99) and code-suffix (9.99 USD) formats
  const CURRENCY_DEFS = [
    { code: 'USD', symbol: '$',  re: /(?:\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*USD)/ },
    { code: 'EUR', symbol: '\u20AC', re: /(?:\u20AC\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*EUR)/ },
    { code: 'GBP', symbol: '\u00A3', re: /(?:\u00A3\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*GBP)/ },
    { code: 'CAD', symbol: 'C$', re: /(?:C\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*CAD)/ },
    { code: 'AUD', symbol: 'A$', re: /(?:A\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*AUD)/ },
    { code: 'RUB', symbol: '\u20BD', re: /(?:\u20BD\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:\u20BD|RUB))/ },
  ];

  function detectTiers(table) {
    const tbody = table.querySelector('tbody') || table;
    const allTrs = [...tbody.querySelectorAll('tr')];
    const tiers = [];
    let currentTier = null;
    for (const tr of allTrs) {
      const type = classifyRow(tr);
      if (type === ROW_TIER) {
        const text = tr.textContent.trim().replace(/\s+/g, ' ');
        // Extract prices for all supported currencies
        const prices = {};
        for (const cd of CURRENCY_DEFS) {
          const m = text.match(cd.re);
          if (m) prices[cd.code] = parseFloat(m[1] || m[2]);
        }
        const priceMatch = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
        // Extract a clean label: text before first price/currency indicator
        const labelMatch = text.match(/^(.+?)(?:\s*[:|\-]\s*(?:\d|[$€£₽CA])|$)/);
        const label = labelMatch ? labelMatch[1].replace(/\s*[:|\-–—]\s*$/, '').trim() : text.substring(0, 40);
        // Prefer USD price; fall back to first detected currency if USD absent
        let tierPrice = priceMatch ? parseFloat(priceMatch[1]) : null;
        if (tierPrice == null && Object.keys(prices).length > 0) {
          tierPrice = prices[Object.keys(prices)[0]];
        }
        currentTier = {
          name: text.substring(0, 80),
          label: label || text.substring(0, 40),
          price: tierPrice,
          prices: prices,
          tr: tr,
          games: [],
        };
        tiers.push(currentTier);
        console.log(`[BVG Scorer] Tier detected: "${label}" price=$${tierPrice} from text: "${text.substring(0, 120)}"`);
      } else if (type === ROW_GAME && currentTier) {
        currentTier.games.push(tr);
        tr.dataset.bvgTier = currentTier.name;
        if (currentTier.price != null) tr.dataset.bvgTierPrice = String(currentTier.price);
      }
    }
    return tiers;
  }

  // ═══════════════════════════════════════
  // OWNED DETECTION FROM DOM
  //
  // Barter.vg shows a 📚 (library) icon
  // for games you own. We detect this from
  // the row content so owned count is
  // accurate without manual clicking.
  // ═══════════════════════════════════════
  function isOwnedInDOM(tr) {
    if (tr.querySelector('a.libr[title="in library"]')) return true;
    if (tr.textContent.includes('📚')) return true;
    return false;
  }
  function isWishlistedInDOM(tr) {
    if (tr.querySelector('[title*="wish" i], [aria-label*="wish" i], .wish, .wishlist')) return true;
    const text = tr.textContent.toLowerCase();
    if (text.includes('wishlisted')) return true;
    return /(^|\s)[★☆](\s|$)/.test(tr.textContent);
  }

  // ═══════════════════════════════════════
  // DATA EXTRACTION (right-to-left)
  // ═══════════════════════════════════════
  // Detect DLC, soundtracks, artbooks, and package parents
  // so they can be excluded from bundle score calculations.
  // classifyItem() logic mirrored in scoring.test.js — keep in sync.
  const DLC_KEYWORDS = /\b(soundtrack|ost|artbook|art\s*book|wallpaper|skin\s*pack|costume|dlc|season\s*pass|expansion|bonus\s*content|digital\s*deluxe|deluxe\s*edition|collector[''\u2019]?s\s*edition|upgrade)\b/i;
  // Review threshold for distinguishing DLC from standalone games. Items with
  // DLC-like titles or inside packages are classified as DLC only if they have
  // fewer reviews than this. Above this count, the item is popular enough to be
  // a real game that happens to have a DLC-ish name (e.g., "Expansion" in the
  // title of a standalone game). 50 balances: too low catches real DLC with a
  // small fanbase, too high lets actual standalone expansions slip through.
  const DLC_REVIEW_THRESHOLD = 50;
  function classifyItem(title, tr, ratingPct, reviews) {
    const titleLower = title.toLowerCase();
    if (DLC_KEYWORDS.test(titleLower)) {
      if (reviews && reviews >= DLC_REVIEW_THRESHOLD) return 'game';
      return 'dlc';
    }
    // Walk up to 5 preceding rows to detect if this item is inside a multi-item
    // package (e.g., "3 item package"). Package sub-items with few reviews are
    // likely DLC/extras bundled with the main game.
    let prev = tr.previousElementSibling;
    let depth = 0;
    while (prev && depth < 5) {
      const text = prev.textContent.trim().toLowerCase();
      if (/\d+\s*item\s*package/.test(text)) {
        if (!reviews || reviews < DLC_REVIEW_THRESHOLD) return 'dlc';
        return 'game';
      }
      if (prev.querySelector('td.bargraphs') || prev.querySelector('td.tierLine')) break;
      prev = prev.previousElementSibling;
      depth++;
    }
    if (!ratingPct && !reviews) return 'package';
    return 'game';
  }
  function extractGame(tr) {
    const titleA = tr.querySelector('a[href*="/i/"], a[href*="/game/"]');
    const title = titleA ? titleA.textContent.trim() : 'Unknown';
    const cells = [...tr.querySelectorAll('td')];
    let msrp = null, bundledTimes = null, reviews = null, ratingPct = null;
    let reviewCell = null;
    const numsIn = (cell) => {
      if (!cell) return [];
      return (cell.textContent.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
    };
    // Walk cells right-to-left
    let phase = 0; // 0=looking for price, 1=looking for bundled, 2=looking for reviews/rating
    for (let i = cells.length - 1; i >= 0 && phase < 3; i--) {
      const text = cells[i].textContent.replace(/,/g, '').trim();
      const nums = numsIn(cells[i]);
      if (phase === 0) {
        const priceMatch = text.match(/(\d+\.\d{2})/);
        if (priceMatch) {
          msrp = parseFloat(priceMatch[1]);
          phase = 1;
        }
        continue;
      }
      if (phase === 1) {
        if (nums.length >= 1) {
          bundledTimes = nums[0];
          phase = 2;
        }
        continue;
      }
      if (phase === 2) {
        reviewCell = cells[i];
        if (nums.length >= 2) {
          const sorted = [...nums].sort((a, b) => b - a);
          reviews = sorted[0];
          ratingPct = sorted[1] <= 100 ? sorted[1] : null;
        } else if (nums.length === 1) {
          if (nums[0] <= 100) ratingPct = nums[0];
          else reviews = nums[0];
        }
        phase = 3;
      }
    }
    // Fallback: if the phased scan didn't reach review/rating data (e.g. no MSRP
    // column for this row), do a dedicated scan for a cell with two numbers where
    // one is ≤100 (rating%) and the other is the review count.
    if (ratingPct == null && reviews == null) {
      for (let i = cells.length - 1; i >= 0; i--) {
        const nums = numsIn(cells[i]);
        if (nums.length >= 2) {
          const sorted = [...nums].sort((a, b) => b - a);
          if (sorted[1] >= 1 && sorted[1] <= 100 && sorted[0] <= 10_000_000) {
            reviews = sorted[0];
            ratingPct = sorted[1];
            reviewCell = cells[i];
            break;
          }
        }
      }
    }
    const ownedDOM = isOwnedInDOM(tr);
    const wishlistedDOM = isWishlistedInDOM(tr);
    const itemType = classifyItem(title, tr, ratingPct, reviews);
    const imgEl = tr.querySelector('img[src*="steam"], img[src*="cdn"], img[src*="capsule"], img[src*="header"]')
      || tr.querySelector('img');
    const imgSrc = imgEl ? imgEl.src : null;
    // Extract Steam store link if available (for per-card Steam button)
    const steamA = tr.querySelector('a[href*="store.steampowered.com/app/"]');
    const steamUrl = steamA ? steamA.href : null;
    console.log(`[BVG] ${title}: type=${itemType} wish=${wishlistedDOM} rating=${ratingPct}% reviews=${reviews} msrp=${msrp} bundled=${bundledTimes}`);
    return { title, ratingPct, reviews, msrp, bundledTimes, ownedDOM, wishlistedDOM, itemType, tr, reviewCell, imgSrc, steamUrl };
  }

  // ═══════════════════════════════════════
  // SCORING — scoreGame() and helpers
  // Mirrored in scoring.test.js — keep both in sync when modifying.
  // ═══════════════════════════════════════
  function scoreGame(g) {
    const isUnrated = g.ratingPct == null && (!g.reviews || g.reviews <= 0);
    const ratingRaw = g.ratingPct ? clamp01(g.ratingPct / 100) : (isUnrated ? 0.5 : 0);
    const conf = isUnrated ? 0.3 : confidenceFromReviews(g.reviews);
    const rating = SETTINGS.useWilsonAdjustedRating && !isUnrated
      ? wilsonLowerBound(ratingRaw, g.reviews || 0)
      : ratingRaw;
    const val = clamp01((g.msrp || 0) / SETTINGS.msrpCap);
    const bundleValue = CURRENT_BUNDLE_COST
      ? clamp01((g.msrp || 0) / Math.max(CURRENT_BUNDLE_COST, 0.01))
      : val;
    const wishlistBonus = g.wishlistedDOM ? 1 : 0;
    const pen = g.bundledTimes != null ? clamp01(g.bundledTimes / SETTINGS.bundledPenaltyCap) : 0;
    const w = SETTINGS.weights;
    const posSum = w.rating + w.confidence + w.value + w.bundleValue + w.wishlist;
    const n = posSum > 0 ? posSum : 1;
    // Penalty is normalized by the same divisor as positive terms so it scales
    // proportionally when users adjust weights — prevents penalty from dominating
    // when positive weights are set low.
    const raw = (w.rating / n) * rating + (w.confidence / n) * conf + (w.value / n) * val + (w.bundleValue / n) * bundleValue + (w.wishlist / n) * wishlistBonus - (w.rebundlePenalty / n) * pen;
    return {
      score: Math.max(0, raw * 100),
      breakdown: { rating, ratingRaw, conf, val, bundleValue, wishlistBonus, pen, isUnrated },
    };
  }
  function scoreColor(s) {
    if (s >= 85) return '#1a7f37';
    if (s >= 70) return '#6e6411';
    if (s >= 50) return '#7c4518';
    return '#7a1d1d';
  }
  function scoreBg(s) {
    if (s >= 85) return 'linear-gradient(135deg, #1a7f37 0%, #238636 100%)';
    if (s >= 70) return 'linear-gradient(135deg, #5c5410 0%, #7a6d12 100%)';
    if (s >= 50) return 'linear-gradient(135deg, #6b3a14 0%, #8a4f1f 100%)';
    return 'linear-gradient(135deg, #611919 0%, #8a1f1f 100%)';
  }
  // Text label for score tier — provides non-color differentiation for
  // colorblind accessibility (~10% of males can't distinguish red/green)
  function scoreTierLabel(s) {
    if (s >= 85) return 'Great';
    if (s >= 70) return 'Good';
    if (s >= 50) return 'Fair';
    return 'Poor';
  }
  function ratingColor(r) {
    if (r >= 80) return '#22863a';
    if (r >= 60) return '#7a6d12';
    if (r >= 40) return '#8a4f1f';
    return '#8a1f1f';
  }
  function formatBreakdown(b) {
    const lines = [];
    if (b.isUnrated) {
      lines.push('Rating:     N/A (unrated — using neutral 50%)');
      lines.push('Confidence: N/A (unrated — using 30% baseline)');
    } else {
      lines.push(`Rating:     ${(b.ratingRaw * 100).toFixed(0)}%` +
        (b.rating !== b.ratingRaw ? ` (Wilson: ${(b.rating * 100).toFixed(1)}%)` : ''));
      lines.push(`Confidence: ${(b.conf * 100).toFixed(1)}%`);
    }
    lines.push(`Value:      ${(b.val * 100).toFixed(1)}%`);
    lines.push(`Bundle $:   ${(b.bundleValue * 100).toFixed(1)}%`);
    lines.push(`Wishlist:  +${(b.wishlistBonus * 100).toFixed(0)}%`);
    lines.push(`Rebundle:  -${(b.pen * 100).toFixed(1)}%`);
    return lines.join('\n');
  }

  // ═══════════════════════════════════════
  // BUNDLE COST DETECTION
  // ═══════════════════════════════════════
  function detectBundleCost(table) {
    const scope = (table?.parentElement || document.body);
    const probe = scope.textContent || '';
    const regexes = [
      /(?:cost|price|pay|from|tier)\D{0,18}\$\s*(\d+(?:\.\d{1,2})?)/ig,
      /\$\s*(\d+(?:\.\d{1,2})?)\s*(?:for|bundle|tier)/ig,
    ];
    const matches = [];
    for (const re of regexes) {
      let m;
      while ((m = re.exec(probe)) !== null) {
        const n = parseFloat(m[1]);
        if (Number.isFinite(n) && n > 0 && n < 500) matches.push(n);
      }
    }
    if (!matches.length) return null;
    return Math.min(...matches);
  }

  // ═══════════════════════════════════════
  // BUNDLE-LEVEL SCORES (normalized 0-100)
  //
  // Raw sum of top-N scores can range from
  // 0 to N*100. We normalize:
  //   bundleRating = sum / N
  //
  // This gives a 0-100 scale where:
  //   90+ = exceptional bundle
  //   70+ = solid bundle
  //   50+ = mediocre
  //   <50 = weak
  // ═══════════════════════════════════════
  function computeBundleScores(scored, ownedSet) {
    const scorable = scored.filter(g => g.itemType === 'game');
    const sorted = [...scorable].sort((a, b) => b.score - a.score);
    const topMain  = sorted.slice(0, SETTINGS.topNMain);
    const topDepth = sorted.slice(0, SETTINGS.topNDepth);
    const personal = sorted.filter(g => !ownedSet.has(g.title));
    const personalTop = personal.slice(0, SETTINGS.topNMain);
    const avg = (arr) => arr.length > 0 ? arr.reduce((s, g) => s + g.score, 0) / arr.length : 0;
    const unownedMsrpSum = personal.reduce((s, g) => s + (g.msrp || 0), 0);
    const dealQuality = CURRENT_BUNDLE_COST && CURRENT_BUNDLE_COST > 0
      ? unownedMsrpSum / CURRENT_BUNDLE_COST : null;
    return {
      bundleRating:  avg(topMain),
      depthRating:   avg(topDepth),
      personalRating: avg(personalTop),
      topMain,
      dealQuality,
      unownedMsrpSum,
    };
  }

  // ═══════════════════════════════════════
  // HISTOGRAM
  // ═══════════════════════════════════════
  function buildHistogramHTML(scored) {
    if (!scored || !scored.length) return '';
    const games = scored.filter(g => g.itemType === 'game');
    const buckets = [
      { label: '85+', min: 85, max: 101, color: '#1a7f37' },
      { label: '70-84', min: 70, max: 85, color: '#6e6411' },
      { label: '50-69', min: 50, max: 70, color: '#7c4518' },
      { label: '<50', min: 0, max: 50, color: '#7a1d1d' },
    ];
    const counts = buckets.map(b => games.filter(g => g.score >= b.min && g.score < b.max).length);
    const maxCount = Math.max(1, ...counts);
    const bars = buckets.map((b, i) => {
      const pct = (counts[i] / maxCount) * 100;
      return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;">
        <span style="width:38px;text-align:right;color:#8b949e;">${b.label}</span>
        <div style="flex:1;height:14px;background:#21262d;border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${b.color};border-radius:3px;"></div>
        </div>
        <span style="width:20px;color:#8b949e;">${counts[i]}</span>
      </div>`;
    }).join('');
    return `<div style="margin:4px 0;">${bars}</div>`;
  }

  // ═══════════════════════════════════════
  // SETTINGS HTML
  // ═══════════════════════════════════════
  function buildSettingsHTML() {
    const s = SETTINGS, w = s.weights;
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;">
        <label>Top N (main) <input type="number" data-key="topNMain" value="${s.topNMain}" min="1" max="50"></label>
        <label>Top N (depth) <input type="number" data-key="topNDepth" value="${s.topNDepth}" min="1" max="50"></label>
        <label>MSRP cap ($) <input type="number" data-key="msrpCap" value="${s.msrpCap}" min="1" max="200" step="0.01"></label>
        <label>Bundled-penalty cap <input type="number" data-key="bundledPenaltyCap" value="${s.bundledPenaltyCap}" min="1" max="100"></label>
        <label>Confidence anchor <input type="number" data-key="confidenceAnchor" value="${s.confidenceAnchor}" min="50" max="5000" step="50" title="Review count where confidence reaches 50%. Lower = trust fewer reviews."></label>
        <label>W: Rating <input type="number" data-key="w.rating" value="${w.rating}" min="0" max="2" step="0.05"></label>
        <label>W: Confidence <input type="number" data-key="w.confidence" value="${w.confidence}" min="0" max="2" step="0.05"></label>
        <label>W: Value <input type="number" data-key="w.value" value="${w.value}" min="0" max="2" step="0.05"></label>
        <label>W: Bundle cost value <input type="number" data-key="w.bundleValue" value="${w.bundleValue}" min="0" max="2" step="0.05"></label>
        <label>W: Wishlist boost <input type="number" data-key="w.wishlist" value="${w.wishlist}" min="0" max="1" step="0.01"></label>
        <label>W: Rebundle <input type="number" data-key="w.rebundlePenalty" value="${w.rebundlePenalty}" min="0" max="2" step="0.05"></label>
        <label style="grid-column:span 2">
          <input type="checkbox" data-key="useWilsonAdjustedRating" ${s.useWilsonAdjustedRating ? 'checked' : ''}>
          Wilson-adjusted rating (SteamDB-like)
        </label>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button class="bvg-settings-btn" id="bvg-settings-apply">Apply &amp; re-score</button>
        <button class="bvg-settings-btn" id="bvg-settings-reset">Reset defaults</button>
      </div>
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid #21262d;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;font-weight:600;margin-bottom:6px;">Presets</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select id="bvg-preset-select" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:4px 8px;font-size:12px;min-width:140px;">
            <option value="">— select preset —</option>
            ${Object.keys(loadPresets()).map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}
          </select>
          <button class="bvg-settings-btn" id="bvg-preset-load">Load</button>
          <button class="bvg-settings-btn" id="bvg-preset-delete" style="color:#f85149;">Delete</button>
          <input type="text" id="bvg-preset-name" placeholder="Preset name…" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:4px 8px;font-size:12px;width:140px;">
          <button class="bvg-settings-btn" id="bvg-preset-save">Save</button>
        </div>
      </div>
    `;
  }
  function readSettingsFromPanel() {
    const panel = document.getElementById('bvg-settings-panel');
    if (!panel) return;
    panel.querySelectorAll('input[data-key]').forEach(input => {
      const key = input.dataset.key;
      if (input.type === 'checkbox') {
        if (key.startsWith('w.')) SETTINGS.weights[key.slice(2)] = input.checked;
        else SETTINGS[key] = input.checked;
        return;
      }
      const val = parseFloat(input.value);
      if (!Number.isFinite(val)) {
        console.warn(`[BVG Scorer] Invalid value for ${key}: "${input.value}", skipping`);
        return;
      }
      const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
      const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
      const clamped = Math.max(min, Math.min(max, val));
      if (clamped !== val) {
        console.warn(`[BVG Scorer] Clamped ${key}: ${val} → ${clamped}`);
        input.value = clamped;
      }
      if (key.startsWith('w.')) SETTINGS.weights[key.slice(2)] = clamped;
      else SETTINGS[key] = clamped;
    });
    saveSettings(SETTINGS);
  }

  // ═══════════════════════════════════════
  // CURRENCY HELPERS
  // ═══════════════════════════════════════
  function loadCurrencyPref() {
    try { return localStorage.getItem(STORAGE_KEY_CURRENCY) || ''; } catch { return ''; }
  }
  function saveCurrencyPref(c) { safeStorageSet(STORAGE_KEY_CURRENCY, c); }
  function formatTierPrice(tier, currencyPref) {
    if (!tier.prices || !Object.keys(tier.prices).length) {
      return tier.price != null ? `$${tier.price.toFixed(2)}` : null;
    }
    if (currencyPref && tier.prices[currencyPref] != null) {
      const def = CURRENCY_DEFS.find(c => c.code === currencyPref);
      const sym = def ? def.symbol : currencyPref;
      return `${sym}${tier.prices[currencyPref].toFixed(2)}`;
    }
    if (tier.prices.USD != null) return `$${tier.prices.USD.toFixed(2)}`;
    const first = Object.keys(tier.prices)[0];
    if (first) {
      const def = CURRENCY_DEFS.find(c => c.code === first);
      const sym = def ? def.symbol : first;
      return `${sym}${tier.prices[first].toFixed(2)}`;
    }
    return tier.price != null ? `$${tier.price.toFixed(2)}` : null;
  }
  function collectAvailableCurrencies(tiers) {
    const seen = new Set();
    for (const t of tiers) {
      if (t.prices) Object.keys(t.prices).forEach(c => seen.add(c));
    }
    return [...seen];
  }

  // ═══════════════════════════════════════
  // BUNDLE METADATA EXTRACTION
  //
  // Reads header-level info from the original
  // Barter page before we hide it. This data
  // populates our custom header bar.
  // ═══════════════════════════════════════
  function extractBundleMetadata() {
    const meta = {
      title: '',
      subtitle: '',
      buyLinks: [],
      dates: '',
      wishlistInfo: '',
    };

    // Bundle title: first <h1>, or fallback to <title> minus site suffix
    const h1 = document.querySelector('h1');
    if (h1) {
      meta.title = h1.textContent.trim();
    } else {
      meta.title = (document.title || '').replace(/\s*[-–|]\s*Barter\.vg.*$/i, '').trim();
    }

    // Subtitle: look for store name and status info near the top
    // Barter shows store name (e.g. "Fanatical ✓") and dates
    const bodyText = document.body.textContent || '';

    // Dates: "Started X ago ... Ends Y"
    const dateMatch = bodyText.match(/((?:Started|Began)\s+.+?(?:Ends?\s+\S+(?:\s+\S+)?))/i);
    if (dateMatch) meta.dates = dateMatch[1].trim();

    // Wishlist info: "N games from wishlist in active bundles"
    const wishMatch = bodyText.match(/(\d+\s+games?\s+from\s+wishlist\s+in\s+active\s+bundles?)/i);
    if (wishMatch) meta.wishlistInfo = wishMatch[1].trim();

    // Buy links: anchors that point to known stores or external bundle pages
    // Per-game Steam links are now on individual cards, so exclude
    // store.steampowered.com from the header buy links
    const storeSelectors = [
      'a[href*="fanatical.com"]',
      'a[href*="humblebundle.com"]',
      'a[href*="indiegala.com"]',
      'a[href*="groupees.com"]',
      'a[href*="steamgifts.com"]',
      'a[href*="reddit.com"]',
    ];
    // Friendly store name mapping for clearer link labels
    const STORE_NAMES = {
      'fanatical.com': 'Fanatical',
      'humblebundle.com': 'Humble Bundle',
      'indiegala.com': 'IndieGala',
      'groupees.com': 'Groupees',
      'steamgifts.com': 'SteamGifts',
      'reddit.com': 'Reddit',
    };
    const seen = new Set();
    for (const sel of storeSelectors) {
      document.querySelectorAll(sel).forEach(a => {
        const href = a.href;
        if (seen.has(href)) return;
        seen.add(href);
        // Derive a descriptive label: "Buy on StoreName" or "View on StoreName"
        let storeName = '';
        try {
          const host = new URL(href).hostname.replace('www.', '');
          storeName = STORE_NAMES[host] || host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
        } catch {
          storeName = a.textContent.trim() || 'Link';
        }
        const prefix = storeName === 'Reddit' || storeName === 'SteamGifts' ? 'View on' : 'Buy on';
        meta.buyLinks.push({ href, label: `${prefix} ${storeName}` });
      });
    }

    // Store name: check for known store indicators
    const storeEl = document.querySelector('a[href*="fanatical.com"], a[href*="humblebundle.com"], a[href*="indiegala.com"]');
    if (storeEl) {
      try {
        const host = new URL(storeEl.href).hostname.replace('www.', '');
        const storeName = host.split('.')[0];
        meta.subtitle = storeName.charAt(0).toUpperCase() + storeName.slice(1);
      } catch { /* ignore */ }
    }

    return meta;
  }

  // ═══════════════════════════════════════
  // PAGE MANAGEMENT
  //
  // Hides the original Barter page and shows
  // our custom app, or vice versa for Classic
  // Page toggle.
  // ═══════════════════════════════════════
  const STORAGE_KEY_PAGE = 'bvg_scorer_page_v1';
  function loadPagePref() {
    try { return localStorage.getItem(STORAGE_KEY_PAGE) || 'modern'; }
    catch { return 'modern'; }
  }
  function savePagePref(v) { safeStorageSet(STORAGE_KEY_PAGE, v); }

  function hideOriginalPage() {
    for (const child of document.body.children) {
      if (child.id === 'bvg-app' || child.id === 'bvg-view-fab') continue;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
      child.style.display = 'none';
      child.dataset.bvgHidden = '1';
    }
  }

  function showOriginalPage() {
    for (const child of document.body.children) {
      if (child.dataset.bvgHidden === '1') {
        child.style.display = '';
        delete child.dataset.bvgHidden;
      }
    }
  }

  function setPage(mode) {
    savePagePref(mode);
    const app = document.getElementById('bvg-app');
    if (mode === 'modern') {
      hideOriginalPage();
      if (app) app.style.display = '';
    } else {
      showOriginalPage();
      if (app) app.style.display = 'none';
    }
    // Update all toggle button states (toolbar + floating FAB)
    document.querySelectorAll('.bvg-page-toggle button, #bvg-view-fab button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === mode);
    });
  }

  // Persistent floating toggle so users can always switch back from classic view
  function ensureViewFAB() {
    if (document.getElementById('bvg-view-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'bvg-view-fab';
    fab.innerHTML = `
      <button type="button" data-page="modern">Modern</button>
      <button type="button" data-page="classic">Classic</button>
    `;
    fab.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPage(btn.dataset.page);
      });
    });
    document.body.appendChild(fab);
    // Sync initial state
    const pref = loadPagePref();
    fab.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pref);
    });
  }

  // ═══════════════════════════════════════
  // RENDER: APP SHELL
  //
  // Master render function that creates the
  // full-page custom layout. Sub-renderers
  // populate each section.
  // ═══════════════════════════════════════
  // Shared state for the game grid (filters/sort)
  let _gridState = {
    sortKey: 'score',
    sortDir: 'desc',
    search: '',
    hideOwned: false,
    hideDLC: false,
    currency: loadCurrencyPref(),
  };

  // Cached references for targeted re-renders
  let _appRefs = {
    statsContainer: null,
    contentContainer: null,
    scored: null,
    ownedSet: null,
    tiers: null,
    bundleScores: null,
    metadata: null,
  };

  function renderApp(scored, ownedSet, tiers, bundleScores, metadata) {
    _appRefs.scored = scored;
    _appRefs.ownedSet = ownedSet;
    _appRefs.tiers = tiers;
    _appRefs.bundleScores = bundleScores;
    _appRefs.metadata = metadata;

    let app = document.getElementById('bvg-app');
    if (!app) {
      app = document.createElement('div');
      app.id = 'bvg-app';
      document.body.appendChild(app);
    }
    app.innerHTML = '';

    renderHeader(app, metadata);
    renderStatsDashboard(app, bundleScores, scored, tiers);
    renderToolbar(app, tiers);
    renderContent(app, scored, ownedSet, tiers);

    // Show storage warning if needed
    if (!_storageAvailable && !_storageWarningShown) {
      _storageWarningShown = true;
      showStorageWarning();
    }
  }

  // ═══════════════════════════════════════
  // RENDER: HEADER BAR
  // ═══════════════════════════════════════
  function renderHeader(app, metadata) {
    const header = document.createElement('div');
    header.className = 'bvg-header';

    // Left: title + subtitle
    let subParts = [];
    if (metadata.subtitle) subParts.push(escHtml(metadata.subtitle));
    if (metadata.dates) subParts.push(escHtml(metadata.dates));
    if (metadata.wishlistInfo) subParts.push(escHtml(metadata.wishlistInfo));

    header.innerHTML = `
      <div class="bvg-header-left">
        <div class="bvg-header-title">${escHtml(metadata.title)}</div>
        ${subParts.length ? `<div class="bvg-header-sub">${subParts.join('<span style="color:#30363d"> | </span>')}</div>` : ''}
      </div>
      <div class="bvg-header-right">
        ${metadata.buyLinks.map(l => `<a class="bvg-header-link" href="${escHtml(l.href)}" target="_blank">${escHtml(l.label)}</a>`).join('')}
        <span class="bvg-header-badge">v${SCRIPT_VERSION}</span>
      </div>
    `;
    app.appendChild(header);
  }

  // ═══════════════════════════════════════
  // RENDER: STATS DASHBOARD
  // ═══════════════════════════════════════
  function renderStatsDashboard(app, bundleScores, scored, tiers) {
    const { bundleRating, depthRating, personalRating, topMain, dealQuality, unownedMsrpSum } = bundleScores;
    const ownedSet = _appRefs.ownedSet;
    const games = scored.filter(g => g.itemType === 'game');
    const ownedCount = games.filter(g => ownedSet.has(g.title)).length;
    const gameCount = games.length;
    const dlcCount = scored.filter(g => g.itemType !== 'game').length;
    const wishCount = games.filter(g => g.wishlistedDOM).length;

    // Aggregate stats for new cards
    const totalMsrp = games.reduce((s, g) => s + (g.msrp || 0), 0);
    const ratedGames = games.filter(g => g.ratingPct != null);
    const avgReview = ratedGames.length > 0
      ? ratedGames.reduce((s, g) => s + g.ratingPct, 0) / ratedGames.length : 0;
    const pctSaved = totalMsrp > 0 && CURRENT_BUNDLE_COST
      ? ((totalMsrp - CURRENT_BUNDLE_COST) / totalMsrp) * 100 : null;

    const stats = document.createElement('div');
    stats.className = 'bvg-stats';
    _appRefs.statsContainer = stats;

    const statBadge = (label, rating, detail) => {
      const c = ratingColor(rating);
      return `<div class="bvg-stat-card">
        <div class="bvg-score-label">${label}</div>
        <div><span class="bvg-score-num" style="color:${c}">${rating.toFixed(0)}</span><span class="bvg-score-denom">/100</span></div>
        <div class="bvg-score-label">${detail}</div>
        <div class="bvg-score-bar" style="width:${rating}%;background:${c}"></div>
      </div>`;
    };

    // Top picks
    const picksHTML = topMain
      .map(p => `<div class="bvg-pick-item"><span class="bvg-pick-name" style="color:${scoreColor(p.score)}">${escHtml(p.title)}</span> <span class="bvg-pick-score">${p.score.toFixed(1)}</span></div>`)
      .join('');

    // Tier pricing strip — prominent display of each tier's price, games, and price-per-game
    let tierStripHTML = '';
    if (tiers && tiers.length > 0) {
      const currPref = _gridState.currency;
      const tierItems = tiers.map(t => {
        const tierGames = games.filter(g => g.tr && g.tr.dataset.bvgTier === t.name);
        const tierMsrp = tierGames.reduce((s, g) => s + (g.msrp || 0), 0);
        const tierAvg = tierGames.length > 0 ? tierGames.reduce((s, g) => s + g.score, 0) / tierGames.length : 0;
        const fmtPrice = formatTierPrice(t, currPref);
        const pricePerGame = t.price != null && tierGames.length > 0
          ? `$${(t.price / tierGames.length).toFixed(2)}/game` : '';
        const tierSaved = tierMsrp > 0 && t.price != null
          ? `${(((tierMsrp - t.price) / tierMsrp) * 100).toFixed(0)}% saved` : '';
        const avgColor = ratingColor(tierAvg);
        return `<div class="bvg-tier-strip-item">
          <div class="bvg-tsi-label">${escHtml(t.label || t.name)}</div>
          <div class="bvg-tsi-price">${fmtPrice || '—'}</div>
          <div class="bvg-tsi-detail">${tierGames.length} game${tierGames.length !== 1 ? 's' : ''}${pricePerGame ? ` &middot; ${pricePerGame}` : ''}${tierSaved ? ` &middot; ${tierSaved}` : ''}</div>
          <div class="bvg-tsi-detail">Avg score: <strong style="color:${avgColor}">${tierAvg.toFixed(0)}</strong> &middot; MSRP: $${tierMsrp.toFixed(2)}</div>
        </div>`;
      }).join('');
      tierStripHTML = `<div class="bvg-tier-strip">
        <div class="bvg-section-label">Tier Pricing</div>
        <div class="bvg-tier-strip-items">${tierItems}</div>
      </div>`;
    }

    stats.innerHTML = `
      ${statBadge('Bundle', bundleRating, `top ${SETTINGS.topNMain}`)}
      ${statBadge('Depth', depthRating, `top ${SETTINGS.topNDepth}`)}
      ${statBadge('Personal', personalRating, `excl. owned`)}
      <div class="bvg-stat-card">
        <div class="bvg-score-label">Total MSRP</div>
        <div><span class="bvg-score-num" style="color:#58a6ff">$${totalMsrp.toFixed(0)}</span></div>
        <div class="bvg-score-label">${gameCount} games${dlcCount > 0 ? ` + ${dlcCount} DLC` : ''}</div>
      </div>
      <div class="bvg-stat-card">
        <div class="bvg-score-label">Avg Review</div>
        <div><span class="bvg-score-num" style="color:${ratingColor(avgReview)}">${avgReview.toFixed(0)}%</span></div>
        <div class="bvg-score-label">${ratedGames.length} rated</div>
        <div class="bvg-score-bar" style="width:${avgReview}%;background:${ratingColor(avgReview)}"></div>
      </div>
      ${pctSaved != null ? `<div class="bvg-stat-card">
        <div class="bvg-score-label">% Saved vs MSRP</div>
        <div><span class="bvg-score-num" style="color:#3fb950">${pctSaved.toFixed(0)}%</span></div>
        <div class="bvg-score-label">$${CURRENT_BUNDLE_COST.toFixed(2)} bundle</div>
        <div class="bvg-score-bar" style="width:${Math.min(pctSaved, 100)}%;background:#3fb950"></div>
      </div>` : ''}
      <div class="bvg-picks-card">
        <div class="bvg-section-label">Top Picks</div>
        ${picksHTML || '<span style="color:#8b949e">n/a</span>'}
      </div>
      <div class="bvg-histogram-card">
        <div class="bvg-section-label" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;font-weight:600;margin-bottom:6px;">Score Distribution</div>
        ${buildHistogramHTML(scored)}
      </div>
      <div class="bvg-meta-card">
        <span>${ownedCount} of ${gameCount} games owned${dlcCount > 0 ? ` &middot; ${dlcCount} DLC/extras` : ''}</span>
        <span>${wishCount} wishlisted${CURRENT_BUNDLE_COST ? ` &middot; Bundle: $${CURRENT_BUNDLE_COST.toFixed(2)}` : ''}</span>
        ${dealQuality != null ? `<span><span class="bvg-meta-highlight">Deal: ${dealQuality.toFixed(1)}x</span> ($${unownedMsrpSum.toFixed(0)} unowned MSRP)</span>` : ''}
        <span>Rating: ${SETTINGS.useWilsonAdjustedRating ? 'Wilson-adjusted' : 'Raw % (confidence-weighted)'}</span>
      </div>
      ${tierStripHTML}
    `;

    app.appendChild(stats);
  }

  // ═══════════════════════════════════════
  // RENDER: TOOLBAR
  // ═══════════════════════════════════════
  function renderToolbar(app, tiers) {
    const st = _gridState;
    const dirArrow = st.sortDir === 'desc' ? '&#9660;' : '&#9650;';
    const pagePref = loadPagePref();

    // Currency selector
    const availCurrencies = collectAvailableCurrencies(tiers);
    let currencySelectHTML = '';
    if (availCurrencies.length > 1) {
      const opts = availCurrencies.map(c => {
        const def = CURRENCY_DEFS.find(d => d.code === c);
        const label = def ? `${def.symbol} ${c}` : c;
        const sel = st.currency === c ? ' selected' : '';
        return `<option value="${c}"${sel}>${escHtml(label)}</option>`;
      }).join('');
      currencySelectHTML = `<select id="bvg-currency-select"><option value=""${!st.currency ? ' selected' : ''}>Currency</option>${opts}</select>`;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'bvg-toolbar';
    toolbar.innerHTML = `
      <div class="bvg-page-toggle">
        <button type="button" data-page="modern" class="${pagePref === 'modern' ? 'active' : ''}">Modern</button>
        <button type="button" data-page="classic" class="${pagePref !== 'modern' ? 'active' : ''}">Classic</button>
      </div>
      <input type="text" id="bvg-search" placeholder="Search games..." value="${escHtml(st.search)}">
      <select id="bvg-sort-select">
        <option value="score"${st.sortKey === 'score' ? ' selected' : ''}>Score ${st.sortKey === 'score' ? dirArrow : ''}</option>
        <option value="title"${st.sortKey === 'title' ? ' selected' : ''}>Title ${st.sortKey === 'title' ? dirArrow : ''}</option>
        <option value="rating"${st.sortKey === 'rating' ? ' selected' : ''}>Rating ${st.sortKey === 'rating' ? dirArrow : ''}</option>
        <option value="reviews"${st.sortKey === 'reviews' ? ' selected' : ''}>Reviews ${st.sortKey === 'reviews' ? dirArrow : ''}</option>
        <option value="msrp"${st.sortKey === 'msrp' ? ' selected' : ''}>MSRP ${st.sortKey === 'msrp' ? dirArrow : ''}</option>
      </select>
      ${currencySelectHTML}
      <button type="button" class="bvg-filter-chip${st.hideOwned ? ' active' : ''}" id="bvg-toggle-owned">Hide owned</button>
      <button type="button" class="bvg-filter-chip${st.hideDLC ? ' active' : ''}" id="bvg-toggle-dlc">Hide DLC</button>
      <span class="bvg-toolbar-spacer"></span>
      <button class="bvg-settings-btn" id="bvg-export-btn" aria-label="Copy summary to clipboard">&#128203; Copy Summary</button>
      <button class="bvg-settings-btn" id="bvg-export-json-btn" aria-label="Export JSON to clipboard">{ } Export JSON</button>
      <button class="bvg-settings-btn" id="bvg-settings-gear" aria-label="Open scoring settings">&#9881; Settings</button>
    `;

    // Page toggle
    toolbar.querySelectorAll('.bvg-page-toggle button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPage(btn.dataset.page);
      });
    });

    // Search
    let searchDebounce = null;
    const searchInput = toolbar.querySelector('#bvg-search');
    searchInput?.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        st.search = searchInput.value;
        reRenderContent();
      }, 200);
    });

    // Sort
    toolbar.querySelector('#bvg-sort-select')?.addEventListener('change', (e) => {
      if (st.sortKey === e.target.value) {
        st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        st.sortKey = e.target.value;
        st.sortDir = 'desc';
      }
      reRenderContent();
    });

    // Currency
    toolbar.querySelector('#bvg-currency-select')?.addEventListener('change', (e) => {
      st.currency = e.target.value;
      saveCurrencyPref(st.currency);
      reRenderContent();
    });

    // Filters
    toolbar.querySelector('#bvg-toggle-owned')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      st.hideOwned = !st.hideOwned;
      reRenderContent();
    });
    toolbar.querySelector('#bvg-toggle-dlc')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      st.hideDLC = !st.hideDLC;
      reRenderContent();
    });

    // Export
    toolbar.querySelector('#bvg-export-btn')?.addEventListener('click', () => {
      const bs = _appRefs.bundleScores;
      const s = _appRefs.scored;
      const os = _appRefs.ownedSet;
      if (!bs || !s) return;
      const ownedCount = s.filter(g => g.itemType === 'game' && os.has(g.title)).length;
      const gameCount = s.filter(g => g.itemType === 'game').length;
      const wishCount = s.filter(g => g.itemType === 'game' && g.wishlistedDOM).length;
      const dlcCount = s.filter(g => g.itemType !== 'game').length;
      const topList = bs.topMain.map((p, i) => `${i + 1}. ${p.title} (${p.score.toFixed(1)})`).join('\n');
      const lines = [
        `Bundle Evaluation — ${document.title || location.href}`,
        `Bundle: ${bs.bundleRating.toFixed(0)}/100 | Depth: ${bs.depthRating.toFixed(0)}/100 | Personal: ${bs.personalRating.toFixed(0)}/100`,
        `${ownedCount}/${gameCount} owned | ${wishCount} wishlisted${dlcCount > 0 ? ` | ${dlcCount} DLC excluded` : ''}`,
        bs.dealQuality != null ? `Deal quality: ${bs.dealQuality.toFixed(1)}x ($${bs.unownedMsrpSum.toFixed(0)} unowned MSRP / $${CURRENT_BUNDLE_COST.toFixed(2)})` : '',
        '', 'Top Picks:', topList,
      ].filter(Boolean).join('\n');
      const btn = toolbar.querySelector('#bvg-export-btn');
      navigator.clipboard.writeText(lines).then(() => {
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.innerHTML = '&#128203; Copy Summary', 1500); }
      }).catch(() => {
        if (btn) { btn.textContent = 'Copy failed'; setTimeout(() => btn.innerHTML = '&#128203; Copy Summary', 2000); }
        console.warn('[BVG Scorer] Clipboard write denied — page may not be in a secure context');
      });
    });

    // JSON Export
    toolbar.querySelector('#bvg-export-json-btn')?.addEventListener('click', () => {
      const bs = _appRefs.bundleScores;
      const s = _appRefs.scored;
      const os = _appRefs.ownedSet;
      if (!bs || !s) return;
      const exportData = {
        metadata: {
          url: location.href,
          title: document.title || '',
          exportedAt: new Date().toISOString(),
          scorerVersion: SCRIPT_VERSION,
        },
        settings: clone(SETTINGS),
        bundle: {
          bundleRating: bs.bundleRating,
          depthRating: bs.depthRating,
          personalRating: bs.personalRating,
          dealQuality: bs.dealQuality,
          bundleCost: CURRENT_BUNDLE_COST,
          unownedMsrpSum: bs.unownedMsrpSum,
        },
        games: s.map(g => ({
          title: g.title,
          itemType: g.itemType,
          score: g.score ?? null,
          breakdown: g.breakdown ?? null,
          ratingPct: g.ratingPct,
          reviews: g.reviews,
          msrp: g.msrp,
          bundledTimes: g.bundledTimes,
          owned: os.has(g.title),
          wishlisted: g.wishlistedDOM,
          steamUrl: g.steamUrl || null,
        })),
      };
      const json = JSON.stringify(exportData, null, 2);
      const btn = toolbar.querySelector('#bvg-export-json-btn');
      navigator.clipboard.writeText(json).then(() => {
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.innerHTML = '{ } Export JSON', 1500); }
      }).catch(() => {
        if (btn) { btn.textContent = 'Copy failed'; setTimeout(() => btn.innerHTML = '{ } Export JSON', 2000); }
        console.warn('[BVG Scorer] Clipboard write denied — page may not be in a secure context');
      });
    });

    // Settings gear
    toolbar.querySelector('#bvg-settings-gear')?.addEventListener('click', () => {
      openSettingsModal();
    });

    app.appendChild(toolbar);
  }

  // ═══════════════════════════════════════
  // RENDER: SETTINGS MODAL
  // ═══════════════════════════════════════
  function openSettingsModal() {
    // Prevent duplicate modals
    if (document.querySelector('.bvg-modal-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'bvg-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'bvg-modal';
    modal.innerHTML = `
      <div class="bvg-modal-header">
        <h3>Scoring Settings</h3>
        <button class="bvg-modal-close" title="Close" aria-label="Close settings modal">&times;</button>
      </div>
      <div id="bvg-settings-panel">${buildSettingsHTML()}</div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    // Close on X button
    modal.querySelector('.bvg-modal-close')?.addEventListener('click', () => backdrop.remove());
    // Close on Escape
    const onEsc = (e) => {
      if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', onEsc); }
    };
    document.addEventListener('keydown', onEsc);

    // Event delegation on modal — survives innerHTML refreshes of the settings panel
    modal.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target) return;
      const id = target.id;

      if (id === 'bvg-settings-apply') {
        readSettingsFromPanel();
        backdrop.remove();
        run();
      } else if (id === 'bvg-settings-reset') {
        SETTINGS = clone(DEFAULT_SETTINGS);
        saveSettings(SETTINGS);
        backdrop.remove();
        run();
      } else if (id === 'bvg-preset-load') {
        const select = modal.querySelector('#bvg-preset-select');
        const name = select?.value;
        if (!name) return;
        const presets = loadPresets();
        if (!presets[name]) return;
        SETTINGS = { ...clone(DEFAULT_SETTINGS), ...presets[name], weights: { ...clone(DEFAULT_SETTINGS).weights, ...(presets[name].weights || {}) } };
        saveSettings(SETTINGS);
        const panel = modal.querySelector('#bvg-settings-panel');
        if (panel) panel.innerHTML = buildSettingsHTML();
        console.log(`[BVG Scorer] Loaded preset: "${name}"`);
      } else if (id === 'bvg-preset-save') {
        const nameInput = modal.querySelector('#bvg-preset-name');
        const name = nameInput?.value.trim();
        if (!name) { nameInput?.focus(); return; }
        readSettingsFromPanel();
        savePreset(name, SETTINGS);
        const panel = modal.querySelector('#bvg-settings-panel');
        if (panel) panel.innerHTML = buildSettingsHTML();
      } else if (id === 'bvg-preset-delete') {
        const select = modal.querySelector('#bvg-preset-select');
        const name = select?.value;
        if (!name) return;
        deletePreset(name);
        const panel = modal.querySelector('#bvg-settings-panel');
        if (panel) panel.innerHTML = buildSettingsHTML();
      }
    });
  }

  // ═══════════════════════════════════════
  // RENDER: CONTENT AREA (game grid)
  // ═══════════════════════════════════════
  function renderContent(app, scored, ownedSet, tiers) {
    const container = document.createElement('div');
    container.id = 'bvg-content';
    _appRefs.contentContainer = container;
    renderGameGrid(container, scored, ownedSet, tiers);
    app.appendChild(container);
  }

  // Targeted re-render for filter/sort changes (avoids full app rebuild)
  function reRenderContent() {
    const container = _appRefs.contentContainer;
    if (!container || !_appRefs.scored) return;
    renderGameGrid(container, _appRefs.scored, _appRefs.ownedSet, _appRefs.tiers);
    // Update toolbar active states for filters
    document.querySelector('#bvg-toggle-owned')?.classList.toggle('active', _gridState.hideOwned);
    document.querySelector('#bvg-toggle-dlc')?.classList.toggle('active', _gridState.hideDLC);
  }

  // Builds HTML for a single game card
  function buildCardHTML(g, rank, ownedSet) {
    const isOwned = ownedSet.has(g.title);
    const isDLC = g.itemType === 'dlc' || g.itemType === 'package';
    const isUnrated = g.breakdown.isUnrated;

    // Extract link from original row
    const titleA = g.tr.querySelector('a[href*="/i/"], a[href*="/game/"]');
    const href = titleA ? titleA.getAttribute('href') : '#';

    // Game image
    const imgHTML = g.imgSrc
      ? `<div class="bvg-card-img-wrap"><img class="bvg-card-img" src="${escHtml(g.imgSrc)}" alt="" loading="lazy"></div>`
      : '<div class="bvg-card-img-placeholder"></div>';

    // Tags — skip tier tag since tiers are now sections
    let tags = '';
    if (isOwned) tags += '<span class="bvg-card-tag tag-owned">Owned</span>';
    if (isDLC) tags += `<span class="bvg-card-tag tag-dlc">${g.itemType === 'package' ? 'Package' : 'DLC'}</span>`;
    if (isUnrated) tags += '<span class="bvg-card-tag tag-unrated">Unrated</span>';

    const cardClass = `bvg-card${isOwned ? ' bvg-card-owned' : ''}${isDLC ? ' bvg-card-dlc' : ''}`;
    const scoreClass = `bvg-card-score${isUnrated ? ' bvg-unrated' : ''}`;
    const scoreBgStyle = isUnrated ? '' : `background:${scoreBg(g.score)}`;
    const scoreLabel = isUnrated ? 'N/R' : g.score.toFixed(0);

    // Meta items
    const metaParts = [];
    if (g.ratingPct != null) metaParts.push(`<span>Rating <span class="bvg-cm-val bvg-cm-rating" style="color:${ratingColor(g.ratingPct)}">${g.ratingPct}%</span></span>`);
    if (g.reviews != null) metaParts.push(`<span>Reviews <span class="bvg-cm-val">${g.reviews.toLocaleString()}</span></span>`);
    if (g.bundledTimes != null) metaParts.push(`<span>Bundled <span class="bvg-cm-val">${g.bundledTimes}x</span></span>`);
    if (g.wishlistedDOM) metaParts.push('<span class="bvg-cm-wish">Wishlisted</span>');
    const metaHTML = metaParts.join('<span class="bvg-cm-sep">&middot;</span>');

    return `
      <div class="${cardClass}" data-bvg-title="${escHtml(g.title)}">
        ${imgHTML}
        <div class="bvg-card-body">
          <div class="bvg-card-title"><span class="bvg-card-rank">#${rank}</span><a href="${escHtml(href)}">${escHtml(g.title)}</a></div>
          <div class="bvg-card-meta">${metaHTML}</div>
          ${tags ? `<div class="bvg-card-tags">${tags}</div>` : ''}
        </div>
        <div class="bvg-card-right">
          ${g.steamUrl ? `<a class="bvg-card-steam" href="${escHtml(g.steamUrl)}" target="_blank" title="View on Steam">Steam</a>` : ''}
          <div class="${scoreClass}" style="${scoreBgStyle}" title="${escHtml(formatBreakdown(g.breakdown))}" role="img" aria-label="Score: ${scoreLabel}${isUnrated ? '' : ` (${scoreTierLabel(g.score)})`}">
            ${scoreLabel}
            ${isUnrated ? '' : `<div class="bvg-score-tier">${scoreTierLabel(g.score)}</div>`}
          </div>
          ${g.msrp != null ? `<span class="bvg-card-msrp">$${g.msrp.toFixed(2)}</span>` : ''}
        </div>
      </div>`;
  }

  function renderGameGrid(container, scored, ownedSet, tiers) {
    const st = _gridState;

    // Filter
    let filtered = [...scored];
    if (st.search) {
      const q = st.search.toLowerCase();
      filtered = filtered.filter(g => g.title.toLowerCase().includes(q));
    }
    if (st.hideOwned) filtered = filtered.filter(g => !ownedSet.has(g.title));
    if (st.hideDLC) filtered = filtered.filter(g => g.itemType === 'game');

    // Sort
    const sortFns = {
      score: (a, b) => b.score - a.score,
      title: (a, b) => a.title.localeCompare(b.title),
      rating: (a, b) => (b.ratingPct || 0) - (a.ratingPct || 0),
      reviews: (a, b) => (b.reviews || 0) - (a.reviews || 0),
      msrp: (a, b) => (b.msrp || 0) - (a.msrp || 0),
    };
    const sortFn = sortFns[st.sortKey] || sortFns.score;
    filtered.sort((a, b) => {
      const result = sortFn(a, b);
      return st.sortDir === 'asc' ? -result : result;
    });

    // Build tier lookup
    const tierMap = new Map();
    for (const t of tiers) {
      for (const gameRow of t.games) {
        tierMap.set(gameRow, t);
      }
    }

    const totalShown = filtered.length;
    const totalGames = scored.filter(g => g.itemType === 'game').length;

    // Tier subsection mode: group by tier when sorted by score (default) and not searching
    const useTierSections = tiers.length > 0 && st.sortKey === 'score' && !st.search;

    let contentHTML = '';
    let rank = 0;

    if (useTierSections) {
      // Group filtered games by tier
      const tierGroups = new Map();
      const ungrouped = [];
      for (const g of filtered) {
        const tier = tierMap.get(g.tr);
        if (tier) {
          if (!tierGroups.has(tier.name)) tierGroups.set(tier.name, { tier, games: [] });
          tierGroups.get(tier.name).games.push(g);
        } else {
          ungrouped.push(g);
        }
      }

      // Render each tier as its own section (in original tier order)
      for (const t of tiers) {
        const group = tierGroups.get(t.name);
        if (!group || group.games.length === 0) continue;

        const tierGames = group.games;
        const tierGamesScorable = tierGames.filter(g => g.itemType === 'game');
        const tierAvg = tierGamesScorable.length > 0
          ? tierGamesScorable.reduce((s, g) => s + g.score, 0) / tierGamesScorable.length : 0;
        const tierMsrp = tierGamesScorable.reduce((s, g) => s + (g.msrp || 0), 0);
        const fmtPrice = formatTierPrice(t, st.currency);
        const pricePerGame = t.price != null && tierGamesScorable.length > 0
          ? `$${(t.price / tierGamesScorable.length).toFixed(2)}/game` : '';
        const avgColor = ratingColor(tierAvg);

        // Build stat chips for the section header
        const statChips = [];
        statChips.push(`<span class="bvg-ts-stat-val">${tierGames.length}</span> game${tierGames.length !== 1 ? 's' : ''}`);
        statChips.push(`Avg <span class="bvg-ts-stat-val" style="color:${avgColor}">${tierAvg.toFixed(0)}</span>`);
        if (pricePerGame) statChips.push(`<span class="bvg-ts-stat-val">${pricePerGame}</span>`);
        statChips.push(`MSRP <span class="bvg-ts-stat-val">$${tierMsrp.toFixed(0)}</span>`);

        let cardsHTML = '';
        for (const g of tierGames) {
          rank++;
          cardsHTML += buildCardHTML(g, rank, ownedSet);
        }

        const tierLabel = escHtml(t.label || t.name);
        const priceStr = fmtPrice ? `<span class="bvg-ts-price">${escHtml(fmtPrice)}</span>` : '';

        contentHTML += `
          <div class="bvg-tier-section">
            <div class="bvg-tier-section-header">
              <div class="bvg-ts-left">${tierLabel} ${priceStr}</div>
              <div class="bvg-ts-stats">${statChips.join('<span style="color:#30363d;margin:0 2px">&middot;</span>')}</div>
            </div>
            <div class="bvg-cards">${cardsHTML}</div>
          </div>`;
      }

      // Render any ungrouped games
      if (ungrouped.length > 0) {
        let cardsHTML = '';
        for (const g of ungrouped) {
          rank++;
          cardsHTML += buildCardHTML(g, rank, ownedSet);
        }
        contentHTML += `<div class="bvg-cards">${cardsHTML}</div>`;
      }
    } else {
      // Flat grid (when sorting/searching — no tier grouping)
      let cardsHTML = '';
      for (const g of filtered) {
        rank++;
        cardsHTML += buildCardHTML(g, rank, ownedSet);
      }
      contentHTML = `<div class="bvg-cards">${cardsHTML}</div>`;
    }

    container.innerHTML = `
      ${contentHTML}
      <div class="bvg-cards-footer">Showing ${totalShown} of ${scored.length} items (${totalGames} games)</div>
    `;

    // Ownership toggle on card score click
    container.querySelectorAll('.bvg-card-score').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const card = el.closest('.bvg-card');
        const title = card?.dataset.bvgTitle;
        if (!title) return;
        const set = loadOwnedSet();
        if (set.has(title)) set.delete(title);
        else set.add(title);
        saveOwnedSet(set);
        run();
      });
    });

    // Preserve search focus after re-render
    if (_gridState.search) {
      const searchInput = document.querySelector('#bvg-search');
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    }
  }

  // ═══════════════════════════════════════
  // MAIN
  // ═══════════════════════════════════════
  function run() {
    console.log('[BVG Scorer] Scanning...');
    const table = findItemTable();
    if (!table) { console.warn('[BVG Scorer] No game table found.'); return; }
    const rows = findGameRows(table);
    if (!rows.length) { console.warn('[BVG Scorer] No game rows.'); return; }
    console.log(`[BVG Scorer] Found ${rows.length} games.`);

    // Detect tiers BEFORE any DOM modifications
    const tiers = detectTiers(table);
    if (tiers.length) console.log(`[BVG Scorer] Detected ${tiers.length} tier(s):`, tiers.map(t => t.name));
    CURRENT_BUNDLE_COST = detectBundleCost(table);
    console.log('[BVG Scorer] Bundle cost detected:', CURRENT_BUNDLE_COST);

    // Build owned set: merge DOM-detected + manually toggled
    const manualOwned = loadOwnedSet();
    const games = rows.map(tr => extractGame(tr));
    const ownedSet = new Set(manualOwned);
    for (const g of games) {
      if (g.ownedDOM) ownedSet.add(g.title);
    }
    const scored = games.map(g => {
      const { score, breakdown } = scoreGame(g);
      return { ...g, score, breakdown };
    });

    const bundleScores = computeBundleScores(scored, ownedSet);

    // Extract metadata from original page before hiding
    const metadata = extractBundleMetadata();

    // Create floating view toggle first so it's always available,
    // even if renderApp throws
    ensureViewFAB();

    // Hide original page and render custom app
    hideOriginalPage();
    renderApp(scored, ownedSet, tiers, bundleScores, metadata);

    // Apply page preference (modern by default, classic shows original page)
    const pagePref = loadPagePref();
    if (pagePref === 'classic') {
      setPage('classic');
    }
  }

  // ═══════════════════════════════════════
  // BOOTSTRAP
  // ═══════════════════════════════════════
  let _bvgObserver = null;
  function boot() {
    // Disconnect any previous observer to prevent duplicates on re-run
    if (_bvgObserver) {
      _bvgObserver.disconnect();
      _bvgObserver = null;
      console.log('[BVG Scorer] Cleaned up previous MutationObserver');
    }
    try { run(); } catch (e) { console.error('[BVG Scorer] Error:', e); }
    let debounce = null;
    _bvgObserver = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!document.querySelector('#bvg-app')) {
          try { run(); } catch (e) { console.error('[BVG Scorer] Rerun error:', e); }
        }
      }, 400);
    });
    _bvgObserver.observe(document.body, { childList: true, subtree: true });
  }
  boot();
})();
