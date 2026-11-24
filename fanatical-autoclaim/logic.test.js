// Tests for the PURE LOGIC section of fanatical-autoclaim.user.js.
// The section's source is sliced out of the userscript and evaluated as-is,
// so these tests can't drift from the shipped code.
//
//   node --test fanatical-autoclaim/logic.test.js

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REDEEM_WINDOW_MS = 60 * 60 * 1000
const STEAM_REDEEMS_PER_HOUR = 30

function loadLogic() {
    const src = fs.readFileSync(path.join(__dirname, 'fanatical-autoclaim.user.js'), 'utf8')
    const start = src.indexOf('//  PURE LOGIC')
    assert.ok(start > 0, 'PURE LOGIC section not found')
    const bodyStart = src.indexOf('\n', src.indexOf('// ═', start)) + 1
    const end = src.indexOf('// ═', bodyStart)
    const body = src.slice(bodyStart, end)
    const names = [
        'pruneRedeemLog',
        'getRedeemPaceState',
        'formatWaitTime',
        'formatPaceLabel',
        'pickNextRedeem',
        'MIN_REVEAL_DELAY_MS',
        'MAX_REVEAL_DELAY_MS',
        'MAX_BACKOFF_MS',
        'MAX_CONSECUTIVE_FAILURES',
        'REVEAL_VERIFY_TIMEOUT_MS',
        'REVEAL_POLL_INTERVAL_MS',
        'clampRevealDelay',
        'computeRevealBackoffMs',
        'recordRevealOutcome',
    ]
    // eslint-disable-next-line no-new-func
    return new Function(
        'REDEEM_WINDOW_MS',
        'STEAM_REDEEMS_PER_HOUR',
        `${body}\nreturn { ${names.join(', ')} }`,
    )(REDEEM_WINDOW_MS, STEAM_REDEEMS_PER_HOUR)
}

const loadPureLogic = loadLogic
const L = loadLogic()

test('pruneRedeemLog keeps only valid timestamps within the rolling hour', () => {
    const now = 10_000_000
    const log = [
        now - REDEEM_WINDOW_MS - 1, // expired
        now - REDEEM_WINDOW_MS,     // boundary expired
        now - 10_000,               // valid
        now - 30_000,               // valid (out of order)
        now + 5_000,                // future
        'bad',
        NaN,
    ]
    assert.deepEqual(L.pruneRedeemLog(log, now), [now - 30_000, now - 10_000])
    assert.deepEqual(L.pruneRedeemLog(null, now), [])
})

test('getRedeemPaceState enforces cap and calculates nextSlotMs from oldest active entry', () => {
    const now = 10_000_000
    const under = L.getRedeemPaceState([now - 50_000, now - 10_000], now, 3, REDEEM_WINDOW_MS)
    assert.equal(under.count, 2)
    assert.equal(under.allowed, true)
    assert.equal(under.nextSlotMs, 0)
    assert.equal(L.formatPaceLabel(under), '2 of 3 this hour')

    const atCap = L.getRedeemPaceState(
        [now - 40 * 60 * 1000, now - 20 * 60 * 1000, now - 5 * 60 * 1000],
        now,
        3,
        REDEEM_WINDOW_MS,
    )
    assert.equal(atCap.count, 3)
    assert.equal(atCap.allowed, false)
    assert.equal(atCap.nextSlotMs, 20 * 60 * 1000)
    assert.equal(L.formatPaceLabel(atCap), '3 of 3 this hour — next slot in 20m')
})

test('formatWaitTime handles seconds, minutes, and non-positive values', () => {
    assert.equal(L.formatWaitTime(0), '0s')
    assert.equal(L.formatWaitTime(-100), '0s')
    assert.equal(L.formatWaitTime(15_200), '16s')
    assert.equal(L.formatWaitTime(61_000), '2m')
})

test('pickNextRedeem selects the next unopened redeem URL and tracks progress', () => {
    const urls = [
        { url: 'steam://registerkey/AAAAA-BBBBB-CCCCC', name: 'Game A' },
        { url: 'steam://registerkey/DDDDD-EEEEE-FFFFF', name: 'Game B' },
    ]
    const opened = new Set()

    let step = L.pickNextRedeem(urls, opened)
    assert.equal(step.next.name, 'Game A')
    assert.equal(step.openedCount, 0)
    assert.equal(step.total, 2)

    opened.add(step.next.url)
    step = L.pickNextRedeem(urls, opened)
    assert.equal(step.next.name, 'Game B')
    assert.equal(step.openedCount, 1)

    opened.add(step.next.url)
    step = L.pickNextRedeem(urls, opened)
    assert.equal(step.next, null)
    assert.equal(step.openedCount, 2)
})

test('exports expected constants with correct defaults', () => {
    assert.equal(L.MIN_REVEAL_DELAY_MS, 500)
    assert.equal(L.MAX_REVEAL_DELAY_MS, 60000)
    assert.equal(L.MAX_BACKOFF_MS, 30000)
    assert.equal(L.MAX_CONSECUTIVE_FAILURES, 3)
    assert.equal(L.REVEAL_VERIFY_TIMEOUT_MS, 5000)
    assert.equal(L.REVEAL_POLL_INTERVAL_MS, 100)
})

test('clampRevealDelay clamps within [500, 60000] and falls back safely', () => {
    // Valid values
    assert.equal(L.clampRevealDelay(500), 500)
    assert.equal(L.clampRevealDelay(1000), 1000)
    assert.equal(L.clampRevealDelay(60000), 60000)
    assert.equal(L.clampRevealDelay(1500.9), 1500)

    // Below minimum
    assert.equal(L.clampRevealDelay(100), 500)
    assert.equal(L.clampRevealDelay(0), 500)
    assert.equal(L.clampRevealDelay(-100), 500)

    // Above maximum
    assert.equal(L.clampRevealDelay(70000), 60000)
    assert.equal(L.clampRevealDelay(1000000), 60000)

    // Non-finite or invalid numbers fall back to defaultMs clamped to [500, 60000]
    assert.equal(L.clampRevealDelay(NaN), 500)
    assert.equal(L.clampRevealDelay('invalid'), 500)
    assert.equal(L.clampRevealDelay(null), 500)
    assert.equal(L.clampRevealDelay(undefined), 500)
    assert.equal(L.clampRevealDelay(NaN, 2000), 2000)
    assert.equal(L.clampRevealDelay(0, 200), 500)
    assert.equal(L.clampRevealDelay(null, 80000), 60000)
})

test('computeRevealBackoffMs computes exponential backoff capped at maxBackoffMs', () => {
    // 0 or negative failures returns clamped base delay
    assert.equal(L.computeRevealBackoffMs(500, 0), 500)
    assert.equal(L.computeRevealBackoffMs(500, -1), 500)
    assert.equal(L.computeRevealBackoffMs(100, 0), 500) // clamps base delay

    // Consecutive failures: base * 2^failures
    assert.equal(L.computeRevealBackoffMs(500, 1), 1000)
    assert.equal(L.computeRevealBackoffMs(500, 2), 2000)
    assert.equal(L.computeRevealBackoffMs(500, 3), 4000)
    assert.equal(L.computeRevealBackoffMs(1000, 2), 4000)

    // Cap at MAX_BACKOFF_MS (30000)
    assert.equal(L.computeRevealBackoffMs(500, 6), 30000)
    assert.equal(L.computeRevealBackoffMs(500, 10), 30000)

    // Custom maxBackoffMs
    assert.equal(L.computeRevealBackoffMs(500, 2, 1500), 1500)
})

test('recordRevealOutcome tracks consecutive failures and halts at threshold', () => {
    // Success resets consecutiveFailures and does not halt
    assert.deepEqual(L.recordRevealOutcome(0, true), { consecutiveFailures: 0, halted: false })
    assert.deepEqual(L.recordRevealOutcome(2, true), { consecutiveFailures: 0, halted: false })

    // Failures increment consecutiveFailures
    assert.deepEqual(L.recordRevealOutcome(0, false), { consecutiveFailures: 1, halted: false })
    assert.deepEqual(L.recordRevealOutcome(1, false), { consecutiveFailures: 2, halted: false })
    assert.deepEqual(L.recordRevealOutcome(2, false), { consecutiveFailures: 3, halted: true })
    assert.deepEqual(L.recordRevealOutcome(3, false), { consecutiveFailures: 4, halted: true })

    // Handles invalid / missing consecutiveFailures
    assert.deepEqual(L.recordRevealOutcome(undefined, false), { consecutiveFailures: 1, halted: false })
    assert.deepEqual(L.recordRevealOutcome('bad', false), { consecutiveFailures: 1, halted: false })

    // Custom maxFailures threshold
    assert.deepEqual(L.recordRevealOutcome(0, false, 2), { consecutiveFailures: 1, halted: false })
    assert.deepEqual(L.recordRevealOutcome(1, false, 2), { consecutiveFailures: 2, halted: true })
})

test('teardownPanel clears paceInterval, aborts reveal, and is wired to panel close', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fanatical-autoclaim.user.js'), 'utf8')
    const teardownMatch = src.match(/function teardownPanel\(\)\s*\{[\s\S]*?\n    \}/)
    assert.ok(teardownMatch, 'teardownPanel not found')

    const closeMatch = src.match(/const closeBtn = panel\.querySelector\('#fac-close-btn'\)[\s\S]*?\n        \}/)
    assert.ok(closeMatch, 'closeBtn handler not found')
    assert.match(closeMatch[0], /teardownPanel\(\)/)

    const cleared = []
    let removed = false
    // eslint-disable-next-line no-new-func
    const runTeardown = new Function(
        'clearInterval',
        'removePanel',
        `
        let revealAborted = false
        let paceInterval = 42
        let revealBtn = {}, redeemBtn = {}, paceEl = {}
        ${teardownMatch[0]}
        teardownPanel()
        return { revealAborted, paceInterval, revealBtn, redeemBtn, paceEl }
        `,
    )(
        id => cleared.push(id),
        () => {
            removed = true
        },
    )

    assert.equal(runTeardown.revealAborted, true)
    assert.equal(runTeardown.paceInterval, null)
    assert.deepEqual(cleared, [42])
    assert.equal(removed, true)
    assert.equal(runTeardown.revealBtn, null)
    assert.equal(runTeardown.redeemBtn, null)
    assert.equal(runTeardown.paceEl, null)
})

test('waitForOrderContent detects revealed Steam keys without Reveal/Redeem buttons', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fanatical-autoclaim.user.js'), 'utf8')
    const waitMatch = src.match(/function waitForOrderContent\([\s\S]*?\n    \}/)
    assert.ok(waitMatch, 'waitForOrderContent not found')

    let scheduledFn = null
    const cleared = []
    let callbackCalls = 0
    const logs = []
    const warns = []

    // eslint-disable-next-line no-new-func
    const runWait = new Function(
        'setInterval',
        'clearInterval',
        'findButtonsByText',
        'findSteamKeys',
        'log',
        'warn',
        `
        let waitInterval = null
        ${waitMatch[0]}
        return waitForOrderContent
        `,
    )(
        fn => {
            scheduledFn = fn
            return 99
        },
        id => {
            if (id != null) cleared.push(id)
        },
        () => [],
        () => [{ key: 'AAAAA-BBBBB-CCCCC', element: {} }],
        msg => logs.push(msg),
        msg => warns.push(msg),
    )

    runWait(() => {
        callbackCalls++
    }, 15000)

    assert.equal(typeof scheduledFn, 'function')
    scheduledFn()

    assert.equal(callbackCalls, 1)
    assert.deepEqual(cleared, [99])
    assert.equal(warns.length, 0)
    assert.equal(logs.length, 1)
    assert.match(logs[0], /Order content detected/)
})

test('showPanel reports collectRedeemUrls().length as ready count when keys are revealed without Redeem buttons', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fanatical-autoclaim.user.js'), 'utf8')
    const showMatch = src.match(/function showPanel\(\)\s*\{[\s\S]*?\n    \}/)
    assert.ok(showMatch, 'showPanel not found')

    const statuses = []
    const logs = []

    // eslint-disable-next-line no-new-func
    const runShow = new Function(
        'injectStyles',
        'teardownPanel',
        'openedRedeemUrls',
        'createPanel',
        'refreshPaceUI',
        'setInterval',
        'findButtonsByText',
        'findSteamKeys',
        'collectRedeemUrls',
        'log',
        'updateStatus',
        `
        let paceInterval = null
        ${showMatch[0]}
        showPanel()
        `,
    )

    runShow(
        () => {},
        () => {},
        new Set(['steam://registerkey/OLD']),
        () => {},
        () => {},
        () => 123,
        () => [],
        () => [
            { key: 'AAAAA-BBBBB-CCCCC', element: {} },
            { key: 'DDDDD-EEEEE-FFFFF', element: {} },
        ],
        () => [
            { url: 'steam://registerkey/AAAAA-BBBBB-CCCCC', name: 'Game A' },
            { url: 'steam://registerkey/DDDDD-EEEEE-FFFFF', name: 'Game B' },
        ],
        msg => logs.push(msg),
        msg => statuses.push(msg),
    )

    assert.deepEqual(statuses, ['0 to reveal, 2 ready'])
    assert.equal(logs.length, 1)
    assert.match(logs[0], /0 to reveal, 0 redeem buttons, 2 visible keys/)
})

test('createPanel initializes delay input with current revealDelayMs instead of DEFAULT_REVEAL_DELAY_MS', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fanatical-autoclaim.user.js'), 'utf8')
    const createMatch = src.match(/function createPanel\(\)\s*\{[\s\S]*?\n    \}/)
    assert.ok(createMatch, 'createPanel not found')

    const makeEl = () => ({
        id: '',
        className: '',
        textContent: '',
        min: '',
        max: '',
        value: '',
        children: [],
        addEventListener() {},
        appendChild(child) {
            this.children.push(child)
        },
        querySelector() {
            return null
        },
    })

    let capturedDelayInitialValue = null

    // eslint-disable-next-line no-new-func
    const runCreate = new Function(
        'buildPanelShell',
        'teardownPanel',
        'revealAllKeys',
        'redeemNextOnSteam',
        'createDelayInput',
        'clampRevealDelay',
        'createStatusLine',
        'document',
        'DEFAULT_REVEAL_DELAY_MS',
        'MIN_REVEAL_DELAY_MS',
        'MAX_REVEAL_DELAY_MS',
        `
        let revealBtn = null
        let redeemBtn = null
        let paceEl = null
        let revealDelayMs = 2500
        ${createMatch[0]}
        createPanel()
        `,
    )

    runCreate(
        () => makeEl(),
        () => {},
        () => {},
        () => {},
        (_label, initialValue) => {
            capturedDelayInitialValue = initialValue
            return makeEl()
        },
        v => v,
        () => {},
        {
            createElement: () => makeEl(),
            body: { appendChild() {} },
        },
        500,
        500,
        60000,
    )

    assert.equal(capturedDelayInitialValue, 2500)
})
