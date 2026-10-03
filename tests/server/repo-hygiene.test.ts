// A source file that git ignores is a file that exists on one machine and nowhere else: the build breaks for everyone else. This
// happened once (a `data/` pattern in .gitignore matched src/data/), so it is now checked.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'

const root = path.join(import.meta.dirname, '..', '..')

test('no source, test, script or documentation file is silently ignored by git', t => {
  let ignored: string
  try {
    ignored = execFileSync(
      'git',
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        'src',
        'server',
        'shared',
        'electron',
        'scripts',
        'tests',
        'docs',
        'public',
        '.github'
      ],
      { cwd: root, encoding: 'utf8' }
    )
  } catch {
    return t.skip('not inside a git checkout')
  }
  assert.equal(ignored.trim(), '', `these files exist but are ignored by .gitignore:\n${ignored}`)
})
