// ==UserScript==
// @name         Luna Autoclaim
// @namespace    luna-autoclaim
// @version      0.2.1
// @description  Bulk-reveal and bulk-redeem keys on Luna
// @match        https://luna.amazon.com/claims/home*
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

(function () {
  "use strict";

  const SCRIPT_VERSION = "0.2.1";
  const META_URL =
    "https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js";
  const DOWNLOAD_URL =
    "https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js";

  const LOG_PREFIX = "[Luna Autoclaim]";
  const SHORT_PREFIX = "[LAC]";

  const DEFAULT_REVEAL_DELAY_MS = 500;
  const DEFAULT_REDEEM_DELAY_MS = 800;

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
  function error(...args) {
    console.error(LOG_PREFIX, ...args);
  }
  function logItem(...args) {
    console.log(SHORT_PREFIX, ...args);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UPDATE CHECK
  // ═══════════════════════════════════════════════════════════════════

  function checkForUpdate() {
    try {
      GM_xmlhttpRequest({
        method: "GET",
        url: META_URL + "?_=" + Date.now(),
        onload(resp) {
          if (resp.status !== 200) return;
          const match = resp.responseText.match(/@version\s+(\S+)/);
          if (!match) return;
          const remote = match[1];
          if (remote !== SCRIPT_VERSION) {
            log(`Update available: v${SCRIPT_VERSION} → v${remote}`);
            showUpdateBanner(remote);
          } else {
            log(`Up to date (v${SCRIPT_VERSION})`);
          }
        },
        onerror() {
          warn("Update check failed (network error)");
        },
      });
    } catch (e) {
      warn("Update check unavailable:", e);
    }
  }

  function showUpdateBanner(version) {
    const banner = document.createElement("div");
    banner.id = "lac-update-banner";
    banner.textContent = `Luna Autoclaim v${version} available — click to update`;
    banner.addEventListener("click", () => window.open(DOWNLOAD_URL, "_blank"));
    document.body.appendChild(banner);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Find all buttons whose visible text matches the given string (case-insensitive).
   * Searches both <button> and <a> elements since Fanatical uses both.
   */
  function findButtonsByText(text) {
    const candidates = document.querySelectorAll(
      '.item-card__claim-button a.tw-button[data-a-target="FGWPOffer"]',
    );
    return Array.from(candidates).filter((el) => {
      const elText = el.textContent.trim();
      return elText === text;
    });
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

  // ═══════════════════════════════════════════════════════════════════
  //  CORE ACTIONS
  // ═══════════════════════════════════════════════════════════════════

  async function openAllClaims() {
    const claimButtons = findButtonsByText("Claim game");
    if (claimButtons.length === 0) {
      log('No "Claim Game" buttons found — all keys may already be redeemed');
      updateStatus("No keys to reveal");
      return;
    }

    log(`Found ${claimButtons.length} key(s) to claim`);
    updateStatus(`Claiming 0/${claimButtons.length}...`);
    setButtonsEnabled(false);

    for (let i = 0; i < claimButtons.length; i++) {
      const btn = claimButtons[i];
      const gameName = getGameName(btn);

      logItem(`Opening ${i + 1}/${claimButtons.length}: ${gameName}`);
      updateStatus(`Opening ${i + 1}/${claimButtons.length}: ${gameName}`);

      GM_openInTab(btn.href, { active: false });

      // Wait for the reveal to process before clicking the next one
      if (i < claimButtons.length - 1) {
        await sleep(revealDelayMs);
      }
    }

    // Wait a moment for the last reveal to render
    await sleep(revealDelayMs);
    log("All keys claimed");
    updateStatus(`Revealed ${claimButtons.length} key(s)`);
    setButtonsEnabled(true);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI
  // ═══════════════════════════════════════════════════════════════════

  let statusEl = null;
  let claimBtn = null;
  //   let redeemBtn = null
  //   let revealAndRedeemBtn = null

  function updateStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // leaving as for loop in case I add more buttons back
  function setButtonsEnabled(enabled) {
    [claimBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? "1" : "0.5";
      btn.style.pointerEvents = enabled ? "auto" : "none";
    });
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

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "lac-panel";

    const header = document.createElement("div");
    header.id = "lac-header";

    const title = document.createElement("div");
    title.id = "lac-title";
    title.textContent = "Autoclaim";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.id = "lac-close-btn";
    closeBtn.textContent = "\u00D7";
    closeBtn.title = "Close panel";
    closeBtn.addEventListener("click", () => panel.remove());
    header.appendChild(closeBtn);

    panel.appendChild(header);

    claimBtn = document.createElement("button");
    claimBtn.id = "lac-claim-btn";
    claimBtn.className = "lac-btn";
    claimBtn.textContent = "Open All";
    claimBtn.addEventListener("click", openAllClaims);
    panel.appendChild(claimBtn);

    const delaySection = document.createElement("div");
    delaySection.id = "lac-delays";
    delaySection.appendChild(
      createDelayInput("Reveal delay", DEFAULT_REVEAL_DELAY_MS, (v) => {
        revealDelayMs = v;
      }),
    );
    delaySection.appendChild(
      createDelayInput("Redeem delay", DEFAULT_REDEEM_DELAY_MS, (v) => {
        redeemDelayMs = v;
      }),
    );
    panel.appendChild(delaySection);

    statusEl = document.createElement("div");
    statusEl.id = "lac-status";
    statusEl.textContent = "Ready";
    panel.appendChild(statusEl);

    document.body.appendChild(panel);
  }

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

            #lac-close-btn:hover {
                color: #eee;
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

            .lac-btn:hover {
                background: #616161;
            }

            .lac-btn-primary {
                background: #ff9800;
                color: #212121;
                border-color: #ff9800;
                font-weight: 700;
            }

            .lac-btn-primary:hover {
                background: #ffb74d;
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

            #lac-status {
                font-size: 12px;
                color: #9e9e9e;
                text-align: center;
                min-height: 16px;
            }

            #lac-update-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 10001;
                background: #ff9800;
                color: #212121;
                text-align: center;
                padding: 8px 16px;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                font-family: Lato, 'Open Sans', sans-serif;
            }

            #lac-update-banner:hover {
                background: #ffb74d;
            }
        `);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Wait for the React app to render order content before injecting the panel.
   * Polls for the presence of key-related buttons (REVEAL KEY or REDEEM ON STEAM).
   */
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
        // Still inject the panel — the user might have a slow connection
        callback();
      }
    }, 500);
  }

  function init() {
    log(`v${SCRIPT_VERSION} loaded`);
    checkForUpdate();

    waitForOrderContent(() => {
      injectStyles();
      createPanel();

      const claimCount = findButtonsByText("Claim game").length;
      log(`Found ${claimCount} to claim`);
      updateStatus(`${claimCount} to claim`);
    });
  }

  init();
})();
