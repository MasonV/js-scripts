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
		'suiteScore',
		'parseTaskCount',
		'partKey',
		'groupColumnKey',
		'parseCsvRows',
		'matchRowsToIds',
		'buildBoard',
		'attachParts',
		'partShares',
		'changedParts',
		'describePartChanges',
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

// ── Parts: the scores underneath each suite ──────────────────────────

// Gemini 4 Neon's Coding parts from breakdown.json (release 2026-11-06),
// with the site's Coding score of 89.7.
const CODING_PARTS = [
	{ key: 'coding/llm api integration', tasks: 3, value: 100 },
	{ key: 'coding/agent loop', tasks: 3, value: 100 },
	{ key: 'coding/billing & limits', tasks: 3, value: 100 },
	{ key: 'coding/cloud infrastructure', tasks: 3, value: 100 },
	{ key: 'coding/product & ux', tasks: 4, value: 91.7 },
	{ key: 'coding/memory & tools', tasks: 3, value: 100 },
	{ key: 'coding/hard fixes', tasks: 5, value: 57.2 },
]
const codingEntry = { key: 'coding', value: 89.7, parts: CODING_PARTS }

test('suiteScore is the site score when no part weight is changed', () => {
	assert.equal(L.suiteScore(codingEntry, {}), 89.7)
	assert.equal(L.suiteScore(codingEntry, { 'coding/hard fixes': 1, coding: 3 }), 89.7)
	assert.equal(L.suiteScore({ key: 'x', value: 70, parts: null }, { 'x/y': 0 }), 70)
	assert.equal(L.suiteScore({ key: 'x', value: 70, parts: [] }, {}), 70)
	assert.equal(L.suiteScore({ key: 'x', value: null, parts: CODING_PARTS }, { 'coding/hard fixes': 0 }), null)
})

test('suiteScore moves with the part weights', () => {
	// Leaving out the weakest part lifts the score to the mean of the rest.
	const without = L.suiteScore(codingEntry, { 'coding/hard fixes': 0 })
	assert.ok(Math.abs(without - 98.25) < 0.01, String(without))
	// Counting it three times drags the score down.
	const triple = L.suiteScore(codingEntry, { 'coding/hard fixes': 3 })
	assert.ok(triple < 89.7 && triple > 70, String(triple))
	// Only one part left → that part's score (shifted by the site's gap, here ~0).
	const only = L.suiteScore(codingEntry, Object.fromEntries(CODING_PARTS.slice(1).map(p => [p.key, 0])))
	assert.ok(Math.abs(only - 100) < 0.01, String(only))
})

test('suiteScore keeps the site gap, skips unscored parts, and stays within 0–100', () => {
	// The site's own score is 4 below the parts' mean (a regression penalty,
	// say). The gap survives a change that doesn't touch the parts' mean.
	const parts = [
		{ key: 'a/p', tasks: 1, value: 80 },
		{ key: 'a/q', tasks: 1, value: 80 },
	]
	assert.equal(L.suiteScore({ key: 'a', value: 76, parts }, { 'a/p': 2 }), 76)
	assert.equal(L.suiteScore({ key: 'a', value: 99, parts: [{ key: 'a/p', tasks: 1, value: 50 }, { key: 'a/q', tasks: 1, value: 100 }] }, { 'a/p': 0 }), 100)
	assert.equal(L.suiteScore({ key: 'a', value: 1, parts: [{ key: 'a/p', tasks: 1, value: 100 }, { key: 'a/q', tasks: 1, value: 0 }] }, { 'a/p': 0 }), 0)
	// A part with no score is ignored, not treated as 0.
	const gap = [
		{ key: 'a/p', tasks: 1, value: 90 },
		{ key: 'a/q', tasks: 1, value: null },
	]
	assert.equal(L.suiteScore({ key: 'a', value: 90, parts: gap }, { 'a/q': 0 }), 90)
	assert.equal(L.suiteScore({ key: 'a', value: 90, parts: [{ key: 'a/q', tasks: 1, value: null }] }, { 'a/q': 0 }), 90)
})

test('suiteScore is null when every part is set to 0', () => {
	const zero = Object.fromEntries(CODING_PARTS.map(p => [p.key, 0]))
	assert.equal(L.suiteScore(codingEntry, zero), null)
})

test('computeCustomScore uses part weights, and leaves out a suite whose parts are all 0', () => {
	const scores = [
		{ key: 'coding', value: 89.7, parts: CODING_PARTS },
		{ key: 'research', value: 60, parts: null },
	]
	assert.equal(L.computeCustomScore(scores, {}), (89.7 + 60) / 2)
	const lifted = L.computeCustomScore(scores, { 'coding/hard fixes': 0 })
	assert.ok(lifted > (89.7 + 60) / 2)
	const zero = Object.fromEntries(CODING_PARTS.map(p => [p.key, 0]))
	assert.equal(L.computeCustomScore(scores, zero), 60)
})

test('parseTaskCount reads the count from a header', () => {
	assert.equal(L.parseTaskCount('LLM API INTEGRATION (3)'), 3)
	assert.equal(L.parseTaskCount('Documents (DOCX) (5)'), 5)
	assert.equal(L.parseTaskCount('Documents (DOCX)'), null)
	assert.equal(L.parseTaskCount('Coding'), null)
	assert.equal(L.parseTaskCount(undefined), null)
})

test('partKey and groupColumnKey line up the site’s names', () => {
	assert.equal(L.partKey('coding', 'Hard Fixes'), 'coding/hard fixes')
	assert.equal(L.partKey('design', 'Documents (DOCX)'), 'design/documents (docx)')
	assert.equal(L.groupColumnKey('Long Agentic'), 'agentic')
	assert.equal(L.groupColumnKey('Browser'), 'browser use')
	assert.equal(L.groupColumnKey('Data Analysis'), 'data analysis')
	assert.equal(L.groupColumnKey('constructor'), 'constructor')
})

test('parseCsvRows reads ids and numeric scores', () => {
	const rows = L.parseCsvRows('model,a,b\nm-1,10.5,20\r\nm-2,30,\n\n')
	assert.deepEqual(rows, [
		{ id: 'm-1', values: [10.5, 20] },
		{ id: 'm-2', values: [30] },
	])
	assert.deepEqual(L.parseCsvRows(''), [])
})

test('matchRowsToIds finds each row’s model from its scores', () => {
	const candidates = [
		{ id: 'a', values: [82.6, 81.5, 89.7] },
		{ id: 'b', values: [70.8, 82.8, 91.9] },
		{ id: 'c', values: [70.8, 82.8, 91.9] }, // identical to b
	]
	// Order of cells doesn't matter; a hidden column still matches.
	assert.deepEqual(L.matchRowsToIds([[89.7, 82.6, 81.5]], candidates), ['a'])
	assert.deepEqual(L.matchRowsToIds([[82.6, 89.7]], candidates), ['a'])
	// Two models with the same scores can't be told apart.
	assert.deepEqual(L.matchRowsToIds([[70.8, 82.8, 91.9]], candidates), [null])
	// Unknown scores and empty rows match nothing.
	assert.deepEqual(L.matchRowsToIds([[1, 2, 3], []], candidates), [null, null])
})

test('matchRowsToIds never gives one model to two rows', () => {
	const candidates = [{ id: 'a', values: [50, 60] }]
	assert.deepEqual(L.matchRowsToIds([[50, 60], [60]], candidates), [null, null])
})

// A table as readLeaderboard() reads it, trimmed to two models.
const rawSuites = {
	hasOverall: true,
	overallLabel: 'Overall',
	columns: [
		{ key: 'agentic', label: 'Agentic', tasks: null },
		{ key: 'coding', label: 'Coding', tasks: null },
	],
	models: [
		{ name: 'Alpha', siteOverall: 90, values: [80, 100] },
		{ name: 'Beta', siteOverall: 70, values: [60, 80] },
	],
}
const breakdown = {
	'Long Agentic': {
		parts: [
			{ name: 'Apps', tasks: 3 },
			{ name: 'Ops', tasks: 1 },
		],
		models: {
			'model-a': { scores: { Apps: 80, Ops: 80 } },
			'model-b': { scores: { Apps: 60, Ops: 60 } },
		},
	},
	Coding: {
		parts: [
			{ name: 'Easy', tasks: 1 },
			{ name: 'Hard', tasks: 1 },
		],
		models: {
			'model-a': { scores: { Easy: 100, Hard: 100 } },
			'model-b': { scores: { Easy: 100, Hard: 60 } },
		},
	},
}
const csvRows = [
	{ id: 'model-a', values: [80, 100, 55] },
	{ id: 'model-b', values: [60, 80, 40] },
]

test('buildBoard treats suite columns as suites', () => {
	const board = L.buildBoard(rawSuites)
	assert.equal(board.kind, 'suites')
	assert.deepEqual(board.columns, [
		{ key: 'agentic', label: 'Agentic' },
		{ key: 'coding', label: 'Coding' },
	])
	assert.deepEqual(board.models[0].scores, [
		{ key: 'agentic', value: 80 },
		{ key: 'coding', value: 100 },
	])
})

test('buildBoard reads a selected category as the parts of one suite', () => {
	const raw = {
		hasOverall: true,
		overallLabel: 'Coding',
		columns: [
			{ key: 'easy', label: 'Easy', tasks: 1 },
			{ key: 'hard', label: 'Hard', tasks: 1 },
		],
		models: [{ name: 'Alpha', siteOverall: 80, values: [100, 60] }],
	}
	const board = L.buildBoard(raw)
	assert.equal(board.kind, 'parts')
	assert.equal(board.suiteLabel, 'Coding')
	assert.deepEqual(board.columns.map(c => c.key), ['coding/easy', 'coding/hard'])
	assert.equal(board.models[0].scores[0].value, 80)
	// The same keys the suites view uses, so one weight serves both views.
	assert.equal(L.partKey('coding', 'Hard'), board.columns[1].key)
	// A suite weight of 0 elsewhere doesn't blank this view.
	assert.equal(L.rankModels(board.models, { coding: 0 })[0].score, 80)
	// And part weights apply.
	assert.ok(L.rankModels(board.models, { 'coding/hard': 0 })[0].score > 80)
})

test('buildBoard needs the Overall column and a count on every column for a parts view', () => {
	const noCounts = { ...rawSuites, overallLabel: 'Coding' }
	assert.equal(L.buildBoard(noCounts).kind, 'suites')
	const noOverall = {
		...rawSuites,
		hasOverall: false,
		columns: rawSuites.columns.map(c => ({ ...c, tasks: 2 })),
	}
	assert.equal(L.buildBoard(noOverall).kind, 'suites')
})

test('attachParts adds each suite’s parts and matches rows to models by score', () => {
	const board = L.attachParts(L.buildBoard(rawSuites), breakdown, csvRows)
	assert.equal(board.partsStatus, 'ready')
	assert.equal(board.unmatched, 0)
	assert.deepEqual(board.columns[0].parts.map(p => p.key), ['agentic/apps', 'agentic/ops'])
	assert.deepEqual(board.models[1].scores[1].parts, [
		{ key: 'coding/easy', tasks: 1, value: 100 },
		{ key: 'coding/hard', tasks: 1, value: 60 },
	])
})

test('with every part at ×1, attaching parts leaves every score unchanged', () => {
	const plain = L.rankModels(L.buildBoard(rawSuites).models, {})
	const withParts = L.rankModels(L.attachParts(L.buildBoard(rawSuites), breakdown, csvRows).models, {})
	assert.deepEqual(withParts.map(m => m.score), plain.map(m => m.score))
})

test('changing a part weight re-scores only the models that have parts', () => {
	const board = L.attachParts(L.buildBoard(rawSuites), breakdown, csvRows)
	const base = L.rankModels(board.models, {})
	const tweaked = L.rankModels(board.models, { 'coding/hard': 0 })
	const score = (list, name) => list.find(m => m.name === name).score
	assert.equal(score(tweaked, 'Alpha'), score(base, 'Alpha')) // its Hard part equals its Easy part
	assert.ok(score(tweaked, 'Beta') > score(base, 'Beta')) // its weak part no longer counts
})

test('attachParts reports models it could not match, and leaves them at their suite scores', () => {
	const stranger = {
		...rawSuites,
		models: [...rawSuites.models, { name: 'Gamma', siteOverall: 50, values: [11, 12] }],
	}
	const board = L.attachParts(L.buildBoard(stranger), breakdown, csvRows)
	assert.equal(board.unmatched, 1)
	assert.equal(board.models[2].scores[1].parts, undefined)
	const ranked = L.rankModels(board.models, { 'coding/hard': 0 })
	assert.equal(ranked.find(m => m.name === 'Gamma').score, (11 + 12) / 2)
})

test('attachParts copes with missing or odd data', () => {
	const board = L.buildBoard(rawSuites)
	assert.equal(L.attachParts(board, null, csvRows), board)
	assert.equal(L.attachParts(board, [], csvRows).partsStatus, 'ready')
	const odd = L.attachParts(board, { Coding: { parts: [{ name: 5 }, { name: 'X', tasks: 0 }], models: {} } }, csvRows)
	assert.equal(odd.columns[1].parts, null)
	// A suite the breakdown doesn't know keeps just its suite score.
	assert.equal(L.attachParts(board, { Unknown: { parts: [], models: {} } }, csvRows).columns[0].parts, null)
})

test('partShares starts at the site’s task shares and follows your weights', () => {
	const parts = [
		{ key: 'a/x', tasks: 3 },
		{ key: 'a/y', tasks: 1 },
	]
	assert.equal(L.partShares(parts, {}).get('a/x'), 75)
	assert.equal(L.partShares(parts, { 'a/x': 0 }).get('a/y'), 100)
	assert.equal(L.partShares(parts, { 'a/x': 0, 'a/y': 0 }).get('a/y'), 0)
})

test('describePartChanges names what was changed', () => {
	const board = L.attachParts(L.buildBoard(rawSuites), breakdown, csvRows)
	assert.equal(L.describePartChanges(board, {}), '')
	assert.equal(L.describePartChanges(board, { 'coding/hard': 2 }), 'Part weights changed in: Coding.')
	assert.equal(L.describePartChanges(board, { 'coding/hard': 2, 'agentic/ops': 0 }), 'Part weights changed in: Agentic, Coding.')

	const parts = L.buildBoard({
		hasOverall: true,
		overallLabel: 'Coding',
		columns: [
			{ key: 'easy', label: 'Easy', tasks: 1 },
			{ key: 'hard', label: 'Hard', tasks: 1 },
		],
		models: [],
	})
	assert.equal(L.describePartChanges(parts, {}), 'Coding score matches the site (every part ×1).')
	assert.equal(
		L.describePartChanges(parts, { 'coding/hard': 0, 'coding/easy': 2 }),
		'Coding score = the site’s, adjusted for: Easy ×2, Hard left out.'
	)
})

test('part weights ride along in a saved profile and count toward "unsaved changes"', () => {
	assert.ok(L.sameWeights({ 'coding/hard fixes': 1 }, {}))
	assert.ok(!L.sameWeights({ 'coding/hard fixes': 3 }, {}))
	assert.deepEqual(L.sanitizeWeights({ 'coding/hard fixes': 3, junk: 'x' }), { 'coding/hard fixes': 3 })
})
