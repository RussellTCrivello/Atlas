// The architecture is a rule, not a convention: this test fails when a file reaches into a layer it should not know
// about. Layers, bottom to top (a module may import from its own layer and from layers below it):
//
//   0 foundation   util, fsutil, config          (shared helpers, configuration)
//   1 security     passwords, throttle
//   2 domain       pure rules: workflow, permissions, time, ledger and audit-chain math, report windows (no I/O)
//     export       the export document model and its renderers (CSV, JSON, XLSX, PDF, print HTML): pure, data in, bytes out
//   3 db           the SQLite driver, schema migrations, backups, open/lock, legacy import
//   4 repositories SQL, and only SQL: one class per table or aggregate
//   5 presenters   domain data -> what the browser sees   |  validation: input contracts  |  seed: demo/empty data
//   6 services     business rules; one transaction per use case
//   7 http         routes and middleware
//   8 app / cli    the composition root, the process lifecycle and the command line
//   9 entry        main.ts, index.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import ts from 'typescript'

const SERVER = path.join(import.meta.dirname, '..', '..', 'server')

const RANK: Record<string, number> = {
  foundation: 0,
  security: 1,
  domain: 2,
  export: 2,
  db: 3,
  repositories: 4,
  presenters: 5,
  validation: 5,
  seed: 5,
  services: 6,
  http: 7,
  app: 8,
  cli: 8,
  entry: 9
}

function layerOf(file: string): string {
  const rel = path.relative(SERVER, file).split(path.sep)
  if (rel.length > 1) return rel[0]
  return ['main.ts', 'index.ts'].includes(rel[0]) ? 'entry' : 'foundation'
}

function sourceFiles(dir = SERVER): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

interface Import {
  from: string
  specifier: string
  target: string | null // resolved file inside server/, or null for packages and shared/
  typeOnly: boolean
}

function importsOf(file: string): Import[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: Import[] = []
  const add = (specifier: string, typeOnly: boolean) => {
    let target: string | null = null
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), specifier)
      for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')])
        if (fs.existsSync(candidate)) target = candidate
      if (!target && resolved.startsWith(SERVER)) target = resolved
    }
    found.push({ from: file, specifier, target: target && target.startsWith(SERVER) ? target : null, typeOnly })
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      add(node.moduleSpecifier.text, Boolean(node.importClause?.isTypeOnly))
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      add(node.moduleSpecifier.text, node.isTypeOnly)
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      add(node.arguments[0].text, false)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const files = sourceFiles()
const rel = (file: string) => path.relative(path.join(SERVER, '..'), file).split(path.sep).join('/')

describe('architecture', () => {
  test('every source file belongs to a known layer', () => {
    for (const file of files) assert.ok(layerOf(file) in RANK, `${rel(file)} is in an unknown layer "${layerOf(file)}"`)
  })

  test('a module only imports from its own layer or the layers below it', () => {
    const violations: string[] = []
    for (const file of files)
      for (const edge of importsOf(file)) {
        if (!edge.target) continue
        const from = layerOf(file)
        const to = layerOf(edge.target)
        // The one deliberate exception: routes take the application container as a parameter, so they name its type.
        const containerType =
          edge.typeOnly && rel(edge.target) === 'server/app/container.ts' && (from === 'http' || from === 'cli')
        if (RANK[to] > RANK[from] && !containerType)
          violations.push(`${rel(file)} (${from}) imports ${edge.specifier} (${to}), which is above it`)
      }
    assert.deepEqual(violations, [])
  })

  test('the domain and the renderers are pure: they import no I/O layer', () => {
    const allowed = new Set(['domain', 'export', 'foundation'])
    const violations = files

      .filter(file => ['domain', 'export'].includes(layerOf(file)))
      .flatMap(file =>
        importsOf(file)
          .filter(edge => edge.target && !allowed.has(layerOf(edge.target)))
          .map(edge => `${rel(file)} imports ${edge.specifier}`)
      )
    assert.deepEqual(violations, [])
    for (const file of files.filter(file => layerOf(file) === 'domain'))
      for (const edge of importsOf(file))
        assert.ok(
          !/^node:(fs|http|net|child_process|sqlite)$/.test(edge.specifier),
          `${rel(file)} imports ${edge.specifier}`
        )
  })

  test('routes and presenters never touch repositories or the database directly', () => {
    const violations: string[] = []
    for (const file of files.filter(f => ['http', 'presenters'].includes(layerOf(f))))
      for (const edge of importsOf(file)) {
        if (!edge.target) continue
        const to = layerOf(edge.target)
        if (to === 'db' || to === 'repositories') {
          // A presenter may name a repository's *type* (the shape of a row set it renders); it never calls one.
          if (layerOf(file) === 'presenters' && edge.typeOnly) continue
          violations.push(`${rel(file)} imports ${edge.specifier}`)
        }
      }
    assert.deepEqual(violations, [])
  })

  test('only the driver talks to node:sqlite', () => {
    const offenders = files.filter(
      file =>
        rel(file) !== 'server/db/driver.ts' && importsOf(file).some(edge => /^(node:)?sqlite$/.test(edge.specifier))
    )
    assert.deepEqual(offenders.map(rel), [])
    const text = fs.readFileSync(path.join(SERVER, 'db', 'driver.ts'), 'utf8')
    assert.match(text, /createRequire\(import\.meta\.url\)\('node:sqlite'\)/)
  })

  test('SQL text lives in the database layer and the repositories, nowhere else', () => {
    const sql =
      /['"`][^'"`\n]*\b(SELECT\s[\s\S]{0,80}?\sFROM\s|INSERT\s+INTO\s|UPDATE\s+\w+\s+SET\s|DELETE\s+FROM\s|PRAGMA\s+\w)/i
    const offenders: string[] = []
    for (const file of files.filter(f => !['db', 'repositories'].includes(layerOf(f)))) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
          if (sql.test(line)) offenders.push(`${rel(file)}:${index + 1}  ${line.trim().slice(0, 90)}`)
        })
    }
    assert.deepEqual(offenders, [])
  })

  test('files stay small enough to read: no server module is longer than 450 lines', () => {
    const long = files
      .map(file => ({ file: rel(file), lines: fs.readFileSync(file, 'utf8').split('\n').length }))
      .filter(x => x.lines > 450)
    assert.deepEqual(long, [])
  })

  test('routes are thin: a route file holds no business rules (no repository or settings logic)', () => {
    for (const file of files.filter(f => rel(f).startsWith('server/http/routes/'))) {
      const text = fs.readFileSync(file, 'utf8')
      assert.ok(!/\.repos\./.test(text), `${rel(file)} reaches into repositories`)
      assert.ok(text.split('\n').length <= 120, `${rel(file)} is not thin any more`)
    }
  })
})
