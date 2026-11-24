// Tests for the PURE LOGIC section of livebench-custom-weights.user.js.
// The section's source is sliced out of the userscript and evaluated as-is,
// so these tests can't drift from the shipped code.
//
//   node --test livebench-custom-weights/logic.test.js

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadPureLogic() {
	const src = fs.readFileSync(path.join(__dirname, 'livebench-custom-weights.user.js'), 'utf8')
	const start = src.indexOf('//  PURE LOGIC')
	assert.ok(start > 0, 'PURE LOGIC section not found')
	const bodyStart = src.indexOf('\n', src.indexOf('// ═', start)) + 1
	const end = src.indexOf('// ═', bodyStart)
	const body = src.slice(bodyStart, end)
	const names = [
		'BUILTIN_PROFILES',
		'DEFAULT_PROFILE_NAME',
		'MAX_WEIGHT',
		'MAX_NAME_LENGTH',
		'stripTaskCount',
		'normalizeLabel',
		'parseScore',
		'clampWeight',
		'weightOf',
		'sanitizeWeights',
		'sameWeights',
		'computeCustomScore',
		'rankModels',
		'weightShares',
		'formatWeight',
		'describeFormula',
		'describeMove',
		'validateProfileName',
	]
	// eslint-disable-next-line no-new-func
	return new Function(`${body}\nreturn { ${names.join(', ')} }`)()
}

const L = loadPureLogic()

// A model row as the leaderboard shows it: the seven LiveBench 2.0 suites.
const SUITES = ['agentic', 'design', 'coding', 'browser use', 'data analysis', 'research', 'reasoning']
function model(name, values, siteOverall = null) {
	return { name, siteOverall, scores: SUITES.map((key, i) => ({ key, value: values[i] })) }
}
const defaultWeights = L.BUILTIN_PROFILES.find(p => p.name === L.DEFAULT_PROFILE_NAME).weights

// ── Labels and cells ─────────────────────────────────────────────────

test('normalizeLabel drops the task count and case', () => {
	assert.equal(L.normalizeLabel('LLM API INTEGRATION (3)'), 'llm api integration')
	assert.equal(L.normalizeLabel('  Browser   Use '), 'browser use')
	assert.equal(L.normalizeLabel(null), '')
})

test('stripTaskCount keeps the label casing', () => {
	assert.equal(L.stripTaskCount('Hard fixes (5)'), 'Hard fixes')
	assert.equal(L.stripTaskCount('Plain'), 'Plain')
	assert.equal(L.stripTaskCount('Mixed (v2) name'), 'Mixed (v2) name')
})

test('parseScore reads plain numbers and rejects everything else', () => {
	assert.equal(L.parseScore('87.4'), 87.4)
	assert.equal(L.parseScore(' 90 '), 90)
	assert.equal(L.parseScore('0.0'), 0)
	assert.equal(L.parseScore('73%'), 73)
	assert.equal(L.parseScore('—'), null)
	assert.equal(L.parseScore(''), null)
	assert.equal(L.parseScore('n/a'), null)
	assert.equal(L.parseScore('$2.654'), null)
	assert.equal(L.parseScore(undefined), null)
})

// ── Weights ──────────────────────────────────────────────────────────

test('clampWeight bounds to 0..MAX_WEIGHT and rounds to 2 places', () => {
	assert.equal(L.clampWeight(-3), 0)
	assert.equal(L.clampWeight(99), L.MAX_WEIGHT)
	assert.equal(L.clampWeight('1.256'), 1.26)
	assert.equal(L.clampWeight('abc'), 1)
	assert.equal(L.clampWeight(NaN, 2), 2)
})

test('weightOf defaults missing suites to 1', () => {
	assert.equal(L.weightOf({ coding: 3 }, 'coding'), 3)
	assert.equal(L.weightOf({ coding: 3 }, 'design'), 1)
	assert.equal(L.weightOf({}, 'constructor'), 1)
	assert.equal(L.weightOf({}, 'toString'), 1)
})

test('sanitizeWeights keeps only clean numeric entries', () => {
	const bad = JSON.parse('{"coding": 2, "design": "x", "agentic": 50, "__proto__": 5, "research": null}')
	const out = L.sanitizeWeights(bad)
	assert.deepEqual(out, { coding: 2, agentic: L.MAX_WEIGHT })
	assert.equal(Object.getPrototypeOf(out), Object.prototype)
	assert.deepEqual(L.sanitizeWeights('nope'), {})
	assert.deepEqual(L.sanitizeWeights(null), {})
})

test('sameWeights treats a missing key as weight 1', () => {
	assert.ok(L.sameWeights({}, { agentic: 1 }))
	assert.ok(L.sameWeights({ a: 2, b: 1 }, { a: 2 }))
	assert.ok(!L.sameWeights({ a: 2 }, { a: 3 }))
	assert.ok(!L.sameWeights({}, { a: 0 }))
})

// ── Scoring ──────────────────────────────────────────────────────────

test('computeCustomScore is a weighted mean', () => {
	const scores = [
		{ key: 'a', value: 100 },
		{ key: 'b', value: 50 },
	]
	assert.equal(L.computeCustomScore(scores, {}), 75)
	assert.equal(L.computeCustomScore(scores, { a: 3 }), 87.5)
})

test('computeCustomScore leaves out zero-weight and missing suites', () => {
	const scores = [
		{ key: 'a', value: 100 },
		{ key: 'b', value: 40 },
		{ key: 'c', value: null },
	]
	assert.equal(L.computeCustomScore(scores, { b: 0 }), 100)
	assert.equal(L.computeCustomScore(scores, { a: 0, b: 0 }), null)
	assert.equal(L.computeCustomScore([], {}), null)
	assert.equal(L.computeCustomScore([{ key: 'a', value: null }], {}), null)
})

test('LiveBench default reproduces the site Overall column', () => {
	// Rows and Overall values copied from the leaderboard (release 2026-11-06).
	// Inputs are the site's already-rounded numbers, so the result may differ
	// from the site's by a rounding step.
	const cases = [
		{ values: [82.6, 81.5, 89.7, 95.6, 85.3, 94.5, 89.6], overall: 87.4 }, // Gemini 4 Neon
		{ values: [82.9, 85.1, 79.2, 86.9, 81.5, 94.5, 88.8], overall: 84.9 }, // Claude Fable 5.2
		{ values: [70.8, 82.8, 91.9, 93.0, 84.1, 91.5, 91.6], overall: 84.9 }, // GPT-6.2 Astra
		{ values: [74.7, 80.0, 87.5, 91.3, 83.0, 90.6, 92.7], overall: 84.3 }, // GPT-6 Astra
	]
	for (const c of cases) {
		const scores = model('x', c.values).scores
		const got = L.computeCustomScore(scores, defaultWeights)
		assert.ok(Math.abs(got - c.overall) <= 0.1, `${got} vs site ${c.overall}`)
	}
})

// ── Ranking ──────────────────────────────────────────────────────────

test('rankModels re-sorts by custom score and reports movement vs the site', () => {
	// Site order: A (90), B (80). With all weight on reasoning, B wins.
	const models = [
		{ name: 'A', siteOverall: 90, scores: [{ key: 'reasoning', value: 50 }, { key: 'coding', value: 100 }] },
		{ name: 'B', siteOverall: 80, scores: [{ key: 'reasoning', value: 95 }, { key: 'coding', value: 60 }] },
	]
	const out = L.rankModels(models, { reasoning: 1, coding: 0 })
	assert.deepEqual(out.map(m => m.name), ['B', 'A'])
	assert.deepEqual(out.map(m => m.rank), [1, 2])
	assert.deepEqual(out.map(m => m.siteRank), [2, 1])
	assert.deepEqual(out.map(m => m.delta), [1, -1])
})

test('rankModels keeps the site order for ties and puts unscored models last', () => {
	const models = [
		{ name: 'A', siteOverall: 80, scores: [{ key: 'x', value: 70 }] },
		{ name: 'Empty', siteOverall: 70, scores: [{ key: 'x', value: null }] },
		{ name: 'B', siteOverall: 60, scores: [{ key: 'x', value: 70 }] },
	]
	const out = L.rankModels(models, {})
	assert.deepEqual(out.map(m => m.name), ['A', 'B', 'Empty'])
	assert.equal(out[2].rank, null)
	assert.equal(out[2].delta, null)
})

test('rankModels has no movement when the page has no Overall column', () => {
	const out = L.rankModels([{ name: 'A', siteOverall: null, scores: [{ key: 'x', value: 1 }] }], {})
	assert.equal(out[0].rank, 1)
	assert.equal(out[0].siteRank, null)
	assert.equal(out[0].delta, null)
})

test('rankModels does not mutate its input', () => {
	const models = [model('A', [1, 2, 3, 4, 5, 6, 7], 50)]
	L.rankModels(models, {})
	assert.equal(models[0].rank, undefined)
})

// ── Echoed interpretation ────────────────────────────────────────────

test('weightShares sums to 100 and handles an all-zero set', () => {
	const shares = L.weightShares(['a', 'b', 'c'], { a: 2, b: 1, c: 1 })
	assert.equal(shares.get('a'), 50)
	assert.equal([...shares.values()].reduce((s, v) => s + v, 0), 100)
	const none = L.weightShares(['a', 'b'], { a: 0, b: 0 })
	assert.equal(none.get('a'), 0)
})

test('describeFormula says what is being computed', () => {
	const cols = [
		{ key: 'agentic', label: 'Agentic' },
		{ key: 'coding', label: 'Coding' },
		{ key: 'design', label: 'Design' },
	]
	assert.equal(L.describeFormula(cols, defaultWeights), 'Score = (2 × Agentic + 1.5 × Coding + 1.5 × Design) ÷ 5')
	assert.equal(L.describeFormula(cols, {}), 'Score = plain average of 3 suites')
	assert.equal(L.describeFormula(cols, { agentic: 0, coding: 2, design: 0 }), 'Score = Coding only')
	assert.equal(
		L.describeFormula(cols, { agentic: 0, coding: 0, design: 0 }),
		'Every weight is 0, so no score can be worked out.'
	)
	assert.equal(L.describeFormula(cols, { agentic: 0 }), 'Score = plain average of 2 suites')
})

test('describeMove', () => {
	assert.deepEqual(L.describeMove(3), { dir: 'up', text: '▲ 3' })
	assert.deepEqual(L.describeMove(-2), { dir: 'down', text: '▼ 2' })
	assert.equal(L.describeMove(0).dir, 'same')
	assert.equal(L.describeMove(null).dir, 'none')
})

// ── Profiles ─────────────────────────────────────────────────────────

test('validateProfileName accepts a fresh name and tidies whitespace', () => {
	const r = L.validateProfileName('  My   mix ', ['Other'], ['LiveBench default'])
	assert.deepEqual(r, { ok: true, name: 'My mix' })
})

test('validateProfileName rejects empty, long, built-in and duplicate names', () => {
	const builtins = L.BUILTIN_PROFILES.map(p => p.name)
	assert.equal(L.validateProfileName('   ', [], builtins).ok, false)
	assert.equal(L.validateProfileName('x'.repeat(L.MAX_NAME_LENGTH + 1), [], builtins).ok, false)
	assert.equal(L.validateProfileName('equal WEIGHT', [], builtins).ok, false)
	assert.equal(L.validateProfileName('mine', ['Mine'], builtins).ok, false)
	assert.equal(L.validateProfileName('__proto__', [], builtins).ok, false)
})

test('built-in profiles are well-formed and the default is first', () => {
	assert.equal(L.DEFAULT_PROFILE_NAME, 'LiveBench default')
	const names = L.BUILTIN_PROFILES.map(p => p.name)
	assert.equal(new Set(names).size, names.length)
	for (const p of L.BUILTIN_PROFILES) {
		assert.ok(p.note.length > 0, `${p.name} has a note`)
		assert.deepEqual(L.sanitizeWeights(p.weights), p.weights, `${p.name} weights are clean`)
	}
})
