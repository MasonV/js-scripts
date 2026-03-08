// ==UserScript==
// @name         Barter.vg Bundle Scorer
// @namespace    https://tampermonkey.net/
// @version      3.8
// @description  Per-game scoring with DLC/package handling, wishlist + bundle-cost valuation, split review metrics, normalized bundle ratings, all-column sorting, owned detection, and settings for Barter.vg bundle pages.
// @match        *://barter.vg/bundle/*
// @match        *://*.barter.vg/bundle/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/bundle-barter-scorer/barter-bundle-scorer.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/bundle-barter-scorer/barter-bundle-scorer.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  console.log('[BVG Scorer] v3.8 loaded on', location.href);
  // ═══════════════════════════════════════
  // STYLES (GM_addStyle bypasses CSP)
  // ═══════════════════════════════════════
  GM_addStyle(`
    /* ── Table layout: widen title column ── */
    table.collection { table-layout: auto !important; width: 100% !important; }
    table.collection th.cTitles,
    table.collection td:nth-child(3) {
      width: auto !important;
      min-width: 200px;
    }
    /* ── Banner ── */
    #bvg-scorer-banner {
      position: sticky; top: 0; z-index: 9999;
      background: linear-gradient(180deg, #0d1117 0%, #111820 100%);
      border-bottom: 1px solid #1f2937;
      padding: 10px 20px 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px; line-height: 1.5;
      color: #c9d1d9;
      box-shadow: 0 2px 12px rgba(0,0,0,.4);
    }
    #bvg-scorer-banner strong { color: #e6edf3; }
    #bvg-scorer-banner .bvg-row {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
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
      margin-top: 5px; font-size: 12px; line-height: 1.6;
    }
    #bvg-scorer-banner .bvg-picks strong { margin-right: 4px; }
    #bvg-scorer-banner .bvg-pick-name {
      font-weight: 600;
    }
    #bvg-scorer-banner .bvg-pick-score {
      opacity: .45; font-size: 11px; font-weight: 400;
    }
    #bvg-scorer-banner .bvg-meta {
      opacity: .4; margin-top: 4px; font-size: 10px;
      letter-spacing: .2px;
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
      min-width: 52px;
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
    /* ── Review split cells ── */
    td.bvg-review-cell,
    th.bvg-review-header {
      text-align: center;
      font-variant-numeric: tabular-nums;
      min-width: 62px;
      white-space: nowrap;
    }
    td.bvg-review-cell {
      color: #8b949e;
      font-size: 12px;
    }
    /* ── Score header ── */
    th.bvg-score-header {
      min-width: 60px;
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
  `);
  // ═══════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════
  const STORAGE_KEY_OWNED    = 'bvg_scorer_owned_v2';
  const STORAGE_KEY_SETTINGS = 'bvg_scorer_settings_v2';
  const DEFAULT_SETTINGS = {
    useWilsonAdjustedRating: false,
    topNMain: 5, topNDepth: 10,
    msrpCap: 39.99, bundledPenaltyCap: 10,
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
  const INJECTED_COLUMNS = 3; // score + reviews + steam rating
  // ═══════════════════════════════════════
  // MATH
  // ═══════════════════════════════════════
  const clamp01 = x => Math.max(0, Math.min(1, x));
  function confidenceFromReviews(n) {
    if (!n || n <= 0) return 0;
    return clamp01(n / (n + 800));
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
  const DLC_KEYWORDS = /\b(soundtrack|ost|artbook|art\s*book|wallpaper|skin\s*pack|costume|dlc|season\s*pass|expansion|bonus\s*content|digital\s*deluxe|deluxe\s*edition|collector.s\s*edition|upgrade)\b/i;
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
    const ownedDOM = isOwnedInDOM(tr);
    const wishlistedDOM = isWishlistedInDOM(tr);
    const itemType = classifyItem(title, tr, ratingPct, reviews);
    console.log(`[BVG] ${title}: type=${itemType} wish=${wishlistedDOM} rating=${ratingPct}% reviews=${reviews} msrp=${msrp} bundled=${bundledTimes}`);
    return { title, ratingPct, reviews, msrp, bundledTimes, ownedDOM, wishlistedDOM, itemType, tr };
  }
  // ═══════════════════════════════════════
  // SCORING
  // ═══════════════════════════════════════
  function scoreGame(g) {
    const ratingRaw = g.ratingPct ? clamp01(g.ratingPct / 100) : 0;
    const conf = confidenceFromReviews(g.reviews);
    const rating = SETTINGS.useWilsonAdjustedRating
      ? wilsonLowerBound(ratingRaw, g.reviews || 0)
      : ratingRaw;
    const val = clamp01((g.msrp || 0) / SETTINGS.msrpCap);
    const bundleValue = CURRENT_BUNDLE_COST
      ? clamp01((g.msrp || 0) / Math.max(CURRENT_BUNDLE_COST, 0.01))
      : val;
    const wishlistBonus = g.wishlistedDOM ? 1 : 0;
    const pen = g.bundledTimes != null ? clamp01(g.bundledTimes / SETTINGS.bundledPenaltyCap) : 0;
    const w = SETTINGS.weights;
    const raw = w.rating * rating + w.confidence * conf + w.value * val + w.bundleValue * bundleValue + w.wishlist * wishlistBonus - w.rebundlePenalty * pen;
    return {
      score: Math.max(0, raw * 100),
      breakdown: { rating, ratingRaw, conf, val, bundleValue, wishlistBonus, pen },
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
    return [
      `Rating:     ${(b.ratingRaw * 100).toFixed(0)}%` +
        (b.rating !== b.ratingRaw ? ` (Wilson: ${(b.rating * 100).toFixed(1)}%)` : ''),
      `Confidence: ${(b.conf * 100).toFixed(1)}%`,
      `Value:      ${(b.val * 100).toFixed(1)}%`,
      `Bundle $:   ${(b.bundleValue * 100).toFixed(1)}%`,
      `Wishlist:  +${(b.wishlistBonus * 100).toFixed(0)}%`,
      `Rebundle:  -${(b.pen * 100).toFixed(1)}%`,
    ].join('\n');
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
    return {
      bundleRating:  avg(topMain),
      depthRating:   avg(topDepth),
      personalRating: avg(personalTop),
      topMain,
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
      const val = input.type === 'checkbox' ? input.checked : parseFloat(input.value);
      if (key.startsWith('w.')) SETTINGS.weights[key.slice(2)] = val;
      else SETTINGS[key] = val;
    });
    saveSettings(SETTINGS);
  }
  function renderBanner(bundleRating, depthRating, personalRating, picks, ownedCount, gameCount, dlcCount, wishCount) {
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
      .map(p => `<span class="bvg-pick-name" style="color:${scoreColor(p.score)}">${p.title}</span> <span class="bvg-pick-score">${p.score.toFixed(1)}</span>`)
      .join(' &middot; ');
    banner.innerHTML = `
      <div class="bvg-row">
        ${statBadge('Bundle', bundleRating, `top ${SETTINGS.topNMain}`)}
        ${statBadge('Depth', depthRating, `top ${SETTINGS.topNDepth}`)}
        ${statBadge('Personal', personalRating, `excl. owned`)}
        <button class="bvg-settings-btn" id="bvg-settings-toggle">&#9881; Settings</button>
      </div>
      <div class="bvg-picks"><strong>Top picks:</strong> ${picksText || 'n/a'}</div>
      <div class="bvg-meta">
        ${ownedCount} of ${gameCount} games owned${dlcCount > 0 ? ` &middot; ${dlcCount} DLC/extras excluded` : ''} &middot; Click any score to toggle owned &middot;
        ${wishCount} wishlisted${CURRENT_BUNDLE_COST ? ` &middot; Bundle cost detected: $${CURRENT_BUNDLE_COST.toFixed(2)}` : ''} &middot;
        Rating: ${SETTINGS.useWilsonAdjustedRating ? 'Wilson-adjusted' : 'Raw % (confidence-weighted)'}
      </div>
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
  }
  // ═══════════════════════════════════════
  // SCORE COLUMN + COLSPAN FIXUP
  // ═══════════════════════════════════════
  function ensureScoreHeader(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow || headerRow.querySelector('.bvg-score-header')) return;

    const ratingTh = document.createElement('th');
    ratingTh.textContent = 'Steam %';
    ratingTh.className = 'bvg-review-header';
    headerRow.prepend(ratingTh);

    const reviewsTh = document.createElement('th');
    reviewsTh.textContent = 'Reviews';
    reviewsTh.className = 'bvg-review-header';
    headerRow.prepend(reviewsTh);

    const th = document.createElement('th');
    th.textContent = 'Score';
    th.className = 'bvg-score-header bvg-sortable';
    const ind = document.createElement('span');
    ind.className = 'bvg-sort-ind';
    th.appendChild(ind);
    headerRow.prepend(th);
    th.addEventListener('click', () => sortByScore(table, ind));
  }
  // Fix tier headers and summary rows: bump their colspan by injected column count
  // and prepend an empty cell so columns align
  function fixNonGameRows(table) {
    const allRows = [...table.querySelectorAll('tr')];
    for (const tr of allRows) {
      const type = classifyRow(tr);
      if (type === ROW_HEADER || type === ROW_GAME) continue;
      if (tr.querySelector('.bvg-spacer')) continue; // already fixed
      // For tier/summary/other rows, prepend an empty cell
      const firstCell = tr.querySelector('td');
      if (firstCell && firstCell.colSpan > 1) {
        // Has colspan — bump it by injected count
        firstCell.colSpan += INJECTED_COLUMNS;
        // Mark as fixed
        firstCell.classList.add('bvg-spacer');
      } else {
        // No colspan — prepend an empty td
        const spacer = document.createElement('td');
        spacer.className = 'bvg-spacer';
        tr.prepend(spacer);
        for (let i = 1; i < INJECTED_COLUMNS; i++) {
          const extra = document.createElement('td');
          extra.className = 'bvg-spacer';
          tr.prepend(extra);
        }
      }
    }
  }
  function clearScoreCells() {
    document.querySelectorAll('.bvg-score-cell, .bvg-score-header, .bvg-review-cell, .bvg-review-header, .bvg-spacer').forEach(el => el.remove());
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
      const reviewsTd = document.createElement('td');
      reviewsTd.className = 'bvg-review-cell';
      reviewsTd.textContent = g.reviews != null ? String(g.reviews) : '-';

      const ratingTd = document.createElement('td');
      ratingTd.className = 'bvg-review-cell';
      ratingTd.textContent = g.ratingPct != null ? `${g.ratingPct}%` : '-';

      if (g.wishlistedDOM) td.title += '\nWishlisted: yes';

      tr.prepend(ratingTd);
      tr.prepend(reviewsTd);
      tr.prepend(td);
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
  // MAIN
  // ═══════════════════════════════════════
  function run() {
    console.log('[BVG Scorer] Scanning...');
    const table = findItemTable();
    if (!table) { console.warn('[BVG Scorer] No game table found.'); return; }
    const rows = findGameRows(table);
    if (!rows.length) { console.warn('[BVG Scorer] No game rows.'); return; }
    console.log(`[BVG Scorer] Found ${rows.length} games.`);
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
    ensureScoreHeader(table);
    ensureScoreCells(scored, ownedSet);
    fixNonGameRows(table);
    makeAllColumnsSortable(table);
    const { bundleRating, depthRating, personalRating, topMain } =
      computeBundleScores(scored, ownedSet);
    const ownedCount = scored.filter(g => g.itemType === 'game' && ownedSet.has(g.title)).length;
    const gameCount = scored.filter(g => g.itemType === 'game').length;
    const dlcCount = scored.filter(g => g.itemType !== 'game').length;
    const wishCount = scored.filter(g => g.itemType === 'game' && g.wishlistedDOM).length;
    renderBanner(bundleRating, depthRating, personalRating, topMain, ownedCount, gameCount, dlcCount, wishCount);
  }
  // ═══════════════════════════════════════
  // BOOTSTRAP
  // ═══════════════════════════════════════
  function boot() {
    try { run(); } catch (e) { console.error('[BVG Scorer] Error:', e); }
    let debounce = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!document.querySelector('.bvg-score-cell')) {
          try { run(); } catch (e) { console.error('[BVG Scorer] Rerun error:', e); }
        }
      }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  boot();
})();