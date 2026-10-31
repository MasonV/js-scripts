// Unit tests for barter-bundle-scorer pure scoring functions.
// Run: node --test barter-bundle-scorer/scoring.test.js
//
// Functions are copied from the userscript since there's no module system.
// Keep in sync with barter-bundle-scorer.user.js MATH + SCORING + CURRENCY sections.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════
// EXTRACTED PURE FUNCTIONS (mirror of userscript)
// ═══════════════════════════════════════

const clamp01 = x => Math.max(0, Math.min(1, x));

function confidenceFromReviews(n, confidenceAnchor = 800) {
  if (!n || n <= 0) return 0;
  return clamp01(n / (n + confidenceAnchor));
}

function wilsonLowerBound(p, n) {
  if (!n || n <= 0) return 0;
  const z = 1.96, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return clamp01((centre - adj) / denom);
}

const DLC_KEYWORDS = /\b(soundtrack|ost|artbook|art\s*book|wallpaper|skin\s*pack|costume|dlc|season\s*pass|expansion|bonus\s*content|digital\s*deluxe|deluxe\s*edition|collector[''\u2019]?s\s*edition|upgrade)\b/i;
const DLC_REVIEW_THRESHOLD = 50;

// Simplified classifyItem for testing — takes structured input instead of DOM elements.
// In the real script this walks the DOM; here we simulate with explicit packageContext.
function classifyItem(title, reviews, ratingPct, { isInPackage = false } = {}) {
  const titleLower = title.toLowerCase();
  if (DLC_KEYWORDS.test(titleLower)) {
    if (reviews && reviews >= DLC_REVIEW_THRESHOLD) return 'game';
    return 'dlc';
  }
  if (isInPackage) {
    if (!reviews || reviews < DLC_REVIEW_THRESHOLD) return 'dlc';
    return 'game';
  }
  if (!ratingPct && !reviews) return 'package';
  return 'game';
}

// scoreGame with explicit settings injection for testability
function scoreGame(g, settings, bundleCost) {
  const isUnrated = g.ratingPct == null && (!g.reviews || g.reviews <= 0);
  const ratingRaw = g.ratingPct ? clamp01(g.ratingPct / 100) : (isUnrated ? 0.5 : 0);
  const conf = isUnrated ? 0.3 : confidenceFromReviews(g.reviews, settings.confidenceAnchor);
  const rating = settings.useWilsonAdjustedRating && !isUnrated
    ? wilsonLowerBound(ratingRaw, g.reviews || 0)
    : ratingRaw;
  const val = clamp01((g.msrp || 0) / settings.msrpCap);
  const bundleValue = bundleCost
    ? clamp01((g.msrp || 0) / Math.max(bundleCost, 0.01))
    : val;
  const wishlistBonus = g.wishlistedDOM ? 1 : 0;
  const pen = g.bundledTimes != null ? clamp01(g.bundledTimes / settings.bundledPenaltyCap) : 0;
  const w = settings.weights;
  const posSum = w.rating + w.confidence + w.value + w.bundleValue + w.wishlist;
  const n = posSum > 0 ? posSum : 1;
  const raw = (w.rating / n) * rating + (w.confidence / n) * conf + (w.value / n) * val + (w.bundleValue / n) * bundleValue + (w.wishlist / n) * wishlistBonus - (w.rebundlePenalty / n) * pen;
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

function scoreTierLabel(s) {
  if (s >= 85) return 'Great';
  if (s >= 70) return 'Good';
  if (s >= 50) return 'Fair';
  return 'Poor';
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

const CURRENCY_DEFS = [
  { code: 'USD', symbol: '$',  re: /(?:\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*USD)/ },
  { code: 'EUR', symbol: '\u20AC', re: /(?:\u20AC\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*EUR)/ },
  { code: 'GBP', symbol: '\u00A3', re: /(?:\u00A3\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*GBP)/ },
  { code: 'CAD', symbol: 'C$', re: /(?:C\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*CAD)/ },
  { code: 'AUD', symbol: 'A$', re: /(?:A\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*AUD)/ },
  { code: 'RUB', symbol: '\u20BD', re: /(?:\u20BD\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:\u20BD|RUB))/ },
];

function formatTierPrice(tier, currencyPref) {
  if (!tier.prices || !Object.keys(tier.prices).length) {
    return tier.price != null ? `$${tier.price.toFixed(2)}` : null;
  }
  if (currencyPref && tier.prices[currencyPref] != null) {
    const def = CURRENCY_DEFS.find(c => c.code === currencyPref);
    const sym = def ? def.symbol : currencyPref;
    return `${sym}${tier.prices[currencyPref].toFixed(2)}`;
  }
  if (tier.prices.USD != null) return `$${tier.prices.USD.toFixed(2)}`;
  const first = Object.keys(tier.prices)[0];
  if (first) {
    const def = CURRENCY_DEFS.find(c => c.code === first);
    const sym = def ? def.symbol : first;
    return `${sym}${tier.prices[first].toFixed(2)}`;
  }
  return tier.price != null ? `$${tier.price.toFixed(2)}` : null;
}

function computeBundleScores(scored, ownedSet, settings = DEFAULT_SETTINGS, bundleCost = null) {
  const scorable = scored.filter(g => g.itemType === 'game');
  const sorted = [...scorable].sort((a, b) => b.score - a.score);
  const topMain  = sorted.slice(0, settings.topNMain);
  const topDepth = sorted.slice(0, settings.topNDepth);
  const personal = sorted.filter(g => !ownedSet.has(g.title));
  const personalTop = personal.slice(0, settings.topNMain);
  const avg = (arr) => arr.length > 0 ? arr.reduce((s, g) => s + g.score, 0) / arr.length : 0;
  const unownedMsrpSum = personal.reduce((s, g) => s + (g.msrp || 0), 0);
  const dealQuality = bundleCost && bundleCost > 0
    ? unownedMsrpSum / bundleCost : null;
  return {
    bundleRating:  avg(topMain),
    depthRating:   avg(topDepth),
    personalRating: avg(personalTop),
    topMain,
    dealQuality,
    unownedMsrpSum,
  };
}

const DEFAULT_SETTINGS = {
  useWilsonAdjustedRating: false,
  topNMain: 5, topNDepth: 10,
  msrpCap: 39.99, bundledPenaltyCap: 10, confidenceAnchor: 800,
  weights: { rating: 0.55, confidence: 0.20, value: 0.20, bundleValue: 0.15, wishlist: 0.08, rebundlePenalty: 0.20 },
};

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
