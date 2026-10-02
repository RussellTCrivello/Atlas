// Lists user-interface strings that have no entry in shared/i18n/ui-phrases.json, so translators know what is missing.
// Informational: it prints a summary and the strings, and exits 0. Pass --json for machine-readable output.
//
// A "string" is JSX text, a text-bearing JSX attribute (title, aria-label, placeholder, label, description, hint, message,
// detail, action, subtitle) or the English source passed to tr()/translateUiText().
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const phrases = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'i18n', 'ui-phrases.json'), 'utf8'))
const known = new Set(Object.keys(phrases.en))
const ATTRIBUTES = new Set([
  'placeholder',
  'aria-label',
  'title',
  'message',
  'description',
  'hint',
  'subtitle',
  'action',
  'detail',
  'label'
])

function collect(file) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found = new Set()
  const add = value => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    // ignore punctuation/number-only fragments
    if (
      normalized &&
      /\p{L}/u.test(normalized) &&
      !/^[\d\s.,:;/%+\-–—·•→←↑↓()[\]{}#@&|=<>!?*'"“”‘’…°$€£]+$/u.test(normalized)
    )
      found.add(normalized)
  }
  ts.forEachChild(source, function visit(node) {
    if (ts.isJsxText(node)) add(node.getText())
    else if (
      ts.isJsxAttribute(node) &&
      ATTRIBUTES.has(node.name.getText()) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      add(node.initializer.text)
    else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'tr' || node.expression.text === 'translateUiText') &&
      node.arguments[1] &&
      ts.isStringLiteralLike(node.arguments[1])
    )
      add(node.arguments[1].text)
    ts.forEachChild(node, visit)
  })
  return found
}

const all = new Set([
  ...collect(path.join(root, 'src', 'main.tsx')),
  ...collect(path.join(root, 'src', 'lib', 'labels.ts'))
])
const missing = [...all].filter(text => !known.has(text)).sort()
if (process.argv.includes('--json')) console.log(JSON.stringify({ total: all.size, missing }, null, 2))
else {
  console.log(
    `${all.size} interface strings, ${all.size - missing.length} with translations, ${missing.length} without (they show in English).`
  )
  console.log(`Languages with entries: ${Object.keys(phrases).join(', ')} (${known.size} phrases each).\n`)
  missing.forEach(text => console.log(`- ${text}`))
}
