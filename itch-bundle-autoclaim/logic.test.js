// Unit tests for Itch Bundle Autoclaim pure rate-mitigation logic.
// Run with: node --test itch-bundle-autoclaim/logic.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadPureLogic() {
    const src = fs.readFileSync(
        path.join(__dirname, 'itch-bundle-autoclaim.user.js'),
        'utf8',
    )
    const startMarker = '//  PURE LOGIC'
    const startIdx = src.indexOf(startMarker)
    assert.ok(startIdx !== -1, 'PURE LOGIC section header not found in user.js')
    const afterStart = src.indexOf('═\n', startIdx) + 2
    const nextSection = src.indexOf('// ═══════════════════════════════════════════════════════════════════', afterStart)
    assert.ok(nextSection !== -1, 'Next section header after PURE LOGIC not found')
    const slice = src.slice(afterStart, nextSection)
    const factory = new Function(`
        "use strict";
        const CLAIM_DELAY_MS = 400;
        const MAX_BACKOFF_MS = 10000;
        const MAX_CONSECUTIVE_FAILURES = 3;
        const MAX_CLAIMS_PER_MINUTE = 60;
        const RATE_WINDOW_MS = 60 * 1000;
        ${slice}
        return {
            parseRetryAfterMs,
            isLoginRedirectUrl,
            classifyClaimResponse,
            computeBackoffDelayMs,
            pruneClaimTimestamps,
            computeRateCapWaitMs,
        };
    `)
    return factory()
}

const {
    parseRetryAfterMs,
    isLoginRedirectUrl,
    classifyClaimResponse,
    computeBackoffDelayMs,
    pruneClaimTimestamps,
    computeRateCapWaitMs,
} = loadPureLogic()

describe('parseRetryAfterMs', () => {
    test('returns 0 for null, empty, or invalid values', () => {
        assert.equal(parseRetryAfterMs(null), 0)
        assert.equal(parseRetryAfterMs(undefined), 0)
        assert.equal(parseRetryAfterMs(''), 0)
        assert.equal(parseRetryAfterMs('   '), 0)
        assert.equal(parseRetryAfterMs('not-a-date-or-number'), 0)
        assert.equal(parseRetryAfterMs('0'), 0)
    })

    test('parses numeric seconds and fractional seconds into ms', () => {
        assert.equal(parseRetryAfterMs('5'), 5000)
        assert.equal(parseRetryAfterMs(' 12 '), 12000)
        assert.equal(parseRetryAfterMs('1.5'), 1500)
    })

    test('parses HTTP-date relative to now', () => {
        const now = Date.parse('2026-10-31T02:00:00Z')
        assert.equal(parseRetryAfterMs('Sat, 31 Oct 2026 02:00:08 GMT', now), 8000)
        // Past date clamps to 0
        assert.equal(parseRetryAfterMs('Sat, 31 Oct 2026 01:59:50 GMT', now), 0)
    })
})

describe('isLoginRedirectUrl', () => {
    test('detects itch.io login redirect URLs', () => {
        assert.equal(isLoginRedirectUrl('https://itch.io/login'), true)
        assert.equal(isLoginRedirectUrl('https://itch.io/login?return_to=%2Fbundle%2Fdownload%2F123'), true)
        assert.equal(isLoginRedirectUrl('https://itch.io/user/login'), true)
        assert.equal(isLoginRedirectUrl('/login'), true)
    })

    test('ignores normal bundle and game download URLs', () => {
        assert.equal(isLoginRedirectUrl('https://itch.io/bundle/download/abc123?page=2'), false)
        assert.equal(isLoginRedirectUrl('https://some-dev.itch.io/login-simulator/download/xyz'), false)
        assert.equal(isLoginRedirectUrl(''), false)
        assert.equal(isLoginRedirectUrl(null), false)
    })
})

describe('classifyClaimResponse', () => {
    function makeHeaders(map = {}) {
        return {
            get(name) {
                const key = Object.keys(map).find(k => k.toLowerCase() === name.toLowerCase())
                return key ? map[key] : null
            },
        }
    }

    test('accepts 200 OK response on bundle/download URL', () => {
        const res = classifyClaimResponse({
            ok: true,
            status: 200,
            type: 'basic',
            url: 'https://itch.io/bundle/download/abc123',
            headers: makeHeaders(),
        })
        assert.deepEqual(res, { ok: true, status: 200, reason: null, retryAfterMs: 0 })
    })

    test('flags HTTP 429 rate limiting and extracts Retry-After', () => {
        const res = classifyClaimResponse({
            ok: false,
            status: 429,
            type: 'basic',
            url: 'https://itch.io/bundle/download/abc123',
            headers: makeHeaders({ 'Retry-After': '7' }),
        })
        assert.deepEqual(res, {
            ok: false,
            status: 429,
            reason: 'Rate limited (HTTP 429)',
            retryAfterMs: 7000,
        })
    })

    test('flags redirect to /login even when final GET status is 200', () => {
        const res = classifyClaimResponse({
            ok: true,
            status: 200,
            type: 'basic',
            url: 'https://itch.io/login?return_to=...',
            headers: makeHeaders(),
        })
        assert.equal(res.ok, false)
        assert.equal(res.reason, 'Redirected to login (session expired)')
    })

    test('rejects opaqueredirect and 5xx errors', () => {
        const opaque = classifyClaimResponse({
            ok: false,
            status: 0,
            type: 'opaqueredirect',
            url: '',
            headers: makeHeaders(),
        })
        assert.equal(opaque.ok, false)
        assert.match(opaque.reason, /Opaque redirect/)

        const err503 = classifyClaimResponse({
            ok: false,
            status: 503,
            type: 'basic',
            url: 'https://itch.io/bundle/download/abc123',
            headers: makeHeaders({ 'Retry-After': '4' }),
        })
        assert.deepEqual(err503, {
            ok: false,
            status: 503,
            reason: 'HTTP 503',
            retryAfterMs: 4000,
        })
    })
})

describe('computeBackoffDelayMs', () => {
    test('returns base delay on 0 failures and doubles on consecutive failures up to cap', () => {
        assert.equal(computeBackoffDelayMs(400, 0), 400)
        assert.equal(computeBackoffDelayMs(400, 1), 800)
        assert.equal(computeBackoffDelayMs(400, 2), 1600)
        assert.equal(computeBackoffDelayMs(400, 3), 3200)
        assert.equal(computeBackoffDelayMs(400, 6, 0, 10000), 10000)
    })

    test('honours Retry-After when larger than computed backoff', () => {
        assert.equal(computeBackoffDelayMs(400, 1, 6000, 10000), 6000)
        assert.equal(computeBackoffDelayMs(400, 1, 15000, 10000), 15000)
        assert.equal(computeBackoffDelayMs(400, 2, 500, 10000), 1600)
    })
})

describe('pruneClaimTimestamps & computeRateCapWaitMs', () => {
    test('allows claims when under the 60/min cap', () => {
        const now = 100_000
        const stamps = Array.from({ length: 59 }, (_, i) => now - i * 500)
        assert.equal(computeRateCapWaitMs(stamps, now, 60, 60_000), 0)
    })

    test('computes wait time until oldest timestamp in window expires when at 60/min cap', () => {
        const now = 100_000
        // 60 claims between t=60_000 and t=89_500 (oldest in window is 60_000)
        const stamps = Array.from({ length: 60 }, (_, i) => 60_000 + i * 500)
        // Oldest is at 60_000; window is 60_000 -> expires at 120_000 -> 20_000ms wait
        assert.equal(computeRateCapWaitMs(stamps, now, 60, 60_000), 20_000)
    })

    test('prunes expired timestamps outside the rolling minute', () => {
        const now = 100_000
        const stamps = [10_000, 39_999, 40_000, 40_001, 99_500]
        assert.deepEqual(pruneClaimTimestamps(stamps, now, 60_000), [40_001, 99_500])
    })
})
