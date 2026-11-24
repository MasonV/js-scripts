// Unit tests for Barter Bundle Scorer collapsible/hideable stat card state logic.
// Run with: node --test barter-bundle-scorer/logic.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPureLogic() {
  const src = fs.readFileSync(
    path.join(__dirname, 'barter-bundle-scorer.user.js'),
    'utf8',
  );
  const startMarker = '//  PURE LOGIC';
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'PURE LOGIC section header not found in user.js');
  const afterStart = src.indexOf('═\n', startIdx) + 2;
  const nextSection = src.indexOf('// ═══════════════════════════════════════════════════════════════════', afterStart);
  assert.ok(nextSection !== -1, 'Next section header after PURE LOGIC not found');
  const slice = src.slice(afterStart, nextSection);
  const factory = new Function(`
    "use strict";
    ${slice}
    return {
      STAT_CARD_DEFS,
      VALID_STAT_CARD_IDS,
      normalizeStatsViewState,
      toggleHiddenStatCard,
      showAllStatCards,
      toggleStatsCollapsed,
      normalizeOwnedOverrides,
      resolveOwnedSet,
      toggleOwnedOverride,
    };
  `);
  return factory();
}

const {
  STAT_CARD_DEFS,
  normalizeStatsViewState,
  toggleHiddenStatCard,
  showAllStatCards,
  toggleStatsCollapsed,
  normalizeOwnedOverrides,
  resolveOwnedSet,
  toggleOwnedOverride,
} = loadPureLogic();

describe('normalizeStatsViewState', () => {
  it('returns default visible state for null, undefined, or non-object inputs', () => {
    assert.deepEqual(normalizeStatsViewState(null), { collapsed: false, hiddenCards: [] });
    assert.deepEqual(normalizeStatsViewState(undefined), { collapsed: false, hiddenCards: [] });
    assert.deepEqual(normalizeStatsViewState('bad'), { collapsed: false, hiddenCards: [] });
  });

  it('filters unknown card IDs and deduplicates valid ones', () => {
    const state = normalizeStatsViewState({
      collapsed: 1,
      hiddenCards: ['bundle', 'unknown', 'picks', 'bundle', 'tiers'],
    });
    assert.deepEqual(state, {
      collapsed: true,
      hiddenCards: ['bundle', 'picks', 'tiers'],
    });
  });

  it('accepts a legacy raw array of card IDs', () => {
    const state = normalizeStatsViewState(['msrp', 'invalid', 'msrp', 'meta']);
    assert.deepEqual(state, {
      collapsed: false,
      hiddenCards: ['msrp', 'meta'],
    });
  });
});

describe('toggleHiddenStatCard', () => {
  it('adds a valid card ID when not hidden and removes it when already hidden', () => {
    const s0 = { collapsed: false, hiddenCards: [] };
    const s1 = toggleHiddenStatCard(s0, 'histogram');
    assert.deepEqual(s1, { collapsed: false, hiddenCards: ['histogram'] });

    const s2 = toggleHiddenStatCard(s1, 'picks');
    assert.deepEqual(s2, { collapsed: false, hiddenCards: ['histogram', 'picks'] });

    const s3 = toggleHiddenStatCard(s2, 'histogram');
    assert.deepEqual(s3, { collapsed: false, hiddenCards: ['picks'] });
  });

  it('ignores unknown card IDs without mutating existing state', () => {
    const s0 = { collapsed: false, hiddenCards: ['bundle'] };
    const s1 = toggleHiddenStatCard(s0, 'not-a-card');
    assert.deepEqual(s1, { collapsed: false, hiddenCards: ['bundle'] });
  });
});

describe('showAllStatCards & toggleStatsCollapsed', () => {
  it('showAllStatCards clears all hidden cards and expands the stats strip', () => {
    const s0 = { collapsed: true, hiddenCards: STAT_CARD_DEFS.map(d => d.id) };
    assert.deepEqual(showAllStatCards(s0), { collapsed: false, hiddenCards: [] });
  });

  it('toggleStatsCollapsed flips collapsed flag while preserving hiddenCards', () => {
    const s0 = { collapsed: false, hiddenCards: ['msrp', 'avgReview'] };
    const s1 = toggleStatsCollapsed(s0);
    assert.deepEqual(s1, { collapsed: true, hiddenCards: ['msrp', 'avgReview'] });
    const s2 = toggleStatsCollapsed(s1);
    assert.deepEqual(s2, { collapsed: false, hiddenCards: ['msrp', 'avgReview'] });
  });
});

describe('ownership overrides (normalizeOwnedOverrides, toggleOwnedOverride, resolveOwnedSet)', () => {
  it('normalizes v3 boolean override maps, legacy v2 title arrays/Sets, and invalid inputs', () => {
    assert.deepEqual(normalizeOwnedOverrides(null), {});
    assert.deepEqual(normalizeOwnedOverrides(undefined), {});
    assert.deepEqual(normalizeOwnedOverrides('bad'), {});
    assert.deepEqual(
      normalizeOwnedOverrides(['Game A', '', 42, 'Game B']),
      { 'Game A': true, 'Game B': true },
    );
    assert.deepEqual(
      normalizeOwnedOverrides(new Set(['Game A', 'Game C'])),
      { 'Game A': true, 'Game C': true },
    );
    assert.deepEqual(
      normalizeOwnedOverrides({ 'Game A': true, 'Game B': false, 'Game C': 'yes', '': true }),
      { 'Game A': true, 'Game B': false },
    );
  });

  it('toggles DOM-owned games off (recording false override) and back on (clearing override)', () => {
    const s0 = {};
    const s1 = toggleOwnedOverride(s0, 'DOM Owned Game', true);
    assert.deepEqual(s1, { 'DOM Owned Game': false });

    const s2 = toggleOwnedOverride(s1, 'DOM Owned Game', true);
    assert.deepEqual(s2, {});
  });

  it('toggles non-DOM-owned games on (recording true override) and back off (clearing override)', () => {
    const s0 = {};
    const s1 = toggleOwnedOverride(s0, 'Unowned Game', false);
    assert.deepEqual(s1, { 'Unowned Game': true });

    const s2 = toggleOwnedOverride(s1, 'Unowned Game', false);
    assert.deepEqual(s2, {});
  });

  it('resolves effective ownedSet merging DOM detection with manual overrides in both directions', () => {
    const games = [
      { title: 'DOM Owned Keep', ownedDOM: true },
      { title: 'DOM Owned Unown', ownedDOM: true },
      { title: 'DOM Unowned ManualOwn', ownedDOM: false },
      { title: 'DOM Unowned Keep', ownedDOM: false },
    ];
    let overrides = {};
    overrides = toggleOwnedOverride(overrides, 'DOM Owned Unown', true);
    overrides = toggleOwnedOverride(overrides, 'DOM Unowned ManualOwn', false);

    const ownedSet = resolveOwnedSet(games, overrides);
    assert.equal(ownedSet.has('DOM Owned Keep'), true);
    assert.equal(ownedSet.has('DOM Owned Unown'), false);
    assert.equal(ownedSet.has('DOM Unowned ManualOwn'), true);
    assert.equal(ownedSet.has('DOM Unowned Keep'), false);

    // Clicking DOM Owned Unown again restores it to owned
    overrides = toggleOwnedOverride(overrides, 'DOM Owned Unown', true);
    const restoredSet = resolveOwnedSet(games, overrides);
    assert.equal(restoredSet.has('DOM Owned Unown'), true);
  });
});
