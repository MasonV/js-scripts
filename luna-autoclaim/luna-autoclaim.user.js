// ==UserScript==
// @name         Luna Autoclaim
// @namespace    luna-autoclaim
// @version      0.5.1
// @description  Bulk-reveal and bulk-redeem keys on Luna
// @include      /^https:\/\/luna\.amazon\.[a-z.]{2,6}\/claims\/(home|[^\/]+\/dp\/)/
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
// Path arm 1 — home listing:  /claims/home…
// Path arm 2 — claim detail:  /claims/<slug>/dp/…

(function () {
  "use strict";

  const SCRIPT_VERSION = "0.5.1";
  const META_URL =
    "https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.meta.js";
  const DOWNLOAD_URL =
    "https://raw.githubusercontent.com/MasonV/js-scripts/main/luna-autoclaim/luna-autoclaim.user.js";

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
   * Detect which store the current claim page is for.
   * Checks all p[title] elements to avoid false-positives from unrelated elements.
   */
  function detectStore() {
    const pTitles = Array.from(document.querySelectorAll("p[title]")).map((p) =>
      p.getAttribute("title"),
    );
    const match = STORE_PATTERNS.find(([pattern]) => pTitles.some((t) => t.includes(pattern)));
    return match ? match[1] : null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CORE ACTIONS — HOME PAGE
  // ═══════════════════════════════════════════════════════════════════

  async function openAllClaims({ autoClaim = false } = {}) {
    const claimButtons = findButtonsByText("Claim game");
    if (claimButtons.length === 0) {
      log('No "Claim Game" buttons found — all keys may already be redeemed');
      updateStatus("No keys to reveal");
      return;
    }

    log(`Found ${claimButtons.length} key(s) to claim (autoClaim=${autoClaim})`);
    updateStatus(`Opening 0/${claimButtons.length}...`);
    setButtonsEnabled(false);

    for (let i = 0; i < claimButtons.length; i++) {
      const btn = claimButtons[i];
      const gameName = getGameName(btn);

      logItem(`Opening ${i + 1}/${claimButtons.length}: ${gameName}`);
      updateStatus(`Opening ${i + 1}/${claimButtons.length}: ${gameName}`);

      const url = new URL(btn.href);
      if (autoClaim) url.searchParams.set("lac_autoclaim", "1");
      GM_openInTab(url.toString(), { active: false });

      if (i < claimButtons.length - 1) {
        await sleep(revealDelayMs);
      }
    }

    await sleep(revealDelayMs);
    log("All claim pages opened");
    updateStatus(`Opened ${claimButtons.length} claim page(s)`);
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

    btn.click();

    await sleep(redeemDelayMs);
    log("Claim submitted");
    updateStatus("Claim submitted");
    setButtonsEnabled(true);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI — SHARED
  // ═══════════════════════════════════════════════════════════════════

  let statusEl = null;
  let claimBtn = null;
  let autoClaimBtn = null;

  function updateStatus(text) {
    if (statusEl) statusEl.textContent = text;
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

            #lac-update-banner:hover { background: #ffb74d; }
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

  function init() {
    log(`v${SCRIPT_VERSION} loaded`);
    checkForUpdate();

    const path = window.location.pathname;

    if (/\/claims\/home/.test(path)) {
      waitForOrderContent(() => {
        injectStyles();
        createPanel();
        const claimCount = findButtonsByText("Claim game").length;
        log(`Found ${claimCount} to claim`);
        updateStatus(`${claimCount} to claim`);
      });
      return;
    }

    if (/\/claims\/.+\/dp\//.test(path)) {
      waitForClaimPageContent(() => {
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
  }

  init();
})();
