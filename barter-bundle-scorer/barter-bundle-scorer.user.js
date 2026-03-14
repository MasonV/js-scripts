// ==UserScript==
// @name         Barter.vg Bundle Scorer
// @namespace    https://tampermonkey.net/
// @version      5.2.0
// @description  Per-game scoring with DLC/package handling, side evaluation panel, normalized bundle ratings, all-column sorting, owned detection, and settings for Barter.vg bundle pages.
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
  const SCRIPT_VERSION = '5.2.0';
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
    // Insert into the side banner if it exists, otherwise before the table
    const anchor = document.getElementById('bvg-scorer-banner') || document.getElementById('bvg-modern-panel');
    if (!anchor) return;
    const banner = document.createElement('div');
    banner.className = 'bvg-update-banner';
    banner.innerHTML = `
      <span>Update available: <strong>v${SCRIPT_VERSION}</strong> → <strong>v${remoteVersion}</strong>
        — <a href="${downloadURL}" target="_blank">Install update</a></span>
      <button class="bvg-update-dismiss" title="Dismiss">&times;</button>
    `;
    banner.querySelector('.bvg-update-dismiss').addEventListener('click', () => banner.remove());
    anchor.parentElement.insertBefore(banner, anchor);
  }

  // Fire update check immediately on load
  checkForUpdate();

  // ═══════════════════════════════════════
  // STYLES (GM_addStyle bypasses CSP)
  // ═══════════════════════════════════════
  GM_addStyle(`
    /* ── Layout: use full width + room for side panel ── */
    html, body { max-width: none !important; }
    body { padding-right: 360px !important; }
    .container, .container-fluid, .wrap, main {
      width: 100% !important;
      max-width: none !important;
    }

    /* ── Table layout: widen title column ── */
    table.collection { table-layout: auto !important; width: 100% !important; }
    table.collection th.cTitles,
    table.collection td:nth-child(3) {
      width: auto !important;
      min-width: 200px;
    }
    /* ── Banner ── */
    #bvg-scorer-banner {
      position: fixed;
      top: 14px;
      right: 14px;
      width: 332px;
      z-index: 9999;
      background: linear-gradient(180deg, #0d1117 0%, #111820 100%);
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 12px 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px; line-height: 1.5;
      color: #c9d1d9;
      box-shadow: 0 2px 12px rgba(0,0,0,.4);
      max-height: calc(100vh - 28px);
      overflow: auto;
    }
    #bvg-scorer-banner strong { color: #e6edf3; }
    #bvg-scorer-banner .bvg-row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    /* ── Stat badges ── */
    #bvg-scorer-banner .bvg-stat {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 5px 14px;
      display: flex; align-items: center; gap: 8px;
      position: relative;
      overflow: hidden;
    }
    #bvg-scorer-banner .bvg-stat .bvg-score-bar {
      position: absolute; left: 0; bottom: 0;
      height: 3px;
      border-radius: 0 0 8px 8px;
      transition: width .3s ease;
    }
    #bvg-scorer-banner .bvg-stat .bvg-score-num {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.5px;
      font-variant-numeric: tabular-nums;
    }
    #bvg-scorer-banner .bvg-stat .bvg-score-denom {
      font-size: 11px; opacity: .45; font-weight: 400;
    }
    #bvg-scorer-banner .bvg-stat .bvg-score-label {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: .5px; opacity: .55; font-weight: 600;
    }
    #bvg-scorer-banner .bvg-picks {
      margin-top: 8px; font-size: 12px; line-height: 1.55;
    }
    #bvg-scorer-banner .bvg-picks strong { margin-right: 4px; }
    #bvg-scorer-banner .bvg-pick-name {
      font-weight: 600;
    }
    #bvg-scorer-banner .bvg-pick-score {
      opacity: .45; font-size: 11px; font-weight: 400;
    }
    #bvg-scorer-banner .bvg-meta {
      opacity: .55; margin-top: 8px; font-size: 10px;
      letter-spacing: .2px;
    }
    #bvg-scorer-banner .bvg-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .7px;
      color: #8b949e;
      margin-bottom: 8px;
    }
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
    .bvg-update-banner a {
      color: #58a6ff;
      font-weight: 600;
      text-decoration: none;
    }
    .bvg-update-banner a:hover { text-decoration: underline; }
    .bvg-update-dismiss {
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
    }
    /* ── Score cells ── */
    td.bvg-score-cell {
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      padding: 6px 10px !important;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      text-align: center;
      border-radius: 4px;
      transition: opacity .15s, transform .1s;
      color: #fff;
      font-size: 14px;
      letter-spacing: -0.3px;
      min-width: 38px;
      text-shadow: 0 1px 2px rgba(0,0,0,.4);
      vertical-align: middle;
    }
    td.bvg-score-cell:hover {
      opacity: .85;
      transform: scale(1.03);
    }
    td.bvg-score-cell.bvg-owned {
      background: #1a1e24 !important;
      color: #555d68 !important;
      text-decoration: line-through;
      text-shadow: none;
    }
    td.bvg-score-cell.bvg-dlc {
      background: #1a1e24 !important;
      color: #555d68 !important;
      font-size: 11px !important;
      font-weight: 400 !important;
      text-shadow: none;
      opacity: .6;
    }
    /* ── Score header ── */
    th.bvg-score-header {
      min-width: 42px;
      text-align: center;
    }
    /* ── Sortable headers ── */
    th.bvg-sortable { cursor: pointer; user-select: none; }
    th.bvg-sortable:hover { text-decoration: underline; }
    .bvg-sort-ind {
      font-size: 14px;
      font-weight: 700;
      margin-left: 2px;
      vertical-align: middle;
      opacity: .8;
    }
    /* ── Tier labels (inline beside game title) ── */
    .bvg-tier-label {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      color: #8b949e;
      background: #21262d;
      border-radius: 4px;
      padding: 1px 6px;
      margin-left: 6px;
      vertical-align: middle;
    }
    /* ── Split review cells ── */
    .bvg-review-cell {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      text-align: center;
      padding: 4px 8px !important;
    }
    .bvg-review-header {
      text-align: center;
      min-width: 50px;
    }
    /* ── Tier section in banner ── */
    #bvg-scorer-banner .bvg-tiers {
      margin-top: 8px;
      font-size: 12px;
      line-height: 1.55;
    }
    #bvg-scorer-banner .bvg-tier-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      border-bottom: 1px solid #21262d;
    }
    #bvg-scorer-banner .bvg-tier-price {
      font-weight: 700;
      color: #58a6ff;
    }
    /* ── Settings panel ── */
    #bvg-settings-panel {
      display: none;
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 10px;
      padding: 16px 20px;
      margin-top: 10px;
      font-size: 12px;
    }
    #bvg-settings-panel.open { display: block; }
    #bvg-settings-panel label {
      display: flex; align-items: center; gap: 10px;
      margin: 6px 0; color: #8b949e;
    }
    #bvg-settings-panel input[type="number"] {
      width: 58px;
      background: #161b22; color: #c9d1d9;
      border: 1px solid #30363d; border-radius: 5px;
      padding: 3px 7px; font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    #bvg-settings-panel input[type="number"]:focus {
      outline: none; border-color: #58a6ff;
    }
    #bvg-settings-panel input[type="checkbox"] { accent-color: #58a6ff; }
    .bvg-settings-btn {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      padding: 5px 14px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      transition: all .15s;
    }
    .bvg-settings-btn:hover {
      color: #e6edf3;
      border-color: #58a6ff;
      background: #1a2332;
    }

    /* ── Modern Panel ── */
    #bvg-modern-panel {
      max-width: calc(100% - 380px);
      margin: 16px auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #c9d1d9;
    }
    /* ── View toggle (always inside modern panel wrapper) ── */
    .bvg-view-toggle {
      display: inline-flex;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 14px;
    }
    .bvg-view-toggle button {
      background: transparent;
      border: none;
      color: #8b949e;
      padding: 7px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all .15s;
      -webkit-appearance: none;
      appearance: none;
    }
    .bvg-view-toggle button.active {
      background: #21262d;
      color: #e6edf3;
    }
    .bvg-view-toggle button:hover:not(.active) {
      color: #c9d1d9;
    }
    /* ── Filter bar ── */
    .bvg-filter-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    .bvg-filter-bar input[type="text"] {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #c9d1d9;
      padding: 6px 12px;
      font-size: 13px;
      width: 220px;
    }
    .bvg-filter-bar input[type="text"]:focus { outline: none; border-color: #58a6ff; }
    .bvg-filter-bar select {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #c9d1d9;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .bvg-filter-chip {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all .15s;
      -webkit-appearance: none;
      appearance: none;
    }
    .bvg-filter-chip:hover, .bvg-filter-chip.active {
      color: #e6edf3;
      border-color: #58a6ff;
      background: #1a2332;
    }
    /* ── Game cards ── */
    .bvg-cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bvg-card {
      display: grid;
      grid-template-columns: 120px 1fr auto;
      gap: 0;
      align-items: stretch;
      background: #0d1117;
      border: 1px solid #1f2937;
      border-radius: 10px;
      overflow: hidden;
      transition: border-color .15s, background .15s;
    }
    .bvg-card:hover {
      border-color: #30363d;
      background: #111820;
    }
    .bvg-card.bvg-card-owned {
      opacity: .5;
    }
    .bvg-card.bvg-card-dlc {
      opacity: .45;
      border-style: dashed;
    }
    .bvg-card-img-wrap {
      position: relative;
      overflow: hidden;
      background: #161b22;
      min-height: 56px;
    }
    .bvg-card-img {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .bvg-card-img-placeholder {
      min-height: 56px;
      background: #161b22;
    }
    .bvg-card-body {
      min-width: 0;
      padding: 8px 14px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .bvg-card-title {
      font-size: 14px;
      font-weight: 600;
      color: #e6edf3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bvg-card-title a { color: inherit; text-decoration: none; }
    .bvg-card-title a:hover { text-decoration: underline; }
    .bvg-card-rank {
      font-size: 11px;
      font-weight: 700;
      color: #8b949e;
      margin-right: 6px;
      letter-spacing: .3px;
    }
    .bvg-card-meta {
      font-size: 11px;
      color: #8b949e;
      margin-top: 3px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .bvg-card-meta .bvg-cm-val {
      color: #c9d1d9;
      font-weight: 600;
    }
    .bvg-card-meta .bvg-cm-wish {
      color: #58a6ff;
      font-weight: 600;
    }
    .bvg-card-meta .bvg-cm-sep {
      color: #30363d;
      font-size: 10px;
    }
    .bvg-card-tags {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .bvg-card-tag {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 4px;
      background: #21262d;
      color: #8b949e;
    }
    .bvg-card-tag.tag-owned { background: #1d2b1d; color: #3fb950; }
    .bvg-card-tag.tag-dlc { background: #2b221d; color: #d29922; }
    .bvg-card-tag.tag-unrated { background: #2d333b; color: #8b949e; }
    .bvg-card-right {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 16px;
      white-space: nowrap;
    }
    .bvg-card-score {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 20px;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.5);
      cursor: pointer;
      user-select: none;
      transition: transform .1s;
      flex-shrink: 0;
      letter-spacing: -0.5px;
    }
    .bvg-card-score:hover { transform: scale(1.08); }
    .bvg-card-score.bvg-unrated {
      background: #2d333b !important;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0;
      text-shadow: none;
      color: #8b949e;
    }
    .bvg-card-msrp {
      font-weight: 600;
      font-size: 12px;
      color: #8b949e;
    }
    /* ── Tier divider in card view ── */
    .bvg-tier-divider {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 8px 16px;
      margin: 6px 0 2px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 700;
      color: #e6edf3;
    }
    .bvg-tier-divider .bvg-td-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .bvg-tier-divider .bvg-td-price {
      color: #58a6ff;
      font-weight: 700;
    }
    .bvg-tier-divider .bvg-td-stats {
      font-size: 11px;
      font-weight: 400;
      color: #8b949e;
    }
    /* ── Card count footer ── */
    .bvg-cards-footer {
      text-align: center;
      color: #8b949e;
      font-size: 11px;
      padding: 10px 0;
    }

    /* ── Responsive: 2-column cards on wide screens ── */
    @media (min-width: 1600px) {
      .bvg-cards {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      .bvg-tier-divider {
        grid-column: 1 / -1;
      }
    }
    @media (min-width: 2200px) {
      .bvg-cards {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    @media (max-width: 1300px) {
      body { padding-right: 0 !important; }
      #bvg-scorer-banner {
        position: sticky;
        top: 0;
        right: auto;
        width: auto;
        max-height: none;
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }
      #bvg-scorer-banner .bvg-row {
        grid-template-columns: repeat(2, minmax(120px, 1fr));
      }
      #bvg-modern-panel { max-width: 100%; padding: 0 8px; }
    }
    /* ── Mobile: compact cards ── */
    @media (max-width: 600px) {
      .bvg-card {
        grid-template-columns: 80px 1fr auto;
      }
      .bvg-card-img-wrap { width: 80px; }
      .bvg-card-img-placeholder { width: 80px; }
    }
  `);
  // ═══════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════
  const STORAGE_KEY_OWNED    = 'bvg_scorer_owned_v2';
  const STORAGE_KEY_SETTINGS = 'bvg_scorer_settings_v2';
  const DEFAULT_SETTINGS = {
    useWilsonAdjustedRating: false,
    topNMain: 5, topNDepth: 10,
    msrpCap: 39.99, bundledPenaltyCap: 10, confidenceAnchor: 800,
    weights: { rating: 0.55, confidence: 0.20, value: 0.20, bundleValue: 0.15, wishlist: 0.08, rebundlePenalty: 0.20 },
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
  function saveSettings(s) { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s)); }
  let SETTINGS = loadSettings();
  let CURRENT_BUNDLE_COST = null;
  // Column injection counts per row type:
  // Score column (+1) uses rowspan=2 so bargraph rows don't need adjustment for it.
  // Review split: original hidden + 2 new = net +1.
  const EXTRA_COLS_BARGRAPH = 1; // review split only (Score handled by rowspan)
  const EXTRA_COLS_OTHER    = 2; // Score + review split
  // ═══════════════════════════════════════
  // MATH
  // ═══════════════════════════════════════
  const clamp01 = x => Math.max(0, Math.min(1, x));
  // Prevent XSS when interpolating DOM-sourced strings into innerHTML templates
  const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function confidenceFromReviews(n) {
    if (!n || n <= 0) return 0;
    return clamp01(n / (n + SETTINGS.confidenceAnchor));
  }
  function wilsonLowerBound(p, n) {
    if (!n || n <= 0) return 0;
    const z = 1.96, z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const adj = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return clamp01((centre - adj) / denom);
  }
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
  function saveOwnedSet(s) { localStorage.setItem(STORAGE_KEY_OWNED, JSON.stringify([...s])); }
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
  // ROW PAIRING
  //
  // Barter.vg often uses rowspan=2 on the
  // image cell, meaning each game spans TWO
  // <tr> elements. The first <tr> has the
  // game link; the second <tr> is a "child"
  // row with additional data.
  //
  // We detect this by checking if any cell
  // in a game row has rowspan > 1. If so,
  // the next sibling <tr> is its pair.
  //
  // When sorting, we must move both rows
  // together as a unit.
  // ═══════════════════════════════════════
  function getRowGroup(tr) {
    // Each game row on barter.vg is followed by a bargraph row
    // (td.bargraphs with colspan). The image cell has rowspan=2
    // spanning both rows. We must move them together.
    const sibling = tr.nextElementSibling;
    if (sibling && sibling.tagName === 'TR') {
      const type = classifyRow(sibling);
      if (type === ROW_BARGRAPH || type === ROW_OTHER) {
        return [tr, sibling];
      }
      // Also catch by checking for bargraphs class directly
      if (sibling.querySelector('td.bargraphs')) {
        return [tr, sibling];
      }
    }
    return [tr];
  }
  // Build groups: array of { rows: [tr, ...], score: number, primaryTr: tr }
  function buildGameGroups(table) {
    const tbody = table.querySelector('tbody') || table;
    const allTrs = [...tbody.querySelectorAll('tr')];
    const visited = new Set();
    const groups = [];
    for (const tr of allTrs) {
      if (visited.has(tr)) continue;
      if (classifyRow(tr) !== ROW_GAME) continue;
      const group = getRowGroup(tr);
      group.forEach(r => visited.add(r));
      groups.push({
        rows: group,
        primaryTr: tr,
      });
    }
    return groups;
  }
  // ═══════════════════════════════════════
  // TIER DETECTION
  //
  // Barter.vg tiered bundles use "tier" rows
  // to separate groups of games. We walk the
  // table in order and tag each game row with
  // its tier name and price.
  // ═══════════════════════════════════════
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
        currentTier = {
          name: text.substring(0, 80),
          label: label || text.substring(0, 40),
          price: priceMatch ? parseFloat(priceMatch[1]) : null,
          prices: prices,
          tr: tr,
          games: [],
        };
        tiers.push(currentTier);
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
    // Barter.vg marks owned games with: <a class="libr" title="in library">📚</a>
    if (tr.querySelector('a.libr[title="in library"]')) return true;
    // Fallback: any 📚 in the row
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
  // so they can be excluded from bundle score calculations
  const DLC_KEYWORDS = /\b(soundtrack|ost|artbook|art\s*book|wallpaper|skin\s*pack|costume|dlc|season\s*pass|expansion|bonus\s*content|digital\s*deluxe|deluxe\s*edition|collector[''\u2019]?s\s*edition|upgrade)\b/i;
  function classifyItem(title, tr, ratingPct, reviews) {
    const titleLower = title.toLowerCase();
    // DLC/soundtrack/artbook: match by title keywords
    if (DLC_KEYWORDS.test(titleLower)) {
      // Exception: if it has substantial reviews, it might be a real game
      // with "Deluxe Edition" in the name (like a GOTY edition)
      // Only flag as DLC if reviews are very low or missing
      if (reviews && reviews > 100) return 'game';
      return 'dlc';
    }
    // Package sub-item indicator: check if the row is inside a
    // "^ N item package" group. These rows follow a tier-like
    // label containing "item package"
    // We detect this by checking previous sibling rows
    let prev = tr.previousElementSibling;
    let depth = 0;
    while (prev && depth < 5) {
      const text = prev.textContent.trim().toLowerCase();
      if (/\d+\s*item\s*package/.test(text)) {
        // This game is inside a package — it's a sub-item
        // The main game in the package has reviews; DLC won't
        if (!reviews || reviews < 10) return 'dlc';
        return 'game'; // It's the actual game inside the package
      }
      // Stop if we hit a tier header or another game with a bargraph
      if (prev.querySelector('td.bargraphs') || prev.querySelector('td.tierLine')) break;
      prev = prev.previousElementSibling;
      depth++;
    }
    // Package parent: has price but no reviews (it's a Steam sub, not an app)
    if (!ratingPct && !reviews) return 'package';
    return 'game';
  }
  function extractGame(tr) {
    const titleA = tr.querySelector('a[href*="/i/"], a[href*="/game/"]');
    const title = titleA ? titleA.textContent.trim() : 'Unknown';
    const cells = [...tr.querySelectorAll('td')];
    let msrp = null, bundledTimes = null, reviews = null, ratingPct = null;
    let reviewCell = null; // DOM reference for review/rating split
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
        reviewCell = cells[i]; // track the combined cell for splitting
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
          if (sorted[1] <= 100) {
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
    // Extract game thumbnail image from the row
    const imgEl = tr.querySelector('img[src*="steam"], img[src*="cdn"], img[src*="capsule"], img[src*="header"]')
      || tr.querySelector('img');
    const imgSrc = imgEl ? imgEl.src : null;
    console.log(`[BVG] ${title}: type=${itemType} wish=${wishlistedDOM} rating=${ratingPct}% reviews=${reviews} msrp=${msrp} bundled=${bundledTimes}`);
    return { title, ratingPct, reviews, msrp, bundledTimes, ownedDOM, wishlistedDOM, itemType, tr, reviewCell, imgSrc };
  }
  // ═══════════════════════════════════════
  // SCORING
  // ═══════════════════════════════════════
  function scoreGame(g) {
    // Unrated games (no rating AND no reviews) get a neutral midpoint for
    // rating/confidence so they aren't unfairly tanked to near-zero. They
    // are then scored primarily by value and MSRP.
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
    // Normalize positive weights to sum to 1.0 so scores map cleanly to 0-100
    const posSum = w.rating + w.confidence + w.value + w.bundleValue + w.wishlist;
    const n = posSum > 0 ? posSum : 1;
    const raw = (w.rating / n) * rating + (w.confidence / n) * conf + (w.value / n) * val + (w.bundleValue / n) * bundleValue + (w.wishlist / n) * wishlistBonus - w.rebundlePenalty * pen;
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
    // Only count actual games for bundle ratings (exclude DLC, soundtracks, packages)
    const scorable = scored.filter(g => g.itemType === 'game');
    const sorted = [...scorable].sort((a, b) => b.score - a.score);
    const topMain  = sorted.slice(0, SETTINGS.topNMain);
    const topDepth = sorted.slice(0, SETTINGS.topNDepth);
    const personal = sorted.filter(g => !ownedSet.has(g.title));
    const personalTop = personal.slice(0, SETTINGS.topNMain);
    const avg = (arr) => arr.length > 0 ? arr.reduce((s, g) => s + g.score, 0) / arr.length : 0;
    // Deal quality: total MSRP of unowned games / bundle cost
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
  // BANNER
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
      // Clamp to the input's own min/max HTML attributes when present
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
    return `<div style="margin:8px 0;max-width:260px;">${bars}</div>`;
  }
  function renderBanner({ bundleRating, depthRating, personalRating, picks, ownedCount, gameCount, dlcCount, wishCount, tiers, scored, dealQuality, unownedMsrpSum }) {
    let banner = document.getElementById('bvg-scorer-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'bvg-scorer-banner';
      document.body.prepend(banner);
    }
    const statBadge = (label, rating, detail) => {
      const c = ratingColor(rating);
      return `<div class="bvg-stat">
        <div>
          <div class="bvg-score-label">${label}</div>
          <div><span class="bvg-score-num" style="color:${c}">${rating.toFixed(0)}</span><span class="bvg-score-denom">/100</span></div>
          <div class="bvg-score-label">${detail}</div>
        </div>
        <div class="bvg-score-bar" style="width:${rating}%;background:${c}"></div>
      </div>`;
    };
    const picksText = picks
      .map(p => `<span class="bvg-pick-name" style="color:${scoreColor(p.score)}">${escHtml(p.title)}</span> <span class="bvg-pick-score">${p.score.toFixed(1)}</span>`)
      .join(' &middot; ');
    // Per-tier scoring: compute average score for games in each tier
    const tierHTML = (tiers && tiers.length > 0) ? `
      <div class="bvg-title" style="margin-top:10px">Tier Scoring</div>
      <div class="bvg-tiers">
        ${tiers.map(t => {
          const tierGames = (scored || []).filter(g => g.itemType === 'game' && g.tr && g.tr.dataset.bvgTier === t.name);
          const tierAvg = tierGames.length > 0 ? tierGames.reduce((s, g) => s + g.score, 0) / tierGames.length : 0;
          const tierTop = tierGames.length > 0 ? Math.max(...tierGames.map(g => g.score)) : 0;
          const color = ratingColor(tierAvg);
          return `<div class="bvg-tier-row">
            <span>${escHtml(t.name)}</span>
            <span>${t.price != null ? '<span class="bvg-tier-price">$' + t.price.toFixed(2) + '</span>' : ''} (${tierGames.length} games) &middot; Avg: <strong style="color:${color}">${tierAvg.toFixed(0)}</strong> &middot; Best: ${tierTop.toFixed(0)}</span>
          </div>`;
        }).join('')}
      </div>` : '';
    banner.innerHTML = `
      <div class="bvg-title">Bundle Evaluation v${SCRIPT_VERSION}</div>
      <div class="bvg-row">
        ${statBadge('Bundle', bundleRating, `top ${SETTINGS.topNMain}`)}
        ${statBadge('Depth', depthRating, `top ${SETTINGS.topNDepth}`)}
        ${statBadge('Personal', personalRating, `excl. owned`)}
        <button class="bvg-settings-btn" id="bvg-export-btn">&#128203; Copy Summary</button>
        <button class="bvg-settings-btn" id="bvg-settings-toggle">&#9881; Settings</button>
      </div>
      <div class="bvg-picks"><strong>Top picks:</strong> ${picksText || 'n/a'}</div>
      ${buildHistogramHTML(scored)}
      <div class="bvg-meta">
        ${ownedCount} of ${gameCount} games owned${dlcCount > 0 ? ` &middot; ${dlcCount} DLC/extras excluded` : ''} &middot; Click any score to toggle owned &middot;
        ${wishCount} wishlisted${CURRENT_BUNDLE_COST ? ` &middot; Bundle cost detected: $${CURRENT_BUNDLE_COST.toFixed(2)}` : ''}
        ${dealQuality != null ? ` &middot; <strong>Deal: ${dealQuality.toFixed(1)}x</strong> ($${unownedMsrpSum.toFixed(0)} unowned MSRP)` : ''} &middot;
        Rating: ${SETTINGS.useWilsonAdjustedRating ? 'Wilson-adjusted' : 'Raw % (confidence-weighted)'}
      </div>
      ${tierHTML}
      <div id="bvg-settings-panel">${buildSettingsHTML()}</div>
    `;
    document.getElementById('bvg-settings-toggle')
      ?.addEventListener('click', () => {
        document.getElementById('bvg-settings-panel')?.classList.toggle('open');
      });
    document.getElementById('bvg-settings-apply')?.addEventListener('click', () => {
      readSettingsFromPanel(); clearScoreCells(); run();
    });
    document.getElementById('bvg-settings-reset')?.addEventListener('click', () => {
      SETTINGS = clone(DEFAULT_SETTINGS); saveSettings(SETTINGS); clearScoreCells(); run();
    });
    document.getElementById('bvg-export-btn')?.addEventListener('click', () => {
      const topList = picks.map((p, i) => `${i + 1}. ${p.title} (${p.score.toFixed(1)})`).join('\n');
      const lines = [
        `Bundle Evaluation — ${document.title || location.href}`,
        `Bundle: ${bundleRating.toFixed(0)}/100 | Depth: ${depthRating.toFixed(0)}/100 | Personal: ${personalRating.toFixed(0)}/100`,
        `${ownedCount}/${gameCount} owned | ${wishCount} wishlisted${dlcCount > 0 ? ` | ${dlcCount} DLC excluded` : ''}`,
        dealQuality != null ? `Deal quality: ${dealQuality.toFixed(1)}x ($${unownedMsrpSum.toFixed(0)} unowned MSRP / $${CURRENT_BUNDLE_COST.toFixed(2)})` : '',
        '', 'Top Picks:', topList,
      ].filter(Boolean).join('\n');
      const btn = document.getElementById('bvg-export-btn');
      navigator.clipboard.writeText(lines).then(() => {
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.innerHTML = '&#128203; Copy Summary', 1500); }
      }).catch(() => {
        if (btn) { btn.textContent = 'Copy failed'; setTimeout(() => btn.innerHTML = '&#128203; Copy Summary', 2000); }
        console.warn('[BVG Scorer] Clipboard write denied — page may not be in a secure context');
      });
    });
  }
  // ═══════════════════════════════════════
  // SCORE COLUMN + COLSPAN FIXUP
  // ═══════════════════════════════════════
  function ensureScoreHeader(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow || headerRow.querySelector('.bvg-score-header')) return;

    const th = document.createElement('th');
    th.textContent = 'Score';
    th.className = 'bvg-score-header bvg-sortable';
    const ind = document.createElement('span');
    ind.className = 'bvg-sort-ind';
    th.appendChild(ind);
    // Insert after the first cell (checkbox column) to keep it pinned left.
    // If the first cell has colspan > 1 (e.g. Barter's "Select All" spans
    // checkbox + title), shrink it by 1 so our new Score column aligns with
    // the Score data cells that are inserted at the same position in data rows.
    const firstCell = headerRow.querySelector('th, td');
    if (firstCell) {
      if (firstCell.colSpan > 1) {
        firstCell.dataset.bvgOrigColspan = firstCell.colSpan;
        firstCell.colSpan -= 1;
      }
      firstCell.insertAdjacentElement('afterend', th);
    } else {
      headerRow.prepend(th);
    }
    th.addEventListener('click', () => sortByScore(table, ind));
  }
  // Fix tier headers and summary rows: bump their colspan or add spacer cells.
  // Bargraph rows are paired with game rows via rowspan on Score, so they only
  // need adjustment for the review column split (+1). All other non-game rows
  // need +2 (Score column + review split).
  function fixNonGameRows(table) {
    const allRows = [...table.querySelectorAll('tr')];
    for (const tr of allRows) {
      const type = classifyRow(tr);
      if (type === ROW_HEADER || type === ROW_GAME) continue;
      if (tr.querySelector('.bvg-spacer')) continue; // already fixed
      const extraCols = (type === ROW_BARGRAPH) ? EXTRA_COLS_BARGRAPH : EXTRA_COLS_OTHER;
      const firstCell = tr.querySelector('td');
      if (firstCell && firstCell.colSpan > 1) {
        firstCell.colSpan += extraCols;
        firstCell.classList.add('bvg-spacer');
      } else {
        if (type === ROW_BARGRAPH) {
          // Bargraph: only needs review-split spacer (Score handled by rowspan)
          const spacer = document.createElement('td');
          spacer.className = 'bvg-spacer';
          tr.appendChild(spacer);
        } else {
          // Score spacer — insert after first cell to match Score column position
          const scoreSpace = document.createElement('td');
          scoreSpace.className = 'bvg-spacer';
          if (firstCell) firstCell.insertAdjacentElement('afterend', scoreSpace);
          else tr.prepend(scoreSpace);
          // Review-split spacer — append at end
          const reviewSpace = document.createElement('td');
          reviewSpace.className = 'bvg-spacer';
          tr.appendChild(reviewSpace);
        }
      }
    }
  }
  function clearScoreCells() {
    // Restore header colspan that was decremented for Score column alignment
    document.querySelectorAll('[data-bvg-orig-colspan]').forEach(el => {
      el.colSpan = parseInt(el.dataset.bvgOrigColspan);
      delete el.dataset.bvgOrigColspan;
    });
    // Restore original review cells that were hidden during split
    document.querySelectorAll('.bvg-review-original').forEach(el => {
      el.style.display = '';
      el.classList.remove('bvg-review-original');
    });
    // Restore original review header
    document.querySelectorAll('.bvg-review-header-original').forEach(el => {
      el.style.display = '';
      el.classList.remove('bvg-review-header-original');
    });
    // Remove all injected elements
    document.querySelectorAll('.bvg-score-cell, .bvg-score-header, .bvg-review-cell, .bvg-review-header, .bvg-spacer, .bvg-tier-label').forEach(el => el.remove());
    // Clear labeled headers
    document.querySelectorAll('[data-bvg-labeled]').forEach(el => {
      delete el.dataset.bvgLabeled;
    });
    // Clear tier data attributes
    document.querySelectorAll('[data-bvg-tier]').forEach(el => {
      delete el.dataset.bvgTier;
      delete el.dataset.bvgTierPrice;
    });
  }
  function ensureScoreCells(scoredGames, ownedSet) {
    for (const g of scoredGames) {
      const tr = g.tr;
      if (tr.querySelector('.bvg-score-cell')) continue;
      const td = document.createElement('td');
      td.className = 'bvg-score-cell';
      td.dataset.score = String(g.score);
      td.textContent = g.score.toFixed(1);
      td.title = formatBreakdown(g.breakdown);
      // Span both game row and its paired bargraph row to prevent double-row cell
      const group = getRowGroup(tr);
      if (group.length > 1) td.rowSpan = 2;
      const owned = ownedSet.has(g.title);
      const isDLC = g.itemType === 'dlc' || g.itemType === 'package';
      if (owned) {
        td.classList.add('bvg-owned');
      } else if (isDLC) {
        td.classList.add('bvg-dlc');
      } else {
        td.style.background = scoreBg(g.score);
      }
      td.addEventListener('click', () => {
        const set = loadOwnedSet();
        if (set.has(g.title)) set.delete(g.title);
        else set.add(g.title);
        saveOwnedSet(set);
        clearScoreCells();
        run();
      });
      if (g.wishlistedDOM) td.title += '\nWishlisted: yes';
      // Insert after the first cell (checkbox) to keep it pinned left
      const firstCell = tr.querySelector('td');
      if (firstCell) firstCell.insertAdjacentElement('afterend', td);
      else tr.prepend(td);
    }
  }
  // ═══════════════════════════════════════
  // REVIEW COLUMN SPLIT
  //
  // Barter.vg combines review count and
  // rating % in a single cell. We hide the
  // original and insert two distinct columns.
  // ═══════════════════════════════════════
  function splitReviewColumn(table, scoredGames) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    // Split the header: find the review/rating th
    if (headerRow && !headerRow.querySelector('.bvg-review-header')) {
      const ths = [...headerRow.querySelectorAll('th, td')];
      let reviewTh = null;
      for (const th of ths) {
        const text = th.textContent.toLowerCase();
        if ((text.includes('review') || text.includes('rating') || text.includes('score')) &&
            !th.classList.contains('bvg-score-header')) {
          reviewTh = th;
          break;
        }
      }
      // Fallback: find header by column index of first game's review cell
      if (!reviewTh) {
        const firstGame = scoredGames.find(g => g.reviewCell);
        if (firstGame) {
          const dataCells = [...firstGame.tr.querySelectorAll('td')];
          const colIdx = dataCells.indexOf(firstGame.reviewCell);
          if (colIdx >= 0 && colIdx < ths.length) {
            const candidate = ths[colIdx];
            if (candidate && !candidate.classList.contains('bvg-score-header')) {
              reviewTh = candidate;
            }
          }
        }
      }
      if (reviewTh) {
        reviewTh.style.display = 'none';
        reviewTh.classList.add('bvg-review-header-original');
        const countTh = document.createElement('th');
        countTh.textContent = '#';
        countTh.className = 'bvg-review-header bvg-sortable';
        const countInd = document.createElement('span');
        countInd.className = 'bvg-sort-ind';
        countTh.appendChild(countInd);
        const ratingTh = document.createElement('th');
        ratingTh.textContent = 'Rating';
        ratingTh.className = 'bvg-review-header bvg-sortable';
        const ratingInd = document.createElement('span');
        ratingInd.className = 'bvg-sort-ind';
        ratingTh.appendChild(ratingInd);
        reviewTh.insertAdjacentElement('afterend', ratingTh);
        reviewTh.insertAdjacentElement('afterend', countTh);
      }
    }
    // Split each game row's review cell
    for (const g of scoredGames) {
      const tr = g.tr;
      if (tr.querySelector('.bvg-review-cell')) continue;
      if (!g.reviewCell) continue;
      // Hide original combined cell
      g.reviewCell.style.display = 'none';
      g.reviewCell.classList.add('bvg-review-original');
      const countTd = document.createElement('td');
      countTd.className = 'bvg-review-cell';
      countTd.textContent = g.reviews != null ? g.reviews.toLocaleString() : '\u2014';
      const ratingTd = document.createElement('td');
      ratingTd.className = 'bvg-review-cell';
      if (g.ratingPct != null) {
        ratingTd.textContent = g.ratingPct + '%';
        ratingTd.style.color = ratingColor(g.ratingPct);
        ratingTd.style.fontWeight = '700';
      } else {
        ratingTd.textContent = '\u2014';
      }
      // Insert after the hidden original (count first, then rating)
      g.reviewCell.insertAdjacentElement('afterend', ratingTd);
      g.reviewCell.insertAdjacentElement('afterend', countTd);
    }
  }
  // ═══════════════════════════════════════
  // TIER LABELS (inline next to game title)
  // ═══════════════════════════════════════
  function addTierLabels(scoredGames) {
    for (const g of scoredGames) {
      const tr = g.tr;
      if (tr.querySelector('.bvg-tier-label')) continue;
      const tierName = tr.dataset.bvgTier;
      if (!tierName) continue;
      const titleA = tr.querySelector('a[href*="/i/"], a[href*="/game/"]');
      if (!titleA) continue;
      const label = document.createElement('span');
      label.className = 'bvg-tier-label';
      const tierPrice = tr.dataset.bvgTierPrice;
      label.textContent = tierPrice ? '$' + parseFloat(tierPrice).toFixed(2) + ' tier' : tierName;
      titleA.insertAdjacentElement('afterend', label);
    }
  }
  // ═══════════════════════════════════════
  // SORTING
  //
  // When any sort is active, tier headers
  // and summary rows are HIDDEN (they only
  // make sense in the original page order).
  // Refresh the page to restore them.
  // Only game rows are reordered.
  // ═══════════════════════════════════════
  function hideTierRows(table) {
    const tbody = table.querySelector('tbody') || table;
    [...tbody.querySelectorAll('tr')].forEach(tr => {
      const type = classifyRow(tr);
      // Hide tier headers and summary, but NOT bargraph rows
      // (bargraphs are paired with game rows and must move with them)
      if (type === ROW_TIER || type === ROW_SUMMARY) {
        tr.style.display = 'none';
        tr.dataset.bvgHidden = '1';
      }
    });
  }
  function sortByScore(table, indicator) {
    const tbody = table.querySelector('tbody') || table;
    // Hide tier/summary rows
    hideTierRows(table);
    // Build game groups (paired rows)
    const groups = buildGameGroups(table);
    // Toggle sort direction
    const current = table.dataset.bvgSortDir || 'desc';
    const dir = current === 'desc' ? 'asc' : 'desc';
    table.dataset.bvgSortDir = dir;
    // Clear all sort indicators, set active one
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    headerRow?.querySelectorAll('.bvg-sort-ind').forEach(s => { s.textContent = ''; });
    if (indicator) indicator.textContent = dir === 'desc' ? ' \u25BC' : ' \u25B2';
    // Sort groups by score
    groups.sort((a, b) => {
      const av = parseFloat(a.primaryTr.querySelector('.bvg-score-cell')?.dataset.score) || 0;
      const bv = parseFloat(b.primaryTr.querySelector('.bvg-score-cell')?.dataset.score) || 0;
      return dir === 'asc' ? av - bv : bv - av;
    });
    // Reinsert all rows in group order
    for (const g of groups) {
      for (const r of g.rows) tbody.appendChild(r);
    }
  }
  // Sort by any other column (same group-aware approach)
  function sortByColumn(table, colIdx, indicator, headerRow) {
    const tbody = table.querySelector('tbody') || table;
    // Hide tier/summary rows
    hideTierRows(table);
    const groups = buildGameGroups(table);
    const key = `bvgSortDir_${colIdx}`;
    const current = table.dataset[key] || 'desc';
    const dir = current === 'desc' ? 'asc' : 'desc';
    table.dataset[key] = dir;
    headerRow.querySelectorAll('.bvg-sort-ind').forEach(s => { s.textContent = ''; });
    if (indicator) indicator.textContent = dir === 'desc' ? ' \u25BC' : ' \u25B2';
    groups.sort((a, b) => {
      const aTr = a.primaryTr;
      const bTr = b.primaryTr;
      const aCell = aTr.querySelectorAll('td')[colIdx];
      const bCell = bTr.querySelectorAll('td')[colIdx];
      const aText = aCell ? aCell.textContent.replace(/,/g, '').trim() : '';
      const bText = bCell ? bCell.textContent.replace(/,/g, '').trim() : '';
      const aNum = parseFloat(aText.replace(/[^0-9.\-]/g, ''));
      const bNum = parseFloat(bText.replace(/[^0-9.\-]/g, ''));
      if (!isNaN(aNum) && !isNaN(bNum)) return dir === 'asc' ? aNum - bNum : bNum - aNum;
      if (aText < bText) return dir === 'asc' ? -1 : 1;
      if (aText > bText) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    for (const g of groups) {
      for (const r of g.rows) tbody.appendChild(r);
    }
  }
  function makeAllColumnsSortable(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return;
    [...headerRow.querySelectorAll('th, td')].forEach((h, idx) => {
      if (h.classList.contains('bvg-score-header')) return;
      if (h.dataset.bvgSortBound === '1') return;
      h.dataset.bvgSortBound = '1';
      h.classList.add('bvg-sortable');
      const ind = document.createElement('span');
      ind.className = 'bvg-sort-ind';
      h.appendChild(ind);
      h.addEventListener('click', () => sortByColumn(table, idx, ind, headerRow));
    });
  }
  // ═══════════════════════════════════════
  // HEADER LABELS
  //
  // Barter.vg headers may be empty or use
  // emojis without text. We detect column
  // purpose from data cells and add labels.
  // ═══════════════════════════════════════
  function isEmojiOrSymbolOnly(text) {
    const stripped = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f\u2600-\u27bf\s]/gu, '').trim();
    return stripped.length === 0;
  }
  function inferColumnLabel(cells) {
    for (const cell of cells) {
      if (!cell) continue;
      if (cell.querySelector('input[type="checkbox"]')) return null;
      if (cell.querySelector('img') && !cell.textContent.trim()) return null;
      if (cell.querySelector('a[href*="/i/"], a[href*="/game/"]')) return 'Title';
      const text = cell.textContent.trim();
      if (/\$\d+(\.\d{2})?/.test(text)) return 'MSRP';
    }
    const texts = cells.filter(Boolean).map(c => c.textContent.trim());
    if (texts.length && texts.every(t => /^\d{1,4}$/.test(t))) return 'Bundled';
    return null;
  }
  function labelEmptyHeaders(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return;
    const headers = [...headerRow.querySelectorAll('th, td')];
    const dataRows = findGameRows(table).slice(0, 3);
    for (let idx = 0; idx < headers.length; idx++) {
      const h = headers[idx];
      if (h.classList.contains('bvg-score-header') ||
          h.classList.contains('bvg-review-header') ||
          h.classList.contains('bvg-review-header-original') ||
          h.dataset.bvgLabeled === '1') continue;
      const text = h.textContent.trim();
      if (text && !isEmojiOrSymbolOnly(text)) continue;
      const samples = dataRows.map(r => {
        const cells = [...r.querySelectorAll('td')];
        return cells[idx] || null;
      });
      const label = inferColumnLabel(samples);
      if (label) {
        h.textContent = label;
        h.dataset.bvgLabeled = '1';
      }
    }
  }
  // ═══════════════════════════════════════
  // MODERN PANEL
  //
  // Card-based game list that replaces the
  // original Barter table. Supports search,
  // sort, ownership toggle, and tier groups.
  // ═══════════════════════════════════════
  const STORAGE_KEY_VIEW = 'bvg_scorer_view_v1';
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
  function loadCurrencyPref() {
    try { return localStorage.getItem(STORAGE_KEY_CURRENCY) || ''; } catch { return ''; }
  }
  function saveCurrencyPref(c) {
    try { localStorage.setItem(STORAGE_KEY_CURRENCY, c); } catch {}
  }
  // Format a tier price using the preferred currency, falling back to USD or first available
  function formatTierPrice(tier, currencyPref) {
    if (!tier.prices || !Object.keys(tier.prices).length) {
      return tier.price != null ? `$${tier.price.toFixed(2)}` : null;
    }
    // If a preference is set and the tier has that currency, use it
    if (currencyPref && tier.prices[currencyPref] != null) {
      const def = CURRENCY_DEFS.find(c => c.code === currencyPref);
      const sym = def ? def.symbol : currencyPref;
      return `${sym}${tier.prices[currencyPref].toFixed(2)}`;
    }
    // No preference or not available — show USD if present, else first available
    if (tier.prices.USD != null) return `$${tier.prices.USD.toFixed(2)}`;
    const first = Object.keys(tier.prices)[0];
    if (first) {
      const def = CURRENCY_DEFS.find(c => c.code === first);
      const sym = def ? def.symbol : first;
      return `${sym}${tier.prices[first].toFixed(2)}`;
    }
    return tier.price != null ? `$${tier.price.toFixed(2)}` : null;
  }
  // Collect all currencies seen across tiers
  function collectAvailableCurrencies(tiers) {
    const seen = new Set();
    for (const t of tiers) {
      if (t.prices) Object.keys(t.prices).forEach(c => seen.add(c));
    }
    return [...seen];
  }
  let _modernPanelState = {
    sortKey: 'score',
    sortDir: 'desc',
    search: '',
    hideOwned: false,
    hideDLC: false,
    currency: loadCurrencyPref(),
  };

  function loadViewPreference() {
    try { return localStorage.getItem(STORAGE_KEY_VIEW) || 'modern'; }
    catch { return 'modern'; }
  }
  function saveViewPreference(v) {
    try { localStorage.setItem(STORAGE_KEY_VIEW, v); } catch {}
  }

  function renderModernPanel(scored, ownedSet, tiers) {
    let panel = document.getElementById('bvg-modern-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'bvg-modern-panel';
      const table = findItemTable();
      if (table) table.parentElement.insertBefore(panel, table);
      else document.body.appendChild(panel);
    }

    const st = _modernPanelState;

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

    // Build tier lookup for dividers
    const tierMap = new Map();
    for (const t of tiers) {
      for (const gameRow of t.games) {
        tierMap.set(gameRow, t);
      }
    }

    // Render cards grouped by tier when sorted by score (default)
    let cardsHTML = '';
    const showTierDividers = tiers.length > 0 && st.sortKey === 'score' && !st.search;
    let currentTierName = null;
    let rank = 0;

    // Precompute tier stats for dividers
    const tierStats = new Map();
    if (showTierDividers) {
      for (const t of tiers) {
        const tierGames = scored.filter(g => g.itemType === 'game' && g.tr && tierMap.get(g.tr) === t);
        const avg = tierGames.length ? tierGames.reduce((s, g) => s + g.score, 0) / tierGames.length : 0;
        tierStats.set(t.name, { avg, count: tierGames.length });
      }
    }

    for (const g of filtered) {
      rank++;
      const isOwned = ownedSet.has(g.title);
      const isDLC = g.itemType === 'dlc' || g.itemType === 'package';
      const isUnrated = g.breakdown.isUnrated;

      // Tier divider
      if (showTierDividers) {
        const tier = tierMap.get(g.tr);
        const tName = tier ? tier.name : null;
        if (tName && tName !== currentTierName) {
          currentTierName = tName;
          const ts = tierStats.get(tName);
          const fmtPrice = formatTierPrice(tier, st.currency);
          const priceStr = fmtPrice ? `<span class="bvg-td-price">${escHtml(fmtPrice)}</span>` : '';
          const statsStr = ts ? `<span class="bvg-td-stats">${ts.count} games &middot; avg ${ts.avg.toFixed(0)}</span>` : '';
          const tierLabel = tier.label || tName;
          cardsHTML += `<div class="bvg-tier-divider"><div class="bvg-td-left">${escHtml(tierLabel)} ${priceStr}</div>${statsStr}</div>`;
        }
      }

      // Extract link from original row
      const titleA = g.tr.querySelector('a[href*="/i/"], a[href*="/game/"]');
      const href = titleA ? titleA.getAttribute('href') : '#';

      // Game image
      const imgHTML = g.imgSrc
        ? `<div class="bvg-card-img-wrap"><img class="bvg-card-img" src="${escHtml(g.imgSrc)}" alt="" loading="lazy"></div>`
        : '<div class="bvg-card-img-placeholder"></div>';

      // Tags (owned, DLC, unrated, tier — NOT wishlist, which is now inline in meta)
      let tags = '';
      if (isOwned) tags += '<span class="bvg-card-tag tag-owned">Owned</span>';
      if (isDLC) tags += `<span class="bvg-card-tag tag-dlc">${g.itemType === 'package' ? 'Package' : 'DLC'}</span>`;
      if (isUnrated) tags += '<span class="bvg-card-tag tag-unrated">Unrated</span>';
      const tierForTag = tierMap.get(g.tr);
      if (tierForTag) {
        const tierPriceStr = formatTierPrice(tierForTag, st.currency);
        if (tierPriceStr) tags += `<span class="bvg-card-tag">${escHtml(tierPriceStr)} tier</span>`;
      }

      const cardClass = `bvg-card${isOwned ? ' bvg-card-owned' : ''}${isDLC ? ' bvg-card-dlc' : ''}`;
      const scoreClass = `bvg-card-score${isUnrated ? ' bvg-unrated' : ''}`;
      const scoreBgStyle = isUnrated ? '' : `background:${scoreBg(g.score)}`;
      const scoreLabel = isUnrated ? 'N/R' : g.score.toFixed(0);

      // Build meta items with separators
      const metaParts = [];
      if (g.ratingPct != null) metaParts.push(`<span>Rating <span class="bvg-cm-val" style="color:${ratingColor(g.ratingPct)}">${g.ratingPct}%</span></span>`);
      if (g.reviews != null) metaParts.push(`<span>Reviews <span class="bvg-cm-val">${g.reviews.toLocaleString()}</span></span>`);
      if (g.bundledTimes != null) metaParts.push(`<span>Bundled <span class="bvg-cm-val">${g.bundledTimes}x</span></span>`);
      if (g.wishlistedDOM) metaParts.push('<span class="bvg-cm-wish">Wishlisted</span>');
      const metaHTML = metaParts.join('<span class="bvg-cm-sep">&middot;</span>');

      cardsHTML += `
        <div class="${cardClass}" data-bvg-title="${escHtml(g.title)}">
          ${imgHTML}
          <div class="bvg-card-body">
            <div class="bvg-card-title"><span class="bvg-card-rank">#${rank}</span><a href="${escHtml(href)}">${escHtml(g.title)}</a></div>
            <div class="bvg-card-meta">${metaHTML}</div>
            ${tags ? `<div class="bvg-card-tags">${tags}</div>` : ''}
          </div>
          <div class="bvg-card-right">
            <div class="${scoreClass}" style="${scoreBgStyle}" title="${escHtml(formatBreakdown(g.breakdown))}">
              ${scoreLabel}
            </div>
            ${g.msrp != null ? `<span class="bvg-card-msrp">$${g.msrp.toFixed(2)}</span>` : ''}
          </div>
        </div>`;
    }

    const totalShown = filtered.length;
    const totalGames = scored.filter(g => g.itemType === 'game').length;
    const dirArrow = st.sortDir === 'desc' ? '&#9660;' : '&#9650;';
    const viewPref = loadViewPreference();

    // Currency selector (only if multiple currencies detected)
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

    panel.innerHTML = `
      <div class="bvg-view-toggle" id="bvg-view-toggle">
        <button type="button" data-view="modern" class="${viewPref === 'modern' ? 'active' : ''}">Modern</button>
        <button type="button" data-view="classic" class="${viewPref !== 'modern' ? 'active' : ''}">Classic</button>
      </div>
      <div class="bvg-filter-bar">
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
      </div>
      <div class="bvg-cards">${cardsHTML}</div>
      <div class="bvg-cards-footer">Showing ${totalShown} of ${scored.length} items (${totalGames} games)</div>
    `;

    // Bind view toggle (inside panel — always in same position)
    panel.querySelectorAll('#bvg-view-toggle button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setView(btn.dataset.view, findItemTable());
      });
    });

    // Bind filter events
    const searchInput = panel.querySelector('#bvg-search');
    let searchDebounce = null;
    searchInput?.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        st.search = searchInput.value;
        renderModernPanel(scored, ownedSet, tiers);
      }, 200);
    });

    panel.querySelector('#bvg-currency-select')?.addEventListener('change', (e) => {
      st.currency = e.target.value;
      saveCurrencyPref(st.currency);
      renderModernPanel(scored, ownedSet, tiers);
    });

    panel.querySelector('#bvg-sort-select')?.addEventListener('change', (e) => {
      if (st.sortKey === e.target.value) {
        st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        st.sortKey = e.target.value;
        st.sortDir = 'desc';
      }
      renderModernPanel(scored, ownedSet, tiers);
    });

    panel.querySelector('#bvg-toggle-owned')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      st.hideOwned = !st.hideOwned;
      renderModernPanel(scored, ownedSet, tiers);
    });

    panel.querySelector('#bvg-toggle-dlc')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      st.hideDLC = !st.hideDLC;
      renderModernPanel(scored, ownedSet, tiers);
    });

    // Ownership toggle on card score click
    panel.querySelectorAll('.bvg-card-score').forEach(el => {
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
        clearScoreCells();
        run();
      });
    });

    // Focus search after re-render if it was focused
    if (document.activeElement?.id === 'bvg-search' || st.search) {
      const newInput = panel.querySelector('#bvg-search');
      if (newInput && st.search) {
        newInput.focus();
        newInput.setSelectionRange(newInput.value.length, newInput.value.length);
      }
    }
  }

  function setView(mode, table) {
    saveViewPreference(mode);
    const panel = document.getElementById('bvg-modern-panel');
    const classicToggle = document.getElementById('bvg-classic-view-toggle');
    if (mode === 'modern') {
      if (table) table.style.display = 'none';
      if (panel) panel.style.display = '';
      if (classicToggle) classicToggle.style.display = 'none';
    } else {
      if (table) table.style.display = '';
      if (panel) panel.style.display = 'none';
      if (classicToggle) classicToggle.style.display = '';
    }
    // Update toggle button states in both the panel toggle and the classic toggle
    document.querySelectorAll('.bvg-view-toggle button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
  }

  function ensureViewToggle(table) {
    // Toggle is now rendered inside renderModernPanel; only need a
    // standalone toggle above the classic table when in classic mode
    if (document.getElementById('bvg-classic-view-toggle')) return;
    const toggle = document.createElement('div');
    toggle.id = 'bvg-classic-view-toggle';
    toggle.className = 'bvg-view-toggle';
    toggle.innerHTML = `
      <button type="button" data-view="modern">Modern</button>
      <button type="button" data-view="classic" class="active">Classic</button>
    `;
    if (table) table.parentElement.insertBefore(toggle, table);
    else document.body.prepend(toggle);

    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setView(btn.dataset.view, table);
      });
    });
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
    // DOM modifications
    ensureScoreHeader(table);
    ensureScoreCells(scored, ownedSet);
    splitReviewColumn(table, scored);
    addTierLabels(scored);
    fixNonGameRows(table);
    makeAllColumnsSortable(table);
    labelEmptyHeaders(table);
    const bundleScores = computeBundleScores(scored, ownedSet);
    const { bundleRating, depthRating, personalRating, topMain, dealQuality, unownedMsrpSum } = bundleScores;
    const ownedCount = scored.filter(g => g.itemType === 'game' && ownedSet.has(g.title)).length;
    const gameCount = scored.filter(g => g.itemType === 'game').length;
    const dlcCount = scored.filter(g => g.itemType !== 'game').length;
    const wishCount = scored.filter(g => g.itemType === 'game' && g.wishlistedDOM).length;
    renderBanner({ bundleRating, depthRating, personalRating, picks: topMain, ownedCount, gameCount, dlcCount, wishCount, tiers, scored, dealQuality, unownedMsrpSum });
    // Modern panel
    renderModernPanel(scored, ownedSet, tiers);
    ensureViewToggle(table);
    setView(loadViewPreference(), table);
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
        if (!document.querySelector('.bvg-score-cell')) {
          try { run(); } catch (e) { console.error('[BVG Scorer] Rerun error:', e); }
        }
      }, 400);
    });
    _bvgObserver.observe(document.body, { childList: true, subtree: true });
  }
  boot();
})();
