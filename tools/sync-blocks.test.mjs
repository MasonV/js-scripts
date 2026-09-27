// node --test tools/sync-blocks.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCKS, loadTemplates, render, syncBlock } from './sync-blocks.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const templates = loadTemplates(ROOT)
const block = name => BLOCKS.find(b => b.name === name)

// ═══════════════════════════════════════════════════════════════════
//  SYNC ENGINE
// ═══════════════════════════════════════════════════════════════════

test('render re-indents tab-authored templates to the host indent', () => {
  const out = render('a()\n\tb()\n\n\t\tc()', 'my-script', '    ')
  assert.equal(out, '    a()\n        b()\n\n            c()')
})

test('render fills SLUG and STORAGE_PREFIX', () => {
  assert.equal(render("'{{SLUG}}' '{{STORAGE_PREFIX}}'", 'my-script', ''), "'my-script' 'my_script'")
})

test('syncBlock fills an empty marked region and is idempotent', () => {
  const b = { name: 'demo' }
  const host = 'x()\n  // <demo>\n  // </demo>\ny()'
  const once = syncBlock(host, b, 'one()\n\ttwo()', 's')
  assert.equal(once, 'x()\n  // <demo>\n  one()\n    two()\n  // </demo>\ny()')
  assert.equal(syncBlock(once, b, 'one()\n\ttwo()', 's'), once)
})

test('syncBlock: optional blocks may be absent, required ones may not', () => {
  assert.equal(syncBlock('x()', { name: 'demo' }, '', 's'), 'absent')
  assert.equal(syncBlock('x()', { name: 'demo', required: true }, '', 's'), 'missing-markers')
})

test('syncBlock rejects broken markers', () => {
  assert.equal(syncBlock('// <demo>\nx()', { name: 'demo' }, '', 's'), 'unpaired-marker')
  assert.equal(syncBlock('// </demo>\n// <demo>', { name: 'demo' }, '', 's'), 'markers-out-of-order')
})

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE PURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
//
// The templates are script fragments, not modules. Evaluate the real
// template text in a function scope and pull out what's pure, so these
// tests can't drift from the code that ships.

function evalBlocks(names, exportNames, scope = {}) {
  const source = names.map(n => render(templates.get(n), 'test-script', '')).join('\n')
  const params = Object.keys(scope)
  const fn = new Function(...params, `${source}\nreturn { ${exportNames.join(', ')} }`)
  return fn(...params.map(k => scope[k]))
}

const kit = evalBlocks(['autoclaim-kit'], ['maskKey', 'normalizeKey', 'waitFor'], { UI_PREFIX: 'test' })

test('maskKey shows only the first five characters', () => {
  assert.equal(kit.maskKey('ABCDE-FGHIJ'), 'ABCDE…')
  assert.equal(kit.maskKey('ABCDE'), 'ABCDE')
})

test('normalizeKey drops separators and upper-cases', () => {
  assert.equal(kit.normalizeKey('abcd-ef12 34'), 'ABCDEF1234')
})

test('waitFor resolves with the probe value, or null on timeout', async () => {
  let n = 0
  assert.equal(await kit.waitFor(() => ++n >= 3 && 'done', 1000, 1), 'done')
  assert.equal(await kit.waitFor(() => false, 5, 1), null)
})

const steam = evalBlocks(['steam-redeem'], ['STEAM_KEY_RE', 'steamRedeemUrl'])

test('STEAM_KEY_RE finds a key inside surrounding text', () => {
  assert.equal('Key: AB1CD-EF2GH-IJ3KL ok'.match(steam.STEAM_KEY_RE)[0], 'AB1CD-EF2GH-IJ3KL')
  assert.equal('ab1cd-ef2gh-ij3kl'.match(steam.STEAM_KEY_RE), null)
})

test('steamRedeemUrl builds a registerkey URL', () => {
  assert.equal(steam.steamRedeemUrl('AAAAA-BBBBB-CCCCC'), 'steam://registerkey/AAAAA-BBBBB-CCCCC')
})

const gog = evalBlocks(
  ['autoclaim-kit', 'gog-redeem'],
  ['GOG_REDEEM_URL_RE', 'GOG_REDEEM_PATH_RE', 'GOG_PENDING_PREFIX', 'GOG_AUTO_REDEEM_KEY'],
  { UI_PREFIX: 'test', KEY_PREFIX: 'lac' },
)

test('GOG storage keys keep the names Luna shipped with', () => {
  assert.equal(gog.GOG_PENDING_PREFIX, 'lac_gog_pending_v1:')
  assert.equal(gog.GOG_AUTO_REDEEM_KEY, 'lac_gog_auto_redeem_v1')
})

test('GOG_REDEEM_URL_RE accepts redeem URLs, with or without a locale', () => {
  for (const url of [
    'https://www.gog.com/redeem/ABC123-DEF',
    'https://gog.com/en/redeem/ABC123DEF/',
    'https://www.gog.com/pt-br/redeem/ABC123?utm=x',
  ]) {
    assert.ok(gog.GOG_REDEEM_URL_RE.test(url), url)
  }
  assert.equal('https://www.gog.com/redeem/ABC123-DEF'.match(gog.GOG_REDEEM_URL_RE)[1], 'ABC123-DEF')
})

test('GOG_REDEEM_URL_RE rejects other hosts and pages', () => {
  for (const url of [
    'https://www.gog.com/en/game/doom',
    'https://evilgog.com/redeem/ABC',
    'http://www.gog.com/redeem/ABC',
  ]) {
    assert.ok(!gog.GOG_REDEEM_URL_RE.test(url), url)
  }
})

test('GOG_REDEEM_PATH_RE matches only the redeem path', () => {
  assert.equal('/en/redeem/ABC-123'.match(gog.GOG_REDEEM_PATH_RE)[1], 'ABC-123')
  assert.equal('/redeem/ABC/extra'.match(gog.GOG_REDEEM_PATH_RE), null)
})
