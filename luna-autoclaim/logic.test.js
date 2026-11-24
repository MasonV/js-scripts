// Tests for the PURE LOGIC section of luna-autoclaim.user.js.
// The section's source is sliced out of the userscript and evaluated as-is,
// so these tests can't drift from the shipped code.
//
//   node --test luna-autoclaim/logic.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STORE_PATTERNS = [
  ["on Amazon Games", "Amazon Games"],
  ["on Epic Games Store", "Epic Games"],
  ["on GOG.com", "GOG"],
  ["on Legacy Games", "Legacy Games"],
  ["on Microsoft Store", "Microsoft Store"],
];

function loadPureLogic() {
  const src = fs.readFileSync(path.join(__dirname, "luna-autoclaim.user.js"), "utf8");
  const start = src.indexOf("//  PURE LOGIC");
  assert.ok(start > 0, "PURE LOGIC section not found");
  const bodyStart = src.indexOf("\n", src.indexOf("// ═", start)) + 1;
  const end = src.indexOf("// ═", bodyStart);
  const body = src.slice(bodyStart, end);
  const names = [
    "matchStore",
    "describeSeenStoresFromTitles",
    "partitionClaimItems",
    "pickNextClaim",
    "describePlan",
    "describeProgress",
  ];
  // eslint-disable-next-line no-new-func
  return new Function("STORE_PATTERNS", `${body}\nreturn { ${names.join(", ")} }`)(STORE_PATTERNS);
}

const L = loadPureLogic();

test("matchStore identifies single known store and rejects none or multiple", () => {
  assert.equal(L.matchStore(["Free game on GOG.com"]), "GOG");
  assert.equal(L.matchStore(["Redeem on Epic Games Store"]), "Epic Games");
  assert.equal(L.matchStore(["Claim on Amazon Games"]), "Amazon Games");
  assert.equal(L.matchStore(["Available on Legacy Games"]), "Legacy Games");
  assert.equal(L.matchStore(["Available on Microsoft Store"]), "Microsoft Store");
  assert.equal(L.matchStore(["No matching store"]), null);
  assert.equal(L.matchStore(["on GOG.com", "on Epic Games Store"]), null);
});

test("describeSeenStoresFromTitles extracts on-Store labels", () => {
  assert.equal(L.describeSeenStoresFromTitles(["on Steam", "Other text", "on Steam"]), '"on Steam"');
  assert.equal(L.describeSeenStoresFromTitles(["Nothing relevant"]), "no store label");
  assert.equal(L.describeSeenStoresFromTitles([]), "no store label");
});

test("partitionClaimItems separates enabled, skipped, and unknown-store entries", () => {
  const items = [
    { href: "https://luna.amazon.com/claims/g1/dp/1", gameName: "Game 1", store: "GOG" },
    { href: "https://luna.amazon.com/claims/g2/dp/2", gameName: "Game 2", store: "Epic Games" },
    { href: "https://luna.amazon.com/claims/g3/dp/3", gameName: "Game 3", store: null },
  ];
  const disabled = new Set(["Epic Games"]);
  const plan = L.partitionClaimItems(items, disabled);
  assert.equal(plan.toOpen.length, 2);
  assert.equal(plan.toOpen[0].gameName, "Game 1");
  assert.equal(plan.toOpen[1].gameName, "Game 3");
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].gameName, "Game 2");
  assert.equal(plan.unknown, 1);
});

test("pickNextClaim advances one item at a time and tracks opened count", () => {
  const toOpen = [
    { href: "https://luna.amazon.com/claims/g1/dp/1", gameName: "Game 1", store: "GOG" },
    { href: "https://luna.amazon.com/claims/g2/dp/2", gameName: "Game 2", store: "GOG" },
    { href: "https://luna.amazon.com/claims/g3/dp/3", gameName: "Game 3", store: "GOG" },
  ];
  const opened = new Set();

  let step = L.pickNextClaim(toOpen, opened);
  assert.equal(step.next.gameName, "Game 1");
  assert.equal(step.openedCount, 0);
  assert.equal(step.total, 3);

  opened.add(step.next.href);
  step = L.pickNextClaim(toOpen, opened);
  assert.equal(step.next.gameName, "Game 2");
  assert.equal(step.openedCount, 1);

  opened.add(step.next.href);
  step = L.pickNextClaim(toOpen, opened);
  assert.equal(step.next.gameName, "Game 3");
  assert.equal(step.openedCount, 2);

  opened.add(step.next.href);
  step = L.pickNextClaim(toOpen, opened);
  assert.equal(step.next, null);
  assert.equal(step.openedCount, 3);
});

test("describePlan and describeProgress format counts with optional skipped and unknown", () => {
  const simplePlan = { toOpen: [{}, {}, {}], skipped: [], unknown: 0 };
  assert.equal(L.describePlan(simplePlan, "To open:"), "To open: 3");
  assert.equal(L.describeProgress(1, simplePlan), "Opened 1 of 3");
  assert.equal(L.describeProgress(3, simplePlan), "Opened 3 of 3");

  const mixedPlan = { toOpen: [{}, {}], skipped: [{}], unknown: 1 };
  assert.equal(
    L.describePlan(mixedPlan, "To open:"),
    "To open: 2 · skipped 1 (store set to Skip) · 1 store unknown",
  );
  assert.equal(
    L.describeProgress(2, mixedPlan),
    "Opened 2 of 2 · skipped 1 (store set to Skip) · 1 store unknown",
  );
});

function loadGetGameName() {
  const src = fs.readFileSync(path.join(__dirname, "luna-autoclaim.user.js"), "utf8");
  const match = src.match(/function getGameName\(btn\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(match, "getGameName not found");
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}\nreturn getGameName;`)();
}

test("getGameName prefers h3[title] and falls back to h3 textContent or unknown", () => {
  const getGameName = loadGetGameName();
  const makeBtn = (h3) => ({
    closest(sel) {
      if (sel !== ".item-card-details") return null;
      return {
        querySelector(q) {
          assert.equal(q, "h3");
          return h3;
        },
      };
    },
  });

  assert.equal(
    getGameName(
      makeBtn({
        getAttribute: (attr) => (attr === "title" ? "  Dishonored 2  " : null),
        textContent: "Ignored Text",
      }),
    ),
    "Dishonored 2",
  );

  assert.equal(
    getGameName(
      makeBtn({
        getAttribute: () => null,
        textContent: "  BioShock Remastered  ",
      }),
    ),
    "BioShock Remastered",
  );

  assert.equal(
    getGameName(
      makeBtn({
        getAttribute: () => "   ",
        textContent: "Fallback From Blank Title",
      }),
    ),
    "Fallback From Blank Title",
  );

  assert.equal(getGameName(makeBtn(null)), "unknown");
  assert.equal(getGameName({ closest: () => null }), "unknown");
});

test("SPA navigation clears active waitInterval when changing or leaving routes", () => {
  const src = fs.readFileSync(path.join(__dirname, "luna-autoclaim.user.js"), "utf8");
  const start = src.indexOf("let waitInterval = null;");
  const end = src.indexOf("function watchForNavigation()");
  assert.ok(start > 0 && end > start, "SPA navigation section not found");
  const snippet = src.slice(start, end);

  let nextId = 1;
  const active = new Map();
  const cleared = [];
  const win = { location: { pathname: "/claims/home" } };

  // eslint-disable-next-line no-new-func
  const harness = new Function(
    "window",
    "document",
    "setInterval",
    "clearInterval",
    "findButtonsByText",
    "removePanel",
    "injectStyles",
    "createPanel",
    "refreshListingStatus",
    "detectStore",
    "describeSeenStores",
    "createClaimPagePanel",
    "openedUrls",
    "log",
    "warn",
    `
    let claimBtn = null;
    ${snippet}
    return {
      handleRoute,
      teardownPanel,
      getWaitInterval: () => waitInterval,
    };
    `,
  )(
    win,
    { querySelector: () => null },
    (fn) => {
      const id = nextId++;
      active.set(id, fn);
      return id;
    },
    (id) => {
      if (id != null) {
        cleared.push(id);
        active.delete(id);
      }
    },
    () => [],
    () => {},
    () => {},
    () => {},
    () => {},
    () => "GOG",
    () => "",
    () => {},
    new Set(),
    () => {},
    () => {},
  );

  harness.handleRoute();
  assert.equal(harness.getWaitInterval(), 1);
  assert.equal(active.size, 1);

  // Navigate to a claim detail route before home wait finishes
  win.location.pathname = "/claims/game-a/dp/1";
  harness.handleRoute();
  assert.ok(cleared.includes(1), "previous interval 1 should be cleared");
  assert.equal(harness.getWaitInterval(), 2);
  assert.equal(active.size, 1);

  // Navigate away to a non-claim page
  win.location.pathname = "/ detail";
  harness.handleRoute();
  assert.ok(cleared.includes(2), "previous interval 2 should be cleared");
  assert.equal(harness.getWaitInterval(), null);
  assert.equal(active.size, 0);
});
