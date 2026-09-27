// Tests for the PURE LOGIC section of prime-video-filter.user.js.
// The section's source is sliced out of the userscript and evaluated as-is,
// so these tests can't drift from the shipped code.
//
//   node --test prime-video-filter/logic.test.js

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const DAY = 24 * 60 * 60 * 1000
const RATING_TTL_MS = 14 * DAY
const NO_RATING_TTL_MS = 2 * DAY

function loadPureLogic() {
	const src = fs.readFileSync(path.join(__dirname, 'prime-video-filter.user.js'), 'utf8')
	const start = src.indexOf('//  PURE LOGIC')
	assert.ok(start > 0, 'PURE LOGIC section not found')
	const bodyStart = src.indexOf('\n', src.indexOf('// ═', start)) + 1
	const end = src.indexOf('// ═', bodyStart)
	const body = src.slice(bodyStart, end)
	const names = [
		'extractImdbRating',
		'classifyEntitlement',
		'entitlementFromAttr',
		'progressFromAria',
		'progressFromWidth',
		'hideReason',
		'isRatingFresh',
		'detailKey',
		'formatRating',
		'roundTo',
	]
	// eslint-disable-next-line no-new-func
	return new Function(
		'RATING_TTL_MS',
		'NO_RATING_TTL_MS',
		`${body}\nreturn { ${names.join(', ')} }`
	)(RATING_TTL_MS, NO_RATING_TTL_MS)
}

const L = loadPureLogic()

const ALL_ON = {
	enabled: true,
	hideNotIncluded: true,
	hideWatched: true,
	watchedPct: 90,
	hideLowRated: true,
	minRating: 7,
	hideUnrated: false,
}
const UNKNOWN = { entitlement: null, progress: null, rating: null, ratingSettled: false }

test('extractImdbRating reads badge text', () => {
	assert.equal(L.extractImdbRating('IMDb 7.4'), 7.4)
	assert.equal(L.extractImdbRating('IMDb rating 8'), 8)
	assert.equal(L.extractImdbRating('IMDb: 10'), 10)
	assert.equal(L.extractImdbRating('2023 · IMDb 6.1 · 2 h 10 min'), 6.1)
})

test('extractImdbRating reads HTML and JSON', () => {
	assert.equal(L.extractImdbRating('<span>IMDb</span><span>&nbsp;5.9</span>'), 5.9)
	assert.equal(L.extractImdbRating('{"title":"X","imdbRating":7.2,"year":2020}'), 7.2)
	assert.equal(L.extractImdbRating('{"imdbRating":"6.8"}'), 6.8)
})

test('extractImdbRating refuses non-ratings', () => {
	assert.equal(L.extractImdbRating(''), null)
	assert.equal(L.extractImdbRating(null), null)
	assert.equal(L.extractImdbRating('Rated 7.4 by critics'), null)
	assert.equal(L.extractImdbRating('IMDb 0'), null)
	assert.equal(L.extractImdbRating('IMDb 2019'), null)
	assert.equal(L.extractImdbRating('IMDb 11'), null)
})

test('classifyEntitlement: included wins over paid upsells', () => {
	assert.equal(L.classifyEntitlement('Included with Prime'), 'included')
	assert.equal(L.classifyEntitlement('Included with your Amazon Prime membership'), 'included')
	assert.equal(L.classifyEntitlement('Included with Prime | Buy 4K $19.99'), 'included')
	assert.equal(L.classifyEntitlement('Watch with Prime'), 'included')
})

test('classifyEntitlement: rent, buy, channels and trials are paid', () => {
	assert.equal(L.classifyEntitlement('Rent or buy'), 'paid')
	assert.equal(L.classifyEntitlement('Available to rent'), 'paid')
	assert.equal(L.classifyEntitlement('Rent HD $3.99'), 'paid')
	assert.equal(L.classifyEntitlement('Subscribe'), 'paid')
	assert.equal(L.classifyEntitlement('Watch with a free trial'), 'paid')
	assert.equal(L.classifyEntitlement('Add Paramount+ to Prime'), 'paid')
	assert.equal(L.classifyEntitlement('Not included with your Prime'), 'paid')
})

test('classifyEntitlement: titles alone are not labels', () => {
	assert.equal(L.classifyEntitlement('Rent'), null)
	assert.equal(L.classifyEntitlement('The Subscriber'), null)
	assert.equal(L.classifyEntitlement(''), null)
	assert.equal(L.classifyEntitlement(undefined), null)
})

test('entitlementFromAttr', () => {
	assert.equal(L.entitlementFromAttr('Entitled'), 'included')
	assert.equal(L.entitlementFromAttr(' entitled '), 'included')
	assert.equal(L.entitlementFromAttr('Unentitled'), 'paid')
	assert.equal(L.entitlementFromAttr('EntitledToChannel'), 'paid')
	assert.equal(L.entitlementFromAttr(null), null)
	assert.equal(L.entitlementFromAttr(''), null)
})

test('progressFromAria handles 0–100, 0–1 and junk', () => {
	assert.equal(L.progressFromAria('45', '100'), 45)
	assert.equal(L.progressFromAria('0.95', '1'), 95)
	assert.equal(L.progressFromAria('60', null), 60)
	assert.equal(L.progressFromAria('150', '100'), 100)
	assert.equal(L.progressFromAria(null, '100'), null)
	assert.equal(L.progressFromAria('', '100'), null)
	assert.equal(L.progressFromAria('50', '0'), null)
})

test('progressFromWidth', () => {
	assert.equal(L.progressFromWidth('73%'), 73)
	assert.equal(L.progressFromWidth(' 73.5% '), 73.5)
	assert.equal(L.progressFromWidth('120px'), null)
	assert.equal(L.progressFromWidth(''), null)
})

test('hideReason: unknown facts never hide', () => {
	assert.equal(L.hideReason(UNKNOWN, ALL_ON), null)
})

test('hideReason: paused or filter off keeps everything', () => {
	const paid = { ...UNKNOWN, entitlement: 'paid' }
	assert.equal(L.hideReason(paid, { ...ALL_ON, enabled: false }), null)
	assert.equal(L.hideReason(paid, { ...ALL_ON, hideNotIncluded: false }), null)
	assert.equal(L.hideReason(paid, ALL_ON), 'not-included')
	assert.equal(L.hideReason({ ...UNKNOWN, entitlement: 'included' }, ALL_ON), null)
})

test('hideReason: watched threshold is inclusive', () => {
	assert.equal(L.hideReason({ ...UNKNOWN, progress: 89.9 }, ALL_ON), null)
	assert.equal(L.hideReason({ ...UNKNOWN, progress: 90 }, ALL_ON), 'watched')
	assert.equal(L.hideReason({ ...UNKNOWN, progress: 100 }, { ...ALL_ON, hideWatched: false }), null)
})

test('hideReason: rating threshold keeps the threshold itself', () => {
	assert.equal(L.hideReason({ ...UNKNOWN, rating: 6.9, ratingSettled: true }, ALL_ON), 'low-rated')
	assert.equal(L.hideReason({ ...UNKNOWN, rating: 7, ratingSettled: true }, ALL_ON), null)
})

test('hideReason: unrated hides only when asked and only once settled', () => {
	const pending = { ...UNKNOWN, ratingSettled: false }
	const none = { ...UNKNOWN, ratingSettled: true }
	assert.equal(L.hideReason(none, ALL_ON), null)
	assert.equal(L.hideReason(pending, { ...ALL_ON, hideUnrated: true }), null)
	assert.equal(L.hideReason(none, { ...ALL_ON, hideUnrated: true }), 'unrated')
})

test('isRatingFresh: misses expire sooner than hits', () => {
	const now = 100 * DAY
	assert.equal(L.isRatingFresh({ r: 7, t: now - 10 * DAY }, now), true)
	assert.equal(L.isRatingFresh({ r: 7, t: now - 15 * DAY }, now), false)
	assert.equal(L.isRatingFresh({ r: null, t: now - 1 * DAY }, now), true)
	assert.equal(L.isRatingFresh({ r: null, t: now - 3 * DAY }, now), false)
	assert.equal(L.isRatingFresh(undefined, now), false)
	assert.equal(L.isRatingFresh({ r: 7 }, now), false)
})

test('detailKey', () => {
	assert.equal(L.detailKey('https://www.primevideo.com/detail/0ABCDEF123/ref=atv_hm_x'), '0ABCDEF123')
	assert.equal(L.detailKey('/gp/video/detail/B0XYZ12345?autoplay=0'), 'B0XYZ12345')
	assert.equal(L.detailKey('https://www.primevideo.com/storefront'), null)
	assert.equal(L.detailKey(null), null)
})

test('formatRating and roundTo', () => {
	assert.equal(L.formatRating(7), '7.0')
	assert.equal(L.roundTo(7.04, 0.1), 7)
	assert.equal(L.roundTo(6.9, 0.1), 6.9)
	// A title rated exactly at the threshold must survive it.
	const at = { ...UNKNOWN, rating: 6.9, ratingSettled: true }
	assert.equal(L.hideReason(at, { ...ALL_ON, minRating: L.roundTo(6.9, 0.1) }), null)
})
