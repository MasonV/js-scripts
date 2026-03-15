// ==UserScript==
// @name         LLM Stats Show All Models
// @namespace    https://tampermonkey.net/
// @version      1.1.0
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
  const CLICK_DELAY_MS = 600;
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
   * Returns { element, total } or null if not found.
   */
  function findPaginationInfo() {
    // Look for text matching "Showing X–Y of Z models" (uses en-dash or hyphen)
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const match = text.match(/Showing\s+(\d+)\s*[–\-]\s*(\d+)\s+of\s+(\d+)/i);
      if (match) {
        return {
          element: walker.currentNode.parentElement,
          start: parseInt(match[1], 10),
          end: parseInt(match[2], 10),
          total: parseInt(match[3], 10),
        };
      }
    }
    return null;
  }

  /**
   * Finds the Next pagination button.
   * Looks for a button/anchor containing "Next" text near pagination controls.
   */
  function findNextButton() {
    const buttons = document.querySelectorAll('button, a[role="button"], a');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text === 'Next' || text === 'Next →' || text === 'Next ›') {
        return btn;
      }
    }
    return null;
  }

  /**
   * Finds the Previous pagination button.
   */
  function findPrevButton() {
    const buttons = document.querySelectorAll('button, a[role="button"], a');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text === 'Previous' || text === '← Previous' || text === '‹ Previous') {
        return btn;
      }
    }
    return null;
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
   * Compares the first row's text before and after to detect update.
   */
  function waitForTableUpdate(previousFirstRowText, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      function check() {
        const rows = extractTableRows();
        if (rows.length > 0) {
          const newFirstText = rowFingerprint(rows[0]);
          if (newFirstText !== previousFirstRowText) {
            resolve();
            return;
          }
        }
        if (Date.now() - start > timeoutMs) {
          // Timeout — table may not have changed (could be last page re-render)
          resolve();
          return;
        }
        requestAnimationFrame(check);
      }

      check();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MAIN LOGIC
  // ═══════════════════════════════════════════════════════════════════

  async function showAllModels() {
    // Wait a beat for React hydration
    await new Promise((r) => setTimeout(r, 1000));

    const paginationInfo = findPaginationInfo();
    if (!paginationInfo) {
      console.warn(LOG, 'Could not find pagination info. Page structure may have changed.');
      return;
    }

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

      // Click Next
      nextBtn.click();
      page++;
      console.log(LOG, `Navigating to page ${page}...`);

      // Wait for table content to update
      await waitForTableUpdate(currentFirstRow);
      // Extra settle time for React rendering
      await new Promise((r) => setTimeout(r, CLICK_DELAY_MS));

      // Collect rows from this page
      const pageRows = extractTableRows();
      allRows.push(...pageRows);
      console.log(LOG, `Page ${page}: collected ${pageRows.length} rows (total: ${allRows.length}).`);
      updateBanner(banner, Math.min(allRows.length, totalModels), totalModels);
    }

    // Deduplicate in case of overlap
    const uniqueRows = deduplicateRows(allRows);
    console.log(LOG, `Collected ${allRows.length} rows, ${uniqueRows.length} unique after dedup.`);

    // Replace table body with all collected rows
    const table = document.querySelector('table');
    if (!table) {
      console.error(LOG, 'Table not found for row replacement.');
      completeBanner(banner, uniqueRows.length);
      return;
    }

    const tbody = table.querySelector('tbody');
    if (!tbody) {
      console.error(LOG, 'Table body not found.');
      completeBanner(banner, uniqueRows.length);
      return;
    }

    // Clear existing rows and insert all collected ones
    tbody.innerHTML = '';
    for (const row of uniqueRows) {
      tbody.appendChild(row);
    }

    // Update the pagination text
    if (paginationInfo.element) {
      paginationInfo.element.textContent = `Showing 1–${uniqueRows.length} of ${totalModels} models`;
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
