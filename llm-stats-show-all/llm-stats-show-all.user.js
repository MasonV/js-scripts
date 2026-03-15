// ==UserScript==
// @name         LLM Stats Show All Models
// @namespace    https://tampermonkey.net/
// @version      1.7.0
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
  const SETTLE_DELAY_MS = 150; // short pause after MutationObserver confirms change
  const WAIT_TIMEOUT_MS = 3000; // max wait for a page transition
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
  //  TABLE SORTING
  // ═══════════════════════════════════════════════════════════════════

  GM_addStyle(`
    #llm-show-all-static th[data-sortable] {
      cursor: pointer;
      user-select: none;
    }
    #llm-show-all-static th[data-sortable]:hover {
      opacity: 0.8;
    }
    #llm-show-all-static th .llm-sort-arrow {
      display: inline-block;
      margin-left: 4px;
      font-size: 10px;
      opacity: 0.4;
    }
    #llm-show-all-static th[data-sort-dir] .llm-sort-arrow {
      opacity: 1;
    }
  `);

  /**
   * Parses a cell's text content into a sortable value.
   * Returns { num, text } — sort by num first (if valid), text as fallback.
   */
  function parseCellValue(cell) {
    const raw = cell.textContent.trim();
    if (raw === '' || raw === '—' || raw === '-' || raw === 'N/A') {
      return { num: -Infinity, text: '' };
    }

    // Strip currency symbols, commas, percent signs, trailing units
    const cleaned = raw.replace(/[$,€£%]/g, '').replace(/[KkMmBb]$/, (u) => {
      const multipliers = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 };
      return '*' + multipliers[u];
    });

    // Handle multiplier notation (e.g., "1.5*1000000")
    if (cleaned.includes('*')) {
      const parts = cleaned.split('*');
      const val = parseFloat(parts[0]) * parseFloat(parts[1]);
      if (Number.isFinite(val)) return { num: val, text: raw };
    }

    const num = parseFloat(cleaned);
    if (Number.isFinite(num)) return { num, text: raw };

    return { num: NaN, text: raw.toLowerCase() };
  }

  /**
   * Attaches click-to-sort handlers to every <th> in the static table.
   * Tracks sort state (column index + direction) and re-orders tbody rows.
   */
  function enableSorting(table) {
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    // Find all header cells in the last header row (handles multi-row headers)
    const headerRows = thead.querySelectorAll('tr');
    const headerRow = headerRows[headerRows.length - 1];
    const ths = headerRow.querySelectorAll('th');

    let currentSortCol = -1;
    let currentSortDir = 0; // 0 = none, 1 = asc, -1 = desc

    ths.forEach((th, colIndex) => {
      th.setAttribute('data-sortable', '');

      // Add sort arrow indicator
      const arrow = document.createElement('span');
      arrow.className = 'llm-sort-arrow';
      arrow.textContent = '▲';
      th.appendChild(arrow);

      th.addEventListener('click', () => {
        // Cycle direction: none → desc → asc → desc ...
        // Default to desc first since higher scores are usually better
        if (currentSortCol === colIndex) {
          currentSortDir = currentSortDir === -1 ? 1 : -1;
        } else {
          currentSortCol = colIndex;
          currentSortDir = -1;
        }

        // Update arrow indicators on all headers
        ths.forEach((h, i) => {
          const a = h.querySelector('.llm-sort-arrow');
          if (!a) return;
          if (i === colIndex) {
            h.setAttribute('data-sort-dir', currentSortDir === 1 ? 'asc' : 'desc');
            a.textContent = currentSortDir === 1 ? '▲' : '▼';
          } else {
            h.removeAttribute('data-sort-dir');
            a.textContent = '▲';
          }
        });

        // Sort the rows
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const isNumeric = rows.some((r) => {
          const cells = r.querySelectorAll('td');
          if (colIndex >= cells.length) return false;
          return Number.isFinite(parseCellValue(cells[colIndex]).num);
        });

        rows.sort((a, b) => {
          const cellsA = a.querySelectorAll('td');
          const cellsB = b.querySelectorAll('td');
          if (colIndex >= cellsA.length || colIndex >= cellsB.length) return 0;

          const valA = parseCellValue(cellsA[colIndex]);
          const valB = parseCellValue(cellsB[colIndex]);

          let cmp = 0;
          if (isNumeric) {
            // Push NaN/empty to the bottom regardless of sort direction
            const aValid = Number.isFinite(valA.num);
            const bValid = Number.isFinite(valB.num);
            if (!aValid && !bValid) cmp = 0;
            else if (!aValid) return 1; // always after valid
            else if (!bValid) return -1;
            else cmp = valA.num - valB.num;
          } else {
            cmp = valA.text.localeCompare(valB.text);
          }

          return cmp * currentSortDir;
        });

        // Re-insert sorted rows
        for (const row of rows) {
          tbody.appendChild(row);
        }

        console.log(LOG, `Sorted by column ${colIndex} (${th.textContent.trim()}), dir=${currentSortDir === 1 ? 'asc' : 'desc'}`);
      });
    });

    console.log(LOG, `Sorting enabled on ${ths.length} columns.`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EXPORT (CSV + CLIPBOARD)
  // ═══════════════════════════════════════════════════════════════════

  GM_addStyle(`
    .llm-export-toolbar {
      display: flex;
      gap: 8px;
      padding: 8px 0;
    }
    .llm-export-toolbar button {
      padding: 6px 14px;
      border: 1px solid #555;
      border-radius: 6px;
      background: #2a2a3e;
      color: #e0e0e0;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .llm-export-toolbar button:hover {
      background: #3a3a52;
    }
    .llm-export-toolbar .llm-export-feedback {
      align-self: center;
      font-size: 12px;
      opacity: 0.7;
      transition: opacity 0.3s;
    }
  `);

  /**
   * Escapes a value for safe CSV embedding.
   * Wraps in quotes if it contains commas, quotes, or newlines.
   */
  function csvEscape(val) {
    if (val.includes('"') || val.includes(',') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  /**
   * Extracts table data as a 2D string array (headers + body rows).
   * Reads from the current DOM order (respects active sort).
   */
  function tableToGrid(table) {
    const grid = [];

    // Headers — use last header row (skips grouped header rows)
    const thead = table.querySelector('thead');
    if (thead) {
      const headerRows = thead.querySelectorAll('tr');
      const headerRow = headerRows[headerRows.length - 1];
      const headerCells = headerRow.querySelectorAll('th');
      const headers = Array.from(headerCells).map((th) => {
        // Strip the sort arrow we injected
        let text = th.textContent.trim();
        text = text.replace(/[▲▼]$/, '').trim();
        return text;
      });
      grid.push(headers);
    }

    // Body rows in current DOM order
    const tbody = table.querySelector('tbody');
    if (tbody) {
      for (const row of tbody.querySelectorAll('tr')) {
        const cells = Array.from(row.querySelectorAll('td'))
          .map((td) => td.textContent.trim());
        grid.push(cells);
      }
    }

    return grid;
  }

  /**
   * Converts a 2D grid to a CSV string.
   */
  function gridToCsv(grid) {
    return grid.map((row) => row.map(csvEscape).join(',')).join('\n');
  }

  /**
   * Converts a 2D grid to a TSV string (for pasting into spreadsheets).
   */
  function gridToTsv(grid) {
    return grid.map((row) => row.join('\t')).join('\n');
  }

  /**
   * Shows brief feedback text next to the export buttons.
   */
  function flashFeedback(toolbar, message) {
    let feedback = toolbar.querySelector('.llm-export-feedback');
    if (!feedback) {
      feedback = document.createElement('span');
      feedback.className = 'llm-export-feedback';
      toolbar.appendChild(feedback);
    }
    feedback.textContent = message;
    feedback.style.opacity = '1';
    setTimeout(() => { feedback.style.opacity = '0'; }, 2000);
  }

  /**
   * Creates the export toolbar with CSV download and copy buttons.
   * Returns the toolbar element to insert into the DOM.
   */
  function createExportToolbar(table) {
    const toolbar = document.createElement('div');
    toolbar.className = 'llm-export-toolbar';

    // CSV download button
    const csvBtn = document.createElement('button');
    csvBtn.textContent = 'Export CSV';
    csvBtn.addEventListener('click', () => {
      const grid = tableToGrid(table);
      const csv = gridToCsv(grid);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `llm-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      flashFeedback(toolbar, `Exported ${grid.length - 1} rows`);
      console.log(LOG, `CSV exported: ${grid.length - 1} rows.`);
    });

    // Copy to clipboard button (TSV for spreadsheet paste compatibility)
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy Table';
    copyBtn.addEventListener('click', async () => {
      const grid = tableToGrid(table);
      const tsv = gridToTsv(grid);
      try {
        await navigator.clipboard.writeText(tsv);
        flashFeedback(toolbar, `Copied ${grid.length - 1} rows`);
        console.log(LOG, `Table copied to clipboard: ${grid.length - 1} rows.`);
      } catch (err) {
        // Fallback for contexts where clipboard API is blocked
        console.error(LOG, 'Clipboard write failed:', err);
        flashFeedback(toolbar, 'Copy failed — check console');
      }
    });

    toolbar.appendChild(csvBtn);
    toolbar.appendChild(copyBtn);
    return toolbar;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PAGINATION HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Waits for the table content to change after a navigation click.
   * Uses MutationObserver on the tbody for reliable detection,
   * with a rAF poll fallback.
   */
  function waitForTableUpdate(previousFirstRowText) {
    return new Promise((resolve) => {
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
      const start = Date.now();
      function poll() {
        if (resolved) return;
        if (hasChanged()) { done(); return; }
        if (Date.now() - start > WAIT_TIMEOUT_MS) { done(); return; }
        requestAnimationFrame(poll);
      }
      requestAnimationFrame(poll);

      // Hard timeout safety net
      setTimeout(done, WAIT_TIMEOUT_MS);
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

      // Wait for table content to update, then a short settle for React
      await waitForTableUpdate(currentFirstRow);
      await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));

      // Collect rows from this page
      const pageRows = extractTableRows();
      allRows.push(...pageRows);
      console.log(LOG, `Page ${page}: collected ${pageRows.length} rows (total: ${allRows.length}).`);
      updateBanner(banner, Math.min(allRows.length, totalModels), totalModels);

      // If we've collected enough rows, stop early without waiting for
      // the next iteration's button check (avoids the slow last-page timeout)
      if (allRows.length >= totalModels) {
        console.log(LOG, 'Collected enough rows, stopping early.');
        break;
      }
    }

    // Deduplicate in case of overlap
    const uniqueRows = deduplicateRows(allRows);
    console.log(LOG, `Collected ${allRows.length} rows, ${uniqueRows.length} unique after dedup.`);

    // Inject all rows into the DOM while preventing React from blanking
    // the page. Strategy: find the nearest React-controlled ancestor of
    // the table, hide it, and insert our static content as a sibling.
    // React can re-render all it wants inside the hidden container.
    const origTable = document.querySelector('table');
    if (!origTable) {
      console.error(LOG, 'Table not found for row replacement.');
      completeBanner(banner, uniqueRows.length);
      return;
    }

    // Walk up to find the scrollable/overflow container that wraps the table.
    // This is typically the element React controls for the whole data-table
    // component (table + pagination + chrome).
    let reactContainer = origTable.parentElement;
    while (reactContainer && reactContainer !== document.body) {
      const style = window.getComputedStyle(reactContainer);
      // Stop at the first element that looks like a self-contained section
      // (has overflow handling or is a direct child of main/body-level wrapper)
      if (
        style.overflow !== 'visible' ||
        style.overflowX !== 'visible' ||
        reactContainer.parentElement === document.body ||
        reactContainer.parentElement?.tagName === 'MAIN'
      ) {
        break;
      }
      reactContainer = reactContainer.parentElement;
    }

    console.log(LOG, 'React container to hide:', reactContainer?.tagName, reactContainer?.className);

    // Build our static table: clone the header, insert all collected rows
    const staticTable = origTable.cloneNode(false);
    for (const child of origTable.children) {
      if (child.tagName === 'TBODY') {
        const newTbody = document.createElement('tbody');
        for (const row of uniqueRows) {
          newTbody.appendChild(row);
        }
        staticTable.appendChild(newTbody);
      } else {
        staticTable.appendChild(child.cloneNode(true));
      }
    }

    // Create a wrapper for our static content
    const staticWrapper = document.createElement('div');
    staticWrapper.id = 'llm-show-all-static';

    // Add a summary line above the table
    const summary = document.createElement('p');
    summary.style.cssText = 'padding: 4px 0 0; font-size: 14px; opacity: 0.7;';
    summary.textContent = `Showing all ${uniqueRows.length} of ${totalModels} models`;
    staticWrapper.appendChild(summary);

    // Add export toolbar (CSV download + copy to clipboard)
    staticWrapper.appendChild(createExportToolbar(staticTable));

    // Copy the scrollable wrapper styling from the original table's parent
    const tableParent = origTable.parentElement;
    if (tableParent) {
      const scrollWrap = document.createElement('div');
      scrollWrap.style.cssText = window.getComputedStyle(tableParent).cssText;
      // Ensure it scrolls horizontally like the original
      scrollWrap.style.overflowX = 'auto';
      scrollWrap.style.maxWidth = '100%';
      scrollWrap.appendChild(staticTable);
      staticWrapper.appendChild(scrollWrap);
    } else {
      staticWrapper.appendChild(staticTable);
    }

    // Enable column sorting on the static table before inserting
    enableSorting(staticTable);

    // Insert our static wrapper and hide the React-controlled container
    reactContainer.parentNode.insertBefore(staticWrapper, reactContainer);
    reactContainer.style.display = 'none';

    // Disconnect React's ability to re-render by removing its internal
    // fiber key from the root. This is a best-effort safeguard.
    const reactRoot = document.getElementById('__next') || document.getElementById('root');
    if (reactRoot) {
      const fiberKey = Object.keys(reactRoot).find((k) => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        console.log(LOG, 'Disconnecting React fiber to prevent re-renders.');
        delete reactRoot[fiberKey];
      }
    }

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
