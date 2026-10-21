import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const ignoredDirectories = new Set(['.git', 'bin', 'dist', 'node_modules', 'obj'])

async function walk(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(join(directory, entry.name)))
    } else if (entry.isFile()) {
      files.push(join(directory, entry.name))
    }
  }
  return files
}

const files = await walk(root)
const testProjects = []
for (const file of files.filter((path) => path.endsWith('.csproj'))) {
  const project = await readFile(file, 'utf8')
  if (/<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(project) || /Microsoft\.NET\.Test\.Sdk/i.test(project)) {
    testProjects.push(file)
  }
}

let ranSuite = false
for (const project of testProjects) {
  ranSuite = true
  const label = relative(root, project).split(sep).join('/')
  console.log(`Running .NET tests: ${label}`)
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'dotnet.mjs'), 'test', project, '--configuration', 'Release'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const packageJson = JSON.parse(await readFile(join(root, 'frontend', 'package.json'), 'utf8'))
if (packageJson.scripts?.test) {
  ranSuite = true
  console.log('Running frontend tests: npm test --prefix frontend')
  const result = spawnSync('npm', ['test', '--prefix', 'frontend'], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

ranSuite = true
console.log('Running delivery documentation and command-contract tests')
const deliveryTests = spawnSync(process.execPath, ['--test', join(root, 'scripts', 'delivery-criteria.test.mjs')], { stdio: 'inherit' })
if (deliveryTests.error) throw deliveryTests.error
if (deliveryTests.status !== 0) process.exit(deliveryTests.status ?? 1)

console.log('Running architecture boundary tests')
const architectureTests = spawnSync(process.execPath, [join(root, 'scripts', 'architecture-boundaries.test.mjs')], { stdio: 'inherit' })
if (architectureTests.error) throw architectureTests.error
if (architectureTests.status !== 0) process.exit(architectureTests.status ?? 1)

if (!ranSuite) console.log('No .NET or frontend product test suite is configured; only delivery documentation tests ran.')
