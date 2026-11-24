// The production functions have no module system, so extract their marked source
// sections and evaluate them with the same small state surface the userscript uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, 'barter-bundle-scorer.user.js'), 'utf8');

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not find source markers: ${startMarker} / ${endMarker}`);
  return source.slice(start, end);
}

const statsViewLogic = between('  const STAT_CARD_DEFS =', '\n  // ═══════════════════════════════════════════════════════════════════\n  //  STATS VIEW PERSISTENCE');
const pureLogic = between('// PURE FUNCTIONS — START', '// PURE FUNCTIONS — END');
const classifyLogic = between('  const DLC_KEYWORDS =', '\n  function extractGame');
const scoringLogic = between('  function scoreGame(g)', '\n  // ═══════════════════════════════════════\n  // BUNDLE COST DETECTION');
const bundleCostLogic = between('  function parseBundleCostFromText(', '\n  // ═══════════════════════════════════════\n  // BUNDLE-LEVEL SCORES');
const bundleLogic = between('  function computeBundleScores(scored, ownedSet)', '\n  // ═══════════════════════════════════════\n  // HISTOGRAM');
const histogramLogic = between('  function buildHistogramHTML(scored)', '\n  // ═══════════════════════════════════════\n  // SETTINGS HTML');
const currencyDefs = between('  const CURRENCY_DEFS =', '\n\n  function detectTiers');
const currencyLogic = between('  function formatTierPrice(tier, currencyPref)', '\n  function collectAvailableCurrencies');
const statsDashboardLogic = between('  function buildStatsDashboardHTML(', '\n  function renderStatsDashboard(');
const pageVisibilityLogic = between('  function hideOriginalPage()', '\n  function setPage(mode)');
const ownedKeysLogic = between('  const STORAGE_KEY_OWNED', '\n  const STORAGE_KEY_SETTINGS');
const ownedPersistenceLogic = between('  function loadOwnedOverrides()', '\n  // ═══════════════════════════════════════\n  // DOM: TABLE DETECTION');

const localStore = new Map();
const sandbox = {
  SETTINGS: {},
  CURRENT_BUNDLE_COST: null,
  UPDATE_BANNER_ID: 'barter-bundle-scorer-update-banner',
  _statsViewState: { collapsed: false, hiddenCards: [] },
  _appRefs: { ownedSet: new Set() },
  _gridState: { currency: 'USD' },
  document: { body: { children: [] } },
  localStorage: {
    getItem: k => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: k => localStore.delete(k),
  },
  safeStorageSet: (k, v) => localStore.set(k, String(v)),
};
vm.createContext(sandbox);
vm.runInContext(`${ownedKeysLogic}\n${statsViewLogic}\n${pureLogic}\n${ownedPersistenceLogic}\n${classifyLogic}\n${scoringLogic}\n${bundleCostLogic}\n${bundleLogic}\n${histogramLogic}\n${currencyDefs}\n${currencyLogic}\n${statsDashboardLogic}\n${pageVisibilityLogic}\nglobalThis.__scoring = { clamp01, confidenceFromReviews, wilsonLowerBound, parseReviewCellText, classifyItem, scoreGame, scoreColor, scoreBg, scoreTierLabel, ratingColor, formatBreakdown, formatTierPrice, parseBundleCostFromText, detectBundleCost, computeBundleScores, buildStatsDashboardHTML, reRenderStats, hideOriginalPage, showOriginalPage, normalizeOwnedOverrides, resolveOwnedSet, toggleOwnedOverride, loadOwnedOverrides, saveOwnedOverrides, STORAGE_KEY_OWNED, STORAGE_KEY_OWNED_LEGACY };`, sandbox);
const {
  clamp01, confidenceFromReviews: confidenceFromProductionReviews, wilsonLowerBound, parseReviewCellText: parseProductionReviewCellText, classifyItem: classifyProductionItem,
  scoreGame: scoreProductionGame, scoreColor, scoreBg, scoreTierLabel, ratingColor,
  formatBreakdown, formatTierPrice, parseBundleCostFromText, detectBundleCost,
  computeBundleScores: computeProductionBundleScores,
  buildStatsDashboardHTML: buildProductionStatsDashboardHTML,
  reRenderStats, hideOriginalPage, showOriginalPage,
  normalizeOwnedOverrides, resolveOwnedSet, toggleOwnedOverride,
  loadOwnedOverrides, saveOwnedOverrides, STORAGE_KEY_OWNED, STORAGE_KEY_OWNED_LEGACY,
} = sandbox.__scoring;

const DEFAULT_SETTINGS = {
  useWilsonAdjustedRating: false,
  topNMain: 5, topNDepth: 10,
  msrpCap: 39.99, bundledPenaltyCap: 10, confidenceAnchor: 800,
  weights: { rating: 0.55, confidence: 0.20, value: 0.20, bundleValue: 0.15, wishlist: 0.08, rebundlePenalty: 0.20 },
};

function fakeRow(isInPackage) {
  return { previousElementSibling: isInPackage ? { textContent: '3 item package', previousElementSibling: null, querySelector: () => null } : null };
}
function parseReviewCellText(text) {
  const { ratingPct, reviews } = parseProductionReviewCellText(text);
  return { ratingPct, reviews };
}
function confidenceFromReviews(n, anchor = DEFAULT_SETTINGS.confidenceAnchor) {
  sandbox.SETTINGS = { ...DEFAULT_SETTINGS, confidenceAnchor: anchor };
  return confidenceFromProductionReviews(n);
}
function classifyItem(title, reviews, ratingPct, { isInPackage = false } = {}) {
  return classifyProductionItem(title, fakeRow(isInPackage), ratingPct, reviews);
}
function scoreGame(game, settings = DEFAULT_SETTINGS, bundleCost = null) {
  sandbox.SETTINGS = settings;
  sandbox.CURRENT_BUNDLE_COST = bundleCost;
  return scoreProductionGame(game);
}
function computeBundleScores(scored, ownedSet, settings = DEFAULT_SETTINGS, bundleCost = null) {
  sandbox.SETTINGS = settings;
  sandbox.CURRENT_BUNDLE_COST = bundleCost;
  return computeProductionBundleScores(scored, ownedSet);
}
function buildStatsDashboardHTML(bundleScores, scored, tiers = [], { ownedSet = new Set(), settings = DEFAULT_SETTINGS, bundleCost = null, viewState = { collapsed: false, hiddenCards: [] } } = {}) {
  sandbox.SETTINGS = settings;
  sandbox.CURRENT_BUNDLE_COST = bundleCost;
  sandbox._appRefs = { ownedSet };
  return buildProductionStatsDashboardHTML(bundleScores, scored, tiers, viewState);
}

// ═══════════════════════════════════════
// TESTS
// ═══════════════════════════════════════

describe('clamp01', () => {
  it('clamps negative values to 0', () => {
    assert.equal(clamp01(-5), 0);
    assert.equal(clamp01(-0.001), 0);
    assert.equal(clamp01(-Infinity), 0);
  });

  it('clamps values above 1 to 1', () => {
    assert.equal(clamp01(1.5), 1);
    assert.equal(clamp01(100), 1);
    assert.equal(clamp01(Infinity), 1);
  });

  it('passes through values in [0, 1]', () => {
    assert.equal(clamp01(0), 0);
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(1), 1);
  });
});

describe('confidenceFromReviews', () => {
  it('returns 0 for null/undefined/zero/negative reviews', () => {
    assert.equal(confidenceFromReviews(null), 0);
    assert.equal(confidenceFromReviews(undefined), 0);
    assert.equal(confidenceFromReviews(0), 0);
    assert.equal(confidenceFromReviews(-10), 0);
  });

  it('returns 50% at the anchor point', () => {
    assert.equal(confidenceFromReviews(800, 800), 0.5);
  });

  it('increases with more reviews', () => {
    const low = confidenceFromReviews(100);
    const mid = confidenceFromReviews(800);
    const high = confidenceFromReviews(5000);
    assert.ok(low < mid, `${low} should be < ${mid}`);
    assert.ok(mid < high, `${mid} should be < ${high}`);
  });

  it('never exceeds 1 even with zero anchor', () => {
    assert.ok(confidenceFromReviews(1_000_000) <= 1);
    assert.equal(confidenceFromReviews(500, 0), 1);
  });

  it('respects custom anchor', () => {
    assert.equal(confidenceFromReviews(100, 100), 0.5);
  });
});

describe('wilsonLowerBound', () => {
  it('returns 0 for zero/negative/null reviews', () => {
    assert.equal(wilsonLowerBound(0.8, 0), 0);
    assert.equal(wilsonLowerBound(0.8, -5), 0);
    assert.equal(wilsonLowerBound(0.8, null), 0);
  });

  it('returns lower bound below the observed proportion', () => {
    const bound = wilsonLowerBound(0.9, 10);
    assert.ok(bound < 0.9, `Wilson bound ${bound} should be < 0.9`);
    assert.ok(bound > 0, `Wilson bound ${bound} should be > 0`);
  });

  it('converges toward observed proportion with many reviews', () => {
    const bound = wilsonLowerBound(0.85, 100_000);
    assert.ok(bound > 0.84, `With 100k reviews, bound ${bound} should be close to 0.85`);
  });

  it('penalizes low sample sizes more', () => {
    const few = wilsonLowerBound(0.9, 5);
    const many = wilsonLowerBound(0.9, 5000);
    assert.ok(few < many, `5 reviews (${few}) should give lower bound than 5000 (${many})`);
  });

  it('handles perfect rating', () => {
    const bound = wilsonLowerBound(1.0, 50);
    assert.ok(bound > 0.8, `Perfect rating with 50 reviews: ${bound}`);
    assert.ok(bound <= 1.0);
  });

  it('handles zero rating', () => {
    const bound = wilsonLowerBound(0, 50);
    assert.ok(bound >= 0, `Zero rating bound: ${bound}`);
    assert.ok(bound < 0.1);
  });

  it('handles single-review boundary', () => {
    const bound = wilsonLowerBound(1.0, 1);
    assert.ok(bound > 0 && bound < 0.5, `1 positive review bound: ${bound}`);
  });
});

describe('classifyItem', () => {
  it('classifies DLC keywords as dlc when few reviews', () => {
    assert.equal(classifyItem('Cool Soundtrack', 10, 80), 'dlc');
    assert.equal(classifyItem('Game OST', 0, null), 'dlc');
    assert.equal(classifyItem('Skin Pack Bundle', null, null), 'dlc');
    assert.equal(classifyItem('Season Pass', 49, 90), 'dlc');
    assert.equal(classifyItem('Collector\u2019s Edition Upgrade', 12, 75), 'dlc');
    assert.equal(classifyItem('Digital Art Book', 5, 100), 'dlc');
  });

  it('classifies DLC keywords as game when reviews >= threshold', () => {
    assert.equal(classifyItem('The Expansion', 50, 80), 'game');
    assert.equal(classifyItem('Deluxe Edition Adventure', 200, 90), 'game');
    assert.equal(classifyItem('DLC Quest', 1000, 95), 'game');
  });

  it('classifies package sub-items as dlc when few reviews', () => {
    assert.equal(classifyItem('Some Extra Content', 5, 80, { isInPackage: true }), 'dlc');
    assert.equal(classifyItem('Bonus Map', null, null, { isInPackage: true }), 'dlc');
  });

  it('classifies package sub-items as game when reviews >= threshold', () => {
    assert.equal(classifyItem('Real Game In Package', 50, 85, { isInPackage: true }), 'game');
    assert.equal(classifyItem('Popular Bundled Title', 500, 75, { isInPackage: true }), 'game');
  });

  it('classifies items with no rating and no reviews as package', () => {
    assert.equal(classifyItem('Mystery Bundle', null, null), 'package');
    assert.equal(classifyItem('Unknown Item', 0, null), 'package');
  });

  it('classifies normal titles with data as game', () => {
    assert.equal(classifyItem('Half-Life 3', 50000, 97), 'game');
    assert.equal(classifyItem('Indie Gem', 15, 88), 'game');
    assert.equal(classifyItem('Rated But Zero Reviews', 0, 75), 'game');
  });

  it('uses unified threshold — no gap between 10 and 100 reviews', () => {
    assert.equal(classifyItem('Expansion Pack', 49, 80), 'dlc');
    assert.equal(classifyItem('Expansion Pack', 50, 80), 'game');
    assert.equal(classifyItem('Normal Title', 49, 80, { isInPackage: true }), 'dlc');
    assert.equal(classifyItem('Normal Title', 50, 80, { isInPackage: true }), 'game');
  });
});

describe('scoreGame', () => {
  const settings = { ...DEFAULT_SETTINGS };

  it('scores a well-rated popular game highly', () => {
    const g = { ratingPct: 95, reviews: 5000, msrp: 29.99, bundledTimes: 1, wishlistedDOM: false };
    const result = scoreGame(g, settings, null);
    assert.ok(result.score > 60, `Score ${result.score} should be > 60`);
  });

  it('scores an unrated game with neutral defaults', () => {
    const g = { ratingPct: null, reviews: 0, msrp: 9.99, bundledTimes: 0, wishlistedDOM: false };
    const result = scoreGame(g, settings, null);
    assert.ok(result.breakdown.isUnrated);
    assert.equal(result.breakdown.ratingRaw, 0.5);
    assert.equal(result.breakdown.conf, 0.3);
  });

  it('applies wishlist bonus', () => {
    const base = { ratingPct: 70, reviews: 100, msrp: 15, bundledTimes: 0 };
    const noWish = scoreGame({ ...base, wishlistedDOM: false }, settings, null);
    const wish = scoreGame({ ...base, wishlistedDOM: true }, settings, null);
    assert.ok(wish.score > noWish.score, `Wishlisted ${wish.score} should be > ${noWish.score}`);
  });

  it('applies rebundle penalty and caps penalty at bundledPenaltyCap', () => {
    const base = { ratingPct: 80, reviews: 500, msrp: 20, wishlistedDOM: false };
    const fresh = scoreGame({ ...base, bundledTimes: 0 }, settings, null);
    const stale = scoreGame({ ...base, bundledTimes: 10 }, settings, null);
    const overCap = scoreGame({ ...base, bundledTimes: 50 }, settings, null);
    assert.ok(fresh.score > stale.score, `Fresh ${fresh.score} should be > rebundled ${stale.score}`);
    assert.equal(stale.breakdown.pen, 1);
    assert.equal(overCap.breakdown.pen, 1);
    assert.equal(stale.score, overCap.score);
  });

  it('score is never negative', () => {
    const g = { ratingPct: 5, reviews: 1, msrp: 0, bundledTimes: 100, wishlistedDOM: false };
    const result = scoreGame(g, settings, null);
    assert.ok(result.score >= 0, `Score ${result.score} should be >= 0`);
  });

  it('uses bundle cost for bundleValue when provided and floors tiny bundleCost at 0.01', () => {
    const g = { ratingPct: 80, reviews: 500, msrp: 30, bundledTimes: 0, wishlistedDOM: false };
    const noCost = scoreGame(g, settings, null);
    const cheapBundle = scoreGame(g, settings, 5);
    const subCentBundle = scoreGame(g, settings, 0.001);
    assert.ok(cheapBundle.score > noCost.score || cheapBundle.breakdown.bundleValue >= noCost.breakdown.bundleValue,
      'Cheap bundle should improve bundleValue component');
    assert.equal(subCentBundle.breakdown.bundleValue, 1);
  });

  it('handles Wilson-adjusted rating mode', () => {
    const wilsonSettings = { ...settings, useWilsonAdjustedRating: true };
    const g = { ratingPct: 95, reviews: 10, msrp: 20, bundledTimes: 0, wishlistedDOM: false };
    const raw = scoreGame(g, settings, null);
    const wilson = scoreGame(g, wilsonSettings, null);
    assert.ok(wilson.score < raw.score,
      `Wilson ${wilson.score} should be < raw ${raw.score} with only 10 reviews`);
  });

  it('handles all-zero positive weights without dividing by zero', () => {
    const zeroWeightSettings = {
      ...settings,
      weights: { rating: 0, confidence: 0, value: 0, bundleValue: 0, wishlist: 0, rebundlePenalty: 0 },
    };
    const g = { ratingPct: 90, reviews: 1000, msrp: 20, bundledTimes: 2, wishlistedDOM: true };
    const result = scoreGame(g, zeroWeightSettings, 5);
    assert.equal(result.score, 0);
    assert.ok(Number.isFinite(result.score));
  });

  it('clamps MSRP above msrpCap and negative MSRP to [0, 1]', () => {
    const expensive = scoreGame({ ratingPct: 80, reviews: 100, msrp: 120, bundledTimes: 0 }, settings, null);
    const negativeMsrp = scoreGame({ ratingPct: 80, reviews: 100, msrp: -10, bundledTimes: 0 }, settings, null);
    assert.equal(expensive.breakdown.val, 1);
    assert.equal(negativeMsrp.breakdown.val, 0);
  });
});

describe('scoreColor, scoreBg, and scoreTierLabel', () => {
  it('maps score thresholds to the expected colors', () => {
    assert.equal(scoreColor(100), '#1a7f37');
    assert.equal(scoreColor(85), '#1a7f37');
    assert.equal(scoreColor(84.9), '#6e6411');
    assert.equal(scoreColor(70), '#6e6411');
    assert.equal(scoreColor(69.9), '#7c4518');
    assert.equal(scoreColor(50), '#7c4518');
    assert.equal(scoreColor(49.9), '#7a1d1d');
    assert.equal(scoreColor(0), '#7a1d1d');
  });

  it('maps score thresholds to the expected gradient backgrounds', () => {
    assert.match(scoreBg(90), /#1a7f37/);
    assert.match(scoreBg(85), /#1a7f37/);
    assert.match(scoreBg(75), /#5c5410/);
    assert.match(scoreBg(70), /#5c5410/);
    assert.match(scoreBg(60), /#6b3a14/);
    assert.match(scoreBg(50), /#6b3a14/);
    assert.match(scoreBg(49.9), /#611919/);
    assert.match(scoreBg(0), /#611919/);
  });

  it('maps score thresholds to accessibility tier labels', () => {
    assert.equal(scoreTierLabel(85), 'Great');
    assert.equal(scoreTierLabel(70), 'Good');
    assert.equal(scoreTierLabel(50), 'Fair');
    assert.equal(scoreTierLabel(49.9), 'Poor');
  });
});

describe('ratingColor', () => {
  it('maps review rating percentages to tier colors', () => {
    assert.equal(ratingColor(95), '#22863a');
    assert.equal(ratingColor(80), '#22863a');
    assert.equal(ratingColor(79.9), '#7a6d12');
    assert.equal(ratingColor(60), '#7a6d12');
    assert.equal(ratingColor(59.9), '#8a4f1f');
    assert.equal(ratingColor(40), '#8a4f1f');
    assert.equal(ratingColor(39.9), '#8a1f1f');
    assert.equal(ratingColor(0), '#8a1f1f');
  });
});

describe('formatBreakdown', () => {
  it('formats a standard rated game breakdown without Wilson suffix', () => {
    const text = formatBreakdown({
      isUnrated: false,
      ratingRaw: 0.88,
      rating: 0.88,
      conf: 0.5,
      val: 0.75,
      bundleValue: 1.0,
      wishlistBonus: 1,
      pen: 0.2,
    });
    assert.equal(
      text,
      [
        'Rating:     88%',
        'Confidence: 50.0%',
        'Value:      75.0%',
        'Bundle $:   100.0%',
        'Wishlist:  +100%',
        'Rebundle:  -20.0%',
      ].join('\n'),
    );
  });

  it('includes Wilson-adjusted rating when rating differs from ratingRaw', () => {
    const text = formatBreakdown({
      isUnrated: false,
      ratingRaw: 0.9,
      rating: 0.742,
      conf: 0.2,
      val: 0.5,
      bundleValue: 0.5,
      wishlistBonus: 0,
      pen: 0,
    });
    assert.match(text, /Rating:\s+90% \(Wilson: 74\.2%\)/);
    assert.match(text, /Wishlist:\s+\+0%/);
    assert.match(text, /Rebundle:\s+-0\.0%/);
  });

  it('formats an unrated game with neutral baseline messages', () => {
    const text = formatBreakdown({
      isUnrated: true,
      ratingRaw: 0.5,
      rating: 0.5,
      conf: 0.3,
      val: 0.25,
      bundleValue: 0.25,
      wishlistBonus: 0,
      pen: 0.1,
    });
    assert.match(text, /Rating:\s+N\/A \(unrated — using neutral 50%\)/);
    assert.match(text, /Confidence:\s+N\/A \(unrated — using 30% baseline\)/);
  });
});

describe('formatTierPrice', () => {
  it('uses preferred currency symbol when available', () => {
    const tier = { price: 9.99, prices: { USD: 9.99, EUR: 8.99, GBP: 7.49, CAD: 12.99 } };
    assert.equal(formatTierPrice(tier, 'EUR'), '\u20AC8.99');
    assert.equal(formatTierPrice(tier, 'GBP'), '\u00A37.49');
    assert.equal(formatTierPrice(tier, 'CAD'), 'C$12.99');
  });

  it('falls back to currency code prefix when currency is not in CURRENCY_DEFS', () => {
    const tier = { price: 10, prices: { JPY: 1500 } };
    assert.equal(formatTierPrice(tier, 'JPY'), 'JPY1500.00');
  });

  it('falls back to USD when preferred currency is missing or empty', () => {
    const tier = { price: 9.99, prices: { EUR: 8.99, USD: 9.99 } };
    assert.equal(formatTierPrice(tier, 'AUD'), '$9.99');
    assert.equal(formatTierPrice(tier, ''), '$9.99');
  });

  it('falls back to first available currency when USD is not in prices', () => {
    const tier = { price: 8.5, prices: { EUR: 8.5, GBP: 7.25 } };
    assert.equal(formatTierPrice(tier, 'CAD'), '\u20AC8.50');
  });

  it('falls back to scalar tier.price when prices map is empty or missing', () => {
    assert.equal(formatTierPrice({ price: 4.99, prices: {} }, 'USD'), '$4.99');
    assert.equal(formatTierPrice({ price: 12, prices: null }, ''), '$12.00');
  });

  it('returns null when neither prices nor tier.price is present', () => {
    assert.equal(formatTierPrice({ price: null, prices: {} }, 'USD'), null);
    assert.equal(formatTierPrice({ price: undefined }, 'USD'), null);
  });
});

describe('computeBundleScores', () => {
  it('excludes DLC/packages and owned games from personalRating and dealQuality', () => {
    const scored = [
      { title: 'Game A', itemType: 'game', score: 90, msrp: 20 },
      { title: 'Game B', itemType: 'game', score: 80, msrp: 15 },
      { title: 'Game C', itemType: 'game', score: 70, msrp: 10 },
      { title: 'Soundtrack', itemType: 'dlc', score: 99, msrp: 5 },
    ];
    const ownedSet = new Set(['Game A']);
    const res = computeBundleScores(scored, ownedSet, { ...DEFAULT_SETTINGS, topNMain: 2, topNDepth: 3 }, 5);
    assert.equal(res.bundleRating, 85); // avg(90, 80)
    assert.equal(res.depthRating, 80);  // avg(90, 80, 70)
    assert.equal(res.personalRating, 75); // avg(80, 70) since Game A is owned
    assert.equal(res.unownedMsrpSum, 25); // 15 + 10
    assert.equal(res.dealQuality, 5); // 25 / 5
  });

  it('handles empty game list gracefully', () => {
    const res = computeBundleScores([], new Set(), DEFAULT_SETTINGS, null);
    assert.equal(res.bundleRating, 0);
    assert.equal(res.depthRating, 0);
    assert.equal(res.personalRating, 0);
    assert.equal(res.dealQuality, null);
  });
});

describe('parseReviewCellText', () => {
  it('parses explicit percentage when review count is below rating percentage', () => {
    assert.deepEqual(parseReviewCellText('88% 15'), { ratingPct: 88, reviews: 15 });
    assert.deepEqual(parseReviewCellText('88% (15)'), { ratingPct: 88, reviews: 15 });
    assert.deepEqual(parseReviewCellText('15 reviews, 88%'), { ratingPct: 88, reviews: 15 });
    assert.deepEqual(parseReviewCellText('80% 10'), { ratingPct: 80, reviews: 10 });
  });

  it('prevents low-review high-rated DLCs from being misclassified as games', () => {
    const parsed = parseReviewCellText('80% 10');
    assert.equal(classifyItem('Cool Soundtrack', parsed.reviews, parsed.ratingPct), 'dlc');
    assert.equal(classifyItem('Bonus Chapter', parsed.reviews, parsed.ratingPct, { isInPackage: true }), 'dlc');
  });

  it('handles comma-formatted counts, whitespace before %, decimals, and boundary percentages', () => {
    assert.deepEqual(parseReviewCellText('92.5% (1,234)'), { ratingPct: 92.5, reviews: 1234 });
    assert.deepEqual(parseReviewCellText('88 % 15'), { ratingPct: 88, reviews: 15 });
    assert.deepEqual(parseReviewCellText('0% (5)'), { ratingPct: 0, reviews: 5 });
    assert.deepEqual(parseReviewCellText('100% 100'), { ratingPct: 100, reviews: 100 });
  });

  it('ignores out-of-range percentage values', () => {
    assert.deepEqual(parseReviewCellText('150% (20)'), { ratingPct: null, reviews: 20 });
  });

  it('handles single-number cells with and without %', () => {
    assert.deepEqual(parseReviewCellText('88%'), { ratingPct: 88, reviews: null });
    assert.deepEqual(parseReviewCellText('88'), { ratingPct: 88, reviews: null });
    assert.deepEqual(parseReviewCellText('250'), { ratingPct: null, reviews: 250 });
  });

  it('falls back to descending heuristic when two numbers appear without %', () => {
    assert.deepEqual(parseReviewCellText('88 1234'), { ratingPct: 88, reviews: 1234 });
    assert.deepEqual(parseReviewCellText('1,234 88'), { ratingPct: 88, reviews: 1234 });
    assert.deepEqual(parseReviewCellText('200 150'), { ratingPct: null, reviews: 200 });
  });

  it('returns nulls for empty, null, or non-numeric inputs', () => {
    assert.deepEqual(parseReviewCellText(''), { ratingPct: null, reviews: null });
    assert.deepEqual(parseReviewCellText('N/A'), { ratingPct: null, reviews: null });
    assert.deepEqual(parseReviewCellText(null), { ratingPct: null, reviews: null });
    assert.deepEqual(parseReviewCellText(undefined), { ratingPct: null, reviews: null });
  });
});

describe('parseBundleCostFromText and detectBundleCost', () => {
  it('extracts bundle cost from numbered tier labels and picks the minimum tier price', () => {
    assert.equal(parseBundleCostFromText('Tier 1: $4.99\nTier 2: $9.99'), 4.99);
    assert.equal(parseBundleCostFromText('Tier 2 - $9.99 | Tier 1 - $4.99'), 4.99);
    assert.equal(parseBundleCostFromText('Tier #1: $3.49'), 3.49);
  });

  it('extracts bundle cost when item counts or short descriptors precede the dollar amount', () => {
    assert.equal(parseBundleCostFromText('From 3 items: $4.99\nFrom 5 items: $7.99'), 4.99);
    assert.equal(parseBundleCostFromText('Pay at least $1.00 for 3 games'), 1);
    assert.equal(parseBundleCostFromText('Bundle cost: $12.99'), 12.99);
    assert.equal(parseBundleCostFromText('Price: $5'), 5);
    assert.equal(parseBundleCostFromText('$6.99 for bundle'), 6.99);
  });

  it('falls back to the minimum positive tier price when no text match is found', () => {
    const tiers = [
      { name: 'Starter Pack', price: 9.99 },
      { name: 'Base Pack', price: 4.99 },
      { name: 'Bonus', price: null },
    ];
    assert.equal(parseBundleCostFromText('Starter Pack / Base Pack', tiers), 4.99);
    assert.equal(parseBundleCostFromText('', [14.99, 6.49]), 6.49);
  });

  it('ignores non-positive, non-finite, or out-of-range (>= 500) prices in text and tier fallback', () => {
    assert.equal(parseBundleCostFromText('Tier 1: $0.00\nTier 2: $500.00'), null);
    assert.equal(
      parseBundleCostFromText('No dollar prices here', [
        { price: 0 },
        { price: -5 },
        { price: 500 },
        { price: NaN },
        { price: null },
      ]),
      null,
    );
    assert.equal(
      parseBundleCostFromText('Tier 1: $0.00', [{ price: 0 }, { price: 500 }, { price: 7.49 }]),
      7.49,
    );
  });

  it('returns null when neither text nor tiers contain a valid cost', () => {
    assert.equal(parseBundleCostFromText(''), null);
    assert.equal(parseBundleCostFromText(null, null), null);
    assert.equal(detectBundleCost({ parentElement: { textContent: 'Just game rows' } }, []), null);
  });

  it('detectBundleCost reads table.parentElement text and falls back to tiers', () => {
    const numberedTable = {
      parentElement: {
        textContent: 'Tier 1: $4.99\nGame A $19.99\nTier 2: $9.99\nGame B $29.99',
      },
    };
    assert.equal(detectBundleCost(numberedTable, [{ price: 4.99 }, { price: 9.99 }]), 4.99);

    const euroOnlyTable = {
      parentElement: {
        textContent: 'Pick & Mix: 4.99 EUR\nGame A 19.99',
      },
    };
    assert.equal(detectBundleCost(euroOnlyTable, [{ price: 4.99 }, { price: 8.99 }]), 4.99);
  });
});

describe('buildStatsDashboardHTML pctSaved and dealQuality rendering', () => {
  const sampleScored = [
    { title: 'Game A', itemType: 'game', score: 85, msrp: 10, ratingPct: 90, wishlistedDOM: false },
    { title: 'Game B', itemType: 'game', score: 75, msrp: 10, ratingPct: 80, wishlistedDOM: true },
  ];

  it('renders Deal quality and % Saved vs MSRP when bundle cost is detected', () => {
    const bundleCost = 5;
    const bundleScores = computeBundleScores(sampleScored, new Set(), DEFAULT_SETTINGS, bundleCost);
    const html = buildStatsDashboardHTML(bundleScores, sampleScored, [], { bundleCost });
    assert.match(html, /% Saved vs MSRP/);
    assert.match(html, /75%/);
    assert.match(html, /width:75%;background:#3fb950/);
    assert.match(html, /Deal: 4\.0x/);
  });

  it('clamps pctSaved CSS bar width to [0, 100] when bundle cost exceeds total MSRP', () => {
    const bundleCost = 30; // totalMsrp is 20 -> pctSaved is -50%
    const bundleScores = computeBundleScores(sampleScored, new Set(), DEFAULT_SETTINGS, bundleCost);
    const html = buildStatsDashboardHTML(bundleScores, sampleScored, [], { bundleCost });
    assert.match(html, /-50%/);
    assert.match(html, /width:0%;background:#3fb950/);
    assert.doesNotMatch(html, /width:-/);
  });
});

// ═══════════════════════════════════════
// METADATA & UPDATE CHECK
// ═══════════════════════════════════════

const metaSource = fs.readFileSync(path.join(__dirname, 'barter-bundle-scorer.meta.js'), 'utf8');

function parseMetadataBlock(text) {
  const match = text.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  assert.ok(match, 'Missing // ==UserScript== metadata block');
  const entries = {};
  for (const line of match[1].split(/\r?\n/)) {
    const lineMatch = line.match(/^\s*\/\/\s+@(\S+)\s+(.*)$/);
    if (!lineMatch) continue;
    const [, key, value] = lineMatch;
    if (!entries[key]) entries[key] = [];
    entries[key].push(value.trim());
  }
  return { entries, afterBlock: text.slice(match.index + match[0].length) };
}

function makeStubElement(tagName) {
  const listeners = new Map();
  const el = {
    tagName: tagName.toUpperCase(),
    id: '',
    type: '',
    textContent: '',
    style: {},
    children: [],
    parent: null,
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    },
    prepend(node) {
      node.parent = this;
      this.children.unshift(node);
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click() {
      for (const fn of listeners.get('click') || []) fn();
    },
  };
  return el;
}

function createUpdateCheckHarness({ gmInfo, responseText, status = 200 } = {}) {
  const versionHeader = between('  const LOG_PREFIX =', '\n  // ═══════════════════════════════════════\n  // LOGGING');
  const updateBlock = between('// <update-check>', '// </update-check>');

  const body = makeStubElement('body');
  const storage = new Map();
  const logs = [];
  const requests = [];
  const openedUrls = [];

  function findById(node, id) {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }

  const updateSandbox = {
    GM_info: gmInfo,
    GM_xmlhttpRequest(opts) {
      requests.push(opts);
      if (typeof responseText === 'string') {
        opts.onload?.({ status, responseText });
      }
    },
    sessionStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, val) => storage.set(key, String(val)),
    },
    document: {
      body,
      createElement: tag => makeStubElement(tag),
      getElementById: id => findById(body, id),
      addEventListener() {},
    },
    window: {
      open: (url, target) => openedUrls.push({ url, target }),
    },
    console: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
    },
  };
  vm.createContext(updateSandbox);
  vm.runInContext(
    `${versionHeader}\n${updateBlock}\nglobalThis.__update = { META_URL, DOWNLOAD_URL, SCRIPT_VERSION, UPDATE_BANNER_ID, isNewerVersion, checkForUpdate };`,
    updateSandbox,
  );
  return {
    ...updateSandbox.__update,
    body,
    storage,
    logs,
    requests,
    openedUrls,
  };
}

describe('barter-bundle-scorer.meta.js metadata & update check', () => {
  it('stays in sync with barter-bundle-scorer.user.js metadata and has no script body', () => {
    const meta = parseMetadataBlock(metaSource);
    const user = parseMetadataBlock(source);

    assert.equal(meta.afterBlock.trim(), '', '.meta.js should contain metadata only');
    assert.match(meta.entries.version?.[0] || '', /^\d+\.\d+\.\d+$/);

    const comparedKeys = [
      'name', 'namespace', 'version', 'description', 'match',
      'homepageURL', 'supportURL', 'updateURL', 'downloadURL',
      'grant', 'connect', 'run-at',
    ];
    for (const key of comparedKeys) {
      assert.deepEqual(meta.entries[key], user.entries[key], `@${key} mismatch between .meta.js and .user.js`);
    }
  });

  it('triggers an update banner when installed version is older than barter-bundle-scorer.meta.js', () => {
    const meta = parseMetadataBlock(metaSource);
    const currentVersion = meta.entries.version[0];
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    const previousVersion = patch > 0 ? `${major}.${minor}.${patch - 1}` : '0.0.0';

    const harness = createUpdateCheckHarness({
      gmInfo: {
        script: {
          version: previousVersion,
          updateURL: meta.entries.updateURL[0],
          downloadURL: meta.entries.downloadURL[0],
        },
      },
      responseText: metaSource,
    });

    harness.checkForUpdate();

    assert.equal(harness.requests.length, 1);
    assert.ok(harness.requests[0].url.startsWith(`${meta.entries.updateURL[0]}?_=`));

    const banner = harness.body.children.find(el => el.id === harness.UPDATE_BANNER_ID);
    assert.ok(banner, 'Expected update banner to be injected');
    assert.match(banner.children[0].textContent, new RegExp(`v${currentVersion.replace(/\./g, '\\.')} available \\(you have v${previousVersion.replace(/\./g, '\\.')}\\)`));

    banner.children[0].click();
    assert.deepEqual(harness.openedUrls, [{ url: meta.entries.downloadURL[0], target: '_blank' }]);
  });

  it('reports up-to-date without a banner when installed version matches barter-bundle-scorer.meta.js', () => {
    const user = parseMetadataBlock(source);
    const installedVersion = user.entries.version[0];

    const harness = createUpdateCheckHarness({
      gmInfo: {
        script: {
          version: installedVersion,
          updateURL: user.entries.updateURL[0],
          downloadURL: user.entries.downloadURL[0],
        },
      },
      responseText: metaSource,
    });

    harness.checkForUpdate();

    assert.equal(harness.requests.length, 1);
    assert.equal(harness.body.children.length, 0);
    assert.ok(harness.logs.some(line => line.includes(`Up to date (v${installedVersion}).`)));
  });

  it('persists dismissal per offered version and surfaces banner again for a newer version', () => {
    const meta = parseMetadataBlock(metaSource);
    const currentVersion = meta.entries.version[0];
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    const previousVersion = patch > 0 ? `${major}.${minor}.${patch - 1}` : '0.0.0';

    const harness = createUpdateCheckHarness({
      gmInfo: {
        script: {
          version: previousVersion,
          updateURL: meta.entries.updateURL[0],
          downloadURL: meta.entries.downloadURL[0],
        },
      },
      responseText: metaSource,
    });

    harness.checkForUpdate();
    const banner = harness.body.children.find(el => el.id === harness.UPDATE_BANNER_ID);
    assert.ok(banner);

    // Click dismiss button
    banner.children[1].click();
    assert.equal(harness.body.children.length, 0);
    assert.equal(harness.storage.get(`barter_bundle_scorer_update_dismissed_v${currentVersion}`), '1');

    // Re-checking the same .meta.js stays dismissed
    harness.checkForUpdate();
    assert.equal(harness.body.children.length, 0);
  });

  it('falls back to .meta.js update/download URLs and skips check in dev builds when GM_info is missing', () => {
    const meta = parseMetadataBlock(metaSource);
    const harness = createUpdateCheckHarness({ gmInfo: undefined, responseText: metaSource });

    assert.equal(harness.SCRIPT_VERSION, '__DEV__');
    assert.equal(harness.META_URL, meta.entries.updateURL[0]);
    assert.equal(harness.DOWNLOAD_URL, meta.entries.downloadURL[0]);

    harness.checkForUpdate();
    assert.equal(harness.requests.length, 0);
    assert.ok(harness.logs.some(line => line.includes('Dev build — skipping update check.')));
  });
});

describe('hideOriginalPage and showOriginalPage', () => {
  function makeBodyChild(tagName, { id = '', classes = [] } = {}) {
    const classSet = new Set(classes);
    return {
      tagName: tagName.toUpperCase(),
      id,
      style: { display: '' },
      dataset: {},
      classList: {
        contains: cls => classSet.has(cls),
      },
    };
  }

  it('exempts #bvg-app, #bvg-view-fab, UPDATE_BANNER_ID, .bvg-modal-backdrop, and SCRIPT/STYLE/LINK while hiding other children', () => {
    const app = makeBodyChild('div', { id: 'bvg-app' });
    const fab = makeBodyChild('div', { id: 'bvg-view-fab' });
    const banner = makeBodyChild('div', { id: 'barter-bundle-scorer-update-banner' });
    const modal = makeBodyChild('div', { classes: ['bvg-modal-backdrop'] });
    const script = makeBodyChild('script');
    const style = makeBodyChild('style');
    const link = makeBodyChild('link');
    const originalHeader = makeBodyChild('header', { id: 'barter-header' });
    const originalTable = makeBodyChild('table');

    sandbox.document.body.children = [
      banner,
      originalHeader,
      originalTable,
      script,
      style,
      link,
      app,
      fab,
      modal,
    ];

    hideOriginalPage();

    assert.equal(banner.style.display, '');
    assert.equal(banner.dataset.bvgHidden, undefined);
    assert.equal(app.style.display, '');
    assert.equal(fab.style.display, '');
    assert.equal(modal.style.display, '');
    assert.equal(modal.dataset.bvgHidden, undefined);
    assert.equal(script.style.display, '');
    assert.equal(style.style.display, '');
    assert.equal(link.style.display, '');

    assert.equal(originalHeader.style.display, 'none');
    assert.equal(originalHeader.dataset.bvgHidden, '1');
    assert.equal(originalTable.style.display, 'none');
    assert.equal(originalTable.dataset.bvgHidden, '1');

    showOriginalPage();

    assert.equal(originalHeader.style.display, '');
    assert.equal(originalHeader.dataset.bvgHidden, undefined);
    assert.equal(originalTable.style.display, '');
    assert.equal(originalTable.dataset.bvgHidden, undefined);
    assert.equal(banner.style.display, '');
  });
});

describe('ownership overrides persistence and currency stats refresh', () => {
  it('migrates legacy bvg_scorer_owned_v2 array and persists v3 overrides for DOM-owned and non-DOM-owned games', () => {
    localStore.clear();
    localStore.set(STORAGE_KEY_OWNED_LEGACY, JSON.stringify(['Legacy Owned']));

    const initial = { ...loadOwnedOverrides() };
    assert.deepEqual(initial, { 'Legacy Owned': true });

    const games = [
      { title: 'Legacy Owned', ownedDOM: false },
      { title: 'Library Game', ownedDOM: true },
      { title: 'Fresh Game', ownedDOM: false },
    ];

    // Before toggling Library Game, it is owned via ownedDOM
    let ownedSet = resolveOwnedSet(games, initial);
    assert.equal(ownedSet.has('Legacy Owned'), true);
    assert.equal(ownedSet.has('Library Game'), true);
    assert.equal(ownedSet.has('Fresh Game'), false);

    // Toggle DOM-owned game off and persist
    const afterUnown = toggleOwnedOverride(initial, 'Library Game', true);
    saveOwnedOverrides(afterUnown);
    assert.equal(localStore.has(STORAGE_KEY_OWNED), true);

    const reloaded = { ...loadOwnedOverrides() };
    assert.deepEqual(reloaded, { 'Legacy Owned': true, 'Library Game': false });
    ownedSet = resolveOwnedSet(games, reloaded);
    assert.equal(ownedSet.has('Library Game'), false);

    // Toggle DOM-owned game back on
    const afterRestore = toggleOwnedOverride(reloaded, 'Library Game', true);
    saveOwnedOverrides(afterRestore);
    ownedSet = resolveOwnedSet(games, loadOwnedOverrides());
    assert.equal(ownedSet.has('Library Game'), true);
  });

  it('reRenderStats refreshes the Tier Pricing strip when _gridState.currency changes', () => {
    const tr = { dataset: { bvgTier: 'Tier 1' } };
    const scored = [
      { title: 'Game A', itemType: 'game', score: 85, msrp: 20, ratingPct: 90, wishlistedDOM: false, tr },
    ];
    const tiers = [
      { name: 'Tier 1', label: 'Tier 1', price: 9.99, prices: { USD: 9.99, EUR: 8.49, GBP: 7.29 }, games: [tr] },
    ];
    const bundleScores = computeBundleScores(scored, new Set(), DEFAULT_SETTINGS, 9.99);
    const statsContainer = {
      innerHTML: '',
      classList: { toggle() {} },
    };

    sandbox.SETTINGS = DEFAULT_SETTINGS;
    sandbox.CURRENT_BUNDLE_COST = 9.99;
    sandbox._statsViewState = { collapsed: false, hiddenCards: [] };
    sandbox._appRefs = {
      statsContainer,
      bundleScores,
      scored,
      tiers,
      ownedSet: new Set(),
    };

    sandbox._gridState.currency = 'USD';
    reRenderStats();
    assert.match(statsContainer.innerHTML, /\$9\.99/);

    sandbox._gridState.currency = 'EUR';
    reRenderStats();
    assert.match(statsContainer.innerHTML, /\u20AC8\.49/);

    sandbox._gridState.currency = 'GBP';
    reRenderStats();
    assert.match(statsContainer.innerHTML, /\u00A37\.29/);

    // Reset default currency for any subsequent checks
    sandbox._gridState.currency = 'USD';
  });
});
