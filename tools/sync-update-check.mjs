// Syncs the canonical update-check block into every userscript.
//
//   node tools/sync-update-check.mjs           rewrite the block in place
//   node tools/sync-update-check.mjs --check   report drift, write nothing
//
// Each .user.js marks the generated region with:
//
//   // <update-check>
//   ...generated...
//   // </update-check>
//
// The block is re-indented to match the host file — this repo is
// deliberately mixed (tabs, 2-space, 4-space) and consistent within each
// file, so a single uniform style would fight every diff.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TEMPLATE = path.join('tools', 'update-check.template.js')

const SKIP_DIRS = new Set(['.git', '.claude', 'archive', 'node_modules', 'diagnostics'])

const OPEN_MARKER = '// <update-check>'
const CLOSE_MARKER = '// </update-check>'

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(ROOT, abs)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.endsWith('.dev.resources') || entry.name.endsWith('.dev.res')) continue
      files.push(...walk(abs))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.user.js')) files.push(rel)
  }

  return files
}

// Slug is the file's base name, which is also its folder name by convention.
function slugFor(file) {
  return path.basename(file).replace(/\.user\.js$/, '')
}

// Template is authored with one tab per depth level. Re-emit it using the
// host file's own indent unit, anchored at the marker's indentation.
function render(template, slug, baseIndent) {
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

function syncFile(file, template) {
  const original = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const lines = original.split('\n')

  const openIdx = lines.findIndex(line => line.trim() === OPEN_MARKER)
  const closeIdx = lines.findIndex(line => line.trim() === CLOSE_MARKER)

  if (openIdx === -1 || closeIdx === -1) return { file, status: 'missing-markers' }
  if (closeIdx < openIdx) return { file, status: 'markers-out-of-order' }

  const baseIndent = lines[openIdx].match(/^\s*/)[0]
  const body = render(template, slugFor(file), baseIndent)

  const next = [
    ...lines.slice(0, openIdx),
    baseIndent + OPEN_MARKER,
    ...body.split('\n'),
    baseIndent + CLOSE_MARKER,
    ...lines.slice(closeIdx + 1),
  ].join('\n')

  if (next === original) return { file, status: 'unchanged' }
  return { file, status: 'drift', next }
}

const checkOnly = process.argv.includes('--check')
const template = fs.readFileSync(path.join(ROOT, TEMPLATE), 'utf8').replace(/\n$/, '')

let problems = 0
let written = 0

for (const file of walk(ROOT)) {
  const result = syncFile(file, template)

  switch (result.status) {
    case 'unchanged':
      break

    case 'drift':
      if (checkOnly) {
        console.log(`  drift: ${file} update-check block is out of sync with ${TEMPLATE}`)
        problems++
      } else {
        fs.writeFileSync(path.join(ROOT, file), result.next)
        console.log(`  synced: ${file}`)
        written++
      }
      break

    case 'missing-markers':
      console.log(`  error: ${file} has no ${OPEN_MARKER} / ${CLOSE_MARKER} region`)
      problems++
      break

    case 'markers-out-of-order':
      console.log(`  error: ${file} has ${CLOSE_MARKER} before ${OPEN_MARKER}`)
      problems++
      break
  }
}

if (problems) {
  console.log(`\nUpdate-check sync: ${problems} problem(s)`)
  process.exit(1)
}

console.log(checkOnly ? 'Update-check sync: ok' : `Update-check sync: ok (${written} file(s) rewritten)`)
