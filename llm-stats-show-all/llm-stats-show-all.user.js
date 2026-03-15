// ==UserScript==
// @name         LLM Stats Show All Models
// @namespace    https://tampermonkey.net/
// @version      1.4.0
// @description  Automatically paginates through all models on the llm-stats.com leaderboard and displays them in a single table.
// @match        *://llm-stats.com/*
// @match        *://*.llm-stats.com/*
// @homepageURL  https://github.com/MasonV/js-scripts
// @supportURL   https://github.com/MasonV/js-scripts/issues
// @updateURL    https://raw.githubusercontent.com/MasonV/js-scripts/main/llm-stats-show-all/llm-stats-show-all.meta.js
// @downloadURL  https://raw.githubusercontent.com/MasonV/js-scripts/main/llm-stats-show-all/llm-stats-show-all.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG = '[LLM Show All]';
  const PAGE_SIZE = 30;
  const SETTLE_DELAY_MS = 800;
  const MAX_PAGES = 20; // safety cap: 20 * 30 = 600 models max

  // ═══════════════════════════════════════════════════════════════════
  //  STYLES
  // ═══════════════════════════════════════════════════════════════════

  GM_addStyle(`
    .llm-show-all-banner {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 10000;
      background: #1a1a2e;
      color: #e0e0e0;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 10px 16px;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: opacity 0.3s ease;
    }
    .llm-show-all-banner .progress-bar {
      margin-top: 6px;
      height: 4px;
      background: #333;
      border-radius: 2px;
      overflow: hidden;
    }
    .llm-show-all-banner .progress-fill {
      height: 100%;
      background: #6c63ff;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
  `);

  // ═══════════════════════════════════════════════════════════════════
  //  DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Finds the "Showing X–Y of Z models" text element.
   * Checks both individual text nodes and element innerText to handle
   * cases where React splits the string across multiple child elements.
   * Returns { element, total } or null if not found.
   */
  function findPaginationInfo() {
    const PAGINATION_RE = /Showing\s+(\d+)\s*[–\-]\s*(\d+)\s+of\s+(\d+)/i;

    // Strategy 1: check individual text nodes (fastest if text is in one node)
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    while (walker.nextNode()) {
      const match = walker.currentNode.textContent.trim().match(PAGINATION_RE);
      if (match) {
        return {
          element: walker.currentNode.parentElement,
          start: parseInt(match[1], 10),
          end: parseInt(match[2], 10),
          total: parseInt(match[3], 10),
        };
      }
    }

    // Strategy 2: check composed innerText of small container elements
    // (handles React splitting "Showing 1–30 of 272 models" across spans)
    const candidates = document.querySelectorAll('p, div, span, nav, footer, section');
    for (const el of candidates) {
      // Skip large containers to avoid false matches on the whole page
      if (el.children.length > 10) continue;
      const text = (el.innerText || el.textContent || '').trim();
      const match = text.match(PAGINATION_RE);
      if (match) {
        return {
          element: el,
          start: parseInt(match[1], 10),
          end: parseInt(match[2], 10),
          total: parseInt(match[3], 10),
        };
      }
    }

    // Strategy 3: look for just "of N models" as a weaker signal
    const weakRe = /of\s+(\d+)\s+models/i;
    for (const el of candidates) {
      if (el.children.length > 10) continue;
      const text = (el.innerText || el.textContent || '').trim();
      const match = text.match(weakRe);
      if (match) {
        console.log(LOG, 'Weak pagination match found:', text);
        // Try to extract start-end from the same text
        const rangeMatch = text.match(/(\d+)\s*[–\-]\s*(\d+)/);
        return {
          element: el,
          start: rangeMatch ? parseInt(rangeMatch[1], 10) : 1,
          end: rangeMatch ? parseInt(rangeMatch[2], 10) : PAGE_SIZE,
          total: parseInt(match[1], 10),
        };
      }
    }

    return null;
  }

  /**
   * Finds a pagination button by matching its text content.
   * Searches broadly: buttons, anchors, and any clickable element near
   * the "Showing X of Y" text. Handles text nested in child spans/SVGs.
   */
  function findPaginationButton(label) {
    // Strategy 1: find by exact or partial text match on button-like elements
    const candidates = document.querySelectorAll('button, a, [role="button"], [tabindex="0"]');
    for (const el of candidates) {
      const text = el.textContent.trim();
      if (text === label || text.includes(label)) {
        // Avoid matching if this element contains BOTH "Previous" and "Next"
        // (i.e., a parent container wrapping both buttons)
        if (text.includes('Previous') && text.includes('Next') && label !== text) {
          continue;
        }
        return el;
      }
    }

    // Strategy 2: walk all elements looking for innerText match
    // (catches custom components that render as <div> etc.)
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length > 5) continue; // skip large containers
      const text = el.textContent.trim();
      if (text === label) return el;
    }

    return null;
  }

  function findNextButton() {
    return findPaginationButton('Next');
  }

  function findPrevButton() {
    return findPaginationButton('Previous');
  }

  /**
   * Dispatches a click event that triggers React handlers without
   * causing browser-native navigation (e.g., <a href> links opening).
   * React listens for bubbling events at the root, so we dispatch
   * a synthetic click with bubbles:true. We temporarily block any
   * default action (like following a link) via a capturing listener.
   */
  function simulateClick(el) {
    // Temporarily intercept the click at the element to prevent
    // native navigation while still letting React's root handler fire
    function blockDefault(e) { e.preventDefault(); }
    el.addEventListener('click', blockDefault, { capture: true, once: true });

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(click);
  }

  /**
   * Extracts all data rows from the leaderboard table body.
   * Returns an array of cloned <tr> elements.
   */
  function extractTableRows() {
    const table = document.querySelector('table');
    if (!table) return [];

    const tbody = table.querySelector('tbody');
    if (!tbody) return [];

    const rows = tbody.querySelectorAll('tr');
    return Array.from(rows).map((row) => row.cloneNode(true));
  }

  /**
   * Checks if the Next button is disabled (indicating last page).
   */
  function isNextDisabled(nextBtn) {
    if (!nextBtn) return true;
    if (nextBtn.disabled) return true;
    if (nextBtn.getAttribute('aria-disabled') === 'true') return true;
    if (nextBtn.classList.contains('disabled')) return true;
    // Check for pointer-events: none or opacity indicating disabled state
    const style = window.getComputedStyle(nextBtn);
    if (style.pointerEvents === 'none') return true;
    if (parseFloat(style.opacity) < 0.5) return true;
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BANNER UI
  // ═══════════════════════════════════════════════════════════════════

  function createBanner() {
    const banner = document.createElement('div');
    banner.className = 'llm-show-all-banner';
    banner.innerHTML = `
      <div class="status-text">Loading all models...</div>
      <div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>
    `;
    document.body.appendChild(banner);
    return banner;
  }

  function updateBanner(banner, loaded, total) {
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    banner.querySelector('.status-text').textContent =
      `Loading models: ${loaded} / ${total} (${pct}%)`;
    banner.querySelector('.progress-fill').style.width = `${pct}%`;
  }

  function completeBanner(banner, total) {
    banner.querySelector('.status-text').textContent =
      `All ${total} models loaded.`;
    banner.querySelector('.progress-fill').style.width = '100%';
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 300);
    }, 2500);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DEDUPLICATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generates a fingerprint for a row based on its cell text content.
   * Used to deduplicate rows collected across pages.
   */
  function rowFingerprint(row) {
    return Array.from(row.querySelectorAll('td, th'))
      .map((cell) => cell.textContent.trim())
      .join('|');
  }

  /**
   * Deduplicates rows by fingerprint, keeping the first occurrence.
   */
  function deduplicateRows(rows) {
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
      const fp = rowFingerprint(row);
      if (!seen.has(fp)) {
        seen.add(fp);
        unique.push(row);
      }
    }
    return unique;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PAGINATION HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Waits for the table content to change after a navigation click.
   * Uses MutationObserver on the tbody for reliable detection,
   * with a rAF poll fallback.
   */
  function waitForTableUpdate(previousFirstRowText, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;

      function done() {
        if (resolved) return;
        resolved = true;
        if (observer) observer.disconnect();
        resolve();
      }

      function hasChanged() {
        const rows = extractTableRows();
        if (rows.length > 0) {
          const newFirstText = rowFingerprint(rows[0]);
          if (newFirstText !== previousFirstRowText) return true;
        }
        return false;
      }

      // MutationObserver on the table body for fast detection
      let observer = null;
      const table = document.querySelector('table');
      const tbody = table ? table.querySelector('tbody') : null;
      if (tbody) {
        observer = new MutationObserver(() => {
          if (hasChanged()) done();
        });
        observer.observe(tbody, { childList: true, subtree: true, characterData: true });
      }

      // rAF poll fallback
      function poll() {
        if (resolved) return;
        if (hasChanged()) { done(); return; }
        if (Date.now() - start > timeoutMs) { done(); return; }
        requestAnimationFrame(poll);
      }
      requestAnimationFrame(poll);

      // Hard timeout safety net
      setTimeout(done, timeoutMs);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MAIN LOGIC
  // ═══════════════════════════════════════════════════════════════════

  async function showAllModels() {
    // Wait for React hydration with retries — the table and pagination
    // may not render immediately on slow connections or heavy pages
    let paginationInfo = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));

      // Diagnostic: log what we can find on each attempt
      {
        const tbl = document.querySelector('table');
        const nBtn = findNextButton();
        const pBtn = findPrevButton();
        console.log(LOG, `Attempt ${attempt}/10 diagnostics:`, {
          tableFound: !!tbl,
          tbodyFound: !!(tbl && tbl.querySelector('tbody')),
          rowCount: tbl ? (tbl.querySelector('tbody')?.querySelectorAll('tr').length ?? 0) : 0,
          nextBtnFound: !!nBtn,
          nextBtnTag: nBtn?.tagName,
          nextBtnText: nBtn?.textContent?.trim(),
          nextBtnDisabled: nBtn ? isNextDisabled(nBtn) : 'N/A',
          prevBtnFound: !!pBtn,
        });
      }

      paginationInfo = findPaginationInfo();
      if (paginationInfo) break;
      console.log(LOG, `Attempt ${attempt}/10: pagination info not found yet, retrying...`);
    }

    if (!paginationInfo) {
      console.warn(LOG, 'Could not find pagination info after 10 attempts. Page structure may have changed.');
      return;
    }
    console.log(LOG, 'Pagination info:', paginationInfo);

    const totalModels = paginationInfo.total;
    const totalPages = Math.ceil(totalModels / PAGE_SIZE);
    console.log(LOG, `Found ${totalModels} models across ~${totalPages} pages.`);

    // If all models already visible, nothing to do
    if (paginationInfo.end >= totalModels) {
      console.log(LOG, 'All models already visible.');
      return;
    }

    const banner = createBanner();
    const allRows = [];

    // Collect rows from the current (first) page
    const firstPageRows = extractTableRows();
    allRows.push(...firstPageRows);
    console.log(LOG, `Page 1: collected ${firstPageRows.length} rows.`);
    updateBanner(banner, allRows.length, totalModels);

    // Navigate through remaining pages
    let page = 1;
    while (page < totalPages && page < MAX_PAGES) {
      const nextBtn = findNextButton();
      if (!nextBtn || isNextDisabled(nextBtn)) {
        console.log(LOG, `Next button unavailable at page ${page}. Stopping.`);
        break;
      }

      // Capture current first row to detect when content changes
      const currentRows = extractTableRows();
      const currentFirstRow = currentRows.length > 0 ? rowFingerprint(currentRows[0]) : '';

      // Click Next — use simulated events for React compatibility
      console.log(LOG, `Clicking Next for page ${page + 1}...`);
      simulateClick(nextBtn);
      page++;

      // Wait for table content to update
      await waitForTableUpdate(currentFirstRow);
      // Extra settle time for React rendering
      await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));

      // Collect rows from this page
      const pageRows = extractTableRows();
      allRows.push(...pageRows);
      console.log(LOG, `Page ${page}: collected ${pageRows.length} rows (total: ${allRows.length}).`);
      updateBanner(banner, Math.min(allRows.length, totalModels), totalModels);
    }

    // Deduplicate in case of overlap
    const uniqueRows = deduplicateRows(allRows);
    console.log(LOG, `Collected ${allRows.length} rows, ${uniqueRows.length} unique after dedup.`);

    // Build a static clone of the table that React cannot re-render.
    // We clone the existing table (preserving thead/styles), replace its
    // tbody with our collected rows, then swap it into the DOM in place
    // of the React-controlled original.
    const origTable = document.querySelector('table');
    if (!origTable) {
      console.error(LOG, 'Table not found for row replacement.');
      completeBanner(banner, uniqueRows.length);
      return;
    }

    // Clone the table structure (thead, colgroups, etc.) without tbody rows
    const staticTable = origTable.cloneNode(false);
    for (const child of origTable.children) {
      if (child.tagName === 'TBODY') {
        // Build a fresh tbody with all collected rows
        const newTbody = document.createElement('tbody');
        for (const row of uniqueRows) {
          newTbody.appendChild(row);
        }
        staticTable.appendChild(newTbody);
      } else {
        // Clone thead, colgroup, etc. as-is
        staticTable.appendChild(child.cloneNode(true));
      }
    }

    // Swap: replace the React-controlled table with our static one.
    // This severs React's reference so it can't wipe our content.
    origTable.parentNode.replaceChild(staticTable, origTable);

    // Update the pagination text
    const freshPagination = findPaginationInfo();
    if (freshPagination && freshPagination.element) {
      freshPagination.element.textContent = `Showing all ${uniqueRows.length} of ${totalModels} models`;
    }

    // Hide pagination buttons since all rows are now visible
    const nextBtn = findNextButton();
    const prevBtn = findPrevButton();
    if (nextBtn) nextBtn.style.display = 'none';
    if (prevBtn) prevBtn.style.display = 'none';

    console.log(LOG, `Done. Displaying ${uniqueRows.length} models in a single table.`);
    completeBanner(banner, uniqueRows.length);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SPA NAVIGATION DETECTION
  // ═══════════════════════════════════════════════════════════════════

  let lastRunUrl = null;
  let running = false;

  function isLeaderboardPage() {
    return /\/leaderboards\b/.test(location.pathname);
  }

  async function tryRun() {
    const url = location.href;
    if (!isLeaderboardPage() || running || url === lastRunUrl) return;
    running = true;
    lastRunUrl = url;
    try {
      await showAllModels();
    } catch (err) {
      console.error(LOG, 'Failed to load all models:', err);
    } finally {
      running = false;
    }
  }

  // Run immediately if already on a leaderboard page
  tryRun();

  // Detect SPA navigation via the Navigation API (modern browsers)
  if (typeof navigation !== 'undefined' && navigation.addEventListener) {
    navigation.addEventListener('navigatesuccess', () => tryRun());
  }

  // Fallback: listen for popstate and detect pushState/replaceState
  window.addEventListener('popstate', () => tryRun());

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    tryRun();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    tryRun();
  };
})();
