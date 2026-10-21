import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const tracePath = join(root, 'docs', 'traceability.md')
const trace = await readFile(tracePath, 'utf8')
const rows = [...trace.matchAll(/^\|\s*(AC-[A-Z]+\d+)\s*\|([^\n]*)/gm)]
const criteria = new Map(rows.map((match) => {
  const columns = match[2].split('|').map((column) => column.trim())
  return [match[1], { disposition: columns[3] ?? '' }]
}))
const acceptanceIds = [...criteria.keys()]
if (acceptanceIds.length === 0) {
  console.error('No acceptance criteria found in docs/traceability.md.')
  process.exit(2)
}

const testRoots = [
  { path: 'tests', match: () => true },
  { path: 'web/e2e', match: () => true },
  { path: 'web/src', match: (name) => /\.(test|spec)\.[jt]sx?$/i.test(name) },
  { path: 'scripts', match: (name) => name === 'delivery-criteria.test.mjs' },
]
const ignoredDirectories = new Set(['bin', 'dist', 'node_modules', 'obj'])
async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(join(directory, entry.name)))
    } else if (entry.isFile() && /\.(cs|tsx?|jsx?|mjs)$/i.test(entry.name)) {
      files.push(join(directory, entry.name))
    }
  }
  return files
}

const testFiles = []
for (const testRoot of testRoots) {
  try {
  testFiles.push(...(await walk(join(root, testRoot.path))).filter((file) => testRoot.match(file.slice(file.lastIndexOf(sep) + 1))))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

const sourceById = new Map()
const namedTestById = new Map()
for (const file of testFiles) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/\b(AC-[A-Z]+\d+)\b/g)) {
    const files = sourceById.get(match[1]) ?? []
    files.push(relative(root, file).split(sep).join('/'))
    sourceById.set(match[1], files)
  }

  const testNames = []
  for (const match of source.matchAll(/\b(?:test|it)\s*\(\s*(['"`])([\s\S]*?)\1/g)) testNames.push(match[2])
  for (const match of source.matchAll(/\[(?:Fact|Theory)\s*\(\s*DisplayName\s*=\s*"([^"]+)"\s*\)\s*\]/g)) testNames.push(match[1])
  for (const name of testNames) {
    for (const match of name.matchAll(/\b(AC-[A-Z]+\d+)\b/g)) {
      const files = namedTestById.get(match[1]) ?? []
      files.push(relative(root, file).split(sep).join('/'))
      namedTestById.set(match[1], files)
    }
  }
}

const deviated = acceptanceIds.filter((id) => criteria.get(id).disposition.toLowerCase().startsWith('deviated:'))
const invalidDisposition = acceptanceIds.filter((id) => !criteria.get(id).disposition || (!/^required$/i.test(criteria.get(id).disposition) && !/^deviated:\s*ADR-\d{4}$/i.test(criteria.get(id).disposition)))
const missing = acceptanceIds.filter((id) => (!sourceById.has(id) || !namedTestById.has(id)) && !deviated.includes(id))
const covered = acceptanceIds.filter((id) => sourceById.has(id) && namedTestById.has(id) && !deviated.includes(id))
console.log(`Acceptance criteria in trace table: ${acceptanceIds.length}`)
console.log(`Required criteria linked to a named test: ${covered.length}`)
for (const id of acceptanceIds.filter((item) => sourceById.has(item))) {
  const disposition = criteria.get(id).disposition.toLowerCase()
  const label = disposition.startsWith('deviated:') ? 'constraint evidence (does not cover criterion)' : 'named test'
  console.log(`  ${id} (${label}): ${[...new Set(sourceById.get(id))].join(', ')}`)
}
for (const id of deviated) console.log(`  ${id}: documented deviation (${criteria.get(id).disposition.slice('deviated:'.length).trim()})`)
if (invalidDisposition.length > 0) {
  console.error(`Invalid/missing criterion disposition (${invalidDisposition.length}): ${invalidDisposition.join(', ')}`)
}
if (missing.length > 0 || invalidDisposition.length > 0) {
  console.error(`Required AC missing a named test (${missing.length}): ${missing.join(', ')}`)
  if (process.argv.includes('--strict')) process.exit(1)
} else {
  console.log('Every required criterion has a named test; deviations remain separate from coverage.')
}
