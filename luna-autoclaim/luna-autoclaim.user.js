// ==UserScript==
// @name         Luna Autoclaim
// @namespace    luna-autoclaim
// @version      1.0.0
// @description  Bulk-reveal and bulk-redeem keys on Luna
// @match        https://luna.amazon.ca/claims/*
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

  const SCRIPT_VERSION = "1.0.0";
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
    banner.id = "fac-update-banner";
    banner.textContent = `Fanatical Autoclaim v${version} available — click to update`;
    banner.addEventListener("click", () => window.open(DOWNLOAD_URL, "_blank"));
    document.body.appendChild(banner);
  }

  function clickClaimButton() {
    // Select all potential claim buttons based on the original selector
    const claimButtonSelector =
      '.item-card__claim-button a.tw-button[data-a-target="FGWPOffer"]';
    const claimButtons = document.querySelectorAll(claimButtonSelector);

    if (claimButtons.length === 0) {
      console.error(
        "No claim buttons found with the specified selector:",
        claimButtonSelector,
      );
      return;
    }

    console.log(
      `Found ${claimButtons.length} claim button(s). Attempting to click sequentially...`,
    );

    let index = 0;
    const clickNextButton = () => {
      if (index >= claimButtons.length) {
        console.log("Finished attempting to click all found claim buttons.");
        return;
      }

      const claimButton = claimButtons[index];
      console.log(
        `Attempting to click button ${index + 1}/${claimButtons.length}...`,
      );

      // Programmatically trigger a click event
      claimButton.click();
      console.log("Click event dispatched.");

      index++;
      // Recursively call after a short delay to mimic user behavior/allow DOM updates
      setTimeout(clickNextButton, 100);
    };

    // Start the process
    clickNextButton();
  }

  clickClaimButton();
});
