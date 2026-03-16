// Unit tests for barter-bundle-scorer pure scoring functions.
// Run: node --test barter-bundle-scorer/scoring.test.js
//
// Functions are copied from the userscript since there's no module system.
// Keep in sync with barter-bundle-scorer.user.js MATH + SCORING sections.

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
  });

  it('clamps values above 1 to 1', () => {
    assert.equal(clamp01(1.5), 1);
    assert.equal(clamp01(100), 1);
  });

  it('passes through values in [0, 1]', () => {
    assert.equal(clamp01(0), 0);
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(1), 1);
  });
});

describe('confidenceFromReviews', () => {
  it('returns 0 for null/zero/negative reviews', () => {
    assert.equal(confidenceFromReviews(null), 0);
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

  it('never exceeds 1', () => {
    assert.ok(confidenceFromReviews(1_000_000) <= 1);
  });

  it('respects custom anchor', () => {
    assert.equal(confidenceFromReviews(100, 100), 0.5);
  });
});

describe('wilsonLowerBound', () => {
  it('returns 0 for zero reviews', () => {
    assert.equal(wilsonLowerBound(0.8, 0), 0);
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
});

describe('classifyItem', () => {
  it('classifies DLC keywords as dlc when few reviews', () => {
    assert.equal(classifyItem('Cool Soundtrack', 10, 80), 'dlc');
    assert.equal(classifyItem('Game OST', 0, null), 'dlc');
    assert.equal(classifyItem('Skin Pack Bundle', null, null), 'dlc');
    assert.equal(classifyItem('Season Pass', 49, 90), 'dlc');
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
  });

  it('uses unified threshold — no gap between 10 and 100 reviews', () => {
    // Previously items with 50 reviews would be classified differently
    // depending on whether they had DLC keywords or were in a package.
    // Both paths now use DLC_REVIEW_THRESHOLD (50).
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

  it('applies rebundle penalty', () => {
    const base = { ratingPct: 80, reviews: 500, msrp: 20, wishlistedDOM: false };
    const fresh = scoreGame({ ...base, bundledTimes: 0 }, settings, null);
    const stale = scoreGame({ ...base, bundledTimes: 10 }, settings, null);
    assert.ok(fresh.score > stale.score, `Fresh ${fresh.score} should be > rebundled ${stale.score}`);
  });

  it('score is never negative', () => {
    const g = { ratingPct: 5, reviews: 1, msrp: 0, bundledTimes: 100, wishlistedDOM: false };
    const result = scoreGame(g, settings, null);
    assert.ok(result.score >= 0, `Score ${result.score} should be >= 0`);
  });

  it('uses bundle cost for bundleValue when provided', () => {
    const g = { ratingPct: 80, reviews: 500, msrp: 30, bundledTimes: 0, wishlistedDOM: false };
    const noCost = scoreGame(g, settings, null);
    const cheapBundle = scoreGame(g, settings, 5); // $30 game in $5 bundle = great deal
    assert.ok(cheapBundle.score > noCost.score || cheapBundle.breakdown.bundleValue >= noCost.breakdown.bundleValue,
      'Cheap bundle should improve bundleValue component');
  });

  it('handles Wilson-adjusted rating mode', () => {
    const wilsonSettings = { ...settings, useWilsonAdjustedRating: true };
    const g = { ratingPct: 95, reviews: 10, msrp: 20, bundledTimes: 0, wishlistedDOM: false };
    const raw = scoreGame(g, settings, null);
    const wilson = scoreGame(g, wilsonSettings, null);
    // Wilson should lower the score for games with few reviews
    assert.ok(wilson.score < raw.score,
      `Wilson ${wilson.score} should be < raw ${raw.score} with only 10 reviews`);
  });
});
