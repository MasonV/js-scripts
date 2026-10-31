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

function loadPureLogic() {
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
    ]
    // eslint-disable-next-line no-new-func
    return new Function(
        'REDEEM_WINDOW_MS',
        'STEAM_REDEEMS_PER_HOUR',
        `${body}\nreturn { ${names.join(', ')} }`,
    )(REDEEM_WINDOW_MS, STEAM_REDEEMS_PER_HOUR)
}

const L = loadPureLogic()

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
