// Syncs canonical shared blocks into every userscript.
//
//   node tools/sync-blocks.mjs           rewrite every block in place
//   node tools/sync-blocks.mjs --check   report drift, write nothing
//
// Each .user.js marks a generated region with the block's name:
//
//   // <autoclaim-kit>
//   ...generated...
//   // </autoclaim-kit>
//
// `update-check` is required in every script. The other blocks are opt-in:
// a script gets one only if it carries that block's markers.
//
// Blocks are re-indented to match the host file — this repo is deliberately
// mixed (tabs, 2-space, 4-space) and consistent within each file, so a
// single uniform style would fight every diff.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BLOCKS = [
  { name: 'update-check', template: 'tools/update-check.template.js', required: true },
  { name: 'autoclaim-kit', template: 'tools/blocks/autoclaim-kit.template.js' },
  { name: 'steam-redeem', template: 'tools/blocks/steam-redeem.template.js' },
]

const SKIP_DIRS = new Set(['.git', '.claude', 'archive', 'node_modules', 'diagnostics'])

function walk(root, dir = root) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(root, abs)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.endsWith('.dev.resources') || entry.name.endsWith('.dev.res')) continue
      files.push(...walk(root, abs))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.user.js')) files.push(rel)
  }

  return files
}

// Slug is the file's base name, which is also its folder name by convention.
export function slugFor(file) {
  return path.basename(file).replace(/\.user\.js$/, '')
}

// Templates are authored with one tab per depth level. Re-emit them using
// the host file's own indent unit, anchored at the marker's indentation.
export function render(template, slug, baseIndent) {
  const unit = baseIndent.length > 0 ? baseIndent : '\t'

  return template
    .replace(/\{\{SLUG\}\}/g, slug)
    .replace(/\{\{STORAGE_PREFIX\}\}/g, slug.replace(/-/g, '_'))
    .split('\n')
    .map(line => {
      if (line.trim() === '') return ''
      const depth = line.match(/^\t*/)[0].length
      return baseIndent + unit.repeat(depth) + line.slice(depth)
    })
    .join('\n')
}

// Rewrites one block in `text`. Returns the new text, or a status string
// when the block can't be synced.
export function syncBlock(text, block, template, slug) {
  const open = `// <${block.name}>`
  const close = `// </${block.name}>`
  const lines = text.split('\n')

  const openIdx = lines.findIndex(line => line.trim() === open)
  const closeIdx = lines.findIndex(line => line.trim() === close)

  if (openIdx === -1 && closeIdx === -1) return block.required ? 'missing-markers' : 'absent'
  if (openIdx === -1 || closeIdx === -1) return 'unpaired-marker'
  if (closeIdx < openIdx) return 'markers-out-of-order'

  const baseIndent = lines[openIdx].match(/^\s*/)[0]
  const body = render(template, slug, baseIndent)

  return [
    ...lines.slice(0, openIdx),
    baseIndent + open,
    ...body.split('\n'),
    baseIndent + close,
    ...lines.slice(closeIdx + 1),
  ].join('\n')
}

const PROBLEMS = {
  'missing-markers': (b, file) => `${file} has no // <${b.name}> / // </${b.name}> region`,
  'unpaired-marker': (b, file) => `${file} has only one of // <${b.name}> / // </${b.name}>`,
  'markers-out-of-order': (b, file) => `${file} has // </${b.name}> before // <${b.name}>`,
}

export function syncFile(root, file, templates) {
  const original = fs.readFileSync(path.join(root, file), 'utf8')
  const slug = slugFor(file)
  const problems = []
  const drifted = []
  let next = original

  for (const block of BLOCKS) {
    const result = syncBlock(next, block, templates.get(block.name), slug)
    if (result === 'absent') continue
    if (PROBLEMS[result]) {
      problems.push(PROBLEMS[result](block, file))
      continue
    }
    if (result !== next) drifted.push(block)
    next = result
  }

  return { file, problems, drifted, next, changed: next !== original }
}

export function loadTemplates(root) {
  const templates = new Map()
  for (const block of BLOCKS) {
    templates.set(block.name, fs.readFileSync(path.join(root, block.template), 'utf8').replace(/\n$/, ''))
  }
  return templates
}

export function main() {
  const root = process.cwd()
  const checkOnly = process.argv.includes('--check')
  const templates = loadTemplates(root)

  let problems = 0
  let written = 0

  for (const file of walk(root)) {
    const result = syncFile(root, file, templates)

    for (const message of result.problems) {
      console.log(`  error: ${message}`)
      problems++
    }
    if (!result.changed) continue

    if (checkOnly) {
      for (const block of result.drifted) {
        console.log(`  drift: ${file} ${block.name} block is out of sync with ${block.template}`)
        problems++
      }
    } else {
      fs.writeFileSync(path.join(root, file), result.next)
      console.log(`  synced: ${file} (${result.drifted.map(b => b.name).join(', ')})`)
      written++
    }
  }

  if (problems) {
    console.log(`\nBlock sync: ${problems} problem(s)`)
    process.exit(1)
  }

  console.log(checkOnly ? 'Block sync: ok' : `Block sync: ok (${written} file(s) rewritten)`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
